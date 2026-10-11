import type { z } from "zod";
import { CotizacionGuiadaSchema, ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import type { PythonListaMaterialesEntrada, PythonListaMaterialesResultado } from "@/lib/ia/nucleo/python-adapter";
import { decidirCotizacionDelCarrusel, type DecisionCarrusel, type DependenciasCarrusel } from "./carrusel";

/**
 * La herramienta `costear_decoracion` de la vista guiada (D-038): el precio de la idea elegida es el del plan que el
 * cliente recibe al elegirla (`decidirCotizacionDelCarrusel`); la lista curada queda para lo que no tiene plan guardado.
 * Devuelve lo que ve el modelo y la cotización que se pinta. La auditoría (`regla:cotizacion_guiada`) dice de dónde salió.
 */
type CotizacionGuiada = z.infer<typeof CotizacionGuiadaSchema>;

export type DecoracionCotizable = { id: string; materiales: ReadonlyArray<{ variantId: string; cantidad: number; nota?: string }> };

export type DependenciasCosteo = DependenciasCarrusel & {
  cotizarLista: (entrada: PythonListaMaterialesEntrada) => Promise<PythonListaMaterialesResultado>;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
};

/** Lo que decidió el costeo, para la auditoría: la lista curada con la cotización que salió de ella (o `null` sin materiales). */
export type DecisionCosteo = Exclude<DecisionCarrusel, { usar: "curada" }> | (Extract<DecisionCarrusel, { usar: "curada" }> & { cotizacion: CotizacionGuiada | null });

export type Costeo = { respuesta: Record<string, unknown>; cotizacion: CotizacionGuiada | null; decision: DecisionCosteo };

const AVISO_PLAN = "Precio de los materiales en la tienda en línea, con IVA. Incluye repuestos de cada globo (el 8 %, al menos uno) salvo cuando comprarlos encarece de más. Es el mismo precio del plan de esta idea. No incluye helio ni montaje.";

async function costearCurada(decoracion: DecoracionCotizable, uso: string, deps: DependenciasCosteo): Promise<Omit<Costeo, "decision">> {
  if (!decoracion.materiales.length) {
    return { cotizacion: null, respuesta: { ok: false, motivo: "costeo_pendiente_datos_de_catalogo", aviso: "Esta decoración todavía no tiene productos asociados en el catálogo; no inventes un precio." } };
  }
  const entrada = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })) });
  const cotizada = await deps.cotizarLista(entrada);
  const cotizacion = CotizacionGuiadaSchema.parse({
    lineas: cotizada.lineas.map((linea) => {
      const presentacion = presentacionMaterialGuiado(decoracion.materiales.find((material) => material.variantId === linea.variant_id)?.nota);
      return { id: linea.variant_id, tamano: "sin tamaño aplicable", ...presentacion, cantidadNecesaria: linea.cantidad_necesaria, disponible: true, varianteId: linea.variant_id, precioPaquete: linea.precio_paquete, unidadesPaquete: linea.unidades_paquete, paquetes: linea.paquetes, subtotal: linea.subtotal, sobrante: linea.sobrante };
    }),
    total: cotizada.total, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
  });
  deps.auditar("regla:cotizacion_guiada", "precio de los materiales de la idea elegida: lista curada (la idea no tiene plan guardado)", { cotiza: true, origen: "curada", total: cotizacion.total, lineas: cotizacion.lineas.length }, { entrada: { decoracionId: decoracion.id, uso, materiales: entrada.materiales } });
  return { cotizacion, respuesta: { cotizacion, incluyeIva: true, uso, aviso: "Precio de los materiales en la tienda en línea, con IVA. No incluye montaje." } };
}

export async function costearDecoracion(decoracion: DecoracionCotizable, uso: string, deps: DependenciasCosteo): Promise<Costeo> {
  const decision = await decidirCotizacionDelCarrusel(decoracion.id, deps);
  if (decision.usar === "curada") {
    const curada = await costearCurada(decoracion, uso, deps);
    return { ...curada, decision: { ...decision, cotizacion: curada.cotizacion } };
  }
  if (decision.usar === "sin_precio") {
    deps.auditar("regla:cotizacion_guiada", "la idea elegida no se pudo cotizar: no se muestra otro precio que el de su plan", { cotiza: false, razon: decision.motivo, ...(decision.detalle ? { detalle: decision.detalle } : {}) }, { entrada: { decoracionId: decoracion.id, uso } });
    return { cotizacion: null, decision, respuesta: { ok: false, motivo: "cotizacion_no_disponible", aviso: "No pude calcular el precio de esta idea ahora; dilo en una frase y no inventes un precio." } };
  }
  const { cotizacion, globos } = decision.resultado;
  const origen = decision.usar === "motor" ? "motor_3d" : "plan_python";
  deps.auditar("regla:cotizacion_guiada", decision.usar === "motor" ? "precio de la idea elegida: el plan del motor 3D (Python cotiza)" : "precio de la idea elegida: el plan de Python de la idea guardada", {
    cotiza: true, origen, total: cotizacion.total, lineas: cotizacion.lineas.length, globos, ...(decision.usar === "plan_python" ? { motivo: decision.motivo, ...(decision.detalle ? { detalle: decision.detalle } : {}) } : {}),
  }, { entrada: { decoracionId: decoracion.id, uso } });
  return { cotizacion, decision, respuesta: { cotizacion, incluyeIva: true, uso, aviso: AVISO_PLAN } };
}
