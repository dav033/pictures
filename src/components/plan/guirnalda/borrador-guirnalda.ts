import type {
  ArmadoGuirnaldaV1,
  FormaGuirnalda,
  PosicionRemateGuirnalda,
  SoporteGuirnalda,
  UnidadRacimoGuirnalda,
} from "@/lib/plan/armado-guirnalda";
import { jsonEstable } from "../bouquet/borrador-armado";
import { formaConCaida } from "./leyenda-guirnalda";

/**
 * Ediciones del armado DECLARATIVO de una guirnalda que arma el editor
 * (ADR-0032): cambiar el soporte, la forma, la caída, los anclajes, la unidad
 * del racimo, el relleno o los remates. El armado no lleva cantidades, así
 * que aquí no hay ninguna regla de conteo: cada borrador va a la vista previa
 * y Python lo resuelve o lo rechaza con su frase. Solo se cuida la FORMA del
 * contrato (`armado-guirnalda.v1`) para que el borrador se pueda pedir: la
 * caída solo en las formas que la tabla de geometría marca `conCaida`, la
 * pieza anfitriona solo sobre otra pieza y los anclajes que el contrato exige
 * al colgar. Todo lo que el decorador toca lo firma él (`origen: "decorador"`).
 * Puro: sin React.
 */

/** Hasta cuántos remates admite `armado-guirnalda.v1`. */
export const MAXIMO_REMATES = 6;
/** Mínimo de anclajes de `armado-guirnalda.v1`: con él arranca una guirnalda que pasa a colgar. */
const ANCLAJES_MINIMOS = 2;

export function claveArmadoGuirnalda(armado: ArmadoGuirnaldaV1): string {
  return jsonEstable(armado);
}

/** Mismo armado aunque cambie quién lo firmó (`origen`). */
export function mismoArmadoGuirnalda(a: ArmadoGuirnaldaV1 | null, b: ArmadoGuirnaldaV1 | null): boolean {
  if (!a || !b) return a === b;
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

function firmado(armado: ArmadoGuirnaldaV1): ArmadoGuirnaldaV1 {
  return { ...armado, origen: "decorador" };
}

function sin<K extends keyof ArmadoGuirnaldaV1>(armado: ArmadoGuirnaldaV1, clave: K): ArmadoGuirnaldaV1 {
  const copia = { ...armado };
  delete copia[clave];
  return copia;
}

/** Los anclajes solo tienen control a la vista colgada o en arco caído (sus tramos). */
function usaAnclajes(armado: Pick<ArmadoGuirnaldaV1, "soporte" | "forma">): boolean {
  return armado.soporte === "colgada" || armado.forma === "arco_caido";
}

/**
 * Otro soporte. Sobre otra pieza lleva su `estructura_id`; colgada, al menos
 * los anclajes que exige el contrato. Al dejar de colgar (fuera de un arco
 * caído) los anclajes se van: sin control a la vista quedaban ocultos y Python
 * los usaba para contar los ganchos de una guirnalda en pared.
 */
export function conSoporte(armado: ArmadoGuirnaldaV1, soporte: SoporteGuirnalda, anfitriona?: string): ArmadoGuirnaldaV1 {
  let siguiente: ArmadoGuirnaldaV1 = { ...sin(armado, "estructura_id"), soporte };
  if (soporte === "sobre_estructura" && anfitriona) siguiente = { ...siguiente, estructura_id: anfitriona };
  if (soporte === "colgada" && siguiente.puntos_de_anclaje === undefined) siguiente = { ...siguiente, puntos_de_anclaje: ANCLAJES_MINIMOS };
  if (usaAnclajes(armado) && !usaAnclajes(siguiente)) siguiente = sin(siguiente, "puntos_de_anclaje");
  return firmado(siguiente);
}

export function conAnfitriona(armado: ArmadoGuirnaldaV1, anfitriona: string): ArmadoGuirnaldaV1 {
  return firmado({ ...armado, soporte: "sobre_estructura", estructura_id: anfitriona });
}

/** Otra forma; la caída se va si la nueva forma no cuelga, y los anclajes si ya no los usa (ver `conSoporte`). */
export function conForma(armado: ArmadoGuirnaldaV1, forma: FormaGuirnalda): ArmadoGuirnaldaV1 {
  let siguiente: ArmadoGuirnaldaV1 = { ...armado, forma };
  if (!formaConCaida(forma)) siguiente = sin(siguiente, "caida_m");
  if (usaAnclajes(armado) && !usaAnclajes(siguiente)) siguiente = sin(siguiente, "puntos_de_anclaje");
  return firmado(siguiente);
}

/** La caída en metros, a dos decimales (el paso del control), o sin caída con `null`. */
export function conCaida(armado: ArmadoGuirnaldaV1, caida: number | null): ArmadoGuirnaldaV1 {
  if (caida === null || !(caida > 0)) return firmado(sin(armado, "caida_m"));
  return firmado({ ...armado, caida_m: Math.round(caida * 100) / 100 });
}

export function conAnclajes(armado: ArmadoGuirnaldaV1, puntos: number | null): ArmadoGuirnaldaV1 {
  return firmado(puntos === null ? sin(armado, "puntos_de_anclaje") : { ...armado, puntos_de_anclaje: puntos });
}

export function conRacimo(armado: ArmadoGuirnaldaV1, cambio: { unidad?: UnidadRacimoGuirnalda; tamano_pulg_base?: ArmadoGuirnaldaV1["racimo"]["tamano_pulg_base"] }): ArmadoGuirnaldaV1 {
  return firmado({ ...armado, racimo: { ...armado.racimo, ...cambio } });
}

/** Proporción del relleno a dos decimales (el paso del control). */
export function conRelleno(armado: ArmadoGuirnaldaV1, relleno: ArmadoGuirnaldaV1["relleno"]): ArmadoGuirnaldaV1 {
  return firmado({ ...armado, relleno: relleno ? { material: relleno.material, proporcion: Math.round(relleno.proporcion * 100) / 100 } : null });
}

export function conRemate(armado: ArmadoGuirnaldaV1, indice: number, cambio: Partial<ArmadoGuirnaldaV1["remates"][number]>): ArmadoGuirnaldaV1 {
  return firmado({ ...armado, remates: armado.remates.map((remate, posicion) => (posicion === indice ? { ...remate, ...cambio } : remate)) });
}

/** Un remate más (repartido a lo largo); `null` si ya están los que admite el contrato. */
export function agregarRemate(armado: ArmadoGuirnaldaV1, material: number, posicion: PosicionRemateGuirnalda = "cada_n"): ArmadoGuirnaldaV1 | null {
  if (armado.remates.length >= MAXIMO_REMATES) return null;
  return firmado({ ...armado, remates: [...armado.remates, { material, posicion }] });
}

export function quitarRemate(armado: ArmadoGuirnaldaV1, indice: number): ArmadoGuirnaldaV1 {
  return firmado({ ...armado, remates: armado.remates.filter((_, posicion) => posicion !== indice) });
}

/**
 * Dónde queda un remate que el decorador suelta sobre el racimo `racimo` (de
 * 1 a `total`). El contrato solo sabe cuatro posiciones: el primer racimo es
 * el extremo izquierdo, el último el derecho, el del centro (los dos del
 * centro si son pares) es "al centro", y cualquier otro reparte el remate a lo
 * largo. Junto a qué racimos quedan sus globos lo decide Python.
 */
export function posicionPorRacimo(racimo: number, total: number): PosicionRemateGuirnalda {
  if (total <= 1 || racimo <= 1) return "extremo_izq";
  if (racimo >= total) return "extremo_der";
  return Math.abs(racimo - (total + 1) / 2) < 1 ? "centro" : "cada_n";
}
