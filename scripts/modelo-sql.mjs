import fs from "node:fs";

const meta = JSON.parse(fs.readFileSync(new URL("../supabase/functions/_shared/legacy/shared/entities.json", import.meta.url)));
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const list = (fields) => fields.map(quote).join(", ");
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const businessDates = new Set([
  "fecha_solicitada_entrega", "fecha_estimada_batch_record", "fecha_entrega_batch_record", "fecha_inspeccion",
  "fecha_recepcion", "fecha_confirmacion", "fecha_estimada_entrega", "fecha_entrega",
]);
const type = (name, field, table) => (name === "datetime" &&
  (businessDates.has(field) || (table === "costos_maquila" && ["fecha_inicio", "fecha_fin"].includes(field)))) ? "date" : ({
  object_id: "uuid", uuid: "uuid", integer: "bigint", boolean: "boolean", datetime: "timestamptz",
  "decimal(14,2)": "numeric(14,2)", "float(5,2)": "numeric(5,2)"
}[name] ?? "text");
const lines = [
  "-- Esquema inicial generado desde el modelo revisado del prototipo.",
  "create schema gimed;",
  "revoke all on schema gimed from public, anon, authenticated;",
  "create role gimed_runtime login noinherit;",
  "grant usage on schema gimed to gimed_runtime;",
];
for (const [table, { fields, pk, unique }] of Object.entries(meta.tables)) {
  const columns = Object.entries(fields).map(([key, field]) => {
    const values = meta.enums[field.type];
    const constraint = values ? " check (" + quote(key) + " in (" + values.map(literal).join(", ") + "))" : "";
    return "  " + quote(key) + " " + type(field.type, key, table) + (field.required ? " not null" : "") + constraint;
  });
  const keys = ["  primary key (" + list(pk) + ")", ...unique.map((key, i) =>
    "  constraint " + table + "_uq_" + i + " unique (" + list(key) + ") deferrable initially deferred"
  )];
  lines.push("create table gimed." + quote(table) + " (\n" + [...columns, ...keys].join(",\n") + "\n);");
}
for (const { table, field, target, targetField } of meta.refs) {
  lines.push("alter table gimed." + quote(table) + " add foreign key (" + quote(field) + ") references gimed." +
    quote(target) + " (" + quote(targetField) + ") deferrable initially deferred;");
  if (meta.tables[table].pk[0] !== field)
    lines.push("create index on gimed." + quote(table) + " (" + quote(field) + ");");
}
console.log(lines.join("\n"));
