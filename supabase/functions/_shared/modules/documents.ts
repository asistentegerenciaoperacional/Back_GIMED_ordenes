import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Postgres } from "../postgres.ts";
import { BusinessError, check } from "../legacy/server/integrity.ts";
import { modify } from "../repository.ts";

const maxSize = 25 * 1024 ** 2;
const budget = 750_000_000;
const warningAt = 600_000_000;
const bucket = "gimed-documentos";
const pdf = "application/pdf";
const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const kinds = {
  orden_compra_escaneada: "orden_compra",
  factura_fisica: "factura",
  certificado_calidad: "lote_material",
  certificado_liberacion: "lote_material",
  plantilla_certificado_liberacion: null,
} as const;

const uploadSchema = z.strictObject({
  id: z.uuid().optional(),
  tipo_entidad: z.enum(["orden_compra", "factura", "lote_material"]).nullable(),
  id_entidad: z.uuid().nullable(),
  tipo_documento: z.enum(Object.keys(kinds) as [keyof typeof kinds, ...(keyof typeof kinds)[]]),
  nombre_archivo: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f/\\]+$/),
  tipo_mime: z.enum([pdf, "image/jpeg", "image/png", docx, xlsx]),
  bytes: z.number().int().min(1).max(maxSize),
});
type Upload = z.infer<typeof uploadSchema>;
type FileRecord = {
  id: string; actor: string; object_key: string; document_id: string; owner_type: Upload["tipo_entidad"];
  owner_id: string | null; document_type: Upload["tipo_documento"]; expected_key: string | null;
  filename: string; mime: string; expected_bytes: string; status: string;
};

function hasSignature(bytes: Uint8Array, mime: string) {
  const signature = mime === pdf ? [37, 80, 68, 70, 45] : mime === "image/jpeg" ? [255, 216, 255] :
    mime === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10] : [80, 75, 3, 4];
  return signature.every((value, index) => bytes[index] === value);
}

export function documentService(config: Pick<Config, "supabaseUrl" | "storageKey" | "storagePublicUrl">, db: Postgres) {
  const storage = createClient(config.supabaseUrl, config.storageKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  }).storage.from(bucket);
  const publicUrl = (path: string) => {
    const resolved = new URL(path, config.supabaseUrl);
    if (!config.storagePublicUrl) return resolved.href;
    return new URL(resolved.pathname + resolved.search, config.storagePublicUrl).href;
  };

  async function reserve(actor: string, input: unknown) {
    const p = uploadSchema.parse(input);
    const owner = kinds[p.tipo_documento];
    check(owner === p.tipo_entidad && Boolean(owner) === Boolean(p.id_entidad), "La clase no corresponde al propietario.", "R06");
    const allowed = owner ? [pdf, "image/jpeg", "image/png"] : [pdf, docx, xlsx];
    check(allowed.includes(p.tipo_mime), "El formato no es válido para este documento.", "VALIDATION");
    const id = crypto.randomUUID();
    const key = "gimed/" + id;
    const reserved = await db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(55193, 1)");
      if (owner) {
        const existing = await tx.query("select id from gimed." + owner + " where id=$1", [p.id_entidad]);
        check(existing.length, "El propietario ya no existe.", "NOT_FOUND");
      }
      const [document] = await tx.query<{ id: string; clave_almacenamiento: string }>(
        "select id,clave_almacenamiento from gimed.documento where tipo_documento=$1 and tipo_entidad is not distinct from $2::text" +
        " and id_entidad is not distinct from $3::uuid", [p.tipo_documento, owner, p.id_entidad]);
      check(document?.id === p.id, "El documento vigente cambió. Actualiza antes de reemplazarlo.", "DOCUMENT_CHANGED");
      const [{ total }] = await tx.query<{ total: string }>("select coalesce(sum(accounted_bytes),0)::text total from gimed.file_object");
      const used = Number(total) + maxSize;
      check(used <= budget, "Se alcanzó el límite de almacenamiento del piloto.", "STORAGE_LIMIT");
      await tx.query("insert into gimed.file_object (id,actor,object_key,document_id,owner_type,owner_id,document_type,expected_key,filename,mime,expected_bytes,accounted_bytes,status)" +
        " values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending')",
        [id, actor, key, p.id ?? crypto.randomUUID(), owner, p.id_entidad, p.tipo_documento, document?.clave_almacenamiento ?? null,
          p.nombre_archivo, p.tipo_mime, p.bytes, maxSize]);
      return { used };
    });

    const { data, error } = await storage.createSignedUploadUrl(key, { upsert: false });
    if (error || !data) {
      await db.query("delete from gimed.file_object where id=$1 and status='pending'", [id]);
      throw new BusinessError("No se pudo autorizar la carga. Reintenta.", "UPSTREAM");
    }
    const storageHost = new URL(config.storagePublicUrl ?? config.supabaseUrl);
    if (storageHost.hostname.endsWith(".supabase.co")) storageHost.hostname = storageHost.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
    return {
      id, key, token: data.token, signedUrl: publicUrl(data.signedUrl),
      resumableUrl: new URL("/storage/v1/upload/resumable/sign", storageHost).href, bucket,
      storageWarning: reserved.used >= warningAt,
    };
  }

  async function signed(key: string, download?: string) {
    const { data, error } = await storage.createSignedUrl(key, 60, download ? { download } : undefined);
    check(!error && data, "El archivo no está disponible.", "UPSTREAM");
    return new URL(data.signedUrl, config.supabaseUrl).href;
  }

  async function confirm(actor: string, id: string) {
    const [file] = await db.query<FileRecord>(
      "select * from gimed.file_object where id=$1 and actor=$2 and (status='active' or (status='pending' and created_at > now() - interval '24 hours'))",
      [id, actor]);
    check(file, "La carga no existe o caducó.", "NOT_FOUND");
    if (file.status === "pending") {
      const { data, error } = await storage.info(file.object_key);
      check(!error && data, "La carga todavía no está disponible.", "VALIDATION");
      check(Number(data.size) === Number(file.expected_bytes) && data.contentType === file.mime,
        "El tamaño o formato del archivo no coincide con la carga autorizada.", "VALIDATION");
      const url = await signed(file.object_key);
      const prefix = await fetch(url, { headers: { Range: "bytes=0-15" }, signal: AbortSignal.timeout(10000) });
      check(prefix.status === 206 || (prefix.ok && Number(file.expected_bytes) <= 16), "No se pudo comprobar el formato.", "UPSTREAM");
      check(hasSignature(new Uint8Array(await prefix.arrayBuffer()), file.mime), "El contenido del archivo no corresponde al formato indicado.", "VALIDATION");
      if (file.mime === docx || file.mime === xlsx) {
        const tail = await fetch(url, { headers: { Range: "bytes=" + Math.max(0, Number(file.expected_bytes) - 65557) + "-" }, signal: AbortSignal.timeout(10000) });
        check(tail.status === 206 || (tail.ok && Number(file.expected_bytes) <= 65557), "No se pudo comprobar la plantilla.", "UPSTREAM");
        const content = new TextDecoder().decode(await tail.arrayBuffer());
        check(content.includes("[Content_Types].xml") && content.includes(file.mime === docx ? "word/document.xml" : "xl/workbook.xml"),
          "La plantilla no contiene la estructura de Office esperada.", "VALIDATION");
      }
    }
    return modify(db, actor, "documento.confirmar", async (model, tx) => {
      const [current] = await tx.query<FileRecord>("select * from gimed.file_object where id=$1 for update", [id]);
      check(current && current.status !== "retired", "La carga ya no está disponible.", "DOCUMENT_CHANGED");
      if (current.status === "active") return { row: model.documento.find((doc) => doc.id === current.document_id) };
      const document = model.documento.find((doc) => doc.tipo_entidad === file.owner_type &&
        doc.id_entidad === file.owner_id && doc.tipo_documento === file.document_type);
      check((document?.clave_almacenamiento ?? null) === file.expected_key, "El documento cambió durante la carga.", "DOCUMENT_CHANGED");
      const row = {
        id: file.document_id, tipo_entidad: file.owner_type, id_entidad: file.owner_id,
        tipo_documento: file.document_type, clave_almacenamiento: file.object_key,
        nombre_archivo: file.filename, tipo_mime: file.mime, fecha_carga: new Date().toISOString(),
      };
      if (document) Object.assign(document, row);
      else model.documento.push(row);
      if (file.expected_key) await tx.query("update gimed.file_object set status='retired' where object_key=$1", [file.expected_key]);
      await tx.query("update gimed.file_object set status='active',accounted_bytes=expected_bytes where id=$1", [id]);
      return { row };
    });
  }

  async function remove(actor: string, id: string) {
    return modify(db, actor, "documento.eliminar", async (model, tx) => {
      const current = model.documento.find((doc) => doc.id === id);
      check(current, "El documento ya no existe.", "NOT_FOUND");
      await tx.query("update gimed.file_object set status='retired' where object_key=$1", [current.clave_almacenamiento]);
      model.documento = model.documento.filter((doc) => doc.id !== id);
      return {};
    });
  }

  async function content(id: string, download: boolean) {
    const [doc] = await db.query<{ clave_almacenamiento: string; nombre_archivo: string; tipo_mime: string }>(
      "select clave_almacenamiento,nombre_archivo,tipo_mime from gimed.documento where id=$1", [id]);
    check(doc, "El documento ya no existe.", "NOT_FOUND");
    const attachment = download || [docx, xlsx].includes(doc.tipo_mime);
    return publicUrl(await signed(doc.clave_almacenamiento, attachment ? doc.nombre_archivo : undefined));
  }

  async function clean() {
    const candidates = await db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock(55193, 1)");
      return tx.query<{ id: string; object_key: string }>(
        "update gimed.file_object set status='retired' where id in (select id from gimed.file_object f " +
        "where (status in ('retired','active') or (status='pending' and created_at < now()-interval '24 hours')) " +
        "and not exists (select 1 from gimed.documento d where d.clave_almacenamiento=f.object_key) limit 50) returning id,object_key");
    });
    let removed = 0;
    for (const file of candidates) {
      const { error } = await storage.remove([file.object_key]);
      if (error) continue;
      await db.query("delete from gimed.file_object where id=$1 and status='retired'", [file.id]);
      removed++;
    }
    return { inspected: candidates.length, removed };
  }
  return { reserve, confirm, remove, content, signed, clean };
}
