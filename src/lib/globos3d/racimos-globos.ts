import type { Vec3 } from "./modulos";
import type { GloboDecoracion, ParteGlobo, TuboDecoracion } from "./decoraciones";
import { centroCuerpo } from "./geometria";

/**
 * **Racimos y totems** de las fotos de Pinterest que no eran ni flor ni burbuja (2026-10-08):
 * - **Racimo**: globitos (casi siempre R-5) amarrados juntos —
 *   - `uvas`: el racimo de uvas dorado que va metido en las columnas de graduación (filas que se angostan hacia abajo);
 *   - `bola`: una media bola compacta (el acento de R-5 en una guirnalda);
 *   - `collar`: un anillo de globitos (el cuello de un orbz, la base de un remate).
 * - **Orbe**: el totem del «orbz» de la foto de los arcos rojos: una esfera grande brillante con un collar de globitos y
 *   flecos que cuelgan hasta abajo. La esfera de foil 4D no es de Sempertex: va como un R-24 Reflex (el látex espejo
 *   más parecido) y los flecos como tubitos casi sin inflar (los de la cortina metálica no son producto Sempertex).
 *
 * Espacio de las decoraciones (el de `figuras.ts`): la cara mira a +y y, de frente o sobre una superficie, +z es arriba.
 * El racimo va tendido en xz con su cara abombada hacia +y y las uvas cuelgan hacia −z; el orbe va de pie (`deFrente`):
 * la esfera hacia +z y los flecos hacia −z. Todo determinista (`semilla`). Unidades: cm.
 */
export type FormaRacimo = "uvas" | "bola" | "collar";

export type PropiedadesRacimo = { forma: FormaRacimo; globo: { formatoId: string; infladoCm: number }; codigos: string[]; cantidad: number; semilla: number };
export type DecoracionRacimo = { tipo: "racimo"; propiedades: PropiedadesRacimo };

export type PropiedadesOrbe = {
  esfera: ParteGlobo;
  collar: (ParteGlobo & { cantidad: number }) | null;
  flecos: { codigos: string[]; tiras: number; largoCm: number } | null;
};
export type DecoracionOrbe = { tipo: "orbe"; propiedades: PropiedadesOrbe };

export type RacimoArmado = { globos: GloboDecoracion[]; tubos: TuboDecoracion[]; radioCm: number; fondoCm: number };

const v = (x: number, y: number, z: number): Vec3 => ({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(z * 10) / 10 });
const unit = (p: Vec3): Vec3 => { const n = Math.hypot(p.x, p.y, p.z) || 1; return { x: p.x / n, y: p.y / n, z: p.z / n }; };

/** Un globo con el centro de su cuerpo en `c`, el cuerpo hacia `dir` (el nudo detrás, hacia el amarre). */
function globoEn(c: Vec3, dir: Vec3, formatoId: string, infladoCm: number, codigo: string): GloboDecoracion {
  const d = unit(dir), k = centroCuerpo("redondo", infladoCm);
  return { formatoId, infladoCm, codigo, nudo: v(c.x - d.x * k, c.y - d.y * k, c.z - d.z * k), direccion: d, cuelloExtraCm: 0 };
}

/** Filas del racimo de uvas: de la de arriba (la más ancha) a la punta, que suman `n`. */
function filasUvas(n: number): number[] {
  const filas: number[] = [];
  let ancho = Math.max(2, Math.round(Math.sqrt(n * 1.1)));
  let quedan = n;
  while (quedan > 0) {
    const fila = Math.min(quedan, Math.max(1, ancho));
    filas.push(fila);
    quedan -= fila;
    if (filas.length % 2 === 0) ancho -= 1;
  }
  return filas;
}

/** El racimo se arma en xy con la cara hacia +z y aquí pasa a su espacio de decoración (y ↔ z): cara a +y, uvas hacia −z. */
export function armarRacimo(p: PropiedadesRacimo): RacimoArmado {
  const r = racimoEnPlano(p);
  const cambio = (q: Vec3): Vec3 => ({ x: q.x, y: q.z, z: q.y });
  return { ...r, globos: r.globos.map((g) => ({ ...g, nudo: cambio(g.nudo), direccion: cambio(g.direccion) })) };
}

function racimoEnPlano(p: PropiedadesRacimo): RacimoArmado {
  const { formatoId, infladoCm } = p.globo;
  const n = Math.max(1, Math.min(80, Math.round(p.cantidad)));
  const codigos = p.codigos.length ? p.codigos : ["970"];
  const r = infladoCm / 2;
  const paso = infladoCm * 0.88;
  const globos: GloboDecoracion[] = [];
  const color = (i: number) => codigos[(i + p.semilla) % codigos.length]!;
  if (p.forma === "uvas") {
    const filas = filasUvas(n);
    let i = 0;
    filas.forEach((cuantos, f) => {
      for (let k = 0; k < cuantos; k++) {
        // Un poco de desorden (determinista): un racimo real no queda en filas perfectas.
        const h = (((i + 1) * 0.6180339887 + p.semilla * 0.3819660113) % 1) - 0.5;
        const x = (k - (cuantos - 1) / 2 + (f % 2 ? 0.25 : -0.25)) * paso + h * r * 0.12;
        const y = -f * paso * 0.82 + h * r * 0.1;
        // Los del medio un poco más afuera: el racimo es abombado, no plano.
        const z = r + (cuantos > 2 && k > 0 && k < cuantos - 1 ? r * 0.35 : 0) + Math.abs(h) * r * 0.3;
        globos.push(globoEn(v(x, y, z), { x: x * 0.15, y: -0.2, z: 1 }, formatoId, infladoCm, color(i++)));
      }
    });
    const ancho = Math.max(...filas) * paso;
    return { globos, tubos: [], radioCm: Math.max(ancho / 2, (filas.length * paso * 0.82) / 2) + r, fondoCm: r * 0.4 };
  }
  if (p.forma === "collar") {
    const radio = Math.max(r * 1.2, (n * paso) / (2 * Math.PI));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      globos.push(globoEn(v(Math.cos(a) * radio, Math.sin(a) * radio, r * 0.7), { x: Math.cos(a), y: Math.sin(a), z: 0.6 }, formatoId, infladoCm, color(i)));
    }
    return { globos, tubos: [], radioCm: radio + r, fondoCm: r * 0.3 };
  }
  // Bola: media esfera de Fibonacci (la cara redonda hacia fuera).
  const radio = Math.max(r, paso * Math.sqrt(n / 4));
  for (let i = 0; i < n; i++) {
    const z = 1 - (i + 0.5) / n, s = Math.sqrt(1 - z * z), a = i * 2.39996;
    const d = { x: Math.cos(a) * s, y: Math.sin(a) * s, z };
    globos.push(globoEn(v(d.x * radio, d.y * radio, d.z * radio + r * 0.3), d, formatoId, infladoCm, color(i)));
  }
  return { globos, tubos: [], radioCm: radio + r, fondoCm: r * 0.3 };
}

/**
 * El orbe de pie (+z arriba): la esfera arriba, el collar bajo ella y los flecos que cuelgan desde el collar. El nudo de
 * la esfera en el origen: se apoya como un remate (encima de una columna) o se cuelga.
 */
export function armarOrbe(p: PropiedadesOrbe): RacimoArmado {
  const globos: GloboDecoracion[] = [];
  const tubos: TuboDecoracion[] = [];
  const { formatoId, infladoCm, codigo } = p.esfera;
  globos.push({ formatoId, infladoCm, codigo, nudo: v(0, 0, 0), direccion: { x: 0, y: 0, z: 1 }, cuelloExtraCm: 0 });
  const radioEsfera = infladoCm / 2;
  if (p.collar) {
    const c = p.collar, n = Math.max(3, Math.round(c.cantidad)), rc = c.infladoCm / 2;
    const radio = Math.max(rc * 1.3, radioEsfera * 0.45);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      globos.push(globoEn(v(Math.cos(a) * radio, Math.sin(a) * radio, rc * 0.6), { x: Math.cos(a), y: Math.sin(a), z: -0.3 }, c.formatoId, c.infladoCm, c.codigo));
    }
  }
  if (p.flecos) {
    const f = p.flecos, n = Math.max(4, Math.min(60, Math.round(f.tiras)));
    // Tiras finas (tubitos casi sin inflar) que caen rectas, con un leve vaivén, desde un círculo bajo el collar.
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, rr = radioEsfera * 0.3 * (0.6 + ((k * 0.618) % 1) * 0.4);
      const largo = f.largoCm * (0.85 + ((k * 0.381) % 1) * 0.15);
      const puntos: Vec3[] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        puntos.push(v(Math.cos(a) * rr + Math.sin(t * 7 + k) * 1.2 * t, Math.sin(a) * rr + Math.cos(t * 5 + k) * 1.2 * t, -2 - largo * t));
      }
      tubos.push({ formatoId: "T-260", grosorCm: 0.8, codigo: f.codigos[k % f.codigos.length] ?? "970", puntos, cerrado: false });
    }
  }
  return { globos, tubos, radioCm: radioEsfera, fondoCm: p.flecos ? p.flecos.largoCm : 0 };
}

export const racimoEnIngles = (p: PropiedadesRacimo) =>
  p.forma === "uvas" ? "a small grape-like cluster of tiny balloons" : p.forma === "collar" ? "a ring of small balloons" : "a small round cluster of tiny balloons";

export const orbeEnIngles = (p: PropiedadesOrbe) =>
  `a big shiny metallic sphere balloon${p.collar ? " with a collar of small balloons" : ""}${p.flecos ? " and a long metallic fringe tassel hanging below it" : ""}`;

const R5 = (codigo: string) => ({ formatoId: "R-5", infladoCm: 11, codigo });

export const RACIMOS_PREDEFINIDOS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; decoracion: DecoracionRacimo | DecoracionOrbe }> = [
  {
    id: "racimo_uvas_dorado", nombre: "Racimo de uvas dorado", descripcion: "Dieciocho R-5 Reflex Dorado en racimo de uvas: el acento de las columnas de graduación.",
    decoracion: { tipo: "racimo", propiedades: { forma: "uvas", globo: { formatoId: "R-5", infladoCm: 11 }, codigos: ["970"], cantidad: 18, semilla: 1 } },
  },
  {
    id: "racimo_bola_r5", nombre: "Bolita de R-5", descripcion: "Nueve R-5 en media bola compacta, para salpicar una guirnalda.",
    decoracion: { tipo: "racimo", propiedades: { forma: "bola", globo: { formatoId: "R-5", infladoCm: 11 }, codigos: ["970"], cantidad: 9, semilla: 2 } },
  },
  {
    id: "collar_r5", nombre: "Collar de R-5", descripcion: "Anillo de ocho R-5 Reflex Dorado (el cuello de un remate).",
    decoracion: { tipo: "racimo", propiedades: { forma: "collar", globo: { formatoId: "R-5", infladoCm: 11 }, codigos: ["970"], cantidad: 8, semilla: 3 } },
  },
  {
    id: "orbe_flecos_dorado", nombre: "Orbe dorado con flecos", descripcion: "Esfera brillante (R-24 Reflex Dorado en lugar del orbz de foil) con collar de R-5 dorados y flecos dorados de 90 cm.",
    decoracion: { tipo: "orbe", propiedades: { esfera: { formatoId: "R-24", infladoCm: 50, codigo: "970" }, collar: { ...R5("970"), cantidad: 8 }, flecos: { codigos: ["970"], tiras: 28, largoCm: 90 } } },
  },
];
