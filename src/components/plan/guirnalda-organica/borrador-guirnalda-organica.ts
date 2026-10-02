import {
  AdornosGuirnaldaSchema,
  FormaGuirnaldaOrganicaSchema,
  TamanosGuirnaldaSchema,
  VolumenGuirnaldaSchema,
  type AcabadoGuirnalda,
  type ArmadoGuirnaldaOrganicaV1,
  type RepartoGuirnalda,
  type RolGuirnalda,
} from "@/lib/plan/armado-guirnalda-organica";
import type { LimitesGuirnaldaOrganica } from "@/lib/plan/opciones-armado-guirnalda-organica";
import { jsonEstable } from "../bouquet/borrador-armado";

/**
 * El borrador del editor de guirnaldas del motor (ADR-0035, paso 3): el `armado_guirnalda_organica` que el
 * decorador va cambiando mientras el motor lo dibuja. Puro: sin React, para poder probarlo sin montar nada.
 *
 * **Aquí no se calcula nada.** Cada función devuelve el mismo armado con UN campo cambiado y marcado como del
 * decorador; lo que ese campo provoca (cuántos globos caben, qué tamaños quedan fuera de la banda, qué se compra)
 * lo decide el motor cuando se le pide el dibujo, y lo que corrige lo dice en español en sus avisos. Los rangos de
 * los mandos salen de `limites` (`limites_de`) y de `opciones` (`opciones_admitidas`), que el motor devuelve con
 * cada dibujo; lo único que el cliente sabe por sí mismo es la forma del contrato `armado-guirnalda-organica.v1`,
 * de donde se leen los rangos que el motor no publica.
 */

type Armado = ArmadoGuirnaldaOrganicaV1;

/** Un armado es el mismo aunque cambie quién lo firmó (`origen`): lo que cuenta es cómo se arma. */
export function mismoArmadoGuirnaldaOrganica(a: Armado, b: Armado): boolean {
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

/** Qué hace distinto a un dibujo de otro: el armado entero, sin importar el orden de sus claves. */
export function claveArmadoGuirnaldaOrganica(armado: Armado): string {
  return jsonEstable(armado);
}

/** Todo cambio del editor es una decisión del decorador, venga el armado de donde venga. */
function delDecorador(armado: Armado): Armado {
  return armado.origen === "decorador" ? armado : { ...armado, origen: "decorador" };
}

// --- La forma -----------------------------------------------------------------------------------------------

export type CampoForma = "largoM" | "alturaM" | "pendienteM" | "ondaM" | "ondas" | "colgadoM" | "festones" | "carga";

export function conForma(armado: Armado, campo: CampoForma, valor: number): Armado {
  const siguiente = FormaGuirnaldaOrganicaSchema.safeParse({ ...armado.forma, [campo]: valor });
  // Lo que el contrato no admite deja el borrador como estaba; el motor acota además lo que se salga de sus rangos.
  return siguiente.success ? delDecorador({ ...armado, forma: siguiente.data }) : armado;
}

// --- El volumen ---------------------------------------------------------------------------------------------

export type CampoVolumen = "grosorPatasM" | "grosorCimaM" | "irregularidad" | "relleno" | "racimo" | "salientes";

export function conVolumen(armado: Armado, campo: CampoVolumen, valor: number): Armado {
  const siguiente = VolumenGuirnaldaSchema.safeParse({ ...armado.volumen, [campo]: valor });
  return siguiente.success ? delDecorador({ ...armado, volumen: siguiente.data }) : armado;
}

// --- Los tamaños --------------------------------------------------------------------------------------------

export type CampoTamanos = "grandesAbajo" | "inflado" | "variacion";

export function conTamanos(armado: Armado, campo: CampoTamanos, valor: number): Armado {
  const siguiente = TamanosGuirnaldaSchema.safeParse({ ...armado.tamanos, [campo]: valor });
  return siguiente.success ? delDecorador({ ...armado, tamanos: siguiente.data }) : armado;
}

/** El peso de un tamaño de globo en la mezcla (`0` lo quita). Una mezcla sin ningún tamaño no se arma, así que no se deja. */
export function conPesoDeTamano(armado: Armado, pulgadas: number, peso: number): Armado {
  const clave = String(pulgadas);
  const mezcla: Record<string, number | undefined> = { ...armado.tamanos.mezcla };
  if (peso <= 0) delete mezcla[clave];
  else mezcla[clave] = peso;
  if (!Object.values(mezcla).some((valor) => typeof valor === "number" && valor > 0)) return armado;
  const siguiente = TamanosGuirnaldaSchema.safeParse({ ...armado.tamanos, mezcla });
  return siguiente.success ? delDecorador({ ...armado, tamanos: siguiente.data }) : armado;
}

/** El peso de un tamaño en la mezcla del armado, o `0` si no lo usa. */
export function pesoDeTamano(armado: Armado, pulgadas: number): number {
  const mezcla: Readonly<Record<string, number | undefined>> = armado.tamanos.mezcla;
  return mezcla[String(pulgadas)] ?? 0;
}

// --- La paleta ----------------------------------------------------------------------------------------------

type Entrada = Armado["colores"]["paleta"][number];

function conPaleta(armado: Armado, paleta: Entrada[]): Armado {
  return delDecorador({ ...armado, colores: { ...armado.colores, paleta } });
}

/** Qué color de la pieza ocupa la posición `posicion` de la paleta. El motor comprueba que exista. */
export function conMaterial(armado: Armado, posicion: number, material: number): Armado {
  const actual = armado.colores.paleta[posicion];
  if (!actual || actual.material === material) return armado;
  return conPaleta(armado, armado.colores.paleta.map((entrada, lugar) => (lugar === posicion ? { ...entrada, material } : entrada)));
}

export function conPesoDeColor(armado: Armado, posicion: number, peso: number): Armado {
  const actual = armado.colores.paleta[posicion];
  if (!actual || actual.peso === peso) return armado;
  return conPaleta(armado, armado.colores.paleta.map((entrada, lugar) => (lugar === posicion ? { ...entrada, peso } : entrada)));
}

export function conAcabado(armado: Armado, posicion: number, acabado: AcabadoGuirnalda): Armado {
  const actual = armado.colores.paleta[posicion];
  if (!actual || actual.acabado === acabado) return armado;
  return conPaleta(armado, armado.colores.paleta.map((entrada, lugar) => (lugar === posicion ? { ...entrada, acabado } : entrada)));
}

export function conRol(armado: Armado, posicion: number, rol: RolGuirnalda): Armado {
  const actual = armado.colores.paleta[posicion];
  if (!actual || actual.rol === rol) return armado;
  return conPaleta(armado, armado.colores.paleta.map((entrada, lugar) => (lugar === posicion ? { ...entrada, rol } : entrada)));
}

/**
 * Agrega un color a la paleta: el primero de la pieza que la paleta todavía no usa. Nada si ya están todos, si
 * se llegó al máximo de la paleta o si la pieza no tiene colores (`coloresDePieza`).
 */
export function conColorAgregado(armado: Armado, coloresDePieza: number, maximo: number): Armado {
  if (armado.colores.paleta.length >= maximo) return armado;
  const usados = new Set(armado.colores.paleta.map((entrada) => entrada.material));
  const libre = Array.from({ length: coloresDePieza }, (_, indice) => indice).find((indice) => !usados.has(indice));
  if (libre === undefined) return armado;
  const modelo = armado.colores.paleta[armado.colores.paleta.length - 1];
  return conPaleta(armado, [...armado.colores.paleta, { material: libre, peso: modelo?.peso ?? 20, acabado: modelo?.acabado ?? "mate", rol: "normal" }]);
}

/** Quita un color de la paleta. Nada si es el único: una guirnalda sin colores no se arma. */
export function conColorQuitado(armado: Armado, posicion: number): Armado {
  if (armado.colores.paleta.length <= 1 || !armado.colores.paleta[posicion]) return armado;
  return conPaleta(armado, armado.colores.paleta.filter((_, lugar) => lugar !== posicion));
}

export function conReparto(armado: Armado, reparto: RepartoGuirnalda): Armado {
  if (armado.colores.reparto === reparto) return armado;
  return delDecorador({ ...armado, colores: { ...armado.colores, reparto } });
}

export function conMezclaDeColores(armado: Armado, mezcla: number): Armado {
  if (armado.colores.mezcla === mezcla || mezcla < 0 || mezcla > 1) return armado;
  return delDecorador({ ...armado, colores: { ...armado.colores, mezcla } });
}

// --- Los adornos --------------------------------------------------------------------------------------------

export type CampoAdorno = "follaje" | "flores";

export function conAdorno(armado: Armado, campo: CampoAdorno, valor: number): Armado {
  const siguiente = AdornosGuirnaldaSchema.safeParse({ ...armado.adornos, [campo]: valor });
  return siguiente.success ? delDecorador({ ...armado, adornos: siguiente.data }) : armado;
}

// --- Los rangos ---------------------------------------------------------------------------------------------

export type RangoControl = { min: number; max: number; paso: number };

/** Pasos de los deslizadores que el motor no publica: el motor redondea sus propios límites a décimas de metro. */
export const PASO_MEDIDA_M = 0.1;
export const PASO_FRACCION = 0.05;

/**
 * El rango de un campo numérico que `opciones_admitidas` y `limites_de` no publican: el del contrato
 * `armado-guirnalda-organica.v1`, que el propio motor usa para acotarlo. Se lee del esquema, no se vuelve a
 * escribir aquí.
 */
export function rangoDelContrato(campo: { minValue: number | null; maxValue: number | null }, paso: number): RangoControl {
  return { min: campo.minValue ?? 0, max: campo.maxValue ?? 1, paso };
}

/** El largo de la tira que el motor admite con este armado puesto: sube con el grosor. */
export function rangoDeLargo(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: limites.largoMin, max: limites.largoMax, paso: PASO_MEDIDA_M };
}

export function rangoDeAltura(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: limites.alturaMin, max: limites.alturaMax, paso: PASO_MEDIDA_M };
}

/** La pendiente va de la mitad más baja a la más alta que el motor admite, simétrica. */
export function rangoDePendiente(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: -limites.pendienteMax, max: limites.pendienteMax, paso: PASO_MEDIDA_M };
}

export function rangoDeOnda(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: 0, max: limites.ondaMax, paso: PASO_FRACCION };
}

export function rangoDeColgado(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: 0, max: limites.colgadoMax, paso: PASO_MEDIDA_M };
}

export function rangoDeFestones(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: 1, max: limites.festonesMax, paso: 1 };
}

export function rangoDeGrosorExtremos(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: limites.grosorExtremosMin, max: limites.grosorExtremosMax, paso: PASO_FRACCION };
}

export function rangoDeGrosorCentro(limites: LimitesGuirnaldaOrganica): RangoControl {
  return { min: limites.grosorCentroMin, max: limites.grosorCentroMax, paso: PASO_FRACCION };
}

/**
 * Dónde se pinta un valor dentro de su rango. Solo presentación: el armado que se guarda y se manda al motor es
 * el que el decorador pidió, y el motor es quien lo corrige y lo dice; pero un control no puede enseñar un 3,0 m
 * si su rango ya empieza en 4,2 m, porque eso contradiría al dibujo y al aviso del motor.
 */
export function valorEnRango(valor: number, rango: Pick<RangoControl, "min" | "max">): number {
  return Math.min(Math.max(valor, rango.min), rango.max);
}
