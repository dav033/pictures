/**
 * Columna de cuartetos del taller 3D (`armarColumna`), contra la fórmula de Sempertex: cuartetos por metro
 * (R-12 a 25 cm: 5; R-9 a 18 cm: 7; R-5 a 12 cm: 10), giro de 1/8 por nivel y patrones de color. Sin coste.
 */
import assert from "node:assert/strict";
import { armarColumna } from "../../src/lib/globos3d/columnas";
import { formatoPorId } from "../../src/lib/globos3d/formatos";
import { centroCuerpo } from "../../src/lib/globos3d/geometria";

const r12 = formatoPorId("R-12")!;
const metro = (id: string, cm: number) => armarColumna({ formato: formatoPorId(id)!, infladoCm: cm, alturaCm: 100, patron: "un_color", colores: ["005"] }).niveles;
assert.equal(metro("R-12", 25), 5, "R-12 a 25 cm: 5 cuartetos por metro");
assert.equal(metro("R-9", 18), 7, "R-9 a 18 cm: 7 cuartetos por metro");
assert.equal(metro("R-5", 12), 10, "R-5 a 12 cm: 10 cuartetos por metro");

const espiral = armarColumna({ formato: r12, infladoCm: 25, alturaCm: 180, patron: "espiral", colores: ["020", "038", "012", "031"] });
assert.equal(espiral.niveles, 9);
assert.equal(espiral.globos.length, 36);
assert.deepEqual(espiral.materiales, [{ codigo: "020", cantidad: 9 }, { codigo: "038", cantidad: 9 }, { codigo: "012", cantidad: 9 }, { codigo: "031", cantidad: 9 }]);
// Giro de 1/8: el primer globo del nivel 1 está a 45° del primero del nivel 0.
const angulo = (nivel: number) => { const g = espiral.globos.find((x) => x.nivel === nivel)!; return Math.atan2(g.direccion.z, g.direccion.x); };
const giro = Math.abs(((angulo(1) - angulo(0)) * 180) / Math.PI);
assert.ok(Math.abs(Math.min(giro, 360 - giro) - 45) < 0.5, `giro por nivel ${giro}°`);
// Los niveles suben 20 cm (0,8 × 25).
assert.ok(Math.abs(espiral.pasoCm - 20) < 0.01);

// Apretada: el centro de cada globo a 0,62 diámetros del eje (sin hueco en el centro), no a ~0,73 como un cuarteto suelto.
for (const g of espiral.globos) {
  const l = centroCuerpo("redondo", 25);
  const r = Math.hypot(g.nudo.x + g.direccion.x * l, g.nudo.z + g.direccion.z * l);
  assert.ok(Math.abs(r - 25 * 0.62) < 0.5, `globo a ${r.toFixed(1)} cm del eje`);
}

// Dos colores: cada cuarteto es una pareja de cada color, alternados A, B, A, B (mitad y mitad).
const dos = armarColumna({ formato: r12, infladoCm: 25, alturaCm: 100, patron: "dos_colores", colores: ["009", "005"] });
assert.deepEqual(dos.globos.filter((g) => g.nivel === 0).map((g) => g.codigo), ["009", "005", "009", "005"]);
assert.deepEqual(dos.materiales, [{ codigo: "009", cantidad: 10 }, { codigo: "005", cantidad: 10 }]);

const salvavidas = armarColumna({ formato: r12, infladoCm: 25, alturaCm: 100, patron: "salvavidas", colores: ["009", "005"] });
const colorNivel = (n: number) => new Set(salvavidas.globos.filter((g) => g.nivel === n).map((g) => g.codigo));
assert.deepEqual([...colorNivel(0)], ["009"]);
assert.deepEqual([...colorNivel(1)], ["009"]);
assert.deepEqual([...colorNivel(2)], ["005"], "salvavidas: bloques de 2 cuartetos por color");

const zigzag = armarColumna({ formato: r12, infladoCm: 25, alturaCm: 140, patron: "zigzag", colores: ["020", "038", "012", "031"] });
const z = (nivel: number) => { const g = zigzag.globos.find((x) => x.nivel === nivel)!; return Math.round((Math.atan2(g.direccion.z, g.direccion.x) * 180) / Math.PI); };
assert.equal(Math.abs(z(2) - z(0)), 90, "zig-zag: los 2 primeros giros van al mismo lado (2 × 45°)");
assert.equal(z(4), z(0), "zig-zag: los 2 siguientes vuelven");

console.log(`OK test-columna3d: 5/7/10 cuartetos por metro (R-12/R-9/R-5), giro de 1/8, espiralada 9 × 4 = 36 globos, dos colores, salvavidas y zig-zag`);
