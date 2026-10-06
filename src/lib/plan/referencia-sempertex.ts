import { z } from "zod";
import tablaCruda from "../../../contracts/domain/v1/sempertex/tabla-color.json";
import { labDeRgb, type Lab } from "@/lib/rag/catalog/similitud-color";
import { acabadoObservado, type FamiliaSempertex } from "@/lib/plan/acabado-observado";

/**
 * De un color medido en una foto a una referencia real del catálogo Sempertex, con su código Pantone.
 *
 * **Se cruza contra el color del globo inflado, nunca contra el Pantone.** El PMS es tinta plana; el látex
 * inflado se estira, es translúcido y le entra luz, y los dos se separan ΔE 17 de mediana (57 en el peor caso,
 * `044` Azul Naval). Medido en el repo dueño (`scripts/migracion/comprobar-cruce-color.ts`): dándole a cada
 * referencia su propio color de globo, cruzar contra la tinta la reconoce en **19 de 70** casos y contra el
 * globo en **70 de 70**. El PMS viaja como dato para mostrar y para pedir el globo, que es para lo que sirve.
 *
 * **Por qué devuelve varias candidatas y no una.** Medido sobre la tabla: 37 de las 90 referencias tienen otra
 * a menos de ΔE 10 y 13 a menos de ΔE 5, y la sombra entre globos baja el croma un 20–30 % (no se puede
 * compensar: se probó). Con eso, decir «es la 041» cuando podría ser la 044 sería inventar precisión. Se
 * devuelven las más cercanas con su distancia, y se marca `ambigua` cuando las dos primeras están tan juntas
 * que la foto no permite elegir.
 *
 * **Los neutros no se identifican por color.** Un globo blanco y una pared blanca son el mismo píxel, y 15 de
 * las 90 referencias son neutras. Un color medido sin croma se marca `neutro` y solo se compara con las
 * referencias neutras, por claridad: distingue un blanco de un negro o de un plata, y nada más.
 *
 * La tabla la genera el repo dueño (`clasificador-decoraciones/scripts/migracion/tabla-color-sempertex.ts`) y
 * aquí no se edita a mano: un color se cambia allá y se vuelve a generar.
 */

const ReferenciaSchema = z
  .object({
    codigo: z.string().regex(/^[0-9]{3}$/),
    nombre: z.string().min(1),
    nombreEn: z.string().min(1),
    nombreBase: z.string().min(1),
    nombreCompleto: z.string().min(1),
    familia: z.string().min(1),
    acabado: z.string().min(1),
    pms: z.string().min(1).nullable(),
    hexTinta: z.string().regex(/^#[0-9a-f]{6}$/),
    hexGlobo: z.string().regex(/^#[0-9a-f]{6}$/),
    medido: z.boolean(),
    neutro: z.boolean(),
    formatos: z.array(z.string().min(1)),
    foto: z.string().url().nullable(),
  })
  .strict();

const TablaSchema = z
  .object({
    version: z.literal("sempertex-color.v1"),
    generado: z.string().min(1),
    fuente: z.string().min(1),
    nota: z.string().min(1),
    cromaNeutro: z.number().positive(),
    referencias: z.array(ReferenciaSchema).min(80).max(200),
  })
  .strict();

/** Se valida al importar: una tabla mal generada falla en las pruebas y no delante de un cliente. */
export const TABLA_SEMPERTEX = TablaSchema.parse(tablaCruda);

export type ReferenciaSempertex = z.infer<typeof ReferenciaSchema>;

export type Candidata = {
  codigo: string;
  nombre: string;
  /** Como se pide en la tienda: la familia delante («Reflex Dorado»). Es el nombre que usa un decorador. */
  nombreCompleto: string;
  nombreEn: string;
  /** El código Pantone con el que se fabrica, o `null` en las referencias que no lo llevan. */
  pms: string | null;
  acabado: string;
  /** El color del globo inflado con el que se comparó. */
  hexGlobo: string;
  /** Distancia CIELAB directa. Se informa porque es la medida que todo el mundo entiende, pero no ordena. */
  deltaE: number;
  /**
   * Lo que **sí** ordena: distancia de globo (ver `distanciaDeGlobo`). Pesa el tono, perdona que el color
   * medido salga más apagado que el del catálogo —la sombra entre globos baja el croma un 20-30 % siempre— y
   * castiga que salga más vivo, que es imposible.
   */
  distancia: number;
  /** Cuánto se separa el tono, en grados. Es el número fiable: su mediana en una foto real es de 3°. */
  tono: number;
  /** Croma del color medido entre el del globo del catálogo. Por debajo de 1 es la sombra; por encima, un error. */
  razonCroma: number;
};

export type CruceColor = {
  /** El color medido que se cruzó. */
  hex: string;
  candidatas: Candidata[];
  /**
   * La primera candidata la nombró el analizador, no la eligieron los píxeles: su etiqueta era el nombre
   * exacto de esa referencia y el color medido no la desmiente. Es el caso más fiable.
   */
  porNombre: boolean;
  /** Un color sin croma: no se puede identificar por tono, solo por claridad. */
  neutro: boolean;
  /** Las dos primeras están tan juntas que la foto no permite elegir entre ellas. */
  ambigua: boolean;
  /**
   * Ninguna referencia se parece: la más cercana está demasiado lejos. Casi siempre ese color no es un globo
   * —es sombra, un mueble o el fondo—, y nombrar la «más cercana» sería inventar. Las candidatas se devuelven
   * igual, pero para diagnosticar, no para decir de qué color es.
   */
  sinReferencia: boolean;
  /** Las familias a las que se restringió por el acabado que vio el analizador. Vacío = no se restringió. */
  familias: FamiliaSempertex[];
};

/** Por debajo de este croma un color no tiene tono que comparar. Sale de la tabla, que lo declara. */
const CROMA_NEUTRO = TABLA_SEMPERTEX.cromaNeutro;

/** Si la segunda candidata está a menos de esto de la primera, no se puede distinguir una de otra. */
const MARGEN_AMBIGUO = 3;

/**
 * Por encima de esta distancia de globo no se nombra ninguna referencia.
 *
 * Está en grados de tono (ver `distanciaDeGlobo`). El caso que lo motivó: un `#1e3e33` —un verde muy oscuro,
 * o sea sombra— salía como «035 Turquesa Profundo», con un azul galaxia y un chocolate empatados detrás. Tres
 * colores que no se parecen entre sí a la misma distancia es la firma de que ninguno es.
 */
const UMBRAL_SIN_REFERENCIA = 26;

const labDeHex = (hex: string): Lab => {
  const entero = Number.parseInt(hex.slice(1), 16);
  return labDeRgb((entero >> 16) & 255, (entero >> 8) & 255, entero & 255);
};

const croma = (lab: Lab): number => Math.hypot(lab[1], lab[2]);

const tono = (lab: Lab): number => ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360;

const distancia = (uno: Lab, otro: Lab): number =>
  Math.hypot(uno[0] - otro[0], uno[1] - otro[1], uno[2] - otro[2]);

/** Diferencia entre dos tonos, en grados, por el lado corto del círculo. */
function difTono(uno: number, otro: number): number {
  return Math.abs(((uno - otro + 540) % 360) - 180);
}

/**
 * Hasta dónde puede bajar el croma de un globo medido en una foto respecto al del catálogo sin que deje de ser
 * ese globo. Medido en `clasificador-decoraciones` (§24.1): la oclusión entre globos devuelve el 76 % del croma
 * de media, y por estructura baja hasta el 68 %; por color, el violeta se queda en el 62 %. Se deja margen.
 */
const CROMA_MINIMA_ESPERADA = 0.5;

/**
 * Y hasta dónde puede **subir**. Un globo medido no puede salir mucho más vivo que el del catálogo: si sale,
 * es que no es ese globo. El margen cubre que la medida del catálogo de las familias brillantes sale algo
 * apagada (§20.5, pendiente allá).
 */
const CROMA_MAXIMA_ESPERADA = 1.25;

/**
 * La distancia con la que se ordenan las candidatas, y por qué no es ΔE.
 *
 * ΔE trata igual un error de tono y una pérdida de croma, y la pérdida de croma **no es un error**: la sombra
 * y la oclusión entre globos la provocan siempre, un 20-30 %. Con ΔE plano, un dorado Reflex medido en una
 * escena (tono 76°, croma 24) queda más cerca de un café mate que del dorado Reflex del catálogo (tono 85°,
 * croma 38), que es justo el fallo que se vio con el árbol de globos dorados cromados.
 *
 * Así que se pesa el tono, que es lo estable, se mira la claridad, y el croma solo cuenta cuando se sale de la
 * banda que la física explica. El resultado está en grados de tono: por debajo de ~12 es un parecido bueno.
 */
export function distanciaDeGlobo(medido: Lab, referencia: Lab): number {
  const cromaMedida = croma(medido);
  const cromaReferencia = croma(referencia);
  const dClaridad = Math.abs(medido[0] - referencia[0]);
  // En un neutro el tono es ruido puro: el ángulo de un gris depende del último bit del píxel y mandaría sobre
  // todo lo demás. Un blanco, un plata y un negro se distinguen por claridad, y nada más. (Se vio con un
  // `#cdc6ba` que el analizador había nombrado «matte white» y que acababa en una perla satinada.)
  if (cromaMedida < CROMA_NEUTRO || cromaReferencia < CROMA_NEUTRO) {
    return dClaridad * 0.5 + Math.abs(cromaMedida - cromaReferencia);
  }
  const dTono = difTono(tono(medido), tono(referencia));
  const razon = cromaReferencia < 1 ? 1 : cromaMedida / cromaReferencia;
  const fuera =
    razon < CROMA_MINIMA_ESPERADA
      ? CROMA_MINIMA_ESPERADA - razon
      : razon > CROMA_MAXIMA_ESPERADA
        ? razon - CROMA_MAXIMA_ESPERADA
        : 0;
  // La claridad pesa la mitad que el tono (una foto cambia el brillo más que el matiz) y salirse de la banda
  // de croma pesa como 30° de tono por cada vez que se sale entera: es lo que descarta a la vecina equivocada.
  return dTono + dClaridad * 0.5 + fuera * 30;
}

/** El Lab del globo de cada referencia, calculado una vez. */
const LAB_POR_REFERENCIA: ReadonlyMap<string, Lab> = new Map(
  TABLA_SEMPERTEX.referencias.map((r) => [r.codigo, labDeHex(r.hexGlobo)]),
);

const redondo = (valor: number) => Math.round(valor * 10) / 10;

function candidata(referencia: ReferenciaSempertex, medido: Lab, referenciaLab: Lab): Candidata {
  const cromaReferencia = croma(referenciaLab);
  return {
    codigo: referencia.codigo,
    nombre: referencia.nombre,
    nombreCompleto: referencia.nombreCompleto,
    nombreEn: referencia.nombreEn,
    pms: referencia.pms,
    acabado: referencia.acabado,
    hexGlobo: referencia.hexGlobo,
    deltaE: redondo(distancia(medido, referenciaLab)),
    distancia: redondo(distanciaDeGlobo(medido, referenciaLab)),
    tono: redondo(difTono(tono(medido), tono(referenciaLab))),
    razonCroma: cromaReferencia < 1 ? 1 : redondo(croma(medido) / cromaReferencia),
  };
}

export type OpcionesCruce = {
  /** Cuántas candidatas devolver. Tres es lo razonable: 37 de las 90 tienen una vecina a menos de ΔE 10. */
  cuantas?: number;
  /**
   * Los códigos que el analizador **nombró** con una etiqueta que es el nombre exacto de una referencia
   * (`chrome gold` = 970). Si los píxeles no la desmienten —si queda dentro del umbral—, esa manda: es la
   * señal más fuerte que hay, porque el acabado solo lo ve el modelo y el color solo lo ven los píxeles.
   */
  nombradas?: readonly string[];
  /** Códigos de la lámina cuyo color nombró el analizador para este tono. */
  permitidas?: readonly string[];
  /**
   * Las familias compatibles con el acabado que vio el analizador (`acabado-observado.ts`). Restringir por
   * aquí es lo que arregla los cromados: el color promedio de un dorado Reflex y el de un café mate son casi
   * el mismo, y la diferencia solo la ve el modelo, que escribe «chrome gold».
   *
   * Si con la restricción no queda ninguna candidata razonable, se vuelve a buscar sin ella y se avisa
   * dejando `familias` vacío: es mejor una referencia de otra familia que ninguna.
   */
  familias?: readonly FamiliaSempertex[];
};

/** Las referencias más parecidas a un color medido, ordenadas por la distancia de globo. */
export function cruzarColor(hex: string, opciones: OpcionesCruce | number = {}): CruceColor {
  const { cuantas = 3, familias = [], nombradas = [], permitidas } =
    typeof opciones === "number" ? { cuantas: opciones, familias: [], nombradas: [], permitidas: undefined } : opciones;
  const lab = labDeHex(hex);
  const neutro = croma(lab) < CROMA_NEUTRO;
  // Un neutro solo se compara con neutros: su tono es ruido y lo llevaría a cualquier color pálido.
  const mismaNaturaleza = TABLA_SEMPERTEX.referencias.filter((r) => r.neutro === neutro);
  const colorNombrado = permitidas?.length
    ? mismaNaturaleza.filter((r) => permitidas.includes(r.codigo))
    : mismaNaturaleza;

  const ordenar = (lista: readonly ReferenciaSempertex[]): Candidata[] =>
    lista
      .map((r) => candidata(r, lab, LAB_POR_REFERENCIA.get(r.codigo) ?? lab))
      .sort((a, b) => a.distancia - b.distancia || (a.codigo < b.codigo ? -1 : 1))
      .slice(0, Math.max(1, cuantas));

  const restringidas = familias.length
    ? mismaNaturaleza.filter((r) => (familias as readonly string[]).includes(r.familia))
    : [];
  let usadas: FamiliaSempertex[] = [];
  let ordenadas = ordenar(colorNombrado);
  if (restringidas.length > 0) {
    const conFamilia = ordenar(restringidas.filter((r) => colorNombrado.includes(r)));
    // La restricción manda mientras dé algo que se sostenga; si no, es peor que no restringir.
    if (conFamilia[0] && conFamilia[0].distancia <= UMBRAL_SIN_REFERENCIA) {
      ordenadas = conFamilia;
      usadas = [...familias];
    }
  }

  // Una referencia que el modelo nombró pasa delante, siempre que los píxeles la admitan. Entre varias
  // nombradas elige la más cercana, que es como se reparten las etiquetas de una pieza de acabados mezclados.
  let porNombre = false;
  if (nombradas.length > 0) {
    const candidatasNombradas = colorNombrado
      .filter((r) => nombradas.includes(r.codigo))
      .map((r) => candidata(r, lab, LAB_POR_REFERENCIA.get(r.codigo) ?? lab))
      .sort((a, b) => a.distancia - b.distancia);
    const mejor = candidatasNombradas[0];
    if (mejor && mejor.distancia <= UMBRAL_SIN_REFERENCIA) {
      ordenadas = [mejor, ...ordenadas.filter((c) => c.codigo !== mejor.codigo)].slice(0, Math.max(1, cuantas));
      porNombre = true;
    }
  }

  return {
    hex,
    candidatas: ordenadas,
    porNombre,
    neutro,
    ambigua: ordenadas.length > 1 && ordenadas[1].distancia - ordenadas[0].distancia < MARGEN_AMBIGUO,
    sinReferencia: ordenadas.length === 0 || ordenadas[0].distancia > UMBRAL_SIN_REFERENCIA,
    familias: usadas,
  };
}

/** Una referencia por su código, para cuando ya se eligió. */
/**
 * De un nombre de color en inglés a los códigos que pueden ser.
 *
 * Lleva los dos nombres de cada referencia: el **único** («chrome gold» es solo la 970) y el **base**, que
 * varias comparten («light pink» son la 009 y la 609 mates, la 409 satín y la 909 cromada). Así el analizador
 * nombra el color aunque no diga el acabado, y de los candidatos elige el más cercano a lo que miden los
 * píxeles. 25 de los 90 nombres base los comparten varias referencias.
 */
export const CODIGOS_POR_NOMBRE_EN: ReadonlyMap<string, string[]> = (() => {
  const indice = new Map<string, string[]>();
  const anotar = (nombre: string, codigo: string) => {
    const clave = nombre.trim().toLowerCase();
    const previos = indice.get(clave);
    if (previos) {
      if (!previos.includes(codigo)) previos.push(codigo);
    } else {
      indice.set(clave, [codigo]);
    }
  };
  for (const r of TABLA_SEMPERTEX.referencias) {
    anotar(r.nombreEn, r.codigo);
    anotar(r.nombreBase, r.codigo);
  }
  return indice;
})();

export function referenciaPorCodigo(codigo: string): ReferenciaSempertex | null {
  return TABLA_SEMPERTEX.referencias.find((r) => r.codigo === codigo) ?? null;
}

/**
 * ¿Esa referencia se fabrica en ese formato? La lámina dice lo que Sempertex fabrica y la tienda lo que se
 * puede comprar hoy, así que esto **avisa, no bloquea** (es la misma regla que en el repo dueño).
 */
export function seFabricaEn(codigo: string, formato: string): boolean {
  return referenciaPorCodigo(codigo)?.formatos.includes(formato) ?? false;
}

/**
 * De un nombre de color **en español** a los códigos que pueden ser: `verde lima` son la 031 (Fashion) y la
 * 931 (Reflex). Es el gemelo de `CODIGOS_POR_NOMBRE_EN`, para lo que escribe el catálogo de la tienda en vez
 * del analizador de fotos.
 */
export const CODIGOS_POR_NOMBRE_ES: ReadonlyMap<string, string[]> = (() => {
  const indice = new Map<string, string[]>();
  for (const r of TABLA_SEMPERTEX.referencias) {
    const clave = plegarNombre(r.nombre);
    const previos = indice.get(clave);
    if (previos) previos.push(r.codigo);
    else indice.set(clave, [r.codigo]);
  }
  return indice;
})();

/** Sin tildes, sin dobles espacios y en minúsculas: así se comparan dos nombres escritos por distinta mano. */
function plegarNombre(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * El color con el que se dibuja un material del plan: el de **la referencia del catálogo que se compra**, no
 * el de la paleta de 26 palabras de la taxonomía.
 *
 * **Por qué hace falta.** La taxonomía tiene un solo `verde` (`#2e9d57`) porque su trabajo es agrupar, no
 * pintar: con ella, un arco de Verde Lima y Verde Selva salía con los dos verdes idénticos y la gráfica
 * contradecía a su propia leyenda, que sí los nombraba distintos. El catálogo los separa — `#97d700` y
 * `#007a53` — porque son dos globos distintos que se compran por separado.
 *
 * Se devuelve el color de la **tinta** (`hexTinta`), que es con el que dibuja el diseñador del repo dueño
 * (`colores/canonico.ts::hexDe`). El color del globo inflado (`hexGlobo`) está en la misma tabla y es lo que
 * se ve en persona; cambiar de uno a otro es cambiar este campo, y moverlo cambiaría todas las gráficas a la
 * vez, así que se deja donde el motor lo tiene.
 *
 * `acabado` llega en palabras del cliente («mate», «cromado») y restringe la familia a través de
 * `acabadoObservado`, que es quien sabe de acabados; sin él, o con un nombre que el catálogo no tiene, se
 * devuelve `null` y quien llame se queda con su respaldo.
 */
export function hexDelCatalogo(tono: string, acabado: string | null): string | null {
  return referenciaDelCatalogo(tono, acabado)?.hexTinta ?? null;
}

/**
 * De la palabra de acabado **del catálogo** (la que escribe el plan: «reflex», «fashion», «perlado») a las
 * familias que puede ser, en orden de preferencia. `acabadoObservado` entiende las palabras de un analizador
 * mirando una foto («chrome», «matte»), no estas: sin esta tabla un dorado Reflex del plan caía en el dorado
 * Fashion, el primero de la lámina. Es el mismo emparejamiento que `_FAMILIAS_POR_ACABADO` de
 * `services/ai-api/app/color_catalogo.py` (`referencia_de`), con la misma prioridad.
 */
const FAMILIAS_POR_PALABRA_CATALOGO: Readonly<Record<string, readonly FamiliaSempertex[]>> = {
  reflex: ["reflex", "metal"],
  cromado: ["reflex", "metal"],
  metal: ["metal", "reflex"],
  metalizado: ["metal", "reflex"],
  satin: ["satin", "silk"],
  satinado: ["satin", "silk"],
  perlado: ["silk", "satin"],
  perla: ["silk", "satin"],
  silk: ["silk", "satin"],
  fashion: ["fashion", "pastelMate", "neon"],
  mate: ["fashion", "pastelMate", "neon"],
  pastel: ["pastelMate", "pastelDusk"],
  "pastel mate": ["pastelMate", "pastelDusk"],
  "pastel dusk": ["pastelDusk", "pastelMate"],
  neon: ["neon"],
  transparente: ["cristal"],
  cristal: ["cristal"],
  translucido: ["cristal"],
};

/**
 * La referencia del catálogo Sempertex que se compra para un color y un acabado del plan, o `null` si el
 * color no es un nombre de la lámina (no se inventa una). Es la referencia de la que salen el Pantone, el
 * color del globo inflado y el nombre visible en inglés que llegan a los prompts de imagen.
 */
export function referenciaDelCatalogo(tono: string, acabado: string | null): ReferenciaSempertex | null {
  const codigos = CODIGOS_POR_NOMBRE_ES.get(plegarNombre(tono));
  if (!codigos || codigos.length === 0) return null;
  const referencias = codigos.map(referenciaPorCodigo).filter((r): r is ReferenciaSempertex => r !== null);
  if (referencias.length === 0) return null;
  const delCatalogo = acabado ? FAMILIAS_POR_PALABRA_CATALOGO[plegarNombre(acabado)] : undefined;
  const familias = delCatalogo ?? (acabado ? acabadoObservado([acabado]).familias : []);
  // El orden de `familias` es una prioridad, no un conjunto: «cromado» devuelve `["reflex", "metal"]` porque
  // un cromado es antes un Reflex que un Metal, y los dos se leen cromados en una foto. Filtrar y quedarse
  // con la primera de la **tabla** daba el Metal Dorado (`#8c6b30`) donde se compra el Reflex (`#c5a253`).
  for (const familia of familias) {
    const encontrada = referencias.find((r) => r.familia === (familia as string));
    if (encontrada) return encontrada;
  }
  // Sin acabado que restrinja, o con uno que ninguna de estas referencias tiene, la primera de la tabla: su
  // orden es el de la lámina del fabricante, que empieza por la familia Fashion, la que se vende por defecto.
  return referencias[0]!;
}

/**
 * La referencia que nombra el TÍTULO del producto que se compra, o `null` si no nombra un solo tono de la
 * lámina. Es `referencia_del_titulo` de `services/ai-api/app/color_catalogo.py` (la guía de escena ya la usa):
 * el color del material es la familia («azul») y la familia cae en su primera referencia, el Azul 040, un
 * cian; el producto dice el tono («Fashion Azul Rey»). Con el color grueso, el prompt de Gemini pedía
 * `#01b2e8` para unas piezas azul rey (CASE-005 y CASE-007 de images-judge). Se busca el nombre más largo de
 * la lámina que el título dice con palabras enteras; con dos tonos distintos, ninguno.
 */
export function referenciaDelTitulo(titulo: string | null | undefined, acabado: string | null): ReferenciaSempertex | null {
  if (!titulo) return null;
  const plegado = ` ${plegarNombre(titulo).replace(/[^a-z0-9]+/g, " ").trim()} `;
  const dichos = [...CODIGOS_POR_NOMBRE_ES.keys()].filter((nombre) => plegado.includes(` ${nombre} `));
  // «azul» va dentro de «azul rey»: el nombre que otro más largo contiene no es otro tono.
  const tonos = dichos.filter((nombre) => !dichos.some((otro) => otro !== nombre && ` ${otro} `.includes(` ${nombre} `)));
  return tonos.length === 1 ? referenciaDelCatalogo(tonos[0]!, acabado) : null;
}

/**
 * Las palabras de acabado que aparecen dentro de un nombre en inglés. No son colores: el acabado se decide
 * aparte, por familia (`acabado-observado.ts`), y dejarlas en el índice haría que «matte white» y «matte
 * green» se parecieran por la palabra «matte».
 */
const PALABRAS_DE_ACABADO = new Set([
  "matte",
  "satin",
  "chrome",
  "metallic",
  "pearlescent",
  "neon",
  "pastel",
  "dusk",
  "bright",
  "glossy",
  "translucent",
  "crystal",
  "silk",
  "reflex",
  "fashion",
]);

/**
 * De una **palabra** de un nombre en inglés a los códigos que la llevan: `green` son los doce verdes,
 * `light` son todas las referencias claras. Es el índice con el que se resuelve un color que el analizador
 * nombró con otras palabras que las de la lámina.
 */
export const CODIGOS_POR_PALABRA_EN: ReadonlyMap<string, string[]> = (() => {
  const indice = new Map<string, string[]>();
  for (const r of TABLA_SEMPERTEX.referencias) {
    const palabras = new Set(`${r.nombreEn} ${r.nombreBase}`.toLowerCase().split(/[^a-z]+/).filter(Boolean));
    for (const palabra of palabras) {
      if (PALABRAS_DE_ACABADO.has(palabra)) continue;
      const previos = indice.get(palabra);
      if (previos) previos.push(r.codigo);
      else indice.set(palabra, [r.codigo]);
    }
  }
  return indice;
})();

/**
 * De la **palabra que encabeza** un color de la lámina a sus códigos: `green` son los doce verdes, `pink`
 * los rosados, `gold` los dorados. Es la última palabra del nombre en inglés, que en inglés es el sustantivo:
 * en «rose gold» la cabeza es `gold` y `rose` solo lo modifica.
 *
 * Esa distinción es la que evita el error tonto: `dusty rose` **no** abre las candidatas de «rose gold»,
 * porque `rose` no encabeza ningún color. Una etiqueta cuya última palabra no encabeza nada se queda sin
 * resolver, que es lo honesto: no sabemos de qué color del catálogo habla.
 */
const CABEZAS_EN: ReadonlyMap<string, string[]> = (() => {
  const indice = new Map<string, string[]>();
  for (const r of TABLA_SEMPERTEX.referencias) {
    for (const nombre of [r.nombreEn, r.nombreBase]) {
      const palabras = nombre.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      const cabeza = palabras[palabras.length - 1];
      if (!cabeza || PALABRAS_DE_ACABADO.has(cabeza)) continue;
      const previos = indice.get(cabeza);
      if (previos) {
        if (!previos.includes(r.codigo)) previos.push(r.codigo);
      } else {
        indice.set(cabeza, [r.codigo]);
      }
    }
  }
  return indice;
})();

/**
 * Los códigos que puede ser una etiqueta del analizador que **no** es un nombre de la lámina.
 *
 * El analizador escribe lo que ve con las palabras que quiere: `forest green`, `light green`, `emerald
 * green`, `olive green`. Ninguna de esas cuatro está en el catálogo, que llama a sus verdes Verde Trébol,
 * Verde Lima, Verde Selva, Eucalipto, Té Verde, Verde Menta y Verde Aurora. Hasta ahora una etiqueta así se
 * caía entera y el color desaparecía del análisis: una foto de un arco verde oscuro, verde lima y blanco
 * salía con **un solo color**, el blanco, que era la única etiqueta que la lámina conocía por su nombre.
 *
 * La regla no cambia —**solo se lista lo que el análisis nombró**—, pero nombrar un color no es acertar con
 * el nombre de catálogo: decir «un verde oscuro» también es nombrarlo. Las palabras acotan las candidatas y
 * **los píxeles eligen cuál es**, que es el mismo reparto de trabajo que el resto del módulo: el modelo dice
 * qué hay, la foto dice cuál.
 *
 * La última palabra abre el abanico (tiene que encabezar un color de la lámina) y las anteriores lo cierran,
 * **mientras dejen algo**: `light pink` deja solo los rosados claros, y `light green` —donde la lámina no
 * tiene ningún verde claro con ese nombre— deja todos los verdes en vez de quedarse sin ninguno.
 */
export function codigosPorPalabras(etiqueta: string): string[] {
  const palabras = etiqueta.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const cabeza = palabras[palabras.length - 1];
  const base = cabeza ? CABEZAS_EN.get(cabeza) : undefined;
  if (!base) return [];
  let acotado = [...base];
  for (const palabra of palabras.slice(0, -1)) {
    const codigos = CODIGOS_POR_PALABRA_EN.get(palabra);
    if (!codigos) continue;
    const cruce = acotado.filter((c) => codigos.includes(c));
    if (cruce.length > 0) acotado = cruce;
  }
  return acotado;
}
