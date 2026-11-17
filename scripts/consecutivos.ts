import { connect } from "../supabase/functions/_shared/postgres.ts";

const environment = process.env;
function base(name: string) {
  const value = environment[name];
  if (!value || !/^\d{1,15}$/.test(value)) throw new Error(name + " debe ser un entero entre 0 y 999999999999998");
  const parsed = Number(value);
  if (parsed >= 999999999999999) throw new Error(name + " no deja espacio para emitir.");
  return parsed;
}
if (!environment.GIMED_ADMIN_DB_URL) throw new Error("Configura GIMED_ADMIN_DB_URL");
const desired = { producto: base("GIMED_OC_BASE"), material: base("GIMED_OCM_BASE") };
const db = connect(environment.GIMED_ADMIN_DB_URL);
try {
  const result = await db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(55193, 1)");
    const orders = await tx.query("select 1 from gimed.orden_compra limit 1");
    const existing = await tx.query<{ grupo: keyof typeof desired; ultimo_numero: string }>("select grupo,ultimo_numero from gimed.consecutivo_orden");
    if (existing.length) {
      if (existing.length !== 2 || existing.some((row) => Number(row.ultimo_numero) !== desired[row.grupo])) {
        throw new Error("Los consecutivos ya están inicializados o tienen emisiones. No se modificaron.");
      }
      return existing;
    }
    if (orders.length) throw new Error("Hay órdenes existentes. Reconcilia sus máximos antes de inicializar.");
    return tx.query("insert into gimed.consecutivo_orden (grupo,ultimo_numero) values ('producto',$1),('material',$2) returning *",
      [desired.producto, desired.material]);
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await db.close(); }
