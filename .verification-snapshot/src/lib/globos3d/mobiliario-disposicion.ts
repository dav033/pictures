import { giroHacia, r1 } from "./mobiliario-base";

/**
 * Dónde van las sillas (u otros asientos) de un reparto: **en fila** a lo largo de x, o **alrededor** de una mesa
 * (redonda: repartidas parejo en el círculo; rectangular: por los dos lados largos y, si sobran, una en cada
 * cabecera). Cada puesto trae el giro que deja el frente del asiento mirando al centro de la mesa.
 */

export type Puesto = { x: number; z: number; giroGrados: number };

/** `cantidad` puestos en fila, centrados en (`cx`, `cz`), a `separacionCm` entre centros, de frente a +z. */
export function puestosEnFila(o: { cx: number; cz: number; cantidad: number; separacionCm: number; giroGrados?: number }): Puesto[] {
  const { cx, cz, cantidad, separacionCm } = o;
  return Array.from({ length: cantidad }, (_, i) => ({ x: r1(cx + (i - (cantidad - 1) / 2) * separacionCm), z: cz, giroGrados: o.giroGrados ?? 0 }));
}

/** Cuántos asientos de `frenteCm` caben por un lado de `largoCm`. */
export const cabenEnLado = (largoCm: number, frenteCm: number) => Math.max(1, Math.floor(largoCm / (frenteCm + 6)));

/**
 * Puestos alrededor de una mesa de `anchoCm` × `fondoCm` centrada en (`cx`, `cz`). `holguraCm` es la distancia del
 * borde de la mesa al centro del asiento y `frenteCm` lo que ocupa un asiento a lo ancho. Si no caben todos, devuelve
 * los que caben (compara el largo con `cantidad`).
 */
export function puestosAlrededor(o: { cx: number; cz: number; anchoCm: number; fondoCm: number; cantidad: number; holguraCm: number; frenteCm: number; /** Cuántos van en las cabeceras (0, 1 o 2) aunque quepan más por los lados; por defecto, solo los que sobran. */ cabeceras?: number }): Puesto[] {
  const { cx, cz, anchoCm, fondoCm, cantidad: n, holguraCm: hol } = o;
  const puesto = (x: number, z: number): Puesto => ({ x: r1(x), z: r1(z), giroGrados: giroHacia(x, z, cx, cz) });
  const largo = Math.max(anchoCm, fondoCm), corto = Math.min(anchoCm, fondoCm);
  if (largo - corto < largo * 0.25) {
    const radio = largo / 2 + hol;
    // Alrededor de una mesa redonda caben tantos como asientos de `frenteCm` (más 6 de aire) hay en la circunferencia.
    const caben = Math.max(1, Math.floor((2 * Math.PI * radio) / (o.frenteCm + 6)));
    return Array.from({ length: Math.min(n, caben) }, (_, i) => { const a = (i / Math.min(n, caben)) * Math.PI * 2; return puesto(cx + Math.sin(a) * radio, cz + Math.cos(a) * radio); });
  }
  const alX = anchoCm >= fondoCm;
  // (l, s): l a lo largo de la mesa, s a lo ancho; se pasa a (x, z) según el lado largo. Cada asiento mira a la mesa
  // en perpendicular a su lado (`haciaS` = 0: la línea central), no al centro: así quedan derechos y no en abanico.
  const aMundo = (l: number, s: number, haciaS = s) => {
    const p = alX ? puesto(cx + l, cz + s) : puesto(cx + s, cz + l);
    const hacia = alX ? { x: cx + l, z: cz + haciaS } : { x: cx + haciaS, z: cz + l };
    return { ...p, giroGrados: giroHacia(p.x, p.z, hacia.x, hacia.z) };
  };
  const lados = Math.min(n - Math.min(2, o.cabeceras ?? 0), 2 * cabenEnLado(largo, o.frenteCm));
  const cabeceras = Math.min(2, n - lados);
  const salida: Puesto[] = [];
  [1, -1].forEach((lado, k) => {
    const cuantos = k === 0 ? Math.ceil(lados / 2) : Math.floor(lados / 2);
    for (let i = 0; i < cuantos; i++) salida.push(aMundo(-largo / 2 + (largo * (i + 0.5)) / cuantos, lado * (corto / 2 + hol), 0));
  });
  for (let i = 0; i < cabeceras; i++) salida.push(aMundo((i === 0 ? 1 : -1) * (largo / 2 + hol), 0, 0));
  return salida;
}
