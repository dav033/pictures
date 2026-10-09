import { LecturaFotoSchema, type AnclaLeida, type ColorLeido, type LecturaFoto, type PiezaLeida } from "./lectura-foto";
import { coloresDe, coloresPorEscalonDe, dominanteDe, indiceDeDetectado } from "./medir-colores";
import { ejeMedido, globosDe, largosDelEje, mediana, normalEnPunto, percentil, proyectar, r3, type CajaDetectada, type Globo, type P } from "./medir-geometria";
import { medirTamanos, repartoDe } from "./medir-tamanos";
import type { Escalon } from "./mezcla-lectura";
import { FONDOS_CON_SUPERFICIE } from "./fondos-familias";
import { medirFondos, type FondoDetectado } from "./medir-fondos";

export type { FondoDetectado } from "./medir-fondos";
export type GloboDetectado = CajaDetectada;

/**
 * **La lectura medida con los globos detectados uno por uno.** El lector (Gemini) dice bien QUÉ hay y por DÓNDE pasa
 * cada guirnalda, pero a ojo se equivoca en lo que más se ve: la escala, el tamaño de los globos, el grosor de cada
 * tramo y dónde van los grandes y los chicos (lee un arco asimétrico como si fuera parejo). La detección
 * (`detectar-globos-ia.ts`: una caja por globo, con su color) sí es precisa, así que aquí, sin ningún modelo:
 *
 * 1. Cada globo detectado se asigna a la pieza que lo tiene: los que caen dentro de una columna, un globo suelto, una
 *    decoración, un ramo o un montón de piso son de ellos y no ensucian la medida de la guirnalda; el resto, a la guirnalda
 *    orgánica más cercana (por la distancia a su eje).
 * 2. Los tamaños se agrupan en los escalones que leyó el lector (chicos < medianos < grandes < gigantes) y de cada uno
 *    sale su diámetro y su parte de los globos.
 * 3. La escala de la foto sale de los propios globos (el diámetro con que se ve en una foto el formato que nombró el lector
 *    entre lo que mide), con los que están a la altura de la pared (los del frente, pegados a la cámara, se ven más grandes).
 * 4. El eje conserva los puntos que leyó el modelo (y agrega puntos en los tramos largos); cada punto se corre hacia el
 *    centro de sus globos y su grosor y su mezcla salen de los que lo rodean: así un lado puede ser más grueso o más
 *    cargado de gigantes que el otro.
 * 5. El reparto de colores sale de la cuenta de colores (`medir-colores.ts`), y los gigantes y grandes quedan uno por uno,
 *    con su color y su diámetro, como `anclas`.
 * 6. Los fondos del catálogo se ponen en la caja donde se detectaron (`medir-fondos.ts`).
 *
 * Los chicos se detectan peor que los grandes (se tapan entre sí): su parte se toma como la mayor entre la detectada y la
 * leída. Con pocos globos detectados en una pieza (menos de `MINIMO_GLOBOS`) la pieza queda como la leyó el lector. El
 * resultado cumple el esquema de la lectura (si no, la lectura queda como la leyó el lector y se dice).
 */

/** Con menos globos que estos en una pieza no se fía de la detección. */
const MINIMO_GLOBOS = 15;
/** Globos alrededor de un punto del eje para medir su grosor y su mezcla. */
const MINIMO_POR_PUNTO = 5;
/** El extremo de una guirnalda que llega a esta fracción del alto de la foto de la línea del piso nace del piso y no se sube. */
const TOCA_PISO = 0.03;
/** El grosor medido de un punto queda entre estas veces el grosor leído. */
const GROSOR_MINIMO = 0.5;
const GROSOR_MAXIMO = 1.6;
/** Los percentiles del borde de fuera y de dentro de los globos de un punto (el 10 % más suelto no manda). */
const PERCENTIL_FUERA = 0.9;
const PERCENTIL_DENTRO = 0.1;
/** Cuánto se aparta la escala de los globos de la leída para corregirla (fracción), y sus límites en cm de alto de foto. */
const DESVIO_ESCALA = 0.1;
const ESCALA_MINIMA_CM = 60;
const ESCALA_MAXIMA_CM = 1500;
/** El esquema admite hasta 80 anclas por guirnalda. */
const MAXIMO_ANCLAS = 80;
const ANCHO_COLUMNA_CLASICA = 0.06;
const ANCHO_RAMO_POR_GLOBO = 0.015;
const RADIO_DECORACION = 0.07;
const ALCANCE_GUIRNALDA = 0.85;

type Pieza<T extends PiezaLeida["tipo"]> = Extract<PiezaLeida, { tipo: T }>;
type Guirnalda = Pieza<"guirnalda_organica">;
type Monton = Pieza<"racimo_piso">;

// ----------------------------------------------------------------------------------------------------------
// Una guirnalda
// ----------------------------------------------------------------------------------------------------------

type Medicion = { pieza: PiezaLeida; escalaCm: number | null; notas: string[] };

/** El grosor de cada punto promediado con sus vecinos (la medida por punto salta de uno a otro). */
function suavizarGrosor<T extends { grosor: number }>(puntos: readonly T[]): T[] {
  return puntos.map((q, i) => {
    const vecinos = [puntos[i - 1], q, q, puntos[i + 1]].filter((x): x is T => Boolean(x));
    return { ...q, grosor: r3(vecinos.reduce((s, x) => s + x.grosor, 0) / vecinos.length) };
  });
}

const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Los gigantes y los grandes uno por uno, donde están, con su color (el de la pieza más parecido) y su diámetro; los mayores si
 * pasan del tope. Salen de mayor a menor diámetro y, a igual diámetro, por sitio: no dependen del orden en que llegaron las cajas.
 */
function anclasDe(porEscalon: ReadonlyMap<Escalon, readonly Globo[]>, colores: readonly ColorLeido[], aspecto: number, filtro: (g: Globo) => boolean = () => true): AnclaLeida[] {
  const indiceDe = indiceDeDetectado(colores);
  return (["gigantes", "grandes"] as const)
    .flatMap((e) => (porEscalon.get(e) ?? []).filter(filtro).flatMap((g) => {
      const k = indiceDe(g.color);
      return k >= 0 ? [{ x: r3(g.x / aspecto), y: r3(g.y), escalon: e, color: colores[k]!.nombre, diametro: r3(g.d) }] : [];
    }))
    .sort((a, b) => b.diametro! - a.diametro! || a.x - b.x || a.y - b.y).slice(0, MAXIMO_ANCLAS);
}

function medirGuirnalda(p: Guirnalda, detectados: readonly Globo[], aspecto: number, pisoY: number | null): Medicion {
  const notas: string[] = [];
  if (detectados.length < MINIMO_GLOBOS) return { pieza: p, escalaCm: null, notas };
  const t = medirTamanos(p.mezcla, detectados, pisoY, true);
  const { escalones, escalonDe, porEscalon, mezcla, reparto, globos } = t;
  if (t.atipicos) notas.push(`${t.atipicos} cajas detectadas no son de ningún tamaño de globo de la guirnalda (un fondo, un globo repetido): no se midieron.`);
  // Colores por la cuenta (de la pieza, de cada escalón y, abajo, de cada tramo).
  const colores = coloresDe(p.colores, globos);
  const coloresPorEscalon = coloresPorEscalonDe(porEscalon, colores);
  const indiceDe = indiceDeDetectado(colores);
  // Eje: los puntos del lector más los de los tramos largos; cada globo cae en el punto más cercano a lo largo del eje, y de
  // los que caen en cada punto salen su grosor (de borde a borde, a los dos lados del eje), su centro y su mezcla.
  const eje = ejeMedido(p.puntos, aspecto);
  const largos = largosDelEje(eje);
  const total = largos[largos.length - 1] || 1;
  const grosorLeido = mediana(p.puntos.map((q) => q.grosor));
  const caen: Array<Array<{ g: Globo; lado: number; escalon: Escalon }>> = eje.map(() => []);
  globos.forEach((g, i) => {
    const pr = proyectar(g, eje);
    const lado = (g.x - pr.q.x) * pr.normal.x + (g.y - pr.q.y) * pr.normal.y;
    const recorrido = pr.t * total;
    const k = largos.reduce((mejor, l, j) => (Math.abs(l - recorrido) < Math.abs(largos[mejor]! - recorrido) ? j : mejor), 0);
    caen[k]!.push({ g, lado, escalon: escalonDe[i]! });
  });
  const medidos = eje.map((q, i) => {
    // Con pocos globos en el punto, también los de los vecinos.
    const lista = caen[i]!.length >= MINIMO_POR_PUNTO ? caen[i]! : [...(caen[i - 1] ?? []), ...caen[i]!, ...(caen[i + 1] ?? [])];
    if (lista.length < MINIMO_POR_PUNTO) return null;
    const afuera = percentil(lista.map((x) => x.lado + x.g.d / 2), PERCENTIL_FUERA), adentro = percentil(lista.map((x) => x.lado - x.g.d / 2), PERCENTIL_DENTRO);
    const grosor = entre(afuera - adentro, grosorLeido * GROSOR_MINIMO, grosorLeido * GROSOR_MAXIMO);
    const corrimiento = (afuera + adentro) / 2;
    const normal = normalEnPunto(eje, i);
    // Los extremos que tocan el piso no se suben: solo se corren de lado.
    const extremo = i === 0 || i === eje.length - 1;
    const enElPiso = extremo && pisoY !== null && q.y + grosor / 2 >= pisoY - TOCA_PISO;
    const tramo = repartoDe(lista.map((x) => x.escalon), escalones, reparto);
    // El dominante se mide con el cuerpo (sin el escalón más chico): los chicos son el acento regado por todo el recorrido (los cromados plateados) y no dicen de qué color es el tramo.
    const cuerpo = lista.filter((x) => escalones.length < 2 || x.escalon !== escalones[0]);
    return { x: q.x + normal.x * corrimiento, y: enElPiso ? q.y : q.y + normal.y * corrimiento, grosor, mezcla: tramo, dominante: dominanteDe(cuerpo.map((x) => x.g), colores, indiceDe) };
  });
  const puntos = suavizarGrosor(eje.map((q, i) => {
    const leido = q.origen === null ? null : p.puntos[q.origen]!;
    const m = medidos[i];
    if (!m) {
      // Sin globos suficientes: el punto como lo leyó el modelo, o (si es de los agregados) entre sus vecinos.
      if (leido) return { ...leido, grosor: r3(leido.grosor) };
      const antes = eje.slice(0, i).reverse().find((x) => x.origen !== null), despues = eje.slice(i + 1).find((x) => x.origen !== null);
      const a = p.puntos[antes?.origen ?? despues!.origen!]!, b = p.puntos[despues?.origen ?? antes!.origen!]!;
      return { x: r3(q.x / aspecto), y: r3(q.y), grosor: r3((a.grosor + b.grosor) / 2) };
    }
    return { x: r3(entre(m.x / aspecto, -0.2, 1.2)), y: r3(entre(m.y, -0.2, 1.2)), grosor: m.grosor, mezcla: m.mezcla, ...(m.dominante ? { dominante: m.dominante } : {}) };
  }));
  notas.push(`Guirnalda medida con ${globos.length} globos detectados: ${escalones.map((e) => `${e} ${reparto[e] ?? 0} %`).join(", ")}.`);
  // Anclas: los gigantes y los grandes de la pared, uno por uno, donde están, con su color y su diámetro; los mayores si pasan del tope.
  const anclas = anclasDe(porEscalon, colores, aspecto, t.dePared);
  return { pieza: { ...p, puntos, mezcla, colores, ...(coloresPorEscalon.length ? { coloresPorEscalon } : {}), ...(anclas.length ? { anclas } : {}) }, escalaCm: t.escalaCm, notas };
}

// ----------------------------------------------------------------------------------------------------------
// Un montón de piso
// ----------------------------------------------------------------------------------------------------------

/** Los bordes del montón son los percentiles de las extremidades de sus globos (los sueltos de la orilla no mandan). */
const PERCENTIL_BORDE_MONTON = 0.04;
/** El montón medido no se aparta de su recuadro leído más que esto (veces su ancho leído) ni se queda en menos de esta fracción de su alto leído. */
const FRACCION_DEL_ALTO_MINIMA = 0.5;

/**
 * El recuadro del montón (centro, ancho, arriba y pie) tomado de sus globos detectados: lo que el lector pone a ojo (corrido, con
 * hueco bajo la columna) sale de donde están los globos. Si lo medido es mucho más bajo que lo leído (la detección se perdió la
 * mitad del montón), se queda lo leído.
 */
function cajaMedida(p: Monton, globos: readonly Globo[], aspecto: number): Pick<Monton, "x" | "ancho" | "yArriba" | "yPie"> | Record<string, never> {
  const x0 = percentil(globos.map((g) => g.x - g.d / 2), PERCENTIL_BORDE_MONTON), x1 = percentil(globos.map((g) => g.x + g.d / 2), 1 - PERCENTIL_BORDE_MONTON);
  const y0 = percentil(globos.map((g) => g.y - g.d / 2), PERCENTIL_BORDE_MONTON), y1 = percentil(globos.map((g) => g.y + g.d / 2), 1 - PERCENTIL_BORDE_MONTON);
  if (y1 - y0 < FRACCION_DEL_ALTO_MINIMA * (p.yPie - p.yArriba)) return {};
  return { x: r3(entre((x0 + x1) / 2 / aspecto, -0.2, 1.2)), ancho: r3(entre(x1 - x0, 0.005, 2)), yArriba: r3(entre(y0, -0.2, 1.2)), yPie: r3(entre(y1, -0.2, 1.2)) };
}

/** El montón de piso con el reparto de tamaños y de colores de sus globos (su escala no se toma: se ve más cerca de la cámara). */
function medirMonton(p: Monton, detectados: readonly Globo[], pisoY: number | null, aspecto: number): Medicion {
  if (detectados.length < MINIMO_GLOBOS) return { pieza: { ...p, colores: coloresDe(p.colores, detectados) }, escalaCm: null, notas: [] };
  const t = medirTamanos(p.mezcla, detectados, pisoY, false);
  const { globos } = t;
  const colores = coloresDe(p.colores, globos);
  const coloresPorEscalon = coloresPorEscalonDe(t.porEscalon, colores);
  const pieza: Monton = { ...p, ...cajaMedida(p, globos, aspecto), mezcla: t.mezcla, colores };
  if (coloresPorEscalon.length) pieza.coloresPorEscalon = coloresPorEscalon; else delete pieza.coloresPorEscalon;
  // Sus gigantes y grandes, uno por uno (el montón está en el piso, por delante: no se filtran por la altura de la pared).
  const anclas = anclasDe(t.porEscalon, colores, aspecto);
  if (anclas.length) pieza.anclas = anclas; else delete pieza.anclas;
  return {
    pieza,
    escalaCm: null,
    notas: [`Montón de piso medido con ${globos.length} globos detectados: ${t.escalones.map((e) => `${e} ${t.reparto[e] ?? 0} %`).join(", ")}.`],
  };
}

// ----------------------------------------------------------------------------------------------------------
// De quién es cada globo
// ----------------------------------------------------------------------------------------------------------

/** ¿El globo cae dentro de la región que ocupa esta pieza que no es una guirnalda? (Los montones de piso se tratan aparte.) */
function dentroDeOtraPieza(g: Globo, p: PiezaLeida, aspecto: number): boolean {
  switch (p.tipo) {
    case "columna_organica": {
      const mitad = Math.max(p.ancho, p.grosor) / 2;
      return Math.abs(g.x - p.x * aspecto) <= mitad && g.y >= p.yArriba - p.grosor / 2 && g.y <= p.yBase;
    }
    case "columna_clasica": return Math.abs(g.x - p.x * aspecto) <= ANCHO_COLUMNA_CLASICA && g.y >= p.yArriba - ANCHO_COLUMNA_CLASICA / 2 && g.y <= p.yBase;
    case "ramo_helio": return Math.abs(g.x - p.x * aspecto) <= Math.max(0.1, p.cantidad * ANCHO_RAMO_POR_GLOBO) && g.y >= p.yArriba - 0.05 && g.y <= p.yBase;
    case "globo": return Math.hypot(g.x - p.x * aspecto, g.y - p.y) <= p.diametro / 2 + g.d / 2;
    case "decoracion": return Math.hypot(g.x - p.x * aspecto, g.y - p.y) <= RADIO_DECORACION * Math.max(1, p.cantidad) + g.d / 2;
    case "metalizado": return Math.abs(g.x - p.x * aspecto) <= (p.alto * p.texto.length * 0.62) / 2 && Math.abs(g.y - p.y) <= p.alto / 2;
    default: return false;
  }
}

/** Una caja detectada es el propio fondo (y no un globo) si se le parece tanto como esto (IoU). */
const IOU_ES_EL_FONDO = 0.3;

/** ¿La caja detectada es un fondo del catálogo tomado por un globo, o un globo sobre un mueble de piso? */
function esDeUnFondo(g: Globo, p: PiezaLeida, aspecto: number): boolean {
  if (p.tipo !== "fondo") return false;
  const f = { x0: p.x * aspecto - p.ancho / 2, x1: p.x * aspecto + p.ancho / 2, y0: p.yBase - p.alto, y1: p.yBase };
  const b = { x0: g.x - g.w / 2, x1: g.x + g.w / 2, y0: g.y - g.h / 2, y1: g.y + g.h / 2 };
  const dentro = Math.max(0, Math.min(f.x1, b.x1) - Math.max(f.x0, b.x0)) * Math.max(0, Math.min(f.y1, b.y1) - Math.max(f.y0, b.y0));
  const union = (f.x1 - f.x0) * (f.y1 - f.y0) + g.w * g.h - dentro;
  if (union > 0 && dentro / union >= IOU_ES_EL_FONDO) return true;
  return FONDOS_CON_SUPERFICIE.has(p.id) && g.x >= f.x0 && g.x <= f.x1 && g.y >= f.y0 && g.y <= f.y1;
}

// ----------------------------------------------------------------------------------------------------------
// Todo junto
// ----------------------------------------------------------------------------------------------------------

/**
 * La lectura con sus guirnaldas orgánicas y montones de piso medidos por los globos detectados, la escala de la foto sacada
 * de ellos (si hay con qué) y los fondos en su caja detectada. Pura: misma lectura y mismas detecciones, misma salida.
 */
export function medirConDetecciones(l: LecturaFoto, detectados: readonly GloboDetectado[], fondos: readonly FondoDetectado[] = []): { lectura: LecturaFoto; notas: string[] } {
  const conFondos = medirFondos(l.piezas, fondos, l.aspecto, l.pisoY);
  const notas = [...conFondos.notas];
  const piezas = [...conFondos.piezas];
  const globos = globosDe(detectados, l.aspecto);
  const guirnaldas = l.piezas.map((p, i) => ({ p, i })).filter((x): x is { p: Guirnalda; i: number } => x.p.tipo === "guirnalda_organica");
  const montones = l.piezas.map((p, i) => ({ p, i })).filter((x): x is { p: Monton; i: number } => x.p.tipo === "racimo_piso");
  let escala = l.escala;
  if ((guirnaldas.length || montones.length) && globos.length) {
    // 1. De quién es cada globo.
    const ejes = guirnaldas.map(({ p }) => ({ eje: p.puntos.map((q) => ({ x: q.x * l.aspecto, y: q.y })) as P[], alcance: Math.max(...p.puntos.map((q) => q.grosor)) * ALCANCE_GUIRNALDA }));
    const asignados: Globo[][] = guirnaldas.map(() => []);
    const deMonton: Globo[][] = montones.map(() => []);
    let deOtras = 0, deFondos = 0;
    for (const g of globos) {
      if (piezas.some((p) => esDeUnFondo(g, p, l.aspecto))) { deFondos++; continue; }
      const k = montones.findIndex(({ p }) => Math.abs(g.x - p.x * l.aspecto) <= p.ancho / 2 && g.y >= p.yArriba && g.y <= p.yPie);
      if (k >= 0) { deMonton[k]!.push(g); continue; }
      if (l.piezas.some((p) => dentroDeOtraPieza(g, p, l.aspecto))) { deOtras++; continue; }
      let mejor = -1, dMin = Infinity;
      ejes.forEach((e, j) => { const d = proyectar(g, e.eje).d; if (d <= e.alcance + g.d / 2 && d < dMin) { dMin = d; mejor = j; } });
      if (mejor >= 0) asignados[mejor]!.push(g);
    }
    if (deFondos) notas.push(`${deFondos} cajas detectadas son de un fondo o de un mueble (el propio panel, lo que hay sobre una mesa): no se miden como globos.`);
    if (deOtras) notas.push(`${deOtras} globos detectados son de otras piezas (columnas, globos sueltos, decoraciones): no cuentan en la medida de las guirnaldas.`);
    const escalas: number[] = [];
    guirnaldas.forEach(({ p, i }, k) => {
      const m = medirGuirnalda(p, asignados[k]!, l.aspecto, l.pisoY);
      piezas[i] = m.pieza;
      notas.push(...m.notas);
      if (m.escalaCm) escalas.push(m.escalaCm);
    });
    montones.forEach(({ p, i }, k) => {
      const m = medirMonton(p, deMonton[k]!, l.pisoY, l.aspecto);
      piezas[i] = m.pieza;
      notas.push(...m.notas);
    });
    escala = escalaCorregida(l, escalas, notas) ?? l.escala;
  }
  const valida = LecturaFotoSchema.safeParse({ ...l, escala, piezas });
  if (!valida.success) {
    const motivos = valida.error.issues.slice(0, 3).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
    return { lectura: l, notas: [`La medida con los globos detectados no cumple el esquema de la lectura (${motivos}): la lectura queda como la escribió el lector.`] };
  }
  return { lectura: valida.data, notas };
}

/** La escala de la foto que dan las guirnaldas (la mediana), si se aparta más del `DESVIO_ESCALA` de la leída. */
function escalaCorregida(l: LecturaFoto, escalas: readonly number[], notas: string[]): LecturaFoto["escala"] | undefined {
  if (!escalas.length) return undefined;
  const cm = Math.min(ESCALA_MAXIMA_CM, Math.max(ESCALA_MINIMA_CM, Math.round(mediana(escalas))));
  if (Math.abs(cm - l.escala.altoImagenCm) / l.escala.altoImagenCm <= DESVIO_ESCALA) return undefined;
  notas.push(`Escala por los globos detectados: ${cm} cm de alto de foto (la leída era ${l.escala.altoImagenCm}).`);
  return { altoImagenCm: cm, referencia: `${l.escala.referencia} · medida con los globos`.slice(0, 80) };
}

