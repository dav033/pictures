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
dominancia de color sobre píxeles reales, exclusiva de esta IA).

Lo que NO vive aquí, a propósito: `reference-blueprint.ts` y
`reference-structure.ts` son el contrato de referencia compartido por medio
app (chat, generación de imagen, componentes, plan); `candidatos-referencia.ts`
también lo usan `analizar-venue.ts` y el evaluador de estructuras. Los tres
se quedan en `src/lib/ia/` como infraestructura compartida.
