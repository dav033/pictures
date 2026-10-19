/** Frases del dueño sobre tamaños de globo (los R-24, R-5…), densidad y medidas de las piezas. */
import assert from "node:assert/strict";
import type { Escena } from "../../../src/lib/globos3d/escena";
import { comprobarTodos } from "../banco-escena-ia";
import { globosDeFormato, inventarioDe, llamar, medidasDe, nodoDe, porcentajeDeColor, type Caso } from "./motor";

const ARCO = "arco";
/** Cuántos R-24 y R-5 tiene el arco orgánico de partida (4 y 192). */
const R24_INICIAL = 4;
const R5_INICIAL = 192;

export const CASOS_TAMANOS: Caso[] = [
  {
    area: "tamanos",
    frase: "más tupida",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, densidad: "mas" })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      const antes = inventarioDe(ctx.antes, ARCO).total;
      const ahora = inventarioDe(ctx.despues, ARCO).total;
      assert.ok(ahora > antes, `el arco no quedó más tupido: ${antes} → ${ahora} globos`);
      assert.match(ctx.llamadas[0]!.resumen, new RegExp(`${antes} → ${ahora} globos`), "la herramienta cuenta cuántos globos había y cuántos hay");
    },
  },
  {
    area: "tamanos",
    frase: "más R-24",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-24", accion: "mas" }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      const ahora = globosDeFormato(ctx.despues, ARCO, "R-24");
      assert.ok(ahora >= Math.ceil(R24_INICIAL * 1.6), `«más» es al menos +60 %: de ${R24_INICIAL} R-24 a ${ahora}`);
      assert.match(ctx.llamadas[0]!.resumen, /R-24: 4 → \d+/, "dice cuántos había y cuántos hay");
    },
  },
  {
    area: "tamanos",
    frase: "más R-5",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-5", accion: "mas" }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      assert.ok(globosDeFormato(ctx.despues, ARCO, "R-5") > R5_INICIAL, "tiene que haber más R-5 que los 192 de antes");
    },
  },
  {
    area: "tamanos",
    frase: "quita los R-5",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-5", accion: "quitar" }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      assert.equal(globosDeFormato(ctx.despues, ARCO, "R-5"), 0, "no queda ningún R-5");
      assert.ok(globosDeFormato(ctx.despues, ARCO, "R-24") > 0 && globosDeFormato(ctx.despues, ARCO, "R-18") > 0, "los demás tamaños se quedan");
    },
  },
  {
    area: "tamanos",
    frase: "un 40 % de R-18",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-18", accion: "poner", porcentaje: 40 }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      assert.match(ctx.llamadas[0]!.resumen, /→ 40 % de la estructura/, "la herramienta cuenta el porcentaje al que llegó");
      assert.ok(globosDeFormato(ctx.despues, ARCO, "R-18") > globosDeFormato(ctx.antes, ARCO, "R-18") * 1.5, "los R-18 subieron mucho");
    },
  },
  {
    area: "tamanos",
    frase: "que tenga 6 R-24",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-24", accion: "poner", cantidad: 6 }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      assert.equal(globosDeFormato(ctx.despues, ARCO, "R-24"), 6, "exactamente 6 R-24");
    },
  },
  {
    area: "tamanos",
    frase: "los R-24 solo abajo",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-24", accion: "poner", cantidad: 6, donde: "abajo", solo_ahi: true }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      assert.equal(globosDeFormato(ctx.despues, ARCO, "R-24"), 6);
      assert.match(ctx.llamadas[0]!.resumen, /abajo/, "la herramienta dice que los puso abajo");
    },
  },
  {
    area: "tamanos",
    frase: "menos globos chicos",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-9", accion: "menos" }, { formato: "R-5", accion: "menos" }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      // Al sacar R-5 quedan huecos y el relleno de huecos los tapa con R-9: pueden quedar más R-9, pero los chicos en conjunto tienen que bajar, y la herramienta lo explica.
      const chicos = (escena: Escena) => globosDeFormato(escena, ARCO, "R-9") + globosDeFormato(escena, ARCO, "R-5");
      assert.ok(chicos(ctx.despues) < chicos(ctx.antes) * 0.85, `los chicos (R-9 + R-5) no bajaron: ${chicos(ctx.antes)} → ${chicos(ctx.despues)}`);
      assert.ok(globosDeFormato(ctx.despues, ARCO, "R-5") < R5_INICIAL * 0.7, "los R-5 bajaron");
      assert.match(ctx.llamadas[0]!.resumen, /relleno de huecos/, "si quedaron más de los que se pidió, la herramienta explica que es relleno");
      assert.equal(globosDeFormato(ctx.despues, ARCO, "R-24"), globosDeFormato(ctx.antes, ARCO, "R-24"), "los grandes no se tocan");
    },
  },
  {
    area: "tamanos",
    frase: "que los grandes sean azules",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, colores_por_tamano: [{ formatos: ["R-24"], colores: ["azul reflex"], exclusivo: true }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      const { porColor } = inventarioDe(ctx.despues, ARCO);
      assert.equal(porColor.get("940"), globosDeFormato(ctx.despues, ARCO, "R-24"), "todos los R-24, y solo ellos, quedan en azul reflex (940)");
      assert.equal(globosDeFormato(ctx.despues, ARCO, "R-24"), globosDeFormato(ctx.antes, ARCO, "R-24"), "cambiar el color no cambia cuántos R-24 hay");
    },
  },
  {
    area: "tamanos",
    frase: "todos los globos grandes deben ser reflex rojo y los más pequeños amarillo fashion del arco orgánico",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, colores_por_tamano: [
      { formatos: ["R-24", "R-18"], colores: ["rojo reflex"], exclusivo: true },
      { formatos: ["R-12", "R-9", "R-5"], colores: ["amarillo fashion"], exclusivo: true },
    ] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      const { porColor, total } = inventarioDe(ctx.despues, ARCO);
      const rojo = porColor.get("915") ?? 0;
      const grandes = globosDeFormato(ctx.despues, ARCO, "R-24") + globosDeFormato(ctx.despues, ARCO, "R-18");
      assert.equal(rojo, grandes, "los R-24 y R-18, y solo ellos, en reflex rojo");
      assert.equal(total - rojo, total - grandes, "el resto no es rojo");
      assert.ok(porcentajeDeColor(ctx.despues, ARCO, "020") > 80, "los chicos quedan en amarillo fashion");
    },
  },
  {
    area: "tamanos",
    frase: "haz las columnas de 2,2 m",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "columna-izq", alto_cm: 220 }), llamar("cambiar_pieza", { id: "columna-der", alto_cm: 220 })]],
    sumaSola: false,
    tocables: ["columna-izq", "columna-der"],
    comprobar: (ctx) => {
      for (const id of ["columna-izq", "columna-der"]) {
        assert.equal((nodoDe(ctx.despues, id).pieza as { alturaCm?: number }).alturaCm, 220, `${id} mide 2,2 m`);
        assert.deepEqual(nodoDe(ctx.despues, id).colocacion, nodoDe(ctx.antes, id).colocacion, `${id} sigue en su sitio`);
      }
    },
  },
  {
    area: "tamanos",
    frase: "baja la columna a un metro",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "columna-izq", alto_cm: 100 })]],
    sumaSola: false,
    tocables: ["columna-izq"],
    comprobar: (ctx) => {
      assert.equal((nodoDe(ctx.despues, "columna-izq").pieza as { alturaCm?: number }).alturaCm, 100);
      assert.equal((nodoDe(ctx.despues, "columna-der").pieza as { alturaCm?: number }).alturaCm, 180, "la otra columna no se toca");
    },
  },
  {
    area: "tamanos",
    frase: "hazlo más ancho, de 4 metros",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: ARCO, ancho_cm: 400 })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      const { anchoCm } = medidasDe(ctx.despues, ARCO);
      assert.ok(anchoCm >= 380 && anchoCm <= 470, `el arco tiene que medir unos 4 m de ancho (con globos) y mide ${Math.round(anchoCm)} cm`);
      assert.ok(anchoCm > medidasDe(ctx.antes, ARCO).anchoCm + 60, "es bastante más ancho que antes");
    },
  },
  {
    area: "tamanos",
    frase: "reduce la densidad de la estructura",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, densidad: "menos" })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      assert.ok(inventarioDe(ctx.despues, ARCO).total < inventarioDe(ctx.antes, ARCO).total * 0.85, "lleva claramente menos globos");
    },
  },
  {
    area: "tamanos",
    frase: "columna orgánica verde con globos R-5 y R-24",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna_organica", colores: ["verde"], tamanos: ["R-5", "R-24"] })]],
    comprobar: (ctx) => {
      const columna = ctx.despues.nodos[0]!;
      // El verde Fashion no se fabrica en R-24: la columna sale solo con R-5 y la persona se tiene que enterar.
      assert.equal(globosDeFormato(ctx.despues, columna.id, "R-24"), 0);
      assert.match(ctx.respuesta, /Aviso:.*Pediste R-24.*ningún color de la paleta se fabrica en ese tamaño/, "el R-24 que se quitó llega a la respuesta aunque el modelo diga «Listo»");
    },
  },
  {
    area: "tamanos",
    frase: "haz que sean globos R-5 con R-24 (blanco, que sí viene en R-24)",
    base: "vacia",
    vueltas: [[llamar("agregar_pieza", { tipo: "semiarco_organico", colores: ["blanco"], tamanos: ["R-5", "R-24"] })]],
    comprobar: (ctx) => {
      const pieza = ctx.despues.nodos[0]!;
      assert.ok(globosDeFormato(ctx.despues, pieza.id, "R-24") > 0 && globosDeFormato(ctx.despues, pieza.id, "R-5") > 0, "lleva los dos tamaños");
      assert.doesNotMatch(ctx.respuesta, /Aviso|No pude/, "no hay nada que avisar");
    },
  },
  {
    area: "tamanos",
    frase: "más R-24 solo en la pata izquierda del arco",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: ARCO, cambios: [{ formato: "R-24", accion: "mas", donde: "izquierda" }] })]],
    sumaSola: false,
    tocables: [ARCO],
    comprobar: (ctx) => {
      const fallos = comprobarTodos(ctx.antes, ctx.despues, [
        { tipo: "conteo", en: { ids: [ARCO] }, selector: { formatos: ["R-24"], partes: ["pata/izquierda"] }, compara: "aumenta_pct", valor: 50 },
        { tipo: "solo_cambian_globos", id: ARCO, selector: { partes: ["pata/izquierda"] } },
      ]);
      assert.deepEqual(fallos, [], "solo la pata izquierda cambia");
    },
    fallaCon: /solo la pata izquierda cambia/,
    fallaEsperada: "el motor orgánico arma las dos patas con UN solo azar y UN solo reparto de colores por cuotas: al subir los R-24 de una pata cambian el relleno, los R-9 y los colores de la otra (banco-escena-ia estilo-30)",
  },
  {
    area: "tamanos",
    frase: "ponle globos R-24 a la columna orgánica verde (cambiar_pieza)",
    base: "vacia",
    textoModelo: "Listo, la columna lleva R-24.",
    vueltas: [
      [llamar("agregar_pieza", { tipo: "columna_organica", colores: ["verde"], tamanos: ["R-12", "R-5"] })],
      [llamar("cambiar_pieza", { id: "columna-organica", tamanos: ["R-5", "R-24"] })],
    ],
    sumaSola: false,
    tocables: ["columna-organica"],
    comprobar: (ctx) => {
      assert.equal(globosDeFormato(ctx.despues, "columna-organica", "R-24"), 0, "el verde Fashion no se fabrica en R-24");
      assert.match(ctx.respuesta, /Aviso:.*Pediste R-24.*ningún color de la paleta se fabrica en ese tamaño/, "aunque el modelo diga que lleva R-24");
    },
  },
  {
    area: "tamanos",
    frase: "cambia la columna por una orgánica verde con R-5 y R-24 (reemplazar_pieza)",
    base: "arco_organico_columnas_guirnalda",
    textoModelo: "Listo, la columna ahora es orgánica con R-24.",
    vueltas: [[llamar("reemplazar_pieza", { id: "columna-izq", tipo: "columna_organica", colores: ["verde"], tamanos: ["R-5", "R-24"] })]],
    sumaSola: false,
    tocables: ["columna-izq"],
    comprobar: (ctx) => {
      assert.equal(globosDeFormato(ctx.despues, "columna-izq", "R-24"), 0);
      assert.match(ctx.respuesta, /Aviso:.*Pediste R-24.*ese tamaño/);
    },
  },
  {
    area: "tamanos",
    frase: "ponle R-24 a la columna verde otra vez (ya estaba así: el aviso se mantiene)",
    base: "vacia",
    textoModelo: "Listo, ya lo tenía.",
    vueltas: [
      [llamar("agregar_pieza", { tipo: "columna_organica", colores: ["verde"], tamanos: ["R-5", "R-24"] })],
      [llamar("cambiar_pieza", { id: "columna-organica", tamanos: ["R-5", "R-24"] })],
    ],
    sumaSola: false,
    tocables: ["columna-organica"],
    comprobar: (ctx) => {
      assert.match(ctx.llamadas[1]!.resumen, /ya estaba así/, "el segundo pedido no cambia nada");
      assert.ok(ctx.llamadas[1]!.avisos.some((a) => /Pediste R-24/.test(a.texto)), "y aun así la herramienta devuelve el aviso, no solo la nota del resumen");
    },
  },
];
