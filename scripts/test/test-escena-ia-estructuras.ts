/**
 * La IA del taller 3D («IA arma la escena»): los cuatro fallos que vio el usuario, sin coste (no llama a ninguna IA
 * ni a la red: aplica las herramientas de src/lib/globos3d/herramientas-escena.ts como lo haría el modelo).
 *   npx tsx scripts/test/test-escena-ia-estructuras.ts
 *
 * 1. «columnas orgánicas» → columna_organica (pieza orgánica, no la clásica de cuartetos); la corrección «no
 *    normales, orgánicas» es reemplazar_pieza: mismo id, mismo sitio, mismos colores, y no se pierde nada.
 * 2. «cámbiame todo a rojo y verde» → recolorear_escena: recolorea todas las piezas respetando su patrón y NUNCA
 *    agrega ni quita piezas; también «cambia el rosado por azul» en todo, y solo las piezas indicadas.
 * 3. Crear de cero cada estructura que el taller sabe armar, con sus parámetros (alto, ancho, grosor, inclinación,
 *    colores con pesos, tamaños de globo, acabado, texto, figura…), validados contra los rangos y los colores
 *    oficiales; todo arma sin fallar y con la medida pedida.
 * 4. La biblioteca como base: buscar_en_biblioteca da una lista corta con ids; insertar_de_biblioteca la pone como
 *    nodos normales; cambiar_pieza la hace más alta, dorada y con flores. Una escena entera en una sala vacía trae su
 *    sala. Y la ruta acepta cualquier escena de la biblioteca (todos los tipos de pieza, hasta MAX_NODOS piezas).
 * 5. Edición precisa de lo orgánico (ajustar_tamanos): «más R-24» sube de verdad (≥ +50 %, contado en la pieza armada)
 *    y engruesa el cuerpo si no cabe; quitar/menos R-5, cantidad y porcentaje exactos, «R-24 solo abajo», colores por
 *    tamaño, más tupida y más abultada; ver_escena cuenta cada tamaño y color.
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, MAX_NODOS, TIPOS_PIEZA, aplicarHerramienta, resumenEscena, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";
import { armarOrganico } from "../../src/lib/globos3d/organico";
import { opcionesArcoOrganico } from "../../src/lib/globos3d/formas-escena";
import { readFileSync } from "node:fs";

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
const cache = new Map<string, PiezaArmada>();
/** Arma la escena: ninguna pieza deja de armarse ni se queda sin colores de su paleta. */
const armaBien = (e: Escena) => {
  const avisos = armarEscena(e, cache).avisos.filter((a) => /no se pudo armar|Ningún color de la paleta|no está en la tabla/.test(a));
  assert.deepEqual(avisos, [], "la escena arma sin fallos");
};
const alto = (p: Pieza) => { const { min, max } = armarPieza(p).caja; return max.y - min.y; };
const ancho = (p: Pieza) => { const { min, max } = armarPieza(p).caja; return max.x - min.x; };
const codigos = (p: Pieza) => [...new Set(armarPieza(p).materiales.filter((m) => m.cantidad > 0).map((m) => m.codigo))];
const nombre = (c: string) => referenciaPorCodigo(c)?.nombreCompleto ?? c;
const esOrganica = (p: Pieza) => p.tipo === "organico";

const base = escenaPredefinida("arco_organico_columnas_guirnalda");
const vacia: Escena = { sala: structuredClone(SALA_INICIAL), nodos: [] };

// ----------------------------------------------------------------------------------------------------------
console.log("1 · «columnas orgánicas» no son columnas normales, y la corrección reemplaza");
// ----------------------------------------------------------------------------------------------------------

prueba("agregar_pieza tipo columna_organica da una pieza orgánica de la altura pedida (no la clásica de cuartetos)", () => {
  const r = ok(aplicarHerramienta(base, "agregar_pieza", { tipo: "columna_organica", alto_cm: 200, colores: ["rosado pastel", "blanco", "dorado"], donde: { en: "piso", x_cm: -225, z_cm: 0 } }));
  assert.equal(r.escena.nodos.length, base.nodos.length + 1);
  const nueva = r.escena.nodos.at(-1)!;
  assert.equal(nueva.pieza.tipo, "organico");
  assert.ok(Math.abs(alto(nueva.pieza) - 200) <= 15, `alto ${alto(nueva.pieza)} ≈ 200`);
  assert.match(nueva.nombre, /orgánica/i);
  armaBien(r.escena);
});

prueba("la descripción de agregar_pieza separa columna (clásica) de columna_organica, y hay reemplazar_pieza", () => {
  const agregar = JSON.stringify(DECLARACIONES_ESCENA.find((d) => d.name === "agregar_pieza")!.parametersJsonSchema);
  assert.match(agregar, /columna: columna CLÁSICA/);
  assert.match(agregar, /columna_organica: columna ORGÁNICA/);
  for (const n of ["reemplazar_pieza", "recolorear_escena", "buscar_en_biblioteca", "insertar_de_biblioteca"]) assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === n), `falta ${n}`);
});

prueba("«no normales, orgánicas»: reemplazar_pieza deja columna orgánica con el mismo id, sitio y colores; nada se pierde", () => {
  let e = base;
  const antes = nodo(base, "columna-izq");
  for (const id of ["columna-izq", "columna-der"]) e = ok(aplicarHerramienta(e, "reemplazar_pieza", { id, tipo: "columna_organica" })).escena;
  assert.deepEqual(e.nodos.map((n) => n.id), base.nodos.map((n) => n.id), "mismos ids, en el mismo orden");
  const izq = nodo(e, "columna-izq");
  assert.ok(esOrganica(izq.pieza), "ya no es la clásica");
  assert.deepEqual(izq.colocacion, antes.colocacion, "mismo sitio");
  assert.equal(izq.nombre, "Columna orgánica izquierda");
  assert.ok(Math.abs(alto(izq.pieza) - 180) <= 8, `la misma altura que la clásica (180): ${alto(izq.pieza)}`);
  const viejos = new Set(codigos(antes.pieza));
  assert.ok(codigos(izq.pieza).every((c) => viejos.has(c)), `hereda los colores: ${codigos(izq.pieza).map(nombre).join(", ")}`);
  assert.deepEqual(nodo(e, "arco"), nodo(base, "arco"), "el arco no se tocó");
  armaBien(e);
});

prueba("reemplazar_pieza con colores y tamaños nuevos; y lo que cuelga de la pieza sigue con ella", () => {
  let e = ok(aplicarHerramienta(base, "poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 120 })).escena;
  const flor = e.nodos.at(-1)!;
  e = ok(aplicarHerramienta(e, "reemplazar_pieza", { id: "columna-izq", tipo: "columna_organica", colores: ["azul pastel", "blanco"], tamanos: ["R-12", "R-5"], alto_cm: 180 })).escena;
  const col = nodo(e, "columna-izq");
  assert.ok(col.pieza.tipo === "organico");
  const formatos = new Set(armarPieza(col.pieza).materiales.map((m) => m.formatoId));
  assert.ok([...formatos].every((f) => f === "R-12" || f === "R-5"), `solo R-12 y R-5: ${[...formatos].join(", ")}`);
  assert.ok(nodo(e, flor.id).colocacion.en === "sobre", "la flor sigue sobre la columna");
  armaBien(e);
});

prueba("reemplazar_pieza con un id que no existe: error y escena intacta", () => {
  const r = aplicarHerramienta(base, "reemplazar_pieza", { id: "columna-centro", tipo: "columna_organica" });
  error(r, /No hay ninguna pieza con id «columna-centro»/);
  assert.equal(r.escena, base);
});

// ----------------------------------------------------------------------------------------------------------
console.log("2 · «cámbiame todo a rojo y verde» recolorea y no agrega nada");
// ----------------------------------------------------------------------------------------------------------

const esRojoOVerde = (c: string) => /rojo|verde|cereza|esmeralda|selva|lima|menta|vino|eucalipto|olivo|navidad/i.test(nombre(c));

prueba("recolorear_escena con rojo y verde: mismas piezas, mismos ids y sitios, solo rojos y verdes", () => {
  const r = ok(aplicarHerramienta(base, "recolorear_escena", { colores: ["rojo", "verde"] }));
  assert.deepEqual(r.escena.nodos.map((n) => n.id), base.nodos.map((n) => n.id), "ni una pieza más ni menos");
  for (const n of r.escena.nodos) {
    assert.deepEqual(n.colocacion, nodo(base, n.id).colocacion, `${n.id}: mismo sitio`);
    assert.equal(n.pieza.tipo, nodo(base, n.id).pieza.tipo, `${n.id}: mismo tipo`);
    const cs = codigos(n.pieza);
    assert.ok(cs.every(esRojoOVerde), `${n.id}: ${cs.map(nombre).join(", ")}`);
    assert.ok(cs.length >= 2 || n.pieza.tipo === "decoracion", `${n.id}: lleva los dos colores`);
  }
  armaBien(r.escena);
});

prueba("respeta el patrón: la espiral de 4 colores queda espiral roja y verde alternada", () => {
  const r = ok(aplicarHerramienta(base, "recolorear_escena", { colores: ["rojo", "verde"], ids: ["columna-izq"] }));
  const col = nodo(r.escena, "columna-izq").pieza;
  assert.ok(col.tipo === "columna");
  if (col.tipo !== "columna") return;
  assert.equal(col.patron, nodo(base, "columna-izq").pieza.tipo === "columna" ? (nodo(base, "columna-izq").pieza as Extract<Pieza, { tipo: "columna" }>).patron : col.patron);
  assert.equal(col.colores.length, 4);
  assert.notEqual(col.colores[0], col.colores[1], "alterna");
  assert.equal(col.colores[0], col.colores[2]);
  assert.deepEqual(nodo(r.escena, "columna-der"), nodo(base, "columna-der"), "solo la indicada");
});

prueba("el arco orgánico conserva sus pesos (sumados por color) y la guirnalda R-9 toma el rojo que sí viene en R-9", () => {
  const r = ok(aplicarHerramienta(base, "recolorear_escena", { colores: ["réflex rojo", "verde"] }));
  const arco = nodo(r.escena, "arco").pieza;
  assert.ok(arco.tipo === "arco_organico");
  if (arco.tipo === "arco_organico") {
    const total = arco.arco.colores.reduce((s, c) => s + c.peso, 0);
    assert.equal(total, 100, "los pesos se conservan");
    assert.equal(arco.arco.colores.length, 2, "dos colores");
  }
  const g = nodo(r.escena, "guirnalda").pieza;
  assert.ok(g.tipo === "guirnalda" && g.guirnalda.colores.every((c) => coloresDelFormato("R-9").some((x) => x.codigo === c)), "en R-9 solo colores que se fabrican en R-9");
  assert.match(r.resumen, /más parecido|Recoloreé/);
});

prueba("reemplazar «rosado pastel» por «azul pastel» en todo; un color que nadie usa da error sin tocar nada", () => {
  const r = ok(aplicarHerramienta(base, "recolorear_escena", { reemplazar: [{ de: "rosado pastel", a: "azul pastel" }] }));
  assert.equal(r.escena.nodos.length, base.nodos.length);
  for (const n of r.escena.nodos) assert.ok(!codigos(n.pieza).includes("609"), `${n.id} sin 609`);
  assert.ok(codigos(nodo(r.escena, "columna-izq").pieza).includes("005"), "el blanco se queda");
  const mal = aplicarHerramienta(base, "recolorear_escena", { reemplazar: [{ de: "neón naranja", a: "azul" }] });
  error(mal, /Ninguna pieza/);
  assert.equal(mal.escena, base);
  error(aplicarHerramienta(base, "recolorear_escena", {}), /Pasa colores/);
});

// ----------------------------------------------------------------------------------------------------------
console.log("3 · Crear de cero cualquier estructura con sus parámetros");
// ----------------------------------------------------------------------------------------------------------

type Caso = { args: Record<string, unknown>; tipo: Pieza["tipo"]; comprobar?: (p: Pieza, n: NodoEscena) => void };
const CASOS: Record<string, Caso> = {
  "columna orgánica de 2 m, gruesa, inclinada, rosado 60 % y dorado 40 %": {
    args: { tipo: "columna_organica", alto_cm: 200, grosor_cm: 80, inclinacion_cm: 40, colores: ["rosado pastel", "dorado"], pesos: [60, 40] }, tipo: "organico",
    comprobar: (p) => {
      assert.ok(Math.abs(alto(p) - 200) <= 15, `alto ${alto(p)}`);
      assert.ok(p.tipo === "organico" && p.opciones.colores.map((c) => c.peso).join() === "60,40");
      const { min, max } = armarPieza(p).caja;
      assert.ok(max.x + min.x > 20, "la punta se corre a la derecha");
    },
  },
  "guirnalda orgánica de 4 m en la pared, con flores": {
    args: { tipo: "guirnalda_organica", ancho_cm: 400, caida_cm: 40, colores: ["blanco", "verde"], flores: true }, tipo: "organico",
    comprobar: (p, n) => { assert.ok(Math.abs(ancho(p) - 400) <= 30, `ancho ${ancho(p)}`); assert.equal(n.colocacion.en, "pared"); assert.ok(p.tipo === "organico" && p.flores !== null); },
  },
  "semiarco orgánico de 2,2 m": { args: { tipo: "semiarco_organico", alto_cm: 220, ancho_cm: 150, colores: ["lila"] }, tipo: "organico", comprobar: (p) => assert.ok(Math.abs(alto(p) - 220) <= 20, `alto ${alto(p)}`) },
  "aro orgánico de 1,8 m": { args: { tipo: "aro_organico", ancho_cm: 180, colores: ["rosado pastel", "blanco"] }, tipo: "organico", comprobar: (p) => assert.ok(Math.abs(alto(p) - 180) <= 25, `alto ${alto(p)}`) },
  "marco orgánico 2,4 × 2,4 m": { args: { tipo: "marco_organico", ancho_cm: 240, alto_cm: 240, colores: ["negro", "naranja"] }, tipo: "organico", comprobar: (p) => assert.ok(Math.abs(alto(p) - 240) <= 25, `alto ${alto(p)}`) },
  "pared de trenzas de 2 colores": { args: { tipo: "pared_trenzas", ancho_cm: 200, alto_cm: 200, colores: ["rosado pastel", "blanco"] }, tipo: "pared_trenzas" },
  "corazón de celdas de 1,2 m": { args: { tipo: "forma", figura: "corazon", ancho_cm: 120, alto_cm: 110, colores: ["rojo"] }, tipo: "forma" },
  "estrella orgánica dorada y blanca": { args: { tipo: "forma", figura: "estrella", tecnica: "organico", colores: ["dorado", "blanco"], pesos: [70, 30] }, tipo: "forma" },
  "esfera de 80 cm": { args: { tipo: "forma", figura: "esfera", ancho_cm: 80, colores: ["plata"] }, tipo: "forma" },
  "cono de 1,2 m": { args: { tipo: "forma", figura: "cono", alto_cm: 120, colores: ["verde"] }, tipo: "forma" },
  "letras FELIZ de 50 cm en dos colores": { args: { tipo: "letras", texto: "FELIZ", alto_cm: 50, colores: ["fucsia", "azul"] }, tipo: "letras", comprobar: (_, n) => assert.equal(n.colocacion.en, "pared") },
  "metalizado 15 dorado": { args: { tipo: "metalizado", texto: "15", color_metalizado: "oro" }, tipo: "metalizado" },
  "metalizado corazón rosado (foil por color)": { args: { tipo: "metalizado", forma_metalizado: "corazon", colores: ["rosado"] }, tipo: "metalizado" },
  "mural corazón en tablero en azul y blanco": { args: { tipo: "mural", modelo: "mural_corazon_tablero", colores: ["azul", "blanco"] }, tipo: "mural" },
  "techo de festones": { args: { tipo: "techo", modelo: "techo_festones" }, tipo: "techo", comprobar: (_, n) => assert.equal(n.colocacion.en, "techo") },
  "palmera de 2,5 m": { args: { tipo: "arbol", modelo: "arbol_palmera_curva", alto_cm: 250 }, tipo: "arbol_globos" },
  "globo R-24 dorado con acabado reflex": { args: { tipo: "globo", colores: ["dorado"], acabado: "reflex" }, tipo: "globo", comprobar: (p) => assert.match(nombre(p.tipo === "globo" ? p.codigo : ""), /Reflex/) },
  "columna clásica sigue igual": { args: { tipo: "columna", alto_cm: 220, colores: ["blanco", "dorado"] }, tipo: "columna" },
};

for (const [titulo, caso] of Object.entries(CASOS)) {
  prueba(titulo, () => {
    const r = ok(aplicarHerramienta(vacia, "agregar_pieza", caso.args));
    assert.equal(r.escena.nodos.length, 1);
    const n = r.escena.nodos[0]!;
    assert.equal(n.pieza.tipo, caso.tipo);
    caso.comprobar?.(n.pieza, n);
    armaBien(r.escena);
    assert.ok(resumenEscena(r.escena).includes(n.id));
  });
}

prueba("validación: rangos, tamaños, colores, texto y campos que no aplican dan error claro sin tocar la escena", () => {
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "columna_organica", alto_cm: 900 }), /alto_cm = 900 cm está fuera de rango: va de 80 a 320/);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "columna_organica", tamanos: ["R-36"] }), /no es de la técnica orgánica/);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "columna_organica", colores: ["verde fosforito galáctico"] }), /No encontré el color/);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "letras" }), /falta texto/);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "metalizado", texto: "Ñ!" }), /0–9 y A–Z/);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "columna_organica", patron: "espiral" }), /no aplica/);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "columna_organica", pesos: [50] , colores: ["rojo", "verde"] }), /pesos tiene 1 valores/);
  const r = aplicarHerramienta(base, "cambiar_pieza", { id: "columna-izq", figura: "corazon" });
  error(r, /solo se usa al crear/);
  assert.equal(r.escena, base);
});

prueba("una columna orgánica de 3,2 m no cabe en una sala de 3 m: error con la medida", () => {
  const baja: Escena = { ...vacia, sala: { ...vacia.sala, altoCm: 300 } };
  error(aplicarHerramienta(baja, "agregar_pieza", { tipo: "columna_organica", alto_cm: 320 }), /no cabe bajo el techo de 300/);
});

// ----------------------------------------------------------------------------------------------------------
console.log("4 · Cualquier objeto de la biblioteca como base, y luego modificarlo");
// ----------------------------------------------------------------------------------------------------------

const idsDe = (resumen: string) => [...resumen.matchAll(/^- (\S+) · /gm)].map((m) => m[1]!);

prueba("buscar_en_biblioteca «arco orgánico»: lista corta con ids que se pueden insertar, sin tocar la escena", () => {
  const r = ok(aplicarHerramienta(base, "buscar_en_biblioteca", { texto: "arco orgánico" }));
  assert.equal(r.consulta, true);
  assert.equal(r.escena, base);
  const ids = idsDe(r.resumen);
  assert.ok(ids.length >= 3 && ids.length <= 8, `${ids.length} resultados`);
  assert.match(r.resumen, /arco org/i);
});

prueba("«toma el arco orgánico de la biblioteca y hazlo más alto, en dorado y con flores»", () => {
  const busqueda = ok(aplicarHerramienta(vacia, "buscar_en_biblioteca", { texto: "arco orgánico", tipo: "estructura" }));
  const id = idsDe(busqueda.resumen)[0]!;
  assert.ok(id, busqueda.resumen);
  const puesto = ok(aplicarHerramienta(vacia, "insertar_de_biblioteca", { id, donde: { en: "piso", x_cm: 0, z_cm: -100 } }));
  assert.ok(puesto.escena.nodos.length >= 1);
  const raiz = puesto.escena.nodos[0]!;
  assert.deepEqual(raiz.colocacion, { en: "piso", xCm: 0, zCm: -100, giroGrados: 0 });
  const altoAntes = alto(raiz.pieza);
  let e = ok(aplicarHerramienta(puesto.escena, "cambiar_pieza", { id: raiz.id, alto_cm: Math.round(altoAntes + 40) })).escena;
  assert.ok(Math.abs(alto(nodo(e, raiz.id).pieza) - (altoAntes + 40)) <= 12, `más alto: ${altoAntes} → ${alto(nodo(e, raiz.id).pieza)}`);
  e = ok(aplicarHerramienta(e, "cambiar_pieza", { id: raiz.id, colores: ["dorado", "blanco"], pesos: [70, 30], flores: true })).escena;
  const final = nodo(e, raiz.id).pieza;
  assert.ok(codigos(final).every((c) => /dorad|blanco/i.test(nombre(c))), codigos(final).map(nombre).join(", "));
  assert.ok((final.tipo === "organico" && final.flores) || (final.tipo === "arco_organico" && final.arco.flores), "con flores");
  armaBien(e);
});

prueba("una columna orgánica con sus decoraciones de una idea: conjunto → nodos normales, hijos colgados de la raíz nueva", () => {
  const b = ok(aplicarHerramienta(base, "buscar_en_biblioteca", { texto: "columna orgánica", tipo: "conjunto" }));
  const id = idsDe(b.resumen)[0]!;
  const r = ok(aplicarHerramienta(base, "insertar_de_biblioteca", { id, donde: { en: "piso", x_cm: 150, z_cm: 0 }, nombre: "Columna de la idea" }));
  const nuevos = r.escena.nodos.slice(base.nodos.length);
  assert.ok(nuevos.length >= 2, "la estructura y sus decoraciones");
  const raiz = nuevos[0]!;
  assert.equal(raiz.nombre, "Columna de la idea");
  for (const n of nuevos.slice(1)) if (n.colocacion.en === "ancla" || n.colocacion.en === "sobre") assert.ok(r.escena.nodos.some((x) => x.id === (n.colocacion as { padreId: string }).padreId), `${n.id} cuelga de algo que está`);
  for (const n of base.nodos) assert.deepEqual(nodo(r.escena, n.id), n, `${n.id} no cambia`);
  // Más alta: lo que va SOBRE ella (el R-24 de la punta) sube con ella.
  // La más alta de las que van sobre ella: un conjunto puede llevar también algo al pie (montículo de una base web).
  const yDeNodo = (e: Escena, id: string) => armarEscena(e, cache).porNodo.find((x) => x.id === id)!.caja.min.y;
  const sobre = nuevos.filter((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === raiz.id)
    .sort((a, b) => yDeNodo(r.escena, b.id) - yDeNodo(r.escena, a.id))[0];
  const altoRaiz = alto(raiz.pieza);
  if (sobre && yDeNodo(r.escena, sobre.id) > altoRaiz / 2) {
    const yDe = (e: Escena) => yDeNodo(e, sobre.id);
    const mas = ok(aplicarHerramienta(r.escena, "cambiar_pieza", { id: raiz.id, alto_cm: Math.round(altoRaiz + 80) }));
    assert.ok(yDe(mas.escena) - yDe(r.escena) > 50, `lo de encima sube: ${Math.round(yDe(r.escena))} → ${Math.round(yDe(mas.escena))}`);
  }
  // Editable como cualquier pieza: recolorear y quitar.
  const rojo = ok(aplicarHerramienta(r.escena, "recolorear_escena", { colores: ["rojo"], ids: [raiz.id] }));
  assert.ok(codigos(nodo(rojo.escena, raiz.id).pieza).every((c) => /rojo/i.test(nombre(c))));
  ok(aplicarHerramienta(r.escena, "quitar_pieza", { id: raiz.id }));
  armaBien(r.escena);
});

prueba("una escena entera de la biblioteca en una sala vacía trae su sala; ids inexistentes dan error", () => {
  const escena = BIBLIOTECA_FABRICA.find((i) => i.id === "idea:columna-organica")!;
  const r = ok(aplicarHerramienta(vacia, "insertar_de_biblioteca", { id: escena.id }));
  assert.ok(escena.contenido.tipo === "escena");
  if (escena.contenido.tipo === "escena") {
    assert.deepEqual(r.escena.sala, escena.contenido.escena.sala);
    assert.equal(r.escena.nodos.length, escena.contenido.escena.nodos.length);
  }
  error(aplicarHerramienta(vacia, "insertar_de_biblioteca", { id: "idea:no-existe" }), /No hay ningún item/);
});

prueba("la ruta acepta cualquier escena de la biblioteca: todos sus tipos de pieza y su número de piezas", () => {
  for (const item of BIBLIOTECA_FABRICA) {
    if (item.contenido.tipo !== "escena") continue;
    assert.ok(item.contenido.escena.nodos.length <= MAX_NODOS, `${item.id}: ${item.contenido.escena.nodos.length} piezas`);
    for (const n of item.contenido.escena.nodos) assert.ok((TIPOS_PIEZA as readonly string[]).includes(n.pieza.tipo), `${item.id}: tipo ${n.pieza.tipo}`);
  }
});

prueba("trazo orgánico: por silueta en la pared a su altura, por puntos desde el piso, y se cambia por sus parámetros", () => {
  const r = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", silueta: "esquina_derecha", ancho_cm: 240, alto_cm: 160, grosor_cm: 55, colores: ["verde", "rosado pastel", "dorado"], pesos: [45, 40, 15] }));
  const n = r.escena.nodos[0]!;
  assert.ok(n.pieza.tipo === "organico" && n.pieza.generador?.tipo === "trazo", "lleva su generador");
  assert.ok(n.colocacion.en === "pared" && n.colocacion.alturaCm >= 100, "cuelga en la pared");
  assert.ok(Math.abs(ancho(n.pieza) - 240) < 30, `ancho ${ancho(n.pieza)}`);
  // Por puntos: nace del piso a la izquierda y cruza arriba (el medio arco de la foto).
  const puntos = [{ x_cm: -120, y_cm: 20, grosor_cm: 80 }, { x_cm: -125, y_cm: 120, grosor_cm: 70 }, { x_cm: -90, y_cm: 200, grosor_cm: 60 }, { x_cm: 20, y_cm: 230, grosor_cm: 50 }, { x_cm: 120, y_cm: 215, grosor_cm: 35 }];
  const p = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", puntos, colores: ["azul pastel", "dorado", "blanco"] }));
  const q = p.escena.nodos[0]!;
  assert.ok(q.colocacion.en === "pared" && q.colocacion.alturaCm <= 2, "nace del piso");
  assert.ok(alto(q.pieza) > 230 && alto(q.pieza) < 275, `alto ${alto(q.pieza)}`);
  error(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", silueta: "feston", puntos }), /no los dos/);
  // Cambiar por parámetros: más ancho y otro color; sigue siendo el mismo trazo (con generador).
  const c = ok(aplicarHerramienta(r.escena, "cambiar_pieza", { id: n.id, ancho_cm: 360, colores: ["rojo"] }));
  const m = nodo(c.escena, n.id).pieza;
  assert.ok(m.tipo === "organico" && m.generador, "conserva el generador");
  assert.ok(Math.abs(ancho(m) - 360) < 40, `ancho nuevo ${ancho(m)}`);
  assert.ok(codigos(m).every((x) => /rojo/i.test(nombre(x))));
  const verde = ok(aplicarHerramienta(c.escena, "recolorear_escena", { colores: ["verde"] }));
  const v = nodo(verde.escena, n.id).pieza;
  assert.ok(v.tipo === "organico" && v.generador?.trazo.colores.every((x) => /verde/i.test(nombre(x.codigo))), "el recolor llega al generador");
  armaBien(verde.escena);
});

prueba("columnas orgánicas por tipo: «irregular» es recta y de pie; «de forma libre» se corre de lado", () => {
  const irregular = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", silueta: "columna_recta", alto_cm: 220, colores: ["dorado", "blanco"] })).escena.nodos[0]!;
  assert.equal(irregular.colocacion.en, "piso");
  assert.ok(Math.abs(alto(irregular.pieza) - 220) < 30, `alto ${alto(irregular.pieza)}`);
  assert.ok(ancho(irregular.pieza) < 100, `recta: ancho ${ancho(irregular.pieza)}`);
  assert.equal(irregular.nombre, "Columna orgánica irregular");
  const libre = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", silueta: "columna_racimos", alto_cm: 200, colores: ["azul pastel", "dorado"] })).escena.nodos[0]!;
  assert.equal(libre.colocacion.en, "piso");
  assert.ok(ancho(libre.pieza) > 110, `forma libre: ancho ${ancho(libre.pieza)}`);
});

// ----------------------------------------------------------------------------------------------------------
console.log("5 · Edición precisa de lo orgánico: «más R-24», «menos chicos», zonas, colores por tamaño, tupida, abultada");
// ----------------------------------------------------------------------------------------------------------

/** Globos de un formato contados en la pieza armada (sus materiales). */
const deFormato = (p: Pieza, f: string) => armarPieza(p).materiales.filter((m) => m.formatoId === f).reduce((s, m) => s + m.cantidad, 0);
const globosOrganicos = (p: Pieza) => (p.tipo === "organico" ? armarOrganico(p.opciones).globos : p.tipo === "arco_organico" ? armarOrganico(opcionesArcoOrganico(p.arco)).globos : assert.fail(`no es orgánica: ${p.tipo}`));
/** «R-24: 2 → 5» del resumen: lo que dice debe ser lo que hay en la pieza armada. */
const reportado = (resumen: string, f: string) => { const m = resumen.match(new RegExp(`${f}: (\\d+) → (\\d+)`)); assert.ok(m, `el resumen cuenta ${f}: ${resumen}`); return { antes: Number(m[1]), despues: Number(m[2]) }; };
const ajustar = (e: Escena, id: string, args: Record<string, unknown>) => ok(aplicarHerramienta(e, "ajustar_tamanos", { id, ...args }));
const conTrazo = (args: Record<string, unknown>) => ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "trazo_organico", ...args })).escena;

prueba("ajustar_tamanos existe, ver_escena cuenta los globos de cada tamaño y color, y el sistema de la ruta la pide", () => {
  assert.ok(DECLARACIONES_ESCENA.some((d) => d.name === "ajustar_tamanos"));
  const e = conTrazo({ silueta: "feston", colores: ["rosado pastel", "blanco"] });
  assert.match(resumenEscena(e), /globos: R-24 \d+ \[\d{3}×\d+.*R-12 \d+ \[/);
  const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /«más R-24».*ajustar_tamanos/);
});

prueba("«más R-24» en un trazo: al menos +50 % cada vez (dos veces seguidas), contado en la pieza armada", () => {
  let e = conTrazo({ silueta: "feston", colores: ["rosado pastel", "blanco"] });
  const id = e.nodos[0]!.id;
  for (let vez = 0; vez < 2; vez++) {
    const antes = deFormato(nodo(e, id).pieza, "R-24");
    const r = ajustar(e, id, { cambios: [{ formato: "R-24", accion: "mas" }] });
    e = r.escena;
    const despues = deFormato(nodo(e, id).pieza, "R-24");
    assert.ok(despues >= Math.max(antes * 1.5, antes + 2), `vez ${vez + 1}: R-24 ${antes} → ${despues}`);
    assert.deepEqual(reportado(r.resumen, "R-24"), { antes, despues }, "el resumen dice lo que hay");
    assert.ok(nodo(e, id).pieza.tipo === "organico" && (nodo(e, id).pieza as Extract<Pieza, { tipo: "organico" }>).generador, "sigue siendo el trazo");
  }
  armaBien(e);
});

prueba("un R-24 no cabe en un trazo delgado: se engruesa donde va (y se dice), o error claro con engrosar: false", () => {
  const e = conTrazo({ silueta: "esquina_derecha", ancho_cm: 240, alto_cm: 160, grosor_cm: 45, colores: ["verde"] });
  const id = e.nodos[0]!.id;
  assert.equal(deFormato(nodo(e, id).pieza, "R-24"), 0);
  error(aplicarHerramienta(e, "ajustar_tamanos", { id, cambios: [{ formato: "R-24", accion: "mas" }], engrosar: false }), /no caben.*al menos \d+ cm de grosor/);
  const r = ajustar(e, id, { cambios: [{ formato: "R-24", accion: "mas" }] });
  assert.match(r.resumen, /engrosé el cuerpo de [\d–]+ a 60 cm/);
  assert.ok(deFormato(nodo(r.escena, id).pieza, "R-24") >= 3, `R-24: ${deFormato(nodo(r.escena, id).pieza, "R-24")}`);
});

prueba("«más R-24» también en una guirnalda orgánica sin generador y en el arco orgánico por medidas", () => {
  for (const tipo of ["guirnalda_organica", "arco_organico"]) {
    const e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo, colores: ["rojo", "blanco"] })).escena;
    const id = e.nodos[0]!.id;
    const antes = deFormato(nodo(e, id).pieza, "R-24");
    const r = ajustar(e, id, { cambios: [{ formato: "R-24", accion: "mas" }] });
    const despues = deFormato(nodo(r.escena, id).pieza, "R-24");
    assert.ok(despues >= Math.max(antes * 1.5, 4), `${tipo}: R-24 ${antes} → ${despues}`);
    armaBien(r.escena);
  }
});

prueba("«quita los R-5» deja 0 R-5 (tampoco de relleno); «menos R-5» los baja a cerca de la mitad", () => {
  const e = conTrazo({ silueta: "feston", colores: ["dorado", "blanco"] });
  const id = e.nodos[0]!.id;
  const antes = deFormato(nodo(e, id).pieza, "R-5");
  assert.ok(antes > 10);
  const sin = ajustar(e, id, { cambios: [{ formato: "R-5", accion: "quitar" }] });
  assert.equal(deFormato(nodo(sin.escena, id).pieza, "R-5"), 0);
  assert.match(sin.resumen, /R-5: \d+ → 0/);
  armaBien(sin.escena);
  const menos = deFormato(nodo(ajustar(e, id, { cambios: [{ formato: "R-5", accion: "menos" }] }).escena, id).pieza, "R-5");
  assert.ok(menos > 0 && menos <= antes * 0.75, `menos R-5: ${antes} → ${menos}`);
});

prueba("cantidad exacta (8 R-24 → 8 ± 2) y porcentaje (40 % de R-18 en la estructura ± 5)", () => {
  const e = conTrazo({ silueta: "arco_pared", ancho_cm: 300, alto_cm: 130, grosor_cm: 65, colores: ["azul pastel", "blanco"] });
  const id = e.nodos[0]!.id;
  const ocho = deFormato(nodo(ajustar(e, id, { cambios: [{ formato: "R-24", accion: "poner", cantidad: 8 }] }).escena, id).pieza, "R-24");
  assert.ok(Math.abs(ocho - 8) <= 2, `R-24: ${ocho}`);
  const p = nodo(ajustar(e, id, { cambios: [{ formato: "R-18", accion: "poner", porcentaje: 40 }] }).escena, id).pieza;
  const estructura = globosOrganicos(p).filter((g) => g.tamano !== "relleno");
  const parte = (100 * estructura.filter((g) => g.formatoId === "R-18").length) / estructura.length;
  assert.ok(Math.abs(parte - 40) <= 5, `R-18 = ${parte.toFixed(1)} % de la estructura`);
  error(aplicarHerramienta(e, "ajustar_tamanos", { id, cambios: [{ formato: "R-24", accion: "poner" }] }), /cantidad o porcentaje/);
});

prueba("«los R-24 solo abajo» en un arco orgánico: más R-24 y todos en la parte de abajo", () => {
  const e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "arco_organico" })).escena;
  const id = e.nodos[0]!.id;
  const r = ajustar(e, id, { cambios: [{ formato: "R-24", accion: "mas", donde: "abajo", solo_ahi: true }] });
  const p = nodo(r.escena, id).pieza;
  const grandes = globosOrganicos(p).filter((g) => g.formatoId === "R-24");
  const { min, max } = armarPieza(p).caja;
  assert.ok(grandes.length >= 4, `R-24: ${grandes.length}`);
  assert.ok(grandes.every((g) => g.centro.y < min.y + (max.y - min.y) * 0.5), `alturas ${grandes.map((g) => Math.round(g.centro.y)).join(", ")}`);
  assert.match(r.resumen, /abajo: \d+ → \d+/);
});

prueba("colores por tamaño: los R-24 en azul reflex; «el blanco solo en los grandes» (exclusivo)", () => {
  let e = conTrazo({ silueta: "feston", colores: ["rosado pastel", "blanco"] });
  const id = e.nodos[0]!.id;
  e = ajustar(e, id, { cambios: [{ formato: "R-24", accion: "mas" }], colores_por_tamano: [{ formatos: ["R-24"], colores: ["azul reflex"] }] }).escena;
  const mats = armarPieza(nodo(e, id).pieza).materiales.filter((m) => m.cantidad > 0);
  assert.ok(mats.some((m) => m.formatoId === "R-24"));
  for (const m of mats) assert.equal(m.codigo === "940", m.formatoId === "R-24", `${m.formatoId} ${nombre(m.codigo)}`);
  const ex = ajustar(e, id, { colores_por_tamano: [{ formatos: ["R-24"], colores: ["blanco"], exclusivo: true }] }).escena;
  const blancos = armarPieza(nodo(ex, id).pieza).materiales.filter((m) => m.cantidad > 0 && /blanco/i.test(nombre(m.codigo)));
  assert.ok(blancos.length > 0 && blancos.every((m) => m.formatoId === "R-24"), `blanco en ${blancos.map((m) => m.formatoId).join(", ")}`);
  error(aplicarHerramienta(conTrazo({ silueta: "feston", colores: ["blanco"] }), "ajustar_tamanos", { id, colores_por_tamano: [{ formatos: ["R-24"], colores: ["blanco"], exclusivo: true }] }), /sin color/);
});

prueba("más tupida (más globos de estructura) y más abultada (racimos), con lo que cambió en el resumen", () => {
  const e = ok(aplicarHerramienta(vacia, "agregar_pieza", { tipo: "guirnalda_organica", colores: ["verde"] })).escena;
  const id = e.nodos[0]!.id;
  const estructura = (p: Pieza) => globosOrganicos(p).filter((g) => g.tamano !== "relleno").length;
  const t = ajustar(e, id, { densidad: "mas" });
  assert.ok(estructura(nodo(t.escena, id).pieza) > estructura(nodo(e, id).pieza), "más estructura");
  assert.match(t.resumen, /estructura \d+ → \d+/);
  const trazo = conTrazo({ silueta: "feston", colores: ["verde"] });
  const a = ajustar(trazo, trazo.nodos[0]!.id, { racimos: "mas" });
  const g = nodo(a.escena, trazo.nodos[0]!.id).pieza;
  assert.ok(g.tipo === "organico" && (g.generador?.trazo.racimos ?? 0) > 0.6, "racimos del trazo suben");
  assert.match(a.resumen, /abultado \(racimos\) 0\.35 → 0\.65/);
  error(aplicarHerramienta(base, "ajustar_tamanos", { id: "columna-izq", densidad: "mas" }), /es para piezas orgánicas/);
  error(aplicarHerramienta(trazo, "ajustar_tamanos", { id: trazo.nodos[0]!.id }), /No pediste ningún cambio/);
});

console.log(`\n${pruebas} pruebas OK`);
