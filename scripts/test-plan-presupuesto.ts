import assert from "node:assert/strict";
import { MERMA } from "../src/lib/cotizacion/constantes";
import { distribuirReservaProyecto, optimizarCobertura } from "../src/lib/plan/optimizar-materiales";
import { extraerRestriccionesUsuario } from "../src/lib/plan/restricciones";
import { evaluateSceneQa } from "../src/lib/ia/image-qa";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { cajasDeEstructuras } from "../src/lib/plan/ubicaciones";

const opcionesR12 = [
  { variantId: "R12-X12", unidadesPaquete: 12, precio: 8832 },
  { variantId: "R12-X50", unidadesPaquete: 50, precio: 28977 },
];

const grupos = [74, 49, 45].map((unidades) => {
  const compra = optimizarCobertura(unidades, opcionesR12);
  assert.ok(compra, `debe cubrir ${unidades} unidades`);
  const costoLocal = Math.ceil(Math.ceil(unidades * (1 + MERMA)) / 12) * 8832;
  assert.equal(compra.costo, compra.compras.reduce((sum, item) => sum + item.paquetes * item.precio, 0));
  assert.ok(compra.costo <= costoLocal, `la optimización global no puede costar más que X12 local para ${unidades}`);
  return { unidades, compra, costoLocal };
});

const totalOptimizado = grupos.reduce((sum, grupo) => sum + grupo.compra!.costo, 0);
const totalLocal = grupos.reduce((sum, grupo) => sum + grupo.costoLocal, 0);
assert.ok(totalOptimizado < totalLocal, "mezclar presentaciones debe reducir el total de paquetes");
assert.equal(totalOptimizado, 104595, "la cobertura base sin merma por SKU debe ser reproducible");
assert.equal(totalLocal, 150144);

const arenaR5Opciones = [
  { variantId: "ARENA-R5-X20", unidadesPaquete: 20, precio: 4950 },
  { variantId: "ARENA-R5-X50", unidadesPaquete: 50, precio: 12350 },
];
const arenaR5 = optimizarCobertura(20, arenaR5Opciones);
const arenaR5Naive = optimizarCobertura(20, arenaR5Opciones, MERMA);
const arenaR24 = optimizarCobertura(3, [{ variantId: "ARENA-R24-X3", unidadesPaquete: 3, precio: 18800 }]);
const arenaR24Naive = optimizarCobertura(3, [{ variantId: "ARENA-R24-X3", unidadesPaquete: 3, precio: 18800 }], MERMA);
assert.equal(arenaR5?.compras[0]?.paquetes, 1);
assert.equal(arenaR5Naive?.compras[0]?.paquetes, 2);
assert.equal(arenaR24?.compras[0]?.paquetes, 1);
assert.equal(arenaR24Naive?.compras[0]?.paquetes, 2);
assert.equal((arenaR5Naive?.costo ?? 0) - (arenaR5?.costo ?? 0), 4950);
assert.equal((arenaR24Naive?.costo ?? 0) - (arenaR24?.costo ?? 0), 18800);
const arenaWasteOnlySavings = (arenaR5Naive?.costo ?? 0) - (arenaR5?.costo ?? 0) + (arenaR24Naive?.costo ?? 0) - (arenaR24?.costo ?? 0);

const reservaProyecto = distribuirReservaProyecto([
  { id: "r5", designQuantity: 20, purchaseQuantity: 20, compatibilityKey: "R-5|arena" },
  { id: "r24", designQuantity: 3, purchaseQuantity: 3, compatibilityKey: "R-24|verde" },
  { id: "r12", designQuantity: 119, purchaseQuantity: 150, compatibilityKey: "R-12|verde" },
], MERMA);
assert.equal(reservaProyecto.targetWasteReserve, 12);
assert.equal(reservaProyecto.naturalSurplus, 31);
assert.equal(reservaProyecto.coveredWasteReserve, 12);
assert.equal(reservaProyecto.uncoveredWasteReserve, 0);
assert.equal(reservaProyecto.allocations.get("r5") ?? 0, 0, "un paquete exacto no crea una compra extra solo por merma");
assert.equal(reservaProyecto.allocations.get("r24") ?? 0, 0, "R-24 exacto no duplica el paquete caro");

// Contrato financiero del incidente original: se conserva separado del
// fixture de paquetes para detectar si una iteración cambia las cifras de
// referencia o mezcla la alternativa no-Reflex con la comparación Reflex.
const incidente = { actual: 408837, reflex: 378471, comparableSinReflex: 166728 };
assert.equal(incidente.actual - incidente.reflex, 30366);
assert.equal(incidente.reflex > incidente.comparableSinReflex, true);

const restricciones = extraerRestriccionesUsuario("Necesito 2 arcos y 2 columnas, máximo $300.000, en dorado R-12.", {});
assert.deepEqual(restricciones.estructuras, [
  { tipo: "arco", repeticiones: 2, procedencia: "explicito", texto_original: "Necesito 2 arcos y 2 columnas, máximo $300.000, en dorado R-12.", polaridad: "obligatorio" },
  { tipo: "columna", repeticiones: 2, procedencia: "explicito", texto_original: "Necesito 2 arcos y 2 columnas, máximo $300.000, en dorado R-12.", polaridad: "obligatorio" },
]);
assert.equal(extraerRestriccionesUsuario("glamour en salón", {}).acabados.length, 0, "glamour no inventa un acabado duro");
assert.equal(restricciones.presupuesto?.techo_cop, 300000);
assert.equal(restricciones.tamanos[0]?.valor, "R-12");
assert.equal(extraerRestriccionesUsuario("Quiero 1 arco pequeño.", {}).estructuras[0]?.repeticiones, 1);
assert.equal(extraerRestriccionesUsuario("$50.000 a $100.000", {}).presupuesto?.techo_cop, 100000);
assert.deepEqual(extraerRestriccionesUsuario("dorado, sin negro y rosado", {}).colores.map((item) => item.valor), ["dorado", "rosa"]);
const cajas = cajasDeEstructuras([{
  estructura_id: "EST_01_ARCO",
  nombre: "Arcos",
  tipo: "arco",
  rol_escena: "focal",
  ubicacion: "arco_central",
  medidas: { ancho_m: 3, alto_m: 2 },
  repeticiones: 2,
  densidad: "media",
  mezcla: "clasica",
  materiales: [{ product_id: "P", color: "dorado", participacion: 1, rol_material: "principal" }],
  porque: "Foco",
}]);
assert.ok(cajas["EST_01_ARCO#1"] && cajas["EST_01_ARCO#2"]);
assert.notEqual(cajas["EST_01_ARCO#1"]!.bbox.x, cajas["EST_01_ARCO#2"]!.bbox.x);

// La QA no acepta el blueprint como evidencia: si falta una instancia física,
// el resultado debe fallar aunque la otra instancia sí esté presente.
const escena = {
  elements: [
    { element_id: "EST_01_ARCO#1" },
    { element_id: "EST_01_ARCO#2" },
  ],
} as SceneSpec;
const qa = evaluateSceneQa(escena, { presentElementIds: ["EST_01_ARCO#1"] });
assert.equal(qa.pass, false);
assert.deepEqual(qa.required_elements.map((item) => item.present), [true, false]);
assert.match(qa.retry_reasons.join(" | "), /EST_01_ARCO#2/);
const qaConExtra = evaluateSceneQa(escena, { presentElementIds: ["EST_01_ARCO#1", "EST_01_ARCO#2", "INVENTADA"] });
assert.equal(qaConExtra.pass, false);
assert.match(qaConExtra.retry_reasons.join(" | "), /INVENTADA/);

console.log(`[PASS] presupuesto y composición — optimizado ${totalOptimizado.toLocaleString("es-CO")} COP vs local ${totalLocal.toLocaleString("es-CO")} COP; Arena R-5 2→1 paquetes, R-24 2→1; ahorro exclusivo por merma ${arenaWasteOnlySavings.toLocaleString("es-CO")} COP`);
