import type { Colocacion, Escena, NodoEscena } from "./escena";
import { armarPieza, type PiezaArmada } from "./piezas";
import { inventarioDe } from "./partes-globos";
import { describirMueble, muebleDeNodo, resumenDeMobiliario } from "./descripcion-mobiliario";
import { contarMobiliario } from "./mobiliario-asientos-mesa";
import { problemasNuevos } from "./problemas-escena";

/**
 * **Verificación automática** de lo que hizo la IA de escena (2026-10-08): tras cada vuelta con herramientas que
 * cambian la escena, la ruta le pasa al modelo lo que DE VERDAD cambió —cuántas piezas hay, y para las piezas
 * tocadas el inventario (formato × color, de `inventarioDe`) antes → después—, para que la respuesta final diga
 * números reales y no lo que el modelo cree que hizo. Puro y sin red; arma solo las piezas que cambiaron.
 *
 * El mobiliario se cuenta por su entrada del catálogo y sus asientos reales, NUNCA por el `nombre` que eligió el modelo (la mesa de
 * 8 sillas llamada «con 4 sillas» alimentó cuatro respuestas falsas), y se avisa de lo que quedó mal puesto (una decoración dentro de una mesa).
 */

const CACHE = new Map<string, Map<string, number>>();

/** Globos por «formato color» de una pieza (sola, una copia), con caché por su JSON. */
function inventario(n: NodoEscena): Map<string, number> {
  const clave = JSON.stringify(n.pieza);
  const hecho = CACHE.get(clave);
  if (hecho) return hecho;
  const mapa = new Map<string, number>();
  let armada: PiezaArmada | null = null;
  try { armada = armarPieza(n.pieza); } catch { armada = null; }
  for (const l of armada ? inventarioDe(armada) : []) {
    const k = `${l.formatoId} ${l.codigo}`;
    mapa.set(k, (mapa.get(k) ?? 0) + l.cantidad);
  }
  CACHE.set(clave, mapa);
  while (CACHE.size > 300) { const k = CACHE.keys().next().value; if (k === undefined) break; CACHE.delete(k); }
  return mapa;
}

/** Dónde quedó una pieza, en pocas palabras («en el piso x 120, z −80», «sobre mesa-1»). */
function lugarBreve(c: Colocacion): string {
  switch (c.en) {
    case "piso": return `en el piso x ${Math.round(c.xCm)}, z ${Math.round(c.zCm)}`;
    case "sobre": return c.encima ? `encima de ${c.padreId}` : `sobre ${c.padreId}`;
    case "ancla": return `colgada de ${c.padreId}`;
    case "pared": return `en la pared ${c.pared}`;
    case "techo": return "colgada del techo";
    case "libre": return "suelta en el aire";
  }
}

const total = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((s, x) => s + x, 0);

/** Suma por formato («R-24 12») a partir de «formato color». */
function porFormato(m: ReadonlyMap<string, number>): Map<string, number> {
  const salida = new Map<string, number>();
  for (const [k, v] of m) { const f = k.split(" ")[0]!; salida.set(f, (salida.get(f) ?? 0) + v); }
  return salida;
}

/** «R-24: 6 → 14; R-5: 80 → 40» de lo que cambió (formatos), y los colores que entran o salen. */
function diferencia(antes: ReadonlyMap<string, number>, despues: ReadonlyMap<string, number>): string {
  const fa = porFormato(antes), fd = porFormato(despues);
  const formatos = [...new Set([...fa.keys(), ...fd.keys()])].filter((f) => (fa.get(f) ?? 0) !== (fd.get(f) ?? 0));
  const partes = formatos.slice(0, 6).map((f) => `${f}: ${fa.get(f) ?? 0} → ${fd.get(f) ?? 0}`);
  const colores = (m: ReadonlyMap<string, number>) => new Set([...m.keys()].map((k) => k.split(" ")[1]!));
  const ca = colores(antes), cd = colores(despues);
  const entran = [...cd].filter((c) => !ca.has(c)), salen = [...ca].filter((c) => !cd.has(c));
  if (entran.length) partes.push(`colores nuevos ${entran.slice(0, 5).join(", ")}`);
  if (salen.length) partes.push(`ya no lleva ${salen.slice(0, 5).join(", ")}`);
  if (!partes.length) {
    const cambiaColor = [...new Set([...antes.keys(), ...despues.keys()])].some((k) => (antes.get(k) ?? 0) !== (despues.get(k) ?? 0));
    partes.push(cambiaColor ? "mismos formatos, cambió el reparto de colores" : "mismos globos (cambió su sitio, medida o nombre)");
  }
  return partes.join("; ");
}

/** Los ids que cambiaron entre dos escenas: nuevos, quitados y modificados (pieza, sitio o nombre). */
export function idsTocados(antes: Escena, despues: Escena): { nuevos: string[]; quitados: string[]; cambiados: string[] } {
  const previos = new Map(antes.nodos.map((n) => [n.id, JSON.stringify(n)]));
  const ahora = new Set(despues.nodos.map((n) => n.id));
  return {
    nuevos: despues.nodos.filter((n) => !previos.has(n.id)).map((n) => n.id),
    quitados: antes.nodos.filter((n) => !ahora.has(n.id)).map((n) => n.id),
    cambiados: despues.nodos.filter((n) => previos.has(n.id) && previos.get(n.id) !== JSON.stringify(n)).map((n) => n.id),
  };
}

/**
 * El texto de la verificación (corto: a lo más `max` piezas detalladas). Vacío si nada cambió.
 * Ej.: «Verificación automática: piezas 4 → 5. Nueva columna-organica (245 globos: R-24 6, R-18 30…). Cambió arco: R-24: 6 → 14.»
 */
export function verificarCambios(antes: Escena, despues: Escena, max = 8): string {
  const t = idsTocados(antes, despues);
  if (!t.nuevos.length && !t.quitados.length && !t.cambiados.length && JSON.stringify(antes.sala) === JSON.stringify(despues.sala)) return "";
  const lineas: string[] = [`Verificación automática (lo que de verdad cambió): piezas ${antes.nodos.length} → ${despues.nodos.length}.`];
  const de = (e: Escena, id: string) => e.nodos.find((n) => n.id === id)!;
  let mostradas = 0;
  for (const id of t.nuevos) {
    if (mostradas >= max) break;
    mostradas += 1;
    const n = de(despues, id);
    if (muebleDeNodo(n)) { lineas.push(`- nuevo mueble ${id}: ${describirMueble(n)}.`); continue; }
    const inv = inventario(n);
    const formatos = [...porFormato(inv)].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, c]) => `${f} ${c}`).join(", ");
    lineas.push(`- nueva ${id} «${n.nombre}» (${n.pieza.tipo}): ${total(inv)} globos${formatos ? ` (${formatos})` : ""} · ${lugarBreve(n.colocacion)}.`);
  }
  for (const id of t.cambiados) {
    if (mostradas >= max) break;
    mostradas += 1;
    const a = de(antes, id), d = de(despues, id);
    if (muebleDeNodo(d)) { lineas.push(`- cambió el mueble ${id}: ${describirMueble(d)}${JSON.stringify(a.colocacion) !== JSON.stringify(d.colocacion) ? " · cambió de sitio" : ""}.`); continue; }
    const ia = inventario(a), id2 = inventario(d);
    const sitio = JSON.stringify(a.colocacion) !== JSON.stringify(d.colocacion) ? " · cambió de sitio" : "";
    lineas.push(`- cambió ${id} «${d.nombre}»: ${total(ia)} → ${total(id2)} globos; ${diferencia(ia, id2)}${sitio}.`);
  }
  if (t.quitados.length) lineas.push(`- quitadas: ${t.quitados.join(", ")}.`);
  const resto = t.nuevos.length + t.cambiados.length - mostradas;
  if (resto > 0) lineas.push(`- y ${resto} piezas más tocadas.`);
  if (JSON.stringify(antes.sala) !== JSON.stringify(despues.sala)) lineas.push("- cambió la sala.");
  // Las mesas y sillas que de verdad hay, leídas de las piezas (un grupo de sillas es una pieza con muchas sillas): nunca del nombre.
  const ma = contarMobiliario(antes), md = contarMobiliario(despues);
  if (ma.mesas !== md.mesas || ma.sillas !== md.sillas) lineas.push(`- mobiliario (leído de las piezas): mesas ${ma.mesas} → ${md.mesas}, sillas ${ma.sillas} → ${md.sillas}.`);
  const tocaMobiliario = [...t.nuevos, ...t.cambiados].some((id) => muebleDeNodo(de(despues, id))) || t.quitados.some((id) => muebleDeNodo(de(antes, id)));
  const mobiliario = tocaMobiliario ? resumenDeMobiliario(despues) : "";
  if (mobiliario) lineas.push(`- ${mobiliario}`);
  const problemas = problemasNuevos(antes, despues).slice(0, 5);
  for (const p of problemas) lineas.push(`- PROBLEMA: ${p.texto}`);
  if (problemas.length) lineas.push("Corrige los PROBLEMA antes de responder; si no puedes, dilo en la respuesta.");
  lineas.push("En la respuesta final di estos números (antes → después), no estimaciones.");
  return lineas.join("\n");
}
