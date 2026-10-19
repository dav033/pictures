import { SIN_PARTE } from "@/lib/globos3d/partes-globos";
import { celebracionPorId, tematicaPorId } from "./taxonomia-celebraciones";
import type { LineaParteRegistro, ProductoRegistro, RegistroTaller } from "./fichas-tipos";
import {
  FRASE_TIPO_ITEM, descripcionDeParte, esTubito, frasesFuente, nombreComercialFormato, ocasionLegible, ordenFormato, siluetasDe,
} from "./fichas-vocabulario";

/**
 * Lo que alimenta la ficha: el registro sin ella ni su huella, y sin el repositorio (REQ-013): el texto que se embebe no
 * depende de él, así asignarlo no obliga a volver a embeber.
 */
export type DatosFicha = Omit<RegistroTaller, "ficha" | "hash" | "repositorio">;

export const PALABRAS_MIN_FICHA = 80;
export const PALABRAS_MAX_FICHA = 250;

export const contarPalabras = (texto: string): number => texto.split(/\s+/).filter(Boolean).length;

/** Cuánto detalle entra en la ficha: del completo al más corto, para que una escena enorme quepa en el tope de palabras. */
type Nivel = { partes: number; formatosPorParte: number; coloresPorFormato: number; colores: number; productos: number; descripcionMax: number };
const NIVELES: readonly Nivel[] = [
  { partes: 10, formatosPorParte: 4, coloresPorFormato: 4, colores: 8, productos: 6, descripcionMax: 420 },
  { partes: 7, formatosPorParte: 3, coloresPorFormato: 3, colores: 6, productos: 4, descripcionMax: 280 },
  { partes: 5, formatosPorParte: 3, coloresPorFormato: 2, colores: 5, productos: 3, descripcionMax: 180 },
  { partes: 4, formatosPorParte: 2, coloresPorFormato: 2, colores: 4, productos: 2, descripcionMax: 110 },
  { partes: 3, formatosPorParte: 2, coloresPorFormato: 1, colores: 3, productos: 2, descripcionMax: 70 },
  { partes: 2, formatosPorParte: 1, coloresPorFormato: 1, colores: 3, productos: 1, descripcionMax: 50 },
];

const ORDEN_ORIGEN: Readonly<Record<ProductoRegistro["origen"], number>> = { impreso: 0, metalizado: 1, utileria: 2, globo: 3 };

const conPunto = (t: string): string => { const x = t.trim(); return /[.!?»)…]$/.test(x) ? x : `${x}.`; };
const recortar = (t: string, max: number): string => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`);
const lista = (xs: readonly string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const cuenta = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

function medidasTexto(m: DatosFicha["medidas"]): string | null {
  if (!(m.altoCm > 0 || m.anchoCm > 0)) return null;
  const largo = (cm: number) => (cm >= 100 ? `${(Math.round(cm / 10) / 10).toString().replace(".", ",")} m` : `${Math.round(cm)} cm`);
  return `Mide unos ${largo(m.altoCm)} de alto por ${largo(m.anchoCm)} de ancho y ${largo(m.fondoCm)} de fondo.`;
}

function nombreDeColor(d: DatosFicha, codigo: string): string {
  const c = d.colores.find((x) => x.codigo === codigo);
  return c && c.nombre !== codigo ? `${c.nombre} ${codigo}` : codigo;
}

/** «40 R-12 (24 Reflex Dorado 970, 16 Fashion Azul 940)» para un formato de una parte. */
function textoFormato(d: DatosFicha, formatoId: string, lineas: readonly LineaParteRegistro[], coloresMax: number): string {
  const total = lineas.reduce((s, l) => s + l.cantidad, 0);
  const etiqueta = esTubito(formatoId) ? `${total === 1 ? "tubito" : "tubitos"} ${formatoId}` : formatoId;
  const porColor = [...lineas].sort((a, b) => b.cantidad - a.cantidad);
  if (porColor.length === 1) return `${total} ${etiqueta} ${nombreDeColor(d, porColor[0]!.codigo)}`;
  const mostrados = porColor.slice(0, coloresMax).map((l) => `${l.cantidad} ${nombreDeColor(d, l.codigo)}`);
  const resto = porColor.length - coloresMax;
  return `${total} ${etiqueta} (${mostrados.join(", ")}${resto > 0 ? ` y ${cuenta(resto, "color más", "colores más")}` : ""})`;
}

function textoPartes(d: DatosFicha, n: Nivel): string | null {
  if (!d.lineasPartes.length) return null;
  const porParte = new Map<string, LineaParteRegistro[]>();
  for (const l of d.lineasPartes) porParte.set(l.parte, [...(porParte.get(l.parte) ?? []), l]);
  const partes = [...porParte.entries()].map(([parte, ls]) => ({ parte, ls, total: ls.reduce((s, l) => s + l.cantidad, 0) })).sort((a, b) => b.total - a.total);
  const frases = partes.slice(0, n.partes).map(({ parte, ls }) => {
    const porFormato = new Map<string, LineaParteRegistro[]>();
    for (const l of ls) porFormato.set(l.formatoId, [...(porFormato.get(l.formatoId) ?? []), l]);
    const formatos = [...porFormato.entries()].sort((a, b) => ordenFormato(a[0]) - ordenFormato(b[0]));
    const mostrados = formatos.slice(0, n.formatosPorParte).map(([f, x]) => textoFormato(d, f, x, n.coloresPorFormato));
    const resto = formatos.length - n.formatosPorParte;
    const nombre = parte === SIN_PARTE ? "globos sin parte específica" : `parte «${parte}»`;
    return `${nombre}: ${mostrados.join("; ")}${resto > 0 ? `; y ${cuenta(resto, "formato más", "formatos más")}` : ""}`;
  });
  const sobran = partes.length - n.partes;
  const globosQueSobran = partes.slice(n.partes).reduce((s, p) => s + p.total, 0);
  return `Por partes, ${frases.join(". ")}${sobran > 0 ? `. Y ${cuenta(sobran, "parte más", "partes más")} con ${globosQueSobran} globos` : ""}.`;
}

function textoProductos(d: DatosFicha, n: Nivel): string | null {
  const ordenados = [...d.productos].sort((a, b) => ORDEN_ORIGEN[a.origen] - ORDEN_ORIGEN[b.origen] || b.cantidad - a.cantidad);
  if (!ordenados.length) return null;
  const mostrados = ordenados.slice(0, n.productos).map((p) => `${p.nombre.toLowerCase()} (${p.cantidad}${p.generico && !/^gen[eé]rico/i.test(p.nombre) ? ", genérico: no hay uno igual en la tienda" : ""})`);
  const resto = ordenados.length - n.productos;
  return `Productos de la tienda Sempertex: ${mostrados.join("; ")}${resto > 0 ? `; y ${cuenta(resto, "producto más", "productos más")}` : ""}.`;
}

function redactar(d: DatosFicha, n: Nivel, conGlosario: boolean): string {
  // Una decoración o una utilería sola ya lo dice su tipo de item: repetirlo con la pieza no suma.
  const siluetas = d.tipo === "decoracion" || d.tipo === "utileria" ? [] : siluetasDe(d.tiposPieza, d.partes);
  const bloques: string[] = [conPunto(d.nombre)];
  bloques.push(`${FRASE_TIPO_ITEM[d.tipo]}${siluetas.length ? `: ${lista(siluetas)}` : ""}.`);
  if (d.descripcion.trim() && d.descripcion.trim() !== d.nombre.trim()) bloques.push(conPunto(recortar(d.descripcion.trim(), n.descripcionMax)));
  bloques.push(d.globos || d.tubos
    ? `Lleva ${d.globos ? cuenta(d.globos, "globo", "globos") : ""}${d.globos && d.tubos ? " y " : ""}${d.tubos ? cuenta(d.tubos, "tubito", "tubitos") : ""} en total.`
    : "No lleva globos: es escenografía, papel o utilería, y no se cotiza como globos.");
  const partes = textoPartes(d, n);
  if (partes) bloques.push(partes);
  if (d.formatos.length) bloques.push(`Formatos: ${[...d.formatos].sort((a, b) => ordenFormato(a) - ordenFormato(b)).map(nombreComercialFormato).join(", ")}.`);
  if (d.colores.length) {
    const colores = d.colores.slice(0, n.colores).map((c) => (c.nombre === c.codigo ? c.codigo : `${c.nombre} (${c.codigo})`));
    const mas = d.colores.length - n.colores;
    bloques.push(`Colores: ${colores.join(", ")}${mas > 0 ? ` y ${mas} más` : ""}.`);
  }
  const productos = textoProductos(d, n);
  if (productos) bloques.push(productos);
  const medidas = medidasTexto(d.medidas);
  if (medidas) bloques.push(medidas);
  const ocasiones = d.ocasiones.map(ocasionLegible);
  if (ocasiones.length) bloques.push(ocasiones.length === 1 && ocasiones[0] === "general" ? "Ocasión: general, sirve para cualquier fiesta." : `Ocasiones: ${ocasiones.join(", ")}.`);
  if (d.clasificacion?.celebraciones.length) bloques.push(`Celebraciones: ${d.clasificacion.celebraciones.map((id) => celebracionPorId(id)?.nombre ?? id).join(", ")}.`);
  if (d.clasificacion?.tematicas.length) bloques.push(`Temáticas: ${d.clasificacion.tematicas.map((id) => tematicaPorId(id)?.nombre ?? id).join(", ")}.`);
  if (d.fuente) bloques.push(frasesFuente(d.fuente));
  if (conGlosario) {
    const explicadas = d.partes.map((p) => ({ p, texto: descripcionDeParte(p) })).filter((x): x is { p: string; texto: string } => x.texto !== null).slice(0, 4);
    if (explicadas.length) bloques.push(`Sus partes: ${explicadas.map((x) => `«${x.p}», ${x.texto.charAt(0).toLowerCase()}${x.texto.slice(1).replace(/\.$/, "")}`).join("; ")}.`);
  }
  return bloques.join(" ");
}

/**
 * La ficha del item: texto en español, natural y denso, de ~80 a ~250 palabras (qué es y su silueta, partes → formatos y
 * colores con cantidades, formatos en palabras del oficio, productos, medidas, ocasiones, clasificación y fuente). Si
 * con todo el detalle pasa del tope, baja de nivel; si se queda corta, explica sus partes con el vocabulario del taller.
 */
export function redactarFicha(d: DatosFicha): string {
  let texto = "";
  for (const nivel of NIVELES) {
    texto = redactar(d, nivel, false);
    if (contarPalabras(texto) <= PALABRAS_MAX_FICHA) break;
  }
  if (contarPalabras(texto) < PALABRAS_MIN_FICHA) {
    const ampliado = redactar(d, NIVELES[0]!, true);
    if (contarPalabras(ampliado) <= PALABRAS_MAX_FICHA) texto = ampliado;
  }
  return texto;
}
