# 0007. Estructuras tipadas de referencia, ambientación no cotizada y prompt JSON para LoRA

Estado: aceptada (2026-09-14), experimental en la parte JSON.

## Problema

Con una imagen de referencia de dos semiarcos asimétricos, la imagen LoRA salía como "columna + arco cerrado + guirnalda":

1. El análisis de referencias solo devolvía `balloon_structure` con forma en texto libre; el chat adivinaba los tipos del plan.
2. El compilador describía como par simétrico dos piezas de alturas distintas y el LoRA v004 cerraba dos semiarcos en un arco.
3. Luces, follaje y utilería de la referencia se descartaban siempre por no estar en el catálogo, aunque definieran la composición.
4. Solo existía el prompt en lenguaje natural; no había forma de comparar un prompt estructurado.

## Decisión

- El análisis perceptual devuelve por estructura `structure` (tipo, lado, altura relativa, curva, apoyo, simetría) y por elemento `composition_relevance`. `src/lib/ia/reference-structure.ts` lo valida y lo convierte en el `visual_semantics` ya existente del contrato `reference-blueprint.v2` (sin cambio de contrato). Los elementos `minor` se omiten.
- El chat recibe esa estructura tipada en `ANALISIS_REFERENCIA_VISUAL` con la instrucción de usar ese tipo y ubicación.
- El compilador no empareja lados con alturas (±15%) o roles distintos, escribe "shorter"/"taller" dentro de un mismo tipo y declara que dos semiarcos opuestos quedan separados. Preflight aplica la misma regla de pares bilaterales.
- Ambientación: un elemento de la referencia se dibuja solo si el análisis lo aprobó como relevante, confianza ≥ 0,6, categoría de ambientación (luces, follaje, mobiliario, pedestal, vajilla, otro), nombre en inglés sin texto/señalética y ninguna estructura del plan lo materializa. Nunca entra al plan, a la cotización ni a las compras; el blueprint del cliente se valida con `ReferenceBlueprintV2Schema` y solo aporta nombres descriptivos.
- `/api/generate` acepta `promptFormat`: `texto` (por defecto), `json` o `ambos`. `ambos` hace dos llamadas a fal.ai con la misma semilla; QA y auditoría aplican a la imagen principal. El JSON contiene los mismos sujetos, ubicaciones, relaciones y colores que el texto y pasa el mismo preflight con presupuesto `LORA_JSON_PROMPT_MAX_LENGTH` (1800); el texto conserva 750.

## Alternativas

- Subir el límite de 750 del texto: descartado, es el régimen de captions del entrenamiento.
- Dibujar todo lo fuera de catálogo: descartado, añade ruido y texto inventado.
- Cambiar el contrato del blueprint con un campo nuevo: innecesario, `visual_semantics` ya existía.

## Consecuencias

- `ambos` duplica el costo de generación.
- Evidencia inicial (misma referencia y plan, `training_1`/v004): el prompt JSON mostró dos semiarcos separados; el texto siguió cerrándolos en un arco. Muestra pequeña, no concluyente.
- La detección de Gemini varía entre corridas (una corrida clasificó un semiarco como columna).

## Reversión

Enviar `promptFormat: "texto"` (o no enviarlo) restaura el comportamiento anterior del prompt. La ambientación se desactiva dejando de enviar `blueprint` a `/api/generate`. Revertir `reference-structure.ts` y su uso en `analizar-referencias-v2.ts` vuelve al análisis sin estructura tipada.
