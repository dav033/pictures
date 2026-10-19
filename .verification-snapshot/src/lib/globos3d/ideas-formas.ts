import type { Vec3 } from "./modulos";
import { armarPieza, type Pieza, type PiezaArmada } from "./piezas";
import { idNuevo, marcoDePared, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { hexDeCodigo, type FormaMiniatura, type Miniatura } from "./decoraciones-escena";

/**
 * **Ideas de fiesta de sempertex.com con formas y letras**, digitalizadas mirando su foto: cada una es una pieza del
 * taller (`forma` o `letras`) con los productos de su ficha (formato y código exactos de `productos_mapeados`; si la
 * ficha no trae productos, los colores se leyeron de la foto y se dice) y una nota honesta de qué se parece y qué no.
 * Más unas formas básicas de partida. Todo se ofrece en «Decoraciones pequeñas» → «Formas y letras».
 */

export type ProductoIdea = { formatoId: string; codigo: string; nombre: string };

export type IdeaForma = {
  /** Número de la idea en la clasificación (`clasif/todas.json`); 0 en las formas básicas. */
  id: number;
  nombre: string;
  slug: string;
  url: string;
  /** De dónde salen los colores: la ficha de la tienda (productos exactos) o la foto (la ficha no trae productos). */
  fuente: "ficha" | "foto";
  productos: ProductoIdea[];
  pieza: Pieza;
  /** Dónde se pone al añadirla: de pie en el piso o en la pared del fondo. */
  lugar: "piso" | "pared";
  nota: string;
};

const url = (slug: string) => `https://sempertex.com/blogs/idea-de-fiesta/${slug}`;

export const IDEAS_FORMAS: readonly IdeaForma[] = [
  {
    id: 2, nombre: "2012 en columna", slug: "2012", url: url("2012"), fuente: "foto", lugar: "piso",
    productos: [
      { formatoId: "R-5", codigo: "051", nombre: "Fashion Violeta" }, { formatoId: "R-5", codigo: "015", nombre: "Fashion Rojo" }, { formatoId: "R-5", codigo: "020", nombre: "Fashion Amarillo" },
      { formatoId: "R-5", codigo: "030", nombre: "Fashion Verde" }, { formatoId: "R-5", codigo: "040", nombre: "Fashion Azul" }, { formatoId: "R-5", codigo: "061", nombre: "Fashion Naranja" },
    ],
    pieza: { tipo: "letras", letras: { texto: "2012", altoCm: 30, grosorCm: 6.5, disposicion: "columna", tecnica: "hilera", formatoId: "R-5", infladoCm: 6.5, colores: ["051", "015", "020", "030", "040", "061"], patron: "alternado", separacionCm: 5 } },
    nota: "Se parece: los cuatro dígitos apilados en columna (~1,4 m), de R-5 chiquitos multicolor en hilera (en la foto el trazo es algo más grueso). No: las flores moradas de remate arriba y abajo (pon «Flor de 5 pétalos» aparte) ni el pie. La ficha no trae productos: colores leídos de la foto.",
  },
  {
    id: 15, nombre: "Ancla azul caribe", slug: "ancla-azul-caribe", url: url("ancla-azul-caribe"), fuente: "foto", lugar: "pared",
    productos: [{ formatoId: "R-5", codigo: "038", nombre: "Fashion Azul Caribe" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "ancla", anchoCm: 95, altoCm: 120 }, tecnica: { tipo: "celdas", formatoId: "R-5", infladoCm: 10, celda: "tresbolillo" }, colores: { codigos: ["038"], patron: "un_color" } } },
    nota: "Se parece: la silueta (caña, cepo y brazos en U con las uñas anchas) rellena de un solo azul, ~1,2 m. No: en la foto son cuartetos de R-6 sobre armazón; aquí R-5 al tresbolillo, que de frente se ven igual. La ficha no trae productos: color de la foto.",
  },
  {
    id: 34, nombre: "Árbol de corazones mini", slug: "arbol-corazones-mini", url: url("arbol-corazones-mini"), fuente: "foto", lugar: "piso",
    productos: [{ formatoId: "R-12", codigo: "074", nombre: "Fashion Café" }, { formatoId: "R-9", codigo: "032", nombre: "Fashion Verde Selva" }, { formatoId: "R-9", codigo: "030", nombre: "Fashion Verde" }, { formatoId: "C-12", codigo: "015", nombre: "Corazón Fashion Rojo" }],
    pieza: { tipo: "forma", forma: { clase: "arbol", tronco: { altoCm: 60, formatoId: "R-12", infladoCm: 25, codigo: "074" }, copa: { diametroCm: 80, globo: { formatoId: "R-9", infladoCm: 12 }, colores: { codigos: ["032", "030"], patron: "degradado", anguloGrados: 90, semilla: 3 }, achatado: 0.85, acento: { formatoId: "C-12", infladoCm: 12.5, codigos: ["015"], cada: 4 } } } },
    nota: "Se parece: tronco de cuartetos café, copa redonda verde oscuro abajo y verde claro arriba con corazoncitos rojos. No: el racimo de R-5 café al pie del tronco y el relleno fino de la copa (aquí R-9 en geodésica). La ficha no trae productos: colores de la foto.",
  },
  {
    id: 37, nombre: "Árbol de Navidad de cuartetos", slug: "arbol-de-navidad-2", url: url("arbol-de-navidad-2"), fuente: "foto", lugar: "piso",
    productos: [{ formatoId: "R-12", codigo: "032", nombre: "Fashion Verde Selva" }, { formatoId: "R-5", codigo: "015", nombre: "Fashion Rojo" }],
    pieza: { tipo: "forma", forma: { clase: "cono", altoCm: 75, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 27, infladoPuntaCm: 17, globosBase: 6, globosPunta: 4, colores: { codigos: ["032"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 10, codigos: ["015"], cada: 2 }, remate: { formatoId: "R-12", infladoCm: 20, codigo: "032" } } },
    nota: "Se parece: cono de anillos verdes que se achican de abajo arriba, con R-5 rojas de bolas y un globo de punta. No: en la foto la base son tres globos más grandes sueltos; aquí la base es un anillo de seis. La ficha no trae productos: colores de la foto.",
  },
  {
    id: 46, nombre: "Árbol dorado de franjas", slug: "arbol-dorado", url: url("arbol-dorado"), fuente: "ficha", lugar: "piso",
    productos: [{ formatoId: "R-12", codigo: "405", nombre: "Satín Blanco" }, { formatoId: "R-12", codigo: "570", nombre: "Metal Dorado" }, { formatoId: "R-12", codigo: "970", nombre: "Reflex Dorado" }],
    pieza: { tipo: "forma", forma: { clase: "cono", altoCm: 150, tecnica: "anillos", formatoId: "R-12", infladoBaseCm: 23, infladoPuntaCm: 14, globosBase: 5, globosPunta: 4, colores: { codigos: ["405", "570"], patron: "franjas", franjaNiveles: 1 }, acento: { formatoId: "R-5", infladoCm: 9, codigos: ["970"], cada: 1 } } },
    nota: "Se parece: cono alto y estrecho de anillos alternando Satín Blanco y Metal Dorado, con bolitas Reflex Dorado (R-5) en los huecos. No: la estrella metalizada de la punta (no es látex). Las bolitas van en R-5 del mismo código de la ficha (que lo trae en R-12).",
  },
  {
    id: 422, nombre: "Corazón marco amarillo", slug: "corazon-amarillo", url: url("corazon-amarillo"), fuente: "foto", lugar: "pared",
    productos: [{ formatoId: "LOL-6", codigo: "020", nombre: "Link-O-Loon Fashion Amarillo" }, { formatoId: "R-5", codigo: "012", nombre: "Fashion Fucsia" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 115, altoCm: 105 }, tecnica: { tipo: "malla", formatoId: "LOL-6", infladoCm: 12, union: { infladoCm: 8, codigo: "012" } }, colores: { codigos: ["020"], patron: "un_color" }, marcoCm: 19 } },
    nota: "Se parece: marco de corazón con el centro hueco, de rejilla amarilla con los nudos fucsia asomando, ~1 m. No: en la foto la rejilla es de globitos torcidos; aquí es malla LOL-6 con su cadeneta de borde. La ficha no trae productos: colores de la foto.",
  },
  {
    id: 425, nombre: "Corazón degradé 3 colores", slug: "corazon-en-malla-3-colores", url: url("corazon-en-malla-3-colores"), fuente: "ficha", lugar: "pared",
    productos: [{ formatoId: "R-12", codigo: "015", nombre: "Fashion Rojo" }, { formatoId: "R-12", codigo: "012", nombre: "Fashion Fucsia" }, { formatoId: "R-12", codigo: "009", nombre: "Fashion Rosado" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "corazon", anchoCm: 150, altoCm: 135 }, tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 20, celda: "tresbolillo" }, colores: { codigos: ["015", "012", "009"], patron: "degradado", anguloGrados: -45, semilla: 4 } } },
    nota: "Se parece: corazón de ~1,5 m relleno de R-12 al tresbolillo con el degradé en diagonal rojo → fucsia → rosado. No: en la foto los globos del borde se ven algo más chicos y sueltos; aquí los huecos de la orilla se tapan con R-5 del mismo color.",
  },
  {
    id: 453, nombre: "Cruz latte y champaña", slug: "cruz-primera-comunion", url: url("cruz-primera-comunion"), fuente: "ficha", lugar: "pared",
    productos: [{ formatoId: "R-12", codigo: "073", nombre: "Fashion Latte" }, { formatoId: "R-12", codigo: "971", nombre: "Reflex Champaña" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "cruz", anchoCm: 125, altoCm: 165 }, tecnica: { tipo: "celdas", formatoId: "R-12", infladoCm: 25, celda: "cuadrada" }, colores: { codigos: ["073"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 12, codigos: ["971"], cada: 1 } } },
    nota: "Se parece: cruz de R-12 Latte en retícula con Reflex Champaña chicos en cada hueco, ~1,5 m. No: los cuatro globos impresos «Mi Primera Comunión» de las puntas (impreso sin código en la tabla) quedan en Latte. Los champaña van en R-5 del mismo código de la ficha.",
  },
  {
    id: 525, nombre: "Esfera de amor", slug: "esfera-de-amor-1", url: url("esfera-de-amor-1"), fuente: "ficha", lugar: "piso",
    productos: [{ formatoId: "R-12", codigo: "005", nombre: "Fashion Blanco" }, { formatoId: "R-12", codigo: "015", nombre: "Fashion Rojo" }, { formatoId: "R-12", codigo: "970", nombre: "Reflex Dorado" }],
    pieza: { tipo: "forma", forma: { clase: "esfera", diametroCm: 62, globo: { formatoId: "R-12", infladoCm: 14 }, colores: { codigos: ["005"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 9, codigos: ["015", "970"], cada: 2 } } },
    nota: "Se parece: esfera geodésica de blancos con bolitas rojas y doradas en los huecos, ~60 cm. No: la base (cuarteto rojo, impresos «Amo», rizos de tubito dorado) ni la cinta de la que flota. Las bolitas van en R-5 de los códigos de la ficha.",
  },
  {
    id: 588, nombre: "Globo aerostático perla", slug: "figura-revelacion-de-genero", url: url("figura-revelacion-de-genero"), fuente: "ficha", lugar: "piso",
    productos: [{ formatoId: "R-12", codigo: "873", nombre: "Silk Perla Crema" }, { formatoId: "R-12", codigo: "839", nombre: "Silk Azul Ártico" }, { formatoId: "R-12", codigo: "809", nombre: "Silk Rosa Primaveral" }],
    pieza: { tipo: "forma", forma: { clase: "aerostatico", globo: { diametroCm: 78, globo: { formatoId: "R-12", infladoCm: 16 }, colores: { codigos: ["873"], patron: "un_color" }, acento: { formatoId: "R-5", infladoCm: 10, codigos: ["839", "809"], cada: 2 } }, canasta: { formatoId: "R-12", infladoCm: 18, codigo: "873", porAnillo: 6, anillos: 2 }, cuerdasCm: 45 } },
    nota: "Se parece: globo de Silk Perla Crema con bolitas azul ártico y rosa primaveral, cuerdas y canasta, ~1,5 m. No: el osito de tubito (T-260 Latte de la ficha) y la base orgánica; la canasta de la foto es plateada y aquí va en Perla Crema (la plata no está en la ficha).",
  },
  {
    id: 792, nombre: "Número 1 orgánico naval", slug: "numero-1-naval", url: url("numero-1-naval"), fuente: "foto", lugar: "piso",
    productos: [{ formatoId: "R-12", codigo: "044", nombre: "Fashion Azul Naval" }, { formatoId: "R-12", codigo: "015", nombre: "Fashion Rojo" }, { formatoId: "R-12", codigo: "005", nombre: "Fashion Blanco" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "texto", texto: "1", altoCm: 140, grosorCm: 34 }, tecnica: { tipo: "organico", radioCm: 17, mezcla: { "R-12": 1, "R-5": 1.2 }, semilla: 5, inflados: { "R-12": 18 } }, colores: { codigos: ["044", "015", "005"], patron: "mezcla", pesos: [40, 30, 30] } } },
    nota: "Se parece: el 1 con bandera y pie, de racimos orgánicos de R-12 y R-5 naval, rojo y blanco mezclados, ~1,5 m. No: en la foto el pie es más ancho y el trazo algo más grueso arriba. La ficha no trae productos: colores de la foto.",
  },
  {
    id: 891, nombre: "Estrella orgánica champaña", slug: "reyes-magos-4", url: url("reyes-magos-4"), fuente: "ficha", lugar: "pared",
    productos: [{ formatoId: "R-12", codigo: "971", nombre: "Reflex Champaña" }, { formatoId: "R-12", codigo: "406", nombre: "Satín Perla" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "estrella", anchoCm: 110, altoCm: 105 }, tecnica: { tipo: "organico", radioCm: 16, mezcla: { "R-12": 1, "R-5": 2 }, semilla: 9, inflados: { "R-12": 14 } }, colores: { codigos: ["971", "406"], patron: "mezcla", pesos: [45, 55] } } },
    nota: "Se parece: estrella de cinco puntas orgánica, gruesa al centro y fina en las puntas, Reflex Champaña con Satín Perla. No: en la foto las puntas rematan en un globito más claro. Sin R-9 de relleno: el Champaña no se fabrica en R-9.",
  },
];

/** Formas básicas para empezar (no son ideas de la tienda). */
export const FORMAS_BASICAS: readonly IdeaForma[] = [
  {
    id: 0, nombre: "FELIZ de cuartetos", slug: "", url: "", fuente: "foto", lugar: "pared", productos: [{ formatoId: "R-5", codigo: "012", nombre: "Fashion Fucsia" }, { formatoId: "R-5", codigo: "040", nombre: "Fashion Azul" }],
    pieza: { tipo: "letras", letras: { texto: "FELIZ", altoCm: 60, grosorCm: 26, disposicion: "fila", tecnica: "cuartetos", formatoId: "R-5", infladoCm: 11, colores: ["012", "040"], patron: "por_letra" } },
    nota: "Letras de 60 cm con una trenza de cuartetos de R-5 por trazo.",
  },
  {
    id: 0, nombre: "ANA de tubito", slug: "", url: "", fuente: "foto", lugar: "pared", productos: [{ formatoId: "T-260", codigo: "570", nombre: "Tubito Metal Dorado" }],
    pieza: { tipo: "letras", letras: { texto: "ANA", altoCm: 45, grosorCm: 10, disposicion: "fila", tecnica: "tubito", formatoId: "T-260", infladoCm: 5, colores: ["570"], patron: "un_color" } },
    nota: "Dos T-260 trenzados siguiendo cada trazo.",
  },
  {
    id: 0, nombre: "Nube de R-9", slug: "", url: "", fuente: "foto", lugar: "pared", productos: [{ formatoId: "R-9", codigo: "005", nombre: "Fashion Blanco" }, { formatoId: "R-9", codigo: "640", nombre: "Pastel Mate Azul" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "nube", anchoCm: 120, altoCm: 75 }, tecnica: { tipo: "celdas", formatoId: "R-9", infladoCm: 17, celda: "tresbolillo" }, colores: { codigos: ["005"], patron: "un_color" }, borde: { codigo: "640" } } },
    nota: "Nube rellena al tresbolillo con el borde de otro color.",
  },
  {
    id: 0, nombre: "Castillo de malla", slug: "", url: "", fuente: "foto", lugar: "pared", productos: [{ formatoId: "LOL-12", codigo: "609", nombre: "Link-O-Loon Pastel Mate Rosado" }, { formatoId: "R-5", codigo: "005", nombre: "Fashion Blanco" }],
    pieza: { tipo: "forma", forma: { clase: "rellena", contorno: { tipo: "predefinido", id: "castillo", anchoCm: 160, altoCm: 150 }, tecnica: { tipo: "malla", formatoId: "LOL-12", infladoCm: 22, union: { infladoCm: 10, codigo: "005" } }, colores: { codigos: ["609"], patron: "un_color" } } },
    nota: "Castillo de dos torres con almenas en malla Link-O-Loon.",
  },
];

// ----------------------------------------------------------------------------------------------------------
// Miniatura y añadir a la escena
// ----------------------------------------------------------------------------------------------------------

/** La pieza armada vista de frente (de +z), como la miniatura de las decoraciones pequeñas. */
export function miniaturaPieza(armada: PiezaArmada): Miniatura {
  const formas: FormaMiniatura[] = [];
  const plano = (p: Vec3): [number, number] => [Math.round(p.x * 100) / 100, Math.round(-p.y * 100) / 100];
  for (const g of armada.globos) {
    const r = g.infladoCm / 2;
    const largo = r + g.cuelloExtraCm;
    const centro: Vec3 = { x: g.nudo.x + g.direccion.x * largo, y: g.nudo.y + g.direccion.y * largo, z: g.nudo.z + g.direccion.z * largo };
    const [cx, cy] = plano(centro);
    const dx = g.direccion.x, dy = -g.direccion.y;
    const s = Math.min(1, Math.hypot(dx, dy));
    const a = r * (g.formatoId.startsWith("LOL") ? 1.35 : 1.08);
    formas.push({
      tipo: "globo", cx, cy, rx: Math.sqrt(a * a * s * s + r * r * (1 - s * s)), ry: r, giroGrados: s > 1e-6 ? (Math.atan2(dy, dx) * 180) / Math.PI : -90,
      corazon: g.formatoId.startsWith("C-"), codigo: g.codigo, hex: hexDeCodigo(g.codigo), profundidad: centro.z,
    });
  }
  for (const t of armada.tubos) {
    const profundidad = t.puntos.reduce((s, q) => s + q.z, 0) / Math.max(1, t.puntos.length);
    formas.push({ tipo: "tubito", puntos: t.puntos.map(plano), grosor: t.grosorCm, cerrado: t.cerrado, codigo: t.codigo, hex: t.papel?.hex ?? hexDeCodigo(t.codigo), profundidad, ...(t.papel ? { papel: { relleno: false } } : {}) });
  }
  formas.sort((p, q) => p.profundidad - q.profundidad);
  const { min, max } = armada.caja;
  const lado = Math.max(max.x - min.x, max.y - min.y, 1) * 1.06;
  const redondo = (v: number) => Math.round(v * 100) / 100;
  return { caja: { x: redondo((min.x + max.x) / 2 - lado / 2), y: redondo(-(min.y + max.y) / 2 - lado / 2), ancho: redondo(lado), alto: redondo(lado) }, formas };
}

export type DestinoForma = { en: "piso" } | { en: "pared" };

/**
 * Mete la idea en la escena (la de entrada no cambia): de pie en el piso, al frente y corrida a un lado si ya hay
 * otras formas ahí, o en la pared del fondo a 60 cm del piso.
 */
export function agregarIdeaForma(escena: Escena, idea: IdeaForma, destino: DestinoForma): { escena: Escena; id: string } {
  const id = idNuevo(escena, idea.slug || "forma");
  const sueltas = escena.nodos.filter((n) => (n.pieza.tipo === "forma" || n.pieza.tipo === "letras") && n.colocacion.en === destino.en).length;
  const desfase = sueltas === 0 ? 0 : (sueltas % 2 === 1 ? 1 : -1) * Math.ceil(sueltas / 2) * 90;
  let colocacion: Colocacion;
  if (destino.en === "pared") {
    const largo = marcoDePared(escena.sala, "fondo").largoCm;
    colocacion = { en: "pared", pared: "fondo", aLoLargoCm: Math.max(-largo / 2 + 60, Math.min(largo / 2 - 60, desfase)), alturaCm: 60 };
  } else {
    colocacion = { en: "piso", xCm: Math.max(-escena.sala.anchoCm / 2 + 60, Math.min(escena.sala.anchoCm / 2 - 60, desfase)), zCm: Math.round(escena.sala.fondoCm * 0.15), giroGrados: 0 };
  }
  const nombre = idea.id ? `${idea.nombre} (#${idea.id})` : idea.nombre;
  const nodo: NodoEscena = { id, nombre, pieza: structuredClone(idea.pieza), colocacion };
  return { escena: { ...escena, nodos: [...escena.nodos, nodo] }, id };
}

/** Las ideas y las básicas armadas, con su miniatura y cuántos globos llevan (los tubitos cuentan como globos). */
export function formasConMiniatura(): Array<IdeaForma & { miniatura: Miniatura; globos: number }> {
  return [...IDEAS_FORMAS, ...FORMAS_BASICAS].map((idea) => {
    const armada = armarPieza(idea.pieza);
    return { ...idea, miniatura: miniaturaPieza(armada), globos: armada.materiales.reduce((s, m) => s + m.cantidad, 0) };
  });
}
