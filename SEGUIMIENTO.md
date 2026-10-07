# SEGUIMIENTO · demo-decoracion (FLUX base, sin LoRA)

Documento único del proyecto (2026-10-06). Sustituye a todos los `.md` anteriores, que se movieron a
`C:\Users\davidt\Downloads\pictures-workspace\respaldo-md-2026-10-06\` (misma estructura de carpetas, para consulta).
Ahí también están `AGENTS.md` y `CLAUDE.md` (sus reglas esenciales están en §2; `next dev` puede volver a crear un
`AGENTS.md` con su bloque generado) y una copia del `SEGUIMIENTO.md` anterior del 2026-10-05
(`SEGUIMIENTO-anterior-copia-2026-10-05.md`; la versión completa anterior está en git: `git show b49c069:SEGUIMIENTO.md`).
La pauta del juez visual pasó de `juez/visual-prompt.md` a `juez/visual-prompt.txt` (mismo contenido).
Copia del código antes de quitar el LoRA: `C:\Users\davidt\Downloads\pictures-workspace\respaldo-antes-de-quitar-lora-2026-10-06\`
(`src`, `ai-api-app`, `scripts`, `package.json`). El proyecto **sí es un repositorio git** (`origin` = `https://github.com/dav033/pictures.git`,
rama de trabajo `fix/color-organico-conteo`, subida el 2026-10-06 en el commit `19af97e`): cualquier archivo borrado o sobrescrito se
recupera del historial (`git show b49c069:SEGUIMIENTO.md` es el seguimiento anterior completo). Las herramientas de evaluación (juez,
trazadores, diagnósticos) están en el repositorio, en `evaluacion/` (§7); las fotos y los resultados siguen fuera, en
`../informes-calidad/` (carpeta de datos, sin git).

---

## ⏯ ESTADO PARA RETOMAR (2026-10-06 ~21:30, antes del /compact)

**Tras el compact (2026-10-06 ~21:45):** registro-2 verificado y en `main` = `350ae58` (tsc en copia limpia, test-registro 15/15,
guardia estricta OK, opciones-catálogo, contrato guiado, pytest test_registro 10/10). La fusión de las 11 fotos YA NO está
cancelada: el dueño pidió hacerla; corre sola en `wf_c88656d7-a4a` al terminar los curadores. Diseño del encargo del plan (solo
lectura, 2 agentes: UI 1-3 y piezas individuales 4) en `wf_1f7c07dd-24c`; la implementación se lanza al terminar «Ajustar mi plan»
(`wf_7d93867a-63d`) y la fusión, para no pisar archivos. VPS sigue en `e447cfe`: avisar al dueño antes de desplegar.


**Reglas nuevas del dueño (hoy):**
- **Subir todo a `main` en cada hito verificado** (tsc en una copia limpia del commit + pruebas puntuales) y desplegar. `main` despliega
  Vercel solo. El VPS se despliega a mano (`git archive --format=tar.gz HEAD | ssh advin-vps "SSH_ORIGINAL_COMMAND=<sha>
  /usr/local/sbin/gh-deploy-vps pictures"`) PERO reinicia también el Python que usa Vercel (1-2 min caído): no desplegar el VPS
  mientras el dueño prueba; avisar antes.
- **Subagentes de Claude** (ya no Codex) con workflows; ultracode activo. UI/UX agresiva: el usuario siempre sabe qué hacer.
- **Registro/auditoría**: ninguna decisión de IA sin registrar; un archivo por conversación (`DATA_DIR/registros/conversaciones/
  <fecha>/<id>.jsonl`). Depurar con `npm run registros -- [conversaciones] --origen local|vps|python-vps|vercel [--desde 30m]
  [--nivel warn] [--conversacion <id>]` antes de adivinar. Logging determinista: no gasta tokens.
- **Biblioteca**: solo decoraciones reales visibles; solo se ofrecen temáticas con ≥1 decoración (`tematicasDisponibles`,
  `sanearOpcionesCatalogo`); temática del catálogo elegida → sus decoraciones aunque sean de otro evento.
- Limpieza de RAM cada 3 latidos (`scratchpad/limpiar-ram.ps1`, contador `scratchpad/latidos.txt`); progreso de workflows con
  `python scratchpad/progreso.py <wf_id…>` (scratchpad = `C:\Users\davidt\AppData\Local\Temp\claude\C--Users-davidt-Downloads-
  pictures-workspace\46a78670-2b14-4fff-9d3c-699a35e6bcb9\scratchpad`). Contraseña de producción: variable `APP_PASSWORD`.

**Producción:** `main` = `6d7db03` (Vercel lo sirve). **VPS atrasado en `e447cfe`**: le faltan e3405ff (filtro «transparente»),
9ae53a6 (pulido), d96a426 + 2d5d072 (lectura de foto hasta 100 s), 6d7db03 (temáticas del catálogo) y lo que salga de los agentes.

**Arreglos de esta noche (todos en `main`):** rescate de la guiada (0a8d945, e447cfe), registro núcleo (6fa7964), solo ideas reales
y opciones filtradas (8c2c07e, 39a2112), plan con «transparente» (e3405ff: el acabado de una paleta multicolor filtraba TODAS las
búsquedas → nunca salía plateado; «plata/oro» ≡ «plateado/dorado»; registro de rechazos de `confirmar_plan_decoracion` y de cada
búsqueda), pulido (9ae53a6), lectura de foto (12 s → 100 s: en producción va por el Python del VPS y tarda ~30 s; local 12-27 s),
temáticas del catálogo (6d7db03).

**Agentes en curso al compactar (comprobar con `progreso.py`; sus cambios están SIN commit en el árbol):**
1. `wf_b3ef7f41-7a7` → agente `registro-2`: conecta los envoltorios de auditoría a todos los clientes de IA, 27 rutas, id de
   conversación en ambas vistas, Python con request/conversación en JSON (toca muchos `src/app/api/**`, `src/lib/gemini.ts`,
   `python-adapter`, `services/ai-api/**`, `Dockerfile`). Al terminar: tsc, `test-registro`, `test-guardia-proveedores-ia --estricto`,
   prueba con `npm run registros -- conversaciones --origen local`; commit y despliegue (VPS avisando).
2. `wf_7d93867a-63d` → «Ajustar mi plan» (panel simplificado en «Tu plan»: protagonismo de colores, tamaño de pieza, quitar pieza;
   reutiliza la edición de la clásica) + verificador en navegador. Al terminar: revisar informe, commit selectivo.
3. `wf_c88656d7-a4a` → 11 fotos nuevas de Sempertex (`C:\Users\davidt\Downloads\hola-2\sempertex-01..11`): 3 curadores (A 01-04,
   B 05-08, C 09-11) dejan entradas en `data/biblioteca-real/nuevas/*.json`, análisis en `data/biblioteca-real/analisis/nueva-*.json`
   y fotos en `public/biblioteca-sempertex/referencias/`. **La fusión quedó CANCELADA por el dueño (se hace después del compact):**
   revisar cada entrada contra su foto, ampliar el esquema si hace falta (esculturas, «estimado a partir de la foto»), fusionar en
   `decoraciones.json`, temáticas nuevas (San Valentín, Halloween, Día de la Madre, Navidad, fútbol, flores), pruebas
   (`test-biblioteca-sempertex`, `test-busqueda-biblioteca-sempertex`, calidad), tsc. El prompt completo de la fusión está en el script
   del workflow (`…\workflows\scripts\biblioteca-sempertex-nuevas-wf_c88656d7-a4a.js`).

**EN PAUSA por el dueño (encargo del plan, hacer después):**
1. «Ver detalle» de «Tu plan»: tabla compacta por pieza (filas = colores, columnas = tamaños 5"/9"/12"/18"/24", totales); hoy repite
   la lista dos veces («ridiculez»).
2. Tarjeta de idea del catálogo con detalle amplio como «Tu plan» (pieza, dibujo, medidas, mezcla de tamaños, globos por color,
   total, tabla): datos precomputados de `data/biblioteca-real/analisis/*.plan.json` al construir la biblioteca (sin Python en caliente).
3. «Agregar al plan»: botón en la idea elegida que suma sus estructuras al plan del cliente (o lo crea), resuelto con Python.
4. Piezas individuales: nunca «2 columnas» como una pieza con repeticiones; «Columna izquierda/derecha» (1, 2, 3…) para poder
   modificar o borrar una en concreto.

**Al hacer commits con agentes trabajando**: subir solo lo propio (`git show HEAD:archivo > tmp`, editar, `git hash-object -w`,
`git update-index --cacheinfo`) o `git add` de archivos concretos; verificar el commit en la copia limpia
`C:\Users\davidt\Downloads\e3-verif` (`git checkout --detach <sha>` + `npx tsc --noEmit`).

---

## 0. Cómo trabajar (preferencias del dueño)

- Todo en **español**. Autonomía total: no preguntar si empezar o continuar. Si hay un bloqueo de verdad, deliberar con 3 subagentes
  antagónicos. Preguntar solo decisiones que son del dueño (taxonomía, gasto alto, borrar cosas irreversibles, promover un prompt).
- El dueño pregunta a menudo «¿qué estás haciendo? ¿avanzamos?»: dar estado corto, concreto, con cifras del juez.
- **Pruebas grandes PAUSADAS** hasta nuevo aviso: no correr la batería de pytest completa (~9 000 pruebas) ni `plan:test` entero
  («estamos perdiendo mucho tiempo con eso»). Sí: pruebas unitarias puntuales del módulo tocado (segundos), `tsc`, `eslint` del archivo,
  `ruff`/`mypy` del archivo. Decir siempre qué quedó sin verificar.
- No lanzar nada pesado mientras el dueño prueba el frontend (la batería de pytest saturó el servicio Python y le rompió el chat).
- Equipo con poca RAM (15,7 GB). Medir antes de corridas pesadas. No matar procesos ajenos sin permiso.
- Toda corrida pagada declara su tope. Gemini-imagen nunca es evidencia; la imagen final es **fal.ai FLUX base**.
- Nunca imprimir valores de `.env*`. No meter imágenes, rutas absolutas ni datos de clientes en el repo.
- El estándar de calidad del dueño son las **fotos** de CASE-001 (columna dorada) y CASE-002 (dos columnas orgánicas inclinadas). No
  elogiar un resultado sin compararlo pieza a pieza con la foto (se elogió el 002 cuando era «una falla»).

## 1. Qué es el producto

App Next.js (`src/`) + servicio FastAPI (`services/ai-api/app`). El cliente sube una foto de referencia de una decoración con globos;
el sistema la analiza, arma un plan con productos Sempertex reales cotizados y genera una imagen de cómo quedaría.

Flujo:
1. **Análisis** (`/api/references/analyze`): Gemini (variante de prompt `VARIANTE_RUTA_ANALISIS` = `v18-candidato`, una sola lectura
   con «lecturas») → blueprint (`reference-blueprint.ts`). Pasos deterministas detrás: `leerLecturaUnica` (valida en Python,
   `reclasificarColumnasConGuirnalda`, `reubicarGuirnaldas`), `conColoresDesdeElPie`, `medirColoresSempertex` + `conReferenciasMedidas`,
   `unificarPiezasEspejo`. Dominancia de color (`enriquecerConDominancia`) y proporción (`conProporcionDeFotos`) dentro de
   `analizarReferenciasV2`.
2. **Plan** (chat Omoikane + `services/ai-api/app/plan.py`): el chat elige estructuras oficiales y productos; Python cuenta, mide y cotiza.
3. **Guía de escena** (`src/lib/ia/kagutsuchi/guia-escena.ts`, `preparar-guia-escena.ts`, Python `guia_escena.py`, `dibujo_estructura.py`,
   `guia_piezas/*`): un mapa plano de discos de colores con la forma de cada pieza.
4. **Imagen** (`/api/generate`): caption + guía → fal.ai `fal-ai/flux-2/lora/edit` con `"loras": []` (es FLUX base; el endpoint y los nombres
   dicen «lora» por historia). Cliente: `usarLora: true, loraMode: "base"`.

Arranque local:
```
python scripts/ops/supervisar-ai-api.py          # Python en :8000, reinicia al cambiar un .py (en Windows, obligatorio en vez de --reload)
PORT=3010 npm run dev                              # frontend en http://localhost:3010
```
fal necesita `NODE_OPTIONS=--use-system-ca`.

## 2. Reglas de ingeniería esenciales (antes en AGENTS.md)

- `services/ai-api/app/plan.py` es el **único dueño** del conteo, medidas, materiales y cotización. TypeScript no recalcula.
- Contratos en una sola dirección: Zod (`src/lib/ia/contracts/domain-v1.ts`, `src/lib/plan/*`) → `npm run contracts:export:domain` y
  `npm run contracts:export` → `uv run --directory services/ai-api python scripts/generate_models.py`. Nunca al revés.
- Lo que va dentro de `estructuras`/`compras` cambia `plan_hash`.
- Vectores dorados `contracts/domain/v1/golden/plan-resolution/*.json`: `expected` es oráculo congelado (se edita a mano y con motivo);
  `expected_python` se regenera con `REGRESION_ACTUALIZAR=1 pytest tests/test_plan_regresion.py`.
- Validar datos externos en runtime; no `any`, no `@ts-ignore`; no tragar excepciones; fallbacks intencionados y observables.
- Escenografía (lo que no son globos en la foto) solo entra en el prompt de imagen; nunca en cotización ni `plan_hash`.
- El prompt de análisis de producción no se cambia sin evaluación; promover una variante es decisión del dueño.
- Verificación completa (cuando se reactive): `npx tsc --noEmit && npm run -s lint && npm run plan:test`;
  `uv run --directory services/ai-api pytest -q`; `uv run --directory services/ai-api ruff check app tests && mypy app`.
- `package.json` está en CRLF: editar con herramientas que lo respeten.

## 3. PRIORIDAD ACTUAL: eliminar el LoRA de la faz del proyecto

Decisión del dueño (2026-10-06): **no hay LoRA ni entrenamiento, solo FLUX base**. Quitar toda referencia al LoRA; el vocabulario de
productos no debe afectar en nada al comportamiento ni tomar ninguna decisión. Precisión del dueño (2026-10-06, tarde): «hay que quitar
lora pero dejar la generación por flux; **Gemini no debe tener ningún camino para generar imágenes**». Eso incluye la generación Gemini
pura de `/api/generate`, la composición FLUX→Gemini sobre la foto del espacio (`usarComposicionLoraGemini`) y cualquier edición o
generador de imagen con Gemini en TS o Python. Gemini se queda solo para analizar fotos y para el chat.

### 3.1 Hecho (2026-10-06, sin pruebas ejecutadas salvo `tsc`)
- `src/lib/ia/kagutsuchi/lora-product-runtime.ts`: en dialecto `base` el vocabulario no se consulta; cada producto se describe desde
  el catálogo (`baseEntryFromCatalog` + `conColorDelCatalogo`); uno indescriptible se omite con diagnóstico, nunca bloquea ni arrastra a la
  pieza; `compileProductPrompt` no exige vocabulario activo en base.
- `src/app/api/generate/route.ts`: `vocabularioDelModo` (vacío en base) en todas las llamadas que pasaban `PRODUCT_VOCABULARY`
  (compilador y chequeos de fuga de nombres); el `throw LORA_PRODUCT_VOCABULARY_FAILED` ya no aplica en base; sin `loraMode` ni
  `loraSelection` con `usarLora` → modo `base` por defecto (antes `LORA_MODE_REQUIRED`).
- `src/lib/lora/mode-resolver.ts`: `resolveLoraMode` sale en `base` antes de tocar la base de datos.
- `src/lib/lora/product-vocabulary-data.ts`: se añadió antes el concepto `pastel_matte.nude` (B2B-20019949/51/54/56). Con el vocabulario
  fuera del camino base ya no hace falta; se irá con el vocabulario.
- `npx tsc --noEmit` = 0; `eslint` limpio; `test-lora-product-runtime` 55/55. `test-lora-vocabulario-base` se adaptó a la etapa 1
  (la barrida da títulos de catálogo; un producto descrito desde el catálogo ya no es `legacy`).
- **Etapa 2 hecha** (2026-10-06): `src/lib/ia/kagutsuchi/texto-base.ts` (`limpiarTextoBase`, `palabrasSoloLora`): el compilador quita
  del texto base Reflex/Fashion/Silk, Crystal/Pastel delante de un título, ®/™, `eventdecor_*` y Link-O-Loon→«linking», y lo deja en
  `palabrasQuitadas` + diagnóstico del runtime; el preflight usa la misma lista como invariante. Errores renombrados:
  `FLUX_PREFLIGHT_FAILED`, `FLUX_PLAN_REQUIRED`, `FLUX_LANGUAGE_FAILED`, `FLUX_EDIT_PREFLIGHT_FAILED` (traductor de errores y pruebas al
  día). Prueba nueva `test-texto-base.ts` (`ia:test-texto-base`, en `plan:test`). Verificado: tsc, eslint, texto-base, ui-error-contract,
  jerga, product-runtime, vocabulario-base, caption-compiler, preflight-barrido (5 760 escenas), caption-bilateral. Sin imagen de control
  todavía (se hará al cerrar la etapa 3, que toca más el camino).

- **Arreglo 2026-10-06 (dueño, `FLUX_PREFLIGHT_FAILED: longitud 1152 supera límite 1000`)**: el límite base de 1000 contaba también
  la nota fija de la guía de escena (~620): al caption le quedaban ~380, dos piezas no cabían, la guía se caía y el caption sin guía
  (con las frases de forma de Python, que no se compactan) medía 1152. Ahora, con guía de escena, el límite es 1000 + la nota
  (`limiteConGuiaEscena` en `route.ts`); el tope duro de fal sigue en 2500. Pendiente: sin guía, el caption con frases de Python aún
  puede pasar de 1000 (probar a quitar esas frases antes de fallar). Verificado: tsc, eslint, `test-guia-escena`.

- **Etapa 3, superficies B+D integradas (2026-10-06, merge `4d96ab7`, rama `etapa3-d`)**: `/api/generate` genera SIEMPRE con FLUX base
  (`loras: []`; `/edit` cuando hay imagen de entrada, texto→imagen sin ella, porque fal exige `image_urls` en `/edit`); cualquier
  `proveedor` de imagen o campo retirado (`usarLora`, `loraMode`, `loraSelection`) → `IMAGEN_SOLO_FLUX`; revisión: el resultado previo
  va como @image1 y la foto del espacio como @image2; el texto de revisión pasa por `limpiarTextoBase`, se traduce al inglés con
  Gemini de TEXTO (`revision-flux.ts`, falla cerrado) y el preflight mira el prompt final. Quitados: generación Gemini pura,
  composición FLUX→Gemini, `REFERENCIA_EN_ETAPA1_V1`, adaptadores `uzume/imagen*.ts`, `GEMINI_IMAGE_MODEL`, endpoint Python
  `/image-generate`, generación del laboratorio (responde 410), selector LoRA del cliente, acción `generar_estilo_estandar`. Revisión
  adversarial previa (3 fallos confirmados, corregidos). Verificado tras el merge: tsc, eslint, edit-referencias, flux-revision,
  ui-error-contract, guia-escena, texto-base, product-runtime; `/api/generate` responde. Sin imagen de control todavía.

- **Etapa 3, superficie C integrada (2026-10-06, merge `1809196`, rama `etapa3-c`)**: sin `lora_variant_ids` ni allowlist de dataset en
  contratos, Python (`plan.py`, `catalog.py`, `recommendations.py`), adaptador, chat, edición y `/api/generate`; sin cambio de
  comportamiento (en base ya era null). Revisión adversarial: 2 bloqueantes corregidos (SQL de `fetch_plan_rows` con un placeholder de
  más → ningún plan se habría resuelto; esquema de vectores dorados). Vector 05 `expected` actualizado a mano (catálogo completo,
  V-RED-12-UNSEEN, 5000 COP). Verificado tras el merge: tsc, eslint, `contracts:export:domain --check` (36), invariantes-plan (32
  vectores), ui-error-contract, python-adapter, catalog-allowlist, flux-revision, pytest regresión allowlist + placeholders (5).

- **Etapa 4 hecha (2026-10-06, rama `etapa4-borrado`)**: se retiraron las rutas, componentes y página de administración LoRA; el registro, modos entrenados, datasets, artefactos y vocabularios de producto; scripts LoRA y utilidades de selección/curación/descarga/empaquetado del dataset de entrenamiento con sus entradas de `package.json` y pruebas. El diff total elimina unas 25,6 mil líneas, principalmente datos de vocabulario y código de administración. `vocabulario-base.ts` y `descriptor-perceptual.ts` se movieron a `src/lib/ia/kagutsuchi/`. Se limpiaron contratos y configuración; `package.json` conserva CRLF. Permanecen las piezas FLUX base para etapa 5 (incluidos los seis archivos Kagutsuchi), el adaptador Python opcional `app/kagutsuchi/lora.py`/`LORA_GENERATION_PYTHON_ENABLED` porque sirve ese transporte base, la lectura de snapshots para compatibilidad y tablas/migraciones de base de datos para etapa 6. No se tocaron `data/staging/` ni las migraciones. Verificado secuencialmente: `npx tsc --noEmit` OK; `npm run -s lint` OK (19 avisos preexistentes); export domain con `--check` OK (36 schemas); pruebas puntuales base de runtime, texto, UI error, guía de escena, edición y FLUX revisión OK; pytest del modelo generado 3/3 y Ruff OK. Sin llamadas pagadas ni imágenes.

- **Etapa 5 hecha (2026-10-06, rama `etapa5-renombrar`)**: `sempertex-lora.ts` → `flux.ts`, compilador → `caption-flux.ts`, runtime → `producto-flux.ts`, preflight → `preflight-flux.ts`, semilla → `semilla-flux.ts`; `lora-semantics.ts` → `scene-semantics.ts`; renombradas pruebas base, adaptador `services/ai-api/app/kagutsuchi/flux.py` y utilitario de captura. `lora-prompt-format.ts` ya no existía en este worktree. Identificadores y diagnósticos internos del camino base usan FLUX. La bandera nueva `FLUX_GENERATION_PYTHON_ENABLED` aún lee la antigua `LORA_GENERATION_PYTHON_ENABLED` con aviso si aparece; se conservan el campo fal `loras` donde forma parte del contrato, y ruta/scope/esquema operacionales `/internal/v1/ia/lora-generate` (`lora-generate.v1`) como contrato estable. El campo antiguo de `/api/generate` `usarLora` sigue rechazado explícitamente.

  fal confirma que `/fal-ai/flux-2/edit` acepta las mismas entradas de edición (`prompt`, `image_urls`, tamaño, guidance, pasos, semilla y opciones de salida); su esquema no tiene `loras`. Endpoint cambiado en los transportes TS, Python y evaluación para el caso base; adaptadores no vacíos conservan compatibilidad. Control CASE-001: 1 solicitud, endpoint nuevo, sin clave `loras`, HTTP 200; salida en el almacén externo `validacion-fase4/etapa5-renombrar-case001`. Comparada visualmente con `estable-3x/caso-1/corrida-1`; tamaño/semilla difieren (1024×1536 / 790224384 frente a 1536×1024 / 481100950), así que comparación no aísla solo el endpoint. Gasto estimado ≈ US$0,04; tope US$0,10. Sin cambio de `plan_hash` ni vectores dorados.

  Verificado: `next typegen`; tsc OK; lint 0 errores (19 avisos preexistentes); `contracts:check` OK (9 chat, 36 domain); pruebas puntuales texto-base, runtime de producto, caption, preflight (1 920 escenas), guía, edición, revisión FLUX, UI-error, semilla, bandera Python y vista guiada OK; pytest Kagutsuchi/API 23/23 y Ruff OK. Snapshot de variantes de biblioteca se omitió en la prueba por falta de `DATABASE_URL`. `package.json` sigue CRLF y todos sus destinos de scripts existen. No se tocó `data/staging/` ni migraciones/tablas `lora_*`.

### 3.2 Inventario previo a la etapa 4 (mapeado el 2026-10-06; lo de «solo entrenamiento/administración» ya se borró, ver §3.1)
Bloqueos o rarezas que siguen corriendo en base:
- `src/lib/ia/kagutsuchi/lora-prompt-preflight.ts:273-277` rechaza prompts con `Reflex|Fashion|Silk|Crystal|Pastel`, ®/™ o `eventdecor_*`
  → `LORA_PREFLIGHT_FAILED` (`route.ts` ~1266). Mejor: quitar esas palabras al construir el texto (`vocabulario-base.ts`
  `PALABRAS_NO_COLOR`) en vez de fallar. El resto del preflight (cobertura, longitud 1000) valida contenido del plan: decidir si se
  convierte en avisos.
- `route.ts` `LORA_LANGUAGE_FAILED` (~1252) y `LORA_EDIT_PREFLIGHT_FAILED` (~1291, longitud 2500): no son LoRA; renombrar.
- `ensureLoraTriggers` (`sempertex-lora.ts:692`), `DEFAULT_SEMPERTEX_LORA_TRIGGER = "eventdecor_style_v3"` (`sempertex-lora.ts:19`,
  `route.ts` ~1205), `captionDialectForTrigger` y los dialectos `scene_v004` / `product_v007` en `lora-caption-compiler.ts` (1 800 líneas;
  ramas base en :1179, :1402, :1630, :1681, :1772), `lora-prompt-format.ts` (JSON solo para el trigger v2).
- Modos entrenados: `src/lib/lora/schema.ts:87-96` (`base`, `unlimited`, `training_1`, `training_2`, `loraSelection`), cliente
  `src/app/page.tsx:517,1272,1304-1307,1017`, `src/lib/estado/modo-vista-reglas.ts:37,53-57`, `.env.local.example:42` (`training_1`),
  `NEXT_PUBLIC_LORA_MODE`. Allowlist de dataset (`mode-resolver.ts`, `resolveLoraModeDatasetAllowlist`) y su uso en `route.ts:607-623`,
  `resolver-backend.ts:95`, `api/chat/route.ts:236-246`, `api/plan-editar/route.ts:127`; Python `lora_variant_ids`
  (`plan.py:328,552,604,4881`, `catalog.py:381,435,1389`, `recommendations.py:44-64`) → quitarlo es cambio de contrato (orden de §2).
- **No es LoRA y se queda**: `allowlist_product_mismatch` / `ALLOWLIST_PRODUCTO_VARIANTE` (emparejamiento comercial producto↔variante).
- Python opcional `LORA_GENERATION_PYTHON_ENABLED` → `services/ai-api/app/kagutsuchi/lora.py`.
- Contrato: `domain-v1.ts:40-41` importa `LoraSelectionSchema` y `productVocabularySchema`.

Tamaño:
- `src/lib/lora/*`: 23 archivos (~14,8 k líneas; datos `v007-dataset-product-vocabulary.ts` 7 233, `product-vocabulary-catalog-data.ts`
  2 086, `product-vocabulary-data.ts` 883). Aún importados por el camino base: `schema.ts` (18 usos), `mode-resolver.ts` (+
  `v007-catalog-allowlist.ts`, `dataset-catalog-link.ts`, `compatibility.ts`), `product-vocabulary*.ts` (13 usos), `vocabulario-base.ts`
  (**es del modo base**: palabras de color/acabado/estructura; conservar con otro nombre), `descriptor-perceptual.ts`
  (`scene-spec.ts:20`), `catalogo-no-disponible.ts` (`registro-herramientas.ts:46`).
- Solo entrenamiento/administración (se pueden borrar): `repository.ts`, `snapshot*.ts`, `dataset-*.ts`, `artifact-store*.ts`,
  `training-reference-counts.ts`, `eliminacion-dataset-v005.ts`, `composicion.ts`, `formato-prompt-cliente.ts`; `src/app/api/lora/*`
  (10 rutas), `src/components/lora/*` (5), `src/app/configuracion-lora/page.tsx`, partes LoRA de `src/app/admin/page.tsx`;
  `scripts/lora/*` (21), migración `scripts/migrations/016_lora_specializations.sql` y tablas `lora_mode_slots`,
  `lora_training_runs`, `lora_artifacts`.
- `src/lib/ia/kagutsuchi/*` (4 634 líneas): `sempertex-lora.ts`, `lora-caption-compiler.ts`, `lora-product-runtime.ts`,
  `lora-prompt-preflight.ts`, `lora-prompt-format.ts`, `lora-seed.ts` **son el camino FLUX base**: renombrar y recortar, no borrar.
- `data/staging/*` (~240 MB, todo material de entrenamiento: `lora-v007`, `recaption-v004/v005`, `sempertex-full-v001`, `structure-v001`,
  dos zip de fal). Borrar = irreversible: confirmar con el dueño o mover fuera.
- Pruebas: 13 `scripts/test/test-lora-*.ts` y 2 `*.test.ts` en `kagutsuchi`; varias en la cadena de `plan:test` (`ia:test-lora-compiler`,
  `-v004-compactacion`, `-bilateral`, `lora:test-product-runtime`, `-edit-referencias`, `-vocabulario-base`, `ia:test-lora-seed`,
  `ia:test-kagutsuchi-lora-python`, `plan:test-lora-centro-contado`, `lora:test-fal-sin-saldo`). `test-armado-bouquet-prompt.ts:224` y
  `test-armado-guirnalda-prompt.ts:296` comprueban los dialectos entrenados.

### 3.3 Plan por etapas
1. **Que el vocabulario no decida nada** (casi hecho, §3.1): correr `eslint` y `test-lora-product-runtime`; ajustar sus aserciones de base.
   Probar 1 imagen FLUX (tope 1) de CASE-003 y F7-5, que fallaban por el nude.
2. **Preflight**: en base, quitar del texto las palabras de línea comercial en vez de fallar; renombrar errores `LORA_*` → `FLUX_*`.
3. **Un solo modo y un solo generador**: quitar todo camino de imagen con Gemini (generación, composición sobre la foto del espacio,
   edición); quitar `training_*`, `unlimited`, `loraSelection`, `NEXT_PUBLIC_LORA_MODE`, el selector del cliente y
   `usarLora`/`loraMode` del contrato de `/api/generate` (siempre FLUX base); quitar la allowlist de dataset y `lora_variant_ids`
   (contrato, en el orden de §2). Quitar `ensureLoraTriggers`, triggers y los dialectos `scene_v004`/`product_v007` del compilador.
4. **[HECHA y fusionada, merge 99cf2dd]** **Borrar** el código de entrenamiento/admin, `src/lib/lora/*` que ya no se importe, el vocabulario y sus datos, `scripts/lora/*`,
   las pruebas `test-lora-*` de dialectos entrenados y sus entradas en `package.json`. Mover `vocabulario-base.ts` y
   `descriptor-perceptual.ts` a `src/lib/ia/kagutsuchi/` (o `src/lib/flux/`).
5. **[HECHA, rama `etapa5-renombrar`] Renombrar** el camino FLUX base y sus pruebas; `/flux-2/edit` confirmado en esquema fal y 1 control CASE-001 (tope US$0,10), ver §3.1.
6. `data/staging` y tablas `lora_*`: solo con confirmación explícita del dueño.
   Etapa 4 fusionada (2026-10-06 tarde, merge 99cf2dd; marca de vuelta atrás `antes-etapa4-medidas`): revisión adversarial sin
   bloqueantes (204 scripts de package.json válidos, camino FLUX, chat y vista guiada OK); se quitaron además un diagnóstico roto
   (`evaluacion/validacion-fase4/diag-coral.ts`) y las variables `LORA_ARTIFACT_ROOT`/`LORA_SNAPSHOT_*` sin lectores. Etapa 5 hecha; sigue etapa 6 con decisión del dueño.
Tras cada etapa: `tsc`, `eslint` de lo tocado, pruebas puntuales y 1-2 imágenes FLUX de control (001 y 002), juzgadas con Codex.

## 4. Misión de fidelidad foto → imagen (estado al 2026-10-06)

Objetivo: que la imagen final reproduzca la foto (composición, geometría, colores, tamaños, densidad, orientación). Hoy es «parecida».

### 4.1 Juez y herramientas
Todo está en `evaluacion/` y documentado en **§7**. Juez de referencia: Codex «luna 6 medium» (`--visual codex`).
Validación del juez: ganchos→columnas en 002: 20→42; 006 8→38; 007 2→12; falla en 005 (decoración diminuta). FLUX varía mucho
entre imágenes del mismo plan (20 frente a 58 en el 002): medir con 2+ imágenes.
Artifact del dueño: «Veredicto de fidelidad» https://claude.ai/artifact/8zZe8QVRLGhbUqNL7yUCZt (v2: antes/ahora por caso).

### 4.2 Cambios hechos hoy en el motor (todos en el repo)
- **Forma 002** (`reference-structure.ts` `reclasificarColumnasConGuirnalda`): solo `u_invertida`/`arco_caido` o una «curva» separada
  del suelo hacen semiarco a una columna; una curva que nace del suelo es columna inclinada (CASE-002 dejó de ser ganchos; 004 vuelve a semiarco).
- **Orden de color desde el pie** (`src/lib/ia/amaterasu/orden-color-pie.ts`, `conColoresDesdeElPie` en la ruta de análisis): por píxeles,
  franja de abajo frente a arriba, sin balance de blancos (con él el fondo blanco borra la señal).
- **Atrezo**: `nombreConSuColor` (madera pintada se nombra por su color); **lienzo con la forma de la foto** (`src/lib/ia/nucleo/aspecto.ts`
  `aspectoDeLaReferencia`; quitó los ramos inventados de la columna dorada: 42→83 en el juez Gemini).
- **Balance de blancos** (`src/lib/plan/balance-blancos.ts`): con lo que el analizador vio blanco, corrige el tinte antes de la dominancia y del
  cruce Sempertex. 002: 981 Reflex Plata y 609 Rosado pastel; F7-5: aparece 044 Fashion Azul Naval y el chat lo compra (color 4-5 → 7).
- **Estructura oficial nueva `racimo_pared`** (aprobada por el dueño; 18 oficiales): `estructuras-oficiales.ts`, contrato regenerado,
  plugin `services/ai-api/app/guia_piezas/racimo_pared.py`. F7-3 ya no sale como ramo de helio con cintas.
- **Medio arco en escuadra** (`armado_estructura.py` `_cruza_por_arriba`, `_corte_hasta_la_esquina`, `CURVA_EN_ESCUADRA`=3,4,
  `GROSOR_EN_ESCUADRA`=0,3): para la L de F7-5. Sin mejora medida (FLUX la cierra en U).
- Fuerza de guía de FLUX: 3,5 gana a 2,5 y 5,0 en 001, 002 y F7-5 → se mantiene. Conclusión: FLUX obedece la guía; la fidelidad se gana en el motor.
- Pruebas nuevas: `test-orden-color-pie.ts`, `test-balance-blancos.ts` (en `plan:test`), `test_semiarco_en_escuadra.py`,
  `test_guia_pieza_racimo_pared.py`; actualizadas `test-guirnalda-referencia.ts`, `test-escenografia-referencia.ts`,
  `test-reencuadre-guia.ts`, `test-estructuras-oficiales.ts` (18), `test-prompt-modo-plan.ts`, `test_dibujo_estructura.py`.

### 4.3 Medidas (juez Gemini calibrado, 2 imágenes por caso; Codex entre paréntesis cuando lo hay)
001 42→83 · 002 40→57 (Codex 42; mejor imagen 58) · 004 38→27 (corregido después) · 005 36→76 · 006 33→32 · 007 20→25 · 008 57→48 ·
F7-1 57→69 · F7-2 82→90 · F7-3 25→20 (antes del racimo de pared) · F7-4 35→43 · F7-5 50→56 (Codex 30-35 tras escuadra y azul) ·
003 ahora genera (Codex 38/28). Media 43→52.

### 4.4 Pendiente de fidelidad (en orden)
1. **Ancho/alto de las piezas laterales — FUSIONADO (2026-10-06 tarde, rama `fix/medidas-de-la-foto`, commits 83f1f14 + 4e0b8de)**.
   La escala sale de la medida del cliente, luego del semiarco u otra estructura estándar; nunca de la altura estándar de una columna
   ni de 2,2 m arbitrarios. Caja cortada por un borde: conserva la medida del motor y avisa. Sin proporción fiable de la foto: no
   ancla ni deriva. La medida explícita del cliente manda también en el armado. `pared_organica` entra en el cálculo (bouquet y
   racimo_pared no, son kits). Columna orgánica: grosor desde la caja. Dueño (foto 1200×1200) 1,35 × 0,72 m (a mano ≈1,36 × 0,73);
   CASE-002 1,8 m conservado (caja cortada arriba, $51.703); F7-5 2,2 m ($197.211). Dos revisiones adversariales (3 fallos
   corregidos; la segunda sin bloqueantes, cada prueba nueva falla sin el arreglo). pytest 14/14, pruebas TS, tsc, ruff.
   Pendiente: el chat aún puede inventar medidas en el texto (F7-5 1,2 m cuando ocupa el 83 % del ancho; 003 cruza por arriba).
2. **[FUSIONADO 2026-10-06 tarde, merge 21e6860; vuelta atrás: tag `antes-colores`]** **Colores de la foto del dueño 2026-10-06** (semiarco + columna orgánicos en rosa empolvado mate, crema, perla rosa claro y
   burbujas transparentes; foto en `Downloads/WhatsApp Image 2026-10-06 at 9.58.10 AM.jpeg`, datos en
   `informes-calidad/dueno-2026-10-06/`). Salió: «Fashion Chocolate 076» en la lista (no hay marrón); el plan compra «Rosado mate»
   (rosa bebé) en vez de Palo de Rosa 010; la columna lleva 83/127 (65 %) de «Oro rosa cromado» y FLUX pinta bolas cobre oscuro.
   Hipótesis: H1 la sombra del rosa (#7a443d) se cruza como color propio; H2 los tonos medios del rosa empolvado (#c6a29a, #b47f77)
   caen junto al Dorado Rosa y la dominancia le da casi la mitad; H3 «rosado» elige 609 (los brillos) y no 010, que se midió y nadie
   usa; H4 el «dorado rosa» de la foto es perla claro, no cromado. Rama `fix/sombra-no-es-color` (worktree `Downloads/e3e`):
   1.ª pasada (US$0,11) confirmó H1 (sombra/café 11,6 % en la columna) y H2 (#b47f77 → 968 Dorado Rosa; ahora 010) y que la caja del
   semiarco incluía el panel marfil del fondo; la dominancia mide dentro del croquis y solo en tonos nombrados. NO fusionada: la columna
   pasó a «rosado 100 %» (pierde el crema visible), el semiarco mide crema 69 %/rosado 23 % y 010 se mide pero no se compra (H3). En
   curso 2.ª pasada (tope US$0,10). Caso nuevo del dueño (2026-10-06 11:35, CASE-002 en vivo): el analizador nombró plateado, rosado y
   blanco (patrón «bloques»), pero el plan compró plateado 126, rosado 64, **gris 38** y transparente 26: el blanco bajo luz lila se
   midió gris y FLUX pinta el pie gris oscuro. Condición para fusionar colores: en ese caso deben salir blanco + plata + rosa y nada
   de gris. 3.ª pasada (2026-10-06 tarde, commits d872f57, merge 40f5393, b69cdab, US$0): solo las etiquetas del analizador
   autorizan tonos (los píxeles ordenan y pesan); blanco nombrado sigue blanco aunque la luz lo mida gris/lila; CASE-002 offline:
   plata + rosa + blanco, cero gris. Duda abierta: el blueprint archivado de CASE-002 nombra «matte light grey». En revisión
   adversarial: sin bloqueantes (F7-5 conserva 044; foto del dueño semiarco crema 69,1/rosado 23,4, columna rosado 55,7/crema 33,5, sin
   chocolate). Medios en corrección (Codex): transparencia en etiquetas compuestas («clear gold confetti»); confeti estampado conserva
   el color del globo opaco («gold confetti balloons»), y el color del relleno solo se descarta con indicio transparente; «matte light grey»
   archivado de CASE-002 habilita gris; bajos: crema sin referencia medida, constante huérfana. Pendiente de diseño: mostrar tonos
   no nombrados para que el cliente los confirme (no se compran solos).
   CASE-002 «horripilante» en la vista clásica (2026-10-06 13:35: bastones finos con franjas plata/rosa/blanco, lila perdido, 40
   blanco mate inventado): rama `fix/forma-organica-002` (e3i) ya mezcla colores con 5 bandas medidas y conserva tonos nombrados con
   presencia ≥3 % (lila); la forma sigue sin resolver y sin imagen juzgable (FLUX `fetch failed`); en curso con su propio ai-api en el
   puerto 8010 (tope US$0,40; gastado antes ≈US$0,35).
   Pendiente aparte: las burbujas transparentes grandes con globitos dentro no existen en el plan.
   Pendiente aparte: `test-guia-estructura.ts` ya falla en la rama principal (espera `#f2a7c3`, sale `#f8a3bc` en guirnalda-pared).
3. **Tonos en el texto de FLUX**: regla general aplicada en `vocabulario-base.ts`: descriptor toma claridad, croma y temperatura de `hexGlobo`; el runtime resuelve la referencia por título y acabado antes de compilar. Acabados quedan aparte del nombre comercial: rosa perlado pálido, nude beige claro/apagado, plata brillante espejo. Controles conservan Dorado 970, Azul Naval 044 y blanco. Pruebas TS puntuales y ESLint pasan. `tsc` sigue bloqueado por `LayoutProps` ausente en `src/app/layout.tsx`; `npx next typegen` terminó con código 1 y no creó `.next/types`. **Visual pendiente**: `../informes-calidad/` en este worktree contiene solo carpetas vacías; faltan referencias, imágenes históricas y planes de CASE-002/003, así que no se compararon ni generaron imágenes. Gasto FLUX: US$0,00 de US$0,30; reserva estimada US$0,15 para tres imágenes cuando se repongan los datos. Sin rutas antes/después aún.
4. **Forma de las columnas orgánicas de CASE-002** (dueño 2026-10-06: «la forma no coincide para nada, el original es más intrincado y
   complejo»): original del suelo al techo curvándose arriba sobre el arco, voluminoso (≈25-30 % del ancho), silueta irregular con
   racimos, muchas bolas de 18-24" entre relleno de 5" y burbujas transparentes con confeti; generada: tubo delgado (≈12 %), regular,
   2/3 del alto, dos franjas de color. La forma la dicta la guía (motor Python de discos) + las medidas. Encolado en rama
   `fix/forma-organica-002` (worktree `Downloads/e3i`) tras fusionar `fix/medidas-de-la-foto`; tope US$0,40, juez Codex.
5. **Grosor de la columna orgánica:** corregido en tercera pasada; `grosorPatasM` deriva de la proporción de su caja cuando no está cortada.
6. **Tamaños del racimo de pared — CORREGIDO (2026-10-06).** `plan.py` excluía `racimo_pared` del asignador de mezclas y después trataba el kit como una sola variante; la lectura `grandes_con_pocos_chicos` se perdía antes de comprar. El kit ahora conserva `unidades_declaradas` y desglosa/cotiza cada talla del mix leído. Regresión offline F7-3: 40 unidades en R-9/R-12/R-18/R-24.
7. **Cobertura de colores del chat — CORREGIDO (2026-10-06).** En CASE-004, ordenar por medición dejaba blanco tras el tope anterior de tres tonos; la paleta de referencia admite cinco (contrato permite ocho). Se conservan los cinco colores nombrados y el acabado que el analizador asignó a cada uno. Regresión offline con `verdad-visual.json` y los pesos guardados en `colores-medidos-kmeans.json`: blanco viaja a la referencia y mate/reflex no se contagian entre colores.
   También se corrigió `scripts/test/test-guia-estructura.ts`: la tinta correcta de Fashion Rosado 009 es `#f8a3bc`; `#f2a7c3` es solo la muestra genérica de la taxonomía. La prueba ahora usa el hex de catálogo y expectativas vigentes del caption, carta y coste seco.
8. 007 (pared pastel con monstruos), 008 (pared con cintas leída como techo), 006 (cobre que no está en la foto).

## 4.5 Vista nueva «Asistente guiado» (pedida por el dueño el 2026-10-06)

Fuente: `Downloads/CUSTOMER JOURNEY MAP.pptx` (perfiles profesional/emprendedor/principiante; pruebas del 5-oct; guion del focus
group). Vista conmutable desde la navbar, sin romper la clásica. Comportamiento de la IA: preguntar evento, edad y temática →
mostrar decoraciones Sempertex ya hechas de esa temática (¿te gusta? sí/no) → si sí: referencias y materiales, y 4 opciones
(contratar decorador HAPPIA/MBP de la zona, costear materiales, comprar en e-commerce o distribuidor cercano, aprender paso a paso al
estilo Balloon Pro) → si no: pedir foto de inspiración (con foto, el mismo flujo; sin foto, decoradores). Precio solo si el usuario lo
pide, tras preguntar negocio/personal (negocio: todo «Ajustar mi precio», costo editable; personal: solo materiales a precio
e-commerce y botón visible «Cotiza con un proveedor cerca de ti»). Sin fila de tarjetas de estructuras. Texto de inicio «Cuéntame qué
quieres hacer»; fotos de inicio de Sempertex. Decisiones del dueño: **en esta vista no se genera imagen**; la biblioteca de
decoraciones y los directorios se construyen con **ejemplos marcados** hasta que lleguen los datos reales.
Diseño (workflow `mapa-ui-vista-guiada`, 2026-10-06): ruta propia `/asistente` + API propia `/api/asistente-guiado` (contrato
`asistente-guiado-v1`, prompt y herramientas propias en `src/lib/ia/guiado/`: guardar_brief_guiado, buscar_decoraciones_sempertex,
ofrecer_opciones, preguntar_uso, costear_decoracion, pasos_decoracion, buscar_proveedores), biblioteca `src/lib/biblioteca-sempertex/`
(Zod, unión por `origen`, ejemplos `ej-` ocultos en producción), conmutador «Clásica / Guiada» con `<Link>` en `CabeceraApp`
(preferencia en localStorage `demo-decoracion:vista-app`), `page.tsx` sin cambios. El costeo lo cotiza Python (regla de §2), nunca TS.
Reutiliza `TarjetaCotizacion` (personal) y `CotizacionProfesional` (negocio). En curso: rama `feat/asistente-guiado`
(worktree `Downloads/e3g`, Codex). La prueba de un turno real con el LLM la hago yo al final. Python cotiza con la operación nueva
`plan.lista_materiales`. Dueño (2026-10-06): sí a enlazar 3-4 decoraciones de ejemplo a kits/variantes REALES (E-DECORS, Fiestas
prediseñadas) para que el costeo de la demo muestre precios; siguen marcadas «Ejemplo» (segunda pasada encolada).

**Integrada (2026-10-06, merge de `feat/asistente-guiado`)**: ruta `/asistente`, conmutador «Clásica / Guiada» en la navbar, API
`/api/asistente-guiado`, biblioteca con 3 decoraciones de ejemplo enlazadas a kits E-DECORS reales (Amor, Niño Bigotes, Colombia; fotos
de Shopify; variantes R-12 reales del snapshot publicado el 11-sep-2026; temática, edad, cantidades y pasos son de ejemplo), costeo por
`plan.lista_materiales` en Python (p. ej. «Cumpleaños entre estrellas»: 3 variantes ×50, $39.111 COP personal y negocio).
Revisión adversarial: 3 fallos confirmados corregidos (uso en el mismo POST, errores de herramienta devueltos al modelo, precio ligado
a la decoración elegida) + menores. Turno real con el LLM (2026-10-06, 2 llamadas Gemini): guardar_brief_guiado (cumpleaños, 6, estrellas) →
buscar_decoraciones_sempertex → 2 decoraciones; la primera respuesta citaba ids internos («ej-…»): regla 9 del prompt, verificado sin
ids. Pendiente: datos reales de decoraciones y proveedores, verificación visual del dueño.

**Rediseño de experiencia para la presentación del 2026-10-07 (prioridad absoluta del dueño)**: el asistente abre la conversación
(saludo fijo + «¿Qué vas a celebrar?» con botones; una pregunta por turno con línea «Opciones:» que la interfaz convierte en botones);
cada respuesta lleva sus piezas en orden (ideas, elección, 4 opciones con iconos, negocio/personal, precio, pasos, proveedores) y las
anteriores quedan como historia; desplazamiento automático; indicador de escritura; identidad del asistente; materiales en palabras
de cliente. El servidor costea y muestra pasos con la decoración y el uso elegidos en la interfaz (el modelo no ve ids y fallaba 3
veces antes de costear). Recorrido completo verificado en el navegador (cumpleaños → 4-6 años → princesas → elegir → costear →
personal → $39.111). Integrados (2026-10-06 tarde): biblioteca de 14 temáticas con kits y variantes reales y búsqueda honesta (exacta/cercana,
sello «Parecida»); fotos de los 5 kits servidas desde `public/biblioteca-sempertex/kits/` (800 px) y, cuando la foto no representa
la decoración, ilustración de globos en su paleta rotulada «Ilustración de colores»; precio por color sin jerga (p. ej. «Bienvenida
en azul»: Azul Rey $13.974 + Blanco $13.037 + impreso bebé $24.143 = $51.154 con IVA); «Comprar» al instante (globos con su foto
del catálogo, enlace al kit en sempertex.com sin el prefijo `b2b-`, distribuidor cercano); `darkreader-lock` (la extensión Dark
Reader del equipo del dueño repintaba la app). Recorrido en el navegador verificado: espacio (ilustración), baby shower niño →
elegir → comprar → costear personal. Hasta la presentación NO se fusionan en la principal las
ramas de motor sin revisión (forma `fix/forma-organica-002`; colores, medidas y etapa 4 ya fusionadas tras revisión adversarial)
sin revisión adversarial y prueba (el dueño pidió el 2026-10-06 seguir también con esas mejoras, no solo con el chat).
Tarde del 2026-10-06 (verificado en el navegador): tras «Aprender» salen las 4 opciones; el modelo no habla de «la pantalla»;
«Contratar decorador» pregunta la ciudad con botones (Bogotá/Medellín/Cali/Barranquilla) y muestra tarjetas de ejemplo (2 decoradores
HAPPIA/Master Balloon Pro + 1 distribuidor por ciudad, con especialidad y cobertura) con «Solicitar cotización» resuelto en la
conversación (sin enlaces a example.com); boda con el impreso real «Nuestra Boda Reflex Dorado» (antes uno de comunión); negocio:
«Ajustar mi precio» con 30 % → $61.832 + $18.550 = $80.382; celular (390 px): compositor fijo abajo (antes se desplazaba la página).
Más tarde: idea «Fiesta tropical» con el kit real Verano Tropical (variantes verificadas en el snapshot); sin coincidencia exacta,
la búsqueda no ofrece ideas de otro evento (un cumpleaños de 35 recibía un baby shower); fotos de kit completas sobre blanco;
miniatura de la foto de inspiración en el mensaje del cliente; «Ninguna me convence» + foto verificado (la IA ve la foto y propone
ideas «Parecida»). 2026-10-06 ~13:35 el sistema cortó por memoria los procesos en segundo plano; el servidor Next sobrevivió.
Después (2026-10-06 ~14:00, captura del dueño «divorcio de mis padres» → «carnaval»: la IA decía «esta propuesta» sin mostrar ninguna
tarjeta porque la búsqueda devolvía vacío): evento fuera del catálogo → ideas de fiesta general por edad y colores (nunca de otro
evento); carnaval/neón/festivo/colorido = multicolor; con una sola idea se completa hasta dos; sin ideas la herramienta lo dice y el
prompt prohíbe hablar de una propuesta; controles desactivados hasta hidratar (el primer clic tras recargar se perdía); en baby
shower no se pregunta la edad. En esta vista NO se genera imagen (decisión del dueño); posible botón «Ver cómo quedaría en mi
espacio» que lleve la idea a la vista clásica: pendiente de decisión del dueño (riesgo en vivo).

**Producción y rama local (2026-10-06 ~15:00-15:40).** `main` en GitHub = 83346fe (todo lo fusionado hasta tonos FLUX y forma
parcial de CASE-002 + arreglos de Vercel: `vercel-build` compila los paquetes del workspace, `output: standalone` solo fuera de
Vercel, preset Next.js en el proyecto, SQLite en /tmp en Vercel). Vercel producción `demo-decoracion.vercel.app` (con login) y VPS
(`gh-deploy-vps pictures`, lanzado a mano porque CI falla: ruff format y una prueba de texto FLUX; DEPLOY_OK 83346fe) alineados.
Dueño: «no subamos a main, intégralo a la raíz del código para ir probando» → la rama de trabajo local integra además: cobertura de
5 colores (los 3 primeros nombrados siempre; 4.º-5.º solo con presencia ≥3 % o sin medición), racimo de pared por tallas, etapa 5
(renombres FLUX; endpoint `fal-ai/flux-2/edit` sin LoRA), guía de escena sin 500 (schema Python regenerado: rechazaba `apariencia`
de transparentes/confeti; ahora las excepciones dejan traceback con request_id) y foto de referencia en la guiada (widget mínimo:
foto pequeña con contornos suaves, «Veo un arco en dorado, azul y rosa.», 3-5 puntos de color; reutiliza el análisis de la
clásica; no genera imagen). Pendiente: CI verde en `main` (ruff format, prueba «organic balloon arch», test-python-adapter que
aún espera LoRA) para que el despliegue al VPS vuelva a ser automático; subir a producción lo local solo cuando el dueño lo pida.

**Vista guiada, más tarde (2026-10-06 ~15:50).** Producción: (1) «No pude responder esta vez» = SQLite en el disco de solo lectura de
Vercel → base en /tmp (83346fe); (2) «no tenemos este tipo de decoración» para todo = la biblioteca ocultaba los ejemplos con
NODE_ENV=production → se muestran salvo `BIBLIOTECA_OCULTAR_EJEMPLOS=true` (ab09868; desplegado en Vercel y VPS). Batería
`scripts/test/bateria-guiada.ts` (20 guiones, paga LLM): antes, «cumple de niño, dinosaurios» → baby shower, graduación/divorcio
preguntaban edad y traían baby shower/XV por color, «fiesta de empresa» → infantiles, edad 0 descartaba adultos, «la pantalla»,
«opciones de abajo»; corregido en local (f35045b, c383530): 18/20 limpias y 2 con una sola pregunta correcta. Pedidos del dueño en
curso (Codex e3v): «Propónme algo» → propuesta de piezas → plan DENTRO de la guiada → imagen FLUX; «Aprender a hacerlo» = pasos del
plan; foto con piezas → plan de la foto (cuántos y cuáles globos) → flujo normal con imagen.

**Más tarde (2026-10-06 ~16:45), integrado en la rama local:** biblioteca real con las 20 fotos del dueño (`Downloads/hola`,
11 temáticas, análisis y planes congelados en `data/biblioteca-real/analisis/`, fotos ≤800 px en
`public/biblioteca-sempertex/referencias/`, licencia «referencia_web_sin_licencia»; segunda pasada en curso: elegía impresos
Infinity para colores lisos/metálicos y perdía colores); «Propónme algo» (propuesta → plan dentro de la guiada → imagen) y
«Aprender a hacerlo» con pasos del plan + plan desde la foto; colores vivos y hex del globo en el texto de FLUX (011 «vivid pink
(#E04B87)», 040 «vivid cyan blue (#01B2E8)»; sin hex en cromados); acentos cromados con poco peso en tallas ≤12" y «a few small
accent» (no dominan la imagen). Guías de armado por estructura investigadas en internet (14 estructuras, 64 fuentes; workflow
`guias-armado-globos`) → tercera pasada en curso: entrada por chat, pregunta «completa o individual», plan con la gráfica de armado
y guía aproximada con fuentes. Pendiente: 3 errores de `tsc` en `scripts/biblioteca/construir-biblioteca-real.ts` (los corrige la
segunda pasada de la biblioteca).

**Cierre de la tarde (2026-10-06 ~17:30).** Integrado y verificado en navegador: «Propónme algo» → «¿completa o individual?» → plan
de Python SIN paso de aceptar (en el turno de propuesta el modelo solo ve `proponer_composicion` + `guardar_brief_guiado`; la función
que pide el plan se cancelaba sola por el «cargando» del mismo turno → parámetro `desdeTurno`) → «Tu plan» (dibujo de armado por pieza,
medidas, mezcla de tamaños, globos por color, total, «Ver detalle») → «Aprender a hacerlo» con guía aproximada investigada + fuentes
plegadas + pasos del plan sin jerga. Biblioteca real corregida (globos lisos por acabado, todos los colores de la paleta). Dueño
(17:25): «manda absolutamente todo a main y mándalo en cada hito» → `main` = 040835a (Vercel) y VPS DEPLOY_OK 040835a. Dueño (17:15):
«el flujo del chat de guiada funciona brutalmente horrible» → workflow de subagentes Claude `rescate-vista-guiada` (4 auditorías: API
E2E de 10 recorridos, navegador escritorio/390 px, código, diseño UX+motion → síntesis → implementación servidor ∥ componentes
animados → VistaGuiada → verificación con una ronda de arreglo). Directiva: UI/UX agresiva (el usuario siempre sabe qué hacer),
implementar recomendaciones superficiales y fáciles, descartar las que meten reglas de negocio (p. ej. WhatsApp). Limpieza de RAM
autónoma cada 3 latidos (`scratchpad/limpiar-ram.ps1`: huérfanos propios; con <2 GB libres, apps pesadas ajenas al trabajo).

**Noche (2026-10-06 ~19:00-20:20), todo en `main` y VPS:**
- 0a8d945 rescate de la guiada (auditoría de 4 agentes → 12 defectos confirmados: «Ver cómo quedaría» tiraba la imagen pagada
  por exigir `approval_token`, plan a medida vía /api/chat lento y fallido, burbuja «Estoy preparando…» colgada, tokens de color
  inexistentes, autoscroll, «Reintentar» que repetía el texto, callejones sin salida, widgets viejos clicables, «Cambiar algo» sin
  plan, textos de demo) + componentes animados (motion, reduced-motion). e447cfe: la instrucción del plan ya no lleva evento ni
  temática (activaban filtros de ocasión → solo impresos de 12"), globos lisos, reintento si sale 1 tamaño o un impreso; plan de
  foto con todos sus colores. Verificación 2: 4/4 planes al primer intento, p50 14 s.
- 6fa7964 registro y auditoría por conversación (`src/lib/registro/`, `npm run registros -- [conversaciones] --origen
  local|vps|python-vps|vercel`, archivos en `DATA_DIR/registros/{general,conversaciones/<fecha>/<id>.jsonl}`). En el VPS se dio
  permiso de escritura a `nextjs` en `/app/data` y `/app/data/registros` (antes SQLite tampoco podía crear su journal).
- 8c2c07e + 39a2112 (dueño: «sigue mostrando las decoraciones de ejemplo… solo categorías soportadas»; «no quiero que ofrezca
  dorado y blanco cuando no tiene imágenes así»): `bibliotecaVisible()` = solo las 20 reales; `tematicasDisponibles()` en el
  estado del turno; `sanearOpcionesCatalogo()` filtra en servidor las «Opciones:» de estilo que no tengan decoración.
- En curso (workflow `pulido-y-registro-2`): precio personal por variante, sin «R-12», guías en «tú», no saltar al plan si el
  cliente relee; segunda pasada del registro (envoltorios en todos los clientes de IA, 27 rutas, id de conversación en ambas
  vistas, Python con request/conversación en JSON, guardia estricta). Contraseña de producción: variable `APP_PASSWORD`.

## 5. Decisiones del dueño
- Tomadas: FLUX base sin LoRA (eliminar el LoRA); Gemini sin ningún camino para generar imágenes (2026-10-06); racimo de pared sí; juez Codex luna 6 medium; pruebas grandes en pausa.
- Pendientes: taxonomía 12 o 18 clases (las 5 que AGENTS.md daba por retiradas: `arco_no_denso`, `columna_no_densa`, `pared_densa`,
  `pared_no_densa`, `semiarco` simple; el código aún las asigna y cotiza); borrar `data/staging` y tablas `lora_*`; cobro del remate de
  columna clásica (Hito 16 antiguo: +1 globo R-24 por columna).

## 6. Gasto (estimado, no factura)
Misión hasta el 2026-10-06 por la mañana ≈ US$8,0; esta sesión ≈ US$10 más (planes, ~110 imágenes FLUX a ≈US$0,05, juez Gemini).
Codex: sin coste por llamada.

## 7. Herramientas de evaluación (`evaluacion/`): usos

Código en el repositorio; **fotos y resultados fuera** (son de clientes o de terceros y pesan cientos de MB: regla de §0/§2).
`evaluacion/rutas.ts` calcula las dos raíces y ningún script lleva rutas absolutas:
- `REPO`: la raíz del repositorio.
- `DATOS`: la carpeta de datos. Por defecto `../informes-calidad` (hermana del repo); se cambia con la variable `EVAL_DATOS`.

Excluida de `tsc` (`tsconfig.json`) y de `eslint` (`eslint.config.mjs`): son scripts que se ejecutan con `tsx`, no código de la app.
Todos se lanzan **desde la raíz del repositorio**, con el servicio Python en marcha (`python scripts/ops/supervisar-ai-api.py`) cuando
tocan análisis, plan o guía, y con telemetría apagada:
```
OTEL_SDK_DISABLED=true npx tsx --env-file=.env.local --conditions=react-server evaluacion/<carpeta>/<script>.ts <opciones>
```
Para fal (imágenes FLUX) añadir `NODE_OPTIONS=--use-system-ca`. **Toda corrida pagada lleva tope** (`--max-usd`, `--max-imagenes`,
`--max-llamadas`, `--max-visual`). Coste orientativo: plan ≈ US$0,04-0,06 · imagen FLUX ≈ US$0,05 · análisis Gemini ≈ US$0,01 ·
juez Gemini ≈ US$0,01 por pareja · juez Codex sin coste por llamada.

### 7.1 Estructura de la carpeta de datos (`DATOS`, por defecto `../informes-calidad/`)
```
linea-base/sin-etiquetas/case-00N-ref.png    8 fotos de la línea base (sin rótulos de la app)
linea-base/resultados/crudos-*/              respuestas crudas de Gemini guardadas (las relee regenerar-blueprint-v18)
validacion-fase7/entradas/case-00N-ref.png   5 fotos de la Fase 7 (F7-1..F7-5)
validacion-fase7/blueprints*/                blueprints de esas fotos (salida de analizar.ts)
validacion-fase4/<carpeta>/caso-N/corrida-K/ planes y, dentro, imagen-flux/ (guía entrada-1.png, prompt.txt, final.png, resumen.json)
juez/analisis/, juez/visual/                 cachés del juez por sha256 (una imagen o pareja nunca se paga dos veces)
juez/resultados-*.json                       salidas del juez
```
En el repo, `evaluacion/juez/resultados-referencia/` guarda una copia de los resultados del 2026-10-06 (las cifras de §4.3).

### 7.2 El ciclo habitual: foto → plan → imagen → juez
1. **Blueprint** de la foto:
   - Línea base (casos 1-8), **sin coste**, con el código actual desde las respuestas guardadas:
     `evaluacion/validacion-fase4/regenerar-blueprint-v18.ts --casos 1,2,3,4,5,6,7,8 --corridas 1 --salida <DATOS>/validacion-fase4/blueprints-vN`
   - Fase 7 (F7-1..5), **1 llamada Gemini por foto**:
     `evaluacion/validacion-fase7/analizar.ts --casos 1,2,3,4,5 --max-llamadas 5 --salida <DATOS>/validacion-fase7/blueprints-vN`
2. **Plan** por el chat real (Gemini) + `plan.py`, con lecturas reales del catálogo:
   `evaluacion/validacion-fase4/trazar-plan.ts --casos 2,4 --corridas 1 --max-usd 0.3 --reserva 0.08 --lecturas-reales --bp-dir <blueprints> --salida <DATOS>/validacion-fase4/<carpeta-nueva>`
   (Fase 7: añadir `--img-dir <DATOS>/validacion-fase7/entradas`). `--preview` muestra entorno y precios sin gastar. El ledger de
   gasto se acumula **por carpeta**: usar una carpeta nueva por experimento o la corrida se salta por tope. Sin `--lecturas-reales`
   el catálogo responde vacío.
3. **Imagen FLUX** (fal, pagada):
   `NODE_OPTIONS=--use-system-ca ... evaluacion/validacion-fase4/trazar-imagen.ts --casos 2,4 --corridas 2 --modos flux --generar --max-imagenes 4 --salida <carpeta del paso 2>`
   - Sin `--generar` no llama a fal: captura el prompt y la guía (gratis) en `imagen-flux/`.
   - Se salta un caso si ya existe `imagen-flux/resumen.json`: para repetir, usar otra carpeta.
   - Para N imágenes del mismo plan: copiar `plan-resuelto.json` y `blueprint.json` de `corrida-1` a `corrida-2..N`.
   - Experimentos: `--guidance 2.5|5` y `--pasos N` reescriben solo esos campos de la petición a fal (lo demás igual).
4. **Juez**: escribir un manifiesto (JSON `[{ "id", "grupo", "ref", "img" }]` con rutas **relativas a `<DATOS>/juez/`**, p. ej.
   `"ref": "../linea-base/sin-etiquetas/case-002-ref.png"`, `"img": "../validacion-fase4/<carpeta>/caso-2/corrida-1/imagen-flux/final.png"`)
   en `evaluacion/juez/manifiestos/` y lanzar:
   `evaluacion/juez/juez.ts --manifiesto evaluacion/juez/manifiestos/manifiesto-X.json --analisis no --visual codex --n-visual 1 --salida <DATOS>/juez/resultados-X.json`
   - `--visual codex` (referencia): CLI local `codex exec -m gpt-6-luna -c model_reasoning_effort=medium`; ~1 min por pareja. Si
     dice «Not logged in», el dueño ejecuta `! codex login`. Cambiar modelo o esfuerzo: `--modelo-visual`, `--esfuerzo-visual`.
   - `--visual gemini` (respaldo, `gemini-3.6-flash`, más generoso), con `--max-visual` como tope. Un 503 de Gemini no se guarda en
     caché: basta relanzar.
   - `--analisis si` (por defecto): juez por análisis con el reconocedor real (`--n-ref 3`, `--max-llamadas`); solo apoyo.
   - Pauta `evaluacion/juez/visual-prompt.txt` (reglas de techo) y esquema `visual-esquema.json`; en la línea base añade la
     descripción de `evaluacion/linea-base/verdad-visual.json`. Cambiar la pauta invalida la caché (forma parte de la clave).
5. **Comparativas** para mirar o enseñar: `node evaluacion/herramientas/fila.cjs <salida.jpg> <img1> <img2> ...` (tira
   horizontal); `node evaluacion/herramientas/veredicto.cjs <carpeta>` (miniaturas y hojas de contactos de las 13 fotos y sus
   imágenes; dentro se elige de qué carpetas de corridas lee).

### 7.3 Otras herramientas
- `evaluacion/validacion-fase4/regresion-resolucion.py`: vuelve a resolver con el código actual las peticiones de plan capturadas y
  compara `plan_hash`, totales, unidades, colores y productos (sin coste; necesita el servicio Python).
- `evaluacion/validacion-fase4/estabilidad.py`, `digest.py`: resúmenes de varias corridas de plan.
- `evaluacion/validacion-fase4/diag-*.ts`: diagnósticos puntuales del catálogo y la escenografía (coral, vino/burdeos, SKU, globos por
  color); `depurar-hash.ts` y `depuracion-hash/*.py`: depuración del `plan_hash` TS/Python.
- `evaluacion/linea-base/correr-analisis-crudo.ts`: corre una variante del prompt de análisis sobre la suite y guarda las respuestas
  crudas (pagado: `--plan <variante>:<n> --max-usd`); `analizar_resultados.py` y `comparar_v18_v19.py` las puntúan contra la verdad.
- `evaluacion/linea-base/medir_hex_ref.py`, `medir_colores_ref.py`: midieron los hex de la verdad (`hex-medidos-verdad.json`,
  `colores-medidos-kmeans.json`); `recortar.py <carpeta images-judge>` y `rejilla.py <carpeta>`: preparación de las fotos.
- `evaluacion/linea-base/trazado/**`: trazadores de una etapa anterior (UI-1/UI-2), conservados como referencia; los vigentes son
  los de `validacion-fase4/`.
- Datos de referencia en el repo: `linea-base/verdad-visual.json` (piezas, tipo, lado e inclinación de las 8 fotos; elaborada a ojo,
  no por un experto), `hex-medidos-verdad.json`, `suite-*.json` (hashes de las fotos, sin las fotos), `validacion-fase7/mapa-casos.json`.
