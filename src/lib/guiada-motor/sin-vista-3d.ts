import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";

/**
 * Las piezas que la vista 3D todavía no dibuja (CUS-03) y lo que el cliente lee de un plan de Python que las lleva. Sin
 * `server-only` y sin importar nada del motor: lo usan el motor (`representable.ts` las devuelve como `fallback`) y la tarjeta
 * del plan en el navegador, así que hay una sola tabla.
 */

/** Las estructuras que ningún constructor del motor arma, cualquiera sea su forma. */
export const ESTRUCTURAS_SIN_VISTA_3D = ["figura", "centro_mesa", "pared_organica", "pared_no_densa"] as const satisfies readonly EstructuraOficialId[];
export type EstructuraSinVista3d = (typeof ESTRUCTURAS_SIN_VISTA_3D)[number];

export const esSinVista3d = (oficial: string | undefined): oficial is EstructuraSinVista3d => (ESTRUCTURAS_SIN_VISTA_3D as readonly (string | undefined)[]).includes(oficial);

/** El aro circular solo falla en su forma «parcial» (media luna, diagonal): el motor solo arma el aro entero. */
export const esAroParcial = (oficial: string | undefined, forma: string | undefined): boolean => oficial === "aro_circular" && forma === "parcial";

export type EstructuraParaAviso = { estructura_oficial?: string | undefined; forma?: string | undefined };

/** «la figura con globos», «el centro de mesa con globos»: el nombre del catálogo oficial con su artículo, como lo dice la tarjeta. */
function nombreEnAviso(oficial: EstructuraOficialId): string {
  return `${FEMENINAS.has(oficial) ? "la" : "el"} ${ESTRUCTURAS_OFICIALES[oficial].nombre.toLocaleLowerCase("es")}`;
}

function nombreSinVista3d(estructura: EstructuraParaAviso): string | undefined {
  if (esAroParcial(estructura.estructura_oficial, estructura.forma)) return `${nombreEnAviso("aro_circular")} parcial`;
  return esSinVista3d(estructura.estructura_oficial) ? nombreEnAviso(estructura.estructura_oficial) : undefined;
}

/** «a», «a y b», «a, b y c». */
function unir(nombres: readonly string[]): string {
  return nombres.length <= 1 ? (nombres[0] ?? "") : `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}`;
}

/**
 * La frase para el cliente de un plan que lleva piezas sin vista 3D, o `[]` si no trae ninguna. Es verdad cómo se haya armado el
 * plan (el 3D no pudo, la bandera estaba en Python o salió de una foto): solo dice qué no se dibuja y qué dibujo ve. Una sola
 * frase por plan: nombra cada pieza una vez aunque el plan repita la estructura.
 */
export function avisosSinVista3d(plan: { plan: { estructuras: readonly EstructuraParaAviso[] } }): string[] {
  const nombres = [...new Set(plan.plan.estructuras.flatMap((estructura) => nombreSinVista3d(estructura) ?? []))];
  if (!nombres.length) return [];
  return [`La vista 3D todavía no dibuja ${unir(nombres)}: en este plan ves el dibujo de siempre.`];
}
