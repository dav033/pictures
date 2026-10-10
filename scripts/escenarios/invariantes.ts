import type { PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { avisoAproximada, avisoDeclarada, avisoTrenzaOrganica, representacionDe } from "../../src/lib/globos3d/motor/representable";
import { solapeTolerado } from "../../src/lib/globos3d/motor/solapes-tolerados";
import { bandaDePieza, celdaDeBanda } from "./bandas";
import type { Observacion } from "./ejecutar";

/**
 * **Los invariantes de la matriz**: cada uno devuelve clases de fallo (texto corto y estable: se agrupan por él) o ninguna.
 * Un escenario pasa si no tiene clases en ningún invariante. Las clases llevan la estructura y la densidad para que el
 * informe diga QUÉ falla, no solo que algo falla.
 */

export const INVARIANTES = ["no_lanza", "banda_conteo", "sin_solapes", "dentro_sala", "determinismo", "tiempo", "avisos_honestos"] as const;
export type Invariante = (typeof INVARIANTES)[number];

/**
 * Presupuesto de construcción de la fachada, en ms. Se fija con la medición del lote de 2 000 escenarios: el p95 de la fachada
 * anda entre 280 y 360 ms y el máximo de un escenario llega a 900 ms con la máquina cargada. Es un informe del CLI, no una
 * prueba: el tiempo varía con la carga y no decide si la prueba rápida pasa.
 */
export const PRESUPUESTO_MS = 1500;

/** Margen de solape (cm): dos cajas que se tocan por menos de esto no son un choque (redondeo de los tubos). */
export const TOLERANCIA_SOLAPE_CM = 2;
/** Margen de sala (cm): una caja que sobresale menos de esto no cuenta como fuera de la sala. */
export const TOLERANCIA_SALA_CM = 2;

export type Chequeo = { invariante: Invariante; clases: string[] };

type Box = readonly [number, number, number, number, number, number];

export type OpcionesEvaluar = {
  /** El tiempo de la fachada se mide solo en el CLI: en la prueba rápida depende de la carga de la máquina. */
  conTiempo: boolean;
};

const cajaSolapa = (a: Box, b: Box): boolean =>
  ([0, 1, 2] as const).every((k) => Math.min(a[k + 3]!, b[k + 3]!) - Math.max(a[k]!, b[k]!) > TOLERANCIA_SOLAPE_CM);

function chequearNoLanza(o: Observacion): string[] {
  if (o.rechazoEsquema) {
    // Los escenarios se generan dentro del esquema: cualquier rechazo es un fallo del generador o del esquema, no se descuenta.
    const primera = o.rechazoEsquema.split(" | ")[0] ?? "";
    return [`no_lanza:esquema_rechaza:${primera.slice(0, 80)}`];
  }
  return o.errorFachada ? [`no_lanza:fachada:${o.errorFachada.slice(0, 90)}`] : [];
}

/** Una pieza se cuenta por su banda solo si la construcción es la que mide PARIDAD: sin flores, sin remate ni unidades. */
function sinConteoComparable(p: PiezaEspec): boolean {
  return Boolean(p.flores || p.remate || p.unidades || p.declarada) || representacionDe(p).estado === "fallback";
}

/** Las bandas usan la proporción que construyó el motor: una trenza clásica que no alcanza para sus colores se arma orgánica (con aviso). */
function bandaEfectiva(p: PiezaEspec, avisos: readonly string[]): PiezaEspec {
  const aviso = avisos.includes(avisoTrenzaOrganica(p.nombre, p.colores.length));
  return aviso ? { ...p, tamanos: "organica_fina" } : p;
}

/** Las piezas comparables con una banda: la celda (estructura y densidad) y el conteo que se mide contra ella. */
export function piezasConBanda(o: Observacion): Array<{ celda: string; oficial: string; globos: number; banda: ReturnType<typeof bandaDePieza> & { tipo: "banda" } }> {
  if (!o.geometria) return [];
  const salida = [];
  for (const pieza of o.piezas) {
    if (sinConteoComparable(pieza)) continue;
    const banda = bandaDePieza(bandaEfectiva(pieza, o.avisos));
    const globos = o.geometria.globos.get(pieza.id);
    if (banda.tipo !== "banda" || globos === undefined) continue;
    salida.push({ celda: celdaDeBanda(pieza, banda), oficial: pieza.oficial, globos, banda });
  }
  return salida;
}

function chequearBandas(o: Observacion): string[] {
  return piezasConBanda(o).flatMap(({ celda, globos, banda }) => {
    if (globos >= banda.minGlobos && globos <= banda.maxGlobos) return [];
    return [`banda_conteo:${celda}:${globos > banda.maxGlobos ? "sobre" : "bajo"}`];
  });
}

function chequearSolapes(o: Observacion): string[] {
  if (!o.geometria) return [];
  const piezas = [...o.geometria.cajas.entries()].map(([id, caja]) => ({ oficial: oficialDe(o.piezas, id), caja }));
  const clases = new Set<string>();
  for (let i = 0; i < piezas.length; i++) {
    for (let j = i + 1; j < piezas.length; j++) {
      const a = piezas[i]!, b = piezas[j]!;
      if (!cajaSolapa(a.caja, b.caja)) continue;
      if (solapeTolerado(a.oficial, b.oficial)) continue;
      clases.add(`sin_solapes:${[a.oficial, b.oficial].sort().join("+")}`);
    }
  }
  return [...clases];
}

function chequearSala(o: Observacion): string[] {
  if (!o.geometria) return [];
  const { anchoCm, fondoCm, altoCm } = o.geometria.sala;
  const clases = new Set<string>();
  for (const [id, caja] of o.geometria.cajas) {
    const oficial = oficialDe(o.piezas, id);
    const [minX, minY, minZ, maxX, maxY] = caja;
    if (minX < -anchoCm / 2 - TOLERANCIA_SALA_CM || maxX > anchoCm / 2 + TOLERANCIA_SALA_CM) clases.add(`dentro_sala:x:${oficial}`);
    if (minY < -TOLERANCIA_SALA_CM || maxY > altoCm + TOLERANCIA_SALA_CM) clases.add(`dentro_sala:y:${oficial}`);
    if (minZ < -fondoCm - TOLERANCIA_SALA_CM) clases.add(`dentro_sala:z:${oficial}`);
  }
  return [...clases];
}

function chequearDeterminismo(o: Observacion): string[] {
  if (!o.huellas) return [];
  return o.huellas[0] === o.huellas[1] ? [] : ["determinismo:distinta_serializacion"];
}

function chequearTiempo(o: Observacion): string[] {
  return o.resultado && o.tiempoMs > PRESUPUESTO_MS ? [`tiempo:excede_${PRESUPUESTO_MS}ms`] : [];
}

/** Lo pedido queda contado: dibujado, declarado o en la lista de lo que no se representa, y cada aproximación se dice. */
function chequearAvisos(o: Observacion): string[] {
  if (!o.resultado || !o.geometria) return [];
  const clases: string[] = [];
  for (const pieza of o.piezas) {
    const estado = representacionDe(pieza).estado;
    const noRep = o.noRepresentables.some((n) => n.piezaId === pieza.id);
    const dibujada = o.geometria.cajas.has(pieza.id);
    // El texto del aviso debe ser exacto (el de la pieza, con su motivo): un aviso de otra pieza con el mismo nombre no cuenta.
    const motivo = representacionDe(pieza).motivo ?? "";
    if (estado === "declarada" && !o.avisos.includes(avisoDeclarada(pieza.nombre))) clases.push(`avisos:declarada_sin_aviso:${pieza.oficial}`);
    else if (estado === "fallback" && !noRep) clases.push(`avisos:fallback_silencioso:${pieza.oficial}`);
    else if (estado === "aproximada" && !o.avisos.includes(avisoAproximada(pieza.nombre, motivo))) clases.push(`avisos:aproximada_sin_aviso:${pieza.oficial}`);
    else if (estado === "representable" && !dibujada && !noRep) clases.push(`avisos:pieza_perdida:${pieza.oficial}`);
  }
  return clases;
}

const oficialDe = (piezas: readonly PiezaEspec[], id: string): string => piezas.find((p) => p.id === id)?.oficial ?? "mobiliario";

/** Corre los invariantes sobre una observación. Un escenario rechazado por el esquema solo tiene el invariante de no lanzar. */
export function evaluar(o: Observacion, opciones: OpcionesEvaluar = { conTiempo: true }): Chequeo[] {
  if (o.rechazoEsquema) return [{ invariante: "no_lanza", clases: chequearNoLanza(o) }];
  return [
    { invariante: "no_lanza", clases: chequearNoLanza(o) },
    { invariante: "banda_conteo", clases: chequearBandas(o) },
    { invariante: "sin_solapes", clases: chequearSolapes(o) },
    { invariante: "dentro_sala", clases: chequearSala(o) },
    { invariante: "determinismo", clases: chequearDeterminismo(o) },
    { invariante: "tiempo", clases: opciones.conTiempo ? chequearTiempo(o) : [] },
    { invariante: "avisos_honestos", clases: chequearAvisos(o) },
  ];
}
