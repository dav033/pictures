import { z } from "zod";
import { armarEscena, type Escena, type NodoEscena } from "./escena";
import type { PiezaArmada } from "./piezas";
import { coincide, contar, inventarioDe, type SelectorGlobos } from "./partes-globos";
import { codigosDePedido, fallar, nombreColor, plegar } from "./herramientas-escena-colores";
import { NOMBRE_TIPO } from "./herramientas-escena-estructuras";

/**
 * **Grupos de piezas** para la IA de la escena (2026-10-08): lo que el usuario nombra en plural o por su sitio
 * («las dos columnas», «todas las guirnaldas», «la columna izquierda», «las flores de la columna izquierda») se
 * resuelve aquí a ids, sin modelo: por clase de oficio (tipo + nombre), lado (x del centro de la sala), y padre
 * (lo que cuelga de o va sobre otra pieza). `seleccionar_grupo` lo devuelve para que la IA actúe sobre esos ids;
 * `contar_globos` cuenta globos de la escena por formato/parte/color (selector de `partes-globos.ts`).
 *
 * También el tipo `HerramientaExtra` (herramientas registradas fuera del archivo grande, ver herramientas-escena-extra.ts)
 * y lo que comparten las de disposición: `idsDelPedido`, `xDeNodo`.
 */

/** Una herramienta de la IA de escena definida fuera de herramientas-escena.ts (mismo contrato: pura, sin red). */
export type HerramientaExtra = {
  esquema: z.ZodType;
  descripcion: string;
  /** Aplica la llamada; lanza `ErrorHerramienta` (con `fallar`) o ZodError si no vale. */
  aplicar: (escena: Escena, argumentos: unknown) => { escena: Escena; resumen: string; consulta?: boolean };
};

// ----------------------------------------------------------------------------------------------------------
// Clases de oficio y lado
// ----------------------------------------------------------------------------------------------------------

/** Plural → singular de las palabras de oficio («flores» → «flor», «columnas» → «columna»). */
export function singular(palabra: string): string {
  const p = plegar(palabra);
  if (p.length > 4 && p.endsWith("es") && /[rlndzj]$/.test(p.slice(0, -2))) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith("s")) return p.slice(0, -1);
  return p;
}

/** Las clases de una pieza: lo que dice su tipo y su nombre («Columna orgánica izquierda» → columna, organica…). */
export function clasesDe(n: NodoEscena): Set<string> {
  const p = n.pieza;
  const base: Record<string, readonly string[]> = {
    columna: ["columna", "clasica", "estructura"], arco: ["arco", "clasico", "estructura"], arco_organico: ["arco", "organico", "estructura"],
    guirnalda: ["guirnalda", "clasica", "estructura"], pared_malla: ["pared", "muro", "malla", "estructura"], pared_trenzas: ["pared", "muro", "trenza", "estructura"],
    mural: ["pared", "muro", "mural", "estructura"], organico: ["organico", "estructura"], decoracion: ["decoracion", "adorno"], globo: ["globo"],
    metalizado: ["globo", "metalizado", "foil"], forma: ["forma", "figura", "estructura"], letras: ["letra", "estructura"], techo: ["techo"],
    arbol_globos: ["arbol", "palmera", "estructura"], escenografia: ["escenografia", "utileria"], modulo: ["modulo"],
  };
  const clases = new Set(base[p.tipo] ?? []);
  for (const palabra of plegar(n.nombre).split(/[^a-z0-9]+/).filter((x) => x.length > 2)) clases.add(singular(palabra));
  if (p.tipo === "decoracion") {
    const d = plegar(n.nombre);
    if (/flor|margarita/.test(d)) clases.add("flor");
    if (/estrella/.test(d)) clases.add("estrella");
    if (/mono|lazo/.test(d)) clases.add("mono");
  }
  // «la palmera»: un árbol de globos con copa de palmera.
  if (p.tipo === "arbol_globos" && p.arbol.copa.tipo === "palmera") clases.add("palmera");
  return clases;
}

/** x del centro de la pieza en la sala (cm): la de su colocación, o la de su padre si cuelga o va sobre otra. */
export function xDeNodo(escena: Escena, n: NodoEscena, vistos = new Set<string>()): number {
  const c = n.colocacion;
  if (c.en === "piso" || c.en === "techo" || c.en === "libre") return c.xCm;
  if (c.en === "pared") return c.pared === "fondo" ? c.aLoLargoCm : c.pared === "izquierda" ? -escena.sala.anchoCm / 2 : escena.sala.anchoCm / 2;
  if (vistos.has(n.id)) return 0;
  vistos.add(n.id);
  const padre = escena.nodos.find((x) => x.id === c.padreId);
  const base = padre ? xDeNodo(escena, padre, vistos) : 0;
  return c.en === "sobre" ? base + c.puntoCm.x : base;
}

const LADOS: Readonly<Record<string, "izquierda" | "derecha" | "centro">> = {
  izquierda: "izquierda", izquierdo: "izquierda", izq: "izquierda", izquierdas: "izquierda", izquierdos: "izquierda",
  derecha: "derecha", derecho: "derecha", der: "derecha", derechas: "derecha", derechos: "derecha",
  centro: "centro", central: "centro", centrales: "centro", medio: "centro", centrada: "centro", centrado: "centro",
};
const NUMEROS: Readonly<Record<string, number>> = { dos: 2, ambas: 2, ambos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6 };
const VACIAS = new Set(["la", "las", "el", "los", "lo", "un", "una", "unos", "unas", "de", "del", "a", "al", "y", "e", "que", "esta", "estas", "este", "estos", "esa", "esas", "ese", "esos", "todo", "toda", "todas", "todos", "pieza", "piezas", "lado", "lados", "en", "sobre", "con", "mi", "mis"]);
const TODO = new Set(["todo", "toda", "todas", "todos"]);

/** Sitios de la sala: «las flores del techo», «lo del piso» (si ninguna pieza se llama así, filtran por colocación). */
const LUGARES: Readonly<Record<string, "techo" | "piso" | "pared">> = { techo: "techo", piso: "piso", suelo: "piso", pared: "pared" };

type Termino = { palabras: string[]; lado: "izquierda" | "derecha" | "centro" | null; lugar: "techo" | "piso" | "pared" | null; cantidad: number | null; singularPedido: boolean; todo: boolean };

function termino(texto: string, escena: Escena): Termino {
  const tokens = plegar(texto).split(/[^a-z0-9]+/).filter(Boolean);
  let lado: Termino["lado"] = null, lugar: Termino["lugar"] = null, cantidad: number | null = null;
  const palabras: string[] = [];
  for (const t of tokens) {
    if (LADOS[t]) { lado = LADOS[t]!; continue; }
    if (NUMEROS[t] !== undefined) { cantidad = NUMEROS[t]!; continue; }
    if (VACIAS.has(t)) continue;
    const s = singular(t);
    if (LUGARES[s] && !escena.nodos.some((n) => clasesDe(n).has(s))) { lugar = LUGARES[s]!; continue; }
    palabras.push(s);
  }
  const singularPedido = /^(la|el|una|un|esta|este|esa|ese)\b/.test(plegar(texto).trim()) && cantidad === null;
  return { palabras, lado, lugar, cantidad, singularPedido, todo: tokens.some((t) => TODO.has(t)) };
}

/** Separa «las flores de la columna izquierda» en lo que se busca y el padre (si lo de la derecha nombra una pieza). */
function separarPadre(texto: string, escena: Escena): { hijo: string; padre: string | null } {
  const plano = plegar(texto);
  const m = plano.match(/^(.*?)\s+(?:de la|de las|del|de los|de|en la|en el|sobre la|sobre el|que (?:van|estan|cuelgan) (?:en|sobre|de) (?:la|el))\s+(.+)$/);
  if (!m) return { hijo: texto, padre: null };
  const derecha = termino(m[2]!, escena);
  const nombraPieza = derecha.palabras.some((p) => escena.nodos.some((n) => clasesDe(n).has(p) || n.id === p));
  return nombraPieza && termino(m[1]!, escena).palabras.length ? { hijo: m[1]!, padre: m[2]! } : { hijo: texto, padre: null };
}

export type GrupoResuelto = { ids: string[]; notas: string[] };

/** Filtra por lado: con «la columna izquierda» (singular) entre varias, la de más a la izquierda. */
function porLado(escena: Escena, nodos: NodoEscena[], t: Termino, notas: string[]): NodoEscena[] {
  if (!t.lado || !nodos.length) return nodos;
  const x = (n: NodoEscena) => xDeNodo(escena, n);
  const orden = [...nodos].sort((a, b) => (t.lado === "izquierda" ? x(a) - x(b) : t.lado === "derecha" ? x(b) - x(a) : Math.abs(x(a)) - Math.abs(x(b))));
  const enLado = orden.filter((n) => (t.lado === "izquierda" ? x(n) < -15 : t.lado === "derecha" ? x(n) > 15 : Math.abs(x(n)) <= 15));
  if (!enLado.length) {
    notas.push(`ninguna está a la ${t.lado === "centro" ? "mitad" : t.lado}: tomé la más cercana a ese lado (${orden[0]!.id}, x=${Math.round(x(orden[0]!))})`);
    return [orden[0]!];
  }
  return t.singularPedido ? [enLado[0]!] : enLado;
}

function coincidePalabras(n: NodoEscena, palabras: readonly string[]): boolean {
  if (!palabras.length) return true;
  const clases = clasesDe(n);
  return palabras.every((p) => clases.has(p) || plegar(n.id) === p || NOMBRE_TIPO[n.pieza.tipo]?.includes(p));
}

/**
 * Resuelve un grupo dicho en palabras a ids de la escena. `tipo` (TipoPieza) y `lado` estructurados se suman al texto.
 * Sin coincidencias devuelve lista vacía con una nota (no lanza: la IA decide si pregunta).
 */
export function resolverGrupo(escena: Escena, pedido: { texto?: string; tipo?: string; lado?: "izquierda" | "derecha" | "centro"; padre?: string }): GrupoResuelto {
  const notas: string[] = [];
  const texto = pedido.texto?.trim() ?? "";
  const { hijo, padre } = pedido.padre ? { hijo: texto, padre: pedido.padre } : separarPadre(texto, escena);
  const t = termino(hijo, escena);
  if (pedido.lado) t.lado = pedido.lado;
  let candidatos = escena.nodos.filter((n) => (!pedido.tipo || n.pieza.tipo === pedido.tipo) && coincidePalabras(n, t.palabras) && (!t.lugar || n.colocacion.en === t.lugar));
  if (padre) {
    const padres = resolverGrupo(escena, { texto: padre });
    notas.push(...padres.notas);
    const ids = new Set(padres.ids);
    candidatos = candidatos.filter((n) => (n.colocacion.en === "ancla" || n.colocacion.en === "sobre") && ids.has(n.colocacion.padreId));
    if (!padres.ids.length) notas.push(`no encontré «${padre}»`);
  }
  // «la columna» sin más: si hay pieza del todo (sin decoraciones) que encaja, se prefieren las estructuras.
  if (!padre && t.palabras.length && !t.todo) {
    const estructuras = candidatos.filter((n) => n.colocacion.en !== "ancla" && n.colocacion.en !== "sobre");
    if (estructuras.length && estructuras.length < candidatos.length && !t.palabras.some((p) => ["flor", "decoracion", "estrella", "mono", "globo"].includes(p))) candidatos = estructuras;
  }
  const elegidos = porLado(escena, candidatos, t, notas);
  if (t.cantidad !== null && elegidos.length !== t.cantidad) notas.push(`se pidieron ${t.cantidad} y encajan ${elegidos.length}`);
  if (!elegidos.length) notas.push(`ninguna pieza encaja con «${texto || pedido.tipo || "?"}»`);
  return { ids: elegidos.map((n) => n.id), notas };
}

/** Los ids de un pedido: `ids` explícitos (deben existir) o `grupo` en palabras (al menos uno). */
export function idsDelPedido(escena: Escena, a: { ids?: readonly string[]; grupo?: string }, minimo = 1): GrupoResuelto {
  if (a.ids?.length) {
    for (const id of a.ids) if (!escena.nodos.some((n) => n.id === id)) fallar(`No hay ninguna pieza con id «${id}». Ids: ${escena.nodos.map((n) => n.id).join(", ")}.`);
    const ids = [...new Set(a.ids)];
    if (ids.length < minimo) fallar(`Hacen falta al menos ${minimo} piezas y se pasó ${ids.length}.`);
    return { ids, notas: [] };
  }
  if (!a.grupo) return fallar("Pasa ids o grupo (en palabras: «las dos columnas», «todas las guirnaldas»).");
  const r = resolverGrupo(escena, { texto: a.grupo });
  if (r.ids.length < minimo) fallar(`«${a.grupo}» encaja con ${r.ids.length} pieza${r.ids.length === 1 ? "" : "s"} y hacen falta al menos ${minimo}${r.notas.length ? ` (${r.notas.join("; ")})` : ""}. Mira los ids con ver_escena.`);
  return r;
}

export const nodoDe = (escena: Escena, id: string): NodoEscena =>
  escena.nodos.find((n) => n.id === id) ?? fallar(`No hay ninguna pieza con id «${id}». Ids: ${escena.nodos.map((n) => n.id).join(", ") || "(la sala está vacía)"}.`);

const lineaNodo = (escena: Escena, n: NodoEscena) => {
  const c = n.colocacion;
  const donde = c.en === "ancla" || c.en === "sobre" ? `${c.en === "ancla" ? "colgada de" : "sobre"} ${c.padreId}` : c.en;
  return `- ${n.id} · «${n.nombre}» · ${n.pieza.tipo} · x=${Math.round(xDeNodo(escena, n))} · ${donde}`;
};

// ----------------------------------------------------------------------------------------------------------
// contar_globos
// ----------------------------------------------------------------------------------------------------------

/** Formatos como los dice el usuario («r24», «R 24», «link-o-loon», «tubitos», «los R») → ids o familias del selector. */
export function formatoDePalabra(pedido: string): string {
  const p = plegar(pedido).replace(/\s+/g, "");
  if (/^(lol|link.?o.?loon|linkoloon|link|eslabon)/.test(p)) { const n = p.match(/(\d+)/)?.[1]; return n ? `LOL-${n}` : "LOL-*"; }
  if (/^(tubito|tubo|t-?\d|modelar|260|160|360)/.test(p)) { const n = p.match(/(\d{3})/)?.[1]; return n ? `T-${n}` : "T-*"; }
  if (/^(corazon|c-?\d)/.test(p)) { const n = p.match(/(\d+)/)?.[1]; return n ? `C-${n}` : "C-*"; }
  const r = p.match(/^r-?(\d+)$/) ?? p.match(/^(\d+)(?:"|pulgadas|pulg)?$/);
  if (r) return `R-${r[1]}`;
  if (p === "r" || p === "redondo" || p === "redondos") return "R-*";
  return pedido.trim().toUpperCase();
}

const CACHE_ARMADO = new Map<string, PiezaArmada>();
const recortarCache = () => { while (CACHE_ARMADO.size > 200) { const k = CACHE_ARMADO.keys().next().value; if (k === undefined) break; CACHE_ARMADO.delete(k); } };

const ContarSchema = z.object({
  ids: z.array(z.string().min(1).max(80)).max(80).optional().describe("las piezas a contar (por defecto, toda la escena)"),
  grupo: z.string().max(120).optional().describe("en vez de ids: el grupo en palabras («las columnas», «el arco», «las flores de la columna izquierda»)"),
  formatos: z.array(z.string().min(1).max(30)).max(8).optional().describe("solo estos formatos: «R-24», «R-5», «LOL-*» (link-o-loon), «T-*» (tubitos), «R-*»; acepta «r24», «link-o-loon», «tubitos»"),
  partes: z.array(z.string().min(1).max(40)).max(8).optional().describe("solo estas partes de la pieza («ramas», «copa», «pata/derecha», «base»; ver_pieza o el inventario las dicen)"),
  colores: z.array(z.string().min(1).max(60)).max(6).optional().describe("solo estos colores (código o nombre)"),
});

function contarGlobos(escena: Escena, argumentos: unknown) {
  const a = ContarSchema.parse(argumentos ?? {});
  const grupo = a.ids?.length || a.grupo ? idsDelPedido(escena, a) : { ids: escena.nodos.map((n) => n.id), notas: [] };
  const colores = a.colores?.map((c) => { const cs = codigosDePedido(c); return cs.length ? cs : fallar(`No encontré el color «${c}» en la tabla Sempertex.`); }).flat();
  const selector: SelectorGlobos = { formatos: a.formatos?.map(formatoDePalabra), partes: a.partes, colores };
  const armada = armarEscena(escena, CACHE_ARMADO);
  recortarCache();
  const lineas: string[] = [];
  let total = 0;
  for (const id of grupo.ids) {
    const hecho = armada.porNodo.find((n) => n.id === id);
    if (!hecho) continue;
    const cuantos = contar(hecho, selector);
    total += cuantos;
    if (!cuantos && grupo.ids.length > 6) continue;
    const porFormato = new Map<string, number>();
    for (const l of inventarioDe(hecho)) {
      if (!coincide(l, selector)) continue;
      porFormato.set(l.formatoId, (porFormato.get(l.formatoId) ?? 0) + l.cantidad);
    }
    const detalle = [...porFormato].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([f, c]) => `${f} ${c}`).join(", ");
    lineas.push(`- ${id}: ${cuantos}${detalle ? ` (${detalle})` : ""}${hecho.copias > 1 ? ` · ${hecho.copias} copias` : ""}`);
  }
  const filtro = [selector.formatos?.length ? `formatos ${selector.formatos.join("/")}` : "", a.partes?.length ? `partes ${a.partes.join("/")}` : "", colores?.length ? `colores ${[...new Set(colores)].slice(0, 4).map(nombreColor).join("/")}` : ""].filter(Boolean).join(", ");
  const notas = grupo.notas.length ? ` (${grupo.notas.join("; ")})` : "";
  return { escena, consulta: true, resumen: `Conteo${filtro ? ` de ${filtro}` : " de todos los globos y tubitos"} en ${grupo.ids.length} pieza${grupo.ids.length === 1 ? "" : "s"}: ${total} en total${notas}.\n${lineas.join("\n")}` };
}

// ----------------------------------------------------------------------------------------------------------
// seleccionar_grupo
// ----------------------------------------------------------------------------------------------------------

const GrupoSchema = z.object({
  texto: z.string().min(1).max(120).describe("el grupo como lo dijo el usuario: «las dos columnas», «todas las guirnaldas», «la columna izquierda», «las flores de la columna izquierda», «los arcos»"),
  tipo: z.string().max(30).optional().describe("además, solo de este tipo de pieza (columna, organico, decoracion, arco_organico…)"),
  lado: z.enum(["izquierda", "derecha", "centro"]).optional().describe("además, solo las de ese lado de la sala (visto desde el público)"),
});

function seleccionarGrupo(escena: Escena, argumentos: unknown) {
  const a = GrupoSchema.parse(argumentos ?? {});
  const r = resolverGrupo(escena, a);
  const nodos = r.ids.map((id) => nodoDe(escena, id));
  const notas = r.notas.length ? ` (${r.notas.join("; ")})` : "";
  return {
    escena, consulta: true,
    resumen: nodos.length
      ? `«${a.texto}» = ${nodos.length} pieza${nodos.length === 1 ? "" : "s"}: ids ${r.ids.join(", ")}${notas}.\n${nodos.map((n) => lineaNodo(escena, n)).join("\n")}`
      : `«${a.texto}» no encaja con ninguna pieza${notas}. Piezas: ${escena.nodos.map((n) => `${n.id} «${n.nombre}»`).join(", ") || "(sala vacía)"}.`,
  };
}

export const HERRAMIENTAS_GRUPOS: Readonly<Record<string, HerramientaExtra>> = {
  seleccionar_grupo: {
    esquema: GrupoSchema,
    descripcion: "Resuelve un grupo dicho en palabras a ids de piezas: «las dos columnas», «todas las guirnaldas», «la columna izquierda», «las flores de la columna izquierda» (por tipo, nombre, lado de la sala y de qué pieza cuelgan). No cambia nada; úsala antes de actuar sobre varias piezas o sobre una nombrada por su lado.",
    aplicar: seleccionarGrupo,
  },
  contar_globos: {
    esquema: ContarSchema,
    descripcion: "Cuenta los globos (y tubitos) de la escena, de unas piezas o de un grupo, filtrando por formato («R-24», «LOL-*» = link-o-loon, «T-*» = tubitos), parte («ramas», «copa») y color. No cambia nada. Para «¿cuántos R-24 tiene el arco?» o para comprobar antes/después.",
    aplicar: contarGlobos,
  },
};
