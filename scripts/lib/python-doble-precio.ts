import { PythonAdapterError, type PythonListaMaterialesEntrada, type PythonListaMaterialesResultado } from "../../src/lib/ia/nucleo/python-adapter";
import type { Crosswalk } from "../../src/lib/globos3d/motor/crosswalk-variantes";

/**
 * Python sin red para las pruebas del precio del motor 3D: cotiza con los paquetes del cruce, igual que
 * `cotizar_lista_materiales` (paquetes cerrados, IVA ya incluido, sobrante). No llama a ningún servicio.
 */
export function pythonDoble(crosswalk: Crosswalk, opciones: { sinVariante?: ReadonlySet<string>; fallo?: unknown } = {}) {
  const indice = new Map(Object.values(crosswalk.entradas).flatMap((entrada) => entrada.variantes.map((v) => [v.variantId, v] as const)));
  const llamadas: PythonListaMaterialesEntrada[] = [];
  const cotizarLista = async (entrada: PythonListaMaterialesEntrada): Promise<PythonListaMaterialesResultado> => {
    llamadas.push(entrada);
    if (opciones.fallo) throw opciones.fallo;
    const lineas = entrada.materiales.map((m) => {
      const v = indice.get(m.variant_id);
      if (!v || opciones.sinVariante?.has(m.variant_id)) throw new PythonAdapterError({ code: "PYTHON_INVALID_REQUEST", status: 422, requestId: "r", correlationId: "c", domainCode: "material_no_disponible" });
      const paquetes = Math.ceil(m.cantidad / v.unidadesPaq);
      return { variant_id: m.variant_id, nombre: v.titulo, cantidad_necesaria: m.cantidad, unidades_paquete: v.unidadesPaq, paquetes, precio_paquete: v.precio, subtotal: paquetes * v.precio, sobrante: paquetes * v.unidadesPaq - m.cantidad };
    });
    return { operation_schema_version: "lista-materiales-result.v1", currency: "COP", incluye_iva: true, lineas, total: lineas.reduce((suma, l) => suma + l.subtotal, 0) };
  };
  return { llamadas, cotizarLista };
}

export type PythonDoble = ReturnType<typeof pythonDoble>;
