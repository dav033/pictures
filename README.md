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
- **E2E de interfaz:** `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npx tsx scripts/e2e-modo-vista.ts --base http://localhost:3010`.

## Despliegue

- **Next** (`demo-decoracion`): push a `main` → `checks.yml` → `deploy.yml`. Este último ejecuta por SSH `~/deploy-demo-decoracion.sh <sha>` en el servidor (EC2), que construye la imagen y reemplaza el contenedor. Solo acepta commits de `origin/main`.
- **Backend Python** (`demo-decoracion-ai-api`): el pipeline no lo despliega. Se construye en el servidor desde el mismo commit: `docker build services/ai-api`, y se reemplaza el contenedor con `--network stack_web` y `--env-file ~/ai-api.env`. **Si cambia el contrato del plan, despliega ai-api antes que Next.**
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

- La **generación de imagen con fal.ai está detenida por saldo agotado** de la cuenta. La calibración visual de creatividad (niveles 0–5 con semilla fija) queda pendiente de recargar saldo.
- Los niveles de creatividad y las bandas de conteo de globos son supuestos de diseño, no están calibrados con montajes reales.
- El análisis de fotos con Gemini no es totalmente estable entre corridas; «Reintentar» fuerza un análisis nuevo.
- El rol de solo lectura para `CATALOG_DATABASE_URL` no está provisionado; hoy usa la misma URL que `DATABASE_URL`.
