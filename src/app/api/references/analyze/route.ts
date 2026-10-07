import { analizarReferenciasV2 } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { crearChatTurnoPython } from "@/lib/ia/amaterasu/chat-python";
import { leerLecturaUnica } from "@/lib/ia/amaterasu/lectura-unica";
import { leerLecturasDeFoto } from "@/lib/ia/amaterasu/lecturas-foto";
import { medirColoresSempertex } from "@/lib/ia/amaterasu/color-sempertex";
import { conColoresDesdeElPie } from "@/lib/ia/amaterasu/dominancia-referencia";
import type { AnalisisColorSempertex } from "@/lib/plan/analisis-color";
import { chatLecturaFotoDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import { MODELO_LECTURA_FOTO, RAZONAMIENTO_LECTURA_FOTO } from "@/lib/ia/amaterasu/config-lectura-foto";
import type { ProveedorId } from "@/lib/ia/nucleo/tipos";
import {
  BOUQUET_REFERENCIA_PYTHON_ENABLED,
  CONTEO_REFERENCIA_PYTHON_ENABLED,
  GUIRNALDA_REFERENCIA_PYTHON_ENABLED,
  LECTURA_UNICA_REFERENCIA_ENABLED,
  PATRON_REFERENCIA_PYTHON_ENABLED,
  REFERENCE_ANALYSIS_PYTHON_ENABLED,
} from "@/lib/ia/nucleo/feature-flags";
import { VARIANTE_RUTA_ANALISIS } from "@/lib/ia/referencia/reference-structure";
import { featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { registrarFalloUi } from "@/lib/errores-ui/traducir-error-servidor";
import { cuerpoExito, leerCuerpo, referenciasEtiquetadas, respuestaError, validarCuerpo } from "./analisis-http";
import { conReferenciasMedidas } from "@/lib/plan/referencias-medidas";
import { unificarPiezasEspejo } from "@/lib/ia/referencia/piezas-espejo";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { reconciliarColoresLectura } from "@/lib/ia/referencia/colores-lectura";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import { coloresDominantesReferencia, coloresNombradosReferencia } from "@/lib/plan/colores-referencia";

export const maxDuration = 120;

// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/references/analyze", atenderPOST);

async function atenderPOST(request: Request) {
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
    // Los dos caminos con la MISMA configuración del lector (`config-lectura-foto.ts`): el mismo modelo, y el
    // razonamiento por defecto en los dos. Antes el directo heredaba el modelo y el razonamiento del chat.
    const chat = REFERENCE_ANALYSIS_PYTHON_ENABLED
      ? crearChatTurnoPython({ requestId, correlationId, model: MODELO_LECTURA_FOTO })
      : await chatLecturaFotoDe(id);
    decidir("regla:config_lectura_foto", "con qué configuración se lee la foto", { via: REFERENCE_ANALYSIS_PYTHON_ENABLED ? "python" : "gemini_directo", modelo: MODELO_LECTURA_FOTO, razonamiento: RAZONAMIENTO_LECTURA_FOTO, variante: LECTURA_UNICA_REFERENCIA_ENABLED ? VARIANTE_RUTA_ANALISIS : "v16" }, { motivo: "REFERENCE_ANALYSIS_PYTHON_ENABLED y config-lectura-foto.ts" });
    const references = referenciasEtiquetadas(body.images);
    // La descripción visual no decide productos. El chat resuelve después
    // cada elemento mediante buscar_catalogo_rag contra PostgreSQL validado.
    // `sin_cache` es el "Reintentar" de la UI: pide un análisis nuevo.
    // Una sola IA mira la foto: con la bandera encendida, el análisis devuelve
    // también las cuatro lecturas (variante `VARIANTE_RUTA_ANALISIS`: v20, que es
    // v18 —v17 más las fronteras de UI-3— más las reglas de color) y no hay
    // ninguna llamada de visión más. Apagada, v16 y las cuatro de siempre.
    const analisis = await analizarReferenciasV2(chat, references, [], "perceptual", { requestId, correlationId, superficie: "/api/references/analyze" }, request.signal, {
      forzarNuevoAnalisis: body.sinCache,
      ...(LECTURA_UNICA_REFERENCIA_ENABLED ? { variante: VARIANTE_RUTA_ANALISIS } : {}),
    });
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
    const leido = LECTURA_UNICA_REFERENCIA_ENABLED
      // Lo que ya leyó el análisis: solo se valida en Python y se reparte por
      // elemento. Las cuatro banderas de arriba no se leen en este camino.
      ? await leerLecturaUnica(analisis.blueprint, analisis.lecturasCrudas, references, lectura)
      : await leerLecturasDeFoto(analisis.blueprint, references, lectura, {
        patron: PATRON_REFERENCIA_PYTHON_ENABLED,
        bouquet: BOUQUET_REFERENCIA_PYTHON_ENABLED,
        conteo: CONTEO_REFERENCIA_PYTHON_ENABLED,
        guirnalda: GUIRNALDA_REFERENCIA_PYTHON_ENABLED,
      });
    // El orden de los colores de cada columna o semiarco, del pie a la punta, lo deciden los píxeles y no el
    // orden en que el modelo los listó (`orden-color-pie.ts`, 2026-10-06). Después de la lectura: ella trae
    // `patron_color` y decide columna o semiarco.
    // Los dos vocabularios de la misma lectura, de acuerdo: un «light grey» de las etiquetas que la disposición
    // (paleta del catálogo, sin gris) lee blanco es ese blanco (`colores-lectura.ts`). Antes de medir el color.
    const reconciliado = reconciliarColoresLectura(leido);
    if (reconciliado.cambios.length) decidir("regla:lectura_foto.gris_claro_es_blanco", "etiquetas de gris claro que la disposición de la misma pieza lee blanco", reconciliado.cambios);
    const blueprint = featureEnabled("MEASURED_COLOR_DOMINANCE_V1") ? await conColoresDesdeElPie(reconciliado.blueprint, references) : reconciliado.blueprint;
    /**
     * Los colores de cada pieza, medidos sobre los píxeles de su croquis y cruzados con una referencia del
     * catálogo Sempertex (su código y su Pantone). Va **fuera** del blueprint a propósito: no entra en ningún
     * contrato, no viaja a Python y no toca el `plan_hash`, así que se puede mirar sin cambiar lo que un plan
     * compra. Un fallo aquí no rompe el análisis: la foto ya está leída y esto es un añadido.
     */
    let analisisColor: AnalisisColorSempertex | null = null;
    if (featureEnabled("ANALISIS_COLOR_SEMPERTEX_V1")) {
      try {
        analisisColor = await medirColoresSempertex(blueprint, references);
      } catch (error) {
        console.warn("[references/analyze] no se pudo medir el color", { request_id: requestId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    // Las referencias medidas entran AL blueprint (2026-10-04): son lo que decide qué globo se compra
    // (`referencias-medidas.ts`). El bloque `analisis_color` de abajo sigue igual para la pantalla.
    // Dos piezas en espejo son UNA pieza repetida (`piezas-espejo.ts`, 2026-10-04): el reconocedor llamó
    // columna a una y semiarco a la otra y el plan armó dos estructuras distintas. Determinista, sin proveedor.
    const final = unificarPiezasEspejo(conReferenciasMedidas(blueprint, analisisColor));
    // Las dos vistas validan el blueprint con su esquema y, si no lo cumple, tiran la lectura entera (la guiada
    // dice «no pude distinguir los detalles», la clásica da error). Un añadido medido que lo rompa (una parte de
    // 1,0001, banco del 2026-10-06) no puede costar la foto: sale el blueprint sin las referencias medidas.
    const valido = ReferenceBlueprintV2Schema.safeParse(final);
    if (!valido.success) {
      decidir("regla:lectura_foto.blueprint_invalido", "el blueprint con las referencias medidas no cumple su esquema; sale sin ellas", { problemas: valido.error.issues.slice(0, 5).map((problema) => `${problema.path.join(".")}: ${problema.message}`) });
    }
    const result = { ...analisis, blueprint: valido.success ? final : unificarPiezasEspejo(blueprint) };
    // Auditoría de IA: de los colores que la lectura nombró en cada pieza de globos, cuáles compra el plan
    // (`coloresDominantesReferencia`) y cuáles se quedan fuera por el tope de tonos, con lo que midieron los píxeles.
    decidir("regla:lectura_foto.colores", "qué colores de cada pieza leída pasan a la compra del plan", result.blueprint.elements
      .filter((elemento) => elemento.approved && elemento.category === "balloon_structure")
      .map((elemento) => {
        const nombrados = coloresNombradosReferencia(elemento.appearance);
        const compra = coloresDominantesReferencia(elemento.appearance);
        const fuera = nombrados.map((color) => color.color).filter((color) => !compra.includes(color));
        return {
          id: elemento.element_id,
          etiquetas: elemento.appearance.observed_colors,
          nombrados: nombrados.map((color) => `${color.color}${color.acabado ? `:${color.acabado}` : ""}`),
          compra,
          ...(fuera.length ? { fuera_de_compra: fuera } : {}),
          medidos: elemento.appearance.measured_colors?.map((medido) => `${medido.color}:${medido.share}`) ?? null,
        };
      }));
    // Qué vio el reconocedor y qué lecturas quedaron en cada elemento: solo
    // ids, tipos y conteos (nunca la foto), para diagnosticar un plan que no
    // sigue la foto (2026-09-25: un bouquet de 5 globos salía con 12 o 20).
    console.info("[references/analyze] elementos", JSON.stringify({
      request_id: requestId,
      cache: analisis.metadata.cached,
      elementos: result.blueprint.elements.filter((elemento) => elemento.approved).map((elemento) => ({
        id: elemento.element_id,
        tipo: elemento.visual_semantics?.structure_type ?? null,
        // Dos piezas con el mismo grupo son la misma pieza repetida (`piezas-espejo.ts`).
        grupo: elemento.visual_semantics?.repetition_group ?? null,
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
        // De qué tamaños es la pieza. Sin esto, que la foto no los dijera y que los dijera y no
        // llegaran al motor se veían igual desde fuera: nada. Es lo que dejó una columna de globos
        // gigantes armada con globos pequeños durante toda una sesión (2026-10-03).
        tamanos: elemento.appearance.tamanos_leidos ?? null,
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
    return Response.json(
      { ...cuerpoExito(result, references, requestId, id), ...(analisisColor ? { analisis_color: analisisColor } : {}) },
      { headers: { "X-Request-ID": requestId } },
    );
  } catch (error) {
    const { status, body, uiError } = respuestaError(error, requestId);
    registrarFalloUi("/api/references/analyze", uiError);
    return Response.json(body, { status, headers: { "X-Request-ID": requestId } });
  }
}
