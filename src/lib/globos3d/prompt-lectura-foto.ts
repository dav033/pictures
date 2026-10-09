import { coloresDelFormato } from "./formatos";
import { RACIMOS_PREDEFINIDOS } from "./racimos-globos";
import { REFERENCIAS_DUENO, type ReferenciaDueno } from "./referencias-dueno";

/**
 * El prompt con que Gemini LEE una foto de decoración (`leer-foto-ia.ts`): el oficio (qué es cada pieza del taller),
 * las reglas de medida y color, y 3 o 4 lecturas hechas a mano por el dueño como ejemplo del formato exacto (JSON, sin
 * imágenes). Puro: sin red, así que se prueba.
 *
 * Las lecturas de ejemplo salen de `referencias-dueno.ts`. Al evaluar una de esas 13 fotos se excluye de los ejemplos
 * (`excluirIds`): si no, el modelo podría copiar la respuesta en vez de leerla.
 */

/** Orden de preferencia de los ejemplos: variados (medio arco con fondos, portal clásico, follaje con foil, columnas libres). */
const EJEMPLOS_PREFERIDOS: readonly string[] = [
  "referencia:happy-birthday-azul-dorado-redondo",
  "referencia:portal-rojo-orbes",
  "referencia:guirnalda-love-monstera",
  "referencia:graduacion-columnas-uvas",
  "referencia:dino-menta-mesa",
  "referencia:guirnalda-feston-vino-rosa",
];
const CUANTOS_EJEMPLOS = 3;

/** Los ejemplos del prompt: los preferidos que no estén excluidos, hasta `CUANTOS_EJEMPLOS`. */
export function ejemplosDeLectura(excluirIds: readonly string[] = []): ReferenciaDueno[] {
  const libres = EJEMPLOS_PREFERIDOS.filter((id) => !excluirIds.includes(id));
  return libres.slice(0, CUANTOS_EJEMPLOS).flatMap((id) => REFERENCIAS_DUENO.filter((r) => r.id === id));
}

const REGLAS = `Eres el lector de fotos del taller 3D de decoración con globos Sempertex. Miras UNA foto y la describes, en el JSON pedido, con las piezas que el taller sabe armar. Solo lees: nunca generas imágenes y nunca inventas lo que no se ve.

COORDENADAS Y MEDIDAS
- x va de 0 (borde izquierdo de la foto) a 1 (borde derecho); y de 0 (arriba) a 1 (abajo). aspecto = ancho de la foto / alto de la foto.
- TODOS los tamaños (grosor, ancho, diámetro, alto) son FRACCIÓN DEL ALTO de la foto, nunca del ancho. Una guirnalda de globos de 12" tiene un grosor de 0,10 a 0,18 del alto cuando la foto es de una pared entera; un globo suelto de 12" mide ~0,06.
- Escala: escala.altoImagenCm = cuántos cm reales mide de alto la foto a la distancia de la decoración. Mídelo con algo de medida conocida y dilo en escala.referencia: mesa o pedestal 75 cm, puerta 205 cm, silla (asiento) 45 cm, persona 170 cm, techo 250 a 270 cm, globo de 12" = 30 cm, de 24" = 60 cm. Sin referencia clara: estima con los globos y di «estimada».
- pisoY = la y de la línea del piso bajo la decoración (null si no se ve el piso). sala.pared y sala.piso: el color de la pared de fondo y del piso, en hex.

PIEZAS (usa solo estos tipos; cada objeto físico es una pieza)
- guirnalda_organica: cualquier cuerpo largo de globos de varios tamaños: festón, arco, medio arco que baja por un lado, guirnalda que cruza arriba y cae en una esquina, arco asimétrico. Se describe por su EJE: 4 a 12 "puntos" en orden de un extremo al otro, cada uno con x, y y grosor del cuerpo en ese punto (más grueso donde carga). Sigue el recorrido REAL de la foto; si un extremo llega al piso, su punto va a la altura del piso. Un arco con dos patas en el piso es UNA pieza con el eje de pata a pata.
- columna_organica: columna de globos de varios tamaños. forma: recta (silueta de columna normal), racimos (racimos apilados que se corren de lado), s (ondula), inclinada.
- columna_clasica: columna lisa de cuartetos con colores que se repiten al subir. guirnalda_clasica: guirnalda lisa de cuartetos entre dos puntos.
- globo: un globo suelto (en el piso o en el aire). ramo_helio: varios globos de helio atados juntos (cantidad real).
- decoracion: racimos y orbes del catálogo (se elige por id). metalizado: globo de foil (letras, números, palabras; cursiva si el foil está en letra cursiva).
- fondo: escenografía del catálogo (panel redondo, media luna, arcos chiara, pared de lentejuelas, pedestales, mesa con mantel, tapete, cortina con luces, letrero). Mide ancho y alto en fracción del alto de la foto.
- otro: todo lo que no es de globos ni del catálogo (torta, dulces, figuras, flores naturales, letreros de luz, muebles, personas). No se arma: solo se anota con su descripción.
- NUNCA agregues piezas que no se ven. Una pieza cortada por el borde de la foto se lee hasta donde se ve y se anota en su nota. Si dudas entre dos tipos, elige el más simple y di la duda en la nota.

TAMAÑOS Y COLORES
- tamanos (en lo orgánico): proporción de globos por tamaño: lo que de verdad se ve. Una guirnalda típica lleva R-12 de base, algunos R-18 o R-24 que resaltan y R-9 o R-5 de relleno. racimos: 0 = cuerpo parejo, 1 = muy abultado en racimos.
- colores: TODOS los que se ven en la pieza (de 1 a 6), cada uno con peso (la suma ronda 100), acabado y el hex medido en la parte iluminada del globo, no en la sombra ni en el reflejo. Pon el nombre como lo diría un decorador y lo más cerca posible de la lista de colores Sempertex de abajo (azul marino, verde esmeralda, blush, dorado, plata, marfil…). Acabado: cromado = espejo (dorado y plata metálicos casi siempre), perla = satinado, cristal = transparente, confeti = transparente con confeti, mate o brillante = látex normal.
- Los acentos pequeños también cuentan (un dorado del 5 % se pone con peso 5).

FOLLAJE: hojas o flores de tela entre los globos van en "follaje" de la guirnalda: monstera, palma, helecho, eucalipto, hoja_seca (con color: «hoja_seca dorada»), rosa, hortensia, gypsophila.

Responde SOLO el JSON.`;

const nombresDeColor = () => [...new Set(coloresDelFormato("R-12").map((c) => c.nombreCompleto))].join(", ");

const racimosDelCatalogo = () => RACIMOS_PREDEFINIDOS.map((r) => `${r.id}: ${r.descripcion}`).join(" ");

/** La instrucción de sistema completa: reglas, colores Sempertex, decoraciones del catálogo y las lecturas de ejemplo. */
export function construirPromptLectura(excluirIds: readonly string[] = []): string {
  const ejemplos = ejemplosDeLectura(excluirIds)
    .map((e, i) => `EJEMPLO ${i + 1} (${e.nombre}):\n${JSON.stringify(e.lectura)}`)
    .join("\n\n");
  return [
    REGLAS,
    `COLORES SEMPERTEX (nombres para "nombre"): ${nombresDeColor()}.`,
    `DECORACIONES DEL CATÁLOGO (tipo "decoracion"): ${racimosDelCatalogo()}`,
    `Lecturas hechas a mano por el decorador de OTRAS fotos, para que veas el formato y el criterio (no las copies):\n\n${ejemplos}`,
  ].join("\n\n");
}

/** El texto que acompaña a la foto. */
export const PEDIDO_LECTURA = "Lee esta foto de decoración con globos y devuelve la lectura en el JSON del esquema.";
