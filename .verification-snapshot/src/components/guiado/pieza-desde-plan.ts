import type { z } from "zod";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { ArmadoArcoOrganicoV1 } from "@/lib/plan/armado-arco-organico";
import type { ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import { TAMANOS_GUIRNALDA, type ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { lineasPorMaterial } from "@/lib/plan/material-de-linea";
import type { LimitesColumnaOrganica } from "@/lib/plan/opciones-armado-columna-organica";
import type { LineaMaterial } from "@/lib/plan/resuelto";

/**
 * «Modificar esta pieza» arranca de lo que el plan tiene DE VERDAD (probador 124, hallazgo 3). Puro: sin React ni red.
 *
 * Antes: una pieza sin armado guardado (el plan exacto de una idea, todo plan que arma el chat) abría con la receta del
 * motor —su diseño de partida: 2,20 m, base de 85 cm, globos de 5/12/18/24″—. La columna izquierda de «Dos columnas
 * rosa, lila y dorado» tiene en el plan 39 globos (15/14/10), 0,55 × 2 m y globos de 5, 9, 12, 18 y 24″; el editor
 * mostraba 48 globos (19/17/12), 1,14 m de ancho y ningún 9″, y si el cliente guardaba cualquier cambio el plan se
 * quedaba con las cifras del motor sin que nadie se lo dijera.
 *
 * Ahora:
 * - `cifrasDelPlan` lee de las líneas que Python resolvió cuántos globos lleva la pieza, de qué color (con
 *   `lineasPorMaterial`, que también cuenta las líneas que compra una sustitución) y de qué tamaño, y sus medidas.
 * - `sembrar*` pone esas cifras en el armado de la receta (que ya trae el alto, el ancho o el largo del plan): el
 *   grosor de la columna, la mezcla de tamaños del plan y el peso de cada color según sus globos. El motor sigue
 *   decidiendo dónde va cada globo y cuántos caben: esto no cuenta nada, solo le dice al motor qué pieza es.
 * - `conRellenoHacia` corrige UNA vez lo lleno de la pieza para acercar el total al del plan (el presupuesto de globos
 *   del motor es proporcional a `relleno`).
 * - `compararConPlan` dice si el dibujo lleva exactamente lo del plan; si no, la vista lo cuenta en palabras de cliente
 *   y pide confirmación antes de reescribir la pieza.
 *
 * Python sigue siendo el único dueño de las cantidades: aquí solo se agrupan las suyas (las del plan y las del motor).
 */

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/** Los tamaños de globo redondo que dibujan los motores orgánicos (la pulgada nominal). */
export type TamanoMotor = (typeof TAMANOS_GUIRNALDA)[number];
const TAMANOS: ReadonlySet<number> = new Set<number>(TAMANOS_GUIRNALDA);

export type ColorDelPlan = {
  /** Índice del material en `materiales` (el mismo que usa el armado). */
  material: number;
  globos: number;
  /** Globos de cada tamaño, con la pulgada como clave («5», «12»…). */
  porTamano: Readonly<Record<string, number>>;
};

export type CifrasPieza = {
  /** Globos de UNA pieza (sin repeticiones), los que el plan cuenta para ella. */
  total: number;
  /** Uno por material, en su orden, aunque lleve 0. */
  porMaterial: ColorDelPlan[];
  /** Globos redondos de cada tamaño que dibujan los motores. */
  porTamano: Readonly<Record<string, number>>;
  /** Globos del plan que un motor orgánico no dibuja (otra forma u otro tamaño). */
  fueraDelMotor: number;
  medidas: { ancho_m?: number; alto_m?: number; largo_m?: number };
};

/** Las cifras que la pieza tiene en el plan, o null si el plan no la trae resuelta. */
export function cifrasDelPlan(plan: PlanGuiado, estructuraId: string): CifrasPieza | null {
  const declarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  const resuelta = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  if (!declarada || !resuelta) return null;
  // Las líneas del plan guiado son las de Python tal cual (`BasePlanSchema` las deja pasar enteras).
  const lineas = resuelta.lineas as unknown as LineaMaterial[];
  if (!lineas.length) return null;
  const repeticiones = Math.max(1, declarada.repeticiones ?? 1);
  const porPieza = (unidades: number) => Math.round(unidades / repeticiones);
  const porMaterial = lineasPorMaterial(declarada, lineas).map((propias, material): ColorDelPlan => {
    const porTamano: Record<string, number> = {};
    for (const linea of propias) {
      if (!esDelMotor(linea)) continue;
      const clave = String(linea.diam_pulg);
      porTamano[clave] = (porTamano[clave] ?? 0) + linea.unidades;
    }
    return {
      material,
      globos: porPieza(propias.reduce((suma, linea) => suma + linea.unidades, 0)),
      porTamano: Object.fromEntries(Object.entries(porTamano).map(([tamano, unidades]) => [tamano, porPieza(unidades)])),
    };
  });
  const porTamano: Record<string, number> = {};
  let fuera = 0;
  for (const linea of lineas) {
    if (!esDelMotor(linea)) { fuera += linea.unidades; continue; }
    const clave = String(linea.diam_pulg);
    porTamano[clave] = (porTamano[clave] ?? 0) + linea.unidades;
  }
  const medidas = declarada.medidas ?? {};
  return {
    total: porPieza(lineas.reduce((suma, linea) => suma + linea.unidades, 0)),
    porMaterial,
    porTamano: Object.fromEntries(Object.entries(porTamano).map(([tamano, unidades]) => [tamano, porPieza(unidades)])),
    fueraDelMotor: porPieza(fuera),
    medidas: {
      ...(positivo(medidas.ancho_m) ? { ancho_m: medidas.ancho_m } : {}),
      ...(positivo(medidas.alto_m) ? { alto_m: medidas.alto_m } : {}),
      ...(positivo(medidas.largo_m) ? { largo_m: medidas.largo_m } : {}),
    },
  };
}

function positivo(valor: number | null | undefined): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0;
}

/** Un globo que dibuja un motor orgánico: redondo (o sin forma dicha) y de un tamaño del motor. */
function esDelMotor(linea: Pick<LineaMaterial, "forma" | "diam_pulg">): boolean {
  const redondo = !linea.forma || /redond/i.test(linea.forma);
  return redondo && typeof linea.diam_pulg === "number" && TAMANOS.has(linea.diam_pulg);
}

// --- Sembrar el armado con las cifras del plan -----------------------------------------------------------------

type Mezcla = ArmadoColumnaOrganicaV1["tamanos"]["mezcla"];
type Paleta = ArmadoColumnaOrganicaV1["colores"]["paleta"];

/** Partes enteras de 1 a 100 de cada cantidad (las que son 0 no salen). */
function partes(cantidades: ReadonlyArray<readonly [string, number]>): Array<[string, number]> {
  const total = cantidades.reduce((suma, [, cantidad]) => suma + cantidad, 0);
  if (total <= 0) return [];
  return cantidades.filter(([, cantidad]) => cantidad > 0).map(([clave, cantidad]) => [clave, Math.min(100, Math.max(1, Math.round((100 * cantidad) / total)))]);
}

/**
 * La mezcla de tamaños del plan como pesos del motor, o null si el plan no trae globos redondos del motor. Lleva TODOS
 * los tamaños, con 0 los que el plan no usa: el motor completa un tamaño que la mezcla no nombra con el peso de su
 * diseño de partida (`organico/config.py`, `_peso_mezcla`), y un arco de solo 12″ salía con 5, 18 y 24″.
 */
export function mezclaDelPlan(cifras: CifrasPieza): Mezcla | null {
  const pesos = new Map(partes(TAMANOS_GUIRNALDA.map((tamano) => [String(tamano), cifras.porTamano[String(tamano)] ?? 0] as const)));
  if (!pesos.size) return null;
  return Object.fromEntries(TAMANOS_GUIRNALDA.map((tamano) => [String(tamano), pesos.get(String(tamano)) ?? 0])) as Mezcla;
}

/**
 * La paleta de la receta con el peso de cada color según sus globos en el plan. Un color que el plan no compra sale
 * de la paleta (el motor no lo pondría y el editor avisaría que no se compra); si no queda ninguno, null.
 */
export function paletaDelPlan(paleta: Paleta, cifras: CifrasPieza): Paleta | null {
  const pesos = new Map(partes(cifras.porMaterial.map((color) => [String(color.material), color.globos] as const)));
  const nueva = paleta.flatMap((color) => {
    const peso = pesos.get(String(color.material));
    return peso === undefined ? [] : [{ ...color, peso }];
  });
  return nueva.length ? nueva : null;
}

function acotar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

const redondear = (valor: number) => Math.round(valor * 100) / 100;

/** Qué se tomó del plan, para el registro: los campos del armado que cambiaron. */
export type Siembra<A> = { armado: A; desdeElPlan: string[] };

function conTamanosYColores<A extends { tamanos: { mezcla: Mezcla }; colores: { paleta: Paleta } }>(armado: A, cifras: CifrasPieza, desdeElPlan: string[]): A {
  const mezcla = mezclaDelPlan(cifras);
  const paleta = paletaDelPlan(armado.colores.paleta, cifras);
  if (mezcla) desdeElPlan.push("tamanos.mezcla");
  if (paleta) desdeElPlan.push("colores.paleta");
  return {
    ...armado,
    ...(mezcla ? { tamanos: { ...armado.tamanos, mezcla } } : {}),
    ...(paleta ? { colores: { ...armado.colores, paleta } } : {}),
  };
}

/**
 * La columna orgánica con el ancho del plan como grosor de la base (la punta conserva la proporción de la receta) y los
 * tamaños y colores del plan, dentro de los rangos que el motor dio para la receta. El alto ya lo pone la receta (el del
 * plan); el grosor no: la receta arranca con la base de 85 cm del diseñador y la columna de 0,55 m salía de 1,14 m.
 */
export function sembrarColumnaOrganica(receta: ArmadoColumnaOrganicaV1, cifras: CifrasPieza, limites: LimitesColumnaOrganica): Siembra<ArmadoColumnaOrganicaV1> {
  const desdeElPlan: string[] = [];
  let armado: ArmadoColumnaOrganicaV1 = { ...receta, origen: "decorador" };
  if (cifras.medidas.ancho_m) {
    const proporcion = receta.volumen.grosorPatasM > 0 ? receta.volumen.grosorCimaM / receta.volumen.grosorPatasM : 1;
    const base = acotar(cifras.medidas.ancho_m, limites.grosorBaseMin, limites.grosorBaseMax);
    const punta = acotar(base * proporcion, limites.grosorPuntaMin, Math.min(limites.grosorPuntaMax, base));
    armado = { ...armado, volumen: { ...armado.volumen, grosorPatasM: redondear(base), grosorCimaM: redondear(punta) } };
    desdeElPlan.push("volumen.grosorPatasM", "volumen.grosorCimaM");
  }
  return { armado: conTamanosYColores(armado, cifras, desdeElPlan), desdeElPlan };
}

/**
 * El arco (o medio arco) orgánico con los tamaños y colores del plan. Su forma NO se toca: la receta ya trae el ancho y
 * el alto del plan, y la de un semiarco es la forma lista de medio arco con el ancho que se ve
 * (`armado_semiarco_de_receta`), que el ancho del plan pondría al doble de angosto.
 */
export function sembrarArcoOrganico(receta: ArmadoArcoOrganicoV1, cifras: CifrasPieza): Siembra<ArmadoArcoOrganicoV1> {
  const desdeElPlan: string[] = [];
  return { armado: conTamanosYColores({ ...receta, origen: "decorador" }, cifras, desdeElPlan), desdeElPlan };
}

/** La guirnalda orgánica con los tamaños y colores del plan (el largo ya lo pone la receta, el del plan). */
export function sembrarGuirnaldaOrganica(receta: ArmadoGuirnaldaOrganicaV1, cifras: CifrasPieza): Siembra<ArmadoGuirnaldaOrganicaV1> {
  const desdeElPlan: string[] = [];
  return { armado: conTamanosYColores({ ...receta, origen: "decorador" }, cifras, desdeElPlan), desdeElPlan };
}

/** Cuánto se acepta de diferencia sin pedir otro dibujo: 10 % del plan, al menos 2 globos. */
export function toleranciaGlobos(objetivo: number): number {
  return Math.max(2, Math.round(objetivo * 0.1));
}

/**
 * El mismo armado con lo lleno corregido para acercar el total al del plan: el presupuesto de globos del motor es
 * proporcional a `volumen.relleno` (`organico/motor.py`). Null si ya está dentro de la tolerancia, si no hay con qué
 * comparar o si el relleno no se movería.
 */
export function conRellenoHacia<A extends { volumen: { relleno: number } }>(armado: A, actual: number, objetivo: number): A | null {
  if (actual <= 0 || objetivo <= 0 || Math.abs(actual - objetivo) <= toleranciaGlobos(objetivo)) return null;
  const relleno = Math.round(acotar(armado.volumen.relleno * (objetivo / actual), 0.05, 1) * 100) / 100;
  if (relleno === armado.volumen.relleno) return null;
  return { ...armado, volumen: { ...armado.volumen, relleno } };
}

// --- Los globos del dibujo y la comparación -----------------------------------------------------------------------

export type GlobosDibujo = {
  total: number;
  /** Globos por índice de material. */
  porMaterial: ReadonlyMap<number, number>;
  /** Pulgadas que el dibujo usa. */
  tamanos: readonly number[];
};

type FilaConteo = { material: number; cantidad: number; tamano?: number };

/** Agrupa el conteo del motor (lo que la pieza LLEVA, sin la reserva de compra). */
export function globosDelConteo(conteo: readonly FilaConteo[]): GlobosDibujo {
  const porMaterial = new Map<number, number>();
  const tamanos = new Set<number>();
  let total = 0;
  for (const fila of conteo) {
    porMaterial.set(fila.material, (porMaterial.get(fila.material) ?? 0) + fila.cantidad);
    if (typeof fila.tamano === "number") tamanos.add(fila.tamano);
    total += fila.cantidad;
  }
  return { total, porMaterial, tamanos: [...tamanos].sort((a, b) => a - b) };
}

export type Comparacion = {
  /** El dibujo lleva exactamente los globos de cada color del plan. */
  exacta: boolean;
  plan: { total: number; porMaterial: Array<{ material: number; globos: number }>; tamanos: number[] };
  dibujo: { total: number; porMaterial: Array<{ material: number; globos: number }>; tamanos: number[] };
};

export function compararConPlan(cifras: CifrasPieza, dibujo: GlobosDibujo): Comparacion {
  const materiales = [...new Set([...cifras.porMaterial.map((color) => color.material), ...dibujo.porMaterial.keys()])].sort((a, b) => a - b);
  const delPlan = (material: number) => cifras.porMaterial.find((color) => color.material === material)?.globos ?? 0;
  const delDibujo = (material: number) => dibujo.porMaterial.get(material) ?? 0;
  const tamanosPlan = Object.entries(cifras.porTamano).filter(([, cantidad]) => cantidad > 0).map(([tamano]) => Number(tamano)).sort((a, b) => a - b);
  return {
    exacta: cifras.total === dibujo.total && cifras.fueraDelMotor === 0 && materiales.every((material) => delPlan(material) === delDibujo(material)),
    plan: { total: cifras.total, porMaterial: materiales.map((material) => ({ material, globos: delPlan(material) })).filter((fila) => fila.globos > 0), tamanos: tamanosPlan },
    dibujo: { total: dibujo.total, porMaterial: materiales.map((material) => ({ material, globos: delDibujo(material) })).filter((fila) => fila.globos > 0), tamanos: [...dibujo.tamanos] },
  };
}

// --- Abrir el editor desde el plan ---------------------------------------------------------------------------------

/**
 * Cómo arrancó el editor: `plan` (con las cifras del plan), `receta` (el motor no aceptó las cifras del plan o el
 * plan no las trae: se ve el diseño de partida) o `guardado` (la pieza ya traía su armado).
 */
export type OrigenApertura = "plan" | "receta" | "guardado";
export type Apertura<V> = {
  vista: V;
  origen: OrigenApertura;
  /** Por qué no arrancó del plan (solo con `receta`). */
  motivo?: "sin_cifras" | "rechazo" | "fallo";
  /** Dibujos pedidos al motor para abrir. */
  pedidos: number;
  /** Los globos del plan y los del dibujo con que abrió (con `plan` y `receta`). */
  globosPlan?: number;
  globosDibujo?: number;
  desdeElPlan?: string[];
};

/** Cuántas veces se corrige lo lleno, como mucho, para acercar el dibujo al total del plan (un dibujo por vez). */
export const MAX_CORRECCIONES = 2;

/**
 * Abre el editor de una pieza SIN armado guardado con las cifras del plan: pide la receta (el armado completo de
 * partida y los rangos del motor), le pone las cifras del plan, la dibuja y, mientras el total quede fuera de la
 * tolerancia, corrige lo lleno (como mucho `MAX_CORRECCIONES` veces, de una en una, para no pedir dibujos a la vez).
 * Se queda con el dibujo más cercano al plan. Si el motor rechaza el armado sembrado o no responde, abre con la receta
 * y lo dice (`motivo`). Una cancelación se relanza tal cual.
 */
export async function abrirConElPlan<A, V extends { armado: A }>({ pedir, sembrar, globos, corregir, objetivo, esCancelacion }: {
  pedir: (armado: A | null) => Promise<V>;
  sembrar: (receta: V) => Siembra<A> | null;
  globos: (vista: V) => number;
  corregir: (armado: A, actual: number, objetivo: number) => A | null;
  objetivo: number;
  esCancelacion: (error: unknown) => boolean;
}): Promise<Apertura<V>> {
  const receta = await pedir(null);
  const siembra = sembrar(receta);
  if (!siembra || !siembra.desdeElPlan.length) return { vista: receta, origen: "receta", motivo: "sin_cifras", pedidos: 1, globosPlan: objetivo, globosDibujo: globos(receta) };
  let pedidos = 2;
  let mejor: { vista: V; total: number; corregido: boolean };
  try {
    const sembrada = await pedir(siembra.armado);
    mejor = { vista: sembrada, total: globos(sembrada), corregido: false };
  } catch (error) {
    if (esCancelacion(error)) throw error;
    const rechazo = typeof error === "object" && error !== null && "armadoInvalido" in error && (error as { armadoInvalido: unknown }).armadoInvalido === true;
    return { vista: receta, origen: "receta", motivo: rechazo ? "rechazo" : "fallo", pedidos, globosPlan: objetivo, globosDibujo: globos(receta), desdeElPlan: siembra.desdeElPlan };
  }
  let ultimo = mejor;
  for (let vuelta = 0; vuelta < MAX_CORRECCIONES; vuelta += 1) {
    const corregido = corregir(ultimo.vista.armado, ultimo.total, objetivo);
    if (!corregido) break;
    pedidos += 1;
    try {
      const vista = await pedir(corregido);
      ultimo = { vista, total: globos(vista), corregido: true };
    } catch (error) {
      if (esCancelacion(error)) throw error;
      break;
    }
    // En empate gana el anterior (menos cambios sobre lo que dijo el plan).
    if (Math.abs(ultimo.total - objetivo) < Math.abs(mejor.total - objetivo)) mejor = ultimo;
    else break;
  }
  return { vista: mejor.vista, origen: "plan", pedidos, globosPlan: objetivo, globosDibujo: mejor.total, desdeElPlan: [...siembra.desdeElPlan, ...(mejor.corregido ? ["volumen.relleno"] : [])] };
}
