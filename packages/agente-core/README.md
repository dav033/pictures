# @sempertex/agente-core

Motor de tool-calling con LLM, adaptador de Gemini y utilidades de retrieval —
sin nada específico de un dominio. Extraído de `demo-decoracion` para
reutilizarse con otra fuente de datos: no trae SQL, prompts de negocio ni
schemas de intención de ningún dominio en particular. Eso lo aporta cada
consumidor.

## Qué NO es este paquete

No orquesta un asistente completo. No sabe qué es un "producto", una
"categoría" ni un "presupuesto" — esas son decisiones de cada consumidor. El
paquete resuelve tres problemas genéricos:

1. Conversar con un LLM que puede llamar herramientas, hasta que produzca una
   respuesta final o se agoten los turnos.
2. Adaptar un proveedor concreto (hoy: Gemini) a una interfaz neutral, para
   poder cambiar de proveedor sin reescribir el loop.
3. Combinar varios rankings (ej. búsqueda vectorial + full-text) en uno solo
   por posición (Reciprocal Rank Fusion), sin asumir de dónde salió cada uno.

## Instalación

Dentro de este monorepo ya está declarado como npm workspace
(`"workspaces": ["packages/*"]` en el `package.json` raíz) — `npm install`
en la raíz lo enlaza. Para usarlo desde otro repositorio, publicarlo a un
registro (GitHub Packages es la vía normal) o cortarlo con
`git subtree split`; npm no soporta instalar un subdirectorio de un repo git
directamente.

## API pública

### `ejecutarConversacion` / `ejecutarConversacionStream`

El loop de tool-calling. Recibe un `ChatPort` ya resuelto y un **registro de
herramientas** que el consumidor construye — el motor no sabe qué
herramientas existen, solo las declara al proveedor y despacha lo que llegue.

```ts
import { ejecutarConversacion } from "@sempertex/agente-core";
import type { ManejadorHerramienta, RegistroHerramientas } from "@sempertex/agente-core";

const registro: RegistroHerramientas = {
  buscar: async (args, llamada) => {
    // args ya viene parseado desde el JSON Schema declarado en `herramientas`
    return { resultados: await miBusqueda(args.query as string) };
  },
};

const resultado = await ejecutarConversacion({
  chat,                    // ChatPort
  sistema: "Sos un asistente de...",
  historial: [],
  herramientas: [{ nombre: "buscar", descripcion: "...", esquema: { /* JSON Schema draft-07 */ } }],
  registro,
  vueltasMax: 10,           // default 10
  onLlamada: (nombre, args) => console.log(nombre, args), // observabilidad pura, no cambia el flujo
  alAgotarVueltas: (historial) => "no llegué a una respuesta final",
});
```

Una llamada a una herramienta sin handler registrado devuelve
`{ error: "herramienta desconocida: <nombre>" }` al modelo en vez de lanzar.

`ejecutarConversacionStream` es la misma máquina como generador async: emite
`{tipo: "texto", delta}` a medida que llega, `{tipo: "herramienta", nombre,
estado}` alrededor de cada ejecución, y termina con `{tipo: "fin", resultado}`.

### `crearChatGemini`

Adaptador `ChatPort` sobre `@google/genai`.

```ts
import { crearChatGemini } from "@sempertex/agente-core/gemini";

const chat = crearChatGemini({
  apiKey: process.env.GEMINI_API_KEY,        // opcional, default: GEMINI_API_KEY del entorno
  modelo: "gemini-3.6-flash",                 // opcional, default: GEMINI_CHAT_MODEL o "gemini-3.6-flash"
  thinkingLevel: ThinkingLevel.LOW,           // opcional
});
```

Traduce el transcript neutral (`Mensaje[]`) al formato de Gemini en cada
turno — nada se persiste en formato de proveedor, lo que permite cambiar de
adaptador a mitad de conversación. Clasifica errores del SDK
(`ApiError.status`) en un `ErrorIA` tipado (`causa`: `sin_llave` | `cuota` |
`filtrado` | `timeout` | `red` | `desconocido`, más `reintentable: boolean`)
en vez de dejar todo caer en un catch genérico.

### `fusionarRankings`

RRF puro — no sabe qué es un producto, solo combina listas de IDs.

```ts
import { fusionarRankings } from "@sempertex/agente-core/rag";

const fusionado = fusionarRankings(
  [
    { ids: resultadosVectoriales, peso: 0.6 },
    { ids: resultadosTexto, peso: 0.4 },
  ],
  { k: 60 }, // default 60 (Cormack et al. 2009)
);
// Map<id, score> — ordenar por score descendente para el ranking final
```

Fusiona por posición y no por score normalizado porque los scores de ramas
distintas (ej. similitud coseno vs. `ts_rank` de full-text) no son
comparables entre sí.

### `conReintento`

Retry genérico con backoff exponencial + jitter para cualquier función async.

```ts
import { conReintento } from "@sempertex/agente-core";

const resultado = await conReintento(() => llamadaQuePuedeFallar(), {
  intentos: 3,              // default 3
  esperaBaseMs: 500,        // default 500
  reintentable: (error) => true, // opcional: filtra qué errores vale la pena reintentar
});
```

### `registrarEvento` / `ultimosEventos`

Telemetría en memoria (buffer circular) para operaciones del motor —
pensada para un panel de admin simple, no para producción multi-instancia.

## El patrón que NO se extrajo: validación anti-alucinación

`demo-decoracion` valida cada selección del LLM contra la base de datos antes
de cotizar nada (`src/lib/rag/chat/validar.ts`). El código no se extrajo
porque cada línea toca columnas concretas de Postgres — pero el patrón
aplica a cualquier dominio con un catálogo/inventario real detrás, y vale la
pena reimplementarlo así en cada consumidor:

1. **El LLM nunca manda datos comerciales.** El schema de la herramienta de
   "seleccionar" solo admite `productId` + `variantId` + `cantidad` (+ una
   razón en texto libre). No hay campo de precio, nombre ni imagen — no
   existe forma de que el modelo los inyecte porque el schema no los admite.
2. **Whitelist de la ronda, no confianza en lo que el LLM "vio".** Cada
   `productId` seleccionado se verifica contra el conjunto de IDs que el
   *retrieval* efectivamente devolvió en ese turno. Si no está ahí, se
   rechaza — el modelo pudo alucinar un ID plausible, pero si retrieval no
   lo entregó, no se cotiza.
3. **Todo dato mostrable (precio, disponibilidad, título, imagen) se
   resuelve de nuevo contra la base de datos**, nunca desde lo que dijo el
   LLM. El subtotal se calcula en código (`precio × cantidad`), nunca se le
   pide al modelo que lo calcule.
4. **Rechazar, no recortar en silencio.** Si la cantidad pedida excede el
   inventario o la variante está agotada, el ítem se rechaza con un motivo
   explícito — ajustarle la cantidad al cliente sin decírselo sería tan malo
   como inventar disponibilidad.
5. **El resultado siempre distingue validados de rechazados** (con motivo),
   para que la capa de presentación pueda explicarle al usuario qué no se
   pudo confirmar y por qué, en vez de fallar en silencio o mostrar un
   carrito parcial sin explicación.

Un consumidor con una fuente de datos distinta reimplementa estos cinco
puntos contra su propio storage — la forma exacta de la query cambia, la
garantía no.
