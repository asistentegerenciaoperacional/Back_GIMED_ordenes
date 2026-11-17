import { connect } from "../supabase/functions/_shared/postgres.ts";

const url = process.env.GIMED_ADMIN_DB_URL;
if (!url) throw new Error("Configura GIMED_ADMIN_DB_URL");
const apply = process.argv.includes("--apply");
const db = connect(url);
try {
  const rows = await db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(55193, 1)");
    const report = await tx.query<{ grupo: string; base: string; nuevo: string }>(
      "select c.grupo, c.ultimo_numero::text base, greatest(c.ultimo_numero,coalesce(max(o.no_orden::bigint),0))::text nuevo " +
      "from gimed.consecutivo_orden c left join gimed.orden_compra o on o.grupo=c.grupo group by c.grupo,c.ultimo_numero order by c.grupo",
    );
    if (report.length !== 2) throw new Error("Inicializa los dos grupos antes de reconciliar.");
    if (apply) {
      for (const row of report) {
        if (row.base === row.nuevo) continue;
        await tx.query("update gimed.consecutivo_orden set ultimo_numero=$2 where grupo=$1", [row.grupo, row.nuevo]);
      }
      if (report.some((row) => row.base !== row.nuevo)) {
        await tx.query("update gimed.workspace_revision set revision=revision+1 where id=1");
        await tx.query("insert into gimed.audit_event (accion,colecciones) values ('consecutivos.reconciliar','[\"consecutivo_orden\"]')");
      }
    }
    return report;
  });
  console.log(JSON.stringify({ aplicado: apply, grupos: rows }, null, 2));
} finally { await db.close(); }
