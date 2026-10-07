/**
 * Configuración del modelo que LEE la foto de referencia (`/api/references/analyze`), la MISMA en sus dos caminos:
 * el de Python (`REFERENCE_ANALYSIS_PYTHON_ENABLED`, producción: `app/amaterasu/turno.py`) y el directo a Gemini
 * (local). La vista guiada y la clásica llaman a la misma ruta, así que también es la misma para las dos.
 *
 * Hasta el 2026-10-06 el camino directo pedía el modelo con `chatDe()`, que es el del CHAT: heredaba
 * `GEMINI_CHAT_MODEL` y `GEMINI_CHAT_THINKING_LEVEL` (en local, `low`, y la lectura salía con 0 tokens de
 * razonamiento), mientras que Python usaba el modelo por defecto sin bajar el razonamiento. La misma foto se leía
 * con dos configuraciones según dónde corriera.
 *
 * - Modelo: fijo, el mismo valor que `DEFAULT_MODEL` de `turno.py`; la ruta lo manda también a Python (campo
 *   `model` del contrato `reference-turn.v1`, que el Python desplegado ya acepta).
 * - Razonamiento: el del modelo por defecto en los dos caminos. Python no manda `thinking_config`; el camino directo
 *   tampoco. Fijar otro nivel exige cambiar `turno.py` y desplegar el VPS a la vez, o los dos caminos se separan.
 * - Temperatura, tope de salida, esquema y prompt: los pone `analizarReferenciasV2` por variante y viajan igual por
 *   los dos caminos.
 * - Resolución de la imagen: la de por defecto del modelo, alta (1081 tokens por foto medidos con countTokens, igual
 *   que `MEDIA_RESOLUTION_HIGH`), en los dos caminos.
 */
export const MODELO_LECTURA_FOTO = "gemini-3.6-flash";

/** Lo que se registra en la auditoría de cada lectura (`decidir`). */
export const RAZONAMIENTO_LECTURA_FOTO = "por defecto del modelo";
