# Happie: consuming the service from outside

Two ways in, both under `/api/happie/`. Neither uses the app's login cookie (they are excluded from the session
proxy in `src/proxy.ts`); each has its own secret.

| Consumer | Endpoints | Auth | CORS |
|---|---|---|---|
| **Server to server** (Happia's chat backend, any backend) | `POST /api/happie/webhook/recommend-package`, `.../recommend-packages`, `.../chat` | `x-api-key: $HAPPIE_WEBHOOK_API_KEY` | none (not for browsers) |
| **Browser on an allowed site** | `POST /api/happie/recommend-package`, `.../recommend-packages` | `x-api-key: $HAPPIE_EXTERNO_API_KEY` | only origins in `HAPPIE_EXTERNO_ORIGENES` |

Prefer the webhook: its key stays on the consumer's server. The browser key is visible in page JS and is only a
speed bump against third parties that do not control an allowed origin.

Production base URL (VPS): `https://185-147-157-25.sslip.io`. The Vercel deployment `https://demo-decoracion.vercel.app` also answers these endpoints, but the VPS is the one deployed from `main` by the Deploy workflow.

## Server configuration

| Variable | Meaning |
|---|---|
| `HAPPIE_WEBHOOK_API_KEY` | At least 32 random characters. Without it (or shorter) the webhook answers `503`. Share it once with the consumer. |
| `HAPPIE_EXTERNO_API_KEY` | Key for the browser endpoints. Must differ from the webhook key. |
| `HAPPIE_EXTERNO_ORIGENES` | Comma-separated allowed origins, no trailing slash. Other origins get no CORS headers. |
| `HAPPIA_API_BASE_URL`, `HAPPIA_API_KEY` | How this app reads the Happia catalogue (`https://www.happia.co/api`). |

Generate a secret: `openssl rand -hex 32`. Set the same variables in the production environment (Vercel / VPS)
and redeploy; rotating a key means setting the new value and giving it to the consumer.

## Webhook: recommend packages

```bash
curl -X POST https://185-147-157-25.sslip.io/api/happie/webhook/recommend-packages \
  -H "x-api-key: $HAPPIE_WEBHOOK_API_KEY" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: 6f1c-example-001" \
  -d '{"tipoEvento":"Cumpleaños","invitados":20,"presupuesto":2000000,"preferencias":["tema acuarela"]}'
```

Request (strict, unknown keys are rejected): `tipoEvento` (string, up to 120), `invitados` (integer > 0),
`presupuesto` (number > 0, COP), optional `comida`, `bebida`, `decoracion`, `fotografia` (booleans),
`preferencias` (up to 20 strings), `url` (http/https, base for the returned links), `schema_version`.

Success `200`:

```json
{ "schema_version": "happie.v1", "recomendaciones": [{ "url": ".../client/events/new?package=<id>", "razon": "..." }], "resumen": "..." }
```

`recommend-package` returns one recommendation, `recommend-packages` up to three.

`POST /api/happie/webhook/chat` is the multi-turn version: body `{ "mensaje": "...", "estado": {...} }`; reply
`tipo: "pregunta"` (send the returned `estado` back with the next message) or `tipo: "recomendaciones"`.

Errors always look like `{ "schema_version": "happie.v1", "error": "..." }`, with `campos` for validation errors:

| HTTP | Meaning |
|---|---|
| `400` | Invalid JSON, invalid body or invalid `Idempotency-Key` |
| `401` | Missing or wrong `x-api-key` |
| `408` | The caller cancelled the request |
| `409` | `Idempotency-Key` reused with a different body, or the same key is still running (`Retry-After: 120`) |
| `413` | Body over 32 KB |
| `429` | Rate limit; honour `Retry-After` |
| `502` / `504` | Provider failure / timeout; retry with the same `Idempotency-Key` |
| `503` | Webhook not configured, or the database is unavailable |

Send an `Idempotency-Key` (1–128 printable ASCII characters) on every call: a retry with the same key and body
replays the stored result instead of paying for a second AI call.

## Browser endpoints

Same request body and success response as the webhook, with `x-api-key: $HAPPIE_EXTERNO_API_KEY`, called from a
page served from an origin listed in `HAPPIE_EXTERNO_ORIGENES` (the preflight `OPTIONS` answers `204` with
`Access-Control-Allow-Origin` only for those origins; allowed request headers are `content-type` and `x-api-key`).

They are the simpler path, not the full one: no `Idempotency-Key`, no per-key rate limit (`429`), no 32 KB body cap,
and the `401` is a plain `{ "error": "..." }` without `schema_version`. Use the webhook for anything that needs
retries without double AI charges.

## Checks without spending anything

```bash
BASE=https://185-147-157-25.sslip.io
# 401 expected: no key (a webhook without HAPPIE_WEBHOOK_API_KEY configured answers 503 instead)
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" -d '{}' $BASE/api/happie/webhook/recommend-packages
# 401 expected: wrong key
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "x-api-key: wrong" -H "content-type: application/json" -d '{}' $BASE/api/happie/webhook/recommend-packages
# CORS: 204 + access-control-allow-origin for an allowed origin; 204 without it for any other
curl -si -X OPTIONS -H "origin: https://allowed.example" $BASE/api/happie/recommend-packages
```

Automated coverage: `npm run happie:test-webhook` (auth, idempotency, limits, cancellation, mocked providers).

## Not exposed

The Happia catalogue readers added for the Integrations API (`/api/happie/prueba-api`) are an internal check behind
the app session. They are not part of the external surface.
