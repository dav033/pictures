/**
 * Editor solitario y menú contextual de la escena (pestaña Escena del taller 3D). Sin coste: no llama a ninguna IA.
 * - `abrirSolitario`: solo la estructura y sus decoraciones (colgadas, sobre ella y pegadas), con sus ids, la raíz en
 *   el origen;
 * - `aplicarSolitario`: sin cambios deja la escena idéntica; con la pieza cambiada (alto y colores) la raíz queda en su
 *   mismo sitio y colocación y las decoraciones intactas; lo suelto que se movió en el editor vuelve corrido lo mismo
 *   en el marco de la raíz (también con la raíz girada); lo quitado se quita y lo duplicado entra con id nuevo y con su
 *   padre; lo que no era del conjunto no cambia;
 * - `eliminarPieza` con y sin decoraciones; `duplicarPieza` copia la estructura CON sus decoraciones (o una decoración
 *   sola a la ancla siguiente); `estructuraQueSostiene` e `infoMenuPieza`.
 */
import assert from "node:assert/strict";
import { armarEscena, duplicarNodo, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { decoracionPredefinida } from "../../src/lib/globos3d/figuras";
import type { PiezaArmada } from "../../src/lib/globos3d/piezas";
import {
  abrirSolitario, aplicarSolitario, decoracionesDe, duplicarPieza, eliminarPieza, estructuraQueSostiene, infoMenuPieza, solitarioCambio,
} from "../../src/lib/globos3d/editor-solitario";

const cache = new Map<string, PiezaArmada>();
const armar = (e: Escena) => armarEscena(e, cache);
const nodo = (e: Escena, id: string): NodoEscena => { const n = e.nodos.find((x) => x.id === id); assert.ok(n, `está ${id}`); return n; };
const cerca = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** La escena de la prueba manual (arco orgánico con dos columnas y guirnalda) con decoraciones en la columna izquierda. */
function escenaDePrueba(giroColumna = 0): Escena {
  const base = escenaPredefinida("arco_organico_columnas_guirnalda");
  base.nodos = base.nodos.map((n) => (n.id === "columna-izq" && n.colocacion.en === "piso" ? { ...n, colocacion: { ...n.colocacion, giroGrados: giroColumna } } : n));
  const armada = armar(base);
  const caja = armada.porNodo.find((n) => n.id === "columna-izq")!.caja;
  const cx = (caja.min.x + caja.max.x) / 2, cz = (caja.min.z + caja.max.z) / 2;
  const flor = (id: string, nombre: string, colocacion: NodoEscena["colocacion"]): NodoEscena => ({ id, nombre, pieza: { tipo: "decoracion", decoracion: decoracionPredefinida("flor5") }, colocacion });
  return {
    ...base,
    nodos: [
      ...base.nodos,
      flor("flores", "Flores en la columna", { en: "ancla", padreId: "columna-izq", ancla: 0, cada: 6, giroGrados: 0 }),
      flor("sobre-1", "Flor sobre la columna", { en: "sobre", padreId: "columna-izq", puntoCm: { x: 0, y: 120, z: 20 }, normal: { x: 0, y: 0, z: 1 }, giroGrados: 0 }),
      // Suelta, pegada a los globos del frente de la columna (a la altura de 1 m).
      flor("pegada", "Flor pegada", { en: "libre", xCm: cx, yCm: 100, zCm: cz + (caja.max.z - caja.min.z) / 2 - 2, giroGrados: 0 }),
      // Una que no es de la columna (en la pared del fondo, lejos): no entra al editor.
      flor("otra", "Flor en la pared", { en: "pared", pared: "fondo", aLoLargoCm: 200, alturaCm: 150 }),
    ],
  };
}

// 1. Lo del menú: decoraciones, quién sostiene a quién.
{
  const escena = escenaDePrueba();
  const armada = armar(escena);
  assert.deepEqual(decoracionesDe(escena, "columna-izq", armada).sort(), ["flores", "pegada", "sobre-1"], "la columna lleva sus tres decoraciones (colgada, sobre y pegada)");
  assert.deepEqual(decoracionesDe(escena, "columna-der", armada), [], "la otra columna no lleva ninguna");
  assert.equal(estructuraQueSostiene(escena, "flores", armada), "columna-izq", "la colgada la sostiene la columna");
  assert.equal(estructuraQueSostiene(escena, "sobre-1", armada), "columna-izq", "la que va sobre ella también");
  assert.equal(estructuraQueSostiene(escena, "pegada", armada), "columna-izq", "y la pegada a sus globos");
  assert.equal(estructuraQueSostiene(escena, "otra", armada), null, "la de la pared no cuelga de nada");
  assert.equal(estructuraQueSostiene(escena, "columna-izq", armada), null, "una estructura no es una decoración colgada");
  const info = infoMenuPieza(escena, "flores", armada);
  assert.deepEqual(info.sostiene, { id: "columna-izq", nombre: nodo(escena, "columna-izq").nombre }, "el menú de la flor ofrece editar la columna");
  assert.equal(infoMenuPieza(escena, "columna-izq", armada).decoraciones.length, 3, "el menú de la columna cuenta 3 decoraciones");
}

// 2. Abrir el editor solitario.
{
  const escena = escenaDePrueba();
  const armada = armar(escena);
  const sol = abrirSolitario(escena, "columna-izq", armada, cache);
  assert.ok(sol);
  assert.deepEqual([...sol.miembros].sort(), ["columna-izq", "flores", "pegada", "sobre-1"], "solo la columna y sus decoraciones, con sus ids");
  assert.deepEqual(nodo(sol.escena, "columna-izq").colocacion, { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 }, "la raíz va al origen (centrada)");
  assert.equal(nodo(sol.escena, "flores").colocacion.en, "ancla", "lo colgado sigue colgado de ella");
  assert.equal(nodo(sol.escena, "pegada").colocacion.en, "libre", "lo pegado va suelto, junto a ella");
  assert.equal(sol.escena.sala.mostrar.laterales, false, "sin paredes laterales");
  // Lo pegado queda pegado en la vista solitaria: igual de cerca de la columna.
  const vista = armar(sol.escena);
  assert.ok(vista.porNodo.every((n) => n.copias > 0 && n.avisos.length === 0), "todo se arma en el editor");
  assert.equal(abrirSolitario(escena, "no-esta", armada), null, "una pieza que no está no abre nada");
  assert.equal(solitarioCambio(sol, sol.escena), false, "recién abierto no hay cambios");

  // 3. «Listo» sin cambios: la escena queda idéntica.
  assert.deepEqual(aplicarSolitario(escena, sol, structuredClone(sol.escena), cache), escena, "sin cambios, nada cambia");

  // 4. Alto y colores de la columna: mismo sitio, decoraciones intactas, lo demás igual.
  const editada: Escena = structuredClone(sol.escena);
  const raiz = nodo(editada, "columna-izq");
  assert.equal(raiz.pieza.tipo, "columna");
  if (raiz.pieza.tipo === "columna") raiz.pieza = { ...raiz.pieza, alturaCm: raiz.pieza.alturaCm + 40, colores: raiz.pieza.colores.map(() => "009") };
  raiz.nombre = "Columna izquierda alta";
  assert.equal(solitarioCambio(sol, editada), true);
  const aplicada = aplicarSolitario(escena, sol, editada, cache);
  const col = nodo(aplicada, "columna-izq"), antes = nodo(escena, "columna-izq");
  assert.deepEqual(col.colocacion, antes.colocacion, "la columna queda en su MISMO sitio y colocación");
  assert.equal(col.nombre, "Columna izquierda alta");
  assert.ok(col.pieza.tipo === "columna" && antes.pieza.tipo === "columna" && col.pieza.alturaCm === antes.pieza.alturaCm + 40, "más alta");
  assert.ok(col.pieza.tipo === "columna" && col.pieza.colores.every((c) => c === "009"), "con sus colores nuevos");
  assert.deepEqual(aplicada.nodos.map((n) => n.id), escena.nodos.map((n) => n.id), "los mismos nodos en el mismo orden");
  for (const id of ["flores", "sobre-1", "pegada", "otra", "arco", "columna-der", "guirnalda"]) assert.deepEqual(nodo(aplicada, id), nodo(escena, id), `${id} queda idéntico`);
  const armadaAplicada = armar(aplicada);
  assert.ok(armadaAplicada.porNodo.find((n) => n.id === "columna-izq")!.globos.length > armada.porNodo.find((n) => n.id === "columna-izq")!.globos.length, "la columna tiene más globos");
  assert.equal(armadaAplicada.porNodo.find((n) => n.id === "flores")!.copias >= armada.porNodo.find((n) => n.id === "flores")!.copias, true, "las flores siguen colgadas (y en una columna más alta caben las mismas o más)");

  // 5. Mover la pegada 10 cm a la derecha en el editor: en la escena se corre lo mismo (raíz sin giro).
  const movida: Escena = structuredClone(sol.escena);
  const p = nodo(movida, "pegada");
  if (p.colocacion.en === "libre") p.colocacion = { ...p.colocacion, xCm: p.colocacion.xCm + 10 };
  const conMovida = aplicarSolitario(escena, sol, movida, cache);
  const c0 = nodo(escena, "pegada").colocacion, c1 = nodo(conMovida, "pegada").colocacion;
  assert.ok(c0.en === "libre" && c1.en === "libre" && cerca(c1.xCm, c0.xCm + 10) && cerca(c1.yCm, c0.yCm) && cerca(c1.zCm, c0.zCm) && cerca(c1.giroGrados, c0.giroGrados), "la pegada se corre 10 cm a la derecha");

  // 6. Quitar la de «sobre» y duplicar las flores colgadas dentro del editor.
  let cambios: Escena = structuredClone(sol.escena);
  cambios = { ...cambios, nodos: cambios.nodos.filter((n) => n.id !== "sobre-1") };
  cambios = duplicarNodo(cambios, "flores");
  const nueva = cambios.nodos.find((n) => !sol.escena.nodos.some((x) => x.id === n.id))!;
  const conCambios = aplicarSolitario(escena, sol, cambios, cache);
  assert.ok(!conCambios.nodos.some((n) => n.id === "sobre-1"), "la quitada en el editor se quita");
  const copias = conCambios.nodos.filter((n) => !escena.nodos.some((x) => x.id === n.id));
  assert.equal(copias.length, 1, "la duplicada entra");
  assert.ok(copias[0]!.colocacion.en === "ancla" && copias[0]!.colocacion.padreId === "columna-izq", "colgada de la columna");
  assert.equal(new Set(conCambios.nodos.map((n) => n.id)).size, conCambios.nodos.length, "ningún id repetido");
  assert.equal(copias[0]!.pieza.tipo, nueva.pieza.tipo);
  assert.deepEqual(nodo(conCambios, "otra"), nodo(escena, "otra"), "lo que no era del conjunto no cambia");
}

// 7. Con la columna girada 90°: lo movido en el editor se lleva girado a la escena.
{
  const escena = escenaDePrueba(90);
  const armada = armar(escena);
  const sol = abrirSolitario(escena, "columna-izq", armada, cache)!;
  assert.ok(sol.miembros.includes("pegada"), "la pegada entra también con la columna girada");
  assert.deepEqual(aplicarSolitario(escena, sol, structuredClone(sol.escena), cache), escena, "sin cambios, nada cambia (girada)");
  const movida: Escena = structuredClone(sol.escena);
  const p = nodo(movida, "pegada");
  if (p.colocacion.en === "libre") p.colocacion = { ...p.colocacion, xCm: p.colocacion.xCm + 10, giroGrados: p.colocacion.giroGrados + 15 };
  const c0 = nodo(escena, "pegada").colocacion, c1 = nodo(aplicarSolitario(escena, sol, movida, cache), "pegada").colocacion;
  // giroY(90°) lleva +x local a −z del mundo.
  assert.ok(c0.en === "libre" && c1.en === "libre", "sigue suelta");
  if (c0.en === "libre" && c1.en === "libre") {
    assert.ok(cerca(c1.xCm, c0.xCm) && cerca(c1.zCm, c0.zCm - 10) && cerca(c1.yCm, c0.yCm), `corrida 10 cm en el marco de la columna (${JSON.stringify(c0)} → ${JSON.stringify(c1)})`);
    assert.ok(cerca(c1.giroGrados, c0.giroGrados + 15), "y girada 15° más");
  }
}

// 8. Eliminar con y sin decoraciones.
{
  const escena = escenaDePrueba();
  const armada = armar(escena);
  const con = eliminarPieza(escena, "columna-izq", { conDecoraciones: true, armada });
  assert.deepEqual(con.nodos.map((n) => n.id), ["arco", "columna-der", "guirnalda", "otra"], "con sus decoraciones: se va todo el conjunto");
  const sin = eliminarPieza(escena, "columna-izq", { conDecoraciones: false, armada });
  assert.deepEqual(sin.nodos.map((n) => n.id), ["arco", "columna-der", "guirnalda", "flores", "sobre-1", "pegada", "otra"], "sin ellas: solo la columna");
  assert.equal(nodo(sin, "flores").colocacion.en, "piso", "lo colgado pasa al piso (como Supr)");
  assert.deepEqual(nodo(sin, "pegada"), nodo(escena, "pegada"), "lo pegado se queda donde estaba");
  assert.equal(eliminarPieza(escena, "no-esta", { conDecoraciones: true, armada }), escena, "una que no está: nada");
}

// 9. Duplicar: la estructura con sus decoraciones; una decoración, sola.
{
  const escena = escenaDePrueba();
  const armada = armar(escena);
  const r = duplicarPieza(escena, "columna-izq", armada, cache);
  assert.ok(r.id && r.id !== "columna-izq");
  const nuevos = r.escena.nodos.filter((n) => !escena.nodos.some((x) => x.id === n.id));
  assert.equal(nuevos.length, 4, "la columna y sus tres decoraciones");
  const copia = nodo(r.escena, r.id);
  const original = nodo(escena, "columna-izq");
  assert.ok(copia.colocacion.en === "piso" && original.colocacion.en === "piso" && copia.colocacion.xCm === original.colocacion.xCm + 60, "60 cm a un lado");
  assert.ok(copia.nombre.endsWith("(copia)"));
  assert.ok(nuevos.filter((n) => n.colocacion.en === "ancla" || n.colocacion.en === "sobre").every((n) => (n.colocacion.en === "ancla" || n.colocacion.en === "sobre") && n.colocacion.padreId === r.id), "lo colgado cuelga de la copia");
  const armadaR = armar(r.escena);
  const globos = (ids: readonly string[]) => armadaR.porNodo.filter((n) => ids.includes(n.id)).reduce((s, n) => s + n.globos.length, 0);
  assert.equal(globos(nuevos.map((n) => n.id)), globos(["columna-izq", "flores", "sobre-1", "pegada"]), "la copia tiene los mismos globos que el original");
  const deco = duplicarPieza(escena, "flores", armada, cache);
  const nueva = nodo(deco.escena, deco.id!);
  assert.ok(nueva.colocacion.en === "ancla" && nueva.colocacion.ancla === 1, "una decoración colgada se duplica sola, a la ancla siguiente");
  assert.equal(deco.escena.nodos.length, escena.nodos.length + 1);
}

console.log("test-editor-solitario: ok");
