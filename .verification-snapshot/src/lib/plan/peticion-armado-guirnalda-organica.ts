import { ArmadoGuirnaldaOrganicaV1Schema, type ArmadoGuirnaldaOrganicaV1 } from "./armado-guirnalda-organica";
import {
  LimitesGuirnaldaOrganicaSchema,
  OpcionesArmadoGuirnaldaOrganicaSchema,
  VistaGuirnaldaOrganicaSchema,
  type LimitesGuirnaldaOrganica,
  type OpcionesArmadoGuirnaldaOrganica,
  type VistaGuirnaldaOrganica,
} from "./opciones-armado-guirnalda-organica";
import { FalloPlanArmado, publicar } from "./peticion-armado";
import type { PlanResuelto } from "./resuelto";

/**
 * Vista de la guirnalda orgánica armada con el motor del diseñador (ADR-0034): el navegador manda el plan, la
 * pieza, su `armado_guirnalda_organica` (o `null` para pedir la receta) y los tonos resueltos de la pieza a
 * /api/plan-armado-guirnalda-organica, y recibe la guirnalda colocada globo a globo, **su dibujo**, el armado
 * con el que se resolvió, las herramientas del diseñador (`opciones`) y los rangos vivos (`limites`).
 *
 * Aquí no se cuenta, no se mide y no se dibuja nada: este módulo es la puerta de la ruta y valida lo que
 * llega con los mismos esquemas que publica el contrato. El SVG lo escribe el mismo motor que colocó los
 * globos, así que la gráfica lo muestra tal cual (ADR-0034, consecuencia 2).
 *
 * No tiene nada que ver con `peticion-armado-guirnalda.ts` (ADR-0032: racimos, relleno y remates): son dos
 * editores distintos sobre la misma pieza y conviven. Los errores son los de las otras vistas previas de
 * armado (`FalloPlanArmado`): un armado que Python rechaza (`armado_invalido`) trae `motivo` estable y su
 * frase en español para el decorador. Sin React.
 */

export const RESPALDO_VISTA_ARMADO_GUIRNALDA_ORGANICA = "No pude dibujar la guirnalda. Intenta de nuevo en un momento.";

export type { LimitesGuirnaldaOrganica, OpcionesArmadoGuirnaldaOrganica };

export type PeticionVistaArmadoGuirnaldaOrganica = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la receta del motor para la pieza. */
  armado_guirnalda_organica: ArmadoGuirnaldaOrganicaV1 | null;
  /** Los tonos de la pieza, uno por material y en su orden: pintan, nunca cuentan. */
  colores?: readonly string[];
};

/** Todo lo que la ruta devuelve, ya validado: la guirnalda con su dibujo, su armado y lo que el motor admite. */
export type VistaArmadoGuirnaldaOrganica = VistaGuirnaldaOrganica & {
  armado: ArmadoGuirnaldaOrganicaV1;
  opciones: OpcionesArmadoGuirnaldaOrganica;
  limites: LimitesGuirnaldaOrganica;
};

/**
 * POST a /api/plan-armado-guirnalda-organica. Una cancelación se relanza tal cual; cualquier otro fallo es un
 * `FalloPlanArmado`.
 *
 * La guirnalda resuelta **no lleva `estructura_id`** (`GuirnaldaOrganicaResueltaSchema`), así que aquí no se
 * puede comprobar que la respuesta sea de la pieza pedida. Lo que la ata a la petición es el eco de `armado`,
 * y eso ya lo exige la frontera con Python (`llamarPythonPlanArmadoGuirnaldaOrganica` rechaza con 502 una
 * respuesta cuyo armado no sea el que se mandó). Repetir la comprobación aquí sería un segundo dueño.
 */
export async function pedirVistaArmadoGuirnaldaOrganica(
  cuerpo: PeticionVistaArmadoGuirnaldaOrganica,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<VistaArmadoGuirnaldaOrganica> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_ARMADO_GUIRNALDA_ORGANICA;
  const datos = await publicar("/api/plan-armado-guirnalda-organica", cuerpo, respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  // Por campo y no con un esquema del cuerpo entero: `VistaGuirnaldaOrganicaSchema` es estricto y solo
  // describe la guirnalda y su gráfica, que es justo lo que el contrato publica de esos dos.
  const vista = VistaGuirnaldaOrganicaSchema.safeParse({ guirnalda: objeto.guirnalda, grafica: objeto.grafica });
  const armado = ArmadoGuirnaldaOrganicaV1Schema.safeParse(objeto.armado);
  const admitidas = OpcionesArmadoGuirnaldaOrganicaSchema.safeParse(objeto.opciones);
  const limites = LimitesGuirnaldaOrganicaSchema.safeParse(objeto.limites);
  if (!vista.success || !armado.success || !admitidas.success || !limites.success) {
    const fallo = [vista, armado, admitidas, limites].find((leido) => !leido.success);
    throw new FalloPlanArmado(respaldo, { cause: fallo?.success === false ? fallo.error : undefined });
  }
  return { ...vista.data, armado: armado.data, opciones: admitidas.data, limites: limites.data };
}
