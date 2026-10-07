import { bibliotecaVisible, buscarDecoracionesSempertex, normalizarBusqueda, type CoincidenciaDecoracion } from "@/lib/biblioteca-sempertex/biblioteca";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { ALIAS_COLORES_V2, clasificarColores, clasificarTonos, plegarTexto, TONOS_V2 } from "@/lib/rag/taxonomy/v2";

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

/** Con menos exactas que esto, el carrusel se completa con parecidas reales del mismo evento y colores. */
const MINIMO_EXACTAS = 3;
/** Ideas que se intenta mostrar (las mismas que `IDEAS_MINIMAS` de la biblioteca). */
const IDEAS_A_MOSTRAR = 4;

/**
 * Completa unas pocas exactas con parecidas REALES: primero las del mismo evento en los colores pedidos, luego las del
 * mismo evento. Probador (2026-10-07, guiada-20261007-000432-mi8qhp): boda «elegante en blanco y dorado» → 1 sola idea
 * (el aro blanco, dorado y nude) y «Te dejo unas ideas…», aunque «Semiarco blanco y oro rosa» y «Semiarco oro rosa,
 * dorado y amarillo pastel» son de boda. Las que se suman van marcadas «cercana» (la insignia «Parecida»).
 */
function completarConParecidas(ideas: CoincidenciaDecoracion[], entrada: EntradaIdeas, consulta: string, catalogo: DecoracionSempertex[]): CoincidenciaDecoracion[] {
  const exactas = ideas.filter((idea) => idea.coincidencia === "exacta").length;
  if (exactas >= MINIMO_EXACTAS || ideas.length >= IDEAS_A_MOSTRAR) return ideas;
  const pedidos = coloresComparables(consulta);
  if (!pedidos.size) return ideas;
  const porColor = buscarDecoracionesSempertex({ evento: entrada.evento, edad: entrada.edad, tematica: [...pedidos].join(" ") }, catalogo);
  const delEvento = entrada.evento ? buscarDecoracionesSempertex({ evento: entrada.evento, edad: entrada.edad, tematica: "" }, catalogo) : [];
  const evento = entrada.evento ? eventoCanonico(entrada.evento) : null;
  // Parecida = del mismo evento y con alguno de los colores pedidos, o de otro evento pero con TODOS (nunca una idea
  // de otros colores: «hay algunas que claramente no son blanco y negro», dueño, 2026-10-06).
  const sirve = (idea: DecoracionSempertex): boolean => {
    const suyos = new Set([...coloresComparables(idea.titulo), ...coloresComparables(idea.tematica)]);
    const compartidos = [...pedidos].filter((color) => suyos.has(color)).length;
    const mismoEvento = evento !== null && idea.eventos.some((otro) => eventoCanonico(otro) === evento);
    return compartidos === pedidos.size || (mismoEvento && compartidos > 0);
  };
  const resultado = [...ideas];
  const vistas = new Set(ideas.map((idea) => idea.id));
  for (const idea of [...porColor, ...delEvento]) {
    if (resultado.length >= IDEAS_A_MOSTRAR) break;
    if (vistas.has(idea.id) || !sirve(idea)) continue;
    vistas.add(idea.id);
    resultado.push({ ...idea, coincidencia: "cercana" });
  }
  return resultado;
}

/** Colores de un texto para comparar ideas: el oro rosa también cuenta como dorado (la biblioteca lo agrupa así). */
function coloresComparables(texto: string): Set<string> {
  const colores = clasificarColores(texto).values.filter((color) => color !== "multicolor");
  return new Set(colores.flatMap((color) => (color === "dorado rosa" ? ["dorado rosa", "dorado"] : [color])));
}

function eventoCanonico(texto: string): string {
  return eventoDeTexto(texto) ?? normalizarBusqueda(texto);
}

/**
 * La temática que se guarda es la que dijo el cliente. Probador (2026-10-07): «me caso… algo elegante en blanco y
 * dorado» y `guardar_brief_guiado` guardó «Blanco, dorado y nude» (la temática del catálogo más parecida): la cabecera
 * decía «nude» y la búsqueda caía en esa temática exacta, con una sola idea. Si la temática trae colores que el cliente
 * nunca nombró, queda su estilo («Romántico», «Unicornio») con los colores de su último mensaje que los nombra, con sus
 * tonos («celeste», no «azul»): «Blanco, dorado y nude» → «Blanco y dorado». Si no queda nada, se deja como estaba.
 */
export function tematicaFielAlCliente(tematica: string, mensajesCliente: readonly string[]): { tematica: string; quitados: string[] } {
  const dichos = new Set(mensajesCliente.flatMap((texto) => clasificarColores(texto).values));
  const delModelo = clasificarColores(tematica).values;
  const ultimo = [...mensajesCliente].reverse().find((texto) => clasificarColores(texto).values.some((color) => color !== "multicolor"));
  const tonos = ultimo ? clasificarTonos(ultimo).values : [];
  // El tono que dijo el cliente y el modelo guardó como su familia («celeste» → «azul») también se corrige.
  const tonosModelo = clasificarTonos(tematica).values;
  const quitados = [
    ...delModelo.filter((color) => !dichos.has(color)),
    ...tonos.filter((tono) => delModelo.includes(TONOS_V2[tono].familia) && !tonosModelo.includes(tono)).map((tono) => `${TONOS_V2[tono].familia} (dijo ${tono})`),
  ];
  if (!quitados.length) return { tematica, quitados: [] };
  const todosLosAlias = new Set(ALIAS_COLORES_V2.flatMap((color) => color.aliases.map(plegarTexto)));
  const estilo = sinPalabras(tematica.replace(/[,;]/g, " "), todosLosAlias);
  const colores = (ultimo ? clasificarColores(ultimo).values.filter((color) => color !== "multicolor") : [])
    .map((color) => tonos.find((tono) => TONOS_V2[tono].familia === color) ?? NOMBRE_COLOR_TEMATICA[color] ?? color);
  const listaColores = colores.length <= 1 ? (colores[0] ?? "") : `${colores.slice(0, -1).join(", ")} y ${colores.at(-1)}`;
  const unida = [estilo, listaColores].filter(Boolean).join(" ").trim();
  if (!unida) return { tematica, quitados: [] };
  return { tematica: (unida.charAt(0).toLocaleUpperCase("es") + unida.slice(1)).slice(0, 160), quitados };
}

/** Cómo se escribe un color de la paleta en una temática («dorado rosa» → «oro rosa»). */
const NOMBRE_COLOR_TEMATICA: Readonly<Record<string, string>> = { "dorado rosa": "oro rosa", cafe: "café", champagne: "champaña" };

const CONECTORES_SUELTOS = /^(?:y|e|o|en|de|con|del|tonos?|colou?r(?:es)?)$/i;

/** Un texto sin las palabras de unos colores («Romántico rosa y dorado» → «Romántico»; «nude» → ""). */
function sinPalabras(texto: string, aliases: ReadonlySet<string>): string {
  const palabras = texto.trim().split(/\s+/).filter(Boolean);
  const quedan: string[] = [];
  for (let indice = 0; indice < palabras.length;) {
    const largo = [3, 2, 1].find((tramo) => indice + tramo <= palabras.length && aliases.has(plegarTexto(palabras.slice(indice, indice + tramo).join(" "))));
    if (largo) { indice += largo; continue; }
    quedan.push(palabras[indice]!);
    indice += 1;
  }
  const limpias = quedan.filter((palabra, indice) => !(CONECTORES_SUELTOS.test(palabra) && (indice === 0 || indice === quedan.length - 1 || CONECTORES_SUELTOS.test(quedan[indice - 1]!))));
  while (limpias.length && CONECTORES_SUELTOS.test(limpias.at(-1)!)) limpias.pop();
  return limpias.join(" ");
}

/**
 * Las ideas que el cliente ya vio en el carrusel de esta conversación: las que devuelve la misma búsqueda con la
 * temática guardada y cada mensaje anterior suyo (es determinista), más la que eligió. Para que «Prefiero ver ideas
 * parecidas» no le muestre otra vez el mismo aro (probador, 2026-10-07).
 */
export function ideasYaVistas(entrada: { evento?: string; edad?: number; tematica?: string; mensajesPrevios: readonly string[]; elegida?: string }, catalogo: DecoracionSempertex[] = bibliotecaVisible()): Set<string> {
  const vistas = new Set<string>(entrada.elegida ? [entrada.elegida] : []);
  if (!entrada.evento) return vistas;
  for (const ultimoUsuario of [undefined, ...entrada.mensajesPrevios.slice(-6)]) {
    for (const idea of ideasGuiadas({ evento: entrada.evento, edad: entrada.edad, tematica: entrada.tematica ?? "", ...(ultimoUsuario ? { ultimoUsuario } : {}) }, catalogo).ideas) vistas.add(idea.id);
  }
  return vistas;
}

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
    if (ideas.length) return { ideas: completarConParecidas(ideas, entrada, consulta, catalogo), genero, via: "busqueda", consulta };
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
