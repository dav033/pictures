import "server-only";
import type { RegistroHerramientas } from "@sempertex/agente-core";
import { cotizar, type Cotizacion, type ItemCotizacion } from "@/lib/cotizacion/motor";
import { buscarDecoraciones } from "@/lib/decoraciones";
import { calcularMedidas, type Figura, type ResultadoMedidas } from "@/lib/medidas/geometria";
import { productosPorId } from "@/lib/products";
import { getRagPool } from "@/lib/rag/db";
import { buscarCatalogoRag, type ProductoCandidato } from "@/lib/rag/chat/buscar";
import { buscarCatalogoRagConPresupuesto } from "@/lib/rag/chat/buscar-presupuesto";
import { validarSeleccion, type ItemRechazado, type ItemValidado, type SeleccionSolicitada } from "@/lib/rag/chat/validar";
import { RAG_ENABLED, RAG_FRANJAS_ENABLED } from "@/lib/rag/flags";
import { registrarBusqueda, registrarSeleccion } from "@/lib/rag/observability/log";
import { resolverFranja } from "@/lib/rag/presupuesto/resolver";
import { resolverVariantesPorDespiece } from "@/lib/rag/tamanos/resolver";
import {
  aProducto,
  buscarCatalogoShopify,
  categoriasDeCatalogo,
  variantesPorIds,
  type Faceta,
  type FiltrosCatalogo,
} from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { HERRAMIENTAS, HERRAMIENTAS_RAG } from "./herramientas";
import type { Herramienta } from "./tipos";

// Superadas por buscar_catalogo_rag/confirmar_seleccion_rag (Fases 3B-6 ya
// validadas contra datos reales). Si se dejan las dos rutas activas a la vez,
// el modelo puede elegir la vieja y saltarse por completo la whitelist, el
// tope de inventario y los datos de imagen/handle que alimentan la UI de
// verificación — pasó en pruebas reales, no es un riesgo teórico.
const HERRAMIENTAS_SUPERADAS_POR_RAG = new Set(["buscar_catalogo", "confirmar_seleccion_ia", "consultar_disponibilidad"]);

export function herramientasActivas(): Herramienta[] {
  const herramientas = !RAG_ENABLED
    ? HERRAMIENTAS
    : [...HERRAMIENTAS.filter((h) => !HERRAMIENTAS_SUPERADAS_POR_RAG.has(h.nombre)), ...HERRAMIENTAS_RAG];
  // La cotización no pertenece al razonamiento de selección en ningún modo.
  // La app la calcula después de terminar la imagen, usando exactamente los
  // productos que entraron en la propuesta visual.
  return herramientas.filter((h) => h.nombre !== "cotizar");
}

// El catálogo real tiene mucho más margen de ambigüedad que el mock de 14
// productos: el modelo a veces reintenta buscar_catalogo buscando una
// coincidencia más exacta antes de responder. Con una imagen de referencia
// de estilo (varios colores/atributos a la vez) se vieron casos reales de
// hasta 6 llamadas a buscar_catalogo antes de decidir — 6 se quedaba corto
// justo para el turno en que el modelo por fin llama confirmar_seleccion_ia,
// dejando la conversación en el mensaje de "me enredé" aunque la selección
// ya se hubiera guardado. 10 da margen real sin dejar una conversación
// colgada indefinidamente.
export const VUELTAS_MAX = 10;

// Si buscar_catalogo trae más piezas que esto y el cliente no pidió un tipo
// puntual, no tiene sentido tirárselas todas de una — se le ofrece elegir el
// tipo de producto primero (§ tipo "buscar_catalogo" más abajo).
const UMBRAL_AGRUPAR_POR_TIPO = 8;

export type EstadoConversacion = {
  brief: Brief;
  recomendaciones: Producto[];
  decoraciones: DecoracionConProductos[];
  categoriasSugeridas: Faceta[];
  // Filtros que produjeron `categoriasSugeridas` (ocasión, colores, texto…),
  // sin la categoría en sí. El cliente los reusa para navegar directo a un
  // tipo puntual sin pasarle otro turno al modelo (§ page.tsx navegarCategoria).
  filtrosCategorias?: FiltrosCatalogo;
  medidas?: ResultadoMedidas;
  cotizacion?: Cotizacion;
  // Piezas que la IA decidió proponer por su cuenta — solo se llenan si
  // `confirmar_seleccion_ia` resolvió al menos un id real; el frontend usa
  // esto para disparar /api/generate sin que el cliente haga clic.
  seleccionFinalIA?: Producto[];
  instruccionIA?: string;
  // Whitelist de productos realmente recuperados en ESTE request/turno (plan
  // §4.8). `ejecutar.ts` crea este estado por ejecución; sólo se acumulan
  // varias llamadas de herramienta del mismo turno, nunca historial viejo.
  ragIdsRecuperados: Set<string>;
  /** Product -> exact variant whitelist exposed by retrieval in this request. */
  ragVariantIdsRecuperados: Map<string, Set<string>>;
  ragCandidatos?: ProductoCandidato[];
  ragValidados?: ItemValidado[];
  ragRechazados?: ItemRechazado[];
  ragTotal?: number;
  /** Une búsqueda con selección en rag_query_log — un id por conversación, no por turno. */
  ragRequestId: string;
  /** Franja de presupuesto resuelta en la última búsqueda de este turno (si
   * RAG_FRANJAS_ENABLED) — confirmar_seleccion_rag la usa para avisar si la
   * selección final se pasó del techo, sin bloquearla (§3, Etapa 5). */
  ragFranja?: { slug: string; nombre: string; techoCop: number };
};

export function crearEstadoConversacion(brief: Brief): EstadoConversacion {
  // The wrapper in ejecutar.ts calls this once per request/turn, so these
  // sets cannot carry a prior conversation's retrieval whitelist.
  return {
    brief: { ...brief },
    recomendaciones: [],
    decoraciones: [],
    categoriasSugeridas: [],
    ragIdsRecuperados: new Set(),
    ragVariantIdsRecuperados: new Map(),
    ragRequestId: crypto.randomUUID(),
  };
}

/**
 * Al agotar VUELTAS_MAX no siempre "se enredó" de verdad: si el modelo
 * llamó confirmar_seleccion_ia justo en la última vuelta permitida, la
 * selección ya quedó guardada y la imagen ya se está generando — decirle al
 * cliente "me enredé" ahí sería mentirle sobre algo que en realidad sí
 * funcionó, solo que no alcanzó a mandar el texto de cierre.
 */
export function textoAlAgotarVueltas(estado: EstadoConversacion): string {
  if (estado.seleccionFinalIA?.length) {
    return "¡Ya elegí las piezas y se está generando tu visualización! Dame un momento.";
  }
  return "Perdón, me enredé un poco. ¿Me lo repites de otra forma?";
}

/** Arma el registro de herramientas (nombre → handler) que el motor genérico
 * de @sempertex/agente-core despacha — cada cuerpo es el mismo que tenía el
 * if-chain de ejecutar.ts antes de esta extracción, sin cambios de lógica. */
export function crearRegistroHerramientas(estado: EstadoConversacion): RegistroHerramientas {
  return {
    guardar_brief: async (args) => {
      Object.assign(estado.brief, args);
      return { ok: true, brief: estado.brief };
    },

    buscar_catalogo: async (args) => {
      const filtros = args as FiltrosCatalogo;
      const { resultados, total, filtroRelajado } = buscarCatalogoShopify(filtros);

      const debeAgruparPorTipo = !filtros.categorias?.length && total > UMBRAL_AGRUPAR_POR_TIPO;
      if (debeAgruparPorTipo) {
        const categorias = categoriasDeCatalogo(filtros);
        estado.categoriasSugeridas = categorias;
        estado.filtrosCategorias = filtros;
        return {
          total,
          demasiados_resultados: true,
          tipos_disponibles: categorias.map((c) => ({ categoria: c.valor, etiqueta: c.etiqueta, cantidad: c.total })),
          filtro_relajado: filtroRelajado,
        };
      }

      estado.recomendaciones = resultados.map(aProducto);
      return {
        total,
        productos: resultados.map((r) => ({
          id: r.varianteId,
          nombre: r.nombre,
          categoria: r.categoriaNombre,
          colores: r.colores,
          ocasiones: r.ocasiones,
          tags: r.tags,
          precio: r.precio,
          unidades_paquete: r.unidadesPaquete,
          disponible: r.disponible,
        })),
        filtro_relajado: filtroRelajado,
      };
    },

    consultar_disponibilidad: async (args) => {
      const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
      const resultados = variantesPorIds(ids);
      return {
        disponibilidad: resultados.map((r) => ({
          id: r.varianteId,
          nombre: r.nombre,
          disponible: r.disponible,
        })),
      };
    },

    calcular_medidas: async (args) => {
      const a = args as {
        figura: Figura;
        ancho_m?: number;
        alto_m?: number;
        largo_m?: number;
        densidad?: "sencilla" | "media" | "lujosa";
        colores?: string[];
        mezcla?: "clasica" | "organica_fina" | "organica_gruesa" | "solo_grandes";
      };
      const resultado = calcularMedidas({
        figura: a.figura,
        anchoM: a.ancho_m,
        altoM: a.alto_m,
        largoM: a.largo_m,
        densidad: a.densidad,
        colores: a.colores,
        mezcla: a.mezcla,
      });
      estado.medidas = resultado;
      return {
        figura: resultado.figura,
        eje_m: resultado.ejeM,
        despiece: resultado.despiece,
        total_globos: resultado.totalGlobos,
        supuestos: resultado.supuestos,
        confianza: resultado.confianza,
        aviso: resultado.aviso,
      };
    },

    cotizar: async (args) => {
      const items = Array.isArray(args.items) ? (args.items as ItemCotizacion[]) : [];
      const resultado = cotizar(items);
      estado.cotizacion = resultado;
      return {
        lineas: resultado.lineas,
        total: resultado.total,
        merma_porcentaje: resultado.mermaPorcentaje,
        incluye_iva: resultado.incluyeIva,
      };
    },

    confirmar_seleccion_ia: async (args) => {
      const ids = Array.isArray(args.ids) ? (args.ids as string[]) : [];
      const productos = variantesPorIds(ids).map(aProducto);
      if (productos.length === 0) {
        return { ok: false, resueltos: 0 };
      }
      estado.seleccionFinalIA = productos;
      estado.instruccionIA = typeof args.instruccion === "string" ? args.instruccion : undefined;
      return {
        ok: true,
        resueltos: productos.length,
        // Desglose real para que el modelo pueda describirle al cliente qué
        // compone la propuesta, aunque las tarjetas ya lo muestren en pantalla —
        // precio siempre por paquete, igual que en buscar_catalogo.
        piezas: productos.map((p) => ({
          nombre: p.nombre,
          categoria: p.categoria,
          // Lista TODOS los colores presentes, no cuál es el dominante — antes
          // de describir esto como "dorado" (o el color que pidió el cliente),
          // confirma que sea el color base y no solo un acento menor.
          colores: p.colores,
          unidades_paquete: p.unidadesPaquete,
        })),
        fase: "propuesta_visual; la cotizacion llega despues de generar la imagen",
      };
    },

    buscar_catalogo_rag: async (args) => {
      const mensaje = typeof args.mensaje === "string" ? args.mensaje : "";
      const pool = getRagPool();
      const t0 = Date.now();

      // La franja NUNCA la nombra el LLM (§3, Etapa 0): se resuelve aquí, en
      // código, a partir de lo que el cliente ya dijo en el brief. Sin franja
      // resuelta (brief.presupuesto vacío o RAG_FRANJAS_ENABLED apagada) el
      // pipeline de hoy corre exactamente igual, sin canasta.
      const franjaResuelta = RAG_FRANJAS_ENABLED ? resolverFranja(estado.brief.presupuesto) : null;

      if (franjaResuelta) {
        const respuesta = await buscarCatalogoRagConPresupuesto(pool, mensaje, franjaResuelta.franja, franjaResuelta.cifraCliente);
        estado.ragFranja = { slug: franjaResuelta.franja.slug, nombre: franjaResuelta.franja.nombre, techoCop: respuesta.canasta?.techoCop ?? franjaResuelta.franja.minCop };

        const idsPool = Object.values(respuesta.poolPorRol)
          .flat()
          .map((item) => item.productId);
        const idsCanasta = respuesta.canasta?.piezas.map((p) => p.productId) ?? [];
        for (const id of [...idsPool, ...idsCanasta, ...respuesta.variantIdsRecuperados.map((item) => item.productId)]) estado.ragIdsRecuperados.add(id);
        for (const item of respuesta.variantIdsRecuperados) {
          const variantes = estado.ragVariantIdsRecuperados.get(item.productId) ?? new Set<string>();
          variantes.add(item.variantId);
          estado.ragVariantIdsRecuperados.set(item.productId, variantes);
        }
        for (const item of Object.values(respuesta.poolPorRol).flat()) {
          const variantes = estado.ragVariantIdsRecuperados.get(item.productId) ?? new Set<string>();
          variantes.add(item.variantId);
          estado.ragVariantIdsRecuperados.set(item.productId, variantes);
        }
        for (const item of respuesta.canasta?.piezas ?? []) {
          const variantes = estado.ragVariantIdsRecuperados.get(item.productId) ?? new Set<string>();
          variantes.add(item.variantId);
          estado.ragVariantIdsRecuperados.set(item.productId, variantes);
        }

        await registrarBusqueda(pool, {
          requestId: estado.ragRequestId,
          mensaje,
          intent: respuesta.intent,
          retrievedProductIds: [...new Set([...idsPool, ...idsCanasta, ...respuesta.variantIdsRecuperados.map((item) => item.productId)])],
          retrievalScores: null,
          status: respuesta.status,
          latencyParseMs: respuesta.latencyParseMs,
          latencyRetrievalMs: respuesta.latencyRetrievalMs,
          latencyTotalMs: Date.now() - t0,
          franja: respuesta.franja?.slug,
          canasta: respuesta.canasta,
          utilizacion: respuesta.canasta?.utilizacion,
          relajaciones: [...respuesta.relajaciones, ...respuesta.conflictos],
        });

        return {
          status: respuesta.status,
          sku_status: respuesta.skuStatus,
          franja: respuesta.franja,
          canasta: respuesta.canasta
            ? {
                piezas: respuesta.canasta.piezas.map((p) => ({
                  product_id: p.productId,
                  variant_id: p.variantId,
                  rol: p.rol,
                  titulo: p.titulo,
                  precio: p.precio,
                  cantidad: p.cantidad,
                  subtotal: p.subtotal,
                  porque: p.porque,
                })),
                total: respuesta.canasta.total,
                techo: respuesta.canasta.techoCop,
                utilizacion: Math.round(respuesta.canasta.utilizacion * 100) / 100,
                cumple_presupuesto: respuesta.canasta.cumplePresupuesto,
                holgura: respuesta.canasta.holgura,
              }
            : null,
          pool_por_rol: respuesta.poolPorRol,
          relajaciones: respuesta.relajaciones,
          conflictos: respuesta.conflictos,
        };
      }

      const respuesta = await buscarCatalogoRag(pool, mensaje);
      estado.ragCandidatos = respuesta.candidatos;
      for (const c of respuesta.candidatos) estado.ragIdsRecuperados.add(c.productId);
      for (const c of respuesta.candidatos) {
        const variantes = estado.ragVariantIdsRecuperados.get(c.productId) ?? new Set<string>();
        for (const variante of c.variantes) variantes.add(variante.variantId);
        estado.ragVariantIdsRecuperados.set(c.productId, variantes);
      }

      // Se espera (no fire-and-forget): en un runtime serverless la función
      // puede cortarse en cuanto termina esta llamada, y una escritura de log
      // sin awaitear se perdería justo ahí. registrarBusqueda ya atrapa sus
      // propios errores — esperarla no puede tumbar la conversación.
      await registrarBusqueda(pool, {
        requestId: estado.ragRequestId,
        mensaje,
        intent: respuesta.intent,
        retrievedProductIds: respuesta.candidatos.map((c) => c.productId),
        retrievalScores: respuesta.scores,
        status: respuesta.status,
        latencyParseMs: respuesta.latencyParseMs,
        latencyRetrievalMs: respuesta.latencyRetrievalMs,
        latencyTotalMs: Date.now() - t0,
      });

      return {
        status: respuesta.status,
        sku_status: respuesta.skuStatus,
        filtro_relajado: respuesta.filtroRelajado,
        candidatos: respuesta.candidatos.map((c) => ({
          product_id: c.productId,
          titulo: c.titulo,
          categoria: c.categoria,
          colores: c.colores,
          ocasiones: c.ocasiones,
          disponible: c.disponible,
          variantes: c.variantes.map((v) => ({
            variant_id: v.variantId,
            sku: v.sku,
            titulo: v.titulo,
            precio: v.precio,
            disponible: v.disponible,
            // Tamaño real (plan de tamaños F2/F3) — sin esto el modelo elegía
            // entre variantes indistinguibles salvo un código interno y caía
            // en la más común del catálogo (R-12) por defecto estadístico.
            tamano: v.codigoTamano,
            diametro_pulgadas: v.diamPulg,
            forma: v.forma,
            colores: v.colores,
          })),
        })),
      };
    },

    confirmar_seleccion_rag: async (args) => {
      const seleccionCruda = Array.isArray(args.seleccion) ? args.seleccion : [];

      // Ítems normales (tamaño explícito) pasan tal cual. Ítems
      // "usar_despiece" (plan de tamaños F3, "mezcla de diseñador") se
      // expanden ANTES de validar: el LLM decidió producto+color, el
      // resolver determinístico decide cuánto de cada tamaño según el
      // despiece geométrico de calcular_medidas — nunca al revés, o vuelve
      // a caer en que el LLM elija una sola variante a ojo.
      const seleccion: SeleccionSolicitada[] = [];
      const sustituciones: { product_id: string; pedido: string; entregado: string; motivo: string }[] = [];
      const sinCobertura: { product_id: string; tamano: string }[] = [];
      const rechazosExpansion: ItemRechazado[] = [];

      for (const cruda of seleccionCruda as Record<string, unknown>[]) {
        const productId = String(cruda.product_id ?? "");
        if (cruda.usar_despiece !== true) {
          seleccion.push({
            productId,
            variantId: String(cruda.variant_id ?? ""),
            cantidad: Number(cruda.cantidad ?? 0),
            razon: typeof cruda.razon === "string" ? cruda.razon : undefined,
          });
          continue;
        }

        if (!estado.medidas) {
          rechazosExpansion.push({ productId, variantId: "", motivo: "usar_despiece sin haber llamado calcular_medidas en este turno" });
          continue;
        }
        const colorArg = typeof cruda.color === "string" ? cruda.color : undefined;
        const despieceTieneColores = estado.medidas.despiece.some((l) => l.color);
        if (despieceTieneColores && !colorArg) {
          rechazosExpansion.push({ productId, variantId: "", motivo: "calculaste medidas con varios colores; usar_despiece necesita 'color' para saber qué parte del despiece cubre este producto" });
          continue;
        }
        const lineasDelColor = estado.medidas.despiece.filter((l) => (colorArg ? l.color === colorArg : true));
        if (lineasDelColor.length === 0) {
          rechazosExpansion.push({ productId, variantId: "", motivo: `ningún tamaño del despiece corresponde al color '${colorArg}'` });
          continue;
        }

        const whitelist = estado.ragVariantIdsRecuperados.get(productId) ?? new Set<string>();
        const resuelto = resolverVariantesPorDespiece(productId, lineasDelColor, whitelist);
        for (const linea of resuelto.lineas) {
          seleccion.push({ productId: linea.productId, variantId: linea.variantId, cantidad: linea.cantidad, razon: typeof cruda.razon === "string" ? cruda.razon : undefined });
          if (linea.sustitucion) sustituciones.push({ product_id: productId, ...linea.sustitucion });
        }
        for (const faltante of resuelto.sinCobertura) sinCobertura.push({ product_id: productId, tamano: faltante.tamano });
      }

      const pool = getRagPool();
      const t0 = Date.now();
      const resultado = await validarSeleccion(pool, seleccion, estado.ragVariantIdsRecuperados);
      resultado.rechazados = [...resultado.rechazados, ...rechazosExpansion];
      estado.ragValidados = resultado.validados;
      estado.ragRechazados = resultado.rechazados;
      estado.ragTotal = resultado.total;

      const statusSeleccion = resultado.validados.length > 0 ? "OK" : "NO_MATCH";

      // El frontend dispara /api/generate cuando `seleccionFinalIA` llega
      // poblado (mecanismo existente de confirmar_seleccion_ia) — se reusa tal
      // cual en vez de duplicarlo, resolviendo los MISMOS variant_id ya
      // validados contra el catálogo SQLite (mismo Shopify, mismos ids). Sin
      // esto, confirmar_seleccion_rag validaba correctamente pero nunca
      // generaba la imagen porque el frontend no sabe nada de este tool nuevo.
      if (resultado.validados.length > 0) {
        const paquetesPorVariante = new Map(resultado.validados.map((v) => [v.variantId, v.cantidad]));
        const productos = variantesPorIds(resultado.validados.map((v) => v.variantId))
          .map(aProducto)
          .map((producto) => ({ ...producto, paquetes: paquetesPorVariante.get(producto.id) ?? 1 }));
        if (productos.length > 0) estado.seleccionFinalIA = productos;
      }

      await registrarSeleccion(pool, {
        requestId: estado.ragRequestId,
        selectedProductIds: resultado.validados.map((v) => v.productId),
        rejected: resultado.rechazados,
        status: statusSeleccion,
        latencyTotalMs: Date.now() - t0,
      });

      // Chequeo de presupuesto (§3, Etapa 5): la franja no bloquea la
      // confirmación — el LLM puede tener una razón real para excederse (ej.
      // el cliente pidió explícitamente una pieza fuera de la receta) — pero
      // el backend SIEMPRE reporta el delta real en vez de dejarlo pasar en
      // silencio, igual que con inventario (validarSeleccion arriba).
      const excedePresupuesto = estado.ragFranja != null && resultado.total > estado.ragFranja.techoCop;

      return {
        status: statusSeleccion,
        validados: resultado.validados.map((v) => ({
          product_id: v.productId,
          variant_id: v.variantId,
          sku: v.sku,
          titulo: v.titulo,
          cantidad: v.cantidad,
        })),
        rechazados: resultado.rechazados,
        // Plan de tamaños F3: nunca sustituir en silencio. Si vienen no
        // vacíos, el LLM está instruido (herramientas.ts) a decírselos al
        // cliente tal cual, igual que cualquier otra sustitución honesta.
        sustituciones,
        sin_cobertura: sinCobertura,
        fase: "propuesta_visual; la cotizacion llega despues de generar la imagen",
        ...(estado.ragFranja
          ? {
              franja: estado.ragFranja.slug,
              techo_presupuesto: estado.ragFranja.techoCop,
              excede_presupuesto: excedePresupuesto,
              delta_cop: excedePresupuesto ? resultado.total - estado.ragFranja.techoCop : 0,
            }
          : {}),
      };
    },

    buscar_decoraciones: async (args) => {
      const encontradas = await buscarDecoraciones(args as { estilos?: string[] });
      const decoracionesConProductos = await Promise.all(
        encontradas.map(async (d) => ({ ...d, productos: await productosPorId(d.elementos) })),
      );
      estado.decoraciones = decoracionesConProductos;
      return {
        total: encontradas.length,
        decoraciones: decoracionesConProductos.map((d) => ({
          id: d.id,
          nombre: d.nombre,
          descripcion: d.descripcion,
          elementos: d.productos.map((p) => p.nombre),
        })),
      };
    },
  };
}
