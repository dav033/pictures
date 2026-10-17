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

## V2: services, packages or mixed recommendations

Opt in on the same recommendation and chat endpoints with `"schema_version": "happie.v2"`.
Omitting the version (or sending `happie.v1`) retains the existing package-only contract.

```json
{
  "schema_version": "happie.v2",
  "tipoEvento": "Cumpleaños infantil",
  "invitados": 20,
  "presupuesto": 2000000,
  "city": "barranquilla",
  "modo": "mixto",
  "cantidad": { "servicios": 5, "paquetes": 2 },
  "preferencias": ["show de magia", "decoración acuarela"]
}
```

`modo` is `servicios`, `paquetes` or `mixto` (default). `cantidad` contains independent recommendation
counts, each an integer from 0 to 20, at least one nonzero. For `servicios`, set `paquetes: 0`;
for `paquetes`, set `servicios: 0`. When omitted, counts default to 3 per enabled type.
These are counts of **recommendations**, not guests or booking units. The legacy endpoint names
`recommend-package` / `recommend-packages` impose their one/three limits only for v1; v2 uses `cantidad`.
The result may contain fewer matches, with an explanation, when the catalogue has insufficient relevant options.
`city` is an optional lowercase city slug; the chat asks for a city before recommending.

The response has `schema_version`, `modo`, requested `cantidad`, `resumen`, and three arrays:

- `recomendaciones`: a ranked list whose `tipo` is `servicio` or `paquete`.
- `servicios`: the service recommendations, so consumers do not need to split the ranked list.
- `paquetes`: the package recommendations.

Each recommendation has `razon`, `precio` and its complete **public** catalogue record (`servicio` or `paquete`).
A package also has the existing booking `url`. Services are identified by their real catalogue `id`; no service
booking URL is invented because the Happia guide does not define one. Only active packages and active package
items are offered. Service records come from Happia's bookable-services endpoint. New upstream/private fields
are excluded by an explicit projection.

`precio` has `moneda: "COP"`, `subtotal: number | null`, `es_final: false`, `invitados`, `cantidad: 1`, and
`advertencia`. `total` stays the public price per unit, never the provider's own price. Estimates use the requested
guests for per-person charging and assume one unit for editable quantities, including one per guest when applicable.
Unknown legacy charging yields a null estimate. IVA, Happia's fee and delivery are excluded; the checkout total
cannot be inferred from these endpoints. Mixed results are individual alternatives, not a combined cart or a claim
that their services do not overlap.

For multi-turn chat use the same options on `POST /api/happie/webhook/chat`:

```json
{
  "schema_version": "happie.v2",
  "mensaje": "Quiero un cumpleaños infantil en Barranquilla para 20 personas, tengo dos millones y busco magia",
  "modo": "mixto",
  "cantidad": { "servicios": 5, "paquetes": 2 }
}
```

Send the returned `estado` with every next message and keep `schema_version: "happie.v2"`. Mode, city and counts
persist in that state. Explicit request options take precedence; users can also change mode or counts in natural
language (for example, “mejor solo 7 servicios”). A changed request is summarized again before recommendations.
A question has `tipo: "pregunta"`, `mensaje`, `estado`; final results have `tipo: "recomendaciones"`, those same
fields and all the arrays/metadata described above. The authenticated `/happie` UI uses this contract too.
Control/authentication errors retain the existing v1 error envelope; successful v2 results always identify v2.

Machine-readable schemas: `contracts/domain/v1/happie-v2/*.schema.json`; validate drift with `npm run contracts:check`.
The nested directory keeps these TypeScript catalogue contracts outside the Python v1 model generator's input set.

### Compatibility decision and rollback

Existing strict v1 readers cannot accept service records or extra response fields. A new explicit version was
chosen over changing v1 in place or adding separate services-only chat endpoints, which would duplicate state,
authentication and idempotency. Consumers affected are the session chat UI, server webhook integrations and external
CORS recommenders. All retain the same authentication/limits; v2 opts into its new shape. Python remains the generic
structured-generation adapter; it does not own these catalogue selection contracts. Rollback: deploy the prior
checked revision; existing v1 clients need no migration, and the UI keeps transient conversation state in memory.

### External chat text

The chat webhook keeps `resumen` in final recommendation responses as the empty string `""`.
Render `mensaje` as the conversational text and use the recommendation arrays for option details. This avoids
showing the same paragraph twice without removing or renaming fields. Shared internal/session generation retains
its original summary; the existing schema files continue to describe that internal representation.
Social or unrelated messages receive a brief contextual reply and retain the current event/phase. They do not
trigger recommendations or replace event preferences with unrelated text.

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
