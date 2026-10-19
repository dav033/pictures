import type { z } from "zod";

/**
 * **Una clave que la herramienta no conoce es un error, no algo que se ignora** (2026-10-09): Gemini mandó `cuelga` en vez de `cuelga_cm` y el esquema
 * (zod descarta lo desconocido) lo dejó pasar sin hacer nada; la herramienta contestó «ok» con el valor de siempre. Se revisa ANTES de aplicar, sobre el
 * esquema de la herramienta, y el error nombra la clave buena para que el modelo reintente bien. No toca el esquema que se le declara al modelo
 * (`.strict()` lo cambiaría a `additionalProperties: false` y agrandaría la declaración). Puro.
 */

type Def = { type?: string; shape?: Record<string, z.ZodType>; innerType?: z.ZodType; element?: z.ZodType; in?: z.ZodType };
const defDe = (e: z.ZodType): Def => ((e as unknown as { _zod?: { def?: Def } })._zod?.def) ?? {};

/** El objeto de un esquema a través de optional/nullable/default (y un arreglo de objetos, su elemento); null si no es de objeto. */
function objetoDe(e: z.ZodType | undefined, profundidad = 0): { shape: Record<string, z.ZodType>; arreglo: boolean } | null {
  if (!e || profundidad > 6) return null;
  const d = defDe(e);
  if (d.type === "object" && d.shape) return { shape: d.shape, arreglo: false };
  if (d.type === "array") { const o = objetoDe(d.element, profundidad + 1); return o ? { shape: o.shape, arreglo: true } : null; }
  if ((d.type === "optional" || d.type === "nullable" || d.type === "default" || d.type === "prefault" || d.type === "readonly") && d.innerType) return objetoDe(d.innerType, profundidad + 1);
  return null;
}

function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0]!;
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = fila[j]!;
      fila[j] = Math.min(fila[j]! + 1, fila[j - 1]! + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return fila[b.length]!;
}

/** La clave válida que más se parece a la desconocida («cuelga» → «cuelga_cm»), si alguna se parece. */
export function sugerenciaDeClave(clave: string, validas: readonly string[]): string | null {
  const base = clave.toLowerCase();
  const empieza = validas.find((v) => v.toLowerCase().startsWith(`${base}_`) || base.startsWith(`${v.toLowerCase()}_`));
  if (empieza) return empieza;
  const cerca = [...validas].map((v) => ({ v, d: distancia(base, v.toLowerCase()) })).sort((x, y) => x.d - y.d)[0];
  return cerca && cerca.d <= Math.max(2, Math.floor(base.length / 4)) ? cerca.v : null;
}

const MAX_VALIDAS = 30;

function revisar(esquema: z.ZodType | undefined, valor: unknown, ruta: string, herramienta: string): string | null {
  const o = objetoDe(esquema);
  if (!o || typeof valor !== "object" || valor === null) return null;
  const items = Array.isArray(valor) ? (o.arreglo ? valor : []) : o.arreglo ? [] : [valor];
  for (const item of items.slice(0, 50)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const validas = Object.keys(o.shape);
    for (const [clave, v] of Object.entries(item as Record<string, unknown>)) {
      if (!(clave in o.shape)) {
        const sugerida = sugerenciaDeClave(clave, validas);
        const donde = ruta ? `${ruta}.${clave}` : clave;
        return `«${donde}» no existe en ${herramienta}${sugerida ? `: ¿quisiste decir «${ruta ? `${ruta}.` : ""}${sugerida}»?` : "."} Claves válidas${ruta ? ` de ${ruta}` : ""}: ${validas.slice(0, MAX_VALIDAS).join(", ")}${validas.length > MAX_VALIDAS ? ", …" : ""}. No apliqué nada: corrige el nombre y vuelve a llamarla.`;
      }
      const dentro = revisar(o.shape[clave], v, ruta ? `${ruta}.${clave}` : clave, herramienta);
      if (dentro) return dentro;
    }
  }
  return null;
}

/** El error (en español, con la clave buena) si `argumentos` trae una clave que el esquema de la herramienta no tiene; null si todas existen. */
export function claveDesconocida(esquema: z.ZodType | undefined, argumentos: unknown, herramienta: string): string | null {
  return revisar(esquema, argumentos, "", herramienta);
}
