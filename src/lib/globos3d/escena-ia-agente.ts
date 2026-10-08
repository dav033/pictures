import { z } from "zod";
import type { Escena } from "./escena";

/**
 * Lo que la ruta /api/escena-ia suma al agente de escena (2026-10-08) sin tocar su sistema base:
 * - la **pieza elegida** en el editor (y la raíz del editor solitario) viaja con cada pedido: «esta», «la elegida»,
 *   «cámbiale…» o un pedido sin pieza nombrada van sobre ella;
 * - **preguntar** solo ante ambigüedad real (preguntar_usuario corta el turno y el taller muestra botones);
 * - **grupos y disposición** (seleccionar_grupo, contar_globos, alinear, distribuir, espejar);
 * - **verificación**: tras cada cambio el modelo recibe lo que de verdad cambió y debe citarlo en su respuesta.
 */

const Ref = z.object({ id: z.string().min(1).max(80), nombre: z.string().max(120) });

export const SeleccionSchema = Ref.extend({ raizSolitario: Ref.nullable().optional() }).nullable().optional();
export type SeleccionEscena = z.infer<typeof SeleccionSchema>;

/**
 * Las líneas de contexto de la selección para el mensaje al modelo (solo con ids que existen en la escena; lo
 * demás se descarta). Vacío si no hay nada elegido.
 */
export function textoSeleccion(escena: Escena, seleccion: SeleccionEscena): string {
  if (!seleccion) return "";
  const nodo = (id: string) => escena.nodos.find((n) => n.id === id);
  const lineas: string[] = [];
  const elegida = nodo(seleccion.id);
  if (elegida) lineas.push(`[Pieza elegida en el editor: ${elegida.id} «${elegida.nombre}» (${elegida.pieza.tipo}). «Esta», «la elegida» o un pedido que no nombra pieza van sobre ella.]`);
  const raiz = seleccion.raizSolitario ? nodo(seleccion.raizSolitario.id) : undefined;
  if (raiz) lineas.push(`[Editando sola la estructura ${raiz.id} «${raiz.nombre}» (${raiz.pieza.tipo}) en el editor solitario: lo pedido va sobre ella o lo que lleva encima.]`);
  return lineas.join("\n");
}

/** ¿La selección nombra piezas que existen? (para el registro: lo que llegó y lo que se usó). */
export function seleccionValida(escena: Escena, seleccion: SeleccionEscena): boolean {
  return !!seleccion && escena.nodos.some((n) => n.id === seleccion.id);
}

export const REGLAS_AGENTE = `PIEZA ELEGIDA, GRUPOS Y PREGUNTAS:
- Si el mensaje trae [Pieza elegida en el editor: id …], «esta», «esta columna», «la elegida», «cámbiale/ponle/hazla…» son ESA pieza. Si el pedido no nombra ninguna pieza y hay una elegida, actúa sobre ella sin preguntar. Si nombra otra, manda lo nombrado. [Editando sola …]: el usuario está en el editor de esa estructura.
- Grupos: «las dos columnas», «todas las guirnaldas», «la columna izquierda», «las flores de la columna izquierda» → seleccionar_grupo para tener sus ids; después actúa sobre cada id.
- Ambigüedad: si dos o más piezas encajan con lo pedido («cambia la columna» y hay dos), NO hay pieza elegida y el pedido no dice cuál (ni «las dos», «todas»), llama preguntar_usuario con una pregunta corta y 2 a 4 opciones listas para mandarse como pedido («la columna izquierda», «la columna derecha», «las dos»); en ese turno no cambies nada. Si solo una encaja, hay una elegida, o el plural lo resuelve, NO preguntes.
- Disposición: «alinea», «en fila», «a la misma altura», «céntralo» → alinear; «repártelas parejas entre…» → distribuir; «una igual al otro lado», «en espejo», «simétrica» → espejar (respecto_id = el arco si lo dice). «¿Cuántos R-24…?», «¿cuántos globos…?» → contar_globos (formatos «R-24», «LOL-*» = link-o-loon, «T-*» = tubitos).
- Verificación: después de cada cambio llega «Verificación automática» con lo que DE VERDAD cambió (piezas antes → después y globos por formato antes → después). Si no es lo pedido (no subió, cambió otra pieza), corrígelo antes de terminar. En la respuesta final di esos números concretos («R-24: 6 → 14», «4 → 6 piezas»).`;
