import { alturaDePieza } from "./altura-pieza";
import { alturaEstimada } from "./altura-estimada";
import { ErrorHerramienta, fallar } from "./herramientas-escena-colores";
import { armarOrganico, type OpcionesOrganico, type ResultadoOrganico } from "./organico";
import { segundosDeArmar } from "./presupuesto-cuerpo";
import { EMPAQUES } from "./organico-empaques";
import { contarEstructura, globosDeEstructura, type SitioDeGlobo } from "./organico-estructura";
import { opcionesDe, type Organico, type PiezaOrganica } from "./organico-ajustes";
import { enZona, puntoEnRecorrido, rangoAltura, type ZonaOrganica } from "./zonas-organicas";

/**
 * Medir una pieza orgánica y buscar el peso de un formato que da la meta, para `ajustar_tamanos` (herramientas-escena-tamanos.ts).
 *
 * Armar la pieza es lo caro (segundos en una grande) y la búsqueda prueba muchos pesos: por eso se busca con la cuenta SIN armar
 * (`estimar`: los globos de estructura que pide la mezcla, `organico-estructura.ts`), corrida por lo que el empaque cambia de ella en
 * la pieza de partida (`calibrada`), y solo se arma la elegida (`confirmar`, que si no llega a la meta vuelve a buscar una vez con lo
 * que midió). Con globos fijos (la lectura de una foto) la cuenta no sirve y se busca armando cada prueba, como siempre.
 */

const CACHE = new Map<string, ResultadoOrganico>();
export function armada(p: PiezaOrganica): ResultadoOrganico {
  const o = opcionesDe(p);
  const clave = JSON.stringify(o);
  let r = CACHE.get(clave);
  if (!r) {
    r = armarOrganico(o);
    CACHE.set(clave, r);
    while (CACHE.size > 40) { const k = CACHE.keys().next().value; if (k === undefined) break; CACHE.delete(k); }
  }
  return r;
}

/** ¿El globo está en la zona? (por el punto del eje de su tramo). */
export function filtroZona(o: OpcionesOrganico, zona: ZonaOrganica): (g: SitioDeGlobo) => boolean {
  if (zona === "todo") return () => true;
  const rango = rangoAltura(o.tramos.flatMap((t) => t.recorrido));
  const porId = new Map(o.tramos.map((t) => [t.id, t]));
  return (g) => { const t = porId.get(g.tramo); if (!t) return true; const q = puntoEnRecorrido(t.recorrido, g.fraccion); return enZona(zona, g.fraccion, q.y, rango, q.x); };
}

export type Medida = { cantidad: number; porcentaje: number; estructura: number };

/** Armando la pieza: cuántos globos hay del formato en la zona (con el relleno), qué parte de la estructura son y cuántos globos de estructura hay. */
export function medir(p: PiezaOrganica, formato: string, zona: ZonaOrganica): Medida {
  const dentro = filtroZona(opcionesDe(p), zona);
  const globos = armada(p).globos.filter(dentro);
  const estructura = globos.filter((g) => g.tamano !== "relleno");
  const deFormato = estructura.filter((g) => g.formatoId === formato).length;
  return { cantidad: globos.filter((g) => g.formatoId === formato).length, porcentaje: estructura.length ? (100 * deFormato) / estructura.length : 0, estructura: estructura.length };
}

export const totalDe = (p: PiezaOrganica, formato: string) => armada(p).globos.filter((g) => g.formatoId === formato).length;

/** Sin armar: los globos de estructura que pide la mezcla al formato en la zona (sin el relleno de huecos ni los que no cabrán). */
export function estimar(p: PiezaOrganica, formato: string, zona: ZonaOrganica): Medida {
  const o = opcionesDe(p);
  const cuenta = contarEstructura(o, formato, zona === "todo" ? undefined : filtroZona(o, zona));
  return { cantidad: cuenta.cantidad, porcentaje: cuenta.estructura ? (100 * cuenta.cantidad) / cuenta.estructura : 0, estructura: cuenta.estructura };
}

/** La cuenta sin armar vale si no hay globos fijos: los pone la foto donde ella los tiene y el empaque descuenta su formato. */
export const sePuedeEstimar = (p: PiezaOrganica) => !opcionesDe(p).fijos?.length;

/**
 * Hasta cuánto tarda armar una pieza para que `ajustar_tamanos` la busque como siempre, armando cada prueba (unas diez): con los números
 * medidos, 80 globos de estructura, la mediana de la biblioteca es 24 y el 90 % de sus piezas orgánicas no pasa de 85. Por encima se busca
 * con la cuenta sin armar y se arma la elegida.
 */
export const SEGUNDOS_PARA_BUSCAR_ARMANDO = 0.5;

// ----------------------------------------------------------------------------------------------------------
// Cuántos armados caben en una herramienta
// ----------------------------------------------------------------------------------------------------------

/** Lo que una herramienta puede dedicar a armar piezas que se pueden dejar de armar (el pedido entero tiene `maxDuration`; ver plazo-escena-ia.ts). */
export const SEGUNDOS_DE_ARMADOS = 14;

export type Cuota = { alcanzaOtro(esLaUltima?: boolean): boolean };

export const seBuscaSinArmar = (p: PiezaOrganica) => sePuedeEstimar(p) && segundosDeArmar(globosDeEstructura(opcionesDe(p))) > SEGUNDOS_PARA_BUSCAR_ARMANDO;

/**
 * Si cabe armar una pieza más sin pasar de `SEGUNDOS_DE_ARMADOS`: lo que tardaron los empaques NUEVOS que lleva esta herramienta (los de la caché
 * no cuentan, ni los de otros pedidos: se cuentan desde que se crea la cuota) más el que se pide. Cada uno vale lo que dice `segundosDeArmar` con
 * los globos de estructura que colocó o, si lo medido aquí es menos (un cuerpo delgado casi no lleva relleno), lo medido: nunca más que la
 * fórmula: un equipo cargado nunca vuelve la cuota más estricta, pero uno más rápido que la fórmula sí cabe más armados. El que se pide vale lo que el mayor de los armados hechos (una
 * pieza que cambió de mezcla puede ser mucho más pesada que la de partida) o, si aún no hubo ninguno, lo que dice la fórmula de la pieza de
 * partida. Se cuenta además el armado de la pieza elegida, que no se puede dejar de hacer (salvo que lo que se arma YA sea esa pieza:
 * `esLaUltima`). Sirve para las pruebas que sí se pueden dejar: si un cuerpo más grueso cabe bajo el techo, una segunda búsqueda. En una pieza
 * de segundos, ninguna; en una chica, las que quepan.
 */
export function crearCuota(p: PiezaOrganica): Cuota {
  const hechosAlCrear = EMPAQUES.hechos;
  const calculadoMs = 1000 * segundosDeArmar(globosDeEstructura(opcionesDe(p)));
  return {
    alcanzaOtro: (esLaUltima = false) => {
      const hechos = Math.min(EMPAQUES.hechos - hechosAlCrear, EMPAQUES.registro.length);
      const previstos = EMPAQUES.registro.slice(EMPAQUES.registro.length - hechos).map((e) => Math.min(1000 * segundosDeArmar(e.globos), e.ms));
      const siguienteMs = previstos.length ? Math.max(...previstos) : calculadoMs;
      return previstos.reduce((suma, ms) => suma + ms, 0) + (esLaUltima ? 1 : 2) * siguienteMs <= SEGUNDOS_DE_ARMADOS * 1000;
    },
  };
}

/**
 * Cuánto se acerca al techo (cm) la estimación del alto de un cuerpo más grueso, más una parte de lo que crece, antes de armarlo de verdad para decidir.
 * Medido contra el alto armado, la estimación cae a 1–2 cm con poco engrosado y a 5–7 cm con mucho (el alto armado mismo varía unos centímetros
 * según qué globos asoman en cada empaque).
 */
export const MARGEN_ALTO_CM = 2;
export const MARGEN_POR_CRECIMIENTO = 0.3;

/**
 * Si un cuerpo más grueso que `partida` cabe bajo el techo, sin armarlo cuando se puede: el alto sale del de la pieza de partida (ya armada) y
 * de lo que crece la cima del cuerpo (`altura-estimada.ts`); solo si queda dentro del margen del techo (`MARGEN_ALTO_CM` más un tercio de lo que
 * creció) se arma de verdad, y eso solo si la cuota lo deja («tarde»). Sin techo, siempre cabe. `sinArmar: false`: siempre armada.
 */
export function comprobadorDeAlto(partida: PiezaOrganica, techoCm: number | undefined, cuota: Cuota, sinArmar = true): (p: PiezaOrganica) => "si" | "no" | "tarde" {
  let altoDePartida: number | undefined;
  return (p) => {
    if (techoCm === undefined) return "si";
    // Una pieza que se busca armando (barata de armar) se comprueba armada, como siempre.
    if (!sinArmar) return alturaDePieza(p) <= techoCm ? "si" : "no";
    // El arco por medidas vale por su alto declarado, que no cambia con el grosor: no hay nada que armar.
    if (p.tipo !== "organico") return alturaDePieza(p) <= techoCm ? "si" : "no";
    altoDePartida ??= alturaDePieza(partida);
    const estimado = alturaEstimada(altoDePartida, opcionesDe(partida), opcionesDe(p));
    const margen = MARGEN_ALTO_CM + MARGEN_POR_CRECIMIENTO * Math.abs(estimado - altoDePartida);
    if (estimado <= techoCm - margen) return "si";
    if (estimado > techoCm + margen) return "no";
    return !cuota.alcanzaOtro() ? "tarde" : alturaDePieza(p) <= techoCm ? "si" : "no";
  };
}

// ----------------------------------------------------------------------------------------------------------
// Buscar el peso que da la meta
// ----------------------------------------------------------------------------------------------------------

export type Modo = "al_menos" | "a_lo_mas" | "cerca";
/** Un peso probado: la pieza que da, su valor, y cómo se armó con otro peso (para bajarlo si la pieza no cabe bajo el techo o para volver a buscar). */
export type Probada = {
  pieza: Organico; valor: number; k: number; aplicar?: (k: number) => Organico;
  /** El valor con el peso 1 (de dónde partió la búsqueda). */
  actual?: number;
  /** Lo que se le dice al modelo de cómo se llegó a esta pieza (cuerpo engrosado, peso acotado): solo si es la que queda. */
  notas?: readonly string[];
};

export const llegaA = (valor: number, meta: number, modo: Modo, tolerancia: number): boolean =>
  modo === "cerca" ? Math.abs(valor - meta) <= tolerancia : modo === "al_menos" ? valor >= meta : valor <= meta;

/**
 * Un peso que deja una parte de la pieza sin globos (quitar todos los R-5 de un tramo que solo los lleva) no se puede probar: se salta y se
 * sigue con los demás, en vez de tirar la herramienta entera. Si ninguno se pudo probar, queda la pieza como está (peso 1). `puedeProbar` deja de
 * probar más pesos (y queda el mejor hasta ahí) cuando armar la siguiente prueba ya no cabe en el tiempo de la herramienta.
 */
export function buscar(aplicar: (k: number) => Organico, valor: (p: Organico) => number, actual: number, meta: number, modo: Modo, tolerancia: number, puedeProbar: () => boolean = () => true): Probada {
  const probadas: Probada[] = [];
  const probar = (k: number): Probada | null => {
    if (probadas.length && !puedeProbar()) return null;
    try {
      const pieza = aplicar(k);
      const e = { pieza, valor: valor(pieza), k, aplicar, actual };
      probadas.push(e);
      return e;
    } catch (error) {
      if (error instanceof ErrorHerramienta) return null;
      throw error;
    }
  };
  const sube = meta > actual;
  const margen = modo === "cerca" ? tolerancia : 0;
  const llegaEn = (v: number) => (sube ? v >= meta - margen : v <= meta + margen);
  // Un extremo que no llega (a) y otro que sí (b).
  let a = 1, b: number | null = null;
  for (const k of sube ? [1.7, 3, 6, 12, 30, 80] : [0.55, 0.3, 0.12, 0]) {
    const e = probar(k);
    if (!e) { if (probadas.length && !puedeProbar()) break; continue; }
    if (llegaEn(e.valor)) { b = k; break; }
    a = k;
  }
  if (b !== null) {
    let hasta: number = b;
    for (let i = 0; i < 4; i++) {
      const elegida = elegir(probadas, meta, modo);
      // Ya está: en «al menos / a lo más» que no se pase de largo (hasta un 35 % y 2 globos de más).
      if (llegaA(elegida.valor, meta, modo, tolerancia) && (modo === "cerca" || Math.abs(elegida.valor - meta) <= Math.max(2, meta * 0.35))) break;
      const m: number = sube ? Math.sqrt(a * hasta) : (a + hasta) / 2;
      const e = probar(m);
      if (!e) break;
      if (llegaEn(e.valor)) hasta = m; else a = m;
    }
  }
  if (!probadas.length && !probar(1)) fallar("No se pudo probar ningún peso de ese tamaño en esta pieza.");
  return elegir(probadas, meta, modo);
}

export function elegir(probadas: readonly Probada[], meta: number, modo: Modo): Probada {
  const porCercania = [...probadas].sort((x, y) => Math.abs(x.valor - meta) - Math.abs(y.valor - meta));
  if (modo === "al_menos") return [...probadas].filter((p) => p.valor >= meta).sort((x, y) => x.valor - y.valor)[0] ?? [...probadas].sort((x, y) => y.valor - x.valor)[0]!;
  if (modo === "a_lo_mas") return [...probadas].filter((p) => p.valor <= meta).sort((x, y) => y.valor - x.valor)[0] ?? [...probadas].sort((x, y) => x.valor - y.valor)[0]!;
  return porCercania[0]!;
}

/** La cuenta sin armar corrida a lo que se midió armando en `desde`: el empaque deja fuera algún globo y el relleno puede ser del mismo formato. */
export function calibrada(desde: Organico, valorDesde: number, estimado: (p: Organico) => number): (p: Organico) => number {
  const desfase = valorDesde - estimado(desde);
  return (p) => estimado(p) + desfase;
}

export type Cuentas = {
  real: (p: Organico) => number; estimado: (p: Organico) => number; meta: number; modo: Modo; tolerancia: number; cuota: Cuota;
  /** Lo que cabe del peso probado (el tope de globos de la pieza): `null` si ninguno. Lo que se arma sale siempre de aquí. */
  acotar?: (e: Probada) => Probada | null;
};

/** Cuánto se puede pasar de largo (o quedarse corto, en «a lo más») la pieza armada de la meta sin volver a buscar: el 12 %, o 2 globos. */
const holguraDe = (meta: number) => Math.max(2, Math.ceil(Math.abs(meta) * 0.12));
/** Cuántas veces se corrige lo medido armando otra. */
const PASADAS_DE_AJUSTE = 2;

/**
 * Arma la elegida y mide de verdad. Si así no llega a la meta (la cuenta sin armar se desvió) o se pasa de largo (más de la holgura: los R-18 de
 * más aprietan a los R-12), vuelve a buscar con la cuenta corrida a lo medido —hacia la meta, por encima o por debajo del peso elegido— y arma
 * esa, si la cuota deja armar otra; se queda la que mejor cumple. Como mucho dos correcciones, y nunca un peso que pase del tope (`acotar`).
 */
export function confirmar(elegida: Probada, c: Cuentas): Probada {
  let mejor: Probada = { ...elegida, valor: c.real(elegida.pieza) };
  const vistos = new Set([elegida.k]);
  const holgura = holguraDe(c.meta);
  const justa = (v: number) => llegaA(v, c.meta, c.modo, c.tolerancia) && (c.modo === "cerca" || Math.abs(v - c.meta) <= holgura);
  for (let pasada = 0; pasada < PASADAS_DE_AJUSTE; pasada++) {
    if (justa(mejor.valor) || !mejor.aplicar || mejor.actual === undefined || !c.cuota.alcanzaOtro()) break;
    // El sentido de la búsqueda sale de lo calibrado en la pieza sin tocar (peso 1), no de la `actual` de la primera búsqueda, que pudo estar desviada.
    const calibrado = calibrada(mejor.pieza, mejor.valor, c.estimado);
    const llega = llegaA(mejor.valor, c.meta, c.modo, c.tolerancia);
    const buscada = llega
      ? buscar(mejor.aplicar, calibrado, calibrado(mejor.aplicar(1)), c.meta, "cerca", Math.max(1, Math.floor(holgura / 2)))
      : buscar(mejor.aplicar, calibrado, calibrado(mejor.aplicar(1)), c.meta, c.modo, c.tolerancia, () => c.cuota.alcanzaOtro());
    const otra = c.acotar ? c.acotar({ ...buscada, notas: mejor.notas }) : { ...buscada, notas: mejor.notas };
    if (!otra || vistos.has(otra.k)) break;
    vistos.add(otra.k);
    mejor = elegir([mejor, { ...otra, valor: c.real(otra.pieza) }], c.meta, c.modo);
  }
  return mejor;
}
