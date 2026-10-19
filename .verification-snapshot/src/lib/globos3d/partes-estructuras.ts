/**
 * **Vocabulario de partes de las ESTRUCTURAS** (columnas, arcos, guirnaldas, paredes, módulos, formas, letras, murales,
 * techo, árboles y todo lo orgánico): los nombres que lleva `parte` en cada globo y tubito armado (ver
 * `GloboDecoracion.parte` y `partes-globos.ts`). Palabras de oficio en minúsculas, sin tildes, jerárquicas con «/»
 * («pata/izquierda», «copa/frutas», «columna/relleno»): una parte vale para sus subpartes al seleccionar.
 *
 * Lo consume el glosario (lo que traduce «las patas del arco», «the trunk of the tree» a un `SelectorGlobos`) y la
 * prueba `test-partes-estructuras.ts`, que exige que todo globo de estructura de la biblioteca lleve una de estas.
 * Las decoraciones pequeñas (flores, figuras, rizos, burbujas…) tienen su propio vocabulario aparte.
 *
 * **Lo orgánico**: la parte de un globo sale de su tramo (`parteDeTramo`): los ids y nombres de los tramos se
 * traducen a palabras de oficio («pata_izquierda» → «pata/izquierda», «racimo_abajo_derecha» → «racimo/abajo/derecha»,
 * «abajo_derecha · Montículo de abajo a la derecha» → «monticulo/abajo/derecha», «tramo-merlot» → «guirnalda»). Los
 * ids de los tramos NO se renombran (decisión 2026-10-08): son los que usan `ColorOrganico.tramos` en los datos y en
 * las escenas que el usuario ya guardó en su navegador; renombrarlos rompería eso y no gana nada que no dé esta
 * traducción. `tramosDeParte` hace el camino de vuelta (parte → ids de tramo) para quien edite por partes.
 * Los globos de relleno (los tríos chicos que tapan huecos) van en «<parte>/relleno»: «la columna» los incluye y «el
 * relleno de la columna» los aparta (el relleno es de su tramo, se arma dentro de él; pero se distingue porque el
 * decorador lo cambia aparte: otro color, otro tamaño).
 */

export type ParteEstructura = {
  /** El nombre tal como va en `parte` («trenza», «pata», «copa/frutas»). */
  id: string;
  /** Qué es, en una línea (español). */
  descripcion: string;
  /** Cómo lo dicen en inglés (para el glosario y las órdenes en inglés). */
  en: readonly string[];
  /** Otras palabras en español con que lo piden. */
  sinonimos?: readonly string[];
};

export const PARTES_ESTRUCTURA: readonly ParteEstructura[] = [
  // Clásico (cuartetos)
  { id: "trenza", descripcion: "Cuerpo de cuartetos trenzados de una columna, un arco o una guirnalda clásica.", en: ["braid", "quad stack", "column body", "arch body", "garland body"], sinonimos: ["cuerpo", "cuartetos"] },
  { id: "trenza/grande", descripcion: "Cuartetos grandes de una pared de trenzas (alternan con los chicos).", en: ["large quads", "big braid balloons"] },
  { id: "trenza/chica", descripcion: "Cuartetos chicos de una pared de trenzas.", en: ["small quads", "small braid balloons"] },
  { id: "modulo", descripcion: "Globos de un módulo suelto (pareja, trío, cuarteto, quinteto, sexteto).", en: ["cluster", "duplet", "triplet", "quad", "module"], sinonimos: ["racimo", "pareja", "trio", "cuarteto"] },
  { id: "globo", descripcion: "Un globo suelto (el remate puesto encima de otra pieza).", en: ["single balloon", "loose balloon", "topper"] },
  // Mallas y murales
  { id: "malla", descripcion: "Eslabones Link-O-Loon de una malla (pared o techo).", en: ["link mesh", "link-o-loon wall", "net", "grid"], sinonimos: ["red", "eslabones"] },
  { id: "union", descripcion: "Parejas de unión (R-5) que amarran los cruces de una malla o un mural.", en: ["joint duplets", "connector balloons", "union balloons"], sinonimos: ["uniones", "amarres"] },
  { id: "mural", descripcion: "Globos de la matriz de un mural pixelado (cada celda, un globo).", en: ["mural", "pixel balloons", "mosaic"], sinonimos: ["pixeles", "matriz"] },
  { id: "aplicacion", descripcion: "Tubitos aplicados encima de un mural (contornos, letras, dibujos).", en: ["applique", "outline", "twisted detail"], sinonimos: ["aplicaciones", "contorno"] },
  // Formas y letras
  { id: "relleno", descripcion: "Globos que llenan una forma plana por dentro (celdas, malla o capa orgánica).", en: ["fill", "infill"], sinonimos: ["interior"] },
  { id: "cuerpo", descripcion: "Cuerpo de un volumen (esfera, cono, globo de un aerostático).", en: ["body", "sphere", "cone", "envelope"], sinonimos: ["bola", "esfera", "cono"] },
  { id: "borde", descripcion: "Hilera de globos que contornea una forma.", en: ["border", "edge", "outline"], sinonimos: ["contorno", "orilla"] },
  { id: "marco", descripcion: "Marco de una forma o un aro: el anillo de globos alrededor.", en: ["frame", "ring", "hoop"], sinonimos: ["aro"] },
  { id: "acento", descripcion: "Globos sueltos de otro color o tamaño sobre otra parte (acentos de una forma, lo que va encima de un mural, del tronco).", en: ["accent", "accent balloons", "highlights"], sinonimos: ["acentos", "detalles", "toques"] },
  { id: "remate", descripcion: "Globo que corona una estructura: el de arriba de una columna, la punta de un cono, de un árbol, de un festón.", en: ["topper", "crown", "finial"], sinonimos: ["punta", "corona", "globo de arriba", "globo de encima"] },
  { id: "canasta", descripcion: "Canasta de un globo aerostático.", en: ["basket", "gondola"] },
  { id: "letras", descripcion: "Letras y números de globos; cada carácter es «letras/<carácter>» («letras/a», «letras/2»).", en: ["letters", "numbers", "lettering"], sinonimos: ["letra", "numero", "numeros", "texto"] },
  // Techo
  { id: "red", descripcion: "Red de racimos de techo (cuartetos pegados al techo).", en: ["ceiling clusters", "ceiling grid"], sinonimos: ["racimos de techo"] },
  { id: "feston", descripcion: "Guirnalda clásica que cuelga en catenaria de punto a punto del techo.", en: ["swag", "festoon", "draped garland"], sinonimos: ["festones", "guirnalda colgante"] },
  { id: "tira", descripcion: "Tira colgante: globos de arriba abajo en un hilo.", en: ["drop", "hanging strand", "balloon strand"], sinonimos: ["tiras", "colgante", "lluvia"] },
  { id: "fleco", descripcion: "Flecos de tubito que bajan de una tira (y su racimito al final, «fleco/racimo»).", en: ["tassel", "fringe", "streamers"], sinonimos: ["flecos"] },
  { id: "helio", descripcion: "Globos de helio flotando contra el techo.", en: ["helium balloons", "floating balloons"], sinonimos: ["flotantes"] },
  // Árboles
  { id: "tronco", descripcion: "Tronco de un árbol o palmera (cuartetos o globos apilados).", en: ["trunk", "stem"], sinonimos: ["tallo"] },
  { id: "tronco/base", descripcion: "Globos grandes al pie del tronco.", en: ["trunk base", "base"] },
  { id: "hojas", descripcion: "Hojas de la palmera (tubito o Link-O-Loon).", en: ["fronds", "leaves", "palm leaves"], sinonimos: ["hoja", "ramas", "pencas"] },
  { id: "cocos", descripcion: "Cocos de la palmera.", en: ["coconuts"], sinonimos: ["coco"] },
  { id: "copa", descripcion: "Copa de racimos de un árbol.", en: ["canopy", "crown", "tree top", "foliage"], sinonimos: ["follaje"] },
  { id: "copa/frutas", descripcion: "Frutas (globos de otro color) sobre la copa.", en: ["fruits", "balloon fruits"], sinonimos: ["frutas", "manzanas"] },
  // Orgánico (por tramo)
  { id: "guirnalda", descripcion: "Guirnalda orgánica (racimo libre o de un trazo).", en: ["garland", "organic garland"], sinonimos: ["racimo"] },
  { id: "trazo", descripcion: "Tramo de una guirnalda orgánica dibujada con un trazo libre.", en: ["stroke", "garland run", "organic run"], sinonimos: ["tramo"] },
  { id: "columna", descripcion: "Columna orgánica (con «/izquierda» o «/derecha» en un par).", en: ["column", "pillar", "tower"], sinonimos: ["torre"] },
  { id: "espiral", descripcion: "Cordón orgánico fino que da vueltas pegado a una columna.", en: ["spiral", "twist", "swirl"] },
  { id: "monticulo", descripcion: "Montículo de globos grandes al pie de una columna u orgánico.", en: ["base mound", "base cluster", "mound"], sinonimos: ["base", "pie"] },
  { id: "pata", descripcion: "Pata de un arco orgánico («pata/izquierda», «pata/derecha»).", en: ["leg", "arch leg", "side"], sinonimos: ["lado", "costado"] },
  { id: "clave", descripcion: "Parte de arriba de un arco orgánico (donde se juntan las patas).", en: ["keystone", "arch top", "crown"], sinonimos: ["arriba", "centro del arco"] },
  { id: "arco", descripcion: "Arco orgánico de un solo tramo (rectangular o de recorrido libre).", en: ["arch", "organic arch"] },
  { id: "travesano", descripcion: "Travesaño (y patas) de un arco orgánico rectangular.", en: ["crossbar", "header", "top bar"] },
  { id: "base", descripcion: "Base orgánica: el anillo o los pies de una estructura (también «base/izquierda»…).", en: ["base", "foot"], sinonimos: ["pie", "pies"] },
  { id: "anillo", descripcion: "Anillo orgánico de un marco redondo («anillo/exterior», «anillo/interior»).", en: ["ring", "hoop", "circle frame"], sinonimos: ["aro"] },
  { id: "semiarco", descripcion: "Semiarco orgánico (medio arco suelto, de un solo lado).", en: ["half arch", "semi arch", "asymmetric arch"], sinonimos: ["medio arco"] },
  { id: "racimo", descripcion: "Racimo de un orgánico hecho de varios («racimo/1», «racimo/arriba/izquierda»).", en: ["cluster", "balloon cluster"], sinonimos: ["grupo", "bola"] },
  { id: "rama", descripcion: "Rama de un orgánico que sale hacia un lado.", en: ["branch", "offshoot"], sinonimos: ["brazo"] },
  { id: "lado", descripcion: "Lado de un marco o aro orgánico («lado/izquierda»).", en: ["side"], sinonimos: ["costado"] },
  { id: "cordon", descripcion: "Cordón orgánico fino que acompaña a otra parte (de otro color).", en: ["cord", "rope", "accent line"], sinonimos: ["linea"] },
  { id: "franja", descripcion: "Franja de un orgánico por partes (degradé o bicolor por alturas).", en: ["band", "stripe", "section"], sinonimos: ["banda", "seccion"] },
];

/** Calificadores que pueden seguir a una parte («pata/izquierda», «columna/relleno», «copa/acento»); también números («racimo/3»). */
export const CALIFICADORES_PARTE: readonly string[] = ["izquierda", "derecha", "centro", "arriba", "abajo", "exterior", "interior", "frente", "atras", "relleno", "racimo", "acento"];

const IDS = new Set(PARTES_ESTRUCTURA.map((p) => p.id));

/** ¿Es un nombre de parte de estructura bien formado? Una parte del vocabulario seguida de calificadores o números (en «letras», del carácter). */
export function esParteEstructura(parte: string): boolean {
  const s = parte.split("/");
  // La parte más larga del vocabulario que es prefijo («trenza/grande» antes que «trenza»).
  let k = s.length;
  while (k > 0 && !IDS.has(s.slice(0, k).join("/"))) k -= 1;
  if (k === 0) return false;
  const base = s.slice(0, k).join("/");
  return s.slice(k).every((x, i) => CALIFICADORES_PARTE.includes(x) || /^\d+$/.test(x) || (i === 0 && base === "letras" && /^[a-z0-9ñ]$/.test(x)));
}

// ----------------------------------------------------------------------------------------------------------
// Lo orgánico: del tramo a la parte
// ----------------------------------------------------------------------------------------------------------

/** Palabras de un id o un nombre de tramo que dicen QUÉ es (→ su parte). */
const ESTRUCTURALES: Readonly<Record<string, string>> = {
  pata: "pata", patas: "pata", semiarco: "semiarco", clave: "clave", columna: "columna", columnas: "columna", espiral: "espiral",
  monticulo: "monticulo", base: "base", pie: "base", pies: "base", anillo: "anillo", aro: "marco", marco: "marco", travesano: "travesano",
  arco: "arco", tronco: "tronco", copa: "copa", arbol: "copa", racimo: "racimo", racimos: "racimo", guirnalda: "guirnalda", trazo: "trazo",
  franja: "franja", rama: "rama", ramas: "rama", lado: "lado", cordon: "cordon",
};
/** Palabras que dicen DÓNDE (→ calificador). */
const POSICIONES: Readonly<Record<string, string>> = {
  izquierda: "izquierda", izquierdo: "izquierda", derecha: "derecha", derecho: "derecha", arriba: "arriba", alto: "arriba", abajo: "abajo", bajo: "abajo",
  centro: "centro", dentro: "interior", interior: "interior", fuera: "exterior", exterior: "exterior", frente: "frente", delante: "frente", atras: "atras", detras: "atras",
};

const palabras = (texto: string) => texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/**
 * La parte de un globo orgánico por su tramo (id y nombre). Los ids de tramo son libres (los de los datos dicen el
 * color, «tramo-merlot», o el lugar, «racimo_abajo_derecha»): se toma la palabra de oficio que diga QUÉ es (del id; si
 * no la tiene, de su nombre: «Montículo de abajo a la derecha») y las que digan DÓNDE (del id; si no, del nombre) y
 * los números («racimo_3» → «racimo/3»). Los colores no son parte (para eso está el color del selector): un tramo que
 * solo dice su color es «guirnalda». `relleno`: el globo es de relleno («<parte>/relleno»).
 */
export function parteDeTramo(tramo: { id: string; nombre?: string }, relleno = false): string {
  const id = palabras(tramo.id), nombre = palabras(tramo.nombre ?? "");
  const que = id.find((w) => ESTRUCTURALES[w]) ?? nombre.find((w) => ESTRUCTURALES[w]);
  const dondeId = id.filter((w) => POSICIONES[w]);
  const donde = (dondeId.length ? dondeId : nombre.filter((w) => POSICIONES[w])).map((w) => POSICIONES[w]!);
  const numeros = id.filter((w) => /^\d+$/.test(w)).map((w) => String(Number(w)));
  const partes = [que ? ESTRUCTURALES[que]! : "guirnalda", ...new Set(donde), ...numeros];
  return relleno ? [...partes, "relleno"].join("/") : partes.join("/");
}

/** Los ids de tramo de unas opciones orgánicas cuyos globos caen en la parte (prefijo, como el selector; sin «/relleno»). */
export function tramosDeParte(tramos: ReadonlyArray<{ id: string; nombre?: string }>, parte: string): string[] {
  const p = parte.toLowerCase().replace(/\/relleno$/, "");
  return tramos.filter((t) => { const q = parteDeTramo(t); return q === p || q.startsWith(`${p}/`); }).map((t) => t.id);
}
