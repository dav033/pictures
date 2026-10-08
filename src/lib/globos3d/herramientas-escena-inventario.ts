import { z } from "zod";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { codigosDePedido, fallar, nombreColor } from "./herramientas-escena-colores";
import { NOMBRE_TIPO } from "./herramientas-escena-estructuras";
import { interpretarTerminos, normalizarTexto, type Interpretacion } from "./glosario-taller";
import { SIN_PARTE, coincide, inventarioDe, type LineaInventario, type SelectorGlobos } from "./partes-globos";
import type { Colocacion, Escena, NodoEscena } from "./escena";
import type { Pieza, PiezaArmada } from "./piezas";

/**
 * **Ver por dentro** (IA de escena): lo que la IA no veía de cada pieza —de qué formatos, colores y partes está hecha—,
 * calculado del armado con `inventarioDe` (`partes-globos.ts`):
 * - `contenidoCompacto`: una cola corta para cada línea de `ver_escena` («24 LOL-660 032 verde selva [ramas]»);
 * - `ver_pieza`: el árbol completo parte → formato → color → cantidad, el follaje, lo que va encima o colgado de ella
 *   y sus productos de la tienda;
 * - `buscar_en_escena`: qué piezas y qué partes tienen lo que nombró el usuario («los link-o-loon de las ramas» →
 *   «Ramas» (id ramas), 24 LOL-660), traducido con el glosario (`glosario-taller.ts`), ordenado por cuánto encaja y
 *   con el selector listo para editar SOLO eso.
 * Puro y sin red; quien llama pasa cómo armar una pieza (`armar`, con su caché).
 */

export type Armador = (p: Pieza) => PiezaArmada;

const IdSchema = z.string().min(1).max(80);

export const ESQUEMA_VER_PIEZA = z.object({ id: IdSchema.describe("id de la pieza (lo dan ver_escena y buscar_en_escena)") });

export const ESQUEMA_BUSCAR_EN_ESCENA = z.object({
  texto: z.string().max(200).optional().describe("lo que nombró el usuario, tal cual («los link-o-loon de las ramas», «los globos de 24 azules», «los tubitos del moño», «las hojas de la palmera»)"),
  formatos: z.array(z.string().min(1).max(30)).max(8).optional().describe("formatos exactos o familia: R-24, LOL-660, LOL-*, T-* (o como lo dijo: «link-o-loon», «de 24»)"),
  partes: z.array(z.string().min(1).max(40)).max(8).optional().describe("partes: ramas, hojas, tronco, pétalos, centro, corona, lazos…"),
  colores: z.array(z.string().min(1).max(60)).max(6).optional().describe("colores que deben tener esos globos (nombre o código); el color NUEVO no va aquí"),
  ids: z.array(IdSchema).max(80).optional().describe("buscar solo en estas piezas"),
  limite: z.number().int().min(1).max(20).optional().describe("cuántas piezas como máximo (8 por defecto)"),
});
export type ArgumentosBuscar = z.infer<typeof ESQUEMA_BUSCAR_EN_ESCENA>;

export const DESCRIPCION_VER_PIEZA = "Muestra por dentro UNA pieza: de qué partes está hecha (ramas, hojas, pétalos, tronco…), con cada formato (R-24, LOL-660, T-260…), color y cantidad; el follaje; lo que va encima o colgado de ella (con ids) y sus productos. No cambia nada. Úsala antes de editar una parte, un formato o un tamaño de esa pieza.";
export const DESCRIPCION_BUSCAR_EN_ESCENA = "Busca en la escena qué piezas y qué partes tienen lo que nombró el usuario («los link-o-loon», «los de 24», «los tubitos del moño», «las hojas de la palmera», «los R-5 dorados»): entiende el vocabulario del taller (link-o-loon/lol/eslabón = LOL, tubito/260 = T, «de 24» = R-24, grandes/medianos/chicos, partes) y devuelve las piezas ordenadas por cuánto encajan, con su id, la parte, cuántos globos y el selector para editar SOLO eso. No cambia nada. Úsala ANTES de editar por formato, tamaño o parte.";

const r0 = (n: number) => Math.round(n);

/** El color en corto: «032 verde selva». */
const colorCorto = (codigo: string) => { const r = referenciaPorCodigo(codigo); return r ? `${codigo} ${r.nombre.toLowerCase()}` : codigo; };

function armarSeguro(p: Pieza, armar: Armador): PiezaArmada | null {
  try { return armar(p); } catch { return null; }
}

type Grupo = { formatoId: string; codigo: string; cantidad: number; partes: string[] };

/** Las líneas del inventario por formato × color (sumando las partes), de la más numerosa a la menos. */
function porFormatoYColor(lineas: readonly LineaInventario[]): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const l of lineas) {
    const clave = `${l.formatoId}|${l.codigo}`;
    const g = mapa.get(clave) ?? { formatoId: l.formatoId, codigo: l.codigo, cantidad: 0, partes: [] };
    g.cantidad += l.cantidad;
    if (l.parte !== SIN_PARTE && !g.partes.includes(l.parte)) g.partes.push(l.parte);
    mapa.set(clave, g);
  }
  return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad);
}

const textoGrupo = (g: Grupo) => `${g.cantidad} ${g.formatoId} ${colorCorto(g.codigo)}${g.partes.length ? ` [${g.partes.slice(0, 3).join(", ")}${g.partes.length > 3 ? "…" : ""}]` : ""}`;

/** Grupos en texto hasta `presupuesto` caracteres; lo que no cabe se cuenta («+3 más»). */
function enPresupuesto(grupos: readonly Grupo[], presupuesto: number): string {
  const partes: string[] = [];
  let largo = 0;
  for (const [i, g] of grupos.entries()) {
    const t = textoGrupo(g);
    if (i > 0 && largo + t.length + 3 > presupuesto) { partes.push(`+${grupos.length - i} más (ver_pieza)`); break; }
    partes.push(t);
    largo += t.length + 3;
  }
  return partes.join(" · ");
}

/**
 * La cola de una línea de `ver_escena`: de qué está hecha la pieza. En las orgánicas (que ya cuentan sus tamaños y
 * colores) solo sus partes; en las demás, formato × color con sus partes, dentro de `presupuesto` caracteres.
 */
export function contenidoCompacto(p: Pieza, armar: Armador, presupuesto = 170): string {
  if (p.tipo === "escenografia" || p.tipo === "metalizado") return "";
  const armada = armarSeguro(p, armar);
  if (!armada) return "";
  const inv = inventarioDe(armada);
  if (!inv.length) return "";
  if (p.tipo === "organico" || p.tipo === "arco_organico") {
    const partes = new Map<string, number>();
    for (const l of inv) if (l.parte !== SIN_PARTE) partes.set(l.parte, (partes.get(l.parte) ?? 0) + l.cantidad);
    return partes.size > 1 ? ` · partes: ${[...partes.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}` : "";
  }
  return ` · lleva: ${enPresupuesto(porFormatoYColor(inv), presupuesto)}`;
}

function nodoDe(escena: Escena, id: string): NodoEscena {
  return escena.nodos.find((n) => n.id === id) ?? fallar(`No hay ninguna pieza con id «${id}». Ids: ${escena.nodos.map((n) => n.id).join(", ") || "(la sala está vacía)"}.`);
}

function dondeCorto(c: Colocacion): string {
  switch (c.en) {
    case "piso": return `en el piso (x=${r0(c.xCm)}, z=${r0(c.zCm)})`;
    case "pared": return `en la pared ${c.pared}`;
    case "techo": return "colgada del techo";
    case "libre": return "suelta en el espacio";
    case "ancla": return `colgada de «${c.padreId}»`;
    case "sobre": return `encima de «${c.padreId}»`;
  }
}

// ----------------------------------------------------------------------------------------------------------
// ver_pieza
// ----------------------------------------------------------------------------------------------------------

/** Una pieza por dentro: partes → formatos → colores, follaje, lo que lleva encima o colgado y productos. */
export function verPieza(escena: Escena, id: string, armar: Armador): string {
  const n = nodoDe(escena, id);
  const lineas = [`«${n.nombre}» (id ${n.id}) · ${n.pieza.tipo} (${NOMBRE_TIPO[n.pieza.tipo]}) · ${dondeCorto(n.colocacion)}`];
  const armada = armarSeguro(n.pieza, armar);
  if (!armada) return [...lineas, "No se pudo armar la pieza para contar sus globos."].join("\n");
  const inv = inventarioDe(armada);
  const globos = inv.filter((l) => !l.tubito).reduce((s, l) => s + l.cantidad, 0);
  const tubitos = inv.filter((l) => l.tubito).reduce((s, l) => s + l.cantidad, 0);
  const partes = [...new Set(inv.map((l) => l.parte))];
  if (!inv.length) lineas.push("No lleva globos de látex.");
  else {
    lineas.push(`${globos} globos${tubitos ? ` y ${tubitos} tubitos/eslabones largos (uno por tramo)` : ""} en ${partes.length} parte${partes.length === 1 ? "" : "s"}${partes.length === 1 && partes[0] === SIN_PARTE ? " (la pieza aún no dice sus partes: «general» es toda)" : ""}:`);
    for (const parte of partes.slice(0, 30)) {
      const deParte = inv.filter((l) => l.parte === parte);
      const formatos = [...new Set(deParte.map((l) => l.formatoId))].map((f) => {
        const deFormato = deParte.filter((l) => l.formatoId === f);
        const total = deFormato.reduce((s, l) => s + l.cantidad, 0);
        return `${f} ×${total} (${deFormato.map((l) => `${nombreColor(l.codigo)} ×${l.cantidad}`).join(", ")})`;
      });
      lineas.push(`- ${parte}: ${formatos.join("; ")}`);
    }
    if (partes.length > 30) lineas.push(`- … y ${partes.length - 30} partes más`);
  }
  if (armada.flores.length) {
    const flores = new Map<string, number>();
    for (const f of armada.flores) flores.set(f.tipo, (flores.get(f.tipo) ?? 0) + 1);
    lineas.push(`Follaje de tela (no son globos): ${[...flores.entries()].map(([t, c]) => `${c} ${t}`).join(", ")}.`);
  }
  const productos = [...(armada.productos ?? []), ...(n.pieza.tipo === "escenografia" ? n.pieza.productos ?? [] : [])];
  if (productos.length) lineas.push(`Productos de la tienda: ${productos.map((p) => `${p.cantidad} × ${p.nombre}${p.variante ? ` (${p.variante})` : ""}`).join("; ")}.`);
  const hijos = escena.nodos.filter((h) => (h.colocacion.en === "ancla" || h.colocacion.en === "sobre") && h.colocacion.padreId === n.id);
  if (hijos.length) {
    lineas.push(`Encima o colgado de ella (${hijos.length}; son piezas aparte, con su id):`);
    for (const h of hijos.slice(0, 20)) lineas.push(`- «${h.nombre}» (id ${h.id}, ${h.colocacion.en === "sobre" ? "encima" : "en sus anclas"})${contenidoCompacto(h.pieza, armar, 120)}`);
  }
  const c = n.colocacion;
  if (c.en === "ancla" || c.en === "sobre") lineas.push(`Ella misma va ${c.en === "sobre" ? "encima" : "colgada"} de «${c.padreId}».`);
  const parteEj = partes.find((p) => p !== SIN_PARTE), formatoEj = inv[0]?.formatoId;
  if (formatoEj) lineas.push(`Para editar solo una parte o un formato: selector ${JSON.stringify({ ...(parteEj ? { partes: [parteEj] } : {}), formatos: [formatoEj] })} con el id ${n.id} (nunca la pieza entera si pidieron una parte, un formato o un tamaño).`);
  return lineas.join("\n");
}

// ----------------------------------------------------------------------------------------------------------
// buscar_en_escena
// ----------------------------------------------------------------------------------------------------------

const sinPlural = (s: string) => s.replace(/(es|s)$/, "");
const segmentoIgual = (a: string, b: string) => a === b || sinPlural(a) === sinPlural(b);

/** ¿La etiqueta de parte («copa/frutas») es la parte nombrada («frutas», «copa», «copa/frutas»)? */
function parteCoincide(etiqueta: string, canon: string, cache: Map<string, string[]>): boolean {
  if (etiqueta === SIN_PARTE) return false;
  const e = etiqueta.split("/"), c = canon.split("/");
  for (let i = 0; i + c.length <= e.length; i++) if (c.every((s, k) => segmentoIgual(e[i + k]!, s))) return true;
  // La etiqueta dicha con otra palabra del glosario («botones» es el centro).
  let partes = cache.get(etiqueta);
  if (!partes) { partes = interpretarTerminos(etiqueta.replace(/[/_]/g, " ")).partes; cache.set(etiqueta, partes); }
  return partes.includes(canon);
}

type Criterios = { formatos: string[]; partes: string[]; colores: string[]; tipos: string[]; palabras: string[] };

type Evaluacion = {
  nodo: NodoEscena; puntaje: number; completa: boolean; parteEnNombre: string[]; partesEtiqueta: string[]; tipoOk: boolean; palabras: string[];
  lineas: LineaInventario[]; cantidad: number; sinEtiquetas: boolean; formatosSinParte: number; colorOk: boolean; selector: SelectorGlobos | null;
};

function evaluar(n: NodoEscena, k: Criterios, inv: readonly LineaInventario[], conColores: boolean, cache: Map<string, string[]>): Evaluacion {
  const nombre = `${n.nombre} ${n.id}`;
  const enNombre = interpretarTerminos(nombre);
  const tokensNombre = normalizarTexto(nombre).split(" ");
  // Una parte nombrada se busca en las etiquetas de los globos; si la pieza no la tiene pero SE LLAMA así («Ramas»), es toda la pieza.
  const partesEtiqueta = k.partes.filter((p) => inv.some((l) => parteCoincide(l.parte, p, cache)));
  const parteEnNombre = k.partes.filter((p) => !partesEtiqueta.includes(p) && (enNombre.partes.includes(p) || tokensNombre.some((t) => segmentoIgual(t, p))));
  const tipoOk = k.tipos.includes(n.pieza.tipo) || k.tipos.some((t) => enNombre.tipos.includes(t as Pieza["tipo"]));
  const palabras = k.palabras.filter((w) => tokensNombre.some((t) => t === w || (w.length >= 4 && t.length >= 4 && (t.startsWith(w) || w.startsWith(t)))));
  const partesFiltro = k.partes.filter((p) => !parteEnNombre.includes(p));
  const colores = conColores ? k.colores : [];
  const deFormato = (l: LineaInventario) => !k.formatos.length || coincide(l, { formatos: k.formatos });
  let lineas = inv.filter((l) => deFormato(l) && (!partesFiltro.length || partesFiltro.some((p) => parteCoincide(l.parte, p, cache))) && (!colores.length || colores.includes(l.codigo)));
  // Varias partes nombradas («la base del tronco», «las frutas de la copa»): si una etiqueta las tiene todas, es esa.
  if (partesFiltro.length > 1) { const todas = lineas.filter((l) => partesFiltro.every((p) => parteCoincide(l.parte, p, cache))); if (todas.length) lineas = todas; }
  const cantidad = lineas.reduce((s, l) => s + l.cantidad, 0);
  const deGlobos = k.formatos.length > 0 || k.partes.length > 0 || colores.length > 0;
  const completa = (deGlobos ? cantidad > 0 : tipoOk || palabras.length > 0 || parteEnNombre.length > 0) && (!k.tipos.length || tipoOk);
  const sinEtiquetas = inv.length > 0 && inv.every((l) => l.parte === SIN_PARTE);
  const colorOk = !colores.length || inv.some((l) => colores.includes(l.codigo));
  const formatosSinParte = inv.filter((l) => deFormato(l) && (!colores.length || colores.includes(l.codigo))).reduce((s, l) => s + l.cantidad, 0);
  const selector: SelectorGlobos | null = deGlobos && cantidad > 0 ? {
    ...(k.formatos.length ? { formatos: [...new Set(lineas.map((l) => l.formatoId))] } : {}),
    ...(partesFiltro.length ? { partes: [...new Set(lineas.map((l) => l.parte))] } : {}),
    ...(colores.length ? { colores: [...new Set(lineas.map((l) => l.codigo))] } : {}),
  } : null;
  const puntaje = (completa ? 1000 : 0) + parteEnNombre.length * 200 + (tipoOk ? 100 : 0) + palabras.length * 60 + (deGlobos ? Math.min(cantidad, 99) : 0) + (formatosSinParte && k.formatos.length ? 10 : 0);
  return { nodo: n, puntaje, completa, parteEnNombre, partesEtiqueta, tipoOk, palabras, lineas, cantidad, sinEtiquetas, formatosSinParte, colorOk, selector };
}

/** Los formatos pedidos por argumento: exactos o familia tal cual; si no, por el glosario («link-o-loon» → LOL-*). */
function formatosDeArgumento(lista: readonly string[]): string[] {
  return lista.flatMap((f) => (/^(R|LOL|T|C)-(\d+|\*)$/i.test(f.trim()) ? [f.trim().toUpperCase()] : interpretarTerminos(f).formatos));
}

function textoCriterios(k: Criterios, i: Interpretacion | null): string {
  const partes = [
    k.formatos.length && `formatos ${k.formatos.join(", ")}`, k.partes.length && `partes ${k.partes.join(", ")}`,
    k.colores.length && `colores ${k.colores.map(colorCorto).join(", ")}`, k.tipos.length && `piezas de tipo ${k.tipos.join("/")}`,
    k.palabras.length && `nombre con ${k.palabras.map((p) => `«${p}»`).join(", ")}`,
  ].filter(Boolean);
  const destino = i?.coloresDestino.length ? ` El color nuevo (${i.coloresDestino.map((c) => `«${c.pedido}»`).join(", ")}) no filtra: es el que se pone después.` : "";
  return `Busqué ${partes.join(" · ") || "(nada reconocible)"}.${destino}`;
}

function lineaHallazgo(e: Evaluacion, i: number): string {
  const n = e.nodo;
  const porNombre = e.parteEnNombre.length ? ` — «${e.parteEnNombre.join(", ")}» es la pieza entera (por su nombre)` : "";
  const contenido = e.lineas.length ? ` · ${enPresupuesto(porFormatoYColor(e.lineas), 220)}` : "";
  const selector = e.selector ? ` · selector: ${JSON.stringify(e.selector)}` : " · la pieza entera";
  return `${i + 1}. «${n.nombre}» (id ${n.id}) · ${NOMBRE_TIPO[n.pieza.tipo]}${porNombre}${contenido}${selector}`;
}

/** Por qué una pieza encaja solo en parte: lo que sí tiene y lo que le falta. */
function motivoParcial(e: Evaluacion, k: Criterios): string {
  const si: string[] = [], no: string[] = [];
  if (k.formatos.length) (e.formatosSinParte ? si : no).push(`${e.formatosSinParte ? "tiene" : "no tiene"} ${k.formatos.join("/")}${e.formatosSinParte ? ` ×${e.formatosSinParte}` : ""}`);
  if (e.parteEnNombre.length) si.push(`se llama «${e.parteEnNombre.join(", ")}»`);
  if (e.partesEtiqueta.length) si.push(`tiene la parte ${e.partesEtiqueta.join(", ")}`);
  const faltan = k.partes.filter((p) => !e.parteEnNombre.includes(p) && !e.partesEtiqueta.includes(p));
  if (faltan.length) no.push(e.sinEtiquetas ? `aún no dice sus partes (no se sabe si tiene «${faltan.join(", ")}»)` : `no tiene la parte «${faltan.join(", ")}»`);
  if (k.tipos.length) (e.tipoOk ? si : no).push(e.tipoOk ? "es de ese tipo" : "no es de ese tipo");
  if (!e.colorOk) no.push("no tiene esos colores");
  if (e.palabras.length) si.push(`su nombre dice ${e.palabras.join(", ")}`);
  if (k.formatos.length && e.formatosSinParte && !faltan.length && e.cantidad === 0) no.push("no en esa combinación");
  return `- «${e.nodo.nombre}» (id ${e.nodo.id}): ${si.join(", ") || "—"}${no.length ? `; pero ${no.join(", ")}` : ""}`;
}

/** Qué piezas y partes tienen lo pedido, ordenadas, con ids y selector. */
export function buscarEnEscena(escena: Escena, a: ArgumentosBuscar, armar: Armador): string {
  const interp = a.texto?.trim() ? interpretarTerminos(a.texto) : null;
  const colores = [...(interp?.colores.flatMap((c) => c.codigos) ?? []), ...(a.colores ?? []).flatMap((c) => { const x = codigosDePedido(c); return x.length ? x : fallar(`No encontré el color «${c}» en la tabla Sempertex.`); })];
  const k: Criterios = {
    formatos: [...new Set([...(interp?.formatos ?? []), ...formatosDeArgumento(a.formatos ?? [])])],
    partes: [...new Set([...(interp?.partes ?? []), ...(a.partes ?? []).flatMap((p) => { const x = interpretarTerminos(p).partes; return x.length ? x : [normalizarTexto(p).replace(/ /g, "/")]; })])],
    colores: [...new Set(colores)],
    tipos: [...new Set(interp?.tipos ?? [])],
    palabras: interp?.resto ?? [],
  };
  if (!k.formatos.length && !k.partes.length && !k.colores.length && !k.tipos.length && !k.palabras.length) {
    fallar("No entendí qué buscar: pasa en texto lo que nombró el usuario («los link-o-loon de las ramas») o formatos, partes o colores.");
  }
  const nodos = a.ids?.length ? a.ids.map((id) => nodoDe(escena, id)) : escena.nodos;
  const inventarios = new Map(nodos.map((n) => { const armada = armarSeguro(n.pieza, armar); return [n.id, armada ? inventarioDe(armada) : []]; }));
  const cache = new Map<string, string[]>();
  const evaluarTodas = (conColores: boolean) => nodos.map((n) => evaluar(n, k, inventarios.get(n.id) ?? [], conColores, cache)).sort((x, y) => y.puntaje - x.puntaje);
  let evaluadas = evaluarTodas(true);
  const notas = interp ? interp.notas.slice(0, 4) : [];
  if (k.colores.length && !evaluadas.some((e) => e.completa)) {
    const sinColor = evaluarTodas(false);
    if (sinColor.some((e) => e.completa)) { evaluadas = sinColor; notas.push("ninguna pieza tiene esos colores ahí: lo busqué sin el color (quizá es el color nuevo)"); }
  }
  const limite = a.limite ?? 8;
  const completas = evaluadas.filter((e) => e.completa).slice(0, limite);
  const parciales = evaluadas.filter((e) => !e.completa && e.puntaje > 0).slice(0, 4);
  const lineas = [textoCriterios(k, interp)];
  if (notas.length) lineas.push(`Glosario: ${notas.join("; ")}.`);
  if (completas.length) {
    lineas.push(`Lo encontré en ${completas.length} pieza${completas.length === 1 ? "" : "s"} (de la que más encaja a la que menos):`);
    completas.forEach((e, i) => lineas.push(lineaHallazgo(e, i)));
  } else {
    lineas.push("No encontré eso en la escena.");
  }
  if (parciales.length) {
    lineas.push(`${completas.length ? "Encajan solo en parte (NO son lo que se nombró: no las toques salvo que lo pidan)" : "Lo más cercano"}:`);
    parciales.forEach((e) => lineas.push(motivoParcial(e, k)));
  }
  if (!completas.length) {
    const todos = porFormatoYColor([...inventarios.values()].flat());
    const formatos = [...new Set(todos.map((g) => g.formatoId))];
    const partes = [...new Set([...inventarios.values()].flat().map((l) => l.parte).filter((p) => p !== SIN_PARTE))];
    lineas.push(`En la escena hay formatos ${formatos.join(", ") || "—"}${partes.length ? ` y partes ${partes.slice(0, 20).join(", ")}` : ""}. Pregúntale al usuario cuál quiere decir si no es evidente.`);
  } else {
    lineas.push(`Ids: ${completas.map((e) => e.nodo.id).join(", ")}. Detalle: ver_pieza. Para editar, usa ese id con su selector (solo esos globos): nunca recolorees ni cambies la pieza entera si se nombró un formato, un tamaño o una parte.`);
  }
  return lineas.join("\n");
}
