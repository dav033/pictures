import { formatoPorId } from "./formatos";
import { centroCuerpo } from "./geometria";
import { armarModulo, moduloPorId, type Vec3 } from "./modulos";
import type { GloboDePared } from "./paredes";

/**
 * Mural de trenzas alternando tamaños (Sempertex, «Técnicas · Murales con trenzas alternando tamaños»; es la
 * pared de fondo de Celebra ed. 27, p. 42): trenzas verticales de cuartetos que alternan un cuarteto grande y
 * uno chico, puestas lado a lado. Una trenza empieza con el grande y la vecina con el chico, así los chicos de
 * una encajan en los huecos que dejan los grandes de la otra y la pared queda densa y plana de frente.
 *
 * Medidas del PDF de Sempertex (con R-12): grande a 25 cm, chico a 20 cm; cada trenza aporta ~50 cm de ancho y
 * lleva en promedio 6 cuartetos por metro. De frente, el cuarteto chico muestra 3 globos (izquierda, centro y
 * derecha; el cuarto queda detrás del centro) y el grande 2 (izquierda y derecha; los otros dos detrás): el chico
 * va girado 1/8 de vuelta respecto al grande, con un globo apuntando al frente.
 * De ahí salen las reglas para otros inflados: el paso vertical es 0,74 × el inflado medio (16,7 cm a 25/20) y
 * el ancho de trenza 1,11 × (grande + chico) (50 cm a 25/20).
 * La pared queda en el plano XY, apoyada en el piso (y = 0), con el frente hacia +Z. Unidades: cm.
 */
export type PatronTrenzas = "un_color" | "por_tamano" | "columnas" | "franjas";

export const PATRONES_TRENZAS: ReadonlyArray<{ id: PatronTrenzas; nombre: string; descripcion: string; colores: number }> = [
  { id: "un_color", nombre: "Un color", descripcion: "Toda la pared del mismo color, como la de Celebra ed. 27.", colores: 1 },
  { id: "por_tamano", nombre: "Por tamaño", descripcion: "Los cuartetos grandes de un color y los chicos de otro: queda un tejido de dos tonos.", colores: 2 },
  { id: "columnas", nombre: "Por trenza", descripcion: "Cada trenza de un color, alternando.", colores: 2 },
  { id: "franjas", nombre: "Franjas", descripcion: "Franjas horizontales de 2 cuartetos de alto, alternando colores.", colores: 3 },
];

/** 6 cuartetos por metro con el inflado medio de 22,5 cm (25 y 20): 16,7 cm de paso = 0,74 diámetros. */
export const PASO_ALTERNADO_POR_DIAMETRO = 100 / 6 / 22.5;
/** ~50 cm de ancho de trenza con 25 + 20 cm. */
export const ANCHO_TRENZA_POR_SUMA = 50 / 45;
/**
 * En el mural el cuarteto NO va apretado como en la columna (0,62): de frente el grande muestra sus dos globos
 * lado a lado, cada uno a medio diámetro del eje, así que el globo queda a d / (2 · cos 45°) ≈ 0,71 d del eje
 * (los cuatro se tocan). Con eso el grande de 25 cm mide 50 cm de frente: el ancho de trenza del PDF.
 */
export const RADIO_CUARTETO_MURAL_POR_DIAMETRO = Math.SQRT1_2;
/** Hilera de 2 cuartetos por franja en el patrón «franjas». */
const FRANJA_CUARTETOS = 2;

export type TamanoCuarteto = { formatoId: string; infladoCm: number };

export type OpcionesParedTrenzas = {
  grande: TamanoCuarteto;
  chico: TamanoCuarteto;
  anchoCm: number;
  altoCm: number;
  patron: PatronTrenzas;
  colores: readonly string[];
  /** Con qué cuarteto empieza (abajo) la primera trenza de la izquierda; la vecina empieza con el otro. */
  empiezaCon: "grande" | "chico";
};

export type GloboDeParedTrenzas = GloboDePared & { columna: number; nivel: number; tamano: "grande" | "chico" };

/**
 * Ancla de la pared de trenzas, siempre al frente (+Z) y sobre la superficie: «trenza» en el eje de una trenza
 * (entre los dos globos de frente del grande, o sobre el globo central del chico) y «union» en la costura entre
 * dos trenzas vecinas, a la altura de cada cuarteto. Ahí se amarran las decoraciones con un T-260.
 */
export type AnclaParedTrenzas = { tipo: "trenza" | "union"; columna: number; nivel: number; posicion: Vec3; normal: Vec3 };

export type ParedTrenzasArmada = {
  globos: GloboDeParedTrenzas[];
  anclas: AnclaParedTrenzas[];
  columnas: number;
  niveles: number;
  cuartetos: { grande: number; chico: number };
  pasoCm: number;
  anchoTrenzaCm: number;
  anchoCm: number;
  altoCm: number;
  materiales: Array<{ formatoId: string; codigo: string; cantidad: number }>;
};

/** Valores del PDF de Sempertex: R-12 a 25 y a 20 cm, un color. */
export const PARED_TRENZAS_INICIAL: OpcionesParedTrenzas = {
  grande: { formatoId: "R-12", infladoCm: 25 }, chico: { formatoId: "R-12", infladoCm: 20 },
  anchoCm: 250, altoCm: 220, patron: "un_color", colores: ["609"], empiezaCon: "grande",
};

function girarY(v: Vec3, angulo: number): Vec3 {
  const c = Math.cos(angulo), s = Math.sin(angulo);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}

function colorDe(patron: PatronTrenzas, colores: readonly string[], columna: number, nivel: number, tamano: "grande" | "chico"): string {
  const c = (i: number) => colores[i % Math.max(1, colores.length)] ?? colores[0] ?? "609";
  switch (patron) {
    case "un_color": return c(0);
    case "por_tamano": return c(tamano === "grande" ? 0 : 1);
    case "columnas": return c(columna);
    case "franjas": return c(Math.floor(nivel / FRANJA_CUARTETOS));
  }
}

/** Un cuarteto del mural (globos a 0,71 diámetros del eje, nudos hacia dentro), eje en Y local. */
function cuartetoApretado(formatoId: string, infladoCm: number) {
  const formato = formatoPorId(formatoId) ?? formatoPorId("R-12")!;
  const cuarteto = { ...moduloPorId("cuarteto")!, inclinacion: 0.12 };
  const base = armarModulo(cuarteto, formato, infladoCm);
  const natural = centroCuerpo(formato.tipo === "link" ? "link" : "redondo", infladoCm);
  const radio = infladoCm * RADIO_CUARTETO_MURAL_POR_DIAMETRO;
  return base.globos.map((g) => {
    const horizontal = Math.hypot(g.direccion.x, g.direccion.z) || 1;
    const desde = radio / horizontal - natural;
    return { ...g, nudo: { x: g.direccion.x * desde, y: g.direccion.y * desde, z: g.direccion.z * desde }, cuelloExtraCm: 0 };
  });
}

/**
 * La superficie de frente de un conjunto de globos colocados: para un punto (x, y) de la pared, la z más
 * adelantada de los cuerpos que lo cubren (cada cuerpo como una esfera de su inflado). Sirve para poner las
 * anclas sobre los globos y para que una decoración quede apoyada, no flotando ni enterrada.
 * `holguraPorDiametro` agranda cada cuerpo (en diámetros): con un 6 % (el radio un 12 % mayor) la costura entre dos globos que apenas se
 * tocan deja de ser un hueco hasta el fondo y queda a la profundidad donde se amarra (el látex se aplasta ahí).
 */
export function superficieFrontal(globos: ReadonlyArray<{ formatoId: string; infladoCm: number; nudo: Vec3; direccion: Vec3; cuelloExtraCm: number }>, holguraPorDiametro = 0): (x: number, y: number) => number {
  const cuerpos = globos.map((g) => {
    const tipo = formatoPorId(g.formatoId)?.tipo === "link" ? "link" : "redondo";
    const l = centroCuerpo(tipo, g.infladoCm) + g.cuelloExtraCm;
    return { x: g.nudo.x + g.direccion.x * l, y: g.nudo.y + g.direccion.y * l, z: g.nudo.z + g.direccion.z * l, r: g.infladoCm * (0.5 + holguraPorDiametro) };
  });
  return (x, y) => {
    let mejor = -Infinity;
    for (const c of cuerpos) {
      const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
      if (d2 < c.r * c.r) mejor = Math.max(mejor, c.z + Math.sqrt(c.r * c.r - d2));
    }
    return Number.isFinite(mejor) ? mejor : 0;
  };
}

export function armarParedTrenzas(opciones: OpcionesParedTrenzas): ParedTrenzasArmada {
  const { grande, chico, anchoCm, altoCm, patron, colores, empiezaCon } = opciones;
  const pasoCm = ((grande.infladoCm + chico.infladoCm) / 2) * PASO_ALTERNADO_POR_DIAMETRO;
  const anchoTrenzaCm = (grande.infladoCm + chico.infladoCm) * ANCHO_TRENZA_POR_SUMA;
  const columnas = Math.max(1, Math.round(anchoCm / anchoTrenzaCm));
  const niveles = Math.max(2, Math.round(altoCm / pasoCm));
  const modelos = { grande: cuartetoApretado(grande.formatoId, grande.infladoCm), chico: cuartetoApretado(chico.formatoId, chico.infladoCm) };
  const medidas = { grande, chico };
  // El cuarteto base tiene sus globos a 45°, 135°, 225° y 315°: de frente se ven 2 (el grande). El chico va
  // girado 1/8 de vuelta: un globo al frente (90°) y se ven 3.
  const giro = { grande: 0, chico: Math.PI / 4 };
  const tamanoDe = (columna: number, nivel: number): "grande" | "chico" =>
    (columna + nivel + (empiezaCon === "chico" ? 1 : 0)) % 2 === 0 ? "grande" : "chico";

  const globos: GloboDeParedTrenzas[] = [];
  const cuartetos = { grande: 0, chico: 0 };
  for (let columna = 0; columna < columnas; columna++) {
    const x = (columna + 0.5) * anchoTrenzaCm;
    for (let nivel = 0; nivel < niveles; nivel++) {
      const tamano = tamanoDe(columna, nivel);
      cuartetos[tamano] += 1;
      const y = (nivel + 0.5) * pasoCm;
      const codigo = colorDe(patron, colores, columna, nivel, tamano);
      for (const g of modelos[tamano]) {
        const nudo = girarY(g.nudo, giro[tamano]);
        globos.push({
          indice: globos.length, formatoId: medidas[tamano].formatoId, infladoCm: medidas[tamano].infladoCm, codigo,
          nudo: { x: nudo.x + x, y: nudo.y + y, z: nudo.z }, direccion: girarY(g.direccion, giro[tamano]), cuelloExtraCm: 0,
          columna, nivel, tamano, parte: tamano === "grande" ? "trenza/grande" : "trenza/chica",
        });
      }
    }
  }

  const frente = superficieFrontal(globos, 0.06);
  const anclas: AnclaParedTrenzas[] = [];
  for (let columna = 0; columna < columnas; columna++) {
    for (let nivel = 0; nivel < niveles; nivel++) {
      const y = (nivel + 0.5) * pasoCm;
      const enEje = (columna + 0.5) * anchoTrenzaCm;
      anclas.push({ tipo: "trenza", columna, nivel, posicion: { x: enEje, y, z: frente(enEje, y) }, normal: { x: 0, y: 0, z: 1 } });
      if (columna < columnas - 1) {
        const costura = (columna + 1) * anchoTrenzaCm;
        anclas.push({ tipo: "union", columna, nivel, posicion: { x: costura, y, z: frente(costura, y) }, normal: { x: 0, y: 0, z: 1 } });
      }
    }
  }

  const cuenta = new Map<string, { formatoId: string; codigo: string; cantidad: number }>();
  for (const g of globos) {
    const clave = `${g.formatoId}|${g.codigo}`;
    const actual = cuenta.get(clave);
    if (actual) actual.cantidad += 1; else cuenta.set(clave, { formatoId: g.formatoId, codigo: g.codigo, cantidad: 1 });
  }
  return {
    globos, anclas, columnas, niveles, cuartetos, pasoCm, anchoTrenzaCm,
    anchoCm: Math.round(columnas * anchoTrenzaCm), altoCm: Math.round(niveles * pasoCm),
    materiales: [...cuenta.values()],
  };
}
