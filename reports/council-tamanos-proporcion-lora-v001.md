# LLM Council — Captioning de tamaños/proporción para el LoRA Sempertex

Fecha: 2026-08-26

## Pregunta original al consejo

Estamos armando el dataset de captions para entrenar un LoRA de estilo de decoración con globos (Sempertex, proveedor fal.ai/FLUX). La parte más crítica del proyecto es que el modelo entrenado respete bien los TAMAÑOS/PROPORCIONES de los globos — un fallo ahí se considera un fallo fundamental de todo el esfuerzo.

Decisión de arquitectura ya tomada (no se debate, es contexto): la medida absoluta en pulgadas no se entrena como concepto aislado. Lo que sí se entrena es la proporción relativa entre tamaños de globo cuando aparecen varios mezclados en la misma foto, vía texto en el caption (ej. "the R-24 balloons are roughly double the diameter of the R-12 filler balloons").

Pipeline real: un modelo de visión (GPT vía opencode CLI) mira la foto real + la lista completa de materiales comprados (con tamaños reales) y escribe el caption, marcando `proporcion_relativa_presente=true` + una descripción cuando ve 2+ tamaños mezclados, usando los tamaños reales confirmados por el pedido — nunca debe inventar uno. Se corrió una auditoría automática sobre las 401 fotos del dataset que cruza cada mención de tamaño en cada caption contra el `desglose.json` real de la orden (cualquier forma de globo, no solo redondo). Resultado: 0 de 401 captions mencionan un tamaño no confirmado por el pedido real.

Se incluyeron 5 captions reales de ejemplo del dataset (órdenes #950000024, #950000021, #7953, #950000192, #950000116) mostrando: comparación multi-tamaño redondo, comparación cruzando formas (foil vs. redondo), un caso sin proporción (foto de producto empacado), lenguaje genérico cuando no hay tamaños confirmados para comparar, y comparación de Link-O-Loon en dos tamaños.

**Pregunta central:** ¿este enfoque de captioning realmente va a funcionar para que el LoRA respete bien las proporciones/tamaños de globo? ¿Es la auditoría automática (0 tamaños inventados en 401 captions) evidencia suficiente de calidad?

---

## Ronda 1 — Respuestas independientes de los 5 asesores

### The Contrarian

Voy directo al punto débil que nadie está mirando: el problema no es la calidad del dato, es que le están pidiendo a un CLIP text encoder que haga aritmética.

Los modelos de difusión (FLUX incluido) tienen una debilidad documentada y bien conocida para conteo, medida y relaciones numéricas — no es un problema de "falta de datos", es una limitación arquitectónica del encoder de texto. Frases como "roughly double the diameter of" no se codifican como una relación matemática; se codifican como bag-of-tokens asociados difusamente a las regiones de la imagen. Con 401 fotos totales y probablemente menos de 140 con `proporcion_relativa_presente=true`, jamás vas a acumular suficiente repetición de un patrón textual específico para que el LoRA aprenda ese patrón como señal generalizable — vas a memorizar 100 casos aislados, no una regla.

Segundo punto ciego, más grave: el audit de 0/401 no prueba nada sobre lo que están intentando validar. Prueba higiene de datos (que el número mencionado exista en el pedido), no prueba que el balloon correcto en la foto tenga la etiqueta correcta. GPT-vision pudo perfectamente haber atado "R-12" al globo equivocado dentro del cuadro (dos globos redondos similares, colores distintos, tamaños confundidos) y el script jamás lo detecta porque solo cruza texto contra texto, nunca contra la imagen. Necesitan una muestra humana revisando visualmente "¿el globo que el caption llama más grande es efectivamente el más grande en la foto?" — eso ningún script de texto lo cubre.

Tercero: formato mixto "18 in" vs "R-12" vs "R-9" fragmenta el tokenizer en subpalabras inconsistentes — reduce aún más la frecuencia efectiva de cualquier patrón aprendible.

Antes de invertir más en el pipeline: generen 20 imágenes con el LoRA actual y midan proporciones a ojo. Si no lo han hecho, están validando la cocina, no el plato.

### The First Principles Thinker

Este es un problema de atribución causal en un sistema de tres etapas con fugas de error acumuladas, y la pregunta correcta no es "¿el captioning funciona?" sino "¿en qué etapa se pierde la señal geométrica, y puede el texto siquiera detectarlo?"

Redefino el problema real: hay tres transformaciones independientes, cada una con su propia tasa de error, y el LoRA solo puede aprender lo que sobrevive las tres:

1. **Pedido → foto**: ¿el globo R-12 que compraron es el mismo objeto físico que aparece en la imagen, en la posición y escala que el caption describe? Nadie lo verificó. Un R-12 puede estar desinflado, parcialmente oculto, o fuera de cuadro mientras otro R-9 domina visualmente.
2. **Foto → descripción de proporción**: el modelo de visión "mira" la foto y decide qué es más grande que qué. Esto es juicio visual de un LLM, no medición. Puede estar sistemáticamente sesgado (perspectiva, profundidad de campo, globos parcialmente inflados que parecen más chicos de lo que su código indica).
3. **Descripción de texto → geometría aprendida por el LoRA**: un modelo de difusión no tiene garantía de traducir "roughly double the diameter" en píxeles consistentes. Eso es exactamente la apuesta de arquitectura que ya tomaron, y es razonable, pero no está validada todavía — solo está *planteada*.

La auditoría de 0/401 tamaños inventados **no toca ninguna de estas tres etapas**. Es un chequeo de consistencia sintáctica texto-vs-pedido: confirma que no mintieron sobre qué códigos existían en la orden. Eso es necesariamente cierto por construcción (el modelo de visión solo tiene esos códigos disponibles para citar) — no es evidencia de que la comparación de tamaño sea *visualmente correcta*, solo de que es *lexicalmente admisible*. Es una prueba de que no alucinaron, no una prueba de que acertaron.

Lo que falta y ningún script de texto puede darles: una auditoría humana de una muestra (30-50 fotos) donde alguien mida a ojo la proporción real en la imagen y la compare contra la "proporcion_relativa_descripcion" generada. Sin eso, están midiendo la honestidad del pipeline, no su precisión.

### The Expansionist

Como Expansionista, esto no es solo "¿va a funcionar?" — es "¿qué tan grande puede ser esto?".

**El pipeline ya construyó un activo mucho más valioso que el LoRA.** Tienen 401 fotos con desglose.json auditado que las cruza contra pedidos reales de Shopify. Eso es un dataset de *ground truth* precio-producto-proporción-visual que casi ninguna empresa de decoración tiene. El LoRA de estilo es apenas el primer producto que se le puede sacar. Con esos mismos datos podrían entrenar: (1) un estimador automático de presupuesto a partir de foto de referencia del cliente ("esto se ve como ~40 R-12 + 20 R-5, cotización estimada"), (2) un clasificador de "materiales visibles vs. comprados" que audite fotos de instalación de franquiciados/distribuidores, (3) un motor de recomendación de mezcla de tamaños por tipo de evento.

**La proporción relativa es más poderosa de lo que están usando.** Ahora mismo capturan "R-24 es el doble de R-12" como texto libre en un caption. Pero si tienen 401 órdenes con desglose completo, ya tienen suficiente señal para derivar una *tabla de ratios canónicos* por combinación de formas (R vs LOL vs foil vs T-twisting) — eso es un dataset estructurado independiente del LoRA, reutilizable para validar generaciones futuras automáticamente sin ojo humano.

**Sobre la auditoría del 0/401**: no la subestimen, pero tampoco se detengan ahí — esa auditoría solo prueba que no hay alucinación de tamaño *no confirmado*. La oportunidad más grande es convertir esa misma infraestructura de auditoría en un **verificador automático post-entrenamiento**: generar N imágenes con el LoRA, correr el mismo cruce contra un desglose objetivo, y tener una métrica cuantitativa de fidelidad de proporción por lote — no solo para el training set, sino como QA continuo de producción. Eso es un producto en sí mismo, no un subproducto.

### The Outsider

No tengo idea de qué es un R-12, un LOL-6 o un T260 hasta que lo veo definido en el segundo párrafo de un mensaje de ustedes. Ese es exactamente el punto ciego que quiero marcarles: si algo tan básico como el sistema de nomenclatura no es evidente para alguien de afuera, tampoco lo es para el modelo de visión que está generando las descripciones de proporción.

Miren el pipeline: el paso crítico es "el modelo de visión mira la foto Y la lista completa de materiales, y decide qué tamaños se ven de verdad." Eso no es visión pura — es visión guiada por una lista. Un modelo de lenguaje con acceso a la respuesta (el desglose real) tiene un incentivo estructural fortísimo a copiar los números del pedido en vez de estimarlos genuinamente por percepción visual. El Ejemplo 4 confirma que esto puede fallar en la dirección honesta ("size no confirmed") — pero eso no prueba que en los otros 400 casos el modelo esté *viendo* la proporción y no *citando* la lista de compra. La auditoría del 0/401 mide alucinación léxica (¿mencionó un tamaño que no está en la orden?), no exactitud perceptual (¿la proporción descrita coincide con lo que realmente se ve en píxeles?). Son dos cosas completamente distintas y el pipeline solo audita la primera.

Otra cosa que salta a la vista sin contexto: en el Ejemplo 2, "27-inch metallic flower... larger than 18-inch foil" — comparan formas distintas (flor vs. redondo). ¿El LoRA va a aprender "27 > 18 en general" o "flor > foil específicamente"? Nadie de afuera puede saber si esa generalización cruzada de forma es intencional o un efecto colateral no examinado.

Mi pregunta directa: ¿alguien comparó manualmente una muestra de las proporciones descritas contra medición real en la foto (regla, píxeles, lo que sea), o toda la validación de calidad vive dentro del texto mismo, nunca contra la imagen?

### The Executor

No hay dataset. Hay 401 captions con auditoría de un solo tipo de error (tamaños inventados), y con eso se quiere decidir si se entrena. Eso no es luz verde, es media luz.

La auditoría automática solo prueba que el pipeline no alucina números que no estén en el desglose.json. No prueba tres cosas que sí importan para "el modelo respeta proporciones":

1. **¿El modelo de visión ve bien lo que compara?** GPT-vision puede confirmar que R-12 y R-5 están en el pedido, pero eso no garantiza que en la foto real el objeto que llamó "R-12" sea efectivamente el más grande. Si el pedido tiene R-12 y R-9 pero en la foto el R-9 quedó al frente (más cerca de cámara, se ve más grande por perspectiva), el caption puede describir la proporción correcta según el pedido pero incorrecta según lo que el modelo de imagen va a aprender a asociar visualmente. Eso el audit de texto-contra-pedido NUNCA lo detecta, porque no mira la imagen.
2. **Sesgo de posición/oclusión**: si "the R-24 are roughly double the R-12" pero en el crop el R-24 está parcialmente cortado o detrás de un pedestal, el LoRA aprende una asociación texto-imagen ruidosa.
3. **Balance de la muestra**: ¿cuántas de las 401 fotos tienen proporcion_relativa_presente=true? Si son 40 de 401, el LoRA no tiene señal suficiente para aprender la relación tamaño-proporción de forma consistente, sin importar qué tan limpio esté el texto.

**Qué hacer esta semana, concreto:**
- Tomar una muestra aleatoria de 25-30 fotos con proporcion_relativa_presente=true, y que un humano (no un LLM) mida a ojo/con regla en pantalla si la proporción descrita en el texto coincide con lo que se ve en píxeles. Es un check manual de 2-3 horas, no un experimento.
- Contar cuántas fotos tienen esa bandera activa. Si es menos del 15-20% del dataset, ese es el verdadero bloqueante, no la auditoría de texto.
- Antes de gastar presupuesto de entrenamiento completo, correr un LoRA de prueba chico (bajo rank, pocos steps) solo con el subset de proporción confirmada, y generar 10-15 imágenes con prompts de proporción explícita para inspección visual humana. Eso cuesta horas y unos dólares de GPU, no el training run completo.

La auditoría de texto es necesaria pero no suficiente. Sin el check visual humano y sin saber el tamaño real del subset con proporción, no hay base para dar luz verde.

---

## Ronda 2 — Revisión por pares (anonimizada)

Mapa de anonimización: **A** = Executor · **B** = Contrarian · **C** = Outsider · **D** = First Principles Thinker · **E** = Expansionist

### Reviewer 1 (lente Contrarian)

1. Más fuerte: **D**. Formaliza el problema con mayor precisión estructural: descompone el pipeline en tres etapas independientes y ubica exactamente dónde el audit de texto no puede ver nada ("necesariamente cierto por construcción"). A y B llegan a conclusiones similares pero D lo formaliza mejor sin perder acción concreta.
2. Mayor punto ciego: **E**. Cambia de tema. En vez de responder si la auditoría es suficiente, pivota a "qué más se puede construir con los datos". Trata la limitación de la auditoría con una frase de cortesía sin cuestionar si el pipeline es sólido. Es la única respuesta que no propone verificación humana visual como paso inmediato.
3. Lo que las cinco pasaron por alto: ninguna cuestiona si GPT-vision (el auditor) tiene sesgos sistemáticos correlacionados con el generador de captions — si ambos comparten arquitectura/entrenamiento, un error de percepción de proporción podría repetirse igual en ambos, haciendo que hasta la auditoría humana propuesta subestime el problema si no usa una segunda fuente de verdad independiente.

### Reviewer 2 (lente First Principles)

1. Más fuerte: **D**. Es el único que estructura el problema como cadena causal de tres etapas independientes y ubica con precisión qué prueba y qué no prueba la auditoría 0/401 en cada eslabón. B tiene un punto técnico fuerte pero es una única apuesta arquitectónica, no un diagnóstico completo del pipeline.
2. Mayor punto ciego: **E**. Se desvía hacia oportunidades de negocio sin resolver la pregunta que se le hizo: si hay evidencia suficiente para entrenar *ahora*. Es el único que no propone una verificación humana inmediata.
3. Lo que las cinco pasaron por alto: ninguna calcula el costo real de la verificación humana propuesta versus el presupuesto de entrenamiento en juego, y ninguna cuestiona si "proporcion_relativa_presente" está bien definida — podría haber falsos negativos que ni el audit ni una muestra humana centrada en ese flag capturarían.

### Reviewer 3 (lente Expansionist)

1. Más fuerte: **D**. Da el mismo diagnóstico que A/B/C pero con el marco más generalizable y accionable.
2. Mayor punto ciego: **E**. Es la única que no cuestiona la validez de la auditoría de fondo — la acepta y pivota a monetización del dataset.
3. Lo que todas omitieron: ninguna cuestiona si 401 fotos totales es un tamaño de dataset viable para un LoRA en absoluto, ni proponen una métrica de éxito cuantitativa post-entrenamiento con un umbral de aceptación definido.

### Reviewer 4 (lente Outsider)

1. Más fuerte: **D**. Localiza exactamente dónde el audit 0/401 puede y no puede detectar fallos ("necesariamente cierto por construcción").
2. Mayor punto ciego: **E**. Su "verificador automático post-entrenamiento" sigue siendo texto-contra-pedido, el mismo punto ciego que A/B/C/D ya identificaron como insuficiente.
3. Lo que las cinco pasaron por alto: ninguna cuantifica el costo/tiempo real de la auditoría humana propuesta, ni pregunta si el propio pipeline de captioning podría auto-reportar su confianza perceptual (bounding boxes o profundidad relativa) en vez de asumir que solo un humano puede detectar el sesgo.

### Reviewer 5 (lente Executor)

1. Más fuerte: **D**. Formalmente rigurosa sin perder lo accionable.
2. Mayor punto ciego: **E**. Diluye la urgencia del problema real con una propuesta de producto tangencial. Es la única que no propone una acción concreta de verificación esta semana.
3. Lo que las cinco pasaron por alto: ninguna cuantifica el costo de NO hacer la validación humana antes de entrenar, ninguna propone una métrica objetiva reproducible (bounding-box + ratio de píxeles) en lugar de "medir a ojo", y ninguna cuestiona si "proporción relativa" es siquiera la señal correcta a aprender vs. simplemente anotar diámetro absoluto por tipo de globo.

---

## Síntesis del presidente del consejo

### Where the Council Agrees

Los cinco advisors — incluso el que se desvía hacia oportunidades de negocio — coinciden en algo que todos los revisores confirmaron de forma independiente: la auditoría de 0/401 no prueba lo que el equipo cree que prueba. Es un chequeo de consistencia texto-contra-texto (¿el número citado existe en el desglose.json?), no texto-contra-imagen (¿ese número está pegado al globo correcto, en la posición correcta, con la proporción correcta?). Cuatro de los cinco advisors (Contrarian, First Principles, Outsider, Executor) llegan a la misma conclusión práctica de forma independiente: falta una verificación humana que mire la foto real y compare la proporción descrita contra lo que se ve en píxeles — no dentro del texto. Los cinco revisores, sin excepción, señalan a First Principles como la respuesta más fuerte porque formaliza *por qué* el audit es "necesariamente cierto por construcción": el modelo de visión solo tiene los códigos del pedido disponibles para citar, así que jamás va a "alucinar" uno que no esté ahí — eso no es evidencia de precisión, es una restricción del espacio de respuestas.

### Where the Council Clashes

**¿Es un problema de datos o un problema de arquitectura?** El Contrarian plantea algo que ningún otro advisor sostiene con la misma fuerza: que los encoders de texto de modelos de difusión tienen una debilidad documentada para aritmética/relaciones numéricas, y que con probablemente menos de 140 fotos con `proporcion_relativa_presente=true`, no hay suficiente repetición para que el LoRA aprenda una regla generalizable en vez de memorizar casos aislados. Los demás advisors tratan el problema como solucionable con mejor QA de datos; el Contrarian sugiere que ni con datos perfectos hay garantía de que el encoder traduzca "el doble de diámetro" en geometría consistente.

**¿Vale la pena pivotar a monetización ahora?** El Expansionist es la voz disonante y los cinco revisores lo marcan como el punto ciego más claro: mientras el resto discute si el pipeline es confiable, él da por sentado que sí y salta a "qué más se puede construir con este dataset". No es una postura irrazonable a mediano plazo, pero en el contexto de la pregunta es prematuro — construir sobre una base no validada.

### Blind Spots the Council Caught

1. **El auditor podría compartir el sesgo del generador.** Nadie cuestionó que tanto el captioner como una eventual verificación "a ojo" por GPT-vision son, en esencia, el mismo tipo de modelo — si GPT-vision tiene un sesgo sistemático de percepción, ese sesgo podría colarse en ambas etapas sin que nadie lo note. Una verificación humana real, con regla en pantalla, es la única que rompe ese círculo.
2. **Nadie puso número al costo.** Todos proponen auditoría humana de 25-50 fotos, pero ninguno estima cuánto tiempo/dinero cuesta eso frente al presupuesto de entrenamiento que se busca proteger — ni al costo de *no* validar y descubrir el fallo después de entrenar.
3. **Nadie definió un umbral de éxito.** Si de 30 fotos auditadas 25 aciertan, ¿es luz verde? ¿27? Sin un criterio numérico de aceptación definido de antemano, la auditoría humana corre el riesgo de ser tan ambigua como la automática.
4. **¿401 fotos totales alcanza para un LoRA?** Nadie cuestionó el tamaño absoluto del dataset, solo su composición interna.
5. **La señal a entrenar en sí podría estar mal elegida.** Un revisor señala que "proporción relativa en texto" es más ambigua para el encoder que anotar diámetro absoluto por tipo de globo — lo cual desafía directamente la "decisión de arquitectura ya tomada" que la pregunta da por cerrada.
6. **`proporcion_relativa_presente` podría tener falsos negativos** que ni el audit automático ni una muestra humana centrada solo en los casos marcados `true` capturarían.

### The Recommendation

El pipeline de captioning **no está listo para entrenar a ciegas**, y la auditoría de 0/401 es higiene de datos, no evidencia de calidad geométrica. Esto no es ambigüedad — es consenso unánime del consejo, confirmado independientemente por los cinco revisores. La causa raíz: el único punto de verdad que existe hoy es texto-contra-pedido; el eslabón que falta — imagen-contra-descripción — nunca se auditó. Antes de comprometer presupuesto de entrenamiento completo, hace falta cerrar ese eslabón con ojos humanos midiendo contra la foto real, no contra el desglose.

### The One Thing to Do First

Tomar una muestra aleatoria de 25-30 fotos con `proporcion_relativa_presente=true`, y que una persona (no un modelo) mida en pantalla —con una herramienta simple de medición de píxeles, no "a ojo"— si la proporción que describe el caption corresponde a la proporción real visible en la imagen; definir de antemano el umbral de aciertos que se considera aceptable antes de ver los resultados.
