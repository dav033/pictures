/** Frases del dueño sobre el salón y el mobiliario: mesas, sillas, centros de mesa, medidas de la sala y zonas. */
import assert from "node:assert/strict";
import { centrosDe } from "../../../src/lib/globos3d/centros-mesa";
import { contarMobiliario } from "../../../src/lib/globos3d/mobiliario-asientos-mesa";
import { llamar, nodoDe, type Caso, type Contexto } from "./motor";

const SALA_GRANDE = { ancho_cm: 1200, fondo_cm: 1000 };
const AGRANDAR_SALA = llamar("cambiar_sala", SALA_GRANDE);
const mesasRedondas = (ctx: Contexto) => ctx.despues.nodos.filter((n) => n.id.startsWith("mesa-redonda"));
/** El color de la estructura de un grupo de sillas, como #rrggbb. */
const colorDeSillas = (pieza: unknown): string => {
  const hex = (pieza as { mueble?: { sillas?: { colorEstructura?: string } } }).mueble?.sillas?.colorEstructura;
  assert.ok(hex && /^#[0-9a-f]{6}$/i.test(hex), "el grupo de sillas no trae color");
  return hex;
};
/** Las mesas de invitados del salón (la de postres y la principal también son mesas, pero no son de invitados). */
const mesasDeInvitados = (ctx: Contexto) => ctx.despues.nodos.filter((n) => /^salon-mesa(-\d+)?$/.test(n.id));
const centrosNuevos = (ctx: Contexto) => centrosDe(ctx.despues);

export const CASOS_SALON: Caso[] = [
  {
    area: "salon",
    frase: "6 mesas redondas con 4 sillas cada una",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[AGRANDAR_SALA, llamar("agregar_mesas", { cantidad: 6, tipo: "redonda", sillas_por_mesa: 4, columnas: 3 })]],
    tocables: [],
    comprobar: (ctx) => {
      assert.equal(mesasRedondas(ctx).length, 6, "tienen que quedar 6 mesas redondas");
      assert.deepEqual(contarMobiliario(ctx.despues), { mesas: 6, sillas: 24 }, "6 mesas con 4 sillas son 24 sillas");
      const sillas = ctx.despues.nodos.filter((n) => n.nombre.startsWith("Silla") && n.colocacion.en === "sobre");
      assert.equal(sillas.length, 6, "cada mesa lleva su grupo de sillas");
      for (const silla of sillas) {
        const pieza = silla.pieza as { mueble?: { sillas?: { pedida?: number; puestos?: unknown[] } } };
        assert.equal(pieza.mueble?.sillas?.pedida, 4, `${silla.id}: tiene que pedir 4 sillas`);
        assert.equal(pieza.mueble?.sillas?.puestos?.length, 4, `${silla.id}: tiene que tener 4 puestos`);
      }
    },
  },
  {
    area: "salon",
    frase: "6 mesas redondas con 4 sillas cada una (en la sala chica: no caben y lo dice)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_mesas", { cantidad: 6, tipo: "redonda", sillas_por_mesa: 4 })]],
    // Las mesas se ponen aunque se salgan: lo que no puede pasar es callarlo.
    comprobar: (ctx) => {
      assert.equal(mesasRedondas(ctx).length, 6);
      const aviso = ctx.llamadas[0]!.avisos.map((a) => a.texto).join(" ");
      assert.match(aviso, /se salen de la sala/, "la herramienta tiene que avisar que las mesas no caben");
      assert.match(ctx.respuesta, /se salen de la sala/, "el aviso de que no caben tiene que llegar a la respuesta aunque el modelo diga «Listo»");
    },
    fueraDeSala: true,
  },
  {
    area: "salon",
    frase: "pon un centro de mesa en cada mesa",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [
      [AGRANDAR_SALA, llamar("agregar_mesas", { cantidad: 6, tipo: "redonda", sillas_por_mesa: 4, columnas: 3 })],
      [llamar("decorar_mesas", { disenos: [{ tipo: "ramo_helio" }] })],
    ],
    tocables: [],
    comprobar: (ctx) => {
      const mesas = mesasRedondas(ctx).map((n) => n.id);
      assert.equal(mesas.length, 6, "las 6 mesas siguen");
      assert.equal(centrosDe(ctx.antes).length, 0, "la sala de partida no tiene centros");
      // Solo cuentan los centros: las sillas también van «sobre» la mesa y harían que esto pasara sin que hubiera ni un centro.
      const padres = centrosNuevos(ctx).map((n) => (n.colocacion.en === "sobre" ? n.colocacion.padreId : ""));
      assert.deepEqual([...padres].sort(), [...mesas].sort(), "cada mesa tiene que llevar su centro, ni más ni menos");
    },
  },
  {
    area: "salon",
    frase: "pon un centro de mesa en cada mesa (del salón armado, sin tocar los postres)",
    base: "salon-armado",
    vueltas: [[llamar("decorar_mesas", { disenos: [{ tipo: "ramo_helio" }], grupo: "invitados" })]],
    comprobar: (ctx) => {
      const mesas = mesasDeInvitados(ctx).map((n) => n.id);
      assert.equal(mesas.length, 4);
      const padres = centrosNuevos(ctx).map((n) => (n.colocacion.en === "sobre" ? n.colocacion.padreId : ""));
      assert.deepEqual([...padres].sort(), [...mesas].sort(), "un centro por cada mesa de invitados");
    },
  },
  {
    area: "salon",
    frase: "quita los centros de mesa",
    base: "salon-armado",
    vueltas: [
      [llamar("decorar_mesas", { disenos: [{ tipo: "ramo_helio" }], grupo: "invitados" })],
      [llamar("quitar_centros", {})],
    ],
    comprobar: (ctx) => {
      assert.equal(centrosNuevos(ctx).length, 0, "no queda ningún centro");
      assert.equal(contarMobiliario(ctx.despues).mesas, contarMobiliario(ctx.antes).mesas, "las mesas se quedan");
    },
  },
  {
    area: "salon",
    frase: "haz el salón más grande",
    base: "salon-armado",
    vueltas: [[llamar("ajustar_salon", (escena) => ({ ancho_cm: escena.sala.anchoCm + 500, fondo_cm: escena.sala.fondoCm + 500 }))]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.ok(ctx.despues.sala.anchoCm > ctx.antes.sala.anchoCm && ctx.despues.sala.fondoCm > ctx.antes.sala.fondoCm, "la sala tiene que crecer");
      assert.deepEqual(contarMobiliario(ctx.despues), contarMobiliario(ctx.antes), "agrandar el salón no cambia las mesas ni las sillas");
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length, "agrandar el salón no agrega ni quita piezas");
      // La decoración del usuario sigue al fondo de fotos: se corre con la pared del fondo y conserva su distancia a ella.
      const distanciaAlFondo = (e: typeof ctx.antes, id: string) => {
        const c = nodoDe(e, id).colocacion;
        assert.ok(c.en === "piso", `${id} sigue en el piso`);
        return c.zCm + e.sala.fondoCm / 2;
      };
      for (const id of ["arco", "columna-izq", "columna-der"]) {
        assert.equal(Math.round(distanciaAlFondo(ctx.despues, id)), Math.round(distanciaAlFondo(ctx.antes, id)), `${id} perdió su distancia a la pared del fondo`);
      }
    },
  },
  {
    area: "salon",
    frase: "agranda la sala a 12 metros de ancho",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_sala", { ancho_cm: 1200 })]],
    comprobar: (ctx) => {
      assert.equal(ctx.despues.sala.anchoCm, 1200);
      assert.equal(ctx.despues.sala.fondoCm, ctx.antes.sala.fondoCm, "el fondo no se pidió");
    },
  },
  {
    area: "salon",
    frase: "quiero un salón para 40 invitados con mesas de 8",
    base: "vacia",
    vueltas: [[llamar("armar_salon", { invitados: 40, sillas_por_mesa: 8 })]],
    comprobar: (ctx) => {
      assert.equal(mesasDeInvitados(ctx).length, 5, "40 invitados de a 8 son 5 mesas");
      assert.equal(contarMobiliario(ctx.despues).sillas, 40, "5 mesas de 8 son 40 sillas");
      assert.ok(ctx.despues.nodos.some((n) => n.id === "salon-postres"), "el salón trae la mesa de postres");
      assert.ok(ctx.despues.nodos.some((n) => n.id === "salon-fondo"), "el salón trae el fondo de fotos");
    },
  },
  {
    area: "salon",
    frase: "mesas de 10 personas",
    base: "salon-armado",
    vueltas: [[llamar("ajustar_salon", { sillas_por_mesa: 10 })]],
    sumaSola: false,
    comprobar: (ctx) => {
      const mesas = mesasDeInvitados(ctx).length;
      assert.equal(contarMobiliario(ctx.despues).sillas, mesas * 10, "cada mesa de invitados tiene que quedar con 10 sillas");
      assert.ok(mesas * 10 >= 30, "las mesas tienen que seguir dando puestos a los 30 invitados");
      assert.equal(mesas, 3, "30 invitados de a 10 son 3 mesas");
      assert.ok(ctx.despues.nodos.some((n) => n.id === "arco"), "la decoración del usuario se queda");
    },
  },
  {
    area: "salon",
    frase: "agrega 3 mesas rectangulares más",
    base: "salon-armado",
    vueltas: [[llamar("agregar_mesas", { cantidad: 3, tipo: "rectangular" })]],
    comprobar: (ctx) => {
      assert.equal(contarMobiliario(ctx.despues).mesas, contarMobiliario(ctx.antes).mesas + 3, "suma 3 mesas a las que había");
      assert.equal(ctx.despues.nodos.filter((n) => n.id.startsWith("mesa-rectangular")).length, 3);
      assert.deepEqual(ctx.despues.salon, ctx.antes.salon, "sumar mesas no rehace el registro del salón");
    },
  },
  {
    area: "salon",
    frase: "pon las sillas de las mesas en azul",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [
      [AGRANDAR_SALA, llamar("agregar_mesas", { cantidad: 2, tipo: "redonda", sillas_por_mesa: 6, columnas: 2 })],
      [llamar("cambiar_sillas", { color_silla: "azul" })],
    ],
    tocables: [],
    comprobar: (ctx) => {
      assert.deepEqual(contarMobiliario(ctx.despues), { mesas: 2, sillas: 12 }, "cambiar el color no cambia cuántas sillas hay");
      const grupos = ctx.despues.nodos.filter((n) => n.id.startsWith("sillas-"));
      assert.equal(grupos.length, 2);
      for (const g of grupos) {
        const hex = colorDeSillas(g.pieza);
        const [r, , azul] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
        assert.ok(azul! > r! + 40, `${g.id}: las sillas quedaron en ${hex}, que no es azul`);
      }
    },
  },
  {
    area: "salon",
    frase: "mueve los postres junto a las mesas",
    base: "salon-armado",
    vueltas: [[llamar("mover_zona", { zona: "mesa_postres", x_cm: -150, z_cm: -127 })]],
    sumaSola: false,
    tocables: ["salon-postres"],
    comprobar: (ctx) => {
      const colocacion = nodoDe(ctx.despues, "salon-postres").colocacion;
      assert.ok(colocacion.en === "piso" && colocacion.xCm === -150, "los postres quedan en x = −150");
      // Quedan encimados con una mesa: eso tiene que llegarle a la persona aunque el modelo diga «Listo».
      assert.match(ctx.llamadas[0]!.resumen, /encimadas/);
      assert.match(ctx.respuesta, /encimadas/, "el choque con las mesas no llegó a la respuesta");
      assert.ok(mesasDeInvitados(ctx).every((m) => JSON.stringify(m) === JSON.stringify(nodoDe(ctx.antes, m.id))), "las mesas no se mueven");
    },
  },
  {
    area: "salon",
    frase: "quita la mesa de postres",
    base: "salon-armado",
    vueltas: [[llamar("quitar_zona", { zona: "mesa_postres" })]],
    sumaSola: false,
    tocables: ["salon-postres"],
    comprobar: (ctx) => {
      assert.ok(!ctx.despues.nodos.some((n) => n.id === "salon-postres"), "los postres ya no están");
      assert.equal(ctx.despues.nodos.length, ctx.antes.nodos.length - 1, "solo se quita esa pieza");
    },
  },
  {
    area: "salon",
    frase: "ahora son 60 invitados",
    base: "salon-armado",
    vueltas: [[llamar("ajustar_salon", { invitados: 60 })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.equal(mesasDeInvitados(ctx).length, 8, "60 invitados de a 8 son 8 mesas");
      assert.ok(contarMobiliario(ctx.despues).sillas >= 60, "hay puesto para los 60");
      // El salón se reacomoda en la sala más grande, pero las mesas que ya estaban conservan su id: se suman las que faltan.
      for (const previa of ctx.antes.nodos.filter((n) => /^salon-mesa-[0-9]+$/.test(n.id))) assert.ok(nodoDe(ctx.despues, previa.id), `${previa.id} se conserva`);
    },
  },
  {
    area: "salon",
    frase: "mejor con mesas imperiales",
    base: "salon-armado",
    vueltas: [[llamar("ajustar_salon", { mesa: "imperial" })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.match(ctx.llamadas[0]!.resumen, /mesas de 10/, "una imperial lleva 10");
      assert.ok(contarMobiliario(ctx.despues).sillas >= 30, "los 30 invitados siguen con silla");
    },
  },
  {
    area: "salon",
    frase: "agrega la pista de baile",
    base: "salon-armado",
    vueltas: [[llamar("ajustar_salon", { agregar_zonas: ["pista"] })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.match(ctx.llamadas[0]!.resumen, /pista de/);
      assert.ok(ctx.despues.salon && JSON.stringify(ctx.despues.salon.piezas).includes("pista"), "la pista queda en el registro del salón");
    },
  },
  {
    area: "salon",
    frase: "el salón de 12 por 18",
    base: "salon-armado",
    vueltas: [[llamar("ajustar_salon", { ancho_cm: 1200, fondo_cm: 1800 })]],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      assert.deepEqual([ctx.despues.sala.anchoCm, ctx.despues.sala.fondoCm], [1200, 1800]);
      assert.equal(mesasDeInvitados(ctx).length, 4, "las mesas no cambian");
    },
  },
  {
    area: "salon",
    frase: "ahora son 60 invitados (las mesas nuevas reciben su centro de mesa)",
    base: "salon-armado",
    vueltas: [
      [llamar("decorar_mesas", { disenos: [{ tipo: "ramo_helio" }], grupo: "invitados" })],
      [llamar("ajustar_salon", { invitados: 60 })],
    ],
    sumaSola: false,
    tocables: ["arco", "columna-izq", "columna-der", "guirnalda"],
    comprobar: (ctx) => {
      const mesas = mesasDeInvitados(ctx).map((n) => n.id);
      assert.equal(mesas.length, 8);
      const padres = centrosNuevos(ctx).map((n) => (n.colocacion.en === "sobre" ? n.colocacion.padreId : ""));
      assert.deepEqual([...padres].sort(), [...mesas].sort(), "las 4 mesas nuevas también llevan su centro");
    },
  },
  {
    area: "salon",
    frase: "pon manteles negros en todas las mesas del salón",
    base: "salon-armado",
    // El camino que sirve es cambiar_pieza con colores (mantel, sillas, cojines) sobre cada mesa del salón; cambiar_mesas las rechaza (siguiente caso).
    vueltas: [[1, 2, 3, 4].map((n) => llamar("cambiar_pieza", { id: `salon-mesa-0${n}`, colores: ["negro"] }))],
    sumaSola: false,
    tocables: ["salon-mesa-01", "salon-mesa-02", "salon-mesa-03", "salon-mesa-04"],
    comprobar: (ctx) => {
      const coloresDe = (escena: typeof ctx.antes, id: string) => (nodoDe(escena, id).pieza as { mueble?: { opciones?: { colores?: string[] } } }).mueble?.opciones?.colores;
      for (const n of mesasDeInvitados(ctx)) {
        assert.equal(coloresDe(ctx.despues, n.id)?.[0], "#1c1c1c", `el mantel de ${n.id} queda negro`);
        assert.equal(coloresDe(ctx.despues, n.id)?.[1], coloresDe(ctx.antes, n.id)?.[1], `las sillas de ${n.id} no cambian`);
      }
      assert.deepEqual(ctx.despues.salon, ctx.antes.salon, "el registro del salón no cambia");
    },
  },
  {
    area: "salon",
    frase: "pon manteles negros en las mesas del salón (cambiar_mesas manda al camino que sirve)",
    base: "salon-armado",
    vueltas: [[llamar("cambiar_mesas", { color_mantel: "negro" })]],
    // Antes mandaba a ajustar_salon, que no tiene color: un callejón sin salida para el modelo.
    rechazo: /son del salón armado.*cambiar_pieza y colores sobre cada mesa/,
    comprobar: () => undefined,
  },
];
