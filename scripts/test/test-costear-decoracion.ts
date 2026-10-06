import { strict as assert } from "node:assert";
import { CotizacionGuiadaSchema, ListaMaterialesRequestSchema, ListaMaterialesResultadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { materialesDesdeCotizacion } from "@/lib/cotizacion/borrador-profesional";

const entrada = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: [{ variant_id: "variante-real", cantidad: 51 }] });
assert.equal(entrada.materiales[0]?.cantidad, 51);
assert.equal(ListaMaterialesRequestSchema.safeParse({ ...entrada, iva: 0 }).success, false);

const salidaPython = ListaMaterialesResultadoSchema.parse({ operation_schema_version: "lista-materiales-result.v1", currency: "COP", incluye_iva: true, total: 25000, lineas: [{ variant_id: "variante-real", nombre: "Globo Sempertex", cantidad_necesaria: 51, unidades_paquete: 50, paquetes: 2, precio_paquete: 12500, subtotal: 25000, sobrante: 49 }] });
const cotizacion = CotizacionGuiadaSchema.parse({ lineas: salidaPython.lineas.map((linea) => ({ id: linea.variant_id, tamano: "sin tamaño aplicable", cantidadNecesaria: linea.cantidad_necesaria, disponible: true, varianteId: linea.variant_id, nombre: linea.nombre, precioPaquete: linea.precio_paquete, unidadesPaquete: linea.unidades_paquete, paquetes: linea.paquetes, subtotal: linea.subtotal, sobrante: linea.sobrante })), total: salidaPython.total, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false });
assert.equal(cotizacion.total, 25000);
const profesional = materialesDesdeCotizacion(cotizacion);
assert.equal(profesional.sinPrecio, 0);
assert.deepEqual(profesional.materiales, [{ variant_id: "variante-real", descripcion: "Globo Sempertex", paquetes: 2, precio_paquete_catalogo_cop: 12500 }]);
console.log("test-costear-decoracion: contratos y paso a CotizacionProfesional correctos; cálculo viene de Python");
