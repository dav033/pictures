import { ArmadoColumnaOrganicaV1Schema, type ArmadoColumnaOrganicaV1 } from "./armado-columna-organica";
import {
  LimitesColumnaOrganicaSchema,
  OpcionesArmadoColumnaOrganicaSchema,
  VistaColumnaOrganicaSchema,
  type LimitesColumnaOrganica,
  type OpcionesArmadoColumnaOrganica,
  type VistaColumnaOrganica,
} from "./opciones-armado-columna-organica";
import { FalloPlanArmado, publicar } from "./peticion-armado";
import type { PlanResuelto } from "./resuelto";

/**
 * Vista de la columna orgánica armada con el motor del diseñador (ADR-0034): el navegador manda el plan, la pieza, su
 * `armado_columna_organica` (o `null` para pedir la receta) y los tonos resueltos de la pieza a
 * /api/plan-armado-columna-organica, y recibe la columna colocada globo a globo, **su dibujo**, el armado con el que
 * se resolvió, las herramientas del diseñador (`opciones`) y los rangos vivos (`limites`).
 *
 * Aquí no se cuenta, no se mide y no se dibuja nada: este módulo es la puerta de la ruta y valida lo que llega con
 * los mismos esquemas que publica el contrato. El SVG lo escribe el mismo motor que colocó los globos, así que la
 * gráfica lo muestra tal cual (ADR-0034, consecuencia 2).
 *
 * No tiene nada que ver con `peticion-armado-columna.ts` (la torre de anillos y patrones): son dos editores
 * distintos sobre el mismo tipo de pieza y conviven. Los errores son los de las otras vistas previas de armado
 * (`FalloPlanArmado`): un armado que Python rechaza (`armado_invalido`) trae `motivo` estable y su frase en español
 * para el decorador. Sin React.
 */

export const RESPALDO_VISTA_ARMADO_COLUMNA_ORGANICA = "No pude dibujar la columna. Intenta de nuevo en un momento.";

export type { LimitesColumnaOrganica, OpcionesArmadoColumnaOrganica };

export type PeticionVistaArmadoColumnaOrganica = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la receta del motor para la pieza. */
  armado_columna_organica: ArmadoColumnaOrganicaV1 | null;
  /** Los tonos de la pieza, uno por material y en su orden: pintan, nunca cuentan. */
  colores?: readonly string[];
};

/** Todo lo que la ruta devuelve, ya validado: la columna con su dibujo, su armado y lo que el motor admite. */
export type VistaArmadoColumnaOrganica = VistaColumnaOrganica & {
  armado: ArmadoColumnaOrganicaV1;
  opciones: OpcionesArmadoColumnaOrganica;
  limites: LimitesColumnaOrganica;
};

/**
 * POST a /api/plan-armado-columna-organica. Una cancelación se relanza tal cual; cualquier otro fallo es un
 * `FalloPlanArmado`.
 *
 * La columna resuelta **no lleva `estructura_id`** (`ColumnaOrganicaResueltaSchema`), así que aquí no se puede
 * comprobar que la respuesta sea de la pieza pedida. Lo que la ata a la petición es el eco de `armado`, y eso ya lo
 * exige la frontera con Python (`llamarPythonPlanArmadoColumnaOrganica` rechaza con 502 una respuesta cuyo armado no
 * sea el que se mandó). Repetir la comprobación aquí sería un segundo dueño.
 */
export async function pedirVistaArmadoColumnaOrganica(
  cuerpo: PeticionVistaArmadoColumnaOrganica,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<VistaArmadoColumnaOrganica> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_ARMADO_COLUMNA_ORGANICA;
  const datos = await publicar("/api/plan-armado-columna-organica", cuerpo, respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  // Por campo y no con un esquema del cuerpo entero: `VistaColumnaOrganicaSchema` es estricto y solo describe la
  // columna y su gráfica, que es justo lo que el contrato publica de esos dos.
  const vista = VistaColumnaOrganicaSchema.safeParse({ columna: objeto.columna, grafica: objeto.grafica });
  const armado = ArmadoColumnaOrganicaV1Schema.safeParse(objeto.armado);
  const admitidas = OpcionesArmadoColumnaOrganicaSchema.safeParse(objeto.opciones);
  const limites = LimitesColumnaOrganicaSchema.safeParse(objeto.limites);
  if (!vista.success || !armado.success || !admitidas.success || !limites.success) {
    const fallo = [vista, armado, admitidas, limites].find((leido) => !leido.success);
    throw new FalloPlanArmado(respaldo, { cause: fallo?.success === false ? fallo.error : undefined });
  }
  return { ...vista.data, armado: armado.data, opciones: admitidas.data, limites: limites.data };
}
