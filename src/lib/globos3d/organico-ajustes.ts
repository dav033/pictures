import { fijoEnFormato, mezclaEn, type ColorOrganico, type GloboFijo, type OpcionesOrganico, type PuntoGrosor, type PuntoMezcla, type RellenoOrganico, type TramoOrganico } from "./organico";
import { formatoPorId } from "./formatos";
import { opcionesArcoOrganico } from "./formas-escena";
import { piezaDeGenerador } from "./generadores-organicos";
import { CABE_EN_GROSOR, DENSIDAD_TRAZO, GROSOR_CUERPO_CM, INFLADOS_TRAZO, muestrasTrazo, type ParametrosTrazoOrganico, type PuntoTrazo } from "./trazo-organico";
import { enZona, fraccionesDe, normalizarPesos, puntoEnRecorrido, rangoAltura, type ZonaMezcla, type ZonaOrganica } from "./zonas-organicas";
import { fallar } from "./herramientas-escena-colores";
import type { Pieza } from "./piezas";

/**
 * **Ajustes de una pieza orgánica** por lo que la hace (sin armarla): el peso de un formato en una zona, el relleno, el
 * grosor donde no cabe un formato, la densidad, lo abultado y la paleta. Valen para el trazo (se cambian sus
 * parámetros y se vuelven a sacar sus opciones), para el orgánico sin generador (sus tramos) y para el arco orgánico
 * por medidas (que pasa a orgánico cuando hace falta tocar su mezcla). Los usa `ajustar_tamanos`
 * (herramientas-escena-tamanos.ts), que arma y mide.
 */

const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Peso con que entra un formato que no estaba (sobre la mezcla normalizada), antes de multiplicarlo. */
const PESO_NUEVO = 0.05;
export const DENSIDAD = { min: 0.5, max: 2.5, mas: 1.3, menos: 0.75 } as const;

export type Organico = Extract<Pieza, { tipo: "organico" }>;
type ArcoOrganico = Extract<Pieza, { tipo: "arco_organico" }>;
export type PiezaOrganica = Organico | ArcoOrganico;
export const esPiezaOrganica = (p: Pieza): p is PiezaOrganica => p.tipo === "organico" || p.tipo === "arco_organico";

export const opcionesDe = (p: PiezaOrganica): OpcionesOrganico => (p.tipo === "organico" ? p.opciones : opcionesArcoOrganico(p.arco));

/** El arco por medidas como pieza orgánica (para cambiarle la mezcla o lo abultado), con sus impresos y repintes. */
export function comoOrganico(p: PiezaOrganica): Organico {
  if (p.tipo === "organico") return p;
  return { tipo: "organico", opciones: opcionesArcoOrganico(p.arco), flores: p.arco.flores, ...(p.impresos ? { impresos: p.impresos } : {}), ...(p.repintes ? { repintes: p.repintes } : {}) };
}

/** Cambia una pieza orgánica por su trazo (si lo tiene: vuelve a sacar sus opciones) o por sus opciones. */
export function editar(p: Organico, trazo: (t: ParametrosTrazoOrganico) => ParametrosTrazoOrganico, opciones: (o: OpcionesOrganico) => OpcionesOrganico): Organico {
  if (p.generador?.tipo !== "trazo") return { ...p, opciones: opciones(p.opciones) };
  const nueva = piezaDeGenerador({ tipo: "trazo", trazo: trazo(p.generador.trazo) }, p.flores, p.opciones.huecosFlores);
  return { ...nueva, ...(p.impresos ? { impresos: p.impresos } : {}), ...(p.repintes ? { repintes: p.repintes } : {}) };
}

// ----------------------------------------------------------------------------------------------------------
// Pesos de un formato en una zona (× k)
// ----------------------------------------------------------------------------------------------------------

const limpiar = (pesos: Record<string, number>) => Object.fromEntries(Object.entries(pesos).filter(([, w]) => w > 0).map(([f, w]) => [f, Math.round(w * 10000) / 10000]));

/**
 * Los puntos del trazo con el formato × k en su mezcla propia (`pesos`: la de los tramos medidos de una foto); con `quitarDeTodos`,
 * sin ese formato (la zona lo vuelve a poner donde va). Un punto que se queda sin pesos vuelve a la mezcla de la pieza.
 */
function pesoEnPuntos(puntos: readonly PuntoTrazo[], f: string, k: number | null): PuntoTrazo[] {
  return puntos.map((q) => {
    if (!q.pesos) return q;
    const pesos = normalizarPesos(q.pesos);
    if (k === null) delete pesos[f];
    else pesos[f] = (pesos[f] ?? 0) > 0 ? pesos[f]! * k : PESO_NUEVO * k;
    const limpios = limpiar(pesos);
    const nuevo: PuntoTrazo = { ...q };
    if (Object.keys(limpios).length) nuevo.pesos = limpios; else delete nuevo.pesos;
    return nuevo;
  });
}

/**
 * Los globos fijos que quedan tras bajar un formato (k < 1) en una zona: de los de ese formato dentro de la zona se conservan
 * `k` de ellos, repartidos a lo largo; con `soloAhi`, los de ese formato fuera de la zona se quitan. Con k ≥ 1 no se toca ninguno
 * (los fijos cuentan en la meta de su formato; la estructura pone los que falten).
 */
function fijosTrasCambio(t: ParametrosTrazoOrganico, f: string, zona: ZonaOrganica, k: number, soloAhi: boolean): readonly GloboFijo[] | undefined {
  if (!t.fijos?.length || (k >= 1 && !soloAhi)) return t.fijos;
  const { muestras, rango } = muestrasTrazo(t);
  const dentro = (g: GloboFijo) => {
    const m = muestras.reduce((mejor, q) => (Math.hypot(q.x - g.x, q.y - g.y) < Math.hypot(mejor.x - g.x, mejor.y - g.y) ? q : mejor), muestras[0]!);
    return enZona(zona, m.t, g.y, rango, g.x);
  };
  const quitar = new Set<GloboFijo>();
  const delFormato = t.fijos.filter((g) => fijoEnFormato(g, f));
  if (soloAhi && zona !== "todo") for (const g of delFormato) if (!dentro(g)) quitar.add(g);
  if (k < 1) {
    const enZonaOrdenados = delFormato.filter((g) => !quitar.has(g) && dentro(g)).sort((a, b) => a.x - b.x);
    const quedan = Math.round(enZonaOrdenados.length * k);
    const conservar = new Set(Array.from({ length: quedan }, (_, j) => Math.floor(((j + 0.5) * enZonaOrdenados.length) / quedan)));
    enZonaOrdenados.forEach((g, i) => { if (!conservar.has(i)) quitar.add(g); });
  }
  const quedan = t.fijos.filter((g) => !quitar.has(g));
  return quedan.length ? quedan : undefined;
}

/** El trazo con el peso del formato × k en la zona (si no estaba, entra con PESO_NUEVO × k); `soloAhi` lo quita del resto. */
function pesoTrazo(t: ParametrosTrazoOrganico, f: string, zona: ZonaOrganica, k: number, soloAhi: boolean): ParametrosTrazoOrganico {
  const base: Record<string, number> = normalizarPesos(t.mezcla);
  let zonas: Array<{ zona: ZonaOrganica; pesos: Record<string, number> }> = (t.zonas ?? []).map((z) => ({ zona: z.zona, pesos: { ...z.pesos } }));
  const por = (w: number | undefined) => ((w ?? 0) > 0 ? w! * k : PESO_NUEVO * k);
  if (zona === "todo") {
    const soloEnZonas = !(base[f]! > 0) && zonas.some((z) => (z.pesos[f] ?? 0) > 0);
    if (!soloEnZonas) base[f] = por(base[f]);
    for (const z of zonas) if ((z.pesos[f] ?? 0) > 0) z.pesos[f] = z.pesos[f]! * k;
  } else {
    const propia = zonas.find((z) => z.zona === zona);
    const w = por(propia?.pesos[f] ?? base[f]);
    // La zona cambiada va al final: lo último que se pidió manda donde dos zonas se pisan.
    zonas = [...zonas.filter((z) => z !== propia), { zona, pesos: { ...(propia?.pesos ?? {}), [f]: w } }];
    if (soloAhi) { delete base[f]; for (const z of zonas) if (z.zona !== zona) delete z.pesos[f]; }
  }
  const mezcla = limpiar(base);
  if (!Object.keys(mezcla).length) fallar(`Así la pieza se quedaría sin globos fuera de la zona: deja otro tamaño (o usa poner/mas con otro formato antes).`);
  // Una zona con peso 0 sí cuenta (quita el formato ahí): solo se descartan las que no traen nada.
  const zonasLimpias: ZonaMezcla[] = zonas.filter((z) => Object.keys(z.pesos).length).map((z) => ({ zona: z.zona, pesos: Object.fromEntries(Object.entries(z.pesos).map(([x, w]) => [x, Math.round(w * 10000) / 10000])) }));
  // La mezcla propia de cada punto manda sobre la de la pieza: el cambio también va ahí.
  const puntos = zona === "todo" ? pesoEnPuntos(t.puntos, f, k) : soloAhi ? pesoEnPuntos(t.puntos, f, null) : t.puntos;
  const fijos = fijosTrasCambio(t, f, zona, k, soloAhi);
  const resto: ParametrosTrazoOrganico = { ...t, puntos, mezcla };
  delete resto.fijos;
  if (fijos) resto.fijos = fijos;
  delete resto.zonas;
  return zonasLimpias.length ? { ...resto, zonas: zonasLimpias } : resto;
}

/** Lo mismo en los tramos de un orgánico sin generador (la mezcla se pone en 13 puntos por tramo si hay zona). */
function pesoTramos(o: OpcionesOrganico, f: string, zona: ZonaOrganica, k: number, soloAhi: boolean): OpcionesOrganico {
  const rango = rangoAltura(o.tramos.flatMap((t) => t.recorrido));
  const existe = o.tramos.some((t) => t.mezcla.some((p) => (p.pesos[f] ?? 0) > 0));
  const tramos = o.tramos.map((t) => {
    const ts = zona === "todo" && !soloAhi ? t.mezcla.map((p) => p.t) : [...new Set([...t.mezcla.map((p) => p.t), ...Array.from({ length: 13 }, (_, i) => i / 12)])].sort((a, b) => a - b);
    const mezcla: PuntoMezcla[] = ts.map((tt) => {
      const pesos: Record<string, number> = Object.fromEntries(mezclaEn(t.mezcla, tt));
      const punto = puntoEnRecorrido(t.recorrido, tt);
      const dentro = enZona(zona, tt, punto.y, rango, punto.x);
      if (dentro) {
        const w = pesos[f] ?? 0;
        if (w > 0) pesos[f] = w * k;
        else if (zona !== "todo" || !existe) pesos[f] = PESO_NUEVO * k;
      } else if (soloAhi) delete pesos[f];
      const limpios = limpiar(pesos);
      if (!Object.keys(limpios).length) fallar(`Sin ${f} una parte de «${t.nombre}» se quedaría sin globos: pon otro tamaño ahí primero.`);
      return { t: Math.round(tt * 1000) / 1000, pesos: limpios };
    });
    return { ...t, mezcla };
  });
  return { ...o, tramos };
}

export const conPeso = (p: Organico, f: string, zona: ZonaOrganica, k: number, soloAhi: boolean): Organico =>
  editar(p, (t) => pesoTrazo(t, f, zona, k, soloAhi), (o) => pesoTramos(o, f, zona, k, soloAhi));

/**
 * El relleno sin ese formato. Sin ningún relleno que quede, el formato más chico de la mezcla a medio inflar, pero no uno
 * de los `evitar` (los que el mismo pedido baja: «menos R-5 y R-9» no puede volver a taparlo todo con R-5); si todos se
 * evitan, el más chico.
 */
export function conRelleno(p: Organico, f: string, evitar: ReadonlySet<string> = new Set()): Organico {
  let relleno: RellenoOrganico[] = opcionesDe(p).relleno.filter((r) => r.formatoId !== f).map((r) => ({ ...r }));
  if (!relleno.length) {
    const formatos = [...new Set(opcionesDe(p).tramos.flatMap((t) => t.mezcla.flatMap((m) => Object.keys(m.pesos).filter((x) => (m.pesos[x] ?? 0) > 0))))].filter((x) => x !== f);
    const admitidos = formatos.filter((x) => !evitar.has(x));
    const menor = (admitidos.length ? admitidos : formatos).sort((a, b) => inflado(p, a) - inflado(p, b))[0];
    if (menor) relleno = [{ formatoId: menor, infladoCm: r0(inflado(p, menor) * 0.88), trios: false }];
  }
  return editar(p, (t) => ({ ...t, relleno }), (o) => ({ ...o, relleno }));
}

export function inflado(p: PiezaOrganica, f: string): number {
  return opcionesDe(p).inflados?.[f] ?? (p.tipo === "organico" && p.generador ? INFLADOS_TRAZO[f] : undefined) ?? formatoPorId(f)?.infladoDecoracionCm ?? fallar(`El formato «${f}» no existe.`);
}

// ----------------------------------------------------------------------------------------------------------
// ¿Cabe? Engrosar el trazo donde haga falta
// ----------------------------------------------------------------------------------------------------------

/** El grosor (cm) en que cabe un formato: su inflado no pasa de 0,82 × grosor (como en el trazo). */
export const grosorMinimo = (p: Organico, f: string) => Math.ceil(inflado(p, f) / CABE_EN_GROSOR + 1);

/** Radio de la envoltura de un tramo en `t` (lineal entre sus puntos de grosor). */
function radioEn(grosor: readonly PuntoGrosor[], t: number): number {
  const g = [...grosor].sort((a, b) => a.t - b.t);
  if (!g.length) return 0;
  if (t <= g[0]!.t) return g[0]!.radioCm;
  for (let i = 1; i < g.length; i++) if (t <= g[i]!.t) return g[i - 1]!.radioCm + (g[i]!.radioCm - g[i - 1]!.radioCm) * ((t - g[i - 1]!.t) / (g[i]!.t - g[i - 1]!.t || 1));
  return g[g.length - 1]!.radioCm;
}

/** ¿Cabe el formato en el cuerpo de la zona? En toda, en parte o en nada (por puntos del eje cada 2 % del recorrido). */
export function cabe(p: Organico, f: string, zona: ZonaOrganica): "todo" | "parte" | "nada" {
  const minimo = inflado(p, f) / CABE_EN_GROSOR;
  let gruesos: boolean[];
  if (p.generador?.tipo === "trazo") {
    const { muestras, rango } = muestrasTrazo(p.generador.trazo);
    gruesos = muestras.filter((q) => enZona(zona, q.t, q.y, rango, q.x)).map((q) => q.grosor >= minimo);
  } else {
    const o = p.opciones;
    const rango = rangoAltura(o.tramos.flatMap((t) => t.recorrido));
    gruesos = o.tramos.flatMap((t) => Array.from({ length: 51 }, (_, i) => i / 50).filter((u) => { const q = puntoEnRecorrido(t.recorrido, u); return enZona(zona, u, q.y, rango, q.x); }).map((u) => 2 * radioEn(t.grosor, u) >= minimo));
  }
  const n = gruesos.filter(Boolean).length;
  return n === 0 ? "nada" : n === gruesos.length ? "todo" : "parte";
}

/**
 * Engruesa el cuerpo de la zona lo justo para que quepa el formato: primero solo lo grueso (los puntos de al menos el
 * 85 % del mayor: las puntas finas no cambian); `amplio`, todos los de la zona y sus vecinos. Los puntos son los del
 * trazo o los de grosor de cada tramo. Si la zona no tiene ninguno, los de toda la pieza.
 */
export function engrosar(p: Organico, f: string, zona: ZonaOrganica, amplio: boolean): { pieza: Organico; nota: string } | null {
  const minimo = grosorMinimo(p, f);
  if (minimo > GROSOR_CUERPO_CM.max) return null;
  /** Qué puntos (de una lista con su diámetro y si están en la zona) se engruesan. */
  const elegir = (diametros: readonly number[], dentro: readonly boolean[]): boolean[] => {
    const mayor = Math.max(0, ...diametros.filter((_, i) => dentro[i]));
    return diametros.map((d, i) => d < minimo && (amplio ? !!dentro[i] || !!dentro[i - 1] || !!dentro[i + 1] : !!dentro[i] && d >= mayor * 0.85));
  };
  const cambiados: number[] = [];
  let total = 0;
  let pieza: Organico;
  if (p.generador?.tipo === "trazo") {
    const t = p.generador.trazo;
    const { rango } = muestrasTrazo(t);
    const fr = fraccionesDe(t.puntos);
    let dentro = t.puntos.map((q, i) => enZona(zona, fr[i]!, q.y, rango, q.x));
    if (!dentro.some(Boolean)) dentro = t.puntos.map(() => true);
    const sube = elegir(t.puntos.map((q) => q.grosor), dentro);
    t.puntos.forEach((q, i) => { if (sube[i]) cambiados.push(q.grosor); });
    total = t.puntos.length;
    pieza = editar(p, (x) => ({ ...x, puntos: x.puntos.map((q, i) => (sube[i] ? { ...q, grosor: minimo } : q)) }), (o) => o);
  } else {
    const o = p.opciones;
    const rango = rangoAltura(o.tramos.flatMap((t) => t.recorrido));
    const dentroDe = (t: TramoOrganico) => t.grosor.map((g) => { const q = puntoEnRecorrido(t.recorrido, g.t); return enZona(zona, g.t, q.y, rango, q.x); });
    const ninguno = !o.tramos.some((t) => dentroDe(t).some(Boolean));
    const tramos = o.tramos.map((t) => {
      const dentro = ninguno ? t.grosor.map(() => true) : dentroDe(t);
      const sube = elegir(t.grosor.map((g) => 2 * g.radioCm), dentro);
      t.grosor.forEach((g, i) => { if (sube[i]) cambiados.push(2 * g.radioCm); });
      total += t.grosor.length;
      return { ...t, grosor: t.grosor.map((g, i) => (sube[i] ? { ...g, radioCm: minimo / 2 } : g)) };
    });
    pieza = { ...p, opciones: { ...o, tramos } };
  }
  if (!cambiados.length) return null;
  const menor = r0(Math.min(...cambiados)), mayor = r0(Math.max(...cambiados));
  const de = menor === mayor ? `${menor}` : `${menor}–${mayor}`;
  return { pieza, nota: `engrosé el cuerpo${zona === "todo" ? "" : ` (${zona})`} de ${de} a ${minimo} cm en ${cambiados.length} de ${total} puntos para que quepan los ${f} (inflado ${r0(inflado(p, f))} cm: no caben en menos de ${minimo} cm de grosor)` };
}

// ----------------------------------------------------------------------------------------------------------
// Densidad, racimos, grosor y paleta
// ----------------------------------------------------------------------------------------------------------

export function densidadDe(p: PiezaOrganica): number {
  if (p.tipo === "arco_organico") return p.arco.densidad;
  return p.generador?.tipo === "trazo" ? (p.generador.trazo.densidad ?? DENSIDAD_TRAZO) : (p.opciones.densidad ?? 1);
}

export function conDensidad(p: PiezaOrganica, factor: number): PiezaOrganica {
  const d = r2(Math.min(DENSIDAD.max, Math.max(DENSIDAD.min, densidadDe(p) * factor)));
  if (p.tipo === "arco_organico") return { ...p, arco: { ...p.arco, densidad: d } };
  return editar(p, (t) => ({ ...t, densidad: d }), (o) => ({ ...o, densidad: d }));
}

/** Lo abultado: los racimos del trazo (0–1) o, sin generador, la irregularidad de los tramos (0–0,3) en la misma escala. */
export function racimosDe(p: Organico): number {
  return r2(p.generador?.tipo === "trazo" ? (p.generador.trazo.racimos ?? 0.35) : Math.max(0, ...p.opciones.tramos.map((t) => t.irregularidad)) / 0.3);
}

export function conRacimos(p: Organico, valor: number): Organico {
  const v = r2(Math.min(1, Math.max(0, valor)));
  return editar(p, (t) => ({ ...t, racimos: v }), (o) => ({ ...o, tramos: o.tramos.map((t) => ({ ...t, irregularidad: r2(v * 0.3) })) }));
}

/** Cuánto sobresalen los bultos del trazo sobre su grosor (fracción); sin generador, la amplitud de la irregularidad. */
export function bultosDe(p: Organico): number {
  if (p.generador?.tipo !== "trazo") return Math.max(0, ...p.opciones.tramos.map((t) => t.irregularidad));
  const { muestras } = muestrasTrazo(p.generador.trazo);
  const grosor = p.opciones.tramos[0]?.grosor ?? [];
  return Math.max(0, ...grosor.map((g, i) => (2 * g.radioCm) / (muestras[i]?.grosor ?? 2 * g.radioCm) - 1));
}

/**
 * El cuerpo más grueso (× factor): el trazo por sus puntos (diámetros), los tramos por su envoltura y el arco por sus radios, sin pasar
 * del grosor máximo de un cuerpo. El presupuesto de armado lo acota quien lo pide (`presupuesto-ajustes.ts`).
 */
export function conGrosor(p: PiezaOrganica, factor: number): PiezaOrganica {
  const diametro = (x: number) => Math.round(Math.min(GROSOR_CUERPO_CM.max, x * factor) * 10) / 10;
  const radio = (x: number) => Math.round(Math.min(GROSOR_CUERPO_CM.max / 2, x * factor) * 10) / 10;
  if (p.tipo === "arco_organico") return { ...p, arco: { ...p.arco, radioBaseCm: radio(p.arco.radioBaseCm), radioPuntaCm: radio(p.arco.radioPuntaCm) } };
  return editar(p, (t) => ({ ...t, puntos: t.puntos.map((q) => ({ ...q, grosor: diametro(q.grosor) })) }), (o) => ({ ...o, tramos: o.tramos.map((t) => ({ ...t, grosor: t.grosor.map((x) => ({ ...x, radioCm: radio(x.radioCm) })) })) }));
}

export function paletaDe(p: PiezaOrganica): readonly ColorOrganico[] {
  if (p.tipo === "arco_organico") return p.arco.colores;
  return p.generador?.tipo === "trazo" ? p.generador.trazo.colores : p.opciones.colores;
}

export function conPaleta(p: PiezaOrganica, colores: ColorOrganico[]): PiezaOrganica {
  if (p.tipo === "arco_organico") return { ...p, arco: { ...p.arco, colores } };
  return editar(p, (t) => ({ ...t, colores }), (o) => ({ ...o, colores }));
}
