import { normalizarBusqueda } from "@/lib/biblioteca-sempertex/biblioteca";
import type { BriefGuiado, EstructuraCliente, MedidaCliente } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { esMensajeDeInterfaz } from "./contexto-cliente";
import { eventoDeTexto } from "./ideas-guiadas";
import { pedidoDeIdeas } from "./pedido-ideas";

/**
 * Lo que el cliente ya dijo, leído SIN modelo de sus propios mensajes (usabilidad 97, puntos 2 y 4).
 *
 * Caso real (guiada-20261006-232915-fskvm8): «Soy decorador. Un cliente me pide un arco orgánico de unos 3 metros en
 * blanco y dorado para una boda y necesito cotizarle». El modelo llamó directo a proponer_composicion: el brief quedó
 * solo con los colores, el plan salió de 2 × 2,2 m como `arco_asimetrico` (una pata en el aire), la cabecera vacía y al
 * pedir el precio se le preguntó si era para su negocio. Aquí se guarda, de forma determinista: el evento («boda»), el
 * uso («negocio» por «soy decorador» / «cotizarle»), la medida («unos 3 metros») y la pieza («arco orgánico» → el arco
 * completo `arco`, salvo que diga asimétrico). Lo más reciente manda. Puro: sin servidor ni modelo.
 */

export type UsoCliente = "negocio" | "personal";
export type HechosCliente = {
  evento?: string;
  uso?: UsoCliente;
  medida?: MedidaCliente;
  estructura?: EstructuraCliente;
  lugar?: string;
  momento?: string;
  presupuesto?: string;
};

// ── Uso ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Sobre el texto normalizado (sin tildes ni puntuación). «Quiero contratar un decorador» no es negocio: hace falta «soy».
const PERSONAL_RE = /\b(?:uso personal|es personal|para mi casa|en mi casa|para mi hogar|para mi familia|no es para (?:un |mi )?negocio|no es para vender|no soy (?:decorador|decoradora))\b/;
const NEGOCIO_RE = /\b(?:soy (?:decorador|decoradora|organizador|organizadora|wedding planner|planner|globoflexista)|somos (?:decoradores|decoradoras|una empresa)|para mi negocio|es para mi negocio|tengo (?:un|una) (?:negocio|empresa|tienda|emprendimiento)|mi emprendimiento|negocio de eventos|(?:un|una|mi|mis) client(?:e|a|es|as)|cotizarle|cotizarles|para revender|le cobro|les cobro)\b/;

/** «Soy decorador…», «Es para mi negocio» → negocio; «para mi casa», «uso personal» → personal; si no, null. */
export function usoDeTexto(texto: string): UsoCliente | null {
  const normal = normalizarBusqueda(texto);
  if (PERSONAL_RE.test(normal)) return "personal";
  if (NEGOCIO_RE.test(normal)) return "negocio";
  return null;
}

// ── Medida ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NUMERO = String.raw`(?<![\d.,])\d{1,2}(?:[.,]\d{1,2})?`;
const UNIDAD_M = String.raw`(?:m|mt|mts|metro|metros)\b\.?`;
const APROX = String.raw`(?:(?:de\s+)?(?:unos|unas|uno|una|aprox(?:imadamente)?\.?|como|cerca de|m[aá]s o menos|alrededor de)\s+)?`;
const DOS_MEDIDAS_RE = new RegExp(String.raw`${APROX}(${NUMERO})\s*(?:${UNIDAD_M})?\s*(?:x|×|por)\s*(${NUMERO})\s*${UNIDAD_M}`, "i");
const UNA_MEDIDA_RE = new RegExp(String.raw`${APROX}(${NUMERO})\s*${UNIDAD_M}(?:\s+de\s+(ancho|alto|altura|largo))?`, "i");
const CENTIMETROS_RE = new RegExp(String.raw`${APROX}(?<![\d.,])(\d{2,3})\s*(?:cm|cms|cent[ií]metros?)\b(?:\s+de\s+(ancho|alto|altura|largo))?`, "i");

function numero(texto: string): number {
  return Number(texto.replace(",", "."));
}

const plausible = (metros: number) => Number.isFinite(metros) && metros >= 0.3 && metros <= 30;

/** «unos 3 metros» → { texto: "unos 3 metros", metros: 3 }; «3 x 2,4 m» → ancho y alto; «2 metros de alto» → alto. */
export function medidaDeTexto(texto: string): MedidaCliente | null {
  const dos = DOS_MEDIDAS_RE.exec(texto);
  if (dos) {
    const [ancho, alto] = [numero(dos[1]!), numero(dos[2]!)];
    if (plausible(ancho) && plausible(alto)) return { texto: dos[0].trim().slice(0, 80), ancho_m: ancho, alto_m: alto };
  }
  const enMetros = UNA_MEDIDA_RE.exec(texto);
  const una = enMetros ?? CENTIMETROS_RE.exec(texto);
  if (!una) return null;
  const metros = numero(una[1]!) / (enMetros ? 1 : 100);
  if (!plausible(metros)) return null;
  const eje = una[2]?.toLocaleLowerCase("es");
  const dicho = una[0].trim().replace(/^de\s+/i, "").slice(0, 80);
  if (eje === "ancho") return { texto: dicho, ancho_m: metros };
  if (eje === "alto" || eje === "altura") return { texto: dicho, alto_m: metros };
  if (eje === "largo") return { texto: dicho, largo_m: metros };
  return { texto: dicho, metros };
}

/** Las medidas de la propuesta para una pieza: la medida sin eje va al ancho del arco, al alto de la columna o al largo de la guirnalda. */
export function medidasParaPieza(estructura: EstructuraOficialId, medida: MedidaCliente): { ancho_m?: number; alto_m?: number; largo_m?: number } | null {
  const tipo = ESTRUCTURAS_OFICIALES[estructura].tipoBase;
  const lineal = tipo === "guirnalda";
  const ejeDefecto = tipo === "columna" ? "alto_m" : lineal ? "largo_m" : tipo === "arco" || tipo === "semiarco" || tipo === "pared" ? "ancho_m" : null;
  if (!ejeDefecto) return null;
  const medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } = {};
  if (medida.ancho_m) medidas[lineal ? "largo_m" : "ancho_m"] = medida.ancho_m;
  if (medida.alto_m && !lineal) medidas.alto_m = medida.alto_m;
  if (medida.largo_m) medidas[lineal ? "largo_m" : "ancho_m"] = medida.largo_m;
  if (medida.metros && !medidas[ejeDefecto]) medidas[ejeDefecto] = medida.metros;
  return Object.keys(medidas).length ? medidas : null;
}

// ── Pieza ────────────────────────────────────────────────────────────────────────────────────────────────────────
type PiezaTexto = { patron: RegExp; id: (normal: string) => EstructuraOficialId; organica?: (normal: string) => boolean };
const ORGANICA = /\borganic[oa]s?\b/;
const ASIMETRICA = /\basimetric[oa]s?\b/;
/** En orden: lo más específico primero («medio arco» antes que «arco»). El texto es el normalizado. */
const PIEZAS_TEXTO: readonly PiezaTexto[] = [
  { patron: /\b(?:semi ?arcos?|medios? arcos?)\b(?: (?:organicos?|asimetricos?))*/, id: (normal) => (ASIMETRICA.test(normal) ? "semiarco_asimetrico" : "semiarco"), organica: (normal) => ORGANICA.test(normal) && !ASIMETRICA.test(normal) },
  // «arco orgánico» es el arco completo (banda entera en las dos patas); solo «asimétrico» lleva la banda que se afina.
  { patron: /\barcos?\b(?: (?:de globos|organicos?|asimetricos?|completos?))*/, id: (normal) => (ASIMETRICA.test(normal) ? "arco_asimetrico" : "arco"), organica: (normal) => ORGANICA.test(normal) && !ASIMETRICA.test(normal) },
  { patron: /\bcolumnas?\b(?: (?:de globos|organicas?|asimetricas?))*/, id: (normal) => (ORGANICA.test(normal) || ASIMETRICA.test(normal) ? "columna_asimetrica" : "columna") },
  { patron: /\bguirnaldas?\b(?: (?:de globos|organicas?))*/, id: () => "guirnalda" },
  { patron: /\baros?\b(?: (?:circular(?:es)?|de globos))*/, id: () => "aro_circular" },
  { patron: /\b(?:pared|muro)(?:es)? (?:de globos|organic[oa]s?)(?: organic[oa]s?)?/, id: (normal) => (ORGANICA.test(normal) ? "pared_organica" : "pared_densa") },
  { patron: /\btecho (?:de globos|con globos)\b/, id: () => "techo_globos" },
  { patron: /\b(?:bouquets?|ramilletes?) de globos\b|\bbouquets?\b/, id: () => "bouquet" },
  { patron: /\bcentros? de mesa\b/, id: () => "centro_mesa" },
];

/** «un arco orgánico de unos 3 metros» → { id: "arco", texto: "arco orgánico", organica: true }. */
export function estructuraDeTexto(texto: string): EstructuraCliente | null {
  const normal = normalizarBusqueda(texto);
  for (const pieza of PIEZAS_TEXTO) {
    const coincidencia = pieza.patron.exec(normal);
    if (!coincidencia) continue;
    const frase = coincidencia[0].trim();
    const id = pieza.id(frase);
    // Las palabras como las escribió el cliente (con tildes), si se encuentran; si no, las normalizadas.
    const original = new RegExp(frase.split(" ").map((palabra) => palabra.replace(/[aeiou]/g, (vocal) => `[${vocal}${"áéíóú"["aeiou".indexOf(vocal)]}]`)).join("\\s+"), "i").exec(texto)?.[0] ?? frase;
    return { id, texto: original.slice(0, 80), ...(pieza.organica?.(frase) ? { organica: true } : {}) };
  }
  return null;
}

// ── Lugar, momento y presupuesto (palabras literales) ────────────────────────────────────────────────────────────
const LUGAR_RE = /\b(?:en|para)\s+(?:un|una|el|la|mi|su|nuestro|nuestra)\s+(?:jard[ií]n|sal[oó]n(?:\s+de\s+(?:eventos|fiestas|recepciones))?|terraza|playa|finca|iglesia|restaurante|hotel|patio|oficina|colegio|piscina|parque|club|hacienda|carpa|auditorio|quinta)\b/i;
const MOMENTO_RE = /\b(?:de noche|en la noche|por la noche|nocturn[ao]|de d[ií]a|en el d[ií]a|al atardecer|en la tarde|por la tarde|de tarde|en la ma[ñn]ana|por la ma[ñn]ana|al mediod[ií]a)\b/i;
const PRESUPUESTO_RE = /\b(?:presupuesto(?:\s+(?:de|es de|es))?|tengo|cuento con|m[aá]ximo|no m[aá]s de|hasta)\s+(?:unos?\s+)?(?:\$\s*)?\d[\d.,]*\s*(?:mil|millones?|mill[oó]n|k|pesos|cop)?(?:\s+(?:pesos|cop))?/i;

function presupuestoDeTexto(texto: string): string | null {
  const coincidencia = PRESUPUESTO_RE.exec(texto);
  if (!coincidencia) return null;
  const frase = coincidencia[0].trim();
  // Un número suelto («tengo 3 hijos») no es dinero: hace falta «presupuesto», «$», mil, millones, pesos o una cifra grande.
  return /presupuesto|\$|mil|mill|pesos|cop|\bk\b|\d{5,}|\d{1,3}[.,]\d{3}/i.test(frase) ? frase.slice(0, 80) : null;
}

/** Lo más reciente manda: se recorre del último mensaje al primero. Los textos de la interfaz y los pedidos de ver ideas no cuentan como pedido de pieza. */
export function hechosDelCliente(mensajesCliente: readonly string[]): HechosCliente {
  const hechos: HechosCliente = {};
  for (let indice = mensajesCliente.length - 1; indice >= 0; indice -= 1) {
    const texto = mensajesCliente[indice]!.trim();
    if (!texto) continue;
    hechos.uso ??= usoDeTexto(texto) ?? undefined;
    if (esMensajeDeInterfaz(texto)) continue;
    hechos.evento ??= eventoDeTexto(texto);
    hechos.medida ??= medidaDeTexto(texto) ?? undefined;
    if (!pedidoDeIdeas(texto)) hechos.estructura ??= estructuraDeTexto(texto) ?? undefined;
    hechos.lugar ??= LUGAR_RE.exec(texto)?.[0].trim().slice(0, 120);
    hechos.momento ??= MOMENTO_RE.exec(texto)?.[0].trim().slice(0, 60);
    hechos.presupuesto ??= presupuestoDeTexto(texto) ?? undefined;
  }
  return Object.fromEntries(Object.entries(hechos).filter(([, valor]) => valor !== undefined)) as HechosCliente;
}

// ── Propuesta con lo pedido ──────────────────────────────────────────────────────────────────────────────────────
type MedidasPieza = { ancho_m?: number; alto_m?: number; largo_m?: number };
type PiezaPropuesta = { estructura: EstructuraOficialId; cantidad: number; medidas?: MedidasPieza };

/**
 * La propuesta del modelo con la pieza y la medida que pidió el cliente: «arco orgánico de unos 3 metros» y el modelo
 * propone `arco_asimetrico` sin medidas → `arco` de 3 m de ancho. La pieza pedida reemplaza a la de su misma familia
 * (arco por arco); si no hay ninguna, se agrega (o reemplaza a la única de una pieza individual). La medida va a la
 * pieza pedida o, si no nombró ninguna, a la única pieza. `conservarPieza`: el cliente eligió la pieza con un botón.
 */
export function propuestaConLoPedido<P extends PiezaPropuesta>(piezas: readonly P[], brief: Pick<BriefGuiado, "estructura" | "medida">, opciones: { individual: boolean; conservarPieza: boolean }): { piezas: P[]; cambios: string[] } {
  let resultado: P[] = piezas.map((pieza) => ({ ...pieza }));
  const cambios: string[] = [];
  const pedida = opciones.conservarPieza ? undefined : brief.estructura?.id;
  if (pedida && !resultado.some((pieza) => pieza.estructura === pedida)) {
    const familia = ESTRUCTURAS_OFICIALES[pedida].tipoBase;
    const indice = opciones.individual ? 0 : resultado.findIndex((pieza) => ESTRUCTURAS_OFICIALES[pieza.estructura].tipoBase === familia);
    if (indice >= 0 && resultado[indice]) {
      cambios.push(`pieza ${resultado[indice]!.estructura} → ${pedida} (el cliente pidió «${brief.estructura!.texto}»)`);
      // Sin las medidas de la pieza que se reemplaza: eran de otra forma.
      const { medidas: _sinMedidas, ...resto } = resultado[indice]!;
      void _sinMedidas;
      resultado[indice] = { ...resto, estructura: pedida } as P;
    } else {
      cambios.push(`pieza ${pedida} agregada (el cliente pidió «${brief.estructura!.texto}»)`);
      resultado = [{ estructura: pedida, cantidad: 1 } as P, ...resultado];
    }
  }
  if (brief.medida) {
    const objetivo = brief.estructura && !opciones.conservarPieza ? brief.estructura.id : null;
    const destino = objetivo ? resultado.findIndex((pieza) => pieza.estructura === objetivo) : resultado.length === 1 ? 0 : -1;
    const pieza = destino >= 0 ? resultado[destino] : undefined;
    const medidas = pieza && !pieza.medidas ? medidasParaPieza(pieza.estructura, brief.medida) : null;
    if (pieza && medidas) {
      resultado[destino] = { ...pieza, medidas };
      cambios.push(`medidas de ${pieza.estructura}: ${JSON.stringify(medidas)} (el cliente dijo «${brief.medida.texto}»)`);
    }
  }
  return { piezas: resultado, cambios };
}

// ── Edad que se ve en la cabecera ────────────────────────────────────────────────────────────────────────────────
const RANGO_EDAD_RE = /^(?:de\s+)?(\d{1,2})\s*(?:a|-|–)\s*(\d{1,2})\s*(?:anos|ano)$/;

/**
 * Lo que eligió el cliente para la edad («4 a 6 años», «Adolescente», «Adulto», «9 años»), compatible con la edad que
 * guardó el modelo (5 → «4 a 6 años»). Undefined si no lo dijo con esas palabras.
 */
export function etiquetaEdadCliente(edad: number | undefined, mensajesCliente: readonly string[]): string | undefined {
  for (let indice = mensajesCliente.length - 1; indice >= 0; indice -= 1) {
    const original = mensajesCliente[indice]!.trim().replace(/[.!]+$/, "");
    const normal = normalizarBusqueda(original);
    const rango = RANGO_EDAD_RE.exec(normal);
    if (rango) {
      const [desde, hasta] = [Number(rango[1]), Number(rango[2])];
      if (!edad || (edad >= Math.min(desde, hasta) && edad <= Math.max(desde, hasta))) return `${desde} a ${hasta} años`;
      continue;
    }
    if (/^adolescentes?$/.test(normal)) return "Adolescente";
    if (/^adult[oa]s?$/.test(normal)) return "Adulto";
    const suelta = /^(?:cumple\s+)?(\d{1,2})\s*anos?$/.exec(normal);
    if (suelta && (!edad || Number(suelta[1]) === edad)) return `${Number(suelta[1])} años`;
  }
  return undefined;
}

// ── Brief ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * El brief que vuelve al cliente: el de antes, el que guardaron las herramientas y lo que dijo el cliente. El evento que
 * ya estaba (lo guardó el modelo con el cliente) no se pisa; el uso es el confirmado del turno.
 */
export function briefConHechos(base: BriefGuiado, hechos: HechosCliente, extra: { uso?: UsoCliente; edadTexto?: string }): BriefGuiado {
  const brief: BriefGuiado = { ...base };
  if (!brief.evento && hechos.evento) brief.evento = hechos.evento;
  const uso = extra.uso ?? hechos.uso;
  if (uso) brief.uso = uso;
  if (hechos.medida) brief.medida = hechos.medida;
  if (hechos.estructura) brief.estructura = hechos.estructura;
  if (hechos.lugar) brief.lugar = hechos.lugar;
  if (hechos.momento) brief.momento = hechos.momento;
  if (hechos.presupuesto) brief.presupuesto = hechos.presupuesto;
  if (extra.edadTexto) brief.edadTexto = extra.edadTexto;
  return brief;
}

/**
 * Frase para el estado confirmado del modelo: lo que el cliente ya dijo y no se le vuelve a preguntar. Con un plan
 * vigente, sin la pieza ni la medida del principio: el plan ya las tiene y un cambio conserva las suyas.
 */
export function textoHechosCliente(brief: BriefGuiado, opciones: { conPlan?: boolean } = {}): string | null {
  const partes = [
    brief.evento ? `evento: ${brief.evento}` : "",
    brief.estructura && !opciones.conPlan ? `pieza que pidió: ${brief.estructura.texto}` : "",
    brief.medida && !opciones.conPlan ? `medida: ${brief.medida.texto}` : "",
    brief.lugar ? `lugar: ${brief.lugar}` : "",
    brief.momento ? `momento: ${brief.momento}` : "",
    brief.presupuesto ? `presupuesto: ${brief.presupuesto}` : "",
  ].filter(Boolean);
  return partes.length ? `Lo que el cliente ya dijo (no lo vuelvas a preguntar; la propuesta lo respeta): ${partes.join("; ")}.` : null;
}
