import { z } from "zod";
import type { ColorOrganico } from "./organico";
import type { ZonaOrganica } from "./zonas-organicas";
import { alturaDePieza } from "./altura-pieza";
import { conAcabado, fallar, nombreColor, resolverColorFlexible } from "./herramientas-escena-colores";
import {
  DENSIDAD, bultosDe, cabe, comoOrganico, conDensidad, conPaleta, conPeso, conRacimos, conRelleno, densidadDe, engrosar, grosorMinimo, inflado, opcionesDe,
  paletaDe, racimosDe, type Organico, type PiezaOrganica,
} from "./organico-ajustes";
import { engrosarEnPresupuesto, porQueNoCabe, valorQueCabeEnPresupuesto } from "./presupuesto-ajustes";
import { GLOBOS_MAXIMOS_CUERPO } from "./presupuesto-cuerpo";
import { armada, buscar, calibrada, comprobadorDeAlto, confirmar, crearCuota, estimar, medir, seBuscaSinArmar, totalDe, type Cuota, type Modo, type Probada } from "./herramientas-escena-tamanos-busqueda";

export { esPiezaOrganica, type PiezaOrganica } from "./organico-ajustes";

/**
 * **Edición precisa de lo orgánico** para la IA de escena (`ajustar_tamanos`): «más R-24», «menos globos chicos»,
 * «los R-24 solo abajo», «un 40 % de R-18», «exactamente 6 R-24», «los grandes en azul reflex», «más tupida», «más
 * abultada». Sirve para cualquier pieza orgánica (con generador de trazo, sin él, y el arco orgánico por medidas).
 *
 * Cómo: la mezcla del motor orgánico son pesos por formato **en número de globos**, pero cuántos salen depende del
 * grosor y de lo que de verdad cabe; así que cada cambio se **busca**: se multiplica el peso del formato en la zona y se
 * prueba hasta llegar a la meta (más = al menos +60 %; menos = la mitad; o la cantidad o el porcentaje pedidos). Armar la
 * pieza es lo caro (segundos en una grande): una pieza de armado barato (hasta ~0,5 s) se busca armando cada prueba, como siempre;
 * una más pesada se mide con los globos de estructura que pide la mezcla, contados sin armar (`organico-estructura.ts`), y se
 * arma la elegida (y cada cuerpo más grueso que se prueba), midiendo de verdad; si así no llega a la meta se busca una vez más con
 * lo medido (`herramientas-escena-tamanos-busqueda.ts`, que también limita cuántos armados caben en una herramienta). El
 * resultado dice cuántos había y cuántos hay de cada formato, contados en la pieza armada.
 * Un formato solo cabe donde el cuerpo es lo bastante grueso (inflado ≤ 0,82 × grosor; el trazo no pone el que no
 * cabe y sin generador sobresaldría): si no cabe en la zona, se engruesa ahí el cuerpo lo justo (y se dice), salvo que
 * se pida `engrosar: false`. Ningún engrosado pasa del presupuesto de armado (presupuesto-ajustes.ts): se acota y se dice.
 * Las transformaciones de la pieza están en organico-ajustes.ts.
 */

export const FORMATOS_AJUSTABLES = ["R-36", "R-24", "R-18", "R-12", "R-9", "R-5"] as const;
/** El tamaño que pide la herramienta: el modelo y la validación ven la misma lista, y un formato ajeno dice cuáles valen. */
export const FORMATO_AJUSTABLE = z.enum(FORMATOS_AJUSTABLES, {
  error: (issue) => `«${String(issue.input)}» no es un tamaño de lo orgánico: usa ${FORMATOS_AJUSTABLES.join(", ")}`,
});
export const ACCIONES_TAMANO = ["mas", "menos", "quitar", "poner"] as const;

export type CambioTamano = { formato: string; accion: (typeof ACCIONES_TAMANO)[number]; cantidad?: number; porcentaje?: number; donde?: ZonaOrganica; solo_ahi?: boolean };
export type ColorPorTamano = { formatos: readonly string[]; colores: readonly string[]; pesos?: readonly number[]; exclusivo?: boolean };
export type PedidoTamanos = {
  cambios?: readonly CambioTamano[];
  colores_por_tamano?: readonly ColorPorTamano[];
  acabado?: string;
  densidad?: "mas" | "menos";
  densidad_factor?: number;
  racimos?: "mas" | "menos";
  racimos_valor?: number;
  engrosar?: boolean;
};

const r0 = (n: number) => Math.round(n);
/** Al bajar el peso de un formato para que la pieza quepa bajo el techo: cuánto del aumento se conserva en cada paso, y el peso a partir del que ya no se baja. */
const REDUCCION_RECORTE = 0.75;
const PESO_MINIMO_RECORTE = 1.05;
/** Cuánto se engruesa el cuerpo, por pasos, cuando un tamaño no llega a la meta con el grosor que hay; y cuando ya no cabe más densidad. */
const FACTORES_CUERPO = [1.12, 1.25, 1.4, 1.55, 1.75, 2] as const;
const ENGROSAR_POR_DENSIDAD = 1.15;
/** El mayor peso que prueba la búsqueda de un formato (el último de `buscar`). */
const PESO_MAXIMO = 80;
const orden = (f: string) => { const i = (FORMATOS_AJUSTABLES as readonly string[]).indexOf(f); return i < 0 ? 99 : i; };

// ----------------------------------------------------------------------------------------------------------
// Medir: armar la pieza y contar (por formato, color, zona y relleno)
// ----------------------------------------------------------------------------------------------------------

/**
 * Los globos de una pieza por formato (del más grande al más chico) con sus colores, y el relleno si se sabe:
 * «92 globos: R-24 6 [609×4, 005×2] · R-12 30 […] · R-5 40, 36 de relleno […]».
 */
export function textoConteo(materiales: readonly { formatoId: string; codigo: string; cantidad: number }[], relleno?: ReadonlyMap<string, number>): string {
  const porFormato = new Map<string, Map<string, number>>();
  for (const m of materiales) {
    if (m.cantidad <= 0) continue;
    const colores = porFormato.get(m.formatoId) ?? new Map<string, number>();
    colores.set(m.codigo, (colores.get(m.codigo) ?? 0) + m.cantidad);
    porFormato.set(m.formatoId, colores);
  }
  const total = materiales.reduce((s, m) => s + Math.max(0, m.cantidad), 0);
  const partes = [...porFormato].sort((a, b) => orden(a[0]) - orden(b[0])).map(([f, colores]) => {
    const n = [...colores.values()].reduce((s, x) => s + x, 0);
    const rel = relleno?.get(f) ?? 0;
    return `${f} ${n}${rel ? `, ${rel} de relleno` : ""} [${[...colores].sort((a, b) => b[1] - a[1]).map(([c, x]) => `${c}×${x}`).join(", ")}]`;
  });
  return `${total} globos: ${partes.join(" · ")}`;
}

function conteoDe(p: PiezaOrganica): string {
  const r = armada(p);
  const relleno = new Map<string, number>();
  for (const g of r.globos) if (g.tamano === "relleno") relleno.set(g.formatoId, (relleno.get(g.formatoId) ?? 0) + 1);
  return textoConteo(r.materiales, relleno);
}

// ----------------------------------------------------------------------------------------------------------
// Un cambio de tamaño
// ----------------------------------------------------------------------------------------------------------

/** Un cambio hecho: la pieza que queda y su línea del resumen, que se escribe al final con lo que de verdad quedó armado (otros cambios del mismo pedido pueden mover estos números). */
type CambioHecho = { pieza: Organico; linea: (final: PiezaOrganica) => string };

/** Lo que comparten los cambios de un mismo pedido: si se puede engrosar, los formatos que el pedido baja, las notas, el techo y cuánto se puede armar. */
type Contexto = { engrosarPermitido: boolean; reducidos: ReadonlySet<string>; notas: string[]; techoCm: number | undefined; cuota: Cuota };

function aplicarCambio(entrada: PiezaOrganica, original: PiezaOrganica, c: CambioTamano, { engrosarPermitido, reducidos, notas, techoCm, cuota }: Contexto): CambioHecho {
  const f = c.formato.trim().toUpperCase();
  if (!(FORMATOS_AJUSTABLES as readonly string[]).includes(f)) fallar(`El tamaño «${c.formato}» no va en lo orgánico: usa ${FORMATOS_AJUSTABLES.join(", ")}.`);
  const zona = c.donde ?? "todo";
  if (c.solo_ahi && zona === "todo") fallar("solo_ahi va con donde (abajo, arriba, inicio, medio o fin).");
  if (c.accion === "poner" && c.cantidad === undefined && c.porcentaje === undefined) fallar("accion «poner» necesita cantidad o porcentaje (para «más», usa accion «mas»).");
  if (c.cantidad !== undefined && c.porcentaje !== undefined) fallar("Pasa cantidad o porcentaje, no los dos.");
  let pieza = comoOrganico(entrada);
  const partida = pieza;
  const medidaPaso = medir(pieza, f, zona);
  const porPorcentaje = c.porcentaje !== undefined;
  const real = (p: Organico) => (porPorcentaje ? medir(p, f, zona).porcentaje : medir(p, f, zona).cantidad);
  const sinArmar = (p: Organico) => (porPorcentaje ? estimar(p, f, zona).porcentaje : estimar(p, f, zona).cantidad);
  const estimable = seBuscaSinArmar(pieza);
  const actual = porPorcentaje ? medidaPaso.porcentaje : medidaPaso.cantidad;
  /** Con qué se compara cada prueba de la búsqueda: la cuenta sin armar corrida a lo medido armando `desde` (o, con globos fijos, lo que mide cada una armada). */
  const valorDesde = (desde: Organico, medido: number): ((p: Organico) => number) => (estimable ? calibrada(desde, medido, sinArmar) : real);
  const valor = valorDesde(pieza, actual);
  /** Lo mismo sobre un cuerpo más grueso: el relleno de ese formato cambia con el cuerpo, así que se mide una vez armado (si la cuota deja) en vez de correr lo medido en el de antes. */
  const valorEnCuerpo = (g: Organico): ((p: Organico) => number) => (estimable && cuota.alcanzaOtro() ? valorDesde(g, real(g)) : valor);
  /** Cuántos había al empezar el pedido: «más» y «menos» se miden contra eso, no contra lo que dejó un cambio anterior. */
  const inicial = porPorcentaje ? actual : medir(original, f, zona).cantidad;
  let meta: number, modo: Modo;
  if (c.accion === "quitar") { meta = 0; modo = "a_lo_mas"; }
  else if (c.cantidad !== undefined || c.porcentaje !== undefined) { meta = c.cantidad ?? c.porcentaje!; modo = "cerca"; }
  else if (c.accion === "mas") { const base = Math.max(actual, inicial); meta = base === 0 ? Math.max(4, Math.ceil(medidaPaso.estructura * 0.08)) : Math.max(base + 3, Math.ceil(base * 1.6)); modo = "al_menos"; }
  else { meta = Math.floor(Math.min(actual, inicial) * 0.5); modo = "a_lo_mas"; }
  const tolerancia = porPorcentaje ? 3 : Math.max(1, Math.round(meta * 0.08));
  /** Lo que se dice siempre (lo que no se hizo y por qué); lo que se hizo para llegar a una pieza va con ella (`Probada.notas`) y solo se dice si es la que queda. */
  const extra: string[] = [];
  const notasDeBase: string[] = [];
  /** Si la pieza, con el cuerpo más grueso, sigue cabiendo bajo el techo (la misma medida de alto con que la herramienta valida después). */
  const cabeBajoElTecho = (p: PiezaOrganica) => techoCm === undefined || alturaDePieza(p) <= techoCm;
  /** Si un cuerpo más grueso cabe bajo el techo, sin armarlo cuando se puede. */
  const cabeSiHayTiempo = comprobadorDeAlto(partida, techoCm, cuota, estimable);
  const SIN_TIEMPO = "comprobar que cabe bajo el techo tardaría demasiado en una pieza tan grande";

  // ¿Cabe? Un formato más ancho que el cuerpo no va (el trazo no lo pone; sin generador sobresale): se engruesa donde va.
  const quiereMas = meta > actual || (c.accion === "poner" && meta > 0);
  if (quiereMas && cabe(pieza, f, zona) === "nada") {
    if (!engrosarPermitido) fallar(`Los ${f} (inflado ${r0(inflado(pieza, f))} cm) no caben en el cuerpo de esta pieza${zona === "todo" ? "" : ` (${zona})`}: necesita al menos ${grosorMinimo(pieza, f)} cm de grosor. Vuelve a llamar con engrosar: true o engruésala con cambiar_pieza grosor_cm.`);
    const hecho = engrosar(pieza, f, zona, false) ?? engrosar(pieza, f, zona, true) ?? fallar(`Los ${f} no caben ni engrosando el cuerpo al máximo (160 cm).`);
    const tope = porQueNoCabe(pieza, hecho.pieza, false);
    const cabeEngrosada = tope ? null : cabeSiHayTiempo(hecho.pieza);
    if (tope) extra.push(`los ${f} no caben en el cuerpo de ahora y no lo engrosé lo que piden (${grosorMinimo(pieza, f)} cm): ${tope}; se queda como está`);
    else if (cabeEngrosada === "si") { pieza = hecho.pieza; notasDeBase.push(hecho.nota); }
    else if (cabeEngrosada === "tarde") extra.push(`los ${f} no caben en el cuerpo de ahora y no pude probar engrosarlo lo que piden (${grosorMinimo(pieza, f)} cm): ${SIN_TIEMPO}; se queda como está`);
    else extra.push(`los ${f} no caben en el cuerpo de ahora y engrosarlo lo que piden (${grosorMinimo(pieza, f)} cm) haría la pieza más alta de lo que cabe bajo el techo (${r0(techoCm!)} cm): se queda como está`);
  }

  const base = pieza;
  /** Una búsqueda de pesos; si cada prueba se arma (las piezas de armado barato se buscan así) y ya no cabe en el tiempo de la herramienta, se queda con la mejor hasta ahí. */
  const buscarAqui = (aplicar: (k: number) => Organico, vf: (p: Organico) => number, desde: number, modoAqui: Modo = modo, toleranciaAqui = tolerancia) =>
    buscar(aplicar, vf, desde, meta, modoAqui, toleranciaAqui, estimable ? undefined : () => cuota.alcanzaOtro(true));
  /**
   * Los globos de estructura de la pieza que queda no pasan de lo que se arma de una vez. El tope se mide en la pieza elegida, no en los pasos del
   * camino (engrosar el cuerpo para que quepan los R-24 sube los globos de la mezcla de antes, y la mezcla nueva los baja), y antes de armarla: se
   * acota el peso sin armar (hacia abajo si el formato es chico, hacia arriba si es grande). `null`: no hay peso con que ese cuerpo quepa.
   */
  const acotada = (e: Probada, vf: (p: Organico) => number): Probada | null => {
    if (porQueNoCabe(partida, e.pieza) === null) return e;
    const cabeK = e.aplicar ? valorQueCabeEnPresupuesto(e.aplicar, e.k, partida, modo === "al_menos" ? PESO_MAXIMO : undefined) : null;
    if (cabeK === null || !e.aplicar) return null;
    const pieza = e.aplicar(cabeK);
    const tope = `para no pasar de lo que se arma de una vez (${GLOBOS_MAXIMOS_CUERPO} globos de estructura)`;
    const nota = e.k < 1 ? `${tope} no quité todos los ${f} pedidos` : cabeK > e.k ? `${tope} pasé de los ${f} pedidos` : `${tope} no puse todos los ${f} pedidos`;
    return { ...e, pieza, valor: vf(pieza), k: cabeK, notas: [...(e.notas ?? []), nota] };
  };
  /**
   * Una pieza que se busca sin armar se arma una vez, la elegida, y se mide de verdad (y, si no llega a la meta, se busca una vez más con lo medido):
   * así cada paso que sigue decide con lo que de verdad hay y no con la cuenta, que no sabe cuántos globos no caben sin montarse.
   */
  const medida = (e: Probada): Probada => (estimable ? confirmar(e, { real, estimado: sinArmar, meta, modo, tolerancia, cuota, acotar: (p) => acotada(p, sinArmar) }) : e);
  const sinPasarse = (e: Probada, vf: (p: Organico) => number): Probada | null => { const a = acotada(e, vf); return a && medida(a); };
  const primera: Probada = c.accion === "quitar" ? { pieza: conPeso(base, f, zona, 0, !!c.solo_ahi), valor: 0, k: 0 } : buscarAqui((k) => conPeso(base, f, zona, k, !!c.solo_ahi), valor, actual);
  let elegida: Probada = sinPasarse({ ...primera, valor: valor(primera.pieza), notas: [...notasDeBase] }, valor) ?? { pieza: partida, valor: real(partida), k: 1, notas: [] };
  if (elegida.pieza === partida && primera.pieza !== partida) {
    extra.push(`${base === partida ? `con esos ${f}` : `engrosar el cuerpo para que quepan los ${f}`}: la pieza pasaría de los ${GLOBOS_MAXIMOS_CUERPO} globos de estructura que se arman de una vez; se queda como está`);
  }
  // No llegó subiendo: engrosar toda la zona (y sus vecinos) donde aún no cabe y volver a buscar.
  if (quiereMas && modo !== "a_lo_mas" && elegida.valor < meta - (modo === "cerca" ? tolerancia : 0) && engrosarPermitido && cabe(base, f, zona) !== "todo") {
    const hecho = engrosar(base, f, zona, true);
    const tope = hecho ? porQueNoCabe(base, hecho.pieza, false) : null;
    const cabeEngrosada = hecho && !tope ? cabeSiHayTiempo(hecho.pieza) : null;
    const dePieza = zona === "todo" ? "la pieza" : zona;
    if (tope) extra.push(`no engrosé el cuerpo de ${dePieza} para llegar a la meta: ${tope}`);
    else if (cabeEngrosada === "no") extra.push(`no engrosé el cuerpo de ${dePieza} para llegar a la meta: pasaría de los ${r0(techoCm!)} cm que caben bajo el techo`);
    else if (cabeEngrosada === "tarde") extra.push(`no engrosé el cuerpo de ${dePieza} para llegar a la meta: ${SIN_TIEMPO}`);
    else if (hecho) {
      const enCuerpo = valorEnCuerpo(hecho.pieza);
      const buscada = { ...buscarAqui((k) => conPeso(hecho.pieza, f, zona, k, !!c.solo_ahi), enCuerpo, enCuerpo(hecho.pieza)), notas: [...notasDeBase, hecho.nota] };
      const otra = sinPasarse(buscada, enCuerpo);
      if (!otra) extra.push(`no engrosé el cuerpo de ${dePieza} para llegar a la meta: pasaría de los ${GLOBOS_MAXIMOS_CUERPO} globos de estructura que se arman de una vez`);
      else if (otra.valor > elegida.valor) elegida = otra;
    }
  }
  // Sigue sin llegar con el cuerpo en que cabe: es lo que da esa mezcla (el segundo «más R-24» seguido). Se engruesa todo
  // el cuerpo por pasos hasta que llegue (más cuerpo, más globos de cada tamaño) y se dice cuánto.
  const noLlega = (v: number) => v < meta - (modo === "cerca" ? tolerancia : 0);
  if (quiereMas && modo !== "a_lo_mas" && zona === "todo" && engrosarPermitido && noLlega(elegida.valor)) {
    for (const pedido of FACTORES_CUERPO) {
      const engrosado = engrosarEnPresupuesto(base, pedido, false);
      if (!engrosado.pieza) {
        extra.push(`no engrosé más el cuerpo: ${engrosado.tope}`);
        break;
      }
      if (estimable && !cuota.alcanzaOtro()) {
        extra.push("no engrosé más el cuerpo: probar uno más grueso tardaría demasiado en una pieza tan grande");
        break;
      }
      const { factor, tope } = engrosado;
      const gruesa = engrosado.pieza as Organico;
      const cabeGruesa = cabeSiHayTiempo(gruesa);
      if (cabeGruesa !== "si") {
        extra.push(cabeGruesa === "no" ? `no engrosé más el cuerpo: con ${r0((factor - 1) * 100)} % más la pieza pasaría de los ${r0(techoCm ?? 0)} cm que caben bajo el techo` : `no engrosé más el cuerpo: ${SIN_TIEMPO}`);
        break;
      }
      const enCuerpo = valorEnCuerpo(gruesa);
      const nota = `para llegar a ${meta} ${f} engrosé todo el cuerpo un ${r0((factor - 1) * 100)} % (con el cuerpo de antes ya no cabían más; pasa a llevar más globos de todos los tamaños)${tope ? `; no más: ${tope}` : ""}`;
      const buscada = { ...buscarAqui((k) => conPeso(gruesa, f, zona, k, !!c.solo_ahi), enCuerpo, enCuerpo(gruesa)), notas: [...notasDeBase, nota] };
      const otra = sinPasarse(buscada, enCuerpo);
      if (!otra) {
        extra.push(`no engrosé más el cuerpo: con ${r0((factor - 1) * 100)} % más la pieza pasaría de los ${GLOBOS_MAXIMOS_CUERPO} globos de estructura que se arman de una vez`);
        break;
      }
      if (otra.valor > elegida.valor) elegida = otra;
      if (tope || !noLlega(elegida.valor)) break;
    }
  }
  // Bajando: el relleno de ese formato también cuenta (los R-5 y R-9 son sobre todo relleno de huecos). El relleno es
  // de toda la pieza: solo se toca si el cambio es en toda ella; sin él, los huecos los tapa el relleno que queda.
  const sobra = (v: number) => v > meta + (modo === "cerca" ? tolerancia : 0);
  if (!porPorcentaje && (modo === "a_lo_mas" || (modo === "cerca" && meta < actual)) && sobra(elegida.valor)) {
    const sinPeso = conPeso(base, f, zona, 0, !!c.solo_ahi);
    if (opcionesDe(sinPeso).relleno.some((r) => r.formatoId === f)) {
      if (zona !== "todo") extra.push(`el relleno de huecos de ${f} es de toda la pieza: en ${zona} quedan los de relleno`);
      else if (!cuota.alcanzaOtro()) extra.push(`no probé quitar el relleno de huecos de ${f}: armar esta pieza tarda demasiado para probarlo`);
      else {
        const sinRelleno = conRelleno(sinPeso, f, reducidos);
        let otra: Probada = { pieza: sinRelleno, valor: real(sinRelleno), k: 0, notas: [...notasDeBase] };
        // Sin relleno de ese formato quedan muy pocos: vuelve a la mezcla de estructura hasta la meta (menos, no ninguno).
        if (c.accion !== "quitar" && otra.valor < meta - tolerancia) {
          const toleranciaMezcla = Math.max(tolerancia, meta * 0.15);
          const buscada = { ...buscarAqui((k) => conPeso(sinRelleno, f, zona, k, !!c.solo_ahi), valorDesde(sinRelleno, otra.valor), otra.valor, "cerca", toleranciaMezcla), notas: [...notasDeBase] };
          const conMezcla = estimable ? confirmar(buscada, { real, estimado: sinArmar, meta, modo: "cerca", tolerancia: toleranciaMezcla, cuota, acotar: (p) => acotada(p, sinArmar) }) : buscada;
          if (Math.abs(conMezcla.valor - meta) < Math.abs(otra.valor - meta)) otra = conMezcla;
        }
        if (otra.valor < elegida.valor) elegida = { ...otra, notas: [...(otra.notas ?? []), `los ${f} eran sobre todo relleno de huecos: los quité del relleno (los huecos los tapa el relleno que queda)`] };
      }
    }
  }
  // Más globos grandes también hacen la pieza más alta (sobresalen del cuerpo): si no cabe bajo el techo, se baja el peso hasta que quepa.
  if (quiereMas && !cabeBajoElTecho(elegida.pieza) && elegida.aplicar) {
    const { aplicar } = elegida;
    // Los pesos que se prueban, de menos a más recorte: cada paso conserva el 75 % del aumento. Armar cada uno es lo caro, así que se
    // busca el primero que cabe partiendo la lista (cada peso menos es una pieza más baja) y sin pasar de lo que la cuota deja armar.
    const pesos: number[] = [];
    for (let k = elegida.k; k > PESO_MINIMO_RECORTE;) { k = 1 + (k - 1) * REDUCCION_RECORTE; pesos.push(k); }
    const probados = new Map<number, boolean>();
    const cabeProbando = (i: number) => {
      const k = pesos[i]!;
      if (!probados.has(k)) probados.set(k, cuota.alcanzaOtro() && cabeBajoElTecho(aplicar(k)));
      return probados.get(k)!;
    };
    // Por dónde empezar: con el alto de la base y el de la elegida (los dos ya armados) se supone que el alto crece con los globos del formato
    // (contados sin armar) y se parte del primer peso que así cabría; si no cabe, se sigue con el siguiente, que arma uno por prueba.
    let primero = 0;
    if (estimable) {
      const altoBase = alturaDePieza(base), altoElegida = alturaDePieza(elegida.pieza), antes = valor(base), con = valor(elegida.pieza);
      const predicho = (k: number) => (con === antes ? altoBase : altoBase + ((altoElegida - altoBase) * (valor(aplicar(k)) - antes)) / (con - antes));
      const cabria = pesos.findIndex((k) => predicho(k) <= (techoCm ?? Infinity));
      primero = cabria < 0 ? Math.max(0, pesos.length - 1) : cabria;
    }
    let queCabe = -1;
    for (let i = primero; i < pesos.length && queCabe < 0; i++) if (cabeProbando(i)) queCabe = i;
    if (queCabe >= 0) {
      const pieza = aplicar(pesos[queCabe]!);
      elegida = { ...elegida, pieza, valor: real(pieza), k: pesos[queCabe]! };
    } else {
      // Ni con el peso mínimo cabe (la pieza ya estaba al límite): se queda como estaba antes de este cambio (si engrosarla no cabía, como al empezar).
      const vuelve = base === partida || cabeBajoElTecho(base) ? base : partida;
      elegida = { pieza: vuelve, valor: real(vuelve), k: 1, notas: vuelve === base ? [...notasDeBase] : [] };
    }
    extra.push(`para que la pieza quepa bajo el techo (${r0(techoCm ?? 0)} cm) quedaron ${elegida.valor} ${f}${porPorcentaje ? " %" : ""} y no los ${meta} pedidos`);
  }
  notas.push(...extra, ...(elegida.notas ?? []));
  const resultado = elegida.pieza;
  const linea = (final: PiezaOrganica): string => {
    const antesZona = medir(original, f, zona), antesTotal = totalDe(original, f);
    const despuesZona = medir(final, f, zona);
    const despuesTotal = totalDe(final, f);
    const enZonaTexto = zona === "todo" ? "" : ` (${zona}: ${antesZona.cantidad} → ${despuesZona.cantidad})`;
    const pct = porPorcentaje ? `; ${r0(antesZona.porcentaje)} % → ${r0(despuesZona.porcentaje)} % de la estructura${zona === "todo" ? "" : ` en ${zona}`} (meta ${meta} %)` : "";
    const cambio = antesTotal > 0 ? ` (${despuesTotal >= antesTotal ? "+" : ""}${r0(((despuesTotal - antesTotal) / antesTotal) * 100)} %)` : "";
    const llegada = porPorcentaje ? despuesZona.porcentaje : despuesZona.cantidad;
    const falta = (modo === "al_menos" && llegada < meta) || (modo === "a_lo_mas" && llegada > meta) || (modo === "cerca" && Math.abs(llegada - meta) > tolerancia)
      ? (modo === "a_lo_mas" || (modo === "cerca" && llegada > meta) ? ` — quedan más que la meta (${meta}${porPorcentaje ? " %" : ""}): son relleno de huecos o lo que pide el cuerpo` : ` — no llegué a la meta (${meta}${porPorcentaje ? " %" : ""}): es lo que cabe en ese cuerpo`) : "";
    return `${f}: ${antesTotal} → ${despuesTotal}${cambio}${enZonaTexto}${pct}${falta}`;
  };
  return { pieza: resultado, linea };
}

// ----------------------------------------------------------------------------------------------------------
// Densidad, racimos y colores por tamaño
// ----------------------------------------------------------------------------------------------------------

const estructuraDe = (p: PiezaOrganica) => armada(p).globos.filter((g) => g.tamano !== "relleno").length;

/**
 * «Más tupida»: más globos de estructura por metro. Pasado cierto punto ya no caben más en ese grosor (el motor los
 * deja fuera y el relleno tapa sus huecos): entonces se engruesa el cuerpo un 15 % para que lleve más, y se dice.
 */
function densidadPedida(p: PiezaOrganica, factor: number, engrosarPermitido: boolean, cuota: Cuota, techoCm?: number): { pieza: PiezaOrganica; linea: string } {
  const antes = densidadDe(p), estAntes = estructuraDe(p), totalAntes = armada(p).globos.length;
  let pieza = conDensidad(p, factor);
  let acotada = false;
  // Más densidad pide más globos de estructura (aunque no quepan, el empaque los intenta uno por uno): nunca más de lo que se arma de una vez.
  if (factor > 1) {
    const cabeF = valorQueCabeEnPresupuesto((f) => conDensidad(p, f), factor) ?? 1;
    if (cabeF < factor) { pieza = conDensidad(p, cabeF); acotada = true; }
  }
  let linea = `densidad ${antes} → ${densidadDe(pieza)}${acotada ? ` (más pasaría de los ${GLOBOS_MAXIMOS_CUERPO} globos de estructura que se arman de una vez)` : ""}`;
  if (factor > 1 && estructuraDe(pieza) < estAntes * 1.08) {
    const gruesa = engrosarPermitido ? engrosarEnPresupuesto(p, ENGROSAR_POR_DENSIDAD) : null;
    const cabeGruesa = gruesa?.pieza ? comprobadorDeAlto(p, techoCm, cuota)(gruesa.pieza) : "si";
    if (!engrosarPermitido) linea += " — no caben más globos de estructura en ese grosor (engrosar: true para engrosarla)";
    else if (!gruesa?.pieza) linea += ` — no caben más globos de estructura en ese grosor y no lo engrosé: ${gruesa?.tope}`;
    else if (!cuota.alcanzaOtro(true)) linea += " — no caben más globos de estructura en ese grosor y no probé engrosar el cuerpo: armar esta pieza tarda demasiado para armarla otra vez";
    else if (cabeGruesa === "tarde") linea += " — no caben más globos de estructura en ese grosor y no probé engrosar el cuerpo: comprobar que cabe bajo el techo tardaría demasiado en una pieza tan grande";
    else if (cabeGruesa === "no") linea += ` — no caben más globos de estructura en ese grosor y engrosar el cuerpo pasaría de los ${r0(techoCm!)} cm que caben bajo el techo`;
    else {
      pieza = gruesa.pieza;
      linea = `densidad: ya no caben más globos en ese grosor (${antes}), así que engrosé el cuerpo un ${r0((gruesa.factor - 1) * 100)} % para que lleve más${gruesa.tope ? ` (no más: ${gruesa.tope})` : ""}`;
    }
  }
  if (factor < 1) {
    const quitados = aligerarRelleno(pieza, totalAntes);
    pieza = quitados.pieza;
    if (quitados.formatos.length) linea += ` (con menos estructura el relleno de huecos hacía crecer el total: quité el relleno de ${quitados.formatos.join(" y ")}, y los huecos quedan más abiertos)`;
  }
  return { pieza, linea: `${linea}: estructura ${estAntes} → ${estructuraDe(pieza)}, total ${totalAntes} → ${armada(pieza).globos.length} globos` };
}

/**
 * «Menos tupida»: con menos globos de estructura quedan más huecos y el relleno los tapa, así que el total puede SUBIR.
 * Mientras el total no baje al menos un 10 %, se quita el relleno del formato más chico (siempre queda alguno).
 */
function aligerarRelleno(p: PiezaOrganica, totalAntes: number): { pieza: PiezaOrganica; formatos: string[] } {
  let pieza = p;
  const formatos: string[] = [];
  while (armada(pieza).globos.length > totalAntes * 0.9 && opcionesDe(pieza).relleno.length > 1) {
    const chico = [...opcionesDe(pieza).relleno].sort((a, b) => a.infladoCm - b.infladoCm)[0]!;
    pieza = conRelleno(comoOrganico(pieza), chico.formatoId);
    formatos.push(chico.formatoId);
  }
  return { pieza, formatos };
}

/** «Los R-24 en azul reflex»: esos formatos solo con esos colores; con `exclusivo`, esos colores salen de los demás formatos. */
function coloresPorTamano(p: PiezaOrganica, pedidos: readonly ColorPorTamano[], acabado: string | undefined, notas: string[]): PiezaOrganica {
  let paleta = paletaDe(p).map((c) => ({ ...c }));
  for (const pedido of pedidos) {
    const formatos = [...new Set(pedido.formatos.map((f) => f.trim().toUpperCase()))];
    for (const f of formatos) if (!(FORMATOS_AJUSTABLES as readonly string[]).includes(f)) fallar(`El tamaño «${f}» no va en lo orgánico: usa ${FORMATOS_AJUSTABLES.join(", ")}.`);
    if (pedido.pesos && pedido.pesos.length !== pedido.colores.length) fallar(`pesos tiene ${pedido.pesos.length} valores y colores ${pedido.colores.length}.`);
    const codigos = pedido.colores.map((c) => resolverColorFlexible(conAcabado(c, acabado), formatos, notas));
    const quitar = (c: ColorOrganico): ColorOrganico | null => {
      if (pedido.exclusivo && codigos.includes(c.codigo)) return null;
      const quedan = (c.formatos ?? FORMATOS_AJUSTABLES).filter((f) => !formatos.includes(f));
      return quedan.length ? { ...c, formatos: quedan } : null;
    };
    paleta = paleta.map(quitar).filter((c): c is ColorOrganico => c !== null);
    codigos.forEach((codigo, i) => paleta.push({ codigo, peso: r0(pedido.pesos?.[i] ?? 10) || 1, formatos }));
  }
  // Cada formato que lleva la pieza debe seguir teniendo algún color.
  const usados = [...new Set(armada(p).globos.map((g) => g.formatoId))];
  const sinColor = usados.filter((f) => !paleta.some((c) => c.peso > 0 && (!c.formatos || c.formatos.includes(f))));
  if (sinColor.length) fallar(`Así los ${sinColor.join(", ")} se quedarían sin color: pasa también en colores_por_tamano el color de esos tamaños (o no uses exclusivo).`);
  return conPaleta(p, paleta);
}

// ----------------------------------------------------------------------------------------------------------
// La herramienta
// ----------------------------------------------------------------------------------------------------------

/** Aplica `ajustar_tamanos` a una pieza orgánica y cuenta, armándola, lo que había y lo que queda. */
export function ajustarTamanos(pieza: PiezaOrganica, pedido: PedidoTamanos, notas: string[], techoCm?: number): { pieza: PiezaOrganica; resumen: string } {
  const nada = !pedido.cambios?.length && !pedido.colores_por_tamano?.length && pedido.densidad === undefined && pedido.densidad_factor === undefined && pedido.racimos === undefined && pedido.racimos_valor === undefined;
  if (nada) fallar("No pediste ningún cambio: pasa cambios (formato + accion), colores_por_tamano, densidad o racimos.");
  if (pedido.densidad !== undefined && pedido.densidad_factor !== undefined) fallar("Pasa densidad («mas»/«menos») o densidad_factor, no los dos.");
  if (pedido.racimos !== undefined && pedido.racimos_valor !== undefined) fallar("Pasa racimos («mas»/«menos») o racimos_valor, no los dos.");
  const lineas: Array<string | CambioHecho["linea"]> = [];
  const cuota = crearCuota(pieza);
  const totalAntes = armada(pieza).globos.length;
  let actual: PiezaOrganica = pieza;
  const reducidos = new Set((pedido.cambios ?? []).filter((c) => c.accion === "menos" || c.accion === "quitar").map((c) => c.formato.trim().toUpperCase()));
  for (const c of pedido.cambios ?? []) {
    const hecho = aplicarCambio(actual, pieza, c, { engrosarPermitido: pedido.engrosar ?? true, reducidos, notas, techoCm, cuota });
    actual = hecho.pieza;
    lineas.push(hecho.linea);
  }
  if (pedido.densidad !== undefined || pedido.densidad_factor !== undefined) {
    const hecho = densidadPedida(actual, pedido.densidad_factor ?? DENSIDAD[pedido.densidad ?? "mas"], pedido.engrosar ?? true, cuota, techoCm);
    actual = hecho.pieza;
    lineas.push(hecho.linea);
  }
  if (pedido.racimos !== undefined || pedido.racimos_valor !== undefined) {
    const o = comoOrganico(actual);
    const antes = racimosDe(o), bultos = bultosDe(o);
    const nueva = conRacimos(o, pedido.racimos_valor ?? antes + (pedido.racimos === "menos" ? -0.3 : 0.3));
    // Los bultos del trazo engordan el cuerpo: tampoco pasan del presupuesto de armado.
    const tope = porQueNoCabe(o, nueva);
    const que = o.generador?.tipo === "trazo" ? "los bultos sobresalen hasta" : "irregularidad de la silueta";
    if (tope) lineas.push(`abultado (racimos): se queda en ${antes}, más abultado ${tope}`);
    else {
      actual = nueva;
      lineas.push(`abultado (racimos) ${antes} → ${racimosDe(nueva)}: ${que} ${r0(bultos * 100)} % → ${r0(bultosDe(nueva) * 100)} %${racimosDe(nueva) === antes ? " (ya estaba en el tope)" : ""}`);
    }
  }
  if (pedido.colores_por_tamano?.length) {
    actual = coloresPorTamano(actual, pedido.colores_por_tamano, pedido.acabado, notas);
    // Un repinte (editar_globos) de esos mismos tamaños taparía los colores nuevos: lo nuevo manda, se quita.
    const tocados = new Set(pedido.colores_por_tamano.flatMap((x) => x.formatos.map((f) => f.trim().toUpperCase())));
    const quedan = (actual.repintes ?? []).filter((r) => !(r.formatos?.length && !r.partes?.length && r.formatos.every((f) => tocados.has(f.toUpperCase()))));
    if (actual.repintes && quedan.length !== actual.repintes.length) actual = { ...actual, repintes: quedan };
    lineas.push(`colores por tamaño: ${pedido.colores_por_tamano.map((x) => `${x.formatos.join("/")} en ${x.colores.join(", ")}${x.exclusivo ? " (solo ahí)" : ""}`).join("; ")}`);
  }
  const final = armada(actual);
  const avisos = final.avisos.filter((a) => /no se fabrica|Ningún color|no cupieron/.test(a));
  notas.push(...avisos.slice(0, 3));
  const colores = new Map<string, number>();
  for (const g of final.globos) colores.set(g.codigo, (colores.get(g.codigo) ?? 0) + 1);
  const porColor = [...colores].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${nombreColor(c)} ${n}`).join(", ");
  return { pieza: actual, resumen: `${lineas.map((l) => (typeof l === "string" ? l : l(actual))).join(" · ")}. Total ${totalAntes} → ${final.globos.length} globos. Ahora (contado en la pieza armada): ${conteoDe(actual)}. Por color: ${porColor}` };
}
