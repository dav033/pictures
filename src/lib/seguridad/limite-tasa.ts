/**
 * Límite de peticiones por clave (la IP de quien llama) en una ventana fija, en memoria de la instancia. No sustituye a un
 * límite compartido entre instancias: frena el abuso de una sola máquina contra una ruta que gasta IA. Sin `Date.now()` al
 * importar: el reloj se pasa por parámetro (las pruebas lo mueven).
 */
export type ResultadoTasa = { ok: true } | { ok: false; reintentarEnMs: number };

type Ventana = { desde: number; usadas: number };

const MAX_CLAVES = 5_000;

export function crearLimitadorTasa(opciones: { max: number; ventanaMs: number }) {
  const ventanas = new Map<string, Ventana>();
  return {
    /** Cuántas claves guarda (para vigilar la memoria). */
    tamano: () => ventanas.size,
    tomar(clave: string, ahora: number = Date.now()): ResultadoTasa {
      if (ventanas.size >= MAX_CLAVES) {
        for (const [k, v] of ventanas) if (ahora - v.desde >= opciones.ventanaMs) ventanas.delete(k);
        // Si siguen siendo demasiadas (claves inventadas con ventanas vivas), se sueltan las más viejas: la memoria no crece sin tope.
        for (const k of ventanas.keys()) { if (ventanas.size < MAX_CLAVES) break; ventanas.delete(k); }
      }
      const previa = ventanas.get(clave);
      const ventana = !previa || ahora - previa.desde >= opciones.ventanaMs ? { desde: ahora, usadas: 0 } : previa;
      ventanas.set(clave, ventana);
      if (ventana.usadas >= opciones.max) return { ok: false, reintentarEnMs: Math.max(0, opciones.ventanaMs - (ahora - ventana.desde)) };
      ventana.usadas += 1;
      return { ok: true };
    },
  };
}

/** La IP de quien llama según el proxy (Vercel pone la primera de `x-forwarded-for`); sin ella, un solo cubo compartido. */
export function ipDe(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "sin-ip";
}
