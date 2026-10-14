/**
 * Las mesas de invitados del salón como conjuntos paramétricos (REQ-012, REQ-014 T54), sin coste ni red:
 *   npx tsx --conditions=react-server scripts/test/test-salon-mesas-parametricas.ts
 * Cada tipo de mesa (redonda de 8, de 10, imperial) con cada número de sillas que admite: la mesa y su grupo de sillas son dos nodos
 * (sin mueble del catálogo ni `opciones.sillas`), las sillas van `sobre` la mesa y son tantas como `medidasDeMesa` dice, el conjunto
 * ocupa lo mismo que el salón le reserva, y mesa y sillas se mueven, duplican y quitan juntas.
 */
import assert from "node:assert/strict";
import { armarEscena, duplicarNodo, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { contarMobiliario, grupoDeSillasDe, sillasDeMesaNodo } from "../../src/lib/globos3d/mobiliario-asientos-mesa";
import { esMesaParametrica, sillasDePieza } from "../../src/lib/globos3d/mobiliario-conjunto";
import { aforoDeMesas, medidasDeMesa, SILLAS_POR_MESA, TIPOS_MESA_SALON, type TipoMesaSalon } from "../../src/lib/globos3d/salon-evento";
import { conjuntoDeMesaSalon } from "../../src/lib/globos3d/salon-mesa-parametrica";
import { quitarConLoSuyo } from "../../src/lib/globos3d/salon-nodos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const vacia = (): Escena => ({ sala: { ...SALA_INICIAL }, nodos: [] });

const sillasValidas = (tipo: TipoMesaSalon): number[] => {
  const { min, max } = tipo === "imperial" ? SILLAS_POR_MESA.imperial : SILLAS_POR_MESA.redonda;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i).filter((n) => tipo !== "imperial" || n % 2 === 0);
};
const casos = TIPOS_MESA_SALON.flatMap((tipo) => sillasValidas(tipo).map((sillas) => ({ tipo, sillas })));

function escenaCon(tipo: TipoMesaSalon, sillas?: number, x = 0, z = 0, giro = 0): { escena: Escena; mesa: NodoEscena; grupo: NodoEscena } {
  const c = conjuntoDeMesaSalon({ tipo, ...(sillas !== undefined ? { sillas } : {}), ids: { mesa: "mesa-1", sillas: "mesa-1-sillas" }, xCm: x, zCm: z, giroGrados: giro });
  assert.ok(c.sillas, "el conjunto trae sillas");
  return { escena: { ...vacia(), nodos: c.nodos }, mesa: c.mesa, grupo: c.sillas };
}

console.log("Mesas del salón como conjuntos paramétricos (REQ-012):");

prueba("cada tipo y cada número de sillas: dos nodos, sillas sobre la mesa, tantas como dice medidasDeMesa, sin mueble del catálogo", () => {
  for (const { tipo, sillas } of casos) {
    const { escena, mesa, grupo } = escenaCon(tipo, sillas);
    const donde = `${tipo} con ${sillas} sillas`;
    assert.equal(escena.nodos.length, 2, donde);
    assert.ok(esMesaParametrica(mesa.pieza), `${donde}: la mesa es paramétrica`);
    for (const n of escena.nodos) assert.ok(!(n.pieza.tipo === "escenografia" && n.pieza.mueble?.opciones), `${donde}: ${n.id} lleva opciones de mueble de catálogo`);
    assert.equal(grupoDeSillasDe(escena, mesa.id)?.id, grupo.id, `${donde}: las sillas no van sobre la mesa`);
    assert.equal(sillasDePieza(grupo.pieza)!.puestos.length, medidasDeMesa(tipo, sillas).puestos, `${donde}: sillas que caben`);
    assert.equal(sillasDeMesaNodo(escena, mesa).total, sillas, `${donde}: sillas contadas`);
    assert.deepEqual(contarMobiliario(escena), { mesas: 1, sillas }, donde);
  }
});

prueba("sin número de sillas salen las de siempre del tipo (8, 10 y 10) y el aforo cuadra", () => {
  for (const [tipo, puestos] of [["redonda8", 8], ["redonda10", 10], ["imperial", 10]] as const) {
    const { escena, mesa } = escenaCon(tipo);
    assert.equal(sillasDeMesaNodo(escena, mesa).total, puestos);
    assert.equal(aforoDeMesas(3, tipo), 3 * puestos);
  }
});

prueba("el conjunto nunca ocupa más de lo que el salón le reserva (medidasDeMesa) y la mesa mide lo reservado menos las sillas", () => {
  let llenos = 0;
  for (const { tipo, sillas } of casos) {
    const { escena } = escenaCon(tipo, sillas);
    const armada = armarEscena(escena);
    const caja = (id: string) => armada.porNodo.find((n) => n.id === id)!.caja;
    const cajas = [caja("mesa-1"), caja("mesa-1-sillas")];
    const ancho = Math.max(...cajas.map((c) => c.max.x)) - Math.min(...cajas.map((c) => c.min.x));
    const fondo = Math.max(...cajas.map((c) => c.max.z)) - Math.min(...cajas.map((c) => c.min.z));
    const { anchoCm, fondoCm } = medidasDeMesa(tipo, sillas);
    // El vuelo del mantel y el fondo de las sillas pasan unos centímetros de lo reservado (los pasillos son de 90 o más).
    assert.ok(ancho <= anchoCm + 12 && fondo <= fondoCm + 12, `${tipo} ${sillas}: ocupa ${ancho.toFixed(0)} × ${fondo.toFixed(0)} y el salón reserva ${anchoCm} × ${fondoCm}`);
    const mesaAncho = caja("mesa-1").max.x - caja("mesa-1").min.x;
    assert.ok(Math.abs(mesaAncho - (anchoCm - 120)) <= 20, `${tipo} ${sillas}: la mesa mide ${mesaAncho.toFixed(0)} y debía rondar ${anchoCm - 120}`);
    if (ancho >= anchoCm - 30) llenos += 1;
    assert.ok(armada.globos.length === 0 && armada.solidos.length > 0, "son muebles, no decoración de globos");
  }
  assert.ok(llenos >= casos.length / 2, `solo ${llenos} de ${casos.length} conjuntos llenan lo reservado: la medida de la mesa no es la del salón`);
});

prueba("mesa y sillas van juntas: duplicar la mesa copia el grupo, quitar la mesa se lleva las sillas, y mover la mesa mueve el conjunto", () => {
  const { escena, mesa } = escenaCon("redonda8", 8, 100, -50, 30);
  const doble = duplicarNodo(escena, mesa.id);
  assert.equal(doble.nodos.length, 4, "la copia de la mesa se lleva una copia de sus sillas");
  assert.deepEqual(contarMobiliario(doble), { mesas: 2, sillas: 16 });
  const { escena: sinMesa, deMas } = quitarConLoSuyo(escena, [mesa.id]);
  assert.equal(sinMesa.nodos.length, 0);
  assert.equal(deMas, 1, "las sillas salieron con la mesa");
  const antes = armarEscena(escena).porNodo.find((n) => n.id === "mesa-1-sillas")!.caja;
  const movida = { ...escena, nodos: escena.nodos.map((n) => (n.id === mesa.id && n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, xCm: n.colocacion.xCm + 200 } } : n)) };
  const despues = armarEscena(movida).porNodo.find((n) => n.id === "mesa-1-sillas")!.caja;
  assert.ok(Math.abs(despues.min.x - antes.min.x - 200) < 1e-6 && Math.abs(despues.max.x - antes.max.x - 200) < 1e-6, "las sillas siguieron a la mesa");
});

prueba("la paleta del salón (mantel, sillas, cojines) llega al conjunto y las medidas inválidas se rechazan con el mensaje del salón", () => {
  const c = conjuntoDeMesaSalon({ tipo: "redonda8", ids: { mesa: "m", sillas: "s" }, xCm: 0, zCm: 0, giroGrados: 0, paleta: ["#112233", "#445566", "#778899"] });
  assert.equal(c.mesa.pieza.tipo === "escenografia" && c.mesa.pieza.mueble?.mesa?.colorMantel, "#112233");
  const s = sillasDePieza(c.sillas!.pieza)!;
  assert.equal(s.colorEstructura, "#445566");
  assert.equal(s.colorCojin, "#778899");
  assert.throws(() => conjuntoDeMesaSalon({ tipo: "redonda8", sillas: 13, ids: { mesa: "m", sillas: "s" }, xCm: 0, zCm: 0, giroGrados: 0 }), /fuera de rango/);
  assert.throws(() => conjuntoDeMesaSalon({ tipo: "imperial", sillas: 9, ids: { mesa: "m", sillas: "s" }, xCm: 0, zCm: 0, giroGrados: 0 }), /número par/);
});

console.log(`test-salon-mesas-parametricas: ok (${pruebas} pruebas, ${casos.length} combinaciones tipo/sillas)`);
console.log("  NOTA: armar_salon (ponerElemento) todavía pone el mueble del catálogo con opciones.sillas; este conjunto es el núcleo puro, sin conectar.");
