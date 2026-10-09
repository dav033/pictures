/**
 * Deshacer un turno de la IA sin tirar lo hecho a mano (D-021), sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-deshacer-turno.ts
 * - sin nada después, deshacer el turno deja la escena exacta de antes;
 * - lo que se tocó a mano después se conserva (y se dice); lo demás de la IA vuelve;
 * - lo quitado vuelve a su sitio; lo sumado se va, salvo que algo nuevo dependa de ello;
 * - el historial global: UN paso, y Ctrl+Z lo revierte;
 * - aplicar el turno cuando se editó a mano mientras la IA contestaba: solo se aplica lo que no tocó la persona.
 * - aplicar el turno cuando la persona editó a mano mientras la IA contestaba: solo se aplica lo que no tocó ella.
 */
import assert from "node:assert/strict";
import { aplicarTurno, textoAplicarTurno } from "../../src/lib/globos3d/aplicar-turno";
import { deshacerTurno, textoDeshacerTurno } from "../../src/lib/globos3d/deshacer-turno";
import { diffEscenas, sonIguales } from "../../src/lib/globos3d/diff-escenas";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { historialCambiar, historialDeshacer, historialNuevo, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const conNodo = (e: Escena, id: string, cambio: (n: NodoEscena) => NodoEscena): Escena => ({ ...e, nodos: e.nodos.map((n) => (n.id === id ? cambio(n) : n)) });
const alto = (e: Escena, id: string, cm: number) => conNodo(e, id, (n) => (n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: cm } } : n));
const colocar = (e: Escena, id: string, x: number) => conNodo(e, id, (n) => (n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, xCm: x } } : n));

// El turno de la IA: columna izquierda a 2,2 m, quita la guirnalda y suma una columna nueva.
const turnoIA = (() => {
  const nueva: NodoEscena = { id: "columna-nueva", nombre: "Columna nueva", pieza: structuredClone(base.nodos[1]!.pieza), colocacion: { en: "piso", xCm: 0, zCm: 100, giroGrados: 0 } };
  const despues = alto({ ...base, nodos: base.nodos.filter((n) => n.id !== "guirnalda") }, "columna-izq", 220);
  return { antes: base, despues: { ...despues, nodos: [...despues.nodos, nueva] } };
})();
const diff = diffEscenas(turnoIA.antes, turnoIA.despues);

console.log("Deshacer turno");
prueba("sin cambios después: la escena vuelve a ser la de antes, pieza por pieza y en su orden", () => {
  const r = deshacerTurno(turnoIA.despues, diff);
  assert.ok(sonIguales(r.escena, turnoIA.antes));
  assert.deepEqual(r.escena.nodos.map((n) => n.id), turnoIA.antes.nodos.map((n) => n.id));
  assert.deepEqual(r.conservadas, []);
  assert.deepEqual([...r.revertidas].sort(), ["columna-izq", "columna-nueva", "guirnalda"]);
});

prueba("una pieza que la IA cambió y tú moviste después se conserva como la dejaste", () => {
  const manual = colocar(turnoIA.despues, "columna-izq", -300);
  const r = deshacerTurno(manual, diff);
  assert.equal(r.conservadas.length, 1);
  assert.deepEqual([r.conservadas[0]!.id, r.conservadas[0]!.motivo], ["columna-izq", "editada"]);
  const col = r.escena.nodos.find((n) => n.id === "columna-izq")!;
  assert.equal(col.pieza.tipo === "columna" ? col.pieza.alturaCm : 0, 220, "sigue como la dejó la IA, con tu cambio");
  assert.equal(col.colocacion.en === "piso" ? col.colocacion.xCm : 0, -300);
  assert.ok(r.escena.nodos.some((n) => n.id === "guirnalda"), "lo quitado por la IA vuelve");
  assert.ok(!r.escena.nodos.some((n) => n.id === "columna-nueva"), "lo sumado por la IA se va");
  assert.match(textoDeshacerTurno(r, "el turno 2"), /Conservé «Columna izquierda» como está: la editaste a mano después/);
});

prueba("lo que se hizo a mano en piezas que la IA no tocó queda intacto", () => {
  const manual = colocar(turnoIA.despues, "columna-der", 180);
  const r = deshacerTurno(manual, diff);
  const der = r.escena.nodos.find((n) => n.id === "columna-der")!;
  assert.equal(der.colocacion.en === "piso" ? der.colocacion.xCm : 0, 180);
  assert.deepEqual(r.conservadas, []);
});

prueba("la pieza que la IA sumó se conserva si tú la editaste o si pusiste algo que cuelga de ella", () => {
  const editada = colocar(turnoIA.despues, "columna-nueva", 50);
  assert.deepEqual(deshacerTurno(editada, diff).conservadas.map((c) => [c.id, c.motivo]), [["columna-nueva", "editada"]]);
  const hijo: NodoEscena = { id: "flor", nombre: "Flor", pieza: { tipo: "decoracion", decoracion: "flor5" } as unknown as NodoEscena["pieza"], colocacion: { en: "ancla", padreId: "columna-nueva", ancla: 1, cada: 0, giroGrados: 0 } };
  const conHijo = { ...turnoIA.despues, nodos: [...turnoIA.despues.nodos, hijo] };
  const r = deshacerTurno(conHijo, diff);
  assert.deepEqual(r.conservadas.map((c) => [c.id, c.motivo]), [["columna-nueva", "en_uso"]]);
  assert.ok(r.escena.nodos.some((n) => n.id === "flor"));
});

prueba("lo que la IA quitó y tú ya volviste a poner no se duplica; lo que quitaste a mano no resucita", () => {
  const vuelta = { ...turnoIA.despues, nodos: [...turnoIA.despues.nodos, structuredClone(base.nodos.find((n) => n.id === "guirnalda")!)] };
  const r1 = deshacerTurno(vuelta, diff);
  assert.equal(r1.escena.nodos.filter((n) => n.id === "guirnalda").length, 1);
  const sinCol = { ...turnoIA.despues, nodos: turnoIA.despues.nodos.filter((n) => n.id !== "columna-izq") };
  const r2 = deshacerTurno(sinCol, diff);
  assert.ok(!r2.escena.nodos.some((n) => n.id === "columna-izq"));
  assert.deepEqual(r2.conservadas.map((c) => [c.id, c.motivo]), [["columna-izq", "quitada"]]);
});

prueba("la sala: vuelve si no la tocaste, se conserva si sí", () => {
  const conSala = { ...turnoIA.despues, sala: { ...turnoIA.despues.sala, anchoCm: 800 } };
  const d = diffEscenas(turnoIA.antes, conSala);
  assert.equal(deshacerTurno(conSala, d).escena.sala.anchoCm, base.sala.anchoCm);
  const manual = { ...conSala, sala: { ...conSala.sala, altoCm: 400 } };
  const r = deshacerTurno(manual, d);
  assert.equal(r.escena.sala.altoCm, 400);
  assert.deepEqual(r.conservadas.map((c) => c.motivo), ["sala"]);
});

prueba("si ya estaba todo deshecho no hay nada que hacer y la escena es la misma", () => {
  const r = deshacerTurno(turnoIA.antes, diff);
  assert.equal(r.escena, turnoIA.antes);
  assert.deepEqual(r.revertidas, []);
  assert.match(textoDeshacerTurno(r, "el turno 1"), /No había nada que deshacer/);
});

console.log("Historial global");
prueba("Deshacer turno es UN paso del historial; Ctrl+Z lo deshace y deja la escena anterior", () => {
  let h = historialNuevo(turnoIA.antes);
  h = historialCambiar(h, turnoIA.despues);
  const conMano = colocar(turnoIA.despues, "columna-izq", -300);
  h = historialCambiar(h, conMano);
  const pasosAntes = h.pasado.length;
  h = historialCambiar(h, deshacerTurno(h.presente, diff).escena);
  assert.equal(h.pasado.length, pasosAntes + 1);
  assert.ok(sonIguales(historialDeshacer(h).presente, conMano));
});

console.log("Aplicar el turno");
prueba("si la escena no cambió mientras la IA contestaba, queda la respuesta tal cual", () => {
  const r = aplicarTurno(turnoIA.antes, turnoIA.antes, turnoIA.despues, diff);
  assert.equal(r.escena, turnoIA.despues);
  assert.deepEqual(r.conservadas, []);
  assert.equal(textoAplicarTurno(r.conservadas), null);
});

prueba("si moviste otra pieza mientras tanto, se aplica lo de la IA y se queda lo tuyo", () => {
  const manual = colocar(turnoIA.antes, "columna-der", 180);
  const r = aplicarTurno(manual, turnoIA.antes, turnoIA.despues, diff);
  assert.deepEqual(r.conservadas, []);
  const der = r.escena.nodos.find((n) => n.id === "columna-der")!;
  assert.equal(der.colocacion.en === "piso" ? der.colocacion.xCm : 0, 180);
  const izq = r.escena.nodos.find((n) => n.id === "columna-izq")!;
  assert.equal(izq.pieza.tipo === "columna" ? izq.pieza.alturaCm : 0, 220);
  assert.ok(!r.escena.nodos.some((n) => n.id === "guirnalda") && r.escena.nodos.some((n) => n.id === "columna-nueva"));
});

prueba("si tocaste la misma pieza que la IA, gana lo tuyo y se dice", () => {
  const manual = colocar(turnoIA.antes, "columna-izq", -300);
  const r = aplicarTurno(manual, turnoIA.antes, turnoIA.despues, diff);
  assert.deepEqual(r.conservadas.map((c) => [c.id, c.motivo]), [["columna-izq", "editada"]]);
  const izq = r.escena.nodos.find((n) => n.id === "columna-izq")!;
  assert.deepEqual([izq.pieza.tipo === "columna" ? izq.pieza.alturaCm : 0, izq.colocacion.en === "piso" ? izq.colocacion.xCm : 0], [180, -300]);
  assert.match(textoAplicarTurno(r.conservadas) ?? "", /cambiaste «Columna izquierda»: conservé lo tuyo/);
});

prueba("si quitaste a mano lo que la IA cambió, no resucita", () => {
  const manual = { ...turnoIA.antes, nodos: turnoIA.antes.nodos.filter((n) => n.id !== "columna-izq") };
  const r = aplicarTurno(manual, turnoIA.antes, turnoIA.despues, diff);
  assert.ok(!r.escena.nodos.some((n) => n.id === "columna-izq"));
  assert.deepEqual(r.conservadas.map((c) => c.motivo), ["quitada"]);
});

console.log(`\n${pruebas} pruebas OK`);
