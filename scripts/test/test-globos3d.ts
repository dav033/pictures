/**
 * Taller 3D (/3d): formatos y geometría de los globos, sin three.js ni navegador. Sin coste.
 * - cada formato de la tabla oficial de color tiene su modelo, y cada modelo tiene colores que se fabrican;
 * - el perfil redondo mide lo que dice su inflado (ancho = diámetro, alto ≈ diámetro × 1,08 más cuello y nudo);
 * - el Link-O-Loon es más alargado que el redondo del mismo diámetro;
 * - el inflado se limita entre el 40 % y el máximo del formato.
 */
import assert from "node:assert/strict";
import { FORMATOS_GLOBO, coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { altoPerfil, anchoPerfil, centroCuerpo, contornoCorazon, perfilLink, perfilRedondo } from "../../src/lib/globos3d/geometria";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import { MODULOS, armarModulo, materialesModulo } from "../../src/lib/globos3d/modulos";

const modelados = new Set(FORMATOS_GLOBO.map((f) => f.id));
const enTabla = new Set(TABLA_SEMPERTEX.referencias.flatMap((r) => r.formatos).filter((f) => f !== "Stuffing"));
for (const id of enTabla) assert.ok(modelados.has(id), `falta el modelo 3D de ${id}`);
for (const f of FORMATOS_GLOBO) {
  assert.ok(coloresDelFormato(f.id).length > 0, `${f.id} no tiene colores en la tabla oficial`);
  assert.ok(f.infladoDecoracionCm <= f.diametroMaxCm, `${f.id}: el inflado de decoración pasa del máximo`);
}
assert.equal(coloresDelFormato("R-12").length, 90);
assert.equal(formatoPorId("R-12")?.diametroMaxCm, 30.5);

for (const diametro of [12, 25, 55, 85]) {
  const perfil = perfilRedondo(diametro);
  assert.ok(Math.abs(anchoPerfil(perfil) - diametro) < diametro * 0.02, `ancho del redondo de ${diametro} cm: ${anchoPerfil(perfil)}`);
  const alto = altoPerfil(perfil);
  assert.ok(alto > diametro * 1.08 && alto < diametro * 1.3, `alto del redondo de ${diametro} cm: ${alto}`);
  assert.equal(perfil[0]!.r, 0, "el perfil arranca en el eje (nudo cerrado)");
  assert.equal(perfil[perfil.length - 1]!.r, 0, "el perfil cierra arriba en el eje");
}
assert.ok(altoPerfil(perfilLink(25)) > altoPerfil(perfilRedondo(25)) * 1.2, "el Link-O-Loon es más alargado que el redondo");

const corazon = contornoCorazon(28);
const xs = corazon.map((p) => p.x);
assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 28) < 1, "el corazón mide su ancho");

const r12 = formatoPorId("R-12")!;
assert.equal(infladoValido(r12, 99), r12.diametroMaxCm);
assert.equal(infladoValido(r12, 1), r12.diametroMaxCm * 0.4);

// Módulos: pareja 2, trío 3, cuarteto 4, quinteto 5, sexteto 6; los cuerpos vecinos no se montan y los nudos
// quedan en el centro (a menos de un diámetro); el cuarteto de R-12 a 25 cm mide unos 60-65 cm de ancho.
assert.deepEqual(MODULOS.map((m) => m.globos), [2, 3, 4, 5, 6]);
for (const modulo of MODULOS) {
  for (const id of ["R-5", "R-12", "LOL-12"]) {
    const f = formatoPorId(id)!;
    const d = f.infladoDecoracionCm;
    const armado = armarModulo(modulo, f, d);
    assert.equal(armado.globos.length, modulo.globos);
    const centro = centroCuerpo(f.tipo === "link" ? "link" : "redondo", d);
    const cuerpos = armado.globos.map((g) => ({ x: g.nudo.x + g.direccion.x * centro, y: g.nudo.y + g.direccion.y * centro, z: g.nudo.z + g.direccion.z * centro }));
    for (let i = 0; i < cuerpos.length; i++) {
      const a = cuerpos[i]!, b = cuerpos[(i + 1) % cuerpos.length]!;
      if (cuerpos.length > 1) assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= d * 0.95, `${modulo.id} ${id}: los globos ${i} y ${i + 1} se montan`);
    }
    for (const g of armado.globos) assert.ok(Math.hypot(g.nudo.x, g.nudo.y, g.nudo.z) < d, `${modulo.id} ${id}: un nudo quedó lejos del centro`);
    assert.equal(armado.anclas.length, modulo.globos >= 3 ? modulo.globos + 1 : 1);
  }
}
const cuartetoR12 = armarModulo(MODULOS[2]!, formatoPorId("R-12")!, 25);
assert.ok(cuartetoR12.anchoCm >= 55 && cuartetoR12.anchoCm <= 70, `ancho del cuarteto R-12: ${cuartetoR12.anchoCm}`);
assert.deepEqual(materialesModulo(["009", "005", "009", "005"]), [{ codigo: "009", cantidad: 2 }, { codigo: "005", cantidad: 2 }]);

console.log(`OK test-globos3d: ${FORMATOS_GLOBO.length} formatos modelados, todos con colores oficiales; perfiles a escala real; 5 módulos armados sin montarse`);
