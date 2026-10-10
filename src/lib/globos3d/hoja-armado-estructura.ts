import { filasBomba, inflablesDeEscena, type CalibracionBomba } from "./bomba-segundos";
import type { NodoArmado } from "./escena";
import { floresDeUnidad, rellenoDe } from "./hoja-armado-anexos";
import { aparteDe, agruparPorNivel, claveDeGlobo, colorear, globoHoja, sinParte, sumaSinRedondear, type GloboHoja } from "./hoja-armado-comun";
import { capasDeAnillos, type CapaHoja } from "./hoja-armado-capas";
import { tubosDeUnidad } from "./hoja-armado-compacta";
import { centrosDeUnidad, globosPorUnidad, type CentroLocal } from "./hoja-armado-local";
import { sentidoDePared, tramosDeGlobos, tramosPorCapa, type TramoHoja } from "./hoja-armado-tramos";
import { cuartetosDeNiveles, sentidoDelRecorrido, type CuartetoHoja } from "./hoja-armado-trenza";
import type { EstructuraHoja, ModoHoja } from "./hoja-armado-tipos";
import { moduloPorId, type TipoModulo } from "./modulos";
import type { Pieza } from "./piezas";
import { PARTE_REMATE } from "./remate";
import { PATRONES_TRENZA } from "./trenza";

/** De una pieza armada (una copia), todo lo que lleva la hoja: sus capas, tramos o cuartetos, lo que va aparte y sus cuentas. */

const ETIQUETA_MODULO: Readonly<Record<TipoModulo, string>> = {
  pareja: "Dúo",
  trio: "Trío",
  cuarteto: "Cuarteto",
  quinteto: "Quinteto",
  sexteto: "Sexteto",
};

const NOTA_ALTURAS = "Tabla por franja de altura (medida sobre el punto más bajo de la pieza): sirve para contar y preparar los globos de cada franja. No sirve para armar por capas.";
const NOTA_CAPAS = "Las capas de esta pieza no son del tamaño de un módulo, así que no se dibujan: cada tramo es una capa, de la base a la punta.";
const NOTA_CONO = "Cada tramo es un anillo del cono, de la base a la punta; los globos de remate y acento van aparte.";

type Reparto = Pick<EstructuraHoja, "modo" | "capas" | "tramos" | "cuartetos"> & { aparte: CentroLocal[]; nota?: string; sentido?: string };

const sinDatos = () => ({ capas: [] as CapaHoja[], tramos: [] as TramoHoja[], cuartetos: [] as CuartetoHoja[] });

/** Cómo se reparten los globos de una copia según la pieza: anillos, capas, trenza, paredes o franjas de altura. */
function repartoDe(pieza: Pieza | undefined, centros: readonly CentroLocal[], calibracion: CalibracionBomba): Reparto {
  const tipo = pieza?.tipo;
  if (pieza?.tipo === "modulo") {
    const { dentro, fuera } = sinParte(centros, PARTE_REMATE);
    const capas = capasDeAnillos([dentro], moduloPorId(pieza.modulo)?.globos ?? 0, calibracion);
    if (capas) return { ...sinDatos(), modo: "anillos", capas, aparte: fuera };
  }
  if (tipo === "columna") {
    const { niveles, aparte } = agruparPorNivel(centros);
    const capas = capasDeAnillos(niveles, moduloPorId("cuarteto")?.globos ?? 4, calibracion);
    if (capas) return { ...sinDatos(), modo: "anillos", capas, aparte };
    if (niveles.length) return { ...sinDatos(), modo: "capas", tramos: tramosPorCapa(niveles, calibracion), aparte, nota: NOTA_CAPAS };
  }
  if (tipo === "arco" || tipo === "guirnalda") {
    const { niveles, aparte } = agruparPorNivel(centros);
    if (niveles.length) {
      const patas = tipo === "arco" ? " El recorrido es continuo: sube por una pata, pasa por arriba y baja por la otra; las patas no se arman a la vez." : "";
      return { ...sinDatos(), modo: "trenza", cuartetos: cuartetosDeNiveles(niveles, calibracion), aparte, sentido: `${sentidoDelRecorrido(niveles)}${patas}` };
    }
  }
  if (tipo === "pared_malla" || tipo === "pared_trenzas") {
    return { ...sinDatos(), modo: "paredes", tramos: tramosDeGlobos(centros, "paredes", calibracion), aparte: [], sentido: sentidoDePared(centros) };
  }
  if (tipo === "forma") {
    const { niveles, aparte } = agruparPorNivel(centros);
    if (niveles.length >= 2) return { ...sinDatos(), modo: "capas", tramos: tramosPorCapa(niveles, calibracion), aparte, nota: NOTA_CONO };
  }
  return { ...sinDatos(), modo: "alturas", tramos: tramosDeGlobos(centros, "alturas", calibracion), aparte: [], nota: NOTA_ALTURAS };
}

function patronDe(pieza: Pieza | undefined): EstructuraHoja["patron"] {
  const id = pieza?.tipo === "columna" || pieza?.tipo === "arco" ? pieza.patron : pieza?.tipo === "guirnalda" ? pieza.guirnalda.patron : undefined;
  const patron = PATRONES_TRENZA.find((p) => p.id === id);
  return patron ? { nombre: patron.nombre, descripcion: patron.descripcion } : undefined;
}

/** La estructura de la hoja de UNA pieza armada (`unidades` y `totalGlobos` son los de sus copias). */
export function estructuraDeNodo(nodo: NodoArmado, pieza: Pieza | undefined, calibracion: CalibracionBomba): EstructuraHoja {
  const centros = centrosDeUnidad(nodo);
  const reparto = repartoDe(pieza, centros, calibracion);
  const tubos = tubosDeUnidad(nodo);
  const globos = centros.map((c) => globoHoja(c));
  const materiales = tubos.map((l) => ({ formatoId: l.formatoId, cantidad: l.cantidad }));
  const filas = filasBomba(inflablesDeEscena({ globos: centros.map((c) => c.globo), materiales }), calibracion);
  const segundosPorUnidad = sumaSinRedondear(filas);
  const modo: ModoHoja = reparto.modo;
  const estructura: Omit<EstructuraHoja, "firma"> = {
    id: nodo.id,
    nombre: nodo.nombre,
    unidades: nodo.copias,
    modulo: pieza?.tipo === "modulo" ? { etiqueta: ETIQUETA_MODULO[pieza.modulo], globosPorGrupo: moduloPorId(pieza.modulo)?.globos ?? 0 } : undefined,
    patron: patronDe(pieza),
    modo,
    nota: reparto.nota,
    sentido: reparto.sentido,
    avisos: nodo.avisos,
    capas: reparto.capas,
    tramos: reparto.tramos,
    cuartetos: reparto.cuartetos,
    aparte: aparteDe(reparto.aparte),
    colores: colorear(globos),
    tubos,
    flores: floresDeUnidad(nodo),
    relleno: rellenoDe(pieza, nodo),
    globosPorUnidad: globosPorUnidad(nodo),
    totalGlobos: nodo.globos.length,
    filasBomba: filas,
    segundosPorUnidad,
    segundosBomba: segundosPorUnidad * nodo.copias,
  };
  return { ...estructura, firma: firmaDe(estructura, globos) };
}

/** La clave de un globo para la firma, con el tamaño al cm (lo que se imprime). */
const claveGlobo = (g: GloboHoja) => claveDeGlobo({ ...g, infladoCm: Math.round(g.infladoCm) });

/**
 * Lo que hace distinta a una estructura de otra en lo que se imprime: dos piezas con la misma firma salen una vez, con sus
 * copias. Todo va en el espacio de la pieza con las posiciones redondeadas, así que dos piezas iguales giradas o colgadas
 * distinto son la misma; una puesta en espejo no (ver `centrosDeUnidad`). Cuentan los globos (con su helio, su impreso y su
 * confeti), lo de aparte, los tubos, las flores, el relleno y cómo se reparten: capas, cuartetos o tramos, también las franjas
 * de altura (dos burbujas con los mismos globos y otro reparto por dentro se imprimen distinto).
 */
function firmaDe(e: Omit<EstructuraHoja, "firma">, globos: readonly GloboHoja[]): string {
  const contenido = [
    e.globosPorUnidad, globos.map(claveGlobo).sort(),
    e.aparte.map((a) => `${a.etiqueta}${a.formatoId}${a.codigo}${a.infladoCm}${a.cantidad}`), e.tubos.map((t) => `${t.formatoId}${t.codigo}${t.cantidad}`),
    e.flores.map((f) => `${f.tipo}${f.cantidad}`), e.relleno ?? "",
  ];
  const tramos = e.tramos.map((t) => [t.etiqueta, t.colores.map((c) => `${c.formatoId}${c.codigo}${c.cantidad}`).sort(), t.marcas]);
  const capas = e.capas.map((c) => [c.numero, c.hasta, c.giroGrados, c.sentidoNumeracion, c.alturaCm, c.globos.map(claveGlobo)]);
  const cuartetos = e.cuartetos.map((c) => [c.desde, c.hasta, c.globos.map(claveGlobo)]);
  return JSON.stringify([e.modo, e.sentido, e.nota, capas, tramos, cuartetos, contenido]);
}

/** Junta estructuras de la misma firma: las unidades y los totales se suman; lo demás es igual. */
export function unirEstructuras(estructuras: readonly EstructuraHoja[], nombre: string): EstructuraHoja {
  const [primera] = estructuras;
  if (!primera) throw new Error("No hay estructuras que unir.");
  return {
    ...primera,
    nombre,
    unidades: estructuras.reduce((s, e) => s + e.unidades, 0),
    totalGlobos: estructuras.reduce((s, e) => s + e.totalGlobos, 0),
    segundosBomba: estructuras.reduce((s, e) => s + e.segundosBomba, 0),
    avisos: [...new Set(estructuras.flatMap((e) => e.avisos))],
  };
}
