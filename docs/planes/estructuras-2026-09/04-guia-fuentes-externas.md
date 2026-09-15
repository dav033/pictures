# Guía de fuentes externas para las 16 estructuras de globos

**Fecha:** 2026-09-15. Todas las fuentes se revisaron ese día. Las que se volvieron a comprobar para esta síntesis llevan la marca "re-verificada" en el Anexo B.

**Convenciones:**
- **[E]** estimación, **[P]** propuesta.
- **[F#]** remite a una fuente del Anexo B.
- Confianza: **A** = texto primario leído; **M** = fragmento de buscador, fuente secundaria o lectura vía resumidor; **B** = inferencia.

**Esto no es asesoría legal.** Sirve para decidir con el menor riesgo razonable y marca lo que debe revisar un abogado.

---

## 1) Resumen y política recomendada

1. **Base (≈80–90 % [E]):** permiso escrito de decoradores o fotógrafos titulares para entrenar, evaluar y enviar a proveedores de IA. Colombia no tiene excepción legal para entrenar IA [F22]; México tampoco [F25].
2. **Complemento (≈5–15 % [E]):** Commons CC0, PDM o CC BY verificadas archivo por archivo [F6][F7]; Flickr CC solo con verificación o confirmación del autor [F9].
3. **Huecos** (techo, aro, no densas, semiarcos): sesiones de fotos pagadas en eventos reales o encargos; stock de datos solo si la cotización lo justifica [F14][F16].
4. **Rojo también para evaluar:** stock estándar [F12]–[F16], Unsplash [F4], Pexels/Pixabay sin permiso [F2][F3], redes y marketplaces sin permiso [F19]–[F21], NC/ND [F1], marcas de agua [F26], menores [F24].
5. **Evaluación con el mismo estándar verde,** disjunta del entrenamiento por montaje y por titular.
6. **Manifiesto por imagen obligatorio:** fal hace responsable al cliente de los derechos del input e indemnización [F30].
7. **Esta semana:** plantilla de permiso al abogado; mientras tanto, leads y candidatas de Commons.

---

## 2) Semáforo de fuentes

**Leyenda:**
- 🟢 se puede usar si se cumple la condición;
- 🟡 solo con la condición indicada o tras revisión legal, y no es prioritario;
- 🔴 no se usa.

"LoRA" es el generador (fal.ai FLUX.2). "Detector" es Gemini, RF-DETR o equivalente.

| Fuente | Entrenar LoRA | Entrenar detector | Solo evaluación | Condición / motivo | Cita |
|---|---|---|---|---|---|
| Decorador o fotógrafo **titular** con permiso escrito (plantilla §4) | 🟢 | 🟢 | 🟢 | Si decorador y fotógrafo son personas distintas, deben firmar ambos o el firmante debe declarar que tiene la cesión | [F22] |
| Encargo pagado con cesión de derechos | 🟢 | 🟢 | 🟢 | Contrato con cesión o licencia para IA | [F22] |
| Instagram, TikTok, Pinterest o la web de un decorador, **con** permiso escrito del autor | 🟢 | 🟢 | 🟢 | La plataforma sirve solo para encontrarlo; el autor entrega el archivo original | [F19][F20][F21] |
| Wikimedia Commons CC0, PDM o CC BY | 🟢 (🟡 si el diseño es de un tercero identificable) | 🟢 | 🟢 | La licencia está en la página de cada archivo y Commons no la garantiza; guardar la atribución en el manifiesto | [F6][F7][F1] |
| Commons o Flickr **CC BY-SA** | 🟡 hasta revisión legal; excluir si se publican los pesos | 🟢/🟡 | 🟢 | ShareAlike obliga a compartir las adaptaciones con la misma licencia | [F1] |
| Flickr CC0, PDM, CC BY 2.0 y 4.0 | 🟡 | 🟡 | 🟡 | Licencias a veces mal asignadas. Los términos de la API prohíben guardar fotos "other than for reasonable periods" y exigen retirarlas en 24 h si el dueño lo pide. Pasa a 🟢 si el fotógrafo lo confirma por correo | [F9][F10] |
| Open Images V7 | 🔴 (baja calidad para LoRA) | 🟡 negativos y bouquet | 🟡 | Las imágenes figuran como CC BY 2.0; hay que verificar cada una | [F57] |
| Openverse | Según la fuente de origen | Según la fuente de origen | Según la fuente de origen | No verifica licencias; usarlo solo como buscador | [F11] |
| Licencia de datos pagada: Shutterstock datasets, Vecteezy Enterprise + Data Training License, 123RF, datasets de Depositphotos, Getty por acuerdo | 🟢 condicional | 🟢 condicional | 🟢 condicional | El contrato debe cubrir el uso comercial del modelo y la evaluación. Según un fragmento de buscador, las licencias de datos de Shutterstock tienen restricciones de uso comercial: leer el contrato | [F13][F14][F16][F17][F18] |
| Unsplash **Lite Dataset** (25k imágenes) | 🟡 | 🟡 | 🟡 | Permite entrenar "for your internal business purposes" y prohíbe redistribuir. Se esperan pocas estructuras de globos [E] | [F5] |
| Pexels / Pixabay | 🔴 salvo permiso | 🔴 salvo permiso | 🔴 salvo permiso | Prohíben el scraping "including… for machine learning purposes" y la copia "bulk, large-scale or systematic" sin permiso. Pasa a 🟢 con permiso escrito de la plataforma o del fotógrafo | [F2][F3] |
| Unsplash (web o API) | 🔴 | 🔴 | 🔴 | Terms §8 prohíbe usar las imágenes en datasets de ML | [F4] |
| Adobe Stock, Getty/iStock, Shutterstock, Freepik/Magnific y Vecteezy con licencia estándar | 🔴 | 🔴 | 🔴 | Adobe prohíbe "create, train, test"; Getty, cualquier propósito de ML, incluido "training, fine-tuning"; Magnific, "any machine learning"; Vecteezy, "data training" sin la licencia de datos | [F12][F13][F14][F15][F16] |
| Depositphotos con licencia estándar / Dreamstime | 🔴 hasta confirmar | 🔴 | 🔴 | La licencia de Depositphotos no menciona el entrenamiento; los términos de Dreamstime no se pudieron leer | [F18] |
| Pinterest, Instagram, Facebook, TikTok o Google Imágenes **sin** permiso | 🔴 | 🔴 | 🔴 | Los derechos son de quien sube la foto y los términos prohíben la recolección automatizada. Usar solo para encontrar decoradores | [F19][F20][F21] |
| Etsy / Amazon | 🔴 | 🔴 | 🔴 | Fotos de vendedores; Amazon excluye la minería de datos (M) | [F58] |
| Web de un decorador sin permiso | 🔴 | 🔴 | 🔴 | Sin licencia expresa, en Colombia hace falta autorización previa y expresa | [F22] |
| Galerías de fabricantes (Qualatex, Gemar, Sempertex…) | 🔴 | 🔴 | 🔴 | Sus términos restringen la reproducción (M). Además, Sempertex queda excluido por decisión del usuario | [F42] |
| Cualquier CC **NC** o **ND** | 🔴 | 🔴 | 🔴 | NC: "all stages… must not be for commercial gain"; ND: "not be used as training data" | [F1] |
| Imagen con marca de agua (de cualquier fuente) | 🔴 | 🔴 | 🔴 | Descartar sin limpiar: quitar información de gestión de derechos es ilícito en EE. UU. | [F26][F27] |
| Personajes con licencia (Disney, Pokémon…) o logos de terceros | 🔴 | 🟡 solo para bloquearlos | 🟡 | Riesgo de marca y de copyright en las salidas | [F27][F28] |
| Menores identificables | 🔴 | 🔴 | 🔴 | El art. 7 de la Ley 1581 proscribe tratar datos de menores salvo los de naturaleza pública | [F24] |
| Adultos identificables | 🔴 si son prominentes | 🟡 difuminados | 🟡 difuminados | Las fotos de personas identificables son datos personales | [F24] |
| Imágenes generadas por IA | 🔴 | 🔴 | 🔴 | No son fotos reales | — |

**Por qué la evaluación no tiene un estándar más laxo:**
- Adobe nombra expresamente "test" [F12] y Vecteezy "evaluate" [F16].
- El set de evaluación acaba en informes y demos.
- Un set rojo de evaluación también se sube a Gemini o a fal para medir, lo que exige tener derechos [F30].

Por eso las redes sin permiso quedan 🔴 también para evaluar, aunque un informe las calificaba 🟡 para uso interno (ver Anexo A).

---

## 3) Dónde buscar cada una de las 16 estructuras

### 3.1 Cómo usar las consultas

- **Con permiso** (la vía principal): buscar en Instagram, Pinterest, TikTok y Google con las consultas de abajo **solo para encontrar decoradores**. Se les pide permiso y ellos entregan los archivos originales. No se descarga nada de esas plataformas [F19][F20].
- **CC:** buscar en Wikimedia Commons (categorías y búsqueda) y en Flickr con el filtro de licencias libres. Confirmar la licencia en la página de cada archivo [F6][F9].
- **Exclusiones útiles:** `-"hot air" -aerostático -inflable -inflatable`. "Balloon arch" en Commons trae muchos arcos inflables publicitarios y globos aerostáticos. En una muestra de las 50 primeras de 4.578 coincidencias, solo 10–12 eran estructuras de globos (conteo del informe de flujo, M).

**Canales generales para encontrar decoradores con trabajo elaborado:**

| Canal | Para qué | Cita |
|---|---|---|
| Qualatex Balloon Pro Finder | Directorio de profesionales en EE. UU. y LATAM | [F38] |
| Balloon HQ Decorator Directory | Directorio. Según su página de copyright, las fotos son de quien las aporta: pedir permiso a cada autor | [F39] |
| NABAS (Reino Unido) | Directorio de miembros | [F40] |
| The Balloon Guild | Comunidad de decoradores | [F41] |
| FLOAT Convention (FLOATEE Awards) | 33 categorías, entre ellas Arch Design, Column Design, Ceiling Decor, Organic Decor, Table Centerpiece, Sculpture, Backdrop or Wall Design, Mural Design y Entrance Decor. Pedir que difundan la convocatoria; el organizador no puede sublicenciar las fotos de los participantes (M) | [F37] |
| Sempertex "artistas de globos", CIG, Encuentro Creativo (LATAM) | Solo como canal hacia artistas independientes. **Decisión pendiente del usuario (`Q-31`):** confirmar que una foto propia de un artista certificado por Sempertex cuenta como "externa" | [F42] |

### 3.2 Tabla por estructura

**Prioridad de búsqueda** (agrupación operativa de esta guía): 9 clases prioritarias y 7 "otras". Los fundamentos (§7.7) fijan para `gold_eval` 50 instancias efectivas en **las 16** clases y 100 en `arco`, `aro_circular`, `semiarco`, `semiarco_organico`, `columna` y `columna_organica`; las clases que no lleguen se reportan sin compuerta.

**Disponibilidad en fuentes libres [E]:** estimación de los informes a partir de sondeos de volumen [F8][F58].

| Clase | Prio. | Disponibilidad libre [E] | Fuentes y canales específicos | Consultas EN | Consultas ES |
|---|---|---|---|---|---|
| `arco` | Sí | Media (la más alta) | Commons (categoría Balloon arches: 79 archivos, más 148 en la subcategoría de EE. UU.) [F8]; Flickr CC; FLOAT Arch Design [F37] | classic balloon arch, spiral balloon arch, quad balloon arch, balloon archway entrance, square pack arch | arco de globos clásico, arco espiral de globos, arco de globos entrada |
| `arco_organico` | Sí | Baja | Decoradores de eventos sociales; FLOAT Organic Decor | organic balloon arch, deconstructed balloon arch, asymmetrical balloon arch, balloon garland arch with greenery | arco orgánico de globos, arco desestructurado de globos, arco asimétrico de globos |
| `arco_no_denso` | Sí | Muy baja | Flickr CC (eventos y desfiles); pedirlo expresamente a decoradores | string of pearls balloon arch, spaced balloon arch, linked balloon arch, single-line balloon arch | arco de globos collar de perlas, arco de globos espaciado, arco de globos lineal |
| `semiarco` | Sí | Baja | FLOAT Arch Design; decoradores de mesas de postres | half balloon arch, demi arch balloon, half arch balloon backdrop | medio arco de globos, semiarco de globos |
| `semiarco_organico` | Sí | Muy baja | Decoradores de baby shower y mesas de postres | organic half arch balloons, L-shaped balloon garland, corner balloon garland, balloon garland over backdrop | semiarco orgánico de globos, guirnalda en L, guirnalda sobre panel |
| `columna` | Sí | Media | Commons y Flickr CC ("balloon column": 66 resultados CC en Flickr, M) [F58] | balloon column, spiral balloon column, balloon pillar, balloon tower | columna de globos, columna espiral de globos, torre de globos |
| `columna_organica` | Sí | Muy baja | FLOAT Organic Decor y Column Design | organic balloon column, deconstructed balloon column, garland column balloons | columna orgánica de globos, columna desestructurada |
| `columna_no_densa` | No | Muy baja | Flickr CC; pedirlo expresamente | spaced balloon column, string of pearls balloon column, balloon topiary, balloon totem | columna de globos espaciada, topiario de globos |
| `pared_densa` | No | Media en stock, baja en CC | FLOAT Backdrop or Wall Design y Mural Design; decoradores | balloon wall, square pack balloon wall, balloon mosaic wall, balloon backdrop wall | pared de globos, muro de globos, mosaico de globos |
| `pared_no_densa` | No | Muy baja | Decoradores; espacios para fotos (photo op) | balloon grid backdrop, open balloon wall, balloon curtain backdrop, balloon frame backdrop | pared de globos calada, cortina de globos, marco de globos |
| `guirnalda` | Sí | Media en stock, baja en CC ("balloon garland": 17 resultados CC en Flickr y 0 en Commons, M) | Decoradores (muy abundante) | balloon garland, organic balloon garland, balloon garland table, balloon swag | guirnalda de globos, guirnalda orgánica de globos, guirnalda para mesa |
| `centro_mesa` | No | Baja | FLOAT Table Centerpiece | balloon centerpiece, table balloon centerpiece, mini balloon garland centerpiece | centro de mesa con globos, centro de mesa de globos |
| `bouquet` | No | Media | Flickr CC; Open Images (solo detector) [F57] | balloon bouquet, helium balloon bouquet, bubble balloon bouquet, balloon delivery arrangement | bouquet de globos, ramo de globos, arreglo de globos |
| `figura` | No | Media (festivales) | Flickr CC; FLOAT Sculpture. **Excluir personajes con licencia** | balloon sculpture, large balloon sculpture, balloon mosaic number, balloon animal sculpture | escultura de globos, figura de globos, número de globos |
| `aro_circular` | Sí | Muy baja | Decoradores; FLOAT Backdrop o Entrance | balloon hoop, balloon ring backdrop, circle balloon arch, round backdrop balloon garland | aro de globos, arco circular de globos, panel redondo con globos |
| `techo_globos` | No | Muy baja | FLOAT Ceiling Decor; decoradores de salones | balloon ceiling, balloon canopy, floating balloon ceiling, balloon ceiling grid | techo de globos, cielo de globos, globos en el techo |

**Notas de etiquetado:**
- Un "Chiara wall" (panel con guirnalda) no es `pared_densa`; si es `guirnalda` o `semiarco` (y si es orgánico) lo decide el árbol de los fundamentos (§4.3–§4.4, `DP-03`, `Q-24`), no esta guía (M, terminología del informe de catálogo).
- **Consultas con "organic":** en el mercado "organic" suele significar mezcla de tamaños (`Q-27`). Sirven para encontrar candidatas, pero la clase `*_organico` solo se asigna si cumple S1; muchas saldrán `arco`/`columna` con `mezcla_tamanos=mixta`.
- **Negativos difíciles** (8–10 % del total [P]; los fundamentos piden 0–10 % [F56]): arcos inflables publicitarios, globos aerostáticos, arcos florales, backdrops de tela, aros metálicos sin globos, guirnaldas de luces, pompones de papel y globos sueltos en el techo.
- **Clases con más riesgo de no llegar a la meta sin pagar:** `arco_no_denso`, `columna_no_densa`, `pared_no_densa`, `semiarco_organico`, `columna_organica`, `aro_circular` y `techo_globos` [E]. Conviene pedirlas desde la primera semana en cada contacto.

---

## 4) Cómo pedir permiso a decoradores

### 4.1 Orden de contacto [P]

1. Decoradores que **fotografían su propio trabajo**, para evitar la doble cadena de derechos entre fotógrafo y diseñador [F22].
2. Academias y decoradores con portafolios grandes y variados (≥3 países en total; ninguno >50 %).
3. Fotógrafos de eventos. En este caso, pedir también el visto bueno del decorador.
4. Convocatoria vía FLOAT o comunidades, con un formulario de alta [F37].

### 4.2 Plantilla breve (primer mensaje, ES)

> Hola [nombre]. Soy [nombre] de [empresa]. Estamos desarrollando una herramienta de IA que ayuda a diseñar y cotizar decoración con globos, y nos encantó tu trabajo en [montaje concreto].
>
> ¿Nos autorizarías a usar algunas fotos de tus montajes **solo para entrenar y evaluar nuestros modelos**? No las publicaremos ni las revenderemos, y no usaremos tu nombre para imitar tu estilo.
>
> Te pedimos:
> 1. las fotos originales, idealmente de al menos 1024 px por lado;
> 2. que sean tuyas, o que tengas permiso del fotógrafo;
> 3. que no aparezcan menores reconocibles.
>
> A cambio ofrecemos [crédito en nuestra página de colaboradores / US$__ por montaje aceptado / acceso anticipado]. Si aceptas, te envío un acuerdo de una página para firmar en línea. Puedes pedir que retiremos tus fotos cuando quieras.
>
> Nos interesan sobre todo arcos y columnas espaciadas, techos de globos, aros y semiarcos orgánicos.

**Versión EN (corta):**

> Hi [name], I'm [name] from [company]. We're building an AI tool that helps design and quote balloon décor. Would you license some photos of your setups **only to train and evaluate our models**? We won't publish or resell them or market "your style". You'd confirm you own the photos (or have the photographer's OK) and that no identifiable minors appear. In return: [credit / US$__ per accepted setup / early access]. You can ask us to remove them at any time. I'll send a one-page agreement to sign online.

### 4.3 Qué debe quedar escrito en el acuerdo

La lista combina los tres informes y está pendiente de revisión legal.

1. **Partes e imágenes:** lista de archivos con sha256 o enlace de entrega, más `setup_id` y fecha del evento.
2. **Garantía de titularidad:** el firmante tiene los derechos de la **foto** y del **diseño**, o la cesión del otro titular. Motivo: en Colombia hace falta la autorización del titular de los derechos patrimoniales [F22], y una licencia del fotógrafo podría no cubrir el diseño del decorador (confianza B).
3. **Personas:** los adultos visibles consintieron o se aceptan difuminado y exclusión; no hay menores identificables [F24].
4. **Licencia:** no exclusiva, mundial, sin límite de tiempo (o N años), con precio o gratuita. Cubre:
   - copiar, almacenar, recortar, redimensionar y anotar;
   - **entrenar, afinar y evaluar** modelos generativos y de reconocimiento;
   - explotar comercialmente los modelos y sus salidas.
5. **Proveedores:** autoriza enviar las imágenes a proveedores de IA y nube para procesarlas: fal.ai, Google (Gemini) y el proveedor de pre-etiquetado. Es necesario porque fal exige que el cliente tenga "all rights… necessary to grant the license" sobre el input [F30].
6. **Sin redistribución pública** de las fotos. Usarlas en marketing o demos requiere una cláusula aparte, con crédito.
7. **Crédito opcional.** En Colombia los derechos morales son irrenunciables [F22], así que se ofrece la mención.
8. **Retiro:** se borran de los datasets activos en **≤15 días** y se excluyen del siguiente reentrenamiento, sin obligación de destruir modelos ya entrenados. Decirlo de forma explícita.
9. **No imitación nominal:** el producto no ofrecerá "estilo de [decorador]" ni usará su nombre en prompts o captions.
10. **Datos personales:** aviso de privacidad (Ley 1581 en Colombia [F24]; LFPDPPP si hay titulares mexicanos), ley aplicable, fecha y firma o aceptación electrónica con registro (IP, fecha y correo).

### 4.4 Evidencia

- Guardar el PDF firmado, el correo o el JSON del formulario en un almacenamiento privado, con su sha256 y un `permission_id`.
- Nunca guardar en el repo nombres ni contactos, solo seudónimos (`t017`).

### 4.5 Contraprestación (decisión de negocio)

| Opción | Costo | Efecto esperado [E] |
|---|---|---|
| Crédito y visibilidad | US$0 | Menor tasa de aceptación |
| Pago por montaje aceptado | US$2–10 por imagen o montaje (estimación del informe de catálogo). Referencias de mercado: US$1–2 por imagen en datos licenciados generales (M) [F44]; US$0,30–1,50 por imagen para usos de generación (A según el informe) [F43] | Más respuestas y portafolios completos |
| Pago por sesión de fotos en un evento real ya contratado (para clases raras) | US$50–150 por montaje [E, sin fuente] | Montajes nuevos sin pagar la decoración |

---

## 5) Flujo de recolección y curación

### 5.1 Estados (solo avanzan por script)

`candidata → licencia_verificada → descargada/entregada → saneada → qc_ok | cuarentena → dedup_ok → prelabel_ok → revisada → aceptada | excluida | retirada`

- El **manifiesto manda**: las carpetas por clase se regeneran desde él y nunca se mueven archivos a mano.
- El repo ya sigue esa convención: `data/raw → data/quarantine → data/sanitized`, con manifiestos JSONL versionados en `data/manifests/` [F56].

### 5.2 Manifiesto

**Dos niveles:**
- `ingesta-externa.v1.jsonl` (**privado**, con datos personales), en almacenamiento privado.
- Proyección **sin datos personales** en `datasets/estructuras/manifests/estructuras-ext/<dataset_id>.jsonl`, que sí va al repo (ubicación única de fundamentos §7.8, `DP-09`; `/data/*` está ignorado por git).

**Campos mínimos por imagen** (unión de los informes):

| Grupo | Campos |
|---|---|
| Identidad y archivo | `image_id`, `sha256` (archivo saneado), `sha256_original`, `dhash64`, `phash64`, `hash_impl`, `width_px`, `height_px` |
| Origen | `source_kind` (`permiso_titular` \| `cc_commons` \| `cc_flickr` \| `encargo_externo` \| `stock_licencia_ia`), `source_page_url`, `source_file_url`, `retrieved_at`, `retrieval_method` (`manual` \| `api` \| `entrega_titular`) |
| Derechos | `rights_holder_id`, `photographer_id`, `decorator_id` (seudónimos), `license_id` + versión, `license_url`, `license_snapshot_sha256` (captura o Wayback de la licencia o los términos del día), `permission_id`, `permission_evidence_sha256`, `usos_permitidos[]`, `envio_proveedores_ia_permitido`, `attribution_text` |
| Montaje | `setup_id` (= `event_cluster_id`), `dedup_cluster_id` |
| Riesgo | `personas` (`none` \| `blurred` \| `consented`), `menores_visibles`, `watermark_flag`, `logos_flag`, `licensed_character_flag`, `ai_generated_flag` |
| Curación | `clase_primaria`, `clases_presentes[]`, `nivel_elaboracion` (1–3), `tipo_foto` (profesional \| celular), `entorno`, `angulo`, `familia_color[]`, `estado`, `motivos_exclusion[]`, `ciego`, `split`, `split_regla`, `taxonomy_version` |
| Trazabilidad | `used_in[]` (p. ej. `lora_v3`, `detector_v1`), `takedown_status` |

**Cabecera de la hoja `candidatos`** (fase manual, antes de descargar):

```
capturado_en,url_pagina,titulo,autor_visible,licencia_url_declarada,og_image,clase_candidata,nota,plataforma,capturado_por,estado
```

La hoja privada tiene tres pestañas más: `leads_permisos` (acceso restringido), `registro_permisos` y `candidatos`.

### 5.3 Herramientas

| Paso | Herramienta | Nota | Cita |
|---|---|---|---|
| Captura al navegar | Bookmarklet (abajo) + hoja privada | Solo metadatos; la licencia capturada es la declarada y se verifica después | — |
| Verificar y descargar Commons | API `prop=imageinfo&iiprop=extmetadata` (`LicenseShortName`, `LicenseUrl`, `Artist`, `AttributionRequired`) | User-Agent descriptivo, concurrencia ≤2, respetar `maxlag` | [F54] |
| Flickr | Solo para descubrir y leer la licencia (`license=4,9,10,11`) | No guardar fotos vía API; pedir el archivo al fotógrafo o descargarlo a mano tras verificar | [F9] |
| Saneado | Python con Pillow (o sharp) | Aplicar la orientación EXIF, borrar metadatos (el GPS se registra antes), pasar a sRGB; lado menor <1024 px → cuarentena **para LoRA** (la política 768–1023 la decide el Plan B, B2.2); sigue siendo apta para detector y evaluación | — |
| QC | MediaPipe Face Detector (caras), detector de marcas de agua de LAION (MIT), OCR | Solo marca; decide un humano | [F52][F53] |
| Dedup | ImageHash (BSD-2) o una sola implementación; FiftyOne para casi-duplicados y fugas entre splits | Ver §5.6 | [F50][F51] |
| Clasificación por imagen | Página interna mínima con atajos de teclado, o Label Studio Community (la elección única es `DP-08`, fundamentos §7.5; esta fila es un insumo) | Label Studio Community (Apache-2.0) no trae flujo de revisor, métricas de acuerdo ni overlap: κ por script | [F48] |
| Cajas por instancia | CVAT Community (MIT) | El auto-etiquetado SAM integrado es de pago; conectar modelo propio | [F49] |
| Scripts | `tools/dataset-estructuras-ext/` [P], Python con dependencias bloqueadas | Según `AGENTS.md`: CLI separada de la lógica, `--dry-run` por defecto, idempotentes por sha256, reanudables | [F56] |

**Bookmarklet** (copia una fila para la hoja; no descarga nada):

```javascript
javascript:(()=>{const q=s=>document.querySelector(s);const lic=[...document.querySelectorAll('a[rel~=license],a[href*="creativecommons.org/"]')].map(a=>a.href)[0]||'';const au=((q('meta[name=author]')||{}).content||(q('[rel=author]')||{}).textContent||'').trim();const img=(q('meta[property="og:image"]')||{}).content||'';const c=prompt('Clase candidata | nota','')||'';const row=[new Date().toISOString(),location.href,document.title.replace(/[\t\n]/g,' '),au,lic,img,c,'',location.hostname,'','candidata'].join('\t');prompt('Ctrl+C y pegar en la hoja:',row);})();
```

En Instagram o en webs de decoradores, lo que se registra es el **lead** en `leads_permisos`, no la imagen.

### 5.4 Pre-clasificación con IA

- **La IA propone atributos y el código deriva la clase.** El modelo responde con familia, soporte, contorno (regular u orgánico **solo con la prueba de silueta S1**, única señal decisiva; `envolvente_irregular`, adaptación al espacio R1 y motivo natural R2 se registran pero no deciden; fundamentos §4.3), densidad, etc. La clase oficial sale de la tabla de derivación de los fundamentos [F56]. Las abstenciones son válidas.
- **Colas de revisión:**
  - `negativo_probable`
  - `clase_clara`
  - `ambigua_o_abstencion`
  - `desacuerdo_modelos`
  - `flags` (personas, marca de agua, collage, sospecha de IA)
- **Restricción del Plan C:** los términos de Gemini y Anthropic prohíben usarlos para entrenar modelos que compitan; hasta que legal responda `QC-11`, las imágenes que vayan a `entrenamiento` del detector se pre-etiquetan con modelos abiertos locales (Plan C, C1.3). Esta pre-clasificación de curación no sustituye esa regla.
- **Familia de modelos distinta de la evaluada.** El Plan A evalúa Gemini, así que pre-etiquetar con Gemini sesgaría la comparación a su favor [P].
  - Aviso: Anthropic desarrolla el modelo que redactó esta guía. Cualquier familia distinta de Gemini cumple el criterio.
- **Solo nivel de pago.** En el nivel gratuito de Gemini, el contenido se usa para mejorar productos [F33][F34]. Anthropic declara que no usa las imágenes subidas para entrenar modelos [F36].
- **Solo imágenes con `envio_proveedores_ia_permitido=true`,** con las caras difuminadas antes del envío.
- **Prompt versionado** (semver + sha256) y generado desde la taxonomía. Boceto de estructura:

```
[prelabel-curacion-estructuras 0.1.0 | taxonomy estructuras-2.0.0]
Pre-sort balloon decoration photos for human review. Never output an official class name. Abstain when unsure.
STEP 1 assembled_balloon_structure: si|no|indeterminado (hard negatives: hot-air balloons, inflatable ad arches,
  floral arches, fabric backdrops, bare hoops, string lights, paper pompoms, loose balloons).
STEP 2 up to 4 salient pieces, ATTRIBUTES ONLY: familia, soporte, apoyos_en_piso, forma_superior, contorno
  (organico only with S1 silhouette asymmetry of the whole piece; record irregular_envelope, adapts_to_space (R1) and natural_motif (R2) separately, they never decide; mixed balloon sizes are NOT organic), densidad
  (no_densa only if background visible through gaps along most of the piece), area_share, evidencia (<=20 words).
STEP 3 image: tipo_foto, entorno, angulo, familia_color, nivel_elaboracion 1-3,
  flags {marca_agua, texto_o_logo, collage, render_o_ia, personas_prominentes, menores_visibles}.
Return JSON matching the schema only.
```

- **Controles de sesgo:**
  1. **10 % ciego:** se elige por hash (`sha256 mod 10 == 0`) antes de ver pre-etiquetas y se revisa sin predicciones.
  2. **`gold_eval` 100 % ciego y con doble anotación** [F56].
  3. **Brecha de anclaje** = acuerdo con pre-etiqueta en no ciegas − acuerdo en ciegas. Si pasa de 10 puntos [P], subir la muestra ciega al 20 %.
  4. **Clase con precisión <70 % [P]:** dejar de sugerirla e iterar el prompt **solo en `dev`**.
- **Costo por 1.000 imágenes** (batch; estimado con precios oficiales verificados; supuestos por imagen: 2.000 tokens de instrucciones y 500–1.500 de salida):

| Modelo | Precio batch (entrada / salida por MTok) | Tokens de imagen | US$ por 1.000 [E] | 6.000 candidatas [E] |
|---|---|---|---|---|
| Gemini 3.5 Flash-Lite | $0,15 / $1,25 [F33] | 1.120 con `media_resolution` alta (según el informe de flujo) | 1,1–2,3 | 7–14 |
| Gemini 3.6 Flash | $0,375 / $1,875 hasta 2026-12-31; **se duplica desde 2027-01-01** [F33] | 1.120 | 2,1–4,0 | 13–24 |
| Claude Haiku 4.5 | $0,50 / $2,50 [F35] | ≤1.568 (nivel estándar) [F36] | ≈3,0 | ≈18 |
| Claude Sonnet 5 | $1 / $5 [F35] | ≈2.128 a 1568×1045 px, con ⌈w/28⌉×⌈h/28⌉ [F36] | ≈6,6–9,6 | ≈40–58 |

**Conclusión:** el pre-etiquetado cuesta decenas de dólares. El cuello de botella es el tiempo humano y los permisos. Si se usa Gemini 3.6 Flash, conviene hacer el grueso antes del 2027-01-01 [F33].

### 5.5 Revisión humana

- Bloques de 45 min, en este orden: cola ciega, ambiguas, claras.
- El revisor confirma la clase primaria, `clases_presentes`, los atributos decisivos, `nivel_elaboracion` y los flags de riesgo.
- Los desacuerdos o casos límite pasan al decorador adjudicador cada 2 semanas; lo que se resuelve alimenta la guía (PATCH o MINOR de la taxonomía) [F56].
- **Rúbrica de elaboración [P]:**
  - **1** = 1–2 colores, tamaño uniforme;
  - **2** = tamaños mixtos, foils o 2 estructuras;
  - **3** = ≥3 tamaños o acabados, elementos integrados (flores, telas, neón) o ≥3 estructuras coordinadas.
- **Topes en `train` [P]:**
  - ≤3 fotos por montaje;
  - ≤8 % de la clase y ≤5 % del total por titular;
  - LoRA con ≥40 % de nivel 3;
  - ≥15 % de fotos de celular, ≥15 % de ángulo no frontal;
  - ninguna familia de color >25 % de la clase.
- **En `gold_eval`:** 1 foto por montaje y distribución realista, con ≥25 % de fotos de celular.
- **Logos o marcas de agua de un negocio:** recortar o excluir del LoRA [F27].

### 5.6 Deduplicación

1. sha256 exacto.
2. Hash perceptual de 64 bits. Los fundamentos usan dHash con **d ≤ 6**: d ≤ 2 se une solo y 3 ≤ d ≤ 6 va a revisión humana [F56].
   - **Inconsistencia en el repo:** `scripts/auditar-diversidad-general.ts` y `scripts/seleccionar-blog-para-general.ts` usan umbral por defecto **10** (verificado en el código).
   - Elegir **una** implementación, guardar `hash_impl` y recalibrar con unos 100 pares etiquetados. Los hashes de sharp e ImageHash no son comparables [E].
3. Unir por `setup_id`: varias fotos del mismo montaje cuentan como **una** para las metas.
4. Deduplicar **también contra** los conjuntos internos (Sempertex, v007, blog), para cumplir la decisión de usar solo fuentes externas.

### 5.7 Splits

1. **Sorteo por titular antes de ver las imágenes [P]:** el titular va al pool de evaluación si `sha256(rights_holder_id) mod 5 == 0` (≈20 %). Dentro de ese pool, un segundo hash reparte entre `gold_eval` y `dev` en proporción ≈2:1.
2. **Siempre disjunto por `setup_id` y `dedup_cluster_id`.** Excepción: una clase rara con menos de 5 titulares en la semana 6 se asigna por montaje, con `split_regla=cluster_excepcion`, y se reporta.
3. **Congelar pronto:**
   - `smoke-eval-v0` (semana 3): 10–15 montajes por clase; solo prueba el pipeline. Es el `gold-eval-v0` de los fundamentos (§7.4): **no apto para compuertas** y después pasa a `dev` o `guia`.
   - `gold-eval-v1`: se cierra la **selección** al llegar a ≥50 montajes en cada clase prioritaria y ≥30 en las demás [F56], o en la semana 8, lo que ocurra primero; el congelamiento formal (`F-M3`, doble anotación ciega y adjudicación) queda en la semana 11 del calendario común (fundamentos §1.3). Las clases que no lleguen se reportan con n e intervalo.
4. **Nunca** iterar prompts ni umbrales sobre `gold_eval`.

### 5.8 Carpetas y nombres

```
<DATA_ROOT privado>/estructuras-ext/
  00_intake/ (candidatos.csv, leads_permisos.csv [restringido], permisos/<permission_id>/)
  10_raw/<source_kind>/<batch_id>/<sha256_original>.<ext>     # inmutable
  15_quarantine/<motivo>/
  20_sanitized/<sha256[0:2]>/<sha256>.jpg                      # identidad del dataset
  40_dedup/  50_prelabel/<prompt>@<ver>/<modelo>/  70_labelstudio/
  60_curated/<clase>/  (+ otra_estructura_globos/ negativo/ no_determinable/)   # vista regenerada
  manifests/ingesta-externa.v1.jsonl, events.jsonl
```

- **Nombre en `60_curated`:** `<clase>__<split>__<fuente>-<titular>__<setup>__<sha8>.jpg`, sin nombres de personas.
- **En Windows:** copias o enlaces duros, porque los symlinks piden permisos.

---

## 6) Metas, ritmo semanal y costo

### 6.1 Metas por clase

Las metas son del usuario y cuentan **montajes distintos**, no fotos. La porción de evaluación sigue los fundamentos [F56]; el reparto es [P].

| Grupo | Clases | Meta total por clase | `gold_eval` | `dev` | `train` | Mínimo aceptable [P] |
|---|---|---|---|---|---|---|
| Prioritarias (9) | arco, arco_organico, arco_no_denso, aro_circular, semiarco, semiarco_organico, columna, columna_organica, guirnalda | 150–200 | 50–60 | 15–20 | 85–120 | 90 |
| Otras (7) | columna_no_densa, pared_densa, pared_no_densa, centro_mesa, bouquet, figura, techo_globos | 100–120 | 30–35 | 10 | 60–75 | 70 |
| **Total** | 16 | **2.050–2.640** | ≈660–785 | ≈205–250 | ≈1.185–1.605 | 1.300 |
| Negativos difíciles | — | +8–10 % (≈170–250) | proporcional | — | — | — |

**Encaje con los fundamentos:** el LoRA pide 30–40 imágenes mínimo por clase y 80–150 en las confundibles; el detector, 100–200 instancias por familia en el piloto [F56]. El `train` propuesto cubre ambos [E].

**Ojo:** con la meta mínima, `gold_eval` queda cerca del piso de los fundamentos en las clases prioritarias, y las 7 "otras" (30–35) quedan por debajo del objetivo de 50 de los fundamentos §7.7: se reportan sin compuerta estricta salvo que lleguen. `semiarco`, `semiarco_organico`, `columna`, `columna_organica`, `arco` y `aro_circular` piden 100 instancias efectivas (no 50–60). Es un motivo para apuntar a la meta recomendada.

### 6.2 Supuestos del embudo (todos [E], confianza baja; medir en semanas 1–2)

| Paso | Supuesto |
|---|---|
| Respuesta × aceptación de contactos | 15–30 % × 30–50 % → **5–15 permisos por cada 100 contactos** (el mayor riesgo) |
| Montajes netos por permiso | 40–60 tras QC, dedup y topes. Si se cuenta estrictamente por montaje, podrían ser menos: planear con +25–50 % de permisos |
| Paso de QC, revisión y cuotas | 33–55 % neto; planear con 40 % |
| Descubrimiento en CC | 10–40 candidatas por hora; la categoría de Commons es pequeña [F8] |
| Revisión con pre-etiqueta | 150–300 imágenes por hora; ciega, 80–140 por hora |
| Gestión de un permiso | 20–40 min |

### 6.3 Esfuerzo y calendario [E]

| Concepto | Mínimo (1.300) | Recomendado (≈2.300) |
|---|---|---|
| Contactos y permisos necesarios | ≈275 / ≈22 (hasta ≈35 contando por montaje) | ≈500 / ≈40 (hasta ≈60) |
| Horas humanas de curación (sin cajas) | 80–150 h | 140–260 h |
| Horas técnicas, una vez | 25–45 h | 30–55 h |
| Con 15 h/semana (2 personas a tiempo parcial) | ≈8–10 semanas + 1–2 de preparación | ≈13–16 semanas + 1–2 de preparación |
| Con 25 h/semana | ≈6 semanas | ≈10 semanas |

**Calendario sugerido** (hoy es martes 2026-09-15) [P]:

| Semana | Fechas | Qué |
|---|---|---|
| 0 | 15–20 sep | Plantilla al abogado, hoja, bookmarklet, 50 leads, 100 candidatas de Commons, prompt v0.1 |
| 1–2 | 21 sep–4 oct | Piloto de 150–300 archivos de principio a fin; ≥60 contactos por semana; medir tasas reales |
| 3 | 5–11 oct | `smoke-eval-v0`; escalar a lotes de 300–500 archivos por semana |
| ≤8 | hasta ≈15 nov | Congelar `gold-eval-v1` |
| 8–10 | hasta ≈29 nov | Mínimo de 1.300 |
| 13–16 | ≈20 dic–10 ene | Meta recomendada. El pre-etiquetado con Gemini 3.6 Flash conviene antes del 1 de enero [F33] |

**Ritmo semanal en régimen [P]:** 60–100 contactos, 3–8 permisos nuevos, 150–250 montajes aceptados y un tablero con semáforo por clase.

**Ritual semanal:**
- **Lunes:** tablero y cuotas por clase.
- **Lunes a miércoles:** leads y contactos, empezando por las clases en rojo.
- **Miércoles:** ingesta → saneado → QC → dedup → split → pre-etiquetado batch.
- **Jueves y viernes:** revisión.
- **Viernes:** métricas (aceptación por clase, brecha de anclaje, participación por titular).
- **Cada 2 semanas:** adjudicación con el decorador.

### 6.4 Costo estimado

| Partida | Rango [E] | Base |
|---|---|---|
| Pre-etiquetado IA (doble modelo e iteraciones incluidas) | US$20–60 | Precios [F33][F35] |
| Almacenamiento (3–8 GB) | Despreciable | [E] |
| Contraprestación a decoradores | US$0 (solo crédito) a US$4.000–26.000 (US$2–10 × 2.050–2.640) | Informe de catálogo [E]; referencias [F43][F44] |
| Sesiones o encargos para clases raras (20–40 montajes) | US$1.000–6.000 por sesión de fotos en eventos reales [E]; US$8.000–60.000 si se construyen montajes a medida (arco US$250–1.500 [F46] + fotógrafo US$122–364/h [F47]) | (M) |
| Licencia de datos de stock | Cotización empresarial, sin precio público | [F14][F16][F17] |
| Tiempo humano | 140–260 h de curación + 30–55 h técnicas | [E] |
| Revisión legal | Cotizar; no hay dato | — |

---

## 7) Riesgos y qué revisar con un abogado

### 7.1 Riesgos principales

| Riesgo | Mitigación |
|---|---|
| **Pocos permisos** (tasa real menor que la supuesta) | Medir en semanas 1–2; contraprestación; academias y portafolios grandes; convocatoria FLOAT [F37] |
| **Doble titularidad foto/diseño:** una decoración podría ser obra de arte aplicado. La excepción andina para obras en lugares públicos exige que estén "en forma permanente en un lugar abierto al público" y no cubre eventos [F22] | Preferir fotógrafo = decorador; garantía y cesión en el acuerdo |
| **Licencias CC mal asignadas** (quien sube no es el autor) [F7][F11] | Revisar el perfil del autor; excluir reposts y capturas; confirmar por correo |
| **Marcas de agua, logos o personajes** en salidas del LoRA. En *Getty v. Stability* (Reino Unido, 2025) la marca de agua generó infracción de marca limitada [F27]; *Disney/Universal v. Midjourney* por personajes [F28] | Descartar con marca de agua; excluir personajes y logos de terceros del LoRA |
| **Quitar información de derechos** (17 U.S.C. §1202) [F26] | Nunca limpiar marcas de agua ni créditos |
| **Datos personales:** fotos con personas identificables; menores proscritos [F24] | Excluir menores; difuminar adultos antes de cualquier envío; no extraer biometría |
| **Estilo firma de un decorador** que el LoRA imite | Tope por titular (≤5 % del total); sin nombres en captions; control de similitud de salidas (pHash o CLIP) antes de entregar [P] |
| **Sesgo a estilo Instagram** frente a fotos reales de clientes | ≥25 % de celular en evaluación; distribución realista en `gold_eval` [P] |
| **Proveedor:** fal traslada al cliente la garantía y la indemnización por el input [F30]. No hay cláusula explícita sobre la propiedad del LoRA entrenado (lectura vía resumidor, M) | Solo material 🟢; pedir aclaración escrita a fal |
| **Licencia de FLUX.2 [dev]:** no comercial; las restricciones alcanzan a los derivados. Usar el LoRA fuera de fal requeriría una licencia comercial de BFL (informe de licencias, M) | Confirmar la cobertura comercial vía fal; cotizar BFL si se sale de fal [F31][F32] |
| **Jurisprudencia de EE. UU. abierta:** fallos de 2025 en distintas direcciones (*Bartz*, *Kadrey*: fair use con copias lícitas; *Thomson Reuters v. Ross*: no fair use, apelación pendiente) (M) [F29] | No depender del fair use; usar licencias explícitas |
| **UE, solo si se vende o procesa allí:** la minería comercial está permitida salvo reserva del titular por medios legibles por máquina (Directiva 2019/790, art. 4) (M) [F29] | Respetar robots.txt, `tdmrep.json` y los términos de cada sitio |

### 7.2 Preguntas concretas para el abogado

1. ¿La plantilla de §4.3 basta en Colombia y México para entrenar y evaluar modelos comerciales, generativos y de reconocimiento, y para enviar las imágenes a proveedores extranjeros (fal, Google)?
2. Si fotógrafo y decorador son personas distintas, ¿hace falta la autorización de ambos? ¿La decoración con globos es obra protegible de arte aplicado?
3. ¿CC BY sin distribución del dataset exige atribución? ¿Basta una página de créditos? ¿CC BY-SA sirve para un LoRA que se ofrece como servicio en fal sin publicar los pesos? [F1]
4. Descarga **manual y acotada** de fotos Pexels o Pixabay: ¿viola la prohibición de copia "systematic" [F2][F3]? (La guía la trata como 🔴 salvo permiso.)
5. Flickr: ¿guardar fotos CC descargadas a mano, sin API, choca con la cláusula de caché de la API [F9]?
6. Ley 1581: ¿qué autorización hace falta para adultos visibles, y el difuminado previo al envío basta como medida? [F24]
7. ¿El compromiso de retiro (≤15 días, sin reentrenar modelos ya entrenados) es válido y suficiente?
8. Uso comercial de FLUX.2 [dev] vía fal y propiedad del LoRA; ¿uso de inputs por fal ("Usage Data")? [F30][F31]
9. Si se vende en la UE: obligaciones del AI Act para quien afina un modelo (según el informe, un LoRA queda por debajo del umbral de proveedor GPAI) y marcado de imágenes sintéticas (M).
10. Revisión de cualquier contrato de licencia de datos de stock antes de firmarlo (alcance comercial, evaluación, indemnidad) [F14][F16].

---

## 8) Checklist para empezar hoy

**Hoy (2–3 h):**
- [ ] Registrar la decisión "100 % fuentes externas" (DT-7) en los fundamentos. Quitar de §7.7 los planes "encargo a decoradores Sempertex" y "blog Sempertex" [F56].
- [ ] Decidir la contraprestación (§4.5) y si una foto propia de un artista certificado por Sempertex cuenta como externa.
- [ ] Crear el almacenamiento privado con cifrado y control de acceso, y el árbol de carpetas de §5.8.
- [ ] Crear una hoja privada con las pestañas `candidatos`, `leads_permisos` y `registro_permisos`.
- [ ] Instalar el bookmarklet (§5.3).
- [ ] Enviar la plantilla (§4.3) y las preguntas (§7.2) a un abogado. Hasta tener su visto bueno, **contactos exploratorios sí, firmas y archivos no** [P].
- [ ] Commons: revisar la categoría Balloon arches (79 + 148) [F8] y 5 búsquedas; capturar 50–100 candidatas CC0, PDM o BY (BY-SA marcada aparte).
- [ ] Armar 50 leads de decoradores (≥3 países), empezando por no densas, orgánicas, techo y aro.

**Esta semana:**
- [ ] Fijar antes de la primera ingesta: sorteo de splits por titular, 10 % ciego por hash, topes y rúbrica (§5.4–§5.7).
- [ ] Técnico: saneado, hash, dedup y QC en `--dry-run`; elegir la implementación de dHash y calibrar el umbral (resolver 10 frente a ≤6).
- [ ] Prompt v0.1 generado desde la taxonomía; estimar costo sobre 50 imágenes; solo nivel de pago.
- [ ] Tablero por clase con metas de §6.1.
- [ ] Escribir a fal pidiendo aclaración sobre la propiedad del LoRA, el uso de inputs y la cobertura comercial de FLUX.2 [dev].

**Nunca:**
- [ ] Descargar de Pinterest, Instagram, Facebook, TikTok, Google Imágenes, Unsplash, Pexels, Pixabay o stock con licencia estándar.
- [ ] Usar NC o ND, quitar marcas de agua o guardar menores identificables.
- [ ] Enviar a Gemini, fal u otro proveedor imágenes sin `envio_proveedores_ia_permitido`.
- [ ] Mover archivos a mano en `60_curated` o iterar sobre `gold_eval`.

---

## Anexo A. Contradicciones entre los informes y cómo se resolvieron

| Tema | Informes | Verificación (2026-09-15) | Resolución |
|---|---|---|---|
| Getty EULA §3.11 | Catálogo: "aclara que no incluye entrenamiento, fine-tuning". Licencias: lo prohíbe | Re-verificada [F13]: prohíbe "training, fine-tuning, or other types of data ingestion" | 🔴. El catálogo estaba mal |
| Unsplash Lite | Catálogo: "libre para uso comercial". Licencias: "internal business purposes" | Re-verificada [F5]: entrenar "for your internal business purposes"; Full es no comercial; redistribución prohibida | 🟡, no "libre comercial" |
| Fecha de los términos de la API de Flickr | Licencias: 9-may-2018. Catálogo: 2026-07-10 | Re-verificada [F9]: la página muestra 9-may-2018 | Se usa 2018. Las cláusulas de caché y de retiro en 24 h están confirmadas |
| CC ND | Licencias: evaluación "sí con cautela". Catálogo y flujo: excluir | Re-verificada [F1]: "ND-licensed content not be used as training data" | 🔴 en todo, por simplicidad |
| CC BY-SA para LoRA | Licencias: sí si no se publican pesos. Flujo: solo evaluación hasta revisión legal | [F1]: SA exige compartir las adaptaciones con la misma licencia | 🟡 para LoRA hasta el abogado; 🟢 para evaluación; detector 🟢/🟡 |
| Pexels/Pixabay descarga manual | Licencias: 🟡. Catálogo: no sin permiso. Flujo: excluida | Re-verificadas [F2][F3]: prohíben la copia "bulk, large-scale or systematic" y el scraping para ML | 🔴 salvo permiso: un dataset de miles de imágenes es sistemático por naturaleza (B) |
| Redes sin permiso para evaluación | Licencias: 🟡 interno. Flujo: excluida | — | 🔴: el set de evaluación se sube a proveedores y aparece en informes |
| Plazo de retiro | Licencias: ≤15 días. Flujo: 24 h (Flickr) y 30 días en la plantilla | [F9]: 24 h aplica a fotos de Flickr | ≤15 días en general; 24 h para material de Flickr |
| Uso de inputs por fal | Licencias: "no está claro si Usage Data incluye imágenes" | Re-verificada vía resumidor [F30]: Usage Data serían datos anonimizados o agregados, sin el input crudo; sin opt-out | Confianza M; pedir confirmación escrita |
| Clases prioritarias | Catálogo marca solo `arco_organico` y `guirnalda`. Flujo: "9 prioritarias" sin lista | Repo [F56] §7.7: arco, arco_organico, arco_no_denso, aro_circular, semiarco, semiarco_organico, columna, columna_organica, guirnalda | Se usa la lista del repo |
| Compensación | Catálogo: pago US$2–10 por imagen. Flujo: licencia gratuita | — | Decisión de negocio con escenarios (§4.5, §6.4) |
| Umbral de dHash | Flujo: scripts TS usan 10 y los fundamentos d ≤ 6 | Verificado en el código y en los fundamentos | Unificar (§5.6) |
| Concepto DNDA | Solo lo citaba el informe de flujo | Re-verificado en el PDF [F22]: Rad. 2-2024-62784, 24-06-2024; "no está consagrada en la ley alguna excepción…"; no vinculante | Confirmado |

---

## Anexo B. Fuentes

Todas las fuentes se revisaron el 2026-09-15. "Re-verificada" = se leyó de nuevo para esta síntesis.

| Id | Fuente | Qué dice (relevante) | Conf. |
|---|---|---|---|
| F1 | Creative Commons, "Using CC-licensed works for AI training" (mayo 2025) — https://creativecommons.org/using-cc-licensed-works-for-ai-training-2/ (re-verificada) | NC: todas las etapas no comerciales. ND: "not be used as training data". SA: las adaptaciones se comparten con la misma licencia. BY: la atribución puede ser un enlace a la fuente del dataset | A |
| F2 | Pexels Terms of Service (15-nov-2024) — https://www.pexels.com/terms-of-service/ (re-verificada) | Scraping prohibido "including without limitation for machine learning purposes"; "Bulk, large-scale or systematic copying… strictly prohibited unless explicit permission" | A |
| F3 | Pixabay Terms (18-nov-2024) — https://pixabay.com/service/terms/ (re-verificada) | Mismas dos cláusulas que Pexels | A |
| F4 | Unsplash Terms §8 — https://unsplash.com/terms | Prohíbe usar las imágenes "in connection with any machine learning and/or artificial intelligence datasets" | A (informes) |
| F5 | Unsplash Datasets TERMS — https://github.com/unsplash/datasets/blob/master/TERMS.md (re-verificada) | Lite: entrenar "for your internal business purposes". Full: solo no comercial. Redistribución prohibida | A |
| F6 | Commons:Licensing — https://commons.wikimedia.org/wiki/Commons:Licensing | Solo admite licencias con uso comercial y derivadas; NC y ND no permitidas | A (informe) |
| F7 | Commons:Reusing content — https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia | Licencia por archivo; sin garantía sobre el estado de copyright | A (informe) |
| F8 | Category:Balloon arches — https://commons.wikimedia.org/wiki/Category:Balloon_arches (re-verificada) | 79 archivos; subcategoría de EE. UU. con 148 | A |
| F9 | Flickr API Terms (9-may-2018) — https://www.flickr.com/help/terms/api (re-verificada) | Uso comercial solo con CC que lo permita; no guardar fotos "other than for reasonable periods"; retirar en 24 h; clave comercial; no menciona IA | A |
| F10 | Flickr Terms (24-jul-2025) — https://www.flickr.com/help/terms | Prohíbe scraping y minería de datos | A (informe) |
| F11 | Openverse ToS — https://docs.openverse.org/terms_of_service.html | No verifica licencias; prohíbe scraping del catálogo | M |
| F12 | Adobe Stock Product Specific Terms (ene-2026) — https://www.adobe.com/cc-shared/assets/pdf/legal/servicetou/stock-product-specific-terms-en-us-20260116.pdf | §7.1(H): no usar "to directly or indirectly create, train, test… machine learning… or artificial intelligence systems" | A (informes) |
| F13 | Getty Images EULA (abr-2026) — https://www.gettyimages.com.mx/eula (re-verificada) | §3.11: sin autorización explícita, no usar para ML ni IA, incluido "training, fine-tuning"; tampoco indirectamente vía herramientas de terceros | A/M |
| F14 | Shutterstock License — https://www.shutterstock.com/license (403) + búsqueda (re-verificada); programa de datos: https://submit.shutterstock.com/help/en/articles/10594694 | La licencia estándar prohíbe usar el contenido "as training data" para IA o ML; hay licencias de datasets aparte | M |
| F15 | Magnific (ex Freepik) Terms (jun-2026) — https://www.magnific.com/legal/terms-of-use | §8.1: no usar para "any machine learning and/or artificial intelligence purposes"; Originals también "evaluation" | A (informes) |
| F16 | Vecteezy Licensing Agreement (22-jun-2026) — https://www.vecteezy.com/licensing-agreement | La Data Training License (solo Enterprise) permite "train, fine-tune, evaluate"; sin ella está prohibido | A (informe) |
| F17 | 123RF Content Licensing — https://www.123rf.com/content-licensing/ | Licencias de activos para entrenamiento de IA; datasets a medida | M |
| F18 | Depositphotos License (12-sep-2025) — https://depositphotos.com/license.html ; blog (27-may-2026) — https://blog.depositphotos.com/rights-cleared-ai-data-licensing.html | La licencia estándar no menciona entrenamiento; ofrecen datasets con derechos liberados | M |
| F19 | Pinterest ToS (30-abr-2025) — https://policy.pinterest.com/en/terms-of-service | El usuario retiene los derechos; prohíbe "scrape, collect… using automated means" sin permiso | A (informes) |
| F20 | Instagram Terms — https://help.instagram.com/581066165581870/ ; Meta Automated Data Collection Terms — https://www.facebook.com/legal/automated_data_collection_terms | No reclaman la propiedad; recolección automatizada solo con permiso expreso | A/M |
| F21 | TikTok ToS (15-jul-2026) — https://www.tiktok.com/legal/page/us/terms-of-service/en | Prohíbe "scrape, crawl, export…" salvo aprobación escrita | A (informe) |
| F22 | DNDA, Concepto Rad. 2-2024-62784 (24-06-2024), copia en https://abogadotic.com/wp-content/uploads/2024/09/Concepto-DNDA-IA-y-Derecho-De-Autor.pdf (re-verificada, PDF leído); índice: https://www.derechodeautor.gov.co/es/pronunciamientos-sobre-ia | "no está consagrada en la ley alguna excepción al derecho de autor que permita que los sistemas de inteligencia artificial se nutran de obras protegibles". Hace falta "autorización previa y expresa del titular". Derechos morales irrenunciables (DA 351 art. 11). Art. 22 h) exige obra "en forma permanente en un lugar abierto al público". No vinculante | A |
| F23 | Decisión Andina 351 — https://derechodeautor.gov.co/decision-andina | Excepciones taxativas (transcritas en F22) | A vía F22 |
| F24 | Ley 1581 de 2012 — https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981 | Art. 3: dato personal (persona determinable). Art. 5: biométricos sensibles. Art. 7: tratamiento de datos de menores proscrito salvo los públicos | A (informe) |
| F25 | LFDA México, art. 148 — https://leyes-mx.com/ley_federal_del_derecho_de_autor/148.htm | Lista cerrada de limitaciones, sin excepción para entrenar IA | M |
| F26 | 17 U.S.C. §1202 — https://www.law.cornell.edu/uscode/text/17/1202 | Prohíbe "intentionally remove or alter any copyright management information" | A (informe) |
| F27 | *Getty Images v. Stability AI* [2025] EWHC 2863 (Ch); permiso de apelación — https://ipkitten.blogspot.com/2026/01/permission-to-appeal-granted-in-getty.html | Infracción de marca por marcas de agua "historic and extremely limited"; se rechazó la infracción secundaria de copyright; hay apelación | M |
| F28 | *Disney/Universal v. Midjourney* — https://www.cnbc.com/2025/06/11/disney-universal-midjourney-ai-copyright.html | Demanda por generación de personajes con licencia | M |
| F29 | Resúmenes de *Bartz*, *Kadrey*, *Ross* y Directiva 2019/790 — https://www.jw.com/news/insights-kadrey-meta-bartz-anthropic-ai-copyright/ ; https://www.bakerbotts.com/thought-leadership/publications/2026/july/third-circuit-hears-oral-argument ; https://legalblogs.wolterskluwer.com/copyright-blog/the-new-copyright-directive-text-and-data-mining-articles-3-and-4/ | Fair use en disputa en EE. UU.; *Ross* en apelación. UE: minería comercial permitida salvo reserva legible por máquina | M |
| F30 | fal.ai Terms (8-sep-2026) — https://fal.ai/terms (re-verificada vía resumidor) | Licencia a fal sobre el Customer Input; el cliente "represents and warrants… it has all rights" e indemniza; Usage Data anonimizada o agregada para sus modelos, sin opt-out; nada explícito sobre la propiedad del LoRA | A/M |
| F31 | FLUX.2 [dev] Non-Commercial License v2.0 — https://bfl.ai/legal/non-commercial-license-terms | Uso no comercial; las restricciones alcanzan a los derivados; no usar las salidas para entrenar un modelo competidor | M (informe) |
| F32 | BFL Licensing — https://bfl.ai/licensing | Planes comerciales con "Fine-tuning & LoRA rights" | M (informe) |
| F33 | Gemini API pricing — https://ai.google.dev/gemini-api/docs/pricing (re-verificada) | 3.6 Flash batch $0,375/$1,875 hasta 2026-12-31, $0,75/$3,75 desde 2027-01-01; 3.5 Flash-Lite batch $0,15/$1,25; en el nivel gratuito el contenido se usa para mejorar productos | A |
| F34 | Gemini API Terms (2026-04-28) — https://ai.google.dev/gemini-api/terms | Gratuito: mejora de productos y revisión humana; de pago: no | A (informe) |
| F35 | Claude pricing — https://platform.claude.com/docs/en/about-claude/pricing (re-verificada) | Sonnet 5: $2/$10 (batch $1/$5); Haiku 4.5: $1/$5 (batch $0,50/$2,50); batch −50 %, combinable con caché | A |
| F36 | Claude vision — https://platform.claude.com/docs/en/build-with-claude/vision (re-verificada) | Tokens = ⌈w/28⌉×⌈h/28⌉; nivel estándar hasta 1568 px y 1568 tokens; alta resolución (4.7+) hasta 2576 px y 4784 tokens; "Anthropic does not use uploaded images to train models" | A |
| F37 | FLOAT Convention, competencias — https://floatconvention.com/activities-competitions/ (re-verificada) | 33 categorías, entre ellas Arch, Column, Ceiling, Organic, Table Centerpiece, Sculpture, Backdrop/Wall, Mural, Entrance. Reglas 2026 (sin sublicencia, M): https://floatconvention.com/wp-content/uploads/2025/11/2026-FLOATEE-Rules-and-Regulations-11_12a.pdf | A/M |
| F38 | Qualatex Balloon Pro Finder — https://us.qualatex.com/en-us/balloon-pro-finder/ | Directorio de profesionales | M |
| F39 | Balloon HQ, directorio y copyright — https://balloonhq.com/decorator-directory/ ; https://balloonhq.com/copyright/ | Directorio; las fotos pertenecen a quien las aporta | M |
| F40 | NABAS — https://nabas.co.uk/ | Asociación y directorio del Reino Unido | M |
| F41 | The Balloon Guild — https://theballoonguild.com/ | Comunidad de decoradores | M |
| F42 | Sempertex, artistas y T&C — https://sempertex.com/en/pages/artistas-de-globos ; https://sempertex.com/pages/terminos-y-condiciones ; Gemar T&C — https://gemarballoons.com/terms-conditions/ | Materiales solo para uso privado o no comercial; reproducción prohibida sin autorización | M |
| F43 | DataSet Shop pricing — https://www.datasetshop.com/pricing | US$0,30–1,50 por imagen para generación sintética | A (informe) |
| F44 | the-decoder (Reuters), 2024 — https://the-decoder.com/tech-giants-are-on-a-billion-dollar-shopping-spree-for-ai-training-data/ | US$1–2 por imagen en datos licenciados | M |
| F45 | Wirestock en Datarade — https://datarade.ai/data-providers/wirestock/profile | Datasets a medida por cotización | M |
| F46 | Partysparkz, precios de arcos 2026 — https://partysparkz.com/blog/balloon-arch-price-guide/ | Arco US$250–1.500 | M |
| F47 | Thumbtack, precios de fotógrafos — https://www.thumbtack.com/p/photographer-prices | Promedio US$164/h (US$122–364) | M |
| F48 | Label Studio, comparación de ediciones — https://labelstud.io/guide/label_studio_compare | Community sin revisor, acuerdo ni overlap | A (informe) |
| F49 | CVAT — https://github.com/cvat-ai/cvat | MIT; SAM integrado en planes de pago | A (informe) |
| F50 | ImageHash — https://github.com/JohannesBuchner/imagehash | pHash y dHash; BSD-2 | A (informe) |
| F51 | FiftyOne Brain — https://docs.voxel51.com/brain/index.html | Casi-duplicados y leaky splits | M |
| F52 | MediaPipe Face Detector — https://developers.google.com/edge/mediapipe/solutions/vision/face_detector | Detección de caras (BlazeFace) | M |
| F53 | LAION watermark detection — https://github.com/LAION-AI/LAION-5B-WatermarkDetection | Detector de marcas de agua; MIT | M |
| F54 | Wikimedia Robot policy / API etiquette — https://wikitech.wikimedia.org/wiki/Robot_policy ; https://www.mediawiki.org/wiki/API:Etiquette | Concurrencia ≤2, User-Agent descriptivo, `maxlag` | A (informe) |
| F55 | Papadopoulos et al., CVPR 2016 — https://openaccess.thecvf.com/content_cvpr_2016/papers/Papadopoulos_We_Dont_Need_CVPR_2016_paper.pdf | Verificación sí/no ≈1,6 s (otro dominio; cota inferior del ritmo de revisión) | M |
| F56 | Repo: `docs/planes/estructuras-2026-09/00-fundamentos-compartidos.md` §7.3, §7.5, §7.7; `scripts/auditar-diversidad-general.ts`, `scripts/seleccionar-blog-para-general.ts`; `AGENTS.md` | 9 clases prioritarias (evaluación 50–100) y otras ≥30; dHash d ≤ 6 frente a umbral 10 en scripts; referencias de tamaño de LoRA y detector; reglas de scripts | A (leído) |
| F57 | Open Images V7 — https://storage.googleapis.com/openimages/web/factsfigures_v7.html | Imágenes "listed as having a CC BY 2.0 license"; verificar cada una | A (informe) |
| F58 | Sondeos de volumen de Flickr y otros (conteos de buscador) — https://www.flickr.com/search/?text=balloon%20arch&license=4%2C5%2C7%2C8%2C9%2C10 ; Amazon Conditions of Use (fragmento de buscador) | "balloon arch" 619 CC; "balloon column" 66; "balloon garland" 17; Amazon excluye minería de datos | M |

**Límites de esta síntesis:**
- No se pudieron leer directamente la licencia de Shutterstock, la FAQ de IA de Pexels, los términos de Dreamstime, Etsy y Amazon, ni la API de Openverse (errores 403 en los informes).
- Varias lecturas pasaron por un resumidor automático. Las citas decisivas conviene releerlas en la fuente antes de firmar.
- Los casos judiciales citados siguen abiertos.
- No se hicieron llamadas pagas ni se crearon cuentas.
