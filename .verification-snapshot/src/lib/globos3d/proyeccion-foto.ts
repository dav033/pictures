import type { Sala } from "./escena";
import type { Encuadre } from "./encuadre-foto";
import type { Vec3 } from "./modulos";

/**
 * La cámara de la foto como números (REQ-001 paso 9): los mismos de `camara-foto.ts`, que dibuja con ella, pero sin
 * three.js, para que el criterio de aceptación del refinado pueda saber dónde cae cada pieza en la captura sin dibujarla,
 * y para que el compilador ponga lo apoyado en el piso donde lo ve esta misma cámara. Unidades: cm del mundo.
 *
 * La cámara está a `camaraYCm` del piso (la mano del que toma la foto) y mira hacia la pared del fondo (−z), inclinada
 * hacia abajo lo justo para que el centro del cuadro caiga en el centro de la imagen sobre el plano de la decoración, a la
 * distancia en que `altoCm` llena el cuadro. Sin `camaraYCm` (encuadres viejos) va a la altura del centro, de frente.
 */

export const FOV_FOTO_GRADOS = 35;
/** A qué profundidad de la pared de fondo se mide la escala de la foto: donde suele estar la decoración (cm hacia el frente). */
export const PROFUNDIDAD_DE_LA_FOTO_CM = 40;

/** Lo más que se inclina la cámara de la foto hacia abajo (las 13 fotos del dueño: de 0 a 4°). */
export const INCLINACION_MAXIMA_GRADOS = 10;

/** `inclinacion`: radianes hacia abajo (0 = de frente). `tangente`: la de la mitad del campo vertical. */
export type CamaraNumerica = { x: number; y: number; z: number; tangente: number; aspecto: number; inclinacion: number };

/** Un punto en la pantalla: `x` e `y` en mitades del alto del cuadro (el cuadro va de −1 a 1 en y y de −aspecto a aspecto en x), `prof` los cm hasta la cámara. */
export type PuntoPantalla = { x: number; y: number; prof: number };

/** La cámara del encuadre con el plano de la decoración en z = `planoZ`. */
function camaraEnPlano(encuadre: Encuadre, planoZ: number): CamaraNumerica {
  const tangente = Math.tan((FOV_FOTO_GRADOS / 2) * Math.PI / 180);
  const distancia = encuadre.altoCm / 2 / tangente;
  // Lo que sube la cámara sobre el centro, sin pasar de `INCLINACION_MAXIMA_GRADOS`: el compilador coloca lo colgado con una
  // escala lineal (de frente), que con más inclinación ya no calza con la captura (un encuadre cercano de 1 m inclinaba 37°).
  const alzada = Math.max(0, (encuadre.camaraYCm ?? encuadre.centroYCm) - encuadre.centroYCm);
  const subida = Math.min(alzada, distancia * Math.sin((INCLINACION_MAXIMA_GRADOS * Math.PI) / 180));
  // A `distancia` del centro de la imagen a lo largo de la mirada: la escala del centro es la misma que de frente.
  return { x: 0, y: encuadre.centroYCm + subida, z: planoZ + Math.sqrt(distancia ** 2 - subida ** 2), tangente, aspecto: encuadre.aspecto, inclinacion: Math.asin(subida / distancia) };
}

export function camaraNumerica(encuadre: Encuadre, sala: Pick<Sala, "fondoCm">): CamaraNumerica {
  return camaraEnPlano(encuadre, -sala.fondoCm / 2 + PROFUNDIDAD_DE_LA_FOTO_CM);
}

/** Hacia dónde mira la cámara (`adelante`) y su arriba, en el mundo (sin giro: la x del cuadro es la del mundo). */
export function ejesDeCamara(c: CamaraNumerica): { adelante: Vec3; arriba: Vec3 } {
  const s = Math.sin(c.inclinacion), k = Math.cos(c.inclinacion);
  return { adelante: { x: 0, y: -s, z: -k }, arriba: { x: 0, y: k, z: -s } };
}

/** Dónde cae un punto del mundo en el cuadro; `null` si está detrás de la cámara. */
export function proyectar(c: CamaraNumerica, p: Vec3): PuntoPantalla | null {
  const { adelante, arriba } = ejesDeCamara(c);
  const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
  const prof = dy * adelante.y + dz * adelante.z;
  if (prof <= 1e-6) return null;
  const k = prof * c.tangente;
  return { x: dx / k, y: (dy * arriba.y + dz * arriba.z) / k, prof };
}

/**
 * El punto del piso (y = 0) que se ve en la fila `yImagen` (0 arriba, 1 abajo) del centro de la foto, con la cámara del
 * encuadre y el plano de la decoración en z = 0: su z (cm, positivo hacia la cámara) y su profundidad hasta la cámara.
 * `null` si esa fila mira por encima del horizonte.
 */
export function pisoEnLaFoto(encuadre: Encuadre, yImagen: number): { z: number; prof: number } | null {
  const c = camaraEnPlano(encuadre, 0);
  const { adelante, arriba } = ejesDeCamara(c);
  const v = (0.5 - yImagen) * 2 * c.tangente;
  const dy = adelante.y + v * arriba.y, dz = adelante.z + v * arriba.z;
  if (dy >= -1e-6) return null;
  const t = c.y / -dy;
  return { z: c.z + t * dz, prof: t };
}

/** Cuánto mide en pantalla (en mitades del alto del cuadro) algo de `cm` de largo a `prof` cm de la cámara. */
export const largoEnPantalla = (c: CamaraNumerica, cm: number, prof: number): number => cm / (prof * c.tangente);

/** Si el punto cae dentro del cuadro de la foto. */
export const enCuadro = (c: CamaraNumerica, p: PuntoPantalla): boolean => Math.abs(p.y) <= 1 && Math.abs(p.x) <= c.aspecto;
