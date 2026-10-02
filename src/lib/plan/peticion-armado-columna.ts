import { ArmadoColumnaV1Schema, VistaColumnaSchema, type ArmadoColumnaV1, type VistaColumna } from "./armado-columna";
import { LimitesColumnaSchema, OpcionesArmadoColumnaSchema, type LimitesColumna, type OpcionesArmadoColumna } from "./opciones-armado-columna";
import { FalloPlanArmado, publicar } from "./peticion-armado";
import type { PlanResuelto } from "./resuelto";

/**
 * Vista de la columna armada con el motor del diseñador (ADR-0034, ADR-0035 paso 3): el navegador manda el plan,
 * la pieza, su `armado_columna` (o `null` para pedir la receta) y los tonos resueltos de la pieza a
 * /api/plan-armado-columna, y recibe la columna colocada globo a globo, **su dibujo**, el armado con el que se
 * resolvió, las herramientas del diseñador (`opciones`) y los rangos vivos (`limites`).
 *
 * Aquí no se cuenta, no se mide y no se dibuja nada: este módulo es la puerta de la ruta y valida lo que llega con
 * los mismos esquemas que publica el contrato. El SVG lo escribe el mismo motor que colocó los globos, así que la
 * gráfica lo muestra tal cual (ADR-0034, consecuencia 2).
 *
 * Los errores son los de las otras vistas previas de armado (`FalloPlanArmado`): un armado que Python rechaza
 * (`armado_invalido`) trae `motivo` estable y su frase en español para el decorador. Sin React.
 */

export const RESPALDO_VISTA_ARMADO_COLUMNA = "No pude dibujar la columna. Intenta de nuevo en un momento.";

export type { LimitesColumna, OpcionesArmadoColumna };

export type PeticionVistaArmadoColumna = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la receta del motor para la pieza. */
  armado_columna: ArmadoColumnaV1 | null;
  /** Los tonos de la pieza, uno por material y en su orden: pintan, nunca cuentan. */
  colores?: readonly string[];
};

/** Todo lo que la ruta devuelve, ya validado: la columna con su dibujo, su armado y lo que el motor admite. */
export type VistaArmadoColumna = VistaColumna & {
  armado: ArmadoColumnaV1;
  opciones: OpcionesArmadoColumna;
  limites: LimitesColumna;
};

/**
 * POST a /api/plan-armado-columna. Una cancelación se relanza tal cual; cualquier otro fallo es un
 * `FalloPlanArmado`.
 *
 * La columna resuelta no lleva `estructura_id`, así que aquí no se puede comprobar que la respuesta sea de la
 * pieza pedida. Lo que la ata a la petición es el eco de `armado`, y eso ya lo exige la frontera con Python
 * (`llamarPythonPlanArmadoColumna` rechaza con 502 una respuesta cuyo armado no sea el que se mandó).
 */
export async function pedirVistaArmadoColumna(
  cuerpo: PeticionVistaArmadoColumna,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<VistaArmadoColumna> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_ARMADO_COLUMNA;
  const datos = await publicar("/api/plan-armado-columna", cuerpo, respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  // Por campo y no con un esquema del cuerpo entero: `VistaColumnaSchema` es estricto y solo describe la columna
  // y su gráfica, que es justo lo que el contrato publica de esos dos.
  const vista = VistaColumnaSchema.safeParse({ columna: objeto.columna, grafica: objeto.grafica });
  const armado = ArmadoColumnaV1Schema.safeParse(objeto.armado);
  const admitidas = OpcionesArmadoColumnaSchema.safeParse(objeto.opciones);
  const limites = LimitesColumnaSchema.safeParse(objeto.limites);
  if (!vista.success || !armado.success || !admitidas.success || !limites.success) {
    const fallo = [vista, armado, admitidas, limites].find((leido) => !leido.success);
    throw new FalloPlanArmado(respaldo, { cause: fallo?.success === false ? fallo.error : undefined });
  }
  return { ...vista.data, armado: armado.data, opciones: admitidas.data, limites: limites.data };
}
