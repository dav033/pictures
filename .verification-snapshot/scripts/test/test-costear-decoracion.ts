import { strict as assert } from "node:assert";
import { CotizacionGuiadaSchema, ListaMaterialesRequestSchema, ListaMaterialesResultadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { materialesDesdeCotizacion } from "@/lib/cotizacion/borrador-profesional";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";

const entrada = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: [{ variant_id: "variante-real", cantidad: 51 }] });
assert.equal(entrada.materiales[0]?.cantidad, 51);
assert.equal(ListaMaterialesRequestSchema.safeParse({ ...entrada, iva: 0 }).success, false);

const salidaPython = ListaMaterialesResultadoSchema.parse({ operation_schema_version: "lista-materiales-result.v1", currency: "COP", incluye_iva: true, total: 25000, lineas: [{ variant_id: "variante-real", nombre: "Globo Sempertex", cantidad_necesaria: 51, unidades_paquete: 50, paquetes: 2, precio_paquete: 12500, subtotal: 25000, sobrante: 49 }] });
const cotizacion = CotizacionGuiadaSchema.parse({ lineas: salidaPython.lineas.map((linea) => ({ id: linea.variant_id, tamano: "sin tamaño aplicable", cantidadNecesaria: linea.cantidad_necesaria, disponible: true, varianteId: linea.variant_id, nombre: linea.nombre, precioPaquete: linea.precio_paquete, unidadesPaquete: linea.unidades_paquete, paquetes: linea.paquetes, subtotal: linea.subtotal, sobrante: linea.sobrante })), total: salidaPython.total, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false });
assert.equal(cotizacion.total, 25000);
const profesional = materialesDesdeCotizacion(cotizacion);
assert.equal(profesional.sinPrecio, 0);
assert.deepEqual(profesional.materiales, [{ variant_id: "variante-real", descripcion: "Globo Sempertex", paquetes: 2, precio_paquete_catalogo_cop: 12500 }]);
assert.deepEqual(presentacionMaterialGuiado("Globo látex R-12 Rosewood, paquete x50"), { nombre: "Globo de látex 12\" Palo de rosa", color: "rosado" });
assert.deepEqual(presentacionMaterialGuiado("Globo látex R-12 Durazno, paquete x50"), { nombre: "Globo de látex 12\" Durazno", color: "naranja" });
assert.deepEqual(presentacionMaterialGuiado("Globo látex R-12 Blanco, paquete x50"), { nombre: "Globo de látex 12\" Blanco", color: "blanco" });
// Notas del catálogo real: antes «Globo de látex 12" / PAQUETE X 50 · R-12 · blanco».
assert.deepEqual(presentacionMaterialGuiado("B2b Globo Latex Redondo Fashion Palo De Rosa — R-12 / PAQUETE X 50 · R-12 · rosado"), { nombre: "Globo de látex 12\" Palo de rosa", color: "rosado" });
assert.deepEqual(presentacionMaterialGuiado("B2b Globo Latex Redondo Reflex Dorado Rosa — R-12 / PAQUETE X 50 · R-12 · dorado rosa"), { nombre: "Globo de látex 12\" Reflex dorado rosa", color: "dorado rosa" });
assert.deepEqual(presentacionMaterialGuiado("B2b Globo Latex Redondo Fashion Azul Naval — R-12 / PAQUETE X 50 · R-12 · azul marino"), { nombre: "Globo de látex 12\" Azul naval", color: "azul" });
console.log("test-costear-decoracion: contratos y paso a CotizacionProfesional correctos; cálculo viene de Python");
