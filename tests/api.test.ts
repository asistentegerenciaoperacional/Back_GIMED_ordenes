import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../supabase/functions/_shared/http.ts";
import { connect, type Postgres, type Executor } from "../supabase/functions/_shared/postgres.ts";
import { isWorkspaceIdentity } from "../supabase/functions/_shared/modules/auth.ts";
import { buildMime } from "../supabase/functions/_shared/modules/gmail.ts";
import { sha256 } from "../supabase/functions/_shared/security.ts";

const config = {
  origin: "https://ordenes.invalid", proxySecret: "test-only-proxy-secret-000000000000", tokenKey: "2a".repeat(32),
  supabaseUrl: "https://supabase.invalid", publishableKey: "test-only-publishable", storageKey: "test-only-storage",
  googleClientId: "test-login-client", googleClientSecret: "test-login-secret", gmailClientId: "test-gmail-client",
  gmailClientSecret: "test-gmail-secret", testRecipients: [],
  databaseUrl: "postgres://local.test/postgres",
};

test("la identidad exige dominio Workspace, correo exacto y verificación", () => {
  const valid = { hd: "gimed.com.co", email: "usuario@gimed.com.co", email_verified: true };
  assert.equal(isWorkspaceIdentity(valid), true);
  assert.equal(isWorkspaceIdentity({ ...valid, email: "usuario@gimed.com.co.example" }), false);
  assert.equal(isWorkspaceIdentity({ ...valid, hd: "gmail.com" }), false);
  assert.equal(isWorkspaceIdentity({ ...valid, email_verified: false }), false);
});

test("el MIME conserva destinatarios, texto internacional y adjuntos del archivo vigente", () => {
  const mime = buildMime({
    from: "usuario@gimed.com.co", recipients: [{ address: "tests@example.com", type: "para" }],
    body: "Recepción", subject: "Certificación", event: "envio_orden_compra", documents: [],
  }, [{ doc: { nombre_archivo: "orden 1.pdf", tipo_mime: "application/pdf" }, bytes: Buffer.from("%PDF-") }], "test-message");
  assert.match(mime, /To: tests@example.com\r\n/);
  assert.ok(mime.includes(Buffer.from("Recepción").toString("base64")));
  assert.ok(mime.includes("orden%201.pdf"));
  assert.ok(mime.includes(Buffer.from("%PDF-").toString("base64")));
});

test("migración, controles HTTP, consecutivo compartido y persistencia", async (t) => {
  const liveUrl = process.env.GIMED_TEST_ADMIN_URL;
  let db: Postgres;
  if (liveUrl) {
    assert.equal(new URL(liveUrl).hostname, "127.0.0.1", "Las pruebas de escritura requieren Postgres local.");
    db = connect(liveUrl);
  } else {
    const pg = new PGlite();
    await pg.exec("create role anon; create role authenticated; create schema storage; " +
      "create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[])");
    await pg.exec(await readFile(new URL("../supabase/migrations/20261117142609_gimed_inicial.sql", import.meta.url), "utf8"));
    function executor(client: Pick<PGlite, "query">): Executor {
      return {
        query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => (await client.query<T>(sql, params)).rows,
      };
    }
    db = { ...executor(pg), transaction: (run) => pg.transaction((tx) => run(executor(tx))), close: () => pg.close() };
  }
  t.after(() => db.close());
  const actor = crypto.randomUUID(), supplier = crypto.randomUUID(), token = "A".repeat(42) + "B";
  const hash = sha256(token);
  if (liveUrl) {
    const existing = await db.query("select id from gimed.orden_compra limit 1");
    assert.equal(existing.length, 0, "Usa una base local descartable para esta prueba.");
  }
  await db.query("insert into gimed.usuario (id,nombre) values ($1,'Cuenta de prueba')", [actor]);
  await db.query("insert into gimed.identity (user_id,google_subject,email) values ($1,$2,'usuario@gimed.com.co')", [actor, actor]);
  await db.query("insert into gimed.session (token_hash,user_id,tokens,access_expires_at) values ($1,$2,'fixture',now() + interval '1 hour')", [hash, actor]);
  await db.query('insert into gimed.proveedor (id,nombre_largo,"Es_maquila","Es_materiales",activo) values ($1,\'Proveedor sintético\',false,false,true)', [supplier]);
  await db.query("insert into gimed.consecutivo_orden values ('producto',200),('material',1200)");
  const storageUrl = process.env.GIMED_TEST_STORAGE_URL;
  const storageKey = process.env.GIMED_TEST_STORAGE_KEY;
  if (storageUrl) assert.equal(new URL(storageUrl).hostname, "127.0.0.1");
  const app = createApp(storageUrl && storageKey ? { ...config, supabaseUrl: storageUrl, storageKey } : config, db);
  const headers = { "x-gimed-proxy": config.proxySecret, cookie: "__Host-gimed-session=" + token };
  assert.equal((await app.request("/api/v1/health")).status, 403);
  assert.equal((await app.request("/functions/v1/api/v1/health", { headers })).status, 200);
  assert.equal((await app.request("/api/v1/contexto", { headers: { "x-gimed-proxy": config.proxySecret } })).status, 401);
  assert.equal((await (await app.request("/api/v1/auth/session", { headers })).json()).usuario.id, actor);
  const invalid = await app.request("/api/v1/ordenes", { method: "POST", headers, body: "{}" });
  assert.equal(invalid.status, 403);
  const payload = JSON.stringify({
    tipo_orden: "otro", id_proveedor: supplier, expected_no_orden: "1201",
    fecha_solicitada_entrega: new Date(Date.now() + 86400000 * 3).toISOString(),
    lines: [{ producto: "Servicio de prueba", cantidad_solicitada: 1, precio_unitario: "12.00" }],
  });
  const send = (key: string) => app.request("/api/v1/ordenes", {
    method: "POST", headers: { ...headers, "content-type": "application/json", "idempotency-key": key,
      "x-gimed-csrf": "1", origin: config.origin }, body: payload,
  });
  const key = crypto.randomUUID();
  const results = await Promise.all([send(key), send(crypto.randomUUID())]);
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  const first = await results.find((response) => response.status === 201)!.json();
  assert.equal(first.result.numero, "1201");
  assert.ok(first.changes.orden_otro.upsert.length);
  const firstWon = results[0].status === 201;
  if (firstWon) assert.equal((await (await send(key)).json()).result.id, first.result.id);
  const list = await (await app.request("/api/v1/ordenes?grupo=materiales&q=servicio", { headers })).json();
  assert.equal(list.items[0].id, first.result.id);
  assert.equal(list.items[0].total, "12.00");
  const detail = await (await app.request("/api/v1/ordenes/" + first.result.id, { headers })).json();
  assert.equal(detail.version, 1);
  assert.equal(detail.renglones[0].posicion, 1);
  if (storageUrl && storageKey) {
    const writeHeaders = { ...headers, origin: config.origin, "x-gimed-csrf": "1", "content-type": "application/json" };
    const examplePdf = "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF";
    const reserve = async (id?: string, resumable = false) => {
      const chunkSize = 6 * 1024 ** 2;
      const file = resumable ? Buffer.concat([Buffer.from(examplePdf), Buffer.alloc(chunkSize)]) : Buffer.from(examplePdf);
      const response = await app.request("/api/v1/documentos/cargas", { method: "POST", headers: writeHeaders, body: JSON.stringify({
        id, tipo_entidad: "orden_compra", id_entidad: first.result.id, tipo_documento: "orden_compra_escaneada",
        nombre_archivo: "ejemplo.pdf", tipo_mime: "application/pdf", bytes: file.length,
      }) });
      assert.equal(response.status, 201, await response.clone().text());
      const upload = await response.json();
      if (resumable) {
        const headers = { "tus-resumable": "1.0.0", "x-signature": upload.token };
        const metadata = { bucketName: upload.bucket, objectName: upload.key, contentType: "application/pdf" };
        const initiated = await fetch(upload.resumableUrl, { method: "POST", headers: {
          ...headers, "upload-length": String(file.length),
          "upload-metadata": Object.entries(metadata).map(([name, value]) => name + " " + Buffer.from(value).toString("base64")).join(","),
        } });
        assert.equal(initiated.status, 201, await initiated.text());
        const target = new URL(initiated.headers.get("location")!, upload.resumableUrl);
        const patch = async (offset: number, bytes: Uint8Array<ArrayBuffer>) => {
          const updated = await fetch(target, { method: "PATCH", headers: {
            ...headers, "upload-offset": String(offset), "content-type": "application/offset+octet-stream",
          }, body: bytes });
          assert.equal(updated.status, 204, await updated.text());
        };
        await patch(0, new Uint8Array(file.subarray(0, chunkSize)));
        const resumed = await fetch(target, { method: "HEAD", headers });
        assert.equal(Number(resumed.headers.get("upload-offset")), chunkSize);
        await patch(chunkSize, new Uint8Array(file.subarray(chunkSize)));
      } else {
        const uploaded = await fetch(upload.signedUrl, { method: "PUT", headers: { "content-type": "application/pdf" }, body: examplePdf });
        assert.ok(uploaded.ok, await uploaded.text());
      }
      return upload.id;
    };
    const confirm = (id: string) => app.request("/api/v1/documentos/cargas/" + id + "/confirmar", { method: "POST", headers: writeHeaders });
    const pending = await reserve();
    const confirmed = await confirm(pending);
    assert.equal(confirmed.status, 200, await confirmed.clone().text());
    const document = (await confirmed.json()).result.row;
    const download = await app.request("/api/v1/documentos/" + document.id + "/contenido", { headers });
    assert.equal(download.status, 302);
    assert.equal(await (await fetch(download.headers.get("location")!)).text(), examplePdf);
    const replacements = await Promise.all([reserve(document.id, true), reserve(document.id)]);
    const replaced = await Promise.all(replacements.map(confirm));
    assert.deepEqual(replaced.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await replaced.find((response) => response.status === 200)!.json()).result.row.id, document.id);
  }
  await db.query("update gimed.identity set disabled_at=now() where user_id=$1", [actor]);
  assert.equal((await app.request("/api/v1/auth/session", { headers })).status, 401);
});
