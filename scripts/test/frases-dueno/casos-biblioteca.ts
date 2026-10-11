/** Frases del dueño que piden algo de la biblioteca (ideas, estructuras con decoraciones) o del catálogo de mobiliario y escenografía. */
import assert from "node:assert/strict";
import { codigosDe, llamar, medidasDe, nodoDe, nuevosDe, unicoNuevo, type Caso } from "./motor";

const ARCO_DE_LA_BIBLIOTECA = "escena:arco_organico_columnas_guirnalda~arco";
const COLUMNA_CON_FLORES = "base-organica:columna-pastel-flores-de-globo";
const DORADO = "570";

type PiezaConFlores = { arco?: { flores?: unknown; altoCm?: number } };

export const CASOS_BIBLIOTECA: Caso[] = [
  {
    area: "biblioteca",
    frase: "toma el arco orgánico 1 de la biblioteca y hazlo más alto, en dorado y con flores",
    base: "vacia",
    biblioteca: [ARCO_DE_LA_BIBLIOTECA, "base-organica:arco-cromado-negro-oro-plata"],
    vueltas: [
      [llamar("buscar_en_biblioteca", { texto: "arco orgánico" })],
      [llamar("insertar_de_biblioteca", { id: ARCO_DE_LA_BIBLIOTECA, nombre: "Arco de la biblioteca", donde: { en: "piso", x_cm: 0, z_cm: -150 } })],
      [llamar("cambiar_pieza", { id: "arco-organico", alto_cm: 300, colores: ["dorado"], flores: true })],
    ],
    comprobar: (ctx) => {
      const arco = unicoNuevo(ctx);
      assert.equal(arco.pieza.tipo, "arco_organico", "queda como pieza normal y editable");
      assert.deepEqual(codigosDe(ctx.despues, arco.id), [DORADO], "dorado");
      const pieza = arco.pieza as PiezaConFlores;
      assert.ok(pieza.arco?.flores, "con flores");
      assert.ok((pieza.arco?.altoCm ?? 0) >= 280, `más alto que los 240 de la biblioteca: ${pieza.arco?.altoCm}`);
      assert.deepEqual(ctx.llamadas[0]!.avisos, [], "la búsqueda no cambia nada");
    },
  },
  {
    area: "biblioteca",
    frase: "usa como base la columna con flores de la biblioteca: ponla a la derecha del arco, en rojo y blanco y de 2,2 m",
    base: "vacia",
    biblioteca: [COLUMNA_CON_FLORES],
    vueltas: [
      [llamar("agregar_pieza", { tipo: "arco_organico", ancho_cm: 300, colores: ["rosado pastel", "blanco"], donde: { en: "piso", x_cm: 0, z_cm: -150 } })],
      [llamar("buscar_en_biblioteca", { texto: "columna con flores", tipo_pieza: "organico" })],
      [llamar("insertar_de_biblioteca", { id: COLUMNA_CON_FLORES, donde: { en: "piso", x_cm: 225, z_cm: -150 } })],
      [llamar("cambiar_pieza", { id: "organico", alto_cm: 220, colores: ["rojo", "blanco"] })],
    ],
    sumaSola: true,
    comprobar: (ctx) => {
      const nuevos = nuevosDe(ctx).filter((n) => n.id !== "arco-organico");
      assert.equal(nuevos.length, 4, "la columna trae sus 3 decoraciones: 4 piezas normales");
      const columna = nuevos.find((n) => n.pieza.tipo === "organico") ?? assert.fail("falta la columna orgánica");
      assert.deepEqual([...codigosDe(ctx.despues, columna.id)].sort(), ["005", "015"].sort(), "rojo y blanco");
      assert.ok(Math.abs(medidasDe(ctx.despues, columna.id).altoCm - 220) <= 12, "mide unos 2,2 m");
      assert.deepEqual(columna.colocacion, { en: "piso", xCm: 225, zCm: -150, giroGrados: 0 }, "a la derecha del arco de 3 m");
      assert.ok(nuevos.filter((n) => n.colocacion.en === "sobre").every((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === columna.id), "las flores acompañan a la columna");
    },
  },
  {
    area: "biblioteca",
    frase: "busca ideas de cumpleaños en rosado",
    base: "arco_organico_columnas_guirnalda",
    biblioteca: ["idea:cumpleanos-violeta-y-plata", "idea:bautizo-unisex"],
    vueltas: [[llamar("buscar_en_biblioteca", { ocasion: "cumpleanos", colores: ["rosado"] })]],
    comprobar: (ctx) => {
      assert.equal(ctx.despues, ctx.antes, "buscar no toca la escena");
      assert.match(ctx.llamadas[0]!.resumen, /idea:cumpleanos-violeta-y-plata/, "el resultado lista los ids para insertar");
      assert.equal(ctx.llamadas[0]!.consulta, true);
    },
  },
  {
    area: "biblioteca",
    frase: "pon un panel redondo",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_mobiliario", { id: "panel_redondo", x_cm: 0, z_cm: -235 })]],
    comprobar: (ctx) => {
      const panel = unicoNuevo(ctx);
      assert.equal(panel.pieza.tipo, "escenografia");
      assert.match(ctx.llamadas[0]!.resumen, /158×7×189 cm/, "con las medidas del catálogo");
    },
  },
  {
    area: "biblioteca",
    frase: "cambia el panel redondo a rosa",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [
      [llamar("agregar_mobiliario", { id: "panel_redondo", x_cm: 0, z_cm: -235 })],
      [llamar("cambiar_pieza", { id: "panel-redondo", colores: ["rosado"] })],
    ],
    comprobar: (ctx) => {
      const panel = nodoDe(ctx.despues, "panel-redondo");
      assert.match(JSON.stringify(panel.pieza), /#f0b8c8/i, "el fondo del panel queda rosa");
      assert.match(ctx.llamadas[1]!.resumen, /escenografía, sin globos/);
    },
  },
  {
    area: "biblioteca",
    frase: "toma de la biblioteca una mesa imperial",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_mobiliario", { id: "mesa_imperial", x_cm: 100, z_cm: 100 })]],
    comprobar: (ctx) => {
      const mesa = unicoNuevo(ctx);
      assert.equal(mesa.id, "mesa-imperial");
      assert.match(ctx.llamadas[0]!.resumen, /240×90×75 cm/);
    },
  },
];
