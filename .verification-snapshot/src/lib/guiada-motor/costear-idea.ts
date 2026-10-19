import { decidirCotizacionDelCarrusel, type DecisionCarrusel, type DependenciasCarrusel } from "./carrusel";
import type { CotizacionIdea } from "./cotizacion-de-tarjeta";
import type { MaterialCurado, ResultadoCotizacionCurada } from "./cotizar-curada";
import { notaNoIncluidos, type FueraDelPrecio, type NoIncluidoEnPrecio } from "./no-incluidos";

/**
 * La herramienta `costear_decoracion` de la vista guiada (D-038): el precio de la idea elegida es el del plan que el
 * cliente recibe al elegirla (`decidirCotizacionDelCarrusel`); lo que no tiene plan guardado se cotiza desde su lista curada
 * con el MISMO cotizador (`cotizarCurada`: los globos que el Taller compraría, con repuestos por globo y el paquete más
 * barato; lo que el cruce no conoce, con los paquetes de su producto). Devuelve lo que ve el modelo y la cotización que se pinta.
 * La auditoría (`regla:cotizacion_guiada`) dice de dónde salió.
 */
export type DecoracionCotizable = { id: string; materiales: ReadonlyArray<MaterialCurado> };

export type DependenciasCosteo = DependenciasCarrusel & {
  /** `cotizarListaCurada` con el cruce y Python puestos por quien llama (carga el motor al pedirla, como `cotizarConMotor`). */
  cotizarCurada: (materiales: ReadonlyArray<MaterialCurado>) => Promise<ResultadoCotizacionCurada>;
  auditar: (quien: string, que: string, resultado: unknown, extra?: { entrada?: unknown; motivo?: string }) => void;
};

/** Lo que decidió el costeo, para la auditoría: la lista curada con la cotización que salió de ella (o `null` sin materiales). */
export type DecisionCosteo = Exclude<DecisionCarrusel, { usar: "curada" }> | (Extract<DecisionCarrusel, { usar: "curada" }> & { cotizacion: CotizacionIdea | null; globos?: number; fuera?: readonly FueraDelPrecio[] });

/**
 * `noIncluidos`: lo que la lista pide y no tiene precio, con el nombre y la cantidad que ve el cliente. Va APARTE de la cotización: la
 * cotización se guarda en la sesión del navegador con un esquema estricto, y una clave nueva descartaría la conversación a un
 * despliegue anterior (D-035); la nota se pinta con ella pero no se guarda.
 */
export type Costeo = { respuesta: Record<string, unknown>; cotizacion: CotizacionIdea | null; decision: DecisionCosteo; noIncluidos?: NoIncluidoEnPrecio[] };

const AVISO_PLAN = "Precio de los materiales en la tienda en línea, con IVA. Incluye repuestos de cada globo (el 8 %, al menos uno) salvo cuando comprarlos encarece de más. Es el mismo precio del plan de esta idea. No incluye helio ni montaje.";
const AVISO_CURADA = "Precio de los globos de esta idea en la tienda en línea, con IVA. Incluye repuestos de cada globo (el 8 %, al menos uno) salvo cuando comprarlos encarece de más. No incluye helio ni montaje.";
const AVISO_SIN_PRECIO = "No pude calcular el precio de esta idea ahora; dilo en una frase y no inventes un precio.";

async function costearCurada(decoracion: DecoracionCotizable, uso: string, deps: DependenciasCosteo): Promise<Costeo> {
  const curada = { usar: "curada", motivo: "sin_plan_guardado" } as const;
  if (!decoracion.materiales.length) {
    return { cotizacion: null, decision: { ...curada, cotizacion: null }, respuesta: { ok: false, motivo: "costeo_pendiente_datos_de_catalogo", aviso: "Esta decoración todavía no tiene productos asociados en el catálogo; no inventes un precio." } };
  }
  const entrada = { decoracionId: decoracion.id, uso, materiales: decoracion.materiales.map((material) => ({ variantId: material.variantId, cantidad: material.cantidad })) };
  const cotizada = await deps.cotizarCurada(decoracion.materiales).catch((error: unknown) => ({ ok: false, razon: "error_del_motor", detalle: error instanceof Error ? error.message : "error" }) as const);
  if (!cotizada.ok) {
    deps.auditar("regla:cotizacion_guiada", "la lista curada de la idea elegida no se pudo cotizar: no se muestra otro precio", { cotiza: false, origen: "curada", razon: cotizada.razon, detalle: cotizada.detalle }, { entrada });
    return { cotizacion: null, decision: { usar: "sin_precio", motivo: cotizada.razon, detalle: cotizada.detalle, origen: "curada" }, respuesta: { ok: false, motivo: "cotizacion_no_disponible", aviso: AVISO_SIN_PRECIO } };
  }
  const { cotizacion, globos, fuera } = cotizada;
  const noIncluidos = fuera.map(({ nombre, cantidad }) => ({ nombre, cantidad }));
  const nota = notaNoIncluidos(noIncluidos);
  deps.auditar("regla:cotizacion_guiada", "precio de los materiales de la idea elegida: su lista curada con el cotizador único (la idea no tiene plan guardado)", {
    cotiza: true, origen: "curada", total: cotizacion.total, lineas: cotizacion.lineas.length, globos, fuera: fuera.map(({ variantId, cantidad, motivo }) => ({ variantId, cantidad, motivo })),
  }, { entrada });
  return {
    cotizacion, decision: { ...curada, cotizacion, globos, fuera }, ...(noIncluidos.length ? { noIncluidos } : {}),
    respuesta: { cotizacion, incluyeIva: true, uso, aviso: nota ? `${AVISO_CURADA} ${nota} Dilo con honestidad al cliente.` : AVISO_CURADA },
  };
}

export async function costearDecoracion(decoracion: DecoracionCotizable, uso: string, deps: DependenciasCosteo): Promise<Costeo> {
  const decision = await decidirCotizacionDelCarrusel(decoracion.id, deps);
  if (decision.usar === "curada") return costearCurada(decoracion, uso, deps);
  if (decision.usar === "sin_precio") {
    deps.auditar("regla:cotizacion_guiada", "la idea elegida no se pudo cotizar: no se muestra otro precio que el de su plan", { cotiza: false, razon: decision.motivo, ...(decision.detalle ? { detalle: decision.detalle } : {}) }, { entrada: { decoracionId: decoracion.id, uso } });
    return { cotizacion: null, decision, respuesta: { ok: false, motivo: "cotizacion_no_disponible", aviso: AVISO_SIN_PRECIO } };
  }
  const { cotizacion, globos } = decision.resultado;
  const origen = decision.usar === "motor" ? "motor_3d" : "plan_python";
  deps.auditar("regla:cotizacion_guiada", decision.usar === "motor" ? "precio de la idea elegida: el plan del motor 3D (Python cotiza)" : "precio de la idea elegida: el plan de Python de la idea guardada", {
    cotiza: true, origen, total: cotizacion.total, lineas: cotizacion.lineas.length, globos, ...(decision.usar === "plan_python" ? { motivo: decision.motivo, ...(decision.detalle ? { detalle: decision.detalle } : {}) } : {}),
  }, { entrada: { decoracionId: decoracion.id, uso } });
  return { cotizacion, decision, respuesta: { cotizacion, incluyeIva: true, uso, aviso: AVISO_PLAN } };
}
