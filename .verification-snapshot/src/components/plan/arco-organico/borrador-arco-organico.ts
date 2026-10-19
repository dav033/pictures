import {
  AdornosGuirnaldaSchema,
  TamanosGuirnaldaSchema,
  type AcabadoGuirnalda,
  type RepartoGuirnalda,
  type RolGuirnalda,
} from "@/lib/plan/armado-guirnalda-organica";
import {
  FormaArcoOrganicoSchema,
  VolumenArcoOrganicoSchema,
  type ArmadoArcoOrganicoV1,
} from "@/lib/plan/armado-arco-organico";
import type { EstiloListoArcoOrganico, FormaListaArcoOrganicoDescrita, LimitesArcoOrganico } from "@/lib/plan/opciones-armado-arco-organico";
import { jsonEstable } from "../bouquet/borrador-armado";

/**
 * El borrador del editor de arcos orgánicos del motor (ADR-0035): el `armado_arco_organico` que el decorador va
 * cambiando mientras el motor lo dibuja. Puro: sin React, para poder probarlo sin montar nada.
 *
 * **Aquí no se calcula nada.** Cada función devuelve el mismo armado con UN campo cambiado y marcado como del
 * decorador; lo que ese campo provoca (cuántos globos caben, qué tamaños quedan fuera de la banda, si el grosor
 * taparía la abertura, qué se compra) lo decide el motor cuando se le pide el dibujo, y lo que corrige lo dice en
 * español en sus avisos. Los rangos de los mandos salen de `limites` (`limites_de`) y de `opciones`
 * (`opciones_admitidas`), que el motor devuelve con cada dibujo; lo único que el cliente sabe por sí mismo es la
 * forma del contrato `armado-arco-organico.v1`, de donde se leen los rangos que el motor no publica.
 *
 * Aplicar una forma lista o un estilo es copiar los campos que el motor describe en `opciones` (`formas`,
 * `estilos`): la interfaz no repite ninguna cifra del diseñador. **Un medio arco es una forma lista** con `corte`
 * menor que 1, así que la silueta de una forma llega completa y se copia entera (al contrario que en la columna,
 * donde la persona de escala y el suelo se quedaban como el decorador los tenía).
 */

type Armado = ArmadoArcoOrganicoV1;

/** Un armado es el mismo aunque cambie quién lo firmó (`origen`): lo que cuenta es cómo se arma. */
export function mismoArmadoArcoOrganico(a: Armado, b: Armado): boolean {
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

/** Qué hace distinto a un dibujo de otro: el armado entero, sin importar el orden de sus claves. */
export function claveArmadoArcoOrganico(armado: Armado): string {
  return jsonEstable(armado);
}

/** Todo cambio del editor es una decisión del decorador, venga el armado de donde venga. */
function delDecorador(armado: Armado): Armado {
  return armado.origen === "decorador" ? armado : { ...armado, origen: "decorador" };
}

// --- La forma -----------------------------------------------------------------------------------------------

export type CampoForma = "anchoM" | "altoM" | "cima" | "curva" | "ondulacion" | "carga" | "corte";

export function conForma(armado: Armado, campo: CampoForma, valor: number): Armado {
  const siguiente = FormaArcoOrganicoSchema.safeParse({ ...armado.forma, [campo]: valor });
  // Lo que el contrato no admite deja el borrador como estaba; el motor acota además lo que se salga de sus rangos.
  return siguiente.success ? delDecorador({ ...armado, forma: siguiente.data }) : armado;
}

export type InterruptorForma = "espejo" | "suelo";

/**
 * El espejo y el suelo no cambian cuántos globos lleva el arco: el espejo corta el medio arco por el otro lado y
 * el suelo solo dibuja la línea del piso.
 */
export function conInterruptorDeForma(armado: Armado, campo: InterruptorForma, activo: boolean): Armado {
  if (armado.forma[campo] === activo) return armado;
  return delDecorador({ ...armado, forma: { ...armado.forma, [campo]: activo } });
}

/**
 * Aplica una forma lista: su silueta entera (el ancho, el alto, la cima, la curva, el corte y su espejo), su
 * volumen, su mezcla de tamaños y su semilla. No toca los colores ni los adornos (igual que el diseñador). El
 * motor es quien dice qué hace con ella en los avisos.
 */
export function conFormaLista(armado: Armado, lista: FormaListaArcoOrganicoDescrita): Armado {
  const forma = FormaArcoOrganicoSchema.safeParse({ ...armado.forma, ...lista.forma });
  const volumen = VolumenArcoOrganicoSchema.safeParse(lista.volumen);
  const tamanos = TamanosGuirnaldaSchema.safeParse(lista.tamanos);
  if (!forma.success || !volumen.success || !tamanos.success) return armado;
  return delDecorador({
    ...armado,
    forma: forma.data,
    volumen: volumen.data,
    tamanos: tamanos.data,
    aspecto: { ...armado.aspecto, semilla: lista.semilla },
  });
}

/**
 * Aplica un estilo: cuánto se llena el arco. Cambia el volumen y, si el estilo lo describe (el de los gigantes),
 * la mezcla de tamaños y cuánto se acomodan los grandes abajo; el inflado y la variación de tamaño se quedan como
 * el decorador los tenía.
 */
export function conEstilo(armado: Armado, estilo: EstiloListoArcoOrganico): Armado {
  const volumen = VolumenArcoOrganicoSchema.safeParse(estilo.volumen);
  if (!volumen.success) return armado;
  const tamanos = estilo.tamanos
    ? TamanosGuirnaldaSchema.safeParse({ ...armado.tamanos, mezcla: estilo.tamanos.mezcla, grandesAbajo: estilo.tamanos.grandesAbajo })
    : null;
  if (tamanos && !tamanos.success) return armado;
  return delDecorador({ ...armado, volumen: volumen.data, ...(tamanos ? { tamanos: tamanos.data } : {}) });
}

/** Otra disposición de los mismos globos: solo cambia la semilla del azar del motor. */
export function conSemilla(armado: Armado, semilla: number): Armado {
  const entera = Math.trunc(semilla);
  if (!Number.isFinite(entera) || entera < 1 || entera > 99999 || armado.aspecto.semilla === entera) return armado;
  return delDecorador({ ...armado, aspecto: { ...armado.aspecto, semilla: entera } });
}

// --- El volumen ---------------------------------------------------------------------------------------------

export type CampoVolumen = "grosorPatasM" | "grosorCimaM" | "irregularidad" | "relleno" | "racimo" | "salientes";

export function conVolumen(armado: Armado, campo: CampoVolumen, valor: number): Armado {
  const siguiente = VolumenArcoOrganicoSchema.safeParse({ ...armado.volumen, [campo]: valor });
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
 * Agrega un color a la paleta: el primero de la pieza que la paleta todavía no usa. Nada si ya están todos, si se
 * llegó al máximo de la paleta o si la pieza no tiene colores (`coloresDePieza`).
 */
export function conColorAgregado(armado: Armado, coloresDePieza: number, maximo: number): Armado {
  if (armado.colores.paleta.length >= maximo) return armado;
  const usados = new Set(armado.colores.paleta.map((entrada) => entrada.material));
  const libre = Array.from({ length: coloresDePieza }, (_, indice) => indice).find((indice) => !usados.has(indice));
  if (libre === undefined) return armado;
  const modelo = armado.colores.paleta[armado.colores.paleta.length - 1];
  return conPaleta(armado, [...armado.colores.paleta, { material: libre, peso: modelo?.peso ?? 20, acabado: modelo?.acabado ?? "mate", rol: "normal" }]);
}

/** Quita un color de la paleta. Nada si es el único: un arco sin colores no se arma. */
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
 * `armado-arco-organico.v1`, que el propio motor usa para acotarlo. Se lee del esquema, no se vuelve a escribir
 * aquí.
 */
export function rangoDelContrato(campo: { minValue: number | null; maxValue: number | null }, paso: number): RangoControl {
  return { min: campo.minValue ?? 0, max: campo.maxValue ?? 1, paso };
}

/** El ancho de pata a pata que el motor admite con este armado puesto. */
export function rangoDeAncho(limites: LimitesArcoOrganico): RangoControl {
  return { min: limites.anchoMin, max: limites.anchoMax, paso: PASO_MEDIDA_M };
}

/** El alto hasta la cima que el motor admite: el mínimo sube con el ancho y con el grosor de la cima. */
export function rangoDeAlto(limites: LimitesArcoOrganico): RangoControl {
  return { min: limites.altoMin, max: limites.altoMax, paso: PASO_MEDIDA_M };
}

/** El grosor de la banda en las patas: el tope baja con el ancho, porque una banda gruesa taparía la abertura. */
export function rangoDeGrosorPatas(limites: LimitesArcoOrganico): RangoControl {
  return { min: limites.grosorPatasMin, max: limites.grosorPatasMax, paso: PASO_FRACCION };
}

export function rangoDeGrosorCima(limites: LimitesArcoOrganico): RangoControl {
  return { min: limites.grosorCimaMin, max: limites.grosorCimaMax, paso: PASO_FRACCION };
}

/**
 * Dónde se pinta un valor dentro de su rango. Solo presentación: el armado que se guarda y se manda al motor es
 * el que el decorador pidió, y el motor es quien lo corrige y lo dice; pero un control no puede enseñar un 1,5 m
 * si su rango ya empieza en 2,4 m, porque eso contradiría al dibujo y al aviso del motor.
 */
export function valorEnRango(valor: number, rango: Pick<RangoControl, "min" | "max">): number {
  return Math.min(Math.max(valor, rango.min), rango.max);
}
