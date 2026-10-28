# betterforward-verify

TGuard-compatible verification API for BetterForward's `tguard` captcha, backed by
Cloudflare Turnstile and a single SQLite Durable Object (strongly consistent, so
BetterForward sees the result immediately from another region).

- `POST /api/verification/create` with `X-API-Key` and `{"user_id": n}` returns `{token, verification_url}`
- `GET /api/v1/verification-status/:token` returns `{completed}` or 404 after 5 minutes
- `/v/:token` is the Mini App page with the Turnstile widget

Deploy with `npm install && cf deploy`. Secrets: `TURNSTILE_SECRET`, `API_KEY`
(the same key goes into BetterForward's TGuard API settings, URL `https://verify.furina.ai`).
