import { z } from "zod";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { FORMATOS_GLOBO, coloresDelFormato } from "./formatos";
import type { Escena, NodoEscena } from "./escena";
import { ErrorHerramienta, codigosDePedido, fallar, listaFormatos, nombreColor, palabras, referenciaDePedido, resolverColor } from "./herramientas-escena-colores";
import { editarSeleccion, sinCoincidencias, textoLineas, type CambioSeleccion, type ResultadoEdicion } from "./editar-seleccion";
import type { SelectorGlobos } from "./partes-globos";
import type { Pieza } from "./piezas";
import { coincideFlexible } from "./repintes";
import { etiquetar, type Etiquetado } from "./seleccion-datos";

/**
 * La herramienta **`editar_globos`** de la IA de escena: el cambio preciso por selector (formato, parte, color) en una
 * pieza o en todas las que tengan esos globos. Traduce lo que dice el modelo (nombres de color, «LOL» por «LOL-*») al
 * selector y al cambio de `editarSeleccion` (editar-seleccion.ts) y le devuelve, pieza por pieza, qué había y qué hay
 * («antes → después» por parte, formato y color) y lo que no se tocó, para que lo verifique y se lo diga al usuario.
 */

export const ESQUEMA_EDITAR_GLOBOS = z.object({
  id: z.string().min(1).max(80).optional().describe("id de la pieza; si falta, todas las piezas que tengan globos de la selección"),
  formatos: z.array(z.string().min(1).max(12)).max(8).optional().describe("formatos exactos («R-24», «LOL-12», «T-260») o familia («LOL-*» = todos los Link-O-Loon, «T-*» = tubitos, «R-*» = redondos)"),
  partes: z.array(z.string().min(1).max(40)).max(8).optional().describe("partes de la pieza («petalos», «corona», «centro», «hojas», «tronco», «copa», «cocos», «base», «union»…; ver_escena/el inventario dicen cuáles tiene)"),
  colores: z.array(z.string().min(1).max(60)).max(6).optional().describe("solo los globos de estos colores (nombre o código)"),
  cambio: z.object({
    color: z.string().min(1).max(60).optional().describe("pasar la selección a este color (nombre o código)"),
    de: z.string().min(1).max(60).optional().describe("con «a»: dentro de la selección, cambia este color…"),
    a: z.string().min(1).max(60).optional().describe("…por este"),
    formato: z.string().min(1).max(12).optional().describe("otro formato de la misma familia (LOL-12 ↔ LOL-6, R-12 → R-9, T-260 ↔ T-160): toma el inflado de decoración de ese formato"),
    inflado_cm: z.number().min(2).max(100).optional().describe("inflar la selección a esta medida (cm)"),
    quitar: z.boolean().optional().describe("true: quitar la selección (el centro o la corona de una flor, los cocos, un tamaño de un orgánico…)"),
  }).describe("UNO solo: color, de+a, formato, inflado_cm o quitar"),
});

export const DESCRIPCION_EDITAR_GLOBOS = "Edición PRECISA de los globos que se eligen por formato, parte y/o color, en una pieza (id) o en todas las que los tengan: cambiarles el color (o un color por otro), el formato dentro de su familia (LOL-12 → LOL-6, R-12 → R-9, T-260 → T-160), el inflado, o quitarlos (el centro de una flor, los cocos, un tamaño de un orgánico). Cambia SOLO esos globos y lo comprueba armando la pieza: devuelve por pieza cuántos había y cuántos hay de cada parte/formato/color y lo que quedó sin tocar. Úsala para «cambia los Link-O-Loon de la decoración», «los R-24 a azul reflex», «la corona de la flor en dorado», «quita el centro», «los LOL-12 a LOL-6».";

type Argumentos = z.infer<typeof ESQUEMA_EDITAR_GLOBOS>;
export type PiezaEditada = { nodo: NodoEscena; nueva: Pieza };

const FAMILIAS = new Set(FORMATOS_GLOBO.map((f) => f.id.split("-")[0]!));

/** «lol» → «LOL-*», «r-24» → «R-24»; error si no es un formato ni una familia. */
function formatoPedido(f: string): string {
  const p = f.trim().toUpperCase().replace(/\s+/g, "");
  const familia = p.replace(/-?\*?$/, "");
  if (FORMATOS_GLOBO.some((x) => x.id === p)) return p;
  if (FAMILIAS.has(familia) && (p === familia || p.endsWith("*"))) return `${familia}-*`;
  return fallar(`El formato «${f}» no existe. Formatos: ${listaFormatos()} (o familia: LOL-*, R-*, T-*).`);
}

/** Los códigos de la pieza que encajan con un color pedido (código, o nombre: «rosado» = los rosados que lleve). */
function codigosEnPieza(pedido: string, usados: readonly string[]): string[] {
  const codigo = pedido.match(/\b(\d{3})\b/)?.[1];
  if (codigo) return usados.includes(codigo) ? [codigo] : [];
  const directos = codigosDePedido(pedido).filter((c) => usados.includes(c));
  if (directos.length) return directos;
  const buscadas = palabras(pedido).join(" ");
  return usados.filter((c) => { const r = referenciaPorCodigo(c); return !!r && palabras(r.nombreCompleto).join(" ").includes(buscadas); });
}

/** El color destino (nombre o código) que se fabrica en todos los formatos de la selección, o el error con el más parecido. */
function colorDestino(pedido: string, formatos: readonly string[], notas: string[]): string {
  let primero: ErrorHerramienta | null = null;
  for (const f of formatos) {
    try {
      const r = resolverColor(pedido, f);
      if (formatos.every((g) => coloresDelFormato(g).some((c) => c.codigo === r.codigo))) { if (r.nota) notas.push(r.nota); return r.codigo; }
    } catch (error) {
      if (!(error instanceof ErrorHerramienta)) throw error;
      primero ??= error;
    }
  }
  if (primero) throw primero;
  // Viene en el primero y no en algún otro: editarSeleccion dice en cuál falta y cuál es el más parecido.
  return resolverColor(pedido, formatos[0]!).codigo;
}

type Plan = { selector: SelectorGlobos; cambio: CambioSeleccion; etiquetado: Etiquetado } | { omitir: string };

/** El selector y el cambio de una pieza (los colores por nombre se resuelven con los que la pieza lleva). */
function planDe(nodo: NodoEscena, a: Argumentos, notas: string[]): Plan {
  const etiquetado = etiquetar(nodo.pieza);
  const usados = [...new Set(etiquetado.elementos.map((e) => e.codigo))];
  const listaUsados = usados.map(nombreColor).join(", ");
  const colores: string[] = [];
  for (const c of a.colores ?? []) {
    const encontrados = codigosEnPieza(c, usados);
    if (!encontrados.length) return { omitir: `no lleva «${c}» (lleva ${listaUsados})` };
    colores.push(...encontrados);
  }
  const base: SelectorGlobos = {
    ...(a.formatos?.length ? { formatos: [...new Set(a.formatos.map(formatoPedido))] } : {}),
    ...(a.partes?.length ? { partes: a.partes.map((p) => p.trim().toLowerCase()) } : {}),
    ...(colores.length ? { colores: [...new Set(colores)] } : {}),
  };
  let selector = base;
  if (a.cambio.de !== undefined) {
    const de = codigosEnPieza(a.cambio.de, usados);
    if (!de.length) return { omitir: `no lleva «${a.cambio.de}» (lleva ${listaUsados})` };
    selector = { ...base, colores: base.colores ? base.colores.filter((c) => de.includes(c)) : de };
    if (!selector.colores!.length) return { omitir: `ninguno de los colores pedidos es «${a.cambio.de}»` };
  }
  const elegidos = etiquetado.elementos.filter((e) => coincideFlexible(e, selector));
  if (!elegidos.length) return a.id ? sinCoincidencias(nodo.pieza, selector, etiquetado) : { omitir: "no tiene globos de esa selección" };
  const formatos = [...new Set(elegidos.map((e) => e.formatoId))];
  const c = a.cambio;
  const cambio: CambioSeleccion = c.color !== undefined || c.a !== undefined ? { tipo: "color", codigo: colorDestino((c.color ?? c.a)!, formatos, notas) }
    : c.formato !== undefined ? { tipo: "formato", formatoId: c.formato.trim().toUpperCase() }
      : c.inflado_cm !== undefined ? { tipo: "inflado", infladoCm: c.inflado_cm }
        : { tipo: "quitar" };
  return { selector, cambio, etiquetado };
}

/** «antes → después» de la selección, lo que quedó igual y lo de fuera que cambió de cantidad. */
export function textoResultado(r: ResultadoEdicion): string {
  if (r.tipo === "metalizado") return r.notas.join("; ");
  const que = r.tipo === "color" ? `cambié de color ${r.cambiados} de ${r.seleccionados} globos seleccionados`
    : r.tipo === "quitar" ? `quité ${r.cambiados} globos`
      : `la selección tenía ${r.seleccionados} globos y ahora tiene ${r.cambiados}`;
  const intactos = r.intactos.reduce((s, l) => s + l.cantidad, 0);
  const partes = [
    `${que} (estrategia ${r.estrategia})`,
    `antes: ${textoLineas(r.seleccionAntes)} → después: ${r.seleccionDespues.length ? textoLineas(r.seleccionDespues) : "nada"}`,
    ...(r.inflado ? [`inflado medio ${r.inflado.antes} → ${r.inflado.despues} cm`] : []),
    `sin tocar: ${intactos} globos${intactos ? ` (${textoLineas(r.intactos, 5)})` : ""}`,
  ];
  if (r.ajenosCambiados.length) partes.push(`OJO, la pieza se rearmó y fuera de la selección cambió la cantidad (mismos colores y partes): ${r.ajenosCambiados.slice(0, 5).map((l) => `${l.parte} ${l.formatoId} ${nombreColor(l.codigo)} ${l.antes} → ${l.despues}`).join(", ")}`);
  return partes.join("; ");
}

export function editarGlobos(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string; editadas: PiezaEditada[] } {
  const a = ESQUEMA_EDITAR_GLOBOS.parse(argumentos);
  const c = a.cambio;
  const cuantos = [c.color !== undefined || c.a !== undefined, c.formato !== undefined, c.inflado_cm !== undefined, c.quitar === true].filter(Boolean).length;
  if (cuantos !== 1) fallar("En cambio pasa UNO: color, de + a, formato, inflado_cm o quitar: true.");
  if ((c.de === undefined) !== (c.a === undefined)) fallar("de y a van juntos (cambia el color «de» por el color «a» dentro de la selección).");
  if (c.de !== undefined && c.color !== undefined) fallar("Pasa color o de + a, no los dos.");
  if (!a.id && !a.formatos?.length && !a.partes?.length && !a.colores?.length && c.de === undefined) fallar("Sin id, di qué globos (formatos, partes o colores); para recolorear toda la escena usa recolorear_escena.");
  const nodos = a.id ? [escena.nodos.find((n) => n.id === a.id) ?? fallar(`No hay ninguna pieza con id «${a.id}». Ids: ${escena.nodos.map((n) => n.id).join(", ")}.`)] : escena.nodos;
  const notas: string[] = [];
  const hechas: string[] = [], omitidas: string[] = [], fallidas: string[] = [];
  const editadas: PiezaEditada[] = [];
  for (const nodo of nodos) {
    const nombre = `«${nodo.nombre}» (${nodo.id})`;
    if (nodo.pieza.tipo === "escenografia") { if (a.id) fallar(`${nombre} es escenografía: no tiene globos.`); continue; }
    try {
      let resultado: ResultadoEdicion;
      if (nodo.pieza.tipo === "metalizado") {
        if (!a.id) continue;
        const pedido = c.color ?? c.a ?? fallar(`${nombre} es un globo metalizado (foil): solo se le cambia el color.`);
        const ref = referenciaDePedido(pedido) ?? fallar(`No encontré el color «${pedido}» en la tabla Sempertex.`);
        resultado = editarSeleccion(nodo.pieza, {}, { tipo: "color", codigo: ref.codigo });
      } else {
        const plan = planDe(nodo, a, notas);
        if ("omitir" in plan) { if (a.id) fallar(`${nombre} ${plan.omitir}.`); omitidas.push(nodo.id); continue; }
        resultado = editarSeleccion(nodo.pieza, plan.selector, plan.cambio, plan.etiquetado);
      }
      editadas.push({ nodo, nueva: resultado.pieza });
      hechas.push(`${nombre}: ${textoResultado(resultado)}${resultado.notas.length ? ` (${resultado.notas.join("; ")})` : ""}`);
    } catch (error) {
      if (a.id || !(error instanceof ErrorHerramienta)) throw error;
      fallidas.push(`${nombre}: ${error.message}`);
    }
  }
  if (!editadas.length) {
    if (fallidas.length) fallar(`No cambié nada. ${fallidas.join(" | ")}`);
    fallar(`Ningún globo de la escena es de esa selección (revisa formatos, partes y colores con ver_escena).`);
  }
  const porId = new Map(editadas.map((e) => [e.nodo.id, e.nueva]));
  const nueva: Escena = { ...escena, nodos: escena.nodos.map((n) => (porId.has(n.id) ? { ...n, pieza: porId.get(n.id)! } : n)) };
  const resumen = [
    `Edité ${editadas.length} pieza${editadas.length === 1 ? "" : "s"}: ${hechas.join(" | ")}`,
    fallidas.length ? `NO pude en: ${fallidas.join(" | ")}` : "",
    !a.id && omitidas.length ? `Sin globos de esa selección (no se tocaron): ${omitidas.join(", ")}` : "",
    notas.length ? `Notas: ${[...new Set(notas)].join("; ")}` : "",
  ].filter(Boolean).join(". ");
  return { escena: nueva, resumen, editadas };
}
