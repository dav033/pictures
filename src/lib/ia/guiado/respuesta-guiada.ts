import { bibliotecaVisible, normalizarBusqueda, tematicasDisponibles } from "@/lib/biblioteca-sempertex/biblioteca";
import { esBabyShower, eventoDeTexto, generoBebeDe, ideasRealesDeOpcion, NOMBRE_GENERO, nombraGeneroBebe, type GeneroBebe } from "./ideas-guiadas";

/**
 * Dueño (2026-10-06/07): «YA TE DIJE QUE LAS OPCIONES QUE DESEMBOQUEN EN "NO ENCONTRÉ DECORACIONES DE ESTE ESTILO" O COSA
 * ASÍ DEBEN SER ELIMINADAS». Caso real: «Baby shower» → «¿niño, niña o neutro?» → «Neutro» → «No encontré ideas exactas
 * para un estilo neutro. ¿Te gustaría probar con beige, verde menta o blanco…?».
 *
 * Saneo determinista de cada respuesta de la vista guiada (fuera de plan, propuesta y proveedores):
 *  1. Cada opción de estilo, color, temática o género de la línea «Opciones:» se valida corriendo la búsqueda real que
 *     haría el clic (ideasRealesDeOpcion); sin decoraciones de ese estilo se quita y, si quedan menos de 2, se rellena con
 *     temáticas del evento que sí tienen. Las opciones de flujo (foto, edades, ciudades, sí/no…) se conservan.
 *  2. Las preguntas no ofrecen alternativas imposibles: «niño, niña o neutro» sin decoraciones neutras pasa a «niño o
 *     niña», y una pregunta que sugiere colores o temáticas sin ninguna decoración se sustituye por una con lo que hay.
 *  3. Nunca «no encontré», «no tengo una exacta», «no hay ideas…»: la frase se quita (o se queda lo que sigue al «pero»).
 * Lo mismo se aplica, oración a oración, al texto que se transmite mientras el modelo escribe (FiltroFlujoGuiado).
 */

export const CHIP_FOTO_GUIADA = "Tengo una foto de inspiración";
export const FRASE_IDEAS_GUIADAS = "Te dejo unas ideas que pueden encantarte, ¿alguna te gusta?";
export const PREGUNTA_ESTILO_GUIADA = "¿Qué estilo te gustaría para tu celebración?";

const OPCIONES_RE = /^(\**\s*opciones\s*:\**\s*)(.+)$/i;
const INICIO_OPCIONES_RE = /^[\s*]*opciones\s*:/i;

// Vocabulario de estilo (normalizado): colores, temáticas y estilos que el cliente podría tocar como opción.
const PALABRAS_DE_ESTILO = new Set([
  "rosa", "rosas", "rosado", "rosada", "fucsia", "dorado", "dorada", "oro", "blanco", "blanca", "negro", "negra", "azul", "celeste",
  "plateado", "plateada", "plata", "lila", "morado", "morada", "violeta", "purpura", "verde", "rojo", "roja", "naranja",
  "amarillo", "amarilla", "turquesa", "coral", "champagne", "champana", "beige", "crema", "pastel", "multicolor", "arcoiris", "neon",
  "cromado", "metalizado", "gris", "menta", "salvia", "nude", "durazno", "melocoton", "lavanda", "perla", "perlado", "marfil",
  "vino", "burdeos", "terracota", "mostaza", "cobre", "bronce", "aguamarina", "lima", "tierra", "terroso", "terrosos",
  "princesa", "princesas", "dinosaurio", "dinosaurios", "superheroe", "superheroes", "videojuego", "videojuegos", "unicornio",
  "unicornios", "espacio", "safari", "selva", "futbol", "frozen", "sirena", "sirenas", "tropical", "elegante", "romantico",
  "romantica", "infantil", "colorida", "colorido", "halloween", "navidad", "navideno", "navidena", "valentin", "flores", "floral",
  "primavera", "boho", "vintage", "rustico", "rustica", "minimalista", "osito", "ositos", "nubes", "animalitos", "mariposas",
  "estrellas", "luna", "circo", "granja", "mar", "marinero",
]);
// Familias que la raíz no junta: una palabra existe en el catálogo si existe cualquiera de su familia.
const FAMILIAS: readonly (readonly string[])[] = [
  ["rosa", "rosas", "rosado", "rosada"], ["dorado", "dorada", "oro"], ["plateado", "plateada", "plata"], ["blanco", "blanca"],
  ["negro", "negra"], ["azul", "azules", "celeste"], ["morado", "morada", "violeta", "purpura"], ["champagne", "champana"],
  ["navidad", "navideno", "navidena"], ["flores", "flor", "floral"], ["perla", "perlado", "perlados"], ["romantico", "romantica"],
  ["colorida", "colorido", "coloridos"], ["rustico", "rustica"],
];

const raiz = (palabra: string): string => palabra.replace(/(?:as|os|a|o|es|s)$/, "");

function palabrasNormalizadas(texto: string): string[] {
  return normalizarBusqueda(texto).split(" ").filter(Boolean);
}

function palabrasDeEstilo(texto: string): string[] {
  return palabrasNormalizadas(texto).filter((palabra) => PALABRAS_DE_ESTILO.has(palabra));
}

let vocabularioCatalogo: { firma: string; palabras: Set<string>; raices: Set<string> } | null = null;

/** Palabras de títulos y temáticas de la biblioteca visible (se recalcula si la biblioteca cambia). */
function vocabularioDeCatalogo(): { palabras: Set<string>; raices: Set<string> } {
  const visibles = bibliotecaVisible();
  const firma = `${visibles.length}:${visibles.map((decoracion) => decoracion.id).join(",").length}`;
  if (vocabularioCatalogo?.firma !== firma) {
    const palabras = new Set(visibles.flatMap((decoracion) => palabrasNormalizadas(`${decoracion.titulo} ${decoracion.tematica}`)));
    vocabularioCatalogo = { firma, palabras, raices: new Set([...palabras].map(raiz)) };
  }
  return vocabularioCatalogo;
}

/** ¿Hay alguna decoración visible con ese color o estilo? («beige», «princesas» → no). */
export function estiloExisteEnCatalogo(palabra: string): boolean {
  const { palabras, raices } = vocabularioDeCatalogo();
  const familia = FAMILIAS.find((grupo) => grupo.includes(palabra)) ?? [palabra];
  return familia.some((forma) => palabras.has(forma) || raices.has(raiz(forma)));
}

// ── 1. Opciones ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type TipoOpcion = "flujo" | "estilo" | "genero";
export type OpcionEvaluada = { opcion: string; tipo: TipoOpcion; ideas: number | null; evento: string | null };
export type ResultadoOpciones = { texto: string; evaluadas: OpcionEvaluada[]; quitadas: OpcionEvaluada[]; anadidas: Array<{ opcion: string; ideas: number }> };
export type ContextoOpciones = {
  evento?: string; edad?: number;
  /** Cuenta las decoraciones reales de una opción (por defecto, la búsqueda real; las pruebas inyectan una biblioteca fija). */
  contarIdeas?: (opcion: string, contexto: { evento?: string; edad?: number }) => number;
};

const FLUJO_RE = /\b(?:foto|fotos|inspiracion|propon\w*|otra|otro|otras|otros|ningun\w*|no se|aun no|todavia|sorpres\w*|cualquiera|igual|si|no|negocio|personal|anos?|meses|adult[oa]s?|adolescentes?|ciudad|bogota|medellin|cali|barranquilla|cartagena|bucaramanga|pereira|manizales|ver|completa|individual|pieza|precio|comprar|armar|contratar|decorador\w*|cotiza\w*)\b/;
const PREGUNTA_ESTILO_RE = /\b(?:tematica|tematicas|estilo|estilos|color|colores|tono|tonos|paleta|ambiente|combinacion|motivo|genero)\b/;

function esOpcionDeFoto(opcion: string): boolean {
  const normal = normalizarBusqueda(opcion);
  return /\bfoto\b/.test(normal) && /\b(?:subir|sube|inspiracion|tengo|mostrar|enviar|adjuntar)\b/.test(normal);
}

function tipoDeOpcion(opcion: string, evento: string | undefined, preguntaDeEstilo: boolean): TipoOpcion {
  const normal = normalizarBusqueda(opcion);
  if (FLUJO_RE.test(normal)) return "flujo";
  const eventoOpcion = eventoDeTexto(opcion) ?? evento;
  if (nombraGeneroBebe(opcion) && (!eventoOpcion || esBabyShower(eventoOpcion))) return "genero";
  if (palabrasDeEstilo(opcion).length) return "estilo";
  // En una pregunta de estilo («¿Qué temática te gusta?») cualquier respuesta que no sea un evento es un estilo.
  return preguntaDeEstilo && !eventoDeTexto(opcion) ? "estilo" : "flujo";
}

function claveOpcion(opcion: string): string {
  return normalizarBusqueda(opcion);
}

/**
 * Valida la línea final «Opciones: a | b | c» contra la biblioteca: cada opción de estilo o género debe llevar a
 * decoraciones reales de ese estilo (la misma búsqueda que haría el clic). Devuelve el texto intacto si no cambia nada.
 */
export function validarOpcionesReales(texto: string, contexto: ContextoOpciones): ResultadoOpciones {
  const lineas = texto.trimEnd().split("\n");
  const coincide = OPCIONES_RE.exec((lineas.at(-1) ?? "").trim());
  if (!coincide) return { texto, evaluadas: [], quitadas: [], anadidas: [] };
  const contar = contexto.contarIdeas ?? ideasRealesDeOpcion;
  const pregunta = lineas.slice(0, -1).join(" ");
  const preguntaNormal = normalizarBusqueda(pregunta);
  const contextoBaby = esBabyShower(contexto.evento) || esBabyShower(pregunta) || !contexto.evento;
  const preguntaDeEstilo = PREGUNTA_ESTILO_RE.test(preguntaNormal) || (contextoBaby && nombraGeneroBebe(pregunta));
  const originales = coincide[2]!.split("|").map((opcion) => opcion.replace(/\*+/g, "").trim()).filter(Boolean);
  const evaluadas: OpcionEvaluada[] = originales.map((original) => {
    const opcion = esOpcionDeFoto(original) ? CHIP_FOTO_GUIADA : original;
    const tipo = tipoDeOpcion(opcion, contexto.evento, preguntaDeEstilo);
    if (tipo === "flujo") return { opcion, tipo, ideas: null, evento: null };
    const evento = eventoDeTexto(opcion) ?? contexto.evento ?? (tipo === "genero" ? "baby shower" : undefined);
    return { opcion, tipo, ideas: contar(opcion, { evento, edad: contexto.edad }), evento: evento ?? null };
  });
  const quitadas = evaluadas.filter((evaluada) => evaluada.tipo !== "flujo" && !evaluada.ideas);
  const estilos = evaluadas.filter((evaluada) => evaluada.tipo !== "flujo" && evaluada.ideas).map((evaluada) => evaluada.opcion);
  const flujo = evaluadas.filter((evaluada) => evaluada.tipo === "flujo").map((evaluada) => evaluada.opcion);
  const anadidas: Array<{ opcion: string; ideas: number }> = [];
  const habiaEstilos = evaluadas.some((evaluada) => evaluada.tipo !== "flujo");
  if ((habiaEstilos || preguntaDeEstilo) && estilos.length < 2) {
    for (const tematica of tematicasDisponibles(contexto.evento)) {
      if (estilos.length >= 4) break;
      if (estilos.some((estilo) => claveOpcion(estilo) === claveOpcion(tematica))) continue;
      const ideas = contar(tematica, { evento: contexto.evento, edad: contexto.edad });
      if (ideas > 0) { estilos.push(tematica); anadidas.push({ opcion: tematica, ideas }); }
    }
  }
  const vistas = new Set<string>();
  const finales = (quitadas.length || anadidas.length ? [...estilos, ...flujo] : evaluadas.map((evaluada) => evaluada.opcion))
    .filter((opcion) => { const clave = claveOpcion(opcion); if (vistas.has(clave)) return false; vistas.add(clave); return true; })
    .slice(0, 6);
  const igual = finales.length === originales.length && finales.every((opcion, indice) => opcion === originales[indice]);
  if (igual) return { texto, evaluadas, quitadas, anadidas };
  const cuerpo = lineas.slice(0, -1);
  return { texto: (finales.length ? [...cuerpo, `Opciones: ${finales.join(" | ")}`] : cuerpo).join("\n").trimEnd(), evaluadas, quitadas, anadidas };
}

// ── 2 y 3. Frases ───────────────────────────────────────────────────────────────────────────────────────────────────
const FRACASO_DIRECTO_RE = /\bno (?:lo |la |los |las )?(?:encontre|encontramos|he encontrado|hemos encontrado|pude encontrar|pudimos encontrar|logre encontrar|halle|hallamos|consegui)\b|\bsin resultados\b|\bno (?:es|son|era|eran) (?:una |unas )?(?:idea |ideas )?exact|\b(?:lamentablemente|desafortunadamente|por desgracia)\b/;
const NEGACION_RE = /\b(?:no|ni|tampoco) (?:tengo|tenemos|hay|habia|existe|existen|contamos con|cuento con|dispongo de|disponemos de|manejo|manejamos|ofrecemos|aparece|aparecen|salio|salieron)\b/;
const OBJETO_RE = /\b(?:idea|ideas|decoracion|decoraciones|opcion|opciones|exacta|exactas|exacto|exactos|estilo|estilos|tematica|tematicas|diseno|disenos|modelo|modelos|resultado|resultados|catalogo|coincidencia|coincidencias|neutro|neutra|color|colores|tono|tonos)\b/;

/** «No encontré ideas exactas…», «No tengo una de princesas exacta…», «No hay decoraciones en beige…». */
export function esFraseDeFracaso(oracion: string): boolean {
  const normal = normalizarBusqueda(oracion);
  return FRACASO_DIRECTO_RE.test(normal) || (NEGACION_RE.test(normal) && OBJETO_RE.test(normal));
}

const LETRA_RE = "a-záéíóúüñ";
const GENERO_PATRON = `(?<![${LETRA_RE}])(?:ni[ñn][oa]s?|neutr[oa]s?|neutral|unisex|var[oó]n|nena)(?![${LETRA_RE}])`;
const SECUENCIA_GENERO_RE = new RegExp(`${GENERO_PATRON}(?:(?:\\s*,\\s*(?:(?:o|u|y)\\s+)?|\\s+(?:o|u|y)\\s+)(?:(?:si es|si prefieres|prefieres|algo|un|una|para|m[aá]s)\\s+)*${GENERO_PATRON})+`, "giu");
const GENERO_SUELTO_RE = new RegExp(GENERO_PATRON, "giu");

function lista(elementos: readonly string[]): string {
  return elementos.length <= 1 ? (elementos[0] ?? "") : `${elementos.slice(0, -1).join(", ")} o ${elementos.at(-1)}`;
}

export function preguntaGeneroBabyShower(generos: readonly GeneroBebe[]): string {
  return generos.length ? `¿El baby shower es para ${lista(generos.map((genero) => NOMBRE_GENERO[genero]))}?` : PREGUNTA_ESTILO_GUIADA;
}

export type ContextoRespuesta = ContextoOpciones & {
  /** Géneros de baby shower que llevan a decoraciones reales. */
  generosValidos: readonly GeneroBebe[];
  /** false en plan, propuesta y proveedores: ahí no se toca el texto. */
  aplicar: boolean;
  /** Ideas que el cliente ve en este turno (carrusel). */
  ideasEnTurno: number;
};

export type CambioOracion = { regla: "fracaso" | "genero" | "estilo_imposible"; antes: string; despues: string; detalle?: string[] };

function esPregunta(oracion: string): boolean {
  return /[?¿]/.test(oracion);
}

function conMayuscula(texto: string): string {
  return texto.replace(/^([¿¡"«\s]*)(\p{Ll})/u, (_, prefijo: string, letra: string) => `${prefijo}${letra.toLocaleUpperCase("es")}`);
}

/** Quita la parte de fracaso de una oración: «No tengo una exacta, pero estas en rosa…» → «Estas en rosa…». */
function sinFracaso(oracion: string): string {
  if (!esFraseDeFracaso(oracion)) return oracion;
  const corte = /,?\s+(?:pero|aunque|sin embargo,?|en cambio,?)\s+/i.exec(oracion);
  if (!corte) return "";
  let resto = oracion.slice(corte.index + corte[0].length).trim();
  if (!resto || esFraseDeFracaso(resto)) return "";
  if (resto.endsWith("?") && !resto.includes("¿")) resto = `¿${resto}`;
  return conMayuscula(resto);
}

/** «niño, niña o neutro» → «niño o niña» cuando neutro no tiene decoraciones. */
function generosPosibles(oracion: string, contexto: ContextoRespuesta): { texto: string; detalle: string[] } {
  const contextoBaby = esBabyShower(contexto.evento) || esBabyShower(oracion) || !contexto.evento;
  if (!contextoBaby || !nombraGeneroBebe(oracion)) return { texto: oracion, detalle: [] };
  const valido = (palabra: string) => { const genero = generoBebeDe(palabra); return genero !== null && contexto.generosValidos.includes(genero); };
  const detalle: string[] = [];
  let sinAlternativas = false;
  let texto = oracion.replace(SECUENCIA_GENERO_RE, (secuencia) => {
    const tokens = secuencia.match(GENERO_SUELTO_RE) ?? [];
    const validos = tokens.filter(valido).filter((token, indice, todos) => todos.findIndex((otro) => generoBebeDe(otro) === generoBebeDe(token)) === indice);
    if (validos.length === tokens.length) return secuencia;
    detalle.push(...tokens.filter((token) => !valido(token)));
    if (!validos.length) { sinAlternativas = true; return secuencia; }
    return lista(validos);
  });
  if (sinAlternativas) return { texto: esPregunta(oracion) ? preguntaGeneroBabyShower(contexto.generosValidos) : "", detalle };
  // Un género sin decoraciones suelto en una pregunta («¿O prefieres algo neutro?») no se ofrece.
  const sueltos = (texto.match(GENERO_SUELTO_RE) ?? []).filter((token) => !valido(token));
  if (sueltos.length && esPregunta(texto)) { detalle.push(...sueltos); texto = ""; }
  return { texto, detalle };
}

/** Sanea una oración: sin fracaso, sin géneros imposibles y sin preguntas que sugieran estilos inexistentes. */
export function sanearOracion(oracion: string, contexto: ContextoRespuesta): { texto: string; cambios: CambioOracion[] } {
  if (!contexto.aplicar || !oracion.trim()) return { texto: oracion, cambios: [] };
  const cambios: CambioOracion[] = [];
  let texto = sinFracaso(oracion);
  if (texto !== oracion) cambios.push({ regla: "fracaso", antes: oracion, despues: texto });
  if (texto) {
    const generos = generosPosibles(texto, contexto);
    if (generos.texto !== texto) cambios.push({ regla: "genero", antes: texto, despues: generos.texto, detalle: generos.detalle });
    texto = generos.texto;
  }
  if (texto && esPregunta(texto)) {
    const imposibles = palabrasDeEstilo(texto).filter((palabra) => !estiloExisteEnCatalogo(palabra));
    if (imposibles.length) {
      cambios.push({ regla: "estilo_imposible", antes: texto, despues: PREGUNTA_ESTILO_GUIADA, detalle: imposibles });
      texto = PREGUNTA_ESTILO_GUIADA;
    }
  }
  return { texto, cambios };
}

function oracionesDe(linea: string): string[] {
  return linea.split(/(?<=[.!?…])\s+(?=\S)/u);
}

function sanearLinea(linea: string, contexto: ContextoRespuesta, cambios: CambioOracion[]): string {
  const sangria = /^\s*/.exec(linea)?.[0] ?? "";
  const saneadas = oracionesDe(linea.trim()).map((oracion) => {
    const resultado = sanearOracion(oracion, contexto);
    cambios.push(...resultado.cambios);
    return resultado.texto;
  }).filter((oracion) => oracion.trim());
  // Dos preguntas de estilo iguales seguidas (dos oraciones sustituidas) se dicen una vez.
  const unicas = saneadas.filter((oracion, indice) => oracion !== saneadas[indice - 1]);
  return unicas.length ? `${sangria}${unicas.join(" ")}` : "";
}

export type SaneoRespuesta = {
  texto: string;
  cambio: boolean;
  frases: CambioOracion[];
  opciones: ResultadoOpciones | null;
  /** Texto de respaldo cuando no quedó ninguna frase. */
  respaldo: string | null;
  /** Se quitó al menos una frase de fracaso. */
  huboFracaso: boolean;
};

export function sanearRespuestaGuiada(texto: string, contexto: ContextoRespuesta): SaneoRespuesta {
  const sinCambios: SaneoRespuesta = { texto, cambio: false, frases: [], opciones: null, respaldo: null, huboFracaso: false };
  if (!contexto.aplicar) return sinCambios;
  const lineas = texto.trimEnd().split("\n");
  const lineaOpciones = OPCIONES_RE.test((lineas.at(-1) ?? "").trim()) ? lineas.at(-1)!.trim() : null;
  const cuerpoOriginal = lineaOpciones ? lineas.slice(0, -1) : lineas;
  const frases: CambioOracion[] = [];
  let cuerpo = cuerpoOriginal.map((linea) => (linea.trim() ? sanearLinea(linea, contexto, frases) : linea)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  let respaldo: string | null = null;
  let opcionesBase = lineaOpciones;
  if (!cuerpo) {
    if (contexto.ideasEnTurno > 0) { respaldo = FRASE_IDEAS_GUIADAS; opcionesBase = null; }
    else {
      const genero = esBabyShower(contexto.evento) && !contexto.ideasEnTurno && frases.some((frase) => frase.regla === "genero");
      respaldo = genero ? preguntaGeneroBabyShower(contexto.generosValidos) : PREGUNTA_ESTILO_GUIADA;
      opcionesBase ??= `Opciones: ${CHIP_FOTO_GUIADA}`;
    }
    cuerpo = respaldo;
  } else if (!opcionesBase && frases.some((frase) => frase.regla === "estilo_imposible") && !contexto.ideasEnTurno) {
    // La pregunta sustituida necesita sus botones con lo que sí hay.
    opcionesBase = `Opciones: ${CHIP_FOTO_GUIADA}`;
  }
  // Se conserva la separación original entre la pregunta y «Opciones:» para no marcar como cambio lo que no cambió.
  const separador = lineaOpciones && !respaldo && cuerpoOriginal.at(-1)?.trim() !== "" ? "\n" : "\n\n";
  const opciones = opcionesBase ? validarOpcionesReales(`${cuerpo}${separador}${opcionesBase}`, contexto) : null;
  const final = (opciones ? opciones.texto : cuerpo).trimEnd();
  const huboFracaso = frases.some((frase) => frase.regla === "fracaso");
  const cambio = final !== texto.trimEnd();
  return { texto: cambio ? final : texto, cambio, frases, opciones, respaldo, huboFracaso };
}

/**
 * El texto se transmite mientras el modelo escribe: sin este filtro el cliente vería «No encontré…» unos segundos
 * antes de que llegue la respuesta saneada. Emite oraciones completas ya saneadas y retiene la línea «Opciones:» (la
 * respuesta final la trae validada).
 */
export class FiltroFlujoGuiado {
  private pendiente = "";
  private retenido = false;
  private emitido = false;

  constructor(private readonly contexto: () => ContextoRespuesta) {}

  empujar(delta: string): string {
    if (this.retenido) return "";
    this.pendiente += delta;
    const inicioOpciones = /(^|\n)[ \t*]*opciones\s*:/i.exec(this.pendiente);
    if (inicioOpciones) {
      const antes = this.pendiente.slice(0, inicioOpciones.index + inicioOpciones[1]!.length);
      this.pendiente = "";
      this.retenido = true;
      return this.procesar(antes);
    }
    let corte = -1;
    for (const limite of this.pendiente.matchAll(/[.!?…]+(?=\s)|\n/gu)) corte = (limite.index ?? 0) + limite[0].length;
    if (corte < 0) return "";
    const completo = this.pendiente.slice(0, corte);
    this.pendiente = this.pendiente.slice(corte);
    return this.procesar(completo);
  }

  private procesar(completo: string): string {
    const contexto = this.contexto();
    const salida = completo.split(/(\n)/).map((parte) => {
      if (!parte.trim()) return parte;
      return INICIO_OPCIONES_RE.test(parte) ? "" : sanearLinea(parte, contexto, []);
    }).join("");
    const texto = this.emitido ? salida : salida.replace(/^\s+/, "");
    if (texto) this.emitido = true;
    return texto;
  }
}
