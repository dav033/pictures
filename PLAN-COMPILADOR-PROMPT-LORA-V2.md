# Plan de seguimiento — Compilador de prompt LoRA v2

Fecha: 2026-08-27  
Estado: plan aprobado conceptualmente; implementación pendiente  
Prioridad: alta  
Documento previo obligatorio: `HANDOFF-SESION-DATASET.md`, empezando por **SESIÓN 5**.

## 1. Objetivo

Reemplazar el armado actual del prompt LoRA por un compilador semántico determinista que convierta el plan aprobado en una caption natural en inglés.

No basta con igualar un prompt manual. El resultado nuevo debe ser mediblemente superior porque puede conservar información que el humano suele omitir:

- estructura exacta;
- cantidad de estructuras;
- ubicación de cada pieza;
- relaciones espaciales;
- jerarquía focal/soporte/acento;
- colores y acabados comerciales;
- evento y espacio;
- soporte físico y profundidad.

Prioridad visual:

1. Composición y relaciones espaciales.
2. Presencia y cantidad de estructuras.
3. Ubicación y anclaje físico.
4. Paleta y acabado.
5. Jerarquía y escala relativa.
6. Estilo, ambiente y fotografía.

## 2. Estado de partida

### 2.1 Ya funciona

- Saldo de fal.ai confirmado.
- LoRA v2 responde correctamente.
- Existe modo de depuración `LoRA · app` contra `LoRA · directo`.
- Ambas llamadas usan la misma seed cuando se especifica.
- Cada tarjeta muestra el prompt enviado.
- El trigger `eventdecor_style_v2` se normaliza para evitar duplicación.
- Comparación real ejecutada desde `http://localhost:3001/`.

Archivos ya tocados por la comparación:

- `src/lib/ia/sempertex-lora.ts`
- `src/app/api/generate/route.ts`
- `src/app/page.tsx`
- `src/components/ComparacionModelos.tsx`

### 2.2 Resultado observado

Caso aprobado:

- un arco orgánico principal;
- dos columnas coordinadas, izquierda y derecha;
- un acento bajo sobre la mesa principal;
- rosado Reflex y dorado rosa metalizado;
- XV años en salón.

Prompt de la app:

```text
eventdecor_style_v2, a full, dense, large balloon arch mixing pink and rose gold in organic clusters, framing the entrance, two balloon columns mixing pink and rose gold in organic clusters, and a balloon installation in rose gold, glam style, recognizable indoor event hall with real walls, ceiling, floor, architectural depth, and event lighting, quinceañera celebration atmosphere, wide photorealistic event photograph, natural depth, physical floor supports.
```

Resultado app:

- arco enorme en primer plano;
- segundo arco interno no solicitado;
- columnas no reconocibles como dos piezas laterales independientes;
- acento de mesa no claramente representado;
- composición menos fiel al plan.

Prompt directo usado como campeón inicial:

```text
a grand organic balloon arch framing the entrance or photo area, two matching balloon columns standing on the left and right sides of the stage, and a low balloon arrangement on the quinceañera's main table, styled for an elegant and glamorous quinceañera celebration in an indoor event hall, using bright reflex pink and metallic rose gold balloons, refined high-impact event decor, wide photorealistic event photograph, natural depth, physical floor supports
```

Resultado directo:

- un arco principal reconocible;
- dos soportes/columnas laterales;
- mesa principal visible;
- acento bajo sobre la mesa;
- composición mucho más cercana al plan;
- todavía imperfecto, pero claramente superior al prompt de la app.

Conclusión: agregar `framing the entrance` al arco fue insuficiente. El problema principal no es solo anclar el arco; es conservar la semántica espacial completa de todas las estructuras.

## 3. Diagnóstico técnico

### 3.1 Pérdida de tipo

`planBlueprint()` recibe `declarada.tipo`, pero convierte casi todo en la categoría genérica `balloon_structure`.

Consecuencia:

- arco, columna, centro de mesa, guirnalda y otras estructuras dejan de tener tipo canónico en `SceneSpec`;
- `buildLoraImagePrompt()` intenta recuperarlo leyendo el nombre libre;
- nombres como `Acento Bajo para Mesa Principal` no contienen `centro de mesa` y terminan como `balloon installation`.

### 3.2 Pérdida de ubicación

El plan contiene valores explícitos:

- `arco_central`;
- `lateral_izquierdo`;
- `lateral_derecho`;
- `sobre_mesa_principal`;
- y demás ubicaciones del contrato.

Actualmente la ubicación se transforma principalmente en `target_bbox` y `depth_layer`. `buildLoraImagePrompt()` no utiliza esas coordenadas ni conserva la etiqueta semántica original.

Consecuencia: `two balloon columns` conserva cantidad, pero pierde `one on the left and one on the right`.

### 3.3 Anclaje incorrecto del arco

`loraGroundingSuffix()` agrega `framing the entrance` a todo arco.

Problemas:

- ignora si el plan declara `arco_central`, `fondo_pared` o `entrada`;
- puede introducir una puerta o entrada secundaria;
- puede favorecer el doble arco visto en la prueba;
- convierte una corrección puntual en regla global falsa.

### 3.4 Tipo detectado por texto libre

`loraStructureNoun()` busca palabras en `element.name`.

Esto es válido solo como fallback para blueprints antiguos o referencias externas. No debe ser fuente primaria cuando existe un plan tipado.

### 3.5 Ruido y jerarquía accidental

- `full, dense, large` se aplica globalmente al primer elemento.
- El arco queda sobredominante.
- `mixing ... in organic clusters` se repite en cada estructura multicolor.
- `loraNaturalJoin()` usa relaciones genéricas como `beside`.
- La paleta vuelve a aparecer en cláusulas posteriores.
- El prompt usa adjetivos antes de asegurar composición.

### 3.6 Omisión silenciosa

El constructor actual toma solo los primeros seis elementos.

Un plan grande puede perder estructuras aprobadas sin error. Esto es incompatible con la promesa de fidelidad del plan.

### 3.7 QA incompleto durante comparación

En modo `compararLora`, la imagen principal es la app si esa llamada funciona. El QA se construye sobre esa imagen principal, no independientemente para cada tarjeta.

Consecuencia: el comparador visual existe, pero no produce métricas equivalentes app/directo.

## 4. Decisiones de arquitectura

### 4.1 `SceneSpec` sigue siendo autoridad

No pasar `PlanResuelto` directamente al compilador como segunda fuente de verdad.

La semántica visual necesaria debe preservarse dentro de cada `SceneElement`. Así:

- prompt y QA leen la misma escena;
- `sceneSpecHash` cubre también la intención espacial;
- no aparecen divergencias entre plan, prompt y evaluación.

Bloque propuesto:

```ts
visual_semantics: {
  structure_type: "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa" | "backdrop" | "kit" | "accesorio";
  placement: "fondo_pared" | "arco_central" | "sobre_mesa_principal" | "lateral_izquierdo" | "lateral_derecho" | "piso_frontal" | "mesas_invitados" | "entrada" | "techo";
  design_role: "focal" | "soporte" | "acento";
  repetition_group: string;
  dimensions_m?: {
    width?: number;
    height?: number;
    length?: number;
  };
  density: "sencilla" | "equilibrada" | "lujosa";
}
```

Usar los unions reales del proyecto si sus nombres difieren.

### 4.2 Separar estructuras de material

`quantity` puede representar globos instalados dentro de una estructura. No debe interpretarse como cantidad de arcos o columnas.

Reglas:

- cada `SceneElement` expandido equivale a una estructura física;
- `repetition_group` permite reagrupar instancias iguales;
- `quantity` conserva cantidad de material para escala y QA;
- cantidad estructural se calcula por número de elementos del mismo grupo.

### 4.3 Compilador determinista

No introducir otro LLM para reescribir el prompt en el camino crítico.

Razones:

- evita latencia y costo extra;
- conserva reproducibilidad;
- evita inventar estructuras;
- facilita snapshots;
- permite comparar dos versiones con misma entrada y seed.

### 4.4 Nuevo módulo aislado

Crear:

```text
src/lib/ia/lora-caption-compiler.ts
```

`build-image-prompt.ts` debe delegar la caption LoRA a ese módulo. El prompt extenso de Gemini queda separado.

## 5. Representación intermedia

Antes de redactar inglés, transformar cada elemento en una cláusula tipada:

```ts
type LoraVisualClause = {
  elementIds: string[];
  structureType: string;
  noun: string;
  count: number;
  colors: string[];
  finishes: string[];
  scale?: string;
  density?: string;
  placement: string;
  relation?: string;
  anchorElementId?: string;
  salience: number;
};
```

Pipeline:

1. Leer semántica canónica.
2. Traducir tipo a sustantivo visual.
3. Traducir colores y acabados.
4. Agrupar repeticiones compatibles.
5. Detectar pares izquierda/derecha.
6. Resolver anclas y relaciones.
7. Ordenar por importancia visual.
8. Redactar caption.
9. Ejecutar preflight.
10. Solo entonces abrir llamada pagada.

## 6. Diccionario de tipos

Base recomendada:

| Tipo de plan | Sustantivo LoRA |
|---|---|
| `arco` | `organic balloon arch` |
| `semiarco` | `asymmetrical balloon half-arch` |
| `guirnalda` | `organic balloon garland` |
| `columna` | `balloon column` |
| `pared` | `balloon wall` |
| `centro_mesa` | `low balloon centerpiece` |
| `backdrop` | `decorated backdrop` |
| `kit` | nombre visual específico del kit |
| `accesorio` | nombre visual específico del accesorio |

No usar `balloon installation` para un tipo conocido.

Antes de cerrar vocabulario, analizar frecuencia en las 154 captions y preferir frases ya presentes en el dataset.

## 7. Diccionario de ubicaciones

| Ubicación | Frase visual base |
|---|---|
| `entrada` | `framing the venue entrance` |
| `arco_central` | `centered around the stage photo area` |
| `lateral_izquierdo` | `standing on the left side` |
| `lateral_derecho` | `standing on the right side` |
| `sobre_mesa_principal` | `a low arrangement placed on the main table` |
| `fondo_pared` | `installed against the rear wall` |
| `piso_frontal` | `grounded across the front of the stage` |
| `mesas_invitados` | `distributed across the guest tables` |
| `techo` | `suspended overhead from the ceiling` |

Regla: no redactar alternativas con `or` cuando el plan ya eligió una ubicación.

`arco_central` no debe convertirse automáticamente en entrada. Si el cliente quiere entrada, el plan debe declarar `entrada`.

## 8. Relaciones espaciales

Resolver relaciones antes de redactar.

### 8.1 Par bilateral

Condición:

- mismo tipo;
- mismo grupo visual;
- uno en `lateral_izquierdo`;
- otro en `lateral_derecho`.

Salida:

```text
two matching balloon columns, one standing on the left and one on the right, flanking the main arch
```

### 8.2 Elemento sobre mobiliario

`sobre_mesa_principal`:

```text
a low coordinated balloon centerpiece placed on the main table
```

Si existe focal central compatible:

```text
placed on the main table beneath the arch
```

### 8.3 Backdrop

Backdrop relacionado con focal:

```text
a decorated backdrop installed behind the main arrangement
```

### 8.4 Elemento de techo

```text
a suspended overhead balloon installation anchored to the ceiling
```

### 8.5 Repeticiones

No listar cada instancia por separado cuando comparten tipo, color y función.

Ejemplo:

```text
twelve matching low centerpieces distributed across the guest tables
```

No cortar elementos después de seis. Agrupar para controlar longitud.

## 9. Jerarquía y presupuesto de adjetivos

Cada prompt debe gastar primero palabras en geometría.

Orden:

1. sustantivo;
2. cantidad;
3. ubicación;
4. relación;
5. color/acabado;
6. escala relativa;
7. estilo;
8. fotografía.

Reglas:

- máximo dos calificadores de densidad/escala por estructura focal;
- soportes reciben escala relativa, no el volumen global de la escena;
- evitar repetir `organic clusters` por elemento;
- evitar repetir paleta global después de describir colores locales;
- evitar cadenas como `full, dense, large, high-impact, glamorous` si desplazan relaciones físicas.

## 10. Gramática de salida

Formato base:

```text
eventdecor_style_v2, [estructura focal y ubicación], [soportes y relaciones], with [acentos anclados]. [evento, espacio y estilo], [tratamiento fotográfico y soporte físico].
```

Contrato:

- trigger una sola vez y al inicio;
- inglés natural;
- una o dos frases;
- objetivo de 350–650 caracteres;
- límite duro recomendado: 750 caracteres;
- sin IDs internos;
- sin precios;
- sin paquetes;
- sin códigos de sustitución;
- sin cantidades de compra;
- sin instrucciones negativas extensas;
- sin texto español sin normalizar;
- sin etiquetas tipo `STRUCTURE:` o JSON.

La distribución debe parecer caption del entrenamiento, no especificación técnica.

## 11. Prompt objetivo del caso actual

Primera hipótesis v2:

```text
eventdecor_style_v2, a single grand organic balloon arch in bright reflex pink and metallic rose gold centered around the quinceañera photo area, flanked by two matching balloon columns, one standing on the left and one on the right, with a low coordinated balloon centerpiece placed on the main table beneath the arch. Elegant glamorous quinceañera decor in a real indoor event hall, wide photorealistic event photograph, balanced visual hierarchy, natural depth, believable floor contact and supports.
```

Ventajas frente al directo actual:

- elimina `entrance or photo area`;
- declara un solo arco;
- fija el arco al área central de fotos;
- fija exactamente dos columnas;
- conserva izquierda y derecha;
- relaciona columnas con arco;
- ancla el acento a la mesa;
- relaciona mesa y arco;
- mantiene caption natural y compacta.

No convertir esta frase en caso especial. Debe salir de reglas generales.

## 12. Preflight antes de fal.ai

Crear:

```text
src/lib/ia/lora-prompt-preflight.ts
```

El preflight recibe `SceneSpec`, representación intermedia y prompt final.

Debe bloquear la llamada si:

- falta una estructura requerida;
- falta ubicación semántica;
- se perdió una relación bilateral;
- un tipo conocido cayó en `balloon installation`;
- existe español sin traducir;
- trigger duplicado;
- aparecen IDs, precios, paquetes o SKU;
- cantidad estructural contradice la escena;
- el prompt contiene ubicaciones incompatibles;
- algún elemento fue descartado por límite interno;
- longitud supera el límite;
- no existe anclaje para una pieza que lo requiere.

Salida de diagnóstico sugerida:

```text
Estructuras: 4/4
Ubicaciones: 4/4
Relaciones: 3/3
Colores: 4/4
Fallbacks genéricos: 0
Ambigüedades: 0
```

## 13. Pruebas automáticas

### 13.1 Unitarias de interpretación

Probar:

- tipo canónico produce sustantivo correcto;
- nombre libre no sobrescribe tipo canónico;
- `centro_mesa` funciona aunque el nombre sea `Acento Bajo`;
- izquierda/derecha se agrupan como par bilateral;
- cantidades de globos no se convierten en cantidad de estructuras;
- repeticiones sí producen cantidad estructural;
- arco central no genera entrada;
- arco en entrada sí genera `framing the venue entrance`;
- elementos posteriores al sexto no desaparecen.

### 13.2 Snapshots de captions

Agregar casos a `scripts/test-visual-prompts.ts` o crear fixtures dedicados.

Casos mínimos:

1. arco único en entrada;
2. arco único central;
3. arco + dos columnas;
4. caso XV actual;
5. centro de mesa con nombre no canónico;
6. backdrop + arco;
7. guirnalda asimétrica;
8. instalación de techo;
9. múltiples centros de mesa;
10. seis o más estructuras;
11. colores Reflex y metálicos;
12. dos estructuras iguales con ubicaciones diferentes.

### 13.3 Propiedades globales

Para todos los fixtures:

- trigger aparece una vez;
- prompt dentro del rango;
- ningún ID interno;
- ningún precio/SKU/paquete;
- ningún tipo conocido usa fallback genérico;
- cobertura estructural 100%;
- cobertura de ubicación 100%;
- salida determinista.

## 14. Comparador de depuración v2

Ampliar modo actual a tres tarjetas:

1. `LoRA · app v1`
2. `LoRA · app v2`
3. `LoRA · directo`

Requisitos:

- misma seed;
- mismo modelo y peso LoRA;
- mismo tamaño;
- llamadas paralelas;
- prompt exacto por tarjeta;
- versión y hash del compilador;
- error independiente;
- QA independiente;
- orden visual aleatorio opcional para evaluación ciega;
- voto manual: mejor, empate o peor;
- razón corta del voto.

El resultado principal no debe determinar el QA de las demás tarjetas.

Cada item de comparación debería poder devolver:

```ts
{
  id: string;
  promptVersion: string;
  promptHash: string;
  seed: number;
  imagen?: string;
  error?: string;
  qa?: ImageQaReport;
  preflight?: LoraPromptPreflightReport;
}
```

## 15. Protocolo de evaluación

Una imagen con una seed no decide calidad.

### 15.1 Ronda rápida

- 12 planes representativos.
- Tres prompts: v1, v2 y directo campeón.
- Tres seeds por caso.
- 108 imágenes.

Familias de casos:

- geometría simple;
- pares laterales;
- anclaje a mesa;
- entrada contra escenario;
- fondos;
- techo;
- repetición masiva;
- paletas metálicas/Reflex;
- eventos diferentes;
- escenas con muchos elementos.

### 15.2 Ronda final

- 20 planes.
- Cinco seeds por plan.
- Evaluación ciega con orden A/B/C aleatorio.
- No cambiar prompts manualmente entre casos.

### 15.3 Puntaje visual

| Dimensión | Peso |
|---|---:|
| Presencia de estructuras | 30% |
| Ubicación y relaciones | 25% |
| Cantidades estructurales | 15% |
| Color y acabado | 10% |
| Jerarquía y composición | 10% |
| Realismo, profundidad y soporte | 10% |

### 15.4 Criterio de superioridad

El compilador v2 pasa cuando:

- estructuras obligatorias presentes: al menos 95%;
- ubicaciones correctas: al menos 90%;
- estructuras duplicadas/fusionadas: máximo 10%;
- gana al directo en al menos 65% de comparaciones;
- gana o empata al directo en al menos 85%;
- gana a v1 en al menos 80%;
- ningún fixture simple presenta regresión grave;
- resultados se sostienen en varias seeds.

QA automático sirve como señal, no como único juez. Complementar con ranking humano ciego.

## 16. Fases de implementación

### Fase 0 — Congelar evidencia

Entregables:

- fixture del plan XV;
- prompt v1;
- prompt directo;
- seed usada;
- imágenes observadas;
- notas de resultado.

No depender de la imagen temporal del portapapeles para otra sesión. Copiarla a `reports/lora-debug/` si todavía existe.

### Fase 1 — Preservar semántica

Cambios:

- extender `SceneElementSchema`;
- poblar `visual_semantics` desde `planBlueprint()`;
- mantener compatibilidad para blueprints sin plan;
- actualizar hash y fixtures afectados;
- validar que tipo y ubicación sobreviven hasta generación.

### Fase 2 — Compilador e IR

Cambios:

- crear `lora-caption-compiler.ts`;
- implementar diccionarios;
- agrupar repeticiones;
- detectar pares laterales;
- resolver relaciones;
- redactar caption v2;
- eliminar dependencia primaria del nombre libre.

### Fase 3 — Preflight y tests

Cambios:

- crear validador;
- bloquear llamadas incoherentes;
- agregar tests unitarios y snapshots;
- cubrir caso XV y matriz mínima.

No generar imágenes pagadas hasta que esta fase pase.

### Fase 4 — Comparador y QA por tarjeta

Cambios:

- agregar v1/v2/directo;
- ejecutar QA para cada resultado;
- mostrar cobertura y errores;
- conservar misma seed;
- registrar versión/hash.

### Fase 5 — Evaluación pagada

Cambios:

- ejecutar ronda rápida;
- ajustar reglas generales;
- ejecutar ronda final;
- documentar resultados por estructura y ubicación.

### Fase 6 — Activación

Usar feature flag:

```text
LORA_PROMPT_VERSION=v1|v2
```

Despliegue:

1. desarrollo;
2. modo debug/shadow;
3. v2 por defecto;
4. conservar rollback inmediato a v1 durante evaluación.

Telemetría mínima:

- prompt version;
- prompt hash;
- seed;
- modelo/LoRA;
- preflight;
- QA;
- latencia;
- ganador manual;
- nunca registrar `FAL_KEY`.

## 17. Archivos previstos

Modificar:

- `src/lib/ia/scene-spec.ts`
- `src/app/api/generate/route.ts`
- `src/lib/ia/build-image-prompt.ts`
- `src/lib/ia/image-qa.ts`
- `src/components/ComparacionModelos.tsx`
- `src/app/page.tsx`, solo si el selector necesita tercer modo
- `scripts/test-visual-prompts.ts`

Crear:

- `src/lib/ia/lora-caption-compiler.ts`
- `src/lib/ia/lora-prompt-preflight.ts`
- fixtures de prompts/planes
- script de evaluación por múltiples seeds
- reporte consolidado en `reports/lora-debug/`

## 18. Riesgos y mitigaciones

### Sobre-especificación

Riesgo: demasiadas relaciones producen escena rígida o collage.

Mitigación: una relación primaria por estructura y una secundaria solo cuando sea indispensable.

### Prompts demasiado largos

Riesgo: alejarse de distribución del dataset.

Mitigación: agrupar repeticiones, deduplicar paleta y limitar adjetivos.

### Optimizar solo XV

Riesgo: prompt excelente para este caso, peor para otros.

Mitigación: fixtures por tipo y ubicación; ninguna frase especial por evento.

### Confundir material con estructuras

Riesgo: `118 units` interpretado como 118 piezas decorativas.

Mitigación: separación explícita entre instancias y material instalado.

### Seed afortunada

Riesgo: declarar victoria con una imagen.

Mitigación: mínimo tres seeds en iteración y cinco en validación final.

### QA sesgado

Riesgo: evaluar mejor la tarjeta elegida como principal.

Mitigación: observación independiente por imagen y ranking humano ciego.

## 19. Fuera de alcance inmediato

- No reentrenar LoRA todavía.
- No agregar más negativos para tapar pérdida semántica.
- No escribir un prompt manual por evento.
- No usar un LLM reescritor en producción.
- No mezclar precios, paquetes o sustituciones con descripción visual.
- No considerar resuelto el fix de honestidad en `prompt-sistema.ts`; sigue siendo prueba separada y no bloquea este trabajo.

Reentrenamiento solo se evalúa si, después del compilador v2, existen fallas repetibles por categoría con prompts correctos.

## 20. Definición de terminado

Trabajo completo cuando:

- `SceneSpec` conserva tipo y ubicación canónicos;
- compilador no depende del nombre libre para planes aprobados;
- caso XV produce cláusulas correctas sin texto manual especial;
- preflight logra cobertura completa;
- pruebas y build pasan;
- comparador muestra v1/v2/directo con QA independiente;
- ronda final cumple umbrales;
- v2 queda detrás de flag con rollback;
- resultados y decisiones quedan documentados.

## 21. Inicio recomendado de próxima sesión

1. Leer `HANDOFF-SESION-DATASET.md`, priorizando SESIÓN 5.
2. Leer este documento completo.
3. Revisar worktree sucio y preservar cambios ajenos.
4. Copiar evidencia visual temporal a `reports/lora-debug/` si sigue disponible.
5. Implementar Fase 1 completa.
6. Agregar tests que demuestren pérdida actual de tipo y ubicación.
7. Implementar Fases 2 y 3.
8. Ejecutar TypeScript, tests dirigidos, lint dirigido y build.
9. Solo después consumir crédito en la ronda rápida.

Primera prueba de aceptación recomendada:

```text
Cumpleaños en salón, un arco de globos rojo y dorado
```

Segunda prueba obligatoria: repetir el caso XV documentado aquí y comparar v1/v2/directo con varias seeds.
