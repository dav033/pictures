import { mesaConMantel, type AcabadoEscenografia, type ElementoEscenografia } from "./escenografia";
import { mat, trasladarGirar, type Material } from "./mobiliario-base";
import { banca, sillaModerna, sillaTiffany, sofa, taburete, type OpcionesAsiento } from "./mobiliario-asientos";
import {
  alfombraRedonda, basePastel, baseHexagonal, biombo, columnaGriega, escaleraDecorativa, jarronPampas, lamparaPie, marcoMetalico, marcoTela, neonCursiva, peldanos,
  rotuloAcrilico, TEXTO_ROTULO_ACRILICO, type OpcionesDecorado,
} from "./mobiliario-decorado";
import { puestosAlrededor } from "./mobiliario-disposicion";
import {
  carritoDulces, consola, mesaCentro, mesaCoctel, mesaCoctelLicra, mesaHexagonal, mesaImperial, mesaRedonda, mesaRedondaMantel, mesaRegalos, mesasNidoHexagonales, ALTO_PILA_REGALOS,
  type OpcionesMesa,
} from "./mobiliario-mesas";
import type { MedidasMueble, MuebleCatalogo, OpcionesMueble } from "./mobiliario-tipos";

/**
 * **Mobiliario de eventos** (2026-10-08): sillas, bancas, taburetes, sofás, mesas (imperial, redonda, cóctel,
 * postres, centro, nido hexagonal, regalos, carrito de dulces) y decorado de pie (aros y arcos metálicos, peldaños,
 * biombo, pampas, neón…). Cada uno se arma por ancho, fondo y alto TOTALES (cm: lo que mide la pieza armada) y por
 * colores (`#rrggbb`; el primero es el principal y `coloresDe` dice para qué sirve cada uno), y entra en
 * `FONDOS_CATALOGO` para el panel «Añadir», la lectura de fotos y la IA del taller. Escenografía: no cotiza.
 */

const color = (o: OpcionesMueble, i: number, acabado: AcabadoEscenografia): Material => mat(o.colores[i] ?? o.colores[0]!, i === 0 && o.acabado ? o.acabado : acabado);

const deAsiento = (f: (o: OpcionesAsiento) => ElementoEscenografia[], estructura: AcabadoEscenografia, tela: AcabadoEscenografia, telaPrimero = false) =>
  (o: OpcionesMueble) => f({ ...o, estructura: color(o, telaPrimero ? 1 : 0, estructura), cojin: color(o, telaPrimero ? 0 : 1, tela) });

const deMesa = (f: (o: OpcionesMesa) => ElementoEscenografia[], tapa: AcabadoEscenografia, patas: AcabadoEscenografia) =>
  (o: OpcionesMueble): ElementoEscenografia[] => f({ ...o, tapa: color(o, 0, tapa), patas: color(o, 1, patas), ...(o.colores[2] ? { extra: color(o, 2, "satinado") } : {}) });

/** Una sola pieza de color (mantel, funda, alambre) y, si hay, un segundo color opcional (sobremantel, vidrio). */
const deMesaDeUnColor = (f: (o: OpcionesMesa) => ElementoEscenografia[], principal: AcabadoEscenografia, opcional: AcabadoEscenografia) =>
  (o: OpcionesMueble): ElementoEscenografia[] => f({ ...o, tapa: color(o, 0, principal), patas: color(o, 0, principal), ...(o.colores[1] ? { extra: color(o, 1, opcional) } : {}) });

const deDecorado = (f: (o: OpcionesDecorado) => ElementoEscenografia[], principal: AcabadoEscenografia, secundario: AcabadoEscenografia) =>
  (o: OpcionesMueble): ElementoEscenografia[] => f({ ...o, principal: color(o, 0, principal), secundario: color(o, 1, secundario), ...(o.texto ? { texto: o.texto } : {}) });

type Datos = Omit<MuebleCatalogo, "clase" | "lugar" | "elementos" | "retiroCm"> & { lugar?: "piso" | "pared"; retiroCm?: number };

/** Una entrada de mobiliario: se pone en el piso, 120 cm delante de la pared, salvo que diga otra cosa. */
function mueble(d: Datos): MuebleCatalogo {
  return { lugar: "piso", retiroCm: 120, ...d, clase: "mueble", elementos: () => d.armar({ ...d.medidas, colores: d.colores }) };
}

const mantelRectangular = (o: OpcionesMueble) => mesaConMantel({ anchoCm: o.anchoCm, fondoCm: o.fondoCm, altoCm: o.altoCm, mantel: o.colores[0]! });

// ----------------------------------------------------------------------------------------------------------
// Asientos
// ----------------------------------------------------------------------------------------------------------

/** Delante de una mesa redonda de 1,5 m con mantel (que llega a 209 cm de la pared) y sin tocar su falda. */
const RETIRO_SILLAS_CM = 260;

const tabureteDe = deAsiento(taburete, "metal", "madera");

const SILLA_TIFFANY = mueble({
  id: "silla_tiffany", nombre: "Silla Tiffany", grupo: "asiento", asiento: true, retiroCm: RETIRO_SILLAS_CM,
  descripcion: "Silla Tiffany (chiavari) dorada de 45 × 45 cm y 90 cm de alto, asiento a 45 cm, con cojín crema; la silla de bodas y quince años.",
  medidas: { anchoCm: 45, fondoCm: 45, altoCm: 90 }, colores: ["#d6b25a", "#f4efe4"], coloresDe: ["estructura", "cojín"], armar: deAsiento(sillaTiffany, "satinado", "tela"),
});

const MESA_REDONDA_MANTEL = mueble({
  id: "mesa_redonda_mantel", fondo: "igual_ancho", nombre: "Mesa redonda con mantel", grupo: "mesa",
  descripcion: "Mesa redonda de banquete de 1,5 m (8 a 10 puestos) con mantel blanco hasta el piso.",
  medidas: { anchoCm: 164, fondoCm: 164, altoCm: 75 }, colores: ["#f7f6f2"], coloresDe: ["mantel", "sobremantel en rombo (opcional)"],
  armar: (o) => mesaRedondaMantel({ ...o, anchoCm: o.anchoCm - 14, fondoCm: o.fondoCm - 14, tapa: color(o, 0, "tela"), patas: color(o, 0, "tela"), ...(o.colores[1] ? { extra: color(o, 1, "tela") } : {}) }),
});

const MESA_IMPERIAL_MANTEL = mueble({
  id: "mesa_imperial_mantel", nombre: "Mesa imperial con mantel", grupo: "mesa",
  descripcion: "Mesa larga imperial de banquete de 2,4 × 0,9 m y 75 cm de alto con mantel blanco hasta el piso.",
  medidas: { anchoCm: 254, fondoCm: 92, altoCm: 75 }, colores: ["#f7f6f2"], coloresDe: ["mantel"],
  armar: (o) => mantelRectangular({ ...o, anchoCm: o.anchoCm - 14, fondoCm: o.fondoCm - 2 }),
});

/** Las sillas de siempre de cada conjunto: las usan el armado, `sillas.porDefecto` y `asientos` del catálogo (`asientosDeEntrada` los lee), para que lo que se cuenta sea lo que se dibuja. */
const SILLAS_MESA_REDONDA = 8;
const SILLAS_MESA_REDONDA_10 = 10;
const SILLAS_MESA_IMPERIAL = 10;

/** Lo que las sillas suman a cada lado de la mesa (cm): holgura, fondo de la silla y el vuelo de la falda. */
const ALREDEDOR_SILLAS_CM = 60;

/** La mesa de un conjunto (de `mesaAncho` × `mesaFondo` armada, con su falda) con sus sillas Tiffany repartidas alrededor, a la escala pedida (`altoCm` es el de la silla). */
function conSillas(mesa: ElementoEscenografia[], mesaAncho: number, mesaFondo: number, o: OpcionesMueble, cantidad: number, cabeceras = 0): ElementoEscenografia[] {
  const k = o.altoCm / SILLA_TIFFANY.medidas.altoCm;
  const silla = { anchoCm: SILLA_TIFFANY.medidas.anchoCm * k, fondoCm: SILLA_TIFFANY.medidas.fondoCm * k, altoCm: o.altoCm, colores: [o.colores[1] ?? SILLA_TIFFANY.colores[0]!, o.colores[2] ?? SILLA_TIFFANY.colores[1]!] };
  const puestos = puestosAlrededor({ cx: 0, cz: 0, anchoCm: mesaAncho, fondoCm: mesaFondo, cantidad, cabeceras, holguraCm: silla.fondoCm / 2 + 8, frenteCm: silla.anchoCm });
  return [...mesa, ...puestos.flatMap((p) => trasladarGirar(SILLA_TIFFANY.armar(silla), p.x, p.z, p.giroGrados))];
}

const SALA_LOUNGE: MedidasMueble = { anchoCm: 410, fondoCm: 208, altoCm: 80 };

/** Todo lo que sigue es del tamaño de la pieza armada; el conjunto escala cada mueble y su sitio a lo pedido. */
function salaLounge(o: OpcionesMueble): ElementoEscenografia[] {
  const kx = o.anchoCm / SALA_LOUNGE.anchoCm, kz = o.fondoCm / SALA_LOUNGE.fondoCm, ky = o.altoCm / SALA_LOUNGE.altoCm;
  const tela = [o.colores[0]!, o.colores[1] ?? "#3a2c20"];
  const de = (id: string, colores: readonly string[], x: number, z: number, giro: number) => {
    const m = muebleDe(id)!;
    const medidas = { anchoCm: m.medidas.anchoCm * kx, fondoCm: m.medidas.fondoCm * kz, altoCm: m.medidas.altoCm * ky };
    return trasladarGirar(m.armar({ ...medidas, colores }), x * kx, z * kz, giro);
  };
  return [
    ...de("sofa", tela, 0, -65, 0),
    ...de("sillon", tela, -150, 45, 70),
    ...de("sillon", tela, 150, 45, -70),
    ...de("mesa_centro", [o.colores[2] ?? "#8a6a45", "#2b2b2b"], 0, 50, 0),
  ];
}

// ----------------------------------------------------------------------------------------------------------
// El catálogo
// ----------------------------------------------------------------------------------------------------------

const BASE: readonly MuebleCatalogo[] = [
  SILLA_TIFFANY,
  mueble({
    id: "silla_moderna", nombre: "Silla moderna", grupo: "asiento", asiento: true, retiroCm: RETIRO_SILLAS_CM,
    descripcion: "Silla moderna de 45 × 48 cm y 82 cm de alto, patas de varilla negras y respaldo curvo claro.",
    medidas: { anchoCm: 45, fondoCm: 48, altoCm: 82 }, colores: ["#2b2b2b", "#d8d1c3"], coloresDe: ["patas", "asiento y respaldo"], armar: deAsiento(sillaModerna, "metal", "tela"),
  }),
  mueble({
    id: "banca", nombre: "Banca", grupo: "asiento", retiroCm: 150,
    descripcion: "Banca acolchada de 1,2 m, 38 cm de fondo y 45 cm de alto (para sentarse dos o tres, o al pie de una mesa).",
    medidas: { anchoCm: 120, fondoCm: 38, altoCm: 45 }, colores: ["#8a6a45", "#e8e0d0"], coloresDe: ["estructura", "cojín"], armar: deAsiento(banca, "madera", "tela"),
  }),
  mueble({
    id: "taburete_alto", fondo: "igual_ancho", nombre: "Taburete alto", grupo: "asiento", asiento: true, retiroCm: RETIRO_SILLAS_CM,
    descripcion: "Taburete alto de bar de 43 cm (asiento redondo de 34) y 75 cm de alto, patas negras con apoyapiés (el de la mesa cóctel y la barra).",
    medidas: { anchoCm: 43, fondoCm: 43, altoCm: 75 }, colores: ["#2b2b2b", "#8a6a45"], coloresDe: ["patas", "asiento"], armar: tabureteDe,
  }),
  mueble({
    id: "taburete_bajo", fondo: "igual_ancho", nombre: "Taburete bajo", grupo: "asiento", asiento: true, retiroCm: RETIRO_SILLAS_CM,
    descripcion: "Taburete bajo redondo de 43 cm (asiento de 34) y 45 cm de alto, patas negras y asiento de madera.",
    medidas: { anchoCm: 43, fondoCm: 43, altoCm: 45 }, colores: ["#2b2b2b", "#8a6a45"], coloresDe: ["patas", "asiento"], armar: tabureteDe,
  }),
  mueble({
    id: "sofa", nombre: "Sofá", grupo: "asiento",
    descripcion: "Sofá de tres plazas de 2 m, 88 cm de fondo y 80 cm de alto, tapizado beige con patas oscuras (zona lounge).",
    medidas: { anchoCm: 200, fondoCm: 88, altoCm: 80 }, colores: ["#c9b8a2", "#3a2c20"], coloresDe: ["tela", "patas"], armar: deAsiento(sofa, "madera", "tela", true),
  }),
  mueble({
    id: "love_seat", nombre: "Love seat", grupo: "asiento",
    descripcion: "Sofá pequeño de dos plazas (love seat) de 1,4 m y 78 cm de alto, tapizado.",
    medidas: { anchoCm: 140, fondoCm: 82, altoCm: 78 }, colores: ["#c9b8a2", "#3a2c20"], coloresDe: ["tela", "patas"], armar: deAsiento(sofa, "madera", "tela", true),
  }),
  mueble({
    id: "sillon", nombre: "Sillón", grupo: "asiento", asiento: true,
    descripcion: "Sillón individual de 85 cm, 85 cm de fondo y 80 cm de alto, tapizado.",
    medidas: { anchoCm: 85, fondoCm: 85, altoCm: 80 }, colores: ["#c9b8a2", "#3a2c20"], coloresDe: ["tela", "patas"], armar: deAsiento(sofa, "madera", "tela", true),
  }),

  mueble({
    id: "mesa_imperial", nombre: "Mesa imperial", grupo: "mesa",
    descripcion: "Mesa larga imperial de banquete, sin mantel, de 2,4 × 0,9 m y 75 cm de alto (tapa clara, patas grises).",
    medidas: { anchoCm: 240, fondoCm: 90, altoCm: 75 }, colores: ["#f1ede4", "#6f6f6f"], coloresDe: ["tapa", "patas"], armar: deMesa(mesaImperial, "mate", "metal"),
  }),
  MESA_IMPERIAL_MANTEL,
  mueble({
    id: "mesa_redonda", fondo: "igual_ancho", nombre: "Mesa redonda", grupo: "mesa",
    descripcion: "Mesa redonda de banquete de 1,5 m y 75 cm de alto, sin mantel (tapa clara, pie central gris).",
    medidas: { anchoCm: 150, fondoCm: 150, altoCm: 75 }, colores: ["#f1ede4", "#6f6f6f"], coloresDe: ["tapa", "pie"], armar: deMesa(mesaRedonda, "mate", "metal"),
  }),
  MESA_REDONDA_MANTEL,
  mueble({
    id: "mesa_coctel", fondo: "igual_ancho", nombre: "Mesa cóctel", grupo: "mesa",
    descripcion: "Mesa alta de cóctel (periquera) de 60 cm y 110 cm de alto, sin mantel: tapa blanca, pie cromado.",
    medidas: { anchoCm: 60, fondoCm: 60, altoCm: 110 }, colores: ["#f4f1ea", "#c9c9c9"], coloresDe: ["tapa", "pie y base"], armar: deMesa(mesaCoctel, "satinado", "metal"),
  }),
  mueble({
    id: "mesa_coctel_licra", fondo: "igual_ancho", nombre: "Mesa cóctel con licra", grupo: "mesa",
    descripcion: "Mesa alta de cóctel de 60 cm y 110 cm de alto con funda de licra blanca ajustada.",
    medidas: { anchoCm: 63, fondoCm: 63, altoCm: 110 }, colores: ["#f7f6f2"], coloresDe: ["funda"], armar: (o) => mesaCoctelLicra({ ...o, anchoCm: o.anchoCm - 3, tapa: color(o, 0, "tela"), patas: color(o, 0, "tela") }),
  }),
  mueble({
    id: "mesa_postres", nombre: "Mesa de postres", grupo: "mesa",
    descripcion: "Consola o mesa de postres angosta de 1,8 m × 45 cm y 90 cm de alto, sin mantel (tapa crema, patas doradas).",
    medidas: { anchoCm: 180, fondoCm: 45, altoCm: 90 }, colores: ["#e9dfcd", "#c9a14a"], coloresDe: ["tapa", "patas"], armar: deMesa(consola, "madera", "metal"),
  }),
  mueble({
    id: "mesa_postres_mantel", nombre: "Mesa de postres con mantel", grupo: "mesa",
    descripcion: "Mesa de postres de 1,8 m × 45 cm y 90 cm de alto con mantel blanco hasta el piso.",
    medidas: { anchoCm: 194, fondoCm: 47, altoCm: 90 }, colores: ["#f7f6f2"], coloresDe: ["mantel"], armar: (o) => mantelRectangular({ ...o, anchoCm: o.anchoCm - 14, fondoCm: o.fondoCm - 2 }),
  }),
  mueble({
    id: "mesa_centro", nombre: "Mesa de centro", grupo: "mesa", retiroCm: 160,
    descripcion: "Mesa de centro baja de 1 m × 55 cm y 42 cm de alto, tapa de madera y patas negras (zona lounge).",
    medidas: { anchoCm: 100, fondoCm: 55, altoCm: 42 }, colores: ["#8a6a45", "#2b2b2b"], coloresDe: ["tapa", "patas"], armar: deMesa(mesaCentro, "madera", "metal"),
  }),
  mueble({
    id: "mesa_hexagonal", fondo: "proporcional", nombre: "Mesa hexagonal dorada", grupo: "mesa", retiroCm: 100,
    descripcion: "Mesa hexagonal de alambre dorado de 50 cm y 60 cm de alto (suelta); con un segundo color lleva cubierta (blanca, de mármol o de vidrio).",
    medidas: { anchoCm: 50, fondoCm: 43, altoCm: 60 }, colores: ["#d4af5a"], coloresDe: ["alambre", "cubierta (opcional)"], armar: deMesaDeUnColor(mesaHexagonal, "metal", "satinado"),
  }),
  mueble({
    id: "mesas_nido_hexagonales", fondo: "proporcional", nombre: "Mesas nido hexagonales", grupo: "mesa", retiroCm: 100,
    descripcion: "Juego de tres mesas nido hexagonales de alambre dorado (50, 40 y 31 cm) de 70, 62 y 55 cm de alto, corridas en escalón; el ancho es el de todo el juego.",
    medidas: { anchoCm: 127, fondoCm: 45, altoCm: 70 }, colores: ["#d4af5a"], coloresDe: ["alambre", "cubierta (opcional)"], armar: deMesaDeUnColor(mesasNidoHexagonales, "metal", "satinado"),
  }),
  mueble({
    id: "mesa_regalos", nombre: "Mesa de regalos", grupo: "mesa",
    descripcion: "Mesa de 1,5 m con mantel blanco hasta el piso y una pila de cajas de regalo con moños encima (el alto es el total, regalos incluidos).",
    medidas: { anchoCm: 150, fondoCm: 70, altoCm: 75 + ALTO_PILA_REGALOS }, colores: ["#f7f6f2", "#c9a14a", "#f0b8c8"], coloresDe: ["mantel", "cajas de regalo", "más cajas"], armar: deMesa(mesaRegalos, "tela", "satinado"),
  }),
  mueble({
    id: "carrito_dulces", nombre: "Carrito de dulces", grupo: "mesa",
    descripcion: "Carrito de dulces (candy cart) de 90 × 50 cm y 150 cm de alto: repisas, techo con volante y frascos de golosinas.",
    medidas: { anchoCm: 96, fondoCm: 56, altoCm: 150 }, colores: ["#f4f1ea", "#c9c9c9", "#d6336c"], coloresDe: ["cuerpo", "metal", "volante y frascos"], armar: (o) => deMesa(carritoDulces, "satinado", "metal")({ ...o, anchoCm: o.anchoCm - 7, fondoCm: o.fondoCm - 7 }),
  }),

  mueble({
    id: "aro_metalico", fondo: "fijo", nombre: "Aro metálico", grupo: "decorado", retiroCm: 30, telon: true,
    descripcion: "Aro metálico dorado de 1,5 m con pie (fondo circular para globos o flores), 1,75 m de alto total.",
    medidas: { anchoCm: 150, fondoCm: 34, altoCm: 175 }, colores: ["#d6b25a"], coloresDe: ["metal"], armar: deDecorado((o) => marcoMetalico({ ...o, forma: "aro" }), "metal", "metal"),
  }),
  mueble({
    id: "aro_hexagonal", fondo: "fijo", nombre: "Marco hexagonal metálico", grupo: "decorado", retiroCm: 30, telon: true,
    descripcion: "Marco hexagonal metálico dorado de 1,4 m de ancho con pie, 1,75 m de alto total.",
    medidas: { anchoCm: 140, fondoCm: 34, altoCm: 175 }, colores: ["#d6b25a"], coloresDe: ["metal"], armar: deDecorado((o) => marcoMetalico({ ...o, forma: "hexagono" }), "metal", "metal"),
  }),
  mueble({
    id: "arco_metalico", fondo: "fijo", nombre: "Arco metálico", grupo: "decorado", retiroCm: 30, telon: true,
    descripcion: "Arco de medio punto metálico dorado de 1,2 × 2,3 m con patines (para cubrir de globos o flores).",
    medidas: { anchoCm: 120, fondoCm: 34, altoCm: 230 }, colores: ["#d6b25a"], coloresDe: ["metal"], armar: deDecorado((o) => marcoMetalico({ ...o, forma: "arco" }), "metal", "metal"),
  }),
  mueble({
    id: "base_hexagonal", fondo: "proporcional", nombre: "Base hexagonal", grupo: "decorado",
    descripcion: "Base o plinto hexagonal blanco de 80 cm y 60 cm de alto, con tapa (para pastel, flores o una figura).",
    medidas: { anchoCm: 83, fondoCm: 72, altoCm: 60 }, colores: ["#f4f1ea"], coloresDe: ["color"], armar: deDecorado((o) => baseHexagonal({ ...o, anchoCm: o.anchoCm - 3 }), "satinado", "satinado"),
  }),
  mueble({
    id: "peldanos", nombre: "Peldaños de exhibición", grupo: "decorado",
    descripcion: "Tres peldaños de exhibición blancos de 1,2 m, 90 cm de fondo y 60 cm de alto en el de atrás (la más alta atrás).",
    medidas: { anchoCm: 120, fondoCm: 90, altoCm: 60 }, colores: ["#f4f1ea"], coloresDe: ["color"], armar: deDecorado(peldanos, "satinado", "satinado"),
  }),
  mueble({
    id: "escalera_decorativa", nombre: "Escalera decorativa", grupo: "decorado", retiroCm: 30, telon: true,
    descripcion: "Escalera decorativa de madera de 45 cm y 1,5 m de alto apoyada en la pared (boho), con peldaños.",
    medidas: { anchoCm: 45, fondoCm: 40, altoCm: 150 }, colores: ["#a8815a"], coloresDe: ["madera"], armar: deDecorado(escaleraDecorativa, "madera", "madera"),
  }),
  mueble({
    id: "biombo", nombre: "Biombo", grupo: "decorado", retiroCm: 40, telon: true,
    descripcion: "Biombo plegable de tres paneles en zigzag, 1,8 m a lo largo y 1,8 m de alto, marco de madera y tela clara.",
    medidas: { anchoCm: 180, fondoCm: 33, altoCm: 180 }, colores: ["#8a6a45", "#efe7d6"], coloresDe: ["marco", "tela"], armar: deDecorado(biombo, "madera", "tela"),
  }),
  mueble({
    id: "jarron_pampas", fondo: "proporcional", nombre: "Jarrón con pampas", grupo: "decorado", retiroCm: 40,
    descripcion: "Jarrón grande con tallos de pampas de 1,4 m de alto (decoración de piso); el ancho es el de las plumas abiertas.",
    medidas: { anchoCm: 90, fondoCm: 50, altoCm: 132 }, colores: ["#e9dfcd", "#d8c3a0"], coloresDe: ["jarrón", "pampas"], armar: deDecorado(jarronPampas, "mate", "pampa"),
  }),
  mueble({
    id: "lampara_pie", fondo: "igual_ancho", nombre: "Lámpara de pie", grupo: "decorado", retiroCm: 40,
    descripcion: "Lámpara de pie de 1,65 m con pantalla de tela encendida, base y mástil negros.",
    medidas: { anchoCm: 40, fondoCm: 40, altoCm: 165 }, colores: ["#2b2b2b", "#ffe9c0"], coloresDe: ["base y mástil", "pantalla"], armar: deDecorado(lamparaPie, "metal", "llama"),
  }),
  mueble({
    id: "base_pastel", fondo: "igual_ancho", nombre: "Base de pastel", grupo: "decorado", sobreMesa: true,
    descripcion: "Base de pastel (platón sobre pie) blanca de 32 cm de plato y 18 cm de alto; va sobre una mesa.",
    medidas: { anchoCm: 32, fondoCm: 32, altoCm: 18 }, colores: ["#f4f1ea"], coloresDe: ["color"], armar: deDecorado(basePastel, "brillante", "brillante"),
  }),
  mueble({
    id: "neon_cursiva", fondo: "fijo", nombre: "Letrero de neón", grupo: "decorado", lugar: "pared", alturaParedCm: 130, conTexto: true, textoPorDefecto: "Happy Birthday",
    descripcion: "Letrero de neón en cursiva de 1,2 × 0,6 m sobre acrílico transparente (o de color: tablero negro con acabado mate) (texto a elegir, por defecto «Happy Birthday»); va en la pared.",
    medidas: { anchoCm: 120, fondoCm: 2, altoCm: 60 }, colores: ["#f4f6f8", "#ff4fa3"], coloresDe: ["tablero", "luz del neón"], armar: deDecorado(neonCursiva, "acrilico", "llama"),
  }),
  mueble({
    id: "marco_tela", fondo: "fijo", nombre: "Marco con tela", grupo: "decorado", retiroCm: 30, telon: true, rotulable: true,
    descripcion: "Marco rectangular de fondo de 2,4 × 1,8 m con perfil de 4 cm (negro, dorado, blanco o madera) y tela tensada; admite un nombre o frase en vinilo cursivo (texto).",
    medidas: { anchoCm: 240, fondoCm: 34, altoCm: 180 }, colores: ["#1c1c1c", "#f7f6f2"], coloresDe: ["marco", "tela"], armar: deDecorado(marcoTela, "satinado", "tela"),
  }),
  mueble({
    id: "rotulo_acrilico", fondo: "fijo", nombre: "Nombre de acrílico", grupo: "decorado", lugar: "piso", retiroCm: 34, flotaCm: 115, conTexto: true, textoPorDefecto: TEXTO_ROTULO_ACRILICO, lineasTexto: 3,
    acabadosPropios: [["metal", "Espejo"], ["mate", "Mate"]],
    descripcion: "Nombre o frase recortado en acrílico de 6 mm, letra cursiva unida (texto a elegir), suelto y en el aire, delante de un aro o arco; dorado espejo (acabado metal = espejo, mate = liso).",
    medidas: { anchoCm: 120, fondoCm: 0.6, altoCm: 40 }, colores: ["#d6b25a"], coloresDe: ["letras"], armar: deDecorado(rotuloAcrilico, "metal", "metal"),
  }),
  mueble({
    id: "columna_griega", fondo: "igual_ancho", nombre: "Columna griega", grupo: "decorado", retiroCm: 40,
    descripcion: "Columna griega blanca de 1,1 m de alto con base y capitel de 42 cm de ancho.",
    medidas: { anchoCm: 42, fondoCm: 42, altoCm: 110 }, colores: ["#f4f1ea"], coloresDe: ["color"], armar: deDecorado(columnaGriega, "satinado", "satinado"),
  }),
  mueble({
    id: "alfombra_redonda", fondo: "igual_ancho", nombre: "Alfombra redonda", grupo: "decorado", retiroCm: 160, seguirPrimero: true,
    descripcion: "Alfombra redonda de tela de 2 m; con un segundo color distinto lleva ribete.",
    medidas: { anchoCm: 200, fondoCm: 200, altoCm: 1 }, colores: ["#e9e2d6", "#e9e2d6"], coloresDe: ["alfombra", "ribete"], armar: deDecorado(alfombraRedonda, "tela", "tela"),
  }),
];

/** Conjuntos: el mueble con sus sillas en una sola pieza (la mesa de banquete lista para poner). */
const CONJUNTOS: readonly MuebleCatalogo[] = [
  mueble({
    id: "mesa_redonda_sillas", fondo: "igual_ancho", nombre: "Mesa redonda con 8 sillas", grupo: "mesa", retiroCm: 190, asientos: SILLAS_MESA_REDONDA,
    descripcion: "Mesa redonda de 1,5 m con mantel blanco y ocho sillas Tiffany doradas alrededor, en una sola pieza (el ancho es el de todo el conjunto, sillas incluidas; el alto, el de las sillas).",
    medidas: { anchoCm: 270, fondoCm: 270, altoCm: 90 }, sillas: { porDefecto: SILLAS_MESA_REDONDA, min: 2, max: 12, par: false }, colores: ["#f7f6f2", "#d6b25a", "#f4efe4"], coloresDe: ["mantel", "sillas", "cojines"],
    armar: (o) => {
      const d = Math.max(60, Math.min(o.anchoCm, o.fondoCm) - 2 * ALREDEDOR_SILLAS_CM);
      return conSillas(MESA_REDONDA_MANTEL.armar({ anchoCm: d + 14, fondoCm: d + 14, altoCm: (o.altoCm * 75) / 90, colores: [o.colores[0]!] }), d + 14, d + 14, o, o.sillas ?? SILLAS_MESA_REDONDA);
    },
  }),
  mueble({
    id: "mesa_redonda10_sillas", fondo: "igual_ancho", nombre: "Mesa redonda con 10 sillas", grupo: "mesa", retiroCm: 190, asientos: SILLAS_MESA_REDONDA_10,
    descripcion: "Mesa redonda de 1,8 m con mantel blanco y diez sillas Tiffany doradas alrededor, en una sola pieza (el ancho es el de todo el conjunto, sillas incluidas; el alto, el de las sillas).",
    medidas: { anchoCm: 300, fondoCm: 300, altoCm: 90 }, sillas: { porDefecto: SILLAS_MESA_REDONDA_10, min: 2, max: 12, par: false }, colores: ["#f7f6f2", "#d6b25a", "#f4efe4"], coloresDe: ["mantel", "sillas", "cojines"],
    armar: (o) => {
      const d = Math.max(60, Math.min(o.anchoCm, o.fondoCm) - 2 * ALREDEDOR_SILLAS_CM);
      return conSillas(MESA_REDONDA_MANTEL.armar({ anchoCm: d + 14, fondoCm: d + 14, altoCm: (o.altoCm * 75) / 90, colores: [o.colores[0]!] }), d + 14, d + 14, o, o.sillas ?? SILLAS_MESA_REDONDA_10);
    },
  }),
  mueble({
    id: "mesa_imperial_sillas", fondo: "proporcional", nombre: "Mesa imperial con 10 sillas", grupo: "mesa", retiroCm: 190, asientos: SILLAS_MESA_IMPERIAL,
    descripcion: "Mesa larga imperial de 2,4 × 0,9 m con mantel blanco y diez sillas Tiffany (cuatro por lado y una en cada cabecera); el ancho y el fondo son los de todo el conjunto.",
    medidas: { anchoCm: 360, fondoCm: 198, altoCm: 90 }, sillas: { porDefecto: SILLAS_MESA_IMPERIAL, min: 4, max: 20, par: true }, colores: ["#f7f6f2", "#d6b25a", "#f4efe4"], coloresDe: ["mantel", "sillas", "cojines"],
    armar: (o) => {
      // Con un número de sillas pedido el fondo de la mesa es el de siempre (90 cm): solo se alarga.
      const largo = Math.max(120, o.anchoCm - 2 * ALREDEDOR_SILLAS_CM), fondo = o.sillas !== undefined ? 90 : Math.max(60, o.fondoCm - 108);
      return conSillas(mantelRectangular({ anchoCm: largo, fondoCm: fondo, altoCm: (o.altoCm * 75) / 90, colores: [o.colores[0]!] }), largo + 14, fondo + 2, o, o.sillas ?? SILLAS_MESA_IMPERIAL, 2);
    },
  }),
  mueble({
    id: "sala_lounge", nombre: "Zona lounge", grupo: "asiento", retiroCm: 190,
    descripcion: "Zona lounge: sofá de tres plazas al fondo, dos sillones a los lados y una mesa de centro (el ancho, el fondo y el alto son los del conjunto).",
    medidas: SALA_LOUNGE, colores: ["#c9b8a2", "#3a2c20", "#8a6a45"], coloresDe: ["tela", "patas", "mesa de centro"], armar: salaLounge,
  }),
];

export const CATALOGO_MOBILIARIO: readonly MuebleCatalogo[] = [...BASE, ...CONJUNTOS];

const POR_ID: ReadonlyMap<string, MuebleCatalogo> = new Map(CATALOGO_MOBILIARIO.map((m) => [m.id, m]));
/** El mueble paramétrico con ese id del catálogo, si lo hay. */
export const muebleDe = (id: string): MuebleCatalogo | undefined => POR_ID.get(id);
