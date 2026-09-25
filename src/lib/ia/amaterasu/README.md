# Amaterasu

Análisis semántico de la foto de referencia del cliente: qué estructuras de
globos hay, dónde están y de qué colores. Nombrada por la diosa sintoísta
del sol — la luz que revela lo oculto —, igual que esta IA "ilumina" y lee
el contenido de una foto.

- **Entrada**: foto de referencia del cliente (`analizarReferenciasV2`).
- **Salida**: `AnalisisV2Resultado` (elementos detectados, cajas, colores,
  confianza) sobre el contrato `ReferenceBlueprintV2`.
- **Proveedor / modelo**: Google Gemini, `MODELO_CHAT` ([gemini.ts](../../gemini.ts)),
  vía el `ChatPort` inyectado.
- **Consumidor principal**: [api/references/analyze/route.ts](../../../app/api/references/analyze/route.ts).

Archivos propios: `analizar-referencias-v2.ts`, `analisis-ejemplos.ts` (+
`analisis-ejemplos.json`, el fijador de casos de la galería),
`dominancia-referencia.ts` y `decodificar-pixeles.ts` (medición de
dominancia de color sobre píxeles reales, exclusiva de esta IA),
`analizar-venue.ts` (la misma lectura sobre la foto del espacio, que usa
`/api/generate`) y `chat-python.ts` (el `ChatPort` respaldado por Python).

Lecturas de la foto que corren después del análisis, en paralelo:
`patron-referencia.ts` (patrón de color, ADR-0028 §11) y
`bouquet-referencia.ts` (armado de cada bouquet, ADR-0030). Comparten la caché
y las llamadas en vuelo de `deteccion-compartida.ts`. Del lado de Python,
lo que Amaterasu sabe de cada tipo de estructura vive en un submódulo por
tipo: `services/ai-api/app/amaterasu/estructuras/` (ADR-0030).

Lo que NO vive aquí, a propósito: el contrato de la referencia está en
[`../referencia/`](../referencia/) porque lo comparte media app (chat,
generación de imagen, componentes, plan). Ahí están `reference-blueprint.ts`,
`reference-structure.ts` (los tipos de estructura detectables y su mapeo
determinista a la semántica visual) y `candidatos-referencia.ts`. Las
evaluaciones de reconocimiento de estructuras viven en
`src/lib/eval/estructuras/` y `scripts/eval/estructuras/`.
