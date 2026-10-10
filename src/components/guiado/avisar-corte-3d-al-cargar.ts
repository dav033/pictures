import type { MotorGuiada } from "@/lib/guiada-motor/tipos";
import { avisarCorte3d, hashAvisoCorteAlCargar } from "./aviso-corte-3d";
import { pedirMotorGuiada, type LecturaBandera } from "./usarMotorGuiada";

/** Lo que de un plan guardado hace falta para decidir: su motor y su hash. */
export type PlanParaAviso = { motor: MotorGuiada; plan: { plan_hash: string } };

/**
 * Al cargar una conversación: si el plan vigente es del 3D, pregunta una vez (la lectura de la bandera que ya existe; sin
 * sondeo) si el corte está puesto, y si lo está avisa antes de que el cliente intente un cambio. Un plan de Python no hace
 * ninguna petición. Un fallo de la lectura no avisa: el aviso llega entonces por la primera respuesta del 3D que diga
 * `MOTOR_3D_CORTADO`.
 */
export async function avisarAlCargarPlan(plan: PlanParaAviso | null, leer: () => Promise<LecturaBandera> = () => pedirMotorGuiada()): Promise<void> {
  if (plan?.motor !== "3d") return;
  const lectura = await leer();
  const hash = hashAvisoCorteAlCargar(plan.plan.plan_hash, lectura.fuente);
  if (hash) avisarCorte3d(hash, "carga");
}
