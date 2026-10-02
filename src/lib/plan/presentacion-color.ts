import type { AnalisisColorSempertex, CandidataColor, ColorConReferencia, ColorDePieza } from "./analisis-color";
import { ESTRUCTURAS_OFICIALES, esEstructuraOficialId } from "./estructuras-oficiales";

/**
 * Cómo se le cuenta al cliente el color medido de su foto (`analisis-color.ts`), sin la jerga del análisis.
 *
 * El análisis trae cosas de auditoría —el id interno de la pieza, el croquis, los píxeles, el hex, el Pantone,
 * el tono y el croma, las distancias y las marcas internas— que son útiles para quien depura y confunden a
 * quien compra. Aquí se decide qué se dice y con qué palabras; el componente (`ColoresSempertex.tsx`) solo
 * pinta lo que sale de `vistaDeColores`. Lo técnico no se pierde: sigue entero en `DetalleTecnicoColores.tsx`.
 *
 * Puro: sin React, sin red y sin estado. Nada comercial se calcula aquí —ni dinero ni cantidades—: solo se
 * nombran y ordenan cosas que el análisis ya midió. El porcentaje es la parte del color en la pieza tal como
 * vino, redondeada para mostrarse.
 */

// ---------------------------------------------------------------------------
// Nombre de la pieza
// ---------------------------------------------------------------------------

/**
 * Los tipos del plan que no tienen una estructura oficial con su mismo id (`estructuras-oficiales.ts` solo
 * nombra la pared por su variante). Para el resto se reutiliza el nombre oficial: `arco`, `semiarco`,
 * `columna`, `guirnalda` y `centro_mesa` son a la vez tipo del plan e id de estructura oficial.
 */
const NOMBRE_TIPO_SIN_OFICIAL: Readonly<Record<string, string>> = {
  pared: "Pared de globos",
  kit: "Arreglo de globos",
};

const NOMBRE_PIEZA_DESCONOCIDA = "Pieza";

/** «Columna», «Arco», «Pared de globos»: el nombre de un tipo de estructura en palabras del cliente. */
export function nombreDeTipoDePieza(tipo: string): string {
  const clave = tipo.trim().toLowerCase();
  if (esEstructuraOficialId(clave)) return ESTRUCTURAS_OFICIALES[clave].nombre;
  return NOMBRE_TIPO_SIN_OFICIAL[clave] ?? NOMBRE_PIEZA_DESCONOCIDA;
}

/**
 * Un nombre humano por pieza, en el mismo orden que la entrada. Solo se numera cuando hay más de una del
 * mismo nombre («Columna 1», «Columna 2»; un arco solo se queda en «Arco»): el número cuenta por orden de
 * aparición entre las piezas que se llaman igual, así que no depende del id interno.
 */
export function etiquetasDePiezas(piezas: ReadonlyArray<{ tipo: string }>): string[] {
  const nombres = piezas.map((pieza) => nombreDeTipoDePieza(pieza.tipo));
  const total = new Map<string, number>();
  for (const nombre of nombres) total.set(nombre, (total.get(nombre) ?? 0) + 1);
  const visto = new Map<string, number>();
  return nombres.map((nombre) => {
    if ((total.get(nombre) ?? 0) < 2) return nombre;
    const numero = (visto.get(nombre) ?? 0) + 1;
    visto.set(nombre, numero);
    return `${nombre} ${numero}`;
  });
}

// ---------------------------------------------------------------------------
// Acabado
// ---------------------------------------------------------------------------

/**
 * El acabado del globo en español. La lista sale de `contracts/domain/v1/sempertex/tabla-color.json`
 * (`referencias[].acabado`, generada por el repo dueño del catálogo y validada en `referencia-sempertex.ts`):
 * hoy son ocho textos en inglés. La tabla es cerrada a propósito —un acabado nuevo no se traduce adivinando—
 * y `acabadoEnEspanol` devuelve el texto original cuando no lo conoce. La prueba
 * `test-presentacion-color.ts` falla si la tabla del catálogo trae uno que aquí no está, para añadirlo.
 */
const ACABADO_EN_ESPANOL: Readonly<Record<string, string>> = {
  matte: "mate",
  translucent: "translúcido",
  "pastel dusk matte": "pastel mate",
  satin: "satinado",
  "pearlescent satin": "satinado perlado",
  "bright matte": "mate neón",
  "metallic sheen": "metalizado",
  "glossy chrome": "cromado brillante",
};

/** Los acabados que la tabla conoce, tal como los escribe el catálogo (para la prueba de cobertura). */
export const ACABADOS_CONOCIDOS: readonly string[] = Object.keys(ACABADO_EN_ESPANOL);

export function acabadoEnEspanol(acabado: string): string {
  return ACABADO_EN_ESPANOL[acabado.trim().toLowerCase()] ?? acabado;
}

// ---------------------------------------------------------------------------
// Parecido
// ---------------------------------------------------------------------------

/**
 * Hasta qué distancia de globo se dice «muy parecido» y hasta cuál «parecido». Son los umbrales que la
 * vista técnica ya usaba para colorear el número (verde, ámbar, rojo): la escala es la distancia de globo de
 * `referencia-sempertex.ts` (grados de tono, con la claridad a la mitad y el croma solo cuando se sale de lo
 * que la sombra explica), no ΔE. Hay una sola definición y la leen las dos vistas.
 */
export const UMBRAL_MUY_PARECIDO = 14;
export const UMBRAL_PARECIDO = 26;

export type NivelParecido = "muy_parecido" | "parecido" | "aproximado";

export function nivelDeParecido(distancia: number): NivelParecido {
  if (distancia <= UMBRAL_MUY_PARECIDO) return "muy_parecido";
  if (distancia <= UMBRAL_PARECIDO) return "parecido";
  return "aproximado";
}

export const TEXTO_PARECIDO: Readonly<Record<NivelParecido, string>> = {
  muy_parecido: "Muy parecido",
  parecido: "Parecido",
  aproximado: "Aproximado",
};

/** Cuántos de los tres puntos del medidor se llenan: una señal que no depende del color. */
export const PUNTOS_PARECIDO: Readonly<Record<NivelParecido, 1 | 2 | 3>> = {
  muy_parecido: 3,
  parecido: 2,
  aproximado: 1,
};

// ---------------------------------------------------------------------------
// Frases de los casos especiales
// ---------------------------------------------------------------------------

export const FRASE_NEUTRO = "Color neutro (blanco, gris o negro)";
export const FRASE_SIN_REFERENCIA = "No encontramos un globo igual: puede ser sombra, fondo o un adorno";
export const TEXTO_PIEZA_SIN_COLORES = "No pudimos medir colores en esta pieza";

/**
 * Las frases de persona de un color, en el orden en que se leen. `porNombre` es una marca interna (el
 * analizador nombró el globo) y no se dice. Un color sin referencia no se nombra ni se matiza: sería inventar.
 */
export function notasDeColor(color: ColorConReferencia): string[] {
  const { cruce } = color;
  if (cruce.sinReferencia) return [FRASE_SIN_REFERENCIA];
  const notas: string[] = [];
  if (cruce.neutro) notas.push(FRASE_NEUTRO);
  const segunda = cruce.candidatas[1];
  if (cruce.ambigua && !cruce.porNombre && segunda) notas.push(`Podría ser también ${segunda.nombreCompleto}`);
  return notas;
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

/** Un globo del catálogo, con lo justo para nombrarlo y mostrar su muestra. */
export type GloboSugerido = {
  codigo: string;
  /** Nombre comercial, como se pide en la tienda («Reflex Plata»). */
  nombre: string;
  /** El color del globo inflado. Es dato del catálogo, no un color del tema. */
  hexGlobo: string;
  /** El acabado tal como lo escribe el catálogo: lo necesita quien dibuja el brillo de la muestra. */
  acabadoOriginal: string;
  acabado: string;
};

export type VistaColor = {
  clave: string;
  /** El color medido en la foto, para la muestra «En tu foto». */
  hexEnFoto: string;
  /** La mejor candidata; `null` cuando ninguna se parece (no se nombra una «más cercana»). */
  globo: GloboSugerido | null;
  parecido: { nivel: NivelParecido; texto: string; puntos: 1 | 2 | 3 } | null;
  /** 0–100, redondeado, para la barra. */
  porcentaje: number;
  textoPorcentaje: string;
  /** «37 %»: lo que cabe en una fila; el texto largo va a quien lee con lector de pantalla. */
  porcentajeCorto: string;
  notas: string[];
  /** Las otras candidatas, solo con su nombre comercial; vacío si no hay otras. */
  otras: GloboSugerido[];
  /** A qué color se refieren las otras dentro del plegable («Para Reflex Plata»). */
  etiquetaOtras: string;
};

export type VistaPieza = {
  clave: string;
  nombre: string;
  colores: VistaColor[];
  avisos: string[];
  /** Frase para cuando no hay colores; `null` si los hay. */
  sinColores: string | null;
};

function globoDe(candidata: CandidataColor): GloboSugerido {
  return {
    codigo: candidata.codigo,
    nombre: candidata.nombreCompleto,
    hexGlobo: candidata.hexGlobo,
    acabadoOriginal: candidata.acabado,
    acabado: acabadoEnEspanol(candidata.acabado),
  };
}

export function porcentajeDeLaPieza(parte: number): { valor: number; texto: string; corto: string } {
  const valor = Math.min(100, Math.max(0, Math.round(parte * 100)));
  return {
    valor,
    texto: valor === 0 ? "Menos del 1 % de la pieza" : `${valor} % de la pieza`,
    corto: valor === 0 ? "<1 %" : `${valor} %`,
  };
}

export function vistaDeColor(color: ColorConReferencia): VistaColor {
  const { cruce } = color;
  const mejor = cruce.candidatas[0];
  const porcentaje = porcentajeDeLaPieza(color.parte);
  // Con la más cercana tan lejos, nombrarla como sugerencia sería inventar; sus vecinas sí se ofrecen, pero
  // dichas como lo que son: lo más cercano que hay.
  const otras = (cruce.sinReferencia ? cruce.candidatas : cruce.candidatas.slice(1)).map(globoDe);
  const nombrable = cruce.sinReferencia || !mejor ? null : mejor;
  const nivel = nombrable ? nivelDeParecido(nombrable.distancia) : null;
  return {
    clave: color.hex,
    hexEnFoto: color.hex,
    globo: nombrable ? globoDe(nombrable) : null,
    parecido: nivel ? { nivel, texto: TEXTO_PARECIDO[nivel], puntos: PUNTOS_PARECIDO[nivel] } : null,
    porcentaje: porcentaje.valor,
    textoPorcentaje: porcentaje.texto,
    porcentajeCorto: porcentaje.corto,
    notas: notasDeColor(color),
    otras,
    etiquetaOtras: nombrable ? `Para ${nombrable.nombreCompleto}` : "Lo más cercano del catálogo",
  };
}

export function vistaDePieza(pieza: ColorDePieza, nombre: string): VistaPieza {
  return {
    clave: pieza.elementId,
    nombre,
    colores: pieza.colores.map(vistaDeColor),
    avisos: pieza.avisos,
    sinColores: pieza.colores.length === 0 ? TEXTO_PIEZA_SIN_COLORES : null,
  };
}

/** Todo lo que pinta el bloque de colores para el cliente; `[]` sin análisis. */
export function vistaDeColores(analisis: AnalisisColorSempertex | null): VistaPieza[] {
  if (!analisis) return [];
  const nombres = etiquetasDePiezas(analisis.piezas);
  return analisis.piezas.map((pieza, indice) => vistaDePieza(pieza, nombres[indice] ?? NOMBRE_PIEZA_DESCONOCIDA));
}

// ---------------------------------------------------------------------------
// El bloque entero, compacto
// ---------------------------------------------------------------------------

/** Con tantos colores o menos, el bloque se enseña abierto; con más, cerrado y con su resumen en una línea. */
export const MAX_COLORES_BLOQUE_ABIERTO = 4;

export function bloqueAbiertoPorDefecto(piezas: readonly VistaPieza[]): boolean {
  return piezas.reduce((total, pieza) => total + pieza.colores.length, 0) <= MAX_COLORES_BLOQUE_ABIERTO;
}

export type ResumenColores = {
  /** Cuántos globos distintos se sugieren (un mismo globo en dos piezas cuenta una vez). */
  total: number;
  /** «5 colores», o `null` si no se sugiere ninguno. */
  texto: string | null;
  /** Hasta seis, de los que más ocupan a los que menos, para las muestras en miniatura del resumen. */
  muestras: GloboSugerido[];
};

const MUESTRAS_DEL_RESUMEN = 6;

export function resumenDeColores(piezas: readonly VistaPieza[]): ResumenColores {
  const porCodigo = new Map<string, { globo: GloboSugerido; porcentaje: number }>();
  for (const pieza of piezas) {
    for (const color of pieza.colores) {
      if (!color.globo) continue;
      const previo = porCodigo.get(color.globo.codigo);
      if (!previo || color.porcentaje > previo.porcentaje) porCodigo.set(color.globo.codigo, { globo: color.globo, porcentaje: color.porcentaje });
    }
  }
  const ordenados = [...porCodigo.values()].sort((a, b) => b.porcentaje - a.porcentaje).map((entrada) => entrada.globo);
  const total = ordenados.length;
  return {
    total,
    texto: total === 0 ? null : total === 1 ? "1 color" : `${total} colores`,
    muestras: ordenados.slice(0, MUESTRAS_DEL_RESUMEN),
  };
}

/** Las notas de la medición de todas las piezas, con el nombre de la pieza delante cuando hay más de una. */
export function notasDelBloque(piezas: readonly VistaPieza[]): Array<{ pieza: string | null; aviso: string }> {
  return piezas.flatMap((pieza) => pieza.avisos.map((aviso) => ({ pieza: piezas.length > 1 ? pieza.nombre : null, aviso })));
}
