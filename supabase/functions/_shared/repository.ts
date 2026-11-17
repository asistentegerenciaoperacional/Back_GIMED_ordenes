import type { Database } from "./legacy/shared/models.ts";
import { emptyDatabase, entities, meta, primaryKey, type Entity, type Row } from "./legacy/shared/schema.ts";
import { validateDatabase } from "./legacy/server/integrity.ts";
import type { Executor, Postgres } from "./postgres.ts";

export const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const table = (name: Entity) => "gimed." + identifier(name);
const businessDates = new Set([
  "fecha_solicitada_entrega", "fecha_estimada_batch_record", "fecha_entrega_batch_record", "fecha_inspeccion",
  "fecha_recepcion", "fecha_confirmacion", "fecha_estimada_entrega", "fecha_entrega",
]);
const isBusinessDate = (name: Entity, field: string) =>
  businessDates.has(field) || (name === "costos_maquila" && ["fecha_inicio", "fecha_fin"].includes(field));

export async function readModel(db: Executor, include: readonly Entity[] = entities): Promise<Database> {
  const model = emptyDatabase();
  // A single JSON projection keeps dependent collections consistent at the statement boundary.
  const selects = include.map((name) => {
    const fields = Object.entries(meta.tables[name].fields).map(([field, spec]) => {
      const column = identifier(field);
      if (isBusinessDate(name, field)) return "to_char(" + column + ", 'YYYY-MM-DD') || 'T12:00:00.000Z' as " + column;
      if (spec.type === "datetime") return "to_char(" + column + " at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as " + column;
      return spec.type === "decimal(14,2)" ? column + "::text as " + column : column;
    });
    return "(select coalesce(jsonb_agg(t), '[]'::jsonb) from (select " + fields.join(", ") + " from " +
      table(name) + " order by " + meta.tables[name].pk.map(identifier).join(", ") + ") t) as " + identifier(name);
  });
  if (selects.length) Object.assign(model, (await db.query("select " + selects.join(", ")))[0]);
  return model;
}

export type Changes = Record<string, { upsert: Row[]; remove: string[] }>;
export async function workspace(db: Postgres) {
  return db.transaction(async (tx) => {
    await tx.query("set transaction isolation level repeatable read read only");
    const [{ revision }] = await tx.query<{ revision: number }>("select revision::float8 revision from gimed.workspace_revision where id=1");
    const data = await readModel(tx, entities.filter((name) => name !== "comentario" && name !== "usuario"));
    const versions = new Map((await tx.query<{ id: string; version: number }>(
      "select id, version::float8 version from gimed.orden_compra"
    )).map((row) => [row.id, row.version]));
    for (const order of data.orden_compra) Object.assign(order, { version: versions.get(order.id) });
    return { data, revision };
  });
}
export function differences(previous: Database, next: Database): Changes {
  const changes: Changes = {};
  for (const name of entities) {
    const before = new Map((previous[name] as Row[]).map((row) => [primaryKey(name, row), row]));
    const upsert: Row[] = [];
    for (const row of next[name] as Row[]) {
      const key = primaryKey(name, row);
      const old = before.get(key);
      if (!old || Object.keys(row).some((field) => old[field] !== row[field])) upsert.push(row);
      before.delete(key);
    }
    if (upsert.length || before.size) changes[name] = { upsert, remove: [...before.keys()] };
  }
  return changes;
}

export async function writeChanges(db: Executor, changes: Changes) {
  for (const name of entities) {
    const change = changes[name];
    if (!change) continue;
    const { pk, fields } = meta.tables[name];
    for (const key of change.remove) {
      const conditions = pk.map((field, index) => identifier(field) + " = $" + (index + 1));
      await db.query("delete from " + table(name) + " where " + conditions.join(" and "), JSON.parse(key));
    }
    const columns = Object.keys(fields);
    const update = columns.filter((field) => !pk.includes(field)).map((field) => identifier(field) + " = excluded." + identifier(field));
    const upserts = name === "codigos_barras"
      ? [...change.upsert].sort((a, b) => Number(a.estado === "asignado") - Number(b.estado === "asignado"))
      : change.upsert;
    for (const row of upserts) {
      await db.query(
        "insert into " + table(name) + " (" + columns.map(identifier).join(", ") + ") values (" +
        columns.map((field, index) => {
          const parameter = "$" + (index + 1);
          return isBusinessDate(name, field) ? "(" + parameter + "::text::timestamptz at time zone 'America/Bogota')::date" : parameter;
        }).join(", ") + ") on conflict (" + pk.map(identifier).join(", ") +
        ") " + (update.length ? "do update set " + update.join(", ") : "do nothing"),
        columns.map((column) => row[column]),
      );
    }
  }
}

export async function modify<T>(db: Postgres, actor: string | null, event: string, run: (model: Database, tx: Executor) => Promise<T> | T) {
  return db.transaction(async (tx) => {
    // La transición conserva las reglas globales, incluso entre instancias del back.
    await tx.query("select pg_advisory_xact_lock(55193, 1)");
    const previous = await readModel(tx);
    const model = structuredClone(previous);
    const result = await run(model, tx);
    const changes = differences(previous, validateDatabase(model, previous));
    await writeChanges(tx, changes);
    if (changes.orden_compra?.upsert.length) {
      const versionRows = await tx.query<{ id: string; version: number }>(
        "select id,version::float8 version from gimed.orden_compra where id=any($1::uuid[])",
        [changes.orden_compra.upsert.map((order) => order.id)]
      );
      const versions = new Map(versionRows.map((item) => [item.id, item.version]));
      for (const order of changes.orden_compra.upsert) order.version = versions.get(order.id);
    }
    const touched = Object.keys(changes);
    if (touched.length) {
      await tx.query("insert into gimed.audit_event (actor, accion, colecciones) values ($1, $2, $3::text::jsonb)",
        [actor, event, JSON.stringify(touched)]);
    }
    const publicChanges = touched.some((name) => name !== "comentario" && name !== "usuario");
    const [{ revision }] = await tx.query<{ revision: number }>(publicChanges
      ? "update gimed.workspace_revision set revision=revision+1 where id=1 returning revision::float8 revision"
      : "select revision::float8 revision from gimed.workspace_revision where id=1");
    delete changes.comentario;
    delete changes.usuario;
    return { result, changes, revision };
  });
}
