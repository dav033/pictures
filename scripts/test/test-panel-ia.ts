/**
 * Las partes puras del panel de la IA del taller (D-021), sin red ni modelo:
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-panel-ia.ts
 * - turnos: lo guardado se valida (y lo roto se descarta), el historial para el modelo, el tiempo típico y el coste;
 * - alcance: pieza elegida / soltada / añadidas / escena entera → lo que viaja y el contexto de la tarjeta;
 * - sugerencias: según lo que hay (sin «quita las flores del techo» si no hay);
 * - respuesta: la forma de lo que devuelve la ruta y sus errores; el cuerpo del pedido.
 */
import assert from "node:assert/strict";
import { ALCANCE_INICIAL, MAX_EXTRAS, mensajeConAlcance, resolverAlcance } from "../../src/lib/globos3d/alcance-ia";
import { construirCuerpoEscenaIA } from "../../src/lib/globos3d/cuerpo-escena-ia";
import { diffEscenas } from "../../src/lib/globos3d/diff-escenas";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena, NodoEscena } from "../../src/lib/globos3d/escena";
import { resumenFotoRealista } from "../../src/lib/globos3d/foto-realista";
import { leerRespuestaIA, mensajeDeError } from "../../src/lib/globos3d/respuesta-escena-ia";
import { sugerenciasIA } from "../../src/lib/globos3d/sugerencias-ia";
import { costeTexto, esDeEstaEscena, historialParaModelo, pasoLegible, leerTurnos, siguienteNumero, tiempoTipico, turnosParaGuardar, type TurnoPanel } from "../../src/lib/globos3d/turnos-ia";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const alto = (e: Escena, id: string, cm: number): Escena => ({ ...e, nodos: e.nodos.map((n) => (n.id === id && n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: cm } } : n)) });

const turno = (numero: number, cambios: Partial<TurnoPanel> = {}): TurnoPanel => ({
  id: `t${numero}`, numero, pedido: `pedido ${numero}`, contexto: "escena entera", ambito: "escena", clave: "e1", foto: false, respuesta: `hecho ${numero}`,
  pasos: [{ herramienta: "ver_escena", resumen: "Miré", consulta: true }], diff: diffEscenas(base, alto(base, "columna-izq", 220)), pregunta: null,
  costeUsd: 0.0031, ms: 12_000, estado: "aplicado", nota: null, ...cambios,
});

console.log("Turnos guardados");
prueba("lo guardado vuelve igual tras JSON; lo roto se descarta turno por turno", () => {
  const t = [turno(1), turno(2, { pregunta: { texto: "¿La igualo?", opciones: ["Sí", "No"] } })];
  assert.deepEqual(leerTurnos(JSON.parse(JSON.stringify(t))), t);
  const roto = JSON.parse(JSON.stringify([turno(1), { ...turno(2), estado: "raro" }, { ...turno(3), diff: { nodos: [{ id: 1 }] } }, "x", null, turno(4)])) as unknown;
  assert.deepEqual(leerTurnos(roto).map((x) => x.numero), [1, 4]);
  assert.deepEqual(leerTurnos(undefined), []);
  assert.deepEqual(leerTurnos({ no: "lista" }), []);
});
prueba("se guardan los últimos 20, y menos si pesan demasiado; la numeración sigue", () => {
  const muchos = Array.from({ length: 30 }, (_, i) => turno(i + 1));
  assert.equal(turnosParaGuardar(muchos).length, 20);
  assert.equal(turnosParaGuardar(muchos)[0]!.numero, 11);
  assert.equal(siguienteNumero(turnosParaGuardar(muchos)), 31);
  assert.deepEqual(turnosParaGuardar([turno(1), turno(2, { estado: "error" }), turno(3, { estado: "detenido" })]).map((x) => x.numero), [1]);
  assert.equal(siguienteNumero([]), 1);
  const pesado = Array.from({ length: 6 }, (_, i) => turno(i + 1, { respuesta: "x".repeat(400_000) }));
  assert.ok(turnosParaGuardar(pesado).length < 6 && turnosParaGuardar(pesado).length >= 1);
});
prueba("historial para el modelo: los últimos pedidos con su respuesta, sin errores ni detenidos", () => {
  const h = historialParaModelo([turno(1), turno(2, { estado: "error" }), turno(3, { foto: true }), turno(4, { estado: "detenido" }), turno(5)]);
  assert.deepEqual(h.map((x) => x.texto), ["pedido 1", "hecho 1", "pedido 3 (con foto)", "hecho 3", "pedido 5", "hecho 5"]);
  assert.equal(historialParaModelo([turno(1), turno(2), turno(3), turno(4)]).length, 6);
});
prueba("tiempo típico y coste: nada inventado cuando no hay datos", () => {
  assert.equal(tiempoTipico([]), null);
  assert.equal(tiempoTipico([turno(1, { ms: 8_000 }), turno(2, { ms: 12_000 }), turno(3, { ms: 30_000 })]), "unos 12 s");
  assert.equal(tiempoTipico([turno(1, { estado: "error", ms: 1 })]), null);
  assert.equal(costeTexto(0.0031), "US$0,0031");
  assert.equal(costeTexto(0.05), "US$0,05");
});

console.log("Alcance");
const elegida = { id: "columna-izq", nombre: "Columna izquierda" };
prueba("la pieza elegida viaja por `seleccion`; soltarla o pedir la escena entera la quita", () => {
  const a = resolverAlcance(base, elegida, ALCANCE_INICIAL);
  assert.deepEqual([a.seleccion?.id, a.contexto], ["columna-izq", "sobre «Columna izquierda»"]);
  assert.deepEqual([resolverAlcance(base, elegida, { ...ALCANCE_INICIAL, descartada: "columna-izq" }).seleccion, resolverAlcance(base, elegida, { ...ALCANCE_INICIAL, descartada: "columna-izq" }).contexto], [null, "escena entera"]);
  assert.equal(resolverAlcance(base, elegida, { ...ALCANCE_INICIAL, escenaEntera: true }).seleccion, null);
  assert.equal(resolverAlcance(base, null, ALCANCE_INICIAL).contexto, "escena entera");
});
prueba("piezas añadidas: solo las que existen, sin repetir la principal, con tope; van como línea del mensaje", () => {
  const a = resolverAlcance(base, elegida, { ...ALCANCE_INICIAL, extras: ["columna-der", "no-existe", "columna-izq", "arco", "guirnalda", "extra"] });
  assert.deepEqual(a.extras.map((e) => e.id), ["columna-der", "arco", "guirnalda"]);
  assert.equal(a.extras.length, MAX_EXTRAS);
  assert.equal(a.contexto, "sobre «Columna izquierda», «Columna derecha», «Arco orgánico» y 1 más");
  const mensaje = mensajeConAlcance("Hazlas de 2,2 m", a, false);
  assert.match(mensaje, /^Hazlas de 2,2 m\n\[También sobre: «Columna derecha» \(id columna-der\)/);
  assert.equal(mensajeConAlcance("hola", resolverAlcance(base, elegida, ALCANCE_INICIAL), false), "hola");
  assert.match(mensajeConAlcance("hola", resolverAlcance(base, elegida, { ...ALCANCE_INICIAL, escenaEntera: true }), true), /la escena entera/);
});
prueba("nunca pasa del tope de la ruta (1000)", () => {
  const largo = "a".repeat(990);
  const a = resolverAlcance(base, null, { ...ALCANCE_INICIAL, extras: ["columna-der"] });
  assert.equal(mensajeConAlcance(largo, a, false), largo);
});
prueba("el cuerpo que viaja usa la pieza principal y el historial corto", () => {
  const cuerpo = construirCuerpoEscenaIA({ escena: base, mensaje: "x", historial: historialParaModelo([turno(1)]), seleccion: resolverAlcance(base, elegida, ALCANCE_INICIAL).seleccion });
  assert.deepEqual((cuerpo.seleccion as { id: string }).id, "columna-izq");
  assert.equal((cuerpo.historial as unknown[]).length, 2);
});

console.log("Sugerencias");
const textos = (e: Escena, id: string | null = null) => sugerenciasIA(e, id ? { id } : null, 8);
prueba("sala vacía: para empezar", () => {
  const s = textos({ ...base, nodos: [] });
  assert.ok(s.length >= 1 && s.every((x) => !/quita|iguala|más alt/i.test(x)));
});
prueba("sin flores en el techo no ofrece quitarlas; con ellas sí, y no ofrece agregarlas", () => {
  assert.ok(!textos(base).some((s) => /Quita las flores del techo/.test(s)));
  assert.ok(textos(base).some((s) => /flores colgando del techo/.test(s)));
  const techo = escenaPredefinida("techo_racimos");
  assert.ok(textos(techo).some((s) => /Quita las flores del techo/.test(s)));
  assert.ok(!textos(techo).some((s) => /flores colgando del techo/.test(s)));
});
prueba("columnas: iguala si difieren, sube si son iguales; sin guirnalda la ofrece, con guirnalda no", () => {
  assert.ok(textos(alto(base, "columna-izq", 220)).some((s) => /Iguala la altura/.test(s)));
  assert.ok(textos(base).some((s) => /columnas más altas, de 2,2 m/.test(s)));
  assert.ok(!textos(base).some((s) => /Agrega una guirnalda/.test(s)));
  assert.ok(textos({ ...base, nodos: base.nodos.filter((n) => n.id !== "guirnalda") }).some((s) => /Agrega una guirnalda/.test(s)));
});
prueba("con una pieza elegida: lo suyo va primero (alto de la columna, tupido del arco orgánico)", () => {
  assert.equal(textos(base, "columna-izq")[0], "Hazla más alta, de 2,2 m");
  assert.ok(textos(base, "arco").some((s) => /más tupida/.test(s)));
  assert.ok(!textos(base, "guirnalda").some((s) => /Hazla más alta/.test(s)));
  const sinElegida: NodoEscena | undefined = base.nodos[0];
  assert.ok(sinElegida);
  assert.deepEqual(textos(base, "no-existe"), textos(base));
});

console.log("Un turno solo actúa sobre su escena y su editor");
prueba("la clave y el ámbito deben coincidir: otra escena, o otra pieza en el editor solitario, no vale", () => {
  const t = turno(1);
  assert.equal(esDeEstaEscena(t, "e1", "escena"), true);
  assert.equal(esDeEstaEscena(t, "e2", "escena"), false, "se abrió una plantilla o una sala vacía");
  assert.equal(esDeEstaEscena(t, "e1", "pieza:columna-izq"), false, "se entró al editor solitario");
  assert.equal(esDeEstaEscena(turno(2, { ambito: "pieza:a" }), "e1", "pieza:b"), false, "otra pieza en el editor solitario");
  assert.equal(esDeEstaEscena(turno(2, { ambito: "pieza:a" }), "e1", "pieza:a"), true);
});
prueba("lo guardado sin clave (o con otra forma) no entra: un turno huérfano nunca actuaría sobre una escena", () => {
  const crudo = JSON.parse(JSON.stringify([turno(1), { ...turno(2), clave: undefined }, { ...turno(3), ambito: 4 }])) as unknown;
  assert.deepEqual(leerTurnos(crudo).map((t) => t.numero), [1]);
});

console.log("Pasos en palabras de persona");
prueba("nombres de herramientas legibles y medidas en la misma unidad (m) en todo el texto", () => {
  assert.equal(pasoLegible({ herramienta: "editar_pieza", resumen: "", consulta: false }), "Editar pieza");
  assert.equal(pasoLegible({ herramienta: "cambiar_pieza", resumen: "Columna izquierda: alto 220 cm, ancho 35 cm", consulta: false }), "Cambió una pieza · Columna izquierda: alto 2,2 m, ancho 35 cm");
  assert.equal(pasoLegible({ herramienta: "ver_escena", resumen: "Miró la escena: 4 piezas\nsegunda línea", consulta: true }), "Miró la escena: 4 piezas");
  assert.doesNotMatch(pasoLegible({ herramienta: "ajustar_tamanos", resumen: "x", consulta: false }), /ajustar_tamanos/);
});

console.log("Respuesta de la ruta y foto realista");
prueba("la respuesta buena se lee; las raras no rompen y dan un mensaje", () => {
  const ok = leerRespuestaIA({ escena: base, respuesta: "Listo", acciones: [{ herramienta: "x", resumen: "y", consulta: false }], pregunta: { texto: "¿?", opciones: ["a"] }, uso: { pasos: 1, llamadas: 2, costeEstimadoUsd: 0.002 } });
  assert.deepEqual([ok?.respuesta, ok?.pregunta?.opciones, ok?.costeEstimadoUsd], ["Listo", ["a"], 0.002]);
  assert.equal(leerRespuestaIA({ escena: base, respuesta: "Listo", acciones: [{ herramienta: "x" }] }), null);
  assert.equal(leerRespuestaIA(null), null);
  assert.equal(leerRespuestaIA({ escena: base, respuesta: "ok", acciones: [], pregunta: { texto: "¿?", opciones: [] } })?.pregunta, null);
  assert.equal(mensajeDeError({ error: "Cupo" }), "Cupo");
  assert.equal(mensajeDeError(null), "No pude hablar con la IA ahora.");
});
prueba("la foto realista dice solo lo que el código sabe", () => {
  assert.match(resumenFotoRealista(), /FLUX · 20–40 s; en casos raros, hasta unos 5 min · ≈US\$0,08 por foto \(tope de 30 por hora\)/);
});

console.log(`\n${pruebas} pruebas OK`);
