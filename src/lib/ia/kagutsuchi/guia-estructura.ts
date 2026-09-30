import type { ArmadoGuirnaldaResuelto } from "@/lib/plan/armado-guirnalda";
import { geometriaDeDibujo, type PatronColorResuelto } from "@/lib/plan/patron-color";
import type { LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
// La geometría y la leyenda de la gráfica del plan (ADR-0028, ADR-0032),
// importadas tal cual: la guía dibuja lo mismo que ve el decorador, sin repetirlo.
import { dibujarGuirnalda } from "@/components/plan/guirnalda/geometria-guirnalda";
import { colorDeCodigo, leyendaGuirnalda } from "@/components/plan/guirnalda/leyenda-guirnalda";
import { dibujarPatron, type EntradaDibujo } from "@/components/plan/patron/geometria-dibujo";
import { colorDe, leyendaPatron } from "@/components/plan/patron/leyenda";

/**
 * Guía plana de la estructura para el `/edit` del LoRA (ADR-0033): el "mapa de
 * color" del modo plano de `clasificador-decoraciones` (`guia.ts`), dibujado
 * aquí desde el plan resuelto en vez de limpiar un SVG de pantalla.
 *
 * - Un disco plano por globo, con su color y su tamaño relativo, en la
 *   posición y el orden de pintura de la gráfica del plan
 *   (`dibujarGuirnalda`, `dibujarPatron`): la forma, la caída, el arqueo, el
 *   desnivel, los racimos y el relleno son los que firmó Python.
 * - Sin sombras, brillos, números, texto, cuerdas ni patas: una cuerda se lee
 *   como cinta y una base como pata.
 * - Fondo neutro liso (`#f4f4f2`, el del origen). La pared es ese fondo; solo
 *   una pieza que se apoya en el piso lleva un plano de piso.
 * - Contorno fino en los colores claros: sin él, un blanco desaparece contra
 *   el fondo (lección del origen, `guia.ts:50-57`).
 *
 * Puro y determinista: el mismo plan da el mismo SVG. Rasterizar es de
 * `rasterizar-guia.ts`, en el servidor.
 */

export const FONDO_GUIA = "#f4f4f2";
export const PISO_GUIA = "#e4e4e0";
const CONTORNO_CLARO = "#b9b9b4";
/** Lado mayor de la guía en píxeles: fal cobra cada imagen de entrada como un megapíxel. */
export const LADO_MAYOR_GUIA = 1024;
/** Tamaño de la carta de color, el del origen. */
export const CARTA = { ancho: 768, alto: 256 } as const;
/**
 * Precio por megapíxel (entrada o salida) de FLUX.2 en fal que usó el origen
 * (`presupuesto.ts`), sin verificar hoy contra fal: todo lo que se calcula con
 * él es ESTIMADO. Cada imagen de entrada cuenta como un megapíxel.
 */
export const PRECIO_MP_USD_ESTIMADO = 0.021;

/** Coste estimado de las imágenes de entrada que añade la guía (guía y carta). */
export function costeEntradasUsdEstimado(entradas: number): number {
  return Math.round(entradas * PRECIO_MP_USD_ESTIMADO * 1000) / 1000;
}

type TipoConPatron = "arco" | "columna" | "semiarco" | "pared";
const TIPOS_CON_PATRON: ReadonlySet<string> = new Set<TipoConPatron>(["arco", "columna", "semiarco", "pared"]);

export type EstructuraConGuia =
  | { clase: "guirnalda"; estructura_id: string; armado: ArmadoGuirnaldaResuelto; lineas: readonly LineaMaterial[] }
  | {
      clase: "patron";
      estructura_id: string;
      tipo: TipoConPatron;
      patron: PatronColorResuelto;
      materiales: ReadonlyArray<{ product_id: string; color?: string; acabado?: string }>;
      lineas: readonly LineaMaterial[];
      oficialId?: string;
      espejo: boolean;
      proporcion?: number;
    };

/**
 * La estructura que la guía puede dibujar, o `null`. Solo con UNA estructura
 * en la escena (una sola pieza, sin props de catálogo): una guía de varias
 * piezas tendría que repartirlas por `target_bbox` y eso es otro trabajo.
 * - guirnalda con armado (sus racimos);
 * - arco, columna o semiarco con un patrón aplicado de racimos;
 * - pared con un patrón aplicado y la silueta real de Python. Sin la guía, el
 *   único canal que le queda al generador es el texto, y el caption NO puede
 *   decirle dónde va un color: `corner` no existe en el corpus de v007 y en el
 *   de v004 significa una esquina del local, no un cuadrante de la pieza. Una
 *   pared con el color agrupado en zonas (ADR-0036) solo es transportable
 *   dibujada.
 */
export function estructuraParaGuia(plan: Pick<PlanResuelto, "plan" | "estructuras" | "props" | "patrones_color" | "armados_guirnalda">): EstructuraConGuia | null {
  if (plan.estructuras.length !== 1 || (plan.props?.length ?? 0) > 0) return null;
  const estructura = plan.estructuras[0]!;
  if (estructura.repeticiones !== 1) return null;
  const declarada = plan.plan.estructuras.find((item) => item.estructura_id === estructura.estructura_id);
  if (estructura.tipo === "guirnalda") {
    const armado = plan.armados_guirnalda?.find((item) => item.estructura_id === estructura.estructura_id);
    return armado && armado.racimos.length > 0 && armado.repeticiones === 1
      ? { clase: "guirnalda", estructura_id: estructura.estructura_id, armado, lineas: estructura.lineas }
      : null;
  }
  if (!TIPOS_CON_PATRON.has(estructura.tipo) || !declarada) return null;
  const patron = plan.patrones_color?.find((item) => item.estructura_id === estructura.estructura_id && item.aplicado);
  if (!patron || patron.repeticiones !== 1 || !patron.celdas.length) return null;
  // Arco, columna y semiarco dibujan sus racimos. Una pared es una rejilla, y
  // solo sirve de guía con la SILUETA real que armó Python: el contorno de borde
  // vivo y la posición de cada globo. Sin `posiciones` el dibujo sería una
  // rejilla regular, que es exactamente lo que no hay que enseñarle al
  // generador de una pared orgánica; en ese caso no se manda guía.
  const admitida = estructura.tipo === "pared" ? geometriaDeDibujo(patron) === "silueta" : patron.geometria === "racimos";
  if (!admitida) return null;
  const medidas = "medidas" in declarada ? declarada.medidas : undefined;
  const proporcion = medidas?.alto_m && medidas.ancho_m ? medidas.alto_m / medidas.ancho_m : undefined;
  const oficialId = "estructura_oficial" in declarada ? declarada.estructura_oficial : undefined;
  return {
    clase: "patron",
    estructura_id: estructura.estructura_id,
    tipo: estructura.tipo as TipoConPatron,
    patron,
    materiales: declarada.materiales.map((material) => ({
      product_id: material.product_id,
      ...(material.color ? { color: material.color } : {}),
      ...(material.acabado ? { acabado: material.acabado } : {}),
    })),
    lineas: estructura.lineas,
    ...(oficialId ? { oficialId } : {}),
    espejo: estructura.ubicacion === "lateral_derecho",
    ...(proporcion ? { proporcion } : {}),
  };
}

/** Un globo de la guía, en unidades del dibujo de la gráfica. */
export type DiscoGuia = { x: number; y: number; r: number; hex: string };

/** Discos en orden de pintura (lo de atrás primero) y si la pieza se apoya en el piso. */
export function discosDeGuia(estructura: EstructuraConGuia): { discos: DiscoGuia[]; sobrePiso: boolean } {
  if (estructura.clase === "guirnalda") {
    const leyenda = leyendaGuirnalda(estructura.armado, [...estructura.lineas]);
    const dibujo = dibujarGuirnalda(estructura.armado);
    return {
      discos: dibujo.globos.map((globo) => ({ x: globo.x, y: globo.y, r: globo.r, hex: colorDeCodigo(leyenda, globo.codigo).hex })),
      sobrePiso: estructura.armado.armado.soporte === "piso",
    };
  }
  const { patron } = estructura;
  const leyenda = leyendaPatron(estructura.materiales, [...estructura.lineas], patron.conteo);
  // Lo mismo que `VistaPatron` le pasa a `dibujarPatron`; su soporte (la base de
  // una columna) no se dibuja: se leería como una pata.
  const entrada: EntradaDibujo = {
    geometria: geometriaDeDibujo(patron),
    ...(patron.posiciones ? { posiciones: patron.posiciones } : {}),
    tipo: estructura.tipo,
    oficialId: estructura.oficialId,
    celdas: patron.celdas,
    extras: patron.extras,
    trazo: patron.patron.base.modo === "espiral" ? patron.patron.base.trazo : undefined,
    espejo: estructura.espejo,
    proporcion: estructura.proporcion,
  };
  const dibujo = dibujarPatron(entrada);
  return {
    discos: dibujo.globos.map((globo) => ({ x: globo.x, y: globo.y, r: globo.r, hex: colorDe(leyenda, globo.material).hex })),
    sobrePiso: true,
  };
}

/** Tamaño en píxeles de la guía: el aspecto de la imagen que se pide (`imageSizeFor`), con el lado mayor acotado. */
export function tamanoGuia(salida: { width: number; height: number }): { ancho: number; alto: number } {
  const escala = LADO_MAYOR_GUIA / Math.max(salida.width, salida.height);
  return { ancho: Math.round(salida.width * escala), alto: Math.round(salida.height * escala) };
}

/** Relación alto / ancho del globo, la de la gráfica. */
const OVALO = 1.06;

function redondear(valor: number): number {
  if (!Number.isFinite(valor)) throw new Error("GUIA_ESTRUCTURA_INVALIDA: la geometría dio un valor no finito.");
  return Math.round(valor * 100) / 100;
}

/** Luminancia relativa (WCAG) de un `#rrggbb`. */
function luminancia(hex: string): number {
  const canal = (inicio: number) => {
    const valor = Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255;
    return valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * El SVG de la guía: los discos encajados en el encuadre de salida, centrados,
 * con margen; sobre el piso, la base de la pieza toca el plano del piso.
 */
export function svgGuia(discos: readonly DiscoGuia[], sobrePiso: boolean, tamano: { ancho: number; alto: number }): string {
  if (!discos.length) throw new Error("GUIA_ESTRUCTURA_INVALIDA: la estructura no tiene globos que dibujar.");
  const { ancho, alto } = tamano;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const disco of discos) {
    if (!HEX.test(disco.hex)) throw new Error(`GUIA_ESTRUCTURA_INVALIDA: color ${disco.hex} fuera de formato.`);
    minX = Math.min(minX, disco.x - disco.r);
    maxX = Math.max(maxX, disco.x + disco.r);
    minY = Math.min(minY, disco.y - disco.r * OVALO);
    maxY = Math.max(maxY, disco.y + disco.r * OVALO);
  }
  const margenX = ancho * 0.08;
  const margenArriba = alto * 0.08;
  const piso = sobrePiso ? redondear(alto * 0.88) : null;
  const abajo = piso ?? alto - alto * 0.08;
  const escala = Math.min((ancho - margenX * 2) / Math.max(maxX - minX, 1e-6), (abajo - margenArriba) / Math.max(maxY - minY, 1e-6));
  const desplazaX = (ancho - (maxX - minX) * escala) / 2 - minX * escala;
  // Sobre el piso, la base toca el piso; en la pared o colgada, la pieza va centrada.
  const desplazaY = piso !== null ? piso - maxY * escala : (margenArriba + abajo - (maxY - minY) * escala) / 2 - minY * escala;
  const partes = [`<rect x="0" y="0" width="${ancho}" height="${alto}" fill="${FONDO_GUIA}"/>`];
  if (piso !== null) partes.push(`<rect x="0" y="${piso}" width="${ancho}" height="${redondear(alto - piso)}" fill="${PISO_GUIA}"/>`);
  for (const disco of discos) {
    const r = disco.r * escala;
    const claro = luminancia(disco.hex) > 0.7;
    const contorno = claro ? ` stroke="${CONTORNO_CLARO}" stroke-width="${redondear(Math.max(1, r * 0.05))}"` : "";
    partes.push(`<ellipse cx="${redondear(disco.x * escala + desplazaX)}" cy="${redondear(disco.y * escala + desplazaY)}" rx="${redondear(r)}" ry="${redondear(r * OVALO)}" fill="${disco.hex.toLowerCase()}"${contorno}/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">${partes.join("")}</svg>`;
}

/** Los colores de la guía, cada uno una vez, en el orden en que se pintan. */
export function coloresDeGuia(discos: readonly DiscoGuia[]): string[] {
  return [...new Set(discos.map((disco) => disco.hex.toLowerCase()))];
}

/**
 * La carta de color (origen: `carta.ts`): franjas verticales planas del mismo
 * ancho con los colores exactos del armado, y nada más. Sin una letra: un
 * modelo de imagen copia el texto que ve.
 */
export function svgCarta(hexes: readonly string[], ancho: number = CARTA.ancho, alto: number = CARTA.alto): string {
  const lista = hexes.filter((hex) => HEX.test(hex)).map((hex) => hex.toLowerCase());
  if (!lista.length) throw new Error("GUIA_ESTRUCTURA_INVALIDA: la carta de color necesita al menos un color.");
  const franja = ancho / lista.length;
  const franjas = lista.map((hex, indice) => `<rect x="${redondear(indice * franja)}" y="0" width="${redondear(franja + 0.5)}" height="${alto}" fill="${hex}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}">${franjas}</svg>`;
}

/**
 * Cuándo la generación lleva guía (ADR-0033): bandera encendida, LoRA directo
 * en texto (sin híbrido), sin foto del espacio ni resultado previo (esas ya son
 * la base de `/edit`) y con `/edit` disponible. Con foto del espacio queda
 * pendiente.
 */
export function generacionAdmiteGuia(entrada: { bandera: boolean; usarLora: boolean; hibrido: boolean; fotoEspacio: boolean; resultadoPrevio: boolean; editApagado: boolean; formatoTexto: boolean }): boolean {
  return entrada.bandera && entrada.usarLora && !entrada.hibrido && !entrada.fotoEspacio && !entrada.resultadoPrevio && !entrada.editApagado && entrada.formatoTexto;
}

/**
 * El caption que acompaña a la guía, dentro del presupuesto del LoRA
 * (`LORA_PROMPT_MAX_LENGTH`): las notas de la guía y de la carta cuentan contra
 * él, como la instrucción de presentación del híbrido, y el compilador
 * compacta el caption con sus pasos de siempre (tamaños, entorno, cola,
 * etiquetas; nunca estructuras, colores ni el patrón). Si ni así cabe, la carta
 * y su nota salen primero (la guía es la que manda la estructura); si tampoco,
 * `null`: la generación sigue sin guía, como con la bandera apagada, y quien
 * llama lo registra.
 */
export function elegirCaptionConGuia<T, I>(entrada: {
  imagenes: readonly I[];
  maximo: number;
  reserva: (conCarta: boolean) => number;
  compilar: (maxLength: number) => T;
  cabe: (compilacion: T, imagenes: readonly I[]) => boolean;
  /**
   * Cuánto caption sobrevive a la compactación. Sin él se conserva el
   * comportamiento viejo (la primera que quepa); con él se elige la que menos
   * pierde, que es lo que evita que la carta se lleve por delante los diámetros.
   */
  largo?: (compilacion: T) => number;
}): { compilacion: T; imagenes: readonly I[] } | null {
  const intentos = entrada.imagenes.length > 1 ? [entrada.imagenes, entrada.imagenes.slice(0, 1)] : [entrada.imagenes];
  const validos: Array<{ compilacion: T; imagenes: readonly I[] }> = [];
  for (const imagenes of intentos) {
    const compilacion = entrada.compilar(entrada.maximo - entrada.reserva(imagenes.length > 1));
    if (entrada.cabe(compilacion, imagenes)) validos.push({ compilacion, imagenes });
  }
  if (!validos.length) return null;
  if (!entrada.largo) return validos[0]!;
  // No basta con "la primera que quepa": las notas de la guía y de la carta se
  // descuentan del presupuesto ANTES de compilar, así que la variante CON carta
  // compila con 353 caracteres menos y el compilador compacta más. Con una pared
  // de zonas eso borraba los tres "(12-inch)" del caption (medido 2026-09-30),
  // y los diámetros son justo lo que la guía NO transporta: dibuja el sitio y el
  // color, no el tamaño. La carta es lo prescindible, no el globo.
  //
  // Se queda con la que MENOS pierde, y a igualdad manda la primera, que es la
  // que lleva carta: mientras no cueste nada, la carta viaja.
  return validos.reduce((mejor, actual) => (entrada.largo!(actual.compilacion) > entrada.largo!(mejor.compilacion) ? actual : mejor));
}
