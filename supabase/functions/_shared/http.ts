import { Hono } from "hono";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { Postgres } from "./postgres.ts";
import { equalSecret } from "./security.ts";
import { BusinessError, check } from "./legacy/server/integrity.ts";
import { mailPreview } from "./legacy/server/domain.ts";
import { materialQuotationPreview } from "./legacy/server/material-quotation.ts";
import { addLineComment, lineComments } from "./legacy/server/comments.ts";
import { modify, readModel, workspace } from "./repository.ts";
import { authService, type Actor } from "./modules/auth.ts";
import { documentService } from "./modules/documents.ts";
import { gmailService, reviewFingerprint } from "./modules/gmail.ts";
import { operations, applyOperation } from "./modules/operations.ts";
import { orderDetail, orderList } from "./modules/orders.ts";

const uuid = z.uuid();
const bodySchema = z.record(z.string(), z.unknown());
const maxBody = 1024 * 1024;
async function json(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  check(length <= maxBody, "La solicitud supera 1 MiB.", "SIZE");
  const reader = request.body?.getReader();
  if (!reader) throw new BusinessError("Envía un cuerpo JSON válido.", "BAD_JSON");
  const decoder = new TextDecoder();
  let size = 0, text = "";
  while (true) {
    const received = await reader.read();
    if (received.done) break;
    size += received.value.byteLength;
    if (size > maxBody) {
      await reader.cancel();
      throw new BusinessError("La solicitud supera 1 MiB.", "SIZE");
    }
    text += decoder.decode(received.value, { stream: true });
  }
  text += decoder.decode();
  try { return bodySchema.parse(JSON.parse(text)); }
  catch { throw new BusinessError("Envía un objeto JSON válido.", "BAD_JSON"); }
}
const sessionView = ({ id, nombre, email }: Actor) => ({ id, nombre, email });
const requestKey = (request: Request) => uuid.parse(request.headers.get("idempotency-key"));
const isConflict = (code: string) => code.endsWith("_CHANGED") || ["COMMENT_REMOVAL", "COST_PERIOD_CONFLICT", "CONSECUTIVE_REQUIRED"].includes(code);

export function createApp(config: Config, db: Postgres) {
  const auth = authService(config, db);
  const documents = documentService(config, db);
  const gmail = gmailService(config, db, documents);
  const api = new Hono<{ Variables: { requestId: string; actor: Actor } }>();
  api.use("*", async (c, next) => {
    const started = performance.now();
    const id = crypto.randomUUID();
    c.set("requestId", id);
    c.header("Cache-Control", "private, no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Request-Id", id);
    check(equalSecret(c.req.header("x-gimed-proxy") ?? null, config.proxySecret), "Origen de API no autorizado.", "FORBIDDEN");
    if (!["GET", "HEAD"].includes(c.req.method)) {
      check(c.req.header("origin") === config.origin && c.req.header("x-gimed-csrf") === "1",
        "Origen de la solicitud no autorizado.", "FORBIDDEN");
    }
    await next();
    c.header("Server-Timing", "api;dur=" + (performance.now() - started).toFixed(1));
  });

  api.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof BusinessError) {
      const status = error.code === "AUTH_REQUIRED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 :
        error.code === "SIZE" ? 413 : error.code === "BAD_JSON" ? 400 :
        isConflict(error.code) ? 409 : error.code === "UPSTREAM" ? 503 : 422;
      return c.json({ error: { code: error.code, message: error.message, fields: error.fields, details: error.details }, requestId }, status);
    }
    if (error instanceof z.ZodError)
      return c.json({ error: { code: "VALIDATION", message: "Revisa los campos de la solicitud.",
        fields: Object.fromEntries(error.issues.map((issue) => [issue.path.join("."), issue.message])) }, requestId }, 422);
    const pgCode = "code" in error ? error.code : undefined;
    if (pgCode === "23505" || pgCode === "23503" || pgCode === "40001")
      return c.json({ error: { code: "DATA_CHANGED", message: "Los datos cambiaron. Actualiza antes de reintentar." }, requestId }, 409);
    console.error(JSON.stringify({ requestId, category: error.name, code: pgCode }));
    return c.json({ error: { code: "SERVER", message: "No se pudo completar la operación." }, requestId }, 500);
  });
  api.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "La ruta no existe." }, requestId: c.get("requestId") }, 404));

  api.get("/health", async (c) => {
    await db.query("select 1");
    return c.json({ ok: true });
  });
  api.get("/auth/inicio", () => auth.start("login"));
  api.get("/auth/callback", async (c) => {
    try { return await auth.callback(c.req.raw, "login"); }
    catch (error) {
      console.error(JSON.stringify({ requestId: c.get("requestId"), category: "oauth.login", code: error instanceof BusinessError ? error.code : "CALLBACK" }));
      return c.redirect(config.origin + "/?acceso=error", 303);
    }
  });
  api.post("/auth/logout", (c) => auth.logout(c.req.raw));

  const protectedRoutes = new Hono<{ Variables: { requestId: string; actor: Actor } }>();
  protectedRoutes.use("*", async (c, next) => {
    c.set("actor", await auth.actor(c.req.raw));
    await next();
  });
  protectedRoutes.get("/auth/session", (c) => c.json({ usuario: sessionView(c.get("actor")) }));
  protectedRoutes.get("/contexto", async (c) => c.json(await workspace(db)));
  protectedRoutes.get("/ordenes", async (c) => c.json(await orderList(db, new URL(c.req.url).searchParams)));
  protectedRoutes.get("/ordenes/:id", async (c) => c.json(await orderDetail(db, uuid.parse(c.req.param("id")))));
  for (const [path, name] of Object.entries(operations)) {
    protectedRoutes.post("/" + path, async (c) => {
      const result = await applyOperation(db, c.get("actor").id, name, await json(c.req.raw), requestKey(c.req.raw));
      return c.json(result, name === "createOrder" || name === "createInvoice" ? 201 : 200);
    });
  }
  protectedRoutes.get("/comentarios/:tipo/:id", async (c) =>
    c.json(lineComments(await readModel(db, ["orden_producto", "orden_material", "usuario", "comentario"]), c.req.param())));
  protectedRoutes.post("/comentarios", async (c) => {
    const body = await json(c.req.raw);
    const entry = await modify(db, c.get("actor").id, "comentario.publicar", (model) => addLineComment(model, body, c.get("actor")));
    return c.json(entry.result, 201);
  });

  protectedRoutes.post("/documentos/cargas", async (c) => c.json(await documents.reserve(c.get("actor").id, await json(c.req.raw)), 201));
  protectedRoutes.post("/documentos/cargas/:id/confirmar", async (c) =>
    c.json(await documents.confirm(c.get("actor").id, uuid.parse(c.req.param("id")))));
  protectedRoutes.post("/documentos/:id/eliminar", async (c) =>
    c.json(await documents.remove(c.get("actor").id, uuid.parse(c.req.param("id")))));
  protectedRoutes.get("/documentos/:id/contenido", async (c) =>
    c.redirect(await documents.content(uuid.parse(c.req.param("id")), c.req.query("download") === "1"), 302));

  protectedRoutes.get("/correos/gmail/inicio", (c) => auth.start("gmail", c.get("actor")));
  protectedRoutes.get("/correos/gmail/callback", async (c) => {
    try { return await auth.callback(c.req.raw, "gmail"); }
    catch (error) {
      console.error(JSON.stringify({ requestId: c.get("requestId"), category: "oauth.gmail", code: error instanceof BusinessError ? error.code : "CALLBACK" }));
      return c.redirect(config.origin + "/correos?gmail=error", 303);
    }
  });
  protectedRoutes.get("/correos/gmail", async (c) => c.json({
    conectado: !!(await db.query("select 1 from gimed.gmail_connection where user_id=$1", [c.get("actor").id])).length,
  }));
  protectedRoutes.post("/correos/previsualizaciones", async (c) => {
    const preview = mailPreview(await readModel(db), await json(c.req.raw));
    return c.json({ ...preview, remitente: c.get("actor").email, revision: reviewFingerprint(preview) });
  });
  protectedRoutes.post("/correos/cotizaciones/previsualizaciones", async (c) =>
    c.json(materialQuotationPreview(await readModel(db), await json(c.req.raw))));
  protectedRoutes.post("/correos/envios", async (c) =>
    c.json(await gmail.send(c.get("actor"), "sendMail", await json(c.req.raw), requestKey(c.req.raw))));
  protectedRoutes.post("/correos/cotizaciones/envios", async (c) =>
    c.json(await gmail.send(c.get("actor"), "sendMaterialQuotations", await json(c.req.raw), requestKey(c.req.raw))));
  api.route("/", protectedRoutes);
  // Supabase incluye el nombre de la función en la URL. El adaptador local usa /api/v1.
  return new Hono().route("/api/v1", api).route("/functions/v1/api/v1", api);
}
