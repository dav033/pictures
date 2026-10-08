import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { coloresDelFormato, formatoPorId } from "./formatos";
import { ErrorHerramienta, fallar, listaFormatos, masParecido, metalizadoMasParecido, nombreColor, nombreDe } from "./herramientas-escena-colores";
import { COLORES_METALIZADO } from "./metalizados";
import type { LineaInventario, SelectorGlobos } from "./partes-globos";
import { armarPieza, type Pieza } from "./piezas";
import { coincideFlexible } from "./repintes";
import { elementosDe, etiquetar, inventarioEtiquetado, parteEfectiva, type ElementoEtiquetado, type Etiquetado } from "./seleccion-datos";
import { ESTRATEGIAS_GENERALES, type CambioNormal, type Contexto } from "./editar-seleccion-estrategias";
import { ESTRATEGIAS_ORGANICO } from "./editar-seleccion-organico";

/**
 * **Edición precisa por selector** (la base de `editar_globos`): «cambia los Link-O-Loon de la decoración», «los R-24 a
 * azul reflex», «la corona de la flor en dorado», «los LOL-12 de la pared a LOL-6», «quita el centro de la flor».
 *
 * `editarSeleccion(pieza, selector, cambio)` cambia SOLO los DATOS de la pieza (sus parámetros: nunca los globos armados)
 * para que lo seleccionado cambie y lo demás no. Prueba estrategias en orden (ver editar-seleccion-estrategias.ts y
 * editar-seleccion-organico.ts) y **siempre verifica armando**: con un cambio de color, globo a globo (cada globo de
 * fuera de la selección sigue igual y cada uno de dentro tomó el color); con formato, inflado o quitar, por inventario
 * (parte × formato × color): fuera de la selección no aparece nada nuevo y lo que cambie de cantidad (la malla se rearma
 * con el tamaño nuevo) se devuelve en `ajenosCambiados`. Si ninguna estrategia pasa, error claro con los motivos.
 * Las partes son las que pone el armador o, si no la puso, la de la ruta de los datos (seleccion-datos.ts).
 */

export type CambioSeleccion = CambioNormal | { tipo: "reemplazar"; de: string; a: string };

export type LineaCambio = { parte: string; formatoId: string; codigo: string; antes: number; despues: number };

export type ResultadoEdicion = {
  pieza: Pieza;
  /** Inventario completo antes y después (parte × formato × color). */
  antes: LineaInventario[];
  despues: LineaInventario[];
  /** El cambio que se hizo (color, formato, inflado, quitar o metalizado). */
  tipo: CambioNormal["tipo"] | "metalizado";
  /** Globos (y tubitos) en la selección antes del cambio. */
  seleccionados: number;
  /**
   * Color: cuántos de la selección cambiaron de color. Formato e inflado: cuántos tiene la selección después (al
   * rearmarse puede tener otro número). Quitar: cuántos se quitaron.
   */
  cambiados: number;
  /** La selección antes y después, por parte × formato × color (después: con el formato nuevo, si cambió). */
  seleccionAntes: LineaInventario[];
  seleccionDespues: LineaInventario[];
  /** Inflado medio (cm) de la selección antes y después, en los cambios de inflado y formato. */
  inflado?: { antes: number; despues: number };
  /** Lo que había fuera de la selección (lo que no se tocó). */
  intactos: LineaInventario[];
  /** Líneas de fuera de la selección que cambiaron de cantidad (solo pasa al cambiar formato, inflado o quitar). */
  ajenosCambiados: LineaCambio[];
  estrategia: string;
  notas: string[];
};

const r0 = (n: number) => Math.round(n);

export function describirSelector(s: SelectorGlobos): string {
  const partes = [
    s.formatos?.length ? s.formatos.join("/") : "",
    s.partes?.length ? `de ${s.partes.map((p) => `«${p}»`).join(" o ")}` : "",
    s.colores?.length ? `en ${s.colores.map(nombreColor).join(" o ")}` : "",
  ].filter(Boolean);
  return partes.length ? `los globos ${partes.join(" ")}` : "todos los globos";
}

export function describirCambio(c: CambioSeleccion): string {
  switch (c.tipo) {
    case "color": return `pasar a ${nombreColor(c.codigo)}`;
    case "reemplazar": return `cambiar ${nombreColor(c.de)} por ${nombreColor(c.a)}`;
    case "formato": return `pasar a ${c.formatoId}`;
    case "inflado": return `inflar a ${c.infladoCm} cm`;
    case "quitar": return "quitar";
  }
}

/** Texto corto de un inventario: «copa/hojas T-260 032 Verde selva ×9, …». */
export function textoLineas(lineas: readonly { parte: string; formatoId: string; codigo: string; cantidad: number }[], max = 6): string {
  const orden = [...lineas].sort((a, b) => b.cantidad - a.cantidad);
  const texto = orden.slice(0, max).map((l) => `${l.parte} ${l.formatoId} ${nombreColor(l.codigo)} ×${l.cantidad}`).join(", ");
  return orden.length > max ? `${texto} y ${orden.length - max} líneas más` : texto;
}

/** De/a → color con el selector limitado a ese color. */
function normalizar(selector: SelectorGlobos, cambio: CambioSeleccion): { selector: SelectorGlobos; cambio: CambioNormal } {
  if (cambio.tipo !== "reemplazar") return { selector, cambio };
  const colores = selector.colores?.length ? selector.colores.filter((c) => c === cambio.de) : [cambio.de];
  return { selector: { ...selector, colores }, cambio: { tipo: "color", codigo: cambio.a } };
}

/** Lo que hay que validar antes de probar: que el color venga en cada formato, que el formato sea de la misma familia. */
function validar(cambio: CambioNormal, elegidos: readonly ElementoEtiquetado[]): void {
  const formatos = [...new Set(elegidos.map((e) => e.formatoId))];
  if (cambio.tipo === "color") {
    const ref = referenciaPorCodigo(cambio.codigo) ?? fallar(`El color ${cambio.codigo} no está en la tabla Sempertex.`);
    for (const f of formatos) {
      if (coloresDelFormato(f).some((c) => c.codigo === cambio.codigo)) continue;
      const otro = masParecido(ref, f);
      fallar(`${f} no viene en ${nombreDe(ref)}${otro ? `: el más parecido que sí viene en ${f} es ${nombreDe(otro)}` : ""}.`);
    }
  } else if (cambio.tipo === "formato") {
    const destino = formatoPorId(cambio.formatoId) ?? fallar(`El formato «${cambio.formatoId}» no existe. Formatos: ${listaFormatos()}.`);
    if (formatos.every((f) => f === destino.id)) fallar(`Esos globos ya son ${destino.id}.`);
    for (const f of formatos) {
      const origen = formatoPorId(f)!;
      if (origen.tipo !== destino.tipo || !!origen.largoCm !== !!destino.largoCm) fallar(`${f} → ${destino.id} no se puede: el formato cambia dentro de la misma familia (${origen.tipo === "link" ? "Link-O-Loon: LOL-12 ↔ LOL-6" : origen.tipo === "tubito" ? "tubitos: T-160, T-260, T-360" : "redondos: R-5, R-9, R-12, R-18, R-24, R-36"}).`);
    }
    for (const codigo of new Set(elegidos.map((e) => e.codigo))) {
      if (coloresDelFormato(destino.id).some((c) => c.codigo === codigo)) continue;
      const ref = referenciaPorCodigo(codigo);
      const otro = ref ? masParecido(ref, destino.id) : undefined;
      fallar(`${destino.id} no viene en ${nombreColor(codigo)}${otro ? `: el más parecido que sí viene en ${destino.id} es ${nombreDe(otro)} (cámbiales primero el color)` : ""}.`);
    }
  } else if (cambio.tipo === "inflado") {
    for (const f of formatos) {
      const fmt = formatoPorId(f)!;
      if (fmt.tipo === "tubito") fallar(`Los tubitos (${f}) no se inflan a una medida: cambia el formato (T-160, T-260, T-360).`);
      const min = r0(fmt.diametroMaxCm * 0.4), max = r0(fmt.diametroMaxCm);
      if (cambio.infladoCm < min || cambio.infladoCm > max) fallar(`Un ${f} se infla entre ${min} y ${max} cm (pediste ${cambio.infladoCm}).`);
    }
  }
}

/** El error de una selección vacía, con lo que la pieza sí tiene (formatos, partes y colores). */
export function sinCoincidencias(pieza: Pieza, s: SelectorGlobos, antes: Etiquetado): never {
  const inv = inventarioEtiquetado(antes.elementos);
  const partes = [...new Set(inv.map((l) => l.parte))];
  const formatos = [...new Set(inv.map((l) => l.formatoId))];
  const colores = [...new Set(inv.map((l) => l.codigo))];
  return fallar(`Ningún globo de esta pieza (${pieza.tipo}) es de ${describirSelector(s)}. Tiene: formatos ${formatos.join(", ") || "ninguno"}; partes ${partes.join(", ")}; colores ${colores.map(nombreColor).join(", ")}. Ajusta formatos/partes/colores a eso.`);
}

// ----------------------------------------------------------------------------------------------------------
// Verificar armando
// ----------------------------------------------------------------------------------------------------------

type Verificado = { ok: true; despues: ElementoEtiquetado[]; seleccion: ElementoEtiquetado[]; cambiados: number; ajenos: LineaCambio[] } | { ok: false; motivo: string };

const media = (es: readonly ElementoEtiquetado[]) => (es.length ? Math.round((es.reduce((t, e) => t + e.infladoCm, 0) / es.length) * 10) / 10 : 0);
const claveDe = (e: ElementoEtiquetado) => `${parteEfectiva(e)}|${e.formatoId}|${e.codigo}`;
function contarPorClave(elementos: readonly ElementoEtiquetado[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of elementos) m.set(claveDe(e), (m.get(claveDe(e)) ?? 0) + 1);
  return m;
}

function verificarColor(ctx: Contexto, nueva: Pieza, destino: string): Verificado {
  const despues = elementosDe(armarPieza(nueva));
  const antes = ctx.antes.elementos;
  if (despues.length !== antes.length || despues.some((e, i) => e.formatoId !== antes[i]!.formatoId)) return { ok: false, motivo: "al armarla cambió la forma de la pieza, no solo el color" };
  let faltan = 0, ajenos = 0, cambiados = 0;
  const etiquetados = despues.map((d, i) => {
    const a = antes[i]!;
    const esperado = ctx.seleccion[i] ? destino : a.codigo;
    if (d.codigo !== esperado) { if (ctx.seleccion[i]) faltan += 1; else ajenos += 1; }
    else if (ctx.seleccion[i] && a.codigo !== destino) cambiados += 1;
    return { ...a, codigo: d.codigo };
  });
  if (faltan || ajenos) return { ok: false, motivo: `${faltan ? `${faltan} de la selección no cambiaron` : ""}${faltan && ajenos ? " y " : ""}${ajenos ? `${ajenos} globos de fuera cambiaron de color` : ""}` };
  return { ok: true, despues: etiquetados, seleccion: etiquetados.filter((_, i) => ctx.seleccion[i]), cambiados, ajenos: [] };
}

function verificarEstructura(ctx: Contexto, nueva: Pieza): Verificado {
  const c = ctx.cambio, s = ctx.selector;
  const despues = etiquetar(nueva).elementos;
  const sinFormato: SelectorGlobos = { ...s, formatos: undefined };
  const viejos = new Set(ctx.antes.elementos.filter((_, i) => ctx.seleccion[i]).map((e) => e.formatoId));
  /** Los de después que son «la selección» (con el formato nuevo, si cambió). */
  const esSeleccion = (e: ElementoEtiquetado) => (c.tipo === "formato" ? coincideFlexible(e, sinFormato) && (e.formatoId === c.formatoId || viejos.has(e.formatoId)) : coincideFlexible(e, s));
  /** Los que ya eran del formato nuevo en esa parte (no se cuentan como ajenos: después no se distinguen de los nuevos). */
  const yaEran = (e: ElementoEtiquetado) => c.tipo === "formato" && e.formatoId === c.formatoId && coincideFlexible(e, sinFormato);
  const elegidosDespues = despues.filter(esSeleccion);
  let cambiados = 0;
  if (c.tipo === "quitar") {
    if (elegidosDespues.length) return { ok: false, motivo: `quedan ${elegidosDespues.length} de esos globos` };
    cambiados = ctx.seleccion.filter(Boolean).length;
  } else if (c.tipo === "formato") {
    const quedan = elegidosDespues.filter((e) => e.formatoId !== c.formatoId).length;
    if (quedan) return { ok: false, motivo: `quedan ${quedan} globos con el formato viejo` };
    if (!elegidosDespues.length) return { ok: false, motivo: `no salió ningún ${c.formatoId} (¿no cabe ahí?)` };
    cambiados = elegidosDespues.length;
  } else if (c.tipo === "inflado") {
    if (!elegidosDespues.length) return { ok: false, motivo: "esos globos desaparecieron al armarla" };
    const media = elegidosDespues.reduce((t, e) => t + e.infladoCm, 0) / elegidosDespues.length;
    if (Math.abs(media - c.infladoCm) > Math.max(1.5, c.infladoCm * 0.2)) return { ok: false, motivo: `quedaron inflados a ${r0(media)} cm en promedio` };
    cambiados = elegidosDespues.length;
  }
  // Fuera de la selección: nada nuevo; lo que cambie de cantidad se informa.
  const fueraAntes = contarPorClave(ctx.antes.elementos.filter((e, i) => !ctx.seleccion[i] && !yaEran(e)));
  const fueraDespues = contarPorClave(despues.filter((e) => !esSeleccion(e)));
  const nuevos = [...fueraDespues.keys()].filter((k) => !fueraAntes.has(k));
  if (nuevos.length) return { ok: false, motivo: `fuera de la selección aparecieron ${nuevos.slice(0, 3).map((k) => k.split("|").join(" ")).join(", ")}` };
  const ajenos: LineaCambio[] = [...fueraAntes].filter(([k, n]) => (fueraDespues.get(k) ?? 0) !== n).map(([k, n]) => {
    const [parte, formatoId, codigo] = k.split("|") as [string, string, string];
    return { parte, formatoId, codigo, antes: n, despues: fueraDespues.get(k) ?? 0 };
  });
  return { ok: true, despues, seleccion: elegidosDespues, cambiados, ajenos };
}

// ----------------------------------------------------------------------------------------------------------
// La edición
// ----------------------------------------------------------------------------------------------------------

function editarMetalizado(pieza: Extract<Pieza, { tipo: "metalizado" }>, s: SelectorGlobos, cambio: CambioNormal): ResultadoEdicion {
  if (cambio.tipo !== "color") fallar("Es un globo metalizado (foil): solo se le cambia el color.");
  if (s.formatos?.length || s.partes?.length) fallar("Es un globo metalizado (foil): no tiene formatos ni partes de látex; cambia su color sin selector.");
  const color = metalizadoMasParecido(cambio.tipo === "color" ? cambio.codigo : "");
  const antes = pieza.metalizado.color;
  return {
    pieza: { ...pieza, metalizado: { ...pieza.metalizado, color } }, antes: [], despues: [], tipo: "metalizado", seleccionados: 1, cambiados: antes === color ? 0 : 1,
    seleccionAntes: [], seleccionDespues: [], intactos: [], ajenosCambiados: [],
    estrategia: "metalizado", notas: [`foil ${COLORES_METALIZADO[antes].nombre} → ${COLORES_METALIZADO[color].nombre} (el color de foil más parecido)`],
  };
}

/** `etiquetado`: el de `etiquetar(pieza)` si ya se tiene (para no volver a armar ni sondear). */
export function editarSeleccion(pieza: Pieza, selector: SelectorGlobos, cambio: CambioSeleccion, etiquetado?: Etiquetado): ResultadoEdicion {
  const normal = normalizar(selector, cambio);
  const s = normal.selector, c = normal.cambio;
  if (pieza.tipo === "metalizado") return editarMetalizado(pieza, s, c);
  if (cambio.tipo === "reemplazar" && !s.colores?.length) fallar(`${nombreColor(cambio.de)} no está entre los colores de la selección.`);
  const antes = etiquetado ?? etiquetar(pieza);
  if (!antes.elementos.length) fallar(`Esta pieza (${pieza.tipo}) no tiene globos.`);
  const seleccion = antes.elementos.map((e) => coincideFlexible(e, s));
  const elegidos = antes.elementos.filter((_, i) => seleccion[i]);
  if (!elegidos.length) sinCoincidencias(pieza, s, antes);
  validar(c, elegidos);
  const notas: string[] = [];
  const ctx: Contexto = { pieza, selector: s, cambio: c, antes, seleccion, notas };
  const organica = pieza.tipo === "organico" || pieza.tipo === "arco_organico";
  const motivos: string[] = [];
  for (const e of (organica ? ESTRATEGIAS_ORGANICO : ESTRATEGIAS_GENERALES).filter((x) => x.cambios.includes(c.tipo))) {
    const largoNotas = notas.length;
    let v: Verificado;
    let nueva: Pieza | string;
    try {
      nueva = e.aplicar(ctx);
      if (typeof nueva === "string") { motivos.push(`${e.nombre}: ${nueva}`); continue; }
      v = c.tipo === "color" ? verificarColor(ctx, nueva, c.codigo) : verificarEstructura(ctx, nueva);
    } catch (error) {
      notas.length = largoNotas;
      motivos.push(`${e.nombre}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof ErrorHerramienta && /no caben|necesita al menos/.test(error.message)) break;
      continue;
    }
    if (!v.ok) { notas.length = largoNotas; motivos.push(`${e.nombre}: ${v.motivo}`); continue; }
    if (c.tipo === "formato") {
      const ya = antes.elementos.filter((x, i) => !seleccion[i] && x.formatoId === c.formatoId && coincideFlexible(x, { ...s, formatos: undefined })).length;
      if (ya) notas.push(`ya había ${ya} ${c.formatoId} ahí: cuentan en lo que tiene ahora la selección`);
    }
    return {
      pieza: nueva, antes: inventarioEtiquetado(antes.elementos), despues: inventarioEtiquetado(v.despues), tipo: c.tipo, seleccionados: elegidos.length, cambiados: v.cambiados,
      seleccionAntes: inventarioEtiquetado(elegidos), seleccionDespues: inventarioEtiquetado(v.seleccion),
      ...(c.tipo === "inflado" || c.tipo === "formato" ? { inflado: { antes: media(elegidos), despues: media(v.seleccion) } } : {}),
      intactos: inventarioEtiquetado(antes.elementos.filter((_, i) => !seleccion[i])),
      ajenosCambiados: v.ajenos, estrategia: e.nombre, notas,
    };
  }
  return fallar(`No pude ${describirCambio(cambio)} solo ${describirSelector(s)} sin tocar lo demás (${elegidos.length} globos: ${textoLineas(inventarioEtiquetado(elegidos), 4)}). Motivos: ${motivos.join(" · ")}.`);
}

/** Cuántos globos de una pieza caen en un selector (con las partes del armador o de los datos). */
export function contarSeleccion(pieza: Pieza, selector: SelectorGlobos): number {
  if (pieza.tipo === "metalizado" || pieza.tipo === "escenografia") return 0;
  return etiquetar(pieza).elementos.filter((e) => coincideFlexible(e, selector)).length;
}
