import { GraficaDibujoEstructuraSchema, type GraficaDibujoEstructura } from "./dibujo-estructura";
import { FalloPlanArmado, publicar } from "./peticion-armado";
import type { EstructuraResuelta, PlanResuelto } from "./resuelto";

/**
 * Dibujo esquemático de una pieza que ningún motor arma (ADR-0034): el navegador manda el plan, la pieza y su
 * mezcla de tamaños ya resuelta a /api/plan-dibujo-estructura, y recibe **solo la gráfica** — el lienzo y el
 * interior del `<svg>`.
 *
 * Aquí no se cuenta, no se mide y no se dibuja nada: este módulo es la puerta de la ruta y valida lo que llega
 * con el esquema que publica `dibujo-estructura.ts`. El dibujo lo escribe Python, portado 1 a 1 de
 * `referencias/dibujos.ts` del clasificador.
 *
 * No tiene nada que ver con `peticion-armado-arco-organico.ts` ni con las otras tres vistas previas de armado:
 * aquellas resuelven un armado del motor y traen además el conteo, la compra y los avisos de la pieza. Estas
 * cuatro estructuras no tienen motor, así que no hay armado que mandar ni cifras que recibir — las de la pieza
 * son las que ya calculó Python al resolver el plan. Los errores son los de las otras vistas previas
 * (`FalloPlanArmado`). Sin React.
 */

export const RESPALDO_DIBUJO_ESTRUCTURA = "No pude dibujar esta pieza. Intenta de nuevo en un momento.";

/** Una línea de la mezcla real de la pieza, tal como la publica `plan_resuelto.estructuras[].mezcla_real`. */
export type LineaMezclaReal = EstructuraResuelta["mezcla_real"][number];

export type PeticionDibujoEstructura = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** La mezcla de tamaños que la resolución calculó para la pieza: el dibujo la reparte, nunca la recalcula. */
  mezcla_real?: readonly LineaMezclaReal[];
};

/**
 * POST a /api/plan-dibujo-estructura. Una cancelación se relanza tal cual; cualquier otro fallo es un
 * `FalloPlanArmado`.
 *
 * La respuesta no se puede atar a la pieza pedida: la gráfica es un SVG y no lleva el `estructura_id`. Lo que
 * la ata es que el cliente cancela lo que ya no quiere (`AbortController`) y descarta lo que llega de una
 * petición que no es la última, igual que los bloques de los motores.
 */
export async function pedirDibujoEstructura(
  cuerpo: PeticionDibujoEstructura,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<GraficaDibujoEstructura> {
  const respaldo = opciones.respaldo ?? RESPALDO_DIBUJO_ESTRUCTURA;
  const datos = await publicar("/api/plan-dibujo-estructura", cuerpo, respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  const grafica = GraficaDibujoEstructuraSchema.safeParse(objeto.grafica);
  if (!grafica.success) throw new FalloPlanArmado(respaldo, { cause: grafica.error });
  return grafica.data;
}
