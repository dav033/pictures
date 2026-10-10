/**
 * Etiquetas de alto y ancho de la estructura elegida en el visor (PRO-13). Sin coste.
 * - las medidas salen de la caja de la pieza en metros, redondeadas al cm (±1 cm);
 * - el ancho es el de la pieza en SU marco: un arco girado 0°, 45° o 90° (en el piso, libre, en el techo o en la pared) mide lo
 *   mismo, no el de su caja en los ejes del mundo; lo que cuelga de un ancla o va sobre otra pieza mide su caja puesta;
 * - el texto siempre tiene dos decimales con coma.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-medidas-caja.ts
 */
import assert from "node:assert/strict";
import { medidasCajaEnMetros, medidasDePieza, textoMetros } from "../../src/lib/globos3d/medidas-caja";
import { SALA_INICIAL, armarEscena, type Caja, type Colocacion, type Escena } from "../../src/lib/globos3d/escena";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

console.log("Medidas de la estructura elegida");
prueba("una caja de 240 cm de ancho, 240,4 cm de alto y 100 cm de fondo da 2,40 m × 2,40 m × 1,00 m", () => {
  const m = medidasCajaEnMetros({ min: { x: -120, y: 0, z: -50 }, max: { x: 120, y: 240.4, z: 50 } });
  assert.deepEqual(m, { anchoM: 2.4, altoM: 2.4, fondoM: 1 });
});
prueba("la altura se mide desde la base de la caja, no desde el piso de la sala", () => {
  const m = medidasCajaEnMetros({ min: { x: 0, y: 30, z: 0 }, max: { x: 50, y: 230, z: 10 } });
  assert.equal(m.altoM, 2);
  assert.equal(m.anchoM, 0.5);
});
prueba("el redondeo es al cm: 2,345 m queda en 2,35 m (±1 cm)", () => {
  const m = medidasCajaEnMetros({ min: { x: 0, y: 0, z: 0 }, max: { x: 234.5, y: 0, z: 0 } });
  assert.equal(m.anchoM, 2.35);
});
const ARCO: Pieza = { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "redondo", anchoCm: 300, altoCm: 200, patron: "espiral", colores: ["609", "005", "570", "010"] };
const sala = () => ({ ...SALA_INICIAL, tonos: { ...SALA_INICIAL.tonos }, mostrar: { ...SALA_INICIAL.mostrar } });
const puesto = (pieza: Pieza, colocacion: Colocacion): Escena => ({ sala: sala(), nodos: [{ id: "p", nombre: "Pieza", pieza, colocacion }] });
const COLOCACIONES: ReadonlyArray<readonly [string, (giro: number) => Colocacion]> = [
  ["piso", (giroGrados) => ({ en: "piso", xCm: 0, zCm: 0, giroGrados })],
  ["libre", (giroGrados) => ({ en: "libre", xCm: 0, yCm: 40, zCm: 0, giroGrados })],
  ["techo", (giroGrados) => ({ en: "techo", xCm: 0, zCm: 0, cuelgaCm: 0, giroGrados, volteada: false })],
];
prueba("el nodo armado trae la caja de la pieza en su marco, la misma que la de armarPieza", () => {
  const nodoArmado = armarEscena(puesto(ARCO, COLOCACIONES[0]![1](30))).porNodo[0]!;
  assert.deepEqual(nodoArmado.cajaLocal, armarPieza(ARCO).caja);
});
prueba("un arco en el piso, libre o en el techo, girado 0°, 45° o 90°, mide siempre su ancho propio; la caja del mundo se encoge al girarlo", () => {
  const local = armarPieza(ARCO).caja;
  const propio = medidasCajaEnMetros(local);
  assert.ok(propio.anchoM > 3 && propio.anchoM < 3.6, `ancho propio ${propio.anchoM} m`);
  for (const [lugar, colocar] of COLOCACIONES) {
    const delMundo: number[] = [];
    for (const giro of [0, 45, 90]) {
      const colocacion = colocar(giro);
      const mundo = armarEscena(puesto(ARCO, colocacion)).porNodo[0]!.caja;
      const m = medidasDePieza(local, mundo, colocacion);
      assert.equal(m.anchoM, propio.anchoM, `${lugar} a ${giro}°`);
      assert.equal(m.fondoM, propio.fondoM, `${lugar} a ${giro}°`);
      assert.ok(Math.abs(m.altoM - propio.altoM) <= 0.01, `${lugar} a ${giro}° el alto es el mismo (${m.altoM} y ${propio.altoM})`);
      delMundo.push(medidasCajaEnMetros(mundo).anchoM);
    }
    assert.ok(delMundo[2]! < 1, `${lugar}: la caja del mundo a 90° mide ${delMundo[2]} m de ancho: por eso no sirve para el ancho`);
    assert.ok(delMundo[1]! < propio.anchoM - 0.3, `${lugar}: a 45° la caja del mundo mide ${delMundo[1]} m`);
  }
});
prueba("en la pared el ancho es el propio, también con la pared de un lado", () => {
  const local = armarPieza(ARCO).caja;
  const propio = medidasCajaEnMetros(local);
  for (const pared of ["fondo", "izquierda", "derecha"] as const) {
    const colocacion: Colocacion = { en: "pared", pared, aLoLargoCm: 0, alturaCm: 0 };
    const mundo: Caja = armarEscena(puesto(ARCO, colocacion)).porNodo[0]!.caja;
    assert.equal(medidasDePieza(local, mundo, colocacion).anchoM, propio.anchoM, pared);
  }
});
prueba("lo que cuelga de un ancla o va sobre otra pieza mide su caja puesta (puede estar en varias anclas o con su x en cualquier dirección)", () => {
  const local = { min: { x: -15, y: 0, z: -15 }, max: { x: 15, y: 30, z: 15 } };
  const grupo = { min: { x: -100, y: 120, z: -15 }, max: { x: 100, y: 250, z: 15 } };
  for (const colocacion of [{ en: "ancla" }, { en: "sobre" }] as const) {
    assert.deepEqual(medidasDePieza(local, grupo, colocacion), { anchoM: 2, altoM: 1.3, fondoM: 0.3 }, colocacion.en);
  }
  assert.deepEqual(medidasDePieza(undefined, grupo, { en: "piso" }), { anchoM: 2, altoM: 1.3, fondoM: 0.3 }, "sin caja propia, la puesta");
});
prueba("el texto lleva dos decimales con coma y la unidad", () => {
  assert.equal(textoMetros(2.4), "2,40 m");
  assert.equal(textoMetros(1), "1,00 m");
});

console.log(`${pruebas} pruebas en verde`);
