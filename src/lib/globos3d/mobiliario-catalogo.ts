import { mesaConMantel, type AcabadoEscenografia, type ElementoEscenografia } from "./escenografia";
import type { FondoCatalogo } from "./fondos-escenografia";
import { mat, trasladarGirar, type Material } from "./mobiliario-base";
import { banca, sillaModerna, sillaTiffany, sofa, taburete, type OpcionesAsiento } from "./mobiliario-asientos";
import {
  alfombraRedonda, basePastel, baseHexagonal, biombo, columnaGriega, escaleraDecorativa, jarronPampas, lamparaPie, marcoMetalico, neonCursiva, peldanos,
  type OpcionesDecorado,
} from "./mobiliario-decorado";
import { puestosAlrededor } from "./mobiliario-disposicion";
import {
  carritoDulces, consola, mesaCentro, mesaCoctel, mesaCoctelLicra, mesaHexagonal, mesaImperial, mesaRedonda, mesaRedondaMantel, mesaRegalos, mesasNidoHexagonales,
  type OpcionesMesa,
} from "./mobiliario-mesas";

/**
 * **Mobiliario de eventos** (2026-10-08): sillas, bancas, taburetes, sofás, mesas (imperial, redonda, cóctel,
 * postres, centro, nido hexagonal, regalos, carrito de dulces) y decorado de pie (aros y arcos metálicos, peldaños,
 * biombo, pampas, neón…). Cada uno se arma por ancho, fondo y alto (cm) y por colores (`#rrggbb`, el primero es el
 * principal), y entra en `FONDOS_CATALOGO` para el panel «Añadir», la lectura de fotos y la IA del taller.
 * Escenografía: no cotiza.
 */

export type MedidasMueble = { anchoCm: number; fondoCm: number; altoCm: number };
export type OpcionesMueble = MedidasMueble & { colores: readonly string[]; acabado?: AcabadoEscenografia; texto?: string };

export type MuebleCatalogo = FondoCatalogo & {
  grupo: "asiento" | "mesa" | "decorado";
  /** Medidas de partida (cm); `anchoCm` es el diámetro en lo redondo. */
  medidas: MedidasMueble;
  /** Colores de partida, en el orden en que se piden (cada uno dice para qué sirve en `coloresDe`). */
  colores: readonly string[];
  coloresDe: readonly string[];
  /** Es un asiento suelto: se puede repartir en fila o alrededor de una mesa. */
  asiento?: boolean;
  /** Lleva un texto (el neón). */
  conTexto?: boolean;
  armar: (o: OpcionesMueble) => ElementoEscenografia[];
};

const color = (o: OpcionesMueble, i: number, acabado: AcabadoEscenografia, alterno?: AcabadoEscenografia): Material =>
  mat(o.colores[i] ?? o.colores[0]!, i === 0 && o.acabado ? o.acabado : (i > 0 && alterno) || acabado);

const deAsiento = (f: (o: OpcionesAsiento) => ElementoEscenografia[], estructura: AcabadoEscenografia, tela: AcabadoEscenografia, telaPrimero = false) =>
  (o: OpcionesMueble) => f({ ...o, estructura: color(o, telaPrimero ? 1 : 0, estructura), cojin: color(o, telaPrimero ? 0 : 1, tela) });

const deMesa = (f: (o: OpcionesMesa) => ElementoEscenografia[], tapa: AcabadoEscenografia, patas: AcabadoEscenografia) =>
  (o: OpcionesMueble): ElementoEscenografia[] => f({ ...o, tapa: color(o, 0, tapa), patas: color(o, 1, patas), ...(o.colores[2] ? { extra: color(o, 2, "satinado") } : {}) });

const deDecorado = (f: (o: OpcionesDecorado) => ElementoEscenografia[], principal: AcabadoEscenografia, secundario: AcabadoEscenografia) =>
  (o: OpcionesMueble): ElementoEscenografia[] => f({ ...o, principal: color(o, 0, principal), secundario: color(o, 1, secundario), ...(o.texto ? { texto: o.texto } : {}) });

function mueble(
  id: string, nombre: string, descripcion: string, grupo: MuebleCatalogo["grupo"], medidas: MedidasMueble,
  colores: readonly string[], coloresDe: readonly string[], armar: MuebleCatalogo["armar"], extra: Partial<MuebleCatalogo> = {},
): MuebleCatalogo {
  return { id, nombre, descripcion, lugar: "piso", retiroCm: 120, ...extra, grupo, medidas, colores, coloresDe, armar, elementos: () => armar({ ...medidas, colores }) };
}

const mantelRectangular = (o: OpcionesMueble) => mesaConMantel({ anchoCm: o.anchoCm, fondoCm: o.fondoCm, altoCm: o.altoCm, mantel: o.colores[0]! });

/** Mesa de 150 con mantel y ocho sillas Tiffany, o la imperial con diez: el mueble y sus sillas en una sola pieza. */
function conSillas(mesa: ElementoEscenografia[], medidas: MedidasMueble, silla: MuebleCatalogo, cantidad: number, colores: readonly string[]): ElementoEscenografia[] {
  const holgura = silla.medidas.fondoCm / 2 + 8;
  const puestos = puestosAlrededor({ cx: 0, cz: 0, anchoCm: medidas.anchoCm + 14, fondoCm: medidas.fondoCm + 14, cantidad, holguraCm: holgura, frenteCm: silla.medidas.anchoCm });
  return [...mesa, ...puestos.flatMap((p) => trasladarGirar(silla.armar({ ...silla.medidas, colores }), p.x, p.z, p.giroGrados))];
}

const SILLA_TIFFANY = mueble("silla_tiffany", "Silla Tiffany", "Silla Tiffany (chiavari) dorada de 45 × 45 cm y 90 cm de alto, asiento a 45 cm, con cojín crema; la silla de bodas y quince años.", "asiento",
  { anchoCm: 45, fondoCm: 45, altoCm: 90 }, ["#d6b25a", "#f4efe4"], ["estructura", "cojín"], deAsiento(sillaTiffany, "satinado", "tela"), { asiento: true, retiroCm: 215 });

const MESA_REDONDA_MANTEL = mueble("mesa_redonda_mantel", "Mesa redonda con mantel", "Mesa redonda de banquete de 1,5 m (8 a 10 puestos) con mantel blanco hasta el piso.", "mesa",
  { anchoCm: 150, fondoCm: 150, altoCm: 75 }, ["#f7f6f2"], ["mantel", "sobremantel en rombo (opcional)"],
  (o) => mesaRedondaMantel({ ...o, tapa: color(o, 0, "tela"), patas: color(o, 0, "tela"), ...(o.colores[1] ? { extra: color(o, 1, "tela") } : {}) }));

const MESA_IMPERIAL = mueble("mesa_imperial", "Mesa imperial", "Mesa larga imperial de banquete, sin mantel, de 2,4 × 0,9 m y 75 cm de alto (tapa clara, patas grises).", "mesa",
  { anchoCm: 240, fondoCm: 90, altoCm: 75 }, ["#f1ede4", "#6f6f6f"], ["tapa", "patas"], deMesa(mesaImperial, "mate", "metal"));

/** Los muebles del catálogo, por grupo (asientos, mesas, decorado de pie). */
export const MUEBLES_CATALOGO: readonly MuebleCatalogo[] = [
  SILLA_TIFFANY,
  mueble("silla_moderna", "Silla moderna", "Silla moderna de 45 × 48 cm y 82 cm de alto, patas de varilla negras y respaldo curvo claro.", "asiento",
    { anchoCm: 45, fondoCm: 48, altoCm: 82 }, ["#2b2b2b", "#d8d1c3"], ["patas", "asiento y respaldo"], deAsiento(sillaModerna, "metal", "tela"), { asiento: true, retiroCm: 215 }),
  mueble("banca", "Banca", "Banca acolchada de 1,2 m, 38 cm de fondo y 45 cm de alto (para sentarse dos o tres, o al pie de una mesa).", "asiento",
    { anchoCm: 120, fondoCm: 38, altoCm: 45 }, ["#8a6a45", "#e8e0d0"], ["estructura", "cojín"], deAsiento(banca, "madera", "tela"), { retiroCm: 150 }),
  mueble("taburete_alto", "Taburete alto", "Taburete alto de bar de 36 cm de asiento redondo y 75 cm de alto, patas negras con apoyapiés (el de la mesa cóctel y la barra).", "asiento",
    { anchoCm: 36, fondoCm: 36, altoCm: 75 }, ["#2b2b2b", "#8a6a45"], ["patas", "asiento"], deAsiento(taburete, "metal", "madera"), { asiento: true, retiroCm: 215 }),
  mueble("taburete_bajo", "Taburete bajo", "Taburete bajo redondo de 36 cm y 45 cm de alto, patas negras y asiento de madera.", "asiento",
    { anchoCm: 36, fondoCm: 36, altoCm: 45 }, ["#2b2b2b", "#8a6a45"], ["patas", "asiento"], deAsiento(taburete, "metal", "madera"), { asiento: true, retiroCm: 215 }),
  mueble("sofa", "Sofá", "Sofá de tres plazas de 2 m, 88 cm de fondo y 80 cm de alto, tapizado beige con patas oscuras (zona lounge).", "asiento",
    { anchoCm: 200, fondoCm: 88, altoCm: 80 }, ["#c9b8a2", "#3a2c20"], ["tela", "patas"], deAsiento(sofa, "madera", "tela", true)),
  mueble("love_seat", "Love seat", "Sofá pequeño de dos plazas (love seat) de 1,4 m y 78 cm de alto, tapizado.", "asiento",
    { anchoCm: 140, fondoCm: 82, altoCm: 78 }, ["#c9b8a2", "#3a2c20"], ["tela", "patas"], deAsiento(sofa, "madera", "tela", true)),
  mueble("sillon", "Sillón", "Sillón individual de 85 cm, 85 cm de fondo y 80 cm de alto, tapizado.", "asiento",
    { anchoCm: 85, fondoCm: 85, altoCm: 80 }, ["#c9b8a2", "#3a2c20"], ["tela", "patas"], deAsiento(sofa, "madera", "tela", true), { asiento: true }),

  MESA_IMPERIAL,
  mueble("mesa_imperial_mantel", "Mesa imperial con mantel", "Mesa larga imperial de banquete de 2,4 × 0,9 m y 75 cm de alto con mantel blanco hasta el piso.", "mesa",
    { anchoCm: 240, fondoCm: 90, altoCm: 75 }, ["#f7f6f2"], ["mantel"], mantelRectangular),
  mueble("mesa_redonda", "Mesa redonda", "Mesa redonda de banquete de 1,5 m y 75 cm de alto, sin mantel (tapa clara, pie central gris).", "mesa",
    { anchoCm: 150, fondoCm: 150, altoCm: 75 }, ["#f1ede4", "#6f6f6f"], ["tapa", "pie"], deMesa(mesaRedonda, "mate", "metal")),
  MESA_REDONDA_MANTEL,
  mueble("mesa_coctel", "Mesa cóctel", "Mesa alta de cóctel (periquera) de 60 cm y 110 cm de alto, sin mantel: tapa blanca, pie cromado.", "mesa",
    { anchoCm: 60, fondoCm: 60, altoCm: 110 }, ["#f4f1ea", "#c9c9c9"], ["tapa", "pie y base"], deMesa(mesaCoctel, "satinado", "metal")),
  mueble("mesa_coctel_licra", "Mesa cóctel con licra", "Mesa alta de cóctel de 60 cm y 110 cm de alto con funda de licra blanca ajustada.", "mesa",
    { anchoCm: 60, fondoCm: 60, altoCm: 110 }, ["#f7f6f2"], ["funda"], (o) => mesaCoctelLicra({ ...o, tapa: color(o, 0, "tela"), patas: color(o, 0, "tela") })),
  mueble("mesa_postres", "Mesa de postres", "Consola o mesa de postres angosta de 1,8 m × 45 cm y 90 cm de alto, sin mantel (tapa crema, patas doradas).", "mesa",
    { anchoCm: 180, fondoCm: 45, altoCm: 90 }, ["#e9dfcd", "#c9a14a"], ["tapa", "patas"], deMesa(consola, "madera", "metal")),
  mueble("mesa_postres_mantel", "Mesa de postres con mantel", "Mesa de postres de 1,8 m × 45 cm y 90 cm de alto con mantel blanco hasta el piso.", "mesa",
    { anchoCm: 180, fondoCm: 45, altoCm: 90 }, ["#f7f6f2"], ["mantel"], mantelRectangular),
  mueble("mesa_centro", "Mesa de centro", "Mesa de centro baja de 1 m × 55 cm y 42 cm de alto, tapa de madera y patas negras (zona lounge).", "mesa",
    { anchoCm: 100, fondoCm: 55, altoCm: 42 }, ["#8a6a45", "#2b2b2b"], ["tapa", "patas"], deMesa(mesaCentro, "madera", "metal")),
  mueble("mesa_hexagonal", "Mesa hexagonal dorada", "Mesa hexagonal de alambre dorado de 50 cm y 60 cm de alto (suelta); con un tercer color lleva vidrio.", "mesa",
    { anchoCm: 50, fondoCm: 50, altoCm: 60 }, ["#d4af5a"], ["alambre", "—", "vidrio (opcional)"],
    (o) => mesaHexagonal({ ...o, tapa: color(o, 0, "metal"), patas: color(o, 0, "metal"), ...(o.colores[1] ? { extra: color(o, 1, "brillante") } : {}) }), { retiroCm: 100 }),
  mueble("mesas_nido_hexagonales", "Mesas nido hexagonales", "Juego de tres mesas nido hexagonales de alambre dorado (50, 40 y 31 cm) de 70, 62 y 55 cm de alto, corridas en escalón.", "mesa",
    { anchoCm: 50, fondoCm: 50, altoCm: 70 }, ["#d4af5a"], ["alambre"],
    (o) => mesasNidoHexagonales({ ...o, tapa: color(o, 0, "metal"), patas: color(o, 0, "metal"), ...(o.colores[1] ? { extra: color(o, 1, "brillante") } : {}) }), { retiroCm: 100 }),
  mueble("mesa_regalos", "Mesa de regalos", "Mesa de 1,5 m con mantel blanco hasta el piso y una pila de cajas de regalo con moños encima.", "mesa",
    { anchoCm: 150, fondoCm: 70, altoCm: 75 }, ["#f7f6f2", "#c9a14a", "#f0b8c8"], ["mantel", "cajas de regalo", "más cajas"], deMesa(mesaRegalos, "tela", "satinado")),
  mueble("carrito_dulces", "Carrito de dulces", "Carrito de dulces (candy cart) de 90 × 50 cm y 150 cm de alto: repisas, techo con volante y frascos de golosinas.", "mesa",
    { anchoCm: 90, fondoCm: 50, altoCm: 150 }, ["#f4f1ea", "#c9c9c9", "#d6336c"], ["cuerpo", "metal", "volante y frascos"], deMesa(carritoDulces, "satinado", "metal")),

  mueble("aro_metalico", "Aro metálico", "Aro metálico dorado de 1,5 m con pie (fondo circular para globos o flores), 1,75 m de alto total.", "decorado",
    { anchoCm: 150, fondoCm: 34, altoCm: 175 }, ["#d6b25a"], ["metal"], deDecorado((o) => marcoMetalico({ ...o, forma: "aro" }), "metal", "metal"), { retiroCm: 30 }),
  mueble("aro_hexagonal", "Marco hexagonal metálico", "Marco hexagonal metálico dorado de 1,4 m con pie, 1,7 m de alto total.", "decorado",
    { anchoCm: 140, fondoCm: 34, altoCm: 170 }, ["#d6b25a"], ["metal"], deDecorado((o) => marcoMetalico({ ...o, forma: "hexagono" }), "metal", "metal"), { retiroCm: 30 }),
  mueble("arco_metalico", "Arco metálico", "Arco de medio punto metálico dorado de 1,2 × 2,3 m con patines (para cubrir de globos o flores).", "decorado",
    { anchoCm: 120, fondoCm: 34, altoCm: 230 }, ["#d6b25a"], ["metal"], deDecorado((o) => marcoMetalico({ ...o, forma: "arco" }), "metal", "metal"), { retiroCm: 30 }),
  mueble("base_hexagonal", "Base hexagonal", "Base o plinto hexagonal blanco de 80 cm y 60 cm de alto, con tapa (para pastel, flores o una figura).", "decorado",
    { anchoCm: 80, fondoCm: 80, altoCm: 60 }, ["#f4f1ea"], ["color"], deDecorado(baseHexagonal, "satinado", "satinado")),
  mueble("peldanos", "Peldaños de exhibición", "Tres peldaños de exhibición blancos de 1,2 m, 90 cm de fondo y 60 cm de alto en el de atrás (la más alta atrás).", "decorado",
    { anchoCm: 120, fondoCm: 90, altoCm: 60 }, ["#f4f1ea"], ["color"], deDecorado(peldanos, "satinado", "satinado")),
  mueble("escalera_decorativa", "Escalera decorativa", "Escalera decorativa de madera de 45 cm y 1,5 m de alto apoyada en la pared (boho), con peldaños.", "decorado",
    { anchoCm: 45, fondoCm: 40, altoCm: 150 }, ["#a8815a"], ["madera"], deDecorado(escaleraDecorativa, "madera", "madera"), { retiroCm: 30 }),
  mueble("biombo", "Biombo", "Biombo plegable de tres paneles en zigzag, 1,8 m a lo largo y 1,8 m de alto, marco de madera y tela clara.", "decorado",
    { anchoCm: 180, fondoCm: 30, altoCm: 180 }, ["#8a6a45", "#efe7d6"], ["marco", "tela"], deDecorado(biombo, "madera", "tela"), { retiroCm: 40 }),
  mueble("jarron_pampas", "Jarrón con pampas", "Jarrón grande de 26 cm con tallos de pampas de 1,4 m de alto (decoración de piso).", "decorado",
    { anchoCm: 26, fondoCm: 26, altoCm: 140 }, ["#e9dfcd", "#d8c3a0"], ["jarrón", "pampas"], deDecorado(jarronPampas, "mate", "tela"), { retiroCm: 40 }),
  mueble("lampara_pie", "Lámpara de pie", "Lámpara de pie de 1,65 m con pantalla de tela encendida, base y mástil negros.", "decorado",
    { anchoCm: 40, fondoCm: 40, altoCm: 165 }, ["#2b2b2b", "#ffe9c0"], ["base y mástil", "pantalla"], deDecorado(lamparaPie, "metal", "llama"), { retiroCm: 40 }),
  mueble("base_pastel", "Base de pastel", "Base de pastel (platón sobre pie) blanca de 32 cm de plato y 18 cm de alto; va sobre una mesa.", "decorado",
    { anchoCm: 32, fondoCm: 32, altoCm: 18 }, ["#f4f1ea"], ["color"], deDecorado(basePastel, "brillante", "brillante")),
  mueble("neon_cursiva", "Letrero de neón", "Letrero de neón en cursiva de 1,2 × 0,6 m sobre acrílico oscuro (texto a elegir, por defecto «Happy Birthday»); va en la pared.", "decorado",
    { anchoCm: 120, fondoCm: 2, altoCm: 60 }, ["#101014", "#ff4fa3"], ["tablero", "luz del neón"], deDecorado(neonCursiva, "satinado", "llama"), { lugar: "pared", alturaParedCm: 130, conTexto: true }),
  mueble("columna_griega", "Columna griega", "Columna griega blanca de 30 cm de diámetro y 1,1 m de alto, con base y capitel.", "decorado",
    { anchoCm: 30, fondoCm: 30, altoCm: 110 }, ["#f4f1ea"], ["color"], deDecorado(columnaGriega, "satinado", "satinado"), { retiroCm: 40 }),
  mueble("alfombra_redonda", "Alfombra redonda", "Alfombra redonda de tela de 2 m; con un segundo color lleva ribete.", "decorado",
    { anchoCm: 200, fondoCm: 200, altoCm: 1 }, ["#e9e2d6", "#e9e2d6"], ["alfombra", "ribete"], deDecorado(alfombraRedonda, "tela", "tela"), { retiroCm: 160 }),
];

const porId = (id: string): MuebleCatalogo => MUEBLES_CATALOGO.find((m) => m.id === id)!;

/** Conjuntos: el mueble con sus sillas en una sola pieza (la mesa de banquete lista para poner). */
const CONJUNTOS: readonly MuebleCatalogo[] = [
  mueble("mesa_redonda_sillas", "Mesa redonda con 8 sillas", "Mesa redonda de 1,5 m con mantel blanco y ocho sillas Tiffany doradas alrededor, en una sola pieza.", "mesa",
    { anchoCm: 150, fondoCm: 150, altoCm: 75 }, ["#f7f6f2", "#d6b25a", "#f4efe4"], ["mantel", "sillas", "cojines"],
    (o) => conSillas(MESA_REDONDA_MANTEL.armar({ ...o, colores: [o.colores[0]!] }), o, SILLA_TIFFANY, 8, [o.colores[1] ?? "#d6b25a", o.colores[2] ?? "#f4efe4"]), { retiroCm: 190 }),
  mueble("mesa_imperial_sillas", "Mesa imperial con 10 sillas", "Mesa larga imperial de 2,4 × 0,9 m con mantel blanco y diez sillas Tiffany (cuatro por lado y una en cada cabecera).", "mesa",
    { anchoCm: 240, fondoCm: 90, altoCm: 75 }, ["#f7f6f2", "#d6b25a", "#f4efe4"], ["mantel", "sillas", "cojines"],
    (o) => conSillas(mantelRectangular({ ...o, colores: [o.colores[0]!] }), o, SILLA_TIFFANY, 10, [o.colores[1] ?? "#d6b25a", o.colores[2] ?? "#f4efe4"]), { retiroCm: 190 }),
  mueble("sala_lounge", "Zona lounge", "Zona lounge: sofá de tres plazas al fondo, dos sillones a los lados y una mesa de centro.", "asiento",
    { anchoCm: 260, fondoCm: 220, altoCm: 80 }, ["#c9b8a2", "#3a2c20", "#8a6a45"], ["tela", "patas", "mesa de centro"],
    (o) => {
      const tela = [o.colores[0]!, o.colores[1] ?? "#3a2c20"];
      return [
        ...trasladarGirar(porId("sofa").armar({ ...porId("sofa").medidas, colores: tela }), 0, -65, 0),
        ...trasladarGirar(porId("sillon").armar({ ...porId("sillon").medidas, colores: tela }), -150, 45, 70),
        ...trasladarGirar(porId("sillon").armar({ ...porId("sillon").medidas, colores: tela }), 150, 45, -70),
        ...trasladarGirar(porId("mesa_centro").armar({ ...porId("mesa_centro").medidas, colores: [o.colores[2] ?? "#8a6a45", "#2b2b2b"] }), 0, 50, 0),
      ];
    }, { retiroCm: 190 }),
];

export const CATALOGO_MOBILIARIO: readonly MuebleCatalogo[] = [...MUEBLES_CATALOGO, ...CONJUNTOS];
