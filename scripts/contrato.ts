import { writeFileSync } from "node:fs";
import { operations } from "../supabase/functions/_shared/modules/operations.ts";

const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const json = (schema: object) => ({ "application/json": { schema } });
const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const row = { type: "object", additionalProperties: true };
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 422, 500, 503].map((code) =>
  [code, { description: "Error de API", content: json(ref("Error")) }]));
const input = (schema = row) => ({ required: true, content: json(schema) });
const auth = [{ Session: [] }];
const security = (method: string, idempotent: boolean) => ([
  ...(method === "post" ? [{ name: "X-Gimed-Csrf", in: "header", required: true, schema: { const: "1" } }] : []),
  ...(idempotent ? [{ name: "Idempotency-Key", in: "header", required: true, schema: uuid }] : []),
]);
function endpoint(id: string, method: "get" | "post", status = 200, output?: object, options: {
  body?: object; public?: boolean; idempotent?: boolean; params?: object[];
} = {}) {
  return {
    operationId: id,
    security: options.public ? [] : auth,
    parameters: [...security(method, !!options.idempotent), ...(options.params ?? [])],
    ...(options.body ? { requestBody: input(options.body as typeof row) } : {}),
    responses: {
      [status]: { description: status >= 300 ? "Redirección" : "Respuesta correcta", ...(output ? { content: json(output) } : {}),
        ...(status >= 300 ? { headers: { Location: { schema: string } } } : {}) },
      ...errors,
    },
  };
}
const req = (required: string[], properties: Record<string, object>) => ({ type: "object", required, properties });
const param = (name: string, where: "path" | "query", schema = string) =>
  ({ name, in: where, required: where === "path", schema });
const byId = [param("id", "path", uuid)];
const paths: Record<string, object> = {
  "/health": { get: endpoint("health", "get", 200, req(["ok"], { ok: { const: true } }), { public: true }) },
  "/auth/inicio": { get: endpoint("authStart", "get", 302, undefined, { public: true }) },
  "/auth/callback": { get: endpoint("authCallback", "get", 303, undefined, { public: true, params: [param("code", "query"), param("state", "query")] }) },
  "/auth/session": { get: endpoint("authSession", "get", 200, req(["usuario"], { usuario: ref("Usuario") })) },
  "/auth/logout": { post: endpoint("authLogout", "post", 204) },
  "/contexto": { get: endpoint("contexto", "get", 200, req(["data","revision"], {
    data: { type: "object", additionalProperties: { type: "array", items: row } }, revision: { type: "integer" },
  })) },
  "/ordenes": { get: endpoint("orderList", "get", 200, ref("ListadoOrdenes"), {
    params: ["grupo", "tipo", "vista", "q", "filtro", "filtros", "estado", "ordenar", "direccion", "cursor", "pagina"].map((name) => param(name, "query")),
  }) },
  "/ordenes/{id}": { get: endpoint("orderDetail", "get", 200, req(["orden","renglones","lotes","version"], {
    orden: row, renglones: { type: "array", items: row }, lotes: { type: "array", items: row }, version: { type: "integer" },
  }), { params: byId }) },
  "/comentarios/{tipo}/{id}": { get: endpoint("lineComments", "get", 200, { type: "array", items: row }, { params: [param("tipo", "path"), ...byId] }) },
  "/comentarios": { post: endpoint("createComment", "post", 201, row, { body: req(["tipo","id","texto"], { tipo: string, id: uuid, texto: string }) }) },
  "/documentos/cargas": { post: endpoint("reserveUpload", "post", 201, ref("Reserva"), { body: ref("Carga") }) },
  "/documentos/cargas/{id}/confirmar": { post: endpoint("confirmUpload", "post", 200, ref("Operacion"), { params: byId }) },
  "/documentos/{id}/eliminar": { post: endpoint("deleteDocument", "post", 200, ref("Operacion"), { params: byId }) },
  "/documentos/{id}/contenido": { get: endpoint("downloadDocument", "get", 302, undefined, { params: [...byId, param("download", "query")] }) },
  "/correos/gmail/inicio": { get: endpoint("gmailStart", "get", 302) },
  "/correos/gmail/callback": { get: endpoint("gmailCallback", "get", 303) },
  "/correos/gmail": { get: endpoint("gmailStatus", "get", 200, req(["conectado"], { conectado: { type: "boolean" } })) },
  "/correos/previsualizaciones": { post: endpoint("mailPreview", "post", 200, row, { body: row }) },
  "/correos/cotizaciones/previsualizaciones": { post: endpoint("quotationsPreview", "post", 200, row, { body: row }) },
  "/correos/envios": { post: endpoint("sendMail", "post", 200, ref("Operacion"), { body: row, idempotent: true }) },
  "/correos/cotizaciones/envios": { post: endpoint("sendQuotations", "post", 200, ref("Operacion"), { body: row, idempotent: true }) },
};
for (const [path, operation] of Object.entries(operations)) {
  const created = path === "ordenes" || path === "facturas";
  paths["/" + path] = { ...paths["/" + path], post: endpoint(operation, "post", created ? 201 : 200, ref("Operacion"), {
    body: path === "ordenes" ? ref("NuevaOrden") : row, idempotent: true,
  }) };
}
const contract = {
  openapi: "3.1.0",
  info: { title: "GIMED Órdenes", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
  paths,
  components: {
    securitySchemes: { Session: { type: "apiKey", in: "cookie", name: "__Host-gimed-session" } },
    schemas: {
      Usuario: req(["id","nombre","email"], { id: uuid, nombre: string, email: { type: "string", format: "email" } }),
      Error: req(["error","requestId"], { requestId: uuid, error: req(["code","message"], { code: string, message: string,
        fields: { type: "object", additionalProperties: string }, details: row }) }),
      Operacion: req(["result", "changes"], { result: row, revision: { type: "integer" }, changes: { type: "object", additionalProperties: req(["upsert","remove"], {
        upsert: { type: "array", items: row }, remove: { type: "array", items: string },
      }) } }),
      NuevaOrden: req(["tipo_orden","id_proveedor","fecha_solicitada_entrega","lines"], {
        tipo_orden: { enum: ["producto","material","otro"] }, id_proveedor: uuid, fecha_solicitada_entrega: { type: "string", format: "date-time" },
        expected_no_orden: string, lines: { type: "array", minItems: 1, maxItems: 7, items: row },
      }),
      ListadoOrdenes: req(["items","total","cursor","page","pageCount","start","end"], { items: { type: "array", items: req(["id","no_orden","estado","total"], {
        id: uuid, no_orden: string, estado: string, total: string, tipo_orden: string, proveedor: string, conceptos: string,
      }) }, total: { type: "integer" }, cursor: { type: ["string", "null"] }, page: { type: "integer" }, pageCount: { type: "integer" },
        start: { type: "integer" }, end: { type: "integer" } }),
      Carga: req(["tipo_entidad","id_entidad","tipo_documento","nombre_archivo","tipo_mime","bytes"], {
        id: uuid, tipo_entidad: { enum: ["orden_compra","factura","lote_material",null] },
        id_entidad: { anyOf: [uuid, { type: "null" }] }, tipo_documento: string, nombre_archivo: string, tipo_mime: string,
        bytes: { type: "integer", minimum: 1, maximum: 26214400 },
      }),
      Reserva: req(["id","key","token","signedUrl","resumableUrl","bucket","storageWarning"], {
        id: uuid, key: string, token: string, signedUrl: string, resumableUrl: string, bucket: string, storageWarning: { type: "boolean" },
      }),
    },
  },
};
const target = new URL("../contracts/openapi.json", import.meta.url);
writeFileSync(target, JSON.stringify(contract, null, 2) + "\n");
