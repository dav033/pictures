# Seguimiento: conteo de globos desde la foto (frente 2)

Documento de traspaso de la rama **`feat/conteo-referencia`** (creada desde
`feat/bouquets` 77d0985). Plan de origen: `SEGUIMIENTO-guirnaldas.md` §2.1, §3 (E1,
E2) y §4. Decisión: `docs/architecture/decisions/0031-conteo-desde-la-foto.md`.
Lee primero `AGENTS.md` y ADR-0030. Fecha: 2026-09-25.

## 1. Estado

| Entrega | Estado | Bandera |
|---|---|---|
| E1: lectura de conteo, contrato y blueprint, sin cambiar planes | hecha | `CONTEO_REFERENCIA_PYTHON_ENABLED` (OFF) |
| E2: `_aplicar_conteos` al confirmar, texto para el chat y evaluación | a medias, en la rama `wip/conteo-e2` (ver §3) | `CONTEO_REFERENCIA_V1` (OFF) |

E1 subida a `origin/feat/conteo-referencia` el 2026-09-28. Cero llamadas pagas: todo
se verificó con dobles y un ai-api local sin llave.

## 2. E1: qué se hizo

### Python (`services/ai-api`)

- `app/amaterasu/conteo_referencia.py`: la lectura entera.
  - Petición `ConteoReferenciaRequest` (l.131): foto y hasta 12 piezas con `tipo`,
    `estructura_oficial`, `bbox` y `piezas` (cuántas piezas iguales representa el
    elemento; se cuenta una).
  - Prompt `SYSTEM_INSTRUCTION` (l.147), esquema `RESPONSE_SCHEMA` (l.179) y
    `PROMPT_VERSION` (l.228) = `conteo-referencia.v1:bfd6604c6192ab95`, fijada en
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

## 3. E2

Quedó a medias el 2026-09-25 por una pausa del usuario y se guardó tal cual en la rama
`wip/conteo-e2` (un commit encima de esta rama). Ese estado **no pasa**
`contracts:check`: el esquema Zod cambió después del último export. Al retomar, seguir
desde esa rama y, al cerrar E2, llevar `feat/conteo-referencia` hasta ella.

**Cambio de diseño obligatorio para kits.** La regla del plan "en kits la lectura del
armado manda si existe, si no, el conteo" (`SEGUIMIENTO-guirnaldas.md` §2.1) queda
descartada: un bouquet de más de 30 globos salió con 11 porque la lectura del armado
describe una unidad por nivel (diagnóstico completo en `SEGUIMIENTO-bouquets.md` §14,
rama `feat/bouquets`). El conteo da la cantidad y el armado la distribución; un conteo
no exacto también debe poder subir la cantidad de un kit (un bouquet apilado nunca es
"exacto": siempre tiene globos ocultos).
