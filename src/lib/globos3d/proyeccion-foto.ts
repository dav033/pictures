import type { Sala } from "./escena";
import type { Encuadre } from "./encuadre-foto";
import type { Vec3 } from "./modulos";

/**
 * La cámara de la foto como números (REQ-001 paso 9): los mismos de `camara-foto.ts`, que dibuja con ella, pero sin
 * three.js, para que el criterio de aceptación del refinado pueda saber dónde cae cada pieza en la captura sin dibujarla.
 * La cámara mira de frente a la pared del fondo (hacia −z); las unidades son cm del mundo.
 */

export const FOV_FOTO_GRADOS = 35;
/** A qué profundidad de la pared de fondo se mide la escala de la foto: donde suele estar la decoración (cm hacia el frente). */
export const PROFUNDIDAD_DE_LA_FOTO_CM = 40;

export type CamaraNumerica = { x: number; y: number; z: number; tangente: number; aspecto: number };

/** Un punto en la pantalla: `x` e `y` en mitades del alto del cuadro (el cuadro va de −1 a 1 en y y de −aspecto a aspecto en x), `prof` los cm hasta la cámara. */
export type PuntoPantalla = { x: number; y: number; prof: number };

export function camaraNumerica(encuadre: Encuadre, sala: Pick<Sala, "fondoCm">): CamaraNumerica {
  const tangente = Math.tan((FOV_FOTO_GRADOS / 2) * Math.PI / 180);
  const distancia = encuadre.altoCm / 2 / tangente;
  const planoZ = -sala.fondoCm / 2 + PROFUNDIDAD_DE_LA_FOTO_CM;
  return { x: 0, y: encuadre.centroYCm, z: planoZ + distancia, tangente, aspecto: encuadre.aspecto };
}

/** Dónde cae un punto del mundo en el cuadro; `null` si está detrás de la cámara. */
export function proyectar(c: CamaraNumerica, p: Vec3): PuntoPantalla | null {
  const prof = c.z - p.z;
  if (prof <= 1e-6) return null;
  const k = prof * c.tangente;
  return { x: (p.x - c.x) / k, y: (p.y - c.y) / k, prof };
}

/** Cuánto mide en pantalla (en mitades del alto del cuadro) algo de `cm` de largo a `prof` cm de la cámara. */
export const largoEnPantalla = (c: CamaraNumerica, cm: number, prof: number): number => cm / (prof * c.tangente);

/** Si el punto cae dentro del cuadro de la foto. */
export const enCuadro = (c: CamaraNumerica, p: PuntoPantalla): boolean => Math.abs(p.y) <= 1 && Math.abs(p.x) <= c.aspecto;
