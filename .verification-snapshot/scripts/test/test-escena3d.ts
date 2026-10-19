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
 *   de 5 cm (y sin él), girar, pasar de ancla, el desplazamiento para arrastrar sin rearmar y deshacer/rehacer;
 * - la estructura como lienzo (colocación `sobre`): en una columna, una pared de globos, un aro, una guirnalda y un
 *   arco queda pegada a la superficie ±2 cm y mirando hacia fuera, se mueve con su estructura; separar una copia de
 *   un reparto deja N − 1 + 1; moverla a otra estructura, quitarla, deslizarla por la superficie, el imán a las
 *   anclas (< 6 cm), soltar en la pared, el techo o el piso, la vista previa y deshacer.
 */
import assert from "node:assert/strict";
import {
  armarEscena, armarNodoSuelto, anclasElegidas, descendientes, desplazamientoEntre, duplicarNodo, escenaEnIngles, girarNodo, historialCambiar, historialDeshacer, historialNuevo,
  historialRehacer, historialReemplazar, imanar, moverNodo, pasarDeAncla, quitarNodo, SALA_INICIAL, type Colocacion, type Escena, type NodoArmado,
} from "../../src/lib/globos3d/escena";
import {
  colocacionEnSala, colocacionSobre, copiaEn, deslizarSobre, moverCopia, quitarCopia, radioLateral, separarCopia, sitioDescrito, sitioEnPieza,
  type SitioDescrito, type SitioEnPieza,
} from "../../src/lib/globos3d/lienzo-escena";
import { cuerposDeGlobos } from "../../src/lib/globos3d/superficie-globos";
import { ESCENAS_PREDEFINIDAS, PIEZAS_NUEVAS, escenaPredefinida, piezaNueva } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
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

// 13. La estructura como lienzo: colocación `sobre` (cualquier punto de una columna, un aro, una pared de globos, una
// guirnalda), pegada a la superficie ±2 cm y mirando hacia fuera; separar una copia de un reparto; mover y deslizar
// sobre la superficie; imán a las anclas; vista previa igual a lo armado; deshacer.
const florSobre: Pieza = { tipo: "decoracion", decoracion: decoracionPredefinida("flor5") };
const normalDe = (n: NodoArmado) => { const m = n.puestas[0]!.marco.m; return { x: m[1], y: m[4], z: m[7] }; };
const punto3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
/** Lo que se mete la decoración en los globos de la estructura (cm; negativo = queda un hueco). */
function penetracion(deco: NodoArmado, padre: NodoArmado): number {
  let peor = -Infinity;
  for (const a of cuerposDeGlobos(deco.globos)) for (const b of cuerposDeGlobos(padre.globos)) peor = Math.max(peor, a.r + b.r - Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y, a.c.z - b.c.z));
  return peor;
}
/** Pone la flor `sobre` el sitio descrito de `padreId` y devuelve la escena, lo armado y la colocación. */
function ponerSobre(base: Escena, padreId: string, d: SitioDescrito, id = "flor-sobre") {
  const a = armarEscena(base, cache);
  const padre = nodo(a, padreId);
  const sitio = sitioDescrito(padre, d, radioLateral(florSobre));
  assert.ok(!("error" in sitio), `${padreId}: hay superficie en ${JSON.stringify(d)}${"error" in sitio ? ` (${sitio.error})` : ""}`);
  const c = colocacionSobre(padre, sitio as SitioEnPieza, 0);
  assert.ok(c, `${padreId}: colocación sobre`);
  const escena: Escena = { ...base, nodos: [...base.nodos, { id, nombre: "Flor sobre", pieza: florSobre, colocacion: c }] };
  const armadaS = armarEscena(escena, cache);
  assert.deepEqual(armadaS.avisos.filter((x) => x.includes("Flor sobre")), [], `${padreId}: arma sin avisos`);
  return { escena, armada: armadaS, c, deco: nodo(armadaS, id), padre: nodo(armadaS, padreId), sitio: sitio as SitioEnPieza };
}
const pegada = (deco: NodoArmado, padre: NodoArmado, que: string) => {
  const p = penetracion(deco, padre);
  assert.ok(p >= -2 && p <= 2, `${que}: pegada a la superficie ±2 cm (se mete ${p.toFixed(2)} cm)`);
  return p;
};
const conColumna: Escena = { sala, nodos: [
  { id: "col", nombre: "Columna", pieza: piezaNueva("columna").pieza, colocacion: { en: "piso", xCm: 50, zCm: -20, giroGrados: 30 } },
  { id: "muro", nombre: "Pared de globos", pieza: piezaNueva("pared").pieza, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: -150, alturaCm: 20 } },
  { id: "flor", nombre: "Flor", pieza: florSobre, colocacion: { en: "ancla", padreId: "col", ancla: 2, cada: 8, giroGrados: 0 } },
] };
const medidas: string[] = [];
// Columna: de frente y por el lado izquierdo (girada 30°), mirando hacia fuera del eje.
for (const lado of ["frente", "izquierda", "atras"] as const) {
  const r = ponerSobre(conColumna, "col", { alturaCm: 100, lado });
  const n = normalDe(r.deco);
  const eje = { x: (r.padre.caja.min.x + r.padre.caja.max.x) / 2, z: (r.padre.caja.min.z + r.padre.caja.max.z) / 2 };
  const fuera = { x: r.sitio.punto.x - eje.x, y: 0, z: r.sitio.punto.z - eje.z };
  const largoFuera = Math.hypot(fuera.x, fuera.z);
  assert.ok(punto3(n, fuera) / largoFuera > 0.8, `columna ${lado}: mira hacia fuera del eje (${(punto3(n, fuera) / largoFuera).toFixed(2)})`);
  assert.ok(cerca(r.sitio.punto.y, 100, 0.01), `columna ${lado}: a la altura pedida`);
  medidas.push(`columna ${lado} ${pegada(r.deco, r.padre, `columna ${lado}`).toFixed(1)}`);
}
// La columna gira 30°: su frente mira a (sin 30°, 0, cos 30°) y la flor de frente también.
const deFrenteCol = ponerSobre(conColumna, "col", { alturaCm: 100 });
assert.ok(punto3(normalDe(deFrenteCol.deco), { x: Math.sin(Math.PI / 6), y: 0, z: Math.cos(Math.PI / 6) }) > 0.85, "columna girada: la flor de frente mira a su frente");
// Pared de globos: de frente al salón, en el punto pedido.
const enMuro = ponerSobre(conColumna, "muro", { alturaCm: 120, xCm: 30 });
assert.ok(normalDe(enMuro.deco).z > 0.95, `pared de globos: mira al salón (n.z ${normalDe(enMuro.deco).z.toFixed(3)})`);
medidas.push(`pared ${pegada(enMuro.deco, enMuro.padre, "pared de globos").toFixed(1)}`);
// Aro (Halloween) en la pared: en su parte de arriba, mirando hacia delante, no hacia la pared.
const conAro = escenaPredefinida("halloween_aro_ojos");
const aroArmado = nodo(armarEscena(conAro, cache), "aro");
const enAro = ponerSobre(conAro, "aro", { alturaCm: aroArmado.caja.max.y - 15 });
assert.ok(normalDe(enAro.deco).z > 0.3, `aro: mira hacia delante (n.z ${normalDe(enAro.deco).z.toFixed(2)})`);
medidas.push(`aro ${pegada(enAro.deco, enAro.padre, "aro").toFixed(1)}`);
// Guirnalda y arco orgánico del preset del dueño.
const enGuirnalda = ponerSobre(preset, "guirnalda", { xCm: -80 });
assert.ok(normalDe(enGuirnalda.deco).z > 0.2, "guirnalda: no mira a la pared");
medidas.push(`guirnalda ${pegada(enGuirnalda.deco, enGuirnalda.padre, "guirnalda").toFixed(1)}`);
const enArco = ponerSobre(preset, "arco", { alturaCm: 150, xCm: -110 });
assert.ok(normalDe(enArco.deco).z > 0.9, "arco orgánico: la flor en la pata izquierda mira al frente");
medidas.push(`arco ${pegada(enArco.deco, enArco.padre, "arco").toFixed(1)}`);
// Va en el espacio del padre: al mover la columna, la flor se mueve con ella.
const columnaMovida = moverNodo(deFrenteCol.escena, "col", { x: 100, y: 0, z: 0 }, { iman: false });
const cajaAntes = deFrenteCol.deco.caja, cajaDespues = nodo(armarEscena(columnaMovida, cache), "flor-sobre").caja;
assert.ok(cerca(cajaDespues.min.x - cajaAntes.min.x, 100, 0.01) && cerca(cajaDespues.min.y, cajaAntes.min.y, 0.01), "la flor sobre la columna se mueve con ella");
// Vista previa: armar solo la pieza nueva con lo ya armado da lo mismo que armar la escena entera.
const suelta = armarNodoSuelto(conColumna, armarEscena(conColumna, cache), deFrenteCol.escena.nodos.at(-1)!, cache);
assert.equal(JSON.stringify(suelta.globos), JSON.stringify(deFrenteCol.deco.globos), "la vista previa coincide con lo que queda al soltar");
// Lo que va sobre una pieza es su descendiente (no se puede poner la columna sobre la flor) y al quitarla pasa al piso.
assert.ok(descendientes(deFrenteCol.escena, "col").has("flor-sobre"), "lo que va sobre la columna cuelga de ella");
assert.equal(quitarNodo(deFrenteCol.escena, "col", deFrenteCol.armada).nodos.find((n) => n.id === "flor-sobre")?.colocacion.en, "piso", "sin la columna, la flor queda en el piso");
assert.equal(moverNodo(deFrenteCol.escena, "flor-sobre", { x: 10, y: 0, z: 0 }), deFrenteCol.escena, "lo que va sobre otra pieza no se mueve con moverNodo (se desliza)");

// Separar una copia de un reparto: quedan N − 1 + 1, la separada en el mismo sitio, materiales iguales.
const armadaReparto = armarEscena(conColumna, cache);
const reparto = nodo(armadaReparto, "flor");
assert.equal(reparto.copias, 5, "la flor va en 5 anclas de la columna");
const separada = separarCopia(conColumna, armadaReparto, "flor", 2);
assert.ok(separada && separada.id !== "flor", "la copia separada es un nodo nuevo");
const armadaSeparada = armarEscena(separada.escena, cache);
assert.deepEqual(armadaSeparada.avisos, [], "separar no deja avisos");
assert.equal(nodo(armadaSeparada, "flor").copias, 4, "el reparto queda con N − 1 = 4");
assert.equal(nodo(armadaSeparada, separada.id).copias, 1, "y la separada es 1");
assert.equal(separada.escena.nodos.find((n) => n.id === separada.id)?.colocacion.en, "sobre", "la separada va sobre la columna");
assert.deepEqual((separada.escena.nodos.find((n) => n.id === "flor")?.colocacion as { omitir?: number[] }).omitir, [reparto.puestas[2]!.ancla], "el reparto se salta el ancla de la separada");
const cajaCopia = reparto.puestas[2]!.caja, cajaSeparada = nodo(armadaSeparada, separada.id).caja;
const centro = (c: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) => ({ x: (c.min.x + c.max.x) / 2, y: (c.min.y + c.max.y) / 2, z: (c.min.z + c.max.z) / 2 });
// En el reparto, la flor va amarrada en el hueco entre globos (algo metida); separada, se apoya sobre ellos: solo se
// corre hacia fuera, a lo largo de la normal del ancla, sin irse de lado.
const anclaSeparada = nodo(armadaReparto, "col").anclas[reparto.puestas[2]!.ancla!]!;
const corrimiento = { x: centro(cajaSeparada).x - centro(cajaCopia).x, y: centro(cajaSeparada).y - centro(cajaCopia).y, z: centro(cajaSeparada).z - centro(cajaCopia).z };
const haciaFuera = punto3(corrimiento, anclaSeparada.normal);
const deLado = Math.sqrt(Math.max(0, punto3(corrimiento, corrimiento) - haciaFuera * haciaFuera));
assert.ok(haciaFuera > -1 && haciaFuera < 15 && deLado < 3, `la separada se queda en su sitio (sale ${haciaFuera.toFixed(1)} cm hacia fuera y ${deLado.toFixed(1)} cm de lado)`);
pegada(nodo(armadaSeparada, separada.id), nodo(armadaSeparada, "col"), "la copia separada");
for (const k of [0, 1, 3, 4]) {
  const antes = reparto.puestas[k]!.caja, despues = nodo(armadaSeparada, "flor").puestas[k > 2 ? k - 1 : k]!.caja;
  assert.ok(cerca(antes.min.y, despues.min.y, 1e-6), `la copia ${k} no se mueve`);
}
assert.equal(total(armadaSeparada.materiales), total(armadaReparto.materiales), "los materiales no cambian al separar");
assert.equal(copiaEn(reparto, centro(reparto.puestas[3]!.caja)), 3, "copiaEn: la copia bajo el puntero");
// Una copia que se coge y se suelta en otra estructura: se separa y las demás se quedan; deshacer vuelve.
const destinoMuro = colocacionSobre(nodo(armadaReparto, "muro"), sitioEnPieza(nodo(armadaReparto, "muro"), (sitioDescrito(nodo(armadaReparto, "muro"), { alturaCm: 100 }) as SitioEnPieza).punto, { radioCm: radioLateral(florSobre) }))!;
const movida = moverCopia(conColumna, armadaReparto, "flor", 1, destinoMuro);
assert.ok(movida, "la copia pasa a la pared de globos");
const armadaMovida = armarEscena(movida.escena, cache);
assert.equal(nodo(armadaMovida, "flor").copias, 4);
assert.equal((movida.escena.nodos.find((n) => n.id === movida.id)?.colocacion as { padreId: string }).padreId, "muro");
pegada(nodo(armadaMovida, movida.id), nodo(armadaMovida, "muro"), "copia movida a la pared");
assert.equal(moverCopia(conColumna, armadaReparto, "col", 0, { ...destinoMuro, padreId: "flor" }), null, "no se puede poner una pieza sobre lo que cuelga de ella");
let hLienzo = historialCambiar(historialNuevo(conColumna), movida.escena);
hLienzo = historialDeshacer(hLienzo);
assert.equal(hLienzo.presente, conColumna, "deshacer devuelve la copia a su reparto");
assert.equal(historialRehacer(hLienzo).presente, movida.escena, "y rehacer la vuelve a mover");
// Quitar una copia: el reparto se la salta; la última quita la pieza.
assert.equal(nodo(armarEscena(quitarCopia(conColumna, armadaReparto, "flor", 0), cache), "flor").copias, 4, "Supr sobre una copia quita solo esa");
const solo = { ...conColumna, nodos: conColumna.nodos.map((n) => (n.id === "flor" ? { ...n, colocacion: { en: "ancla" as const, padreId: "col", ancla: 5, cada: 0, giroGrados: 0 } } : n)) };
assert.ok(!quitarCopia(solo, armarEscena(solo, cache), "flor", 0).nodos.some((n) => n.id === "flor"), "si es la única, se quita la pieza");
const unaSola = separarCopia(solo, armarEscena(solo, cache), "flor", 0);
assert.ok(unaSola && unaSola.id === "flor" && unaSola.escena.nodos.length === solo.nodos.length, "separar la única copia convierte ese mismo nodo");

// Deslizar sobre la superficie: en la columna da la vuelta (sigue pegada y mirando fuera); en la pared sube derecho.
let girando = deFrenteCol.escena;
for (let i = 0; i < 4; i++) girando = deslizarSobre(girando, armarEscena(girando, cache), "flor-sobre", { x: 10, y: 0, z: -5 });
const armadaGirando = armarEscena(girando, cache);
const nGirando = normalDe(nodo(armadaGirando, "flor-sobre"));
assert.ok(punto3(nGirando, normalDe(deFrenteCol.deco)) < 0.97, "deslizar: la flor da la vuelta a la columna (cambia hacia dónde mira)");
assert.ok(Math.abs(nGirando.y) < 0.4, "deslizar de lado: sigue mirando hacia fuera, no al techo");
pegada(nodo(armadaGirando, "flor-sobre"), nodo(armadaGirando, "col"), "deslizada en la columna");
const subida = deslizarSobre(enMuro.escena, enMuro.armada, "flor-sobre", { x: 0, y: 20, z: 0 });
const armadaSubida = armarEscena(subida, cache);
assert.ok(cerca(nodo(armadaSubida, "flor-sobre").caja.min.y - enMuro.deco.caja.min.y, 20, 4), `deslizar en la pared: sube ~20 cm (${(nodo(armadaSubida, "flor-sobre").caja.min.y - enMuro.deco.caja.min.y).toFixed(1)})`);
assert.ok(normalDe(nodo(armadaSubida, "flor-sobre")).z > 0.95, "y sigue de frente");
pegada(nodo(armadaSubida, "flor-sobre"), nodo(armadaSubida, "muro"), "deslizada en la pared");
assert.equal(deslizarSobre(enMuro.escena, enMuro.armada, "flor-sobre", { x: 0, y: 5000, z: 0 }), enMuro.escena, "si se sale de la superficie, no se mueve");

// Imán: a menos de 6 cm de un ancla se pega a ella; más lejos o sin imán (Alt), no.
const col = nodo(armadaReparto, "col");
const ancla = col.anclas[7]!;
const cercaDelAncla = { x: ancla.posicion.x + 3, y: ancla.posicion.y + 2, z: ancla.posicion.z };
assert.equal(sitioEnPieza(col, cercaDelAncla, { iman: true }).ancla, 7, "a 3,6 cm se pega al ancla");
assert.deepEqual(sitioEnPieza(col, cercaDelAncla, { iman: true }).punto, ancla.posicion);
assert.equal(sitioEnPieza(col, cercaDelAncla, { iman: false }).ancla, null, "sin imán (Alt) no se pega");
assert.equal(sitioEnPieza(col, { x: ancla.posicion.x + 9, y: ancla.posicion.y, z: ancla.posicion.z }, { iman: true }).ancla === 7, false, "a 9 cm no se pega a esa");

// Soltar en la sala: pared (centrada donde se soltó, de frente), techo (colgada) y piso.
const soltadaPared = colocacionEnSala(sala, "fondo", { x: 100, y: 150, z: -sala.fondoCm / 2 }, florSobre);
const cajaPared = armarEscena({ sala, nodos: [{ id: "f", nombre: "F", pieza: florSobre, colocacion: soltadaPared }] }).porNodo[0]!.caja;
assert.ok(cerca(centro(cajaPared).x, 100, 1) && cerca(centro(cajaPared).y, 150, 1) && cerca(cajaPared.min.z, -sala.fondoCm / 2, 0.5), "soltada en la pared del fondo: centrada donde se soltó y pegada");
assert.deepEqual(colocacionEnSala(sala, "techo", { x: 40, y: sala.altoCm, z: -60 }, florSobre), { en: "techo", xCm: 40, zCm: -60, cuelgaCm: 60, giroGrados: 0, volteada: true });
assert.equal(colocacionEnSala(sala, "piso", { x: 9000, y: 0, z: 0 }, florSobre).en, "piso");
console.log(`OK lienzo: ${medidas.join(" · ")} cm metidas en los globos; reparto 5 → 4 + 1; deslizar, imán y soltar en la sala`);

console.log(`OK escena 3D: arco ${arco.globos.length} globos + columnas ${izq.globos.length}/${der.globos.length} + guirnalda ${guirnalda.globos.length} = ${armada.globos.length}; ${ESCENAS_PREDEFINIDAS.length} presets dentro de la sala; ${texto.length} caracteres en inglés`);
