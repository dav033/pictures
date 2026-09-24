# Inari

Parser de intención de búsqueda del catálogo (RAG). Nombrado por la deidad
sintoísta del comercio y la abundancia, representada por zorros mensajeros
que encuentran lo que se busca.

- **Entrada**: mensaje del cliente en texto libre (`interpretarConsulta`).
- **Salida**: `IntentQuery` ([schema.ts](../../rag/query-parser/schema.ts)).
- **Proveedor / modelo**: Google Gemini, `MODELO_CHAT` ([gemini.ts](../../gemini.ts)).
- **Estrategia**: determinista primero — `interpretarConsultaDeterminista`
  ([deterministic.ts](../../rag/query-parser/deterministic.ts)) resuelve el
  caso cuando su confianza es `"certain"`. Gemini solo se llama para
  enriquecer un parse ambiguo, y cualquier falla de proveedor cae de vuelta al
  resultado determinista: la búsqueda nunca se bloquea por esta IA.
- **Consumidor principal**: [rag/chat/buscar.ts](../../rag/chat/buscar.ts).

El resto de `rag/query-parser/` (`deterministic.ts`, `event-search.ts`,
`parse-event.ts`, `hard-filters.ts`, `schema.ts`, `event-schema.ts`) es
lógica determinista sin llamada a proveedor, compartida por más consumidores
que esta IA — se queda en su lugar; Inari solo posee la llamada a Gemini y su
propio prompt (`parse.ts`).
