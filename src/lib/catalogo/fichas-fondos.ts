import { createHash } from "node:crypto";
import { esTelon } from "@/lib/globos3d/fondos-escenografia";
import { SINONIMOS_DE_FONDO } from "@/lib/globos3d/fondos-sinonimos";
import { interpretarTerminos } from "@/lib/globos3d/glosario-taller";
import { NOMBRE_MESA } from "@/lib/globos3d/mobiliario-conjunto-tipos";
import { piezaDeEntrada } from "@/lib/globos3d/mobiliario-pieza";
import { SILLAS } from "@/lib/globos3d/mobiliario-sillas-param";
import { asientosDeEntrada, descripcionConColores, type FondoCatalogo } from "@/lib/globos3d/mobiliario-tipos";
import { armarPieza } from "@/lib/globos3d/piezas";
import type { MedidasRegistro } from "@/lib/taller/fichas-tipos";
import type { RepositorioDeFondos } from "./asignacion-fondos";
import { redactarFichaFondo, type DatosTextoFondo } from "./fichas-fondos-texto";
import type { ClaseFondo, RegistroFondo } from "./fichas-fondos-tipos";
import { MANIFIESTOS } from "./manifiestos";
import { repositorio } from "./registro";
import type { EntradaCatalogo, GeneradorMobiliario } from "./repositorio";

/**
 * Las **fichas de mobiliario y escenografía** para el RAG del taller (REQ-013 fase 3, T14): una por entrada de su repositorio, en
 * el orden del repositorio, con la forma del registro de la biblioteca (`RegistroTaller`) y su clase por `tipo`. Las medidas son
 * las de la pieza armada con sus valores de partida (el mismo camino del motor que `test-catalogo-dorado`). Puro y determinista:
 * la misma entrada da el mismo registro y la misma huella. Como en la biblioteca, el campo `repositorio` no entra en la huella; el
 * texto sí dice de qué repositorio es (y su clase depende de él), así que mover una entrada de repositorio la vuelve a embeber.
 */

export type { ClaseFondo, RegistroFondo } from "./fichas-fondos-tipos";

/** Súbela al cambiar la forma de estas fichas: cambian las huellas y se vuelven a embeber. */
export const VERSION_FICHA_FONDOS = 1;

const CLASES_FONDO: readonly ClaseFondo[] = ["mueble", "mueble-fijo", "generador", "fondo", "decorado"];
const esEntradaDeFondo = (e: EntradaCatalogo): e is EntradaCatalogo<ClaseFondo> => (CLASES_FONDO as readonly string[]).includes(e.clase);

function medidasDe(f: FondoCatalogo): MedidasRegistro {
  const { min, max } = armarPieza(piezaDeEntrada(f)).caja;
  return { altoCm: Math.round(max.y - min.y), anchoCm: Math.round(max.x - min.x), fondoCm: Math.round(max.z - min.z) };
}

const USO_ASIENTO = "Sirve para sentar a los invitados: se reparte en fila o alrededor de una mesa redonda, imperial o de cóctel";
const USO_MESA = "Sirve para servir y exhibir el pastel, los dulces y los regalos, o para sentar a los invitados; se viste con mantel";

function usoDe(f: FondoCatalogo): string {
  if (f.clase === "mueble" && f.sobreMesa) return "Va encima de una mesa (la del pastel o la de postres), en el centro del montaje";
  if (esTelon(f.id)) return "Va contra la pared del fondo, como telón de la foto: lo demás del montaje se pone delante y suele taparlo en parte";
  if (f.grupo === "asiento") return USO_ASIENTO;
  if (f.grupo === "mesa") return USO_MESA;
  return "Completa la escena del montaje, delante o al lado de lo principal";
}

function dondeVa(f: FondoCatalogo): string {
  if (f.lugar === "pared") return `Se cuelga en la pared del fondo${f.alturaParedCm ? `, con el borde de abajo a ${f.alturaParedCm} cm del piso` : ""}`;
  if (f.flotaCm) return `Va en el aire, a ${f.flotaCm} cm del piso, delante de un aro o de un panel`;
  return "Se pone en el piso del montaje";
}

function detallesDe(f: FondoCatalogo): string[] {
  const d: string[] = [];
  if (f.clase === "mueble" && f.sillas) {
    d.push(`Trae ${f.sillas.porDefecto} sillas de partida y admite de ${f.sillas.min} a ${f.sillas.max}${f.sillas.par ? ": una en cada cabecera y las demás por pares a los lados" : ""}`);
  } else if (f.clase === "mueble") {
    const asientos = asientosDeEntrada(f);
    if (asientos === 1) d.push("Es un asiento suelto: cuenta como un puesto");
    else if (asientos > 1) d.push(`Trae ${asientos} puestos`);
  }
  d.push(dondeVa(f));
  if (f.clase === "mueble" && f.conTexto) {
    const lineas = f.lineasTexto ?? 1;
    d.push(`Lleva un texto en cursiva que se puede cambiar (por defecto «${f.textoPorDefecto ?? ""}»), ${lineas > 1 ? `de hasta ${lineas} líneas` : "en una línea"}`);
  }
  if (f.rotulable) d.push("Admite un nombre o un texto en cursiva sobre su cara");
  if (f.clase === "mueble" && f.acabadosPropios?.length) d.push(`Acabados: ${f.acabadosPropios.map(([, nombre]) => nombre.toLowerCase()).join(" o ")}`);
  return d;
}

function variantesDe(g: GeneradorMobiliario): string[] {
  if (g.id === "mesa_param") {
    return g.tipos.map((t) => {
      const l = g.limites[t];
      return `${NOMBRE_MESA[t].toLowerCase()} de ${l.ancho[0]}–${l.ancho[1]} × ${l.fondo[0]}–${l.fondo[1]} cm y ${l.alto[0]}–${l.alto[1]} cm de alto`;
    });
  }
  return g.tipos.map((t) => `${SILLAS[t].plural} de ${SILLAS[t].anchoCm} × ${SILLAS[t].fondoCm} cm y ${SILLAS[t].altoCm} cm de alto`);
}

/**
 * La descripción sin globos («fondo circular para globos o flores» → «fondo circular para flores»): la del catálogo alimenta también
 * el prompt de la lectura de fotos (no se toca); en el RAG, nombrar globos acercaría el mueble a las búsquedas de globos.
 */
export const sinGlobos = (texto: string): string => texto.replace(/\bglobos? (o|y) /gi, "").replace(/ (o|y) globos?\b/gi, "");

const normalizar = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const singular = (palabra: string): string => palabra.replace(/(es|s)$/, "");

/** Estructuras de globos que el glosario del taller no lee como pieza y que también nombran escenografía. */
const ESTRUCTURAS_DE_GLOBOS = new Set(["circulo", "hexagono", "marco"]);

/** ¿Nombra una estructura de globos? (el glosario la lee como pieza que no es escenografía: arco, aro, columna, pared, letras…). */
const nombraEstructuraDeGlobos = (dicho: string): boolean =>
  interpretarTerminos(dicho).tipos.some((t) => t !== "escenografia") || dicho.split(" ").some((p) => ESTRUCTURAS_DE_GLOBOS.has(singular(p)));

/**
 * Cómo más le dicen (la tabla con que se corrigen los ids que inventa el lector de fotos), en palabras. Sin su nombre ni una palabra
 * suelta de su nombre («silla» en la silla Tiffany): el sustantivo genérico apunta a un solo mueble y lo traería a toda búsqueda de
 * sillas. Sin lo que nombra una estructura de globos («círculo», «pilar», «columna romana», «arco chiavari»): lo acercaría a las
 * búsquedas de globos; su nombre ya dice lo que es.
 */
function sinonimosDe(id: string, nombre: string): string[] {
  const propio = normalizar(nombre);
  const delNombre = new Set(propio.split(/[^a-z0-9]+/).filter(Boolean).flatMap((p) => [p, singular(p)]));
  const dichos = Object.entries(SINONIMOS_DE_FONDO).filter(([, destino]) => destino === id).map(([dicho]) => dicho.replace(/_/g, " "));
  return [...new Set(dichos)].filter((s) => s !== propio && !nombraEstructuraDeGlobos(s) && (s.includes(" ") || !(delNombre.has(s) || delNombre.has(singular(s)))));
}

function datosDeTexto(e: EntradaCatalogo<ClaseFondo>, repo: RepositorioDeFondos): DatosTextoFondo {
  const manifiesto = MANIFIESTOS[repo];
  const base = { nombre: e.nombre, clase: e.clase, sinonimos: sinonimosDe(e.idLocal, e.nombre) };
  const conTexto = e.clase !== "generador" && (Boolean(e.dato.rotulable) || (e.dato.clase === "mueble" && Boolean(e.dato.conTexto)));
  const comun = {
    procedencia: `${e.procedencia.titulo}, no un producto de la tienda`,
    repositorio: { nombre: manifiesto.nombre, atribucion: conTexto ? manifiesto.licencia.atribucion ?? null : null },
  };
  if (e.clase === "generador") {
    const g = e.dato;
    return {
      ...base, ...comun, descripcion: sinGlobos(e.descripcion), uso: g.id === "mesa_param" ? USO_MESA : USO_ASIENTO, medidas: null,
      detalles: ["Se pone en el piso del montaje"], variantes: variantesDe(g),
    };
  }
  const f = e.dato;
  return { ...base, ...comun, descripcion: sinGlobos(descripcionConColores(f)), uso: usoDe(f), medidas: medidasDe(f), detalles: detallesDe(f), variantes: [] };
}

/** La ficha de una entrada de mobiliario o escenografía; falla con cualquier otra clase (la biblioteca usa `fichaDeItem`). */
export function fichaDeEntradaFondo(e: EntradaCatalogo): RegistroFondo {
  if (!esEntradaDeFondo(e) || (e.repositorio !== "mobiliario" && e.repositorio !== "escenografia")) throw new Error(`${e.id}: no es una entrada de mobiliario ni de escenografía`);
  const texto = datosDeTexto(e, e.repositorio);
  const datos = {
    id: e.idLocal, tipo: e.clase, nombre: e.nombre, descripcion: sinGlobos(e.descripcion),
    fuente: { tipo: "propio" as const, titulo: e.procedencia.titulo, url: null, foto: null },
    ocasiones: [], tiposPieza: ["escenografia"], formatos: [], colores: [], partes: [], lineasPartes: [], productos: [],
    medidas: texto.medidas, globos: 0, tubos: 0, clasificacion: null, ficha: redactarFichaFondo(texto),
  };
  const hash = createHash("sha256").update(JSON.stringify({ v: VERSION_FICHA_FONDOS, ...datos })).digest("hex");
  return { ...datos, repositorio: e.repositorio, hash };
}

/** Las fichas de todo el repositorio, en su orden. */
export function fichasDeRepositorio(id: RepositorioDeFondos): RegistroFondo[] {
  const repo = repositorio(id);
  if (!repo) throw new Error(`repositorio ${id} sin cargador`);
  return repo.entradas().map(fichaDeEntradaFondo);
}
