/**
 * Decoraciones del taller 3D: flores por propiedades y su colocación en anclas. Sin coste.
 * - la flor arma tantos pétalos como pide (3-8) más su centro (uno o trío), y los pétalos se tocan sin montarse;
 * - todas las flores predefinidas usan colores que existen en el formato de cada parte;
 * - `colocarEn` gira la flor hacia la normal del ancla (el centro apunta hacia fuera) y la lleva a su posición;
 * - la trenza expone 4 anclas por cuarteto, en la superficie (entre globos), y la regla elige cada N y 1/2/4 caras;
 * - la lista de materiales separa formato y color.
 */
import assert from "node:assert/strict";
import { FLORES_PREDEFINIDAS, armarFlor, colocarEn, elegirAnclas, materialesPorFormato, type PropiedadesFlor } from "../../src/lib/globos3d/decoraciones";
import { armarColumna } from "../../src/lib/globos3d/columnas";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";

for (const f of FLORES_PREDEFINIDAS) {
  const { petalos, centro } = f.propiedades;
  assert.ok(coloresDelFormato(petalos.formatoId).some((c) => c.codigo === petalos.codigo), `${f.id}: el color de los pétalos no existe en ${petalos.formatoId}`);
  if (centro) assert.ok(coloresDelFormato(centro.formatoId).some((c) => c.codigo === centro.codigo), `${f.id}: el color del centro no existe en ${centro.formatoId}`);
  const flor = armarFlor(f.propiedades);
  assert.equal(flor.globos.length, petalos.cantidad + (centro ? centro.cantidad : 0), `${f.id}: número de globos`);
}

const base: PropiedadesFlor = { petalos: { formatoId: "R-5", infladoCm: 12, codigo: "012", cantidad: 5, aperturaGrados: 15, giroGrados: 0 }, centro: { formatoId: "R-5", infladoCm: 8, codigo: "570", cantidad: 1 } };
for (const cantidad of [3, 4, 5, 6, 8]) {
  const flor = armarFlor({ ...base, petalos: { ...base.petalos, cantidad } });
  const petalos = flor.globos.slice(0, cantidad);
  const l = centroCuerpo("redondo", 12);
  const cuerpos = petalos.map((g) => { const k = l + g.cuelloExtraCm; return { x: g.nudo.x + g.direccion.x * k, y: g.nudo.y + g.direccion.y * k, z: g.nudo.z + g.direccion.z * k }; });
  for (let i = 0; i < cantidad; i++) {
    const a = cuerpos[i]!, b = cuerpos[(i + 1) % cantidad]!;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= 12 * 0.87, `${cantidad} pétalos: se montan`);
  }
  for (const g of petalos) assert.ok(Math.hypot(g.nudo.x, g.nudo.y, g.nudo.z) <= 1.5, "los nudos de los pétalos quedan amarrados al centro");
}
// Apertura: plana (0°) vs copa (45°): los pétalos suben.
const copa = armarFlor({ ...base, petalos: { ...base.petalos, aperturaGrados: 45 } });
assert.ok(copa.globos[0]!.direccion.y > 0.6 && armarFlor({ ...base, petalos: { ...base.petalos, aperturaGrados: 0 } }).globos[0]!.direccion.y === 0);

// Colocar en un ancla que mira hacia +X: el centro (que miraba a +Y) pasa a mirar a +X y la flor queda en el ancla.
const puesta = colocarEn(armarFlor(base).globos, { posicion: { x: 30, y: 100, z: 0 }, normal: { x: 1, y: 0, z: 0 } });
const centroPuesto = puesta[puesta.length - 1]!;
assert.ok(centroPuesto.direccion.x > 0.99, `el centro mira hacia la normal: ${JSON.stringify(centroPuesto.direccion)}`);
assert.ok(Math.abs(centroPuesto.nudo.x - 30) < 0.01 && Math.abs(centroPuesto.nudo.y - 100) < 0.01);

// Anclas de una columna de R-12 de 1,8 m: 9 cuartetos × 4 huecos; en la superficie, a ~0,68 diámetros del eje.
const columna = armarColumna({ formato: formatoPorId("R-12")!, infladoCm: 25, alturaCm: 180, patron: "un_color", colores: ["009"] });
assert.equal(columna.anclas.length, columna.niveles * 4);
for (const a of columna.anclas) {
  const r = Math.hypot(a.posicion.x, a.posicion.z);
  assert.ok(r > 25 * 0.6 && r < 25 * 0.75, `ancla a ${r.toFixed(1)} cm del eje`);
  assert.ok(Math.abs(Math.hypot(a.normal.x, a.normal.z) - 1) < 0.01 && Math.abs(a.normal.y) < 0.01, "la normal sale horizontal hacia fuera");
}
assert.equal(elegirAnclas(columna.anclas, { cadaNiveles: 2, caras: 2 }).length, 5 * 2, "cada 2 cuartetos, 2 caras: 5 niveles × 2");
assert.equal(elegirAnclas(columna.anclas, { cadaNiveles: 1, caras: 4 }).length, columna.niveles * 4);

assert.deepEqual(materialesPorFormato([{ formatoId: "R-5", codigo: "012" }, { formatoId: "R-12", codigo: "012" }, { formatoId: "R-5", codigo: "012" }]),
  [{ formatoId: "R-5", codigo: "012", cantidad: 2 }, { formatoId: "R-12", codigo: "012", cantidad: 1 }]);

console.log(`OK test-decoraciones3d: ${FLORES_PREDEFINIDAS.length} flores predefinidas con colores reales; pétalos amarrados sin montarse; colocación por normal; anclas y reglas de la trenza`);
