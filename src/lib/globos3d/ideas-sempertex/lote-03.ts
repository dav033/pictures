import { ideaPerezosa, type IdeaDigitalizada, type ProductoDeIdea } from "./tipos";
import { armarEscena, HUNDIMIENTO_SOBRE_CM, SALA_INICIAL, type Colocacion, type Escena, type NodoEscena } from "../escena";
import { armarPieza, type Pieza } from "../piezas";
import { altoPerfil, centroCuerpo, perfilRedondo } from "../geometria";
import { formatoPorId } from "../formatos";
import { GLOBOS_TIENDA, productoDeGlobo } from "../productos-tienda";
import type { ElementoEscenografia } from "../escenografia";
import type { ParteGlobo, PropiedadesFlor } from "../decoraciones";
import type { PropiedadesFlorTubito } from "../figuras";
import type { PatronColumna } from "../columnas";
import { LARGO_ESLABON_POR_DIAMETRO } from "../paredes";
import type { Vec3 } from "../modulos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { IDEAS_IMPRESOS } from "../ideas-impresos";

/**
 * Ideas de fiesta de sempertex.com digitalizadas: **lote 03** (los números de `clasif/lote-03.json`: 13 ramos de helio
 * por pisos, 3 estructuras de cuartetos con globo gigante, una malla flor, 2 margaritas de pared y una pulsera).
 *
 * Cómo se hizo (2026-10-07), idea por idea, con su foto (`fotos/<slug>--0.*`) abierta, ampliada y con más contraste:
 * - **Conteo**: los globos visibles, contando los que asoman por detrás de otro (una franja de otro color o de otro
 *   brillo que no es de ningún globo de delante). Ninguna idea publica «Materiales» con cantidades: todas son contadas
 *   en la foto (`contada: true`).
 * - **Medidas**: la escala sale de un globo de tamaño conocido en la misma foto (R-12 de ramo ≈ 28 cm, R-12 de
 *   estructura ≈ 25 cm) y con ella el paso entre pisos (~29 cm en todas las fotos de ramos: ~1,05 diámetros), los
 *   radios y el tamaño de los globos gigantes (proporción de anchos en píxeles).
 * - **Colores**: si la idea publica productos (o los nombra con código en su texto), se usan ESOS códigos aunque la
 *   foto mida otra cosa (se dice en la nota). Si no, se midió en la foto (Python/PIL: mediana de un parche sin brillos,
 *   ΔE en Lab contra `hexGlobo` de la tabla oficial) y se tomó el código más cercano que se fabrica en ese formato; si
 *   la medida engaña (sombra, cromado, impreso), se eligió por tono y la nota lo dice. El «vinotinto» no existe en la
 *   tabla: mide siempre más cerca del Reflex Fucsia 912 (ΔE 8–19) que del Merlot 018 (ΔE ≥ 23).
 * - **Impresos**: si el taller tiene el impreso de la tienda (`impresos-catalogo.ts`: Graffiti Invierno rojo, Hojas
 *   Tropicales, Happy Halloween, balón de fútbol), el globo lo lleva sobre su látex de fondo; si no (máscaras, «Mi
 *   Boda», lunares azules, birretes, estrellas sobre rojo, «Happy Halloween Fiesta»), va el liso de su látex de fondo y
 *   la nota lo dice. Los graffiti «… + Fashion X» son un graffiti transparente con un liso dentro (doble globo): el 3D
 *   muestra el liso de dentro y la lista lleva los dos productos.
 * - **Ramos**: por pisos planos, como en la foto (no la espiral del ramo de Halloween): cada globo es un `globo` puesto
 *   `sobre` la pieza «Peso y cintas» (escenografía: el peso en el piso y una cinta del peso al nudo de cada globo). Cada
 *   piso tiene sus globos a la misma altura, repartidos alrededor del eje: «centro» = uno de frente y los demás a los
 *   lados y detrás; «par» = dos de frente lado a lado y los demás detrás (así se ve cada piso en la foto).
 * - **Cuartetos apilados**: columnas de un nivel, una por banda, cada una girada lo que lleva la trenza (1/8 de vuelta
 *   por nivel) o sin girar si en la foto los niveles van alineados.
 * Unidades: cm.
 */

// ----------------------------------------------------------------------------------------------------------
// Ayudas de geometría
// ----------------------------------------------------------------------------------------------------------

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const mas = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const menos = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const por = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const largo = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unitario = (a: Vec3): Vec3 => { const n = largo(a) || 1; return por(a, 1 / n); };
const cruz = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const redondo = (p: Vec3): Vec3 => v(r2(p.x), r2(p.y), r2(p.z));
const rad = (g: number) => (g * Math.PI) / 180;
const ARRIBA = v(0, 1, 0);
const AL_FRENTE = v(0, 0, 1);

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });
const PISO: Colocacion = { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 };
const libre = (xCm: number, yCm: number, zCm: number, giroGrados = 0): Colocacion => ({ en: "libre", xCm: r2(xCm), yCm: r2(yCm), zCm: r2(zCm), giroGrados });
const sala = (): Escena["sala"] => structuredClone(SALA_INICIAL);
/** Un globo suelto; con `impresoId`, con el impreso de la tienda (mismo látex de fondo: no cambia el material). */
const globo = (g: ParteGlobo, impresoId?: string): Pieza =>
  ({ tipo: "globo", formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, ...(impresoId ? { impresos: [{ impresoId, codigo: g.codigo }] } : {}) });

/** Nombre de un globo para su nodo: «R-12 Reflex Verde Lima». */
const nombreGlobo = (g: ParteGlobo) => `${g.formatoId} ${referenciaPorCodigo(g.codigo)?.nombreCompleto ?? g.codigo}`;

// ----------------------------------------------------------------------------------------------------------
// Productos
// ----------------------------------------------------------------------------------------------------------

const quitarOrigen = (url: string) => url.replace(/^https:\/\/sempertex\.com/, "");

/** El producto liso de la tienda para un formato y un código (nombre y url relativa exactos de `GLOBOS_TIENDA`). */
function liso(formatoId: string, codigo: string, cantidad: number): ProductoDeIdea {
  const tipo = formatoPorId(formatoId)?.tipo ?? "redondo";
  const fila = GLOBOS_TIENDA.find((p) => p.tipo === tipo && p.codigo === codigo);
  const producto = fila ? { nombre: fila.nombre, url: fila.url } : (() => { const p = productoDeGlobo(formatoId, codigo); return { nombre: p.nombre, url: quitarOrigen(p.url) }; })();
  return { nombre: producto.nombre, url: producto.url, formato: formatoId, codigo, cantidad, contada: true };
}

/** Un producto que la idea publica (o uno de la tienda que la foto muestra), tal cual, con la cantidad contada en la foto. */
const publicado = (nombre: string, url: string, formato: string | null, codigo: string | null, cantidad: number): ProductoDeIdea => ({ nombre, url, formato, codigo, cantidad, contada: true });

/** Los productos de lo que se armó (ideas sin productos publicados): un liso por formato y código, con la cantidad del 3D. */
function productosDe(contenido: IdeaDigitalizada["contenido"]): ProductoDeIdea[] {
  const materiales = contenido.tipo === "escena" ? armarEscena(contenido.escena).materiales : armarPieza(contenido.pieza).materiales;
  return materiales.filter((m) => m.cantidad > 0).map((m) => liso(m.formatoId, m.codigo, Math.ceil(m.cantidad - 1e-9)));
}

// Productos publicados de varias ideas (nombre y url tal cual en la tienda).
const P = {
  reflexDorado: (n: number) => publicado("GLOBO LATEX REDONDO REFLEX DORADO", "/products/globo-para-fiesta-latex-redondo-reflex-dorado", "R-12", "970", n),
  reflexVerdeLima: (n: number) => publicado("GLOBO REDONDO REFLEX VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-reflex-verde-lima", "R-12", "931", n),
  arena: (n: number) => publicado("GLOBO REDONDO FASHION ARENA", "/products/globo-para-fiesta-latex-redondo-fashion-arena", "R-12", "071", n),
  eucalipto: (n: number) => publicado("GLOBO REDONDO FASHION EUCALIPTO", "/products/globo-para-fiesta-latex-redondo-fashion-eucalipto", "R-12", "027", n),
  paloDeRosa: (n: number) => publicado("GLOBO REDONDO FASHION PALO DE ROSA", "/products/globo-para-fiesta-latex-redondo-fashion-palo-de-rosa", "R-12", "010", n),
  reflexRosado: (n: number) => publicado("GLOBO REDONDO REFLEX ROSADO", "/products/globo-para-fiesta-latex-redondo-reflex-rosado", "R-12", "909", n),
  fashionRosado: (n: number) => publicado("GLOBO REDONDO FASHION ROSADO", "/products/globo-para-fiesta-latex-redondo-fashion-rosado", "R-12", "009", n),
  /** La tienda lo mapea al Pastel Mate Rosado 609 (el Cristal Pastel no está en la tabla oficial). */
  cristalPastelRosado: (n: number) => publicado("GLOBO REDONDO CRISTAL PASTEL ROSADO", "/products/globo-latex-redondo-cristal-pastel-rosado", "R-12", "609", n),
  graffitiInviernoTransparente: (n: number) => publicado("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-transparente", "R-12", null, n),
  graffitiMarmolTransparente: (n: number) => publicado("GLOBO REDONDO INFINITY® GRAFFITI MARMOL FASHION TRANSPARENTE", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-marmol-fashion-transparente", "R-12", null, n),
};

// ----------------------------------------------------------------------------------------------------------
// Ramo de helio por pisos planos
// ----------------------------------------------------------------------------------------------------------

/** Un piso del ramo, de arriba abajo. «centro»: uno de frente y los demás a los lados y detrás; «par»: dos de frente. */
type PisoRamo = {
  codigo: string; cantidad: number; vista?: "centro" | "par"; formatoId?: string; infladoCm?: number;
  /** Qué es (para el nombre del nodo): «impreso «Happy Halloween»», «dentro de un Graffiti Mármol». */
  impreso?: string;
  /** El impreso de la tienda que lleva (`impresos-catalogo.ts`), si el taller lo tiene. */
  impresoId?: string;
};
type OpcionesRamo = { cinta: string; peso?: string; pasoCm?: number; abajoCm?: number; inclinacionGrados?: number };

const ALTO_PESO = 7;
const PESO_GRIS = "#c9c9cf";

/** Ángulos de un piso alrededor del eje (0° = de frente, 90° = a la derecha de quien mira). */
function angulosPiso(n: number, vista: "centro" | "par"): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [300, 60];
  const paso = 360 / n;
  const inicio = vista === "centro" ? 0 : paso / 2;
  return Array.from({ length: n }, (_, i) => inicio + i * paso);
}

/** Radio del eje al centro de cada globo: dos lado a lado se tocan; tres o cuatro se abren algo más. */
const radioPiso = (n: number, infladoCm: number) => (n <= 1 ? 0 : n === 2 ? 16 : n === 3 ? 21 : 23) * (infladoCm / 28);

/** Una cinta (escenografía: no cotiza) de `desde` a `hasta`, en el espacio de la pieza que la lleva. */
function cinta(desde: Vec3, hasta: Vec3, hex: string): ElementoEscenografia {
  const d = menos(hasta, desde);
  const y = unitario(d);
  const x = unitario(Math.abs(y.y) < 0.95 ? cruz(y, ARRIBA) : cruz(y, AL_FRENTE));
  return { forma: "cilindro", base: v(0, 0, 0), radioCm: 0.2, altoCm: r2(largo(d)), hex, acabado: "satinado", en: { origen: redondo(desde), ejeX: redondo(x), ejeY: redondo(y) } };
}

/**
 * Un globo `sobre` la pieza del peso con el centro de su cuerpo en `centro` y el cuerpo hacia `direccion`. La
 * colocación `sobre` apoya lo más bajo del globo (el nudo, a `centroCuerpo` del centro) en el punto, hundido
 * `HUNDIMIENTO_SOBRE_CM`: se corrige para que el centro quede donde va.
 */
function globoSobrePeso(id: string, nombre: string, g: ParteGlobo, centro: Vec3, direccion: Vec3, impresoId?: string): NodoEscena {
  const n = unitario(direccion);
  const punto = menos(centro, por(n, centroCuerpo("redondo", g.infladoCm) - HUNDIMIENTO_SOBRE_CM));
  return { id, nombre, pieza: globo(g, impresoId), colocacion: { en: "sobre", padreId: "peso", puntoCm: redondo(punto), normal: redondo(n), giroGrados: 0 } };
}

/**
 * La escena de un ramo de helio por pisos (de arriba abajo, como en la foto): el piso de abajo con el centro de sus
 * globos a `abajoCm` del piso y cada piso `pasoCm` más arriba; cada globo inclinado hacia fuera y con su cinta al peso.
 */
function escenaRamo(pisos: readonly PisoRamo[], o: OpcionesRamo): Escena {
  const paso = o.pasoCm ?? 29, abajo = o.abajoCm ?? 112, inclinacion = rad(o.inclinacionGrados ?? 12);
  const amarre = v(0, ALTO_PESO, 0);
  const globos: NodoEscena[] = [];
  const cintas: ElementoEscenografia[] = [];
  pisos.forEach((p, k) => {
    const g = R(p.formatoId ?? "R-12", p.infladoCm ?? 28, p.codigo);
    const altura = abajo + (pisos.length - 1 - k) * paso;
    const radio = radioPiso(p.cantidad, g.infladoCm);
    angulosPiso(p.cantidad, p.vista ?? "centro").forEach((grados, i) => {
      const fuera = v(Math.sin(rad(grados)), 0, Math.cos(rad(grados)));
      const direccion = p.cantidad <= 1 ? ARRIBA : unitario(mas(por(fuera, Math.sin(inclinacion)), por(ARRIBA, Math.cos(inclinacion))));
      const centro = v(fuera.x * radio, altura, fuera.z * radio);
      const nombre = `${nombreGlobo(g)}${p.impreso ? `, ${p.impreso}` : ""} (piso ${k + 1})`;
      globos.push(globoSobrePeso(`globo-${k + 1}-${i + 1}`, nombre, g, centro, direccion, p.impresoId));
      const nudo = menos(centro, por(direccion, centroCuerpo("redondo", g.infladoCm)));
      cintas.push(cinta(amarre, nudo, o.cinta));
    });
  });
  const peso: NodoEscena = {
    id: "peso", nombre: "Peso y cintas",
    pieza: { tipo: "escenografia", elementos: [{ forma: "cilindro", base: v(0, 0, 0), radioCm: 4.5, altoCm: ALTO_PESO, hex: o.peso ?? PESO_GRIS, acabado: "metal" }, ...cintas] },
    colocacion: libre(0, 0, 0),
  };
  return { sala: sala(), nodos: [peso, ...globos] };
}

// ----------------------------------------------------------------------------------------------------------
// Cuartetos apilados
// ----------------------------------------------------------------------------------------------------------

type Banda = { id: string; nombre: string; formatoId: string; infladoCm: number; niveles: number; patron: PatronColumna; colores: string[] };

/**
 * Columnas apiladas (una por banda) desde `baseCm` (0 = en el piso): cada una con su primer cuarteto a medio paso del
 * último de la de abajo y girada 1/8 de vuelta por cada nivel que ya hay (sigue la trenza). Devuelve los nodos y la
 * altura del centro de su último nivel.
 */
function apilar(bandas: readonly Banda[], baseCm = 0): { nodos: NodoEscena[]; ultimoCm: number } {
  const nodos: NodoEscena[] = [];
  let centro = 0, pasoAnterior = 0, niveles = 0;
  bandas.forEach((b, i) => {
    const paso = b.infladoCm * 0.8;
    const pieza: Pieza = { tipo: "columna", formatoId: b.formatoId, infladoCm: b.infladoCm, alturaCm: Math.round(b.niveles * paso * 10) / 10, patron: b.patron, colores: b.colores };
    if (i === 0) centro = baseCm - armarPieza(pieza).caja.min.y;
    else centro += (pasoAnterior + paso) / 2;
    const colocacion: Colocacion = i === 0 && baseCm === 0 ? PISO : libre(0, centro, 0, (niveles % 2) * 45);
    nodos.push({ id: b.id, nombre: b.nombre, pieza, colocacion });
    centro += (b.niveles - 1) * paso;
    pasoAnterior = paso;
    niveles += b.niveles;
  });
  return { nodos, ultimoCm: centro };
}

// ----------------------------------------------------------------------------------------------------------
// Las 7 que no son ramos
// ----------------------------------------------------------------------------------------------------------

/**
 * 630 · Gigante diversión. Escala: los impresos R-12 miden 118 px (≈ 28 cm: 4,2 px/cm). De abajo arriba: un cuarteto de
 * R-9 perla (67 px ≈ 15 cm), un cuarteto R-9 azul rey (80 px ≈ 18 cm, girado 1/8: se ven tres), dos R-12 de cristal
 * impresos (birretes y estrellas) lado a lado y un gigante azul rey de 300 px (≈ 70 cm: R-36) con su centro a ~60 cm
 * del cuarteto azul (en la foto, 62; algo menos para que su nudo quede escondido entre los dos de cristal).
 */
const escena630 = (): Escena => {
  const pila = apilar([
    { id: "base", nombre: "Cuarteto R-9 perla", formatoId: "R-9", infladoCm: 15, niveles: 1, patron: "un_color", colores: ["406"] },
    { id: "cuarteto-azul", nombre: "Cuarteto R-9 azul rey", formatoId: "R-9", infladoCm: 18, niveles: 1, patron: "un_color", colores: ["041"] },
  ]);
  const impreso = R("R-12", 26, "390");
  return {
    sala: sala(),
    nodos: [
      ...pila.nodos,
      { id: "impreso-izquierdo", nombre: "R-12 Cristal Transparente (impreso de birretes)", pieza: globo(impreso), colocacion: libre(-14, pila.ultimoCm + 17, 3) },
      { id: "impreso-derecho", nombre: "R-12 Cristal Transparente (impreso de birretes)", pieza: globo(impreso), colocacion: libre(14, pila.ultimoCm + 17, 3) },
      { id: "gigante", nombre: "R-36 Fashion Azul Rey", pieza: globo(R("R-36", 70, "041")), colocacion: libre(0, pila.ultimoCm + 59, -2) },
    ],
  };
};

/**
 * 632 · Globo navideño. Escala: los R-12 verdes miden 123 px (≈ 25 cm: 4,9 px/cm). Dos cuartetos verde selva ALINEADOS
 * (en la foto los dos niveles muestran dos globos uno encima del otro, sin la trenza), un R-9 rojo en el hueco de
 * delante entre los dos niveles, una flor de 5 R-5 rojos (40 px ≈ 8 cm) a cada lado y el R-24 rojo de estrellas
 * blancas (285 px ≈ 58 cm) encima, con su centro a 77 cm del piso.
 */
const escena632 = (): Escena => {
  const nivel: Pieza = { tipo: "columna", formatoId: "R-12", infladoCm: 25, alturaCm: 20, patron: "un_color", colores: ["032"] };
  const centro1 = -armarPieza(nivel).caja.min.y;
  const centro2 = centro1 + 24;
  const flor: PropiedadesFlor = { petalos: { formatoId: "R-5", infladoCm: 8, codigo: "015", cantidad: 5, aperturaGrados: 0, giroGrados: 18 }, centro: null };
  const medio = (centro1 + centro2) / 2;
  return {
    sala: sala(),
    nodos: [
      { id: "nivel-1", nombre: "Cuarteto R-12 verde selva (abajo)", pieza: nivel, colocacion: PISO },
      { id: "nivel-2", nombre: "Cuarteto R-12 verde selva (arriba)", pieza: nivel, colocacion: libre(0, centro2, 0) },
      { id: "centro-rojo", nombre: "R-9 rojo del hueco", pieza: globo(R("R-9", 18, "015")), colocacion: libre(0, medio, 7) },
      { id: "flor-izquierda", nombre: "Flor de 5 R-5 rojos (izquierda)", pieza: { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: flor } }, colocacion: libre(-29, medio, 9, -40) },
      { id: "flor-derecha", nombre: "Flor de 5 R-5 rojos (derecha)", pieza: { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: flor } }, colocacion: libre(29, medio, 9, 40) },
      { id: "gigante", nombre: "R-24 Fashion Rojo (impreso de estrellas)", pieza: globo(R("R-24", 58, "015")), colocacion: libre(0, 77, 0) },
    ],
  };
};

/**
 * 682 · La pasión del fútbol. El balón mide 170 px y cada globo de la columna 43 px (×3,95) y la columna sube 33 px por
 * nivel (0,77 diámetros: la trenza de Sempertex). Con R-12 el balón sería un R-36 de 1 m y el conjunto pasaría de 3 m;
 * con R-9 a 17 cm el balón es un R-24 a tope (61 cm) y el conjunto mide ~2,2 m. De abajo arriba: 3 niveles rojos,
 * 3 azules y 6 amarillos (la bandera de Colombia: el amarillo es el doble), 12 cuartetos sobre el balón.
 */
const BALON_682 = R("R-24", 61, "005");
const escena682 = (): Escena => {
  const tope = altoPerfil(perfilRedondo(BALON_682.infladoCm));
  const pila = apilar([
    { id: "rojo", nombre: "Banda roja", formatoId: "R-9", infladoCm: 17, niveles: 3, patron: "un_color", colores: ["015"] },
    { id: "azul", nombre: "Banda azul", formatoId: "R-9", infladoCm: 17, niveles: 3, patron: "un_color", colores: ["041"] },
    { id: "amarillo", nombre: "Banda amarilla", formatoId: "R-9", infladoCm: 17, niveles: 6, patron: "un_color", colores: ["021"] },
  ], tope - 4);
  return { sala: sala(), nodos: [{ id: "balon", nombre: "R-24 blanco (impreso de balón de fútbol)", pieza: globo(BALON_682, "infinity-balon-de-futbol-fashion-blanco"), colocacion: PISO }, ...pila.nodos] };
};

/**
 * 708 · Malla flor. 6 × 6 eslabones LOL-12 fucsia (cada uno ~85 px, la malla 515 px: 150 cm con LOL-12 a 24 cm) en la
 * malla diagonal de Sempertex (7 × 7 nodos con i + j par), y un R-5 verde trébol en cada uno de los 13 nodos de dentro
 * (en la foto los nodos del borde no llevan globito). Las parejas de unión de la malla van en R-5 fucsia mínimos, para
 * que se pierdan entre los eslabones como en la foto.
 */
const MALLA_708: Pieza = { tipo: "pared_malla", formatoId: "LOL-12", infladoCm: 24, anchoCm: 150, altoCm: 150, patron: "un_color", colores: ["012"], union: { infladoCm: 5.2, codigo: "012" } };
const escena708 = (): Escena => {
  const a = (24 * LARGO_ESLABON_POR_DIAMETRO) / Math.SQRT2;
  const verdes: NodoEscena[] = [];
  for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
    if ((i + j) % 2 !== 0) continue;
    verdes.push({ id: `verde-${i}-${j}`, nombre: "R-5 verde trébol del nodo", pieza: globo(R("R-5", 12.7, "029")), colocacion: { en: "sobre", padreId: "malla", puntoCm: v(r2(i * a), r2(j * a), 0), normal: AL_FRENTE, giroGrados: 0 } });
  }
  return { sala: sala(), nodos: [{ id: "malla", nombre: "Malla Link-O-Loon fucsia", pieza: MALLA_708, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm: 40 } }, ...verdes] };
};

/** 728 · Margarita amarilla: 5 R-12 amarillos (200 px ≈ 25 cm), corona de 5 R-5 azules (95 px ≈ 12 cm) y un R-5 rojo al centro. */
const flor728: PropiedadesFlor = {
  petalos: { formatoId: "R-12", infladoCm: 25, codigo: "020", cantidad: 5, aperturaGrados: 0, giroGrados: 54 },
  corona: { formatoId: "R-5", infladoCm: 11.5, codigo: "040", cantidad: 5 },
  centro: { formatoId: "R-5", infladoCm: 12.7, codigo: "015", cantidad: 1 },
};

/** 729 · Margarita polka azul: 5 R-12 azules de lunares (205 px ≈ 25 cm), corona de 5 R-5 fucsia (95 px ≈ 12 cm) y un R-5 verde (70 px ≈ 9 cm). */
const flor729: PropiedadesFlor = {
  petalos: { formatoId: "R-12", infladoCm: 25, codigo: "040", cantidad: 5, aperturaGrados: 0, giroGrados: 18 },
  corona: { formatoId: "R-5", infladoCm: 11, codigo: "012", cantidad: 5 },
  centro: { formatoId: "R-5", infladoCm: 11.5, codigo: "029", cantidad: 1 },
};

/**
 * 873 · Pulsera de amor y flores (Hyung-Gu Park). La flor es UN R-12 blanco torcido en 5 burbujas; la pulsera, un
 * T-260 rosado en aro cuya punta hace la burbuja del centro. Escala por la mano (≈ 9 cm de nudillos): la flor mide
 * ~23 cm. El taller no tuerce un redondo en burbujas: los pétalos son 5 R-12 blancos al mínimo (12 cm), y el T-260 va
 * en un lazo hacia atrás (la pulsera) y una burbuja hacia delante (el centro).
 */
const escena873 = (): Escena => {
  const flor: PropiedadesFlor = { petalos: { formatoId: "R-12", infladoCm: 12.2, codigo: "005", cantidad: 5, aperturaGrados: 0, giroGrados: 0 }, centro: null };
  const pulsera: PropiedadesFlorTubito = {
    // Un anillo de tubito lleva al menos 2: los dos lazos (hacia atrás) y las dos burbujas (hacia delante) quedan
    // superpuestos, como un solo lazo y una sola burbuja.
    petalos: { formatoId: "T-260", grosorCm: 3.2, codigos: ["009"], cantidad: 2, estilo: "lazo", largoCm: 9, anchoCm: 7, aperturaGrados: -90, giroGrados: 0 },
    interior: { formatoId: "T-260", grosorCm: 4.5, codigos: ["009"], cantidad: 2, estilo: "burbuja", largoCm: 4.5, anchoCm: 4.5, aperturaGrados: 90, giroGrados: 0 },
    corona: null, centro: null,
  };
  return {
    sala: sala(),
    nodos: [
      { id: "flor", nombre: "Flor de pétalos blancos", pieza: { tipo: "decoracion", decoracion: { tipo: "flor", propiedades: flor } }, colocacion: libre(0, 100, 0) },
      { id: "pulsera", nombre: "Pulsera de T-260 rosado con la burbuja del centro", pieza: { tipo: "decoracion", decoracion: { tipo: "flor_tubito", propiedades: pulsera } }, colocacion: libre(0, 100, 2) },
    ],
  };
};

// ----------------------------------------------------------------------------------------------------------

type Base = Omit<IdeaDigitalizada, "id" | "productos" | "contenido"> & { productos?: ProductoDeIdea[]; contenido: () => IdeaDigitalizada["contenido"] };

/** La idea completa (perezosa: ver `ideaPerezosa`): su id «idea:<slug>» y, si no publica productos, los lisos de lo armado (contados en la foto). */
function idea(b: Base): IdeaDigitalizada {
  const { productos, contenido, ...fijo } = b;
  return ideaPerezosa({ id: `idea:${b.slug}`, ...fijo }, contenido, (c) => productos ?? productosDe(c));
}

const escena = (e: Escena): IdeaDigitalizada["contenido"] => ({ tipo: "escena", escena: e });
const enPared = (pieza: Pieza, alturaCm: number): IdeaDigitalizada["contenido"] => ({ tipo: "pieza", pieza, sugerida: { en: "pared", pared: "fondo", aLoLargoCm: 0, alturaCm } });

const CDN = "https://sempertex.com/cdn/shop/articles/";

/** Las 20 ideas del lote 03 (`clasif/lote-03.json`), en orden. */
export const LOTE_03_COMPLETO: readonly IdeaDigitalizada[] = [
  idea({
    numero: 627, slug: "gender-reveal-1", nombre: "Ramo Gender Reveal", ocasiones: ["baby-shower"],
    fotoUrl: `${CDN}Gender_Reveal_46fb8108-4db9-4aa2-a277-b10f9d637c91.jpg`,
    productos: [
      publicado("GLOBO REDONDO PASTEL MATE ROSADO", "/products/globo-para-fiesta-latex-redondo-pastel-mate-rosado", "R-12", "609", 2),
      P.fashionRosado(3),
      publicado("GLOBO REDONDO PASTEL MATE AZUL", "/products/globo-para-fiesta-latex-redondo-pastel-mate-azul", "R-12", "640", 2),
      publicado("GLOBO REDONDO FASHION AZUL", "/products/globo-para-fiesta-latex-redondo-fashion-azul", "R-12", "040", 3),
      P.reflexDorado(3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "609", cantidad: 2 }, { codigo: "009", cantidad: 3 }, { codigo: "640", cantidad: 2 }, { codigo: "040", cantidad: 3 }, { codigo: "970", cantidad: 3, vista: "par" },
    ], { cinta: "#ece0c4" })),
    nota: "Igual: 13 R-12 en 5 pisos planos de arriba abajo, alternando 2 y 3 como en la foto: 2 Pastel Mate Rosado lado a lado, 3 Fashion Rosado (uno de frente), 2 Pastel Mate Azul, 3 Fashion Azul y 3 Reflex Dorado (dos de frente y el tercero asoma detrás a la izquierda), los 5 productos publicados, con cintas crema al peso. Distinto: el segundo piso de la foto es un rosa fuerte (mide #e9589a, más cerca de Neón Fucsia 212 o Rosa 011) y el de arriba tira a durazno (#e7b2b2); van los códigos publicados (Fashion Rosado 009 y Pastel Mate Rosado 609). El peso y el largo de las cintas no salen en la foto.",
  }),
  idea({
    numero: 630, slug: "gigante-diversion", nombre: "Gigante diversión", ocasiones: ["cumpleanos"],
    fotoUrl: `${CDN}4008221ab4182b7ac481ed539248770c_52844423-5d37-4d52-96f9-0581b7fa679d.jpg`,
    clase: "escena", contenido: () => escena(escena630()),
    nota: "Igual: de abajo arriba un cuarteto de R-9 perla, un cuarteto de R-9 azul rey girado 1/8 (se ven tres), dos R-12 de cristal lado a lado y el gigante azul rey encima (R-36 a 70 cm: 2,5 veces el ancho de un R-12, como en la foto); 1,25 m de alto. Colores medidos (no publica productos): el azul #1e2e8d por ΔE cae en Violeta 051, pero su tono es azul ultramar y va Fashion Azul Rey 041; la base perlada mide #c8b3a6 en sombra y va Satín Perla 406. Distinto: los dos R-12 son impresos de birretes y estrellas sobre cristal y van en Cristal Transparente 390 liso; en la foto se inclinan hacia fuera y aquí van derechos.",
  }),
  idea({
    numero: 632, slug: "globo-navideno", nombre: "Globo navideño", ocasiones: ["navidad"],
    fotoUrl: `${CDN}42f90d9bb29cbede797be21e82d633a6_eab8b98c-995d-44a1-8d7b-4fdc9eab9200.jpg`,
    clase: "escena", contenido: () => escena(escena632()),
    nota: "Igual: dos cuartetos R-12 verde selva alineados (dos globos de frente por nivel, uno sobre otro, como en la foto), un R-9 rojo en el hueco de delante, una flor de 5 R-5 rojos a cada lado entre los dos niveles y el R-24 rojo a 58 cm encima (1,07 m en total). Colores medidos (no publica productos): verde #006c47–#008360 → Fashion Verde Selva 032; rojo #d91226 → Fashion Rojo 015 (el del hueco mide #890d05 porque está en sombra: es el mismo rojo). Distinto: el R-24 es un impreso de estrellas blancas y va liso; el cordón que asoma arriba no se dibuja.",
  }),
  idea({
    numero: 641, slug: "graffiti-happy-halloween", nombre: "Ramo Graffiti Happy Halloween", ocasiones: ["halloween"],
    fotoUrl: `${CDN}Halloween_988bff6f-b29d-40f1-92c1-aa215faa8f98.jpg`,
    productos: [
      P.graffitiInviernoTransparente(3),
      liso("R-12", "031", 3),
      publicado("GLOBO INFINITY® HAPPY HALLOWEEN", "/products/globo-para-fiesta-latex-redondo-infinity-happy-halloween-noche-fashion-surtido", "R-12", null, 3),
      P.graffitiMarmolTransparente(3),
      liso("R-12", "061", 3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "031", cantidad: 3, impreso: "dentro de un Graffiti Invierno" },
      { codigo: "051", cantidad: 3, vista: "par", impreso: "impreso «Happy Halloween»", impresoId: "infinity-happy-halloween-noche-fashion-surtido" },
      { codigo: "061", cantidad: 3, impreso: "dentro de un Graffiti Mármol" },
    ], { cinta: "#ececf0", pasoCm: 30 })),
    nota: "Igual: 9 R-12 en 3 pisos planos de arriba abajo: 3 Graffiti Invierno con verde dentro (uno de frente), 3 violeta «Happy Halloween» (dos de frente y el tercero asoma detrás, entre ellos) y 3 Graffiti Mármol con Fashion Naranja 061 dentro, como dice la idea («Graffiti Invierno + Fashion Verde», «051 - Fashion Violeta Happy Halloween», «Graffiti Mármol + Fashion Naranja»), con cintas blancas. Los violeta llevan el impreso «Happy Halloween» de la tienda (dibujo propio: araña y letrero, no el fantasma y la casa de la foto). Distinto: los graffiti dobles se ven como el liso de dentro, sin la escarcha ni el mármol; el texto dice «Fashion Verde», pero la foto mide #76b55f, verde lima (Fashion Verde 030 queda a ΔE 23): va Fashion Verde Lima 031. La lista lleva el graffiti transparente y el liso de dentro de cada doble globo.",
  }),
  idea({
    numero: 642, slug: "graffiti-invierno-verde-lima-cristal-rojo", nombre: "Ramo Graffiti Invierno, verde y cristal rojo", ocasiones: ["navidad"],
    fotoUrl: `${CDN}Bouquet-DSC_6347-000x1000_7ed8c5ef-1a3d-4509-bdd2-fefed4b3b186.jpg`,
    productos: [
      publicado("GLOBO REDONDO INFINITY® GRAFFITI INVIERNO FASHION ROJO", "/products/globo-para-fiesta-latex-redondo-infinity-graffiti-invierno-fashion-rojo", "R-12", null, 4),
      liso("R-12", "032", 3),
      liso("R-12", "609", 3),
      publicado("GLOBO REDONDO REFLEX CRISTAL ROJO", "/products/globo-para-fiesta-latex-redondo-reflex-cristal-rojo", "R-12", "915", 3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "015", cantidad: 4, impreso: "Graffiti Invierno", impresoId: "infinity-graffiti-invierno-fashion-rojo" }, { codigo: "032", cantidad: 3, vista: "par" }, { codigo: "609", cantidad: 3 }, { codigo: "915", cantidad: 3, vista: "par" },
    ], { cinta: "#d8344a", pasoCm: 30 })),
    nota: "Igual: 13 R-12 en 4 pisos planos de arriba abajo: 4 Graffiti Invierno rojos (tres de frente y el cuarto asoma liso detrás, entre los verdes), 3 verdes (dos de frente y uno detrás a la izquierda), 3 Pastel Mate Rosado (uno de frente) y 3 Reflex Cristal Rojo (dos de frente y uno detrás), con cintas rojas rizadas. Colores: la idea no enlaza productos; el título nombra el Graffiti Invierno y el Cristal Rojo (915, el de la tienda) y lo demás se midió: verde #047650 → Fashion Verde Selva 032 (el «verde lima» del título no es lo que muestra la foto: es un verde oscuro brillante), rosado #e0cdd3 → Pastel Mate Rosado 609 (ΔE 1,9). Los rojos llevan el impreso Graffiti Invierno de la tienda sobre Fashion Rojo 015. Distinto: el remolino del graffiti es un dibujo propio (escarcha blanca), más parejo que el de la foto.",
  }),
  idea({
    numero: 659, slug: "happy-halloween-violeta-verde-lima", nombre: "Ramo Happy Halloween violeta y verde lima", ocasiones: ["halloween"],
    fotoUrl: `${CDN}Violeta-Verde-Lima.jpg`,
    productos: [
      publicado("GLOBO REDONDO REFLEX VIOLETA", "/products/globo-para-fiesta-latex-redondo-reflex-violeta", "R-12", "951", 3),
      liso("R-12", "390", 3),
      P.reflexVerdeLima(3),
      P.graffitiMarmolTransparente(3),
      liso("R-12", "061", 3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "951", cantidad: 3 }, { codigo: "390", cantidad: 3, vista: "par", impreso: "impreso «Happy Halloween Fiesta»" }, { codigo: "931", cantidad: 3 }, { codigo: "061", cantidad: 3, vista: "par", impreso: "dentro de un Graffiti Mármol" },
    ], { cinta: "#ececf0" })),
    nota: "Igual: 12 R-12 en 4 pisos planos con los códigos que da la idea: 3 Reflex Violeta 951 (uno de frente), 3 Cristal 390 impresos «Happy Halloween Fiesta» (dos de frente; el tercero se ve detrás por la transparencia), 3 Reflex Verde Lima 931 y 3 Graffiti Mármol con Fashion Naranja 061 dentro (dos de frente y uno detrás), con cintas blancas. Distinto: el impreso de gato y araña no está en la tienda: va el Cristal Transparente 390 liso (el código que da la idea); los graffiti se ven como el naranja liso de dentro, sin las manchas negras y blancas.",
  }),
  idea({
    numero: 665, slug: "hojas-dorado-verde-lima", nombre: "Ramo hojas, dorado y verde lima", ocasiones: ["general"],
    fotoUrl: `${CDN}Dorado-Verde-Lima.jpg`,
    productos: [
      P.reflexDorado(3),
      publicado("GLOBO REDONDO INFINITY® HOJAS TROPICALES FASHION NEGRO", "/products/globo-para-fiesta-latex-redondo-infinity-hojas-tropicales-fashion-negro", "R-12", null, 3),
      P.reflexVerdeLima(3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "970", cantidad: 3, vista: "par" }, { codigo: "080", cantidad: 3, impreso: "Infinity® Hojas Tropicales", impresoId: "infinity-hojas-tropicales-fashion-negro" }, { codigo: "931", cantidad: 3, vista: "par" },
    ], { cinta: "#c8a04a", pasoCm: 30 })),
    nota: "Igual: 9 R-12 en 3 pisos planos de arriba abajo: 3 Reflex Dorado (dos de frente y el tercero asoma detrás, al medio), 3 Infinity® Hojas Tropicales (uno de frente) y 3 Reflex Verde Lima (dos de frente y uno detrás), los productos publicados, con cintas doradas. Los negros llevan el impreso Hojas Tropicales de la tienda sobre Fashion Negro 080. Distinto: las hojas son un dibujo propio (hoja con nervaduras), no la monstera y la palma de la foto; el peso no sale en la foto.",
  }),
  idea({
    numero: 682, slug: "la-pasion-del-futbol", nombre: "Columna La pasión del fútbol", ocasiones: ["general", "cumpleanos"],
    fotoUrl: `${CDN}3eb38ae73979cfdafab27b3a6fa5bbb9_1a5eba79-0899-4da7-882e-542b59c54dfc.jpg`,
    productos: [
      publicado("GLOBO REDONDO FASHION SURTIDO TRICOLOR", "/products/globo-para-fiesta-latex-redondo-fashion-surtido-colores-primarios", "R-9", null, 48),
      publicado("GLOBO INFINITY® BALÓN DE FUTBOL", "/products/globo-para-fiesta-latex-redondo-infinity-balon-de-futbol-fashion-blanco", "R-24", null, 1),
    ],
    clase: "escena", contenido: () => escena(escena682()),
    nota: "Igual: columna de 12 cuartetos (48 globos) en la trenza de Sempertex, de abajo arriba 3 niveles rojos, 3 azules y 6 amarillos (la bandera de Colombia), sobre un balón gigante, ~2,2 m. Los dos productos publicados: el surtido tricolor (los colores medidos: amarillo #fecf00 → Amarillo Miel 021, azul #003fb9 → Azul Rey 041 por tono, rojo → Fashion Rojo 015) y el Infinity® Balón de fútbol. Distinto: la tienda mapea el surtido a R-12, pero en la foto el balón mide 3,95 globos de la columna: con R-12 el balón sería de 1 m y el conjunto pasaría de 3 m; va en R-9 a 17 cm con el balón como R-24 a tope (61 cm). El balón lleva el impreso de la tienda (pentágonos negros, dibujo propio) sobre Fashion Blanco 005; la tienda lo vende de R-5 a R-36.",
  }),
  idea({
    numero: 694, slug: "lime-citrus-1", nombre: "Ramo Lime Citrus", ocasiones: ["general"],
    fotoUrl: `${CDN}Lime_Citrus_6d15a9b9-c1bb-4324-bbd6-a43d1bb4f072.jpg`,
    productos: [
      publicado("GLOBO REDONDO FASHION VERDE TREBOL", "/products/globo-latex-redondo-fashion-verde-trebol", "R-12", "029", 3),
      P.arena(2),
      publicado("GLOBO REDONDO FASHION VERDE LIMA", "/products/globo-para-fiesta-latex-redondo-fashion-verde-lima", "R-12", "031", 3),
      P.eucalipto(3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "029", cantidad: 3 }, { codigo: "071", cantidad: 2 }, { codigo: "031", cantidad: 3 }, { codigo: "027", cantidad: 3, vista: "par" },
    ], { cinta: "#efe6cf" })),
    nota: "Igual: 11 R-12 en 4 pisos planos de arriba abajo: 3 Verde Trébol (uno de frente), 2 Arena lado a lado, 3 Verde Lima (uno de frente) y 3 Eucalipto (dos de frente y el tercero asoma detrás a la derecha), los productos publicados, con cintas crema. Distinto: el Eucalipto de la foto se ve gris (mide #9fa090): va el código publicado, 027. El peso no sale en la foto.",
  }),
  idea({
    numero: 708, slug: "malla-flor", nombre: "Malla flor fucsia y verde", ocasiones: ["boda", "fiesta-infantil"],
    fotoUrl: `${CDN}5dcf83808deb8f47dba3eab1ffd646c3_92c4a516-22e8-483f-8564-76cbebd83f7f.jpg`,
    clase: "escena", contenido: () => escena(escena708()),
    nota: "Igual: malla Link-O-Loon de 6 × 6 eslabones LOL-12 fucsia (36) en diagonal, 1,5 × 1,5 m en la pared, con un R-5 verde trébol en cada uno de los 13 nodos de dentro: las flores de 4 pétalos alrededor de cada globito verde, en damero, como en la foto. Colores medidos (no publica productos): fucsia #f6337e → Fashion Fucsia 012; verde #00b134 → Verde Trébol 029 (ΔE 4). Distinto: la malla del taller amarra cada nodo con una pareja de R-5 (aquí fucsia y al mínimo, para que se pierdan): son 50 R-5 fucsia que la foto no deja ver; la foto no da la medida (se tomó el LOL-12 a 24 cm).",
  }),
  idea({
    numero: 728, slug: "margarita-amarilla", nombre: "Margarita amarilla", ocasiones: ["cumpleanos"],
    fotoUrl: `${CDN}24cef37dd47c4f89c42a6b31769b727a_af5579a6-bdac-4bc8-abcb-8e7cdd1b3d36.jpg`,
    clase: "decoracion", contenido: () => enPared({ tipo: "decoracion", decoracion: { tipo: "flor", propiedades: flor728 }, deFrente: true }, 120),
    nota: "Igual: flor de pared de 5 R-12 amarillos con dos pétalos arriba y uno abajo, una corona de 5 R-5 azules y un R-5 rojo al centro, ~67 cm. Colores medidos (no publica productos): amarillo #ffe200 → Fashion Amarillo 020; azul #029fd1 → Fashion Azul 040; rojo #d91226 → Fashion Rojo 015. Distinto: en la foto el rojo del centro es apenas más grande que los azules (va a 12,7 cm, el tope del R-5).",
  }),
  idea({
    numero: 729, slug: "margarita-polka-azul", nombre: "Margarita polka azul", ocasiones: ["cumpleanos"],
    fotoUrl: `${CDN}34969d9cfef8408d50611956a689d451_966e94e5-34ec-4ec6-ad28-0af0215bf12c.jpg`,
    clase: "decoracion", contenido: () => enPared({ tipo: "decoracion", decoracion: { tipo: "flor", propiedades: flor729 }, deFrente: true }, 120),
    nota: "Igual: flor de pared de 5 R-12 azules con un pétalo arriba, corona de 5 R-5 fucsia y un R-5 verde al centro, ~67 cm. Colores medidos (no publica productos): azul #00a0d1 → Fashion Azul 040; fucsia #ff3598 → Fashion Fucsia 012 (Neón Fucsia 212 mide 3 ΔE más cerca, pero la foto está saturada: no es neón); verde #00be05 → Verde Trébol 029. Distinto: los pétalos son impresos de lunares blancos y van en Fashion Azul liso (el taller tiene el Polka solo sobre verde lima y rojo); el verde de la foto es más chico que los fucsia (9 cm): aquí va a 11,5 cm y los fucsia a 11, porque con la corona inclinada un centro más chico queda tapado.",
  }),
  idea({
    numero: 735, slug: "mascaras-neon", nombre: "Ramo Máscaras Neón", ocasiones: ["halloween"],
    fotoUrl: `${CDN}Bouquet-Halloween-Mascaras-Neon_186098b8-6f7c-4d60-9104-01e165774428.png`,
    productos: [
      publicado("GLOBO REDONDO MASCARAS NEON", "/products/globo-para-fiesta-latex-redondo-4-caras-mascaras-neon-fashion-negro", "R-12", null, 3),
      publicado("GLOBO REDONDO NEON VERDE", "/products/globo-para-fiesta-latex-redondo-neon-verde", "R-12", "230", 3),
      publicado("GLOBO REDONDO NEON AZUL", "/products/globo-para-fiesta-latex-redondo-neon-azul", "R-12", "240", 2),
      publicado("GLOBO REDONDO NEON FUCSIA", "/products/globo-para-fiesta-latex-redondo-neon-fucsia", "R-12", "212", 3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "080", cantidad: 3, impreso: "Máscaras Neón" }, { codigo: "240", cantidad: 2 }, { codigo: "212", cantidad: 3 }, { codigo: "230", cantidad: 3, vista: "par" },
    ], { cinta: "#e2553a", pasoCm: 30 })),
    nota: "Igual: 11 R-12 en 4 pisos planos de arriba abajo: 3 Máscaras Neón (uno de frente), 2 Neón Azul lado a lado, 3 Neón Fucsia (uno de frente) y 3 Neón Verde (dos de frente y el tercero asoma detrás a la derecha), los productos publicados, con cintas de colores. Distinto: las máscaras son impresas y van en Fashion Negro 080 liso; con luz de día la foto muestra los neón pálidos (el fucsia se ve lila, #e6c9eb): van los códigos publicados.",
  }),
  idea({
    numero: 740, slug: "mi-boda-dorado-arena-eucalipto", nombre: "Ramo Mi Boda, dorado, arena y eucalipto", ocasiones: ["boda"],
    fotoUrl: `${CDN}Dorado-Arena-Eucalipto.jpg`,
    productos: [liso("R-12", "406", 3), P.reflexDorado(3), P.arena(3), P.eucalipto(3)],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "406", cantidad: 3, impreso: "impreso «Mi Boda»" }, { codigo: "970", cantidad: 3, vista: "par" }, { codigo: "071", cantidad: 3 }, { codigo: "027", cantidad: 3, vista: "par" },
    ], { cinta: "#d0d1d6" })),
    nota: "Igual: 12 R-12 en 4 pisos planos con los códigos que da la idea: 3 Satín Perla 406 «Mi Boda» (uno de frente), 3 Reflex Dorado 970 (dos de frente y el tercero asoma detrás a la derecha), 3 Arena 071 (uno de frente) y 3 Eucalipto 027 (dos de frente y uno detrás), con cintas plateadas. Distinto: el impreso «Mi Boda» (corazón y anillos dorados) no está en la tienda: va el Satín Perla 406 liso.",
  }),
  idea({
    numero: 798, slug: "ocean-hues-1", nombre: "Ramo Ocean Hues", ocasiones: ["general"],
    fotoUrl: `${CDN}Ocean_Hues.jpg`,
    productos: [
      publicado("GLOBO REDONDO REFLEX CHAMPAÑA", "/products/globo-para-fiesta-latex-redondo-reflex-champana", "R-12", "971", 4),
      publicado("GLOBO LATEX REDONDO FASHION AGUAMARINA", "/products/globo-para-fiesta-latex-redondo-fashion-aguamarina", "R-12", "037", 3),
      publicado("GLOBO REDONDO FASHION TURQUESA PROFUNDO", "/products/globo-latex-redondo-fashion-turquesa-profundo", "R-12", "035", 4),
      publicado("GLOBO REDONDO REFLEX AZUL", "/products/globo-para-fiesta-latex-redondo-reflex-azul", "R-12", "940", 3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "971", cantidad: 4 }, { codigo: "037", cantidad: 3, vista: "par" }, { codigo: "035", cantidad: 4 }, { codigo: "940", cantidad: 3, vista: "par" },
    ], { cinta: "#2aa3b5", pasoCm: 30 })),
    nota: "Igual: 14 R-12 en 4 pisos planos de arriba abajo: 4 cromados claros (tres de frente y el cuarto asoma detrás, a la izquierda del de en medio), 3 Aguamarina (dos de frente y uno detrás), 4 Turquesa Profundo (tres de frente y uno detrás) y 3 Reflex Azul (dos de frente y uno detrás), los productos publicados, con cintas turquesa. Distinto: los de arriba se ven plateados (la idea publica Reflex Champaña 971 y va ese); los que asoman detrás se contaron por su franja de color y pueden faltar o sobrar uno por piso.",
  }),
  idea({
    numero: 818, slug: "palo-de-rosa-lila-frambuesa-vinotinto", nombre: "Ramo palo de rosa, lila, frambuesa y vinotinto", ocasiones: ["general"],
    fotoUrl: `${CDN}Palo-de-Rosa-Lila-Frambuesa-Vinotinto.jpg`,
    productos: [P.paloDeRosa(3), publicado("GLOBO REDONDO FASHION LILA", "/products/globo-para-fiesta-latex-redondo-fashion-lila", "R-12", "050", 3), publicado("GLOBO REDONDO FASHION FRAMBUESA", "/products/globo-para-fiesta-latex-redondo-fashion-frambuesa", "R-12", "014", 3), liso("R-12", "912", 3)],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "010", cantidad: 3, vista: "par" }, { codigo: "050", cantidad: 3 }, { codigo: "014", cantidad: 3, vista: "par" }, { codigo: "912", cantidad: 3 },
    ], { cinta: "#f0eeec" })),
    nota: "Igual: 12 R-12 en 4 pisos planos de arriba abajo: 3 Palo de Rosa (dos de frente y el tercero asoma detrás), 3 Lila (uno de frente), 3 Frambuesa (dos de frente y uno detrás) y 3 vinotinto (uno de frente), con los productos publicados y cintas blancas. El vinotinto no está publicado ni en la tabla: mide #6f3551 → Reflex Fucsia 912 (ΔE 7,7; el Merlot 018 queda a 28). Distinto: en la foto el vinotinto es mate y el 912 es cromado.",
  }),
  idea({
    numero: 819, slug: "palo-de-rosa-vinotinto-rosado-arena", nombre: "Ramo palo de rosa, vinotinto, rosado y arena", ocasiones: ["general"],
    fotoUrl: `${CDN}Palo-de-Rosa-Vinotinto-Rosado-Arena.jpg`,
    productos: [P.paloDeRosa(3), liso("R-12", "912", 2), P.reflexRosado(4), P.arena(3)],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "010", cantidad: 3 }, { codigo: "912", cantidad: 2 }, { codigo: "909", cantidad: 4 }, { codigo: "071", cantidad: 3, vista: "par" },
    ], { cinta: "#d0d1d6", pasoCm: 30 })),
    nota: "Igual: 12 R-12 en 4 pisos planos de arriba abajo: 3 Palo de Rosa (uno de frente), 2 vinotinto lado a lado, 4 Reflex Rosado (tres de frente y el cuarto asoma detrás, entre los vinotinto) y 3 Arena (dos de frente y uno detrás a la derecha), con los productos publicados y cintas plateadas. El vinotinto no está publicado: mide #4e1f30 (brillante) → Reflex Fucsia 912. Distinto: el Arena de la foto mide más oscuro (#b09883, en sombra); va el código publicado.",
  }),
  idea({
    numero: 873, slug: "pulsera-de-amor-y-flores", nombre: "Pulsera de amor y flores", ocasiones: ["san-valentin"],
    fotoUrl: `${CDN}pulsera-de-amor-y-flores_fbc07ea8-9592-4408-a10d-3fa20f06df57.jpg`,
    productos: [
      publicado("GLOBO REDONDO FASHION BLANCO", "/products/globo-para-fiesta-latex-redondo-fashion-blanco", "R-12", "005", 1),
      publicado("GLOBO TUBITO FASHION ROSADO", "/products/globo-para-fiesta-latex-tubito-fashion-rosado", "T-260", "009", 1),
    ],
    clase: "escena", contenido: () => escena(escena873()),
    nota: "Igual: flor de 5 pétalos blancos con la burbuja rosada al centro y la pulsera de T-260 rosado, con los dos productos publicados (Fashion Blanco 005 y el tubito Fashion Rosado 009). Distinto: en la foto los 5 pétalos son UN solo R-12 torcido en burbujas; el taller no tuerce redondos y dibuja 5 R-12 al mínimo (12 cm: la flor sale de ~30 cm y no de ~23); se compra 1. La pulsera es un lazo de tubito hacia atrás (no da la vuelta a una muñeca, que no está) y la escena no lleva la mano.",
  }),
  idea({
    numero: 894, slug: "rosado-fucsia-plata", nombre: "Ramo rosado, fucsia y plata", ocasiones: ["general"],
    fotoUrl: `${CDN}Rosado-Frambuesa-Plata.jpg`,
    productos: [
      P.cristalPastelRosado(3), P.fashionRosado(2),
      publicado("GLOBO REDONDO FASHION FUCSIA", "/products/globo-para-fiesta-latex-redondo-fashion-fucsia", "R-12", "012", 3),
      publicado("GLOBO LATEX REDONDO REFLEX PLATA", "/products/globo-para-fiesta-latex-redondo-reflex-plata", "R-12", "981", 3),
    ],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "609", cantidad: 3 }, { codigo: "009", cantidad: 2 }, { codigo: "012", cantidad: 3 }, { codigo: "981", cantidad: 3, vista: "par" },
    ], { cinta: "#f3e6ea" })),
    nota: "Igual: 11 R-12 en 4 pisos planos de arriba abajo: 3 Cristal Pastel Rosado (uno de frente), 2 Fashion Rosado lado a lado, 3 Fashion Fucsia (uno de frente) y 3 Reflex Plata (dos de frente y el tercero asoma detrás, al medio), los productos publicados, con cintas blancas. Distinto: el Cristal Pastel Rosado no está en la tabla oficial y la tienda lo mapea al Pastel Mate Rosado 609 (opaco en el 3D, translúcido en la foto); el fucsia de la foto es más oscuro (#9f293e, casi frambuesa) y va el publicado, 012; el segundo piso mide #d3a7ac, más palo de rosa que el Rosado 009 publicado.",
  }),
  idea({
    numero: 895, slug: "rosado-vinotinto", nombre: "Ramo rosado y vinotinto", ocasiones: ["general"],
    fotoUrl: `${CDN}Rosado-Rosado-Vinotinto_874eda84-42a9-479b-9e83-870c341a34fa.jpg`,
    productos: [P.reflexRosado(3), P.cristalPastelRosado(2), liso("R-12", "912", 4)],
    clase: "escena", contenido: () => escena(escenaRamo([
      { codigo: "909", cantidad: 3 }, { codigo: "609", cantidad: 2 }, { codigo: "912", cantidad: 4 },
    ], { cinta: "#f2f2f2", pasoCm: 30 })),
    nota: "Igual: 9 R-12 en 3 pisos planos de arriba abajo: 3 Reflex Rosado (uno de frente), 2 Cristal Pastel Rosado lado a lado y 4 vinotinto (tres de frente y el cuarto asoma detrás, al medio), con los productos publicados y cintas blancas. El vinotinto no está publicado: mide #6a2f43 → Reflex Fucsia 912 (ΔE 9,4). Distinto: el Cristal Pastel Rosado va en el Pastel Mate Rosado 609 al que lo mapea la tienda (opaco en el 3D, translúcido en la foto).",
  }),
];

/**
 * 665 y 682 ya entraron a la biblioteca desde `ideas-impresos.ts` con el mismo id («idea:<slug>»), en ramo en espiral y
 * en columna de 32 R-12. Dos items con el mismo id rompen la biblioteca: mientras estén allá, las de este lote (pisos
 * planos; 48 cuartetos contados sobre un balón R-24) quedan en `LOTE_03_REPETIDAS` y no entran; si se quitan de allá,
 * entran solas.
 */
const YA_EN_LA_BIBLIOTECA = new Set(IDEAS_IMPRESOS.map((i) => i.id));
export const LOTE_03_REPETIDAS: readonly IdeaDigitalizada[] = LOTE_03_COMPLETO.filter((i) => YA_EN_LA_BIBLIOTECA.has(i.id));

/** Ideas de fiesta de sempertex.com digitalizadas: lote 03 (sin las que ya están en la biblioteca con el mismo id). */
export const LOTE_03: readonly IdeaDigitalizada[] = LOTE_03_COMPLETO.filter((i) => !YA_EN_LA_BIBLIOTECA.has(i.id));
