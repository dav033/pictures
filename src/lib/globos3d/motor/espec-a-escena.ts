import { ErrorHerramienta, resolverColorFlexible } from "../herramientas-escena-colores";
import type { Escena, NodoEscena } from "../escena";
import { armarPieza, type Pieza, type PiezaArmada } from "../piezas";
import type { EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";
import { florDeGlobos, lineasDeFlores } from "./flores-espec";
import type { BomLinea } from "./resultado-motor-v1";
import {
  construirArcoAsimetrico, construirArcoOrganico, construirAro, construirColumnaOrganica, construirGuirnaldaOrganica, construirSemiarco, conDensidad,
  type Construida, type EntradaOrganica,
} from "./constructores-organicos";
import { construirArco, construirColumna, construirGuirnalda, construirPared, construirRacimoPared, construirRamo, construirTecho } from "./constructores-clasicos";
import { anchoEstimadoCm, distribuir, type ItemDeLayout } from "./layout";
import { SEPARADOR_FLORES } from "./ids-nodos";
import { DENSIDAD_POR_DEFECTO, medidasDe } from "./medidas-espec";
import { representacionDe } from "./representable";

/**
 * **Espec → escena.** PRIVADO del motor: solo `v1.ts` lo importa (lo vigila una prueba). Cada pieza oficial se arma con
 * su constructor (la tabla de `construir`); `layout.ts` la pone en la sala; las flores de globo cuelgan de los anclajes
 * de la pieza. Lo que ningún constructor arma, o que pasa de los topes, no entra: queda en `noRepresentables` con su
 * motivo para que quien llama decida (volver al motor de Python), nunca se omite en silencio.
 */
export const TOPE_GLOBOS_PIEZA = 700;
export const TOPE_GLOBOS_PLAN = 1500;

export type NoRepresentable = { piezaId: string; motivo: string };

export type EscenaDeEspec = {
  escena: Escena;
  /** Las piezas ya armadas por su JSON: `armarEscena` no las rehace. */
  cache: Map<string, PiezaArmada>;
  declaradas: PiezaEspec[];
  /** Las flores de globo de cada pieza, contadas de la espec (lleven o no dónde colgarse en el dibujo). */
  lineasDeFlores: Record<string, BomLinea[]>;
  noRepresentables: NoRepresentable[];
  avisos: string[];
};

const CONSTRUCTORES_ORGANICOS: Partial<Record<PiezaEspec["oficial"], (e: EntradaOrganica) => Construida>> = {
  semiarco: construirSemiarco, semiarco_asimetrico: construirSemiarco, arco_asimetrico: construirArcoAsimetrico,
  columna_asimetrica: construirColumnaOrganica, aro_circular: construirAro,
};

const CONSTRUCTORES_CLASICOS: Partial<Record<PiezaEspec["oficial"], (e: EntradaOrganica) => Construida>> = {
  pared_densa: construirPared, techo_globos: construirTecho, bouquet: construirRamo, racimo_pared: construirRacimoPared,
};

const ALTURA_GUIRNALDA_CM = 200;
const ALTURA_RACIMO_PARED_CM = 120;

/** Cuál de los dos constructores (de cuartetos u orgánico) arma una pieza que admite los dos, según su proporción de tamaños. */
function constructorDe(pieza: PiezaEspec): (e: EntradaOrganica) => Construida {
  const organica = pieza.tamanos !== "clasica";
  switch (pieza.oficial) {
    case "arco": return organica ? construirArcoOrganico : construirArco;
    case "arco_no_denso": return construirArcoOrganico;
    case "columna": return organica ? construirColumnaOrganica : construirColumna;
    case "columna_no_densa": return construirColumnaOrganica;
    case "guirnalda": return organica ? construirGuirnaldaOrganica : construirGuirnalda;
    default: {
      const constructor = CONSTRUCTORES_ORGANICOS[pieza.oficial] ?? CONSTRUCTORES_CLASICOS[pieza.oficial];
      if (!constructor) throw new ErrorHerramienta(`No hay constructor para ${pieza.oficial}.`);
      return constructor;
    }
  }
}

function construirPieza(pieza: PiezaEspec, avisos: string[]): Construida {
  const entrada: EntradaOrganica = { espec: pieza, medidas: medidasDe(pieza), avisos, notas: avisos };
  const construida = constructorDe(pieza)(entrada);
  if (construida.pieza.tipo !== "organico" && pieza.densidad === "sencilla") avisos.push(`La densidad ligera de «${pieza.nombre}» no cambia este armado de cuartetos: solo afecta a las piezas orgánicas.`);
  const densa = conDensidad(construida.pieza, pieza.densidad ?? DENSIDAD_POR_DEFECTO[pieza.oficial] ?? "media");
  return { ...construida, pieza: conRemate(conHuecosParaFlores(densa, pieza.flores?.cantidad ?? 0), pieza, avisos) };
}

/** El globo de arriba: solo las columnas lo llevan, de cuartetos o de racimos. */
function conRemate(pieza: Pieza, espec: PiezaEspec, avisos: string[]): Pieza {
  if (!espec.remate) return pieza;
  if (!espec.oficial.startsWith("columna")) {
    avisos.push(`El remate de «${espec.nombre}» no se arma: solo las columnas llevan un globo arriba.`);
    return pieza;
  }
  return { ...pieza, remate: { formatoId: espec.remate.formatoId, codigo: resolverColorFlexible(espec.remate.codigo, [espec.remate.formatoId], avisos) } };
}

/** Una pieza orgánica solo tiene dónde colgar flores en los huecos que se le reservan al armarla. */
function conHuecosParaFlores(pieza: Pieza, cantidad: number): Pieza {
  if (pieza.tipo !== "organico" || cantidad <= 0) return pieza;
  return { ...pieza, opciones: { ...pieza.opciones, huecosFlores: Math.max(pieza.opciones.huecosFlores, cantidad) } };
}

/** Los anclajes donde se cuelgan las flores: los que miran a quien ve la escena, repartidos parejo por la pieza. */
function anclasParaFlores(armada: PiezaArmada, cantidad: number): number[] {
  const delFrente = armada.anclas.map((ancla, indice) => ({ ancla, indice })).filter(({ ancla }) => ancla.normal.z > 0.3);
  const candidatas = delFrente.length ? delFrente : armada.anclas.map((ancla, indice) => ({ ancla, indice }));
  const cuantas = Math.min(cantidad, candidatas.length);
  return Array.from({ length: cuantas }, (_, k) => candidatas[Math.floor(((k + 0.5) * candidatas.length) / cuantas)]!.indice);
}

function nodosDeFlores(pieza: PiezaEspec, flor: Pieza | null, armada: PiezaArmada, avisos: string[]): NodoEscena[] {
  const flores = pieza.flores;
  if (!flores || !flor) return [];
  const anclas = anclasParaFlores(armada, flores.cantidad);
  if (!anclas.length) {
    avisos.push(`Las flores de «${pieza.nombre}» no se dibujan: esa pieza no tiene dónde colgarlas, pero se cuentan en la lista.`);
    return [];
  }
  if (anclas.length < flores.cantidad) avisos.push(`En «${pieza.nombre}» solo caben ${anclas.length} de las ${flores.cantidad} flores en el dibujo.`);
  return anclas.map((ancla, k): NodoEscena => ({
    id: `${pieza.id}${SEPARADOR_FLORES}${k + 1}`, nombre: "Flor de globos", pieza: flor, colocacion: { en: "ancla", padreId: pieza.id, ancla, cada: 0, giroGrados: 0 },
  }));
}

function alturaPared(pieza: PiezaEspec): number {
  if (pieza.oficial === "guirnalda") return ALTURA_GUIRNALDA_CM;
  return pieza.oficial === "racimo_pared" ? ALTURA_RACIMO_PARED_CM : 0;
}

type Preparada = { construida: Construida; armada: PiezaArmada; flor: Pieza | null; lineas: BomLinea[] };

function prepararPieza(pieza: PiezaEspec, avisos: string[]): Preparada {
  const construida = construirPieza(pieza, avisos);
  const flor = pieza.flores ? florDeGlobos(pieza.flores, avisos) : null;
  return { construida, armada: armarPieza(construida.pieza), flor, lineas: pieza.flores ? lineasDeFlores(pieza.flores, avisos) : [] };
}

/** Las piezas de cuartetos que tienen su gemela orgánica, que reparte cualquier número de colores por peso. */
const ORGANICA_DE_RESPALDO: ReadonlySet<PiezaEspec["oficial"]> = new Set<PiezaEspec["oficial"]>(["arco", "columna", "guirnalda"]);

/** Los colores del cliente que no aparecen en los materiales de la pieza armada. */
const faltantes = (pieza: PiezaEspec, armada: PiezaArmada): PiezaEspec["colores"] => pieza.colores.filter((c) => !armada.materiales.some((m) => m.codigo === c.codigo));

type Armada = { espec: PiezaEspec; construida: Construida; armada: PiezaArmada; flor: Pieza | null };

export function escenaDesdeEspec(espec: EspecClienteV1): EscenaDeEspec {
  const avisos: string[] = [];
  const noRepresentables: NoRepresentable[] = [];
  const declaradas: PiezaEspec[] = [];
  const cache = new Map<string, PiezaArmada>();
  const lineasFlores: Record<string, BomLinea[]> = {};
  const listas: Armada[] = [];
  let globosDelPlan = 0;
  for (const pieza of espec.piezas) {
    const representacion = representacionDe(pieza);
    if (representacion.estado === "fallback") { noRepresentables.push({ piezaId: pieza.id, motivo: representacion.motivo ?? "No se puede representar." }); continue; }
    if (representacion.estado === "declarada") { declaradas.push(pieza); avisos.push(`«${pieza.nombre}» se cuenta de la lista del catálogo y no se dibuja.`); continue; }
    if (representacion.estado === "aproximada" && representacion.motivo) avisos.push(`«${pieza.nombre}»: ${representacion.motivo}`);
    let preparada: Preparada;
    const avisosPieza: string[] = [];
    try {
      preparada = prepararPieza(pieza, avisosPieza);
      // Una trenza clásica reparte los colores en bandas de dos cuartetos: con más colores que bandas los últimos no llegan a
      // la lista de materiales. Ningún color del cliente se pierde en silencio: se arma orgánica (que sí los reparte todos).
      if (faltantes(pieza, preparada.armada).length && ORGANICA_DE_RESPALDO.has(pieza.oficial) && pieza.tamanos === "clasica") {
        const respaldo: string[] = [];
        const organica = prepararPieza({ ...pieza, tamanos: "organica_fina" }, respaldo);
        if (!faltantes(pieza, organica.armada).length) {
          preparada = organica;
          avisosPieza.length = 0;
          avisosPieza.push(...respaldo, `«${pieza.nombre}»: la trenza clásica no alcanza para sus ${pieza.colores.length} colores en ese tamaño; se armó orgánica, con globos de varios tamaños, para que lleve todos.`);
        }
      }
    } catch (error) {
      if (!(error instanceof ErrorHerramienta)) throw error;
      noRepresentables.push({ piezaId: pieza.id, motivo: error.message });
      continue;
    }
    const sinColor = faltantes(pieza, preparada.armada);
    if (sinColor.length) { noRepresentables.push({ piezaId: pieza.id, motivo: `${sinColor.length === 1 ? "El color" : "Los colores"} ${sinColor.map((c) => `${c.nombre} (${c.codigo})`).join(", ")} no llegan a la lista de materiales de «${pieza.nombre}»: el armado no los reparte.` }); continue; }
    avisos.push(...avisosPieza);
    const { construida, armada, flor, lineas } = preparada;
    if (armada.globos.length > TOPE_GLOBOS_PIEZA) { noRepresentables.push({ piezaId: pieza.id, motivo: `Lleva ${armada.globos.length} globos y el tope por pieza es ${TOPE_GLOBOS_PIEZA}.` }); continue; }
    if (globosDelPlan + armada.globos.length > TOPE_GLOBOS_PLAN) { noRepresentables.push({ piezaId: pieza.id, motivo: `Con esta pieza el plan pasa de ${TOPE_GLOBOS_PLAN} globos.` }); continue; }
    globosDelPlan += armada.globos.length;
    cache.set(JSON.stringify(construida.pieza), armada);
    if (lineas.length) lineasFlores[pieza.id] = lineas;
    listas.push({ espec: pieza, construida, armada, flor });
  }
  const items: ItemDeLayout[] = listas.map(({ espec: pieza, construida }) => ({ id: pieza.id, lugar: pieza.lugar, apoyo: construida.apoyo, anchoCm: anchoEstimadoCm(pieza), alturaPared: alturaPared(pieza) }));
  const { sala, colocaciones } = distribuir(items);
  const nodos = listas.flatMap(({ espec: pieza, construida, armada, flor }): NodoEscena[] => [
    { id: pieza.id, nombre: pieza.nombre, pieza: construida.pieza, colocacion: colocaciones.get(pieza.id)! },
    ...nodosDeFlores(pieza, flor, armada, avisos),
  ]);
  return { escena: { sala, nodos }, cache, declaradas, lineasDeFlores: lineasFlores, noRepresentables, avisos };
}
