import "server-only";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { cotizarLoQueSeVende, sumarLineas, type BomLinea, type ResultadoCotizacionBom } from "@/lib/globos3d/motor/v1";
import { CotizacionTallerSchema, MAX_GLOBOS_LINEA_TALLER, PedidoCotizacionTallerSchema, type CotizacionTaller } from "./cotizacion-taller-tipos";

/**
 * Lógica de `POST /api/taller/cotizacion` (D-038, cotización única): el precio de la lista de compra del Taller 3D con el
 * MISMO cotizador que el plan del motor 3D y su «¿cuánto cuesta?» (`cotizarBom`: la regla única de paquetes y reserva, y
 * los precios de Python `lista-materiales`). La misma lista de materiales da el mismo total en todas las superficies. Lo
 * que la tienda no vende no tumba la lista: se cotiza lo demás y se dice qué quedó sin precio (`faltantes`).
 * Sin modelo ni RAG. La cotización se inyecta para probarla sin red.
 */
export type DependenciasCotizacionTaller = {
  cotizar: (bom: { total: readonly BomLinea[]; porPieza: Readonly<Record<string, readonly BomLinea[]>> }, signal: AbortSignal) => Promise<ResultadoCotizacionBom>;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
};

const SIN_CACHE = { "Cache-Control": "no-store" } as const;
const MAX_CARACTERES_CUERPO = 40_000;

function error(codigo: string, mensaje: string, estado: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: mensaje, codigo, ...extra }, { status: estado, headers: SIN_CACHE });
}

export async function atenderCotizacionTaller(request: Request, deps: DependenciasCotizacionTaller): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return error("SESION_REQUERIDA", "Sesión requerida.", 401);
  if (!isSameOriginRequest(request)) return error("ORIGEN_INVALIDO", "Origen no permitido.", 403);
  const texto = await request.text().catch(() => "");
  if (!texto || texto.length > MAX_CARACTERES_CUERPO) return error("CUERPO_INVALIDO", "Cuerpo inválido.", 400);
  let json: unknown;
  try { json = JSON.parse(texto); } catch { return error("CUERPO_INVALIDO", "El cuerpo debe ser JSON válido.", 400); }
  const leido = PedidoCotizacionTallerSchema.safeParse(json);
  if (!leido.success) return error("CUERPO_INVALIDO", "La lista no tiene un formato válido.", 400);

  const total = sumarLineas(leido.data.materiales);
  // El tope por línea se mira después de sumar: dos líneas del mismo globo son una sola compra.
  if (total.some((l) => l.cantidad > MAX_GLOBOS_LINEA_TALLER)) return error("CUERPO_INVALIDO", `Como mucho ${MAX_GLOBOS_LINEA_TALLER} globos de un mismo color y talla.`, 400);
  const entrada = { lineas: total.length, globos: total.reduce((suma, l) => suma + l.cantidad, 0) };
  const { cotizada, faltantes, ninguno } = await cotizarLoQueSeVende(total, (bom) => deps.cotizar(bom, request.signal));
  if (!cotizada.ok) {
    deps.auditar("regla:cotizacion_taller", "lista de compra del taller sin precio", { razon: cotizada.razon, ...(cotizada.razon === "sin_cobertura" ? { faltantes: cotizada.faltantes } : { detalle: cotizada.detalle }) }, { entrada });
    if (cotizada.razon === "sin_cobertura") return error("SIN_COBERTURA", ninguno ? "La tienda no vende ninguno de los globos de la lista en esa talla o color." : "La tienda no vende algunos globos de la lista en esa talla o color, y no pude cotizar los demás.", 422, { faltantes });
    if (cotizada.razon === "material_no_disponible") return error("SIN_COBERTURA", "La tienda ya no vende alguna de las presentaciones de la lista.", 422);
    return error("PRECIO_FALLIDO", "No pude cotizar la lista ahora.", 502);
  }
  const leida = CotizacionTallerSchema.safeParse({
    total: cotizada.total,
    mermaPorcentaje: cotizada.cotizacion.mermaPorcentaje,
    incluyeIva: true,
    lineas: cotizada.compras.map((compra) => ({
      formatoId: compra.formatoId, codigo: compra.codigo, nombre: `${compra.variante.titulo} — ${compra.variante.tituloVariante}`,
      cantidad: compra.cantidad, reserva: compra.reserva, paquetes: compra.paquetes, unidadesPaquete: compra.unidadesPaquete,
      precioPaquete: compra.precioPaquete, subtotal: compra.subtotal,
    })),
    faltantes,
  });
  if (!leida.success) {
    deps.auditar("regla:cotizacion_taller", "lista de compra del taller sin precio", { razon: "precio_fallido", detalle: "la cotización no cumple el contrato del Taller" }, { entrada });
    return error("PRECIO_FALLIDO", "No pude cotizar la lista ahora.", 502);
  }
  const cotizacion: CotizacionTaller = leida.data;
  deps.auditar("regla:cotizacion_taller", "precio de la lista de compra del taller (la regla única, Python cotiza)", {
    total_cop: cotizacion.total, lineas: cotizacion.lineas.length, snapshot_precios: cotizada.snapshot, politica_paquetes: cotizada.politica, reserva: cotizada.reserva,
    ...(faltantes.length ? { faltantes } : {}),
  }, { entrada });
  return Response.json(cotizacion, { headers: SIN_CACHE });
}
