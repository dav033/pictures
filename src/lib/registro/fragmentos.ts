import { createHash } from "node:crypto";

/**
 * **Líneas de registro que caben en la línea de Vercel** (2026-10-09): Vercel corta cada línea de stdout hacia los 16 KB, y la traza de
 * auditoría (una `llamada_ia` con el sistema y las herramientas, una `salida` con la escena) pasa de eso: quedaba un JSON roto que ninguna
 * herramienta leía (turno 1 `llamada_ia` y turno 6 `salida` de la conversación 3d-20261009-103125-92b58a). Una línea más larga se parte en
 * fragmentos válidos, cada uno con su marca (`fragmento_de`, `parte`, `de`); `reensamblarFragmentos` los junta. Los archivos de la conversación
 * siguen llevando la línea entera. Puro.
 */

/** Largo máximo de una línea hacia stdout (Vercel corta a ~16 KB). */
export const MAX_LINEA_STDOUT = 15_000;
/** Cuántos caracteres de la línea original lleva cada fragmento: con el peor escape (todo comillas) siguen cabiendo bajo el máximo. */
const TROZO = 6_000;
/** Más allá de esto se corta con una marca (un registro de 8 MB no se vuelca entero a stdout). */
const MAX_PARTES = 40;

export type Fragmento = { ts: string; fragmento_de: string; parte: number; de: number; conversacion?: string; texto: string; recortado?: number };

function campo(linea: string, clave: string): string | undefined {
  const m = new RegExp(`"${clave}":"([^"]{1,120})"`).exec(linea.slice(0, 2_000));
  return m?.[1];
}

/** La línea tal cual si cabe; si no, sus fragmentos (cada uno una línea JSON de a lo más `MAX_LINEA_STDOUT`). */
export function partirLinea(linea: string, max = MAX_LINEA_STDOUT): string[] {
  if (linea.length <= max) return [linea];
  const id = createHash("sha256").update(linea).digest("hex").slice(0, 12);
  const ts = campo(linea, "ts") ?? new Date().toISOString();
  const conversacion = campo(linea, "conversacion");
  const trozo = Math.max(500, Math.min(TROZO, Math.floor(max / 2.5)));
  const total = Math.ceil(linea.length / trozo);
  const partes = Math.min(total, MAX_PARTES);
  const salida: string[] = [];
  for (let i = 0; i < partes; i++) {
    const f: Fragmento = {
      ts, fragmento_de: id, parte: i + 1, de: partes, ...(conversacion ? { conversacion } : {}), texto: linea.slice(i * trozo, (i + 1) * trozo),
      ...(i === partes - 1 && total > partes ? { recortado: linea.length - partes * trozo } : {}),
    };
    salida.push(JSON.stringify(f));
  }
  return salida;
}

const esFragmento = (o: unknown): o is Fragmento =>
  typeof o === "object" && o !== null && typeof (o as Fragmento).fragmento_de === "string" && typeof (o as Fragmento).parte === "number" && typeof (o as Fragmento).texto === "string";

/**
 * Junta los fragmentos de `lineas` (mezclados con otras líneas y en cualquier orden) en la línea original. Las líneas que no son fragmentos pasan
 * tal cual; un grupo al que le faltan partes (o recortado) se deja como fragmentos sueltos, nunca se inventa una línea.
 */
export function reensamblarFragmentos(lineas: readonly string[]): string[] {
  const grupos = new Map<string, Fragmento[]>();
  const salida: Array<string | { grupo: string }> = [];
  for (const linea of lineas) {
    let o: unknown;
    try { o = linea.trim().startsWith("{") ? JSON.parse(linea) : undefined; } catch { o = undefined; }
    if (!esFragmento(o)) { salida.push(linea); continue; }
    if (!grupos.has(o.fragmento_de)) { grupos.set(o.fragmento_de, []); salida.push({ grupo: o.fragmento_de }); }
    grupos.get(o.fragmento_de)!.push(o);
  }
  const hecho = new Set<string>();
  const final: string[] = [];
  for (const s of salida) {
    if (typeof s === "string") { final.push(s); continue; }
    if (hecho.has(s.grupo)) continue;
    hecho.add(s.grupo);
    const partes = grupos.get(s.grupo)!.sort((a, b) => a.parte - b.parte);
    const completo = partes.length === partes[0]!.de && partes.every((p, i) => p.parte === i + 1) && !partes.some((p) => p.recortado);
    if (completo) final.push(partes.map((p) => p.texto).join(""));
    else final.push(...partes.map((p) => JSON.stringify(p)));
  }
  return final;
}
