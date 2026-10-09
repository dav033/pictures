import { contornoDeMesa, desplazarContorno, normalDeArista } from "./mobiliario-contornos";
import type { DisposicionSillas, MesaGuardada, PuestoGuardado, TipoSilla } from "./mobiliario-conjunto-tipos";
import { NOMBRE_MESA } from "./mobiliario-conjunto-tipos";
import { medidaDeAsiento, SILLAS } from "./mobiliario-sillas-param";
import type { Punto2 } from "./trenza";

/**
 * **Dónde se sientan** (REQ-012): los puestos de las sillas de una mesa salen de su perímetro REAL, no de un número fijo. El
 * contorno de la tapa se corre hacia afuera lo que mide la silla (más el vuelo del mantel), se elige qué tramos se usan según la
 * disposición, se reparte `cantidad` entre ellos por su largo y, dentro de cada tramo, a igual distancia. Si no caben todas, se
 * devuelven las que caben y se dice. Cada silla mira a la mesa en perpendicular a su borde.
 *
 *   alrededor: todo el borde · un_lado: el lado de adelante · dos_lados: los dos lados largos · cabeceras: solo las puntas ·
 *   frente: solo el lado contrario a hacia dónde miran (un escenario): todos ven al frente.
 */

/** Aire entre dos asientos (cm), el mismo de `mobiliario-disposicion.ts`. */
const AIRE_ENTRE_ASIENTOS_CM = 6;
/** Cuánto se separa el frente del asiento del borde de la mesa (cm). */
const HOLGURA_A_LA_MESA_CM = 6;
const VUELO_MANTEL_CM: Readonly<Record<MesaGuardada["mantel"], number>> = { piso: 7, corto: 3, ninguno: 0 };
/** Dos aristas seguidas cuyas normales se abren más de 25° son una esquina: el tramo se corta ahí. */
const COS_ESQUINA = Math.cos((25 * Math.PI) / 180);

export type ResultadoPuestos = {
  puestos: PuestoGuardado[];
  /** Las que caben en total con esa disposición (tope de lo que se puede pedir). */
  capacidad: number;
  pedida: number;
  /** Qué se ajustó (no caben todas, ningún tramo sirve…), o null. */
  nota: string | null;
};

type Vec = { x: number; y: number };
const norm = (v: Vec): Vec => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const punto = (a: Punto2, b: Punto2, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Un tramo del borde donde se sientan: sus aristas, el largo útil (sin lo que el borde corrido se pasa de las esquinas), dónde arranca dentro de ellas y cuántos caben. */
type Tramo = { aristas: number[]; largoCm: number; inicioCm: number; cerrado: boolean; capacidad: number };

/**
 * Los tramos del borde donde se puede sentar alguien con esta disposición. `sobra(v)` es lo que el borde corrido se pasa de la
 * esquina del vértice `v` (cm): en un tramo abierto se descuenta en cada punta, para que las sillas no queden más allá de la mesa.
 */
function tramosDe(n: number, selecta: (i: number) => boolean, normales: readonly Vec[], largos: readonly number[], frenteCm: number, sobra: (v: number) => number): Tramo[] {
  const unidas = (i: number, j: number) => normales[i]!.x * normales[j]!.x + normales[i]!.y * normales[j]!.y >= COS_ESQUINA;
  const todas = Array.from({ length: n }, (_, i) => i).every(selecta);
  const rompe = (i: number) => !selecta((i - 1 + n) % n) || !unidas((i - 1 + n) % n, i);
  const crear = (aristas: number[], cerrado: boolean): Tramo => {
    const inicioCm = cerrado ? 0 : sobra(aristas[0]!);
    const largoCm = aristas.reduce((s, i) => s + largos[i]!, 0) - inicioCm - (cerrado ? 0 : sobra((aristas[aristas.length - 1]! + 1) % n));
    return { aristas, largoCm, inicioCm, cerrado, capacidad: Math.max(0, Math.floor(largoCm / (frenteCm + AIRE_ENTRE_ASIENTOS_CM))) };
  };
  if (todas && !Array.from({ length: n }, (_, i) => i).some(rompe)) return [crear(Array.from({ length: n }, (_, i) => i), true)];
  const inicio = Array.from({ length: n }, (_, i) => i).find((i) => selecta(i) && rompe(i));
  if (inicio === undefined) return [];
  const salida: Tramo[] = [];
  let actual: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (inicio + k) % n;
    if (!selecta(i)) { if (actual.length) salida.push(crear(actual, false)); actual = []; continue; }
    if (actual.length && rompe(i)) { salida.push(crear(actual, false)); actual = []; }
    actual.push(i);
  }
  if (actual.length) salida.push(crear(actual, false));
  return salida;
}

/** Cuántas van en cada tramo: proporcional a su largo, sin pasar de lo que cabe en él, y las que sobran al tramo con más hueco. */
function reparto(cantidad: number, tramos: readonly Tramo[]): number[] {
  const largoTotal = tramos.reduce((s, t) => s + t.largoCm, 0) || 1;
  const n = Math.min(cantidad, tramos.reduce((s, t) => s + t.capacidad, 0));
  const cuota = tramos.map((t) => (n * t.largoCm) / largoTotal);
  const cuentas = tramos.map((t, i) => Math.min(t.capacidad, Math.floor(cuota[i]!)));
  for (let resto = n - cuentas.reduce((s, c) => s + c, 0); resto > 0; resto--) {
    let mejor = -1, hueco = -Infinity;
    cuentas.forEach((c, i) => { if (c < tramos[i]!.capacidad && cuota[i]! - c > hueco) { hueco = cuota[i]! - c; mejor = i; } });
    if (mejor < 0) break;
    cuentas[mejor]!++;
  }
  return cuentas;
}

/**
 * Los puestos de `cantidad` asientos de `tipo` alrededor de una mesa con esa `disposicion` (en el marco de la mesa). `haciaGrados`
 * solo cuenta con `frente`: hacia dónde miran los comensales (0 = +z, 90 = +x).
 */
export function repartirSillas(mesa: MesaGuardada, p: { tipo: TipoSilla; cantidad: number; disposicion: DisposicionSillas; haciaGrados?: number }): ResultadoPuestos {
  const cantidad = Math.max(0, Math.round(p.cantidad));
  const { frenteCm, fondoCm: fondoSilla } = medidaDeAsiento(p.tipo);
  const contorno = contornoDeMesa(mesa);
  const base = contorno.puntos, n = base.length;
  // Donde se pone el centro de cada silla: el borde corrido lo que mide la silla más su aire y el vuelo del mantel.
  const margen = fondoSilla / 2 + HOLGURA_A_LA_MESA_CM + VUELO_MANTEL_CM[mesa.mantel];
  const sitio = desplazarContorno(base, margen);
  const normales = base.map((_, i) => normalDeArista(base, i));
  const largos = sitio.map((q, i) => { const s = sitio[(i + 1) % n]!; return Math.hypot(s.x - q.x, s.y - q.y); });
  const alX = mesa.anchoCm >= mesa.fondoCm;
  const lado: Vec = alX ? { x: 0, y: 1 } : { x: 1, y: 0 }, largo: Vec = { x: lado.y, y: lado.x };
  const hacia: Vec = { x: Math.sin(((p.haciaGrados ?? 0) * Math.PI) / 180), y: Math.cos(((p.haciaGrados ?? 0) * Math.PI) / 180) };
  const punta = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
  const sirve = (i: number): boolean => {
    if (contorno.traseras.has(i)) return false;
    const nm = normales[i]!;
    switch (p.disposicion) {
      case "alrededor": return true;
      case "un_lado": return punta(nm, lado) > 0.5;
      case "dos_lados": return Math.abs(punta(nm, lado)) > 0.5;
      case "cabeceras": return Math.abs(punta(nm, largo)) > 0.5;
      case "frente": return punta(nm, hacia) < -0.3;
    }
  };
  const sobra = (v: number) => {
    const c = punta(normales[(v - 1 + n) % n]!, normales[v % n]!);
    return Math.min(3 * margen, margen * Math.tan(Math.acos(Math.max(-1, Math.min(1, c))) / 2));
  };
  const tramos = tramosDe(n, sirve, normales, largos, frenteCm, sobra);
  const capacidad = tramos.reduce((s, t) => s + t.capacidad, 0);
  const cuentas = reparto(cantidad, tramos);
  // La normal en un vértice de curva es el promedio de sus dos aristas; en una esquina, la de la arista.
  const normalEn = (i: number, t: number): Vec => {
    const suave = (v: number): Vec | null => {
      const a = normales[(v - 1 + n) % n]!, b = normales[v % n]!;
      return punta(a, b) >= COS_ESQUINA ? norm({ x: a.x + b.x, y: a.y + b.y }) : null;
    };
    const propia = normales[i]!, a = suave(i) ?? propia, b = suave(i + 1) ?? propia;
    return norm({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
  };
  const puestos: PuestoGuardado[] = [];
  tramos.forEach((tramo, k) => {
    const cuantos = cuentas[k]!;
    for (let j = 0; j < cuantos; j++) {
      let resto = (tramo.cerrado ? j / cuantos : (j + 0.5) / cuantos) * tramo.largoCm + tramo.inicioCm;
      let a = 0;
      while (a < tramo.aristas.length - 1 && resto > largos[tramo.aristas[a]!]!) { resto -= largos[tramo.aristas[a]!]!; a++; }
      const i = tramo.aristas[a]!, largoArista = largos[i]! || 1, t = Math.min(1, resto / largoArista);
      const q = punto(sitio[i]!, sitio[(i + 1) % n]!, t), nm = normalEn(i, t);
      puestos.push({ x: r1(q.x), z: r1(q.y), giroGrados: r1((Math.atan2(-nm.x, -nm.y) * 180) / Math.PI) });
    }
  });
  const colocadas = puestos.length;
  const nombre = SILLAS[p.tipo].plural;
  const nota = cantidad > colocadas
    ? `En ${NOMBRE_MESA[mesa.tipo].toLowerCase()} de ${Math.round(mesa.anchoCm)}${mesa.fondoCm !== mesa.anchoCm ? `×${Math.round(mesa.fondoCm)}` : ""} cm solo caben ${capacidad} ${nombre} con la disposición «${p.disposicion.replace(/_/g, " ")}» (pediste ${cantidad}): puse ${colocadas}.`
    : null;
  return { puestos, capacidad, pedida: cantidad, nota };
}
