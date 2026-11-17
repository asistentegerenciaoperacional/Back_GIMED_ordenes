import { connect } from "../supabase/functions/_shared/postgres.ts";
import { documentService } from "../supabase/functions/_shared/modules/documents.ts";

const { GIMED_DB_URL, GIMED_SUPABASE_URL, GIMED_SUPABASE_STORAGE_KEY } = process.env;
if (!GIMED_DB_URL || !GIMED_SUPABASE_URL || !GIMED_SUPABASE_STORAGE_KEY) {
  throw new Error("Configura GIMED_DB_URL, GIMED_SUPABASE_URL y GIMED_SUPABASE_STORAGE_KEY");
}
const db = connect(GIMED_DB_URL);
try {
  console.log(await documentService({ supabaseUrl: GIMED_SUPABASE_URL, storageKey: GIMED_SUPABASE_STORAGE_KEY }, db).clean());
  await db.transaction(async (tx) => {
    await tx.query("delete from gimed.oauth_state where expires_at < now()");
    await tx.query("delete from gimed.session where expires_at < now() or last_seen < now()-interval '7 days'");
    await tx.query("delete from gimed.idempotency where created_at < now()-interval '30 days'");
  });
} finally { await db.close(); }
