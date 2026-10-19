/** Frases del dueño sobre estructuras: crear y cambiar arcos, columnas y guirnaldas (orgánicas y clásicas). */
import assert from "node:assert/strict";
import type { Escena } from "../../../src/lib/globos3d/escena";
import { codigosDe, globosDeFormato, inventarioDe, llamar, medidasDe, nodoDe, porcentajeDeColor, unicoNuevo, type Caso, type Contexto } from "./motor";

const FUCSIA_ROSA = "011";
const BLANCO = "005";
const DORADO = "570";
const ARCO_ORGANICO_300 = llamar("agregar_pieza", { tipo: "arco_organico", ancho_cm: 300, colores: ["rosado pastel", "blanco"], donde: { en: "piso", x_cm: 0, z_cm: -150 } });

const tipoDe = (escena: Escena, id: string) => nodoDe(escena, id).pieza.tipo;
const idsNuevos = (ctx: Contexto) => ctx.despues.nodos.filter((n) => !ctx.antes.nodos.some((m) => m.id === n.id));

export const CASOS_ORGANICO: Caso[] = [
  {
    area: "organico",
    frase: "arco orgánico rosa y blanco",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "arco_organico", colores: ["rosa", "blanco"] })]],
    comprobar: (ctx) => {
      const arco = unicoNuevo(ctx);
      assert.equal(arco.pieza.tipo, "arco_organico");
      assert.deepEqual([...codigosDe(ctx.despues, arco.id)].sort(), [BLANCO, FUCSIA_ROSA].sort(), "tiene que llevar solo el rosa y el blanco que se pidieron");
      assert.ok(inventarioDe(ctx.despues, arco.id).total > 100, "un arco orgánico lleva cientos de globos");
      assert.match(ctx.llamadas[0]!.resumen, /«rosa» → 011/, "la herramienta dice qué color Sempertex eligió para «rosa»");
    },
  },
  {
    area: "organico",
    frase: "cambia el arco a dorado",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "arco", colores: ["dorado"] })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      assert.deepEqual(codigosDe(ctx.despues, "arco"), [DORADO], "el arco queda solo dorado");
      assert.equal(inventarioDe(ctx.despues, "arco").total, inventarioDe(ctx.antes, "arco").total, "cambiar de color no cambia cuántos globos tiene");
      assert.deepEqual(nodoDe(ctx.despues, "arco").colocacion, nodoDe(ctx.antes, "arco").colocacion, "ni dónde está");
    },
  },
  {
    area: "organico",
    frase: "agrega una guirnalda",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "guirnalda" })]],
    comprobar: (ctx) => {
      const nueva = unicoNuevo(ctx);
      assert.equal(nueva.pieza.tipo, "guirnalda");
      assert.equal(ctx.despues.nodos.filter((n) => n.pieza.tipo === "guirnalda").length, 2, "ahora hay dos guirnaldas: la que estaba y la nueva");
      assert.deepEqual(nodoDe(ctx.despues, "guirnalda"), nodoDe(ctx.antes, "guirnalda"), "la guirnalda de antes no se toca");
      assert.ok(nueva.id !== "guirnalda", "la nueva tiene su propio id");
    },
  },
  {
    area: "organico",
    frase: "agrega una guirnalda orgánica en la pared del fondo",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "guirnalda_organica", colores: ["rosado", "blanco"], donde: { en: "pared", pared: "fondo", altura_cm: 150 } })]],
    comprobar: (ctx) => {
      const nueva = unicoNuevo(ctx);
      assert.equal(nueva.pieza.tipo, "organico");
      assert.deepEqual(nueva.colocacion, { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 150 });
      assert.equal(ctx.despues.nodos.filter((n) => n.pieza.tipo === "guirnalda").length, 1, "la guirnalda clásica que había sigue sola");
    },
  },
  {
    area: "organico",
    frase: "pon dos columnas orgánicas a los lados del arco",
    base: "vacia",
    vueltas: [
      [ARCO_ORGANICO_300],
      [
        llamar("agregar_pieza", { tipo: "columna_organica", colores: ["rosado pastel", "blanco"], nombre: "Columna izquierda", donde: { en: "piso", x_cm: -225, z_cm: -150 } }),
        llamar("agregar_pieza", { tipo: "columna_organica", colores: ["rosado pastel", "blanco"], nombre: "Columna derecha", donde: { en: "piso", x_cm: 225, z_cm: -150 } }),
      ],
    ],
    comprobar: (ctx) => {
      const columnas = ctx.despues.nodos.filter((n) => n.nombre.startsWith("Columna"));
      assert.equal(columnas.length, 2);
      assert.ok(columnas.every((n) => n.pieza.tipo === "organico"), "las dos tienen que ser orgánicas, no las clásicas de cuartetos");
      const xs = columnas.map((n) => (n.colocacion.en === "piso" ? n.colocacion.xCm : NaN)).sort((a, b) => a - b);
      assert.deepEqual(xs, [-225, 225], "una a cada lado del arco de 3 m");
      const arco = nodoDe(ctx.despues, "arco-organico");
      assert.equal(arco.pieza.tipo, "arco_organico");
    },
  },
  {
    area: "organico",
    frase: "cambia las columnas por columnas orgánicas",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("reemplazar_pieza", { id: "columna-izq", tipo: "columna_organica" }), llamar("reemplazar_pieza", { id: "columna-der", tipo: "columna_organica" })]],
    sumaSola: false,
    tocables: ["columna-izq", "columna-der"],
    comprobar: (ctx) => {
      for (const id of ["columna-izq", "columna-der"]) {
        assert.equal(tipoDe(ctx.despues, id), "organico", `${id} tiene que quedar orgánica`);
        assert.deepEqual(nodoDe(ctx.despues, id).colocacion, nodoDe(ctx.antes, id).colocacion, `${id} sigue en su sitio`);
        assert.deepEqual(codigosDe(ctx.despues, id).sort(), codigosDe(ctx.antes, id).sort(), `${id} conserva sus colores`);
      }
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length, "es un reemplazo: no sobran ni faltan piezas");
    },
  },
  {
    area: "organico",
    frase: "columna dorada de 2 metros",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", alto_cm: 200, colores: ["dorado"] })]],
    comprobar: (ctx) => {
      const nueva = unicoNuevo(ctx);
      assert.equal((nueva.pieza as { alturaCm?: number }).alturaCm, 200, "la columna mide 2 metros");
      assert.deepEqual(codigosDe(ctx.despues, nueva.id), [DORADO], "la columna es dorada");
    },
  },
  {
    area: "organico",
    frase: "columna orgánica de 2 m en rosado pastel y dorado (60 y 40 %), con globos de 18, 12 y 5 pulgadas, un poco inclinada a la derecha",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna_organica", alto_cm: 200, colores: ["rosado pastel", "dorado"], pesos: [60, 40], tamanos: ["R-18", "R-12", "R-5"], inclinacion_cm: 30 })]],
    comprobar: (ctx) => {
      const columna = unicoNuevo(ctx);
      const { altoCm } = medidasDe(ctx.despues, columna.id);
      assert.ok(Math.abs(altoCm - 200) <= 12, `tiene que medir unos 2 m y mide ${Math.round(altoCm)} cm`);
      const { porFormato } = inventarioDe(ctx.despues, columna.id);
      assert.deepEqual([...porFormato.keys()].sort(), ["R-12", "R-18", "R-5"], "solo los tres tamaños pedidos");
      const rosado = porcentajeDeColor(ctx.despues, columna.id, "609");
      assert.ok(Math.abs(rosado - 60) <= 8, `el rosado pastel tenía que ser ~60 % y es ${rosado.toFixed(0)} %`);
      assert.ok(Math.abs(porcentajeDeColor(ctx.despues, columna.id, DORADO) - 40) <= 8, "el dorado ~40 %");
      assert.match(ctx.llamadas[0]!.resumen, /inclinada/i, "la herramienta dice que quedó inclinada");
    },
  },
  {
    area: "organico",
    frase: "semiarco orgánico con globos R-9 mayoría y R-24",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "semiarco_organico", colores: ["verde", "blanco"], tamanos: ["R-9", "R-24"] })]],
    comprobar: (ctx) => {
      const semiarco = unicoNuevo(ctx);
      const r9 = globosDeFormato(ctx.despues, semiarco.id, "R-9");
      const r24 = globosDeFormato(ctx.despues, semiarco.id, "R-24");
      assert.ok(r24 > 0, "lleva R-24");
      assert.ok(r9 > r24 * 3, `los R-9 son mayoría (R-9 ${r9}, R-24 ${r24})`);
      assert.deepEqual([...inventarioDe(ctx.despues, semiarco.id).porFormato.keys()].sort(), ["R-24", "R-9"], "solo esos dos tamaños");
    },
  },
  {
    area: "organico",
    frase: "un arco orgánico 70 % blanco, 20 % dorado y 10 % rosado",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "arco_organico", colores: ["blanco", "dorado", "rosado"], pesos: [70, 20, 10] })]],
    comprobar: (ctx) => {
      const arco = unicoNuevo(ctx);
      for (const [codigo, esperado] of [[BLANCO, 70], [DORADO, 20], ["009", 10]] as const) {
        const real = porcentajeDeColor(ctx.despues, arco.id, codigo);
        assert.ok(Math.abs(real - esperado) <= 8, `el color ${codigo} tenía que ser ~${esperado} % y es ${real.toFixed(0)} %`);
      }
    },
  },
  {
    area: "organico",
    frase: "ponle flores al arco",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "arco", flores: true })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      const floresDe = (escena: Escena) => (nodoDe(escena, "arco").pieza as { arco?: { flores?: unknown } }).arco?.flores;
      assert.ok(!floresDe(ctx.antes), "el arco empezaba sin flores");
      assert.ok(floresDe(ctx.despues), "el arco tiene que quedar con flores");
      assert.match(ctx.llamadas[0]!.resumen, /con flores/);
      assert.deepEqual(codigosDe(ctx.despues, "arco").sort(), codigosDe(ctx.antes, "arco").sort(), "los colores no cambian");
    },
  },
  {
    area: "organico",
    frase: "hazme la guirnalda con R12 en vez de R9",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "guirnalda", formato: "R-12" })]],
    sumaSola: false,
    tocables: ["guirnalda"],
    comprobar: (ctx) => {
      assert.equal((nodoDe(ctx.despues, "guirnalda").pieza as { guirnalda?: { formatoId?: string } }).guirnalda?.formatoId, "R-12");
      assert.ok(globosDeFormato(ctx.despues, "guirnalda", "R-12") > 0 && globosDeFormato(ctx.despues, "guirnalda", "R-9") === 0, "la guirnalda queda toda en R-12");
    },
  },
  {
    area: "organico",
    frase: "quita el arco",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("quitar_pieza", { id: "arco" })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length - 1, "se quita una sola pieza");
      assert.ok(!ctx.despues.nodos.some((n) => n.id === "arco"), "el arco ya no está");
      assert.ok(ctx.despues.nodos.some((n) => n.id === "columna-izq") && ctx.despues.nodos.some((n) => n.id === "columna-der"), "las columnas se quedan");
    },
  },
  {
    area: "organico",
    frase: "una guirnalda orgánica en esquina con monstera",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "trazo_organico", silueta: "esquina_derecha", colores: ["verde", "blanco"], follaje: ["monstera"] })]],
    comprobar: (ctx) => {
      const trazo = unicoNuevo(ctx);
      const pieza = trazo.pieza as { tipo: string; generador?: { trazo?: { silueta?: string } } };
      assert.equal(pieza.tipo, "organico");
      assert.equal(pieza.generador?.trazo?.silueta, "esquina_derecha");
      assert.ok(idsNuevos(ctx).length === 1, "una sola pieza nueva");
    },
  },
];
