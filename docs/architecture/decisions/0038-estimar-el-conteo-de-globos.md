# 0038 — La IA puede estimar el conteo de globos antes de confirmar

Fecha: 2026-10-02
Estado: en ejecución (detrás de `ESTIMAR_CONTEO_V1`, apagada en producción)
Relacionado con: ADR-0031 (conteo desde la foto), ADR-0034 (el motor del diseñador arma las tres estructuras)

## Problema

El número de globos de una pieza lo decide Python (`services/ai-api/app/plan.py`), y la IA no tenía cómo
consultarlo: solo lo obtenía **confirmando el plan** (`confirmar_plan_decoracion`), que fija el estado del turno,
el token de aprobación y el `plan_hash`. Para acercarse al conteo que Amaterasu leyó en la foto, el modelo
tenía que adivinar medidas, densidad y mezcla, confirmar, mirar el resultado y repetir, gastando rechazos.

Además, hoy hay **dos dueños del conteo según la pieza**:

- sin armado cuenta la fórmula (`_total_globos`, `_eje`): medidas, densidad y mezcla;
- con `armado_arco`, `armado_columna` o `armado_guirnalda_organica` cuenta el motor del diseñador
  (`_conteo_del_motor`, ADR-0034 §3), que coloca cada globo y **no lee** la densidad, la mezcla, las medidas del
  plan, la estructura oficial ni el número de colores (comprobado: las 12 combinaciones densidad × mezcla dan un
  solo total, `tests/test_estimar_conteo.py`).

Eso tiene una consecuencia concreta: `confirmar_plan_decoracion` devolvía `ESTIMACION_INCONSISTENTE` con
«revisa las medidas, densidad, mezcla…» también cuando la pieza señalada traía armado, y esos mandos no la mueven:
el modelo repetía el mismo plan hasta agotar los rechazos.

Y `conteo_foto.py` ya sabe buscar la menor variación de densidad y medidas que lleva una pieza a un conteo
(`_geometrica`), pero solo la corre `resolve_plan` al confirmar con la foto; ninguna herramienta la podía invocar,
y no sabe de motores.

## Decisión

### 1. Una herramienta de solo lectura: `estimar_conteo_globos`

Entrada: hasta 6 `candidatos` (`etiqueta` única, `tipo`, `estructura_oficial?`, `medidas`, `densidad`, `mezcla`,
`colores?`, `repeticiones?`, `armado_de?`), un `objetivo?` (`conteo`, `exacto?`) y `referencia_element_id?`.
`armado_de` es el `estructura_id` de una pieza que `armar_estructura` ya validó en el turno: el servidor trae el
armado guardado en `estado.armadosEstructura` (el modelo no puede escribir ese objeto entero). Sin `objetivo`, se
usa el conteo leído en la foto, con la **misma regla que el prompt** (`objetivoDelConteo`: confianza ≥ 0,5 y
`CONTEO_REFERENCIA_V1`); con dos conteos y sin elegir, no se adivina.

Salida por candidato: `total_formula`, `total_motor` (`null` sin armado), `total_vigente` (el que se cobraría) y su
`fuente` (`formula` | `motor`), `total_instalado` (× repeticiones), `eje_m`, `globos_por_metro`, `formula_clasica`
(el ancla `4,8·L/d` que publica el motor del arco), `reparto_por_tamano`, `puerta_fisica` (`dentro` y avisos),
`avisos`, `nota`, y con objetivo: `brecha` (diferencia, absoluta, relativa, tolerancia, `dentro_de_tolerancia`) y
`sugerencia` (`estado`: `no_necesaria` | `propuesta` | `sin_ajuste_posible` | `no_evaluada` | `cortada_por_tope`; `via`:
`formula` | `motor`; `cambios`; `total_resultante`; `brecha`; `motivo`). Más `mejor`: la etiqueta del candidato
dentro de tolerancia y de la puerta física más cercano al objetivo.

No escribe estado, no toca `planResuelto`, el token ni `plan_hash` (`HERRAMIENTAS_SOLO_LECTURA`). **El número que se
le dice al cliente sigue saliendo siempre de `confirmar_plan_decoracion`.**

### 2. Python es dueño de todo el cálculo

`services/ai-api/app/estimar_conteo.py` (frontera y operación), `estimar_conteo_sugerencia.py` (la menor variación) y
`estimar_conteo_mandos.py` (los mandos del armado y sus valores), ruta `POST /internal/v1/plan/estimar-conteo`
(scope `plan.estimar_conteo`, `run_plan_cpu`, sin red ni Postgres). No copia la fórmula ni sus constantes:

- `plan.contar_pieza` abre lo que ya decide el conteo (fórmula, motor, `_physical_warnings`, reparto por tamaño).
  `_structure_count` se partió en `_formula_count` + la rama del motor y `_within_physical_gate` en `_gate_warnings`:
  refactor sin cambio de comportamiento (los vectores dorados lo prueban).
- La tolerancia y la búsqueda hacia el objetivo son las de `conteo_foto` (`tolerancia`, `dentro_de_tolerancia`,
  `buscar_ajuste` → `_geometrica`, con `plan.puerto_de_conteo`). Sin lectura de la foto la mezcla nunca cambia.
- Las medidas que faltan se asumen como al confirmar (`plan.con_medidas_por_defecto` → `_complete_measures`, interior) y la
  respuesta lo avisa en `avisos`: el chat deja vacías las que el cliente no dio, y una pieza sin medidas no se rechaza.
- Errores estables: `invalid_request` (forma, validada contra el contrato exportado), `candidato_invalido`
  (`etiqueta_repetida`, `armado_no_corresponde`) y `armado_invalido` (el motivo de la puerta del
  motor), con `estructura_id` = etiqueta del candidato.

### 3. Una pieza con armado del motor se estima con los mandos del motor

Con armado, los mandos de la fórmula no mueven el total y la sugerencia lo dice (`nota`). Lo único propio del módulo
es **barrer los mandos del armado** y preguntarle a `contar_pieza` qué total da cada valor, del más cercano al más
lejano:

| Pieza | Mandos que se barren | Si no alcanzan |
|---|---|---|
| arco | `tamano_globo`, `globos_ancho` (dentro de `limites_de`) | `ancho_m` (ventana ±35 % de `conteo_foto`, paso 5 %), solo si no son medidas del cliente |
| columna | `globos_capa`, `abajo`, `arriba` | `alto_m` (ventana, y luego el alto que da la cantidad, como la tercera etapa de `conteo_foto`) |
| columna por capas | ninguno: la lista de capas es el diseño → `no_evaluada` | |
| guirnalda orgánica | solo `largo_m`, por secante sobre su propio conteo (≤ 5 evaluaciones) | |

Una variante cuenta como propuesta solo si el motor la acepta tal cual se pidió (sin avisos nuevos: ni acotó ni
corrigió nada) y la puerta física no avisa. Los nombres de los mandos son los de `armar_estructura`
(`geometria.*`, `forma.largo_m`): se comprobó que pedirlos con el mismo patrón y materiales da el total prometido
(`test_lo_que_sugiere_el_motor_se_aplica_con_armar_y_da_el_mismo_total`).
Cada petición tiene un **tope de trabajo** con dos límites, evaluaciones y reloj, que cuentan **también el conteo
base de cada candidato** (se cuenta todo primero y se busca después con lo que queda): 80 unidades (la guirnalda
cuesta 8) y 2 s en total (`PRESUPUESTO_SEGUNDOS`; el reloj se comprueba entre evaluaciones, contando por adelantado
lo que cuesta la siguiente). Al cortarse, la sugerencia es `cortada_por_tope` (con la causa en `motivo`) o, si ya había
una propuesta, la propuesta marcada como posiblemente no mínima; nunca un error ni un «sin ajuste posible».
Una consulta admite como máximo 2 guirnaldas con armado del motor (`demasiadas_guirnaldas_con_armado`).
La ruta atiende **una estimación a la vez**, sin cola: si hay otra en curso responde `estimacion_ocupada` (429) y el
handler le dice al modelo «ocupado, reintenta una vez» (`ESTIMACION_OCUPADA`).

### 4. Contrato, TypeScript y prompt

- Contrato en una sola dirección: `estimar-conteo.v1` y `estimar-conteo-result.v1` en
  `src/lib/ia/contracts/domain-v1.ts` → `npm run contracts:export:domain` → `generate_models.py` (39 → 41 contratos
  generados; los esquemas existentes y `x-reglas-mezclas` no cambian).
- TS solo valida el borde, junta lo que el turno ya sabe (armado guardado, conteo de la foto, tamaños y medidas del
  cliente) y llama a Python por el adaptador (`llamarPythonEstimarConteo`); no recalcula nada. La respuesta se valida
  contra el contrato y contra los candidatos preguntados.
- Prompt (`BLOQUE_ESTIMAR_CONTEO`): solo con la bandera y un conteo de la foto que el prompt ya presenta, para que el
  prompt de los demás turnos no cambie. Pide 2–3 candidatos antes de armar o confirmar, y repite que el número del
  cliente sale de `confirmar_plan_decoracion`.
- `ESTIMACION_INCONSISTENTE` ya no manda a tocar medidas, densidad ni mezcla de una pieza con armado señalada por la
  puerta física (`accionEstimacionInconsistente`); sin armado, el mensaje es el de siempre.

### 5. Bandera

`ESTIMAR_CONTEO_V1`: encendida fuera de producción y apagada en producción, la misma convención que
`ARMADO_ARCO_COLUMNA_V1`; independiente de ella (estimar sirve también sin armar).

## Alternativas descartadas

- **Un modo «simulacro» de `confirmar_plan_decoracion`**: arrastra estado, token, catálogo y rechazos; justo lo que se
  quería evitar.
- **Recalcular en TypeScript o poner la fórmula (λ, 0,92, anchos de banda) en el prompt**: un segundo dueño del
  conteo, prohibido por AGENTS.md (`validateMaterialEstimate` recalculaba catorce totales y costó una mañana de
  diagnóstico cuando las dos definiciones se separaron).
- **Que el motor lea densidad y mezcla**: cambia lo que se cobra y el `plan_hash` de los planes aprobados; es una
  decisión de ADR-0034, no de esta consulta.
- **Barrer todos los mandos del motor o bisecar la guirnalda**: el arco cuesta ~0,06 s por evaluación y la guirnalda
  0,3–0,9 s, con ruido de semilla que rompe la monotonía; se barre lo que alcanza el objetivo con pocas evaluaciones y
  lo demás se declara.
- **Una sugerencia que cambie la mezcla**: `conteo_foto` solo la cambia con el reparto por tamaño leído de la foto, que
  esta consulta no recibe; el modelo puede probarla como otro candidato.

## Consecuencias

- La IA puede comparar candidatos contra el conteo de la foto sin comprometer el turno, con las cifras del dueño.
- **Una pieza con armado y un objetivo lejano se corrige con el armado, no con la densidad**; la herramienta lo dice.
- **Entran al motor por `tipo`, no por `estructura_oficial`**: `aro_circular`, `arco_asimetrico`, `arco_no_denso`,
  `columna_asimetrica` y `columna_no_densa` se cuentan como arco o columna normal. Medido: un `aro_circular` de
  1,5 × 1,5 m da 91 con la fórmula (eje = circunferencia) y 23 con el motor (que lo arma como herradura de 1,5 m), y
  con el motor la puerta física lo marca «demasiado bajo» (7,4 globos/m). La herramienta lo reporta —`nota`,
  `total_formula`, `total_motor`, `puerta_fisica`— y no lo corrige: es deuda de ADR-0034 §3.
- La guirnalda con motor da un total **para la semilla fija del armado**: con 40 semillas a 3 m el total fue de 56 a
  89 globos (±22 %). Las propuestas dicen «no es exacta».
- **Tiempo medido** (2026-10-02, caché del motor frío, armados distintos por candidato, máquina compartida con otros
  procesos): antes del tope, 6 guirnaldas con armado y objetivo 400 tardaban 19,8 s, 6 arcos con objetivo 600 6,7 s y
  con objetivo 5000 9,5 s (la primera versión de este ADR decía ~5 s sin haberlo medido en frío). Con el tope por
  reloj, que cuenta el conteo base, y el máximo de 2 guirnaldas: 2 guirnaldas con objetivo 400 1,1–1,3 s, 6 arcos 1,9 s
  (con ambos objetivos), 6 columnas 0,4–0,8 s, y 6 guirnaldas con armado se rechazan en 0,01 s. Un candidato cortado
  por el tope no recibe sugerencia (`cortada_por_tope`); el conteo base sale siempre. El tiempo total es el conteo base
  más ~2 s: el reloj no interrumpe una evaluación en marcha, y el resultado de la búsqueda depende de qué tan cargada
  esté la máquina (por eso las pruebas de resultado fijan el reloj en una hora y el reloj se prueba aparte).
- Las variantes evaluadas entran en el `lru_cache` de piezas del motor (32) y pueden desalojar piezas de una resolución
  reciente, que se recalculan (~55 ms).
- La sugerencia es válida para el armado dado (patrón, opciones, materiales): cambiar el patrón cambia el total.

## Rollback

- `ESTIMAR_CONTEO_V1=false` (kill-switch, sin despliegue): el modelo no ve la herramienta ni la línea del prompt y el
  handler responde `HERRAMIENTA_NO_DISPONIBLE`. En producción ya nace apagada.
- Revertir el código: no hay datos que migrar ni escritura que deshacer; la ruta de Python es de solo lectura y puede
  quedarse sin consumidores. Los refactors de `plan.py` (`_formula_count`, `_gate_warnings`, campos de
  `_ConteoDelMotor`) son equivalentes; si se revierten, los vectores dorados no se mueven.
- El texto nuevo de `ESTIMACION_INCONSISTENTE` es independiente de la bandera: se revierte con `accionEstimacionInconsistente`.
- Los contratos nuevos se retiran quitándolos de `domain-v1.ts`, regenerando y bajando el recuento (41 → 39) en
  `generate_models.py` y `test_generated_models.py`.

## Lo que no se pudo comprobar

- **Que la estimación se parezca a la verdad.** No hay ningún conteo real etiquetado en el repositorio (ni los 30 de la
  evaluación pendiente de `SEGUIMIENTO-conteo.md` §4): las pruebas son de paridad con el dueño (`resolve_plan`, `armar`), no de acierto.
- **Que el modelo use bien la herramienta y el prompt** (elige candidatos, respeta la nota, no cita la estimación al
  cliente): es calidad probabilística y no se evaluó; no se llamó a ningún proveedor.
- **La ruta contra el `ai-api` vivo con firma real**: se probó con `TestClient` firmado (auth, scope, 422, 200) y el
  servicio local ya sirve la ruta (401 sin firma), pero no se hizo una llamada autenticada desde Next.
- **Los tiempos** (0,06 s por evaluación de arco, 0,3–0,9 s de guirnalda) son de una máquina de desarrollo con un
  armado; no hay presupuesto medido en producción.
- **La puerta física con motor en arcos chicos** (arcos de 1,5 m en densidad media o lujosa quedan por debajo del
  mínimo con el motor y no con la fórmula) se reporta por candidato, pero su causa —umbrales calibrados contra la
  fórmula— no se investigó aquí.
- **Los mandos que no se barren** (forma e inflado del arco; grosor, relleno, mezcla de tamaños y ondas de la
  guirnalda; el patrón) sí mueven el total del motor y quedan fuera por costo o por cambiar el diseño.
