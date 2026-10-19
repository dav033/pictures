import { z } from "zod";
import type { EstructuraOficialId } from "./estructuras-oficiales";

/**
 * El dibujo esquemático de una pieza que ningún motor arma: la pared, el aro circular, el techo de globos y
 * el centro de mesa (ADR-0034).
 *
 * **Qué tiene de distinto frente a los cuatro armados del motor.** Esos resuelven una pieza globo a globo y
 * devuelven además su conteo, su compra, sus medidas reales y sus avisos. Estas cuatro estructuras no tienen
 * diseñador ni motor, así que lo único que hay es el dibujo: Python lo porta de `referencias/dibujos.ts` del
 * clasificador, que lo dice en su encabezado — «No calculan cantidades: la medida es la típica de cada
 * estructura». Lo que la pieza lleva, cuesta y se compra sigue siendo lo que calculó `plan.py`, y el aro se
 * cuenta con su `π × diámetro`.
 *
 * Por eso aquí no hay nada que guardar y la interfaz lo muestra en solo lectura: no hay armado que escribir en
 * el plan ni cantidad que cambie al tocar algo. El SVG es derivado y nunca entra en el plan, en el snapshot ni
 * en `plan_hash`.
 */

/**
 * El lienzo del dibujo y el interior de su `<svg>`. **El lienzo no es cuadrado y cambia con la pieza** (600 ×
 * 560 la pared, 600 × 600 el aro y el centro de mesa, 640 × 420 el techo), así que los dos lados viajan y la
 * interfaz no inventa ninguno.
 */
export const GraficaDibujoEstructuraSchema = z
  .object({
    ancho: z.number().int().positive(),
    alto: z.number().int().positive(),
    svg: z.string().min(1),
  })
  .strict();

export type GraficaDibujoEstructura = z.infer<typeof GraficaDibujoEstructuraSchema>;

/**
 * Las estructuras oficiales que tienen dibujo esquemático. Es lo único que el navegador necesita saber:
 * **cuál** de los cuatro dibujos le toca a cada una lo decide Python, que es su dueño
 * (`services/ai-api/app/dibujo_estructura.py`, `DIBUJO_POR_OFICIAL`), y esta lista solo dice si vale la pena
 * preguntar. El tipo `EstructuraOficialId` impide que un id inventado entre aquí.
 *
 * Las tres paredes son la misma pieza con tres densidades y comparten dibujo. Las que faltan o las arma un
 * motor —y entonces el dibujo es el de su propio bloque, que coloca cada globo— o no tienen forma fija: el
 * bouquet tiene su propio armado y la figura puede ser cualquier cosa.
 */
export const OFICIALES_CON_DIBUJO_ESQUEMATICO: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>([
  "pared_densa",
  "pared_no_densa",
  "pared_organica",
  "aro_circular",
  "techo_globos",
  "centro_mesa",
]);
