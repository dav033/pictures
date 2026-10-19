import assert from "node:assert/strict";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import type { Crosswalk } from "../../src/lib/globos3d/motor/crosswalk-variantes";
import { cotizarBom } from "../../src/lib/globos3d/motor/v1";
import { cotizarListaCurada } from "../../src/lib/guiada-motor/cotizar-curada";
import { cotizarIdeaConMotor } from "../../src/lib/guiada-motor/cotizar-idea";
import { cotizarIdeaConPython } from "../../src/lib/guiada-motor/cotizar-idea-python";
import type { DependenciasCosteo } from "../../src/lib/guiada-motor/costear-idea";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderCotizacionTaller } from "../../src/lib/taller/cotizacion-taller";
import { CotizacionTallerSchema } from "../../src/lib/taller/cotizacion-taller-tipos";
import { presentacionesDeImpresos, variantesDeImpresos } from "./presentaciones-impresos";
import { pythonDoble } from "./python-doble-precio";

/**
 * Los dos precios que D-038 pide iguales, sin navegador ni red, con Python sustituido por el doble que cotiza con los paquetes del
 * cruce: el «Precio en la tienda» del Taller (la lista de globos de la escena mandada a la ruta del Taller con el mismo armado de
 * pedido que `useCotizacionTaller`) y el «¿Cuánto cuesta?» de la tarjeta de la vista guiada (`costearDecoracion`, bandera en 3d).
 */
type Linea = { formatoId: string; codigo: string; cantidad: number };

const CLAVE_APP = "clave-de-prueba-precio-tarjeta-taller";
const COOKIES = [`${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`, `feedback_usuario=${"d4".repeat(16)}`].join("; ");
process.env.APP_PASSWORD = CLAVE_APP;
delete process.env.DATABASE_URL;

const nada = () => undefined;

/** Lo que el Taller manda al pulsar «Cotizar en la tienda»: lo que la tienda vende por paquete, sin ceros y en orden fijo (`pedidoDe`). */
export const pedidoDelTaller = (lista: ReadonlyArray<Linea>) =>
  lista.filter((l) => l.cantidad > 0).sort((a, b) => a.formatoId.localeCompare(b.formatoId) || a.codigo.localeCompare(b.codigo)).map((l) => ({ formatoId: l.formatoId, codigo: l.codigo, cantidad: l.cantidad }));

export async function totalDelTaller(lista: ReadonlyArray<Linea>, cruce: Crosswalk): Promise<number> {
  const peticion = new Request("https://app.test/api/taller/cotizacion", { method: "POST", headers: { "content-type": "application/json", cookie: COOKIES }, body: JSON.stringify({ materiales: pedidoDelTaller(lista) }) });
  const respuesta = await atenderCotizacionTaller(peticion, { cotizar: (bom) => cotizarBom(bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }), auditar: nada });
  assert.equal(respuesta.status, 200, await respuesta.clone().text());
  const cotizacion = CotizacionTallerSchema.parse(await respuesta.json());
  assert.deepEqual(cotizacion.faltantes, [], "el Taller cotizó toda la lista");
  return cotizacion.total;
}

/**
 * Las dependencias de la tarjeta: el motor 3D arma el plan guardado de la idea, la lista curada pasa por el cotizador único (lo que el
 * cruce no conoce, con las presentaciones de `presentaciones-impresos`) y Python no responde para los planes de Python.
 */
export const dependenciasDeLaTarjeta = (cruce: Crosswalk): DependenciasCosteo => {
  const { cotizarLista } = pythonDoble(cruce, { variantesExtra: variantesDeImpresos() });
  return {
    leerMotor: async () => "3d",
    tienePlanGuardado: async (id) => planGuardadoDeIdea(id) !== null,
    cotizarConMotor: (id) => cotizarIdeaConMotor(id, { planGuardado: planGuardadoDeIdea, crosswalk: async () => cruce, cotizarLista }),
    cotizarConPython: (id) => cotizarIdeaConPython(id, { planGuardado: planGuardadoDeIdea, resolver: async () => { throw new Error("Python no responde en la prueba"); } }),
    cotizarCurada: (materiales) => cotizarListaCurada(materiales, { crosswalk: async () => cruce, cotizarLista, presentaciones: presentacionesDeImpresos }),
    auditar: nada,
  };
};
