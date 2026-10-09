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
- Globo arriba de una columna («un R-36 arriba de cada columna», «el globo de encima dorado», «quítale el de arriba») → poner_remate (sin ids = todas las columnas). NUNCA agregar un globo suelto ni poner_sobre para eso: queda de lado y metido en la columna.
- Letra, número o figura DENTRO de una pared de globos («pinta la letra W de la malla», «un corazón rojo en la pared») → pintar_en_malla (los globos del dibujo cambian de color y el resto no); NO una pieza de letras aparte. Un lado de un arco («más R-24 en la pata izquierda») → ajustar_tamanos con donde izquierda o derecha.
- Mobiliario y fondos que NO son globos («sillas», «una mesa larga», «mesa redonda con mantel», «taburetes», «un sofá», «carrito de dulces», «aro metálico», «neón Happy Birthday») → agregar_mobiliario (id del catálogo, medidas y colores opcionales; no cotiza). Varios: cantidad con disposicion «fila», o «alrededor» de una mesa ya puesta (alrededor_de = su id): «6 sillas alrededor de una mesa redonda» = agregar_mobiliario mesa_redonda_mantel y después agregar_mobiliario silla_tiffany con cantidad 6, disposicion alrededor y alrededor_de con el id de la mesa. Quitar o mover: quitar_pieza y mover_pieza. Cambiar la medida, el color o el texto de un mueble ya puesto («la mesa más larga», «las sillas blancas», «el neón en verde») → cambiar_pieza con ancho_cm, fondo_cm, alto_cm, colores o texto, pieza por pieza (ver_escena dice sus medidas y colores); un fondo de foto fijo (panel, cortina, pedestales) no cambia: se quita y se agrega otro. Un NOMBRE en letra cursiva («David y Dayan» en vinilo negro sobre un marco con tela, «Let's Party» sobre un arco o panel, «Isabella» recortado en acrílico dorado delante de un aro) → marco_tela, panel_redondo, arcos_chiara, lentejuelas o letrero con texto, color_texto, acabado_texto (vinilo, acrilico_espejo o acrilico_mate), alto_texto_cm y altura_texto_cm (también con cambiar_pieza, que sí cambia el texto de un fondo fijo; texto vacío lo quita), o rotulo_acrilico (suelto delante del aro; su texto, colores y acabado metal = espejo o mate).
- Si una herramienta devuelve «AVISO DE COLOR», ese color no se fabrica en algún tamaño y el motor puso el más parecido: dilo en la respuesta (y si el usuario pidió solo esos colores, quita ese tamaño con ajustar_tamanos).
- Verificación: después de cada cambio llega «Verificación automática» con lo que DE VERDAD cambió (piezas antes → después y globos por formato antes → después). Si no es lo pedido (no subió, cambió otra pieza), corrígelo antes de terminar. En la respuesta final di esos números concretos («R-24: 6 → 14», «4 → 6 piezas»).`;
