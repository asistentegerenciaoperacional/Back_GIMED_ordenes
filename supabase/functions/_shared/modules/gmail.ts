import { z } from "zod";
import { Buffer } from "node:buffer";
import type { Config } from "../config.ts";
import type { Postgres } from "../postgres.ts";
import { encryptedTokens, sha256 } from "../security.ts";
import type { Row } from "../legacy/shared/schema.ts";
import { command, mailPreview } from "../legacy/server/domain.ts";
import { BusinessError, check } from "../legacy/server/integrity.ts";
import { deliverMail, type MailMessage } from "../legacy/server/mail.ts";
import { readModel, modify, type Changes } from "../repository.ts";
import type { Actor } from "./auth.ts";
import type { documentService } from "./documents.ts";

const maxAttachments = 18 * 1024 ** 2;
const maxMime = 34_000_000;
const subjects: Record<MailMessage["event"], string> = {
  codigos_barras_nuevos: "Códigos de barras nuevos",
  envio_orden_compra: "Orden de compra",
  envio_certificado_calidad: "Certificado de calidad",
  envio_certificado_liberacion: "Certificado de liberación",
  cotizacion_materiales: "Cotización de materiales",
};
const address = z.email();
const line = (text: string) => text.replace(/[\r\n]/g, " ");
const headerText = (text: string) => {
  const groups: string[] = [];
  let next = "";
  for (const character of line(text)) {
    if (Buffer.byteLength(next + character) > 44) {
      groups.push(next);
      next = "";
    }
    next += character;
  }
  if (next) groups.push(next);
  return groups.map((part) => "=?UTF-8?B?" + Buffer.from(part).toString("base64") + "?=").join("\r\n ");
};
const base64Lines = (bytes: Buffer) => bytes.toString("base64").replace(/.{76}(?=.)/g, "$&\r\n");

export function buildMime(message: MailMessage, attachments: { doc: Row; bytes: Buffer }[], requestId: string) {
  const boundary = "GIMED_" + requestId;
  const lines = ["From: " + message.from];
  for (const [type, label] of [["para", "To"], ["cc", "Cc"], ["cco", "Bcc"]]) {
    const recipients = message.recipients.filter((recipient) => recipient.type === type).map((recipient) => recipient.address);
    if (recipients.length) lines.push(label + ": " + recipients.join(",\r\n "));
  }
  lines.push("Subject: " + headerText(message.subject || subjects[message.event]),
    "Message-ID: <" + requestId + "@gimed.com.co>", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="' + boundary + '"', "",
    "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    base64Lines(Buffer.from(message.body)), "");
  for (const { doc, bytes } of attachments) {
    const filename = encodeURIComponent(doc.nombre_archivo).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16));
    lines.push("--" + boundary, "Content-Type: " + doc.tipo_mime, "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment;\r\n filename*=UTF-8''" + filename, "", base64Lines(bytes), "");
  }
  lines.push("--" + boundary + "--", "");
  return lines.join("\r\n");
}

export function reviewFingerprint(preview: Row) {
  return sha256(JSON.stringify([preview.body, preview.recipients, preview.documents, preview.missing]));
}

export function gmailService(config: Config, db: Postgres, documents: ReturnType<typeof documentService>) {
  const secrets = encryptedTokens(config.tokenKey);
  async function accessToken(actor: Actor) {
    const [record] = await db.query<{ refresh_token: string }>("select refresh_token from gimed.gmail_connection where user_id=$1", [actor.id]);
    check(record, "Conecta tu Gmail corporativo antes de enviar.", "GMAIL_REQUIRED");
    const token = await secrets.decrypt(record.refresh_token, "gmail:" + actor.id);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: config.gmailClientId, client_secret: config.gmailClientSecret,
        refresh_token: token, grant_type: "refresh_token" }),
    });
    const data = await response.json() as { error?: string; access_token?: string };
    if (data.error === "invalid_grant") {
      await db.query("delete from gimed.gmail_connection where user_id=$1 and refresh_token=$2", [actor.id, record.refresh_token]);
      throw new BusinessError("El permiso de Gmail venció. Vuelve a conectar el buzón.", "GMAIL_REQUIRED");
    }
    check(response.ok && data.access_token, "Gmail no pudo renovar el permiso de envío.", "UPSTREAM");
    return data.access_token;
  }

  async function send(actor: Actor, name: "sendMail" | "sendMaterialQuotations", payload: Row, requestKey: string) {
    const model = await readModel(db);
    if (name === "sendMail") {
      const preview = mailPreview(model, payload);
      check(payload.expected_revision === reviewFingerprint(preview), "La vista previa cambió. Vuelve a revisarla.", "MAIL_CHANGED");
    }
    const messages: MailMessage[] = [];
    // Reuse the business validation for recipients, quotation revision and attachments.
    await command(model, name, payload, async (message) => {
      messages.push({ ...message, from: actor.email });
      return "validated-" + messages.length;
    });
    for (const message of messages) {
      check(message.body.length <= 100_000 && (message.subject?.length ?? 0) <= 300 &&
        message.recipients.length <= 100 && message.recipients.every((item) => address.safeParse(item.address).success),
        "Revisa el tamaño del mensaje y las direcciones de correo.", "VALIDATION");
      check(!config.testRecipients.length || message.recipients.every((item) => config.testRecipients.includes(item.address.toLowerCase())),
        "Por ahora el piloto solo envía a los destinatarios de comprobación.", "FORBIDDEN");
    }
    const result: Row[] = [];
    const changes: Changes = {};
    let token: string | undefined;
    for (const [index, message] of messages.entries()) {
      const fingerprint = sha256(JSON.stringify(message));
      const key = requestKey + ":" + index;
      const [prior] = await db.query<{ status: string; fingerprint: string; response: Row | null }>(
        "select status,fingerprint,response from gimed.mail_attempt where user_id=$1 and attempt_key=$2", [actor.id, key]);
      if (prior) {
        check(prior.fingerprint === fingerprint, "Ya se usó esta confirmación con otro mensaje.", "MAIL_CHANGED");
        result.push(prior.status === "sent" && prior.response
          ? { ...prior.response, status: "sent" }
          : { status: prior.status === "sending" ? "uncertain" : prior.status });
        continue;
      }
      const uncertain = await db.query("select 1 from gimed.mail_attempt where user_id=$1 and fingerprint=$2 and status in ('sending','uncertain') limit 1",
        [actor.id, fingerprint]);
      if (uncertain.length) {
        result.push({ status: "uncertain" });
        continue;
      }
      token ??= await accessToken(actor);
      const keys = message.documents.map((item) => item.clave_almacenamiento);
      const stored = keys.length ? await db.query<{ object_key: string; expected_bytes: string }>(
        "select object_key,expected_bytes from gimed.file_object where status='active' and object_key=any($1::text[])", [keys]) : [];
      check(stored.length === keys.length, "Cambió un adjunto. Revisa el correo antes de enviar.", "MAIL_CHANGED");
      check(stored.reduce((sum, row) => sum + Number(row.expected_bytes), 0) <= maxAttachments,
        "Los adjuntos superan 18 MiB por mensaje.", "SIZE");
      const attachments = [];
      for (const doc of message.documents) {
        const response = await fetch(await documents.signed(doc.clave_almacenamiento), { signal: AbortSignal.timeout(12000) });
        check(response.ok, "No se pudo leer un archivo adjunto.", "UPSTREAM");
        const bytes = Buffer.from(await response.arrayBuffer());
        check(bytes.length === Number(stored.find((file) => file.object_key === doc.clave_almacenamiento)!.expected_bytes),
          "El tamaño real del adjunto cambió.", "MAIL_CHANGED");
        attachments.push({ doc, bytes });
      }
      const mimeId = sha256(actor.id + ":" + key).slice(0, 42);
      const mime = buildMime(message, attachments, mimeId);
      check(Buffer.byteLength(mime) <= maxMime, "El tamaño del correo excede el límite de Gmail.", "SIZE");
      const inserted = await db.query("insert into gimed.mail_attempt (user_id,attempt_key,fingerprint,status) values ($1,$2,$3,'sending')" +
        " on conflict do nothing returning attempt_key", [actor.id, key, fingerprint]);
      if (!inserted.length) {
        result.push({ status: "uncertain" });
        continue;
      }
      let status = "uncertain";
      let id: string | undefined;
      try {
        const response = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
          method: "POST", headers: { authorization: "Bearer " + token, "content-type": "message/rfc822" },
          body: mime, signal: AbortSignal.timeout(20000),
        });
        if (response.ok) {
          const data = await response.json() as { id?: string };
          id = data.id;
        } else if (response.status < 500 && response.status !== 408) {
          status = "rejected";
          if (response.status === 401) {
            token = undefined;
          }
        }
      } catch {
        // Gmail pudo recibir la petición aunque la respuesta no llegara.
      }
      if (id) {
        const saved = await modify(db, actor.id, "correo.enviar", async (current, tx) => {
          const row = await deliverMail(current, async () => id!, message);
          await tx.query("update gimed.mail_attempt set status='sent',response=$3::text::jsonb,updated_at=now() where user_id=$1 and attempt_key=$2",
            [actor.id, key, JSON.stringify(row)]);
          return row;
        });
        for (const [table, change] of Object.entries(saved.changes)) {
          changes[table] ??= { upsert: [], remove: [] };
          changes[table].upsert.push(...change.upsert);
        }
        result.push({ ...saved.result, status: "sent" });
      } else {
        await db.query("update gimed.mail_attempt set status=$3,updated_at=now() where user_id=$1 and attempt_key=$2",
          [actor.id, key, status]);
        result.push({ status });
      }
    }
    return { result: name === "sendMail" ? { row: result[0] } : { messages: result }, changes };
  }
  return { send };
}
