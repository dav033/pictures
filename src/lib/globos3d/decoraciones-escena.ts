import type { Vec3 } from "./modulos";
import { DECORACIONES_PREDEFINIDAS, armarDecoracion, type Decoracion, type MaterialDecoracion } from "./figuras";
import type { GloboDecoracion } from "./decoraciones";
import { esDePie, esHalloween } from "./halloween";
import type { AnclaDePieza } from "./piezas";
import { anclasElegidas, idNuevo, marcoDePared, type Colocacion, type Escena, type NodoEscena } from "./escena";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/**
 * Las **decoraciones pequeñas** de la pestaña Escena: las predefinidas de `figuras.ts` (flores de globos, de
 * tubito, moños, estrellas, flor de corazones, racimos, Halloween) agrupadas para escoger, con una miniatura de frente y lo
 * que hace falta para meterlas en la escena: colgadas de las anclas de otra pieza (repetidas cada N anclas) o
 * sueltas en la pared del fondo, el piso o el techo. Todo puro: sin React ni three.js.
 */

// ----------------------------------------------------------------------------------------------------------
// Grupos
// ----------------------------------------------------------------------------------------------------------

export type GrupoDecoracion = "flores" | "flores_tubito" | "monos" | "estrellas" | "corazones" | "racimos" | "halloween" | "figuras";

export const GRUPOS_DECORACION: ReadonlyArray<{ id: GrupoDecoracion; nombre: string }> = [
  { id: "flores", nombre: "Flores" },
  { id: "flores_tubito", nombre: "Flores de tubito" },
  { id: "monos", nombre: "Moños" },
  { id: "estrellas", nombre: "Estrellas" },
  { id: "corazones", nombre: "Corazones" },
  { id: "racimos", nombre: "Racimos" },
  { id: "halloween", nombre: "Halloween" },
  { id: "figuras", nombre: "Figuras" },
];

type Predefinida = (typeof DECORACIONES_PREDEFINIDAS)[number];

/** A qué grupo va una predefinida: por su tipo, salvo los racimos (que se arman como una flor en copa). */
export function grupoDe(p: Pick<Predefinida, "id" | "decoracion">): GrupoDecoracion {
  if (esHalloween(p.decoracion)) return "halloween";
  if (p.decoracion.tipo === "figura") return "figuras";
  if (p.id.startsWith("racimo")) return "racimos";
  switch (p.decoracion.tipo) {
    case "flor": return "flores";
    case "flor_tubito": return "flores_tubito";
    case "mono": return "monos";
    case "estrella": return "estrellas";
    case "flor_corazones": return "corazones";
    default: return "halloween";
  }
}

/** Cuántos globos lleva (los tubitos cuentan como globos: cada T-260 es uno). */
export function globosDe(materiales: readonly MaterialDecoracion[]): number {
  return materiales.reduce((s, m) => s + m.cantidad, 0);
}

/** `noEsGlobo`: escenografía de papel (fantasma, telaraña): no lleva globos ni se cotiza. */
export type DecoracionPequena = Predefinida & { grupo: GrupoDecoracion; materiales: MaterialDecoracion[]; globos: number; noEsGlobo: boolean };

/** Las predefinidas por grupo, en el orden de `GRUPOS_DECORACION` (sin grupos vacíos). */
export function decoracionesPorGrupo(): Array<{ id: GrupoDecoracion; nombre: string; decoraciones: DecoracionPequena[] }> {
  const todas: DecoracionPequena[] = DECORACIONES_PREDEFINIDAS.map((p) => {
    const { materiales } = armarDecoracion(p.decoracion);
    const globos = globosDe(materiales);
    return { ...p, grupo: grupoDe(p), materiales, globos, noEsGlobo: globos === 0 };
  });
  return GRUPOS_DECORACION.map((g) => ({ ...g, decoraciones: todas.filter((d) => d.grupo === g.id) })).filter((g) => g.decoraciones.length > 0);
}

// ----------------------------------------------------------------------------------------------------------
// Miniatura (vista de frente)
// ----------------------------------------------------------------------------------------------------------

/**
 * Una forma de la miniatura, en cm del dibujo (x a la derecha, y hacia abajo, como en SVG). `profundidad` crece
 * hacia quien mira: las formas vienen ordenadas de la más lejana a la más cercana (se pintan en ese orden).
 */
export type FormaMiniatura =
  | {
    tipo: "globo"; cx: number; cy: number; /** Semieje a lo largo del globo (del nudo hacia fuera). */ rx: number; ry: number; giroGrados: number; corazon: boolean; codigo: string; hex: string; profundidad: number;
    /** Lo impreso que se ve de frente (iris, cara de calabaza), en coordenadas del dibujo. */
    estampado?: Array<{ hex: string; puntos: Array<[number, number]> }>;
  }
  | { tipo: "tubito"; puntos: Array<[number, number]>; grosor: number; cerrado: boolean; codigo: string; hex: string; profundidad: number; /** Papel (no es globo): `relleno` pinta la figura. */ papel?: { relleno: boolean } };

export type Miniatura = { caja: { x: number; y: number; ancho: number; alto: number }; formas: FormaMiniatura[] };

/** Color oficial del globo (`hexGlobo` de la tabla Sempertex); gris si el código no está (no debería pasar). */
export function hexDeCodigo(codigo: string): string {
  return referenciaPorCodigo(codigo)?.hexGlobo ?? "#c8c8c8";
}

/**
 * La decoración vista de frente: se mira desde su cara (+y del espacio de la decoración) con su arriba (+z)
 * arriba. Es el mismo giro que `deFrente` de las piezas: x del dibujo = −x, y del dibujo = −z (SVG baja) y la
 * profundidad es +y. Los globos se proyectan como elipses (un poco alargados a lo largo de su eje) y los
 * tubitos como trazos de su grosor.
 */
export function miniaturaDecoracion(decoracion: Decoracion): Miniatura {
  const armada = armarDecoracion(decoracion);
  const plano = (p: Vec3): [number, number] => [-p.x, -p.z];
  const formas: FormaMiniatura[] = [];
  for (const g of armada.globos) {
    const r = g.infladoCm / 2;
    const largo = r + g.cuelloExtraCm;
    const centro: Vec3 = { x: g.nudo.x + g.direccion.x * largo, y: g.nudo.y + g.direccion.y * largo, z: g.nudo.z + g.direccion.z * largo };
    const [cx, cy] = plano(centro);
    const [dx, dy] = plano(g.direccion);
    const s = Math.min(1, Math.hypot(dx, dy));
    // Un globo es un elipsoide algo más largo (a) que ancho (r): de frente se ve su largo según cuánto se tumba.
    const a = r * 1.08;
    const corazon = g.formatoId.startsWith("C-");
    const estampado = estampadoDeFrente(g, centro, plano);
    formas.push({
      tipo: "globo", cx, cy, rx: Math.sqrt(a * a * s * s + r * r * (1 - s * s)), ry: r,
      giroGrados: s > 1e-6 ? (Math.atan2(dy, dx) * 180) / Math.PI : -90, corazon, codigo: g.codigo, hex: hexDeCodigo(g.codigo), profundidad: centro.y,
      ...(estampado ? { estampado } : {}),
    });
  }
  for (const t of armada.tubos) {
    const profundidad = t.puntos.reduce((s, p) => s + p.y, 0) / Math.max(1, t.puntos.length);
    formas.push({
      tipo: "tubito", puntos: t.puntos.map(plano), grosor: t.grosorCm, cerrado: t.cerrado, codigo: t.codigo, hex: t.papel?.hex ?? hexDeCodigo(t.codigo), profundidad,
      ...(t.papel ? { papel: { relleno: Boolean(t.papel.relleno && t.cerrado) } } : {}),
    });
  }
  formas.sort((a, b) => a.profundidad - b.profundidad);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const meter = (x: number, y: number, r: number) => { minX = Math.min(minX, x - r); minY = Math.min(minY, y - r); maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r); };
  for (const f of formas) {
    if (f.tipo === "globo") meter(f.cx, f.cy, Math.max(f.rx, f.ry));
    else for (const [x, y] of f.puntos) meter(x, y, f.grosor / 2);
  }
  if (!Number.isFinite(minX)) return { caja: { x: -10, y: -10, ancho: 20, alto: 20 }, formas };
  // Cuadrada, centrada y con un margen pequeño.
  const lado = Math.max(maxX - minX, maxY - minY) * 1.08;
  const redondo = (v: number) => Math.round(v * 100) / 100;
  return { caja: { x: redondo((minX + maxX) / 2 - lado / 2), y: redondo((minY + maxY) / 2 - lado / 2), ancho: redondo(lado), alto: redondo(lado) }, formas };
}

/**
 * Lo impreso de un globo tal como se ve de frente, con el mismo marco que el visor: cara = hacia `frente` (u =
 * eje × frente, v = eje); punta = el polo del globo (u = −(eje × frente), v = frente). Cada punto (u, v) se lleva a
 * la esfera del cuerpo midiendo sobre ella (equidistante) y se proyecta. `undefined` si no se ve desde delante.
 */
function estampadoDeFrente(g: GloboDecoracion, centro: Vec3, plano: (p: Vec3) => [number, number]): Array<{ hex: string; puntos: Array<[number, number]> }> | undefined {
  if (!g.estampado || !g.frente || !g.estampado.capas.length) return undefined;
  const eje = unitario(g.direccion);
  const f = g.frente;
  const k = f.x * eje.x + f.y * eje.y + f.z * eje.z;
  const z = unitario({ x: f.x - eje.x * k, y: f.y - eje.y * k, z: f.z - eje.z * k });
  const x: Vec3 = { x: eje.y * z.z - eje.z * z.y, y: eje.z * z.x - eje.x * z.z, z: eje.x * z.y - eje.y * z.x };
  const [d, u, v] = g.estampado.en === "punta" ? [eje, { x: -x.x, y: -x.y, z: -x.z }, z] : [z, x, eje];
  // Se ve si la cara apunta hacia quien mira (+y del espacio de la decoración).
  if (d.y < 0.15) return undefined;
  const r = g.infladoCm / 2;
  const sobre = ([pu, pv]: [number, number]): [number, number] => {
    const largo = Math.hypot(pu, pv), t = largo / r;
    const lado = largo > 1e-9 ? { x: (u.x * pu + v.x * pv) / largo, y: (u.y * pu + v.y * pv) / largo, z: (u.z * pu + v.z * pv) / largo } : { x: 0, y: 0, z: 0 };
    const dir = { x: d.x * Math.cos(t) + lado.x * Math.sin(t), y: d.y * Math.cos(t) + lado.y * Math.sin(t), z: d.z * Math.cos(t) + lado.z * Math.sin(t) };
    const [px, py] = plano({ x: centro.x + dir.x * r, y: centro.y + dir.y * r, z: centro.z + dir.z * r });
    return [Math.round(px * 100) / 100, Math.round(py * 100) / 100];
  };
  return g.estampado.capas.map((c) => ({ hex: c.hex, puntos: c.puntos.map(sobre) }));
}

// ----------------------------------------------------------------------------------------------------------
// Reparto en las anclas de otra pieza
// ----------------------------------------------------------------------------------------------------------

export type Reparto = { ancla: number; cada: number; copias: number };

const unitario = (v: Vec3): Vec3 => { const n = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / n, y: v.y / n, z: v.z / n }; };

/**
 * Cómo repartir copias en las anclas de una pieza para que se vea bien: unas pocas (≈ una por cada 6 anclas, de
 * 2 a 8), en las anclas que miran hacia quien mira la escena (el frente de una columna o un arco, o la cara de
 * una pared) y centradas a lo largo de la pieza. Con `cada` fijo (lo que pidió el usuario) solo busca dónde
 * empezar; `cada` = 0 es una sola, en el ancla más de frente y más al medio.
 */
export function repartoSugerido(anclas: readonly AnclaDePieza[], cada?: number): Reparto {
  const total = anclas.length;
  if (total === 0) return { ancla: 0, cada: 0, copias: 0 };
  const suma = anclas.reduce((s, a) => { const n = unitario(a.normal); return { x: s.x + n.x, y: s.y + n.y, z: s.z + n.z }; }, { x: 0, y: 0, z: 0 });
  // Si las anclas miran casi todas a un lado (una pared), ese es el frente; si no (columna, arco), hacia +z.
  const vista = Math.hypot(suma.x, suma.y, suma.z) / total > 0.3 ? unitario(suma) : { x: 0, y: 0, z: 1 };
  const deFrente = anclas.map((a) => { const n = unitario(a.normal); return n.x * vista.x + n.y * vista.y + n.z * vista.z; });
  const fijo = cada !== undefined;
  const objetivo = Math.min(8, Math.max(2, Math.round(total / 6)));
  const pasos = fijo ? [Math.max(0, Math.round(cada))] : Array.from({ length: Math.min(total - 1, 40) }, (_, i) => i + 1);
  if (!pasos.length) pasos.push(0);
  let mejor: (Reparto & { puntos: number; descentrado: number }) | null = null;
  for (const paso of pasos) {
    const inicios = paso <= 0 ? total : Math.min(paso, total);
    for (let inicio = 0; inicio < inicios; inicio++) {
      const indices = anclasElegidas(total, inicio, paso);
      if (!indices.length) continue;
      const media = indices.reduce((s, i) => s + deFrente[i]!, 0) / indices.length;
      const puntos = media - (fijo ? 0 : (0.6 * Math.abs(indices.length - objetivo)) / objetivo);
      const descentrado = Math.abs(indices[0]! - (total - 1 - indices[indices.length - 1]!));
      const mejora = !mejor || puntos > mejor.puntos + 1e-9 || (Math.abs(puntos - mejor.puntos) <= 1e-9 && descentrado < mejor.descentrado);
      if (mejora) mejor = { ancla: inicio, cada: paso, copias: indices.length, puntos, descentrado };
    }
  }
  return mejor ? { ancla: mejor.ancla, cada: mejor.cada, copias: mejor.copias } : { ancla: 0, cada: 0, copias: 1 };
}

// ----------------------------------------------------------------------------------------------------------
// Agregar a la escena
// ----------------------------------------------------------------------------------------------------------

/**
 * Dónde va: colgada de las anclas de otra pieza (repetida cada `cada`), suelta en la pared del fondo, el piso o el
 * techo, o en un `sitio` exacto (lo que se soltó en el visor: sobre una estructura, en una pared o en el techo).
 */
export type DestinoDecoracion =
  | { en: "ancla"; padreId: string; cada: number; ancla?: number }
  | { en: "pared" }
  | { en: "piso" }
  | { en: "techo" }
  | { en: "sitio"; colocacion: Colocacion };

/** Alturas de partida de lo suelto: a la vista en la pared y un poco bajo el techo. */
export const ALTURA_EN_PARED_CM = 140;
export const CUELGA_DEL_TECHO_CM = 60;
const SEPARACION_CM = 70;

/** 0, +70, −70, +140, −140… para que la segunda flor no caiga encima de la primera. */
function desfase(k: number): number {
  return k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * SEPARACION_CM;
}

const limitar = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/**
 * Mete una decoración en la escena y devuelve la escena nueva (la de entrada no cambia) con el id del nodo.
 * Colgada: `colocacion` ancla en `padreId`, desde `ancla` y repetida `cada` anclas (0 = una sola). Suelta: en la
 * pared del fondo (de frente, a 1,4 m), en el piso (adelante) o del techo (cabeza abajo, a 60 cm); si ya hay
 * decoraciones sueltas en ese sitio, la nueva se corre a un lado. En un `sitio`, justo en esa colocación.
 */
export function agregarDecoracion(
  escena: Escena,
  decoracion: Decoracion,
  destino: DestinoDecoracion,
  opciones: { nombre?: string; idBase?: string } = {},
): { escena: Escena; id: string } {
  const { sala } = escena;
  const id = idNuevo(escena, opciones.idBase ?? "decoracion");
  const nombre = opciones.nombre ?? "Decoración";
  const sueltas = escena.nodos.filter((n) => n.pieza.tipo === "decoracion" && n.colocacion.en === destino.en && (n.colocacion.en !== "pared" || n.colocacion.pared === "fondo")).length;
  let colocacion: Colocacion;
  // Las que van de pie (calabazas, árbol, ramo, fantasma) quedan derechas también en el piso y colgadas del techo.
  const dePie = esDePie(decoracion);
  let deFrente = false;
  if (destino.en === "sitio") {
    const c = structuredClone(destino.colocacion);
    if ((c.en === "ancla" || c.en === "sobre") && !escena.nodos.some((n) => n.id === c.padreId)) throw new Error(`No hay ninguna pieza «${c.padreId}» donde ponerla.`);
    colocacion = c;
    deFrente = c.en === "pared" || c.en === "libre" || ((c.en === "piso" || c.en === "techo") && dePie);
  } else if (destino.en === "ancla") {
    if (!escena.nodos.some((n) => n.id === destino.padreId)) throw new Error(`No hay ninguna pieza «${destino.padreId}» de la que colgarla.`);
    colocacion = { en: "ancla", padreId: destino.padreId, ancla: Math.max(0, Math.round(destino.ancla ?? 0)), cada: Math.max(0, Math.round(destino.cada)), giroGrados: 0 };
  } else if (destino.en === "pared") {
    const largo = marcoDePared(sala, "fondo").largoCm;
    colocacion = { en: "pared", pared: "fondo", aLoLargoCm: limitar(desfase(sueltas), largo / 2 - 40), alturaCm: Math.min(ALTURA_EN_PARED_CM, Math.max(0, sala.altoCm - 60)) };
    deFrente = true;
  } else if (destino.en === "piso") {
    colocacion = { en: "piso", xCm: limitar(desfase(sueltas), sala.anchoCm / 2 - 40), zCm: Math.round(sala.fondoCm * 0.25), giroGrados: 0 };
    deFrente = dePie;
  } else {
    colocacion = { en: "techo", xCm: limitar(desfase(sueltas), sala.anchoCm / 2 - 40), zCm: 0, cuelgaCm: Math.min(CUELGA_DEL_TECHO_CM, Math.max(0, sala.altoCm - 60)), giroGrados: 0, volteada: !dePie };
    deFrente = dePie;
  }
  const nodo: NodoEscena = { id, nombre, pieza: { tipo: "decoracion", decoracion: structuredClone(decoracion), ...(deFrente ? { deFrente: true } : {}) }, colocacion };
  return { escena: { ...escena, nodos: [...escena.nodos, nodo] }, id };
}
