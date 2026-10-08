import type { IdeaDigitalizada, ProductoDeIdea } from "./tipos";
import { armarEscena, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { PropiedadesFlorTubito, PropiedadesMono } from "../figuras";
import type { PatronColumna } from "../columnas";
import type { FormaArco } from "../arcos";
import type { ElementoEscenografia } from "../escenografia";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 01** (los números de `clasif/lote-01.json`: 12 ramos de
 * helio, 5 arcos y 3 columnas).
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta y ampliada:
 * - **Conteo**: los globos visibles, contando los que asoman por detrás. Ningún lote publica «Materiales» con cantidad:
 *   todas las cantidades son contadas en la foto (`contada: true`). En los arcos se cuentan los cuartetos (bloques de
 *   color, moños cada tantos niveles) y la forma sale de la proporción ancho/alto de la foto; el ancho y el alto del
 *   eje se eligen para que, con el paso de la trenza de Sempertex (0,8 diámetros), salgan esos niveles.
 * - **Colores**: si la idea publica productos, se usan ESOS códigos. Si no, se midió el color en la foto (Python/PIL:
 *   mediana de un parche y k-medias de los píxeles que no son fondo, ΔE en Lab contra `hexGlobo` de la tabla oficial)
 *   y se tomó el código más cercano que se fabrica en ese formato; cuando la medida engaña (sombra, cristal que se ve
 *   oscuro, brillo) se dice en la nota.
 * - **Impresos** (Infinity®, «Te amo», «15», filigrana, lunares…): el taller no imprime; van en el liso de su color de
 *   fondo, y la nota lo dice.
 * - **Ramos**: el ramo de helio de `halloween.ts` (espiral de ángulo de oro, cintas al peso). La lista va de arriba
 *   abajo, piso por piso como en la foto, y el alto sale de que cada piso de la foto mide ~0,9 diámetros: la espiral
 *   baja un piso cada tantos globos como tenga el piso. Los pisos de la foto son anillos planos; en el 3D son tramos
 *   de espiral (mismo orden de colores y misma altura por piso).
 * - **Columnas por bandas** (un color por nivel, tamaños distintos): columnas apiladas, una por banda, cada una girada
 *   lo que lleva la trenza (1/8 de vuelta por nivel) para que sigan encajando; los R-5 de relleno van en sus anclas.
 * Unidades: cm. R-12 de ramo a 28 cm, de estructura a 25 cm (el inflado de los tutoriales de Sempertex).
 */

// ----------------------------------------------------------------------------------------------------------
// Ayudas
// ----------------------------------------------------------------------------------------------------------

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
/** Un ramo dentro de una escena va suelto con su origen (el peso) en el piso: así el peso queda donde va, no corrido por su caja. */
const EN_EL_PESO: Colocacion = { en: "libre", xCm: 0, yCm: 0, zCm: 0, giroGrados: 0 };
const sala = (): Escena["sala"] => structuredClone(SALA_INICIAL);
const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** El producto liso de la tienda para un formato y un código (nombre y url relativa exactos de `GLOBOS_TIENDA`). */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const producto = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const p = productoDeGlobo(formatoId, codigo); return { nombre: p.nombre, url: quitarOrigen(p.url) }; })();
  return { nombre: producto.nombre, url: producto.url, formato: formatoId, codigo, cantidad, contada: true };
}

/** Un producto que la idea publica (nombre y url tal cual), con la cantidad contada en la foto. */
const publicado = (nombre: string, url: string, formato: string | null, codigo: string | null, cantidad: number): ProductoDeIdea => ({ nombre, url, formato, codigo, cantidad, contada: true });

/**
 * Los productos de lo que se armó (para las ideas que no publican productos): un liso por formato y código, con la
 * cantidad del 3D, que es la contada en la foto. Los tubitos se cuentan por largo: se compra el entero de arriba.
 */
function productosDe(contenido: IdeaDigitalizada["contenido"]): ProductoDeIdea[] {
  const materiales = contenido.tipo === "escena" ? armarEscena(contenido.escena).materiales : armarPieza(contenido.pieza).materiales;
  return materiales.filter((m) => m.cantidad > 0).map((m) => liso(m.formatoId, m.codigo, Math.ceil(m.cantidad - 1e-9)));
}

// ---------------------------------------------------------------------------- ramos de helio

/**
 * Un ramo de helio por pisos (de arriba abajo). Cada piso de la foto mide ~0,9 diámetros: la espiral del ramo baja
 * `tramo` por globo, y con `n / pisos` globos por piso el tramo es 0,9·d·pisos/n. `armarRamoHelio` usa
 * tramo = alto·0,55/(n − 1) (tope 0,62·d): de ahí el alto.
 */
function ramo(pisos: ReadonlyArray<{ codigo: string; cantidad: number; formatoId?: string }>, o: { cinta: string; peso: string; infladoCm?: number; /** Pisos de la foto, si un piso mezcla colores. */ nPisos?: number }): Pieza {
  const inflado = o.infladoCm ?? 28;
  const globos = pisos.flatMap((p) => Array.from({ length: p.cantidad }, () => R(p.formatoId ?? "R-12", inflado, p.codigo)));
  const n = globos.length;
  const tramo = Math.min(inflado * 0.62, (0.9 * inflado * (o.nPisos ?? pisos.length)) / n);
  const alturaCm = Math.round((tramo * (n - 1)) / 0.55);
  return { tipo: "decoracion", decoracion: { tipo: "ramo_helio", propiedades: { globos, alturaCm, cinta: { hex: o.cinta }, peso: { hex: o.peso } } } };
}

const CINTA_PLATA = "#d9d9de";

// ---------------------------------------------------------------------------- columnas por bandas

type Banda = { id: string; nombre: string; formatoId: string; infladoCm: number; niveles: number; patron: PatronColumna; colores: string[]; acento?: ParteGlobo };

/**
 * Columnas apiladas (una por banda): la de abajo en el piso y las demás sueltas encima, cada una con su primer
 * cuarteto a medio paso del último de la de abajo y girada 1/8 de vuelta por cada nivel que ya hay (sigue la trenza).
 * Devuelve los nodos y la altura del centro del último nivel y su inflado (para el remate).
 */
function apilar(bandas: readonly Banda[]): { nodos: NodoEscena[]; ultimoCm: number; ultimoInfladoCm: number } {
  const nodos: NodoEscena[] = [];
  let centro = 0, pasoAnterior = 0, niveles = 0;
  bandas.forEach((b, i) => {
    const paso = b.infladoCm * 0.8;
    const pieza: Pieza = { tipo: "columna", formatoId: b.formatoId, infladoCm: b.infladoCm, alturaCm: Math.round(b.niveles * paso * 10) / 10, patron: b.patron, colores: b.colores };
    if (i === 0) centro = -armarPieza(pieza).caja.min.y;
    else centro += (pasoAnterior + paso) / 2;
    const colocacion: Colocacion = i === 0 ? PISO : { en: "libre", xCm: 0, yCm: Math.round(centro * 100) / 100, zCm: 0, giroGrados: (niveles % 2) * 45 };
    nodos.push({ id: b.id, nombre: b.nombre, pieza, colocacion });
    if (b.acento) nodos.push({ id: `${b.id}-relleno`, nombre: `Relleno ${b.nombre.toLowerCase()}`, pieza: { tipo: "globo", formatoId: b.acento.formatoId, infladoCm: b.acento.infladoCm, codigo: b.acento.codigo }, colocacion: { en: "ancla", padreId: b.id, ancla: 0, cada: 1, giroGrados: 0 } });
    centro += (b.niveles - 1) * paso;
    pasoAnterior = paso;
    niveles += b.niveles;
  });
  const ultimo = bandas[bandas.length - 1];
  return { nodos, ultimoCm: centro, ultimoInfladoCm: ultimo?.infladoCm ?? 0 };
}

/** Un globo de remate (R-36, corazón) apoyado sobre el último nivel de una columna apilada. */
function remate(id: string, nombre: string, globo: ParteGlobo, pila: { ultimoCm: number; ultimoInfladoCm: number }): NodoEscena {
  const y = pila.ultimoCm + pila.ultimoInfladoCm * 0.42 + globo.infladoCm * 0.45;
  return { id, nombre, pieza: { tipo: "globo", formatoId: globo.formatoId, infladoCm: globo.infladoCm, codigo: globo.codigo }, colocacion: { en: "libre", xCm: 0, yCm: Math.round(y * 10) / 10, zCm: 0, giroGrados: 0 } };
}

// ---------------------------------------------------------------------------- arcos

const arco = (formatoId: string, infladoCm: number, forma: FormaArco, anchoCm: number, altoCm: number, patron: PatronColumna, colores: string[]): Pieza => ({ tipo: "arco", formatoId, infladoCm, forma, anchoCm, altoCm, patron, colores });

/** Índices de las anclas de un arco que miran de frente (+z), en los niveles pedidos (4 anclas por nivel). */
function anclasDeFrente(pieza: Pieza, niveles: readonly number[]): number[] {
  const anclas = armarPieza(pieza).anclas;
  return niveles.map((nivel) => {
    let mejor = nivel * 4;
    for (let h = 0; h < 4; h++) if ((anclas[nivel * 4 + h]?.normal.z ?? -2) > (anclas[mejor]?.normal.z ?? -2)) mejor = nivel * 4 + h;
    return mejor;
  });
}

/** Todas las anclas menos `usar` (para un reparto `cada: 1` que solo cae en esas). */
function omitirSalvo(total: number, usar: readonly number[]): number[] {
  const dentro = new Set(usar);
  return Array.from({ length: total }, (_, i) => i).filter((i) => !dentro.has(i));
}

// ----------------------------------------------------------------------------------------------------------
// Las 20 ideas
// ----------------------------------------------------------------------------------------------------------

const CDN = "https://sempertex.com/cdn/shop/articles/";

// 6 · AMARILLO - VERDE LIMA - EUCALIPTO - ARENA (ramo; productos publicados).
const ramo6 = ramo([{ codigo: "620", cantidad: 3 }, { codigo: "931", cantidad: 2 }, { codigo: "027", cantidad: 3 }, { codigo: "071", cantidad: 2 }], { cinta: CINTA_PLATA, peso: "#c9c9cf" });

// 159 · Autumn Harvest (ramo; productos publicados).
const ramo159 = ramo([{ codigo: "062", cantidad: 3 }, { codigo: "021", cantidad: 3 }, { codigo: "027", cantidad: 3 }, { codigo: "061", cantidad: 3 }, { codigo: "018", cantidad: 3 }], { cinta: "#e6dcc3", peso: "#c9c9cf" });

// 163 · AZUL - ARENA - DORADO (ramo; productos publicados).
const ramo163 = ramo([{ codigo: "040", cantidad: 3 }, { codigo: "044", cantidad: 3 }, { codigo: "071", cantidad: 3 }, { codigo: "970", cantidad: 3 }], { cinta: CINTA_PLATA, peso: "#c9c9cf" });

// 164 · AZUL - PLATA (ramo; publica Azul Rey 041 y Reflex Plata 981; los dos pisos de arriba se midieron).
const ramo164 = ramo([{ codigo: "390", cantidad: 3 }, { codigo: "839", cantidad: 3 }, { codigo: "041", cantidad: 3 }, { codigo: "981", cantidad: 3 }], { cinta: "#efe9df", peso: "#c9c9cf" });

// 212 · Bright Christmas (ramo; productos publicados).
const ramo212 = ramo([{ codigo: "016", cantidad: 3 }, { codigo: "018", cantidad: 2 }, { codigo: "059", cantidad: 3 }, { codigo: "609", cantidad: 3 }], { cinta: "#c0152b", peso: "#c0152b" });

// 316 · Charming Love (ramo; productos publicados).
const ramo316 = ramo([{ codigo: "107", cantidad: 4 }, { codigo: "059", cantidad: 3 }, { codigo: "609", cantidad: 3 }, { codigo: "015", cantidad: 3 }, { codigo: "016", cantidad: 3 }], { cinta: "#d0182a", peso: "#d0182a" });

// 417 · CONFETTI - BLANCO - PALO DE ROSA - ARENA (ramo; el Infinity® Confetti Dorado va en Cristal Transparente 390).
const ramo417 = ramo([{ codigo: "390", cantidad: 3 }, { codigo: "005", cantidad: 3 }, { codigo: "010", cantidad: 3 }, { codigo: "071", cantidad: 3 }], { cinta: "#f2b8c8", peso: "#f2b8c8" });

// 434 · CORAZONES MODERNOS - PLATA - GRAFITTI INVIERNO (ramo; impresos en su liso de fondo).
const ramo434 = ramo([
  { codigo: "012", cantidad: 1 }, { codigo: "051", cantidad: 1 }, { codigo: "015", cantidad: 1 }, { codigo: "009", cantidad: 1 },
  { codigo: "981", cantidad: 3 }, { codigo: "009", cantidad: 3 },
], { cinta: CINTA_PLATA, peso: "#c9c9cf", nPisos: 3 });

// 435 · CORAZONES MODERNOS - ROSADO - VIOLETA (ramo; impresos en su liso de fondo).
const ramo435 = ramo([
  { codigo: "051", cantidad: 1 }, { codigo: "015", cantidad: 1 }, { codigo: "012", cantidad: 1 }, { codigo: "009", cantidad: 1 },
  { codigo: "909", cantidad: 4 }, { codigo: "951", cantidad: 4 },
], { cinta: CINTA_PLATA, peso: "#c9c9cf", nPisos: 3 });

// 446 · Creamy Dusk (ramo; productos publicados).
const ramo446 = ramo([{ codigo: "970", cantidad: 3 }, { codigo: "060", cantidad: 3 }, { codigo: "027", cantidad: 2 }, { codigo: "140", cantidad: 3 }, { codigo: "010", cantidad: 3 }], { cinta: "#f0a6bd", peso: "#f0a6bd" });

// 64 · ARCO- AZUL Y ROJO: 11 bloques de 2 cuartetos (rojo, azul caribe, … rojo) → 22 niveles en salvavidas.
const arco64 = arco("R-12", 25, "parabolico", 168, 168, "salvavidas", ["015", "038"]);

// 84 · ARCO DOS COLORES: ~24 niveles de cuartetos 2 + 2 (cristal amarillo por fuera, fucsia por dentro).
const arco84 = arco("R-12", 25, "redondo", 230, 173, "espiral", ["020", "020", "014", "014"]);

// 110 · ARCO MIS 15 AÑOS: ~52 niveles de R-9 morado con una espiral de impresos «15» fucsia.
const arco110 = arco("R-9", 18, "parabolico", 350, 273, "espiral", ["014", "051", "051", "051"]);

// 141 · ARCO TRENZA DOS COLORES: ~44 niveles de R-9 en espiral doble rojo / amarillo.
const arco141 = arco("R-9", 18, "parabolico", 263, 244, "dos_colores", ["015", "021"]);

// 137 · ARCO REGALITOS FUCSIA: ~30 niveles fucsia, 12 moños morados de frente y 4 R-5 al pie de cada pata.
const arco137 = arco("R-12", 25, "redondo", 280, 222, "un_color", ["012"]);
const escena137 = ((): Escena => {
  const niveles = Math.max(2, armarPieza(arco137).anclas.length / 4);
  // 12 moños repartidos a lo largo del arco, cada uno en el nivel par más cercano (los pares tienen un ancla de frente).
  const nivelesMono = Array.from({ length: 12 }, (_, k) => { const ideal = 2 + (k * (niveles - 5)) / 11; return Math.min(niveles - 2, 2 * Math.round(ideal / 2)); });
  const anclas = armarPieza(arco137).anclas;
  const conMono = anclasDeFrente(arco137, [...new Set(nivelesMono)]);
  const pies = [0, 1, 2, 3, ...[0, 1, 2, 3].map((h) => (niveles - 1) * 4 + h)];
  const mono: PropiedadesMono = { formatoId: "T-260", grosorCm: 3.5, codigo: "051", lazosPorLado: 2, largoLazoCm: 15, anchoLazoCm: 10, aberturaGrados: 40, colas: true, largoColaCm: 12, centro: null };
  // Cada moño va SOBRE los globos (no en el hueco del ancla, donde quedaría enterrado): en el punto del ancla de
  // frente, corrido hacia fuera hasta apoyarse en los cuartetos, como amarrado encima en la foto.
  const monos: NodoEscena[] = conMono.map((i, k) => ({
    id: `mono-${k + 1}`, nombre: "Moño morado", pieza: { tipo: "decoracion", decoracion: { tipo: "mono", propiedades: mono } },
    colocacion: { en: "sobre", padreId: "arco", puntoCm: anclas[i]!.posicion, normal: anclas[i]!.normal, giroGrados: 0 },
  }));
  return {
    sala: sala(),
    nodos: [
      { id: "arco", nombre: "Arco de cuartetos fucsia", pieza: arco137, colocacion: PISO },
      ...monos,
      { id: "pies", nombre: "R-5 fucsia del pie", pieza: { tipo: "globo", formatoId: "R-5", infladoCm: 12, codigo: "012" }, colocacion: { en: "ancla", padreId: "arco", ancla: 0, cada: 1, giroGrados: 0, omitir: omitirSalvo(niveles * 4, pies) } },
    ],
  };
})();

// 288 · CENTRO DE MESA FILIGREE: 3 R-12 con helio (1 dorado y 2 perla impresos), botella dorada de peso y 2 flores rosadas.
const escena288 = ((): Escena => {
  const flor: PropiedadesFlorTubito = {
    petalos: { formatoId: "T-260", grosorCm: 3, codigos: ["409"], cantidad: 5, estilo: "lazo", largoCm: 9, anchoCm: 5.5, aperturaGrados: 25, giroGrados: 0 },
    interior: null, corona: null, centro: R("R-5", 6, "570"),
  };
  const ORO = "#c8893a";
  const botella: ElementoEscenografia[] = [
    { forma: "cilindro", base: { x: 0, y: 0, z: 0 }, radioCm: 3, altoCm: 12, hex: ORO, acabado: "metal" },
    { forma: "cilindro", base: { x: 0, y: 12, z: 0 }, radioCm: 3, altoCm: 4, radioArribaCm: 1.2, hex: ORO, acabado: "metal" },
    { forma: "cilindro", base: { x: 0, y: 16, z: 0 }, radioCm: 1.2, altoCm: 5, hex: ORO, acabado: "metal" },
  ];
  return {
    sala: sala(),
    nodos: [
      { id: "ramo", nombre: "Ramo de 3 globos con helio", pieza: { tipo: "decoracion", decoracion: { tipo: "ramo_helio", propiedades: { globos: [R("R-12", 28, "570"), R("R-12", 28, "406"), R("R-12", 28, "406")], alturaCm: 115, cinta: { hex: "#f3efe6" }, peso: { hex: ORO } } } }, colocacion: EN_EL_PESO },
      { id: "botella", nombre: "Botella dorada (peso)", pieza: { tipo: "escenografia", elementos: botella }, colocacion: PISO },
      { id: "flor-1", nombre: "Flor de lazos rosada", pieza: { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: flor } }, colocacion: { en: "libre", xCm: -8, yCm: 24, zCm: 3, giroGrados: 0 } },
      { id: "flor-2", nombre: "Flor de lazos rosada", pieza: { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: { ...flor, petalos: { ...flor.petalos, giroGrados: 36 } } } }, colocacion: { en: "libre", xCm: 7, yCm: 23, zCm: 2, giroGrados: 0 } },
    ],
  };
})();

// 308 · CENTRO DE MESA SAN VALENTÍN: ramo de 2 corazones y 3 redondos sobre una base de globos con un corazón encima.
const escena308 = ((): Escena => {
  const base: PropiedadesFlor = { petalos: { formatoId: "R-5", infladoCm: 9, codigo: "450", cantidad: 4, aperturaGrados: 0, giroGrados: 45 }, centro: null };
  const anillo: PropiedadesFlor = { petalos: { formatoId: "R-5", infladoCm: 6, codigo: "015", cantidad: 8, aperturaGrados: 0, giroGrados: 0 }, centro: null };
  const ARRIBA = { x: 0, y: 1, z: 0 };
  return {
    sala: sala(),
    nodos: [
      { id: "ramo", nombre: "Ramo de corazones y redondos", pieza: { tipo: "decoracion", decoracion: { tipo: "ramo_helio", propiedades: { globos: [R("C-12", 28, "015"), R("C-12", 28, "009"), R("R-12", 27, "010"), R("R-12", 27, "015"), R("R-12", 27, "005")], alturaCm: 145, cinta: { hex: "#f4f1ec" }, peso: { hex: "#b67cb6" } } } }, colocacion: EN_EL_PESO },
      { id: "base", nombre: "Base de 4 R-5 lila", pieza: { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: base } }, colocacion: PISO },
      { id: "cuerpo", nombre: "Cuerpo fucsia de la base", pieza: { tipo: "globo", formatoId: "R-9", infladoCm: 13, codigo: "012" }, colocacion: { en: "sobre", padreId: "base", puntoCm: { x: 0, y: 0, z: 0 }, normal: ARRIBA, giroGrados: 0 } },
      { id: "anillo", nombre: "Anillo de R-5 rojo", pieza: { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: anillo } }, colocacion: { en: "sobre", padreId: "cuerpo", puntoCm: { x: 0, y: 6.5, z: 0 }, normal: ARRIBA, giroGrados: 0 } },
      { id: "corazon", nombre: "Corazón rosado de la base", pieza: { tipo: "globo", formatoId: "C-12", infladoCm: 26, codigo: "009" }, colocacion: { en: "sobre", padreId: "anillo", puntoCm: { x: 0, y: 0, z: 0 }, normal: ARRIBA, giroGrados: 0 } },
    ],
  };
})();

// 372 · COLUMNA FELIZ CUMPLEAÑOS R 36: bandas arcoíris (anchas abajo y arriba, angostas al medio) con R-5 de relleno y un R-36 rojo impreso.
const escena372 = ((): Escena => {
  const pila = apilar([
    { id: "rojo", nombre: "Banda roja", formatoId: "R-12", infladoCm: 25, niveles: 2, patron: "un_color", colores: ["015"], acento: R("R-5", 11, "015") },
    { id: "naranja", nombre: "Banda naranja", formatoId: "R-12", infladoCm: 25, niveles: 2, patron: "un_color", colores: ["061"], acento: R("R-5", 11, "061") },
    { id: "amarillo", nombre: "Banda amarilla", formatoId: "R-9", infladoCm: 18, niveles: 1, patron: "un_color", colores: ["021"], acento: R("R-5", 10, "021") },
    { id: "verde", nombre: "Banda verde", formatoId: "R-9", infladoCm: 18, niveles: 1, patron: "un_color", colores: ["029"], acento: R("R-5", 10, "029") },
    { id: "celeste", nombre: "Banda celeste", formatoId: "R-9", infladoCm: 18, niveles: 1, patron: "un_color", colores: ["040"], acento: R("R-5", 10, "040") },
    { id: "morado", nombre: "Banda morada", formatoId: "R-9", infladoCm: 21, niveles: 2, patron: "un_color", colores: ["051"], acento: R("R-5", 11, "051") },
    { id: "fucsia", nombre: "Banda fucsia", formatoId: "R-12", infladoCm: 25, niveles: 2, patron: "un_color", colores: ["212"], acento: R("R-5", 11, "212") },
  ]);
  return { sala: sala(), nodos: [...pila.nodos, remate("r36", "R-36 rojo (impreso «Feliz Cumpleaños»)", R("R-36", 62, "015"), pila)] };
})();

// 432 · CORAZON POLKA: negro, fucsia liso, fucsia de lunares (impreso), negro que se angosta y un corazón rosado arriba.
const escena432 = ((): Escena => {
  const pila = apilar([
    { id: "columna", nombre: "Columna negro y fucsia", formatoId: "R-12", infladoCm: 25, niveles: 8, patron: "salvavidas", colores: ["080", "012", "012", "080"] },
    { id: "cuello", nombre: "Cuello R-9 negro", formatoId: "R-9", infladoCm: 18, niveles: 1, patron: "un_color", colores: ["080"] },
    { id: "punta", nombre: "Punta R-5 negro", formatoId: "R-5", infladoCm: 11, niveles: 1, patron: "un_color", colores: ["080"] },
  ]);
  return { sala: sala(), nodos: [...pila.nodos, remate("corazon", "Corazón rosado", R("C-12", 28, "009"), pila)] };
})();

// 501 · DIRECTO AL CORAZON: 6 niveles (rojo, impreso blanco de corazones, rojo, impreso rojo de labios, rojo, impreso
// blanco), corona de R-5 rojo y corazón rojo C-12 arriba.
const escena501 = ((): Escena => {
  const nivel = (id: string, nombre: string, codigo: string): Banda => ({ id, nombre, formatoId: "R-12", infladoCm: 25, niveles: 1, patron: "un_color", colores: [codigo] });
  const pila = apilar([
    nivel("nivel-1", "Cuarteto rojo", "015"), nivel("nivel-2", "Cuarteto blanco (impreso de corazones)", "005"), nivel("nivel-3", "Cuarteto rojo", "015"),
    nivel("nivel-4", "Cuarteto rojo (impreso de labios)", "015"), nivel("nivel-5", "Cuarteto rojo", "015"), nivel("nivel-6", "Cuarteto blanco (impreso de corazones)", "005"),
    { id: "corona", nombre: "Corona R-5 roja", formatoId: "R-5", infladoCm: 11, niveles: 1, patron: "un_color", colores: ["015"] },
  ]);
  const centro = remate("centro-corona", "R-5 rojo de la corona", R("R-5", 12, "015"), { ultimoCm: pila.ultimoCm - 4, ultimoInfladoCm: pila.ultimoInfladoCm });
  return { sala: sala(), nodos: [...pila.nodos, centro, remate("corazon", "Corazón rojo", R("C-12", 30, "015"), { ultimoCm: pila.ultimoCm + 6, ultimoInfladoCm: pila.ultimoInfladoCm })] };
})();

// ----------------------------------------------------------------------------------------------------------

type Base = Omit<IdeaDigitalizada, "id" | "productos"> & { productos?: ProductoDeIdea[] };

/** La idea completa: su id «idea:<slug>» y, si no publica productos, los lisos de lo armado (contados en la foto). */
function idea(b: Base): IdeaDigitalizada {
  return { id: `idea:${b.slug}`, ...b, productos: b.productos ?? productosDe(b.contenido) };
}

const pieza = (p: Pieza): IdeaDigitalizada["contenido"] => ({ tipo: "pieza", pieza: p, sugerida: PISO });
const escena = (e: Escena): IdeaDigitalizada["contenido"] => ({ tipo: "escena", escena: e });

/** Ideas de fiesta de sempertex.com digitalizadas: lote 01. */
export const LOTE_01: readonly IdeaDigitalizada[] = [
  idea({
    numero: 6, slug: "amarillo-verde-lima-eucalipto-arena", nombre: "Ramo amarillo, verde lima, eucalipto y arena", ocasiones: ["general"],
    fotoUrl: `${CDN}Amarillo-Verde-Eucalipto-Arena.jpg`,
    productos: [
      publicado("GLOBO REDONDO PASTEL MATE AMARILLO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-amarillo", "R-12", "620", 3),
      publicado("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931", 2),
      publicado("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027", 3),
      publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 2),
    ],
    contenido: pieza(ramo6),
    nota: "Igual: los 10 R-12 de la foto con los 4 productos publicados, de arriba abajo 3 Pastel Mate Amarillo, 2 Reflex Verde Lima, 3 Eucalipto y 2 Arena, con cintas plateadas. Distinto: en la foto cada color es un piso plano; en el 3D el ramo es una espiral que baja piso por piso (mismo orden y alto). El peso no se ve en la foto: va uno gris neutro.",
  }),
  idea({
    numero: 64, slug: "arco-azul-y-rojo", nombre: "Arco azul y rojo", ocasiones: ["cumpleaños"],
    fotoUrl: `${CDN}bede532cf38b5a519d30005953e179d3_c4995634-4ebc-45f4-8d09-6fedd05f97ce.jpg`,
    contenido: pieza(arco64),
    nota: "Igual: arco de cuartetos R-12 en salvavidas, 11 bloques de 2 cuartetos alternando rojo y azul caribe (empieza y termina en rojo): 22 niveles, 88 globos. Colores medidos en la foto (no publica productos): rojo #cf010e → Fashion Rojo 015; azul #02869f → Fashion Azul Caribe 038 (el Reflex Azul 940 mide un poco más cerca, pero la foto no es cromada). Distinto: en la foto los cuartetos van sueltos (un diámetro entre niveles) y el taller los aprieta a 0,8: el arco queda algo más bajo (eje 168 × 168 cm, parabólico).",
  }),
  idea({
    numero: 84, slug: "arco-dos-colores", nombre: "Arco dos colores", ocasiones: ["general"],
    fotoUrl: `${CDN}f51807b8fb5c28baec153a5f25da1207_a0d5d005-5c31-4cf2-a832-e28c70896cf6.jpg`,
    contenido: pieza(arco84),
    nota: "Igual: arco de 24 cuartetos R-12 de 2 + 2 (2 amarillos y 2 fucsia por cuarteto: 48 y 48), forma redonda de la foto (eje 230 × 173 cm). Distinto: en la foto los cuartetos no giran (amarillo por fuera, fucsia por dentro); la trenza del taller gira 1/8 por nivel y el 2 + 2 sale como espiral de dos bandas. El «cristal amarillo» no existe en la tabla: va el Fashion Amarillo 020 (la foto mide #c0ab02, oscurecido por la transparencia; el más cercano por ΔE sería Mostaza 023, más naranja). Fucsia perlado medido #fe4e6f → Frambuesa 014.",
  }),
  idea({
    numero: 110, slug: "arco-mis-15-anos", nombre: "Arco Mis 15 años", ocasiones: ["quince años", "cumpleaños"],
    fotoUrl: `${CDN}96e809188327ed377532ffba59fd7113_a164772b-5353-457e-b25b-0bce40a5e6b8.jpg`,
    contenido: pieza(arco110),
    nota: "Igual: arco parabólico de ~52 cuartetos de R-9 Violeta 051 (medido #6e3992) con una espiral de un globo fucsia por cuarteto (el impreso «15», medido #f23770 → Frambuesa 014), eje 350 × 273 cm. Distinto: los impresos «15» son R-12 más grandes que el morado y en la foto la espiral da la vuelta más despacio; aquí son R-9 lisos del mismo tamaño y el giro es el de la trenza (1/8 por nivel).",
  }),
  idea({
    numero: 137, slug: "arco-regalitos-fucsia", nombre: "Arco regalitos fucsia", ocasiones: ["cumpleaños", "infantil"],
    fotoUrl: `${CDN}42c99b12b747f5f12d28991cc8a1c812_aa036102-4033-4a8a-a759-5321ec6dc2cd.jpg`,
    contenido: escena(escena137),
    nota: "Igual: arco redondo de 30 cuartetos R-12 Fashion Fucsia 012 (medido #e21d6e), los 12 moños de T-260 Violeta 051 que se ven en la foto (medido #381354), todos de frente y repartidos a lo largo del arco, y el pie de cada pata con 4 R-5 fucsia. Distinto: los moños de la foto llevan 2 lazos y colas cortas sin globito al centro (así quedan); el pie de la foto es un poco más ancho.",
  }),
  idea({
    numero: 141, slug: "arco-trenza-dos-colores", nombre: "Arco trenza dos colores", ocasiones: ["general"],
    fotoUrl: `${CDN}8b890aa4259ff2c4871339d448c066cd_c9985a82-cd47-49d6-8570-4c58e1f0391e.jpg`,
    contenido: pieza(arco141),
    nota: "Igual: la espiral doble del patrón «dos colores» (una pareja de cada color por cuarteto), ~44 cuartetos de R-9 (en la foto el paso entre niveles es 0,8 diámetros, como el del taller), eje 263 × 244 cm parabólico. Colores medidos (no publica productos): rojo anaranjado #fc2e06 → Fashion Rojo 015 (empata con Naranja 061; la foto tira a cálido, como su amarillo); amarillo #f5bb02 → Amarillo Miel 021.",
  }),
  idea({
    numero: 159, slug: "autumn-harvest", nombre: "Ramo Autumn Harvest", ocasiones: ["general"],
    fotoUrl: `${CDN}Autumn_Harvest.jpg`,
    productos: [
      publicado("GLOBO REDONDO FASHION NARANJA COBRIZO", "/products/globo-latex-redondo-fashion-naranja-cobrizo", "R-12", "062", 3),
      publicado("GLOBO REDONDO FASHION AMARILLO MIEL", "/products/copia-de-globo-latex-redondo-fashion-amarillomiel", "R-12", "021", 3),
      publicado("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027", 3),
      publicado("GLOBO REDONDO FASHION NARANJA", "/products/globo-para-fiesta-latex-redondo-fashion-naranja", "R-12", "061", 3),
      publicado("GLOBO REDONDO FASHION MERLOT", "/products/globo-latex-redondo-fashion-merlot", "R-12", "018", 3),
    ],
    contenido: pieza(ramo159),
    nota: "Igual: 15 R-12 en 5 pisos de 3 (contando los que asoman por detrás), de arriba abajo Naranja Cobrizo, Amarillo Miel, Eucalipto, Naranja y Merlot, con los productos publicados y cintas crema. Distinto: pisos planos en la foto, espiral en el 3D; el peso no se ve.",
  }),
  idea({
    numero: 163, slug: "azul-arena-dorado", nombre: "Ramo azul, arena y dorado", ocasiones: ["general"],
    fotoUrl: `${CDN}Azul-Azul-Naval-Arena-Dorado.jpg`,
    productos: [
      publicado("GLOBO REDONDO FASHION AZUL", "/products/globo-para-fiesta-latex-redondo-fashion-azul", "R-12", "040", 3),
      publicado("GLOBO REDONDO FASHION AZUL NAVAL", "/products/globo-para-fiesta-latex-redondo-fashion-azul-naval", "R-12", "044", 3),
      publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 3),
      publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
    ],
    contenido: pieza(ramo163),
    nota: "Igual: 12 R-12 en 4 pisos de 3 (el tercero del Azul Naval y del Reflex Dorado asoma por detrás), de arriba abajo Azul, Azul Naval, Arena y Reflex Dorado, los productos publicados, con cintas plateadas. Distinto: espiral en vez de pisos planos; el peso no se ve.",
  }),
  idea({
    numero: 164, slug: "azul-plata", nombre: "Ramo azul y plata", ocasiones: ["general"],
    fotoUrl: `${CDN}Azul-Plata.jpg`,
    productos: [
      liso("R-12", "390", 3),
      liso("R-12", "839", 3),
      publicado("GLOBO REDONDO FASHION AZUL REY", "/products/globo-para-fiesta-latex-redondo-fashion-azul-rey", "R-12", "041", 3),
      publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 3),
    ],
    contenido: pieza(ramo164),
    nota: "Igual: 12 R-12 en 4 pisos de 3, degradé de arriba abajo; los dos de abajo son los publicados (Azul Rey 041 y Reflex Plata 981). Los dos de arriba no están en la lista de la idea y se midieron: el de arriba es un cristal azulado (el Cristal Azul no está en la tabla: va el Cristal Transparente 390) y el segundo un perlado celeste (#6c8aa2 → Silk Azul Ártico 839, el perlado más cercano). Distinto: espiral en vez de pisos.",
  }),
  idea({
    numero: 212, slug: "bright-christmas", nombre: "Ramo Bright Christmas", ocasiones: ["navidad"],
    fotoUrl: `${CDN}Bright_Christmas.png`,
    productos: [
      publicado("GLOBO REDONDO FASHION ROJO IMPERIAL", "/products/globo-latex-redondo-fashion-rojo-imperial", "R-12", "016", 3),
      publicado("GLOBO REDONDO FASHION MERLOT", "/products/globo-latex-redondo-fashion-merlot", "R-12", "018", 2),
      publicado("GLOBO REDONDO FASHION CORAL TROPICAL", "/products/globo-para-fiesta-latex-redondo-fashion-coral-tropical", "R-12", "059", 3),
      publicado("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609", 3),
    ],
    contenido: pieza(ramo212),
    nota: "Igual: 11 R-12 de arriba abajo 3 Rojo Imperial, 2 Merlot, 3 Coral Tropical y 3 Pastel Mate Rosado (el tercero asoma por detrás), los productos publicados, con cintas rojas rizadas. Distinto: espiral en vez de pisos; el peso no se ve (va rojo como las cintas).",
  }),
  idea({
    numero: 288, slug: "centro-de-mesa-filigree", nombre: "Centro de mesa Filigree", ocasiones: ["boda"],
    fotoUrl: `${CDN}e2a5aaef03199b2cf72a0c45f0f1129f_4dadf347-10c5-4aa5-9610-5544328bf3ba.jpg`,
    contenido: escena(escena288),
    nota: "Igual: 3 R-12 con helio (1 arriba, 2 abajo a los lados), cintas blancas, botella dorada de peso (escenografía, no se cotiza) y 2 flores de lazos de T-260 Satín Rosado 409 (medido #e79eb0) con centro R-5 Metal Dorado 570 en el cuello. Distinto: los globos son impresos de filigrana y van lisos: el dorado en Metal Dorado 570 (medido #efc85f) y los perlados en Satín Perla 406; la idea no publica productos.",
  }),
  idea({
    numero: 308, slug: "centro-de-mesa-san-valentin", nombre: "Centro de mesa San Valentín", ocasiones: ["amor"],
    fotoUrl: `${CDN}0d0a2d4f6120774c06b673c207efaddb_b559e546-60f2-4fec-9e53-360be38e66c5.jpg`,
    contenido: escena(escena308),
    nota: "Igual: de arriba abajo corazón rojo, corazón fucsia, redondo rosado, redondo rojo y redondo blanco con helio, sobre una base de globos: 4 R-5 Satín Lila 450 (medido #ac74b2), cuerpo fucsia, anillo de R-5 rojo y un corazón rosado encima. Distinto: los «Te amo» y «Happy Valentine's Day» son impresos y van lisos; el corazón fucsia va en Corazón Rosado 009 (el Corazón 12 no se fabrica en fucsia), el redondo rosado en Palo de Rosa 010 (medido #f5a3a7) y el blanco en Fashion Blanco 005 (mide #ebdbd4 en sombra); el cuerpo de la base es un tubo en la foto y aquí un R-9 Fucsia redondo.",
  }),
  idea({
    numero: 316, slug: "charming-love", nombre: "Ramo Charming Love", ocasiones: ["amor"],
    fotoUrl: `${CDN}Charming_Love_737f4c28-268b-443b-97c1-cf1b513bf021.jpg`,
    productos: [
      publicado("GLOBO LATEX REDONDO PASTEL DUSK CREMA", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-crema", "R-12", "107", 4),
      publicado("GLOBO REDONDO FASHION CORAL TROPICAL", "/products/globo-para-fiesta-latex-redondo-fashion-coral-tropical", "R-12", "059", 3),
      publicado("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609", 3),
      publicado("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015", 3),
      publicado("GLOBO REDONDO FASHION ROJO IMPERIAL", "/products/globo-latex-redondo-fashion-rojo-imperial", "R-12", "016", 3),
    ],
    contenido: pieza(ramo316),
    nota: "Igual: 16 R-12 en degradé de arriba abajo (4 Pastel Dusk Crema, 3 Coral Tropical, 3 Pastel Mate Rosado, 3 Rojo y 3 Rojo Imperial, contando los que asoman por detrás), los productos publicados, con cintas rojas. Distinto: espiral en vez de pisos; el peso no se ve.",
  }),
  idea({
    numero: 372, slug: "columna-feliz-cumpleanos-r-36", nombre: "Columna Feliz Cumpleaños R-36", ocasiones: ["cumpleaños"],
    fotoUrl: `${CDN}4b4a6e9e2c34841b06ed9efca3bed398_09b945c1-38f3-488b-9fec-dda62d26bafc.jpg`,
    contenido: escena(escena372),
    nota: "Igual: columna arcoíris en bandas de abajo arriba: rojo 015 y naranja 061 (2 niveles R-12 cada una), amarillo miel 021, verde trébol 029 y azul 040 (1 nivel R-9: la cintura angosta de la foto), violeta 051 (2 niveles R-9 a 21 cm) y neón fucsia 212 (2 niveles R-12), cada banda con R-5 de su color en los huecos, y un R-36 rojo arriba (a 62 cm: en la foto es casi tan ancho como la columna). Colores medidos (no publica productos). Distinto: el R-36 es un impreso «Feliz Cumpleaños» y va liso (Fashion Rojo 015); los globos grandes de la foto parecen Link-O-Loon y aquí son redondos; la foto lleva más relleno entre niveles.",
  }),
  idea({
    numero: 417, slug: "confetti-blanco-palo-de-rosa-arena", nombre: "Ramo confetti, blanco, palo de rosa y arena", ocasiones: ["boda", "navidad"],
    fotoUrl: `${CDN}Bouquet-DSC_6345-000x1000_40ad522a-d01e-4fe3-a492-603d47d0bdd1.jpg`,
    productos: [
      publicado("GLOBO INFINITY® CONFETTI DORADO TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-confetti-dorado-fashion-transparente", "R-12", null, 3),
      publicado("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005", 3),
      publicado("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010", 3),
      publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", 3),
    ],
    contenido: pieza(ramo417),
    nota: "Igual: 12 R-12 en 4 pisos de 3, de arriba abajo los Infinity® Confetti Dorado, Blanco, Palo de Rosa y Arena (los publicados), con cintas rosadas. Distinto: el confeti dorado es impreso y va en Cristal Transparente 390 sin los puntos; espiral en vez de pisos.",
  }),
  idea({
    numero: 432, slug: "corazon-polka", nombre: "Columna Corazón Polka", ocasiones: ["amor", "cumpleaños"],
    fotoUrl: `${CDN}96fb609ca5cdf5a90fd2f2f86a8047e2.jpg`,
    contenido: escena(escena432),
    nota: "Igual: columna de 8 niveles R-12 de abajo arriba 2 negro, 2 fucsia, 2 fucsia de lunares y 2 negro, rematada con un nivel R-9 y uno R-5 negros que la angostan y un corazón rosado arriba. Colores medidos (no publica productos): fucsia #fd4690 → Fashion Fucsia 012, negro 080. Distinto: los de lunares blancos son impresos y van en Fucsia liso; el corazón de la foto es de brillo satinado y va en Corazón Rosado 009 (el Corazón 12 no se fabrica en fucsia).",
  }),
  idea({
    numero: 434, slug: "corazones-modernos-plata-grafitti-invierno", nombre: "Ramo corazones modernos, plata y graffiti", ocasiones: ["amor", "día de la madre"],
    fotoUrl: `${CDN}Plata-Grafitti-Invierno.jpg`,
    productos: [
      publicado("GLOBO REDONDO INFINITY® CORAZONES MODERNOS", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-modernos-fashion-surtido", "R-12", null, 4),
      publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 3),
      publicado("GLOBO REDONDO INFINITY® GRAFFITI ROSA FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-rosa-fashion-transparente", "R-12", null, 3),
    ],
    contenido: pieza(ramo434),
    nota: "Igual: 10 R-12 en 3 pisos: 4 Infinity® Corazones Modernos arriba (fucsia, violeta, rojo y rosado, el surtido), 3 Reflex Plata y 3 Graffiti Rosa abajo. La foto muestra globos redondos: el «C-12» del mapeo de la tienda era un error y el formato es R-12. Distinto: los impresos van en el liso de su fondo (Fucsia 012, Violeta 051, Rojo 015, Rosado 009; el graffiti en Rosado 009), sin los corazones blancos ni el marmoleado; espiral en vez de pisos.",
  }),
  idea({
    numero: 435, slug: "corazones-modernos-rosado-violeta", nombre: "Ramo corazones modernos, rosado y violeta", ocasiones: ["amor"],
    fotoUrl: `${CDN}Rosado-Violeta_4e1918d8-bc8a-4de4-8237-9f872a9e9b28.jpg`,
    productos: [
      publicado("GLOBO REDONDO INFINITY® CORAZONES MODERNOS", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-modernos-fashion-surtido", "R-12", null, 4),
      publicado("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909", 4),
      publicado("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951", 4),
    ],
    contenido: pieza(ramo435),
    nota: "Igual: 12 R-12 en 3 pisos: 4 Infinity® Corazones Modernos arriba (violeta, rojo, fucsia y uno rosado detrás), 4 Reflex Rosado y 4 Reflex Violeta, contando los que asoman por detrás. La foto muestra redondos: el formato es R-12 (el mapeo decía C-12). Distinto: los impresos van en el liso de su fondo (Violeta 051, Rojo 015, Fucsia 012, Rosado 009) sin los corazones blancos; espiral en vez de pisos.",
  }),
  idea({
    numero: 446, slug: "creamy-dusk-1", nombre: "Ramo Creamy Dusk", ocasiones: ["general"],
    fotoUrl: `${CDN}Creamy_Dusk_d5eb2f59-0d9b-46af-bd18-d46e7f26c185.jpg`,
    productos: [
      publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", 3),
      publicado("GLOBO REDONDO FASHION DURAZNO", "/products/globo-para-fiesta-latex-redondo-fashion-durazno", "R-12", "060", 3),
      publicado("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027", 2),
      publicado("GLOBO REDONDO PASTEL DUSK AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-dusk-azul", "R-12", "140", 3),
      publicado("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010", 3),
    ],
    contenido: pieza(ramo446),
    nota: "Igual: 14 R-12 de arriba abajo 3 Reflex Dorado, 3 Durazno, 2 Eucalipto, 3 Pastel Dusk Azul y 3 Palo de Rosa (los publicados, contando los que asoman por detrás), con cintas rosadas. Distinto: espiral en vez de pisos; el peso no se ve.",
  }),
  idea({
    numero: 501, slug: "directo-al-corazon", nombre: "Columna Directo al corazón", ocasiones: ["amor"],
    fotoUrl: `${CDN}3a8fa127d8c6629153f35e5cfd88cf09.jpg`,
    productos: [
      publicado("GLOBO CORAZON FASHION ROJO", "/products/globo-para-fiesta-latex-corazon-fashion-rojo", "C-12", "015", 1),
      publicado("GLOBO REDONDO INFINITY® CORAZONES POR SIEMPRE FASHION SURTIDO ROJO - BLANCO", "/products/globo-para-fiesta-latex-redondo-infinity-corazones-por-siempre-fashion-surtido-rojo-blanco", "R-12", null, 12),
      publicado("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-12", "015", 12),
      publicado("GLOBO REDONDO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-fashion-rojo", "R-5", "015", 5),
    ],
    contenido: escena(escena501),
    nota: "Igual: 6 cuartetos R-12 de abajo arriba rojo, impreso blanco de corazones, rojo, impreso rojo de labios, rojo e impreso blanco (12 Fashion Rojo y 12 Infinity® Corazones por Siempre), una corona de 5 R-5 rojo (el mismo producto, talla R-5) y el Corazón 12 Rojo arriba. Distinto: los impresos van lisos (los blancos en Blanco 005, los de labios en Rojo 015), sin los corazones ni los labios; el mapeo decía C-12 para el impreso y la foto muestra redondos (R-12).",
  }),
];
