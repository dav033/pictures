/**
 * Herramientas de la IA para la escena del taller 3D (src/lib/globos3d/herramientas-escena.ts). Sin coste: no
 * llama a ninguna IA ni a la red.
 *   npx tsx scripts/test/test-herramientas-escena.ts
 * - los esquemas JSON de todas las herramientas son objetos válidos y sin lo que Gemini rechaza;
 * - cada herramienta sobre una escena de prueba: agrega, mueve, gira, cambia, quita, duplica, sala, preset,
 *   catálogo, listar colores y ver escena;
 * - los colores se piden por código o por nombre («rosado pastel» → 609) y un color que no viene en el formato da
 *   error con el más parecido que sí viene; medidas fuera de rango, formatos e ids inexistentes dan error;
 * - ninguna herramienta toca nodos que no se le indicaron (CRUD, no rehacer) y un error deja la escena intacta;
 * - todo lo que producen las herramientas arma sin avisos;
 * - la estructura como lienzo: poner_sobre (columna de frente y a 90°, pata del arco, guirnalda) deja la decoración
 *   pegada ±2 cm y mirando hacia fuera; separar_copia deja N − 1 + 1; mover_sobre lleva una copia de un reparto a
 *   otra estructura (las demás se quedan) y una flor de una columna a otra; errores claros y sin tocar otros nodos.
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, NOMBRES_HERRAMIENTAS, aplicarHerramienta, resolverColor, resumenEscena, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { armarEscena, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { PiezaArmada } from "../../src/lib/globos3d/piezas";
import { cuerposDeGlobos } from "../../src/lib/globos3d/superficie-globos";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const ok = (r: ResultadoHerramienta): Extract<ResultadoHerramienta, { ok: true }> => {
  if (!r.ok) assert.fail(`se esperaba éxito y vino error: ${r.error}`);
  return r;
};
const error = (r: ResultadoHerramienta, contiene: RegExp): string => {
  if (r.ok) assert.fail(`se esperaba error y vino: ${r.resumen}`);
  assert.match(r.error, contiene);
  return r.error;
};
const nodo = (e: Escena, id: string): NodoEscena => { const n = e.nodos.find((x) => x.id === id); assert.ok(n, `falta ${id}`); return n; };

/** Ningún nodo fuera de `tocados` cambió (ni se perdió), y la sala sigue igual salvo que se diga. */
function soloTocó(antes: Escena, despues: Escena, tocados: readonly string[], sala = false) {
  for (const n of antes.nodos) {
    if (tocados.includes(n.id)) continue;
    const d = despues.nodos.find((x) => x.id === n.id);
    assert.ok(d, `se perdió ${n.id}`);
    assert.deepEqual(d, n, `cambió ${n.id} sin pedirlo`);
  }
  if (!sala) assert.deepEqual(despues.sala, antes.sala, "cambió la sala sin pedirlo");
}

const cache = new Map<string, PiezaArmada>();
const armaBien = (e: Escena) => assert.deepEqual(armarEscena(e, cache).avisos, [], "la escena arma sin avisos");

const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const congelada = JSON.stringify(base);

console.log("Esquemas");
prueba("hay una declaración por herramienta, con nombre, descripción y esquema de objeto", () => {
  assert.equal(DECLARACIONES_ESCENA.length, NOMBRES_HERRAMIENTAS.length);
  for (const n of ["ver_escena", "usar_preset", "agregar_pieza", "mover_pieza", "girar_pieza", "cambiar_pieza", "quitar_pieza", "duplicar_pieza", "cambiar_sala", "agregar_del_catalogo", "listar_colores"]) {
    const d = DECLARACIONES_ESCENA.find((x) => x.name === n);
    assert.ok(d, `falta ${n}`);
    assert.ok(d.description.length > 10);
    assert.equal(d.parametersJsonSchema.type, "object", `${n}: esquema de objeto`);
  }
});
prueba("los esquemas son JSON sin $schema, additionalProperties ni exclusiveMinimum (Gemini los rechaza)", () => {
  const texto = JSON.stringify(DECLARACIONES_ESCENA);
  assert.doesNotThrow(() => JSON.parse(texto));
  assert.ok(!/"\$schema"|"additionalProperties"|"exclusiveM(in|ax)imum"/.test(texto));
  const agregar = DECLARACIONES_ESCENA.find((x) => x.name === "agregar_pieza")!.parametersJsonSchema;
  assert.deepEqual(agregar.required, ["tipo"], "agregar_pieza solo exige el tipo");
});

console.log("Colores");
prueba("por código y por nombre, en la tabla oficial", () => {
  assert.equal(resolverColor("609", "R-12").codigo, "609");
  assert.equal(resolverColor("rosado pastel", "R-12").codigo, "609");
  assert.equal(resolverColor("Pastel Mate Rosado", "R-12").codigo, "609");
  assert.equal(resolverColor("rosado", "R-12").codigo, "009");
  assert.equal(resolverColor("blanco", "R-12").codigo, "005");
  assert.equal(resolverColor("dorado", "R-12").codigo, "570");
  assert.equal(resolverColor("palo de rosa", "R-12").codigo, "010");
  assert.equal(resolverColor("dorado metalizado", "R-9").codigo, "570");
  assert.equal(resolverColor("plateado", "R-12").codigo, "981");
});
prueba("un color que no viene en el formato: error con el más parecido que sí viene", () => {
  assert.throws(() => resolverColor("412", "LOL-12"), /no se fabrica en LOL-12.*más parecido.*\d{3} /);
  assert.throws(() => resolverColor("999", "R-12"), /no está en la tabla oficial/);
  assert.throws(() => resolverColor("verde fosforito galáctico", "R-12"), /No encontré el color/);
  assert.throws(() => resolverColor("rosado", "R-99"), /formato «R-99» no existe/);
});

console.log("Herramientas");
prueba("ver_escena: sala e ids con tipo, medidas, colores y posición", () => {
  const r = ok(aplicarHerramienta(base, "ver_escena", {}));
  assert.equal(r.consulta, true);
  assert.equal(r.escena, base);
  for (const id of ["arco", "columna-izq", "columna-der", "guirnalda"]) assert.match(r.resumen, new RegExp(`- ${id} · `));
  assert.match(r.resumen, /Sala 600×500×320/);
  assert.match(r.resumen, /609 Pastel Mate Rosado/);
  assert.match(r.resumen, /piso x=-225 z=-150/);
});

prueba("listar_colores: por formato, con nombre y código, y filtro", () => {
  const r = ok(aplicarHerramienta(base, "listar_colores", { formato: "R-12" }));
  assert.match(r.resumen, /609 Pastel Mate Rosado/);
  const metal = ok(aplicarHerramienta(base, "listar_colores", { formato: "R-12", buscar: "metal" }));
  assert.match(metal.resumen, /570 Metal Dorado/);
  assert.ok(!/Fashion/.test(metal.resumen), "el filtro deja solo los metalizados");
  error(aplicarHerramienta(base, "listar_colores", { formato: "X-1" }), /no existe/);
});

let escena = base;
prueba("agregar_pieza suma una guirnalda sin tocar lo demás", () => {
  const r = ok(aplicarHerramienta(escena, "agregar_pieza", { tipo: "guirnalda", colores: ["rosado pastel", "dorado"], ancho_cm: 400, caida_cm: 40, donde: { en: "pared", pared: "fondo", altura_cm: 180 } }));
  assert.equal(r.escena.nodos.length, escena.nodos.length + 1);
  const nueva = r.escena.nodos.at(-1)!;
  assert.equal(nueva.id, "guirnalda-2", "id nuevo que no choca");
  assert.equal(nueva.pieza.tipo, "guirnalda");
  if (nueva.pieza.tipo === "guirnalda") {
    assert.deepEqual(nueva.pieza.guirnalda.colores, ["609", "570"]);
    assert.equal(nueva.pieza.guirnalda.patron, "dos_colores");
    assert.equal(nueva.pieza.guirnalda.anchoCm, 400);
  }
  assert.deepEqual(nueva.colocacion, { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 180 });
  assert.match(r.resumen, /guirnalda-2/);
  soloTocó(escena, r.escena, []);
  escena = r.escena;
});

prueba("agregar_pieza: columnas, arco orgánico, decoración colgada del techo y flores en un ancla", () => {
  const col = ok(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", colores: ["blanco"], alto_cm: 200, nombre: "Columna blanca", donde: { en: "piso", x_cm: -260, z_cm: -100 } }));
  const c = nodo(col.escena, "columna");
  assert.equal(c.pieza.tipo === "columna" && c.pieza.patron, "un_color");
  assert.equal(c.nombre, "Columna blanca");
  soloTocó(escena, col.escena, []);

  const arco = ok(aplicarHerramienta(col.escena, "agregar_pieza", { tipo: "arco_organico", ancho_cm: 300, alto_cm: 250, colores: ["rosado", "dorado"], donde: { en: "piso", z_cm: -120 } }));
  const a = nodo(arco.escena, "arco-organico");
  assert.ok(a.pieza.tipo === "arco_organico");
  if (a.pieza.tipo === "arco_organico") {
    assert.deepEqual(a.pieza.arco.colores.map((x) => x.codigo), ["009", "570"]);
    assert.deepEqual(a.pieza.arco.colores.map((x) => x.peso), [40, 60]);
  }

  const flor = ok(aplicarHerramienta(arco.escena, "agregar_pieza", { tipo: "decoracion", decoracion_id: "flor5", colores: ["009"], donde: { en: "techo", x_cm: 100, cuelga_cm: 80 } }));
  const f = nodo(flor.escena, "decoracion");
  assert.equal(f.colocacion.en === "techo" && f.colocacion.volteada, true, "una flor del techo mira al piso");
  assert.match(JSON.stringify(f.pieza), /"codigo":"009"/, "pétalos recoloreados");

  const enAncla = ok(aplicarHerramienta(flor.escena, "agregar_pieza", { tipo: "decoracion", decoracion_id: "flor4", donde: { en: "ancla", padre_id: "columna", ancla: 2, cada: 4 } }));
  assert.deepEqual(nodo(enAncla.escena, "decoracion-2").colocacion, { en: "ancla", padreId: "columna", ancla: 2, cada: 4, giroGrados: 0 });
  soloTocó(flor.escena, enAncla.escena, []);
  armaBien(enAncla.escena);
  escena = enAncla.escena;
});

prueba("agregar_pieza: errores claros sin tocar la escena", () => {
  const antes = JSON.stringify(escena);
  const e1 = error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "pared_malla", colores: ["Satín Fucsia"] }), /no se fabrica en LOL-12.*más parecido/);
  assert.match(e1, /412 Satín Fucsia/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", alto_cm: 900 }), /fuera de rango: va de 60 a 500/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", formato: "R-24" }), /no se arma con R-24/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", formato: "R-77" }), /no existe/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", donde: { en: "piso", x_cm: 900 } }), /se sale de la sala/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "decoracion", donde: { en: "ancla", padre_id: "no-existe" } }), /No hay ninguna pieza con id «no-existe»/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", caida_cm: 20 }), /«caida_cm» no aplica a una columna/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "columna", patron: "dos_colores", colores: ["005", "609", "570"] }), /usa 2 colores/);
  error(aplicarHerramienta(escena, "agregar_pieza", { tipo: "nave" }), /Parámetros no válidos/);
  error(aplicarHerramienta(escena, "inventar", {}), /No existe la herramienta/);
  assert.equal(JSON.stringify(escena), antes, "los errores no tocan la escena");
});

prueba("mover_pieza: solo esa pieza; conserva lo que no se pasa en el mismo sitio", () => {
  const r = ok(aplicarHerramienta(escena, "mover_pieza", { id: "columna-izq", donde: { en: "piso", x_cm: -240 } }));
  assert.deepEqual(nodo(r.escena, "columna-izq").colocacion, { en: "piso", xCm: -240, zCm: -150, giroGrados: 0 });
  soloTocó(escena, r.escena, ["columna-izq"]);
  const techo = ok(aplicarHerramienta(r.escena, "mover_pieza", { id: "decoracion", donde: { en: "pared", pared: "izquierda", altura_cm: 150 } }));
  assert.deepEqual(nodo(techo.escena, "decoracion").colocacion, { en: "pared", pared: "izquierda", aLoLargoCm: 0, alturaCm: 150 });
  error(aplicarHerramienta(r.escena, "mover_pieza", { id: "columna", donde: { en: "ancla", padre_id: "decoracion-2" } }), /cuelga de esta misma pieza/);
  escena = r.escena;
});

prueba("girar_pieza: absoluto y relativo; en la pared no", () => {
  const r = ok(aplicarHerramienta(escena, "girar_pieza", { id: "columna-der", grados: 45 }));
  assert.equal(nodo(r.escena, "columna-der").colocacion.en === "piso" && (nodo(r.escena, "columna-der").colocacion as { giroGrados: number }).giroGrados, 45);
  const r2 = ok(aplicarHerramienta(r.escena, "girar_pieza", { id: "columna-der", grados: 170, relativo: true }));
  assert.equal((nodo(r2.escena, "columna-der").colocacion as { giroGrados: number }).giroGrados, -145);
  soloTocó(escena, r2.escena, ["columna-der"]);
  error(aplicarHerramienta(escena, "girar_pieza", { id: "guirnalda", grados: 30 }), /está en una pared/);
});

prueba("cambiar_pieza: color inexistente → error con sugerencia; color, medida y patrón válidos solo en esa pieza", () => {
  const e = error(aplicarHerramienta(escena, "cambiar_pieza", { id: "guirnalda", colores: ["909", "005"] }), /909 Reflex Rosado no se fabrica en R-9/);
  assert.match(e, /más parecido que sí viene en R-9 es \d{3} /);
  const r = ok(aplicarHerramienta(escena, "cambiar_pieza", { id: "columna-izq", colores: ["blanco", "dorado"], alto_cm: 220 }));
  const c = nodo(r.escena, "columna-izq");
  assert.ok(c.pieza.tipo === "columna" && c.pieza.alturaCm === 220 && c.pieza.patron === "dos_colores");
  assert.deepEqual(c.pieza.tipo === "columna" && c.pieza.colores, ["005", "570"]);
  soloTocó(escena, r.escena, ["columna-izq"]);
  armaBien(r.escena);

  const formato = ok(aplicarHerramienta(r.escena, "cambiar_pieza", { id: "columna-izq", formato: "R-9" }));
  const f = nodo(formato.escena, "columna-izq");
  assert.ok(f.pieza.tipo === "columna" && f.pieza.formatoId === "R-9" && f.pieza.infladoCm === 18);

  const recolor = ok(aplicarHerramienta(r.escena, "cambiar_pieza", { id: "decoracion", reemplazar_colores: [{ de: "570", a: "blanco" }] }));
  assert.match(JSON.stringify(nodo(recolor.escena, "decoracion").pieza), /"codigo":"005"/);
  soloTocó(r.escena, recolor.escena, ["decoracion"]);
  error(aplicarHerramienta(r.escena, "cambiar_pieza", { id: "decoracion", reemplazar_colores: [{ de: "080", a: "blanco" }] }), /no usa el color/);
  error(aplicarHerramienta(r.escena, "cambiar_pieza", { id: "nada", alto_cm: 100 }), /No hay ninguna pieza con id «nada»/);
  error(aplicarHerramienta(r.escena, "cambiar_pieza", { id: "arco", alto_cm: 400 }), /fuera de rango: va de 150 a 320/);
  escena = r.escena;
});

prueba("duplicar_pieza: copia con id nuevo, solo agrega", () => {
  const r = ok(aplicarHerramienta(escena, "duplicar_pieza", { id: "columna-izq", nombre: "Columna extra", donde: { en: "piso", x_cm: 0, z_cm: 150 } }));
  assert.equal(r.escena.nodos.length, escena.nodos.length + 1);
  const copia = nodo(r.escena, "columna-izq-2");
  assert.equal(copia.nombre, "Columna extra");
  assert.deepEqual(copia.colocacion, { en: "piso", xCm: 0, zCm: 150, giroGrados: 0 });
  assert.deepEqual(copia.pieza, nodo(escena, "columna-izq").pieza);
  soloTocó(escena, r.escena, []);
  escena = r.escena;
});

prueba("quitar_pieza: solo esa (y lo que cuelga de ella, si se pide)", () => {
  const r = ok(aplicarHerramienta(escena, "quitar_pieza", { id: "columna-izq-2" }));
  assert.equal(r.escena.nodos.length, escena.nodos.length - 1);
  assert.ok(!r.escena.nodos.some((n) => n.id === "columna-izq-2"));
  soloTocó(escena, r.escena, ["columna-izq-2"]);
  const conHijas = ok(aplicarHerramienta(escena, "quitar_pieza", { id: "columna" }));
  assert.ok(!conHijas.escena.nodos.some((n) => n.id === "columna" || n.id === "decoracion-2"));
  assert.match(conHijas.resumen, /decoracion-2/);
  soloTocó(escena, conHijas.escena, ["columna", "decoracion-2"]);
  const alPiso = ok(aplicarHerramienta(escena, "quitar_pieza", { id: "columna", quitar_colgadas: false }));
  assert.equal(nodo(alPiso.escena, "decoracion-2").colocacion.en, "piso");
  error(aplicarHerramienta(escena, "quitar_pieza", { id: "fantasma" }), /No hay ninguna pieza/);
  escena = r.escena;
});

prueba("cambiar_sala: medidas, tonos y superficies; no toca las piezas", () => {
  const r = ok(aplicarHerramienta(escena, "cambiar_sala", { ancho_cm: 800, mostrar_techo: false, tono_paredes: "#FFEEDD" }));
  assert.equal(r.escena.sala.anchoCm, 800);
  assert.equal(r.escena.sala.mostrar.techo, false);
  assert.equal(r.escena.sala.tonos.paredes, "#ffeedd");
  assert.equal(r.escena.sala.fondoCm, escena.sala.fondoCm);
  assert.deepEqual(r.escena.nodos, escena.nodos);
  error(aplicarHerramienta(escena, "cambiar_sala", { alto_cm: 100 }), /fuera de rango: va de 240 a 600/);
  error(aplicarHerramienta(escena, "cambiar_sala", { alto_cm: 240 }), /no cabe bajo el techo/);
  error(aplicarHerramienta(escena, "cambiar_sala", { tono_piso: "rojo" }), /hex/);
});

prueba("agregar_del_catalogo: la decoración real, sin tocar lo demás", () => {
  const r = ok(aplicarHerramienta(escena, "agregar_del_catalogo", { id: "columna_espiral_roja_azul", donde: { en: "piso", x_cm: 150, z_cm: 100 } }));
  const n = r.escena.nodos.at(-1)!;
  assert.equal(n.id, "columna-espiral-roja-azul");
  assert.equal(n.nombre, "Columna espiral roja y azul");
  assert.ok(n.pieza.tipo === "columna" && n.pieza.colores.join() === "015,041");
  soloTocó(escena, r.escena, []);
  const flor = ok(aplicarHerramienta(r.escena, "agregar_del_catalogo", { id: "flor_corazones_c27" }));
  assert.equal(flor.escena.nodos.at(-1)!.colocacion.en, "techo");
  error(aplicarHerramienta(escena, "agregar_del_catalogo", { id: "no_existe" }), /Parámetros no válidos/);
  armaBien(flor.escena);
});

prueba("usar_preset: reemplaza la escena entera (solo esta herramienta lo hace)", () => {
  const r = ok(aplicarHerramienta(escena, "usar_preset", { id: "techo_racimos" }));
  assert.deepEqual(r.escena, escenaPredefinida("techo_racimos"));
  error(aplicarHerramienta(escena, "usar_preset", { id: "otro" }), /Parámetros no válidos/);
});

console.log("Lienzo (decoraciones sobre una estructura)");
/** Lo que se mete la decoración en los globos de su estructura (cm). */
const metida = (e: Escena, id: string, padreId: string): number => {
  const a = armarEscena(e, cache);
  const d = a.porNodo.find((n) => n.id === id)!, p = a.porNodo.find((n) => n.id === padreId)!;
  let peor = -Infinity;
  for (const x of cuerposDeGlobos(d.globos)) for (const y of cuerposDeGlobos(p.globos)) peor = Math.max(peor, x.r + y.r - Math.hypot(x.c.x - y.c.x, x.c.y - y.c.y, x.c.z - y.c.z));
  return peor;
};
const normalDe = (e: Escena, id: string) => { const m = armarEscena(e, cache).porNodo.find((n) => n.id === id)!.puestas[0]!.marco.m; return { x: m[1], y: m[4], z: m[7] }; };
let lienzo = base;

prueba("hay declaraciones de poner_sobre, mover_sobre y separar_copia", () => {
  for (const n of ["poner_sobre", "mover_sobre", "separar_copia"]) assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === n), `falta ${n}`);
  const poner = DECLARACIONES_ESCENA.find((x) => x.name === "poner_sobre")!.parametersJsonSchema;
  assert.deepEqual([...(poner.required as string[])].sort(), ["decoracion_id", "padre_id"]);
});

prueba("poner_sobre: una flor en la columna a 1,2 m, de frente, pegada y mirando fuera; no toca lo demás", () => {
  const r = ok(aplicarHerramienta(lienzo, "poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 120 }));
  const n = r.escena.nodos.at(-1)!;
  assert.equal(n.colocacion.en, "sobre");
  assert.equal(n.colocacion.en === "sobre" && n.colocacion.padreId, "columna-izq");
  soloTocó(lienzo, r.escena, []);
  armaBien(r.escena);
  const m = metida(r.escena, n.id, "columna-izq");
  assert.ok(m >= -2 && m <= 2, `pegada ±2 cm (${m.toFixed(2)})`);
  assert.ok(normalDe(r.escena, n.id).z > 0.8, "de frente: mira al público");
  assert.match(r.resumen, /sobre «columna-izq» a 120 cm de altura, lado frente/);
  assert.match(resumenEscena(r.escena), /sobre «columna-izq» a 120 cm de altura/);
  lienzo = r.escena;
});

prueba("poner_sobre: alrededor de la columna (90° = su derecha), en la pata del arco y en la guirnalda", () => {
  const derecha = ok(aplicarHerramienta(lienzo, "poner_sobre", { decoracion_id: "mono_fucsia", padre_id: "columna-der", altura_cm: 90, angulo_grados: 90, nombre: "Moño" }));
  const id = derecha.escena.nodos.at(-1)!.id;
  assert.ok(normalDe(derecha.escena, id).x > 0.8, "a 90° mira a la derecha");
  assert.match(derecha.resumen, /lado derecha/);
  const enArco = ok(aplicarHerramienta(derecha.escena, "poner_sobre", { decoracion_id: "flor5", padre_id: "arco", altura_cm: 150, x_cm: -110 }));
  const idArco = enArco.escena.nodos.at(-1)!.id;
  const m = metida(enArco.escena, idArco, "arco");
  assert.ok(m >= -2 && m <= 2 && normalDe(enArco.escena, idArco).z > 0.8, `en la pata izquierda del arco, de frente y pegada (${m.toFixed(2)})`);
  const enGuirnalda = ok(aplicarHerramienta(enArco.escena, "poner_sobre", { decoracion_id: "estrella_dorada", padre_id: "guirnalda", x_cm: 100, colores: ["plata"] }));
  soloTocó(lienzo, enGuirnalda.escena, []);
  armaBien(enGuirnalda.escena);
  lienzo = enGuirnalda.escena;
});

prueba("poner_sobre: errores claros sin tocar nada", () => {
  error(aplicarHerramienta(lienzo, "poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 900 }), /no hay globos de «.*»/);
  error(aplicarHerramienta(lienzo, "poner_sobre", { decoracion_id: "flor5", padre_id: "no-existe" }), /No hay ninguna pieza/);
  const decoracion = lienzo.nodos.find((n) => n.pieza.tipo === "decoracion")!;
  error(aplicarHerramienta(lienzo, "poner_sobre", { decoracion_id: "flor5", padre_id: decoracion.id }), /no sirve de lienzo/);
});

prueba("separar_copia: de un reparto de N copias quedan N − 1 + 1, en el mismo sitio", () => {
  const conReparto = ok(aplicarHerramienta(lienzo, "agregar_pieza", { tipo: "decoracion", decoracion_id: "flor5", donde: { en: "ancla", padre_id: "columna-der", ancla: 2, cada: 6 } }));
  const id = conReparto.escena.nodos.at(-1)!.id;
  const copias = armarEscena(conReparto.escena, cache).porNodo.find((n) => n.id === id)!.copias;
  assert.ok(copias >= 3, `el reparto tiene varias copias (${copias})`);
  assert.match(resumenEscena(conReparto.escena), new RegExp(`${id} .*${copias} copias: #0 a \\d+ cm de altura`));
  const r = ok(aplicarHerramienta(conReparto.escena, "separar_copia", { id, copia: 1 }));
  const nueva = r.escena.nodos.find((n) => !conReparto.escena.nodos.some((x) => x.id === n.id))!;
  assert.equal(nueva.colocacion.en, "sobre");
  const a = armarEscena(r.escena, cache);
  assert.equal(a.porNodo.find((n) => n.id === id)!.copias, copias - 1, "el reparto queda con N − 1");
  assert.equal(a.porNodo.find((n) => n.id === nueva.id)!.copias, 1);
  soloTocó(conReparto.escena, r.escena, [id]);
  assert.match(r.resumen, new RegExp(`sigue con ${copias - 1} copias`));
  error(aplicarHerramienta(conReparto.escena, "separar_copia", { id, copia: 99 }), /copia va de 0 a/);
  error(aplicarHerramienta(conReparto.escena, "separar_copia", { id: "columna-izq", copia: 0 }), /no está repetida/);
  armaBien(r.escena);
  lienzo = conReparto.escena;
});

prueba("mover_sobre: una copia de un reparto a la guirnalda (las demás se quedan) y una flor de una columna a otra", () => {
  const reparto = lienzo.nodos.at(-1)!;
  const copias = armarEscena(lienzo, cache).porNodo.find((n) => n.id === reparto.id)!.copias;
  error(aplicarHerramienta(lienzo, "mover_sobre", { id: reparto.id, padre_id: "guirnalda" }), /Indica copia/);
  const r = ok(aplicarHerramienta(lienzo, "mover_sobre", { id: reparto.id, copia: 0, padre_id: "guirnalda", x_cm: -150 }));
  const movida = r.escena.nodos.find((n) => !lienzo.nodos.some((x) => x.id === n.id))!;
  assert.ok(movida.colocacion.en === "sobre" && movida.colocacion.padreId === "guirnalda", "la copia pasó a la guirnalda");
  assert.equal(armarEscena(r.escena, cache).porNodo.find((n) => n.id === reparto.id)!.copias, copias - 1);
  soloTocó(lienzo, r.escena, [reparto.id]);
  assert.match(r.resumen, /separada del reparto/);
  // La flor que se puso sobre la columna izquierda pasa a la derecha, por su lado izquierdo.
  const flor = r.escena.nodos.find((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === "columna-izq")!;
  const otra = ok(aplicarHerramienta(r.escena, "mover_sobre", { id: flor.id, padre_id: "columna-der", altura_cm: 60, lado: "izquierda" }));
  const ahora = otra.escena.nodos.find((n) => n.id === flor.id)!;
  assert.ok(ahora.colocacion.en === "sobre" && ahora.colocacion.padreId === "columna-der");
  assert.ok(normalDe(otra.escena, flor.id).x < -0.8, "por el lado izquierdo mira a la izquierda");
  soloTocó(r.escena, otra.escena, [flor.id]);
  error(aplicarHerramienta(r.escena, "mover_sobre", { id: "columna-der", padre_id: "columna-der" }), /misma pieza/);
  armaBien(otra.escena);
});

prueba("ninguna herramienta muta la escena que recibe", () => {
  assert.equal(JSON.stringify(base), congelada);
  assert.match(resumenEscena(escena), /piezas:/);
});

console.log(`\n${pruebas} pruebas OK`);
