/**
 * `ajustar_tamanos` sobre piezas orgánicas de la biblioteca, contra lo que daba antes de buscar sin armar (main, d9a9a6b5; los números salen de correr
 * aquella versión). Tres casos que la primera versión del cambio de tiempo (P-054) dejaba mal:
 * - el tronco del árbol de Halloween, «más R-5»: daba un error («Sin R-5 una parte de «Tronco» se quedaría sin globos») donde antes pasaba de 49 a 79;
 * - la guirnalda de la idea Graffiti Invierno, «más R-24»: con el tope de globos aplicado a un paso del camino (engrosar el cuerpo) no se engrosaba y
 *   los R-24 se forzaban en un cuerpo delgado (383 → 73 globos); antes quedaba 383 → 300 con 35 R-24;
 * - el semiarco tropical con animal print, «más R-12»: quedaba en 66 R-12 y 71 globos; antes, 89 y 264.
 * Y los tres de la segunda revisión: el texto de una pieza que no cambió no cuenta un engrosado que se descartó, el tope de globos vale también para la
 * segunda búsqueda («poner R-5 1200» llegaba a 502 globos de estructura y a 17 armados) y «menos R-12» se entrega aunque el tope no deje bajarlos todos.
 * Los números tienen margen (no se compara cada globo): lo que se comprueba es que no se pierda lo que antes se lograba.
 * Sin coste: ninguna IA ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-ajustar-tamanos-biblioteca.ts
 */
import assert from "node:assert/strict";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "../../src/lib/globos3d/biblioteca";
import type { Escena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { armarOrganico } from "../../src/lib/globos3d/organico";
import { EMPAQUES } from "../../src/lib/globos3d/organico-empaques";
import { esPiezaOrganica, opcionesDe } from "../../src/lib/globos3d/organico-ajustes";
import { globosDeEstructura } from "../../src/lib/globos3d/organico-estructura";
import { GLOBOS_MAXIMOS_CUERPO } from "../../src/lib/globos3d/presupuesto-cuerpo";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const escenaDe = (idItem: string): Escena => escenaDeItem(BIBLIOTECA_FABRICA.find((i) => i.id === idItem) ?? assert.fail(`falta ${idItem}`));
function globosDe(escena: Escena, id: string, formato: string): { formato: number; total: number } {
  const pieza = escena.nodos.find((n) => n.id === id)?.pieza;
  assert.ok(pieza && esPiezaOrganica(pieza), `${id} no es orgánica`);
  const globos = armarOrganico(opcionesDe(pieza)).globos;
  return { formato: globos.filter((g) => g.formatoId === formato).length, total: globos.length };
}
function cambiar(idItem: string, id: string, cambio: Record<string, unknown>) {
  const escena = escenaDe(idItem);
  const antes = globosDe(escena, id, String(cambio.formato));
  const armadosAntes = EMPAQUES.hechos;
  const r = aplicarHerramienta(escena, "ajustar_tamanos", { id, cambios: [cambio] });
  assert.ok(r.ok, r.ok ? "" : r.error);
  const pieza = r.escena.nodos.find((n) => n.id === id)!.pieza;
  assert.ok(esPiezaOrganica(pieza));
  return { antes, despues: globosDe(r.escena, id, String(cambio.formato)), resumen: r.resumen, estructura: globosDeEstructura(opcionesDe(pieza)), armados: EMPAQUES.hechos - armadosAntes, igual: pieza === escena.nodos.find((n) => n.id === id)!.pieza };
}
const mas = (idItem: string, id: string, formato: string) => cambiar(idItem, id, { formato, accion: "mas" });

prueba("tronco del árbol de Halloween, «más R-5»: no da error y llega a lo de antes (49 → 79)", () => {
  const { antes, despues } = mas("idea:arbol-halloween", "tronco", "R-5");
  assert.equal(antes.formato, 49);
  assert.ok(despues.formato >= 70, `R-5: ${despues.formato}`);
});

prueba("guirnalda Graffiti Invierno, «más R-24»: engruesa el cuerpo para que quepan y deja lo de antes (35 R-24 y unos 300 globos), no 73", () => {
  const { antes, despues, resumen } = mas("idea:arbol-de-navidad-graffiti-invierno", "guirnalda", "R-24");
  assert.equal(antes.formato, 0);
  assert.ok(despues.formato >= 31, `R-24: ${despues.formato}`);
  assert.ok(despues.total >= 270, `globos: ${despues.total} (antes de forzar los R-24 en un cuerpo delgado: 73)`);
  assert.match(resumen, /engrosé el cuerpo/);
});

prueba("semiarco tropical con animal print, «más R-12»: llega a lo de antes (54 → 89 R-12, unos 264 globos), no a 66 y 71", () => {
  const { antes, despues } = mas("idea:semi-arco-organico-tropical-con-toques-de-animal-print", "semiarco", "R-12");
  assert.equal(antes.formato, 54);
  assert.ok(despues.formato >= 80, `R-12: ${despues.formato}`);
  assert.ok(despues.total >= 200, `globos: ${despues.total}`);
});

prueba("semiarco «Amor y amistad», «más R-12»: el cuerpo más grueso pasaría del tope de globos, la pieza queda igual y el texto no cuenta un engrosado que no quedó", () => {
  const { antes, despues, resumen, igual } = mas("idea:semiarco-amor-y-amistad", "semiarco", "R-12");
  assert.ok(igual && despues.formato === antes.formato, "la pieza no cambió");
  assert.doesNotMatch(resumen, /(?<!no )engrosé (todo )?el cuerpo/, "no dice que engrosó lo que no engrosó (sí que no lo engrosó)");
  assert.match(resumen, new RegExp(`${GLOBOS_MAXIMOS_CUERPO} globos de estructura`), "dice por qué se queda como está");
  assert.match(resumen, /se queda como está/);
});

prueba("arco de calabazas, «poner 1200 R-5»: ni la primera ni la segunda búsqueda pasan del tope de globos, y no hacen decenas de armados", () => {
  const { despues, estructura, armados } = cambiar("escena:halloween_arco_calabazas", "arco", { formato: "R-5", accion: "poner", cantidad: 1200 });
  assert.ok(estructura <= GLOBOS_MAXIMOS_CUERPO, `${estructura} globos de estructura (antes de acotar la segunda búsqueda: 502)`);
  assert.ok(despues.formato > 147, `R-5: ${despues.formato}`);
  // El número de armados depende de lo rápido que arme el equipo (la cuota usa lo medido si es menos que la fórmula):
  // en un equipo tranquilo hace 9, con carga menos. Lo que no puede pasar es volver a decenas (antes, 17).
  assert.ok(armados <= 14, `${armados} armados (antes, 17)`);
});

prueba("arco de corazones brillantes, «menos R-12»: baja aunque el tope no deje bajarlos todos (antes se quedaba en 168)", () => {
  const { antes, despues, estructura, resumen } = cambiar("idea:decoracion-corazones-brillantes", "arco", { formato: "R-12", accion: "menos" });
  assert.equal(antes.formato, 168);
  assert.ok(despues.formato < 150, `R-12: ${despues.formato}`);
  assert.ok(estructura <= GLOBOS_MAXIMOS_CUERPO, `${estructura} globos de estructura`);
  assert.match(resumen, /no quité todos los R-12 pedidos/);
});

console.log(`test-ajustar-tamanos-biblioteca: ${pruebas} pruebas ok`);
