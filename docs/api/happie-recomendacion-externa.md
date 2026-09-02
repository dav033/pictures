# Recomendación y chat de paquetes Happie — API externa

Cinco endpoints, dos variantes de transporte, misma lógica de negocio: le
piden a la IA recomendaciones de paquetes de eventos, sin usar la cookie de
sesión de la app.

## Endpoints

| Endpoint | Recomendaciones | Consumidor |
|---|---|---|
| `POST /api/happie/recommend-packages` | Hasta 3 | Navegador (CORS) |
| `POST /api/happie/recommend-package` | Exactamente 1 | Navegador (CORS) |
| `POST /api/happie/webhook/recommend-packages` | Hasta 3 | Server-to-server (webhook) |
| `POST /api/happie/webhook/recommend-package` | Exactamente 1 | Server-to-server (webhook) |
| `POST /api/happie/webhook/chat` | Conversación antes de recomendar | Server-to-server (webhook) |

Las cuatro comparten el mismo body y la misma lógica de recomendación — solo
cambia cuántas recomendaciones como máximo devuelve la IA y cómo se
autentican/transportan.

El endpoint `webhook/chat` usa el mismo recomendador, pero reúne los datos en
varios turnos y exige confirmación antes de buscar paquetes.

## Autenticación

**Navegador** (`recommend-packages` / `recommend-package`):
- Header `x-api-key`: debe coincidir con `HAPPIE_EXTERNO_API_KEY` (env var del servidor).
- CORS: el `Origin` del request debe estar en la lista de `HAPPIE_EXTERNO_ORIGENES`
  (orígenes separados por coma, sin barra final). El navegador hace un
  preflight `OPTIONS` que ambos endpoints responden.
- Origen no permitido → la respuesta no lleva headers CORS y el navegador la
  bloquea (sigue devolviendo el JSON, pero el navegador no lo expone al script).

**Webhook** (`webhook/recommend-packages` / `webhook/recommend-package`):
- Header `x-api-key`: debe coincidir con `HAPPIE_WEBHOOK_API_KEY` — un secreto
  **distinto** al de navegador, porque este nunca queda expuesto en JS de
  cliente y se puede tratar como un secreto real.
- La clave debe tener mínimo 32 caracteres aleatorios y configurarse con el
  mismo valor en este servidor y en el backend consumidor.
- Sin CORS ni preflight: pensado para que el backend de chat de Happia lo
  llame directo, servidor a servidor.

En ambas variantes, sin API key válida → `401`.

## Body de la petición

```jsonc
{
  "tipoEvento": "Cumpleaños",     // requerido
  "invitados": 25,                // requerido, > 0
  "presupuesto": 800000,          // requerido, > 0
  "comida": true,                 // opcional, boolean
  "bebida": true,                 // opcional, boolean
  "decoracion": false,            // opcional, boolean
  "fotografia": true,             // opcional, boolean
  "preferencias": ["colores neón", "ambiente juvenil"], // opcional, string[]
  "url": "https://www.happia.co"  // opcional, string (URL)
}
```

- **Servicios booleanos** (`comida`/`bebida`/`decoracion`/`fotografia`): solo
  los que vienen en `true` se le mencionan a la IA como necesarios. Los que
  vienen en `false` o no se envían simplemente se ignoran — la IA nunca se
  entera de que esa opción existió, no la exige ni la penaliza.
- **`preferencias`**: texto libre (colores, temática, restricciones, etc.)
  que la IA tiene en cuenta al elegir y al redactar la razón.
- **`url`**: dominio base para armar el link de cada paquete recomendado
  (ver formato abajo). Si no se envía, se deriva de `HAPPIA_API_BASE_URL`
  quitándole el sufijo `/api` (queda `https://www.happia.co`). Si se envía
  y no es una URL válida, responde `400`.

## Respuesta

```jsonc
{
  "recomendaciones": [
    {
      "url": "https://www.happia.co/client/events/new?package=e62aa19b-ca0c-4c5c-8807-3d5623bf4e07",
      "razon": "Encaja con el ambiente juvenil pedido e incluye decoración, aunque excede el presupuesto por $11.000."
    }
  ],
  "resumen": "Te recomendamos este paquete por adaptarse a tu estilo y presupuesto."
}
```

- Cada recomendación trae solo `url` (link listo para el cliente, con el
  `package` id embebido) y `razon` (una frase). No se devuelve el objeto
  completo del paquete.
- La IA compara el presupuesto contra el precio total real de cada paquete
  y lo dice con honestidad en la razón si lo excede.
- Si el catálogo no tiene un paquete categorizado exactamente como
  `tipoEvento`, la IA puede adaptar uno de otra categoría por temática —
  también lo explica en la razón.

## Errores

| Status | Motivo |
|---|---|
| `400` | JSON inválido, campo requerido/tipo incorrecto o `url` no HTTP(S) |
| `401` | `x-api-key` ausente o incorrecta |
| `502` | Falló la llamada a la API de Happia o al modelo de IA |
| `503` | `HAPPIE_WEBHOOK_API_KEY` ausente o menor de 32 caracteres |

## Ejemplo

Navegador:
```bash
curl -s -X POST http://localhost:3000/api/happie/recommend-packages \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY_NAVEGADOR" \
  -d '{
    "tipoEvento": "Cumpleaños",
    "invitados": 25,
    "presupuesto": 800000,
    "comida": true,
    "bebida": true,
    "fotografia": true,
    "preferencias": ["colores neón", "ambiente juvenil"]
  }'
```

Webhook (server-to-server, mismo body, sin necesidad de `Origin`):
```bash
curl -s -X POST http://localhost:3000/api/happie/webhook/recommend-package \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY_WEBHOOK" \
  -d '{"tipoEvento": "Boda", "invitados": 60, "presupuesto": 2500000, "decoracion": true}'
```

El chat consumidor debe convertir la conversación a este body estructurado
antes de llamar el webhook. La selección final usa el flujo nuevo: acota el
catálogo por tipo de evento y cercanía de invitados, luego la IA pondera
presupuesto, servicios y preferencias. La respuesta mantiene solo enlaces y
razones; no expone el catálogo completo.

## Chat conversacional externo

Primera llamada:

```json
{
  "mensaje": "Quiero una boda para 60 personas con 2,5 millones"
}
```

Mientras falten datos, responde `tipo: "pregunta"`:

```json
{
  "tipo": "pregunta",
  "mensaje": "¿Qué servicios necesitas y tienes alguna preferencia de estilo?",
  "estado": {
    "fase": "detalles",
    "tipoEvento": "Boda",
    "invitados": 60,
    "presupuesto": 2500000,
    "servicios": [],
    "preferencias": []
  }
}
```

La aplicación externa muestra `mensaje` y envía el `estado` recibido, sin
modificarlo, junto con el siguiente mensaje del usuario:

```json
{
  "mensaje": "Decoración y fotografía, estilo elegante",
  "estado": { "...": "estado devuelto por la llamada anterior" }
}
```

El webhook resume los datos y pide confirmación. Solo después de un “sí”
responde `tipo: "recomendaciones"`, con `mensaje`, `resumen`, `estado` y
`recomendaciones` en el mismo formato de enlaces y razones documentado arriba.
Para iniciar otra conversación, se omite `estado`.

## Código relacionado

- Lógica de negocio compartida: [`src/lib/happie/generar-recomendacion.ts`](../../src/lib/happie/generar-recomendacion.ts)
- Rutas navegador: [`src/app/api/happie/recommend-packages/route.ts`](../../src/app/api/happie/recommend-packages/route.ts), [`src/app/api/happie/recommend-package/route.ts`](../../src/app/api/happie/recommend-package/route.ts)
- Handler navegador (CORS + API key): [`src/lib/happie/recomendar-paquetes-externo.ts`](../../src/lib/happie/recomendar-paquetes-externo.ts), [`src/lib/happie/cors-externo.ts`](../../src/lib/happie/cors-externo.ts)
- Rutas webhook: [`src/app/api/happie/webhook/recommend-packages/route.ts`](../../src/app/api/happie/webhook/recommend-packages/route.ts), [`src/app/api/happie/webhook/recommend-package/route.ts`](../../src/app/api/happie/webhook/recommend-package/route.ts)
- Handler webhook (API key propia, sin CORS): [`src/lib/happie/recomendar-paquetes-webhook.ts`](../../src/lib/happie/recomendar-paquetes-webhook.ts)
- Chat webhook multi-turno: [`src/app/api/happie/webhook/chat/route.ts`](../../src/app/api/happie/webhook/chat/route.ts), [`src/lib/happie/conversacion-webhook.ts`](../../src/lib/happie/conversacion-webhook.ts)
- Motor de IA: [`packages/happie-package-ia/src/recomendador.ts`](../../packages/happie-package-ia/src/recomendador.ts) (`recomendarPaquetesConFiltros`)
- Bypass de la cookie de sesión: [`src/proxy.ts`](../../src/proxy.ts)
