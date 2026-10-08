import { formatoPorId, infladoValido } from "./formatos";
import type { Vec3 } from "./modulos";
import type { GloboDecoracion, TuboDecoracion } from "./decoraciones";
import { materialesDecoracion, type MaterialDecoracion } from "./figuras";
import { centroDe, exigirColor, globoEn } from "./letras";
import { altoPerfil, perfilLink, perfilRedondo } from "./geometria";
import { armarTrenza, RADIO_TRENZA_POR_DIAMETRO, type PatronTrenza, type Punto2 } from "./trenza";
import { armarMural } from "./murales";
import type { ElementoEscenografia } from "./escenografia";

/**
 * **Decoración de techo**: lo que va pegado o colgado del techo de la sala, en una sola pieza. Espacio local: el
 * techo es el plano y = 0 y todo cuelga por debajo (y ≤ 0); x a lo ancho y +z hacia quien mira, centrado. Se pone
 * con la colocación `techo` de la escena (con `cuelgaCm` 0, lo de más arriba toca el techo).
 *
 * Elementos:
 * - `red`: una malla o red de techo. `racimos`: cuadrícula de cuartetos (racimos de 4) pegados al techo, colgando
 *   hacia abajo y afuera; `malla`: Link-O-Loon con su unión R-5 (la malla del mural, `murales.ts`, tumbada boca abajo).
 * - `festones`: guirnaldas clásicas (trenza de cuartetos, `trenza.ts`) colgando en **catenaria** de punto a punto del
 *   techo (la curva de una cadena: y = a·(cosh(u/a) − 1)), con un globo de remate en cada punto si se pide. La
 *   guirnalda arranca y termina pegada al techo; con remate, se recorta para no meterse en él.
 * - `tira`: una tira vertical que cuelga de un hilo: globos (solos, en pareja, trío o cuarteto) de arriba abajo y,
 *   si se pide, flecos de tubito que bajan abriéndose y terminan en un racimito (la «lluvia de globos»).
 * - `helio`: globos de helio flotando contra el techo, con su cinta colgando (la cinta no es globo: escenografía).
 *
 * Los colores se exigen del formato: uno que no se fabrica es un error.
 */

export type GloboTecho = { formatoId: string; infladoCm: number };
export type PuntoTecho = { xCm: number; zCm: number };

export type ElementoTecho =
  | {
    tipo: "red"; tecnica: "racimos" | "malla"; anchoCm: number; fondoCm: number; globo: GloboTecho;
    /** Solo en la malla: la pareja de unión (R-5). */
    union?: { infladoCm: number; codigo: string } | null;
    colores: string[]; patron: "un_color" | "alternado" | "damero";
    /** Centro de la red (por defecto, el origen). */
    centro?: PuntoTecho;
  }
  | {
    tipo: "festones"; puntos: PuntoTecho[]; caidaCm: number;
    guirnalda: { formatoId: string; infladoCm: number; patron: PatronTrenza; colores: string[] };
    remate: { formatoId: string; infladoCm: number; codigo: string } | null;
  }
  | {
    tipo: "tira"; punto: PuntoTecho; hiloCm: number;
    globos: Array<{ formatoId: string; infladoCm: number; codigo: string; cantidad: 1 | 2 | 3 | 4 }>;
    flecos?: { formatoId: string; codigo: string; cantidad: number; largoCm: number; aperturaCm: number; racimo: { formatoId: string; infladoCm: number; codigos: string[]; globos: number } | null } | null;
  }
  | { tipo: "helio"; puntos: PuntoTecho[]; globo: GloboTecho; codigos: string[]; cintaCm: number; cintaHex: string };

export type OpcionesTecho = { elementos: ElementoTecho[] };

/** El eje de cada festón (la catenaria) y qué globos son los suyos: para comprobar que no atraviesa otros globos. */
export type CatenariaTecho = { puntos: Vec3[]; desde: number; hasta: number };

export type TechoArmado = {
  globos: GloboDecoracion[];
  tubos: TuboDecoracion[];
  escenografia: ElementoEscenografia[];
  anclas: Array<{ posicion: Vec3; normal: Vec3 }>;
  materiales: MaterialDecoracion[];
  catenarias: CatenariaTecho[];
};

const r1 = (n: number) => Math.round(n * 10) / 10 + 0;
const v = (x: number, y: number, z: number): Vec3 => ({ x: r1(x), y: r1(y), z: r1(z) });
const unitario = (a: Vec3): Vec3 => { const n = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };
const ABAJO: Vec3 = { x: 0, y: -1, z: 0 };

/** Del nudo a la punta del cuerpo (cm): lo que mide un globo colgado de su nudo. */
const largoGlobo = (tipo: "redondo" | "link", d: number) => altoPerfil(tipo === "link" ? perfilLink(d) : perfilRedondo(d));
/** Un globo colgando de su nudo (el nudo arriba, en `nudo`). */
const colgando = (formatoId: string, d: number, codigo: string, nudo: Vec3): GloboDecoracion => ({ formatoId, infladoCm: d, codigo, nudo: v(nudo.x, nudo.y, nudo.z), direccion: ABAJO, cuelloExtraCm: 0 });

function formato(id: string, tipo?: "redondo" | "link" | "tubito") {
  const f = formatoPorId(id);
  if (!f) throw new Error(`Formato desconocido: ${id}`);
  if (tipo && f.tipo !== tipo) throw new Error(`${id} no es ${tipo === "redondo" ? "un globo redondo" : tipo === "link" ? "un Link-O-Loon" : "un tubito"}.`);
  return f;
}

/**
 * La catenaria de dos puntos a la misma altura separados `luz` cm que cuelga `caida` cm en el medio: el parámetro
 * `a` de y = a·(cosh(x/a) − 1) (bisección: la caída baja al crecer `a`).
 */
export function parametroCatenaria(luz: number, caida: number): number {
  const mitad = luz / 2;
  if (caida <= 0) return Infinity;
  let lo = 1e-3, hi = 1e7;
  for (let k = 0; k < 200; k++) {
    const a = Math.sqrt(lo * hi);
    const c = a * (Math.cosh(mitad / a) - 1);
    if (c > caida) lo = a; else hi = a;
  }
  return Math.sqrt(lo * hi);
}

/** La catenaria muestreada (u de 0 a luz, y ≤ 0 respecto a los extremos). */
export function puntosCatenaria(luz: number, caida: number, n = 60): Punto2[] {
  const a = parametroCatenaria(luz, caida);
  const mitad = luz / 2;
  const fondo = Number.isFinite(a) ? a * (Math.cosh(mitad / a) - 1) : 0;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = (luz * i) / n;
    const y = Number.isFinite(a) ? a * (Math.cosh((u - mitad) / a) - 1) - fondo : 0;
    return { x: u, y };
  });
}

function colorRed(patron: "un_color" | "alternado" | "damero", colores: readonly string[], i: number, j: number, k: number): string {
  const c = (n: number) => colores[((n % colores.length) + colores.length) % colores.length]!;
  return patron === "un_color" ? c(0) : patron === "alternado" ? c(k) : c(i + j);
}

function armarRed(e: Extract<ElementoTecho, { tipo: "red" }>, globos: GloboDecoracion[], anclas: TechoArmado["anclas"]): void {
  if (!e.colores.length) throw new Error("La red de techo necesita al menos un color.");
  const cx = e.centro?.xCm ?? 0, cz = e.centro?.zCm ?? 0;
  if (e.tecnica === "racimos") {
    const f = formato(e.globo.formatoId, "redondo");
    const d = infladoValido(f, e.globo.infladoCm), r = d / 2;
    for (const c of e.colores) exigirColor(f.id, c);
    // Un cuarteto: cuatro globos en cuadrado (se tocan a 0,9 d), colgando hacia abajo y afuera.
    const rho = (0.9 * d) / Math.SQRT2;
    const paso = 2 * rho + 0.9 * d;
    const nx = Math.max(1, Math.floor(e.anchoCm / paso) + 1), nz = Math.max(1, Math.floor(e.fondoCm / paso) + 1);
    let k = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = cx + (i - (nx - 1) / 2) * paso, z = cz + (j - (nz - 1) / 2) * paso;
        const codigo = colorRed(e.patron, e.colores, i, j, k++);
        for (let q = 0; q < 4; q++) {
          const a = Math.PI / 4 + (q * Math.PI) / 2;
          const radial = { x: Math.cos(a), y: 0, z: Math.sin(a) };
          globos.push(globoEn(f.id, d, codigo, v(x + radial.x * rho, -r, z + radial.z * rho), unitario({ x: radial.x, y: -0.6, z: radial.z })));
        }
        anclas.push({ posicion: v(x, -d * 0.9, z), normal: ABAJO });
      }
    }
    return;
  }
  // Malla Link-O-Loon: la del mural, de un color por patrón, tumbada boca abajo (su frente mira al piso).
  const f = formato(e.globo.formatoId, "link");
  const union = e.union ?? { infladoCm: 10, codigo: e.colores[0]! };
  const paso = (infladoValido(f, e.globo.infladoCm) * 1.47) / 2;
  const columnas = Math.max(3, 2 * Math.round(e.anchoCm / paso / 2) + 1), filas = Math.max(3, 2 * Math.round(e.fondoCm / paso / 2) + 1);
  const simbolos = "abcdefghijklmnopqrstuvwxyz";
  const filasMatriz: string[] = [];
  let k = 0;
  for (let j = 0; j < filas; j++) {
    let fila = "";
    for (let i = 0; i < columnas; i++) {
      if (i % 2 === 1 && j % 2 === 1) { fila += "."; continue; }
      if (i % 2 === 0 && j % 2 === 0) { fila += "u"; continue; }
      const indice = e.patron === "un_color" ? 0 : e.patron === "alternado" ? k++ : Math.floor(i / 2) + Math.floor(j / 2);
      fila += simbolos[indice % e.colores.length]!;
    }
    filasMatriz.push(fila);
  }
  const colores = [...e.colores];
  while (colores.length < 20) colores.push(e.colores[0]!);
  colores[20] = union.codigo; // «u»
  const mural = armarMural({ disposicion: "malla", grande: { formatoId: f.id, infladoCm: e.globo.infladoCm }, chico: { formatoId: "R-5", infladoCm: union.infladoCm }, matriz: { colores, filas: filasMatriz } });
  // Del plano XY (frente +z) al techo: giro de +90° sobre x, (x, y, z) ↦ (x, −z, y), centrado y pegado al techo.
  const ys = mural.celdas.map((c) => c.centro.y);
  const medio = (Math.max(...ys) + Math.min(...ys)) / 2;
  const girarPunto = (p: Vec3): Vec3 => ({ x: p.x, y: -p.z, z: p.y - medio });
  const girarVector = (p: Vec3): Vec3 => ({ x: p.x, y: -p.z, z: p.y });
  const tumbados = mural.globos.map((g) => ({ ...g, nudo: girarPunto(g.nudo), direccion: girarVector(g.direccion) }));
  let techo = -Infinity;
  for (const g of tumbados) { const c = centroDe(g); techo = Math.max(techo, c.y + g.infladoCm / 2); }
  for (const g of tumbados) globos.push({ ...g, nudo: v(g.nudo.x + cx, g.nudo.y - techo, g.nudo.z + cz), direccion: g.direccion });
  for (const a of mural.anclas) anclas.push({ posicion: v(a.posicion.x + cx, -a.posicion.z - techo, a.posicion.y - medio + cz), normal: ABAJO });
}

function armarFestones(e: Extract<ElementoTecho, { tipo: "festones" }>, globos: GloboDecoracion[], anclas: TechoArmado["anclas"], catenarias: CatenariaTecho[]): void {
  if (e.puntos.length < 2) throw new Error("Los festones necesitan al menos dos puntos del techo.");
  const f = formato(e.guirnalda.formatoId, "redondo");
  for (const c of e.guirnalda.colores) exigirColor(f.id, c);
  const d = infladoValido(f, e.guirnalda.infladoCm);
  // Lo que sobresale la trenza de su eje: el eje va a esa distancia del techo.
  const radioTrenza = d * RADIO_TRENZA_POR_DIAMETRO + d / 2;
  let rRemate = 0;
  if (e.remate) {
    const fr = formato(e.remate.formatoId, "redondo");
    exigirColor(fr.id, e.remate.codigo);
    const dr = infladoValido(fr, e.remate.infladoCm);
    rRemate = dr / 2;
    for (const p of e.puntos) {
      // Colgando de su nudo, pegado al techo.
      globos.push(colgando(fr.id, dr, e.remate.codigo, v(p.xCm, -0.5, p.zCm)));
      anclas.push({ posicion: v(p.xCm, -dr, p.zCm), normal: ABAJO });
    }
  }
  for (let k = 0; k + 1 < e.puntos.length; k++) {
    const a = e.puntos[k]!, b = e.puntos[k + 1]!;
    const dx = b.xCm - a.xCm, dz = b.zCm - a.zCm;
    const luzTotal = Math.hypot(dx, dz);
    // Con remate, la guirnalda nace a un lado de él (sin meterse dentro).
    const recorte = e.remate ? rRemate + d * 0.6 : 0;
    const luz = luzTotal - 2 * recorte;
    if (luz < 2 * d) throw new Error("Dos puntos de festón están demasiado juntos para colgar una guirnalda.");
    const eU = { x: dx / luzTotal, y: 0, z: dz / luzTotal };
    const eW = { x: -eU.z, y: 0, z: eU.x }; // eU × eY
    const origen = { x: a.xCm + eU.x * recorte, y: -radioTrenza, z: a.zCm + eU.z * recorte };
    const curva = puntosCatenaria(luz, e.caidaCm);
    const trenza = armarTrenza({ formato: f, infladoCm: d, patron: e.guirnalda.patron, colores: e.guirnalda.colores, recorrido: curva, reparto: "extremos" });
    const mundo = (p: Vec3): Vec3 => ({ x: origen.x + p.x * eU.x + p.z * eW.x, y: origen.y + p.y, z: origen.z + p.x * eU.z + p.z * eW.z });
    const vector = (p: Vec3): Vec3 => ({ x: p.x * eU.x + p.z * eW.x, y: p.y, z: p.x * eU.z + p.z * eW.z });
    const desde = globos.length;
    for (const g of trenza.globos) globos.push({ formatoId: f.id, infladoCm: d, codigo: g.codigo, nudo: v(mundo(g.nudo).x, mundo(g.nudo).y, mundo(g.nudo).z), direccion: vector(g.direccion), cuelloExtraCm: g.cuelloExtraCm });
    catenarias.push({ puntos: curva.map((q) => mundo({ x: q.x, y: q.y, z: 0 })), desde, hasta: globos.length });
    trenza.anclas.filter((x) => x.hueco === 0 && x.nivel % 3 === 1).forEach((x) => anclas.push({ posicion: mundo(x.posicion), normal: vector(x.normal) }));
  }
}

function armarTira(e: Extract<ElementoTecho, { tipo: "tira" }>, globos: GloboDecoracion[], tubos: TuboDecoracion[], escenografia: ElementoEscenografia[], anclas: TechoArmado["anclas"]): void {
  if (!e.globos.length) throw new Error("La tira de techo necesita al menos un globo.");
  const { xCm: x, zCm: z } = e.punto;
  let y = -Math.max(0, e.hiloCm);
  if (e.hiloCm > 0) escenografia.push({ forma: "cilindro", base: v(x, y, z), radioCm: 0.25, altoCm: r1(e.hiloCm), hex: "#d9d9de", acabado: "satinado" });
  for (const g of e.globos) {
    const f = formato(g.formatoId);
    if (f.tipo === "tubito") throw new Error("La tira lleva globos, no tubitos (los tubitos van en los flecos).");
    exigirColor(f.id, g.codigo);
    const d = infladoValido(f, g.infladoCm);
    if (g.cantidad === 1) {
      // Solo: cuelga de su nudo, a lo largo de la tira.
      globos.push(colgando(f.id, d, g.codigo, v(x, y, z)));
      y -= largoGlobo(f.tipo === "link" ? "link" : "redondo", d) * 0.95;
    } else {
      // Pareja, trío o cuarteto: alrededor de la tira, tocándose, con el nudo al centro.
      const rho = g.cantidad === 2 ? 0.45 * d : (0.9 * d) / (2 * Math.sin(Math.PI / g.cantidad));
      for (let q = 0; q < g.cantidad; q++) {
        const a = (q * 2 * Math.PI) / g.cantidad;
        const radial = { x: Math.cos(a), y: 0, z: Math.sin(a) };
        globos.push(globoEn(f.id, d, g.codigo, v(x + radial.x * rho, y - d / 2, z + radial.z * rho), radial));
      }
      y -= d * 0.9;
    }
  }
  anclas.push({ posicion: v(x, y, z), normal: ABAJO });
  const fl = e.flecos;
  if (!fl || fl.cantidad < 1) return;
  const ft = formato(fl.formatoId, "tubito");
  exigirColor(ft.id, fl.codigo);
  const grosor = ft.infladoDecoracionCm;
  for (let q = 0; q < fl.cantidad; q++) {
    const a = Math.PI / 4 + (q * 2 * Math.PI) / fl.cantidad;
    const radial = { x: Math.cos(a), z: Math.sin(a) };
    // Baja abriéndose en una curva suave (sale, se aleja `aperturaCm` y vuelve un poco hacia dentro al final).
    const puntos: Vec3[] = [];
    for (let s = 0; s <= 12; s++) {
      const t = s / 12;
      const fuera = fl.aperturaCm * Math.sin(Math.PI * Math.min(1, t * 0.8 + 0.1)) * (0.6 + 0.4 * t);
      puntos.push(v(x + radial.x * fuera, y - fl.largoCm * t, z + radial.z * fuera));
    }
    tubos.push({ formatoId: ft.id, grosorCm: grosor, codigo: fl.codigo, puntos, cerrado: false });
    const fin = puntos[puntos.length - 1]!;
    if (fl.racimo) {
      const fr = formato(fl.racimo.formatoId, "redondo");
      const dr = infladoValido(fr, fl.racimo.infladoCm);
      const n = Math.max(1, Math.round(fl.racimo.globos));
      for (let m = 0; m < n; m++) {
        // Un racimito alrededor de la punta del fleco: una vuelta de globos y el último debajo.
        const codigo = fl.racimo.codigos[(q + m) % fl.racimo.codigos.length]!;
        exigirColor(fr.id, codigo);
        const enAnillo = m < n - 1 || n === 1;
        const b = (m * 2 * Math.PI) / Math.max(1, n - 1) + q;
        const centro = enAnillo && n > 1 ? v(fin.x + Math.cos(b) * dr * 0.55, fin.y - dr * 0.35, fin.z + Math.sin(b) * dr * 0.55) : v(fin.x, fin.y - dr * 0.9, fin.z);
        globos.push(globoEn(fr.id, dr, codigo, centro, unitario({ x: centro.x - fin.x, y: centro.y - fin.y, z: centro.z - fin.z })));
      }
    }
  }
}

function armarHelio(e: Extract<ElementoTecho, { tipo: "helio" }>, globos: GloboDecoracion[], escenografia: ElementoEscenografia[]): void {
  const f = formato(e.globo.formatoId);
  if (f.tipo === "tubito") throw new Error("Los globos de helio no son tubitos.");
  if (!e.codigos.length) throw new Error("Los globos de helio necesitan al menos un color.");
  for (const c of e.codigos) exigirColor(f.id, c);
  const d = infladoValido(f, e.globo.infladoCm);
  e.puntos.forEach((p, k) => {
    // Flotando contra el techo: el cuerpo arriba (tocándolo), el nudo abajo y la cinta colgando del nudo.
    const largo = largoGlobo(f.tipo === "link" ? "link" : "redondo", d);
    const g: GloboDecoracion = { formatoId: f.id, infladoCm: d, codigo: e.codigos[k % e.codigos.length]!, nudo: v(p.xCm, -largo, p.zCm), direccion: { x: 0, y: 1, z: 0 }, cuelloExtraCm: 0 };
    globos.push(g);
    if (e.cintaCm > 0) escenografia.push({ forma: "cilindro", base: v(p.xCm, g.nudo.y - e.cintaCm, p.zCm), radioCm: 0.2, altoCm: r1(e.cintaCm), hex: e.cintaHex, acabado: "satinado" });
  });
}

export function armarTecho(o: OpcionesTecho): TechoArmado {
  if (!o.elementos.length) throw new Error("La decoración de techo no tiene elementos.");
  const globos: GloboDecoracion[] = [];
  const tubos: TuboDecoracion[] = [];
  const escenografia: ElementoEscenografia[] = [];
  const anclas: TechoArmado["anclas"] = [];
  const catenarias: CatenariaTecho[] = [];
  for (const e of o.elementos) {
    switch (e.tipo) {
      case "red": armarRed(e, globos, anclas); break;
      case "festones": armarFestones(e, globos, anclas, catenarias); break;
      case "tira": armarTira(e, globos, tubos, escenografia, anclas); break;
      case "helio": armarHelio(e, globos, escenografia); break;
    }
  }
  // Lo de más arriba (como lo mide la caja de la pieza: el cuerpo de cada globo como una esfera) toca el techo: si
  // algo asoma (un cuarteto inclinado, la punta de un festón), todo baja eso; si nada llega, todo sube.
  let arriba = -Infinity;
  for (const g of globos) arriba = Math.max(arriba, g.nudo.y + g.direccion.y * (g.infladoCm / 2 + g.cuelloExtraCm) + g.infladoCm / 2);
  for (const t of tubos) for (const p of t.puntos) arriba = Math.max(arriba, p.y + t.grosorCm / 2);
  for (const x of escenografia) if (x.forma === "cilindro") arriba = Math.max(arriba, x.base.y + x.altoCm);
  // (si nada llega al techo, todo sube: la pieza siempre tiene el techo en y = 0)
  const dy = Number.isFinite(arriba) ? -arriba : 0;
  if (Math.abs(dy) < 0.01) return { globos, tubos, escenografia, anclas, materiales: materialesDecoracion(globos, tubos), catenarias };
  const bajar = (p: Vec3): Vec3 => v(p.x, p.y + dy, p.z);
  return {
    globos: globos.map((g) => ({ ...g, nudo: bajar(g.nudo) })),
    tubos: tubos.map((t) => ({ ...t, puntos: t.puntos.map(bajar) })),
    escenografia: escenografia.map((x) => (x.forma === "cilindro" ? { ...x, base: bajar(x.base), altoCm: x.base.y + x.altoCm >= -0.01 ? r1(x.altoCm - dy) : x.altoCm } : x)),
    anclas: anclas.map((a) => ({ posicion: bajar(a.posicion), normal: a.normal })),
    materiales: materialesDecoracion(globos, tubos),
    catenarias: catenarias.map((c) => ({ ...c, puntos: c.puntos.map(bajar) })),
  };
}

// ----------------------------------------------------------------------------------------------------------
// Techos de muestra (Decoraciones pequeñas)
// ----------------------------------------------------------------------------------------------------------

export const TECHOS_PREDEFINIDOS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; techo: OpcionesTecho }> = [
  {
    id: "techo_festones", nombre: "Festones de techo", descripcion: "Tres guirnaldas de R-9 en catenaria entre cuatro R-24 de remate.",
    techo: { elementos: [{ tipo: "festones", puntos: [{ xCm: -270, zCm: 0 }, { xCm: -90, zCm: 0 }, { xCm: 90, zCm: 0 }, { xCm: 270, zCm: 0 }], caidaCm: 55, guirnalda: { formatoId: "R-9", infladoCm: 18, patron: "dos_colores", colores: ["021", "080"] }, remate: { formatoId: "R-24", infladoCm: 55, codigo: "080" } }] },
  },
  {
    id: "techo_red_racimos", nombre: "Red de racimos", descripcion: "Cuadrícula de cuartetos R-12 pegada al techo (2 × 1,5 m).",
    techo: { elementos: [{ tipo: "red", tecnica: "racimos", anchoCm: 200, fondoCm: 150, globo: { formatoId: "R-12", infladoCm: 25 }, colores: ["009", "005"], patron: "damero" }] },
  },
  {
    id: "techo_malla_lol", nombre: "Malla de techo LOL", descripcion: "Malla Link-O-Loon 12 boca abajo, con uniones R-5.",
    techo: { elementos: [{ tipo: "red", tecnica: "malla", anchoCm: 180, fondoCm: 140, globo: { formatoId: "LOL-12", infladoCm: 25 }, union: { infladoCm: 10, codigo: "005" }, colores: ["040", "005"], patron: "damero" }] },
  },
  {
    id: "techo_tiras", nombre: "Tiras colgantes", descripcion: "Tres tiras de R-9 y parejas de R-5 con flecos de T-260 y racimitos.",
    techo: {
      elementos: [-60, 0, 60].map((x, k): ElementoTecho => ({
        tipo: "tira", punto: { xCm: x, zCm: 0 }, hiloCm: 20 + 25 * (k % 2),
        globos: [{ formatoId: "R-5", infladoCm: 11, codigo: "031", cantidad: 2 }, { formatoId: "R-9", infladoCm: 20, codigo: "061", cantidad: 1 }, { formatoId: "R-5", infladoCm: 11, codigo: "031", cantidad: 2 }],
        flecos: { formatoId: "T-260", codigo: "061", cantidad: 3, largoCm: 70, aperturaCm: 14, racimo: { formatoId: "R-5", infladoCm: 11, codigos: ["020", "038", "051"], globos: 4 } },
      })),
    },
  },
  {
    id: "techo_helio", nombre: "Helio contra el techo", descripcion: "Doce R-12 de helio con cinta, flotando contra el techo.",
    techo: { elementos: [{ tipo: "helio", puntos: Array.from({ length: 12 }, (_, k) => ({ xCm: r1(((k % 4) - 1.5) * 45 + (Math.floor(k / 4) % 2) * 20), zCm: r1((Math.floor(k / 4) - 1) * 45) })), globo: { formatoId: "R-12", infladoCm: 28 }, codigos: ["011", "005", "570"], cintaCm: 120, cintaHex: "#f2f2f2" }] },
  },
];

/** La decoración de techo en inglés corto (para el prompt de la imagen). */
export function techoEnIngles(o: OpcionesTecho): string {
  const partes = o.elementos.map((e) => {
    switch (e.tipo) {
      case "red": return e.tecnica === "malla" ? "a Link-O-Loon balloon net covering the ceiling" : "a grid of balloon clusters attached to the ceiling";
      case "festones": return `${e.puntos.length - 1} classic balloon garlands draped in swags from point to point of the ceiling${e.remate ? " with a large balloon at each point" : ""}`;
      case "tira": return `a vertical strand of balloons hanging on a string${e.flecos ? " with twisting balloon tails ending in small balloon clusters" : ""}`;
      case "helio": return `${e.puntos.length} helium balloons floating against the ceiling with hanging ribbons`;
    }
  });
  return [...new Set(partes)].join(", ");
}
