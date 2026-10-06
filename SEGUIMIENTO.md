# SEGUIMIENTO · demo-decoracion (FLUX base, sin LoRA)

Documento único del proyecto (2026-10-06). Sustituye a todos los `.md` anteriores, que se movieron a
`C:\Users\davidt\Downloads\pictures-workspace\respaldo-md-2026-10-06\` (misma estructura de carpetas, para consulta).
Ahí también están `AGENTS.md` y `CLAUDE.md` (sus reglas esenciales están en §2; `next dev` puede volver a crear un
`AGENTS.md` con su bloque generado) y una copia del `SEGUIMIENTO.md` anterior del 2026-10-05
(`SEGUIMIENTO-anterior-copia-2026-10-05.md`; la versión posterior a esa fecha se sobrescribió por error y no se pudo recuperar).
La pauta del juez visual pasó de `juez/visual-prompt.md` a `juez/visual-prompt.txt` (mismo contenido).
Copia del código antes de quitar el LoRA: `C:\Users\davidt\Downloads\pictures-workspace\respaldo-antes-de-quitar-lora-2026-10-06\`
(`src`, `ai-api-app`, `scripts`, `package.json`). **El proyecto no tiene git**: todo borrado es irreversible salvo por esos respaldos.

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
productos no debe afectar en nada al comportamiento ni tomar ninguna decisión.

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
- `npx tsc --noEmit` = 0. **Pendiente de correr**: `eslint` de esos tres archivos y `scripts/test/test-lora-product-runtime.ts`
  (puede tener aserciones del comportamiento viejo en base que haya que actualizar).

### 3.2 Inventario de lo que queda (mapeado el 2026-10-06)
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
3. **Un solo modo**: quitar `training_*`, `unlimited`, `loraSelection`, `NEXT_PUBLIC_LORA_MODE`, el selector del cliente y
   `usarLora`/`loraMode` del contrato de `/api/generate` (siempre FLUX base); quitar la allowlist de dataset y `lora_variant_ids`
   (contrato, en el orden de §2). Quitar `ensureLoraTriggers`, triggers y los dialectos `scene_v004`/`product_v007` del compilador.
4. **Borrar** el código de entrenamiento/admin, `src/lib/lora/*` que ya no se importe, el vocabulario y sus datos, `scripts/lora/*`,
   las pruebas `test-lora-*` de dialectos entrenados y sus entradas en `package.json`. Mover `vocabulario-base.ts` y
   `descriptor-perceptual.ts` a `src/lib/ia/kagutsuchi/` (o `src/lib/flux/`).
5. **Renombrar** `sempertex-lora.ts` → `flux.ts`, `lora-caption-compiler.ts` → `caption-flux.ts`, etc., y `fal-ai/flux-2/lora/edit` →
   `fal-ai/flux-2/edit` si fal lo admite con las mismas entradas (comprobar con 1 imagen y tope).
6. `data/staging` y tablas `lora_*`: solo con confirmación explícita del dueño.
Tras cada etapa: `tsc`, `eslint` de lo tocado, pruebas puntuales y 1-2 imágenes FLUX de control (001 y 002), juzgadas con Codex.

## 4. Misión de fidelidad foto → imagen (estado al 2026-10-06)

Objetivo: que la imagen final reproduzca la foto (composición, geometría, colores, tamaños, densidad, orientación). Hoy es «parecida».

### 4.1 Juez (fuera del repo: `informes-calidad/juez/juez.ts`)
- `--visual codex` (**juez de referencia**): `codex exec -m gpt-6-luna -c model_reasoning_effort=medium` («luna 6 medium»), foto e
  imagen en la misma llamada, pauta `juez/visual-prompt.txt` con reglas de techo (forma equivocada → ≤ 40) y, en la línea base, la
  descripción de `linea-base/verdad-visual.json`; salida forzada `juez/visual-esquema.json`. ~1 min por pareja, sin coste por llamada
  (sesión de ChatGPT; si dice «Not logged in», el dueño ejecuta `! codex login`).
- `--visual gemini`: mismo juez con `gemini-3.6-flash` (respaldo; más generoso). `--analisis si|no`: juez por análisis (tipo, lado,
  color ΔE, escala, topología); no pasa la validación, solo apoyo.
- Caché por sha256 en `juez/analisis/` y `juez/visual/`. Manifiestos `juez/manifiesto-*.json` (`{id, grupo, ref, img}`, rutas relativas a
  `juez/`). Ejemplo:
  `cd demo-decoracion && npx tsx --env-file=.env.local --conditions=react-server ../informes-calidad/juez/juez.ts --manifiesto ../informes-calidad/juez/manifiesto-X.json --analisis no --visual codex --n-visual 1 --salida ../informes-calidad/juez/resultados-X.json`
- Validación: Codex ganchos→columnas en 002: 20→42; 006 8→38; 007 2→12; falla en 005 (decoración diminuta). FLUX varía mucho entre
  imágenes del mismo plan (20 frente a 58 en el 002): medir con 2+ imágenes.

### 4.2 Herramientas de evaluación (fuera del repo, `informes-calidad/`)
- `validacion-fase4/trazar-plan.ts` (`--casos --corridas --max-usd --reserva --lecturas-reales --bp-dir --img-dir --salida`): plan real por
  el chat con lecturas del catálogo; el ledger acumula por carpeta → usar carpetas nuevas.
- `validacion-fase4/trazar-imagen.ts` (`--casos --corridas --modos flux --generar --max-imagenes --img-dir --salida`, y para
  experimentos `--guidance` / `--pasos`): imagen FLUX real con tope; se salta un caso si ya existe `imagen-flux/resumen.json`.
  Para N imágenes del mismo plan, copiar `plan-resuelto.json` y `blueprint.json` a `corrida-2..N`.
- `validacion-fase4/regenerar-blueprint-v18.ts --salida`: blueprint con el código actual desde las respuestas crudas guardadas (sin
  coste) — línea base 1-8. `validacion-fase7/analizar.ts --casos --max-llamadas --salida`: análisis real (1 llamada por foto) — fotos F7-1..5.
- Fotos: línea base `informes-calidad/linea-base/sin-etiquetas/case-00N-ref.png` (8); Fase 7 `informes-calidad/validacion-fase7/entradas/case-00N-ref.png` (5).
- Comparativas: `scratchpad/fila.cjs <salida.jpg> <img1> <img2>...` (tira horizontal con sharp del repo).
- Artifact del dueño: «Veredicto de fidelidad» https://claude.ai/artifact/8zZe8QVRLGhbUqNL7yUCZt (v2: antes/ahora por caso).

### 4.3 Cambios hechos hoy en el motor (todos en el repo)
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

### 4.4 Medidas (juez Gemini calibrado, 2 imágenes por caso; Codex entre paréntesis cuando lo hay)
001 42→83 · 002 40→57 (Codex 42; mejor imagen 58) · 004 38→27 (corregido después) · 005 36→76 · 006 33→32 · 007 20→25 · 008 57→48 ·
F7-1 57→69 · F7-2 82→90 · F7-3 25→20 (antes del racimo de pared) · F7-4 35→43 · F7-5 50→56 (Codex 30-35 tras escuadra y azul) ·
003 ahora genera (Codex 38/28). Media 43→52.

### 4.5 Pendiente de fidelidad (en orden)
1. **Ancho/alto de las piezas laterales**: el chat inventa medidas (F7-5 ocupa el 83 % del ancho de la foto y el chat pide 1,2 m; el 002 a
   veces 1,8 m de alto cuando llega al techo; 003 cruza demasiado por arriba). Propiedad huérfana: proporción de la caja de la foto.
2. **Tonos en el texto de FLUX**: «satin pearlescent pink» sale coral; «pastel matte nude» sale rosa melocotón; plata cromada sale oscura.
3. **Grosor de la columna orgánica** (siempre 1,1 m de base; debería salir de la proporción de la caja).
4. **Tamaños del racimo de pared** (el chat compra una sola talla; la lectura por tamaños no llega al kit).
5. **Cobertura de colores del chat** (004 sin blanco; acabado: respetar el que vio el analizador por color).
6. 007 (pared pastel con monstruos), 008 (pared con cintas leída como techo), 006 (cobre que no está en la foto).

## 5. Decisiones del dueño
- Tomadas: FLUX base sin LoRA (eliminar el LoRA); racimo de pared sí; juez Codex luna 6 medium; pruebas grandes en pausa.
- Pendientes: taxonomía 12 o 18 clases (las 5 que AGENTS.md daba por retiradas: `arco_no_denso`, `columna_no_densa`, `pared_densa`,
  `pared_no_densa`, `semiarco` simple; el código aún las asigna y cotiza); borrar `data/staging` y tablas `lora_*`; cobro del remate de
  columna clásica (Hito 16 antiguo: +1 globo R-24 por columna).

## 6. Gasto (estimado, no factura)
Misión hasta el 2026-10-06 por la mañana ≈ US$8,0; esta sesión ≈ US$10 más (planes, ~110 imágenes FLUX a ≈US$0,05, juez Gemini).
Codex: sin coste por llamada.
