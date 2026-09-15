# Prompt de seguimiento · Recolector de imágenes de estructuras (loop autónomo + revisión humana)

> Se ejecuta con `/loop` en Claude Code (ver `COMO-LANZAR` al final). En **cada iteración** relee este archivo y el archivo de estado antes de actuar. Versión: `recolector-imagenes 1.0.0` (2026-09-15).

## Parámetros (edítalos antes de lanzar)

| Parámetro | Valor | Uso |
|---|---|---|
| `DATA_ROOT` | `C:\Users\davidt\Downloads\estructuras-dataset` | Imágenes, manifiesto privado y decisiones. **Fuera del repo.** |
| `RAMA` | `datos/recolector-estructuras` | Rama de trabajo creada desde `2026-09-14` |
| `TOPE_DESCARGAS_ITERACION` | `150` | Archivos descargados como máximo por iteración |
| `TOPE_DESCARGAS_TOTAL` | `2500` | Archivos descargados en toda la corrida |
| `COLA_REVISION_MAX` | `200` | Si hay más imágenes esperando revisión humana, deja de descargar y solo mantiene/mejora lo existente |
| `PUERTO_REVISION` | `4173` | Página local de revisión (`http://127.0.0.1:4173`) |
| `ESTADO` | `docs/planes/estructuras-2026-09/ejecucion/recolector/ESTADO.md` | Memoria entre iteraciones (sin datos personales) |
| `CONTACTO_UA` | `davidt@sempertex.com` | Contacto en el User-Agent de las APIs públicas |

## GOAL

Construir y operar un flujo que **consiga imágenes externas de estructuras de globos con licencia verificada, las proponga en las 16 categorías oficiales y las deje listas para que la persona usuaria las revise** en una página local. Con cada ronda de revisión, el agente aplica las decisiones, regenera las carpetas por clase y enfoca la búsqueda en las clases con más brecha frente a las metas.

**Terminado =** herramienta y página de revisión funcionando con pruebas; metas mínimas por clase alcanzadas **o** fuentes automáticas agotadas (lo que ocurra antes); brechas restantes y lista de decoradores a contactar entregadas; `ESTADO` al día y loop detenido.

## Contexto que debes conocer (resumen; la fuente de verdad son los documentos)

Lee en la primera iteración, y después solo lo que la tarea necesite:
1. `AGENTS.md`.
2. `docs/planes/estructuras-2026-09/README.md` (decisiones DT-1…DT-7).
3. `00-fundamentos-compartidos.md` §4 (taxonomía, árbol, fichas por clase, pares confundibles), §5 (esquema de anotación), §7 (programa de datos).
4. `04-guia-fuentes-externas.md` §2 (semáforo), §3 (consultas por clase), §5 (flujo, manifiesto, pre-clasificación, dedup, splits, carpetas), §6.1 (metas).

### Decisiones del usuario que aplican
- **DT-7:** todas las imágenes de entrenamiento y evaluación vienen de **fuentes externas** (no fotos propias ni de Sempertex), buscando variedad y diseños elaborados.
- **DT-3:** las 16 estructuras oficiales desde el inicio.
- **DT-5:** la IA propone y **una persona revisa**; la persona tiene la última palabra.
- **DT-1/DT-2:** "asimétrico" se llama ahora "orgánico". Orgánico = estructura de globos asimétrica que suele adaptarse al espacio o imitar la naturaleza.

### Las 16 clases (nombre de carpeta = id exacto)
| Id | Qué es | Prioritaria |
|---|---|---|
| `arco` | Banda de globos con 2 apoyos en el nivel inferior unidos por una curva arriba; silueta espejable; densa | Sí |
| `arco_organico` | Arco que cumple la prueba de silueta S1 (un lado visiblemente más grueso, cargado o alto) | Sí |
| `arco_no_denso` | Arco regular con huecos repartidos por los que se ve el fondo | Sí |
| `aro_circular` | Anillo cerrado o casi cerrado cubierto de globos, interior abierto | Sí |
| `semiarco` | Sube desde un apoyo, supera la mitad de la altura y dobla hacia un lado (voladizo fuerte); regular | Sí |
| `semiarco_organico` | Semiarco que además cumple S1 (bordes o tramos claramente desiguales); suele trepar un panel o esquina | Sí |
| `columna` | Pieza vertical, cima sobre la base (voladizo ninguno o leve); regular; densa | Sí |
| `columna_organica` | Columna que cumple S1 | Sí |
| `guirnalda` | Banda horizontal o que sigue un borde (mesa, escalera, parte superior de un marco) sin subir desde el nivel inferior por ambos lados | Sí |
| `columna_no_densa` | Columna regular con huecos donde se ve el tubo o el fondo | No |
| `pared_densa` | Plano vertical de globos relleno, sin fondo visible | No |
| `pared_no_densa` | Plano con fondo visible entre globos (rejilla, malla espaciada) | No |
| `centro_mesa` | Arreglo compacto a escala de mesa sobre una mesa | No |
| `bouquet` | Globos atados individualmente con cinta a un peso o base, o flotando | No |
| `figura` | Forma reconocible de globos: número de mosaico, animal, letra, corazón (sin personajes con licencia) | No |
| `techo_globos` | Instalación suspendida que cubre un área sobre los invitados | No |

Carpetas extra: `otra_estructura_globos/` (canopy, topiario, malla, esfera, marco de fotos: nunca forzarlas a las 16), `negativo/` (inflables publicitarios, aerostáticos, arcos florales sin globos, telas, aros desnudos, luces), `no_determinable/`.

### Reglas de clasificación (Fundamentos §4.1–§4.4)
- **Primero atributos, después clase.** El modelo propone: `forma_cobertura`, `familia`, `apoyos_en_piso`, `forma_superior`, `voladizo_superior`, `contorno` (`regular|organico|indeterminado`), `densidad`, `mezcla_tamanos`, `adapta_al_espacio`, `motivo_natural`, `adornos`, `truncada_por_borde`, `oclusion`, con evidencia breve. **La clase la deriva el código** con el árbol de §4.4 (implementado como tabla/función con pruebas, no con texto libre).
- **Orgánico solo con S1** (reducir la pieza a silueta, reflejarla sobre su eje: arco por el punto medio entre apoyos, columna por el centro de la base; en semiarco comparar borde interior/exterior y tramo inicial/final). **La mezcla de tamaños no es orgánico**; `envolvente_irregular`, adaptación al espacio y motivo natural se registran pero **no deciden**. Sin evidencia clara, `contorno=indeterminado`.
- **Consultas "organic"** traen sobre todo mezcla de tamaños: muchas saldrán `arco`/`columna` con `mezcla_tamanos=mixta`. Es correcto.
- Si un atributo decisivo es `indeterminado` → `candidatos[]` y cola `ambigua_o_abstencion`, nunca una clase inventada.
- Arco cortado por el borde con la curva continuando = `arco` con `truncada_por_borde`, no `semiarco`. Piezas adosadas (foil fijado a otra estructura) son parte de esa estructura.
- Una foto puede tener varias estructuras: registra todas en `clases_presentes[]` y elige `clase_primaria` por área dominante. La foto va a la carpeta de su `clase_primaria`.

### Metas por clase (montajes distintos, no fotos; Guía §6.1)
- Prioritarias (9): meta 150–200, mínimo 90.
- Otras (7): meta 100–120, mínimo 70.
- Negativos difíciles: 8–10 % del total.
- Varias fotos del mismo montaje cuentan como una (`setup_id`).

## Límites duros (no negociables)

**Qué se puede descargar**
- **Wikimedia Commons** vía API (`action=query&prop=imageinfo&iiprop=url|size|sha1|extmetadata`, búsqueda por categorías y `list=search` en el namespace 6). Licencia verificada **por archivo** en `extmetadata` (`LicenseShortName`, `LicenseUrl`, `Artist`, `AttributionRequired`). Solo **CC0, dominio público (PD/PDM) y CC BY**. User-Agent `EstructurasGlobosResearch/1.0 (CONTACTO_UA)`, concurrencia ≤2, `maxlag=5`, reintentos con espera ante 429/503/`maxlag`.
- **Openverse** solo para descubrir: si el origen es Commons, se re-verifica en Commons y se descarga; si es otro sitio, no se descarga.
- **Flickr**: solo descubrir candidatas con licencia CC0, PDM, CC BY 2.0/4.0 (`license=4,9,10,11`) usando la API pública. **No guardes el archivo**: registra `source_page_url`, licencia, autor y la URL estática de vista previa para mostrarla en la revisión (se muestra en vivo desde Flickr, no se copia). La persona decide si la descarga a mano o pide el original.
- **CC BY-SA** → registrar como candidata en `15_quarantine/by-sa-revision-legal/` (metadatos, sin usarla para nada).

**Qué no se descarga nunca**: Pinterest, Instagram, Facebook, TikTok, Google Imágenes, Unsplash, Pexels, Pixabay, bancos de stock, Etsy, Amazon, webs de decoradores o fabricantes; cualquier NC, ND, "fair use", sin licencia o dudosa. No contactes personas ni envíes mensajes. Sí puedes registrar **leads** de decoradores con trabajo elaborado (nombre comercial, URL pública, país, clases que hacen, por qué destacan) usando búsqueda web, sin guardar sus imágenes.

**Qué se excluye o va a cuarentena**: marcas de agua (nunca las quites), texto o logos prominentes, personajes con licencia, menores identificables, personas prominentes, collages, renders o imágenes generadas por IA. Lado menor <1024 px → marcar `baja_resolucion` (sirve para evaluación y detector, no para LoRA). Si dudas, cuarentena con motivo.

**Datos y repo**
- Estructura bajo `DATA_ROOT` exactamente como la Guía §5.8: `00_intake/`, `10_raw/<source_kind>/<batch_id>/` (inmutable), `15_quarantine/<motivo>/`, `20_sanitized/<sha256[0:2]>/<sha256>.jpg`, `40_dedup/`, `50_prelabel/<prompt>@<ver>/<modelo>/`, `60_curated/<clase>/` (vista regenerada; copias, sin symlinks en Windows), `manifests/ingesta-externa.v1.jsonl` y `manifests/events.jsonl`.
- Estados solo por script: `candidata → licencia_verificada → descargada → saneada → qc_ok|cuarentena → dedup_ok → prelabel_ok → revisada → aceptada|excluida|retirada`. **Las carpetas se regeneran desde el manifiesto; nunca mueves archivos a mano.**
- Saneado: orientación EXIF aplicada, metadatos borrados (registra si había GPS), sRGB JPEG; original intacto en `10_raw/`.
- Dedup: sha256 exacto; hash perceptual de 64 bits con **una sola** implementación (`hash_impl` en el manifiesto); d ≤2 se une solo, 3–6 va a la cola `posible_duplicado` de la revisión; agrupa por `setup_id`.
- **Ninguna imagen entra al repo.** Al repo solo van el código de la herramienta, sus pruebas, `ESTADO` y, si se pide, la proyección sin datos personales del manifiesto en `datasets/estructuras/manifests/estructuras-ext/`. Revisa `git status` antes de cada commit.
- Trabaja solo en `RAMA`; nunca commit en `main` ni en `2026-09-14`, nunca push. No toques producción (sin `ssh`, sin despliegues, sin Neon, sin fal, sin Gemini).
- Respeta `AGENTS.md`: CLI separada de la lógica, `--dry-run` por defecto en lo que escriba datos, idempotente por sha256, reanudable, validación en tiempo de ejecución, dependencias bloqueadas.

**Pre-clasificación**
- Con **subagentes de Claude** (modelo `sonnet`) que leen las imágenes saneadas en lotes de 10–20, con el prompt de la Guía §5.4 **versionado** (semver + sha256, generado desde la taxonomía) y salida JSON validada contra esquema. **No uses Gemini** (es el sistema que se evalúa en el Plan A).
- Solo imágenes con `envio_proveedores_ia_permitido=true` (Commons CC0/PD/BY lo cumplen por licencia pública; regístralo con esa base). Las de Flickr no descargadas no se pre-clasifican: van a revisión como "vista previa en vivo".
- **10 % ciego**: si `sha256 mod 10 == 0`, se marca **antes** de pre-clasificar y la página la muestra sin propuesta.
- Las propuestas son **candidatas de curación**, no verdad terreno: no sirven para medir exactitud ni para entrenar el detector del Plan C sin la revisión humana.

## Herramienta a construir (T1–T3)

Ubicación: `tools/dataset-estructuras-ext/` (Python con `uv`, `pyproject.toml` + `uv.lock`; Pillow e ImageHash; librería estándar para el servidor). Comandos CLI, todos con `--dry-run` por defecto y `--apply` para escribir:

| Comando | Qué hace |
|---|---|
| `buscar --clase <id> --fuente commons|openverse|flickr` | Consultas de la Guía §3.2 (EN y ES) con exclusiones (`-"hot air" -inflatable`), registra `candidata` |
| `verificar-licencias` | Lee `extmetadata`/API, decide verde/BY-SA/rojo, guarda snapshot de la licencia |
| `descargar` | Solo verdes de Commons, respeta topes |
| `sanear`, `qc`, `dedup` | Según límites duros |
| `prelabel-exportar` / `prelabel-importar` | Lotes para los subagentes y validación de su JSON |
| `derivar` | Atributos → clase con el árbol (§4.4) y reglas de S1 |
| `curar` | Regenera `60_curated/` desde el manifiesto |
| `cobertura` | Tabla por clase: aceptadas (montajes), pendientes, excluidas, meta y brecha |
| `revisar` | Levanta la página local en `PUERTO_REVISION` |

**Página de revisión (lo que usa la persona usuaria):**
- Pestañas: `Cola de revisión`, `Por clase` (una grilla por cada una de las 16 + extras), `Posibles duplicados`, `Flags de riesgo`, `Flickr (vista previa)`, `Cobertura`.
- Cada tarjeta: imagen (o vista previa en vivo si es Flickr), clase propuesta y candidatos, atributos clave (familia, apoyos, forma superior, contorno con evidencia de S1, densidad, mezcla de tamaños), licencia con enlace a la página de origen y autor, resolución, flags.
- Acciones con teclado y ratón: **A** aceptar, **1–9 / selector** cambiar clase (lista de 16 + extras), **E** excluir (con motivo: licencia, calidad, duplicado, no es estructura, riesgo), **N** no determinable, **D** marcar mismo montaje que otra, **←/→** navegar. Filtros por clase, fuente, prioridad y estado.
- Cada decisión se escribe al instante como evento en `manifests/events.jsonl` (`decision`, `clase_final`, `atributos_corregidos`, `motivo`, `revisor=usuario`, `ts`). Nada se borra; una decisión nueva reemplaza a la anterior.
- Accesible y usable en una pantalla de portátil; sin dependencias de CDN (todo local); solo escucha en `127.0.0.1`.

## Backlog

| Id | Tarea | Hecho cuando |
|---|---|---|
| T0 | Si hay cambios sin commit en el árbol, no los toques: `BLOQUEADA` y avisa. Si está limpio: crear `RAMA`, `ESTADO`, verificar que `DATA_ROOT` existe y está fuera del repo | Rama y `ESTADO` commiteados |
| T1 | Esqueleto de la herramienta, manifiesto (esquema validado, campos de la Guía §5.2) y eventos; pruebas deterministas de verificación de licencias (casos CC0, PD, BY, BY-SA, NC, ND, sin licencia), saneado EXIF y dedup | Pruebas verdes; `--dry-run` revisado |
| T2 | `derivar`: árbol §4.4 y reglas §4.3 como código con pruebas por clase (al menos un caso positivo y uno de desempate por cada par confundible de §4.6) | Pruebas verdes |
| T3 | Página de revisión con pruebas del servidor (escritura de eventos, idempotencia, rechazo de rutas fuera de `DATA_ROOT`) | Página levanta y registra decisiones |
| T4 | Primera ronda: Commons en las 16 clases (priorizando las de "muy baja" disponibilidad), verificación, descarga, saneado, QC, dedup, pre-clasificación, `curar`, `cobertura` | Cola de revisión con ≥1 imagen por clase disponible; tabla de cobertura en `ESTADO` |
| T5 | Flickr (solo descubrimiento) y Openverse; leads de decoradores (≥50, ≥3 países, empezando por no densas, orgánicas, aro y techo) en `00_intake/leads_permisos.csv` | Candidatas y leads registrados |
| T6 | Ciclo continuo (iteraciones siguientes): aplicar decisiones nuevas → `curar` → `cobertura` → buscar donde la brecha es mayor → pre-clasificar → avisar en `ESTADO` cuántas esperan revisión. Respeta `COLA_REVISION_MAX` | Metas mínimas alcanzadas o fuentes agotadas por clase |
| T7 | Cierre: informe de cobertura final, clases que necesitan permisos o encargos, métricas de la muestra ciega (acuerdo de la propuesta con la decisión humana por clase), recomendaciones de ajuste del prompt (solo aplicables en `dev`) | Informe en `ejecucion/recolector/informe-final.md`; loop detenido |

## Protocolo de cada iteración

1. Relee este archivo y `ESTADO`. Si `ESTADO` dice `COMPLETADO`, detén el loop.
2. Si hay decisiones humanas nuevas en `events.jsonl`, aplícalas primero (`curar`, `cobertura`).
3. Toma la siguiente tarea pendiente cuyas dependencias estén cumplidas y avanza un bloque verificable.
4. Antes de descargar o escribir datos, ejecuta `--dry-run` y registra lo que haría.
5. Verifica: pruebas de la herramienta (`uv run pytest` en `tools/dataset-estructuras-ext/`), y `npm run lint`/`npx tsc --noEmit` solo si tocaste TS. Reporta resultados reales.
6. Commit en `RAMA` (mensaje convencional en español) solo de código, pruebas y `ESTADO`.
7. Actualiza `ESTADO`: tarea, evidencia, descargas usadas/topes, cobertura por clase (tabla), cola pendiente de revisión, próximos pasos, bloqueos. **Sin nombres de personas ni URLs de perfiles** (eso vive solo en `DATA_ROOT`).
8. Ritmo:
   - trabajo inmediato disponible → siguiente iteración en 60–120 s;
   - límites de tasa de una API → 20–30 min;
   - cola de revisión ≥ `COLA_REVISION_MAX` y nada más que hacer → iteración cada 30–60 min solo para aplicar decisiones; escribe en `ESTADO` "esperando revisión humana: N imágenes en http://127.0.0.1:4173";
   - metas alcanzadas o fuentes agotadas → T7 y detener.

Si una tarea falla dos iteraciones seguidas por la misma causa, márcala `BLOQUEADA` con diagnóstico y sigue con otra.

---

## COMO-LANZAR

Para la persona que lanza el loop (no es instrucción del agente):

1. Crea la carpeta `C:\Users\davidt\Downloads\estructuras-dataset`.
2. Abre una terminal en la raíz del repo, en la rama `2026-09-14` con el árbol limpio, y arranca `claude --model claude-opus-5`.
3. En la sesión: `/effort xhigh`. Aprueba en `/permissions` `git`, `uv`, `python`, `curl` y `node`, o arranca con `--permission-mode acceptEdits`. No uses `--dangerously-skip-permissions`.
4. Lanza:
   `/loop Ejecuta una iteración del protocolo de docs/planes/estructuras-2026-09/prompts/recolector-imagenes-loop.md. Relee ese archivo y el ESTADO antes de actuar.`
5. Cuando `ESTADO` diga que hay imágenes esperando, abre `http://127.0.0.1:4173` y revisa. Tus decisiones se aplican solas en la siguiente iteración.
6. Para detenerlo: Esc o "detén el loop".
