import type { z } from "zod";
import { leyendaPatron, type ColorLeyenda } from "@/components/plan/patron/leyenda";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { OFICIALES_CON_DIBUJO_ESQUEMATICO } from "@/lib/plan/dibujo-estructura";
import { OFICIALES_SIN_MOTOR, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { LineaMaterial } from "@/lib/plan/resuelto";
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
export type PiezaDeclarada = { tipo?: unknown; estructura_oficial?: unknown } & Partial<Record<CampoArmado, unknown>>;

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
  const campo = oficial ? MOTOR_POR_OFICIAL[oficial] : MOTOR_POR_TIPO[tipo];
  if (campo) return { tipo: "motor", campo, ruta: RUTA_MOTOR[campo], armado: null };
  return !oficial && (tipo === "pared" || tipo === "centro_mesa") ? { tipo: "dibujo" } : null;
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
  return leyendaPatron(declarada.materiales.map((material) => ({
    product_id: material.product_id,
    ...(material.color ? { color: material.color } : {}),
    ...(material.acabado ? { acabado: material.acabado } : {}),
  })), lineas);
}
