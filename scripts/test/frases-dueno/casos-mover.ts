/** Frases del dueño sobre mover, girar, alinear, copiar y colgar decoraciones de otras piezas (anclas). */
import assert from "node:assert/strict";
import type { NodoEscena } from "../../../src/lib/globos3d/escena";
import { codigosDe, llamar, nodoDe, unicoNuevo, type Caso } from "./motor";

const DORADO = "570";
const xDe = (n: NodoEscena): number => {
  assert.ok("xCm" in n.colocacion, `${n.id} no está en el piso`);
  return n.colocacion.xCm;
};
const sobreDe = (n: NodoEscena) => (n.colocacion.en === "sobre" ? n.colocacion : assert.fail(`${n.id} no va sobre otra pieza`));

export const CASOS_MOVER: Caso[] = [
  {
    area: "mover",
    frase: "pon una flor sobre la columna izquierda a 1,5 m de altura",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 150 })]],
    comprobar: (ctx) => {
      const flor = unicoNuevo(ctx);
      assert.equal(sobreDe(flor).padreId, "columna-izq");
      assert.ok(Math.abs(sobreDe(flor).puntoCm.y - 150) <= 20, `la flor tiene que estar a ~150 cm: ${sobreDe(flor).puntoCm.y}`);
      assert.deepEqual(nodoDe(ctx.despues, "columna-izq"), nodoDe(ctx.antes, "columna-izq"), "la columna no se toca");
    },
  },
  {
    area: "mover",
    frase: "agrega 3 flores doradas a la columna",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[
      llamar("poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 100, angulo_grados: 0, colores: ["dorado"] }),
      llamar("poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 100, angulo_grados: 120, colores: ["dorado"] }),
      llamar("poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 100, angulo_grados: 240, colores: ["dorado"] }),
    ]],
    comprobar: (ctx) => {
      const flores = ctx.despues.nodos.filter((n) => n.pieza.tipo === "decoracion");
      assert.equal(flores.length, 3, "tres flores nuevas");
      for (const f of flores) {
        assert.equal(sobreDe(f).padreId, "columna-izq");
        assert.ok(codigosDe(ctx.despues, f.id).includes(DORADO), `${f.id} es dorada`);
      }
      const puntos = new Set(flores.map((f) => `${sobreDe(f).puntoCm.x.toFixed(0)},${sobreDe(f).puntoCm.z.toFixed(0)}`));
      assert.equal(puntos.size, 3, "repartidas alrededor de la columna, no una encima de otra");
    },
  },
  {
    area: "mover",
    frase: "las flores de la columna izquierda pásalas a la derecha",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [
      [
        llamar("poner_sobre", { decoracion_id: "flor5", padre_id: "columna-izq", altura_cm: 150 }),
        llamar("poner_sobre", { decoracion_id: "flor4", padre_id: "columna-izq", altura_cm: 100 }),
      ],
      [llamar("mover_sobre", { id: "flor5", padre_id: "columna-der", altura_cm: 150 }), llamar("mover_sobre", { id: "flor4", padre_id: "columna-der", altura_cm: 100 })],
    ],
    comprobar: (ctx) => {
      const flores = ctx.despues.nodos.filter((n) => n.pieza.tipo === "decoracion");
      assert.equal(flores.length, 2, "se mueven, no se duplican");
      assert.ok(flores.every((f) => sobreDe(f).padreId === "columna-der"), "las dos pasaron a la columna derecha");
    },
  },
  {
    area: "mover",
    frase: "sube la guirnalda 20 cm",
    base: "arco_organico_columnas_guirnalda",
    // La sala de 3,2 m no deja subirla 20 cm (ver la frase en honestidad): con el techo más alto sí.
    vueltas: [[llamar("cambiar_sala", { alto_cm: 400 })], [llamar("mover_pieza", { id: "guirnalda", donde: { en: "pared", altura_cm: 260 } })]],
    sumaSola: false,
    tocables: ["guirnalda"],
    comprobar: (ctx) => {
      const c = nodoDe(ctx.despues, "guirnalda").colocacion;
      assert.ok(c.en === "pared" && c.alturaCm === 260, "de 240 a 260 cm");
      assert.ok(c.en === "pared" && c.aLoLargoCm === 0 && c.pared === "fondo", "sigue centrada en la pared del fondo");
    },
  },
  {
    area: "mover",
    frase: "mueve el arco 50 cm a la derecha",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("mover_pieza", { id: "arco", donde: { en: "piso", x_cm: 50 } })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      const c = nodoDe(ctx.despues, "arco").colocacion;
      assert.ok(c.en === "piso" && c.xCm === 50 && c.zCm === -150, "x = 50 y conserva su z");
    },
  },
  {
    area: "mover",
    frase: "gira la columna izquierda 45 grados",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("girar_pieza", { id: "columna-izq", grados: 45 })]],
    sumaSola: false,
    tocables: ["columna-izq"],
    comprobar: (ctx) => {
      const c = nodoDe(ctx.despues, "columna-izq").colocacion;
      assert.ok(c.en === "piso" && c.giroGrados === 45 && c.xCm === -225, "gira 45° sin moverse");
    },
  },
  {
    area: "mover",
    frase: "pon las dos columnas en fila con 1 m de separación",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("alinear", { grupo: "las dos columnas", como: ["fila"], separacion_cm: 100, centro_x_cm: 0 })]],
    sumaSola: false,
    tocables: ["columna-izq", "columna-der"],
    comprobar: (ctx) => {
      const izq = xDe(nodoDe(ctx.despues, "columna-izq")), der = xDe(nodoDe(ctx.despues, "columna-der"));
      assert.ok(Math.abs(izq + der) <= 1, `centradas en x = 0: ${izq} ${der}`);
      assert.ok(der - izq > 100 && der - izq < 200, `un metro de borde a borde: ${der - izq} cm entre centros`);
      assert.deepEqual(nodoDe(ctx.despues, "arco"), nodoDe(ctx.antes, "arco"), "el arco no se mueve");
    },
  },
  {
    area: "mover",
    frase: "centra el arco en la pared",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("mover_pieza", { id: "arco", donde: { en: "piso", x_cm: 80 } })], [llamar("alinear", { ids: ["arco"], como: ["centrar"] })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      assert.ok(Math.abs(xDe(nodoDe(ctx.despues, "arco"))) <= 1, "el arco queda en x = 0");
    },
  },
  {
    area: "mover",
    frase: "haz una copia de la columna izquierda al otro lado del arco, en espejo",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("quitar_pieza", { id: "columna-der" })], [llamar("espejar", { id: "columna-izq", respecto_id: "arco" })]],
    sumaSola: false,
    tocables: ["columna-der"],
    comprobar: (ctx) => {
      const copia = nodoDe(ctx.despues, "columna-der");
      assert.equal(xDe(copia), 225, "al otro lado del arco, a la misma distancia");
      assert.equal(copia.nombre, "Columna derecha");
      assert.deepEqual(nodoDe(ctx.despues, "columna-izq"), nodoDe(ctx.antes, "columna-izq"), "la original no se toca");
    },
  },
  {
    area: "mover",
    frase: "duplica la columna izquierda",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("duplicar_pieza", { id: "columna-izq", donde: { en: "piso", x_cm: -100, z_cm: -150 } })]],
    comprobar: (ctx) => {
      const copia = unicoNuevo(ctx);
      assert.equal(xDe(copia), -100);
      assert.deepEqual(codigosDe(ctx.despues, copia.id), codigosDe(ctx.despues, "columna-izq"), "con los mismos colores");
      assert.deepEqual(copia.pieza, nodoDe(ctx.despues, "columna-izq").pieza, "con las mismas medidas");
    },
  },
  {
    area: "mover",
    frase: "reparte las flores del techo parejas de -2 m a 2 m",
    base: "techo_racimos",
    vueltas: [[llamar("distribuir", { grupo: "las flores del techo", desde_x_cm: -200, hasta_x_cm: 200 })]],
    sumaSola: false,
    tocables: ["flor-1", "flor-2", "flor-3", "flor-4", "flor-5"],
    comprobar: (ctx) => {
      const xs = ctx.despues.nodos.filter((n) => n.id.startsWith("flor-")).map(xDe).sort((a, b) => a - b);
      assert.deepEqual(xs, [-200, -100, 0, 100, 200], "cinco flores equidistantes");
    },
  },
];
