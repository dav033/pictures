import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { IntentQuerySchema, type IntentQuery } from "./schema";

const JSON_SCHEMA = z.toJSONSchema(IntentQuerySchema, { target: "draft-7" });

const INSTRUCCION = `Interpretas mensajes de clientes de una tienda de decoración de fiestas
(globos, velas, banderolas, kits, guirnaldas) para extraer intención de búsqueda.

No conoces el catálogo real — solo produces filtros e intención, el catálogo lo valida
y busca el backend.

Reglas:
- "filtros_duros" son SOLO requerimientos estrictos e innegociables (ej. "tiene que ser
  dorado", "solo bodas", "máximo 50 mil"). Si el cliente dice algo como "preferiría dorado"
  o "algo elegante", eso NO es un filtro duro — va en semantic_query como preferencia.
- No inventes valores fuera de las categorías/ocasiones/colores permitidas por el schema.
  Si no aplica ninguna, deja el arreglo vacío.
- "semantic_query" es una frase corta en español que resume lo que el cliente busca,
  incluyendo preferencias sueltas de estilo/color/tema que no son filtro duro.
- Si el mensaje no es una búsqueda de producto (saludo, pregunta general, etc.), intent = "other".
- "solo_disponibles" debe ser SIEMPRE true, salvo que el cliente pida explícitamente ver
  productos agotados o descontinuados (algo muy raro).
- "categorias" es el filtro MÁS restrictivo: actívalo SOLO cuando el cliente use una palabra
  que corresponda a UNA sola categoría sin ambigüedad (ej. "arco"/"guirnalda"→guirnalda_arco,
  "velas"→vela, "kit"→kit, "desechables"→desechable, "metalizados"→globo_metalizado). La
  palabra "globos" por sí sola NO activa categoría: abarca globo_latex, globo_metalizado y
  globo_numero_letra a la vez, así que fijarla sería adivinar cuál de las tres quiso decir el
  cliente — esa palabra va en semantic_query, no en filtros_duros. Ante la duda, deja
  "categorias" vacío: el ranking ya prioriza lo que el cliente describió, y un filtro de
  categoría de más puede dejar fuera kits y combos que sí le servían.
- "diametros_pulgadas" es el tamaño EXACTO del globo redondo en pulgadas — SOLO los valores
  5, 9, 12, 18 o 24 (36 es jumbo especial, rara vez lo pide un cliente por nombre). Actívalo
  cuando el cliente dé un número explícito ("de 5 pulgadas", "R-12", "tamaño 9") o un término
  de tamaño inequívoco: "chiquito"/"pequeñito"/"mini" → 5; "mediano"/"normal" → 12;
  "grande" → 18; "gigante"/"jumbo" → 24. Si el cliente NO menciona tamaño para nada, deja el
  arreglo vacío — el sistema arma una mezcla de tamaños razonable por su cuenta, no adivines
  un tamaño que nadie pidió.
- "formas" es la forma física del globo (redondo, corazon, link, modelar) — NUNCA el acabado
  (metalizado es "categorias: globo_metalizado", no una forma). Actívalo solo cuando el
  cliente la nombre explícitamente ("globos de corazón", "para figuras/modelar").`;

/**
 * Query Interpreter (plan §3.10). El LLM solo produce intención estructurada,
 * nunca productos — el retrieval y el backend son quienes tocan el catálogo.
 *
 * Esta llamada era el 88% de la latencia de una búsqueda (medido:
 * PLAN_RENDIMIENTO_RAG.md §1.1) porque el modelo razonaba en nivel "medium"
 * por defecto para clasificar texto a enums cerrados — 4-14x más tokens
 * pensando que produciendo. `thinkingLevel: "minimal"` da la misma extracción
 * (verificado 12/12 casos estables en 3 repeticiones cada uno — la regla de
 * "categorias" arriba fue necesaria para el caso que fallaba) a una fracción
 * de la latencia, MISMO modelo.
 *
 * `gemini-3.5-flash-lite` (más barato) se probó y se descartó: aislado en
 * 8 repeticiones, falló extracción de color compuesto 1/8 y clasificación de
 * intención ambigua 3-5/8, con o sin thinking — no es un efecto del nivel de
 * razonamiento, es el modelo. `gemini-3.6-flash` fue 8/8 limpio en ambos
 * casos con o sin `minimal`. No cambiar de modelo sin repetir esta medición.
 */
export async function interpretarConsulta(mensaje: string): Promise<IntentQuery> {
  const client = getGeminiClient();
  if (!client) throw new Error("No hay GEMINI_API_KEY configurada.");

  const respuesta = await client.models.generateContent({
    model: MODELO_CHAT,
    contents: [{ role: "user", parts: [{ text: mensaje }] }],
    config: {
      systemInstruction: INSTRUCCION,
      responseMimeType: "application/json",
      responseJsonSchema: JSON_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });

  const texto = respuesta.text;
  if (!texto) throw new Error("Gemini no devolvió una respuesta estructurada.");

  return IntentQuerySchema.parse(JSON.parse(texto));
}
