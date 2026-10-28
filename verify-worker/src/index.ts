// TGuard-compatible verification API backed by Cloudflare Turnstile.
// BetterForward's "tguard" captcha calls:
//   POST /api/verification/create  (X-API-Key)  {user_id} -> {token, verification_url}
//   GET  /api/v1/verification-status/:token               -> {completed} | 404
// The user opens /v/:token as a Telegram Mini App and solves Turnstile there.
import { DurableObject, env } from "cloudflare:workers";

const TTL_MS = 600_000;
const TOKEN_RE = /^[0-9a-f]{64}$/;

export class TokenStore extends DurableObject {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL)",
		);
	}

	add(token: string, userId: number): void {
		const now = Date.now();
		this.ctx.storage.sql.exec("DELETE FROM tokens WHERE expires < ?", now);
		this.ctx.storage.sql.exec("INSERT INTO tokens (token, user_id, expires) VALUES (?, ?, ?)", token, userId, now + TTL_MS);
	}

	/** null when unknown or expired. */
	completed(token: string): boolean | null {
		const row = this.ctx.storage.sql
			.exec<{ completed: number }>("SELECT completed FROM tokens WHERE token = ? AND expires >= ?", token, Date.now())
			.toArray()[0];
		return row ? row.completed === 1 : null;
	}

	complete(token: string): boolean {
		return this.ctx.storage.sql.exec("UPDATE tokens SET completed = 1 WHERE token = ? AND expires >= ?", token, Date.now()).rowsWritten > 0;
	}
}

// Generated types cannot see the class through the self-binding.
const store = () => env.TOKENS.getByName("store") as unknown as DurableObjectStub<TokenStore>;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", "cache-control": "no-store" },
	});

async function sameSecret(a: string, b: string): Promise<boolean> {
	const enc = new TextEncoder();
	const [x, y] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(a)),
		crypto.subtle.digest("SHA-256", enc.encode(b)),
	]);
	return crypto.subtle.timingSafeEqual(x, y);
}

function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function create(request: Request, origin: string): Promise<Response> {
	if (!(await sameSecret(request.headers.get("X-API-Key") ?? "", env.API_KEY))) {
		return json({ error: "unauthorized" }, 401);
	}
	const body = (await request.json().catch(() => null)) as { user_id?: unknown } | null;
	const userId = Number(body?.user_id);
	if (!Number.isSafeInteger(userId) || userId <= 0) return json({ error: "invalid user_id" }, 400);

	const token = newToken();
	await store().add(token, userId);
	return json({ token, verification_url: `${origin}/v/${token}` });
}

async function status(token: string): Promise<Response> {
	const completed = await store().completed(token);
	return completed === null ? json({ error: "not found" }, 404) : json({ completed });
}

async function solve(request: Request, token: string, hostname: string): Promise<Response> {
	const completed = await store().completed(token);
	if (completed === null) return json({ ok: false, error: "expired" }, 404);
	if (completed) return json({ ok: true });

	const { response } = ((await request.json().catch(() => ({}))) ?? {}) as { response?: string };
	if (!response) return json({ ok: false, error: "missing response" }, 400);

	const form = new FormData();
	form.append("secret", env.TURNSTILE_SECRET);
	form.append("response", response);
	form.append("idempotency_key", crypto.randomUUID());
	const ip = request.headers.get("CF-Connecting-IP");
	if (ip) form.append("remoteip", ip);
	const result = (await (
		await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })
	).json()) as { success: boolean; hostname?: string; "error-codes"?: string[] };

	if (!result.success || result.hostname !== hostname) {
		return json({ ok: false, error: (result["error-codes"] ?? ["hostname mismatch"]).join(",") }, 403);
	}
	return (await store().complete(token)) ? json({ ok: true }) : json({ ok: false, error: "expired" }, 404);
}

function page(token: string): Response {
	const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>人机验证</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root{color-scheme:light dark;--bg:var(--tg-theme-bg-color,#fff);--fg:var(--tg-theme-text-color,#1f2328);--hint:var(--tg-theme-hint-color,#6e7781)}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{padding:24px 16px;text-align:center;max-width:360px}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:var(--hint)}#msg{margin-top:16px;min-height:24px}
</style></head><body><main>
<h1>人机验证</h1><p>完成下方验证后，回到聊天发送消息即可。</p>
<div class="cf-turnstile" data-sitekey="${env.TURNSTILE_SITEKEY}" data-callback="done" data-language="zh-cn"></div>
<div id="msg"></div>
</main><script>
const tg = window.Telegram && Telegram.WebApp; if (tg) tg.ready();
const msg = document.getElementById("msg");
async function done(response) {
  msg.textContent = "正在确认…";
  const r = await fetch(location.pathname, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({response})});
  const d = await r.json().catch(() => ({}));
  if (d.ok) { msg.textContent = "✅ 验证成功，请回到聊天发送消息。"; if (tg) setTimeout(() => tg.close(), 1500); }
  else { msg.textContent = d.error === "expired" ? "链接已过期，请回到聊天重新发送消息获取新的验证。" : "验证失败，请重试。"; if (window.turnstile) turnstile.reset(); }
}
</script></body></html>`;
	return new Response(html, {
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
		},
	});
}

export default {
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === "/api/verification/create" && request.method === "POST") return create(request, url.origin);

		const statusMatch = path.match(/^\/api\/v1\/verification-status\/([^/]+)$/);
		if (statusMatch && request.method === "GET") {
			return TOKEN_RE.test(statusMatch[1]) ? status(statusMatch[1]) : json({ error: "not found" }, 404);
		}

		const pageMatch = path.match(/^\/v\/([^/]+)$/);
		if (pageMatch && TOKEN_RE.test(pageMatch[1])) {
			if (request.method === "GET") return page(pageMatch[1]);
			if (request.method === "POST") return solve(request, pageMatch[1], url.hostname);
		}
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler;
