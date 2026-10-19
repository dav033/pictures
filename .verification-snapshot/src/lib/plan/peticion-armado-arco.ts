import { ArmadoArcoV1Schema, VistaArcoSchema, type ArmadoArcoV1, type VistaArco } from "./armado-arco";
import { LimitesArcoSchema, OpcionesArmadoArcoSchema, type LimitesArco, type OpcionesArmadoArco } from "./opciones-armado-arco";
import { FalloPlanArmado, publicar } from "./peticion-armado";
import type { PlanResuelto } from "./resuelto";

/**
 * Vista del arco armado con el motor del diseñador (ADR-0034): el navegador manda el plan, la pieza, su
 * `armado_arco` (o `null` para pedir la receta) y los tonos resueltos de la pieza a
 * /api/plan-armado-arco, y recibe el arco colocado globo a globo, **su dibujo**, el armado con el que se
 * resolvió, las herramientas del diseñador (`opciones`) y los rangos vivos (`limites`).
 *
 * Aquí no se cuenta, no se mide y no se dibuja nada: este módulo es la puerta de la ruta y valida lo que
 * llega con los mismos esquemas que publica el contrato. El SVG lo escribe el mismo motor que colocó los
 * globos, así que la gráfica lo muestra tal cual (ADR-0034, consecuencia 2).
 *
 * Los errores son los de las otras vistas previas de armado (`FalloPlanArmado`): un armado que Python
 * rechaza (`armado_invalido`) trae `motivo` estable y su frase en español para el decorador. Sin React.
 */

export const RESPALDO_VISTA_ARMADO_ARCO = "No pude dibujar el arco. Intenta de nuevo en un momento.";

export type { LimitesArco, OpcionesArmadoArco };

export type PeticionVistaArmadoArco = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la receta del motor para la pieza. */
  armado_arco: ArmadoArcoV1 | null;
  /** Los tonos de la pieza, uno por material y en su orden: pintan, nunca cuentan. */
  colores?: readonly string[];
};

/** Todo lo que la ruta devuelve, ya validado: el arco con su dibujo, su armado y lo que el motor admite. */
export type VistaArmadoArco = VistaArco & {
  armado: ArmadoArcoV1;
  opciones: OpcionesArmadoArco;
  limites: LimitesArco;
};

/**
 * POST a /api/plan-armado-arco. Una cancelación se relanza tal cual; cualquier otro fallo es un
 * `FalloPlanArmado`.
 *
 * A diferencia de la guirnalda, el arco resuelto **no lleva `estructura_id`** (`ArcoResueltoSchema`), así que
 * aquí no se puede comprobar que la respuesta sea de la pieza pedida. Lo que la ata a la petición es el eco
 * de `armado`, y eso ya lo exige la frontera con Python (`llamarPythonPlanArmadoArco` rechaza con 502 una
 * respuesta cuyo armado no sea el que se mandó). Repetir la comprobación aquí sería un segundo dueño.
 */
export async function pedirVistaArmadoArco(
  cuerpo: PeticionVistaArmadoArco,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<VistaArmadoArco> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_ARMADO_ARCO;
  const datos = await publicar("/api/plan-armado-arco", cuerpo, respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  // Por campo y no con un esquema del cuerpo entero: `VistaArcoSchema` es estricto y solo describe el arco y
  // su gráfica, que es justo lo que el contrato publica de esos dos.
  const vista = VistaArcoSchema.safeParse({ arco: objeto.arco, grafica: objeto.grafica });
  const armado = ArmadoArcoV1Schema.safeParse(objeto.armado);
  const admitidas = OpcionesArmadoArcoSchema.safeParse(objeto.opciones);
  const limites = LimitesArcoSchema.safeParse(objeto.limites);
  if (!vista.success || !armado.success || !admitidas.success || !limites.success) {
    const fallo = [vista, armado, admitidas, limites].find((leido) => !leido.success);
    throw new FalloPlanArmado(respaldo, { cause: fallo?.success === false ? fallo.error : undefined });
  }
  return { ...vista.data, armado: armado.data, opciones: admitidas.data, limites: limites.data };
}
