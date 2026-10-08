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
 */
import assert from "node:assert/strict";
import { DECLARACIONES_ESCENA, MAX_NODOS, TIPOS_PIEZA, aplicarHerramienta, resumenEscena, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { armarEscena, SALA_INICIAL, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { armarPieza, type Pieza, type PiezaArmada } from "../../src/lib/globos3d/piezas";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { coloresDelFormato } from "../../src/lib/globos3d/formatos";

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

console.log(`\n${pruebas} pruebas OK`);
