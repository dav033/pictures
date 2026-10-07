/**
 * Escenas del taller 3D (varias piezas en una sala). Sin coste: no llama a ninguna IA.
 * - el preset «Arco orgánico con dos columnas y guirnalda» arma sin avisos, con sus cuatro piezas;
 * - las columnas quedan a los lados del arco, sin tocarlo, y todo lo que va en el piso queda apoyado en y = 0;
 * - nada atraviesa el piso, las paredes ni el techo de la sala en ningún preset;
 * - lo colgado del techo queda bajo el techo, a la altura de cuelga, con su hilo hasta el techo;
 * - lo que va en una pared queda pegado a ella y mirando al salón (también en las laterales);
 * - lo colgado de un ancla queda igual que con `colocarEn`, y con `cada` se repite;
 * - los materiales de la escena son la suma de los de cada pieza (por sus copias);
 * - es determinista (y la caché no cambia nada); los ciclos y los padres que faltan avisan sin romper;
 * - `reemplazarColor` sobre la escena entera cambia el color en todas sus piezas.
 */
import assert from "node:assert/strict";
import { armarEscena, anclasElegidas, duplicarNodo, escenaEnIngles, quitarNodo, SALA_INICIAL, type Escena, type NodoArmado } from "../../src/lib/globos3d/escena";
import { ESCENAS_PREDEFINIDAS, PIEZAS_NUEVAS, escenaPredefinida, piezaNueva } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import { colocarEn } from "../../src/lib/globos3d/decoraciones";
import { decoracionPredefinida } from "../../src/lib/globos3d/figuras";
import { reemplazarColor } from "../../src/lib/globos3d/recolorear";

const EPS = 0.5;
const cerca = (a: number, b: number, tol = EPS) => Math.abs(a - b) <= tol;
const total = (m: ReadonlyArray<{ cantidad: number }>) => m.reduce((s, x) => s + x.cantidad, 0);
const nodo = (armada: { porNodo: NodoArmado[] }, id: string) => { const n = armada.porNodo.find((x) => x.id === id); assert.ok(n, `falta el nodo ${id}`); return n; };

// 1. El preset del dueño.
const preset = escenaPredefinida("arco_organico_columnas_guirnalda");
const cache = new Map<string, PiezaArmada>();
const armada = armarEscena(preset, cache);
assert.deepEqual(armada.avisos, [], "el arco con columnas arma sin avisos");
assert.deepEqual(preset.nodos.map((n) => n.pieza.tipo).sort(), ["arco_organico", "columna", "columna", "guirnalda"]);
const arco = nodo(armada, "arco"), izq = nodo(armada, "columna-izq"), der = nodo(armada, "columna-der"), guirnalda = nodo(armada, "guirnalda");
assert.ok(arco.globos.length > 150, `el arco orgánico tiene globos (${arco.globos.length})`);
assert.ok(izq.caja.max.x < arco.caja.min.x, `la columna izquierda queda a la izquierda del arco sin tocarlo (${izq.caja.max.x.toFixed(1)} < ${arco.caja.min.x.toFixed(1)})`);
assert.ok(der.caja.min.x > arco.caja.max.x, `la columna derecha queda a la derecha del arco (${der.caja.min.x.toFixed(1)} > ${arco.caja.max.x.toFixed(1)})`);
for (const n of [arco, izq, der]) assert.ok(cerca(n.caja.min.y, 0), `${n.id} apoyada en el piso (y mín. ${n.caja.min.y.toFixed(2)})`);
assert.ok(cerca((izq.caja.min.z + izq.caja.max.z) / 2, (arco.caja.min.z + arco.caja.max.z) / 2, 30), "las columnas están a la altura (en z) de las patas del arco");
assert.ok(cerca(guirnalda.caja.min.z, -preset.sala.fondoCm / 2), `la guirnalda queda pegada a la pared del fondo (z mín. ${guirnalda.caja.min.z.toFixed(2)})`);
assert.ok(guirnalda.caja.max.y <= preset.sala.altoCm, "la guirnalda cabe bajo el techo");
assert.ok(guirnalda.caja.min.y >= arco.caja.max.y - 5, "la guirnalda asoma por encima del arco");

// 2. Nada atraviesa la sala en ningún preset (y cada pieza nueva se arma).
for (const p of ESCENAS_PREDEFINIDAS) {
  const a = armarEscena(p.escena, cache);
  assert.deepEqual(a.avisos, [], `${p.id}: sin avisos`);
  const s = p.escena.sala;
  for (const n of a.porNodo) {
    assert.ok(n.caja.min.y >= -EPS && n.caja.max.y <= s.altoCm + EPS, `${p.id}/${n.id}: entre el piso y el techo (${n.caja.min.y.toFixed(1)}…${n.caja.max.y.toFixed(1)})`);
    assert.ok(n.caja.min.x >= -s.anchoCm / 2 - EPS && n.caja.max.x <= s.anchoCm / 2 + EPS, `${p.id}/${n.id}: entre las paredes laterales`);
    assert.ok(n.caja.min.z >= -s.fondoCm / 2 - EPS, `${p.id}/${n.id}: no atraviesa la pared del fondo`);
  }
}
for (const t of PIEZAS_NUEVAS) assert.ok(armarPieza(piezaNueva(t.id).pieza).globos.length > 0, `pieza nueva ${t.id}`);

// 3. Techo: cada pieza colgada cuelga bajo el techo a su altura de cuelga, con su hilo.
const techo = escenaPredefinida("techo_racimos");
const armadaTecho = armarEscena(techo);
for (const n of techo.nodos) {
  if (n.colocacion.en !== "techo") continue;
  const hecho = nodo(armadaTecho, n.id);
  assert.ok(cerca(hecho.caja.max.y, techo.sala.altoCm - n.colocacion.cuelgaCm), `${n.id}: su borde de arriba a ${n.colocacion.cuelgaCm} cm del techo`);
  assert.ok(hecho.caja.max.y < techo.sala.altoCm, `${n.id}: bajo el techo`);
  const cx = (hecho.caja.min.x + hecho.caja.max.x) / 2, cz = (hecho.caja.min.z + hecho.caja.max.z) / 2;
  assert.ok(cerca(cx, n.colocacion.xCm, 1) && cerca(cz, n.colocacion.zCm, 1), `${n.id}: centrada en su (x, z)`);
}
assert.equal(armadaTecho.cilindros.length, techo.nodos.filter((n) => n.colocacion.en === "techo" && n.colocacion.cuelgaCm > 0).length, "un hilo por pieza colgada");
for (const h of armadaTecho.cilindros) assert.ok(cerca(h.base.y + h.altoCm, techo.sala.altoCm), "el hilo llega al techo");
// Volteada: una flor (mira a +y) colgada cabeza abajo mira al piso.
const flor = techo.nodos.find((n) => n.pieza.tipo === "decoracion" && n.colocacion.en === "techo" && n.colocacion.volteada)!;
assert.ok(nodo(armadaTecho, flor.id).globos.every((g) => g.direccion.y < -0.1), "la flor volteada mira al piso (todos sus globos apuntan hacia abajo)");

// 4. Paredes: pegado a cada una y mirando al salón.
const pared = piezaNueva("pared").pieza;
for (const [lado, eje, signo] of [["fondo", "z", 1], ["izquierda", "x", 1], ["derecha", "x", -1]] as const) {
  const escena: Escena = { sala: SALA_INICIAL, nodos: [{ id: "p", nombre: "Pared", pieza: pared, colocacion: { en: "pared", pared: lado, aLoLargoCm: 40, alturaCm: 30 } }] };
  const hecho = armarEscena(escena).porNodo[0]!;
  const muro = lado === "fondo" ? -SALA_INICIAL.fondoCm / 2 : lado === "izquierda" ? -SALA_INICIAL.anchoCm / 2 : SALA_INICIAL.anchoCm / 2;
  const espalda = signo > 0 ? hecho.caja.min[eje] : hecho.caja.max[eje];
  assert.ok(cerca(espalda, muro), `pared ${lado}: pegada (${espalda.toFixed(2)} vs ${muro})`);
  assert.ok(cerca(hecho.caja.min.y, 30), `pared ${lado}: su borde de abajo a la altura pedida`);
  const normal = hecho.anclas[0]!.normal;
  assert.ok(normal[eje] * signo > 0.99, `pared ${lado}: sus anclas miran al salón`);
  // A lo largo: +40 cm hacia la derecha de quien mira la pared desde dentro.
  const centro = lado === "fondo" ? (hecho.caja.min.x + hecho.caja.max.x) / 2 : (hecho.caja.min.z + hecho.caja.max.z) / 2;
  const esperado = lado === "fondo" ? 40 : lado === "izquierda" ? -40 : 40;
  assert.ok(cerca(centro, esperado, 1), `pared ${lado}: corrida a lo largo (${centro.toFixed(1)} vs ${esperado})`);
}

// 5. Anclas: igual que `colocarEn`, y con `cada` se repite.
const conFlor: Escena = {
  sala: SALA_INICIAL,
  nodos: [
    { id: "col", nombre: "Columna", pieza: piezaNueva("columna").pieza, colocacion: { en: "piso", xCm: 50, zCm: -20, giroGrados: 30 } },
    { id: "flor", nombre: "Flor", pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("flor5") }, colocacion: { en: "ancla", padreId: "col", ancla: 5, cada: 0, giroGrados: 15 } },
  ],
};
const armadaFlor = armarEscena(conFlor);
const anclaMundo = nodo(armadaFlor, "col").anclas[5]!;
const esperada = colocarEn(armarPieza(conFlor.nodos[1]!.pieza).globos, anclaMundo, (15 * Math.PI) / 180);
const puesta = nodo(armadaFlor, "flor").globos;
assert.equal(puesta.length, esperada.length);
puesta.forEach((g, i) => {
  const e = esperada[i]!;
  assert.ok(cerca(g.nudo.x, e.nudo.x, 1e-6) && cerca(g.nudo.y, e.nudo.y, 1e-6) && cerca(g.nudo.z, e.nudo.z, 1e-6), "el nudo coincide con colocarEn");
  assert.ok(cerca(g.direccion.x, e.direccion.x, 1e-9) && cerca(g.direccion.y, e.direccion.y, 1e-9) && cerca(g.direccion.z, e.direccion.z, 1e-9), "la dirección coincide con colocarEn");
});
assert.deepEqual(anclasElegidas(36, 2, 8), [2, 10, 18, 26, 34]);
const repetida = armarEscena({ ...conFlor, nodos: [conFlor.nodos[0]!, { ...conFlor.nodos[1]!, colocacion: { en: "ancla", padreId: "col", ancla: 2, cada: 8, giroGrados: 0 } }] });
assert.equal(nodo(repetida, "flor").copias, 5, "con cada = 8 la flor va en 5 anclas de la columna");

// 6. Materiales: la suma de cada pieza (por sus copias), y cuadran con los globos.
for (const a of [armada, armadaTecho, repetida]) {
  assert.equal(total(a.materiales), a.porNodo.reduce((s, n) => s + total(n.materiales), 0), "la escena suma los materiales de sus piezas");
  assert.equal(total(a.materiales), a.globos.length, "un material por globo (sin tubitos)");
}
for (const n of preset.nodos) assert.deepEqual(nodo(armada, n.id).materiales, armarPieza(n.pieza).materiales, `${n.id}: sus materiales son los de su pieza`);
assert.equal(total(nodo(repetida, "flor").materiales), 5 * total(armarPieza(conFlor.nodos[1]!.pieza).materiales), "las copias multiplican los materiales");

// 7. Determinismo (con y sin caché).
assert.equal(JSON.stringify(armarEscena(preset)), JSON.stringify(armada), "misma escena, mismo resultado (sin caché)");
assert.equal(JSON.stringify(armarEscena(preset, cache)), JSON.stringify(armada), "misma escena, mismo resultado (con caché)");

// 8. Errores de colocación: avisan sin romper.
const ciclo: Escena = { sala: SALA_INICIAL, nodos: [
  { id: "a", nombre: "A", pieza: piezaNueva("columna").pieza, colocacion: { en: "ancla", padreId: "b", ancla: 0, cada: 0, giroGrados: 0 } },
  { id: "b", nombre: "B", pieza: piezaNueva("columna").pieza, colocacion: { en: "ancla", padreId: "a", ancla: 0, cada: 0, giroGrados: 0 } },
  { id: "c", nombre: "C", pieza: piezaNueva("columna").pieza, colocacion: { en: "ancla", padreId: "no-existe", ancla: 0, cada: 0, giroGrados: 0 } },
] };
const armadaCiclo = armarEscena(ciclo);
assert.ok(armadaCiclo.avisos.length >= 2, "el ciclo y el padre que falta avisan");
assert.equal(nodo(armadaCiclo, "c").copias, 0);

// 9. Duplicar y quitar: lo que colgaba de lo quitado pasa al piso.
const duplicada = duplicarNodo(conFlor, "col");
assert.equal(duplicada.nodos.length, 3);
assert.equal(new Set(duplicada.nodos.map((n) => n.id)).size, 3, "ids distintos");
const sinColumna = quitarNodo(conFlor, "col", armadaFlor);
assert.equal(sinColumna.nodos.length, 1);
assert.equal(sinColumna.nodos[0]!.colocacion.en, "piso", "la flor huérfana queda en el piso");

// 10. Colores de la escena: un cambio llega a todas las piezas.
const recoloreada = reemplazarColor(preset, "005", "640");
assert.ok(recoloreada.cambios >= 3, `el blanco cambia en el arco, las columnas y la guirnalda (${recoloreada.cambios} cambios)`);
const materialesNuevos = armarEscena(recoloreada.valor, cache).materiales;
assert.ok(!materialesNuevos.some((m) => m.codigo === "005"), "ya no queda blanco");
assert.ok(materialesNuevos.some((m) => m.codigo === "640"), "el azul pastel entró");
assert.deepEqual(recoloreada.valor.sala, preset.sala, "la sala no se toca");

// 11. Descripción en inglés.
const texto = escenaEnIngles(preset, armada);
assert.match(texto, /organic balloon arch/);
assert.match(texto, /2 × classic balloon column/);
assert.match(texto, /garland/);

console.log(`OK escena 3D: arco ${arco.globos.length} globos + columnas ${izq.globos.length}/${der.globos.length} + guirnalda ${guirnalda.globos.length} = ${armada.globos.length}; ${ESCENAS_PREDEFINIDAS.length} presets dentro de la sala; ${texto.length} caracteres en inglés`);
