import type { ParteGlobo } from "./decoraciones";
import { SALA_INICIAL, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { ElementoEscenografia } from "./escenografia";
import { metalizadoDeTienda } from "./metalizados";
import { armarPieza, type Pieza } from "./piezas";
import type { IdeaDigitalizada, ProductoDeIdea } from "./ideas-sempertex/tipos";
import type { ImpresoEnPieza } from "./impresos-catalogo";

/**
 * **Ideas de fiesta de sempertex.com que dependen de globos impresos y metalizados**, digitalizadas con las piezas del
 * taller (ramo de helio, columnas, arco) más los impresos de `impresos-catalogo.ts` y los metalizados de
 * `metalizados.ts`. Cada una con los productos exactos de su ficha (`productos_mapeados` de la idea: nombre y url de
 * la tienda; la cantidad es la contada en la foto, `contada: true`), su foto pública y una nota honesta.
 * Mismo formato que las ideas de `ideas-sempertex/` (`IdeaDigitalizada`), más su `url`.
 *
 * Ramos: el ramo de helio de `halloween.ts` (espiral de ángulo de oro con cintas al peso), con la lista de globos de
 * arriba abajo, piso por piso como en la foto; R-12 de ramo a 28 cm. Los impresos van por índice o por color.
 * Columnas por bandas: una columna de un nivel por banda, apiladas y giradas 1/8 de vuelta cada una (como la trenza).
 */
export type IdeaImpresos = IdeaDigitalizada & { url: string };

const urlIdea = (slug: string) => `https://sempertex.com/blogs/idea-de-fiesta/${slug}`;
const R = (codigo: string, infladoCm = 28, formatoId = "R-12"): ParteGlobo => ({ formatoId, infladoCm, codigo });
const CINTA = { hex: "#f3f1ee" };
const libre = (xCm: number, yCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "libre", xCm, yCm, zCm, giroGrados });
const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const sala = (): Escena["sala"] => structuredClone(SALA_INICIAL);
const nodo = (id: string, nombre: string, pieza: Pieza, colocacion: Colocacion): NodoEscena => ({ id, nombre, pieza, colocacion });

/** Un ramo de helio (de arriba abajo) con sus impresos. */
function ramo(globos: ParteGlobo[], alturaCm: number, impresos: ImpresoEnPieza[] = []): Pieza {
  return {
    tipo: "decoracion", deFrente: true,
    decoracion: { tipo: "ramo_helio", propiedades: { globos, alturaCm, cinta: CINTA, peso: { hex: "#e9e6e1" } } },
    ...(impresos.length ? { impresos } : {}),
  };
}

/** Un producto de la ficha de la idea (nombre y url tal cual), con la cantidad contada en la foto (null: no se contó). */
const P = (nombre: string, url: string, formato: string | null, codigo: string | null, cantidad: number | null): ProductoDeIdea =>
  ({ nombre, url, formato, codigo, cantidad, ...(cantidad !== null ? { contada: true } : {}) });

/** Columnas de un nivel apiladas (una banda por color, girada 1/8 de vuelta respecto a la de abajo), desde `baseCm`. */
function bandas(prefijo: string, filas: Array<{ colores: string[]; patron: "un_color" | "dos_colores"; niveles: number; impresos?: ImpresoEnPieza[] }>, baseCm: number): { nodos: NodoEscena[]; arribaCm: number } {
  const nodos: NodoEscena[] = [];
  let y = baseCm, giro = 0;
  filas.forEach((f, k) => {
    const pieza: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 20 * (f.niveles - 1) + 26, patron: f.patron, colores: f.colores, ...(f.impresos ? { impresos: f.impresos } : {}) };
    const caja = armarPieza(pieza).caja;
    nodos.push(nodo(`${prefijo}-${k + 1}`, `Banda ${k + 1}`, pieza, libre(0, Math.round((y - caja.min.y) * 10) / 10, 0, giro)));
    // La siguiente banda encaja un poco en esta (el cuarteto de arriba se apoya en el de abajo).
    y += caja.max.y - caja.min.y - 6;
    giro += 45 * f.niveles;
  });
  return { nodos, arribaCm: y + 6 };
}

const CORAZONES_SURTIDOS = "infinity-corazones-surtidos-fashion-y-metal-surtido";

function fantasiaDeCorazones(): Escena {
  const filas = [
    { colores: ["005"], patron: "un_color" as const, niveles: 2 },
    ...["012", "570", "009", "015", "570"].map((c) => ({ colores: [c, "005"], patron: "dos_colores" as const, niveles: 1, impresos: [{ impresoId: CORAZONES_SURTIDOS, codigo: c }] })),
    { colores: ["005"], patron: "un_color" as const, niveles: 1 },
  ];
  const columna = bandas("columna", filas, 0);
  return {
    sala: sala(),
    nodos: [
      ...columna.nodos,
      nodo("ramo", "Tres corazones con helio", ramo([R("570"), R("012"), R("015")], 85, [{ impresoId: CORAZONES_SURTIDOS, globos: [0, 1, 2] }]), libre(0, Math.round(columna.arribaCm), 0)),
    ],
  };
}

function pasionDelFutbol(): Escena {
  const balon: Pieza = { tipo: "globo", formatoId: "R-24", infladoCm: 55, codigo: "005", impresos: [{ impresoId: "infinity-balon-de-futbol-fashion-blanco", codigo: "005" }] };
  const caja = armarPieza(balon).caja;
  const alto = caja.max.y - caja.min.y;
  const columna = bandas("banda", [
    { colores: ["015"], patron: "un_color", niveles: 2 },
    { colores: ["041"], patron: "un_color", niveles: 2 },
    { colores: ["020"], patron: "un_color", niveles: 4 },
  ], alto - 8);
  return { sala: sala(), nodos: [nodo("balon", "Balón de fútbol R-24", balon, PISO), ...columna.nodos] };
}

function cajaSorpresa(): Escena {
  const kraft = "#c9a27c", fucsia = "#d63a8c";
  const caja: ElementoEscenografia[] = [
    { forma: "caja", centro: { x: 0, y: 15, z: 0 }, tamano: { x: 34, y: 30, z: 34 }, hex: kraft, acabado: "mate" },
    { forma: "caja", centro: { x: 0, y: 15, z: 0 }, tamano: { x: 34.4, y: 30.4, z: 5 }, hex: fucsia, acabado: "satinado" },
    // La tapa, de pie y recostada a la izquierda, con su cinta.
    { forma: "caja", centro: { x: -34, y: 18, z: 10 }, tamano: { x: 36, y: 36, z: 3 }, hex: kraft, acabado: "mate", giroGrados: 25 },
    { forma: "caja", centro: { x: -34, y: 18, z: 10 }, tamano: { x: 6, y: 36.4, z: 3.4 }, hex: fucsia, acabado: "satinado", giroGrados: 25 },
  ];
  return {
    sala: sala(),
    nodos: [
      nodo("caja", "Caja de regalo kraft (no es globo)", { tipo: "escenografia", elementos: caja }, libre(0, 0, 0)),
      nodo("ramo", "Tres corazones modernos", ramo([R("012"), R("051"), R("009")], 150, [{ impresoId: "infinity-corazones-modernos-fashion-surtido", globos: [0, 1, 2] }]), libre(0, 6, 0)),
      nodo("corazon", "Corazón metalizado «I Love You»", { tipo: "metalizado", metalizado: metalizadoDeTienda("corazon-rosado-i-love-you", { cinta: { largoCm: 160, hex: CINTA.hex } }) }, libre(0, 6, 0)),
    ],
  };
}

function arcoAnoNuevo(): Escena {
  const numeros = [["numero-2-dorado-mate", 170], ["numero-0-dorado-mate", 128], ["numero-2-dorado-mate", 86], ["numero-5-dorado-mate", 44]] as const;
  return {
    sala: sala(),
    nodos: [
      nodo("arco", "Arco espiral silk", { tipo: "arco", formatoId: "R-12", infladoCm: 25, forma: "rectangular", anchoCm: 170, altoCm: 235, patron: "espiral", colores: ["826", "870", "806", "870"] }, PISO),
      ...numeros.map(([id, y], k) => nodo(`numero-${k + 1}`, `Número ${id.split("-")[1]} metalizado dorado`, { tipo: "metalizado", metalizado: metalizadoDeTienda(id, { pulgadas: 16 }) }, libre(85, y, 36))),
    ],
  };
}

function centroDeMesaEstrella(): Escena {
  return {
    sala: sala(),
    nodos: [
      nodo("columna", "Mini columna reflex azul y plata", { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 46, patron: "dos_colores", colores: ["940", "981"] }, PISO),
      nodo("estrella", "Estrella metalizada azul «Feliz Día del Padre»", {
        tipo: "metalizado",
        metalizado: { ...metalizadoDeTienda("estrella-azul-1"), impreso: { dibujo: "texto", texto: "Feliz Día\ndel Padre", hex: "#1d3461" } },
      }, libre(-14, 40, 8, -8)),
    ],
  };
}

export const IDEAS_IMPRESOS: readonly IdeaImpresos[] = [
  {
    id: "idea:adivina-nino-o-nina-rosado-azul", numero: 3, slug: "adivina-nino-o-nina-rosado-azul", url: urlIdea("adivina-nino-o-nina-rosado-azul"),
    nombre: "Adivina niño o niña: rosado y azul", ocasiones: ["baby shower"], fotoUrl: "https://sempertex.com/cdn/shop/articles/Rosado-Azul.jpg",
    productos: [
      P("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909", 2),
      P("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609", 1),
      P("GLOBO INFINITY® ES UNA NIÑA ESTRELLA", "/products/globo-para-fiesta-latex-redondo-infinity-es-una-nina-estrella-pastel-mate-rosado", "R-12", "609", 2),
      P("GLOBO INFINITY® ES UN NIÑO ESTRELLA", "/products/globo-para-fiesta-latex-redondo-infinity-es-un-nino-estrella-pastel-mate-azul", "R-12", "640", 1),
      P("GLOBO REDONDO PASTEL MATE AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-mate-azul", "R-12", "640", 2),
      P("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940", 1),
    ],
    contenido: { tipo: "pieza", pieza: ramo([R("609"), R("909"), R("909"), R("609"), R("640"), R("609"), R("640"), R("940"), R("640")], 165, [
      { impresoId: "infinity-es-una-nina-estrella-pastel-mate-rosado", globos: [3, 5] }, { impresoId: "infinity-es-un-nino-estrella-pastel-mate-azul", globos: [4] },
    ]), sugerida: PISO },
    nota: "Se parece: ramo de 9 R-12 por pisos (rosados arriba, los impresos al medio, azules abajo) con los productos de la ficha. No: en la foto los impresos dicen «¿Niña?» y «¿Niño?» con biberones y chupos sobre fondo claro; la ficha lista «Es una niña / Es un niño estrella» (pastel rosado y azul), que es lo que se dibuja. El ramo es una espiral, no pisos planos.",
  },
  {
    id: "idea:caja-sorpresa", numero: 226, slug: "caja-sorpresa", url: urlIdea("caja-sorpresa"),
    nombre: "Caja sorpresa con corazones", ocasiones: ["amor"], fotoUrl: "https://sempertex.com/cdn/shop/articles/DSC_5707_a48da6c0-2181-4ad1-b67b-befc897ec1f4.jpg",
    productos: [
      P("GLOBO REDONDO INFINITY® CORAZONES MODERNOS", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-modernos-fashion-surtido", "R-12", null, 3),
      P("GLOBO METALIZADO CORAZON ROSADO I LOVE YOU", "/products/globo-metalizado-corazon-rosado-i-love-you", null, null, 1),
    ],
    contenido: { tipo: "escena", escena: cajaSorpresa() },
    nota: "Se parece: tres R-12 Infinity corazones modernos (fucsia, violeta y rosado) y el corazón metalizado «I Love You» de 18\" más alto, saliendo de una caja kraft con cinta fucsia y la tapa recostada. No: la ficha mapeaba los corazones como C-12; son R-12 redondos. El corazón metalizado va blanco con el letrero (sin las rayas rosadas) y la caja es escenografía sencilla (sin moño).",
  },
  {
    id: "idea:violeta-rosado-confetti-dorado", numero: 976, slug: "violeta-rosado-confetti-dorado", url: urlIdea("violeta-rosado-confetti-dorado"),
    nombre: "Violeta, rosado, confeti y dorado", ocasiones: ["cumpleaños", "general"], fotoUrl: "https://sempertex.com/cdn/shop/articles/Violeta-Rosado-Dorado.jpg",
    productos: [
      P("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951", 3),
      P("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609", 2),
      P("GLOBO INFINITY® CONFETTI DORADO TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-confetti-dorado-fashion-transparente", "R-12", "390", 3),
      P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
    ],
    contenido: { tipo: "pieza", pieza: ramo([R("951"), R("951"), R("951"), R("609"), R("609"), R("390"), R("390"), R("390"), R("970"), R("970"), R("970")], 190, [
      { impresoId: "infinity-confetti-dorado-fashion-transparente", codigo: "390" },
    ]), sugerida: PISO },
    nota: "Se parece: 11 R-12 por pisos (3 reflex violeta, 2 pastel rosado, 3 cristal con confeti dorado impreso, 3 reflex dorado). No: el confeti impreso son puntos dorados repartidos (en la foto, más menudos y apretados); espiral en vez de pisos planos.",
  },
  {
    id: "idea:hojas-dorado-verde-lima", numero: 665, slug: "hojas-dorado-verde-lima", url: urlIdea("hojas-dorado-verde-lima"),
    nombre: "Hojas tropicales: dorado y verde lima", ocasiones: ["cumpleaños", "general"], fotoUrl: "https://sempertex.com/cdn/shop/articles/Dorado-Verde-Lima.jpg",
    productos: [
      P("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
      P("GLOBO REDONDO INFINITY® HOJAS TROPICALES FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-infinity-hojas-tropicales-fashion-negro", "R-12", "080", 3),
      P("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931", 3),
    ],
    contenido: { tipo: "pieza", pieza: ramo([R("970"), R("970"), R("970"), R("080"), R("080"), R("080"), R("931"), R("931"), R("931")], 165, [
      { impresoId: "infinity-hojas-tropicales-fashion-negro", codigo: "080" },
    ]), sugerida: PISO },
    nota: "Se parece: 3 reflex dorado arriba, 3 negros con hojas tropicales doradas impresas al medio y 3 reflex verde lima abajo, con los productos de la ficha. No: las hojas son un dibujo propio (hoja con nervaduras), no la monstera y la palma del producto; espiral en vez de pisos planos.",
  },
  {
    id: "idea:palomas-eucalipto-chocolate-durazno", numero: 820, slug: "palomas-eucalipto-chocolate-durazno", url: urlIdea("palomas-eucalipto-chocolate-durazno"),
    nombre: "Palomas, eucalipto, chocolate y durazno", ocasiones: ["bautizo y comunión"], fotoUrl: "https://sempertex.com/cdn/shop/articles/Bouquet-Palomas_69c187b6-67c8-4392-a669-157c4b42716f.png",
    productos: [
      P("GLOBO REDONDO INFINITY® PALOMAS FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-palomas-fashion-transparente", "R-12", "390", 2),
      P("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027", 3),
      P("GLOBO REDONDO FASHION CHOCOLATE", "/products/globo-para-fiesta-latex-redondo-fashion-chocolate", "R-12", "076", 3),
      P("GLOBO REDONDO FASHION DURAZNO", "/products/globo-para-fiesta-latex-redondo-fashion-durazno", "R-12", "060", 3),
    ],
    contenido: { tipo: "pieza", pieza: ramo([R("390"), R("390"), R("027"), R("027"), R("027"), R("076"), R("076"), R("076"), R("060"), R("060"), R("060")], 190, [
      { impresoId: "infinity-palomas-fashion-transparente", codigo: "390" },
    ]), sugerida: PISO },
    nota: "Se parece: 11 R-12 por pisos: 2 cristal con palomas blancas impresas arriba, 3 eucalipto, 3 chocolate y 3 durazno, los productos de la ficha. No: las palomas son una silueta propia; espiral en vez de pisos planos.",
  },
  {
    id: "idea:monstruos-plata-violeta-verde-lima", numero: 759, slug: "monstruos-plata-violeta-verde-lima", url: urlIdea("monstruos-plata-violeta-verde-lima"),
    nombre: "Monstruos: plata, violeta y verde lima", ocasiones: ["halloween", "infantil"], fotoUrl: "https://sempertex.com/cdn/shop/articles/Bouquet-Halloween-Monstruos_530ecc83-921d-43aa-8bce-a3dda30db500.png",
    productos: [
      P("GLOBO REDONDO 2 CARAS MONSTRUOS FASHION SURTIDO", "/products/globo-para-fiesta-latex-redondo-2-caras-monstruos-fashion-surtido", "R-12", null, 5),
      P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 2),
      P("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951", 3),
    ],
    contenido: { tipo: "pieza", pieza: ramo([R("061"), R("080"), R("051"), R("981"), R("981"), R("951"), R("951"), R("951"), R("031"), R("031")], 175, [
      { impresoId: "2-caras-monstruos-fashion-surtido", globos: [0, 1, 2, 8, 9] },
    ]), sugerida: PISO },
    nota: "Se parece: 10 R-12 por pisos (naranja, negro y violeta arriba; 2 reflex plata; 3 reflex violeta; 2 verde lima abajo). Los naranja, negro, violeta y verde lima son del surtido «2 caras monstruos» (la ficha no lista otros lisos de esos colores), con la cara de monstruo en blanco. No: en la foto solo se ve la cara del negro (los otros miran a otro lado); la cara es un dibujo propio, no la del producto.",
  },
  {
    id: "idea:arco-ano-nuevo", numero: 60, slug: "arco-ano-nuevo", url: urlIdea("arco-ano-nuevo"),
    nombre: "Arco de año nuevo con números dorados", ocasiones: ["año nuevo"], fotoUrl: "https://sempertex.com/cdn/shop/articles/Arco_ano_nuevo_1b60ead0-9e5d-40ba-b28c-4fe60ba01054.jpg",
    productos: [
      P("GLOBO REDONDO SILK BLANCO NÁCAR", "/products/globo-latex-redondo-silk-blanco-nacar", "R-12", "806", null),
      P("GLOBO REDONDO SILK DORADO", "/products/globo-latex-redondo-silk-rocio-de-oro", "R-12", "870", null),
      P("GLOBO REDONDO SILK VERDE MENTA", "/products/globo-latex-redondo-silk-verde-menta", "R-12", "826", null),
      P("GLOBO METALIZADO NUMERO 2 DORADO MATE", "/products/globo-metalizado-numero-2-dorado-mate", null, null, 2),
      P("GLOBO METALIZADO NUMERO 0 DORADO MATE", "/products/globo-metalizado-numero-0-dorado-mate", null, null, 1),
      P("GLOBO METALIZADO NUMERO 5 DORADO MATE", "/products/globo-metalizado-numero-5-dorado-mate", null, null, 1),
      P("GLOBO TUBITO FASHION NEGRO", "/products/globo-para-fiesta-latex-tubito-fashion-negro", "T-260", "080", null),
    ],
    contenido: { tipo: "escena", escena: arcoAnoNuevo() },
    nota: "Se parece: arco de cuartetos R-12 en espiral (silk verde menta, dorado y blanco nácar) de ~1,7 × 2,35 m, con «2025» en números metalizados dorados de 16\" bajando por la pata derecha. Las cantidades de los R-12 las da el 3D (no se contaron). No: el contorno de T-260 negro de cada número y los R-5 de relleno no se modelan; la espiral repite el dorado (la trenza espiral pide 4 colores).",
  },
  {
    id: "idea:fantasia-de-corazones", numero: 537, slug: "fantasia-de-corazones", url: urlIdea("fantasia-de-corazones"),
    nombre: "Fantasía de corazones", ocasiones: ["amor"], fotoUrl: "https://sempertex.com/cdn/shop/articles/49f7f82cf8697867a964917f64924dde_7469e710-d3f0-464f-bea8-7f1a11d2d780.jpg",
    productos: [
      P("GLOBO REDONDO INFINITY® CORAZONES SURTIDOS", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-surtidos-fashion-y-metal-surtido", "R-12", null, 13),
      P("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005", 22),
    ],
    contenido: { tipo: "escena", escena: fantasiaDeCorazones() },
    nota: "Se parece: columna de ~1,6 m con dos globos impresos de corazones por nivel (fucsia, dorado, rosado, rojo, dorado) y dos blancos, base y remate blancos, y tres impresos con helio arriba. No: en la foto el centro de la columna se ve de globitos blancos chicos; aquí son los blancos R-12 de cada cuarteto. La ficha mapeaba los corazones como C-12: son R-12 redondos.",
  },
  {
    id: "idea:la-pasion-del-futbol", numero: 682, slug: "la-pasion-del-futbol", url: urlIdea("la-pasion-del-futbol"),
    nombre: "La pasión del fútbol", ocasiones: ["general", "infantil"], fotoUrl: "https://sempertex.com/cdn/shop/articles/3eb38ae73979cfdafab27b3a6fa5bbb9_1a5eba79-0899-4da7-882e-542b59c54dfc.jpg",
    productos: [
      P("GLOBO REDONDO FASHION SURTIDO TRICOLOR", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-colores-primarios", "R-12", null, 32),
      P("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", "R-24", "005", 1),
    ],
    contenido: { tipo: "escena", escena: pasionDelFutbol() },
    nota: "Se parece: balón de fútbol impreso R-24 en el piso y encima la columna con la bandera de Colombia al revés (rojo, azul y amarillo doble, de abajo arriba) en cuartetos R-12 del surtido tricolor. No: el balón es un dibujo propio (pentágonos negros); la tienda vende el balón en R-5 a R-36 y la ficha no dice cuál: por la foto, R-24.",
  },
  {
    id: "idea:centro-de-mesa-estrella", numero: 283, slug: "centro-de-mesa-estrella", url: urlIdea("centro-de-mesa-estrella"),
    nombre: "Centro de mesa estrella", ocasiones: ["general"], fotoUrl: "https://sempertex.com/cdn/shop/articles/CENTRO_DE_MESA_ESTRELLA.jpg",
    productos: [
      P("GLOBO METALIZADO ESTRELLA AZUL", "/products/globo-metalizado-estrella-azul-1", null, null, 1),
      P("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 4),
      P("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940", 4),
      P("GLOBO TUBITO REFLEX PLATA", "/products/globo-para-fiesta-latex-tubito-reflex-plata", "T-260", "981", null),
    ],
    contenido: { tipo: "escena", escena: centroDeMesaEstrella() },
    nota: "Se parece: mini columna de dos cuartetos reflex azul y plata con la estrella metalizada azul de 18\" encima, con «Feliz Día del Padre» impreso. No: los tres arcos de T-260 plata detrás de la estrella no se modelan; el letrero de la estrella va recto y no en cursiva.",
  },
];

export function ideaImpresosPorSlug(slug: string): IdeaImpresos | undefined {
  return IDEAS_IMPRESOS.find((i) => i.slug === slug);
}
