/** Frases del dueño sobre colores y acabados: nombres comunes que tienen que acabar en un color real del catálogo Sempertex. */
import assert from "node:assert/strict";
import type { Escena } from "../../../src/lib/globos3d/escena";
import { codigosDe, globosDeFormato, inventarioDe, llamar, nodoDe, type Caso } from "./motor";

const VERDE = "030";
const DORADO = "570";
const ROJO = "015";
const AZUL = "040";
const REFLEX_ROJO = "915";
const MATE_AZUL = "640";

const todosLosCodigos = (escena: Escena) => new Set(escena.nodos.flatMap((n) => codigosDe(escena, n.id)));

export const CASOS_COLORES: Caso[] = [
  {
    area: "colores",
    frase: "dúo de reflex rojo con azul mate",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[
      llamar("agregar_pieza", { tipo: "columna", colores: ["rojo reflex"] }),
      llamar("agregar_pieza", { tipo: "columna", colores: ["azul mate"] }),
    ]],
    comprobar: (ctx) => {
      assert.equal(ctx.despues.nodos.length - ctx.antes.nodos.length, 2, "un dúo son dos columnas");
      const [rojo, azul] = ctx.despues.nodos.slice(-2).map((n) => n.id);
      assert.deepEqual(codigosDe(ctx.despues, rojo!), [REFLEX_ROJO], "la primera tiene que ser roja reflex");
      assert.deepEqual(codigosDe(ctx.despues, azul!), [MATE_AZUL], "la segunda tiene que ser azul mate");
      assert.match(ctx.llamadas[0]!.resumen, /«rojo reflex» → 915/, "la herramienta dice con qué código resolvió cada nombre");
    },
  },
  {
    area: "colores",
    frase: "cámbiame todo a rojo y verde",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("recolorear_escena", { colores: ["rojo", "verde"] })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.deepEqual(ctx.despues.nodos.map((n) => n.id), ctx.antes.nodos.map((n) => n.id), "recolorear no agrega ni quita piezas");
      assert.deepEqual([...todosLosCodigos(ctx.despues)].sort(), [VERDE, ROJO].sort(), "en toda la escena solo quedan el rojo y el verde");
      for (const n of ctx.despues.nodos) assert.deepEqual(nodoDe(ctx.despues, n.id).colocacion, nodoDe(ctx.antes, n.id).colocacion, `${n.id} no se movió`);
    },
  },
  {
    area: "colores",
    frase: "ponlo todo en dorado",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("recolorear_escena", { colores: ["dorado"] })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.deepEqual([...todosLosCodigos(ctx.despues)], [DORADO], "toda la escena en dorado");
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length);
    },
  },
  {
    area: "colores",
    frase: "cambia el rosado por azul",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("recolorear_escena", { reemplazar: [{ de: "rosado", a: "azul" }] })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der"],
    comprobar: (ctx) => {
      const despues = todosLosCodigos(ctx.despues);
      assert.ok(!despues.has("609"), "ya no queda el rosado");
      assert.ok(despues.has(AZUL), "el azul lo reemplaza");
      assert.ok(despues.has("005") && despues.has(DORADO), "el blanco y el dorado se quedan");
      assert.equal(globosDeFormato(ctx.despues, "arco", "R-24"), globosDeFormato(ctx.antes, "arco", "R-24"), "cambiar de color no cambia los tamaños");
    },
  },
  {
    area: "colores",
    frase: "cambia el naranja por verde reflex",
    base: "vacia",
    vueltas: [
      [llamar("agregar_pieza", { tipo: "columna", colores: ["naranja"] })],
      [llamar("recolorear_escena", { reemplazar: [{ de: "naranja", a: "verde reflex" }] })],
    ],
    sumaSola: false,
    tocables: ["columna"],
    comprobar: (ctx) => {
      assert.deepEqual(codigosDe(ctx.despues, "columna"), ["931"], "la columna queda verde reflex");
    },
  },
  {
    area: "colores",
    frase: "cambia los link-o-loon a verde",
    base: "pared_fondo_columnas",
    vueltas: [[llamar("editar_globos", { formatos: ["LOL-*"], cambio: { color: "verde" } })]],
    sumaSola: false,
    tocables: ["pared"],
    comprobar: (ctx) => {
      assert.equal(ctx.antes.nodos.length, ctx.despues.nodos.length, "cambiar color no agrega ni quita piezas");
      const pared = (escena: Escena) => codigosDe(escena, "pared");
      assert.deepEqual([...new Set(pared(ctx.despues).filter((c) => c !== "609"))], [VERDE], `la malla de la pared tiene que quedar toda verde: ${pared(ctx.despues)}`);
      assert.ok(pared(ctx.antes).length > 1 && !pared(ctx.antes).includes(VERDE), "la pared empezaba sin verde");
    },
  },
  {
    area: "colores",
    frase: "los r5 del arco en dorado",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("editar_globos", { id: "arco", formatos: ["R-5"], cambio: { color: "dorado" } })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      const antes = inventarioDe(ctx.antes, "arco");
      const despues = inventarioDe(ctx.despues, "arco");
      assert.equal(despues.total, antes.total, "pintar no cambia cuántos globos hay");
      assert.equal(globosDeFormato(ctx.despues, "arco", "R-5"), globosDeFormato(ctx.antes, "arco", "R-5"), "ni cuántos R-5");
      assert.ok((despues.porColor.get(DORADO) ?? 0) >= globosDeFormato(ctx.despues, "arco", "R-5"), "todos los R-5 quedan dorados");
      assert.equal(globosDeFormato(ctx.despues, "arco", "R-24"), 4);
    },
  },
  {
    area: "colores",
    frase: "cambia el color de la columna a azul",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "columna-izq", colores: ["azul"] })]],
    sumaSola: false,
    tocables: ["columna-izq"],
    comprobar: (ctx) => {
      assert.deepEqual(codigosDe(ctx.despues, "columna-izq"), [AZUL]);
      assert.deepEqual(nodoDe(ctx.despues, "columna-der"), nodoDe(ctx.antes, "columna-der"), "la otra columna no se toca");
    },
  },
  {
    area: "colores",
    frase: "la columna izquierda en dorado y la derecha igual",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "columna-izq", colores: ["dorado"] }), llamar("cambiar_pieza", { id: "columna-der", colores: ["dorado"] })]],
    sumaSola: false,
    tocables: ["columna-izq", "columna-der"],
    comprobar: (ctx) => {
      assert.deepEqual(codigosDe(ctx.despues, "columna-izq"), [DORADO]);
      assert.deepEqual(codigosDe(ctx.despues, "columna-der"), [DORADO]);
    },
  },
  {
    area: "colores",
    frase: "columna rosada pastel de globos de 5 pulgadas",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", formato: "R-5", colores: ["rosado pastel"] })]],
    comprobar: (ctx) => {
      const columna = ctx.despues.nodos[0]!;
      assert.equal((columna.pieza as { formatoId?: string }).formatoId, "R-5");
      assert.deepEqual(codigosDe(ctx.despues, columna.id), ["609"], "rosado pastel es el 609 (Pastel Mate Rosado)");
    },
  },
  {
    area: "colores",
    frase: "columna azul hortensia",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", colores: ["azul hortensia"] })]],
    comprobar: (ctx) => {
      assert.deepEqual(codigosDe(ctx.despues, ctx.despues.nodos[0]!.id), ["042"], "azul hortensia es el 042");
    },
  },
  {
    area: "colores",
    frase: "espiral roja, blanca, verde y dorada",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", colores: ["rojo", "blanco", "verde", "dorado"], patron: "espiral" })]],
    comprobar: (ctx) => {
      assert.deepEqual([...codigosDe(ctx.despues, ctx.despues.nodos[0]!.id)].sort(), ["005", ROJO, VERDE, DORADO].sort(), "los cuatro colores pedidos y ninguno más");
    },
  },
  {
    area: "colores",
    frase: "solo los link-o-loon a fashion chocolate",
    base: "pared_fondo_columnas",
    vueltas: [[llamar("editar_globos", { formatos: ["LOL-*"], cambio: { color: "fashion chocolate" } })]],
    rechazo: /076 Fashion Chocolate no se fabrica en LOL-12.*074 Fashion Café/,
    comprobar: () => undefined,
  },
];
