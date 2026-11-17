import { z } from "zod";

const credentials = z.object({
  databaseUrl: z.string().url(),
  origin: z.string().url().transform((url) => new URL(url).origin),
  proxySecret: z.string().min(32),
  tokenKey: z.string().regex(/^[\da-f]{64}$/i),
  supabaseUrl: z.string().url(),
  storagePublicUrl: z.string().url().optional(),
  publishableKey: z.string().min(1),
  storageKey: z.string().min(1),
  googleClientId: z.string().min(1),
  googleClientSecret: z.string().min(1),
  gmailClientId: z.string().min(1),
  gmailClientSecret: z.string().min(1),
  testRecipients: z.array(z.string().email()),
});
export type Config = z.infer<typeof credentials>;

export function configFrom(read: (key: string) => string | undefined): Config {
  const result = credentials.safeParse({
    databaseUrl: read("GIMED_DB_URL"),
    origin: read("GIMED_APP_ORIGIN"),
    proxySecret: read("GIMED_PROXY_SECRET"),
    tokenKey: read("GIMED_TOKEN_KEY"),
    supabaseUrl: read("GIMED_SUPABASE_URL") ?? read("SUPABASE_URL"),
    storagePublicUrl: read("GIMED_STORAGE_PUBLIC_URL") || undefined,
    publishableKey: read("GIMED_SUPABASE_PUBLISHABLE_KEY") ?? read("SUPABASE_ANON_KEY"),
    storageKey: read("GIMED_SUPABASE_STORAGE_KEY") ?? read("SUPABASE_SERVICE_ROLE_KEY"),
    googleClientId: read("GIMED_GOOGLE_CLIENT_ID"),
    googleClientSecret: read("GIMED_GOOGLE_CLIENT_SECRET"),
    gmailClientId: read("GIMED_GMAIL_CLIENT_ID"),
    gmailClientSecret: read("GIMED_GMAIL_CLIENT_SECRET"),
    testRecipients: (read("GIMED_GMAIL_TEST_RECIPIENTS") ?? "").split(",").map((address) => address.trim().toLowerCase()).filter(Boolean),
  });
  if (!result.success) throw new Error("Configuración inválida: " + result.error.issues.map((issue) => issue.path.join(".")).join(", "));
  return result.data;
}
