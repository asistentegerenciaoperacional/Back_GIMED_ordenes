import { createClient, type Session } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "../config.ts";
import type { Postgres } from "../postgres.ts";
import { BusinessError, check } from "../legacy/server/integrity.ts";
import { encryptedTokens, pkce, randomToken, sha256 } from "../security.ts";

const workspace = "gimed.com.co";
const issuer = "https://accounts.google.com";
const jwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const sessionCookie = "__Host-gimed-session";
const stateCookie = (flow: Flow) => "__Host-gimed-" + flow;
type Flow = "login" | "gmail";
type Credentials = { access: string; refresh: string };
export type Actor = { id: string; nombre: string; email: string; google_subject: string; tokenHash: string };

function readCookie(request: Request, key: string) {
  return request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(key + "="))?.slice(key.length + 1);
}
function cookie(name: string, value: string, maxAge: number) {
  return name + "=" + value + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" + maxAge;
}
export function isWorkspaceIdentity(claims: { hd?: unknown; email?: unknown; email_verified?: unknown }) {
  return claims.hd === workspace && claims.email_verified === true &&
    typeof claims.email === "string" && /^[^@\s]+@gimed\.com\.co$/i.test(claims.email);
}

export function authService(config: Config, db: Postgres) {
  const secrets = encryptedTokens(config.tokenKey);
  const supabase = () => createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(7000) }) },
  });
  const redirectUri = (flow: Flow) => config.origin + (flow === "login" ? "/api/v1/auth/callback" : "/api/v1/correos/gmail/callback");
  const clients = {
    login: { id: config.googleClientId, secret: config.googleClientSecret },
    gmail: { id: config.gmailClientId, secret: config.gmailClientSecret },
  };
  const tokenExpiry = (session: Session) => new Date((session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in) * 1000).toISOString();
  const encode = (session: Session, hash: string) => secrets.encrypt(JSON.stringify({ access: session.access_token, refresh: session.refresh_token }), hash);

  async function actor(request: Request): Promise<Actor> {
    const token = readCookie(request, sessionCookie);
    check(token && /^[\w-]{43}$/.test(token), "Inicia sesión para continuar.", "AUTH_REQUIRED");
    const tokenHash = sha256(token);
    const user = await db.transaction(async (tx) => {
      const [entry] = await tx.query<{
        id: string; nombre: string; email: string; google_subject: string; tokens: string; fresh: boolean; touch: boolean;
      }>(
        "select u.id,u.nombre,i.email,i.google_subject,s.tokens, s.access_expires_at > now() + interval '45 seconds' fresh," +
        " s.last_seen < now() - interval '5 minutes' touch from gimed.session s join gimed.identity i on i.user_id=s.user_id" +
        " join gimed.usuario u on u.id=i.user_id where s.token_hash=$1 and s.expires_at > now() and" +
        " s.last_seen > now() - interval '7 days' and i.disabled_at is null for update of s", [tokenHash]);
      if (!entry) return null;
      if (!entry.fresh) {
        const tokens = JSON.parse(await secrets.decrypt(entry.tokens, tokenHash)) as Credentials;
        const { data, error } = await supabase().auth.refreshSession({ refresh_token: tokens.refresh });
        if (error || !data.session) {
          if (error?.status && [400, 401, 403].includes(error.status)) {
            await tx.query("delete from gimed.session where token_hash=$1", [tokenHash]);
            return null;
          }
          throw new BusinessError("No se pudo renovar la sesión. Reintenta en unos segundos.", "UPSTREAM");
        }
        check(data.session.user.id === entry.id, "Sesión inválida.", "AUTH_REQUIRED");
        await tx.query("update gimed.session set tokens=$2, access_expires_at=$3, last_seen=now() where token_hash=$1",
          [tokenHash, await encode(data.session, tokenHash), tokenExpiry(data.session)]);
      } else if (entry.touch) {
        await tx.query("update gimed.session set last_seen=now() where token_hash=$1", [tokenHash]);
      }
      return { id: entry.id, nombre: entry.nombre, email: entry.email, google_subject: entry.google_subject, tokenHash };
    });
    check(user, "Inicia sesión para continuar.", "AUTH_REQUIRED");
    return user;
  }

  async function start(flow: Flow, user?: Actor) {
    const state = randomToken(), verifier = randomToken(), nonce = randomToken();
    await db.query("insert into gimed.oauth_state (state_hash,flow,session_hash,verifier,nonce) values ($1,$2,$3,$4,$5)",
      [sha256(state), flow, user?.tokenHash ?? null, verifier, nonce]);
    const url = new URL(issuer + "/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clients[flow].id, redirect_uri: redirectUri(flow), response_type: "code",
      scope: flow === "login" ? "openid email profile" : "openid email https://www.googleapis.com/auth/gmail.send",
      state, nonce: sha256(nonce), code_challenge: pkce(verifier), code_challenge_method: "S256", hd: workspace,
      ...(flow === "gmail" ? { access_type: "offline", prompt: "consent", login_hint: user!.email } : {}),
    }).toString();
    return new Response(null, { status: 302, headers: { location: url.href, "set-cookie": cookie(stateCookie(flow), state, 600) } });
  }

  async function callback(request: Request, flow: Flow) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    check(code && state && state === readCookie(request, stateCookie(flow)), "La autorización de Google caducó. Vuelve a iniciarla.", "FORBIDDEN");
    const current = flow === "gmail" ? await actor(request) : undefined;
    const [pending] = await db.query<{ verifier: string; nonce: string }>(
      "delete from gimed.oauth_state where state_hash=$1 and flow=$2 and session_hash is not distinct from $3::text" +
      " and expires_at > now() returning verifier,nonce", [sha256(state), flow, current?.tokenHash ?? null]);
    check(pending, "La autorización se usó o caducó.", "FORBIDDEN");

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({
        client_id: clients[flow].id, client_secret: clients[flow].secret, redirect_uri: redirectUri(flow),
        grant_type: "authorization_code", code, code_verifier: pending.verifier,
      }),
    });
    check(response.ok, "Google no completó la autorización.", "FORBIDDEN");
    const data = await response.json() as { id_token?: string; access_token?: string; refresh_token?: string; scope?: string };
    check(data.id_token, "Google no devolvió la identidad.", "FORBIDDEN");
    const { payload } = await jwtVerify(data.id_token, jwks, { audience: clients[flow].id, issuer: [issuer, "accounts.google.com"], algorithms: ["RS256"] });
    check(payload.sub && payload.nonce === sha256(pending.nonce) &&
      isWorkspaceIdentity({ hd: payload.hd, email: payload.email, email_verified: payload.email_verified }),
      "Usa una cuenta corporativa verificada de GIMED.", "FORBIDDEN");
    const email = (payload.email as string).toLowerCase();
    const headers = new Headers({ location: config.origin + (flow === "gmail" ? "/correos" : "/") });
    headers.append("set-cookie", cookie(stateCookie(flow), "", 0));
    if (current) {
      check(current.google_subject === payload.sub && current.email === email, "Conecta el mismo buzón corporativo de tu sesión.", "FORBIDDEN");
      check(data.refresh_token && data.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.send"),
        "Falta el permiso de envío. Conecta nuevamente el buzón.", "FORBIDDEN");
      await db.query("insert into gimed.gmail_connection (user_id,refresh_token) values ($1,$2)" +
        " on conflict (user_id) do update set refresh_token=excluded.refresh_token",
        [current.id, await secrets.encrypt(data.refresh_token, "gmail:" + current.id)]);
    } else {
      const { data: signed, error } = await supabase().auth.signInWithIdToken({
        provider: "google", token: data.id_token, nonce: pending.nonce, access_token: data.access_token,
      });
      check(!error && signed.session, "Supabase no estableció la sesión.", "UPSTREAM");
      const session = signed.session;
      const sessionToken = randomToken(), hash = sha256(sessionToken);
      const nombre = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 180) : email;
      await db.transaction(async (tx) => {
        const [identity] = await tx.query<{ disabled_at: string | null; google_subject: string }>(
          "select disabled_at,google_subject from gimed.identity where user_id=$1 for update", [session.user.id]);
        check(!identity || (!identity.disabled_at && identity.google_subject === payload.sub), "La cuenta está deshabilitada.", "FORBIDDEN");
        await tx.query("insert into gimed.usuario (id,nombre) values ($1,$2) on conflict (id) do update set nombre=excluded.nombre", [session.user.id, nombre]);
        const validIdentity = await tx.query("insert into gimed.identity (user_id,google_subject,email) values ($1,$2,$3)" +
          " on conflict (user_id) do update set email=excluded.email where gimed.identity.disabled_at is null" +
          " and gimed.identity.google_subject=excluded.google_subject returning user_id", [session.user.id, payload.sub, email]);
        check(validIdentity.length, "La cuenta está deshabilitada.", "FORBIDDEN");
        await tx.query("insert into gimed.session (token_hash,user_id,tokens,access_expires_at) values ($1,$2,$3,$4)",
          [hash, session.user.id, await encode(session, hash), tokenExpiry(session)]);
        await tx.query("insert into gimed.audit_event (actor,accion) values ($1,'auth.login')", [session.user.id]);
      });
      headers.append("set-cookie", cookie(sessionCookie, sessionToken, 30 * 86400));
    }
    return new Response(null, { status: 303, headers });
  }

  async function logout(request: Request) {
    const token = readCookie(request, sessionCookie);
    if (token) {
      const hash = sha256(token);
      const [entry] = await db.query<{ tokens: string }>("delete from gimed.session where token_hash=$1 returning tokens", [hash]);
      if (entry) {
        try {
          const tokens = JSON.parse(await secrets.decrypt(entry.tokens, hash)) as Credentials;
          await supabase().auth.admin.signOut(tokens.access, "local");
        } catch {
          // La cookie opaca queda revocada aunque Supabase Auth esté indisponible.
        }
      }
    }
    return new Response(null, { status: 204, headers: { "set-cookie": cookie(sessionCookie, "", 0) } });
  }
  return { actor, start, callback, logout, secrets };
}
