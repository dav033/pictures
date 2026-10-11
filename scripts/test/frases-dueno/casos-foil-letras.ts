/** Frases del dueño sobre globos de foil, letras y números, formas y globos sueltos. */
import assert from "node:assert/strict";
import { codigosDe, llamar, medidasDe, nodoDe, unicoNuevo, type Caso } from "./motor";

type Foil = { tipo: "metalizado"; metalizado: { forma: { tipo: string; valor?: number | string; texto?: string }; pulgadas: number; color: string } };
const foilDe = (pieza: unknown) => (pieza as Foil).metalizado;

export const CASOS_FOIL_LETRAS: Caso[] = [
  {
    area: "foil-letras",
    frase: "pon el número 15 en foil dorado",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "numero", texto: "15", colores: ["dorado"] })]],
    comprobar: (ctx) => {
      const foil = foilDe(unicoNuevo(ctx).pieza);
      assert.equal(foil.forma.tipo, "letras", "«15» son dos cifras: va como letras");
      assert.equal(foil.forma.texto, "15");
      assert.equal(foil.color, "oro", "el foil «dorado» es el Oro de la tienda, no el dorado mate");
      assert.equal(foil.pulgadas, 34, "los números van en 34\" por defecto");
    },
  },
  {
    area: "foil-letras",
    frase: "pon el número 15 en foil dorado (el modelo elige el color del foil)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "numero", texto: "15", color_metalizado: "oro", pulgadas: 40 })]],
    comprobar: (ctx) => {
      const foil = foilDe(unicoNuevo(ctx).pieza);
      assert.equal(foil.color, "oro");
      assert.equal(foil.pulgadas, 40);
      const { altoCm } = medidasDe(ctx.despues, unicoNuevo(ctx).id);
      assert.ok(altoCm > 90 && altoCm < 125, `un número de 40\" mide ~1 m de alto y mide ${Math.round(altoCm)} cm`);
    },
  },
  {
    area: "foil-letras",
    frase: "HBD en foil plateado",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "letras", texto: "HBD", color_metalizado: "plata" })]],
    comprobar: (ctx) => {
      const foil = foilDe(unicoNuevo(ctx).pieza);
      assert.deepEqual([foil.forma.tipo, foil.forma.texto, foil.color], ["letras", "HBD", "plata"]);
    },
  },
  {
    area: "foil-letras",
    frase: "un corazón de foil rojo",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "corazon", colores: ["rojo"] })]],
    comprobar: (ctx) => {
      const foil = foilDe(unicoNuevo(ctx).pieza);
      assert.deepEqual([foil.forma.tipo, foil.color], ["corazon", "rojo"]);
    },
  },
  {
    area: "foil-letras",
    frase: "letras FELIZ en globos rosados",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "letras", texto: "FELIZ", colores: ["rosado"] })]],
    comprobar: (ctx) => {
      const nueva = unicoNuevo(ctx);
      assert.equal(nueva.pieza.tipo, "letras");
      assert.match(JSON.stringify(nueva.pieza), /FELIZ/);
      assert.match(ctx.llamadas[0]!.resumen, /«rosado» → 009/);
    },
  },
  {
    area: "foil-letras",
    frase: "el número 5 relleno de globos azules",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "forma", texto: "5", colores: ["azul"] })]],
    comprobar: (ctx) => {
      const nueva = unicoNuevo(ctx);
      assert.equal(nueva.pieza.tipo, "forma");
      assert.match(ctx.llamadas[0]!.resumen, /«5» \(relleno de globos\)/);
    },
  },
  {
    area: "foil-letras",
    frase: "un corazón de globos rojo",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "forma", figura: "corazon", colores: ["rojo"] })]],
    comprobar: (ctx) => {
      const nueva = unicoNuevo(ctx);
      assert.equal(nueva.pieza.tipo, "forma");
      assert.match(ctx.llamadas[0]!.resumen, /Corazón/);
    },
  },
  {
    area: "foil-letras",
    frase: "agrega un globo R-36 arriba de cada columna",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("poner_remate", { formato: "R-36", color: "azul" })]],
    sumaSola: false,
    tocables: ["columna-izq", "columna-der"],
    comprobar: (ctx) => {
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length, "el globo de arriba va en la columna, no es una pieza suelta");
      for (const id of ["columna-izq", "columna-der"]) {
        const remate = (nodoDe(ctx.despues, id).pieza as { remate?: { formatoId: string; codigo: string } }).remate;
        assert.deepEqual(remate && [remate.formatoId, remate.codigo], ["R-36", "040"], `${id} lleva su R-36 azul arriba`);
        assert.ok(medidasDe(ctx.despues, id).altoCm > medidasDe(ctx.antes, id).altoCm + 60, `${id}: el globo tiene que sobresalir por encima de la columna`);
      }
    },
  },
  {
    area: "foil-letras",
    frase: "pinta la letra W en la pared de globos",
    base: "pared_fondo_columnas",
    vueltas: [[llamar("pintar_en_malla", { id: "pared", texto: "W", color: "azul" })]],
    sumaSola: false,
    tocables: ["pared"],
    comprobar: (ctx) => {
      assert.match(ctx.llamadas[0]!.resumen, /Pinté «W».* [0-9]+ de 108 globos de la malla/);
      assert.ok(codigosDe(ctx.despues, "pared").includes("040"), "la W queda en azul");
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length);
    },
  },
];
