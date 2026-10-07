import type { z } from "zod";
import { leyendaPatron, type ColorLeyenda } from "@/components/plan/patron/leyenda";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { OFICIALES_CON_DIBUJO_ESQUEMATICO } from "@/lib/plan/dibujo-estructura";
import { OFICIALES_SIN_MOTOR, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { lineasPorMaterial } from "@/lib/plan/material-de-linea";
import type { LineaMaterial } from "@/lib/plan/resuelto";
import { colorSempertex } from "./color-sempertex";
import { idOficial } from "./piezas-vista";

/**
 * Qué dibuja cada pieza de «Tu plan» y con qué editor se modifica: **el mismo que la vista clásica**
 * (`TarjetaPlanDecoracion` → `DetalleEstructura`). Sin React y sin red.
 *
 * Por qué existe (2026-10-06): la gráfica del plan guiado solo pedía el dibujo del motor cuando la pieza ya traía su
 * `armado_*`. Una pieza sin armado (la columna orgánica, que ningún paso del modelo arma; todo plan del Python del
 * VPS) iba a `/api/plan-dibujo-estructura`, que solo dibuja pared, aro, techo y centro de mesa: respondía 422 y la
 * tarjeta caía al icono genérico. Ahora una pieza sin armado pide al MISMO motor su receta (`armado_*: null`), que
 * es con lo que arranca el editor de la clásica; la cifra sigue siendo la de Python hasta que el cliente guarda.
 */

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

export type CampoArmado = "armado_arco" | "armado_arco_organico" | "armado_columna" | "armado_columna_organica" | "armado_guirnalda_organica";

export type MotorPieza =
  | { tipo: "motor"; campo: CampoArmado; ruta: string; armado: unknown | null }
  | { tipo: "dibujo" };

export const RUTA_MOTOR: Readonly<Record<CampoArmado, string>> = {
  armado_arco: "/api/plan-armado-arco",
  armado_arco_organico: "/api/plan-armado-arco-organico",
  armado_columna: "/api/plan-armado-columna",
  armado_columna_organica: "/api/plan-armado-columna-organica",
  armado_guirnalda_organica: "/api/plan-armado-guirnalda-organica",
};

/** El orden de la clásica: si una pieza trae los dos armados de su tipo, manda el clásico (`DetalleEstructura`). */
const PRIORIDAD: readonly CampoArmado[] = ["armado_arco", "armado_arco_organico", "armado_columna", "armado_columna_organica", "armado_guirnalda_organica"];

/** Sin armado guardado, el motor de su receta según la pieza oficial (la que el plan declara). */
const MOTOR_POR_OFICIAL: Partial<Record<EstructuraOficialId, CampoArmado>> = {
  arco: "armado_arco",
  arco_no_denso: "armado_arco",
  arco_asimetrico: "armado_arco_organico",
  semiarco: "armado_arco_organico",
  semiarco_asimetrico: "armado_arco_organico",
  columna: "armado_columna",
  columna_no_densa: "armado_columna",
  columna_asimetrica: "armado_columna_organica",
  guirnalda: "armado_guirnalda_organica",
};

/** Sin pieza oficial, por su tipo (el mismo reparto de `CLAVE_ARMADO`). */
const MOTOR_POR_TIPO: Readonly<Record<string, CampoArmado>> = {
  arco: "armado_arco",
  semiarco: "armado_arco_organico",
  columna: "armado_columna",
  guirnalda: "armado_guirnalda_organica",
};

/** Lo que se lee de la pieza declarada (`EstructuraPlan` o la pieza cruda que recibe la gráfica). */
export type PiezaDeclarada = { tipo?: unknown; estructura_oficial?: unknown; mezcla?: unknown } & Partial<Record<CampoArmado, unknown>>;

/** Mezclas de varios tamaños: la pieza es orgánica aunque su oficial sea la lisa (`MEZCLAS` de tipos.ts). */
const MEZCLAS_ORGANICAS: ReadonlySet<string> = new Set(["organica_fina", "organica_gruesa"]);

/**
 * «Arco orgánico» es el arco completo (`arco`, las dos patas en el piso) con mezcla de tamaños (hechos-cliente.ts,
 * PreguntaPropuesta): sin armado guardado se arma y se edita con el motor de arco orgánico, no con el de patrón
 * («Espiral» y franjas de un solo tamaño). Probador 124, hallazgo 4: el decorador pidió «arco orgánico de unos 3 m» y
 * «Modificar esta pieza» abría el arco clásico. Un arco de mezcla `clasica` (las ideas de arco de la biblioteca) sigue
 * con el de patrón.
 */
function campoSinArmado(campo: CampoArmado | undefined, pieza: PiezaDeclarada): CampoArmado | undefined {
  const organica = typeof pieza.mezcla === "string" && MEZCLAS_ORGANICAS.has(pieza.mezcla);
  return campo === "armado_arco" && organica ? "armado_arco_organico" : campo;
}

/**
 * El motor de la pieza y el armado con que se pide su dibujo (el guardado o `null` = su receta), o el dibujo
 * esquemático (pared, aro, techo, centro de mesa), o `null` si ningún dibujo la representa (bouquet, figura…):
 * entonces se ve su icono, sin pedir nada.
 */
export function motorDePieza(pieza: PiezaDeclarada): MotorPieza | null {
  const oficial = idOficial(pieza.estructura_oficial);
  if (oficial && OFICIALES_CON_DIBUJO_ESQUEMATICO.has(oficial)) return { tipo: "dibujo" };
  if (oficial && OFICIALES_SIN_MOTOR.has(oficial)) return null;
  const guardado = PRIORIDAD.find((campo) => pieza[campo] !== undefined && pieza[campo] !== null);
  if (guardado) return { tipo: "motor", campo: guardado, ruta: RUTA_MOTOR[guardado], armado: pieza[guardado] };
  const tipo = typeof pieza.tipo === "string" ? pieza.tipo : "";
  const campo = campoSinArmado(oficial ? MOTOR_POR_OFICIAL[oficial] : MOTOR_POR_TIPO[tipo], pieza);
  if (campo) return { tipo: "motor", campo, ruta: RUTA_MOTOR[campo], armado: null };
  return !oficial && (tipo === "pared" || tipo === "centro_mesa") ? { tipo: "dibujo" } : null;
}

type MaterialLeyendaPieza = { product_id: string; color?: string | undefined; acabado?: string | undefined };

/**
 * El material como se compra: si TODAS sus líneas las compra una sustitución (`variant_overrides`) de un solo color,
 * el producto, el color y el acabado de esas líneas (lo mismo que hace Python con `_named_by_purchase`: el burdeos de
 * la guirnalda del Día de la Madre se compra como un Infinity multicolor). Si no, el material declarado.
 */
function compradoPorSustitucion(material: MaterialLeyendaPieza, propias: readonly LineaMaterial[]): MaterialLeyendaPieza {
  if (!propias.length || propias.some((linea) => linea.product_id === material.product_id)) return material;
  const colores = new Set(propias.map((linea) => (linea.color ?? "").trim().toLocaleLowerCase("es")));
  const acabados = new Set(propias.map((linea) => linea.acabado ?? ""));
  const primera = propias[0]!;
  const color = colores.size === 1 && primera.color ? primera.color : material.color;
  const acabado = acabados.size === 1 && primera.acabado ? primera.acabado : colores.size === 1 ? undefined : material.acabado;
  return { product_id: primera.product_id, ...(color ? { color } : {}), ...(acabado ? { acabado } : {}) };
}

/**
 * La leyenda numerada de la pieza (color y tono Sempertex de cada material, en el orden de `materiales`), la misma
 * que arma la clásica: con ella el motor pinta y los editores nombran los colores.
 */
export function leyendaDePieza(plan: PlanGuiado, estructuraId: string): ColorLeyenda[] {
  const declarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  if (!declarada) return [];
  // Las líneas del plan guiado son las de Python tal cual (`BasePlanSchema` las deja pasar enteras).
  const lineas = (plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId)?.lineas ?? []) as unknown as LineaMaterial[];
  // Las líneas de cada material, también las que compra una sustitución (`variant_overrides`): antes se buscaban por
  // producto y el lila de la idea «rosa, lila y dorado», comprado como otro producto, salía sin nombre Sempertex.
  const porMaterial = lineasPorMaterial(declarada, lineas);
  const comprados = declarada.materiales.map((material, indice) => compradoPorSustitucion(material, porMaterial[indice] ?? []));
  const leyenda = leyendaPatron(comprados.map((material) => ({
    product_id: material.product_id,
    ...(material.color ? { color: material.color } : {}),
    ...(material.acabado ? { acabado: material.acabado } : {}),
  })), lineas);
  // Nombre y tono de la fuente única de la guiada (`color-sempertex`): el editor dice «Verde lima» y «Plata cromado»
  // como los chips, la tabla y los materiales, y su muestra lleva el tono del catálogo, no el de la paleta (antes:
  // «Verde lima mate» aquí y «Fashion Verde Lima» en la tarjeta; muestra azul rey y globo celeste).
  return leyenda.map((entrada, indice) => {
    const material = comprados[indice];
    if (!material?.color) return entrada;
    const propias = porMaterial[indice] ?? [];
    const linea = propias.find((item) => item.color === material.color) ?? propias[0];
    const sempertex = colorSempertex(material.color, { titulo: linea?.titulo ?? null, acabado: material.acabado ?? linea?.acabado ?? null });
    // El nombre, siempre el de los chips; el tono, solo con referencia del catálogo (un transparente o un multicolor
    // conservan su muestra especial).
    if (!sempertex.producto) return { ...entrada, etiqueta: sempertex.nombre, muestra: { ...entrada.muestra, etiqueta: sempertex.nombre } };
    const solida = /^#[0-9a-f]{6}$/i.test(entrada.muestra.fondo);
    return { ...entrada, etiqueta: sempertex.nombre, hex: sempertex.hex, muestra: { ...entrada.muestra, etiqueta: sempertex.nombre, ...(solida ? { fondo: sempertex.hex } : {}) } };
  });
}
