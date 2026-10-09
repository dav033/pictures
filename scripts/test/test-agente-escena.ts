/**
 * El agente de la escena (2026-10-08), sin modelo y sin coste:
 *   npx tsx scripts/test/test-agente-escena.ts
 * - grupos en palabras → ids (seleccionar_grupo): plural, lado, padre («las flores de la columna izquierda»), sitio
 *   («las flores del techo»), sin coincidencias;
 * - contar_globos por formato como lo dice el usuario («r24», «link-o-loon», «tubitos»);
 * - alinear / distribuir / espejar: lo que mueven, lo que no tocan y sus errores claros;
 * - espejar refleja lo orgánico (silueta y puntos) y copia las decoraciones con su padre nuevo;
 * - preguntar_usuario: 2–4 opciones; la verificación automática dice piezas y globos antes → después;
 * - la selección del editor viaja como contexto solo si existe; el contrato de la ruta (12 pasos, 40 llamadas,
 *   selección, pregunta, verificación registrada con decidir).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DECLARACIONES_ESCENA, NOMBRES_HERRAMIENTAS, aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena, NodoEscena } from "../../src/lib/globos3d/escena";
import { formatoDePalabra, resolverGrupo } from "../../src/lib/globos3d/herramientas-escena-grupos";
import { espejarPieza } from "../../src/lib/globos3d/herramientas-escena-disposicion";
import { preguntaDe } from "../../src/lib/globos3d/herramientas-escena-extra";
import { verificarCambios } from "../../src/lib/globos3d/verificacion-escena";
import { textoSeleccion, SeleccionSchema } from "../../src/lib/globos3d/escena-ia-agente";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };
const ok = (r: ResultadoHerramienta) => { if (!r.ok) assert.fail(`se esperaba éxito: ${r.error}`); return r; };
const error = (r: ResultadoHerramienta, re: RegExp) => { if (r.ok) assert.fail(`se esperaba error: ${r.resumen}`); assert.match(r.error, re); };
const nodo = (e: Escena, id: string): NodoEscena => e.nodos.find((n) => n.id === id) ?? assert.fail(`falta ${id}`);
const x = (n: NodoEscena) => ("xCm" in n.colocacion ? n.colocacion.xCm : NaN);

const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const conFlores = [
  { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 150 },
  { decoracion_id: "flor4", padre_id: "columna-izq", altura_cm: 100 },
  { decoracion_id: "flor5", padre_id: "columna-der", altura_cm: 120 },
].reduce((e, a) => ok(aplicarHerramienta(e, "poner_sobre", a)).escena, base);

console.log("Registro");
prueba("las herramientas nuevas están declaradas y se despachan", () => {
  for (const n of ["seleccionar_grupo", "contar_globos", "alinear", "distribuir", "espejar", "preguntar_usuario"]) {
    assert.ok(NOMBRES_HERRAMIENTAS.includes(n), `falta ${n}`);
    assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === n && d.description.length > 30 && (d.parametersJsonSchema as { type?: string }).type === "object"), `declaración de ${n}`);
  }
  error(aplicarHerramienta(base, "alinear", { como: ["volar"] }), /Parámetros no válidos/);
});

console.log("Grupos");
prueba("plural, lado y cantidad: «las dos columnas», «la columna derecha», «las columnas de la izquierda»", () => {
  assert.deepEqual(resolverGrupo(base, { texto: "las dos columnas" }).ids, ["columna-izq", "columna-der"]);
  assert.deepEqual(resolverGrupo(base, { texto: "la columna derecha" }).ids, ["columna-der"]);
  assert.deepEqual(resolverGrupo(base, { texto: "la columna de la izquierda" }).ids, ["columna-izq"]);
  assert.match(resolverGrupo(base, { texto: "las tres columnas" }).notas.join(" "), /se pidieron 3 y encajan 2/);
});
prueba("padre y sitio: «las flores de la columna izquierda», «las flores del techo»; «la columna» prefiere estructuras", () => {
  assert.deepEqual(resolverGrupo(conFlores, { texto: "las flores de la columna izquierda" }).ids, ["flor5", "flor4"]);
  assert.deepEqual(resolverGrupo(conFlores, { texto: "las flores de la columna derecha" }).ids, ["flor5-2"]);
  const techo = escenaPredefinida("techo_racimos");
  assert.deepEqual(resolverGrupo(techo, { texto: "las flores del techo" }).ids.sort(), ["flor-1", "flor-2", "flor-3", "flor-4", "flor-5"]);
  assert.deepEqual(resolverGrupo(conFlores, { texto: "la columna izquierda" }).ids, ["columna-izq"]);
  const nada = resolverGrupo(base, { texto: "las palmeras" });
  assert.deepEqual(nada.ids, []);
  assert.match(nada.notas.join(" "), /ninguna pieza encaja/);
});
prueba("seleccionar_grupo no cambia la escena y lista ids con su x", () => {
  const r = ok(aplicarHerramienta(conFlores, "seleccionar_grupo", { texto: "todas las flores" }));
  assert.equal(r.consulta, true);
  assert.equal(r.escena, conFlores);
  assert.match(r.resumen, /3 piezas: ids flor5, flor4, flor5-2/);
});

console.log("Contar");
prueba("formatos como los dice el usuario", () => {
  assert.equal(formatoDePalabra("r24"), "R-24");
  assert.equal(formatoDePalabra("R 18"), "R-18");
  assert.equal(formatoDePalabra("link-o-loon"), "LOL-*");
  assert.equal(formatoDePalabra("LOL 12"), "LOL-12");
  assert.equal(formatoDePalabra("tubitos"), "T-*");
  assert.equal(formatoDePalabra("260"), "T-260");
});
prueba("contar_globos: por grupo y formato, y el total de la escena", () => {
  const r24 = ok(aplicarHerramienta(base, "contar_globos", { grupo: "el arco", formatos: ["r24"] }));
  assert.match(r24.resumen, /^Conteo de formatos R-24 en 1 pieza: 4 en total/);
  const todo = ok(aplicarHerramienta(base, "contar_globos", {}));
  assert.match(todo.resumen, /530 en total/);
  const pared = ok(aplicarHerramienta(escenaPredefinida("pared_fondo_columnas"), "contar_globos", { ids: ["pared"], formatos: ["link-o-loon"] }));
  assert.match(pared.resumen, /pared: 108 \(LOL-12 108\)/);
  error(aplicarHerramienta(base, "contar_globos", { colores: ["color que no existe xyz"] }), /No encontré el color/);
});

console.log("Disposición");
prueba("alinear en fila (borde a borde), misma línea y centrar; solo toca lo pedido", () => {
  const fila = ok(aplicarHerramienta(base, "alinear", { grupo: "las dos columnas", como: ["fila"], separacion_cm: 100, centro_x_cm: 0 })).escena;
  const izq = nodo(fila, "columna-izq"), der = nodo(fila, "columna-der");
  assert.ok(Math.abs(x(izq) + x(der)) <= 1 && x(der) - x(izq) > 100 && x(der) - x(izq) < 200, `fila: ${x(izq)} ${x(der)}`);
  assert.deepEqual(nodo(fila, "arco"), nodo(base, "arco"));
  const corrida = ok(aplicarHerramienta(base, "mover_pieza", { id: "columna-der", donde: { en: "piso", z_cm: -60 } })).escena;
  const linea = ok(aplicarHerramienta(corrida, "alinear", { ids: ["arco", "columna-izq", "columna-der"], como: ["misma_linea"] })).escena;
  assert.equal((nodo(linea, "columna-der").colocacion as { zCm: number }).zCm, -150);
  const movido = ok(aplicarHerramienta(base, "mover_pieza", { id: "arco", donde: { en: "piso", x_cm: 80 } })).escena;
  assert.ok(Math.abs(x(nodo(ok(aplicarHerramienta(movido, "alinear", { ids: ["arco"], como: ["centrar"] })).escena, "arco"))) <= 1);
});
prueba("alinear: errores claros (colgada de otra, fuera de la sala) sin tocar nada", () => {
  error(aplicarHerramienta(conFlores, "alinear", { ids: ["flor5", "flor4"], como: ["fila"] }), /va sobre «columna-izq»/);
  error(aplicarHerramienta(base, "alinear", { grupo: "las columnas", como: ["fila"], entre_centros_cm: 900 }), /fuera de la sala/);
  error(aplicarHerramienta(base, "alinear", { grupo: "las palmeras", como: ["fila"] }), /encaja con 0 piezas/);
});
prueba("distribuir: equidistantes entre dos x, en su orden", () => {
  const techo = escenaPredefinida("techo_racimos");
  const e = ok(aplicarHerramienta(techo, "distribuir", { grupo: "las flores del techo", desde_x_cm: -200, hasta_x_cm: 200 })).escena;
  const xs = ["flor-3", "flor-1", "flor-5", "flor-2", "flor-4"].map((id) => x(nodo(e, id)));
  assert.deepEqual(xs, [-200, -100, 0, 100, 200]);
  error(aplicarHerramienta(base, "distribuir", { ids: ["arco"], desde_x_cm: -100, hasta_x_cm: 100 }), /al menos 2/);
});
prueba("espejar: copia simétrica respecto del arco, con sus decoraciones colgadas de la copia", () => {
  const sin = ok(aplicarHerramienta(conFlores, "quitar_pieza", { id: "columna-der" })).escena;
  const r = ok(aplicarHerramienta(sin, "espejar", { id: "columna-izq", respecto_id: "arco" }));
  const copia = nodo(r.escena, "columna-der");
  assert.equal(x(copia), 225);
  assert.equal(copia.nombre, "Columna derecha");
  const flores = r.escena.nodos.filter((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "columna-der");
  assert.equal(flores.length, 2);
  for (const f of flores) {
    const original = nodo(sin, f.id.replace(/-2$/, "")).colocacion;
    assert.ok(f.colocacion.en === "sobre" && original.en === "sobre");
    assert.equal(f.colocacion.puntoCm.x, -original.puntoCm.x, `${f.id} reflejada en x`);
    assert.equal(f.colocacion.puntoCm.y, original.puntoCm.y);
  }
  assert.deepEqual(sin.nodos.map((n) => n.id), r.escena.nodos.slice(0, sin.nodos.length).map((n) => n.id), "no toca lo que había");
  error(aplicarHerramienta(base, "espejar", { id: "arco" }), /sobre el eje/);
});
prueba("espejarPieza: el trazo cambia de lado (silueta izquierda ↔ derecha, puntos en −x)", () => {
  const e = ok(aplicarHerramienta({ ...base, nodos: [] }, "agregar_pieza", { tipo: "trazo_organico", silueta: "esquina_derecha" })).escena;
  const p = e.nodos[0]!.pieza;
  const { pieza, reflejada } = espejarPieza(p);
  assert.ok(reflejada);
  assert.ok(p.tipo === "organico" && pieza.tipo === "organico" && p.generador && pieza.generador);
  assert.equal(pieza.generador.trazo.silueta, "esquina_izquierda");
  assert.deepEqual(pieza.generador.trazo.puntos.map((q) => q.x), p.generador.trazo.puntos.map((q) => -q.x));
});

console.log("Pregunta, verificación y selección");
prueba("preguntar_usuario: 2 a 4 opciones; no cambia la escena", () => {
  const r = ok(aplicarHerramienta(base, "preguntar_usuario", { pregunta: "¿Cuál columna?", opciones: ["la izquierda", "la derecha"] }));
  assert.equal(r.escena, base);
  assert.equal(r.consulta, true);
  assert.equal(preguntaDe({ pregunta: "¿Cuál?", opciones: ["una"] }), null);
  assert.equal(preguntaDe({ pregunta: "¿Cuál?", opciones: ["a", "b", "c", "d", "e"] }), null);
  assert.deepEqual(preguntaDe({ pregunta: " ¿Cuál? ", opciones: ["a", "a", "b"] }), { pregunta: "¿Cuál?", opciones: ["a", "b"] });
});
prueba("verificación: piezas antes → después y globos por formato de lo tocado", () => {
  assert.equal(verificarCambios(base, base), "");
  const mas = ok(aplicarHerramienta(base, "ajustar_tamanos", { id: "arco", cambios: [{ formato: "R-24", accion: "mas" }] })).escena;
  const v = verificarCambios(base, mas);
  assert.match(v, /piezas 4 → 4/);
  assert.match(v, /cambió arco «Arco orgánico»: \d+ → \d+ globos; .*R-24: 4 → \d+/);
  assert.doesNotMatch(v, /columna-izq/);
  const nueva = ok(aplicarHerramienta(base, "agregar_pieza", { tipo: "columna", colores: ["rojo"] })).escena;
  assert.match(verificarCambios(base, nueva), /piezas 4 → 5[\s\S]*nueva columna «Columna» \(columna\): 36 globos \(R-12 36\)/);
  const menos = ok(aplicarHerramienta(base, "quitar_pieza", { id: "guirnalda" })).escena;
  assert.match(verificarCambios(base, menos), /quitadas: guirnalda/);
});
prueba("selección: solo ids que existen; con la raíz del editor solitario", () => {
  assert.equal(textoSeleccion(base, null), "");
  assert.equal(textoSeleccion(base, { id: "no-existe", nombre: "X" }), "");
  assert.match(textoSeleccion(base, { id: "columna-der", nombre: "Columna derecha" }), /^\[Pieza elegida en el editor: columna-der «Columna derecha» \(columna\)/);
  assert.match(textoSeleccion(base, { id: "columna-der", nombre: "c", raizSolitario: { id: "columna-der", nombre: "c" } }), /Editando sola la estructura columna-der/);
  assert.ok(SeleccionSchema.safeParse(undefined).success && SeleccionSchema.safeParse(null).success);
  assert.ok(!SeleccionSchema.safeParse({ id: "" , nombre: "x" }).success);
});
prueba("contrato de la ruta: selección, pregunta, verificación registrada, 12 pasos y 40 llamadas", () => {
  const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
  for (const re of [/const MAX_PASOS = 12;/, /const MAX_LLAMADAS = 40;/, /seleccion: SeleccionSchema/, /REGLAS_AGENTE/, /textoSeleccion\(inicial, seleccion\)/,
    /nombre === PREGUNTAR_USUARIO/, /verificarCambios\(antesDelPaso, escena\)/, /decidir\("regla:escena_ia_verificacion"/, /decidir\("herramienta:escena_ia"/, /pregunta: \{ texto: pregunta\.pregunta, opciones: pregunta\.opciones \}/]) {
    assert.match(ruta, re);
  }
  const ui = readFileSync(new URL("../../src/components/tres-d/AsistenteEscena.tsx", import.meta.url), "utf8");
  assert.match(ui, /construirCuerpoEscenaIA\(\{ escena: antes, mensaje: limpio, historial, seleccion, foto \}\)/);
  const cuerpo = readFileSync(new URL("../../src/lib/globos3d/cuerpo-escena-ia.ts", import.meta.url), "utf8");
  assert.match(cuerpo, /seleccion: seleccion \? \{ id: seleccion\.id/);
  assert.match(ui, /OpcionesPregunta/);
});

console.log(`\n${pruebas} pruebas OK`);
