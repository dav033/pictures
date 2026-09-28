# Seguimiento: conteo de globos desde la foto (frente 2)

Documento de traspaso de la rama **`feat/conteo-referencia`** (creada desde
`feat/bouquets` 77d0985). Plan de origen: `SEGUIMIENTO-guirnaldas.md` §2.1, §3 (E1,
E2) y §4. Decisión: `docs/architecture/decisions/0031-conteo-desde-la-foto.md`.
Lee primero `AGENTS.md` y ADR-0030. Fecha: 2026-09-25 (E1) y 2026-09-28 (E2).

## 1. Estado

| Entrega | Estado | Bandera |
|---|---|---|
| E1: lectura de conteo, contrato y blueprint, sin cambiar planes | hecha | `CONTEO_REFERENCIA_PYTHON_ENABLED` (OFF) |
| E2: `_aplicar_conteos` al confirmar, texto para el chat y evaluación sin costo | hecha (evaluación pagada pendiente, §4) | `CONTEO_REFERENCIA_V1` (OFF) |

E1 y E2 en `origin/feat/conteo-referencia`; el trabajo de E2 se hizo en `wip/conteo-e2`. Cero llamadas
pagas: todo se verificó con dobles, catálogos falsos y un ai-api local sin llave.

## 2. E1: qué se hizo

### Python (`services/ai-api`)

- `app/amaterasu/conteo_referencia.py`: la lectura entera.
  - Petición `ConteoReferenciaRequest` (l.131): foto y hasta 12 piezas con `tipo`,
    `estructura_oficial`, `bbox` y `piezas` (cuántas piezas iguales representa el
    elemento; se cuenta una).
  - Prompt `SYSTEM_INSTRUCTION` (l.147), esquema `RESPONSE_SCHEMA` (l.179) y
    `PROMPT_VERSION` (l.228) = `conteo-referencia.v1:bfd6604c6192ab95` (desde la revisión 1/11, `1b1d24d385008090`), fijada en
    `tests/test_conteo_referencia.py`. El esquema se serializa sin ordenar claves:
    el SDK manda `property_ordering` y el modelo escribe lo visible, luego los
    racimos y al final el estimado.
  - `mensaje` (l.236) pone en cada pieza la clave del registro que la describe.
  - Validación: `_por_tamano` (l.279), `_lectura` (l.318), `validar_lecturas` (l.357).
    `exacto` solo con 1–40 visibles (`MAX_GLOBOS_EXACTO`, l.57) y sin estimado. Un
    estimado menor que lo visible pasa a `null`. Las proporciones que suman 1 ± 0,1
    se normalizan; si no, el reparto queda vacío. Fuera de rango, el campo pasa a
    `null`: nunca se recorta ni se inventa.
  - `cumple_contrato` (l.352) comprueba cada lectura contra `appearance.conteo` del
    contrato exportado (`CONTRATO_LECTURA`, l.86, leído de `generated_models`); una
    lectura que no cabe se descarta con un aviso.
- Registro `app/amaterasu/estructuras/`:
  - campo `como_contar` en `base.py:26` y una regla por submódulo;
  - nuevos `techo_globos.py` y `figura.py`, al final de `DEFINICIONES`
    (`__init__.py:33`) y sin `inicio_de_pieza`;
  - `definicion_de_pieza` (`__init__.py:45`) y `reglas_de_conteo` (`__init__.py:61`).
  - El prompt del patrón no cambió: `0d8c93d34d672014`.
- `app/main.py`: `_default_conteo_referencia_handler` (l.436) y la ruta
  `POST /internal/v1/ia/conteo-referencia` (l.1586), con scope `ia.conteo_referencia`
  y cuerpo de 11 MB.
- Pruebas:
  - `tests/test_conteo_referencia.py` (18 casos): registro, versión fijada, prompt
    sin cifras del plan, orden del esquema, clases leídas del contrato, validación
    (densa, exacta, incoherente, descartes), lectura fuera de contrato, blueprint
    válido con la lectura, petición, proveedor falso, errores y ruta con su scope;
  - `tests/test_estructuras_registro.py`: techo y figura sin frase de patrón, y
    `definicion_de_pieza`.

### Contrato

- `src/lib/plan/conteo-referencia.ts`: `LecturaConteoSchema` (l.61) y
  `PorTamanoSchema` (l.47, cada clase una vez y suma 1 ± 0,01), dueño Zod de
  `conteo-referencia.v1`.
- `src/lib/ia/referencia/reference-blueprint.ts:97`: `appearance.conteo` opcional.
- Exportado a `contracts/domain/v1/reference-blueprint.schema.json` y
  `contracts/chat/v1/request.schema.json` (la petición del chat lleva el blueprint).
  `services/ai-api/app/generated_models.py` quedó regenerado.
- `pistas_conteo` no se agregó en E1: ADR-0031, decisión 10.

### Next

- `src/lib/ia/nucleo/feature-flags.ts:149`: `CONTEO_REFERENCIA_PYTHON_ENABLED`,
  default OFF.
- `src/lib/ia/nucleo/python-adapter.ts`:
  - ruta y scope en l.69;
  - esquema del resultado en l.1488;
  - `lecturasPorElementoPedido` (l.1503), compartida con el bouquet;
  - `llamarPythonConteoReferencia` (l.2073).
- `src/lib/ia/amaterasu/conteo-referencia.ts`:
  - `elementosConteo` (l.78): todas las estructuras de globos aprobadas, con la
    estructura oficial de `identificarEstructuraOficial` y las piezas;
  - `conConteosDe` (l.132);
  - registro de omisiones con `request_id` y `correlation_id` (l.136);
  - `leerConteosReferencia` (l.198).
- `src/lib/ia/amaterasu/lecturas-foto.ts:35`: `leerLecturasDeFoto` lanza las tres
  lecturas en paralelo según sus banderas y las junta por elemento.
- `src/app/api/references/analyze/route.ts`:
  - la llamada está en l.49;
  - el registro de elementos añade `conteo` solo cuando hay lectura (l.70).
- `scripts/test/test-conteo-referencia.ts` (8 casos, en `plan:test` como
  `ia:test-conteo-referencia`):
  - forma del blueprint;
  - selección de piezas;
  - adaptador (firma, cuerpo, rechazos);
  - caché, fallo con registro y con los ids;
  - bandera apagada = byte a byte;
  - fallo = lo mismo que apagada;
  - el prompt del chat no cambia;
  - la ruta con Python caído y con lectura.

### Fin de línea de los contratos (arreglado)

`contracts:export` y `contracts:export:domain` reescribían los 39 JSON aunque su
contenido no cambiara. El checkout con `core.autocrlf=true` los deja en CRLF y el
script escribe LF, así que git los daba por modificados. Contenido igual:
`git diff --ignore-cr-at-eol` salía vacío. Los 37 archivos que solo cambiaban de
fin de línea se devolvieron con `git checkout --`. Los dos scripts
(`scripts/ops/export-*-contract-schemas.ts`) ahora solo escriben un archivo si su
contenido, con el fin de línea normalizado, cambió; `--check` sigue igual.

### Verificación de E1 (resultados reales, 2026-09-25)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | solo TS2304 `LayoutProps` en `src/app/layout.tsx` (preexistente, faltan tipos de `.next/types`) |
| `npm run -s lint` | 0 errores, 25 avisos; ninguno en archivos tocados |
| `npm run -s contracts:check` | 9 chat + 30 domain al día |
| `npm run plan:test` | exit 0 (incluye `ia:test-conteo-referencia` 8/8) |
| `pytest -q` | 695 passed, 4 skipped (antes 675) |
| `ruff check app tests` · `ruff format --check` · `mypy app` | limpio · 73 formateados · sin errores |
| `generate_models.py --check` | al día |
| vectores dorados `plan-resolution` | 31, sin cambios |
| e2e local (adaptador TS real → ai-api en 8011, sin llave de Gemini) | un cuerpo válido llega al dominio (`conteo_referencia_unavailable`, 503); `piezas: 0` → 422 antes del dominio |

## 3. E2: qué se hizo

Hecho en `wip/conteo-e2` y llevado a `feat/conteo-referencia` (fast-forward). La
decisión y sus supuestos están en ADR-0031, decisiones 11 a 16.

**Cambio de diseño en kits.** La regla del plan original ("en kits manda la
lectura del armado") se reemplazó: un bouquet de más de 30 globos salía con 11
porque la lectura del armado describe una unidad por nivel
(`SEGUIMIENTO-bouquets.md` §14). Ahora el conteo da la cantidad y el armado la
distribución. No se tocó `amaterasu/estructuras/bouquet.py`, `armado_bouquet.py`
ni `armadoLeido`: los cambia la rama `fix/bouquet-conteo-niveles`.

### Python (`services/ai-api`)

- `app/conteo_foto.py`: las reglas, sin importar `plan.py`.
  - `validar_pistas` (l.90): contra el esquema exportado.
  - `cuenta_usable` (l.116): exacta → estimado → racimos × globos por racimo, con
    confianza de al menos 0,5.
  - Kits: `total_kit_sin_armado` (l.150), `total_kit_con_armado` (l.163),
    `reescalar_lectura_armado` (l.209; ver §3.1) y `_kit` (l.490).
  - Geométricas: `mezcla_de_la_foto` (l.307), `medidas_desde_referencia` (l.335),
    `elegir_opcion` (l.387) y `_geometrica` (l.658).
  - `PuertoPlan` (l.408) y `aplicar` (l.761): una entrada de
    `conteos_referencia` por estructura con pista. Tras una edición, las piezas
    no pedidas quedan `sin_aplicar`.
- `app/plan.py`:
  - campos `completar_conteos`, `pistas_conteo` y `completar_conteos_de` (l.328);
  - enganche en `_resolution_result` antes de los armados (l.3485), y
    `conteos_referencia` fuera del hash (l.3520);
  - al final del archivo, un bloque nuevo y separado: `_mix_covered` (l.3547),
    `_within_physical_gate` (l.3567, llama a `_physical_warnings` sin tocarla),
    `_resynced_pattern` (l.3584) y `_aplicar_conteos` (l.3596).
- `tests/test_conteo_foto.py` (24 casos):
  - reglas puras;
  - bouquet que sube de 9 a 30 con un solo supuesto y punto fijo;
  - estimado que no baja y cuenta exacta que sí;
  - kits sin armado, racimo, kit con armado propio y lectura poco confiable;
  - densidad antes que largo, largo equivalente, medidas del cliente fijas y
    escala de la foto;
  - mezcla que cambia solo si el catálogo la cubre y no tras una edición;
  - `completar_conteos_de` (también vacío);
  - patrón re-sincronizado y punto fijo, y `conteos_referencia` fuera del hash.

### Contrato

- `src/lib/plan/conteo-referencia.ts`: `PistaConteoSchema` (l.84),
  `DECISIONES_CONTEO` y `ConteoAplicadoSchema` (l.114), con la lectura, la
  decisión, los globos de la foto, antes y después, los cambios y el motivo.
- `src/lib/ia/contracts/domain-v1.ts`: `conteos_referencia` en `plan-resuelto.v1`
  (l.414) y `completar_conteos`, `pistas_conteo` y `completar_conteos_de` en
  `plan-resolution.v1` (l.478).
- Regenerados: `plan-resolution-request`, `plan-resolution-result`,
  `plan-resuelto.schema.json` y `generated_models.py`.

### Next

- `src/lib/ia/nucleo/feature-flags.ts:61`: `CONTEO_REFERENCIA_V1`, default OFF.
- Transporte: `python-adapter.ts:1212` y `resolver-backend.ts:68` pasan los tres
  campos; `python-mapper.ts:85` y `resuelto.ts` llevan `conteos_referencia`.
- Confirmar: `pistasConteoDelPlan` (`registro-herramientas.ts:565`) y la bandera en
  l.1001. Solo se mandan con pistas.
- Editar: `conteosDeLaEdicion` (`aplicar-edicion.ts:133`, usada en l.225). Todas
  las lecturas vuelven a viajar; solo una edición de mezcla ajusta su pieza.
- Chat: `conteoLeido` (`prompt-sistema.ts:191`), solo con la bandera y confianza
  de al menos 0,5.
- Evaluación sin costo:
  - `src/lib/eval/estructuras/conteo.ts`: verdad, predicción, métricas, costo
    estimado y runner;
  - `cli-conteo.ts` y `scripts/eval/estructuras/conteo.ts` (`npm run eval:conteo`);
  - `eval/estructuras/supuestos/tokens-conteo-2026-09-28.json`, marcado
    `medido: false`.
- Pruebas:
  - `scripts/test/test-conteo-referencia.ts` pasa a 9 casos (prompt con y sin
    bandera, pistas, transporte, mapper y edición);
  - `scripts/test/test-eval-conteo.ts`: 7 casos, en `plan:test` como
    `eval:test-conteo`.

### Verificación de E2 (resultados reales, 2026-09-28)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | solo TS2304 `LayoutProps` (preexistente) |
| `npm run -s lint` | 0 errores, 25 avisos (los mismos de antes) |
| `npm run -s contracts:check` | 9 chat + 30 domain al día |
| `npm run plan:test` | exit 0 (`ia:test-conteo-referencia` 9/9, `eval:test-conteo` 7/7) |
| `pytest -q` | 719 passed, 4 skipped |
| `ruff check` · `ruff format --check` · `mypy app` | limpio · 75 formateados · sin errores |
| `generate_models.py --check` | al día |
| vectores dorados `plan-resolution` | 31, sin cambios (`test_plan_regresion.py` en verde) |
| `npm run eval:conteo` en vista previa con una suite de 30 fotos ficticia fuera del repo | 30 análisis, esperado US$0,35, cota US$0,94 (estimado, tokens sin medir), sin llamadas |

No se corrió nada contra proveedores. No hubo e2e de `resolve_plan` contra el
ai-api real: la resolución necesita la base del catálogo y se probó con catálogos
falsos en pytest.

### 3.1 Fusión con `fix/bouquet-conteo-niveles` (2026-09-28)

`origin/fix/bouquet-conteo-niveles` (2932204) entró con un merge normal. Trae:
- `cantidad` y `clase_tamano` por nivel en la lectura del armado, más
  `total_globos` y `avisos`;
- `armado_bouquet.total_leido` como único dueño de la cuenta;
- `compra_desde_lectura` comprando ese total;
- `_material_del_color` eligiendo por clase;
- `armadoLeido` mostrando el total de Python.

- **Conflictos textuales, dos:**
  - `package.json`: la cadena de `plan:test` se unió. Quedaron
    `ia:test-conteo-referencia`, `eval:test-conteo` e
    `ia:test-armado-bouquet-prompt`: 82 pasos, sin duplicados.
  - `generated_models.py`: se regeneró desde el Zod fusionado, después de
    `contracts:export:domain` y `contracts:export`.
  `plan.py`, `prompt-sistema.ts`, los contratos y `DetalleEstructura.tsx` se
  fusionaron solos y se revisaron a mano.
- **Reescalado** (`conteo_foto.py`):
  - `reescalar_lectura_armado` (l.209) ya no repite niveles: ajusta la
    `cantidad` de cada nivel por restos mayores, con la base primero en un
    empate;
  - las posiciones, los colores y la clase se conservan;
  - el sobrante menor que una unidad va como sueltos de acento;
  - un nivel que pasa de 24 unidades se parte en tramos (`_en_tramos`, l.199);
  - las cuentas son las de `armado_bouquet.total_leido` (`_globos_de`, l.190),
    sin una segunda regla.
- **Tamaños desde `por_tamano`:** `clases_desde_por_tamano` (l.269) pone la clase
  en los niveles leídos que no la traen, repartiendo por los globos que le faltan
  a cada clase. `_kit` la aplica siempre que haya lectura del armado y conteo
  confiable. El látex lo sigue eligiendo `_material_del_color`; no hizo falta
  cambiar su firma, porque la clase viaja en el nivel.
- **Chat** (`prompt-sistema.ts`):
  - `cantidadDelConteo` (l.211) decide si el conteo manda: bandera, confianza de
    al menos 0,5 y una cifra leída (cuenta exacta o estimado);
  - si manda, `armadoLeido(…, sinTotal)` (l.176) omite el `total_globos` y la
    orden de declararlo, y `conteoLeido` (l.224) da la cifra para declarar;
  - si no, sigue el total que publicó Python;
  - sin conteo o sin bandera, la línea es la de la rama del bouquet, byte a
    byte;
  - no se cuenta nada en TypeScript.
- **Pruebas nuevas:**
  - en `test_conteo_foto.py`:
    - el bouquet del 11 (dos cuartetos sin `cantidad`, corona, 3 y 5) con un
      conteo estimado de 35 sube a 35: un nivel base con cantidad 8, las
      posiciones intactas y un solo supuesto;
    - la misma lectura con `cantidad` 4 (35) y un conteo de 36: `coincide` y se
      queda el armado;
    - los tamaños salen de `por_tamano` (el blanco de 18" ya no se quita);
    - el bouquet de 5 sigue dando 5, con y sin conteo;
    - reescalado por `cantidad` y en tramos;
    - la clase solo donde falta;
  - en `test-conteo-referencia.ts`: el conteo manda sobre el total del armado en
    el texto del chat; sin cifra leída, o sin la bandera, manda el total de
    Python.
- **Verificación:** ver §3.2.

### 3.2 Verificación tras la fusión (resultados reales, 2026-09-28)

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | solo TS2304 `LayoutProps` (preexistente) |
| `npm run -s lint` | 0 errores, 25 avisos (los mismos) |
| `npm run -s contracts:check` | 9 chat + 30 domain al día |
| `npm run plan:test` | exit 0 (82 pasos: `ia:test-bouquet-referencia` 11/11, `ia:test-conteo-referencia` 9/9, `ia:test-armado-bouquet-prompt`, `eval:test-conteo` 7/7) |
| `pytest -q` | 745 passed, 4 skipped |
| `ruff check app tests scripts` · `ruff format --check app tests` · `mypy app scripts` | limpio · 75 formateados · sin errores (41 archivos) |
| `generate_models.py --check` | al día |
| vectores dorados `plan-resolution` | 31, sin cambios |

### 3.3 Revisión adversaria de `feat/guirnaldas`: hallazgos 24–30 (rama `fix/rev-eval`, 2026-09-28)

Cada arreglo lleva una prueba que falla antes y pasa después; nada corrió contra
proveedores.

- **24** (`0dd22bf`): antes del primer análisis pagado, una petición firmada con un cuerpo inválido tiene que volver con 422 (ruta, firma y scope bien, sin proveedor); un fallo sistemático a mitad (otra versión del prompt, 401/403/404, respuesta fuera de contrato, ai-api sin llave) no deja empezar otra foto, queda en `run.json` (`detenida_por`) y el comando sale con error; cada línea `error` guarda `error_codigo`.
- **25** (`d45e7fe`): el exceso sobre la cota también se reserva, así que el tope sigue el gasto real; mismo arreglo en `runner.ts` (reconocimiento).
- **26** (`b898fe3`): `correrExperimento` (fal.ai) falla cerrado: sin saldo legible no genera nada y, si deja de leerse a mitad, se detiene (`npm run lora:test-tope-fal`).
- **27** (`7b06c10`): la cuenta humana tiene que ser un entero escrito; un blanco, "1e1" o "0x10" se rechazan con su línea.
- **28** (`7d36228`): los tokens de pensamiento de las dos llamadas se registran (`tokens_pensamiento`, opcional en líneas viejas) y se cobran como salida.
- **29** (`4df6ab3`): cada foto cuenta en una sola meta; una foto de más de 15 globos contada una a una va a la del error relativo, y `cumple.exactas` es un veredicto estricto (todas a ±1). Decisión en ADR-0031, decisión 16.
- **30** (`334cf0a`): `run.json` cubre la corrida entera tras reanudar (costo sumado desde las líneas, plan completo); lo de la invocación va en `esta_invocacion`.

Fuera de estos ids, sin tocar: `scripts/bench/bench-fidelidad.ts` lee el saldo de fal
pero no aplica `--max-usd` a mitad de corrida, y `resumirCorrida`
(`resumen-corrida.ts`, reconocimiento) tiene la misma forma que el hallazgo 30.

### 3.4 Revisión adversaria de `feat/guirnaldas`: Python (rama `fix/rev-python`, 2026-09-28)

Una línea por hallazgo, cada uno con su prueba de regresión
(`services/ai-api/tests/test_revision_conteo.py` y `test_revision_bouquet.py`),
que falla contra el código anterior al arreglo.

- **3 = 9 = 31** (`5e81129`): un supuesto del conteo de más de 240 caracteres, o
  un plan con 30 supuestos, daba 422 al confirmar. `app/supuestos.py` lee
  `maxLength` y `maxItems` del contrato, acorta el nombre y corta con "…". Las
  medidas van en una sola cláusula. Aplica también al aviso de patrón degradado
  de la guirnalda.
- **10** (`bdd2bdd`): racimos × globos por racimo pasaba de 10000 y rompía
  `conteos_referencia`. `cuenta_usable` y la lectura lo descartan por encima del
  tope del contrato.
- **34** (`fcfa125`): editar la mezcla sumaba un supuesto de conteo al de la
  confirmación. `aplicar` quita primero, en las piezas de `solo`, los supuestos
  que escribió el conteo.
- **2** (`f758bba`): el conteo elegía densidades que la estructura oficial no
  admite y daba 422 invalid_plan. Las densidades salen ahora de las reglas
  `allOf` del contrato (`plan._OFFICIAL_DENSITIES`).
- **1 = 11** (`a5a9e26`): el conteo decía "grande" a 24" y el bouquet,
  "gigante". Queda una sola escala, `armado_bouquet.CLASES_TAMANO_NIVEL`
  (`clase_de_tamano`); el prompt del conteo sube a `1b1d24d385008090`.
  Documentado en ADR-0031 §5 y ADR-0030.
- **33** (`32ffc32`): las medidas que el cliente dio a una estructura se movían
  si el espacio no tenía medidas. `plan-resolution.v1` gana
  `medidas_del_cliente` y Python fija las medidas declaradas por estructura.
  Tras una edición, la foto solo ajusta la densidad.
  **Pendiente:** `aplicar-edicion.ts` no manda la señal (fuera de esta rama).
- **7** (`a203645`): con números "a los lados" el prompt v2 permitía describir
  los dos grupos juntos, y `total_leido` los duplicaba. El prompt dice ahora que
  se describe un grupo (`bouquet-referencia.v2:b1f5cb194f104d59`).
- **8** (`a203645`): el tope de salida de la lectura del bouquet sube de 2048 a
  4096 tokens, y un JSON cortado lleva su `finish_reason` en `provider_detail`.

## 4. Pendientes

1. ~~Fusionar con `fix/bouquet-conteo-niveles`~~: hecho, ver §3.1.
2. **Fusionar con `feat/guirnaldas`.** `_aplicar_conteos` va antes de
   `completar_armados_guirnalda` en `_resolution_result`. La cuerda parabólica de
   `_total_globos` y `_eje` entra sola: `conteo_foto.py` cuenta con `contar` de
   `PuertoPlan`.
3. **Evaluación.**
   - Contar a mano 30 fotos (`sha256,globos,exacto[,familia]`) fuera del repo.
   - Correr `npm run eval:conteo -- … --ejecutar --max-usd <tope> --crudos <dir>`
     con tope declarado y confirmado.
   - Con esos números, reemplazar el supuesto de tokens sin medir y validar las
     metas (≤ 25 % en densas, ±1 hasta 15 globos).
4. **Validar con el negocio los supuestos de ADR-0031:**
   - la tolerancia de ±15 %;
   - la ventana de ±35 %;
   - las alturas de referencia;
   - el umbral de la mezcla;
   - que un estimado nunca baje un kit.
5. **UI.**
   - La tarjeta no muestra `conteos_referencia` (los ajustes llegan por
     `supuestos`).
   - El supuesto "medidas asumidas para …" de `_complete_measures` sigue con el
     valor anterior cuando el conteo mueve el largo.
6. **Encendido.** Primero `CONTEO_REFERENCIA_PYTHON_ENABLED` y después
   `CONTEO_REFERENCIA_V1`, tras la evaluación (E7), y con app y `ai-api`
   desplegados juntos.
