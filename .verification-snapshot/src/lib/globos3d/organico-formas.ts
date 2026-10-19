import type { Vec3 } from "./modulos";
import type { PuntoMezcla, RellenoOrganico, TramoOrganico } from "./organico";
import { vec } from "./organico-geometria";

/**
 * Mezcla de una columna orgánica gruesa: grandes (R-24/R-18) de ancla abajo y decrecientes hacia la punta. Parte de
 * `organica_gruesa` del plan (`mezclas.ts`: 9 → 25 %, 12 → 45 %, 18 → 20 %, 24 → 10 %), con los grandes cargados
 * en la base («grandes abajo») en vez de repartidos.
 */
export const MEZCLA_COLUMNA_GRUESA: readonly PuntoMezcla[] = [
  { t: 0, pesos: { "R-24": 0.25, "R-18": 0.35, "R-12": 0.4 } },
  { t: 0.22, pesos: { "R-24": 0.08, "R-18": 0.3, "R-12": 0.5, "R-9": 0.12 } },
  { t: 0.55, pesos: { "R-18": 0.12, "R-12": 0.5, "R-9": 0.38 } },
  { t: 1, pesos: { "R-18": 0.03, "R-12": 0.5, "R-9": 0.47 } },
];

/** Mezcla de una guirnalda baja: más carga donde nace y más fina hacia la punta. */
export const MEZCLA_GUIRNALDA: readonly PuntoMezcla[] = [
  { t: 0, pesos: { "R-18": 0.2, "R-12": 0.5, "R-9": 0.3 } },
  { t: 1, pesos: { "R-18": 0.06, "R-12": 0.47, "R-9": 0.47 } },
];

/** Relleno de la técnica Sempertex: R-9 en los huecos grandes y tríos de R-5 en el resto. */
export const RELLENO_TUPIDO: readonly RellenoOrganico[] = [
  { formatoId: "R-9", infladoCm: 18, trios: false },
  { formatoId: "R-5", infladoCm: 12, trios: true },
];

export type OpcionesColumna = {
  id?: string;
  nombre?: string;
  /** Alto total, del piso a la cara de arriba de los globos de la punta. */
  altoCm: number;
  radioBaseCm: number;
  radioMedioCm: number;
  radioPuntaCm: number;
  /** Cuánto se corre la punta hacia +x (negativo: hacia -x). */
  inclinacionCm?: number;
  /** Amplitud de la S con que serpentea el eje. */
  serpenteoCm?: number;
  origen?: Vec3;
  mezcla?: readonly PuntoMezcla[];
  irregularidad?: number;
};

/** Columna orgánica: eje casi vertical del piso a la punta, gruesa abajo y fina arriba. */
export function formaColumna(o: OpcionesColumna): TramoOrganico {
  const origen = o.origen ?? vec(0, 0, 0);
  const inicio = o.radioBaseCm * 0.5;
  // La tapa de arriba es media esfera del radio de la punta (×0,8): el eje acaba ese tanto por debajo del alto.
  const fin = o.altoCm - o.radioPuntaCm * 0.8;
  const recorrido: Vec3[] = [];
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    recorrido.push(vec(origen.x + (o.inclinacionCm ?? 0) * f * f + (o.serpenteoCm ?? 0) * Math.sin(Math.PI * 2 * f), origen.y + inicio + (fin - inicio) * f, origen.z));
  }
  return {
    id: o.id ?? "columna",
    nombre: o.nombre ?? "Columna orgánica",
    recorrido,
    grosor: [
      { t: 0, radioCm: o.radioBaseCm },
      { t: 0.15, radioCm: o.radioBaseCm },
      { t: 0.5, radioCm: o.radioMedioCm },
      { t: 0.9, radioCm: o.radioPuntaCm },
      { t: 1, radioCm: o.radioPuntaCm * 0.8 },
    ],
    mezcla: o.mezcla ?? MEZCLA_COLUMNA_GRUESA,
    irregularidad: o.irregularidad ?? 0.12,
    tapas: { fin: true },
  };
}

/** Guirnalda: cualquier recorrido 3D, con el grosor que va de `radioInicioCm` a `radioFinCm`. */
export function formaGuirnalda(o: { id?: string; nombre?: string; puntos: readonly Vec3[]; radioInicioCm: number; radioFinCm: number; mezcla?: readonly PuntoMezcla[]; irregularidad?: number }): TramoOrganico {
  return {
    id: o.id ?? "guirnalda",
    nombre: o.nombre ?? "Guirnalda orgánica",
    recorrido: o.puntos,
    grosor: [
      { t: 0, radioCm: o.radioInicioCm },
      { t: 0.85, radioCm: o.radioFinCm },
      { t: 1, radioCm: o.radioFinCm * 0.8 },
    ],
    mezcla: o.mezcla ?? MEZCLA_GUIRNALDA,
    irregularidad: o.irregularidad ?? 0.14,
    tapas: { fin: true },
  };
}

/** Semiarco: sube del piso en `origen` y se curva hasta quedar horizontal a `altoCm`, `anchoCm` más allá (en +x). */
export function formaSemiarco(o: { id?: string; nombre?: string; anchoCm: number; altoCm: number; radioBaseCm: number; radioPuntaCm: number; origen?: Vec3; mezcla?: readonly PuntoMezcla[]; irregularidad?: number }): TramoOrganico {
  const origen = o.origen ?? vec(0, 0, 0);
  const recorrido: Vec3[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    recorrido.push(vec(origen.x + o.anchoCm * (1 - Math.cos(a)), origen.y + o.radioBaseCm * 0.5 + (o.altoCm - o.radioPuntaCm - o.radioBaseCm * 0.5) * Math.sin(a), origen.z));
  }
  return {
    id: o.id ?? "semiarco",
    nombre: o.nombre ?? "Semiarco orgánico",
    recorrido,
    grosor: [
      { t: 0, radioCm: o.radioBaseCm },
      { t: 0.2, radioCm: o.radioBaseCm },
      { t: 0.9, radioCm: o.radioPuntaCm },
      { t: 1, radioCm: o.radioPuntaCm * 0.8 },
    ],
    mezcla: o.mezcla ?? MEZCLA_COLUMNA_GRUESA,
    irregularidad: o.irregularidad ?? 0.12,
    tapas: { fin: true },
  };
}

