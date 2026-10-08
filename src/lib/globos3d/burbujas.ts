import type { Vec3 } from "./modulos";
import type { GloboDecoracion, ParteGlobo, TuboDecoracion } from "./decoraciones";
import { centroCuerpo, perfilRedondo, type PuntoPerfil } from "./geometria";

/**
 * **Globo burbuja y globo dentro de globo**, por propiedades: un globo transparente (R-18, R-24 o R-36 Cristal
 * Transparente 390, el látex cristal de Sempertex; el «Deco Bubble» de plástico no es de Sempertex ni está en su
 * tienda) con globos pequeños dentro (R-5, R-9…, de varios colores y cantidades), y si se quiere un relleno de
 * confeti o de plumas. Es lo que llevan 58 «Ideas de fiesta» (columnas rematadas en burbuja, centros de mesa, el
 * «doble globo» de un ramo).
 *
 * - **Exterior**: el nudo en el origen y el cuerpo hacia arriba (+z, el espacio de las decoraciones de pie): se apoya
 *   en el piso o encima de una columna.
 * - **Interiores**: se meten de grande a chico y cada uno cae al sitio libre más bajo (se amontonan abajo, como en la
 *   foto), sin montarse entre ellos y sin atravesar el exterior: cada uno se toma como una esfera de su alto (0,54 del
 *   inflado) más su nudo, y se comprueba contra el perfil real del exterior (`perfilRedondo`) con el grueso del látex.
 * - **Relleno**: confeti (papelitos pegados por la estática a la pared de adentro, más abajo que arriba) o plumas
 *   sueltas. No es globo ni se cotiza: va como papel (mate).
 *
 * El visor dibuja el cristal con transmisión: lo de adentro se ve a través. Todo determinista (`semilla`). Unidades: cm.
 */
export type InteriorBurbuja = { formatoId: string; infladoCm: number; /** En ciclo: un color, o varios repartidos. */ codigos: string[]; cantidad: number };

export type RellenoBurbuja =
  | { tipo: "confeti"; /** Colores en ciclo (papel metalizado o de color). */ colores: string[]; cantidad: number; tamanoCm?: number }
  | { tipo: "plumas"; colores: string[]; cantidad: number; largoCm?: number };

export type PropiedadesBurbuja = {
  /** El globo de fuera: un redondo transparente (390 Cristal Transparente). */
  exterior: ParteGlobo;
  interiores: InteriorBurbuja[];
  relleno: RellenoBurbuja | null;
  semilla: number;
};

export type DecoracionBurbuja = { tipo: "burbuja"; propiedades: PropiedadesBurbuja };

export type BurbujaArmada = {
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  /** Cuántos interiores entraron (si se piden más de los que caben, los que sobran no se ponen y se dice aquí). */
  colocados: number;
  pedidos: number;
  radioCm: number;
  fondoCm: number;
  altoCm: number;
};

/** Grueso de la pared de látex del exterior (lo de adentro no lo toca). */
export const PARED_BURBUJA_CM = 0.4;
/** Holgura de más al colocar: el perfil se mira en 24 giros y entre dos de ellos el globo puede asomar un poco más. */
const HOLGURA_CM = 0.15;
/**
 * Cuánto se pueden acercar dos globos de adentro, en fracción de la suma de sus radios: el látex cede y se aprietan un
 * poco (como al meterlos a presión por la boca).
 */
export const APRIETE = 0.9;
/** Cuánto del inflado mide un globo desde su centro hasta su punta (el cuerpo es un 8 % más alto que ancho). */
export const SEMIEJE_GLOBO = 0.54;

const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const mas = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const por = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const unitario = (a: Vec3): Vec3 => { const n = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };
const redondo = (p: Vec3): Vec3 => ({ x: r3(p.x), y: r3(p.y), z: r3(p.z) });
const distancia = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Azar determinista. */
function azar(semilla: number): () => number {
  let x = (Math.round(semilla) * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1000003) / 1000003; };
}

/** Direcciones repartidas por igual en la esfera (espiral de Fibonacci). */
export function direccionesEsfera(n: number): Vec3[] {
  const salida: Vec3[] = [];
  const oro = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n;
    const s = Math.sqrt(1 - z * z);
    salida.push({ x: Math.cos(i * oro) * s, y: Math.sin(i * oro) * s, z });
  }
  return salida;
}

/** Radio del perfil torneado a la altura `h` sobre el nudo (−1 fuera de él). */
export function radioDelPerfil(perfil: readonly PuntoPerfil[], h: number): number {
  if (h < 0) return -1;
  for (let i = 1; i < perfil.length; i++) {
    const a = perfil[i - 1]!, b = perfil[i]!;
    if (h >= a.y && h <= b.y) return b.y - a.y < 1e-9 ? Math.max(a.r, b.r) : a.r + ((b.r - a.r) * (h - a.y)) / (b.y - a.y);
  }
  return -1;
}

/** ¿El punto (en el espacio de la burbuja: nudo en el origen, eje +z) queda dentro del exterior, a `margen` de su pared? */
export function puntoDentro(perfil: readonly PuntoPerfil[], p: Vec3, margen: number): boolean {
  const r = radioDelPerfil(perfil, p.z);
  return r >= 0 && Math.hypot(p.x, p.y) <= r - margen;
}

const GIROS_PERFIL = 24;

/**
 * ¿Un globo (nudo, dirección, inflado) queda entero dentro del exterior, a `margen` de su pared? Se mira su perfil
 * torneado real (`perfilRedondo`: nudo, cuello y cuerpo) en 24 giros alrededor de su eje; `soloCuerpo` no mira el nudo
 * ni el cuello (el doble globo: los dos nudos se amarran juntos en la boca).
 */
export function globoDentro(perfilExterior: readonly PuntoPerfil[], g: Pick<GloboDecoracion, "nudo" | "direccion" | "infladoCm" | "cuelloExtraCm">, margen: number, soloCuerpo = false): boolean {
  const e = unitario(g.direccion);
  const aux: Vec3 = Math.abs(e.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u = unitario({ x: aux.y * e.z - aux.z * e.y, y: aux.z * e.x - aux.x * e.z, z: aux.x * e.y - aux.y * e.x });
  const v = { x: e.y * u.z - e.z * u.y, y: e.z * u.x - e.x * u.z, z: e.x * u.y - e.y * u.x };
  // El perfil empieza por el nudo (4 puntos) y el cuello (1): en el doble globo el nudo sale por la boca del de fuera.
  for (const q of perfilRedondo(g.infladoCm, g.cuelloExtraCm).slice(soloCuerpo ? 5 : 0)) {
    const eje = mas(g.nudo, por(e, q.y));
    if (q.r < 1e-6) { if (!puntoDentro(perfilExterior, eje, margen)) return false; continue; }
    for (let k = 0; k < GIROS_PERFIL; k++) {
      const a = (2 * Math.PI * k) / GIROS_PERFIL;
      if (!puntoDentro(perfilExterior, mas(eje, mas(por(u, q.r * Math.cos(a)), por(v, q.r * Math.sin(a)))), margen)) return false;
    }
  }
  return true;
}

/** El cuerpo de un globo interior como esfera (para que no se monten entre ellos): centro y radio de su alto. */
export function cuerpoDeInterior(g: GloboDecoracion): { centro: Vec3; radio: number } {
  const c = centroCuerpo("redondo", g.infladoCm) + g.cuelloExtraCm;
  return { centro: mas(g.nudo, por(unitario(g.direccion), c)), radio: g.infladoCm * SEMIEJE_GLOBO };
}

/** Un papelito (hexágono) de `lado` cm, plano, con su cara hacia `normal`. */
function papelito(centro: Vec3, normal: Vec3, lado: number, giro: number): Vec3[] {
  const n = unitario(normal);
  const aux: Vec3 = Math.abs(n.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const u = unitario({ x: aux.y * n.z - aux.z * n.y, y: aux.z * n.x - aux.x * n.z, z: aux.x * n.y - aux.y * n.x });
  const v = { x: n.y * u.z - n.z * u.y, y: n.z * u.x - n.x * u.z, z: n.x * u.y - n.y * u.x };
  return Array.from({ length: 6 }, (_, k) => {
    const a = giro + (k * Math.PI) / 3;
    return redondo(mas(centro, mas(por(u, lado * Math.cos(a)), por(v, lado * Math.sin(a)))));
  });
}

/** Una pluma: una hoja alargada y un poco curva (contorno cerrado), de `largo` cm, a lo largo de `eje`. */
function pluma(centro: Vec3, eje: Vec3, curva: Vec3, largo: number): Vec3[] {
  const e = unitario(eje);
  const c = unitario(curva);
  const ancho = largo * 0.17;
  const lado = unitario({ x: e.y * c.z - e.z * c.y, y: e.z * c.x - e.x * c.z, z: e.x * c.y - e.y * c.x });
  const puntos: Vec3[] = [];
  const n = 8;
  for (const s of [1, -1]) {
    for (let i = 0; i <= n; i++) {
      const t = s > 0 ? i / n : 1 - i / n;
      const a = (t - 0.5) * largo;
      // Más ancha cerca de la punta (como una pluma de verdad) y combada hacia `curva`.
      const w = ancho * Math.sin(Math.PI * Math.min(1, t * 1.15)) * s;
      const comba = largo * 0.12 * (1 - (2 * t - 1) ** 2);
      puntos.push(redondo(mas(centro, mas(por(e, a), mas(por(lado, w), por(c, comba))))));
    }
  }
  return puntos.slice(0, -1);
}

/** Arma la burbuja: el exterior, los interiores amontonados abajo y el relleno. */
export function armarBurbuja(p: PropiedadesBurbuja): BurbujaArmada {
  const D = Math.max(10, p.exterior.infladoCm);
  const perfil = perfilRedondo(D);
  const centroExt = centroCuerpo("redondo", D);
  const globos: GloboDecoracion[] = [{ formatoId: p.exterior.formatoId, infladoCm: D, codigo: p.exterior.codigo, nudo: { x: 0, y: 0, z: 0 }, direccion: { x: 0, y: 0, z: 1 }, cuelloExtraCm: 0 }];
  const tubos: TuboDecoracion[] = [];
  const r = azar(p.semilla + 1);

  // Interiores: de grande a chico, cada uno en el sitio libre más bajo que encuentre entre muchos candidatos.
  const pedidosLista = p.interiores.flatMap((i) => Array.from({ length: Math.max(0, Math.round(i.cantidad)) }, (_, k) => ({
    formatoId: i.formatoId, infladoCm: Math.max(4, i.infladoCm), codigo: i.codigos[k % Math.max(1, i.codigos.length)] ?? "005",
  })));
  // Los colores se intercalan (no todos los rojos juntos abajo): orden estable por tamaño y, dentro, alternando.
  const pedidos = pedidosLista.map((g, k) => ({ g, k })).sort((a, b) => b.g.infladoCm - a.g.infladoCm || ((a.k * 7) % 11) - ((b.k * 7) % 11) || a.k - b.k).map((x) => x.g);
  const puestos: Array<{ centro: Vec3; radio: number }> = [];
  const candidatos: Vec3[] = [];
  for (let i = 0; i < 3000; i++) {
    const h = r() * D * 1.1;
    const a = r() * Math.PI * 2, s = Math.sqrt(r());
    const rr = radioDelPerfil(perfil, h);
    if (rr <= 0) continue;
    candidatos.push({ x: Math.cos(a) * s * rr, y: Math.sin(a) * s * rr, z: h });
  }
  // Un solo interior grande (más de 0,6 del exterior) es el «doble globo»: se infla adentro, con el nudo junto al del
  // exterior y el mismo eje; si no cabe entero, se infla un poco menos.
  const unico = pedidos.length === 1 ? pedidos[0]! : null;
  if (unico && unico.infladoCm > D * 0.6) {
    // El más grande que quepa: el de adentro sube un poco (su cuello se estira hasta la boca, donde van los dos nudos).
    const arriba = { x: 0, y: 0, z: 1 };
    let puesto: GloboDecoracion | null = null;
    for (let d = Math.min(unico.infladoCm, D - 2 * PARED_BURBUJA_CM); d > D * 0.3 && !puesto; d -= D * 0.01) {
      for (let dz = 0; dz <= D * 0.4 && !puesto; dz += 0.25) {
        const g = { nudo: { x: 0, y: 0, z: r2(dz) }, direccion: arriba, infladoCm: r2(d), cuelloExtraCm: 0 };
        if (globoDentro(perfil, g, PARED_BURBUJA_CM + HOLGURA_CM, true)) puesto = { ...g, formatoId: unico.formatoId, codigo: unico.codigo };
      }
    }
    if (puesto) globos.push(puesto);
  } else {
    for (const g of pedidos) {
      const radio = g.infladoCm * SEMIEJE_GLOBO;
      const cuello = centroCuerpo("redondo", g.infladoCm);
      let mejor: { centro: Vec3; dir: Vec3; puntaje: number } | null = null;
      for (const c of candidatos) {
        // Lo más bajo posible; a igual altura, más cerca del eje. Lo que ya no mejora ni se mira.
        const puntaje = c.z + Math.hypot(c.x, c.y) * 0.15;
        if (mejor && puntaje >= mejor.puntaje) continue;
        if (puestos.some((q) => distancia(q.centro, c) < (q.radio + radio) * APRIETE)) continue;
        if (!puntoDentro(perfil, c, PARED_BURBUJA_CM + radio * 0.9)) continue;
        // La boca mira a un lado cualquiera (determinista), un poco hacia arriba.
        const giro = Math.abs(c.x * 13.7 + c.y * 7.3 + c.z * 3.1) % (Math.PI * 2);
        const dir = unitario({ x: Math.cos(giro), y: Math.sin(giro), z: 0.6 });
        if (!globoDentro(perfil, { nudo: mas(c, por(dir, -cuello)), direccion: dir, infladoCm: g.infladoCm, cuelloExtraCm: 0 }, PARED_BURBUJA_CM + HOLGURA_CM)) continue;
        mejor = { centro: c, dir, puntaje };
      }
      if (!mejor) continue;
      puestos.push({ centro: mejor.centro, radio });
      globos.push({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: redondo(mas(mejor.centro, por(mejor.dir, -cuello))), direccion: redondo(mejor.dir), cuelloExtraCm: 0 });
    }
  }

  // Relleno: papel (no se cotiza). Confeti pegado a la pared de adentro; plumas sueltas.
  const relleno = p.relleno;
  if (relleno && relleno.cantidad > 0 && relleno.colores.length) {
    const n = Math.min(400, Math.round(relleno.cantidad));
    for (let k = 0; k < n; k++) {
      const hex = relleno.colores[k % relleno.colores.length]!;
      if (relleno.tipo === "confeti") {
        const lado = Math.max(0.3, relleno.tamanoCm ?? 0.8) / 2;
        // Más abajo que arriba (la estática y el peso), pero por todo el globo.
        const z = Math.max(-0.95, Math.min(0.95, 1 - 2 * Math.pow(r(), 0.7)));
        const a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
        const dir: Vec3 = { x: Math.cos(a) * s, y: Math.sin(a) * s, z: z * 1.08 };
        // Pegado a la pared: el punto de la pared en esa dirección (desde el centro), un poco hacia adentro.
        let lo = 0, hi = D;
        for (let i = 0; i < 24; i++) {
          const m = (lo + hi) / 2;
          if (puntoDentro(perfil, mas({ x: 0, y: 0, z: centroExt }, por(dir, m)), PARED_BURBUJA_CM + lado + 0.1)) lo = m; else hi = m;
        }
        const c = mas({ x: 0, y: 0, z: centroExt }, por(dir, lo));
        tubos.push({ formatoId: "papel", grosorCm: 0.12, codigo: "papel", puntos: papelito(c, dir, lado, r() * Math.PI), cerrado: true, papel: { hex, relleno: true } });
      } else {
        const largo = Math.max(3, relleno.largoCm ?? 7);
        for (let intento = 0; intento < 40; intento++) {
          const c = candidatos[Math.floor(r() * candidatos.length)]!;
          const eje = unitario({ x: r() - 0.5, y: r() - 0.5, z: r() - 0.5 });
          const curva = unitario({ x: r() - 0.5, y: r() - 0.5, z: r() - 0.5 });
          const puntos = pluma(c, eje, curva, largo);
          if (!puntos.every((q) => puntoDentro(perfil, q, PARED_BURBUJA_CM + 0.2))) continue;
          tubos.push({ formatoId: "papel", grosorCm: 0.2, codigo: "papel", puntos, cerrado: true, papel: { hex, relleno: true } });
          break;
        }
      }
    }
  }

  const alto = perfil.reduce((m, q) => Math.max(m, q.y), 0);
  return { globos, tubos, colocados: globos.length - 1, pedidos: pedidos.length, radioCm: r2(Math.max(D / 2, alto / 2)), fondoCm: r2(D / 2), altoCm: r2(alto) };
}

/** Qué es, en inglés y corto (para la foto con IA). */
export function burbujaEnIngles(p: PropiedadesBurbuja): string {
  const dentro = p.interiores.reduce((s, i) => s + i.cantidad, 0);
  const relleno = p.relleno ? (p.relleno.tipo === "confeti" ? " and confetti" : " and feathers") : "";
  return `a clear bubble balloon with ${dentro > 0 ? `${dentro} small balloons` : "nothing"}${relleno} inside`;
}

const R = (formatoId: string, infladoCm: number, codigo: string): ParteGlobo => ({ formatoId, infladoCm, codigo });

/** Burbujas de partida (todo se cambia por propiedades). */
export const BURBUJAS_PREDEFINIDAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; decoracion: DecoracionBurbuja }> = [
  {
    id: "burbuja_r5_pastel", nombre: "Burbuja con R-5 pastel", descripcion: "R-24 Cristal Transparente con 14 R-5 Pastel Mate rosado, amarillo, verde y azul dentro.",
    decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-24", 50, "390"), interiores: [{ formatoId: "R-5", infladoCm: 11, codigos: ["609", "620", "630", "640"], cantidad: 14 }], relleno: null, semilla: 3 } },
  },
  {
    id: "burbuja_confeti_dorado", nombre: "Burbuja con confeti dorado", descripcion: "R-18 Cristal Transparente con confeti dorado pegado por dentro y 3 R-5 Reflex Dorado.",
    decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-18", 40, "390"), interiores: [{ formatoId: "R-5", infladoCm: 10, codigos: ["970"], cantidad: 3 }], relleno: { tipo: "confeti", colores: ["#c9a24a", "#e3c77a"], cantidad: 70, tamanoCm: 0.9 }, semilla: 5 } },
  },
  {
    id: "burbuja_plumas", nombre: "Burbuja con plumas", descripcion: "R-24 Cristal Transparente con plumas blancas y rosadas sueltas y 4 R-5 Fashion Rosado.",
    decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-24", 50, "390"), interiores: [{ formatoId: "R-5", infladoCm: 10, codigos: ["009"], cantidad: 4 }], relleno: { tipo: "plumas", colores: ["#ffffff", "#f6c6d4"], cantidad: 12, largoCm: 8 }, semilla: 7 } },
  },
  {
    id: "doble_globo", nombre: "Globo dentro de globo", descripcion: "Un R-12 Cristal Transparente con un R-9 Satín Plata dentro (el «doble globo» de los ramos).",
    decoracion: { tipo: "burbuja", propiedades: { exterior: R("R-12", 28, "390"), interiores: [{ formatoId: "R-9", infladoCm: 21, codigos: ["481"], cantidad: 1 }], relleno: null, semilla: 1 } },
  },
];
