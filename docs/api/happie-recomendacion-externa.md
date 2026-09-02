# Recomendación de paquetes Happie — API externa

Dos endpoints pensados para que un servicio externo (desde el navegador, otro
dominio) pida recomendaciones de paquetes de eventos vía IA, sin usar la
cookie de sesión de la app.

## Endpoints

| Endpoint | Recomendaciones |
|---|---|
| `POST /api/happie/recommend-packages` | Hasta 3 |
| `POST /api/happie/recommend-package` | Exactamente 1 |

Ambos comparten la misma lógica y el mismo body; solo cambia cuántas
recomendaciones como máximo devuelve la IA.

## Autenticación

- Header `x-api-key`: debe coincidir con `HAPPIE_EXTERNO_API_KEY` (env var del servidor).
- CORS: el `Origin` del request debe estar en la lista de `HAPPIE_EXTERNO_ORIGENES`
  (orígenes separados por coma, sin barra final). El navegador hace un
  preflight `OPTIONS` que ambos endpoints responden.

Sin API key válida → `401`. Origen no permitido → la respuesta no lleva
headers CORS y el navegador la bloquea (sigue devolviendo el JSON, pero el
navegador no lo expone al script).

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
| `400` | Falta `tipoEvento`, `invitados` o `presupuesto`, o `url` inválida |
| `401` | `x-api-key` ausente o incorrecta |
| `502` | Falló la llamada a la API de Happia o al modelo de IA |

## Ejemplo

```bash
curl -s -X POST http://localhost:3000/api/happie/recommend-packages \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_API_KEY" \
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

## Código relacionado

- Rutas: [`src/app/api/happie/recommend-packages/route.ts`](../../src/app/api/happie/recommend-packages/route.ts), [`src/app/api/happie/recommend-package/route.ts`](../../src/app/api/happie/recommend-package/route.ts)
- Handler compartido: [`src/lib/happie/recomendar-paquetes-externo.ts`](../../src/lib/happie/recomendar-paquetes-externo.ts)
- CORS + API key: [`src/lib/happie/cors-externo.ts`](../../src/lib/happie/cors-externo.ts)
- Motor de IA: [`packages/happie-package-ia/src/recomendador.ts`](../../packages/happie-package-ia/src/recomendador.ts) (`recomendarPaquetesConFiltros`)
- Bypass de la cookie de sesión: [`src/proxy.ts`](../../src/proxy.ts)
