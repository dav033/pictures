/**
 * Lista de compra: helio y cinta (PRO-02). Sin coste. Las cifras de litros están calculadas a mano (esfera 4/3·π·r³, ×1,07).
 * - 10 globos de 30 cm con 7 % = 151,3 L (151,2677 sin redondear);
 * - los litros salen del diámetro INFLADO de cada globo (28 cm ≠ 30,5 cm del formato);
 * - flotan los globos de las partes de helio («helio» del techo, «ramo» del ramo de helio) y los que la fuente marca con
 *   `helio: true` (en la pieza o en el globo de una decoración), siempre que su formato flote;
 * - la cinta sale de la pieza (techo: cintaCm por globo; ramo: su alto) y si no, 1,2 m por globo;
 * - lo que la estimación no cuenta (foil) y que solo cuentan los marcados va en el aviso de la lista.
 * La cobertura de la biblioteca de fábrica (que ningún globo de helio quede sin marca) está en `test-helio-cobertura.ts`.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-helio-cinta.ts
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "../../src/lib/globos3d/biblioteca";
import { AVISO_ALCANCE_HELIO, avisoMetalizados, contarMetalizados, LITROS_POR_TANQUE, PERDIDA_HELIO, esGloboDeHelio, gruposDeHelio, muestraMarcaHelio, puedeFlotar, lineasHelio, litrosDeEsfera, litrosDeHelio, metrosCintaDePieza, resumenHelio } from "../../src/lib/globos3d/helio-cinta";
import { ESCENAS_PREDEFINIDAS } from "../../src/lib/globos3d/escenas-presets";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { armarPieza, type Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

console.log("Litros y tanques");
prueba("la pérdida es el 7 % y el tanque es una constante fija", () => {
  assert.equal(PERDIDA_HELIO, 0.07);
  assert.equal(LITROS_POR_TANQUE, 10000);
});
prueba("esfera de 30 cm = 14,137 L (4/3·π·15³ / 1000)", () => {
  assert.ok(Math.abs(litrosDeEsfera(30) - 14.1372) < 0.0001);
});
prueba("10 globos de 30 cm con 7 % de pérdida = 151,3 L (151,2677 a mano)", () => {
  assert.equal(litrosDeHelio(30, 10, 0.07), 151.3);
});
prueba("sin pérdida, 10 globos de 30 cm = 141,4 L", () => {
  assert.equal(litrosDeHelio(30, 10, 0), 141.4);
});
prueba("el resumen usa el diámetro INFLADO de cada globo: 10 globos de 30,5 cm = 159,0 L (158,9578 a mano)", () => {
  const r = resumenHelio([{ globos: Array.from({ length: 10 }, () => ({ formatoId: "R-12", infladoCm: 30.5, parte: "helio" })) }]);
  assert.ok(r);
  assert.equal(r.litros, 159);
  assert.equal(r.tanques, 1);
});
prueba("un R-12 inflado a 28 cm no se calcula con 30,5 cm: 1 globo = 12,3 L (12,2986 a mano)", () => {
  const r = resumenHelio([{ globos: [{ formatoId: "R-12", infladoCm: 28, parte: "helio" }] }]);
  assert.ok(r);
  assert.equal(r.filas[0]!.litros, 12.3);
});
prueba("varios tamaños: filas por tamaño inflado y total = suma de filas; los tanques suben con el total", () => {
  const grupos = [{ globos: [{ formatoId: "R-24", infladoCm: 55, parte: "ramo" }, { formatoId: "R-24", infladoCm: 55, parte: "ramo" }, { formatoId: "C-12", infladoCm: 28, parte: "helio" }] }];
  const r = resumenHelio(grupos);
  assert.ok(r);
  assert.equal(r.filas.length, 2);
  assert.equal(r.litros, Math.round((r.filas[0]!.litros + r.filas[1]!.litros) * 10) / 10);
  assert.equal(r.tanques, Math.ceil(r.litros / LITROS_POR_TANQUE));
  const enorme = resumenHelio([{ globos: Array.from({ length: 300 }, () => ({ formatoId: "R-24", infladoCm: 55, parte: "ramo" })) }]);
  // 300 × 87,13 L (esfera de 55 cm) × 1,07 ≈ 27 970 L → 3 tanques de 10 000 L.
  assert.equal(enorme!.tanques, 3);
});

console.log("Qué globo flota");
prueba("flota el de una parte de helio (techo o ramo) o el que la fuente marca; el de aire no", () => {
  assert.equal(esGloboDeHelio({ formatoId: "R-12", parte: "helio" }), true);
  assert.equal(esGloboDeHelio({ formatoId: "R-12", parte: "ramo" }), true);
  assert.equal(esGloboDeHelio({ formatoId: "R-12", parte: "globo", helio: true }), true);
  assert.equal(esGloboDeHelio({ formatoId: "C-12", helio: true }), true);
  assert.equal(esGloboDeHelio({ formatoId: "R-12", parte: "centro" }), false);
  assert.equal(esGloboDeHelio({ formatoId: "R-12" }), false);
});
prueba("un tubito o un Link-O-Loon no flota aunque lo marque su parte", () => {
  assert.equal(esGloboDeHelio({ formatoId: "T-260", parte: "helio" }), false);
  assert.equal(esGloboDeHelio({ formatoId: "LOL-12", parte: "helio" }), false);
});
prueba("la marca nace en el origen: una pieza globo con helio:true arma su globo con la marca y sigue siendo parte «globo»; sin marca, de aire", () => {
  const conMarca: Pieza = { tipo: "globo", formatoId: "R-12", infladoCm: 28, codigo: "080", helio: true };
  const sinMarca: Pieza = { tipo: "globo", formatoId: "R-12", infladoCm: 28, codigo: "080" };
  const flotante = armarPieza(conMarca).globos[0]!;
  assert.equal(flotante.helio, true);
  assert.equal(flotante.parte, "globo");
  assert.equal(esGloboDeHelio(flotante), true);
  assert.equal(armarPieza(sinMarca).globos[0]!.helio, undefined);
  assert.equal(esGloboDeHelio(armarPieza(sinMarca).globos[0]!), false);
});
prueba("Pieza.helio marca todos los globos de una pieza que flota entera (un cuarteto) y la marca llega a la escena armada", () => {
  const cuarteto: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 28, alturaCm: 28, patron: "un_color", colores: ["015"], helio: true };
  const armada = armarPieza(cuarteto);
  assert.ok(armada.globos.length >= 4);
  assert.ok(armada.globos.every((g) => g.helio === true));
  const escena = armarEscena({ sala: ESCENAS_PREDEFINIDAS[0]!.escena.sala, nodos: [{ id: "c", nombre: "Cuarteto", pieza: cuarteto, colocacion: { en: "libre", xCm: 0, yCm: 150, zCm: 0, giroGrados: 0 } }] });
  assert.equal(escena.globos.filter(esGloboDeHelio).length, armada.globos.length);
});
prueba("Pieza.helio en un globo dentro de globo marca el de fuera y no los de adentro (su volumen ya está en el exterior)", () => {
  const doble: Pieza = { tipo: "decoracion", helio: true, decoracion: { tipo: "burbuja", propiedades: { exterior: { formatoId: "R-12", infladoCm: 28, codigo: "390" }, interiores: [{ formatoId: "R-12", infladoCm: 26, codigos: ["481"], cantidad: 1 }], relleno: null, semilla: 1 } } };
  const armada = armarPieza(doble);
  assert.deepEqual(armada.globos.map((g) => [g.parte, g.helio === true]), [["exterior", true], ["interiores", false]]);
  assert.equal(resumenHelio([{ globos: armada.globos }])!.globos, 1);
});
prueba("en una decoración, ParteGlobo.helio marca solo ese globo: el exterior del globo dentro de globo, no el de adentro; y la calabaza y la figura", () => {
  const conExterior = armarPieza({ tipo: "decoracion", decoracion: { tipo: "burbuja", propiedades: { exterior: { formatoId: "R-12", infladoCm: 28, codigo: "390", helio: true }, interiores: [{ formatoId: "R-12", infladoCm: 26, codigos: ["481"], cantidad: 1 }], relleno: null, semilla: 1 } } });
  assert.deepEqual(conExterior.globos.map((g) => [g.parte, g.helio === true]), [["exterior", true], ["interiores", false]]);
  const calabaza = armarPieza({ tipo: "decoracion", decoracion: { tipo: "calabaza", propiedades: { globo: { formatoId: "R-12", infladoCm: 28, codigo: "061", helio: true }, cara: { hex: "#141414" }, tallo: null } } });
  assert.equal(calabaza.globos.filter(esGloboDeHelio).length, 1);
  assert.equal(calabaza.globos[0]!.parte, "calabaza");
  const figura = armarPieza({ tipo: "decoracion", decoracion: { tipo: "figura", propiedades: { postura: "de_pie", base: [], piernas: null, cuerpo: [{ tipo: "globo", globo: { formatoId: "R-12", infladoCm: 28, codigo: "012", helio: true } }], cuello: null, cabeza: null, brazos: null, accesorios: [], queEs: "a balloon" } } });
  assert.equal(figura.globos.filter(esGloboDeHelio).length, 1);
});
prueba("la casilla «Flota con helio» sale en lo que puede flotar y en lo ya marcado: nunca cuenta helio una pieza cuya casilla no se ve", () => {
  const globo = (formatoId: string, helio?: true): Pieza => ({ tipo: "globo", formatoId, infladoCm: 25, codigo: "015", ...(helio ? { helio } : {}) });
  const columna = (alturaCm: number, helio?: true): Pieza => ({ tipo: "columna", formatoId: "R-12", infladoCm: 28, alturaCm, patron: "un_color", colores: ["015"], ...(helio ? { helio } : {}) });
  assert.equal(puedeFlotar(globo("R-12")), true);
  assert.equal(puedeFlotar(columna(28)), true, "un cuarteto flota");
  assert.equal(puedeFlotar(columna(180)), false, "una columna no");
  assert.equal(puedeFlotar(globo("LOL-12")), false, "un Link-O-Loon no");
  assert.equal(muestraMarcaHelio(globo("R-12")), true);
  assert.equal(muestraMarcaHelio(columna(180)), false);
  // El caso del defecto: se marca un cuarteto y luego se estira a columna (o se cambia de formato): sigue contando, así que su casilla sigue a la vista.
  for (const marcada of [columna(180, true), globo("LOL-12", true)]) {
    assert.equal(armarPieza(marcada).globos.every((g) => g.helio === true), true);
    assert.equal(muestraMarcaHelio(marcada), true, `${marcada.tipo} marcada`);
  }
  assert.equal(armarPieza(columna(180, true)).globos.filter(esGloboDeHelio).length > 4, true, "la columna marcada cuenta sus globos");
  assert.equal(puedeFlotar({ tipo: "decoracion", decoracion: { tipo: "ramo_helio", propiedades: { globos: [], alturaCm: 100, cinta: { hex: "#fff" }, peso: { hex: "#000" } } } }), false, "el ramo de helio ya lo es por su parte");
});
prueba("sin globos de helio no hay resumen ni líneas de texto", () => {
  assert.equal(resumenHelio([{ globos: [{ formatoId: "R-12", infladoCm: 25, parte: "centro" }, { formatoId: "R-5", infladoCm: 12 }] }]), null);
  assert.deepEqual(lineasHelio(null), []);
});

console.log("Cinta");
prueba("el techo pone su cintaCm por globo: 12 globos con 120 cm = 14,4 m", () => {
  const techo: Pieza = { tipo: "techo", techo: { elementos: [{ tipo: "helio", puntos: Array.from({ length: 12 }, (_, k) => ({ xCm: k, zCm: 0 })), globo: { formatoId: "R-12", infladoCm: 28 }, codigos: ["011"], cintaCm: 120, cintaHex: "#f2f2f2" }] } } as Pieza;
  assert.equal(metrosCintaDePieza(techo, 12), 14.4);
});
prueba("el ramo de helio pone su alto (280 cm) por globo: 3 globos = 8,4 m", () => {
  const ramo: Pieza = { tipo: "decoracion", decoracion: { tipo: "ramo_helio", propiedades: { globos: [], alturaCm: 280, cinta: { hex: "#fff" }, peso: { hex: "#000" } } } } as Pieza;
  assert.equal(metrosCintaDePieza(ramo, 3), 8.4);
});
prueba("sin cinta en la pieza: 1,2 m por globo de helio", () => {
  const r = resumenHelio([{ globos: Array.from({ length: 5 }, () => ({ formatoId: "R-12", infladoCm: 28, parte: "helio" })) }]);
  assert.equal(r!.metrosCinta, 6);
});
prueba("la cinta de la pieza gana sobre el valor por defecto en el total", () => {
  const r = resumenHelio([{ globos: Array.from({ length: 5 }, () => ({ formatoId: "R-12", infladoCm: 28, parte: "helio" })), metrosCinta: 14.4 }]);
  assert.equal(r!.metrosCinta, 14.4);
});

console.log("Texto copiado");
prueba("el texto lleva las filas, el aviso de estimación y el tanque nominal", () => {
  const lineas = lineasHelio(resumenHelio([{ globos: [{ formatoId: "R-12", infladoCm: 28, parte: "helio" }, { formatoId: "R-12", infladoCm: 28, parte: "helio" }] }]));
  assert.equal(lineas[1], "HELIO Y CINTA (estimación)");
  assert.ok(lineas.some((l) => l.startsWith("2 × R-12 a 28 cm: 24,6 L")));
  assert.ok(lineas.some((l) => l.includes("10.000 L nominales") && l.includes("confirmar con el proveedor")));
});
prueba("el texto y la pantalla dicen lo que no cuenta: los foil, el doble globo y que solo cuentan los marcados", () => {
  const lineas = lineasHelio(resumenHelio([{ globos: [{ formatoId: "R-12", infladoCm: 28, helio: true }] }]));
  assert.ok(lineas.includes(AVISO_ALCANCE_HELIO));
  assert.match(AVISO_ALCANCE_HELIO, /metalizados \(foil\)/);
  assert.match(AVISO_ALCANCE_HELIO, /globo dentro de globo/);
  assert.match(AVISO_ALCANCE_HELIO, /marcados como de helio/);
});

console.log("Metalizados (foil)");
const escenaDeIdea = (id: string) => escenaDeItem(BIBLIOTECA_FABRICA.find((x) => x.id === id) ?? assert.fail(id));
prueba("una escena de helio solo de foil no tiene litros de látex pero sí su aviso (bouquet regalo de cumpleaños: 2 metalizados)", () => {
  const escena = escenaDeIdea("idea:bouquet-regalo-de-cumpleano");
  const armada = armarEscena(escena);
  assert.equal(resumenHelio(gruposDeHelio(escena.nodos, armada.porNodo)), null);
  const foil = contarMetalizados(escena.nodos, armada.porNodo);
  assert.equal(foil, 2);
  assert.match(avisoMetalizados(foil), /^La escena lleva 2 piezas metalizadas \(foil\): se llenan con helio .* no entran en estos litros/);
  assert.match(avisoMetalizados(1), /^La escena lleva 1 pieza metalizada \(foil\)/);
});
prueba("sin metalizados no hay aviso; una pieza repetida en varias anclas cuenta cada copia", () => {
  const sin = escenaDeIdea("idea:columna-rellena");
  assert.equal(contarMetalizados(sin.nodos, armarEscena(sin).porNodo), 0);
  const nodos = [{ id: "a", pieza: { tipo: "metalizado" } as Pieza }, { id: "b", pieza: { tipo: "globo" } as Pieza }];
  assert.equal(contarMetalizados(nodos, [{ id: "a", copias: 3 }, { id: "b", copias: 1 }]), 3);
});

console.log("Escena armada");
prueba("el preset de Halloween con ramo de helio: 9 globos y su cinta de 280 cm = 25,2 m (la pieza la dice)", () => {
  const preset = ESCENAS_PREDEFINIDAS.find((p) => p.id === "halloween_marco_mesas");
  assert.ok(preset);
  const armada = armarEscena(preset.escena);
  const r = resumenHelio(gruposDeHelio(preset.escena.nodos, armada.porNodo));
  assert.ok(r);
  assert.equal(r.globos, 9);
  assert.equal(r.metrosCinta, 25.2);
});

console.log(`${pruebas} pruebas en verde`);
