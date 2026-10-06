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
const sinonimosColor: string[][] = [
  ["rosa", "rosado", "rosada", "fucsia"], ["dorado", "oro"], ["azul", "celeste", "frozen", "hielo", "nieve", "invierno"],
  ["verde", "selva", "tropical"], ["negro", "negra"], ["blanco", "blanca", "perla", "frozen", "nieve"],
  ["lila", "morado", "violeta", "purpura"], ["arcoiris", "multicolor", "colores vivos", "vivos", "neon", "carnaval", "festivo", "festivos", "alegre", "alegres", "colorido", "colorida", "coloridos"],
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
    return { decoracion, exacta, fuerzaExacta, puntaje, evento, edad, puntajeColor };
  });
  const exactasEdad = puntajes.filter((item) => item.exacta && puntajeEdad(entrada.edad, item.decoracion) >= 0);
  // Una idea exacta de OTRO evento no le gana a una del evento pedido.
  const exactasDelEvento = exactasEdad.filter((item) => item.evento > 0);
  const exactasDisponibles = exactasDelEvento.length ? exactasDelEvento : exactasEdad;
  const fuerzaMaxima = Math.max(0, ...exactasDisponibles.map((item) => item.fuerzaExacta));
  const exactas = exactasDisponibles.filter((item) => item.fuerzaExacta === fuerzaMaxima)
    .sort((a, b) => prioridadOrigen(b.decoracion) - prioridadOrigen(a.decoracion) || puntajeEvento(entrada.evento ?? "", b.decoracion) - puntajeEvento(entrada.evento ?? "", a.decoracion) || b.puntaje - a.puntaje);
  if (exactas.length) return exactas.slice(0, 6).map(({ decoracion }) => ({ ...decoracion, coincidencia: "exacta" }));
  const candidatas = puntajes.filter((item) => item.edad >= 0 && (item.evento > 0 || item.puntajeColor > 0));
  // Ideas de fiesta general: ni de otro evento propio (baby shower, boda, XV, bautizo) ni infantiles si no se dio una edad.
  const esGeneral = (item: (typeof puntajes)[number]): boolean => item.edad >= 0 && !esDeEventoPropio(item.decoracion) && (entrada.edad !== undefined || item.decoracion.edad === null || item.decoracion.edad.max >= 18);
  // Con ideas del evento pedido, solo esas (un baby shower no se ofrece para un cumpleaños de 35). Sin ellas, las de color que
  // sean de fiesta general (nunca un baby shower o unos XV para una graduación o un divorcio).
  const delEvento = candidatas.filter((item) => item.evento > 0);
  const elegidas = (delEvento.length ? delEvento : candidatas.filter(esGeneral)).sort((a, b) => prioridadOrigen(b.decoracion) - prioridadOrigen(a.decoracion) || b.puntaje - a.puntaje);
  // Con menos de dos, se completa con fiesta general para que el cliente siempre pueda elegir.
  const relleno = elegidas.length < 2
    ? puntajes.filter((item) => esGeneral(item) && !elegidas.includes(item)).sort((a, b) => b.puntaje - a.puntaje)
    : [];
  return [...elegidas, ...relleno].slice(0, elegidas.length >= 2 ? 6 : Math.max(2, elegidas.length + 1))
    .map(({ decoracion }) => ({ ...decoracion, coincidencia: "cercana" }));
}

export const decoracionesSempertex: DecoracionSempertex[] = decoracionesRaw.map((dato) => DecoracionSempertexSchema.parse(dato));
export const proveedoresSempertex: ProveedorSempertex[] = proveedoresRaw.map((dato) => ProveedorSempertexSchema.parse(dato));

// Hoy toda la biblioteca y el directorio son ejemplos marcados «Ejemplo» (decisión del dueño, SEGUIMIENTO §4.5). Ocultarlos en
// producción dejaba la vista guiada sin ninguna idea («no tenemos este tipo de decoración» para todo, 2026-10-06). Se ocultan
// solo cuando haya datos reales y se active BIBLIOTECA_OCULTAR_EJEMPLOS=true en producción.
function ocultarEjemplos(): boolean {
  return resolveRuntimeCommercialEnvironment() === "production" && process.env.BIBLIOTECA_OCULTAR_EJEMPLOS === "true";
}

export function bibliotecaVisible(): DecoracionSempertex[] {
  return ocultarEjemplos()
    ? decoracionesSempertex.filter((decoracion) => decoracion.origen !== "ejemplo")
    : decoracionesSempertex;
}

export function proveedoresVisibles(): ProveedorSempertex[] {
  return ocultarEjemplos()
    ? proveedoresSempertex.filter((proveedor) => proveedor.origen !== "ejemplo")
    : proveedoresSempertex;
}
