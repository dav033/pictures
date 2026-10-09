import { largoRecorrido, type ColorOrganico, type OpcionesOrganico, type PuntoMezcla, type RellenoOrganico, type TramoOrganico } from "../organico";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { Pieza } from "../piezas";
import type { DensidadEspec } from "./espec-cliente-v1";

/**
 * **Calibración de las piezas orgánicas de la vista guiada.** El motor orgánico compartido (el del Taller y la biblioteca) llena
 * la envoltura «hasta que quede tupido»: primero la estructura y luego tapa cada rendija con R-9 y tríos de R-5, sin tope. En un
 * tubo de 45 a 60 cm eso da unos 42 globos por metro y más de la mitad R-5, el doble de lo que cuenta Python y de lo que se ve en
 * las fotos de referencia (20 a 26 por metro, un 24 a 26 % de R-5).
 *
 * Aquí no se toca ese motor: se le pasan SUS propios parámetros (`densidad`, `relleno` con `maximo` y `racimo`, la `mezcla` de los
 * tramos) desde la fachada de la vista guiada, así el Taller y la biblioteca siguen armando igual.
 * - Los R-5 solo van como racimitos con tope por metro de cuerpo (nunca más de ~30 % de la pieza).
 * - Los de relleno mediano (R-9) tienen tope por metro en las densidades ligera y media, y sin tope en la lujosa (que sí se tapa
 *   del todo). Con tope, la densidad cambia de verdad cuántos globos hay: sin él, el relleno tapaba lo que la estructura dejaba
 *   libre y la pieza ligera salía con MÁS globos que la lujosa (sencilla 112, lujosa 94 en una guirnalda de 2,4 m).
 * - La estructura carga más R-12 que R-9 (Python y las fotos son de R-12 dominante).
 */

/** Cuánto de la estructura completa pide cada densidad (1 = la envoltura cubierta del todo); menos globos por centímetro cuanto más ligera. */
export const FACTOR_ESTRUCTURA: Readonly<Record<DensidadEspec, number>> = { sencilla: 0.5, media: 0.65, lujosa: 1 };
/** Cuánto del tope de relleno entra en cada densidad. */
export const FACTOR_RELLENO: Readonly<Record<DensidadEspec, number>> = { sencilla: 0.55, media: 0.72, lujosa: 1 };

/** Radio de envoltura (cm) del tubo de referencia con que se midió el tope: 45 cm de grosor. */
const RADIO_REFERENCIA_CM = 22.5;
/** Globos por racimito de R-5 (los de las fotos van de 3 a 5). */
const GLOBOS_POR_RACIMITO = 4;
/** Cuánto pesa R-5 como mucho dentro de la estructura de un tramo (el aro lo trae al 25 %); el resto de R-5 es relleno con tope. */
const PESO_MAXIMO_R5_ESTRUCTURA = 0.12;
/** Inflado del relleno de referencia (R-9) para escalar el tope de un relleno de otro tamaño. */
const INFLADO_RELLENO_REFERENCIA_CM = 18;

export type PerfilOrganico = {
  /** Tope de globos R-5 de relleno por metro de cuerpo (a la densidad lujosa y con el tubo de referencia). */
  r5PorMetro: number;
  /** Tope de globos de relleno mediano (R-9) por metro de cuerpo, en las densidades ligera y media. */
  medianosPorMetro: number;
  /** Cuánto más pesan los R-12 que los R-9 en la estructura. */
  empujeR12: number;
};

export const PERFIL_POR_DEFECTO: PerfilOrganico = { r5PorMetro: 6.5, medianosPorMetro: 6, empujeR12: 1.4 };
/** El aro lleva dos anillos de relleno y su estructura de dentro ya es de R-9: con el tope de las demás salía 22 % por encima de las fotos. */
const PERFIL_ARO: PerfilOrganico = { ...PERFIL_POR_DEFECTO, r5PorMetro: 3.5 };

/** El perfil de cada estructura oficial; las que no están aquí usan el de por defecto. */
export const perfilDe = (oficial: EstructuraOficialId): PerfilOrganico => (oficial === "aro_circular" ? PERFIL_ARO : PERFIL_POR_DEFECTO);

const radioMedio = (tramo: TramoOrganico): number => tramo.grosor.reduce((s, g) => s + g.radioCm, 0) / tramo.grosor.length;

/** Los metros de cuerpo de la pieza, ponderados por lo ancho que es cada tramo (1 = un metro del tubo de referencia). */
export function superficieOrganica(opciones: OpcionesOrganico): number {
  return opciones.tramos.reduce((suma, t) => suma + (largoRecorrido(t.recorrido) / 100) * (radioMedio(t) / RADIO_REFERENCIA_CM), 0);
}

function conPesoR12(mezcla: readonly PuntoMezcla[], empuje: number): PuntoMezcla[] {
  return mezcla.map((p) => ({ t: p.t, pesos: Object.fromEntries(Object.entries(p.pesos).map(([formato, peso]) => [formato, formato === "R-12" ? peso * empuje : formato === "R-9" ? peso / empuje : peso])) }));
}

/** R-5 en la estructura de un tramo, a lo más `PESO_MAXIMO_R5_ESTRUCTURA` del total: el aro de la biblioteca lo trae al 25 %. */
function conR5Acotado(mezcla: readonly PuntoMezcla[]): PuntoMezcla[] {
  return mezcla.map((p) => {
    const chicos = p.pesos["R-5"] ?? 0;
    const resto = Object.entries(p.pesos).reduce((s, [formato, peso]) => (formato === "R-5" ? s : s + peso), 0);
    const tope = (PESO_MAXIMO_R5_ESTRUCTURA / (1 - PESO_MAXIMO_R5_ESTRUCTURA)) * resto;
    return chicos <= 0 || resto <= 0 || chicos <= tope ? p : { t: p.t, pesos: { ...p.pesos, "R-5": tope } };
  });
}

/**
 * El color que solo se fabrica en algunos tamaños (los Reflex, los cristales) se reparte por tamaño con su peso en cada uno: el
 * motor reparte la cuota de un color entre TODOS los globos que lo admiten, y los chicos (con menos vecinos del mismo color)
 * se lo quedaban casi todo (el Dorado Rosa de un semiarco salía 43 de 49 en R-5, un acento de 12 cm).
 */
function cuotaPorTamano(colores: readonly ColorOrganico[]): ColorOrganico[] {
  return colores.flatMap((c): ColorOrganico[] => (c.formatos && c.formatos.length > 1 ? c.formatos.map((formato) => ({ ...c, formatos: [formato], porFormato: true })) : [{ ...c, porFormato: true }]));
}

function rellenoCalibrado(relleno: readonly RellenoOrganico[], densidad: DensidadEspec, superficie: number, perfil: PerfilOrganico): RellenoOrganico[] {
  const escala = FACTOR_RELLENO[densidad] * superficie;
  return relleno.map((r) => {
    if (r.formatoId === "R-5") return { ...r, trios: true, racimo: GLOBOS_POR_RACIMITO, maximo: Math.round(perfil.r5PorMetro * escala) };
    if (densidad === "lujosa") return r;
    const tamano = INFLADO_RELLENO_REFERENCIA_CM / Math.max(1, r.infladoCm);
    return { ...r, maximo: Math.round(perfil.medianosPorMetro * escala * tamano * tamano) };
  });
}

/** La pieza orgánica con su densidad y su relleno calibrados. Lo que no es orgánico (cuartetos, mallas, decoraciones) pasa igual. */
export function calibrarOrganico(pieza: Pieza, densidad: DensidadEspec, perfil: PerfilOrganico): Pieza {
  if (pieza.tipo !== "organico") return pieza;
  const { opciones } = pieza;
  const calibradas: OpcionesOrganico = {
    ...opciones,
    densidad: (opciones.densidad ?? 1) * FACTOR_ESTRUCTURA[densidad],
    relleno: rellenoCalibrado(opciones.relleno, densidad, superficieOrganica(opciones), perfil),
    colores: cuotaPorTamano(opciones.colores),
    tramos: opciones.tramos.map((t) => ({ ...t, mezcla: conR5Acotado(conPesoR12(t.mezcla, perfil.empujeR12)) })),
  };
  return { ...pieza, opciones: calibradas };
}
