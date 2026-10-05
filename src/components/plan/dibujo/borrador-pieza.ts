import { DENSIDADES, type Densidad } from "@/lib/plan/tipos";
import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { formasDeOficial } from "@/lib/plan/formas-pieza";
import type { PiezaDibujoEstructura } from "./vista-dibujo-estructura";

/**
 * El borrador del editor de una pieza **sin motor** (la pared, el aro, el techo y el centro de mesa): qué mandos
 * tiene cada una, qué cambió respecto del plan y qué dibujo se pide mientras se edita. Puro, sin React.
 *
 * Los mandos son los campos que la fórmula de `plan.py` lee para contar la pieza (`_formula_count`): la densidad y
 * las medidas del eje o del área que le tocan a esa pieza (la pared es ancho × alto; el aro, su diámetro —el
 * menor de ancho y alto—; el techo, su largo; el centro de mesa, la mayor de sus medidas), y la forma elegida, que
 * solo cambia el dibujo. Aquí no se cuenta nada: lo que cuesta y lleva la pieza lo recalcula la propuesta al
 * guardar (`accion: "propiedades"`).
 */

export type MedidasPieza = { ancho_m?: number; alto_m?: number; largo_m?: number };
export type ClaveMedida = keyof MedidasPieza;

/** Lo que el editor guarda: solo lo que cambió (`forma: null` quita la forma elegida). */
export type CambiosPieza = { forma?: string | null; densidad?: Densidad; medidas?: MedidasPieza };

export type BorradorPieza = { forma: string | null; densidad: Densidad; medidas: MedidasPieza };

/** Un mando de medida: qué campos del plan escribe (el diámetro de un aro escribe ancho y alto a la vez). */
export type CampoMedida = { etiqueta: string; ayuda: string; claves: readonly ClaveMedida[]; testid: string; min: number; max: number; paso: number };

const ANCHO: CampoMedida = { etiqueta: "Ancho", ayuda: "De lado a lado.", claves: ["ancho_m"], testid: "medida-ancho", min: 0.5, max: 12, paso: 0.1 };
const ALTO: CampoMedida = { etiqueta: "Alto", ayuda: "Del piso hasta arriba.", claves: ["alto_m"], testid: "medida-alto", min: 0.5, max: 6, paso: 0.1 };

/**
 * Las medidas que cuenta cada pieza, en el orden en que se leen. Son las mismas que usa `_eje`/`_total_globos` de
 * `plan.py` para esa pieza: un campo que la fórmula no lee no se ofrece, porque cambiarlo solo movería el
 * `plan_hash` con el mismo total.
 */
export function camposMedidaDe(oficial: string | undefined, tipo: string): readonly CampoMedida[] {
  if (oficial === "aro_circular") {
    return [{ etiqueta: "Diámetro", ayuda: "De borde a borde del aro. Los globos van por toda la vuelta.", claves: ["ancho_m", "alto_m"], testid: "medida-diametro", min: 0.5, max: 4, paso: 0.1 }];
  }
  if (oficial === "techo_globos" || tipo === "guirnalda") {
    return [{ etiqueta: "Largo", ayuda: "Lo que recorre la instalación por el techo.", claves: ["largo_m"], testid: "medida-largo", min: 1, max: 30, paso: 0.5 }];
  }
  if (tipo === "centro_mesa") {
    return [
      { ...ANCHO, etiqueta: "Diámetro", ayuda: "Lo que ocupa sobre la mesa.", testid: "medida-diametro", min: 0.2, max: 2, paso: 0.05 },
      { ...ALTO, ayuda: "Desde la mesa hasta arriba.", min: 0.2, max: 2.5, paso: 0.05 },
    ];
  }
  if (tipo === "pared") return [ANCHO, ALTO];
  return [];
}

/** Las densidades que admite la estructura oficial (una pared densa es media o lujosa); las tres si no fija ninguna. */
export function densidadesDe(oficial: string | undefined): readonly Densidad[] {
  const fijadas = oficial ? ESTRUCTURAS_OFICIALES[oficial as EstructuraOficialId]?.densidades : undefined;
  return fijadas && fijadas.length > 0 ? fijadas : DENSIDADES;
}

export const ETIQUETA_DENSIDAD: Readonly<Record<Densidad, { nombre: string; ayuda: string }>> = {
  sencilla: { nombre: "Sencilla", ayuda: "Más aireada: menos globos y se ve el fondo." },
  media: { nombre: "Media", ayuda: "La de siempre." },
  lujosa: { nombre: "Lujosa", ayuda: "Más llena: más globos, sin huecos." },
};

/** El valor de un mando de medida: el primer campo que traiga (el largo de un techo cae al ancho, como en `_eje`). */
export function valorMedida(medidas: MedidasPieza, campo: CampoMedida): number | undefined {
  for (const clave of campo.claves) {
    if (typeof medidas[clave] === "number") return medidas[clave];
  }
  return campo.claves.includes("largo_m") ? medidas.ancho_m : undefined;
}

/** Escribe un mando de medida en todos sus campos. */
export function conMedida(borrador: BorradorPieza, campo: CampoMedida, valor: number): BorradorPieza {
  const medidas = { ...borrador.medidas };
  for (const clave of campo.claves) medidas[clave] = valor;
  return { ...borrador, medidas };
}

export function borradorDe(declarada: { forma?: string; densidad?: string; medidas?: MedidasPieza }): BorradorPieza {
  const densidad = (DENSIDADES as readonly string[]).includes(declarada.densidad ?? "") ? (declarada.densidad as Densidad) : "media";
  return { forma: declarada.forma ?? null, densidad, medidas: { ...(declarada.medidas ?? {}) } };
}

/** Una medida nueva es válida dentro del rango de su mando (el contrato admite hasta 100 m; una pieza real, mucho menos). */
export function medidaValida(valor: number | undefined, campo: CampoMedida): boolean {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= campo.min && valor <= campo.max;
}

/** Solo lo que cambió respecto del plan; `null` si nada cambió o si una medida no es válida. */
export function cambiosDe(enPlan: BorradorPieza, borrador: BorradorPieza, campos: readonly CampoMedida[]): CambiosPieza | null {
  const cambios: CambiosPieza = {};
  if (borrador.forma !== enPlan.forma) cambios.forma = borrador.forma;
  if (borrador.densidad !== enPlan.densidad) cambios.densidad = borrador.densidad;
  const medidas: MedidasPieza = {};
  for (const campo of campos) {
    const valor = valorMedida(borrador.medidas, campo);
    if (valor === valorMedida(enPlan.medidas, campo)) continue;
    if (!medidaValida(valor, campo)) return null;
    for (const clave of campo.claves) medidas[clave] = valor;
  }
  if (Object.keys(medidas).length > 0) cambios.medidas = medidas;
  return Object.keys(cambios).length > 0 ? cambios : null;
}

/** Las formas que la pieza ofrece (vacío si su oficial no tiene lámina). */
export function formasDe(oficial: string | undefined) {
  return formasDeOficial(oficial);
}

/**
 * La pieza que se dibuja mientras se edita: la del plan con la forma del borrador. Solo la forma cambia el dibujo
 * (es esquemático: su medida es la típica de la estructura y no cuenta globos), así que la densidad y las medidas
 * no se mandan aquí. El dibujo es derivado y no entra en `plan_hash`.
 */
export function piezaConBorrador(pieza: PiezaDibujoEstructura, forma: string | null): PiezaDibujoEstructura {
  if ((pieza.declarada.forma ?? null) === forma) return pieza;
  const { forma: _anterior, ...sinForma } = pieza.declarada;
  void _anterior;
  const declarada = forma === null ? sinForma : { ...sinForma, forma };
  const estructuras = pieza.plan.estructuras.map((estructura) => {
    if (estructura.estructura_id !== pieza.estructuraId) return estructura;
    const { forma: _vieja, ...resto } = estructura;
    void _vieja;
    return (forma === null ? resto : { ...resto, forma }) as typeof estructura;
  });
  return { ...pieza, declarada, plan: { ...pieza.plan, estructuras } as typeof pieza.plan };
}
