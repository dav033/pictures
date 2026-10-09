import type { ColorLeido, ColoresEscalon, LecturaFoto, MezclaLeida, MezclaTramo, PiezaLeida } from "./lectura-foto";
import { diametroSueltoCm } from "./mezcla-lectura";
import { INFLADOS_TRAZO } from "./trazo-organico";

/**
 * **La lectura medida con los globos detectados uno por uno.** El lector (Gemini) dice bien QUÉ hay y por DÓNDE pasa
 * cada guirnalda, pero a ojo se equivoca en lo que más se ve: la escala, el tamaño de los globos, el grosor de cada
 * tramo y dónde van los grandes y los chicos (lee un arco asimétrico como si fuera parejo). La detección
 * (`detectar-globos-ia.ts`: una caja por globo, con su color) sí es precisa, así que aquí, sin ningún modelo:
 *
 * 1. Cada globo detectado se asigna a la guirnalda orgánica más cercana (por la distancia a su eje).
 * 2. Los tamaños se agrupan en los escalones que leyó el lector (chicos < medianos < grandes < gigantes) y de cada uno
 *    sale su diámetro y su parte de los globos.
 * 3. La escala de la foto sale de los propios globos (el diámetro con que el motor dibuja el formato que nombró el lector entre lo que mide),
 *    con los que están a la altura de la pared (los del frente, pegados a la cámara, se ven más grandes).
 * 4. El eje se remuestrea a puntos parejos y cada punto se corre hacia el centro de sus globos; su grosor y su mezcla salen
 *    de los globos que lo rodean: así un lado puede ser más grueso o más cargado de gigantes que el otro.
 * 5. El reparto de colores de la pieza sale de la cuenta de colores.
 *
 * Los chicos se detectan peor que los grandes (se tapan entre sí): su parte se toma como la mayor entre la detectada y la
 * leída. Con pocos globos detectados en una pieza (menos de `MINIMO_GLOBOS`) la pieza queda como la leyó el lector.
 */

export type GloboDetectado = { box_2d: readonly [number, number, number, number] | readonly number[]; color: string };

const MINIMO_GLOBOS = 15;
/** Globos alrededor de un punto del eje para medir su grosor y su mezcla. */
const MINIMO_POR_PUNTO = 5;
const PUNTOS_EJE = 12;
const ESCALONES = ["chicos", "medianos", "grandes", "gigantes"] as const;
type Escalon = (typeof ESCALONES)[number];
const FORMATO_POR_OMISION: Readonly<Record<Escalon, string>> = { chicos: "R-5", medianos: "R-12", grandes: "R-18", gigantes: "R-36" };
const CAMPO_FORMATO: Readonly<Record<Escalon, keyof MezclaLeida>> = { chicos: "formatoChico", medianos: "formatoMediano", grandes: "formatoGrande", gigantes: "formatoGigante" };
const CAMPO_DIAMETRO: Readonly<Record<Escalon, keyof MezclaLeida>> = { chicos: "diametroChico", medianos: "diametroMediano", grandes: "diametroGrande", gigantes: "diametroGigante" };

type Globo = { x: number; y: number; d: number; color: string };
type P = { x: number; y: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mediana = (v: readonly number[]) => { const s = [...v].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2; };
const percentil = (v: readonly number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!; };

/** Los globos en unidades de ALTO de la foto (x también: x × aspecto), con su diámetro. */
function globosDe(det: readonly GloboDetectado[], aspecto: number): Globo[] {
  return det.flatMap((g) => {
    const [y0, x0, y1, x1] = g.box_2d as readonly number[];
    if (![y0, x0, y1, x1].every((n) => Number.isFinite(n)) || y1! <= y0! || x1! <= x0!) return [];
    const h = (y1! - y0!) / 1000, w = ((x1! - x0!) / 1000) * aspecto;
    // Un globo tapado a medias deja una caja angosta: su diámetro es el lado mayor.
    return [{ x: ((x0! + x1!) / 2 / 1000) * aspecto, y: (y0! + y1!) / 2 / 1000, d: Math.max(h, w), color: g.color }];
  });
}

/** El punto más cercano de una polilínea, su distancia, el tramo y la fracción del recorrido. */
function proyectar(p: P, eje: readonly P[]): { d: number; q: P; t: number; normal: P } {
  const largos = [0];
  for (let i = 1; i < eje.length; i++) largos.push(largos[i - 1]! + Math.hypot(eje[i]!.x - eje[i - 1]!.x, eje[i]!.y - eje[i - 1]!.y));
  const total = largos[largos.length - 1]! || 1;
  let mejor = { d: Infinity, q: eje[0]!, t: 0, normal: { x: 0, y: -1 } };
  for (let i = 1; i < eje.length; i++) {
    const a = eje[i - 1]!, b = eje[i]!;
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const q = { x: a.x + vx * u, y: a.y + vy * u };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < mejor.d) { const l = Math.sqrt(l2); mejor = { d, q, t: (largos[i - 1]! + u * l) / total, normal: { x: -vy / l, y: vx / l } }; }
  }
  return mejor;
}

/** La polilínea remuestreada a `n` puntos parejos (conservando los extremos). */
function remuestrear<T extends P>(eje: readonly T[], n: number): P[] {
  const largos = [0];
  for (let i = 1; i < eje.length; i++) largos.push(largos[i - 1]! + Math.hypot(eje[i]!.x - eje[i - 1]!.x, eje[i]!.y - eje[i - 1]!.y));
  const total = largos[largos.length - 1]!;
  return Array.from({ length: n }, (_, k) => {
    const meta = (k / (n - 1)) * total;
    let i = 1;
    while (i < eje.length - 1 && largos[i]! < meta) i++;
    const a = eje[i - 1]!, b = eje[i]!, u = (meta - largos[i - 1]!) / ((largos[i]! - largos[i - 1]!) || 1);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  });
}

/** k-medias en una dimensión (log del diámetro), con centros iniciales en los cuantiles; centros de menor a mayor. */
function kMedias1D(v: readonly number[], k: number): number[] {
  let centros = Array.from({ length: k }, (_, i) => percentil(v, (i + 0.5) / k));
  for (let it = 0; it < 30; it++) {
    const grupos: number[][] = centros.map(() => []);
    for (const x of v) grupos[centros.reduce((m, c, i) => (Math.abs(x - c) < Math.abs(x - centros[m]!) ? i : m), 0)]!.push(x);
    centros = grupos.map((g, i) => (g.length ? g.reduce((s, x) => s + x, 0) / g.length : centros[i]!));
  }
  return centros.sort((a, b) => a - b);
}

/** Los escalones que la pieza dice tener, de chico a grande (al menos chicos y medianos). */
function escalonesDe(m: MezclaLeida | undefined): Escalon[] {
  const hay = ESCALONES.filter((e) => (m?.[e] ?? 0) > 0);
  return hay.length >= 2 ? hay : ["chicos", "medianos", "grandes"];
}

type Medicion = { pieza: PiezaLeida; escalaCm: number | null; notas: string[] };

function medirGuirnalda(p: Extract<PiezaLeida, { tipo: "guirnalda_organica" }>, globos: readonly Globo[], aspecto: number, pisoY: number | null): Medicion {
  const notas: string[] = [];
  if (globos.length < MINIMO_GLOBOS) return { pieza: p, escalaCm: null, notas };
  const escalones = escalonesDe(p.mezcla);
  // 2. Escalones por tamaño.
  const logs = globos.map((g) => Math.log(g.d));
  const centros = kMedias1D(logs, escalones.length);
  const escalonDe = (g: Globo): Escalon => escalones[centros.reduce((m, c, i) => (Math.abs(Math.log(g.d) - c) < Math.abs(Math.log(g.d) - centros[m]!) ? i : m), 0)]!;
  const porEscalon = new Map<Escalon, Globo[]>();
  for (const g of globos) porEscalon.set(escalonDe(g), [...(porEscalon.get(escalonDe(g)) ?? []), g]);
  // 3. Escala por los globos de la pared (no los del frente, bajo la línea del piso).
  const dePared = (g: Globo) => pisoY === null || g.y + g.d / 2 <= pisoY + 0.02;
  const mezcla: MezclaLeida = { ...(p.mezcla ?? { grandes: 0, medianos: 0, chicos: 0, diametroGrande: 0.1 }) };
  // El diámetro de cada escalón; la escala se ancla en los medianos (el escalón más común y de formato más seguro:
  // casi siempre R-12) y el formato de los demás sale de su PROPORCIÓN con ellos, no del nombre que puso el lector a ojo.
  const diametros = new Map<Escalon, { d: number; pared: number }>();
  for (const e of escalones) {
    const lista = porEscalon.get(e) ?? [];
    if (!lista.length) continue;
    const pared = lista.filter(dePared);
    diametros.set(e, { d: mediana((pared.length >= 2 ? pared : lista).map((g) => g.d)), pared: pared.length });
  }
  const ancla: Escalon | undefined = diametros.has("medianos") ? "medianos" : [...diametros.keys()][0];
  let escalaCm: number | null = null;
  if (ancla) {
    const formatoAncla = (ancla === "medianos" ? (mezcla.formatoMediano ?? "R-12") : (mezcla[CAMPO_FORMATO[ancla]] as string | undefined) ?? FORMATO_POR_OMISION[ancla]);
    const realAncla = INFLADOS_TRAZO[formatoAncla] ?? diametroSueltoCm(formatoAncla) ?? 25;
    const dAncla = diametros.get(ancla)!.d;
    if (diametros.get(ancla)!.pared >= 3) escalaCm = realAncla / dAncla;
    for (const [e, { d }] of diametros) {
      (mezcla as Record<string, unknown>)[CAMPO_DIAMETRO[e]] = r3(d);
      const cm = (d / dAncla) * realAncla;
      // El nombrado por el lector se respeta si la medida no se le aparta más de 1,25 veces (las cajas de los globos chiquitos
      // salen algo infladas: un R-5 se mide como de 15 cm).
      const nombrado = mezcla[CAMPO_FORMATO[e]] as string | undefined;
      const realNombrado = nombrado ? INFLADOS_TRAZO[nombrado] : undefined;
      const formato = e === ancla ? formatoAncla : realNombrado && Math.abs(Math.log(realNombrado / cm)) <= Math.log(1.25) ? nombrado! : formatoPorTamano(cm);
      (mezcla as Record<string, unknown>)[CAMPO_FORMATO[e]] = formato;
    }
  }
  const reparto = repartoDe(globos.map(escalonDe), escalones, p.mezcla);
  Object.assign(mezcla, reparto);
  delete mezcla.muestras;
  // 5. Colores por la cuenta (de la pieza, de cada escalón y, abajo, de cada tramo).
  const colores = coloresDe(p.colores, globos);
  const coloresPorEscalon = coloresPorEscalonDe(porEscalon, colores);
  // 4. Eje: puntos parejos; cada globo cae en el punto más cercano a lo largo del eje, y de los que caen en cada punto
  // salen su grosor (de borde a borde, a los dos lados del eje), su centro y su mezcla.
  const eje = remuestrear(p.puntos.map((q) => ({ x: q.x * aspecto, y: q.y })), PUNTOS_EJE);
  const grosorLeido = mediana(p.puntos.map((q) => q.grosor));
  const caen: Array<Array<{ g: Globo; lado: number }>> = eje.map(() => []);
  for (const g of globos) {
    const pr = proyectar(g, eje);
    const lado = (g.x - pr.q.x) * pr.normal.x + (g.y - pr.q.y) * pr.normal.y;
    caen[Math.round(pr.t * (eje.length - 1))]!.push({ g, lado });
  }
  const puntos = eje.map((q, i) => {
    // Con pocos globos en el punto, también los de los vecinos.
    const lista = caen[i]!.length >= MINIMO_POR_PUNTO ? caen[i]! : [...(caen[i - 1] ?? []), ...caen[i]!, ...(caen[i + 1] ?? [])];
    if (lista.length < MINIMO_POR_PUNTO) return { x: r3(q.x / aspecto), y: r3(q.y), grosor: r3(grosorLeido) };
    const afuera = percentil(lista.map((x) => x.lado + x.g.d / 2), 0.9), adentro = percentil(lista.map((x) => x.lado - x.g.d / 2), 0.1);
    const grosor = r3(Math.min(grosorLeido * 1.6, Math.max(grosorLeido * 0.5, afuera - adentro)));
    const corrimiento = (afuera + adentro) / 2;
    const pr = proyectar(q, eje);
    // Los extremos que tocan el piso no se suben: solo se corren de lado.
    const extremo = i === 0 || i === eje.length - 1;
    const nx = r3((q.x + pr.normal.x * corrimiento) / aspecto), ny = r3(extremo ? q.y : q.y + pr.normal.y * corrimiento);
    const tramo = repartoDe(lista.map((x) => escalonDe(x.g)), escalones, reparto);
    const dominante = dominanteDe(lista.map((x) => x.g), colores);
    return { x: nx, y: ny, grosor, mezcla: tramo, ...(dominante ? { dominante } : {}) };
  });
  notas.push(`Guirnalda medida con ${globos.length} globos detectados: ${escalones.map((e) => `${e} ${reparto[e] ?? 0} %`).join(", ")}.`);
  // 6. Anclas: los gigantes y los grandes de la pared, uno por uno, donde están y con su color.
  const anclas = (["gigantes", "grandes"] as const).flatMap((e) => (porEscalon.get(e) ?? []).filter(dePared).flatMap((g) => {
    const k = indiceDeDetectado(g.color, colores);
    return k >= 0 ? [{ x: r3(g.x / aspecto), y: r3(g.y), escalon: e, color: colores[k]!.nombre }] : [];
  }));
  return { pieza: { ...p, puntos: suavizarGrosor(puntos), mezcla, colores, ...(coloresPorEscalon.length ? { coloresPorEscalon } : {}), ...(anclas.length ? { anclas } : {}) }, escalaCm, notas };
}

/** El formato redondo con que el motor dibuja más cerca de `cm` (por proporción: en escala logarítmica). */
function formatoPorTamano(cm: number): string {
  const lista = Object.entries(INFLADOS_TRAZO).filter(([f]) => /^R-\d+$/.test(f));
  return lista.reduce((m, o) => (Math.abs(Math.log(o[1] / cm)) < Math.abs(Math.log(m[1] / cm)) ? o : m))[0];
}

/** El grosor de cada punto promediado con sus vecinos (la medida por punto salta de uno a otro). */
function suavizarGrosor<T extends { grosor: number }>(puntos: readonly T[]): T[] {
  return puntos.map((q, i) => {
    const vecinos = [puntos[i - 1], q, q, puntos[i + 1]].filter((x): x is T => Boolean(x));
    return { ...q, grosor: r3(vecinos.reduce((s, x) => s + x.grosor, 0) / vecinos.length) };
  });
}

/** El % por escalón de una lista; los chicos, como mínimo los leídos (se detectan de menos). */
function repartoDe(lista: readonly Escalon[], escalones: readonly Escalon[], leida: Partial<MezclaTramo> | undefined): MezclaTramo {
  const cuenta = new Map<Escalon, number>();
  for (const e of lista) cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
  const total = lista.length || 1;
  const pct = Object.fromEntries(escalones.map((e) => [e, (100 * (cuenta.get(e) ?? 0)) / total])) as Record<Escalon, number>;
  if (escalones.includes("chicos")) pct.chicos = Math.max(pct.chicos, Math.min(60, leida?.chicos ?? 0));
  const suma = Object.values(pct).reduce((s, w) => s + w, 0) || 1;
  const salida: MezclaTramo = { grandes: 0, medianos: 0, chicos: 0 };
  for (const e of escalones) (salida as Record<string, number>)[e] = Math.round((100 * pct[e]) / suma);
  return salida;
}

/** El color de la pieza que corresponde al color detectado (por nombre; el confeti y lo transparente, por acabado), o -1. */
function indiceDeDetectado(color: string, colores: readonly ColorLeido[]): number {
  const c = color.toLowerCase();
  if (c === "confeti") return colores.findIndex((x) => x.acabado === "confeti");
  if (c === "transparente") return colores.findIndex((x) => x.acabado === "cristal");
  const raiz = c.slice(0, 5);
  return colores.findIndex((x) => x.acabado !== "confeti" && x.nombre.toLowerCase().includes(raiz));
}

/** Cuántos globos de cada color de la pieza hay en la lista (los que no casan con ninguno no cuentan). */
function cuentaPorColor(lista: readonly Globo[], colores: readonly ColorLeido[]): { cuenta: number[]; total: number } {
  const cuenta = colores.map(() => 0);
  let total = 0;
  for (const g of lista) { const k = indiceDeDetectado(g.color, colores); if (k >= 0) { cuenta[k]!++; total++; } }
  return { cuenta, total };
}

/** Los pesos de los colores leídos por la cuenta de colores detectados; los que no aparecen quedan igual. */
function coloresDe(colores: readonly ColorLeido[], globos: readonly Globo[]): ColorLeido[] {
  const { cuenta, total } = cuentaPorColor(globos, colores);
  if (total < MINIMO_GLOBOS) return [...colores];
  return colores.map((c, k) => (cuenta[k]! > 0 ? { ...c, peso: Math.max(1, Math.round((100 * cuenta[k]!) / total)) } : c));
}

/** Diferencia mínima (en puntos de %) con el reparto de la pieza para que un escalón lleve sus propios colores. */
const DESVIO_COLOR_ESCALON = 15;
const MINIMO_COLOR_ESCALON = 6;

/** Los colores de cada escalón que se aparta del reparto de la pieza («los chicos, todos dorados»). */
function coloresPorEscalonDe(porEscalon: ReadonlyMap<Escalon, readonly Globo[]>, colores: readonly ColorLeido[]): ColoresEscalon[] {
  const salida: ColoresEscalon[] = [];
  for (const [e, lista] of porEscalon) {
    const { cuenta, total } = cuentaPorColor(lista, colores);
    if (total < MINIMO_COLOR_ESCALON) continue;
    const pesos = cuenta.map((n) => Math.round((100 * n) / total));
    if (pesos.some((w, k) => Math.abs(w - colores[k]!.peso) >= DESVIO_COLOR_ESCALON)) salida.push({ escalon: e, pesos });
  }
  return salida;
}

/** El color que domina en un tramo (≥ 70 % de sus globos y 15 puntos más que en la pieza), o undefined. */
function dominanteDe(lista: readonly Globo[], colores: readonly ColorLeido[]): string | undefined {
  const { cuenta, total } = cuentaPorColor(lista, colores);
  if (total < MINIMO_POR_PUNTO) return undefined;
  const k = cuenta.reduce((m, n, i) => (n > cuenta[m]! ? i : m), 0);
  const parte = (100 * cuenta[k]!) / total;
  return parte >= 70 && parte - colores[k]!.peso >= 15 ? colores[k]!.nombre : undefined;
}

/**
 * La lectura con sus guirnaldas orgánicas medidas por los globos detectados y la escala de la foto sacada de ellos (si
 * hay con qué). Pura: misma lectura y mismas detecciones, misma salida.
 */
export function medirConDetecciones(l: LecturaFoto, detectados: readonly GloboDetectado[]): { lectura: LecturaFoto; notas: string[] } {
  const globos = globosDe(detectados, l.aspecto);
  const guirnaldas = l.piezas.map((p, i) => ({ p, i })).filter((x): x is { p: Extract<PiezaLeida, { tipo: "guirnalda_organica" }>; i: number } => x.p.tipo === "guirnalda_organica");
  if (!guirnaldas.length || !globos.length) return { lectura: l, notas: [] };
  // 1. Cada globo, a la guirnalda más cercana (si queda a menos de su grosor).
  const ejes = guirnaldas.map(({ p }) => ({ eje: p.puntos.map((q) => ({ x: q.x * l.aspecto, y: q.y })), alcance: Math.max(...p.puntos.map((q) => q.grosor)) * 0.85 }));
  const asignados: Globo[][] = guirnaldas.map(() => []);
  // Los globos de los montones de piso (dentro de su recuadro en la foto) son de ellos, no de la guirnalda.
  const montones = l.piezas.map((p, i) => ({ p, i })).filter((x): x is { p: Extract<PiezaLeida, { tipo: "racimo_piso" }>; i: number } => x.p.tipo === "racimo_piso");
  const deMonton = montones.map(() => [] as Globo[]);
  const libres = globos.filter((g) => {
    const k = montones.findIndex(({ p }) => Math.abs(g.x - p.x * l.aspecto) <= p.ancho / 2 && g.y >= p.yArriba && g.y <= p.yPie);
    if (k < 0) return true;
    deMonton[k]!.push(g);
    return false;
  });
  for (const g of libres) {
    let mejor = -1, dMin = Infinity;
    ejes.forEach((e, k) => { const d = proyectar(g, e.eje).d; if (d <= e.alcance + g.d / 2 && d < dMin) { dMin = d; mejor = k; } });
    if (mejor >= 0) asignados[mejor]!.push(g);
  }
  const notas: string[] = [];
  const piezas = [...l.piezas];
  montones.forEach(({ p, i }, k) => { piezas[i] = { ...p, colores: coloresDe(p.colores, deMonton[k]!) }; });
  const escalas: number[] = [];
  guirnaldas.forEach(({ p, i }, k) => {
    const m = medirGuirnalda(p, asignados[k]!, l.aspecto, l.pisoY);
    piezas[i] = m.pieza;
    notas.push(...m.notas);
    if (m.escalaCm) escalas.push(m.escalaCm);
  });
  let escala = l.escala;
  if (escalas.length) {
    const cm = Math.min(1500, Math.max(60, Math.round(mediana(escalas))));
    if (Math.abs(cm - l.escala.altoImagenCm) / l.escala.altoImagenCm > 0.1) {
      notas.push(`Escala por los globos detectados: ${cm} cm de alto de foto (la leída era ${l.escala.altoImagenCm}).`);
      escala = { altoImagenCm: cm, referencia: `${l.escala.referencia} · medida con los globos`.slice(0, 80) };
    }
  }
  return { lectura: { ...l, escala, piezas }, notas };
}
