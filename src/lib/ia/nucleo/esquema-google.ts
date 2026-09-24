/**
 * Google's `response_schema` (the Python google-genai SDK, and the Gemini API
 * behind it) accepts a narrower subset of JSON Schema than the `@google/genai`
 * (JS) SDK's `responseJsonSchema` already running in production. Three
 * patterns from Zod's draft-7 export do not survive the trip, each found by
 * an actual failing call against Gemini on 2026-09-22, not just schema
 * validation (`types.Schema.model_validate` alone did not catch the
 * `additionalProperties` one -- the Gemini API itself rejects it during
 * request serialization):
 * - Top-level `$schema` -- rejected as an unknown field.
 * - `additionalProperties` (Zod's `.strict()`) -- the Gemini API raises
 *   "additional_properties parameter is not supported" outright, even `false`.
 * - `const` unions (`anyOf` of `{type, const}`, how Zod represents a numeric
 *   enum since `z.enum` only works on strings) -- Google's `enum` field only
 *   accepts strings, so a numeric const-union keeps only its `type` and loses
 *   the enum constraint. The caller's Zod schema still rejects an
 *   out-of-range value on the way back.
 *
 * Shared by every structured-output call routed through Python (Inari,
 * Happie); the caller keeps validating the result with its own Zod schema.
 */
export function paraGoogleSchema(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(paraGoogleSchema);
  if (nodo === null || typeof nodo !== "object") return nodo;
  const objeto = nodo as Record<string, unknown>;
  const ramas = objeto.anyOf;
  const esEnumDeConstantes = Array.isArray(ramas) && ramas.length > 0
    && ramas.every((rama) => typeof rama === "object" && rama !== null && "const" in (rama as Record<string, unknown>));
  const clavesNoSoportadas = new Set(["$schema", "additionalProperties"]);
  const entradas = Object.entries(objeto).filter(([clave]) => !clavesNoSoportadas.has(clave) && !(esEnumDeConstantes && clave === "anyOf"));
  const base = Object.fromEntries(entradas.map(([clave, valor]) => [clave, paraGoogleSchema(valor)]));
  if (!esEnumDeConstantes) return base;
  const constantes = (ramas as Record<string, unknown>[]).map((rama) => rama.const);
  const tipo = (ramas as Record<string, unknown>[])[0]!.type;
  return constantes.every((valor) => typeof valor === "string")
    ? { ...base, type: tipo, enum: constantes }
    : { ...base, type: tipo };
}

/** Root-level form for callers that hand a whole object schema over the wire. */
export function esquemaRaizParaGoogle(schema: Record<string, unknown>): Record<string, unknown> {
  // An object node always maps to an object (Object.fromEntries, or a spread of one).
  return paraGoogleSchema(schema) as Record<string, unknown>;
}
