import decoracionesRaw from "./decoraciones.json";
import proveedoresRaw from "./proveedores.json";
import { DecoracionSempertexSchema, ProveedorSempertexSchema, type DecoracionSempertex, type ProveedorSempertex } from "./esquemas";
import { resolveRuntimeCommercialEnvironment } from "@/lib/generacion/provenance";

export type CoincidenciaDecoracion = DecoracionSempertex & { coincidencia: "exacta" | "cercana" };

const sinonimosTematicos: string[][] = [
  ["elegante negro y dorado", "negro y dorado", "elegante", "cumpleaños adulto", "graduación"],
  ["elegante blanco y negro", "blanco y negro", "monocromático", "graduación"],
  ["infantil colorida", "infantil", "arcoíris", "multicolor", "disfraces"],
  ["rosa y lila", "lila y morado", "rosa y morado", "pastel"],
  ["rosa y dorado", "rosado y dorado", "oro rosa", "romántico"],
  ["azul y plateado", "azul y plata", "azul", "celeste"],
  ["baby shower niña", "baby shower", "bienvenida de bebé niña", "nina", "girl"],
  ["princesa", "princesas", "castillo", "cuento"],
  ["dinosaurio", "dinosaurios", "dino", "dinos"],
  ["superheroe", "superheroes", "heroe", "heroes", "heroina", "heroínas"],
  ["unicornio", "unicornios", "arcoiris", "arco iris"],
  ["espacio", "estrella", "estrellas", "planeta", "planetas", "galaxia"],
  ["safari", "selva", "jungla", "animal", "animales"],
  ["tropical", "hawaiano", "hawaiana", "hawai", "verano", "playa", "palmera", "palmeras"],
  ["futbol", "deporte", "deportes", "partido", "campeonato"],
  ["boda", "matrimonio", "casamiento"],
  ["xv", "quince", "quinceanos", "quinceanera", "15 anos"],
  ["bautizo", "bautismo", "comunion", "primera comunion"],
  ["baby shower", "bienvenida de bebe", "nino", "nina", "neutro"],
  ["baby shower nino", "bienvenida de bebe nino", "nino", "boy"],
  ["baby shower nina", "bienvenida de bebe nina", "nina", "girl"],
  ["baby shower neutro", "bienvenida de bebe neutra", "neutro", "unisex"],
];
const sinonimosEvento: string[][] = [
  ["cumpleanos", "fiesta infantil", "cumple"],
  ["baby shower", "bienvenida de bebe"],
  ["boda", "matrimonio", "casamiento"],
  ["xv", "quince", "quinceanos", "quinceanera", "15 anos"],
  ["bautizo", "bautismo", "comunion", "primera comunion"],
];
// Las temáticas sin decoración propia (princesas, videojuegos…) se resuelven por sus colores típicos hacia las del catálogo.
const sinonimosColor: string[][] = [
  ["rosa", "rosado", "rosada", "fucsia", "princesa", "princesas", "hada", "hadas", "unicornio", "unicornios", "mariposa", "mariposas"],
  ["dorado", "oro", "princesa", "princesas", "corona", "reina", "realeza"],
  ["azul", "celeste", "frozen", "hielo", "nieve", "invierno", "espacio", "galaxia", "estrella", "estrellas", "planeta", "planetas", "mar", "marinero", "sirena", "sirenas"],
  ["plateado", "plata", "espacio", "galaxia", "estrella", "estrellas", "robot", "robots"],
  ["verde", "selva", "tropical", "dinosaurio", "dinosaurios", "safari", "jungla"],
  ["negro", "negra", "halloween", "brujas", "terror"], ["naranja", "halloween", "calabaza"],
  ["blanco", "blanca", "perla", "frozen", "nieve"],
  ["lila", "morado", "violeta", "purpura", "unicornio", "unicornios", "hada", "hadas", "sirena", "sirenas"],
  ["arcoiris", "multicolor", "colores vivos", "vivos", "neon", "carnaval", "festivo", "festivos", "alegre", "alegres", "colorido", "colorida", "coloridos", "videojuego", "videojuegos", "gamer", "superheroe", "superheroes", "heroe", "heroes", "circo", "payaso", "fiesta infantil"],
];

function prioridadOrigen(decoracion: DecoracionSempertex): number {
  return decoracion.origen === "referencia_real" ? 1 : 0;
}

export function normalizarBusqueda(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim();
}

function contieneAlguno(texto: string, palabras: string[]): boolean {
  return palabras.some((palabra) => ` ${texto} `.includes(` ${normalizarBusqueda(palabra)} `));
}

const PALABRAS_GENERICAS = new Set(["fiesta", "fiestas", "celebracion", "evento", "eventos", "decoracion", "reunion"]);

function puntajeEvento(evento: string, decoracion: DecoracionSempertex): number {
  const consulta = normalizarBusqueda(evento);
  const eventos = decoracion.eventos.map(normalizarBusqueda).join(" ");
  const tematica = normalizarBusqueda(`${decoracion.titulo} ${decoracion.tematica}`);
  if (!consulta) return 0;
  const sinonimo = sinonimosEvento.find((grupo) => contieneAlguno(consulta, grupo));
  if (sinonimo && contieneAlguno(eventos, sinonimo)) return 4;
  // «fiesta de empresa» no es «fiesta infantil»: las palabras genéricas de celebración no emparejan eventos.
  const palabras = consulta.split(" ").filter((palabra) => palabra.length > 3 && !PALABRAS_GENERICAS.has(palabra));
  if (contieneAlguno(eventos, palabras)) return 3;
  if (contieneAlguno(tematica, palabras)) return 1;
  return 0;
}

const EVENTOS_PROPIOS = ["baby shower", "bienvenida de bebe", "boda", "matrimonio", "bautizo", "comunion", "primera comunion", "xv", "quince anos", "quinceanera"];

function esDeEventoPropio(decoracion: DecoracionSempertex): boolean {
  return decoracion.eventos.some((evento) => contieneAlguno(normalizarBusqueda(evento), EVENTOS_PROPIOS));
}

function puntajeEdad(edad: number | undefined, decoracion: DecoracionSempertex): number {
  if (edad === undefined || decoracion.edad === null) return 1;
  return edad >= decoracion.edad.min && edad <= decoracion.edad.max ? 2 : -4;
}

export function buscarDecoracionesSempertex(entradaCruda: { evento?: string; edad?: number; tematica?: string }, catalogo: DecoracionSempertex[] = bibliotecaVisible()): CoincidenciaDecoracion[] {
  // El asistente guarda edad 0 cuando no la sabe (boda, graduación…): 0 es «sin edad», no un bebé de 0 años.
  const entrada = { ...entradaCruda, edad: entradaCruda.edad && entradaCruda.edad > 0 ? entradaCruda.edad : undefined };
  const temaConsulta = normalizarBusqueda(entrada.tematica ?? "");
  const esBabyShower = contieneAlguno(normalizarBusqueda(entrada.evento ?? ""), ["baby shower", "bienvenida de bebe"]);
  // «niño»/«niña» en «cumpleaños de mi niño de 7» no es un baby shower: esos grupos solo cuentan si el evento lo es.
  const gruposConsultados = sinonimosTematicos.filter((grupo) => contieneAlguno(temaConsulta, grupo) && (esBabyShower || !grupo.some((palabra) => palabra.startsWith("baby shower"))));
  const generoBebe = esBabyShower && contieneAlguno(temaConsulta, ["niña", "nina", "girl"]) ? "nina"
    : esBabyShower && contieneAlguno(temaConsulta, ["niño", "nino", "boy"]) ? "nino"
      : esBabyShower && contieneAlguno(temaConsulta, ["neutro", "neutra", "unisex"]) ? "neutro" : null;
  const puntajes = catalogo.map((decoracion) => {
    const textoTema = normalizarBusqueda(`${decoracion.titulo} ${decoracion.tematica} ${decoracion.id}`);
    const fuerzaExacta = gruposConsultados.filter((grupo) => contieneAlguno(textoTema, grupo)).length;
    const coincideGeneroBebe = !generoBebe || contieneAlguno(textoTema, generoBebe === "nina" ? ["nina", "girl"] : generoBebe === "nino" ? ["nino", "boy"] : ["neutro", "neutra", "unisex"]);
    const exacta = fuerzaExacta > 0 && coincideGeneroBebe;
    const temaEvento = normalizarBusqueda(`${decoracion.titulo} ${decoracion.tematica} ${decoracion.eventos.join(" ")}`);
    const gruposColor = sinonimosColor.filter((grupo) => contieneAlguno(temaConsulta, grupo));
    const puntajeColor = gruposColor.reduce((total, grupo) => total + (contieneAlguno(temaEvento, grupo) ? 2 : 0), 0);
    const evento = puntajeEvento(entrada.evento ?? "", decoracion);
    const edad = puntajeEdad(entrada.edad, decoracion);
    const puntaje = evento + edad + puntajeColor;
    // En un baby shower con género pedido, una idea del otro género no se ofrece ni como parecida.
    const generoOpuesto = Boolean(generoBebe) && !coincideGeneroBebe && contieneAlguno(textoTema, ["nina", "girl", "nino", "boy", "neutro", "neutra", "unisex"]);
    return { decoracion, exacta, fuerzaExacta, puntaje, evento, edad, puntajeColor, generoOpuesto, temaEvento };
  });
  const exactasEdad = puntajes.filter((item) => item.exacta && puntajeEdad(entrada.edad, item.decoracion) >= 0);
  // Una idea exacta de OTRO evento no le gana a una del evento pedido.
  const exactasDelEvento = exactasEdad.filter((item) => item.evento > 0);
  const exactasDisponibles = exactasDelEvento.length ? exactasDelEvento : exactasEdad;
  const fuerzaMaxima = Math.max(0, ...exactasDisponibles.map((item) => item.fuerzaExacta));
  const exactas = exactasDisponibles.filter((item) => item.fuerzaExacta === fuerzaMaxima)
    .sort((a, b) => prioridadOrigen(b.decoracion) - prioridadOrigen(a.decoracion) || puntajeEvento(entrada.evento ?? "", b.decoracion) - puntajeEvento(entrada.evento ?? "", a.decoracion) || b.puntaje - a.puntaje);
  const candidatas = puntajes.filter((item) => item.edad >= 0 && (item.evento > 0 || item.puntajeColor > 0));
  // Ideas de fiesta general: ni de otro evento propio (baby shower, boda, XV, bautizo) ni infantiles si no se dio una edad.
  const esGeneral = (item: (typeof puntajes)[number]): boolean => item.edad >= 0 && !esDeEventoPropio(item.decoracion) && (entrada.edad !== undefined || item.decoracion.edad === null || item.decoracion.edad.max >= 18);
  // Con ideas del evento pedido, primero esas (un baby shower no se ofrece para un cumpleaños de 35). Sin ellas, las de color
  // que sean de fiesta general (nunca un baby shower o unos XV para una graduación o un divorcio).
  const delEvento = candidatas.filter((item) => item.evento > 0);
  const elegidas = (delEvento.length ? delEvento : candidatas.filter(esGeneral)).sort((a, b) => prioridadOrigen(b.decoracion) - prioridadOrigen(a.decoracion) || b.puntaje - a.puntaje);
  // Se completa con fiesta general para que el cliente siempre tenga entre 3 y 4 ideas para elegir.
  const relleno = puntajes.filter((item) => esGeneral(item) && !elegidas.includes(item)).sort((a, b) => b.puntaje - a.puntaje);
  const yaExactas = new Set(exactas.map((item) => item.decoracion.id));
  const cercanas = [...elegidas, ...relleno].filter((item) => !yaExactas.has(item.decoracion.id) && !item.generoOpuesto);
  // Junto a ideas exactas, las parecidas van por afinidad de color primero (sort estable: el resto conserva su orden).
  if (exactas.length) {
    // Afinidad con lo pedido y con los colores de las ideas exactas («princesas» → tonos rosa).
    const gruposReferencia = sinonimosColor.filter((grupo) => contieneAlguno(temaConsulta, grupo) || exactas.some((item) => contieneAlguno(item.temaEvento, grupo)));
    const afinidad = (item: (typeof puntajes)[number]): number => gruposReferencia.filter((grupo) => contieneAlguno(item.temaEvento, grupo)).length;
    cercanas.sort((a, b) => afinidad(b) - afinidad(a));
  }
  const tope = Math.max(IDEAS_MINIMAS, Math.min(exactas.length || elegidas.length, 6));
  const vistos = new Set<string>();
  const resultado: CoincidenciaDecoracion[] = [];
  for (const [item, coincidencia] of [...exactas.map((item) => [item, "exacta"] as const), ...cercanas.map((item) => [item, "cercana"] as const)]) {
    if (resultado.length >= tope) break;
    const clave = tituloComparable(item.decoracion.titulo);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    resultado.push({ ...item.decoracion, titulo: tituloParaEvento(item.decoracion.titulo, entrada.evento), coincidencia });
  }
  return resultado;
}

/** Mínimo de ideas que se intenta mostrar en el carrusel (exactas primero, luego cercanas). */
const IDEAS_MINIMAS = 4;

/** «Arco de entrada en blanco y negro» y «Arco de entrada blanco y negro» son la misma idea para el cliente. */
function tituloComparable(titulo: string): string {
  return normalizarBusqueda(titulo).split(" ").filter((palabra) => palabra !== "en" && palabra !== "de").join(" ");
}

/** Fuera de un cumpleaños, una idea titulada «Cumpleaños …» se presenta como «Fiesta …» (solo en la copia que se devuelve). */
function tituloParaEvento(titulo: string, evento: string | undefined): string {
  if (!evento?.trim() || normalizarBusqueda(evento).includes("cumple")) return titulo;
  return titulo.replace(/^cumplea(?:ñ|n)os(?=\s|$)/i, "Fiesta").replace(/\s+(?:de|para)\s+cumplea(?:ñ|n)os$/i, "");
}

export const decoracionesSempertex: DecoracionSempertex[] = decoracionesRaw.map((dato) => DecoracionSempertexSchema.parse(dato));
export const proveedoresSempertex: ProveedorSempertex[] = proveedoresRaw.map((dato) => ProveedorSempertexSchema.parse(dato));

// Hoy toda la biblioteca y el directorio son ejemplos marcados «Ejemplo» (decisión del dueño, SEGUIMIENTO §4.5). Ocultarlos en
// producción dejaba la vista guiada sin ninguna idea («no tenemos este tipo de decoración» para todo, 2026-10-06). Se ocultan
// solo cuando haya datos reales y se active BIBLIOTECA_OCULTAR_EJEMPLOS=true en producción.
function ocultarEjemplos(): boolean {
  return resolveRuntimeCommercialEnvironment() === "production" && process.env.BIBLIOTECA_OCULTAR_EJEMPLOS === "true";
}

// Dueño (2026-10-06): «sigue mostrando las decoraciones antiguas de ejemplo… solo saldrán categorías soportadas». Desde que
// existe la biblioteca real (20 decoraciones), las de ejemplo no se muestran en ningún entorno.
export function bibliotecaVisible(): DecoracionSempertex[] {
  return decoracionesSempertex.filter((decoracion) => decoracion.origen !== "ejemplo");
}

/** Temáticas con al menos una decoración visible (opcionalmente de un evento): las únicas que se ofrecen al cliente. */
export function tematicasDisponibles(evento?: string): string[] {
  const clave = evento ? normalizarBusqueda(evento) : "";
  const grupoEvento = clave ? sinonimosEvento.find((grupo) => grupo.some((sinonimo) => clave.includes(sinonimo))) : undefined;
  const delEvento = (decoracion: DecoracionSempertex) => !clave
    || decoracion.eventos.some((e) => { const n = normalizarBusqueda(e); return n.includes(clave) || clave.includes(n) || Boolean(grupoEvento?.some((s) => n.includes(s))); });
  const visibles = bibliotecaVisible();
  const elegidas = visibles.filter(delEvento);
  return [...new Set((elegidas.length ? elegidas : visibles).map((decoracion) => decoracion.tematica))];
}

export function proveedoresVisibles(): ProveedorSempertex[] {
  return ocultarEjemplos()
    ? proveedoresSempertex.filter((proveedor) => proveedor.origen !== "ejemplo")
    : proveedoresSempertex;
}
