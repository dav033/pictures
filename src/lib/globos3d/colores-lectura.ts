import { referenciaPorCodigo } from "../plan/referencia-sempertex";
import { coloresDelFormato } from "./formatos";
import { distanciaLab, resolverColorFlexible, resolverColorOrganico } from "./herramientas-escena-colores";
import type { ColorLeido, ColoresEscalon, MezclaLeida } from "./lectura-foto";
import { formatosDeEscalones } from "./mezcla-lectura";
import type { ColorOrganico } from "./organico";
import { fraccionesDe } from "./zonas-organicas";

/**
 * **Los colores de una pieza orgánica leída** → la paleta del motor orgánico (`ColorOrganico[]`): cada color por su nombre
 * de decorador y su acabado en la tabla Sempertex; y, si la lectura lo dice, por escalón de tamaño («los gigantes casi
 * todos dorados») y por tramo («el pie izquierdo casi todo dorado»). Puro.
 *
 * - Por escalón (`coloresPorEscalon`): cada color va con el peso de ese escalón y solo en sus formatos; los formatos de los
 *   escalones sin reparto propio llevan los pesos de la pieza.
 * - Por tramo (`dominante` de un punto): en ese trecho del recorrido el color dominante suma otro tanto como todo el resto
 *   junto (queda en ~2/3 de los globos del trecho).
 */

const r0 = (n: number) => Math.round(n);
const FAMILIA_ACABADO: Readonly<Record<ColorLeido["acabado"], string>> = { mate: "", brillante: "", cromado: "reflex", perla: "silk", cristal: "cristal", confeti: "cristal" };
const CRISTAL = "390";
const FORMATOS_ORGANICOS: readonly string[] = ["R-36", "R-24", "R-18", "R-12", "R-9", "R-5"];
const FORMATOS_CRISTAL: readonly string[] = ["R-12", "R-18", "R-24"];

/** Un color leído → código Sempertex (en los formatos pedidos): por nombre y acabado, si no por el hex medido. */
export function codigoDeColor(c: ColorLeido, formatos: readonly string[], notas: string[]): string {
  if (c.acabado === "cristal" || c.acabado === "confeti") return CRISTAL;
  const familia = FAMILIA_ACABADO[c.acabado];
  const pedido = familia && !c.nombre.toLowerCase().includes(familia) ? `${c.nombre} ${familia}` : c.nombre;
  try {
    return formatos.length === 1 && formatos[0] !== "R-12" ? resolverColorFlexible(pedido, formatos, notas) : resolverColorOrganico(pedido, notas).codigo;
  } catch {
    // El nombre no está en la tabla: el más parecido por el color medido (de la familia del acabado, si la trae).
    const candidatos = coloresDelFormato(formatos[0] ?? "R-12").filter((r) => !familia || (referenciaPorCodigo(r.codigo)?.familia ?? "").toLowerCase().includes(familia));
    const lista = candidatos.length ? candidatos : coloresDelFormato(formatos[0] ?? "R-12");
    const mejor = [...lista].sort((a, b) => distanciaLab(c.hex, a.hexGlobo) - distanciaLab(c.hex, b.hexGlobo))[0];
    notas.push(`«${c.nombre}» no está en la tabla: va ${mejor?.codigo} ${mejor?.nombreCompleto} (el más parecido al color de la foto).`);
    return mejor?.codigo ?? "005";
  }
}

/** La paleta simple: un color por código (los repetidos suman su peso). */
export function coloresOrganicos(colores: readonly ColorLeido[], notas: string[]): ColorOrganico[] {
  const salida: ColorOrganico[] = [];
  for (const c of colores) {
    const codigo = codigoDeColor(c, ["R-12"], notas);
    const peso = Math.max(1, r0(c.peso));
    const previo = salida.find((x) => x.codigo === codigo && Boolean(x.confeti) === (c.acabado === "confeti"));
    if (previo) { previo.peso += peso; continue; }
    salida.push({ codigo, peso, ...(c.acabado === "confeti" ? { confeti: true } : {}), ...(codigo === CRISTAL ? { formatos: [...FORMATOS_CRISTAL] } : {}) });
  }
  return salida;
}

/** Una entrada de la paleta limitada a unos formatos (el cristal, además, solo en los suyos); null si no va en ninguno. */
function entrada(c: ColorLeido, codigo: string, peso: number, formatos: readonly string[] | null): ColorOrganico | null {
  const permitidos = codigo === CRISTAL ? (formatos ?? FORMATOS_CRISTAL).filter((f) => FORMATOS_CRISTAL.includes(f)) : formatos;
  if (peso <= 0 || (permitidos && !permitidos.length)) return null;
  return { codigo, peso: Math.max(1, r0(peso)), porFormato: true, ...(c.acabado === "confeti" ? { confeti: true } : {}), ...(permitidos ? { formatos: [...permitidos] } : {}) };
}

/** El índice del color de la pieza que nombra `nombre` (igual o contenido en él), o -1. */
function indiceDeColor(colores: readonly ColorLeido[], nombre: string): number {
  const n = nombre.toLowerCase();
  const exacto = colores.findIndex((c) => c.nombre.toLowerCase() === n);
  return exacto >= 0 ? exacto : colores.findIndex((c) => c.nombre.toLowerCase().includes(n) || n.includes(c.nombre.toLowerCase()));
}

const ESCALERA_GRANDES: readonly string[] = ["R-36", "R-24", "R-18", "R-12"];

/**
 * El formato para un color: el pedido si el color se fabrica en él; si no, el más grande de los de abajo que lo tenga (un
 * gigante dorado cromado es un R-24 Reflex Dorado, no un R-36 de otro color: nunca se cambia el color por el tamaño).
 */
export function formatoConColor(formatoId: string, codigo: string): string {
  const desde = Math.max(0, ESCALERA_GRANDES.indexOf(formatoId));
  return ESCALERA_GRANDES.slice(desde).find((f) => coloresDelFormato(f).some((r) => r.codigo === codigo)) ?? formatoId;
}

/** Los globos fijos de las anclas medidas (en coordenadas de la foto: x, y de 0 a 1), con su formato y su código. */
export function fijosDeAnclas(p: { colores: readonly ColorLeido[]; mezcla?: MezclaLeida; anclas?: ReadonlyArray<{ x: number; y: number; escalon: "gigantes" | "grandes"; color: string }> }, altoImagenCm: number, notas: string[]): Array<{ formatoId: string; codigo: string; x: number; y: number }> {
  if (!p.anclas?.length) return [];
  const formatos = formatosDeEscalones(p.mezcla, altoImagenCm);
  return p.anclas.flatMap((a) => {
    const k = indiceDeColor(p.colores, a.color);
    if (k < 0) return [];
    const c = p.colores[k]!;
    const codigo = codigoDeColor(c, ["R-12"], notas);
    const formatoId = formatoConColor(formatos[a.escalon][0] ?? "R-18", codigo);
    return [{ formatoId, codigo: c.acabado === "confeti" || c.acabado === "cristal" ? codigo : codigoDeColor(c, [formatoId], notas), x: a.x, y: a.y }];
  });
}

export type PiezaConColores = {
  colores: readonly ColorLeido[];
  mezcla?: MezclaLeida;
  coloresPorEscalon?: readonly ColoresEscalon[];
  puntos?: ReadonlyArray<{ x: number; y: number; dominante?: string }>;
};

/** La paleta de una pieza orgánica leída, con sus colores por escalón y por tramo si los trae. */
export function paletaDeLectura(p: PiezaConColores, altoImagenCm: number, notas: string[]): ColorOrganico[] {
  const porEscalon = (p.coloresPorEscalon ?? []).filter((e) => e.pesos.some((w) => w > 0));
  const conDominantes = Boolean(p.puntos?.some((q) => q.dominante));
  if (!porEscalon.length && !conDominantes) return coloresOrganicos(p.colores, notas);
  const codigos = p.colores.map((c) => codigoDeColor(c, ["R-12"], notas));
  const salida: ColorOrganico[] = [];
  const empujar = (x: ColorOrganico | null) => { if (x) salida.push(x); };
  if (porEscalon.length) {
    const formatos = formatosDeEscalones(p.mezcla, altoImagenCm);
    const propios = new Set(porEscalon.flatMap((e) => formatos[e.escalon]));
    const resto = FORMATOS_ORGANICOS.filter((f) => !propios.has(f));
    p.colores.forEach((c, k) => empujar(entrada(c, codigos[k]!, c.peso, resto)));
    // Cada escalón, con el color resuelto en SU formato (el Reflex Dorado no se fabrica en 36": ahí va el Metal Dorado).
    for (const e of porEscalon) p.colores.forEach((c, k) => empujar(entrada(c, formatos[e.escalon].length === 1 ? codigoDeColor(c, formatos[e.escalon], notas) : codigos[k]!, e.pesos[k] ?? 0, formatos[e.escalon])));
  } else {
    salida.push(...coloresOrganicos(p.colores, notas));
  }
  if (conDominantes && p.puntos) {
    const fr = fraccionesDe(p.puntos);
    // Lo que pesa un grupo de globos (con escalones, la paleta se repite por cada uno).
    const total = salida.reduce((s, x) => s + x.peso, 0) / (porEscalon.length + 1);
    p.puntos.forEach((q, i) => {
      if (!q.dominante) return;
      const k = indiceDeColor(p.colores, q.dominante);
      if (k < 0) { notas.push(`El color dominante «${q.dominante}» no está entre los colores de la pieza.`); return; }
      const desde = i === 0 ? 0 : (fr[i - 1]! + fr[i]!) / 2, hasta = i === fr.length - 1 ? 1 : (fr[i]! + fr[i + 1]!) / 2;
      const base = entrada(p.colores[k]!, codigos[k]!, total, null);
      if (base) salida.push({ ...base, franjas: [{ desde: Math.round(desde * 1000) / 1000, hasta: Math.round(hasta * 1000) / 1000 }] });
    });
  }
  return salida;
}
