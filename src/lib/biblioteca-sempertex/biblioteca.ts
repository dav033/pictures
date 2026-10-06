import decoracionesRaw from "./decoraciones.json";
import proveedoresRaw from "./proveedores.json";
import { DecoracionSempertexSchema, ProveedorSempertexSchema, type DecoracionSempertex, type ProveedorSempertex } from "./esquemas";
import { resolveRuntimeCommercialEnvironment } from "@/lib/generacion/provenance";

export type CoincidenciaDecoracion = DecoracionSempertex & { coincidencia: "exacta" | "cercana" };

const sinonimosTematicos: string[][] = [
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
  ["rosa", "rosado", "rosada", "fucsia"], ["dorado", "oro"], ["azul", "celeste"],
  ["verde", "selva", "tropical"], ["negro", "negra"], ["blanco", "blanca", "perla"],
  ["lila", "morado", "violeta", "purpura"], ["arcoiris", "multicolor", "colores vivos", "vivos", "neon", "carnaval", "festivo", "festivos", "alegre", "alegres", "colorido", "colorida", "coloridos"],
];

export function normalizarBusqueda(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim();
}

function contieneAlguno(texto: string, palabras: string[]): boolean {
  return palabras.some((palabra) => ` ${texto} `.includes(` ${normalizarBusqueda(palabra)} `));
}

function puntajeEvento(evento: string, decoracion: DecoracionSempertex): number {
  const consulta = normalizarBusqueda(evento);
  const eventos = decoracion.eventos.map(normalizarBusqueda).join(" ");
  const tematica = normalizarBusqueda(`${decoracion.titulo} ${decoracion.tematica}`);
  if (!consulta) return 0;
  const sinonimo = sinonimosEvento.find((grupo) => contieneAlguno(consulta, grupo));
  if (sinonimo && contieneAlguno(eventos, sinonimo)) return 4;
  if (contieneAlguno(eventos, consulta.split(" ").filter((palabra) => palabra.length > 3))) return 3;
  if (contieneAlguno(tematica, consulta.split(" ").filter((palabra) => palabra.length > 3))) return 1;
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

export function buscarDecoracionesSempertex(entrada: { evento?: string; edad?: number; tematica?: string }, catalogo: DecoracionSempertex[] = bibliotecaVisible()): CoincidenciaDecoracion[] {
  const temaConsulta = normalizarBusqueda(entrada.tematica ?? "");
  const gruposConsultados = sinonimosTematicos.filter((grupo) => contieneAlguno(temaConsulta, grupo));
  const esBabyShower = contieneAlguno(normalizarBusqueda(entrada.evento ?? ""), ["baby shower", "bienvenida de bebe"]);
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
  const exactasDisponibles = puntajes.filter((item) => item.exacta && puntajeEdad(entrada.edad, item.decoracion) >= 0);
  const fuerzaMaxima = Math.max(0, ...exactasDisponibles.map((item) => item.fuerzaExacta));
  const exactas = exactasDisponibles.filter((item) => item.fuerzaExacta === fuerzaMaxima)
    .sort((a, b) => puntajeEvento(entrada.evento ?? "", b.decoracion) - puntajeEvento(entrada.evento ?? "", a.decoracion) || b.puntaje - a.puntaje);
  if (exactas.length) return exactas.slice(0, 6).map(({ decoracion }) => ({ ...decoracion, coincidencia: "exacta" }));
  const candidatas = puntajes.filter((item) => item.edad >= 0 && (item.evento > 0 || item.puntajeColor > 0));
  // Un evento que la biblioteca no tiene (divorcio, jubilación, despedida…) no deja al cliente sin ideas: se ofrecen las de fiesta
  // general que encajan por edad y colores, nunca las de un evento ajeno (un baby shower o una boda para un divorcio).
  // Con una sola idea parecida se completa hasta dos con las de fiesta general, para que el cliente pueda elegir.
  if (candidatas.length < 2) {
    const generales = puntajes.filter((item) => item.edad >= 0 && !esDeEventoPropio(item.decoracion) && !candidatas.includes(item))
      .sort((a, b) => b.puntaje - a.puntaje);
    return [...candidatas, ...generales].slice(0, candidatas.length ? 2 : 4)
      .map(({ decoracion }) => ({ ...decoracion, coincidencia: "cercana" }));
  }
  // Con evento conocido, una idea de otro evento (un baby shower para un cumpleaños de 35) no se ofrece si hay alguna del mismo.
  const delEvento = candidatas.filter((item) => item.evento > 0);
  return (delEvento.length ? delEvento : candidatas)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, 6)
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
