/**
 * Deshacer, rehacer y aplicar un turno de la IA sin tirar lo hecho a mano (D-021), sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-deshacer-turno.ts
 * - sin nada después, deshacer el turno deja la escena exacta de antes;
 * - campo a campo: lo que la persona cambió después se conserva (y se dice) y lo demás vuelve;
 * - lo quitado vuelve a su sitio; lo sumado se va, salvo que algo que se queda dependa de ello (también si es de la IA);
 * - nunca queda una pieza colgada de un padre que no está (al deshacer, al aplicar y al rehacer);
 * - lo que se puede hacer HOY con un turno (deshacer, rehacer, bloqueado) sale de la escena, no de lo guardado;
 * - aplicar el turno cuando se editó a mano mientras la IA contestaba: solo lo que la persona no tocó, sin pisar ids;
 * - el historial global: UN paso, y Ctrl+Z lo revierte.
 */
import assert from "node:assert/strict";
import { aplicarDiff, aplicarTurno, textoAplicarTurno } from "../../src/lib/globos3d/aplicar-turno";
import { deshacerTurno, estadoDeTurno, textoDeshacerTurno } from "../../src/lib/globos3d/deshacer-turno";
import { diffEscenas, sonIguales } from "../../src/lib/globos3d/diff-escenas";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { historialCambiar, historialDeshacer, historialNuevo, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const conNodo = (e: Escena, id: string, cambio: (n: NodoEscena) => NodoEscena): Escena => ({ ...e, nodos: e.nodos.map((n) => (n.id === id ? cambio(n) : n)) });
const alto = (e: Escena, id: string, cm: number) => conNodo(e, id, (n) => (n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: cm } } : n));
const colores = (e: Escena, id: string, c: string[]) => conNodo(e, id, (n) => (n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, colores: c } } : n));
const colocar = (e: Escena, id: string, x: number) => conNodo(e, id, (n) => (n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, xCm: x } } : n));
const col = (e: Escena, id: string) => e.nodos.find((n) => n.id === id)!;
const altoDe = (e: Escena, id: string) => { const p = col(e, id).pieza; return p.tipo === "columna" ? p.alturaCm : -1; };
const coloresDe = (e: Escena, id: string) => { const p = col(e, id).pieza; return p.tipo === "columna" ? p.colores : []; };
const xDe = (e: Escena, id: string) => { const c = col(e, id).colocacion; return c.en === "piso" ? c.xCm : NaN; };
const hijoDe = (id: string, padreId: string): NodoEscena => ({ id, nombre: `Hijo ${id}`, pieza: { tipo: "decoracion", decoracion: "flor5" } as unknown as NodoEscena["pieza"], colocacion: { en: "ancla", padreId, ancla: 1, cada: 0, giroGrados: 0 } });
const sinHuerfanas = (e: Escena) => e.nodos.every((n) => !("padreId" in n.colocacion) || e.nodos.some((p) => "padreId" in n.colocacion && p.id === n.colocacion.padreId));

// El turno de la IA: columna izquierda a 2,2 m y dorada, quita la guirnalda y suma una columna nueva.
const turnoIA = (() => {
  const nueva: NodoEscena = { id: "columna-nueva", nombre: "Columna nueva", pieza: structuredClone(base.nodos[1]!.pieza), colocacion: { en: "piso", xCm: 0, zCm: 100, giroGrados: 0 } };
  const despues = colores(alto({ ...base, nodos: base.nodos.filter((n) => n.id !== "guirnalda") }, "columna-izq", 220), "columna-izq", ["570"]);
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

prueba("campo a campo: si moviste la columna, el alto y el color vuelven y el lugar se queda", () => {
  const r = deshacerTurno(colocar(turnoIA.despues, "columna-izq", -300), diff);
  assert.equal(altoDe(r.escena, "columna-izq"), 180);
  assert.deepEqual(coloresDe(r.escena, "columna-izq"), ["609", "005", "570", "010"]);
  assert.equal(xDe(r.escena, "columna-izq"), -300);
  assert.deepEqual(r.conservadas, [], "mover lo que la IA no tocó no es un conflicto");
  assert.ok(r.revertidas.includes("columna-izq"));
});

prueba("campo a campo: si cambiaste el color, el alto vuelve y el color se queda, diciendo cuál", () => {
  const r = deshacerTurno(colores(turnoIA.despues, "columna-izq", ["010"]), diff);
  assert.equal(altoDe(r.escena, "columna-izq"), 180);
  assert.deepEqual(coloresDe(r.escena, "columna-izq"), ["010"]);
  assert.deepEqual(r.conservadas.map((c) => [c.id, c.motivo, c.campos]), [["columna-izq", "editada", ["colores"]]]);
  assert.match(textoDeshacerTurno(r, "el turno 2"), /Conservé «Columna izquierda» \(colores\) como está: la editaste a mano después/);
});

prueba("lo que se hizo a mano en piezas que la IA no tocó queda intacto", () => {
  const r = deshacerTurno(colocar(turnoIA.despues, "columna-der", 180), diff);
  assert.equal(xDe(r.escena, "columna-der"), 180);
  assert.deepEqual(r.conservadas, []);
});

prueba("la pieza que la IA sumó se conserva si la editaste o si pusiste algo que cuelga de ella", () => {
  assert.deepEqual(deshacerTurno(colocar(turnoIA.despues, "columna-nueva", 50), diff).conservadas.map((c) => [c.id, c.motivo]), [["columna-nueva", "editada"]]);
  const conHijo = { ...turnoIA.despues, nodos: [...turnoIA.despues.nodos, hijoDe("flor", "columna-nueva")] };
  const r = deshacerTurno(conHijo, diff);
  assert.deepEqual(r.conservadas.map((c) => [c.id, c.motivo]), [["columna-nueva", "en_uso"]]);
  assert.ok(r.escena.nodos.some((n) => n.id === "flor"));
  assert.ok(sinHuerfanas(r.escena));
});

prueba("padre e hijo nuevos de la IA: si editaste el hijo, el padre también se queda (no hay hijos colgados)", () => {
  const padre: NodoEscena = { ...structuredClone(base.nodos[1]!), id: "padre-ia", nombre: "Padre IA" };
  const hijo = hijoDe("hijo-ia", "padre-ia");
  const despues = { ...base, nodos: [...base.nodos, padre, hijo] };
  const d = diffEscenas(base, despues);
  const editadoHijo = conNodo(despues, "hijo-ia", (n) => ({ ...n, nombre: "Mi flor" }));
  const r = deshacerTurno(editadoHijo, d);
  assert.ok(r.escena.nodos.some((n) => n.id === "padre-ia") && r.escena.nodos.some((n) => n.id === "hijo-ia"));
  assert.ok(sinHuerfanas(r.escena));
  assert.ok(r.conservadas.some((c) => c.id === "padre-ia" && c.motivo === "en_uso"));
  // Sin editar nada, los dos se van juntos.
  assert.ok(sonIguales(deshacerTurno(despues, d).escena, base));
});

prueba("lo que la IA quitó vuelve; si ya estaba de vuelta no se duplica; si la quitaste tú no resucita", () => {
  const vuelta = { ...turnoIA.despues, nodos: [...turnoIA.despues.nodos, structuredClone(base.nodos.find((n) => n.id === "guirnalda")!)] };
  assert.equal(deshacerTurno(vuelta, diff).escena.nodos.filter((n) => n.id === "guirnalda").length, 1);
  const sinCol = { ...turnoIA.despues, nodos: turnoIA.despues.nodos.filter((n) => n.id !== "columna-izq") };
  const r2 = deshacerTurno(sinCol, diff);
  assert.ok(!r2.escena.nodos.some((n) => n.id === "columna-izq"));
  assert.deepEqual(r2.conservadas.map((c) => [c.id, c.motivo]), [["columna-izq", "quitada"]]);
});

prueba("una pieza quitada por la IA no vuelve si el padre del que colgaba lo quitaste tú después", () => {
  const conHijo = { ...base, nodos: [...base.nodos, hijoDe("flor", "columna-izq")] };
  const despues = { ...conHijo, nodos: conHijo.nodos.filter((n) => n.id !== "flor") };
  const d = diffEscenas(conHijo, despues);
  const sinPadre = { ...despues, nodos: despues.nodos.filter((n) => n.id !== "columna-izq") };
  const r = deshacerTurno(sinPadre, d);
  assert.ok(!r.escena.nodos.some((n) => n.id === "flor"));
  assert.ok(sinHuerfanas(r.escena));
  assert.deepEqual(r.conservadas.map((c) => c.motivo), ["sin_padre"]);
});

prueba("la sala: vuelve si no la tocaste y se conserva si sí; el ambiente se normaliza como al leer una escena", () => {
  const conSala = { ...turnoIA.despues, sala: { ...turnoIA.despues.sala, anchoCm: 800 } };
  const d = diffEscenas(turnoIA.antes, conSala);
  assert.equal(deshacerTurno(conSala, d).escena.sala.anchoCm, base.sala.anchoCm);
  const manual = { ...conSala, sala: { ...conSala.sala, altoCm: 400 } };
  const r = deshacerTurno(manual, d);
  assert.equal(r.escena.sala.altoCm, 400);
  assert.deepEqual(r.conservadas.map((c) => c.motivo), ["sala"]);
  const rara = { ...base, sala: { ...base.sala, ambiente: { piso: "madera", basura: 1 } as unknown as NonNullable<Escena["sala"]["ambiente"]> } };
  const d2 = diffEscenas(rara, { ...rara, sala: { ...rara.sala, anchoCm: 900 } });
  const vuelta = deshacerTurno({ ...rara, sala: { ...rara.sala, anchoCm: 900 } }, d2).escena.sala.ambiente;
  assert.deepEqual(vuelta, { piso: "madera" });
});

prueba("si ya estaba todo deshecho no hay nada que hacer y la escena es la misma", () => {
  const r = deshacerTurno(turnoIA.antes, diff);
  assert.equal(r.escena, turnoIA.antes);
  assert.deepEqual(r.revertidas, []);
  assert.deepEqual(r.conservadas, []);
  assert.match(textoDeshacerTurno(r, "el turno 1"), /No había nada que deshacer/);
});

console.log("Qué se puede hacer hoy con un turno");
prueba("aplicado: se puede deshacer; tras Ctrl+Z (o el botón): se puede rehacer, y rehacer deja lo mismo", () => {
  assert.deepEqual(estadoDeTurno(turnoIA.despues, diff), { deshacible: true, rehacible: false, bloqueado: false });
  assert.deepEqual(estadoDeTurno(turnoIA.antes, diff), { deshacible: false, rehacible: true, bloqueado: false });
  const rehecha = aplicarDiff(turnoIA.antes, diff);
  assert.ok(sonIguales(rehecha.escena, turnoIA.despues));
  assert.equal(estadoDeTurno(rehecha.escena, diff).deshacible, true);
});
prueba("bloqueado: si lo único que cambió la IA lo cambiaste tú, no hay nada que deshacer (el botón no puede estar activo)", () => {
  const solo = diffEscenas(base, alto(base, "columna-izq", 220));
  const tuyo = alto(base, "columna-izq", 250);
  assert.deepEqual(estadoDeTurno(tuyo, solo), { deshacible: false, rehacible: false, bloqueado: true });
});
prueba("rehacer campo a campo: respeta lo que cambiaste mientras estaba deshecho", () => {
  const solo = diffEscenas(base, colores(alto(base, "columna-izq", 220), "columna-izq", ["570"]));
  const r = aplicarDiff(colores(base, "columna-izq", ["010"]), solo);
  assert.equal(altoDe(r.escena, "columna-izq"), 220);
  assert.deepEqual(coloresDe(r.escena, "columna-izq"), ["010"]);
  assert.deepEqual(r.conservadas.map((c) => c.campos), [["colores"]]);
});

console.log("Aplicar el turno");
prueba("si la escena no cambió mientras la IA contestaba, queda la respuesta tal cual", () => {
  const r = aplicarTurno(turnoIA.antes, turnoIA.antes, turnoIA.despues, diff);
  assert.equal(r.escena, turnoIA.despues);
  assert.deepEqual(r.conservadas, []);
  assert.equal(textoAplicarTurno(r.conservadas), null);
});

prueba("si moviste otra pieza mientras tanto, se aplica lo de la IA y se queda lo tuyo", () => {
  const r = aplicarTurno(colocar(turnoIA.antes, "columna-der", 180), turnoIA.antes, turnoIA.despues, diff);
  assert.deepEqual(r.conservadas, []);
  assert.equal(xDe(r.escena, "columna-der"), 180);
  assert.equal(altoDe(r.escena, "columna-izq"), 220);
  assert.ok(!r.escena.nodos.some((n) => n.id === "guirnalda") && r.escena.nodos.some((n) => n.id === "columna-nueva"));
});

prueba("si tocaste la misma pieza que la IA, gana lo tuyo solo en lo que tocaste y se dice", () => {
  const r = aplicarTurno(colores(turnoIA.antes, "columna-izq", ["010"]), turnoIA.antes, turnoIA.despues, diff);
  assert.deepEqual(r.conservadas.map((c) => [c.id, c.campos]), [["columna-izq", ["colores"]]]);
  assert.equal(altoDe(r.escena, "columna-izq"), 220);
  assert.deepEqual(coloresDe(r.escena, "columna-izq"), ["010"]);
  assert.match(textoAplicarTurno(r.conservadas) ?? "", /cambiaste «Columna izquierda» \(colores\): conservé lo tuyo/);
});

prueba("si quitaste a mano lo que la IA cambió, no resucita", () => {
  const manual = { ...turnoIA.antes, nodos: turnoIA.antes.nodos.filter((n) => n.id !== "columna-izq") };
  const r = aplicarTurno(manual, turnoIA.antes, turnoIA.despues, diff);
  assert.ok(!r.escena.nodos.some((n) => n.id === "columna-izq"));
  assert.deepEqual(r.conservadas.map((c) => c.motivo), ["quitada"]);
});

prueba("la IA quita una pieza y tú colgaste algo de ella mientras contestaba: la pieza se queda", () => {
  const manual = { ...turnoIA.antes, nodos: [...turnoIA.antes.nodos, hijoDe("mi-flor", "guirnalda")] };
  const r = aplicarTurno(manual, turnoIA.antes, turnoIA.despues, diff);
  assert.ok(r.escena.nodos.some((n) => n.id === "guirnalda"));
  assert.deepEqual(r.conservadas.map((c) => [c.id, c.motivo]), [["guirnalda", "en_uso"]]);
  assert.ok(sinHuerfanas(r.escena));
});

prueba("la IA suma algo que cuelga de una pieza que quitaste tú mientras contestaba: no queda colgado", () => {
  const conFlor = { ...turnoIA.despues, nodos: [...turnoIA.despues.nodos, hijoDe("flor-ia", "columna-der")] };
  const d = diffEscenas(turnoIA.antes, conFlor);
  const manual = { ...turnoIA.antes, nodos: turnoIA.antes.nodos.filter((n) => n.id !== "columna-der") };
  const r = aplicarTurno(manual, turnoIA.antes, conFlor, d);
  assert.ok(sinHuerfanas(r.escena));
  assert.ok(!r.escena.nodos.some((n) => n.id === "flor-ia"));
  assert.ok(r.conservadas.some((c) => c.id === "flor-ia" && c.motivo === "sin_padre"));
});

prueba("choque de ids: la pieza nueva de la IA no se pierde si tú creaste otra con el mismo id (y lo que cuelga de ella la sigue)", () => {
  const tuya: NodoEscena = { ...structuredClone(base.nodos[1]!), id: "columna-nueva", nombre: "Mi columna" };
  const manual = { ...turnoIA.antes, nodos: [...turnoIA.antes.nodos, tuya] };
  const conHija = { ...turnoIA.despues, nodos: [...turnoIA.despues.nodos, hijoDe("flor-ia", "columna-nueva")] };
  const d = diffEscenas(turnoIA.antes, conHija);
  const r = aplicarTurno(manual, turnoIA.antes, conHija, d);
  assert.equal(col(r.escena, "columna-nueva").nombre, "Mi columna");
  const suya = r.escena.nodos.find((n) => n.nombre === "Columna nueva");
  assert.ok(suya && suya.id !== "columna-nueva", "la de la IA tomó un id libre");
  const flor = col(r.escena, "flor-ia");
  assert.equal("padreId" in flor.colocacion ? flor.colocacion.padreId : null, suya.id);
  assert.ok(sinHuerfanas(r.escena));
  assert.ok(r.diff.nodos.some((c) => c.tipo === "nueva" && c.id === suya.id), "el turno guardado lleva el id nuevo (así se puede deshacer)");
  assert.ok(r.escena.nodos.length === new Set(r.escena.nodos.map((n) => n.id)).size, "sin ids repetidos");
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

console.log(`\n${pruebas} pruebas OK`);
