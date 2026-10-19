import type { Vec3 } from "./modulos";
import type { Colocacion, Escena, NodoEscena } from "./escena";
import type { MotivoEscenografia } from "./escenografia";
import type { Pieza } from "./piezas";
import {
  bandeja, banderin, banderinEntre, bolsaDulces, cajaRegalo, calabazaDulces, cubiertos, gorrito, letrero, mantel, paquete, platos, servilletas, sobreMesa, vasos, velas,
  type FormaBanderin,
} from "./utileria";

/**
 * La utilería de fiesta de las escenas de Halloween (lo que se ve en las fotos 1 y 2 del dueño, 2026-10-07) y las
 * piezas listas del grupo «Utilería de fiesta» de «Decoraciones pequeñas». Cada pieza apunta al producto Sempertex
 * más parecido de `utileria-catalogo.ts` (por su handle); lo que la tienda no tiene sale como «genérico».
 */

export const COLOR = {
  negro: "#1a1414", naranja: "#f07a1a", morado: "#6d3a8f", lila: "#9b6fc6", verde: "#8cc63f", blanco: "#f6f4ef", gris: "#c9c9cc",
} as const;

const HAPPY: MotivoEscenografia = { dibujo: "texto", texto: "Happy Halloween" };

/** Una pieza de utilería puesta en la escena. */
const nodo = (id: string, nombre: string, pieza: Pieza, colocacion: Colocacion): NodoEscena => ({ id, nombre, pieza, colocacion });

/** Sobre la tapa de una mesa de la escena (o del tapete), corrida (dx, dz) de su centro. */
function en(escena: Escena, mesaId: string, dx: number, dz: number, giro = 0): Colocacion {
  const c = sobreMesa(escena, mesaId, dx, dz, giro);
  if (!c) throw new Error(`No hay superficie en «${mesaId}» en (${dx}, ${dz})`);
  return c;
}

/** El banderín que rodea el frente de una mesa redonda: cordón justo bajo la tapa y banderines colgando por delante. */
function banderinDeMesa(escena: Escena, mesaId: string, radioTapaCm: number, grados: number, cantidad: number): { pieza: Pieza; colocacion: Colocacion } {
  const mesa = escena.nodos.find((n) => n.id === mesaId);
  if (!mesa || mesa.colocacion.en !== "piso") throw new Error(`«${mesaId}» no es una mesa en el piso`);
  const tapa = en(escena, mesaId, 0, 0);
  return {
    pieza: banderin({
      recorrido: { tipo: "arco", radioCm: radioTapaCm + 1.2, desdeGrados: -grados, hastaGrados: grados },
      caidaCm: 3, cantidad, forma: "triangulo", anchoCm: 13, altoCm: 21,
      colores: [COLOR.negro, COLOR.naranja],
      motivos: [{ ...HAPPY, hex: COLOR.naranja }, { dibujo: "calavera", hex: COLOR.negro }],
      cordon: COLOR.negro, productoId: "cartel-de-letras-happy-halloween",
    }),
    colocacion: { en: "libre", xCm: mesa.colocacion.xCm, yCm: tapa.en === "libre" ? tapa.yCm - 1.5 : 60, zCm: mesa.colocacion.zCm, giroGrados: 0 },
  };
}

/**
 * Foto 1 (marco orgánico con mesas): la guirnalda de recortes (calaveras, murciélagos, calabazas) bajo el travesaño
 * del marco —los fantasmitas que ya tiene la escena quedan sentados en su cordón—, los banderines «Happy Halloween» en
 * el frente de las dos mesas negras, platos, vasos y servilletas morados, naranjas y verdes sobre ellas, la cubeta y
 * la bolsa de dulces en el piso, el letrero de calabaza y los paquetes de producto al frente.
 */
export function utileriaMarcoConMesas(escena: Escena): NodoEscena[] {
  // El cordón cruza el borde de dentro del panel de delante del marco (z = −201,75), 1 cm por delante, a 1,99 m.
  const guirnalda = banderinEntre({ x: -68, y: 199, z: -200.6 }, { x: 68, y: 199, z: -200.6 }, {
    caidaCm: 7, cantidad: 8, forma: "circulo", anchoCm: 11, altoCm: 11,
    colores: [COLOR.negro, COLOR.morado, COLOR.naranja],
    motivos: [{ dibujo: "calavera", hex: COLOR.blanco }, { dibujo: "murcielago", hex: COLOR.negro }, { dibujo: "calabaza", hex: COLOR.negro }],
    cordon: COLOR.negro, productoId: "feston-fantasma-blanco-negro",
  });
  const baja = banderinDeMesa(escena, "mesa-baja", 31.8, 70, 5);
  const alta = banderinDeMesa(escena, "mesa-alta", 35.8, 55, 4);
  return [
    nodo("fiesta-guirnalda-marco", "Guirnalda de recortes bajo el marco", guirnalda.pieza, guirnalda.colocacion),
    nodo("fiesta-banderin-mesa-baja", "Banderín «Happy Halloween» (mesa baja)", baja.pieza, baja.colocacion),
    nodo("fiesta-banderin-mesa-alta", "Banderín «Happy Halloween» (mesa alta)", alta.pieza, alta.colocacion),
    // Mesa baja: dos platos de pie atrás (lila con lunares y naranja), vasos lila con servilleta naranja y platos naranja.
    nodo("fiesta-plato-lila", "Plato lila de pie", platos({ cantidad: 1, diametroCm: 23, hex: COLOR.lila, motivo: { dibujo: "lunares", hex: COLOR.blanco }, dePie: true, productoId: "plato-deluxe-oxo", variante: "lila" }), en(escena, "mesa-baja", -11, -14)),
    nodo("fiesta-plato-naranja", "Plato naranja de pie", platos({ cantidad: 1, diametroCm: 23, hex: COLOR.naranja, dePie: true, productoId: "plato-deluxe-oxo", variante: "naranja" }), en(escena, "mesa-baja", 12, -14)),
    nodo("fiesta-vasos-lila", "Vasos lila con servilleta naranja", vasos({ cantidad: 2, altoCm: 9, diametroCm: 7.5, hex: COLOR.lila, servilleta: COLOR.naranja, productoId: "vaso-desechable-deluxe-oxo-pequeno", variante: "lila", servilletaProductoId: "servilleta-desechable-halloween-noche" }), en(escena, "mesa-baja", -9, 9)),
    nodo("fiesta-platos-naranja", "Platos naranja (pila)", platos({ cantidad: 3, diametroCm: 18, hex: COLOR.naranja, centro: COLOR.negro, motivo: { dibujo: "calabaza" }, productoId: "plato-desechable-polka-rayas-naranja-negro" }), en(escena, "mesa-baja", 13, 9)),
    // Mesa alta: plato naranja con lunares negros y plato lila «Happy Halloween» de pie, vasos verdes y servilletas lila.
    nodo("fiesta-plato-polka", "Plato naranja con lunares de pie", platos({ cantidad: 1, diametroCm: 18, hex: COLOR.naranja, motivo: { dibujo: "lunares", hex: COLOR.negro }, dePie: true, productoId: "plato-desechable-polka-rayas-naranja-negro" }), en(escena, "mesa-alta", -13, -15)),
    nodo("fiesta-plato-happy", "Plato «Happy Halloween» de pie", platos({ cantidad: 1, diametroCm: 18, hex: COLOR.morado, centro: COLOR.lila, motivo: { ...HAPPY, hex: COLOR.negro }, dePie: true, productoId: "plato-desechable-happy-halloween" }), en(escena, "mesa-alta", 12, -15)),
    nodo("fiesta-vasos-verdes", "Vasos verdes con servilleta verde", vasos({ cantidad: 2, altoCm: 9, diametroCm: 7.5, hex: COLOR.verde, servilleta: COLOR.verde, productoId: "vaso-desechable-deluxe-oxo-pequeno", variante: "verde lima", servilletaProductoId: "servilleta-polka-verde-lima" }), en(escena, "mesa-alta", -8, 10)),
    nodo("fiesta-servilletas-lila", "Servilletas lila", servilletas({ cantidad: 12, ladoCm: 12.5, hex: COLOR.lila, motivo: { dibujo: "lunares", hex: COLOR.blanco }, productoId: "servilleta-polka-lila" }), en(escena, "mesa-alta", 15, 10)),
    // En el piso, sobre el tapete: la cubeta y la bolsa de dulces a la izquierda, el letrero de calabaza al frente de
    // la mesa baja y los paquetes de producto a la derecha.
    nodo("fiesta-cubeta", "Cubeta de dulces calabaza", calabazaDulces({ diametroCm: 19, altoCm: 15, hex: COLOR.naranja, productoId: "balde-calabaza" }), en(escena, "tapete", -122, 56)),
    nodo("fiesta-bolsa", "Bolsa de dulces calabaza", bolsaDulces({ anchoCm: 25.5, altoCm: 26, fondoCm: 8, hex: COLOR.naranja, asas: COLOR.naranja, motivo: { dibujo: "calabaza", hex: COLOR.negro }, productoId: "bolsita-dulces-halloween-calabaza" }), en(escena, "tapete", -80, 56)),
    nodo("fiesta-letrero", "Letrero de calabaza", letrero({ forma: "calabaza", anchoCm: 30, altoCm: 26, hex: COLOR.naranja, motivo: { dibujo: "calabaza", hex: COLOR.negro, escala: 1.4 }, apoyo: "atril", productoId: null, descripcion: "letrero de cartón con forma de calabaza (la tienda no lo tiene)" }), en(escena, "tapete", -4, 60)),
    nodo("fiesta-paquete-kit", "Paquete «Halloween» (kit desechable)", paquete({ anchoCm: 20, altoCm: 26, fondoCm: 3, hex: COLOR.negro, motivo: { dibujo: "texto", texto: "Halloween", hex: COLOR.blanco }, productoId: "kit-desechable-fantasmitas" }), en(escena, "tapete", 30, 54)),
    nodo("fiesta-paquete-serpentina", "Paquete de serpentina naranja", paquete({ anchoCm: 12, altoCm: 30, fondoCm: 3, hex: COLOR.naranja, motivo: { dibujo: "rayas", hex: "#c0392b" }, productoId: "serpentina-metalizada-naranja-negro" }), en(escena, "tapete", 56, 54)),
    nodo("fiesta-paquete-mantel-1", "Paquete de mantel Halloween", paquete({ anchoCm: 26, altoCm: 20, fondoCm: 1.5, hex: COLOR.naranja, motivo: { ...HAPPY, hex: COLOR.negro }, acostado: true, productoId: "mantel-fiesta-desechable-plastico-rectangular-halloween-friends" }), en(escena, "tapete", 98, 52, -8)),
    nodo("fiesta-paquete-mantel-2", "Paquete de mantel Halloween (otro)", paquete({ anchoCm: 26, altoCm: 20, fondoCm: 1.5, hex: COLOR.naranja, motivo: { ...HAPPY, hex: COLOR.negro }, acostado: true, productoId: "mantel-fiesta-desechable-plastico-rectangular-halloween-friends" }), en(escena, "tapete", 130, 50, 10)),
    nodo("fiesta-platos-negros", "Platos negros (pila en el piso)", platos({ cantidad: 4, diametroCm: 23, hex: COLOR.negro, productoId: "plato-deluxe-oxo", variante: "negro" }), en(escena, "tapete", 72, 60)),
  ];
}

/**
 * Foto 2 (arco con calabazas): el banderín de triángulos morados y naranjas («Happy Halloween», fantasmas,
 * murciélagos) colgado dentro del arco, de la cara de dentro de los globos de una pata a la de la otra, y sobre la
 * mesa los platos naranja y negro, vasos naranjas con servilleta verde, servilletas, cubiertos y la bandeja verde.
 */
export function utileriaArcoConCalabazas(escena: Escena): NodoEscena[] {
  // Los extremos: la cara de dentro de los globos de cada pata a 1,65 m (medida sobre el arco armado).
  const desde: Vec3 = { x: -79.6, y: 164.7, z: -147.5 }, hasta: Vec3 = { x: 71.9, y: 164.7, z: -147.5 };
  const triangulos = banderinEntre(desde, hasta, {
    caidaCm: 20, cantidad: 5, forma: "triangulo", anchoCm: 22, altoCm: 28,
    colores: [COLOR.morado, COLOR.naranja],
    motivos: [{ dibujo: "fantasma" }, { ...HAPPY, hex: COLOR.negro }, { dibujo: "murcielago", hex: COLOR.negro }, { ...HAPPY, hex: COLOR.negro }],
    cordon: COLOR.blanco, productoId: "cartel-de-letras-happy-halloween",
  });
  return [
    nodo("fiesta-banderin-arco", "Banderín de triángulos «Happy Halloween»", triangulos.pieza, triangulos.colocacion),
    nodo("fiesta-plato-polka", "Plato naranja con lunares de pie (tarima izquierda)", platos({ cantidad: 1, diametroCm: 18, hex: COLOR.naranja, motivo: { dibujo: "lunares", hex: COLOR.negro }, dePie: true, productoId: "plato-desechable-polka-rayas-naranja-negro" }), en(escena, "mesa", -36, -10)),
    nodo("fiesta-platos-rayas", "Platos naranja y negro (tarima derecha)", platos({ cantidad: 4, diametroCm: 18, hex: COLOR.negro, centro: COLOR.naranja, motivo: { dibujo: "rayas", hex: COLOR.negro }, productoId: "plato-desechable-polka-rayas-naranja-negro" }), en(escena, "mesa", 33, -8)),
    nodo("fiesta-vasos", "Vasos naranjas con servilleta verde", vasos({ cantidad: 2, altoCm: 9, diametroCm: 7.5, hex: COLOR.naranja, motivo: { dibujo: "murcielago", hex: COLOR.negro }, servilleta: COLOR.verde, productoId: "vaso-desechable-halloween-noche", servilletaProductoId: "servilleta-polka-verde-lima" }), en(escena, "mesa", -12, 15)),
    nodo("fiesta-servilletas", "Servilletas naranjas", servilletas({ cantidad: 10, ladoCm: 12.5, hex: COLOR.naranja, motivo: { dibujo: "murcielago", hex: COLOR.negro }, productoId: "servilleta-desechable-halloween-noche" }), en(escena, "mesa", 13, 17)),
    nodo("fiesta-cubiertos", "Cubiertos negros", cubiertos({ juegos: 2, hex: COLOR.negro, productoIds: { tenedor: "tenedor-desechable-deluxe-oxo", cuchillo: "cuchillo-desechable-deluxe-oxo", cuchara: "cuchara-desechable-deluxe-oxo" }, variante: "negro" }), en(escena, "mesa", 33, 18)),
    nodo("fiesta-bandeja", "Bandeja verde", bandeja({ anchoCm: 28, fondoCm: 19, hex: COLOR.verde, productoId: "bandeja-desechable-ovalada-deluxe-oxo", variante: "verde lima" }), en(escena, "mesa", -42, 19.5)),
  ];
}

// ----------------------------------------------------------------------------------------------------------
// Las piezas listas del grupo «Utilería de fiesta»
// ----------------------------------------------------------------------------------------------------------

/** Dónde se ofrece: colgada entre dos puntos (banderín), sobre una mesa o en el piso. */
export type DondeUtileria = "colgar" | "mesa" | "piso";

export type UtileriaLista = {
  id: string; nombre: string; descripcion: string; donde: DondeUtileria;
  /** Colores para su miniatura. */
  colores: string[];
  /** La pieza (el banderín, entre dos puntos locales que se dan al ponerlo). */
  crear: (entre?: { desde: Vec3; hasta: Vec3 }) => Pieza;
};

const banderinLista = (forma: FormaBanderin, colores: string[], motivos: Array<MotivoEscenografia | null>, productoId: string, ancho: number, alto: number) =>
  (entre?: { desde: Vec3; hasta: Vec3 }): Pieza => {
    const desde = entre?.desde ?? { x: -100, y: 0, z: 0 }, hasta = entre?.hasta ?? { x: 100, y: 0, z: 0 };
    const largo = Math.hypot(hasta.x - desde.x, hasta.z - desde.z);
    return banderin({ recorrido: { tipo: "recto", desde, hasta }, caidaCm: Math.max(8, largo * 0.12), cantidad: Math.max(3, Math.floor(largo / (ancho + 5))), forma, anchoCm: ancho, altoCm: alto, colores, motivos, cordon: COLOR.negro, productoId });
  };

export const UTILERIA_LISTA: readonly UtileriaLista[] = [
  { id: "banderin_halloween", nombre: "Banderín Happy Halloween", descripcion: "Triángulos morados y naranjas con «Happy Halloween», fantasmas y murciélagos (CARTEL DE LETRAS HAPPY HALLOWEEN).", donde: "colgar", colores: [COLOR.morado, COLOR.naranja],
    crear: banderinLista("triangulo", [COLOR.morado, COLOR.naranja], [{ dibujo: "fantasma" }, { ...HAPPY, hex: COLOR.negro }, { dibujo: "murcielago", hex: COLOR.negro }, { ...HAPPY, hex: COLOR.negro }], "cartel-de-letras-happy-halloween", 22, 28) },
  { id: "guirnalda_recortes", nombre: "Guirnalda de recortes", descripcion: "Calaveras, murciélagos y calabazas recortados en un cordón (FESTON FANTASMA BLANCO - NEGRO).", donde: "colgar", colores: [COLOR.negro, COLOR.morado, COLOR.naranja],
    crear: banderinLista("circulo", [COLOR.negro, COLOR.morado, COLOR.naranja], [{ dibujo: "calavera", hex: COLOR.blanco }, { dibujo: "murcielago", hex: COLOR.negro }, { dibujo: "calabaza", hex: COLOR.negro }], "feston-fantasma-blanco-negro", 12, 12) },
  { id: "banderola_fiesta", nombre: "Banderola de fiesta", descripcion: "Banderines de cola de golondrina de colores (BANDEROLA METALIZADA FELIZ CUMPLEAÑOS FESTIVO).", donde: "colgar", colores: ["#e0218a", "#ffd200", "#00a6b4", "#8cc63f"],
    crear: banderinLista("golondrina", ["#e0218a", "#ffd200", "#00a6b4", "#8cc63f"], [{ dibujo: "estrellas", hex: COLOR.blanco }, null], "banderola-metalizada-feliz-cumpleanos-festivo", 16, 22) },
  { id: "platos_halloween", nombre: "Platos naranja-negro", descripcion: "Pila de 4 platos de 18 cm con lunares (PLATO POLKA / RAYAS NARANJA-NEGRO, paquete de 8).", donde: "mesa", colores: [COLOR.naranja, COLOR.negro],
    crear: () => platos({ cantidad: 4, diametroCm: 18, hex: COLOR.naranja, motivo: { dibujo: "lunares", hex: COLOR.negro }, productoId: "plato-desechable-polka-rayas-naranja-negro" }) },
  { id: "plato_de_pie", nombre: "Plato de pie", descripcion: "Un plato lila de 23 cm apoyado de pie, de cara al salón (PLATO DELUXE OXO GRANDE).", donde: "mesa", colores: [COLOR.lila, COLOR.blanco],
    crear: () => platos({ cantidad: 1, diametroCm: 23, hex: COLOR.lila, motivo: { dibujo: "lunares", hex: COLOR.blanco }, dePie: true, productoId: "plato-deluxe-oxo", variante: "lila" }) },
  { id: "vasos", nombre: "Vasos con servilleta", descripcion: "Dos vasos naranjas de 9 oz con servilleta asomada (VASO HALLOWEEN NOCHE y SERVILLETA HALLOWEEN NOCHE).", donde: "mesa", colores: [COLOR.naranja, COLOR.naranja],
    crear: () => vasos({ cantidad: 2, altoCm: 9, diametroCm: 7.5, hex: COLOR.naranja, motivo: { dibujo: "murcielago", hex: COLOR.negro }, servilleta: COLOR.naranja, productoId: "vaso-desechable-halloween-noche", servilletaProductoId: "servilleta-desechable-halloween-noche" }) },
  { id: "servilletas", nombre: "Servilletas", descripcion: "Servilletas dobladas lila con lunares (SERVILLETA POLKA LILA, paquete de 16).", donde: "mesa", colores: [COLOR.lila, COLOR.blanco],
    crear: () => servilletas({ cantidad: 12, ladoCm: 12.5, hex: COLOR.lila, motivo: { dibujo: "lunares", hex: COLOR.blanco }, productoId: "servilleta-polka-lila" }) },
  { id: "cubiertos", nombre: "Cubiertos", descripcion: "Dos juegos de tenedor, cuchillo y cuchara negros (TENEDOR, CUCHILLO y CUCHARA DELUXE OXO).", donde: "mesa", colores: [COLOR.negro],
    crear: () => cubiertos({ juegos: 2, hex: COLOR.negro, productoIds: { tenedor: "tenedor-desechable-deluxe-oxo", cuchillo: "cuchillo-desechable-deluxe-oxo", cuchara: "cuchara-desechable-deluxe-oxo" }, variante: "negro" }) },
  { id: "bandeja", nombre: "Bandeja", descripcion: "Bandeja naranja de 28 cm (BANDEJA TELARAÑA NARANJA).", donde: "mesa", colores: [COLOR.naranja],
    crear: () => bandeja({ anchoCm: 28, fondoCm: 20, hex: COLOR.naranja, productoId: "bandeja-telarana-naranja" }) },
  { id: "mantel", nombre: "Mantel con caída", descripcion: "Mantel negro de plástico sobre la tapa con 45 cm de caída (MANTEL PLASTICO RECTANGULAR).", donde: "mesa", colores: [COLOR.negro],
    crear: () => mantel({ anchoCm: 120, fondoCm: 60, caidaCm: 45, hex: COLOR.negro, productoId: "mantel-fiesta-desechable-plastico-rectangular", variante: "negro" }) },
  { id: "velas", nombre: "Velas", descripcion: "Seis velitas espiraladas encendidas (VELA ESPIRALADA NEON).", donde: "mesa", colores: ["#e0218a", "#ffc23d"],
    crear: () => velas({ cantidad: 6, altoCm: 6, hex: "#e0218a", productoId: "vela-espiralada-neon" }) },
  { id: "topper", nombre: "Topper", descripcion: "Topper «Feliz cumpleaños» en un palito (TOPPER FELIZ CUMPLEAÑOS FANTASIA).", donde: "mesa", colores: ["#f4a6c0", COLOR.negro],
    crear: () => letrero({ forma: "rectangulo", anchoCm: 12, altoCm: 6, hex: "#f4a6c0", motivo: { dibujo: "texto", texto: "Feliz cumpleaños", hex: COLOR.negro }, apoyo: "palito", productoId: "topper-feliz-cumpleanos-fantasia" }) },
  { id: "calabaza_dulces", nombre: "Cubeta calabaza", descripcion: "Cubeta de dulces con cara de calabaza, 19 × 15 cm (BALDE CALABAZA).", donde: "piso", colores: [COLOR.naranja, COLOR.negro],
    crear: () => calabazaDulces({ diametroCm: 19, altoCm: 15, hex: COLOR.naranja, productoId: "balde-calabaza" }) },
  { id: "bolsa_dulces", nombre: "Bolsa de dulces", descripcion: "Bolsa naranja con asas y calabaza impresa, 25,5 × 30,5 cm (BOLSITA DULCES HALLOWEEN CALABAZA).", donde: "piso", colores: [COLOR.naranja, COLOR.negro],
    crear: () => bolsaDulces({ anchoCm: 25.5, altoCm: 26, fondoCm: 8, hex: COLOR.naranja, motivo: { dibujo: "calabaza", hex: COLOR.negro }, productoId: "bolsita-dulces-halloween-calabaza" }) },
  { id: "gorritos", nombre: "Gorritos", descripcion: "Tres gorritos de fiesta metalizados con pompón (GORROS METALIZADO FELIZ AÑO).", donde: "mesa", colores: ["#d4af37", COLOR.blanco],
    crear: () => gorrito({ cantidad: 3, altoCm: 16, diametroCm: 11, hex: "#d4af37", productoId: "gorros-metalizado-feliz-ano" }) },
  { id: "letrero_calabaza", nombre: "Letrero calabaza", descripcion: "Letrero de cartón con forma de calabaza en atril (genérico: la tienda no tiene uno igual).", donde: "piso", colores: [COLOR.naranja, COLOR.negro],
    crear: () => letrero({ forma: "calabaza", anchoCm: 30, altoCm: 26, hex: COLOR.naranja, motivo: { dibujo: "calabaza", hex: COLOR.negro, escala: 1.4 }, apoyo: "atril", productoId: null, descripcion: "letrero de cartón con forma de calabaza (la tienda no lo tiene)" }) },
  { id: "caja_regalo", nombre: "Caja de regalo", descripcion: "Caja de 20 cm con listón y moño (genérico: la tienda vende bolsas de regalo, no cajas).", donde: "piso", colores: [COLOR.morado, COLOR.verde],
    crear: () => cajaRegalo({ ladoCm: 20, altoCm: 16, hex: COLOR.morado, liston: COLOR.verde, productoId: null, descripcion: "caja de regalo (la tienda vende bolsas de regalo, no cajas)" }) },
];
