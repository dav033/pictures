import {
  CLASES_REMATE_GUIRNALDA,
  FORMAS_GUIRNALDA,
  MAX_RACIMOS_LECTURA_GUIRNALDA,
  POSICIONES_REMATE_GUIRNALDA,
  SOPORTES_GUIRNALDA,
  UNIDADES_RACIMO_GUIRNALDA,
} from "@/lib/plan/armado-guirnalda";
import {
  CLASES_TAMANO_NIVEL,
  DISPOSICIONES_NUMERO,
  MAX_CANTIDAD_NIVEL,
  MAX_NIVELES_LEIDOS,
  MAX_SUELTOS_LEIDOS,
  UNIDADES_BOUQUET,
  VARIANTES_BOUQUET,
} from "@/lib/plan/armado-bouquet";
import { REMATES_COLUMNA } from "@/lib/plan/armado-columna";
import {
  CLASES_TAMANO_CONTEO,
  MAX_GLOBOS_POR_RACIMO_CONTEO,
  MAX_VECES_REFERENCIA_CONTEO,
  REFERENCIAS_ESCALA_CONTEO,
} from "@/lib/plan/conteo-referencia";
import {
  ANCLAS_ZONA,
  DIRECCIONES_PATRON_COLOR,
  EXTENSION_ZONA_MAXIMA,
  MODOS_PATRON_COLOR,
  TAMANOS_LEIDOS,
} from "@/lib/plan/patron-color";
import { MAX_FLORES_PIEZA } from "@/lib/plan/flores-pieza";
import { PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

/**
 * Variante `v17-lectura-unica`: las cuatro lecturas de la foto, dentro del
 * análisis.
 *
 * Hoy la foto se mira cinco veces: el análisis (`analizar-referencias-v2.ts`) y
 * después cuatro llamadas de visión más sobre la MISMA imagen — el patrón de
 * color (ADR-0028 §11, ADR-0036, ADR-0039), el conteo de globos (ADR-0031), el
 * armado del bouquet (ADR-0030) y el armado de la guirnalda (ADR-0032, E4).
 * Esta variante hace que la primera y única IA que mira la imagen devuelva
 * también lo que piden las otras cuatro, por elemento, en la misma llamada de
 * herramienta; las cuatro pasan de ser lectoras a ser consumidoras de su
 * salida, y `app/amaterasu/lectura_unica.py` valida cada bloque con el
 * validador de siempre.
 *
 * Reglas que esto NO rompe:
 * - `VARIANTE_PRODUCCION` (v16) sigue byte a byte como está (ADR-0029). Estas
 *   reglas se añaden **solo** cuando alguien pide esta variante, igual que
 *   v14/v15, así que el hash de producción y su clave de caché no se mueven.
 * - La variante incluye el texto de v16 antes que el suyo: la frontera
 *   bouquet/centro de mesa que la evaluación midió no cambia.
 *
 * **Duplicación temporal y acotada**: mientras la bandera exista, estas reglas
 * y las de los cinco prompts de Python (`patron_referencia.py`,
 * `conteo_referencia.py`, `estructuras/bouquet.py`, `estructuras/guirnalda.py`)
 * dicen lo mismo en dos sitios. Se acepta porque el prompt del análisis vive
 * aquí y el de cada lectura vive allá, y no hay forma de compartir el texto sin
 * que una llamada dependa de la otra. Condición de borrado: cuando una
 * evaluación promueva esta variante a producción, se borran los cuatro prompts
 * de Python, sus esquemas de salida y el camino de `vision_estructurada.leer_foto`
 * (los **validadores** se quedan: son los que esta operación reutiliza).
 *
 * El vocabulario (paleta, modos, anclas, soportes, formas, unidades, clases de
 * tamaño, remates) se lee de su dueño en cada caso, nunca se copia aquí: es la
 * misma fuente de la que lo lee Python a través del contrato.
 *
 * Puro: sin proveedor, HTTP ni entorno.
 */

/** La paleta del catálogo sin "multicolor", que es un surtido y no el color de una posición. */
const PALETA = PALETA_COLORES_V2.filter((color) => color !== "multicolor");

const COLOR = { type: "string", enum: PALETA } as const;
const CONFIANZA = { type: "number", minimum: 0, maximum: 1 } as const;
const FRACCION = { type: "number", minimum: 0, maximum: 1 } as const;
const PUNTO = { type: "object", required: ["x", "y"], properties: { x: FRACCION, y: FRACCION } } as const;
const ESCALA = {
  type: "object",
  required: ["referencia", "veces"],
  properties: {
    referencia: { type: "string", enum: [...REFERENCIAS_ESCALA_CONTEO] },
    veces: { type: "number", minimum: 0, maximum: MAX_VECES_REFERENCIA_CONTEO },
  },
} as const;

/**
 * Fragmento de esquema que la variante añade a cada elemento de
 * `return_reference_inventory`, junto a su texto (como
 * `DETECTED_STRUCTURE_TOOL_SCHEMA` y `STRUCTURE_DETECTION_RULES`).
 *
 * Sin `maxItems` en ningún array: `gemini-3.6-flash` responde 400
 * INVALID_ARGUMENT a un esquema que lo lleve (medido 2026-09-24,
 * `patron_referencia.py`). Los topes los aplican los validadores de Python, que
 * es donde se validan de todos modos.
 */
export const LECTURA_UNICA_TOOL_SCHEMA = {
  type: "object",
  description:
    "Only for balloon structures. How the piece is laid out, how many balloons it has and how it is assembled. Omit a block you cannot read.",
  properties: {
    patron_color: {
      type: "object",
      required: ["modo", "colores", "confianza"],
      properties: {
        modo: { type: "string", enum: [...MODOS_PATRON_COLOR, "monocromo", "ninguno"] },
        colores: { type: "array", items: COLOR },
        globos_por_racimo: { type: "integer", minimum: 1, maximum: 8 },
        pesos: { type: "array", items: { type: "integer", minimum: 1, maximum: 100 } },
        zonas: {
          type: "array",
          items: {
            type: "object",
            required: ["color", "ancla", "extension"],
            properties: {
              color: COLOR,
              ancla: { type: "string", enum: [...ANCLAS_ZONA] },
              extension: { type: "integer", minimum: 1, maximum: EXTENSION_ZONA_MAXIMA },
            },
          },
        },
        motas: { type: "array", items: COLOR },
        tamanos: { type: "string", enum: [...TAMANOS_LEIDOS] },
        direccion: { type: "string", enum: [...DIRECCIONES_PATRON_COLOR] },
        simetria: { type: "string", enum: ["espejo"] },
        remate: {
          type: "object",
          required: ["tipo"],
          properties: { tipo: { type: "string", enum: [...REMATES_COLUMNA] }, color: COLOR },
        },
        confianza: CONFIANZA,
      },
    },
    conteo: {
      type: "object",
      required: ["globos_visibles", "exacto", "por_tamano", "confianza"],
      properties: {
        globos_visibles: { type: "integer", minimum: 0 },
        exacto: { type: "boolean" },
        racimos: { type: "integer", minimum: 1 },
        globos_por_racimo: { type: "integer", minimum: 1, maximum: MAX_GLOBOS_POR_RACIMO_CONTEO },
        estimado_total: { type: "integer", minimum: 1 },
        por_tamano: {
          type: "array",
          items: {
            type: "object",
            required: ["clase", "proporcion"],
            properties: { clase: { type: "string", enum: [...CLASES_TAMANO_CONTEO] }, proporcion: FRACCION },
          },
        },
        largo_relativo: ESCALA,
        alto_relativo: ESCALA,
        confianza: CONFIANZA,
      },
    },
    armado_bouquet: {
      type: "object",
      required: ["variante", "niveles", "confianza"],
      properties: {
        variante: { type: "string", enum: [...VARIANTES_BOUQUET] },
        niveles: {
          type: "array",
          items: {
            type: "object",
            required: ["unidad", "colores", "cantidad"],
            properties: {
              unidad: { type: "string", enum: [...UNIDADES_BOUQUET] },
              colores: { type: "array", items: COLOR },
              cantidad: { type: "integer", minimum: 1, maximum: MAX_CANTIDAD_NIVEL },
              clase_tamano: { type: "string", enum: [...CLASES_TAMANO_NIVEL] },
            },
          },
        },
        remate: {
          type: "object",
          required: ["clase"],
          properties: { clase: { type: "string", enum: ["metalizado", "burbuja", "latex"] }, color: COLOR },
        },
        numeros: {
          type: "array",
          items: {
            type: "object",
            required: ["digito", "clase_tamano"],
            properties: {
              digito: { type: "string", enum: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
              clase_tamano: { type: "string", enum: ["chico", "grande"] },
            },
          },
        },
        disposicion: { type: "string", enum: [...DISPOSICIONES_NUMERO] },
        confianza: CONFIANZA,
      },
    },
    armado_guirnalda: {
      type: "object",
      required: ["soporte", "forma", "racimos_visibles", "colores_por_racimo", "remates", "confianza"],
      properties: {
        soporte: { type: "string", enum: [...SOPORTES_GUIRNALDA] },
        // El nombre de otra pieza de esta misma imagen, no un id: en esta
        // llamada los element_id todavía no existen. `buildBlueprint` los
        // resuelve igual que `relationships` y `mirrors_element`.
        anfitriona_elemento: { type: "string", description: "Name of the other balloon piece it is wrapped around." },
        forma: { type: "string", enum: [...FORMAS_GUIRNALDA] },
        puntos_de_anclaje: { type: "integer", minimum: 2, maximum: 6 },
        linea_central: {
          type: "object",
          required: ["extremo_izquierdo", "punto_medio", "extremo_derecho"],
          properties: { extremo_izquierdo: PUNTO, punto_medio: PUNTO, extremo_derecho: PUNTO },
        },
        racimos_visibles: { type: "integer", minimum: 0, maximum: MAX_RACIMOS_LECTURA_GUIRNALDA },
        unidad_racimo: { type: "string", enum: [...UNIDADES_RACIMO_GUIRNALDA] },
        colores_por_racimo: { type: "array", items: COLOR },
        relleno: {
          type: "object",
          required: ["color", "proporcion"],
          properties: { color: COLOR, proporcion: { type: "number", minimum: 0, maximum: 0.5 } },
        },
        remates: {
          type: "array",
          items: {
            type: "object",
            required: ["clase", "posicion"],
            properties: {
              clase: { type: "string", enum: [...CLASES_REMATE_GUIRNALDA] },
              color: COLOR,
              posicion: { type: "string", enum: [...POSICIONES_REMATE_GUIRNALDA] },
            },
          },
        },
        confianza: CONFIANZA,
      },
    },
    flores: {
      type: "object",
      required: ["cantidad", "color_petalo", "confianza"],
      properties: {
        cantidad: { type: "integer", minimum: 1, maximum: MAX_FLORES_PIEZA },
        color_petalo: COLOR,
        color_centro: COLOR,
        confianza: CONFIANZA,
      },
    },
  },
} as const;

/**
 * El texto que la variante añade a las reglas del análisis, después de las de
 * v16. Cuatro preguntas separadas sobre la misma pieza, cada una con el
 * vocabulario de su dueño: ninguna sustituye a `structure`, a `composition` ni a
 * `observed_colors`, que siguen siendo los de v16 (y por tanto el color que un
 * plan compra sigue resolviéndose igual mientras esta variante no se promueva).
 */
export const LECTURA_UNICA_RULES = `For every balloon structure also return \`lecturas\`, four separate readings of that same piece. Answer each one on its own: a rule inside one reading never limits another. Omit a whole reading when the piece is not the kind it describes or when you cannot see enough of it; never guess to fill it. Each reading carries its own \`confianza\` from 0 to 1, and below 0.5 means a decorator would not rely on it.

Colors inside \`lecturas\`: use ONLY these catalog color names, spelled exactly as written: ${PALETA.join(", ")}. Map what you see to the closest of these names (light pink is rosado, chrome or metallic gold is dorado, clear is transparente). Never write any other color name there, and never write "multicolor". This does not change \`observed_colors\`, which stays in plain English with its finish prefix.

\`lecturas.patron_color\` — HOW THE COLORS ARE LAID OUT on the piece, the way a decorator reads a numbered color chart to rebuild it cluster by cluster, never how it was built. An organic garland or an organic column can be laid out in any of these ways: if its colors sit in stretches, one color owning the left, another the middle and another the right, that is "bloques", not "aleatorio". Reach for "aleatorio" only when every color really is spread over the whole piece from one end to the other.
- "espiral" (spiral, zigzag or straight stripes): the piece is made of identical clusters, usually quartets of 4 balloons, with the same colors in the same positions in every cluster. Rotated one eighth of a turn per layer the colors form continuous diagonal spiral stripes; turned left for two layers and right for the next two they form zigzag chevrons; stacked without rotation each color runs as a straight vertical stripe. All three are "espiral". colores = the colors of ONE cluster in position order, repeating a color when it takes two positions. globos_por_racimo = balloons per cluster.
- "anillos" (rings, "salvavidas"): every cluster is a single color and the colors follow each other along the piece. colores = the ring colors in order from the start of the piece, one per ring of the repeating sequence.
- "bloques" (color-blocked sections): long sections of mostly one color each, following each other along the piece. The transitions can be clean or they can blend, and a section may carry a few balloons of the neighbouring colors: what makes it "bloques" is that each color OWNS a stretch of the piece instead of running along the whole of it. colores = the sections in order from the start of the piece. pesos = the relative length of each section as integers from 1 to 100, one per color.
- "degradado" (degradé, ombré): the colors blend gradually from one into the next along the piece. colores = the stops in order from the start of the piece, 2 to 6 colors.
- "aleatorio" (confetti, organic mix): the colors are mixed with no regular order, every color appearing all over the piece from one end to the other. colores = the colors present, the most used first. pesos = the approximate share of each color as integers from 1 to 100, one per color.
- "flor" (daisy motif): runs of background clusters, then a flower made of petal clusters around one center balloon, repeating. colores = exactly three colors: background, petal, center.
- "damero" (checkerboard, only on flat balloon walls): a checkerboard of 2 colors, or diagonal rainbow bands of 3 or 4 colors. colores = the colors in order.
- "zonas" (color gathered in patches, only on flat balloon walls): one color covers most of the wall as a base and one or more OTHER colors sit GATHERED in compact patches at particular places on it, touching each other, instead of being spread over the whole wall. This is the usual organic wall: a pearl base with a metallic color clustered in a few spots. colores = the base color FIRST, then the patch colors in the order you list the patches. zonas = one entry per patch you can see, with the patch's color, where on the wall its middle sits (ancla) and roughly what percentage of the whole wall it covers (extension). Use several entries with the SAME color when one color is gathered in several separate spots. Do not use "zonas" when a color is sprinkled all over the piece: that is "aleatorio".
- "monocromo": the WHOLE piece is one single color, with no second color anywhere on it. colores = that one color, alone. A chrome or metallic piece is still monocromo: a mirror balloon reflects the wall, the floor and the furniture around it, so you will see browns, pinks and greens ON it that are not balloon colors. Name only the color the balloons ARE.
- "ninguno": you cannot tell the arrangement -- the piece is hidden, cut off or too blurry. colores = []. Do NOT use "ninguno" for a one-color piece: that is "monocromo".
The nine places a patch can sit (ancla), reading the piece as thirds: ${ANCLAS_ZONA.join(", ")}.
motas: the colors that are SPRINKLED over the piece instead of owning a stretch of it — clear bubble balloons scattered along an organic arch, a few loose chrome balloons, a gold that shows up every so often. Name a color here, not in colores, when it never forms a section of its own and you would describe it as "here and there". A color belongs either in colores or in motas, never in both, and leave motas out when every color sits in a run of its own.
tamanos: what SIZES of balloon the piece is made of, which decides how it is built and bought. Read it from the balloons themselves, comparing them to each other — never from the size of the piece. "casi_todos_gigantes": nearly every balloon is one of the big ones and the small ones are rare or absent; a piece of a dozen large balloons with two little ones tucked between them is this. "grandes_con_pocos_chicos": big balloons carry the piece and smaller ones fill the gaps, roughly one small for every two big. "chicos_con_pocos_grandes": small and medium balloons make up most of the piece and a few big ones stand out as accents, which is the usual organic look. "un_solo_tamano": every balloon is the same size, with no mix at all. Leave tamanos out when the balloons are too far, too blurry or too cut off to compare their sizes, and never guess it from the kind of piece. It is a property of the piece and not of its color layout: read it even when modo is "monocromo" or "ninguno".
direccion: the axis the pattern runs along. "longitudinal" is along the piece, which is the usual one: up a column, from one foot of an arch over the top to the other, along a garland, down a wall from the top. "transversal" is the pattern running ACROSS the piece instead: on a wall, bands from the left edge to the right one; on an arch or a column, colors that change across the width of the band rather than along it. "diagonal" is only for a degradado that runs corner to corner. Say "longitudinal" when in doubt.
simetria: "espejo" when the two halves of the piece are the same, mirrored: an arch whose left leg repeats the right one reading from each foot up to the top, or an upside-down-U garland that repeats from each end to the middle. Leave it out when the piece runs straight through from one end to the other, and whenever you cannot see both halves.
remate (only when structure_type is column): what crowns it, which a decorator builds separately from the body. "globo" for one single big balloon sitting on the top, "racimo" for a small cluster of 3 to 5 balloons on the top, "estrella" or "corazon" for a foil star or heart, and "ninguno" when the column ends flush with its last ring, which is just as common. Say "ninguno" when you can see the top and there is nothing on it; leave remate out entirely when the top is cut off by the frame, hidden or too blurry to tell. remate.color is the catalog color of that topper when you can see it. Never read a remate for any other structure type. patron_color.confianza does not judge the remate: a column whose arrangement you cannot tell can still have a plain big balloon on top.

\`lecturas.conteo\` — the balloons of the piece, the way a decorator sizes up a piece before quoting it. When quantity is more than 1 the element stands for that many identical pieces: count ONE of them, the most visible one.
globos_visibles: the balloons of the piece you can actually see and tell apart, counted one by one, foil and number balloons included. Never count balloons of another piece, loose balloons on the floor or balloons printed on a backdrop.
exacto: true only when the piece has few visible balloons and none of them is hidden (behind people, furniture, another piece, the piece's own front balloons or the edge of the photo), so that globos_visibles is its real total. Otherwise false.
racimos and globos_por_racimo: when the piece is built from repeated clusters (quartets of 4 are the most common), how many clusters the whole piece has, hidden ones included, and the balloons in each cluster. Omit both when there are no clear clusters.
estimado_total: when exacto is false, your estimate of ALL the balloons of the piece, hidden ones included: racimos times globos_por_racimo plus the loose balloons, or the balloons along one stretch times the stretches that make the whole piece. It is never less than globos_visibles. Omit it when exacto is true.
por_tamano: the share of the piece's balloons in each size class, as fractions that add up to 1, each class once: "chico" (small balloons often used as fillers), "mediano" (the regular party balloon), "grande" (clearly bigger than a regular balloon) and "gigante" (jumbo balloons). Judge sizes against the other balloons and the room. Leave it empty when you cannot tell.
largo_relativo and alto_relativo: only when a standing adult ("persona"), a door ("puerta") or a table ("mesa") is visible at about the same distance as the piece. referencia names it and veces is the piece's length (largo) or height (alto) divided by that reference's height. Omit them otherwise.
Never give balloons per metre or per density: that is a quoting decision, not something a photo shows.

\`lecturas.armado_bouquet\` — only for a compact standalone arrangement: whatever you called bouquet or centerpiece, and any cluster or sculpture that is an arrangement of that kind. How it is ASSEMBLED, the way a decorator would rebuild it level by level. Omit it for a column, an arch, a garland, a balloon wall or a ceiling installation.
variante: "base_aire" = air-filled balloons stacked on a base or stand (clusters sitting on each other), usually with a foil, number or bubble balloon fixed on top with a stick; it does not float. "helio_apilado" = helium balloons tied at the same height in tight layers (usually three per layer, the next layer nested on the one below), with a foil or bubble balloon nested on top; all ribbons go to one weight. "helio_escalonado" = helium balloons on ribbons of different lengths, at different heights around one larger central balloon; all ribbons go to one weight.
niveles: the latex levels from the bottom up (for a helium bouquet, from the lowest layer), at most ${MAX_NIVELES_LEIDOS}. unidad is the balloon unit of that level: "suelto" (single balloons), "pareja" (2 tied together), "trio" (3), "cuarteto" (4), "quinteto" (5) or "sexteto" (6). colores = the color of each balloon of ONE unit in position order; for "suelto", the colors of one group of single balloons that repeats around the level (at most ${MAX_SUELTOS_LEIDOS}). cantidad = how many identical units form that level all around the piece, counting the units hidden behind it by symmetry (a ring of four quartets is "cuarteto" with cantidad 4), from 1 to ${MAX_CANTIDAD_NIVEL}. clase_tamano = the size of the balloons of that level; omit it when you cannot tell. When a level mixes balloon sizes, write one level per size.
remate: the balloon on top or at the center that is not part of a latex level: clase "metalizado" (a foil shape such as a heart or a star), "burbuja" (a clear bubble balloon) or "latex" (one large latex balloon), and its color.
numeros: foil number balloons in the piece, in reading order: digito and clase_tamano "chico" (about the size of a regular balloon, usually on a stick) or "grande" (much taller than the other balloons). Omit when there are none. disposicion: where they are — "centro", "arriba" (as the topper), "abajo" (standing at the base or on the floor) or "lados" (one number on each side, each with its own identical group of balloons). With "lados" the two groups are identical: niveles, cantidad and remate describe ONE of them, never both together.

\`lecturas.armado_guirnalda\` — only for an organic run of balloon clusters along something, and for every arch and half-arch, because a hung garland often reads as an arch. How it is BUILT, cluster by cluster. Omit it for a column, a balloon wall, a ceiling installation or a compact arrangement.
soporte: "pared" (fixed flat on a wall or backdrop with hooks or tape), "colgada" (hung from two or more points with the cord in the air), "piso" (resting on the floor), "mesa" (resting on a table or along its edge) or "sobre_estructura" (wrapped around another balloon piece of this image). With "sobre_estructura", anfitriona_elemento is that other piece's \`name\` exactly as you wrote it in this same answer, never this piece's own name.
forma: "recta", "curva" (one gentle curve), "ondulada" (rises and falls along its length), "u_invertida" (frames something from above with both sides dropping) or "arco_caido" (hangs between anchor points and dips at the center). puntos_de_anclaje: how many points it hangs or is fixed from, 2 to 6, only when you can see them.
linea_central: where the garland runs, as three points on the center line of its band of balloons. Each point is a position in the WHOLE image, never relative to box_2d: x goes from 0 at the left edge of the image to 1 at its right edge, y from 0 at the top edge to 1 at the bottom edge. extremo_izquierdo = the center of the band at its left end, in the middle of its last cluster on the left; extremo_derecho = the same at its right end; punto_medio = go halfway between the two ends horizontally, look straight up and down at that x, and mark the center of the band there, at whatever height the balloons actually are. Place every point on the balloons themselves, not on the wall, a ribbon or the edge of the box. Omit linea_central when you cannot see both ends. Do not try to say which way it curves or how much: those are computed from these three points.
racimos_visibles: the clusters you can see from one end to the other. unidad_racimo: the balloons of one cluster, "trio" (3), "cuarteto" (4) or "quinteto" (5); omit it when you cannot tell. colores_por_racimo: the colors of a typical cluster in position order, at most 5.
relleno: the small balloons tucked between the clusters, with their main color and the share of the garland's balloons they make up (0 to 0.5); omit it when there are none.
remates: balloons clearly bigger than the cluster balloons, or foil or bubble balloons, placed on the garland: clase "latex", "metalizado" or "burbuja", their color, and posicion "extremo_izq", "extremo_der", "centro" or "cada_n" (repeated along the garland). At most 6; empty when there are none.

\`lecturas.flores\` — only when the piece carries BALLOON FLOWERS: daisy-like flowers made of balloons, several petal balloons of one color around a center balloon of another color, fixed on the piece as an ornament (on an arch, a hoop, a column, a garland or a wall). Real flowers, paper flowers, foil flower balloons and a flower motif drawn by the color layout itself (the "flor" pattern) are not balloon flowers. cantidad = the balloon flowers on ONE piece. color_petalo = the catalog color of the petals; color_centro = the catalog color of the center balloon, omitted when you cannot see it or it is the same color as the petals. Omit the whole reading when the piece has no balloon flowers.`;
