import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { connect } from "../supabase/functions/_shared/postgres.ts";

const { GIMED_BACKUP_DIR, GIMED_BACKUP_KEY, GIMED_ADMIN_DB_URL, GIMED_SUPABASE_URL, GIMED_SUPABASE_STORAGE_KEY } = process.env;
if (!GIMED_BACKUP_DIR || !isAbsolute(GIMED_BACKUP_DIR) || !GIMED_BACKUP_KEY || !/^[0-9a-f]{64}$/i.test(GIMED_BACKUP_KEY) ||
    !GIMED_ADMIN_DB_URL || !GIMED_SUPABASE_URL || !GIMED_SUPABASE_STORAGE_KEY) {
  throw new Error("Configura el destino absoluto, clave de respaldo y conexiones corporativas.");
}
const key = Buffer.from(GIMED_BACKUP_KEY, "hex");
const db = connect(GIMED_ADMIN_DB_URL);
const source = new URL(GIMED_ADMIN_DB_URL);
const storage = createClient(GIMED_SUPABASE_URL, GIMED_SUPABASE_STORAGE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) },
}).storage.from("gimed-documentos");
const name = "gimed-" + new Date().toISOString().replaceAll(/[:.]/g, "-") + "-" + randomBytes(4).toString("hex");
const partial = join(GIMED_BACKUP_DIR, name + ".partial");
await mkdir(partial, { mode: 0o700 });

async function encrypt(filename: string, input: AsyncIterable<Buffer | Uint8Array>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(filename));
  const hash = createHash("sha256");
  const output = await open(join(partial, filename + ".gcm"), "wx", 0o600);
  let size = 0;
  try {
    await output.writeFile(iv);
    for await (const chunk of input) {
      hash.update(chunk);
      size += chunk.length;
      await output.writeFile(cipher.update(chunk));
    }
    await output.writeFile(cipher.final());
    await output.writeFile(cipher.getAuthTag());
    await output.sync();
    return { size, sha256: hash.digest("hex") };
  } finally { await output.close(); }
}

try {
  await db.transaction(async (tx) => {
    // La ventana de copia mantiene fijas las referencias y la limpieza de archivos.
    await tx.query("select pg_advisory_xact_lock(55193, 1)");
    const [{ snapshot }] = await tx.query<{ snapshot: string }>("select pg_export_snapshot() snapshot");
    const dump = spawn("pg_dump", ["--format=custom", "--data-only", "--schema=gimed", "--no-owner", "--no-privileges", "--snapshot=" + snapshot], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PGHOST: source.hostname, PGPORT: source.port || "5432",
        PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password),
        PGDATABASE: source.pathname.slice(1), PGSSLMODE: ["127.0.0.1", "localhost"].includes(source.hostname) ? "disable" : "verify-full" },
    });
    const exited = new Promise<void>((resolve, reject) => {
      dump.once("error", reject);
      dump.once("close", (code) => code === 0 ? resolve() : reject(new Error("pg_dump falló con código " + code)));
    });
    const [database] = await Promise.all([encrypt("base.dump", dump.stdout), exited]);
    const rows = await tx.query<{ clave_almacenamiento: string; tipo_mime: string; expected_bytes: string }>(
      "select d.clave_almacenamiento,d.tipo_mime,f.expected_bytes from gimed.documento d" +
      " join gimed.file_object f on f.object_key=d.clave_almacenamiento and f.status='active' order by d.id");
    const [{ count }] = await tx.query<{ count: string }>("select count(*)::text count from gimed.documento");
    if (Number(count) !== rows.length) throw new Error("El manifiesto tiene referencias sin objeto activo.");
    const objects = [];
    for (const item of rows) {
      const signed = await storage.createSignedUrl(item.clave_almacenamiento, 60);
      if (!signed.data) throw new Error("No se pudo autorizar un objeto del respaldo.");
      const response = await fetch(signed.data.signedUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok || !response.body) throw new Error("No se pudo recuperar un objeto del respaldo.");
      const filename = item.clave_almacenamiento.replace(/^gimed\//, "");
      if (!/^[a-f\d-]{36}$/.test(filename)) throw new Error("Clave inválida en el manifiesto.");
      const info = await encrypt(filename, Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]));
      if (info.size !== Number(item.expected_bytes)) throw new Error("El tamaño de un objeto no coincide.");
      objects.push({ ...item, filename, ...info });
    }
    await encrypt("manifest.json", Readable.from([Buffer.from(JSON.stringify({ database, objects }))]));
  });
  await rename(partial, join(GIMED_BACKUP_DIR, name));
  console.log("Respaldo cifrado completo " + name);
} finally { await db.close(); }
