/** Frases del dueño sobre globos de foil, letras y números, formas y globos sueltos. */
import assert from "node:assert/strict";
import { armarPieza } from "../../../src/lib/globos3d/piezas";
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
  {
    area: "foil-letras",
    frase: "pon el número 15 (sin decir la forma del foil)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", texto: "15", color_metalizado: "oro" })]],
    comprobar: (ctx) => {
      const nuevo = unicoNuevo(ctx);
      assert.equal(foilDe(nuevo.pieza).pulgadas, 34, "un texto de cifras son números de 34 pulgadas, no letras de 16");
      const producto = armarPieza(nuevo.pieza).productos?.[0]?.nombre ?? "";
      assert.match(producto, /números metalizados.*34"/, "la lista de compra dice números, no letras");
      assert.doesNotMatch(producto, /letras/);
    },
  },
  {
    area: "foil-letras",
    frase: "las letras ABC en foil, pidiendo forma de número",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "numero", texto: "ABC", color_metalizado: "plata" })]],
    comprobar: (ctx) => {
      const nuevo = unicoNuevo(ctx);
      assert.equal(foilDe(nuevo.pieza).pulgadas, 16, "unas letras van en 16 pulgadas por defecto aunque se pida número");
      assert.match(armarPieza(nuevo.pieza).productos?.[0]?.nombre ?? "", /letras metalizadas.*16"/);
    },
  },
  {
    area: "foil-letras",
    frase: "una estrella de foil amarilla (el modelo dice foil y amarilla en su respuesta)",
    base: "arco_organico_columnas_guirnalda",
    textoModelo: "Agregué una estrella de foil amarilla.",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "estrella", colores: ["amarillo"] })]],
    comprobar: (ctx) => {
      assert.equal(foilDe(unicoNuevo(ctx).pieza).color, "oro", "no hay foil amarillo: el más parecido es el Oro");
      assert.match(ctx.respuesta, /Aviso:.*El foil no viene en «amarillo».*Oro, el foil más parecido/, "nombrar el foil o el color no da el aviso por dicho");
    },
  },
  {
    area: "foil-letras",
    frase: "un corazón de foil gris",
    base: "arco_organico_columnas_guirnalda",
    textoModelo: "Listo, un corazón de foil gris.",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "corazon", colores: ["gris"] })]],
    comprobar: (ctx) => {
      assert.equal(foilDe(unicoNuevo(ctx).pieza).color, "plata", "un gris es un foil neutro (plata), nunca el azul pastel");
      assert.match(ctx.respuesta, /Aviso:.*El foil no viene en «gris».*Plata/);
    },
  },
  {
    area: "foil-letras",
    frase: "un corazón de foil rojo y una estrella de foil reflex dorado (sin aviso: son ese color)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[
      llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "corazon", colores: ["rojo"] }),
      llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "estrella", colores: ["reflex dorado"] }),
    ]],
    comprobar: (ctx) => {
      const [rojo, dorado] = ctx.despues.nodos.slice(-2).map((n) => foilDe(n.pieza).color);
      assert.deepEqual([rojo, dorado], ["rojo", "oro"], "el reflex dorado es el Oro por regla");
      assert.doesNotMatch(ctx.respuesta, /Aviso|No pude/, "el rojo está a una distancia corta del foil Rojo y el dorado va a Oro por regla: nada que avisar");
    },
  },
  {
    area: "foil-letras",
    frase: "cámbiame el foil a verde fashion (recolorear_escena)",
    base: "arco_organico_columnas_guirnalda",
    textoModelo: "Listo, el foil quedó verde.",
    vueltas: [
      [llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "estrella", color_metalizado: "oro" })],
      [llamar("recolorear_escena", { colores: ["fashion verde"], ids: ["metalizado"] })],
    ],
    sumaSola: false,
    tocables: ["metalizado"],
    comprobar: (ctx) => {
      assert.equal(foilDe(nodoDe(ctx.despues, "metalizado").pieza).color, "verde_vibrante");
      assert.match(ctx.respuesta, /Aviso:.*El foil no viene en «fashion verde».*Verde vibrante/);
    },
  },
  {
    area: "foil-letras",
    frase: "pon el foil en verde fashion (editar_globos)",
    base: "arco_organico_columnas_guirnalda",
    textoModelo: "Listo, el foil quedó verde.",
    vueltas: [
      [llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "estrella", color_metalizado: "oro" })],
      [llamar("editar_globos", { id: "metalizado", cambio: { color: "fashion verde" } })],
    ],
    sumaSola: false,
    tocables: ["metalizado"],
    comprobar: (ctx) => {
      assert.equal(foilDe(nodoDe(ctx.despues, "metalizado").pieza).color, "verde_vibrante");
      assert.match(ctx.respuesta, /Aviso:.*El foil no viene en «fashion verde».*Verde vibrante/);
    },
  },
];
