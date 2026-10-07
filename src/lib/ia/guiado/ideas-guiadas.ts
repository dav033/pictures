import { bibliotecaVisible, buscarDecoracionesSempertex, normalizarBusqueda, type CoincidenciaDecoracion } from "@/lib/biblioteca-sempertex/biblioteca";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

/**
 * Dueño (2026-10-06): «las opciones que desemboquen en "no encontré decoraciones de este estilo" deben ser eliminadas».
 * Esta es LA búsqueda de la vista guiada: la usa la herramienta buscar_decoraciones_sempertex y también el saneo de
 * «Opciones:» (cada opción se valida corriendo exactamente la búsqueda que haría el clic). Así una opción solo se
 * ofrece si al tocarla aparecen decoraciones reales de ese estilo.
 */

export type GeneroBebe = "nino" | "nina" | "neutro";
export const GENEROS_BEBE: readonly GeneroBebe[] = ["nino", "nina", "neutro"];
export const NOMBRE_GENERO: Readonly<Record<GeneroBebe, string>> = { nino: "niño", nina: "niña", neutro: "neutro" };

const PALABRAS_GENERO: Readonly<Record<GeneroBebe, readonly string[]>> = {
  nino: ["nino", "ninos", "boy", "varon", "varoncito"],
  nina: ["nina", "ninas", "girl", "nena"],
  neutro: ["neutro", "neutra", "neutros", "neutral", "unisex"],
};
const ROSAS = ["rosa", "rosas", "rosado", "rosada", "fucsia", "lila", "morado", "morada", "magenta"];
const AZULES = ["azul", "azules", "celeste", "celestes"];

function palabras(texto: string): Set<string> {
  return new Set(normalizarBusqueda(texto).split(" ").filter(Boolean));
}

function tieneAlguna(conjunto: ReadonlySet<string>, lista: readonly string[]): boolean {
  return lista.some((palabra) => conjunto.has(palabra));
}

export function esBabyShower(evento: string | undefined): boolean {
  const texto = ` ${normalizarBusqueda(evento ?? "")} `;
  return texto.includes(" baby shower ") || texto.includes(" babyshower ") || texto.includes(" bienvenida de bebe ");
}

/** El género que nombra un texto («Niña», «para niño», «algo neutro»); null si no nombra ninguno o nombra varios. */
export function generoBebeDe(texto: string): GeneroBebe | null {
  const conjunto = palabras(texto);
  const nombrados = GENEROS_BEBE.filter((genero) => tieneAlguna(conjunto, PALABRAS_GENERO[genero]));
  return nombrados.length === 1 ? nombrados[0]! : null;
}

export function nombraGeneroBebe(texto: string): boolean {
  const conjunto = palabras(texto);
  return GENEROS_BEBE.some((genero) => tieneAlguna(conjunto, PALABRAS_GENERO[genero]));
}

function esDecoracionDeBabyShower(decoracion: DecoracionSempertex): boolean {
  return decoracion.eventos.some((evento) => esBabyShower(evento));
}

/**
 * Género de una decoración de baby shower: el que dice su temática o título («Baby shower niña») y, si no lo dice, el de
 * sus colores (rosa → niña, azul → niño, ni lo uno ni lo otro o ambos → neutro). Antes solo valía la palabra literal y
 * «Niño» y «Neutro» desembocaban en «no encontré» aunque hubiera semiarcos azules de baby shower.
 */
export function generoDeDecoracion(decoracion: DecoracionSempertex): GeneroBebe | null {
  const explicito = generoBebeDe(`${decoracion.titulo} ${decoracion.tematica}`);
  if (explicito) return explicito;
  if (!esDecoracionDeBabyShower(decoracion)) return null;
  const conjunto = palabras(`${decoracion.titulo} ${decoracion.tematica}`);
  const rosa = tieneAlguna(conjunto, ROSAS);
  const azul = tieneAlguna(conjunto, AZULES);
  return rosa && !azul ? "nina" : azul && !rosa ? "nino" : "neutro";
}

export type ViaIdeas = "genero" | "busqueda" | "evento" | "vacio";
export type ResultadoIdeas = {
  ideas: CoincidenciaDecoracion[];
  genero: GeneroBebe | null;
  /** genero/busqueda: ideas de lo pedido; evento: no había de lo pedido y van las reales más cercanas del mismo evento. */
  via: ViaIdeas;
  consulta: string;
};

export type EntradaIdeas = { evento?: string; edad?: number; tematica?: string; ultimoUsuario?: string };

export function ideasGuiadas(entrada: EntradaIdeas, catalogo: DecoracionSempertex[] = bibliotecaVisible()): ResultadoIdeas {
  const consulta = [entrada.tematica, entrada.ultimoUsuario].filter((parte): parte is string => Boolean(parte?.trim())).join(" ");
  const base = { evento: entrada.evento, edad: entrada.edad, tematica: consulta };
  // Lo último que dijo el cliente manda sobre la temática guardada («niña» → «Niño»).
  const genero = esBabyShower(entrada.evento) ? generoBebeDe(entrada.ultimoUsuario ?? "") ?? generoBebeDe(entrada.tematica ?? "") : null;
  if (genero) {
    const delGenero = catalogo.filter((decoracion) => generoDeDecoracion(decoracion) === genero);
    const ideas = delGenero.length ? buscarDecoracionesSempertex(base, delGenero).map((idea) => ({ ...idea, coincidencia: "exacta" as const })) : [];
    if (ideas.length) return { ideas, genero, via: "genero", consulta };
  } else {
    const ideas = buscarDecoracionesSempertex(base, catalogo);
    if (ideas.length) return { ideas, genero, via: "busqueda", consulta };
  }
  // Nunca «no encontré»: las reales más cercanas del mismo evento, como sugerencias.
  const delEvento = buscarDecoracionesSempertex({ evento: entrada.evento, edad: entrada.edad, tematica: "" }, catalogo)
    .map((idea) => ({ ...idea, coincidencia: "cercana" as const }));
  return { ideas: delEvento, genero, via: delEvento.length ? "evento" : "vacio", consulta };
}

/**
 * Cuántas decoraciones REALES de ese estilo ve el cliente si toca la opción (0 = la opción desemboca en sugerencias de
 * otro estilo o en nada, y no se ofrece). Solo cuentan las exactas: las «cercanas» son de otro estilo.
 */
export function ideasRealesDeOpcion(opcion: string, contexto: { evento?: string; edad?: number }): number {
  const resultado = ideasGuiadas({ evento: contexto.evento, edad: contexto.edad, tematica: opcion });
  if (resultado.via !== "genero" && resultado.via !== "busqueda") return 0;
  return resultado.ideas.filter((idea) => idea.coincidencia === "exacta").length;
}

/** Géneros de baby shower que llevan a decoraciones reales, con cuántas. */
export function generosBabyShower(): Array<{ genero: GeneroBebe; ideas: number }> {
  return GENEROS_BEBE.map((genero) => ({ genero, ideas: ideasRealesDeOpcion(NOMBRE_GENERO[genero], { evento: "baby shower" }) }));
}

const EVENTOS_CONOCIDOS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["baby shower", ["baby shower", "babyshower", "bienvenida de bebe"]],
  ["boda", ["boda", "matrimonio", "casamiento"]],
  ["XV años", ["xv", "quince", "quinceanos", "quinceanera", "15 anos"]],
  ["bautizo", ["bautizo", "bautismo", "comunion", "primera comunion"]],
  ["graduación", ["graduacion", "grado"]],
  ["Halloween", ["halloween"]],
  ["Navidad", ["navidad", "navideno", "novena"]],
  ["Día de la Madre", ["dia de la madre"]],
  ["San Valentín", ["san valentin", "amor y amistad"]],
  ["fiesta de empresa", ["fiesta de empresa", "empresa", "corporativo", "corporativa"]],
  ["cumpleaños", ["cumpleanos", "cumple"]],
];

/** El evento que nombra un texto («Baby shower», «es para la boda de mi hermana»); undefined si no nombra ninguno. */
export function eventoDeTexto(texto: string): string | undefined {
  const normalizado = ` ${normalizarBusqueda(texto)} `;
  return EVENTOS_CONOCIDOS.find(([, sinonimos]) => sinonimos.some((sinonimo) => normalizado.includes(` ${sinonimo} `)))?.[0];
}

/** El evento más reciente que nombró el cliente (antes de que el modelo guarde el brief, p. ej. al preguntar el género). */
export function eventoDeMensajes(mensajesCliente: readonly string[]): string | undefined {
  for (let indice = mensajesCliente.length - 1; indice >= 0; indice -= 1) {
    const evento = eventoDeTexto(mensajesCliente[indice]!);
    if (evento) return evento;
  }
  return undefined;
}
