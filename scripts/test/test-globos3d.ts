/**
 * Taller 3D (/3d): formatos y geometría de los globos, sin three.js ni navegador. Sin coste.
 * - cada formato de la tabla oficial de color tiene su modelo, y cada modelo tiene colores que se fabrican;
 * - el perfil redondo mide lo que dice su inflado (ancho = diámetro, alto ≈ diámetro × 1,08 más cuello y nudo);
 * - el Link-O-Loon es más alargado que el redondo del mismo diámetro;
 * - el inflado se limita entre el 40 % y el máximo del formato.
 */
import assert from "node:assert/strict";
import { FORMATOS_GLOBO, coloresDelFormato, formatoPorId, infladoValido } from "../../src/lib/globos3d/formatos";
import { altoPerfil, anchoPerfil, contornoCorazon, perfilLink, perfilRedondo } from "../../src/lib/globos3d/geometria";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";

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

console.log(`OK test-globos3d: ${FORMATOS_GLOBO.length} formatos modelados, todos con colores oficiales; perfiles a escala real`);
