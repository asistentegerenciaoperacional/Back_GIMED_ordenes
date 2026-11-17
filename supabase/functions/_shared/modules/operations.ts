import { command } from "../legacy/server/domain.ts";
import { check } from "../legacy/server/integrity.ts";
import type { Row } from "../legacy/shared/schema.ts";
import type { Postgres } from "../postgres.ts";
import { modify } from "../repository.ts";
import { sha256 } from "../security.ts";

export const operations = {
  "catalogos/guardar": "saveEntity",
  "catalogos/eliminar": "deleteEntity",
  "catalogos/materiales-producto": "setProductMaterials",
  "catalogos/proveedores-favoritos": "setFavoriteSuppliers",
  "catalogos/tolerancia": "setTolerance",
  "ordenes": "createOrder",
  "ordenes/editar": "editOrder",
  "ordenes/autorizar": "authorizeOrder",
  "ordenes/autorizar-varias": "authorizeOrders",
  "ordenes/hoja-producto": "saveProductOrderSheet",
  "ordenes/hoja-material": "saveMaterialOrderSheet",
  "ordenes/estados-renglon-material": "setMaterialSheetLineStates",
  "ordenes/eliminar-renglones-material": "deleteMaterialSheetLines",
  "ordenes/estado-renglon": "setLineState",
  "ordenes/estados-renglon-producto": "setProductLineStates",
  "ordenes/estados-lote": "setProductLotStates",
  "ordenes/lotes-producto": "createProductLots",
  "ordenes/lote/guardar": "saveLot",
  "ordenes/lote/eliminar": "deleteLot",
  "ordenes/lotes/eliminar": "deleteLots",
  "abastecimiento/vincular": "linkMaterialSupply",
  "recepciones/guardar": "saveReceipt",
  "facturas": "createInvoice",
  "facturas/asignar": "assignInvoice",
  "codigos": "createBarcode",
  "codigos/avanzar": "advanceBarcode",
  "codigos/asignar": "setAssignedBarcode",
  "correos/plantilla-cotizacion": "saveQuotationTemplate",
} as const;

export async function applyOperation(
  db: Postgres, actor: string, operation: (typeof operations)[keyof typeof operations], payload: Row, requestKey: string,
) {
  const fingerprint = sha256(JSON.stringify([operation, payload]));
  return modify(db, actor, operation, async (model, tx) => {
    const [saved] = await tx.query<{ fingerprint: string; result: Row }>(
      "select fingerprint,result from gimed.idempotency where actor=$1 and request_key=$2", [actor, requestKey]);
    if (saved) {
      check(saved.fingerprint === fingerprint, "Ya se usó esta clave para otra operación.", "REQUEST_CHANGED");
      return saved.result;
    }
    if (operation === "createOrder" || operation === "editOrder") {
      check(model.consecutivo_orden.length === 2, "Inicializa los consecutivos de OC y OCM antes de emitir.", "CONSECUTIVE_REQUIRED");
    }
    if (operation === "createInvoice") {
      check(!payload.document, "Agrega el archivo después de crear la factura.", "VALIDATION");
    }
    if (operation === "editOrder" && payload.expected_version !== undefined) {
      const [entry] = await tx.query<{ version: number }>("select version::float8 version from gimed.orden_compra where id=$1", [payload.id]);
      check(entry?.version === payload.expected_version, "La orden cambió. Actualiza antes de guardar.", "ORDER_CHANGED");
    }
    const result = await command(model, operation, payload);
    if (operation === "createOrder") {
      const record = model.orden_compra.find((order) => order.id === result.orderId)!;
      Object.assign(result, { id: record.id, numero: record.no_orden, version: 1 });
    }
    await tx.query("insert into gimed.idempotency (actor,request_key,fingerprint,result) values ($1,$2,$3,$4::text::jsonb)",
      [actor, requestKey, fingerprint, JSON.stringify(result)]);
    return result;
  });
}
