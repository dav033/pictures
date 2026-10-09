/**
 * Honestidad de la IA de escena y centros de mesa (2026-10-09, conversación 3d-20261009-103125-92b58a). Sin coste: ni red ni IA.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-honestidad-escena.ts
 * - la verificación describe el mobiliario por su entrada del catálogo y sus asientos reales, nunca por el `nombre` del modelo;
 * - un nombre que contradice el catálogo («con 4 sillas» en la mesa de 8) da error con el camino correcto, o se corrige si la pieza no trae sillas;
 * - una decoración en el piso dentro de una mesa se reporta como PROBLEMA, y encima de la mesa no;
 * - la respuesta final dice lo que falló aunque el modelo lo calle (y no repite lo que ya admitió);
 * - poner_sobre / mover_sobre con una mesa de padre: queda en la cubierta, a la altura de la mesa, y se mueve con ella.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { cubiertaDeNodo } from "../../src/lib/globos3d/cubierta-mesa";
import { deslizarSobre } from "../../src/lib/globos3d/lienzo-escena";
import { verificarCambios } from "../../src/lib/globos3d/verificacion-escena";
import { problemasDeEscena, problemasNuevos } from "../../src/lib/globos3d/problemas-escena";
import { conHonestidad, fallosPendientes, objetivoDe } from "../../src/lib/globos3d/honestidad-respuesta";
import { resumenDeMobiliario, sillasQueDiceElNombre } from "../../src/lib/globos3d/descripcion-mobiliario";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const vacia = (): Escena => ({ sala: { ...SALA_INICIAL, anchoCm: 1200, fondoCm: 900 }, nodos: [] });
const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => { if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`); return r; };
const error = (r: ResultadoHerramienta, contiene: RegExp): string => { if (r.ok) assert.fail(`se esperaba error y vino: ${r.resumen}`); assert.match(r.error, contiene); return r.error; };
const nodo = (e: Escena, id: string): NodoEscena => { const n = e.nodos.find((x) => x.id === id); assert.ok(n, `falta ${id}`); return n; };
const paso = (e: Escena, herramienta: string, args: Record<string, unknown>): Escena => ok(aplicarHerramienta(e, herramienta, args)).escena;

/** Una escena con una mesa redonda con mantel en (x, z). */
function conMesa(x = 0, z = 0): { escena: Escena; mesaId: string } {
  const escena = paso(vacia(), "agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: x, z_cm: z });
  return { escena, mesaId: escena.nodos[0]!.id };
}

const florEnPiso = (e: Escena, x: number, z: number, decoracion = "flor_grande"): Escena =>
  paso(e, "agregar_pieza", { tipo: "decoracion", decoracion_id: decoracion, donde: { en: "piso", x_cm: x, z_cm: z } });

// ----------------------------------------------------------------------------------------------------------
console.log("1a. La verificación cuenta el mobiliario por catálogo");

prueba("una mesa de 8 sillas llamada «con 4 sillas» (puesta a mano) se describe como lo que es", () => {
  const antes = vacia();
  const real = paso(antes, "agregar_mobiliario", { id: "mesa_redonda_sillas" });
  const mentirosa: Escena = { ...real, nodos: real.nodos.map((n) => ({ ...n, nombre: "Mesa redonda 1 con 4 sillas" })) };
  const v = verificarCambios(antes, mentirosa);
  assert.match(v, /Mesa redonda con 8 sillas \(mesa_redonda_sillas, 8 asientos/);
  assert.match(v, /Mobiliario real \(por catálogo\): 1 × Mesa redonda con 8 sillas; 8 asientos/);
  assert.doesNotMatch(v, /4 sillas/, "no repite el nombre que eligió el modelo");
});

prueba("el resumen cuenta mesas, sillas sueltas y las mesas con algo encima", () => {
  let e = paso(vacia(), "agregar_mobiliario", { id: "mesa_redonda_mantel", x_cm: -200, z_cm: 0 });
  const mesaId = e.nodos[0]!.id;
  e = paso(e, "agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor", alrededor_de: mesaId });
  e = paso(e, "poner_sobre", { decoracion_id: "margarita", padre_id: mesaId });
  assert.match(resumenDeMobiliario(e), /1 × Mesa redonda con mantel, 4 × Silla Tiffany; 4 asientos; mesas con algo encima: 1 de 1/);
});

// ----------------------------------------------------------------------------------------------------------
console.log("1b. Un nombre que contradice el catálogo");

prueba("«4 sillas» en la mesa de 8 → error con el camino correcto", () => {
  const msg = error(aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "mesa_redonda_sillas", nombre: "Mesa redonda 1 con 4 sillas" }), /trae SIEMPRE 8/);
  assert.match(msg, /mesa_redonda_mantel/);
  assert.match(msg, /silla_tiffany con cantidad 4, disposicion alrededor/);
});
prueba("el número en letras también se detecta, y la cantidad correcta pasa", () => {
  assert.equal(sillasQueDiceElNombre("Mesa con cuatro sillas"), 4);
  assert.equal(sillasQueDiceElNombre("Mesa 3"), null);
  error(aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "mesa_imperial_sillas", nombre: "Imperial con ocho sillas" }), /trae SIEMPRE 10/);
  const e = ok(aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "mesa_redonda_sillas", nombre: "Mesa 1 con 8 sillas" })).escena;
  assert.equal(e.nodos[0]!.nombre, "Mesa 1 con 8 sillas");
});
prueba("una mesa sola llamada «con 4 sillas» se corrige al nombre del catálogo y avisa", () => {
  const r = ok(aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "mesa_redonda_mantel", nombre: "Mesa 1 con 4 sillas" }));
  assert.equal(r.escena.nodos[0]!.nombre, "Mesa redonda con mantel");
  assert.match(r.resumen, /no trae sillas/);
});
prueba("cambiar_pieza no deja renombrar una mesa de 8 sillas a «4 sillas»", () => {
  const e = paso(vacia(), "agregar_mobiliario", { id: "mesa_redonda_sillas" });
  error(aplicarHerramienta(e, "cambiar_pieza", { id: e.nodos[0]!.id, nombre: "Mesa con 4 sillas" }), /trae SIEMPRE 8/);
});
prueba("el camino indicado funciona: 4 sillas Tiffany alrededor de la mesa sola", () => {
  let e = paso(vacia(), "agregar_mobiliario", { id: "mesa_redonda_mantel" });
  const mesaId = e.nodos[0]!.id;
  e = paso(e, "agregar_mobiliario", { id: "silla_tiffany", cantidad: 4, disposicion: "alrededor", alrededor_de: mesaId });
  assert.equal(e.nodos.filter((n) => n.id.startsWith("silla-tiffany")).length, 4);
});

// ----------------------------------------------------------------------------------------------------------
console.log("1c. Decoración dentro de una mesa");

prueba("una flor en el piso a la x/z de la mesa es un PROBLEMA; encima de la mesa no", () => {
  const { escena: conMesaSola, mesaId } = conMesa(100, -50);
  const enPiso = florEnPiso(conMesaSola, 100, -50);
  const florId = enPiso.nodos.at(-1)!.id;
  const problemas = problemasDeEscena(enPiso);
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0]!.mesaId, mesaId);
  assert.match(problemas[0]!.texto, /dentro de la mesa, tapada por el mantel/);
  const v = verificarCambios(conMesaSola, enPiso);
  assert.match(v, /PROBLEMA: «.*» \(decoracion\) quedó dentro de la mesa/);
  assert.match(v, /mover_sobre/);
  const encima = paso(enPiso, "mover_sobre", { id: florId, padre_id: mesaId });
  assert.deepEqual(problemasDeEscena(encima), []);
  assert.doesNotMatch(verificarCambios(enPiso, encima), /PROBLEMA/);
});
prueba("una flor al lado de la mesa, o sin mesas en la escena, no es problema", () => {
  const { escena: conMesaSola } = conMesa(0, 0);
  assert.deepEqual(problemasDeEscena(florEnPiso(conMesaSola, 300, 0)), []);
  assert.deepEqual(problemasDeEscena(florEnPiso(vacia(), 0, 0)), []);
});

// ----------------------------------------------------------------------------------------------------------
console.log("1d. La respuesta final dice lo que falló");

prueba("fallos sin resolver → «No pude: …» aunque el modelo diga «Confirmado»", () => {
  const fallos = fallosPendientes([
    { herramienta: "poner_sobre", ok: false, error: "«Mesa redonda 1» no tiene globos donde apoyar una decoración." },
    { herramienta: "poner_sobre", ok: false, error: "«Mesa redonda 1» no tiene globos donde apoyar una decoración." },
    { herramienta: "agregar_mobiliario", ok: true },
  ]);
  assert.deepEqual(fallos.map((f) => [f.herramienta, f.veces]), [["poner_sobre", 2]]);
  const r = conHonestidad("Coloqué un centro de mesa sobre cada una de las mesas. Confirmado.", fallos, []);
  assert.match(r, /^Coloqué un centro de mesa sobre cada una de las mesas\. Confirmado\./, "no quita lo que dijo el modelo");
  assert.match(r, /No pude: poner algo sobre una pieza \(2 veces\): «Mesa redonda 1» no tiene globos donde apoyar una decoración\./);
});
prueba("un éxito posterior de la misma herramienta cancela el fallo; sin fallos no se toca la respuesta", () => {
  assert.deepEqual(fallosPendientes([{ herramienta: "agregar_mobiliario", ok: false, error: "x" }, { herramienta: "agregar_mobiliario", ok: true }]), []);
  assert.equal(conHonestidad("Listo.", [], []), "Listo.");
  assert.equal(fallosPendientes([{ herramienta: "ver_escena", ok: true }]).length, 0);
});
prueba("si el modelo ya admite el fallo no se repite; los problemas de la escena sí se dicen si los calla", () => {
  const fallos = fallosPendientes([{ herramienta: "poner_sobre", ok: false, error: "No cabe." }]);
  assert.equal(conHonestidad("Puse las sillas, pero no pude poner los centros.", fallos, []), "Puse las sillas, pero no pude poner los centros.");
  const e = florEnPiso(conMesa(0, 0).escena, 0, 0);
  const r = conHonestidad("Listo, centros puestos.", [], problemasDeEscena(e));
  assert.match(r, /Quedó mal: «.*» \(decoracion\) quedó dentro de la mesa/);
  assert.equal(conHonestidad("La decoracion quedó dentro de la mesa.", [], problemasDeEscena(e)), "La decoracion quedó dentro de la mesa.");
});
prueba("fallos e éxitos intercalados en mesas distintas: cada éxito solo cancela el de su mesa", () => {
  const f = (objetivo: string, ok: boolean) => ({ herramienta: "poner_sobre", ok, objetivo, ...(ok ? {} : { error: `No cabe en ${objetivo}.` }) });
  const pendientes = fallosPendientes([f("mesa-1", false), f("mesa-2", true), f("mesa-3", false), f("mesa-4", true), f("mesa-1", false)]);
  assert.equal(pendientes.reduce((s, x) => s + x.veces, 0), 3, "mesa-1 (dos veces) y mesa-3 siguen sin centro");
  assert.deepEqual(fallosPendientes([f("mesa-1", false), f("mesa-1", true)]), []);
  assert.equal(objetivoDe({ decoracion_id: "x", padre_id: "mesa-9" }), "mesa-9");
  assert.equal(objetivoDe({ id: "silla" }), "silla");
  assert.equal(objetivoDe(undefined), undefined);
});
prueba("la admisión se reconoce con tildes, y «nada pendiente» no cuenta", () => {
  const fallos = fallosPendientes([{ herramienta: "poner_sobre", ok: false, error: "No cabe." }]);
  for (const t of ["La mesa 3 falló.", "No logré poner el centro.", "No quedó en la mesa 2.", "Fallé en la última."]) assert.equal(conHonestidad(t, fallos, []), t, t);
  assert.match(conHonestidad("Todo listo, nada pendiente.", fallos, []), /No pude:/);
});
prueba("solo se reclama lo que este turno rompió, no lo que ya estaba", () => {
  const { escena: conMesaSola } = conMesa(0, 0);
  const yaMal = florEnPiso(conMesaSola, 0, 0);
  assert.deepEqual(problemasNuevos(yaMal, yaMal), []);
  assert.doesNotMatch(verificarCambios(yaMal, florEnPiso(yaMal, 600, 300)), /PROBLEMA/);
  assert.equal(problemasNuevos(conMesaSola, yaMal).length, 1);
});
prueba("el carrito de dulces y la mesa de regalos no reciben centros; un sofá no se renombra por «sillas»", () => {
  const carrito = paso(vacia(), "agregar_mobiliario", { id: "carrito_dulces" });
  error(aplicarHerramienta(carrito, "poner_sobre", { decoracion_id: "margarita", padre_id: carrito.nodos[0]!.id }), /sin cubierta|no tiene globos|No cabe/);
  const sofa = ok(aplicarHerramienta(vacia(), "agregar_mobiliario", { id: "sofa", nombre: "Sofá de 3 puestos" }));
  assert.equal(sofa.escena.nodos[0]!.nombre, "Sofá de 3 puestos");
});
prueba("hay un tope de líneas: muchos fallos distintos se resumen", () => {
  const fallos = fallosPendientes(["a", "b", "c", "d", "e", "f"].map((h) => ({ herramienta: h, ok: false, error: `error de ${h}.` })));
  const r = conHonestidad("Hecho.", fallos, []);
  assert.match(r, /y 2 más/);
  assert.ok(r.length < 600, `respuesta larga: ${r.length}`);
});

prueba("la ruta aplica la honestidad al texto final, incluso al de la IA cortada, y registra los fallos", () => {
  const ruta = readFileSync("src/app/api/escena-ia/route.ts", "utf8");
  for (const patron of [/intentos\.push\(\{ herramienta: nombre, ok: hecho\.ok/, /respuesta = conHonestidad\(respuesta, fallos, problemas\)/, /conHonestidad\("La IA se cortó/, /cortado, fallos, problemas/]) assert.match(ruta, patron);
});

// ----------------------------------------------------------------------------------------------------------
console.log("2. Centros de mesa con poner_sobre / mover_sobre");

prueba("poner_sobre con una mesa de padre queda en la cubierta, a la altura de la mesa", () => {
  const { escena, mesaId } = conMesa(150, -100);
  const r = ok(aplicarHerramienta(escena, "poner_sobre", { decoracion_id: "flor_grande", padre_id: mesaId }));
  const flor = nodo(r.escena, "flor-grande");
  assert.equal(flor.colocacion.en === "sobre" && flor.colocacion.encima, true);
  const armada = armarEscena(r.escena);
  const cubierta = cubiertaDeNodo(nodo(r.escena, mesaId), armada.porNodo.find((n) => n.id === mesaId))!.cubierta;
  const caja = armada.porNodo.find((n) => n.id === "flor-grande")!.caja;
  assert.ok(Math.abs(caja.min.y - cubierta.centro.y) <= 1, `base ${caja.min.y} vs cubierta ${cubierta.centro.y}`);
  assert.ok(Math.abs((caja.min.x + caja.max.x) / 2 - 150) <= 2 && Math.abs((caja.min.z + caja.max.z) / 2 + 100) <= 2, "centrada en la mesa");
  assert.equal(armada.avisos.length, 0);
  assert.match(r.resumen, /encima de «mesa-redonda-mantel»/);
});
prueba("altura_cm no manda: la altura es la de la mesa, y la herramienta lo dice", () => {
  const { escena, mesaId } = conMesa();
  const r = ok(aplicarHerramienta(escena, "poner_sobre", { decoracion_id: "margarita", padre_id: mesaId, altura_cm: 300, lado: "atras" }));
  assert.match(r.resumen, /ignoré altura_cm/);
  const caja = armarEscena(r.escena).porNodo.find((n) => n.id === "margarita")!.caja;
  assert.ok(caja.max.y < 120, `quedó a ${caja.max.y} cm`);
});
prueba("se mueve con la mesa (mover_pieza) y gira con ella", () => {
  const { escena, mesaId } = conMesa(0, 0);
  const puesta = paso(escena, "poner_sobre", { decoracion_id: "margarita", padre_id: mesaId });
  const movida = paso(puesta, "mover_pieza", { id: mesaId, donde: { en: "piso", x_cm: 220, z_cm: 140, giro_grados: 30 } });
  const caja = armarEscena(movida).porNodo.find((n) => n.id === "margarita")!.caja;
  assert.ok(Math.abs((caja.min.x + caja.max.x) / 2 - 220) <= 2 && Math.abs((caja.min.z + caja.max.z) / 2 - 140) <= 2, "siguió a la mesa");
  assert.ok(Math.abs(caja.min.y - 75) <= 1);
});
prueba("mover_sobre lleva una flor del piso a la mesa; x_cm la corre a un lado", () => {
  const { escena, mesaId } = conMesa(0, 0);
  const arriba = paso(florEnPiso(escena, 400, 0, "margarita"), "mover_sobre", { id: "decoracion", padre_id: mesaId, x_cm: 30 });
  const caja = armarEscena(arriba).porNodo.find((n) => n.id === "decoracion")!.caja;
  assert.ok(Math.abs((caja.min.x + caja.max.x) / 2 - 30) <= 2, `x ${(caja.min.x + caja.max.x) / 2}`);
  assert.ok(Math.abs(caja.min.y - 75) <= 1);
});
prueba("deslizar con el visor conserva `encima` y no se sale de la cubierta", () => {
  const { escena, mesaId } = conMesa(0, 0);
  const puesta = paso(escena, "poner_sobre", { decoracion_id: "margarita", padre_id: mesaId });
  const movida = deslizarSobre(puesta, armarEscena(puesta), "margarita", { x: 30, y: 0, z: 0 });
  const c = nodo(movida, "margarita").colocacion;
  assert.equal(c.en === "sobre" && c.encima, true);
  const lejos = deslizarSobre(movida, armarEscena(movida), "margarita", { x: 900, y: 0, z: 0 });
  const caja = armarEscena(lejos).porNodo.find((n) => n.id === "margarita")!.caja;
  assert.ok(caja.max.x <= 82 + 1, `se salió: ${caja.max.x}`);
});
prueba("una silla no es una mesa: error que dice qué usar; algo demasiado grande no cabe", () => {
  const e = paso(vacia(), "agregar_mobiliario", { id: "silla_tiffany" });
  error(aplicarHerramienta(e, "poner_sobre", { decoracion_id: "margarita", padre_id: e.nodos[0]!.id }), /mobiliario sin cubierta/);
  const m = paso(vacia(), "agregar_mobiliario", { id: "mesa_coctel", ancho_cm: 40 });
  error(aplicarHerramienta(m, "poner_sobre", { decoracion_id: "flor_grande", padre_id: m.nodos[0]!.id }), /No cabe sobre/);
});
prueba("al quitar la mesa se va lo que llevaba encima; con quitar_colgadas false se queda en el piso", () => {
  const { escena, mesaId } = conMesa(100, 0);
  const puesta = paso(escena, "poner_sobre", { decoracion_id: "margarita", padre_id: mesaId });
  assert.equal(paso(puesta, "quitar_pieza", { id: mesaId }).nodos.length, 0);
  assert.equal(nodo(paso(puesta, "quitar_pieza", { id: mesaId, quitar_colgadas: false }), "margarita").colocacion.en, "piso");
});

console.log(`\n${pruebas} pruebas ok`);
