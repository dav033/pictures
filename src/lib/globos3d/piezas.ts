import { formatoPorId } from "./formatos";
import { centroCuerpo } from "./geometria";
import { armarModulo, moduloPorId, type TipoModulo, type Vec3 } from "./modulos";
import { armarColumna, type PatronColumna } from "./columnas";
import { armarArco, type FormaArco } from "./arcos";
import { armarPared, type PatronMalla } from "./paredes";
import { armarParedTrenzas, type OpcionesParedTrenzas } from "./pared-trenzas";
import { armarOrganico, type OpcionesOrganico } from "./organico";
import type { GeneradorOrganico } from "./generadores-organicos";
import { repartirFlores, type OpcionesFlores, type TipoFlorArtificial } from "./flores-artificiales";
import { armarDecoracion, type Decoracion, type MaterialDecoracion } from "./figuras";
import { materialesPorFormato, type GloboDecoracion, type TuboDecoracion } from "./decoraciones";
import { sumarMateriales } from "./mezcla";
import { armarTrenza } from "./trenza";
import { opcionesArcoOrganico, recorridoGuirnalda, type OpcionesArcoOrganico, type OpcionesGuirnalda } from "./formas-escena";
import { armarEscenografia, puntosSolido, type ElementoEscenografia, type ProductoDePieza, type SolidoEscenografia } from "./escenografia";
import type { TipoUtileria } from "./utileria-catalogo";
import { armarForma, type OpcionesForma } from "./formas";
import { armarLetras, type OpcionesLetras } from "./letras";
import { armarMetalizado, type OpcionesMetalizado } from "./metalizados";
import { aplicarImpresos, type ImpresoEnPieza } from "./impresos-catalogo";
import { armarMural, type OpcionesMural } from "./murales";
import { armarTecho, type OpcionesTecho } from "./techo";
import { armarArbolGlobos, type OpcionesArbolGlobos } from "./arboles-globos";

/**
 * Una **pieza**: cualquier cosa que sabe armar el taller, descrita solo con datos (JSON) para poder guardarla,
 * repetirla y componer escenas con varias. `armarPieza` la convierte en lo que dibuja el visor y en su lista de
 * materiales, en su propio espacio (cm, y hacia arriba, apoyada en y = 0 cuando es una estructura de piso).
 * Las escenas (varias piezas colocadas) y el catálogo de decoraciones digitalizadas se construyen encima.
 */
type PiezaBase =
  | { tipo: "columna"; formatoId: string; infladoCm: number; alturaCm: number; patron: PatronColumna; colores: string[] }
  | { tipo: "arco"; formatoId: string; infladoCm: number; forma: FormaArco; anchoCm: number; altoCm: number; patron: PatronColumna; colores: string[] }
  | { tipo: "pared_malla"; formatoId: string; infladoCm: number; anchoCm: number; altoCm: number; patron: PatronMalla; colores: string[]; union: { infladoCm: number; codigo: string } }
  | { tipo: "pared_trenzas"; opciones: OpcionesParedTrenzas }
  /**
   * Orgánico: lo arma el motor desde `opciones`. Con `generador`, la pieza guarda además los PARÁMETROS con que se
   * hizo (el trazo de una guirnalda libre…): los editores y la IA la cambian por ellos y vuelven a sacar `opciones`.
   */
  | { tipo: "organico"; opciones: OpcionesOrganico; flores: OpcionesFlores | null; generador?: GeneradorOrganico }
  /**
   * Decoración pequeña (flor, moño, estrella…). Se arma mirando a +y (bien en el piso, del techo o colgada de un
   * ancla); con `deFrente` mira a +z, al salón, con su arriba hacia +y: así va pegada a una pared.
   */
  | { tipo: "decoracion"; decoracion: Decoracion; deFrente?: boolean }
  /** Arco orgánico por medidas: dos semiarcos que se juntan en la clave (ver `formas-escena.ts`). */
  | { tipo: "arco_organico"; arco: OpcionesArcoOrganico }
  /** Guirnalda clásica: trenza de cuartetos en festón, recta o sobre una curva libre. */
  | { tipo: "guirnalda"; guirnalda: OpcionesGuirnalda }
  /**
   * Escenografía (no es globo ni cotiza): paneles de fondo, pared de lentejuelas, mesas, tapete (ver `escenografia.ts`).
   * La **utilería de fiesta** (banderín, platos, vasos… ver `utileria.ts`) también es escenografía, pero dice qué es
   * (`utileria`) y qué producto Sempertex representa (`productos`): sale en la lista «Productos de fiesta».
   */
  | { tipo: "escenografia"; elementos: ElementoEscenografia[]; utileria?: TipoUtileria; productos?: ProductoDePieza[] }
  /**
   * Un globo suelto (el R-24 de remate encima de un arco): el centro de su cuerpo en el origen y el cuerpo hacia +y
   * (nudo abajo). Cotiza como un globo.
   */
  | { tipo: "globo"; formatoId: string; infladoCm: number; codigo: string }
  /**
   * Forma rellena por contorno (corazón, estrella, ancla, número…: celdas, malla o capa orgánica, con borde, marco y
   * acentos) o volumen (esfera, cono, árbol, globo aerostático). Ver `formas.ts`.
   */
  | { tipo: "forma"; forma: OpcionesForma }
  /** Letras y números de globos (hilera de R-5, cuartetos o tubitos trenzados). Ver `letras.ts`. */
  | { tipo: "letras"; letras: OpcionesLetras }
  /**
   * Globo metalizado (foil): número, letra, corazón, estrella, redondo… parado de frente, con la base en y = 0 (o
   * flotando sobre su cinta). No es látex: no da materiales; su producto de la tienda va en `productos`. Ver `metalizados.ts`.
   */
  | { tipo: "metalizado"; metalizado: OpcionesMetalizado }
  /**
   * Mural pixelado: una matriz de colores (cada celda, un globo en su sitio real) en malla de R-5/R-9/R-12 (uno o dos
   * tamaños) o de Link-O-Loon, de frente y apoyado en y = 0. Ver `murales.ts`.
   */
  | { tipo: "mural"; mural: OpcionesMural }
  /**
   * Decoración de techo: red de racimos o malla, festones en catenaria de punto a punto, tiras colgantes y globos de
   * helio contra el techo. Su espacio local tiene el techo en y = 0 y todo cuelga por debajo. Ver `techo.ts`.
   */
  | { tipo: "techo"; techo: OpcionesTecho }
  /** Palmera (tronco de cuartetos que se curva, hojas de tubito, cocos) o árbol con copa de racimos. Ver `arboles-globos.ts`. */
  | { tipo: "arbol_globos"; arbol: OpcionesArbolGlobos }
  /**
   * Módulo suelto (pareja, trío, cuarteto, quinteto o sexteto) armado como enseña Sempertex, con el color de cada globo
   * (`colores[i]`, el del globo i; si falta, el primero). Apoyado en y = 0, con sus anclas (centro y huecos).
   */
  | { tipo: "modulo"; modulo: TipoModulo; formatoId: string; infladoCm: number; colores: string[] };

/**
 * Cualquier pieza puede llevar **globos impresos** de la tienda (`impresos`, ver `impresos-catalogo.ts`): se eligen
 * sus globos por color o por índice y esos toman el impreso, su color base y su producto.
 */
export type Pieza = PiezaBase & { impresos?: ImpresoEnPieza[] };

export type TipoPieza = Pieza["tipo"];

/** Un globo listo para el visor (con confeti si es un cristal relleno). */
export type GloboDePieza = GloboDecoracion & { confeti?: boolean };
/** Flor artificial (follaje): no cotiza como globo. */
export type FlorDePieza = { tipo: TipoFlorArtificial; hex: string; diametroCm: number; posicion: Vec3; normal: Vec3 };
export type AnclaDePieza = { posicion: Vec3; normal: Vec3 };

export type PiezaArmada = {
  globos: GloboDePieza[];
  tubos: TuboDecoracion[];
  flores: FlorDePieza[];
  /** Donde se pueden colgar decoraciones hijas. */
  anclas: AnclaDePieza[];
  materiales: MaterialDecoracion[];
  /** Escenografía (paneles, mesas, tapete): solo la trae la pieza `escenografia`. */
  solidos?: SolidoEscenografia[];
  /** Caja que ocupa (cm), contando el cuerpo de cada globo. */
  caja: { min: Vec3; max: Vec3 };
  /** Productos de la tienda que no son globos lisos (metalizados, globos impresos), con su cantidad. */
  productos?: ProductoDePieza[];
};

function cajaDe(globos: readonly GloboDecoracion[], tubos: readonly TuboDecoracion[], solidos: readonly SolidoEscenografia[] = []): PiezaArmada["caja"] {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const meter = (p: Vec3, r: number) => {
    min.x = Math.min(min.x, p.x - r); min.y = Math.min(min.y, p.y - r); min.z = Math.min(min.z, p.z - r);
    max.x = Math.max(max.x, p.x + r); max.y = Math.max(max.y, p.y + r); max.z = Math.max(max.z, p.z + r);
  };
  for (const g of globos) {
    const r = g.infladoCm / 2;
    const largo = r + g.cuelloExtraCm;
    meter({ x: g.nudo.x + g.direccion.x * largo, y: g.nudo.y + g.direccion.y * largo, z: g.nudo.z + g.direccion.z * largo }, r);
  }
  for (const t of tubos) for (const p of t.puntos) meter(p, t.grosorCm / 2);
  for (const s of solidos) for (const p of puntosSolido(s)) meter(p, 0);
  if (!Number.isFinite(min.x)) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  return { min, max };
}

function conCaja(p: Omit<PiezaArmada, "caja">): PiezaArmada {
  return { ...p, caja: cajaDe(p.globos, p.tubos, p.solidos) };
}

/** La parte de un globo orgánico: su tramo («columna», «trazo», «espiral», «pata_izquierda»…), en minúsculas y con «/» por «_». */
const parteOrganica = (tramo: string) => tramo.toLowerCase().replace(/_/g, "/");

export function armarPieza(pieza: Pieza): PiezaArmada {
  const armada = armarPiezaBase(pieza);
  if (!pieza.impresos?.length) return armada;
  const conImpresos = aplicarImpresos(armada.globos, armada.materiales, pieza.impresos);
  return { ...armada, globos: conImpresos.globos, materiales: conImpresos.materiales, productos: [...(armada.productos ?? []), ...conImpresos.productos] };
}

function armarPiezaBase(pieza: PiezaBase): PiezaArmada {
  switch (pieza.tipo) {
    case "columna":
    case "arco": {
      const formato = formatoPorId(pieza.formatoId);
      if (!formato) throw new Error(`Formato desconocido: ${pieza.formatoId}`);
      const armada = pieza.tipo === "columna"
        ? armarColumna({ formato, infladoCm: pieza.infladoCm, alturaCm: pieza.alturaCm, patron: pieza.patron, colores: pieza.colores })
        : armarArco({ formato, infladoCm: pieza.infladoCm, forma: pieza.forma, anchoCm: pieza.anchoCm, altoCm: pieza.altoCm, patron: pieza.patron, colores: pieza.colores });
      const globos: GloboDePieza[] = armada.globos.map((g) => ({ formatoId: formato.id, infladoCm: pieza.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.parte ? { parte: g.parte } : {}) }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armada.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: materialesPorFormato(globos) });
    }
    case "pared_malla": {
      const formato = formatoPorId(pieza.formatoId);
      const r5 = formatoPorId("R-5");
      if (!formato || !r5) throw new Error(`Formato desconocido: ${pieza.formatoId}`);
      const armada = armarPared({ formato, infladoCm: pieza.infladoCm, anchoCm: pieza.anchoCm, altoCm: pieza.altoCm, patron: pieza.patron, colores: pieza.colores, union: { formato: r5, infladoCm: pieza.union.infladoCm, codigo: pieza.union.codigo } });
      const globos: GloboDePieza[] = armada.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.parte ? { parte: g.parte } : {}) }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armada.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: armada.materiales });
    }
    case "pared_trenzas": {
      const armada = armarParedTrenzas(pieza.opciones);
      const globos: GloboDePieza[] = armada.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.parte ? { parte: g.parte } : {}) }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armada.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: armada.materiales });
    }
    case "organico": {
      const resultado = armarOrganico(pieza.opciones);
      const flores = pieza.flores ? repartirFlores(resultado.anclas, pieza.flores) : null;
      const globos: GloboDePieza[] = resultado.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.confeti ? { confeti: true } : {}), parte: parteOrganica(g.tramo) }));
      return conCaja({
        globos, tubos: [],
        flores: flores ? flores.racimos.flatMap((r) => r.flores.map((f) => ({ tipo: f.tipo, hex: f.hex, diametroCm: f.diametroCm, posicion: f.posicion, normal: f.normal }))) : [],
        anclas: resultado.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })),
        materiales: sumarMateriales(resultado.materiales.map((m) => ({ formatoId: m.formatoId, codigo: m.codigo, cantidad: m.cantidad }))),
      });
    }
    case "arco_organico":
      return armarPieza({ tipo: "organico", opciones: opcionesArcoOrganico(pieza.arco), flores: pieza.arco.flores });
    case "guirnalda": {
      const g = pieza.guirnalda;
      const formato = formatoPorId(g.formatoId);
      if (!formato) throw new Error(`Formato desconocido: ${g.formatoId}`);
      const trenza = armarTrenza({ formato, infladoCm: g.infladoCm, patron: g.patron, colores: g.colores, recorrido: recorridoGuirnalda(g), reparto: "extremos" });
      const globos: GloboDePieza[] = trenza.globos.map((x) => ({ formatoId: formato.id, infladoCm: g.infladoCm, codigo: x.codigo, nudo: x.nudo, direccion: x.direccion, cuelloExtraCm: x.cuelloExtraCm }));
      return conCaja({ globos, tubos: [], flores: [], anclas: trenza.anclas.map((a) => ({ posicion: a.posicion, normal: a.normal })), materiales: materialesPorFormato(globos) });
    }
    case "escenografia":
      return conCaja({ globos: [], tubos: [], flores: [], anclas: [], materiales: [], solidos: armarEscenografia(pieza.elementos) });
    case "globo": {
      const formato = formatoPorId(pieza.formatoId);
      if (!formato) throw new Error(`Formato desconocido: ${pieza.formatoId}`);
      const globo: GloboDePieza = { formatoId: formato.id, infladoCm: pieza.infladoCm, codigo: pieza.codigo, nudo: { x: 0, y: -centroCuerpo("redondo", pieza.infladoCm), z: 0 }, direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0, parte: "globo" };
      return conCaja({ globos: [globo], tubos: [], flores: [], anclas: [], materiales: materialesPorFormato([globo]) });
    }
    case "modulo": {
      const formato = formatoPorId(pieza.formatoId);
      const datos = moduloPorId(pieza.modulo);
      if (!formato || !datos) throw new Error(`Módulo desconocido: ${pieza.modulo} de ${pieza.formatoId}`);
      const armado = armarModulo(datos, formato, pieza.infladoCm);
      const sueltos: GloboDePieza[] = armado.globos.map((g) => ({ formatoId: formato.id, infladoCm: pieza.infladoCm, codigo: pieza.colores[g.indice] ?? pieza.colores[0] ?? "005", nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.parte ? { parte: g.parte } : {}) }));
      // Apoyado en el piso (y = 0), como lo mostraba la pestaña Módulos.
      const dy = -cajaDe(sueltos, []).min.y;
      const subir = (p: Vec3): Vec3 => ({ x: p.x, y: p.y + dy, z: p.z });
      const globos = sueltos.map((g) => ({ ...g, nudo: subir(g.nudo) }));
      return conCaja({ globos, tubos: [], flores: [], anclas: armado.anclas.map((a) => ({ posicion: subir(a.posicion), normal: a.normal })), materiales: materialesPorFormato(globos) });
    }
    case "forma": {
      const armada = armarForma(pieza.forma);
      return conCaja({ globos: armada.globos, tubos: armada.tubos, flores: [], anclas: armada.anclas, materiales: armada.materiales });
    }
    case "letras": {
      const armada = armarLetras(pieza.letras);
      return conCaja({ globos: armada.globos, tubos: armada.tubos, flores: [], anclas: armada.anclas, materiales: armada.materiales });
    }
    case "metalizado": {
      const m = armarMetalizado(pieza.metalizado);
      return conCaja({ globos: [], tubos: m.tubos, flores: [], anclas: [], materiales: [], solidos: armarEscenografia(m.elementos), ...(m.productos.length ? { productos: m.productos } : {}) });
    }
    case "mural": {
      const m = armarMural(pieza.mural);
      return conCaja({ globos: m.globos, tubos: m.tubos, flores: [], anclas: m.anclas, materiales: m.materiales });
    }
    case "techo": {
      const t = armarTecho(pieza.techo);
      return conCaja({ globos: t.globos, tubos: t.tubos, flores: [], anclas: t.anclas, materiales: t.materiales, ...(t.escenografia.length ? { solidos: armarEscenografia(t.escenografia) } : {}) });
    }
    case "arbol_globos": {
      const a = armarArbolGlobos(pieza.arbol);
      return conCaja({ globos: a.globos, tubos: a.tubos, flores: [], anclas: a.anclas, materiales: a.materiales });
    }
    case "decoracion": {
      const armada = armarDecoracion(pieza.decoracion);
      if (!pieza.deFrente) return conCaja({ globos: armada.globos, tubos: armada.tubos, flores: [], anclas: [], materiales: armada.materiales });
      // De frente: un giro (sin espejo) que lleva su cara (+y) al frente (+z) y su arriba (+z) arriba (+y).
      const deFrente = (v: Vec3): Vec3 => ({ x: -v.x, y: v.z, z: v.y });
      return conCaja({
        globos: armada.globos.map((g) => ({ ...g, nudo: deFrente(g.nudo), direccion: deFrente(g.direccion), ...(g.frente ? { frente: deFrente(g.frente) } : {}) })),
        tubos: armada.tubos.map((t) => ({ ...t, puntos: t.puntos.map(deFrente) })),
        flores: [], anclas: [], materiales: armada.materiales,
      });
    }
  }
}
