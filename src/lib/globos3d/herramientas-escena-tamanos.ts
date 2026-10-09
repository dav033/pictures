import { armarOrganico, type ColorOrganico, type GloboOrganico, type OpcionesOrganico, type ResultadoOrganico } from "./organico";
import { enZona, puntoEnRecorrido, rangoAltura, type ZonaOrganica } from "./zonas-organicas";
import { alturaDePieza } from "./altura-pieza";
import { conAcabado, fallar, nombreColor, resolverColorFlexible } from "./herramientas-escena-colores";
import {
  DENSIDAD, bultosDe, cabe, comoOrganico, conDensidad, conGrosor, conPaleta, conPeso, conRacimos, conRelleno, densidadDe, engrosar, grosorMinimo, inflado, opcionesDe,
  paletaDe, racimosDe, type Organico, type PiezaOrganica,
} from "./organico-ajustes";

export { esPiezaOrganica, type PiezaOrganica } from "./organico-ajustes";

/**
 * **Edición precisa de lo orgánico** para la IA de escena (`ajustar_tamanos`): «más R-24», «menos globos chicos»,
 * «los R-24 solo abajo», «un 40 % de R-18», «exactamente 6 R-24», «los grandes en azul reflex», «más tupida», «más
 * abultada». Sirve para cualquier pieza orgánica (con generador de trazo, sin él, y el arco orgánico por medidas).
 *
 * Cómo: la mezcla del motor orgánico son pesos por formato **en número de globos**, pero cuántos salen depende del
 * grosor y de lo que de verdad cabe; así que cada cambio se **busca armando la pieza**: se multiplica el peso del
 * formato en la zona y se arma hasta llegar a la meta (más = al menos +60 %; menos = la mitad; o la cantidad o el
 * porcentaje pedidos). El resultado dice cuántos había y cuántos hay de cada formato, contados en la pieza armada.
 * Un formato solo cabe donde el cuerpo es lo bastante grueso (inflado ≤ 0,82 × grosor; el trazo no pone el que no
 * cabe y sin generador sobresaldría): si no cabe en la zona, se engruesa ahí el cuerpo lo justo (y se dice), salvo que
 * se pida `engrosar: false`. Las transformaciones de la pieza están en organico-ajustes.ts.
 */

export const FORMATOS_AJUSTABLES = ["R-36", "R-24", "R-18", "R-12", "R-9", "R-5"] as const;
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
/** Cuánto se engruesa el cuerpo, por pasos, cuando un tamaño no llega a la meta con el grosor que hay. */
const FACTORES_CUERPO = [1.12, 1.25, 1.4, 1.55, 1.75, 2] as const;
const orden = (f: string) => { const i = (FORMATOS_AJUSTABLES as readonly string[]).indexOf(f); return i < 0 ? 99 : i; };

// ----------------------------------------------------------------------------------------------------------
// Medir: armar la pieza y contar (por formato, color, zona y relleno)
// ----------------------------------------------------------------------------------------------------------

const CACHE = new Map<string, ResultadoOrganico>();
function armada(p: PiezaOrganica): ResultadoOrganico {
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
function filtroZona(o: OpcionesOrganico, zona: ZonaOrganica): (g: GloboOrganico) => boolean {
  if (zona === "todo") return () => true;
  const rango = rangoAltura(o.tramos.flatMap((t) => t.recorrido));
  const porId = new Map(o.tramos.map((t) => [t.id, t]));
  return (g) => { const t = porId.get(g.tramo); if (!t) return true; const q = puntoEnRecorrido(t.recorrido, g.fraccion); return enZona(zona, g.fraccion, q.y, rango, q.x); };
}

type Medida = { cantidad: number; porcentaje: number; estructura: number };
function medir(p: PiezaOrganica, formato: string, zona: ZonaOrganica): Medida {
  const dentro = filtroZona(opcionesDe(p), zona);
  const globos = armada(p).globos.filter(dentro);
  const estructura = globos.filter((g) => g.tamano !== "relleno");
  const deFormato = estructura.filter((g) => g.formatoId === formato).length;
  return { cantidad: globos.filter((g) => g.formatoId === formato).length, porcentaje: estructura.length ? (100 * deFormato) / estructura.length : 0, estructura: estructura.length };
}

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

const totalDe = (p: PiezaOrganica, formato: string) => armada(p).globos.filter((g) => g.formatoId === formato).length;

// ----------------------------------------------------------------------------------------------------------
// Buscar el peso que da la meta, armando
// ----------------------------------------------------------------------------------------------------------

type Modo = "al_menos" | "a_lo_mas" | "cerca";
type Probada = { pieza: Organico; valor: number; k: number; /** Cómo se armó con otro peso (para bajarlo si la pieza no cabe bajo el techo). */ aplicar?: (k: number) => Organico };

function buscar(aplicar: (k: number) => Organico, valor: (p: Organico) => number, actual: number, meta: number, modo: Modo, tolerancia: number): Probada {
  const probadas: Probada[] = [];
  const probar = (k: number): Probada => { const pieza = aplicar(k); const e = { pieza, valor: valor(pieza), k, aplicar }; probadas.push(e); return e; };
  const llega = (v: number) => (modo === "cerca" ? Math.abs(v - meta) <= tolerancia : modo === "al_menos" ? v >= meta : v <= meta);
  const sube = meta > actual;
  // Un extremo que no llega (a) y otro que sí (b).
  let a = 1, b: number | null = null;
  for (const k of sube ? [1.7, 3, 6, 12, 30, 80] : [0.55, 0.3, 0.12, 0]) {
    const e = probar(k);
    if (sube ? e.valor >= meta - (modo === "cerca" ? tolerancia : 0) : e.valor <= meta + (modo === "cerca" ? tolerancia : 0)) { b = k; break; }
    a = k;
  }
  if (b !== null) {
    let hasta: number = b;
    for (let i = 0; i < 4; i++) {
      const elegida = elegir(probadas, meta, modo);
      // Ya está: en «al menos / a lo más» que no se pase de largo (hasta un 35 % y 2 globos de más).
      if (llega(elegida.valor) && (modo === "cerca" || Math.abs(elegida.valor - meta) <= Math.max(2, meta * 0.35))) break;
      const m: number = sube ? Math.sqrt(a * hasta) : (a + hasta) / 2;
      const e = probar(m);
      if (sube ? e.valor >= meta - (modo === "cerca" ? tolerancia : 0) : e.valor <= meta + (modo === "cerca" ? tolerancia : 0)) hasta = m; else a = m;
    }
  }
  return elegir(probadas, meta, modo);
}

function elegir(probadas: readonly Probada[], meta: number, modo: Modo): Probada {
  const porCercania = [...probadas].sort((x, y) => Math.abs(x.valor - meta) - Math.abs(y.valor - meta));
  if (modo === "al_menos") return [...probadas].filter((p) => p.valor >= meta).sort((x, y) => x.valor - y.valor)[0] ?? [...probadas].sort((x, y) => y.valor - x.valor)[0]!;
  if (modo === "a_lo_mas") return [...probadas].filter((p) => p.valor <= meta).sort((x, y) => y.valor - x.valor)[0] ?? [...probadas].sort((x, y) => x.valor - y.valor)[0]!;
  return porCercania[0]!;
}

// ----------------------------------------------------------------------------------------------------------
// Un cambio de tamaño
// ----------------------------------------------------------------------------------------------------------

/** Un cambio hecho: la pieza que queda y su línea del resumen, que se escribe al final con lo que de verdad quedó armado (otros cambios del mismo pedido pueden mover estos números). */
type CambioHecho = { pieza: Organico; linea: (final: PiezaOrganica) => string };

function aplicarCambio(entrada: PiezaOrganica, original: PiezaOrganica, c: CambioTamano, engrosarPermitido: boolean, reducidos: ReadonlySet<string>, notas: string[], techoCm?: number): CambioHecho {
  const f = c.formato.trim().toUpperCase();
  if (!(FORMATOS_AJUSTABLES as readonly string[]).includes(f)) fallar(`El tamaño «${c.formato}» no va en lo orgánico: usa ${FORMATOS_AJUSTABLES.join(", ")}.`);
  const zona = c.donde ?? "todo";
  if (c.solo_ahi && zona === "todo") fallar("solo_ahi va con donde (abajo, arriba, inicio, medio o fin).");
  if (c.accion === "poner" && c.cantidad === undefined && c.porcentaje === undefined) fallar("accion «poner» necesita cantidad o porcentaje (para «más», usa accion «mas»).");
  if (c.cantidad !== undefined && c.porcentaje !== undefined) fallar("Pasa cantidad o porcentaje, no los dos.");
  let pieza = comoOrganico(entrada);
  const medidaPaso = medir(pieza, f, zona);
  const porPorcentaje = c.porcentaje !== undefined;
  const valor = (p: Organico) => (porPorcentaje ? medir(p, f, zona).porcentaje : medir(p, f, zona).cantidad);
  const actual = porPorcentaje ? medidaPaso.porcentaje : medidaPaso.cantidad;
  /** Cuántos había al empezar el pedido: «más» y «menos» se miden contra eso, no contra lo que dejó un cambio anterior. */
  const inicial = porPorcentaje ? actual : medir(original, f, zona).cantidad;
  let meta: number, modo: Modo;
  if (c.accion === "quitar") { meta = 0; modo = "a_lo_mas"; }
  else if (c.cantidad !== undefined || c.porcentaje !== undefined) { meta = c.cantidad ?? c.porcentaje!; modo = "cerca"; }
  else if (c.accion === "mas") { const base = Math.max(actual, inicial); meta = base === 0 ? Math.max(4, Math.ceil(medidaPaso.estructura * 0.08)) : Math.max(base + 3, Math.ceil(base * 1.6)); modo = "al_menos"; }
  else { meta = Math.floor(Math.min(actual, inicial) * 0.5); modo = "a_lo_mas"; }
  const tolerancia = porPorcentaje ? 3 : Math.max(1, Math.round(meta * 0.08));
  const extra: string[] = [];
  /** Si la pieza, con el cuerpo más grueso, sigue cabiendo bajo el techo (la misma medida de alto con que la herramienta valida después). */
  const cabeBajoElTecho = (p: PiezaOrganica) => techoCm === undefined || alturaDePieza(p) <= techoCm;

  // ¿Cabe? Un formato más ancho que el cuerpo no va (el trazo no lo pone; sin generador sobresale): se engruesa donde va.
  const quiereMas = meta > actual || (c.accion === "poner" && meta > 0);
  if (quiereMas && cabe(pieza, f, zona) === "nada") {
    if (!engrosarPermitido) fallar(`Los ${f} (inflado ${r0(inflado(pieza, f))} cm) no caben en el cuerpo de esta pieza${zona === "todo" ? "" : ` (${zona})`}: necesita al menos ${grosorMinimo(pieza, f)} cm de grosor. Vuelve a llamar con engrosar: true o engruésala con cambiar_pieza grosor_cm.`);
    const hecho = engrosar(pieza, f, zona, false) ?? engrosar(pieza, f, zona, true) ?? fallar(`Los ${f} no caben ni engrosando el cuerpo al máximo (160 cm).`);
    if (cabeBajoElTecho(hecho.pieza)) { pieza = hecho.pieza; extra.push(hecho.nota); }
    else extra.push(`los ${f} no caben en el cuerpo de ahora y engrosarlo lo que piden (${grosorMinimo(pieza, f)} cm) haría la pieza más alta de lo que cabe bajo el techo (${r0(techoCm!)} cm): se queda como está`);
  }

  const base = pieza;
  let elegida = c.accion === "quitar" ? { pieza: conPeso(base, f, zona, 0, !!c.solo_ahi), valor: 0, k: 0 } : buscar((k) => conPeso(base, f, zona, k, !!c.solo_ahi), valor, actual, meta, modo, tolerancia);
  elegida = { ...elegida, valor: valor(elegida.pieza) };
  // No llegó subiendo: engrosar toda la zona (y sus vecinos) donde aún no cabe y volver a buscar.
  if (quiereMas && modo !== "a_lo_mas" && elegida.valor < meta - (modo === "cerca" ? tolerancia : 0) && engrosarPermitido && cabe(base, f, zona) !== "todo") {
    const hecho = engrosar(base, f, zona, true);
    if (hecho && !cabeBajoElTecho(hecho.pieza)) extra.push(`no engrosé el cuerpo de ${zona === "todo" ? "la pieza" : zona} para llegar a la meta: pasaría de los ${r0(techoCm!)} cm que caben bajo el techo`);
    else if (hecho) {
      const otra = buscar((k) => conPeso(hecho.pieza, f, zona, k, !!c.solo_ahi), valor, valor(hecho.pieza), meta, modo, tolerancia);
      if (otra.valor > elegida.valor) { elegida = otra; extra.push(hecho.nota); }
    }
  }
  // Sigue sin llegar con el cuerpo en que cabe: es lo que da esa mezcla (el segundo «más R-24» seguido). Se engruesa todo
  // el cuerpo por pasos hasta que llegue (más cuerpo, más globos de cada tamaño) y se dice cuánto.
  const noLlega = (v: number) => v < meta - (modo === "cerca" ? tolerancia : 0);
  if (quiereMas && modo !== "a_lo_mas" && zona === "todo" && engrosarPermitido && noLlega(elegida.valor)) {
    let notaCuerpo = "";
    for (const factor of FACTORES_CUERPO) {
      const gruesa = conGrosor(base, factor) as Organico;
      if (!cabeBajoElTecho(gruesa)) {
        extra.push(`no engrosé más el cuerpo: con ${r0((factor - 1) * 100)} % más la pieza pasaría de los ${r0(techoCm ?? 0)} cm que caben bajo el techo`);
        break;
      }
      const otra = buscar((k) => conPeso(gruesa, f, zona, k, !!c.solo_ahi), valor, valor(gruesa), meta, modo, tolerancia);
      if (otra.valor <= elegida.valor) continue;
      elegida = otra;
      notaCuerpo = `para llegar a ${meta} ${f} engrosé todo el cuerpo un ${r0((factor - 1) * 100)} % (con el cuerpo de antes ya no cabían más; pasa a llevar más globos de todos los tamaños)`;
      if (!noLlega(otra.valor)) break;
    }
    if (notaCuerpo) extra.push(notaCuerpo);
  }
  // Bajando: el relleno de ese formato también cuenta (los R-5 y R-9 son sobre todo relleno de huecos). El relleno es
  // de toda la pieza: solo se toca si el cambio es en toda ella; sin él, los huecos los tapa el relleno que queda.
  const sobra = (v: number) => v > meta + (modo === "cerca" ? tolerancia : 0);
  if (!porPorcentaje && (modo === "a_lo_mas" || (modo === "cerca" && meta < actual)) && sobra(elegida.valor)) {
    const sinPeso = conPeso(base, f, zona, 0, !!c.solo_ahi);
    if (opcionesDe(sinPeso).relleno.some((r) => r.formatoId === f)) {
      if (zona !== "todo") extra.push(`el relleno de huecos de ${f} es de toda la pieza: en ${zona} quedan los de relleno`);
      else {
        const sinRelleno = conRelleno(sinPeso, f, reducidos);
        let otra: Probada = { pieza: sinRelleno, valor: valor(sinRelleno), k: 0 };
        // Sin relleno de ese formato quedan muy pocos: vuelve a la mezcla de estructura hasta la meta (menos, no ninguno).
        if (c.accion !== "quitar" && otra.valor < meta - tolerancia) {
          const conMezcla = buscar((k) => conPeso(sinRelleno, f, zona, k, !!c.solo_ahi), valor, otra.valor, meta, "cerca", Math.max(tolerancia, meta * 0.15));
          if (Math.abs(conMezcla.valor - meta) < Math.abs(otra.valor - meta)) otra = conMezcla;
        }
        if (otra.valor < elegida.valor) { elegida = otra; extra.push(`los ${f} eran sobre todo relleno de huecos: los quité del relleno (los huecos los tapa el relleno que queda)`); }
      }
    }
  }
  // Más globos grandes también hacen la pieza más alta (sobresalen del cuerpo): si no cabe bajo el techo, se baja el peso hasta que quepa.
  if (quiereMas && !cabeBajoElTecho(elegida.pieza) && elegida.aplicar) {
    const { aplicar } = elegida;
    let k = elegida.k;
    while (k > PESO_MINIMO_RECORTE && !cabeBajoElTecho(elegida.pieza)) {
      k = 1 + (k - 1) * REDUCCION_RECORTE;
      const pieza = aplicar(k);
      elegida = { pieza, valor: valor(pieza), k, aplicar };
    }
    // Ni con el peso mínimo cabe (la pieza ya estaba al límite): se queda como estaba antes de este cambio.
    if (!cabeBajoElTecho(elegida.pieza)) elegida = { pieza: base, valor: valor(base), k: 1 };
    extra.push(`para que la pieza quepa bajo el techo (${r0(techoCm ?? 0)} cm) quedaron ${elegida.valor} ${f}${porPorcentaje ? " %" : ""} y no los ${meta} pedidos`);
  }
  notas.push(...extra);
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
function densidadPedida(p: PiezaOrganica, factor: number, engrosarPermitido: boolean, techoCm?: number): { pieza: PiezaOrganica; linea: string } {
  const antes = densidadDe(p), estAntes = estructuraDe(p), totalAntes = armada(p).globos.length;
  let pieza = conDensidad(p, factor);
  let linea = `densidad ${antes} → ${densidadDe(pieza)}`;
  if (factor > 1 && estructuraDe(pieza) < estAntes * 1.08) {
    const gruesa = engrosarPermitido ? conGrosor(p, 1.15) : null;
    if (gruesa && techoCm !== undefined && alturaDePieza(gruesa) > techoCm) linea += ` — no caben más globos de estructura en ese grosor y engrosar el cuerpo pasaría de los ${r0(techoCm)} cm que caben bajo el techo`;
    else if (gruesa) { pieza = gruesa; linea = `densidad: ya no caben más globos en ese grosor (${antes}), así que engrosé el cuerpo un 15 % para que lleve más`; }
    else linea += " — no caben más globos de estructura en ese grosor (engrosar: true para engrosarla)";
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
  const totalAntes = armada(pieza).globos.length;
  let actual: PiezaOrganica = pieza;
  const reducidos = new Set((pedido.cambios ?? []).filter((c) => c.accion === "menos" || c.accion === "quitar").map((c) => c.formato.trim().toUpperCase()));
  for (const c of pedido.cambios ?? []) {
    const hecho = aplicarCambio(actual, pieza, c, pedido.engrosar ?? true, reducidos, notas, techoCm);
    actual = hecho.pieza;
    lineas.push(hecho.linea);
  }
  if (pedido.densidad !== undefined || pedido.densidad_factor !== undefined) {
    const hecho = densidadPedida(actual, pedido.densidad_factor ?? DENSIDAD[pedido.densidad ?? "mas"], pedido.engrosar ?? true, techoCm);
    actual = hecho.pieza;
    lineas.push(hecho.linea);
  }
  if (pedido.racimos !== undefined || pedido.racimos_valor !== undefined) {
    const o = comoOrganico(actual);
    const antes = racimosDe(o), bultos = bultosDe(o);
    const nueva = conRacimos(o, pedido.racimos_valor ?? antes + (pedido.racimos === "menos" ? -0.3 : 0.3));
    actual = nueva;
    const que = o.generador?.tipo === "trazo" ? "los bultos sobresalen hasta" : "irregularidad de la silueta";
    lineas.push(`abultado (racimos) ${antes} → ${racimosDe(nueva)}: ${que} ${r0(bultos * 100)} % → ${r0(bultosDe(nueva) * 100)} %${racimosDe(nueva) === antes ? " (ya estaba en el tope)" : ""}`);
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
