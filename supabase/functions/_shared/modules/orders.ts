import type { Executor } from "../postgres.ts";
import { readModel } from "../repository.ts";
import { check } from "../legacy/server/integrity.ts";
import { buildOrderReadModel, filterCustomOrders } from "../legacy/read/order-read-model.ts";
import { paginateOrders, readCustomFilter } from "../legacy/read/order-filters.ts";
import { calendarDay, filterColumnRows, readTableState, sortColumnRows, type ColumnCell } from "../legacy/read/order-table.ts";
import { orderLines, orderReference, words } from "../legacy/shared/schema.ts";
import { sha256 } from "../security.ts";

export async function orderList(db: Executor, params: URLSearchParams) {
  const model = await readModel(db, ["proveedor", "productos", "materiales", "codigos_barras", "orden_compra",
    "orden_producto", "orden_material", "orden_otro", "lote_producto", "abastecimiento_material", "documento"]);
  const group = params.get("grupo") === "materiales" ? "materiales" : "productos";
  const requestedType = params.get("tipo");
  const view = params.get("vista");
  const search = (params.get("q") ?? "").toLowerCase();
  const { filters, sort } = readTableState(params);
  const day = calendarDay(new Date().toISOString())!;
  const custom = readCustomFilter(params.get("filtro"), group);
  const orders = buildOrderReadModel(model).orders.filter((o) => {
    const inGroup = group === "productos" ? o.tipo_orden === "producto" : o.tipo_orden !== "producto";
    const inView = !view || (view === "no_autorizadas" ? o.visible === "no_autorizada" : view === "anuladas"
      ? o.visible === "anulada" : ["autorizada", "parcialmente_anulada", "cerrada"].includes(o.visible));
    return inGroup && inView && (!requestedType || o.tipo_orden === requestedType) && o.searchText.includes(search);
  });
  const value = (key: string | null, label = key ?? "—", filterValue = key): ColumnCell => ({
    sortValue: filterValue, values: [{ key: key ?? "__sin_valor__", label, value: filterValue }],
  });
  const candidates = filterCustomOrders(orders, custom, day).sort((a, b) =>
    (b.fecha_elaboracion ?? "").localeCompare(a.fecha_elaboracion ?? "") ||
    Number(b.no_orden) - Number(a.no_orden) || a.id.localeCompare(b.id)).map((o) => ({
      id: o.id, tipo_orden: o.tipo_orden, no_orden: o.no_orden, fecha_elaboracion: o.fecha_elaboracion,
      fecha_solicitada_entrega: o.fecha_solicitada_entrega, estado: o.visible, total: o.total,
      proveedor: o.p.nombre_corto ?? o.p.nombre_largo ?? "", conceptos: o.name,
      cells: {
        orden: value(o.no_orden, orderReference(o.tipo_orden, o.no_orden)),
        proveedor: {
          sortValue: o.p.nombre_corto ?? o.p.nombre_largo,
          values: [{ key: o.p.id, label: o.p.nombre_corto ?? o.p.nombre_largo ?? "", value: o.p.nombre_corto ?? o.p.nombre_largo }],
          searchValues: [o.p.nombre_corto, o.p.nombre_largo, o.p.nit, "NIT " + (o.p.nit ?? "Sin informar")].filter((entry): entry is string => !!entry),
        },
        productos: { sortValue: o.itemValues[0]?.value ?? null,
          values: o.itemValues.length ? o.itemValues : [{ key: "__sin_valor__", label: o.name, value: null }] },
        elaboracion: value(o.elaborationDay), entrega: value(o.deliveryDay),
        estado: { ...value(o.visible, words[o.visible]), sortValue: words[o.visible] }, total: value(o.total),
      },
    }));
  const filtered = sortColumnRows(filterColumnRows(candidates, filters), sort);
  const cursor = params.get("cursor");
  const signature = sha256(JSON.stringify([group, view, requestedType, search, custom, filters, sort])).slice(0, 16);
  const page = paginateOrders(filtered, params.get("pagina"));
  let start = (page.page - 1) * 50;
  if (cursor) {
    const [hash, id] = cursor.split(".");
    const index = filtered.findIndex((o) => o.id === id);
    check(hash === signature && index >= 0, "El listado cambió. Vuelve a la primera página.", "CURSOR_CHANGED");
    start = index + 1;
  }
  const results = filtered.slice(start, start + 50);
  return {
    items: results.map(({ cells: _, ...item }) => item), total: filtered.length,
    page: start === (page.page - 1) * 50 ? page.page : Math.floor(start / 50) + 1,
    pageCount: page.pageCount, start: results.length ? start + 1 : 0, end: start + results.length,
    cursor: start + results.length < filtered.length ? signature + "." + results.at(-1)!.id : null,
  };
}

export async function orderDetail(db: Executor, id: string) {
  const model = await readModel(db, ["orden_compra", "orden_producto", "orden_material", "orden_otro", "lote_producto"]);
  const order = model.orden_compra.find((item) => item.id === id);
  check(order, "La orden ya no existe.", "NOT_FOUND");
  const lines = orderLines(model, id);
  const lineIds = new Set(lines.map((line) => line.id));
  const [version] = await db.query<{ version: number }>("select version::float8 version from gimed.orden_compra where id=$1", [id]);
  check(version, "La orden ya no existe.", "NOT_FOUND");
  return { orden: order, renglones: lines, lotes: model.lote_producto.filter((lot) => lineIds.has(lot.id_orden_producto)), version: version.version };
}
