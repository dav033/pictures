/**
 * **Banco de evaluación de la IA de escena** (2026-10-08): tipos del banco (`fixtures/banco-escena-ia.json`), cómo se
 * arma la escena de partida de cada caso y cómo se comprueban sus efectos esperados. Lo usan:
 * - `scripts/test/test-banco-escena-ia.ts` (sin coste): aplica la secuencia IDEAL de herramientas de cada caso con
 *   `aplicarHerramienta` y comprueba los efectos → valida que las HERRAMIENTAS pueden hacer cada pedido;
 * - `scripts/exp/evaluar-escena-ia.ts` (de pago, con tope): corre la ruta real con Gemini y puntúa los mismos checks.
 * Puro y sin red.
 */
import { referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";
import { SALA_INICIAL, armarEscena, type Escena, type NodoEscena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { codigosDePedido, plegar } from "../../src/lib/globos3d/herramientas-escena-colores";
import { formatoDePalabra, xDeNodo } from "../../src/lib/globos3d/herramientas-escena-grupos";
import { coincide, inventarioDe, type SelectorGlobos } from "../../src/lib/globos3d/partes-globos";
import type { PiezaArmada } from "../../src/lib/globos3d/piezas";

export type Llamada = { herramienta: string; args: Record<string, unknown> };
export type Turno = { rol: "usuario" | "asistente"; texto: string };

export type Contexto = {
  /** Escena de partida (id de `ESCENAS_PREDEFINIDAS`); sin ella, la sala vacía. */
  preset?: string;
  /** Herramientas que se aplican antes para dejar la escena como estaba cuando el usuario escribió. */
  pasos?: Llamada[];
  /** Id de la pieza elegida en el editor (viaja como `seleccion`). */
  seleccion?: string;
  historial?: Turno[];
};

/** A qué piezas se refiere un check: ids, las nuevas, por tipo o nombre (en la escena de después). */
export type Objetivo = { ids?: string[]; nuevos?: boolean; tipo_pieza?: string[]; nombre?: string; todos?: boolean };
/** Selector de globos con colores por nombre o código y formatos como los dice el usuario. */
export type SelectorCaso = { formatos?: string[]; partes?: string[]; colores?: string[] };

export type Check =
  | { tipo: "piezas"; delta?: number; min?: number; max?: number }
  | { tipo: "sin_cambios" }
  | { tipo: "solo_cambian"; ids: string[] }
  | { tipo: "conteo"; en: Objetivo; selector?: SelectorCaso; compara: "aumenta_pct" | "disminuye_pct" | "igual" | "cero" | "min" | "max"; valor?: number }
  | { tipo: "domina"; en: Objetivo; mas: SelectorCaso; que: SelectorCaso }
  | { tipo: "solo_cambian_globos"; id: string; selector: SelectorCaso }
  | { tipo: "colores"; en: Objetivo; selector?: SelectorCaso; contienen?: string[][]; modo?: "todos" | "alguno"; excluye?: string[] }
  | { tipo: "medida"; en: Objetivo; eje: "alto" | "ancho"; min: number; max: number }
  | { tipo: "hay"; en: Objetivo; min?: number; max?: number }
  | { tipo: "posicion"; en: Objetivo; x?: [number, number]; z?: [number, number] }
  | { tipo: "misma"; en: Objetivo; campo: "z" | "altura" }
  | { tipo: "equidistantes"; en: Objetivo; tolerancia?: number }
  | { tipo: "simetricas"; a: string; b: Objetivo; eje_x?: number; forma?: boolean; tolerancia?: number }
  | { tipo: "padre"; en: Objetivo; padre: Objetivo; min: number }
  | { tipo: "pregunta"; opciones_min?: number }
  | { tipo: "respuesta_con_numeros" };

export type Caso = {
  id: string;
  origen: "real" | "estilo";
  texto: string;
  cobertura: string[];
  contexto: Contexto;
  checks: Check[];
  /** La secuencia ideal de herramientas (escrita a mano): lo que el modelo debería llamar. */
  esperado?: { herramientas: Llamada[] };
  /** Si las herramientas aún no pueden: por qué (es el pendiente). El arnés espera que falle y avisa si ya pasa. */
  backlog?: string;
  nota?: string;
};
export type Banco = { version: number; descripcion: string; casos: Caso[] };

// ----------------------------------------------------------------------------------------------------------
// Escena de partida
// ----------------------------------------------------------------------------------------------------------

export function escenaDeContexto(c: Contexto): Escena {
  let escena: Escena = c.preset ? escenaPredefinida(c.preset) : { sala: structuredClone(SALA_INICIAL), nodos: [] };
  for (const p of c.pasos ?? []) {
    const r = aplicarHerramienta(escena, p.herramienta, p.args);
    if (!r.ok) throw new Error(`contexto: ${p.herramienta} falló: ${r.error}`);
    escena = r.escena;
  }
  return escena;
}

// ----------------------------------------------------------------------------------------------------------
// Comprobaciones
// ----------------------------------------------------------------------------------------------------------

const CACHE = new Map<string, PiezaArmada>();
const armadas = new WeakMap<Escena, ReturnType<typeof armarEscena>>();
function armada(e: Escena) {
  let a = armadas.get(e);
  if (!a) { a = armarEscena(e, CACHE); armadas.set(e, a); }
  while (CACHE.size > 300) { const k = CACHE.keys().next().value; if (k === undefined) break; CACHE.delete(k); }
  return a;
}

function selectorDe(s: SelectorCaso | undefined): SelectorGlobos {
  if (!s) return {};
  return {
    formatos: s.formatos?.map(formatoDePalabra),
    partes: s.partes,
    colores: s.colores?.flatMap((c) => { const cs = codigosDePedido(c); if (!cs.length) throw new Error(`color «${c}» no está en la tabla`); return cs; }),
  };
}

export function objetivo(antes: Escena, despues: Escena, o: Objetivo): NodoEscena[] {
  const previos = new Set(antes.nodos.map((n) => n.id));
  const re = o.nombre ? new RegExp(o.nombre, "i") : null;
  return despues.nodos.filter((n) =>
    (!o.ids || o.ids.includes(n.id)) && (!o.nuevos || !previos.has(n.id)) && (!o.tipo_pieza || o.tipo_pieza.includes(n.pieza.tipo)) && (!re || re.test(plegar(n.nombre)) || re.test(n.nombre)));
}

/** Globos del selector en unas piezas de una escena (todas las copias, como se ven). */
function contarEn(e: Escena, ids: readonly string[], s: SelectorGlobos): number {
  const a = armada(e);
  return ids.reduce((suma, id) => {
    const n = a.porNodo.find((x) => x.id === id);
    return suma + (n ? n.globos.filter((g) => coincide(g, s)).length + n.tubos.filter((t) => !t.papel && coincide(t, s)).length : 0);
  }, 0);
}

function codigosEn(e: Escena, ids: readonly string[], s: SelectorGlobos): Set<string> {
  const a = armada(e), salida = new Set<string>();
  for (const id of ids) {
    const n = a.porNodo.find((x) => x.id === id);
    for (const g of n ? [...n.globos, ...n.tubos.filter((t) => !t.papel)] : []) if (coincide(g, s)) salida.add(g.codigo);
  }
  return salida;
}

const caja = (e: Escena, id: string) => armada(e).porNodo.find((n) => n.id === id)?.caja;
const nombreCodigo = (c: string) => plegar(referenciaPorCodigo(c)?.nombreCompleto ?? c);

/** Altura de colocación: borde de abajo en la pared, hilo en el techo o y suelta. */
const alturaDe = (n: NodoEscena) => { const c = n.colocacion; return c.en === "pared" ? c.alturaCm : c.en === "techo" ? c.cuelgaCm : c.en === "libre" ? c.yCm : 0; };
const zDe = (n: NodoEscena) => { const c = n.colocacion; return c.en === "piso" || c.en === "techo" || c.en === "libre" ? c.zCm : NaN; };

export type Extra = { pregunta?: { texto: string; opciones: string[] } | null; respuesta?: string; evaluacion?: boolean };

/** Comprueba un check; devuelve el motivo si falla, o null. */
export function comprobar(antes: Escena, despues: Escena, ch: Check, extra: Extra = {}): string | null {
  const ids = (o: Objetivo) => objetivo(antes, despues, o).map((n) => n.id);
  switch (ch.tipo) {
    case "piezas": {
      const d = despues.nodos.length - antes.nodos.length;
      if (ch.delta !== undefined && d !== ch.delta) return `piezas ${antes.nodos.length} → ${despues.nodos.length} (se esperaba ${ch.delta >= 0 ? "+" : ""}${ch.delta})`;
      if (ch.min !== undefined && despues.nodos.length < ch.min) return `quedan ${despues.nodos.length} piezas (mínimo ${ch.min})`;
      if (ch.max !== undefined && despues.nodos.length > ch.max) return `quedan ${despues.nodos.length} piezas (máximo ${ch.max})`;
      return null;
    }
    case "sin_cambios":
      return JSON.stringify(antes) === JSON.stringify(despues) ? null : "la escena cambió y no debía";
    case "solo_cambian": {
      for (const n of antes.nodos) {
        if (ch.ids.includes(n.id)) continue;
        const d = despues.nodos.find((x) => x.id === n.id);
        if (!d) return `se quitó ${n.id} sin pedirlo`;
        if (JSON.stringify(d) !== JSON.stringify(n)) return `cambió ${n.id} sin pedirlo`;
      }
      return null;
    }
    case "conteo": {
      const lista = ids(ch.en);
      if (!lista.length) return "conteo: ninguna pieza objetivo";
      const s = selectorDe(ch.selector);
      const a = contarEn(antes, lista, s), d = contarEn(despues, lista, s), v = ch.valor ?? 0;
      const ok = ch.compara === "aumenta_pct" ? d >= Math.max(a + 1, a * (1 + v / 100)) : ch.compara === "disminuye_pct" ? d <= a * (1 - v / 100) && d < a
        : ch.compara === "igual" ? a === d : ch.compara === "cero" ? d === 0 : ch.compara === "min" ? d >= v : d <= v;
      return ok ? null : `conteo ${JSON.stringify(ch.selector ?? {})} en ${lista.join(",")}: ${a} → ${d} (${ch.compara}${ch.valor !== undefined ? ` ${v}` : ""})`;
    }
    case "domina": {
      const lista = ids(ch.en);
      const m = contarEn(despues, lista, selectorDe(ch.mas)), q = contarEn(despues, lista, selectorDe(ch.que));
      return lista.length && m > q ? null : `${JSON.stringify(ch.mas)} = ${m} no supera a ${JSON.stringify(ch.que)} = ${q}`;
    }
    case "solo_cambian_globos": {
      const s = selectorDe(ch.selector);
      const fuera = (e: Escena) => {
        const n = armada(e).porNodo.find((x) => x.id === ch.id);
        if (!n) return "∅";
        return JSON.stringify(inventarioDe(n).filter((l) => !coincide(l, s)).map((l) => `${l.parte}|${l.formatoId}|${l.codigo}|${l.cantidad}`).sort());
      };
      return fuera(antes) === fuera(despues) ? null : `en ${ch.id} cambiaron globos fuera de ${JSON.stringify(ch.selector)}`;
    }
    case "colores": {
      const lista = ids(ch.en);
      const codigos = [...codigosEn(despues, lista, selectorDe(ch.selector))];
      if (!codigos.length) return `colores: sin globos en ${lista.join(",") || "(nada)"}`;
      const cumple = (c: string) => (ch.contienen ?? []).some((grupo) => grupo.every((p) => nombreCodigo(c).includes(plegar(p))));
      if (ch.contienen?.length) {
        const buenos = codigos.filter(cumple);
        if ((ch.modo ?? "todos") === "todos" ? buenos.length !== codigos.length : !buenos.length) return `colores de ${lista.join(",")}: ${codigos.map((c) => `${c} ${referenciaPorCodigo(c)?.nombreCompleto ?? ""}`).join(", ")} (se esperaba ${ch.modo ?? "todos"} con ${JSON.stringify(ch.contienen)})`;
      }
      const prohibidos = codigos.filter((c) => (ch.excluye ?? []).some((p) => nombreCodigo(c).includes(plegar(p)) || c === p));
      return prohibidos.length ? `quedan colores excluidos: ${prohibidos.join(", ")}` : null;
    }
    case "medida": {
      const lista = ids(ch.en);
      if (!lista.length) return "medida: ninguna pieza objetivo";
      for (const id of lista) {
        const c = caja(despues, id);
        const v = c ? (ch.eje === "alto" ? c.max.y - c.min.y : c.max.x - c.min.x) : NaN;
        if (!(v >= ch.min && v <= ch.max)) return `${id}: ${ch.eje} = ${Math.round(v)} cm (se esperaba ${ch.min}–${ch.max})`;
      }
      return null;
    }
    case "hay": {
      const n = ids(ch.en).length;
      return (ch.min === undefined || n >= ch.min) && (ch.max === undefined || n <= ch.max) ? null : `hay ${n} de ${JSON.stringify(ch.en)} (se esperaba ${ch.min ?? 0}–${ch.max ?? "∞"})`;
    }
    case "posicion": {
      for (const n of objetivo(antes, despues, ch.en)) {
        const x = xDeNodo(despues, n), z = zDe(n);
        if (ch.x && !(x >= ch.x[0] && x <= ch.x[1])) return `${n.id}: x = ${Math.round(x)} (se esperaba ${ch.x.join("…")})`;
        if (ch.z && !(z >= ch.z[0] && z <= ch.z[1])) return `${n.id}: z = ${Math.round(z)} (se esperaba ${ch.z.join("…")})`;
      }
      return objetivo(antes, despues, ch.en).length ? null : "posicion: ninguna pieza objetivo";
    }
    case "misma": {
      const vals = objetivo(antes, despues, ch.en).map((n) => (ch.campo === "z" ? zDe(n) : alturaDe(n)));
      return vals.length >= 2 && vals.every((v) => Math.abs(v - vals[0]!) <= 2) ? null : `${ch.campo} no es la misma: ${vals.map(Math.round).join(", ")}`;
    }
    case "equidistantes": {
      const xs = objetivo(antes, despues, ch.en).map((n) => { const c = caja(despues, n.id); return c ? (c.min.x + c.max.x) / 2 : xDeNodo(despues, n); }).sort((a, b) => a - b);
      const pasos = xs.slice(1).map((x, i) => x - xs[i]!);
      const tol = ch.tolerancia ?? 6;
      return xs.length >= 3 && pasos.every((p) => Math.abs(p - pasos[0]!) <= tol) ? null : `no están equidistantes: x = ${xs.map(Math.round).join(", ")}`;
    }
    case "simetricas": {
      const a = despues.nodos.find((n) => n.id === ch.a);
      const b = objetivo(antes, despues, ch.b).find((n) => n.id !== ch.a);
      if (!a || !b) return `simetricas: falta ${a ? "la copia" : ch.a}`;
      const eje = ch.eje_x ?? 0, tol = ch.tolerancia ?? 12;
      const ca = caja(despues, a.id), cb = caja(despues, b.id);
      if (!ca || !cb) return "simetricas: sin caja";
      // Por su x de colocación (una palmera curva no es simétrica por dentro); con «forma», además la caja reflejada.
      const centroA = xDeNodo(despues, a), centroB = xDeNodo(despues, b);
      if (Math.abs(centroA + centroB - 2 * eje) > tol) return `${a.id} (x=${Math.round(centroA)}) y ${b.id} (x=${Math.round(centroB)}) no son simétricas respecto de x=${eje}`;
      if (Math.abs((zDe(a) || 0) - (zDe(b) || 0)) > tol) return `${a.id} y ${b.id} no están a la misma z`;
      // La forma reflejada: el borde izquierdo de una es el derecho de la otra (respecto de su propio eje de colocación).
      if (ch.forma && Math.abs((ca.max.x - xDeNodo(despues, a)) - (xDeNodo(despues, b) - cb.min.x)) > tol) return `${b.id} no tiene la forma reflejada de ${a.id}`;
      return null;
    }
    case "padre": {
      const padres = new Set(ids(ch.padre));
      const n = objetivo(antes, despues, ch.en).filter((x) => (x.colocacion.en === "ancla" || x.colocacion.en === "sobre") && padres.has(x.colocacion.padreId)).length;
      return n >= ch.min ? null : `solo ${n} van sobre/colgadas de ${[...padres].join(",") || "(ninguna)"} (mínimo ${ch.min})`;
    }
    case "pregunta":
      return extra.pregunta && extra.pregunta.opciones.length >= (ch.opciones_min ?? 2) ? null : "se esperaba una pregunta con opciones";
    case "respuesta_con_numeros":
      if (!extra.evaluacion) return null;
      return /\d/.test(extra.respuesta ?? "") ? null : "la respuesta final no dice números";
  }
}

export function comprobarTodos(antes: Escena, despues: Escena, checks: readonly Check[], extra: Extra = {}): string[] {
  return checks.flatMap((ch) => {
    try { const f = comprobar(antes, despues, ch, extra); return f ? [f] : []; } catch (e) { return [`${ch.tipo}: ${e instanceof Error ? e.message : String(e)}`]; }
  });
}
