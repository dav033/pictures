/**
 * Decoraciones de tubito y corazón, y la mezcla en la pared (Celebra ed. 27, p. 42). Sin coste.
 * - cada predefinida arma los globos y tramos de tubito esperados, con colores que existen en su formato;
 * - la flor de corazones pone la cara de cada corazón hacia fuera de la flor (perpendicular al pétalo);
 * - los tubitos se cuentan por largo (un T-260 da ~137 cm útiles);
 * - `colocarTubosEn` lleva los tubitos al ancla igual que `colocarEn` los globos;
 * - el reparto de la mezcla es determinista (misma semilla, mismo reparto), respeta proporciones y separación,
 *   y el cíclico sigue el orden;
 * - la réplica de Celebra ed. 27 pone las 25 decoraciones de la foto, apoyadas sobre la pared.
 */
import assert from "node:assert/strict";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, armarEstrella, armarFlorCorazones, armarFlorTubito, armarMono, decoracionPredefinida, largoCurva, type Decoracion } from "../../src/lib/globos3d/figuras";
import { colocarEn, colocarTubosEn } from "../../src/lib/globos3d/decoraciones";
import { CELEBRA_27, cuotas, decorarPared, repartirMezcla, type MezclaDecoraciones } from "../../src/lib/globos3d/mezcla";
import { armarParedTrenzas, superficieFrontal } from "../../src/lib/globos3d/pared-trenzas";
import { coloresDelFormato, formatoPorId } from "../../src/lib/globos3d/formatos";
import { esHalloween } from "../../src/lib/globos3d/halloween";

const existe = (formatoId: string, codigo: string) => coloresDelFormato(formatoId).some((c) => c.codigo === codigo);

// Todas las predefinidas: colores que existen en su formato; globos y tubos con sus formatos reales. Las de
// Halloween (figuras de hasta 2 m y papel que no es globo) las prueba `test-halloween-piezas.ts`.
for (const d of DECORACIONES_PREDEFINIDAS.filter((x) => !esHalloween(x.decoracion))) {
  const a = armarDecoracion(d.decoracion);
  for (const g of a.globos) assert.ok(existe(g.formatoId, g.codigo), `${d.id}: ${g.codigo} no existe en ${g.formatoId}`);
  for (const t of a.tubos) {
    assert.ok(existe(t.formatoId, t.codigo), `${d.id}: ${t.codigo} no existe en ${t.formatoId}`);
    assert.equal(formatoPorId(t.formatoId)?.tipo, "tubito", `${d.id}: los tramos son de tubito`);
    assert.ok(t.grosorCm <= formatoPorId(t.formatoId)!.diametroMaxCm, `${d.id}: tubito más grueso que su máximo`);
    assert.ok(t.puntos.length >= 2);
  }
  assert.ok(a.diametroCm > 5 && a.diametroCm < 80, `${d.id}: ${a.diametroCm} cm`);
  assert.ok(a.materiales.length > 0);
}

// Flor de tubito de lazos dorados: 3 lazos + 3 interiores (6 tramos) y su botón; cada lazo sale y vuelve al centro.
const dorada = armarDecoracion(decoracionPredefinida("flor_lazos_dorados"));
assert.equal(dorada.tubos.length, 6);
assert.equal(dorada.globos.length, 1);
for (const t of dorada.tubos) {
  const a = t.puntos[0]!, b = t.puntos[t.puntos.length - 1]!;
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.5, "el lazo vuelve al centro");
  assert.ok(Math.max(...t.puntos.map((p) => Math.hypot(p.x, p.z))) > 6, "y llega lejos del centro");
}
// Burbujas: 8 pétalos en ciclo de 4 colores; ninguno sale del centro (no se montan).
const burbujas = armarDecoracion(decoracionPredefinida("flor_burbujas"));
assert.equal(burbujas.tubos.length, 8);
assert.deepEqual(burbujas.tubos.map((t) => t.codigo), ["012", "970", "012", "009", "012", "970", "012", "009"]);
for (const t of burbujas.tubos) assert.ok(Math.hypot(t.puntos[0]!.x, t.puntos[0]!.z) > 2, "las burbujas arrancan fuera del centro");

// Moño: 2 lazos por lado + 2 colas, un globito al centro; simétrico (tantos tramos a la derecha como a la izquierda).
const mono = armarDecoracion(decoracionPredefinida("mono_fucsia"));
assert.equal(mono.tubos.length, 6);
assert.equal(mono.globos.length, 1);
const lado = (t: { puntos: Array<{ x: number }> }) => Math.sign(t.puntos.reduce((s, p) => s + p.x, 0));
assert.equal(mono.tubos.filter((t) => lado(t) > 0).length, 3);
assert.equal(mono.tubos.filter((t) => lado(t) < 0).length, 3);
assert.equal(armarMono({ formatoId: "T-260", grosorCm: 4, codigo: "012", lazosPorLado: 3, largoLazoCm: 15, anchoLazoCm: 9, aberturaGrados: 30, colas: false, largoColaCm: 10, centro: null }).tubos.length, 6);

// Estrella: rayos = 2 tramos por punta (rayo y perilla), la primera punta hacia arriba (+Z local); contorno = 1 cerrado.
const rayos = armarEstrella({ formatoId: "T-260", grosorCm: 3, codigo: "970", puntas: 5, radioCm: 11, estilo: "rayos", giroGrados: 0, centro: null });
assert.equal(rayos.tubos.length, 10);
const punta = rayos.tubos[1]!.puntos[2]!;
assert.ok(punta.z > 9 && Math.abs(punta.x) < 0.01, "la primera punta mira hacia arriba");
const contorno = armarEstrella({ formatoId: "T-260", grosorCm: 4, codigo: "970", puntas: 5, radioCm: 18, estilo: "contorno", giroGrados: 0, centro: null });
assert.equal(contorno.tubos.length, 1);
assert.ok(contorno.tubos[0]!.cerrado && contorno.tubos[0]!.puntos.length === 10);

// Flor de corazones: 5 Corazón 6 Fucsia con la cara hacia fuera (frente ⟂ pétalo, mirando a +Y) + 5 lazos + centro.
const corazones = armarFlorCorazones({ corazones: { formatoId: "C-6", infladoCm: 14, codigo: "012", cantidad: 5, aperturaGrados: 10, giroGrados: 0 }, interior: null, centro: { formatoId: "R-5", infladoCm: 8, codigo: "968" } });
const petalos = corazones.globos.filter((g) => g.formatoId === "C-6");
assert.equal(petalos.length, 5);
for (const g of petalos) {
  const f = g.frente!;
  assert.ok(Math.abs(f.x * g.direccion.x + f.y * g.direccion.y + f.z * g.direccion.z) < 1e-9, "la cara es perpendicular al pétalo");
  assert.ok(f.y > 0.9, "la cara mira hacia fuera de la flor");
}
assert.ok(existe("C-6", "012") && !existe("C-12", "012"), "el Corazón 6 Fucsia viene de Celebra; el C-12 no se fabrica en Fucsia");
const conInterior = armarDecoracion(decoracionPredefinida("flor_corazones"));
assert.equal(conInterior.globos.length, 6);
assert.equal(conInterior.tubos.length, 5);

// Materiales de tubito por largo: 8 lazos de 15 cm (~33 cm de tubo cada uno) no caben en un T-260 (~137 cm útiles).
const grande = armarFlorTubito({ petalos: { formatoId: "T-260", grosorCm: 4, codigos: ["012"], cantidad: 8, estilo: "lazo", largoCm: 15, anchoCm: 10, aperturaGrados: 0, giroGrados: 0 }, interior: null, corona: null, centro: null });
const largo = grande.tubos.reduce((s, t) => s + largoCurva(t.puntos, t.cerrado), 0);
assert.ok(largo > 200, `largo de 8 lazos: ${largo.toFixed(0)} cm`);
assert.equal(grande.materiales.find((m) => m.formatoId === "T-260")?.cantidad, Math.ceil(((largo + 8 * 4) * 1.1) / (formatoPorId("T-260")!.largoCm! - 15)));
assert.equal(armarDecoracion(decoracionPredefinida("estrella_dorada")).materiales[0]?.cantidad, 1, "una estrella de rayos sale de un T-260");

// Colocar: los tubitos siguen al ancla igual que los globos (mismo marco, mismo giro).
const ancla = { posicion: { x: 100, y: 50, z: 20 }, normal: { x: 0, y: 0, z: 1 } };
const t0 = colocarTubosEn(mono.tubos, ancla)[0]!.puntos[0]!;
const p0 = mono.tubos[0]!.puntos[0]!;
assert.ok(Math.abs(t0.x - (100 + p0.x)) < 1e-9 && Math.abs(t0.y - (50 + p0.z)) < 1e-9 && Math.abs(t0.z - (20 + p0.y)) < 1e-9, "en la pared: X local = derecha, Z local = arriba, Y local = al frente");
const corazonPuesto = colocarEn(petalos, ancla)[0]!;
assert.ok(corazonPuesto.frente!.z > 0.9, "el corazón puesto en la pared mira al frente");

// Reparto: cuotas por resto mayor; determinista; respeta separación; el cíclico sigue el orden de lectura.
assert.deepEqual(cuotas([3, 7, 7, 2, 1, 2, 1, 1, 1], 25), [3, 7, 7, 2, 1, 2, 1, 1, 1]);
assert.deepEqual(cuotas([1, 1, 1], 4), [2, 1, 1]);
assert.deepEqual(cuotas([2, 1], 6), [4, 2]);
const rejilla = Array.from({ length: 12 * 10 }, (_, i) => ({ posicion: { x: (i % 12) * 20, y: Math.floor(i / 12) * 20, z: 0 }, normal: { x: 0, y: 0, z: 1 } }));
const piezas = [{ radioCm: 25, girable: true }, { radioCm: 12, girable: true }, { radioCm: 10, girable: false }];
const elementos = (pesos: number[]) => pesos.map((peso, i) => ({ nombre: `e${i}`, decoracion: decoracionPredefinida("flor5") as Decoracion, peso }));
const base: MezclaDecoraciones = { elementos: elementos([1, 3, 2]), modo: "proporcional", semilla: 7, total: 12, separacionCm: 0, giroAleatorio: true };
const r1 = repartirMezcla(rejilla, piezas, base);
assert.deepEqual(repartirMezcla(rejilla, piezas, base), r1, "misma semilla, mismo reparto");
assert.notDeepEqual(repartirMezcla(rejilla, piezas, { ...base, semilla: 8 }), r1, "otra semilla, otro reparto");
assert.deepEqual([0, 1, 2].map((e) => r1.filter((c) => c.elemento === e).length), [2, 6, 4], "proporciones 1:3:2 de 12");
for (const a of r1) for (const b of r1) {
  if (a === b) continue;
  const p = rejilla[a.ancla]!.posicion, q = rejilla[b.ancla]!.posicion;
  assert.ok(Math.hypot(p.x - q.x, p.y - q.y) >= piezas[a.elemento]!.radioCm + piezas[b.elemento]!.radioCm, "no se montan");
}
for (const c of r1) if (c.elemento === 2) assert.equal(c.giroRad, 0, "lo que no es girable queda derecho");
const ciclico = repartirMezcla(rejilla, [{ radioCm: 5, girable: false }, { radioCm: 5, girable: false }], { ...base, elementos: elementos([1, 2]), modo: "ciclico", total: 6 });
assert.deepEqual(ciclico.map((c) => c.elemento), [0, 1, 1, 0, 1, 1], "cíclico: cada uno tantas veces seguidas como su peso");
assert.equal(rejilla[ciclico[0]!.ancla]!.posicion.y, 180, "cíclico: empieza arriba a la izquierda");
assert.ok(rejilla[ciclico[1]!.ancla]!.posicion.x > rejilla[ciclico[0]!.ancla]!.posicion.x, "y sigue a la derecha");
assert.deepEqual(repartirMezcla(rejilla, piezas, { ...base, elementos: elementos([0, 0, 0]) }), [], "sin pesos no hay reparto");

// Celebra ed. 27: las 25 decoraciones de la foto caben en la pared, deterministas y apoyadas sobre los globos.
const pared = armarParedTrenzas(CELEBRA_27.pared);
const superficie = superficieFrontal(pared.globos);
const limites = { minX: 0, maxX: pared.anchoCm, minY: 0, maxY: pared.altoCm };
const decorada = decorarPared({ anclas: pared.anclas, mezcla: CELEBRA_27.mezcla, superficie, limites });
assert.equal(decorada.colocaciones.length, 25, `decoraciones puestas: ${decorada.colocaciones.length}`);
assert.deepEqual(decorada.porElemento, CELEBRA_27.mezcla.elementos.map((e) => e.peso), "cada pieza tantas veces como en la foto");
assert.deepEqual(decorarPared({ anclas: pared.anclas, mezcla: CELEBRA_27.mezcla, superficie, limites }).colocaciones, decorada.colocaciones, "réplica determinista");
for (const m of decorada.materiales) assert.ok(existe(m.formatoId, m.codigo), `material ${m.formatoId} ${m.codigo} existe`);
assert.equal(decorada.materiales.find((m) => m.formatoId === "C-6")?.cantidad, 7 * 5, "7 flores de corazones × 5 Corazón 6");
assert.equal(decorada.materiales.find((m) => m.formatoId === "R-12" && m.codigo === "412")?.cantidad, 3 * 5, "3 flores grandes × 5 R-12 (la foto)");
// Apoyadas: ningún globo de decoración queda metido detrás del frente de la pared más de lo que cede el látex.
for (const g of decorada.globos) {
  const l = (g.infladoCm * 0.6);
  const cuerpo = { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l };
  assert.ok(cuerpo.z > superficie(cuerpo.x, cuerpo.y) - g.infladoCm * 0.6, `globo ${g.formatoId} ${g.codigo} enterrado en la pared`);
}

console.log(`OK test-figuras3d: ${DECORACIONES_PREDEFINIDAS.length} decoraciones predefinidas con colores reales; lazos, burbujas, moño, estrella y corazones; tubitos por largo; reparto determinista por proporciones y en ciclo; Celebra ed. 27 con ${decorada.colocaciones.length} decoraciones`);

// Réplica 1 a 1: en modo «fijo», cada pieza va al sitio medido en la foto (relativo a la pared), sin azar.
for (const [i, c] of decorada.colocaciones.entries()) {
  const fija = CELEBRA_27.mezcla.fijas![i]!;
  assert.equal(c.elemento, fija.elemento);
}
const moño = CELEBRA_27.mezcla.fijas!.find((f) => f.elemento === 8)!;
assert.ok(moño.u < 0.25 && moño.v < 0.25, "el moño va abajo a la izquierda, como en la foto");
const mitad = decorarPared({ anclas: pared.anclas, mezcla: CELEBRA_27.mezcla, superficie, limites: { ...limites, maxX: limites.maxX / 2 } });
assert.equal(mitad.colocaciones.length, 25, "en una pared más angosta siguen todas, en el mismo sitio relativo");
console.log("OK test-figuras3d: Celebra ed. 27 en sus 25 sitios de la foto");
