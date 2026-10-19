import type { Vec3 } from "./modulos";
import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";
import type { Punto2 } from "./trenza";

/**
 * Herramientas para armar **mobiliario** con los sólidos de la escenografía (cajas, cilindros, paneles): varillas
 * entre dos puntos (patas abiertas, aros de apoyapiés), losas horizontales con cualquier contorno (la tapa
 * hexagonal de una mesa nido), cajas inclinadas (el respaldo de una silla) y cómo llevar un mueble armado a otro
 * sitio de la escena (la silla que se pone alrededor de una mesa). Todo en cm, y hacia arriba, +z al frente.
 */

export const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const r1 = (n: number) => Math.round(n * 10) / 10;
const ORIGEN = v(0, 0, 0), X = v(1, 0, 0), Y = v(0, 1, 0);
const cruz = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unitario = (a: Vec3): Vec3 => { const n = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };

/** Un material: el acabado y el color con que se arma cada parte de un mueble. */
export type Material = { hex: string; acabado: AcabadoEscenografia };
export const mat = (hex: string, acabado: AcabadoEscenografia): Material => ({ hex, acabado });

/** Varilla (cilindro) de `a` a `b`, de radio `radioCm` (y `radioFinCm` en `b`, si se afina). */
export function barra(a: Vec3, b: Vec3, radioCm: number, m: Material, radioFinCm?: number): ElementoEscenografia {
  const d = v(b.x - a.x, b.y - a.y, b.z - a.z);
  const largo = Math.hypot(d.x, d.y, d.z);
  const arriba = unitario(d);
  const radioArribaCm = radioFinCm ?? radioCm;
  if (Math.abs(arriba.x) < 1e-6 && Math.abs(arriba.z) < 1e-6 && arriba.y > 0) {
    return { forma: "cilindro", base: a, radioCm, radioArribaCm, altoCm: r1(largo), ...m };
  }
  const ejeX = Math.abs(arriba.y) > 0.999 ? X : unitario(cruz(Y, arriba));
  return { forma: "cilindro", base: ORIGEN, radioCm, radioArribaCm, altoCm: r1(largo), en: { origen: a, ejeX, ejeY: arriba }, ...m };
}

/** Caja centrada en `centro`, de `tamano`, inclinada `inclinacionGrados` sobre el eje x (positivo: la punta de arriba se va hacia atrás). */
export function cajaInclinada(centro: Vec3, tamano: Vec3, inclinacionGrados: number, m: Material): ElementoEscenografia {
  const a = (inclinacionGrados * Math.PI) / 180;
  return { forma: "caja", centro: ORIGEN, tamano, en: { origen: centro, ejeX: X, ejeY: v(0, Math.cos(a), -Math.sin(a)) }, ...m };
}

export const caja = (centro: Vec3, tamano: Vec3, m: Material, giroGrados?: number): ElementoEscenografia =>
  ({ forma: "caja", centro, tamano, ...(giroGrados ? { giroGrados } : {}), ...m });

export const cilindro = (base: Vec3, radioCm: number, altoCm: number, m: Material, radioArribaCm?: number): ElementoEscenografia =>
  ({ forma: "cilindro", base, radioCm, altoCm, ...(radioArribaCm !== undefined ? { radioArribaCm } : {}), ...m });

/** Cilindro tumbado con el eje a lo largo de x (una rueda: su eje va de lado a lado) o de z. */
export function cilindroTumbado(centro: Vec3, radioCm: number, anchoCm: number, eje: "x" | "z", m: Material): ElementoEscenografia {
  const dir = eje === "x" ? X : v(0, 0, 1);
  const origen = v(centro.x - dir.x * anchoCm / 2, centro.y, centro.z - dir.z * anchoCm / 2);
  return { forma: "cilindro", base: ORIGEN, radioCm, altoCm: anchoCm, en: { origen, ejeX: eje === "x" ? v(0, 0, 1) : X, ejeY: dir }, ...m };
}

/** Los vértices de un polígono regular de `lados` lados y radio `radioCm` (al vértice), con el primero en `faseGrados`. */
export function poligono(lados: number, radioCm: number, faseGrados = 0): Punto2[] {
  return Array.from({ length: lados }, (_, i) => {
    const a = ((faseGrados + (360 * i) / lados) * Math.PI) / 180;
    return { x: r1(Math.cos(a) * radioCm), y: r1(Math.sin(a) * radioCm) };
  });
}

/**
 * Losa horizontal: un contorno del plano del piso (x, z) —z positivo hacia el frente— extruido hacia arriba
 * `grosorCm` desde `yCm`. `huecos` la vacían (un marco hexagonal de alambre).
 */
export function losa(contorno: readonly Punto2[], yCm: number, grosorCm: number, m: Material, huecos: readonly (readonly Punto2[])[] = [], centro: { x: number; z: number } = { x: 0, z: 0 }): ElementoEscenografia {
  const plano = (p: Punto2): Punto2 => ({ x: p.x, y: -p.y });
  return {
    forma: "panel", contorno: contorno.map(plano), huecos: huecos.map((h) => h.map(plano)), zCm: 0, grosorCm,
    en: { origen: v(centro.x, yCm, centro.z), ejeX: X, ejeY: v(0, 0, -1) }, ...m,
  };
}

const giroY = (p: Vec3, grados: number): Vec3 => {
  const a = (grados * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: c * p.x + s * p.z, y: p.y, z: -s * p.x + c * p.z };
};

/** Lleva un mueble armado a (`x`, `z`) girado `giroGrados` sobre y (el mismo sentido del giro de las piezas del piso). */
export function trasladarGirar(elementos: readonly ElementoEscenografia[], x: number, z: number, giroGrados: number): ElementoEscenografia[] {
  return elementos.map((e) => {
    const marco = e.en ?? { origen: ORIGEN, ejeX: X, ejeY: Y };
    const o = giroY(marco.origen, giroGrados);
    return { ...e, en: { origen: v(o.x + x, o.y, o.z + z), ejeX: giroY(marco.ejeX, giroGrados), ejeY: giroY(marco.ejeY, giroGrados) } };
  });
}

/** Giro (grados) para que el frente (+z) de algo puesto en (`x`, `z`) mire al punto (`haciaX`, `haciaZ`). */
export const giroHacia = (x: number, z: number, haciaX: number, haciaZ: number): number =>
  Math.round((Math.atan2(haciaX - x, haciaZ - z) * 180) / Math.PI);
