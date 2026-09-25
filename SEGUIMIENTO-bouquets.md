# Seguimiento: reconocedor v16 y bouquets por partes

Documento de traspaso para continuar el trabajo con otro agente. Fecha: 2026-09-25.
Lee primero `AGENTS.md` (reglas del repo), luego ADR-0029 y ADR-0030 en
`docs/architecture/decisions/`.

## 1. Estado en una línea

Todo está en la rama **`feat/bouquets`**, que ya incluye v16 (merge `2dec759`) y la
segunda entrega de bouquets (§7). El PR [dav033/pictures#1](https://github.com/dav033/pictures/pull/1)
(`feat/reconocedor-v16`, solo v16) se cerró: lo reemplaza el PR
[dav033/pictures#2](https://github.com/dav033/pictures/pull/2) (`feat/bouquets` → `main`).

| Commit | Qué |
|---|---|
| `fa9f483` | Parte A: v16 en producción y análisis de la foto sin auditoría (ADR-0029) |
| `603d194` | Parte B: bouquets por partes y registro de estructuras por tipo (ADR-0030) |
| `2dec759` | Merge de `feat/reconocedor-v16` en `feat/bouquets` (sin conflictos) |

## 2. Qué se pidió

Llevar a los bouquets lo que ADR-0028 hizo para arcos y columnas (gráfica numerada,
hoja de armado, conteo, pesas, lectura desde la foto), con una arquitectura de
**submódulos por tipo de estructura dentro de Amaterasu** (la IA que analiza la foto
de referencia).

## 3. Decisiones tomadas (por el usuario, salvo que se indique)

1. **Cubrir los dos tipos de bouquet:** con base de aire y de helio (apilado y escalonado).
2. **Remates metalizados cotizables.** Hallazgo: ya existían en el catálogo (134
   `globo_metalizado` activos; 33 en la allowlist LoRA v007). No hizo falta agregarlos.
3. **Alcance de la parte gráfica:** hoja de armado, editor de estilos, detección en la
   foto y texto para la imagen. No hay material Sempertex propio de bouquets: se
   propusieron recetas desde fuentes públicas y quedan como supuestos (§8).
4. **Formato de gráfica aprobado:** numerada por niveles; en bouquets con número, el
   código de la leyenda cambia con el valor, el tamaño y el color, y la gráfica con la
   posición (centro, lados, arriba).
5. **Arquitectura:**
   - Submódulos en **Python** (`services/ai-api/app/amaterasu/estructuras/`).
   - **Amaterasu solo detecta.** Armado, conteo, pesas y recetas van al plan de Python
     (`app/armado_bouquet.py`), porque `AGENTS.md` hace de Python el único dueño de lo
     comercial.
   - Primera entrega **sin UI**, detrás de banderas apagadas.
   - Los tipos que ya vivían en Python se mudaron a sus submódulos.
6. **Promover v16 antes que los bouquets.** Con v13 solo 7 de 39 bouquets llegaban
   como bouquet.
   - Revisión humana de los 5 casos límite: **las 5 piezas son centros de mesa** (v16
     se equivoca en esos 5).
   - Control autorizado con tope US$1,50: 34 fotos, 33/34, gasto reportado **US$0,28**.
7. **Quitar la pasada de auditoría** del análisis de la foto de referencia.
   - Medido sin costo sobre salidas crudas guardadas: 113/122 sin auditoría frente a
     109/122 con ella. Cambió el tipo principal 3 veces para bien y 7 para mal; 4 de
     los errores eran los centros de mesa rechazados.
   - El análisis del **espacio** (`analizar-venue.ts`) conserva su auditoría: no se midió.
8. **Galería regenerada con v16.** El usuario aprobó los 3 cambios: ejemplo 07 →
   bouquet, 09 → columna, 10 → techo de globos.
9. **Ramas:** el usuario pidió juntar todo en `feat/bouquets`.

## 4. Qué se hizo

### Parte A — v16 sin auditoría (ADR-0029)

- `src/lib/ia/referencia/reference-structure.ts`: `VARIANTE_PRODUCCION = "v16"`,
  variante renombrada `v16-candidato` → `v16`. El texto de la regla no cambió ni un byte.
- `src/lib/ia/amaterasu/analizar-referencias-v2.ts`:
  - una sola pasada (inventario);
  - fuera `AUDIT_*`, `mergeCandidates` y `VERIFIER_MIN_CONFIDENCE`;
  - `metadata.passes = ["inventory"]`;
  - el hash del prompt ya no incluye la auditoría. Hashes nuevos: producción
    `e119092d…`, v13 `c2393842…`, fijados en `scripts/test/test-telemetria-analisis-referencias.ts`.
- Galería:
  - `analisis-ejemplos.json` guarda `variante` y solo se sirve si coincide con producción.
  - `scripts/ops/generar-analisis-ejemplos.ts` llama al análisis directo (sin login) y
    escribe en la ruta vigente; antes escribía en una ruta que ya no existía.
- Evaluación: el adaptador y la CLI usan `VARIANTE_PRODUCCION` por defecto.
- Corrida de control guardada en `eval/results/estructuras/control-v16-20260925/`.
  Las salidas crudas y las fotos están fuera del repo, en `C:\Users\davidt\Downloads\estructuras-eval-privado\`.
- Documentación: `AGENTS.md` (decisión permanente) y `SEGUIMIENTO.md` (pendiente cerrado).

### Parte B — bouquets por partes (ADR-0030)

- **Registro** `services/ai-api/app/amaterasu/estructuras/`:
  - `base.py` define `DefinicionEstructura(clave, inicio_de_pieza)`.
  - Un archivo por tipo: `columna`, `arco`, `semiarco`, `guirnalda`, `pared`,
    `centro_mesa`, `bouquet`.
  - `__init__.py` expone `DEFINICIONES`, `definicion(clave)` y `frase_inicio_de_pieza()`.
  - El prompt de patrones se arma desde aquí; su `PROMPT_VERSION` sigue en
    `0d8c93d34d672014` (prueba en `tests/test_estructuras_registro.py`).
  - Los `MODOS` de patrón se leen de `patron_color` (un solo dueño).
- **`estructuras/bouquet.py`**: criterios de detección, prompt de la lectura, esquema
  de salida y `validar_lecturas`.
- **`amaterasu/vision_estructurada.py`**: la llamada de visión común (foto + mensaje +
  esquema, temperatura 0, sin razonamiento), con errores `<prefijo>_*`. La usan la
  lectura de patrones y la de bouquets.
- **`amaterasu/bouquet_referencia.py`** y el endpoint `POST /internal/v1/ia/bouquet-referencia`
  (scope `ia.bouquet_referencia`, cuerpo de 11 MB) en `app/main.py`.
- **`app/armado_bouquet.py`** (plan, dueño único de las reglas):
  - `clasificar`: látex, metalizado, burbuja o número, con tamaño y dígito, a partir de
    la forma y el título de la variante.
  - `validar`: errores `armado_invalido` con motivo.
  - `sugerir_armado`: receta, o lectura de la foto si la confianza es ≥ 0,5.
  - `armado_resuelto`: leyenda, niveles, insumos, duración, pasos y avisos.
  - **Nunca cambia la compra:** acomoda las mismas unidades que `_distribute_units`.
- **Integración en `app/plan.py`:**
  - `completar_armados` y `pistas_armado` en la petición.
  - `_assign_assemblies` en `_resolution_result` (necesita el catálogo).
  - `armados_bouquet` se emite junto a `patrones_color`, fuera del hash.
  - Un armado inválido responde `armado_invalido` 422.
- **`app/plan_edicion.py`**: editar globos o reparto de un bouquet quita su armado con aviso.
- **Contrato** (dueño Zod `src/lib/plan/armado-bouquet.ts`), regenerado con
  `npm run contracts:export:domain`, `npm run contracts:export` y `generate_models.py`:
  - `armado_bouquet` opcional en la estructura (Plan 1.0 y 1.1);
  - `armados_bouquet` en el plan resuelto;
  - `completar_armados` / `pistas_armado` en la petición;
  - `appearance.armado_bouquet` en el blueprint.
- **Next:**
  - `src/lib/ia/amaterasu/bouquet-referencia.ts`: elige bouquets con
    `identificarEstructuraOficial`, igual que el chat.
  - `deteccion-compartida.ts`: caché y llamadas en vuelo, extraídas de
    `patron-referencia.ts`, que bajó de 301 a 204 líneas.
  - La ruta `/api/references/analyze` corre patrón y bouquet **en paralelo** y los junta (`conArmadosDe`).
  - `pistasArmadoDelPlan` y el envío al confirmar en `registro-herramientas.ts`.
  - Paso por `resolver-backend.ts` y `python-mapper.ts`; tipo en `resuelto.ts`.
- **Banderas (default OFF):** `BOUQUETS_ARMADO_V1` (en `featureEnabled`) y
  `BOUQUET_REFERENCIA_PYTHON_ENABLED` (const). Están en `.env.example`.

## 5. Verificación hecha

- **Rama combinada, Python:** 649 pruebas ok (4 omitidas que requieren BD local, igual
  que antes); `ruff`, formato, `mypy` y `generate_models.py --check` limpios.
- **Rama combinada, TypeScript:** `tsc` limpio, lint 0 errores (25 avisos), `contracts:check` sin deriva.
- **`plan:test` sobre la rama combinada:** terminó en 0, sin fallos.
- **Cada parte por separado** pasó su `plan:test` completo antes del merge.
- **Llamadas reales a Gemini:**
  - regeneración de la galería (10 análisis);
  - una lectura real del bouquet del ejemplo 07: "base de aire, remate burbuja
    transparente, confianza 0,85".
- **No probado:**
  - la ruta completa en el navegador (requiere login, que el agente no debe hacer);
  - una confirmación de plan contra el catálogo real (la resolución se probó con catálogo simulado).

## 6. Gasto en proveedores

| Qué | Gasto |
|---|---|
| Corrida de control v16 | US$0,28 reportados (tope US$1,50) |
| Regeneración de galería (10 llamadas, una pasada) | ~US$0,08 estimado |
| Lectura real del bouquet | ~US$0,002 estimado |

## 7. Segunda entrega (2026-09-25, misma rama)

Decisiones del usuario en esta sesión: los cinco supuestos de §8 quedan como reglas
del negocio; se implementan la vista previa, el re-sugerido tras editar, la frase
del armado en el prompt de imagen y la UI; **no** se corre la evaluación paga; se
sube la rama y se abre el PR.

### Qué se hizo

- **Python**
  - `app/armado_bouquet.py`: `variantes_admitidas` y `disposiciones_admitidas`
    (lo que la compra permite), `sugerir_armado(..., variante=, disposicion=)`
    (elección del decorador; `variante_no_admitida` / `disposicion_no_admitida`),
    y `prompt_gemini` / `prompt_lora` en el armado resuelto (inglés; LoRA en ASCII
    y con los dígitos deletreados). Nombres de color por `patron_color`
    (`nombre_color_en`, `color_con_acabado_en`, `lista_en`, públicas nuevas).
  - `app/plan.py`: `contexto_bouquet_de_globos` (clasifica con lo que manda el
    navegador, cuenta con el plan), `vista_previa_de_armado`, `opciones_de_armado`,
    `validar_armado_sin_catalogo`; `completar_armados_de` limita la completitud
    a esas piezas.
  - `app/plan_edicion.py`: acción `armado` (`EdicionArmado`), `GloboNavegador`,
    `PlanArmadoRequest` y `vista_previa_armado`; `completar_armados` en
    `plan-edit.v1` cambia el aviso de "se quitó" a "se vuelve a sugerir".
  - `app/main.py`: `POST /internal/v1/plan/armado-bouquet` (scope
    `plan.armado_bouquet`); `_detail_metadata` deja pasar
    `variantes_admitidas` / `disposiciones_admitidas` solo con valores conocidos.
- **Contrato** (dueño Zod → `contracts:export:domain` → `generate_models.py`):
  `prompt_gemini` y `prompt_lora` en `ArmadoBouquetResuelto`;
  `completar_armados_de` en `plan-resolution.v1`. Ningún vector dorado cambia.
- **Next**
  - `python-adapter.ts`: `llamarPythonPlanArmadoBouquet`, `PythonPlanArmadoGloboSchema`,
    códigos de dominio y `domainDetails` con las opciones; `completar_armados`
    en la edición; `completarArmadosDe` en la resolución.
  - `edicion-python.ts` (`vistaPreviaArmadoPython`, `RechazoVistaArmadoError`),
    `edicion-esquemas.ts` (`EdicionArmadoSchema`), `edicion-error.ts`
    (`ARMADO_INVALIDO`), `traducir-error-servidor.ts` (misma familia que el patrón).
  - `aplicar-edicion.ts`: con `BOUQUETS_ARMADO_V1`, una edición que quita el armado
    re-resuelve con `completar_armados_de: [pieza]`; si no vuelve, aviso
    "queda sin armado".
  - Ruta `/api/plan-armado-bouquet`; `/api/plan-editar` acepta `accion: "armado"`.
  - Prompt de imagen: `frasesDeEstructuras` (`mezcla-color-escena.ts`) junta
    patrones y armados; `build-image-prompt.ts`, el compilador LoRA y
    `lora-product-runtime.ts` reciben `FraseDeEstructura[]`; `/api/generate` lo usa.
  - UI en `src/components/plan/bouquet/` (ver el informe del commit y §9).
- **Pruebas nuevas**: `tests/test_plan_armado_preview.py` (15), casos nuevos en
  `tests/test_armado_bouquet.py` (5), `scripts/test/test-plan-armado-ruta.ts`
  (en `plan:test`), caso bouquet en `test-patron-color-prompt.ts` con la frase
  real de Python fijada en `scripts/fixtures/patron-color-prompt/armados.json`.
- **Docs**: ADR-0030 "Segunda entrega" y reglas validadas.

### La foto manda sobre la compra (2026-09-25, tarde)

Probando en local, un bouquet de 5 globos en la foto salía con 15: el modelo del
chat elige `unidades_declaradas` sin ver el número de globos y el armado solo
acomodaba esa compra. Decisión del usuario: la foto manda, sin mínimo de 5 en ese
caso. `compra_desde_lectura` (armado_bouquet.py) y `_comprar_lo_leido` (plan.py):
al confirmar con lectura confiable, la cantidad, el reparto y el armado salen de
la foto; los colores que la foto no muestra se quitan; todo queda en `supuestos`.
Si algo de la lectura no se compra, regla de siempre. ADR-0030 decisión 4
enmendada. También `allowedDevOrigins` admite `127.0.0.1` (la app abierta por la
IP quedaba sin JavaScript en desarrollo).

### Pendiente inmediato

0. **Revisar y mezclar el PR #2.** Nota: gitleaks marcó dos falsos positivos en
   `test-patron-color-prompt.ts` (una variable llamada `apilado` contiene «api»);
   se renombró y sus huellas quedaron en `.gitleaksignore`.
1. **Desplegar la app y `ai-api` juntos.** `ai-api` hoy se despliega a mano (ver la
   memoria del proyecto y `AGENTS.md`). Las dos banderas siguen apagadas.
2. **Encender banderas en producción** cuando se decida: `BOUQUETS_ARMADO_V1` y
   `BOUQUET_REFERENCIA_PYTHON_ENABLED` (ver §7 de la primera entrega).

## 8. Reglas del negocio (eran supuestos; validadas el 2026-09-25)

- Los números de 16" o menos van con aire en varilla.
- Qué variante elige la receta sin foto:
  - base de aire si hay látex menor de 9" o números chicos;
  - helio apilado si hay 6 o más látex grandes en múltiplos de 3;
  - si no, escalonado.
- Receta con base: los dos primeros cuartetos son "base" y el resto "cuerpo"; el sobrante va suelto.
- Pesos estimados donde la tabla del distribuidor no tiene fila: látex de 9", 18", 24"
  y 36"; números de 25" y 34" (marcados como estimados, con aviso).
- La cantidad impar en helio solo avisa, no bloquea.

## 9. Pendiente de la siguiente entrega

- **Evaluación de la lectura del bouquet** con fotos reales (39 en el conjunto
  privado), con tope de gasto declarado y telemetría apagada. El usuario decidió
  no correrla en esta sesión.
- **LoRA v007 y bouquets:** la frase `prompt_lora` pasa el control de idioma y el
  preflight, pero no se sabe si la LoRA aprendió bouquets; medir con una corrida
  real cuando se encienda la bandera.
- **Vista previa en vivo al intercambiar globos:** hoy cada intercambio pide una
  vista previa (con debounce); si se nota lento, mover el intercambio a una
  permutación local dibujada al instante y validar después.
- **Estimador de costo de las evaluaciones:** sigue sumando la auditoría, así que
  sobreestima, y `src/lib/eval/estructuras/medir-tokens.ts` exige filas de auditoría.
  Medir un supuesto nuevo cuando haya telemetría sin auditoría (ADR-0029, "Pendiente acotado").
- **Deuda previa, no tocada:** `estructuras-oficiales.ts` aún lista ids densos, no
  densos y `semiarco` simple, aunque `AGENTS.md` dice que la taxonomía es de 12 clases.

## 10. Reglas que el próximo agente debe respetar

- El prompt de producción del reconocedor está **congelado byte a byte** (v16, una
  pasada). Cambiarlo invalida la línea base de evaluación; las variantes se agregan
  solo bajo pedido.
- **Toda corrida contra Gemini de pago** requiere un tope declarado y confirmado por el
  usuario, con telemetría apagada. Las fotos y salidas crudas nunca entran al repo.
- **Nunca regenerar un oráculo** para que pase una prueba (`expected` de los vectores
  dorados es a mano).
- **Contratos en un solo sentido:** Zod → `contracts:export(:domain)` → `generate_models.py`.
- **Lo comercial es de Python:** TypeScript no recalcula conteos ni pesas.
- **Nada que se agregue a `estructuras` o `compras` del snapshot:** cambiaría el
  `plan_hash` de todos los planes. Lo derivado para la UI va afuera, como
  `armados_bouquet`.
- **Git:** no subir ni abrir PRs sin permiso. El usuario tiene un stash previo
  ("wip: fase 2 escultura…") que no se debe tocar.

## 11. Fuentes externas usadas

- Sempertex, "Conceptos y técnicas – globos redondos", técnica "Topiario Satín" (PDF)
  y tabla de especificaciones de helio.
- Anagram, *Balloon Guide* (PDF oficial): definición de bouquet, pesas, tabla de helio, paquete P75.
- Qualatex, "Balloon Basics": bouquet apilado. Solo vía el buscador; la red corporativa
  bloquea qualatex.com y balloonhq.com.
- Balloons Are Everywhere, *Helium & Weight Chart* (2014): peso por globo; regla "suma por globo".

## 12. Comandos de verificación

```
npx tsc --noEmit && npm run -s lint && npm run -s contracts:check && npm run plan:test
uv run --directory services/ai-api pytest -q
uv run --directory services/ai-api ruff check app tests && uv run --directory services/ai-api mypy app
uv run --directory services/ai-api python scripts/generate_models.py --check
```

Pruebas propias de la segunda entrega, sueltas:

```
uv run --directory services/ai-api pytest -q tests/test_armado_bouquet.py tests/test_plan_armado.py tests/test_plan_armado_preview.py
npm run -s plan:test-armado-ruta && npm run -s ia:test-patron-color-prompt && npm run -s ui:test-propuesta
```
