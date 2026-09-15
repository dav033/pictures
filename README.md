# Asistente de decoración con globos (Sempertex)

Aplicación web en la que un cliente describe su evento, o muestra una foto de una decoración que le gusta, y un asistente arma una **propuesta de decoración con globos reales del catálogo Sempertex**. La propuesta incluye medidas, cantidades, cotización por paquetes y presupuesto; después se puede generar una vista previa con un LoRA propio.

- **Frontend y API:** Next.js 16 (App Router, React 19, Tailwind 4, `motion`), en `src/`.
- **Backend Python:** FastAPI en `services/ai-api/`. Resuelve el plan con paridad TS↔Python y hace la búsqueda en el catálogo.
- **Paquetes:** `packages/agente-core` (orquestación del chat con Gemini) y `packages/happie-package-ia`.
- **Datos:** PostgreSQL en **Neon**, la única fuente de verdad: catálogo publicado, embeddings, planes, telemetría y LoRA.
- **IA:** Gemini para chat, análisis de fotos, QA visual y embeddings; fal.ai (`fal-ai/flux-2/lora`) para la vista previa con el LoRA.

## Cómo correrlo en local

Requisitos: Node 22 o superior (CI usa 22), npm, Python 3.11 o superior con [uv](https://docs.astral.sh/uv/), y acceso a la base de Neon y a las claves.

1. **Dependencias**
   ```bash
   npm ci
   npm run build --workspaces --if-present   # compila packages/* (sin esto: MODULE_NOT_FOUND @sempertex/agente-core)
   cd services/ai-api && uv sync --extra test --extra quality && cd -
   ```
2. **Variables** (`.env.local`, ignorado por git). Parte de `.env.local.example`. Los valores sensibles están en el servidor de producción.
   - `DATABASE_URL` y `CATALOG_DATABASE_URL`: URL de Neon **entre comillas simples**. Contiene `&channel_binding=require`, y sin comillas `set -a; . .env.local` corta la variable.
   - `APP_PASSWORD`, `PLAN_APPROVAL_SECRET`, `INTERNAL_HMAC_SECRET`, `GEMINI_API_KEY`, `FAL_KEY`, `SHOPIFY_WEBHOOK_SECRET`, `HAPPIA_*` / `HAPPIE_*`.
   - Flags igual que en producción: `IA_PROVEEDOR=gemini`, `RAG_ENABLED=true`, `PLAN_DECORACION_ENABLED=true`, `PYTHON_BACKEND_ENABLED=true`, `RAG_USE_VECTOR=true`, `RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED=true`, `RAG_FRANJAS_ENABLED=true`, y los modelos `GEMINI_CHAT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSIONS`.
   - Sin `RAG_ENABLED` el chat responde «El servicio no respondió» (`RAG_UNAVAILABLE`).
3. **Backend Python** (uvicorn no lee dotenv):
   ```bash
   cd services/ai-api
   bash -c 'set -a; . ../../.env.local; set +a; exec uv run --system-certs uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload'
   # comprobar: curl localhost:8000/readyz  →  {"status":"ready"}
   ```
4. **Frontend**
   ```bash
   PORT=3010 npm run dev      # http://localhost:3010  (entra con APP_PASSWORD)
   ```

No hace falta una base de datos local: todo apunta a Neon. Los tests que usan PostgreSQL crean su propia base desechable, igual que CI.

## Verificación

- **CI** (`.github/workflows/checks.yml`) en cada push a `main` y en cada PR:
  - build de paquetes, `contracts:check`, `lint`, `next build`, `tsc`;
  - contratos, `plan:test` (incluye paridad TS↔Python), historial de chat, webhook de Happie e idempotencia, con PostgreSQL de CI;
  - Python: `ruff check`, `ruff format --check`, `mypy app scripts`, `generate_models --check`, `pytest`;
  - escaneo de secretos.
- **Sin gasto en local** (vacía las claves: `env GEMINI_API_KEY= FAL_KEY= …`): `npm run plan:test`, `npm run ia:test`, `npm run ui:test-propuesta`, `npm run ui:test-armazon`, `npm run ia:test-referencias-reglas` y el resto de scripts `*:test*` de `package.json`.
- **E2E de interfaz (simulado, sin gasto):** `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npx tsx scripts/e2e-modo-vista.ts --base http://localhost:3010`.
- **Pruebas E2E del backend con Gemini real (con gasto):** `npm run plan:test-segunda-e2e` y `npm run plan:test-tercera-e2e` validan sin red; las corridas reales se hicieron contra `/api/chat` con la foto `ejemplo-01`.

## Despliegue

- **Next** (`demo-decoracion`): push a `main` → `checks.yml` → `deploy.yml`. Este último ejecuta por SSH `~/deploy-demo-decoracion.sh <sha>` en el servidor (EC2), que construye la imagen y reemplaza el contenedor. Solo acepta commits de `origin/main`.
- **Backend Python** (`demo-decoracion-ai-api`): el pipeline no lo despliega. Se construye en el servidor desde el mismo commit: `docker build services/ai-api`, y se reemplaza el contenedor con `--network stack_web` y `--env-file ~/ai-api.env`. **Si cambia el contrato del plan, despliega ai-api antes que Next.** Desde la iteración 4 ai-api también necesita `CATALOG_DATABASE_URL` (catálogo y `/readyz`), y el `plan_hash` cambia en planes con compras consolidadas o medidas de foto: un plan firmado antes del despliegue puede pedir confirmarse de nuevo (409).
- **URL pública:** https://52-54-205-188.sslip.io (Caddy → `demo-decoracion:3000`).

## Flujo del cliente

1. **Inicio:** «¿Qué vamos a decorar?». El cliente escribe, sube una foto o elige una de las **10 fotos de ejemplo** (Pexels, en `public/referencias-ejemplo/`).
2. **Análisis de la foto**, animado: detecta cada pieza de globos con su recuadro, colores y ambientación. Si la foto no tiene globos, el asistente pregunta antes de proponer.
3. **Chat:** el asistente muestra sus pasos en vivo (entender, buscar en el catálogo, armar) y confirma un plan firmado.
4. **Propuesta:** piezas con el recorte real de la foto o fotos reales de producto, medidas, globos, colores, tamaños y ambientación que no se cotiza. Incluye el **detalle de cada estructura** (productos, edición) y la **cotización** (paquetes cerrados, sobrantes, total con IVA y presupuesto).
5. **Aprobar y ver cómo queda:** genera la vista previa con el LoRA. Si el servicio de imágenes no está disponible, lo dice claramente y la propuesta se conserva.
6. **Tema claro u oscuro:** sigue al sistema y tiene interruptor en la cabecera. El «Modo dev» muestra detalles técnicos.

## Cambios recientes

### Iteración 3 (2026-09-14)
- Corregida la regresión del preflight del LoRA v004 (`eventdecor_style_v2`): 51/3.840 escenas pasaban de 750 caracteres; ahora 0.
- La escena del plan (lugar y hora) completa el contexto visual de la imagen cuando el cliente no la dio.
- El QA visual detecta piezas laterales separadas que se unieron en un arco.
- Formato de prompt JSON por defecto con `eventdecor_style_v2`, y `seed` opcional validado en `/api/generate`.

### Iteración 4 (2026-09-14/15)
- **Rediseño completo de la interfaz**:
  - cabecera en una línea;
  - tema claro y oscuro con contraste AA;
  - galería de ejemplos;
  - pasos en vivo;
  - propuesta, detalle y cotización animados con recortes reales;
  - análisis de foto y de espacio;
  - estados de espera y error;
  - todas las vistas secundarias adaptadas;
  - miniaturas persistentes tras recargar.
- **Armador del plan** (TS y Python con paridad):
  - reparto de unidades sin materiales en 0 y mínimos por figura y bouquet;
  - colores de la foto que faltan se registran como sustitución y se avisan;
  - foto sin globos → el asistente pregunta;
  - validación del rango de estructuras por nivel de creatividad;
  - el nivel de creatividad va firmado en el plan;
  - fal sin saldo → error `VISTA_PREVIA_NO_DISPONIBLE` no reintentable.
- **Análisis de referencia**:
  - solo se aprueban estructuras de globos tipadas (un globo aerostático ya no es una «figura»);
  - verificador con umbral y deduplicación;
  - piezas contenidas en una pared y globos sueltos no se cotizan;
  - partición de piezas a ambos lados;
  - perla y ubicaciones coherentes;
  - validación de bytes y mime, y 413 real para fotos grandes;
  - reanálisis sin caché y deduplicación en vuelo;
  - errores de imagen no reintentables;
  - `request_id` en las respuestas.
- **Verificación E2E real (tres rondas con Gemini real)** y sus correcciones:
  - los colores de la foto se conservan aunque la ocasión (p. ej. cumpleaños) no los filtre; los últimos mensajes del cliente mandan sobre colores y piezas (`restricciones-conversacion.ts`);
  - las medidas estimadas desde una foto quedan como supuesto, no como dato;
  - compras consolidadas por producto, tamaño y color (una fila por paquete, sin duplicados);
  - el plan converge: tras 2 rechazos del validador se relajan reglas no críticas, tras 4 se responde `PLAN_NO_CONVERGE` con una pregunta, y el turno se cierra a los 40 s;
  - el brief de la herramienta se sanea (claves desconocidas ya no tumban el turno);
  - el filtro de tamaños por turno solo usa tamaños que pidió el cliente; gris y plateado son colores distintos;
  - números por dígito (`NUMERO_INCORRECTO`), marcas registradas, un solo material por pieza cuando aplica;
  - nunca hay turnos vacíos y el asistente no afirma cambios que no aplicó («Todavía no pude aplicar ese cambio»);
  - creatividad, propuesta aprobada, imagen y adjuntos persisten tras recargar;
  - pool de Neon con keepAlive y reintento ante cortes.

### Iteración 5 (2026-09-15)
- **Recuadros de la foto de referencia:** Gemini devolvía a veces cajas desplazadas (una columna izquierda dibujada sobre la mesa). Ahora el análisis pide las cajas en el formato nativo de Gemini, `box_2d` [ymin, xmin, ymax, xmax] de 0 a 1000, y las convierte a `reference_bbox`. En la foto 1, con el formato anterior, 1 de 3 corridas salió desplazada; con `box_2d`, 6 de 6 bien. También probado con 13 fotos de Wikimedia Commons fuera de la galería. Versión del parser: `semantic-layers-v13-box-2d`.
- **Fotos de ejemplo con análisis fijo** (`src/lib/ia/analisis-ejemplos.json`): la galería envía el archivo sin recomprimir y el servidor lo reconoce por SHA-256. Así devuelve un análisis revisado al instante, igual en todos los navegadores y sin llamar a Gemini. «Reintentar» sí pide un análisis nuevo. Se regenera con `npx tsx --conditions=react-server scripts/generar-analisis-ejemplos.ts` cuando cambia la versión del parser; `ia:test-analisis-ejemplos` falla si queda desactualizado.
- **Verificación del análisis:** si el paso de verificación devuelve una salida mal formada, se usa el inventario en vez de fallar con 502.
- **Flujo:** elegir una foto de la galería, o subir una en la pantalla inicial, envía el turno solo; el análisis y la propuesta llegan sin otro clic.
- **Propuesta:** el número de veces que cada producto salió en el entrenamiento del LoRA vuelve a verse en modo usuario (antes de la iteración 4 era visible), junto a «Modificar», «Quitar» y «Cambiar» para reemplazar globos. La validación visual queda marcada por defecto.
- Títulos de la galería alineados con lo que detecta el análisis (columnas en vez de semiarcos en las fotos 1, 3 y 5).
- **Calibración de creatividad en la imagen (Gemini estándar, sin LoRA):**
  - *Qué se midió:* si cada nivel (0–5) da imágenes distintas y coherentes con su definición sin romper lo cotizado (número y tipo de estructuras, colores y ubicación), qué partes del prompt confunden al modelo y si la validación visual detecta los fallos.
  - *Método:* 4 planes aprobados de texto, sin foto del espacio, referencias ni fotos de catálogo: XV con arco y dos columnas; cumpleaños con semiarco y columna separados; baby shower con una guirnalda de un color y un solo tamaño; boda con pared, dos columnas y dos centros de mesa. Cada plan se generó en los 6 niveles con el mismo encadenamiento de `/api/generate` y el catálogo simulado (`scripts/calibrar-creatividad-gemini.ts`). Modelo `gemini-3.1-flash-image` a 1K. Gemini no tiene semilla, así que cada repetición es una tirada nueva del mismo prompt. En total 100 imágenes: línea base 24, primera corrección 24, versión final 48 (2 repeticiones) y 3 de control de la forma del arco. Cada imagen pasó por la validación visual de la app. Imágenes, prompts y resultados están en `pictures-infra/iteracion5/calibracion/`.
  - *Línea base:* Gemini recibía el mismo prompt, byte a byte, en los niveles 0, 1, 3, 4 y 5 de los 4 planes. El nivel solo llegaba al LoRA. Las 24 imágenes eran salones vacíos sin diferencias de estilo. En el nivel 2 el prompt fijaba un lugar sin sentido, sacado de cualquier «en …» del pedido: «blanco y dorado con un arco orgánico…», «pared», «entrada y centros de mesa». Otros fallos: 2 de 6 imágenes de la boda dibujaron cotas y rótulos («2.4 m», «Columna de entrada»); 0 de 6 pusieron los centros de mesa sobre mesas (salieron sobre cajas o pedestales, porque el prompt prohibía las mesas); apareció una cortina inventada y un aro en vez del arco. La validación visual detectó los rótulos (2 de 2), pero no la cortina ni el aro.
  - *Cambios:* `creatividad.ts` gana `imagen.direccion` y `imagen.ambientacion`. Sus usos: dirección de arte en el prompt de Gemini (vacía en el nivel 2, que conserva el prompt anterior) y estilismo permitido (flores desde el nivel 3, velas e invitados desde el 4, mesa de postres en el 5). `build-image-prompt.ts` añade la sección `CREATIVITY LEVEL` con el bloqueo de fidelidad y abre las prohibiciones de flores, muebles y personas solo para ese estilismo. También pide mesas lisas bajo los centros de mesa. Los nombres de las piezas pierden las medidas; el tamaño se describe con palabras («about the height of an adult»), sin cifras. El arco es una U invertida, salvo que el plan declare un aro circular, y la guirnalda de pared va anclada. El prompt termina con un recordatorio de «cero texto», en vez de terminar en el JSON de la escena. `visual-context.ts` ya no toma cualquier «en …» como lugar. La validación visual recibe el nivel: el estilismo permitido y las mesas de los centros no cuentan como extras, pero globos sueltos, cortinas, letreros y texto siguen fallando. Además se le pide listar cortinas, pedestales y aros, y marcar formas distintas. Una prueba determinista fija estas reglas: `npm run ia:test-creatividad-imagen`.
  - *Después (48 imágenes finales):*
    - Cada nivel produce un prompt distinto; número, colores, tamaños y escena son idénticos en todos los niveles.
    - Los niveles 0–2 no añaden estilismo (24 de 24). El 3 añade flores sin invitados (8 de 8). El 4 añade invitados y velas (8 de 8). El 5 añade mesa de postres o pastel en 6 de 8; la boda no la puso.
    - Número de estructuras y colores correctos a ojo en 47 de 48 (en una boda sobró una columna).
    - Texto dibujado: 0 de 48. Antes de quitar la palabra «editorial» del nivel 3 hubo 2 de 2, y 3 de 24 en la primera corrección.
    - Centros de mesa sobre mesa en 11 de 12, aunque 4 salieron como ramilletes con varilla.
    - La validación visual detectó 3 de los 5 arcos con forma de aro o marco, las cortinas inventadas y los pedestales. En la primera corrección marcaba como extra las mesas pedidas (4 de 6); ya está corregido.
  - *Límites y pendientes:*
    - Es Gemini estándar, no el LoRA (fal.ai sin saldo), y sin fotos.
    - Muestra pequeña: 1–2 tiradas por nivel y plan.
    - La forma del arco siguió fallando en 5 de 12 imágenes. Tras la cláusula de U invertida, 1 de 3 salió como aro, y esa misma imagen (nivel 0) dibujó rótulos. Se cambió «documentary» por «true-to-life» sin volver a medir.
    - La validación visual no detecta guirnaldas flotando ni la columna sobrante. Falló la observación en 2 de 48, y en el nivel 5 puede marcar como extra el pedestal de la mesa de postres.
    - La calidad de generación fue 1K; producción usa 2K.

## Decisiones tomadas

- **Neon es la única fuente de verdad**; no se usa base local para la app.
- **Diseño:**
  - propuesta dentro del chat; se descartó la variante «lado a lado»;
  - nada de globos dibujados por código: recortes reales de la foto, fotos de producto del catálogo o las siluetas de `IconoEstructura`;
  - el interruptor «Modo dev» se mantiene visible;
  - los nombres comerciales de producto no se traducen.
- **Tema:** sigue al sistema, con interruptor que se guarda en el navegador. En oscuro, el texto de los botones lila es oscuro, para cumplir AA.
- **Foto sin globos** (niveles 0–2): el asistente pregunta qué piezas quiere o sugiere una foto de ejemplo, y no vuelve a preguntar si el cliente ya respondió.
- **Unidades:** `unidades_declaradas` son unidades de venta de la estructura completa (globos si se arma con globos sueltos). La `quantity` del análisis es el número de piezas iguales (repeticiones). El reparto por mayor residuo conserva los planes ya aprobados (`plan_hash` estable).
- **Creatividad:** con foto con globos manda la foto; sin foto se valida el rango de estructuras del nivel. El nivel firmado en el plan manda al generar.
- **Límite de subida:** 10 MB, el valor por defecto del proxy, ahora explícito. La interfaz recomprime a JPEG de 1800 px.
- **CI:** se arregló la deuda previa en lugar de desactivar checks (`ia:test`, formato Python).

## Limitaciones conocidas

- La **generación de imagen con fal.ai** estuvo detenida por saldo agotado durante la iteración 4; si vuelve a faltar saldo la interfaz lo dice (`VISTA_PREVIA_NO_DISPONIBLE`) y conserva la propuesta. La calibración visual de creatividad (niveles 0–5 con semilla fija) sigue pendiente.
- El número foil «4» en dorado o plata no está en la lista de productos entrenados; el asistente ofrece el disponible (latte).
- Los niveles de creatividad y las bandas de conteo de globos son supuestos de diseño, no están calibrados con montajes reales.
- El análisis de fotos con Gemini no es totalmente estable entre corridas; «Reintentar» fuerza un análisis nuevo.
- El rol de solo lectura para `CATALOG_DATABASE_URL` no está provisionado; hoy usa la misma URL que `DATABASE_URL`.
