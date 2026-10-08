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
 * - `reemplazarColor` sobre la escena entera cambia el color en todas sus piezas;
 * - mover a mano (arrastrar / flechas): en el piso, la pared y el techo respeta los límites de la sala, el imán
 *   de 5 cm (y sin él), girar, pasar de ancla, el desplazamiento para arrastrar sin rearmar y deshacer/rehacer.
 */
import assert from "node:assert/strict";
import {
  armarEscena, anclasElegidas, desplazamientoEntre, duplicarNodo, escenaEnIngles, girarNodo, historialCambiar, historialDeshacer, historialNuevo,
  historialRehacer, historialReemplazar, imanar, moverNodo, pasarDeAncla, quitarNodo, SALA_INICIAL, type Colocacion, type Escena, type NodoArmado,
} from "../../src/lib/globos3d/escena";
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

// 12. Mover a mano: piso, pared y techo; imán; límites de la sala; girar; anclas; desplazamiento; historial.
const colocacionDe = (e: Escena, id: string): Colocacion => { const n = e.nodos.find((x) => x.id === id); assert.ok(n, `falta ${id}`); return n.colocacion; };
const numero = (c: Colocacion, clave: "xCm" | "zCm" | "cuelgaCm" | "giroGrados" | "ancla" | "aLoLargoCm" | "alturaCm"): number => {
  const v = (c as Record<string, unknown>)[clave];
  assert.equal(typeof v, "number", `${c.en} sin ${clave}`);
  return v as number;
};
const sala = SALA_INICIAL;
const enPiso: Escena = { sala, nodos: [{ id: "col", nombre: "Columna", pieza: piezaNueva("columna").pieza, colocacion: { en: "piso", xCm: 37, zCm: 12, giroGrados: 0 } }] };
const armadaPiso = armarEscena(enPiso);
const cajaCol = nodo(armadaPiso, "col").caja;
const medioX = (cajaCol.max.x - cajaCol.min.x) / 2;
// Imán: lo que se mueve cae en múltiplos de 5; lo que no se mueve no se toca. Sin imán, el paso exacto.
assert.deepEqual(colocacionDe(moverNodo(enPiso, "col", { x: 5, y: 0, z: 0 }, { armada: armadaPiso }), "col"), { en: "piso", xCm: 40, zCm: 12, giroGrados: 0 }, "flecha con imán: 37 + 5 → 40; z sigue en 12");
assert.deepEqual(colocacionDe(moverNodo(enPiso, "col", { x: 5, y: 0, z: 0 }, { armada: armadaPiso, iman: false }), "col"), { en: "piso", xCm: 42, zCm: 12, giroGrados: 0 }, "sin imán (Alt): 37 + 5 = 42");
assert.equal(imanar(12.4, true), 10); assert.equal(imanar(12.6, true), 15); assert.equal(imanar(12.34, false), 12.3);
assert.equal(moverNodo(enPiso, "col", { x: 0, y: 80, z: 0 }), enPiso, "en el piso la altura no cuenta: misma escena");
// Límites: por mucho que se arrastre, la caja de la columna no pasa de las paredes (ni del frente).
for (const [dx, dz] of [[5000, 0], [-5000, 0], [0, 5000], [0, -5000]] as const) {
  const caja = nodo(armarEscena(moverNodo(enPiso, "col", { x: dx, y: 0, z: dz }, { armada: armadaPiso })), "col").caja;
  assert.ok(caja.min.x >= -sala.anchoCm / 2 - EPS && caja.max.x <= sala.anchoCm / 2 + EPS, `piso (${dx}, ${dz}): dentro a lo ancho (${caja.min.x.toFixed(1)}…${caja.max.x.toFixed(1)})`);
  assert.ok(caja.min.z >= -sala.fondoCm / 2 - EPS && caja.max.z <= sala.fondoCm / 2 + EPS, `piso (${dx}, ${dz}): dentro a lo hondo (${caja.min.z.toFixed(1)}…${caja.max.z.toFixed(1)})`);
}
const xTope = numero(colocacionDe(moverNodo(enPiso, "col", { x: 5000, y: 0, z: 0 }, { armada: armadaPiso }), "col"), "xCm");
assert.ok(cerca(xTope, sala.anchoCm / 2 - medioX), `pegada a la pared derecha (${xTope} vs ${sala.anchoCm / 2 - medioX})`);
// Pared: a lo largo (lo que va hacia la pared no cuenta) y en altura, sin salirse por los lados, el piso ni el techo.
const enPared: Escena = { sala, nodos: [{ id: "p", nombre: "Pared", pieza: piezaNueva("pared").pieza, colocacion: { en: "pared", pared: "izquierda", aLoLargoCm: 0, alturaCm: 20 } }] };
const armadaPared = armarEscena(enPared);
assert.deepEqual(colocacionDe(moverNodo(enPared, "p", { x: 30, y: 10, z: -20 }, { armada: armadaPared }), "p"), { en: "pared", pared: "izquierda", aLoLargoCm: 20, alturaCm: 30 }, "en la pared izquierda, −z es su derecha; x (hacia la pared) no cuenta");
for (const d of [{ x: 0, y: 0, z: 9000 }, { x: 0, y: 0, z: -9000 }, { x: 0, y: 9000, z: 0 }, { x: 0, y: -9000, z: 0 }]) {
  const caja = nodo(armarEscena(moverNodo(enPared, "p", d, { armada: armadaPared })), "p").caja;
  assert.ok(caja.min.z >= -sala.fondoCm / 2 - EPS && caja.max.z <= sala.fondoCm / 2 + EPS, `pared ${JSON.stringify(d)}: dentro de la pared a lo largo`);
  assert.ok(caja.min.y >= -EPS && caja.max.y <= sala.altoCm + EPS, `pared ${JSON.stringify(d)}: entre el piso y el techo (${caja.min.y.toFixed(1)}…${caja.max.y.toFixed(1)})`);
}
// Techo: (x, z) como el piso; subir (y +) acorta el hilo; ni atraviesa el piso ni pasa del techo.
const enTecho: Escena = { sala, nodos: [{ id: "t", nombre: "Racimo", pieza: piezaNueva("columna").pieza, colocacion: { en: "techo", xCm: 0, zCm: 0, cuelgaCm: 40, giroGrados: 0, volteada: false } }] };
const armadaT = armarEscena(enTecho);
assert.deepEqual(colocacionDe(moverNodo(enTecho, "t", { x: -25, y: 15, z: 25 }, { armada: armadaT }), "t"), { en: "techo", xCm: -25, zCm: 25, cuelgaCm: 25, giroGrados: 0, volteada: false }, "techo: subir 15 cm acorta el hilo a 25");
assert.ok(cerca(nodo(armarEscena(moverNodo(enTecho, "t", { x: 0, y: -9000, z: 0 }, { armada: armadaT })), "t").caja.min.y, 0, 1), "techo: bajar a tope la deja tocando el piso, no lo atraviesa");
assert.equal(numero(colocacionDe(moverNodo(enTecho, "t", { x: 0, y: 9000, z: 0 }, { armada: armadaT }), "t"), "cuelgaCm"), 0, "techo: subir a tope la pega al techo");
// Lo colgado de un ancla no se arrastra: cambia de ancla (dentro de las que hay).
assert.equal(moverNodo(conFlor, "flor", { x: 50, y: 0, z: 0 }), conFlor, "lo colgado de un ancla no se mueve con moverNodo");
assert.equal(numero(colocacionDe(pasarDeAncla(conFlor, "flor", 1, armadaFlor), "flor"), "ancla"), 6);
assert.equal(numero(colocacionDe(pasarDeAncla(conFlor, "flor", 999, armadaFlor), "flor"), "ancla"), nodo(armadaFlor, "col").anclas.length - 1, "no pasa de la última ancla");
assert.equal(numero(colocacionDe(pasarDeAncla(conFlor, "flor", -999, armadaFlor), "flor"), "ancla"), 0, "ni de la primera");
// Girar: Q/E suman o restan y el giro queda en (−180, 180]; en la pared no gira.
assert.equal(numero(colocacionDe(girarNodo(enPiso, "col", 15), "col"), "giroGrados"), 15);
assert.equal(numero(colocacionDe(girarNodo(girarNodo(enPiso, "col", -90), "col", -135), "col"), "giroGrados"), 135, "−225° es 135°");
assert.equal(numero(colocacionDe(girarNodo(conFlor, "flor", 45), "flor"), "giroGrados"), 60, "lo colgado gira sobre su ancla");
assert.equal(girarNodo(enPared, "p", 15), enPared, "en la pared no gira");
// Desplazamiento: lo que se corre lo dibujado al arrastrar coincide con lo que se corre la caja al rearmar.
for (const [base, id, d] of [[enPiso, "col", { x: -60, y: 0, z: 35 }], [enPared, "p", { x: 0, y: 25, z: -45 }], [enTecho, "t", { x: 30, y: 10, z: -20 }]] as const) {
  const antes = nodo(armarEscena(base), id).caja;
  const movidaE = moverNodo(base, id, d);
  const despues = nodo(armarEscena(movidaE), id).caja;
  const desp = desplazamientoEntre(sala, colocacionDe(base, id), colocacionDe(movidaE, id));
  assert.ok(desp, `${id}: solo se trasladó`);
  for (const eje of ["x", "y", "z"] as const) assert.ok(cerca(despues.min[eje] - antes.min[eje], desp[eje], 1e-6), `${id}: desplazamiento en ${eje} (${(despues.min[eje] - antes.min[eje]).toFixed(2)} vs ${desp[eje].toFixed(2)})`);
}
assert.equal(desplazamientoEntre(sala, colocacionDe(enPiso, "col"), colocacionDe(girarNodo(enPiso, "col", 15), "col")), null, "si gira, no es solo trasladar");
// Historial: deshacer y rehacer, un cambio nuevo borra lo deshecho, a lo más 50 pasos.
let h = historialNuevo(enPiso);
const paso1 = moverNodo(enPiso, "col", { x: 25, y: 0, z: 0 }), paso2 = girarNodo(paso1, "col", 45);
h = historialCambiar(historialCambiar(h, paso1), paso2);
assert.equal(h.presente, paso2);
h = historialDeshacer(h); assert.equal(h.presente, paso1, "deshacer vuelve al paso anterior");
h = historialDeshacer(h); assert.equal(h.presente, enPiso);
assert.equal(historialDeshacer(h), h, "sin pasado, deshacer no hace nada");
h = historialRehacer(h); assert.equal(h.presente, paso1, "rehacer");
h = historialCambiar(h, moverNodo(paso1, "col", { x: 0, y: 0, z: -30 })); assert.equal(h.futuro.length, 0, "un cambio nuevo borra lo deshecho");
assert.equal(historialRehacer(h), h);
h = historialReemplazar(h, paso2); assert.equal(h.pasado.length, 2, "reemplazar no guarda paso"); assert.equal(h.presente, paso2);
let largo = historialNuevo(enPiso);
for (let i = 1; i <= 70; i++) largo = historialCambiar(largo, moverNodo(enPiso, "col", { x: i, y: 0, z: 0 }, { iman: false }));
assert.equal(largo.pasado.length, 50, "a lo más 50 pasos para deshacer");

console.log(`OK escena 3D: arco ${arco.globos.length} globos + columnas ${izq.globos.length}/${der.globos.length} + guirnalda ${guirnalda.globos.length} = ${armada.globos.length}; ${ESCENAS_PREDEFINIDAS.length} presets dentro de la sala; ${texto.length} caracteres en inglés`);
