import { analizarReferenciasV2 } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { crearChatTurnoPython } from "@/lib/ia/amaterasu/chat-python";
import { leerLecturasDeFoto } from "@/lib/ia/amaterasu/lecturas-foto";
import { chatDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import type { ProveedorId } from "@/lib/ia/nucleo/tipos";
import {
  BOUQUET_REFERENCIA_PYTHON_ENABLED,
  CONTEO_REFERENCIA_PYTHON_ENABLED,
  GUIRNALDA_REFERENCIA_PYTHON_ENABLED,
  PATRON_REFERENCIA_PYTHON_ENABLED,
  REFERENCE_ANALYSIS_PYTHON_ENABLED,
} from "@/lib/ia/nucleo/feature-flags";
import { registrarFalloUi } from "@/lib/errores-ui/traducir-error-servidor";
import { cuerpoExito, leerCuerpo, referenciasEtiquetadas, respuestaError, validarCuerpo } from "./analisis-http";

export const maxDuration = 120;

export async function POST(request: Request) {
  const vencimiento = Date.now() + maxDuration * 1000;
  let id: ProveedorId | undefined;
  const requestId = crypto.randomUUID();
  const correlationHeader = request.headers.get("x-correlation-id");
  const correlationId = correlationHeader && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationHeader)
    ? correlationHeader
    : requestId;
  try {
    const body = validarCuerpo(await leerCuerpo(request));
    const cookie = request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1];
    id = resolverProveedor({ override: body.proveedor, cookie });
    // Fase 2 de ADR-0026: flag de capacidad propio de Amaterasu, gradual e
    // independiente de las demás IAs -- ver crearChatTurnoPython.
    const chat = REFERENCE_ANALYSIS_PYTHON_ENABLED
      ? crearChatTurnoPython({ requestId, correlationId })
      : await chatDe(id);
    const references = referenciasEtiquetadas(body.images);
    // La descripción visual no decide productos. El chat resuelve después
    // cada elemento mediante buscar_catalogo_rag contra PostgreSQL validado.
    // `sin_cache` es el "Reintentar" de la UI: pide un análisis nuevo.
    const analisis = await analizarReferenciasV2(chat, references, [], "perceptual", { requestId, correlationId, superficie: "/api/references/analyze" }, request.signal, { forzarNuevoAnalisis: body.sinCache });
    // ADR-0028 §11: el patrón de color de cada estructura lo lee Python en una
    // llamada aparte (el prompt del análisis sigue congelado). Un fallo deja el
    // blueprint sin pistas; nunca rompe el análisis. La misma foto con los
    // mismos elementos (un análisis de la caché o de la galería) reutiliza la
    // detección ya pagada; "Reintentar" (`sin_cache`) pide una nueva.
    // ADR-0030: el armado de cada bouquet es otra lectura igual, en paralelo
    // con la del patrón y con el mismo vencimiento; las dos se juntan por elemento.
    // ADR-0031: el conteo de globos de cada estructura es la tercera lectura,
    // en paralelo con las otras dos (`leerLecturasDeFoto`).
    // ADR-0032 (E4): el armado de cada guirnalda es la cuarta, y con ella la
    // ubicación de las guirnaldas se refina con su lectura y los muebles.
    const lectura = { requestId, correlationId, signal: request.signal, vencimiento, sinCache: body.sinCache };
    const blueprint = await leerLecturasDeFoto(analisis.blueprint, references, lectura, {
      patron: PATRON_REFERENCIA_PYTHON_ENABLED,
      bouquet: BOUQUET_REFERENCIA_PYTHON_ENABLED,
      conteo: CONTEO_REFERENCIA_PYTHON_ENABLED,
      guirnalda: GUIRNALDA_REFERENCIA_PYTHON_ENABLED,
    });
    const result = { ...analisis, blueprint };
    // Qué vio el reconocedor y qué lecturas quedaron en cada elemento: solo
    // ids, tipos y conteos (nunca la foto), para diagnosticar un plan que no
    // sigue la foto (2026-09-25: un bouquet de 5 globos salía con 12 o 20).
    console.info("[references/analyze] elementos", JSON.stringify({
      request_id: requestId,
      cache: analisis.metadata.cached,
      elementos: result.blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => ({
        id: elemento.element_id,
        tipo: elemento.visual_semantics?.structure_type ?? null,
        // Con la confianza y los colores, no solo el modo: una pista por debajo de 0,5
        // la descarta `patron_desde_pista` y la pieza cae al preset, que en una pared es
        // confeti igual que la pista `aleatorio`. Sin la confianza aquí, el modo leído
        // parecía correcto y la caída al preset no se veía en ningún registro.
        // `zonas` es el dato propio del modo del mismo nombre (ADR-0036): sin él
        // no se distingue una pared en zonas leída con sus cuatro manchas de una
        // que llegó sin ninguna y se degradó a "ninguno" en la validación.
        patron: elemento.appearance.patron_color
          ? { modo: elemento.appearance.patron_color.modo, confianza: elemento.appearance.patron_color.confianza, colores: elemento.appearance.patron_color.colores, zonas: elemento.appearance.patron_color.zonas?.map((zona) => `${zona.color}@${zona.ancla}:${zona.extension}`) ?? null }
          : null,
        armado: elemento.appearance.armado_bouquet
          ? { confianza: elemento.appearance.armado_bouquet.confianza, niveles: elemento.appearance.armado_bouquet.niveles.length, numeros: elemento.appearance.armado_bouquet.numeros?.map((numero) => numero.digito).join("") ?? null }
          : null,
        // Solo con la lectura encendida: apagada, esta línea es la de siempre.
        ...(elemento.appearance.conteo
          ? { conteo: { visibles: elemento.appearance.conteo.globos_visibles, exacto: elemento.appearance.conteo.exacto, estimado: elemento.appearance.conteo.estimado_total, confianza: elemento.appearance.conteo.confianza } }
          : {}),
        ...(elemento.appearance.armado_guirnalda
          ? { guirnalda: { soporte: elemento.appearance.armado_guirnalda.soporte, forma: elemento.appearance.armado_guirnalda.forma, ubicacion: elemento.visual_semantics?.placement ?? null, confianza: elemento.appearance.armado_guirnalda.confianza } }
          : {}),
      })),
    }));
    return Response.json(cuerpoExito(result, references, requestId, id), { headers: { "X-Request-ID": requestId } });
  } catch (error) {
    const { status, body, uiError } = respuestaError(error, requestId);
    registrarFalloUi("/api/references/analyze", uiError);
    return Response.json(body, { status, headers: { "X-Request-ID": requestId } });
  }
}
