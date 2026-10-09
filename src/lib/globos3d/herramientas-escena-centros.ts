import { z } from "zod";
import { armarEscena, type Escena, type NodoEscena } from "./escena";
import { centrosDe, centroDeMesa, cosaEncima, GRUPOS_MESA, mesasDeEscena, padreDeCentro, principalDelSalon, ranuraDe, ranurasAlternas, seleccionarMesas, type MesaDeEscena, type Ranura } from "./centros-mesa";
import { altoDe, crearDiseno, recolorearCentro, reescalarCentro, TIPOS_DISENO } from "./centros-mesa-diseno";
import { fallar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { MAX_NODOS } from "./limites-escena";
import type { Pieza } from "./piezas";

/**
 * **Centros de mesa para la IA de escena**: `decorar_mesas` (el mismo centro, o dos que se alternan, en todas las mesas o en las que
 * se digan), `completar_centros` (las mesas nuevas reciben el mismo centro), `cambiar_centros` (colores, alto, escala o diseño de
 * todos a la vez, o de una ranura o unas mesas) y `quitar_centros`. Sirven con cualquier escena que tenga mesas del catálogo.
 * La geometría y las reglas (qué es un centro, dónde va, qué mesa lleva algo encima) están en `centros-mesa.ts`; los diseños, en
 * `centros-mesa-diseno.ts`. El tope de piezas (`MAX_NODOS`) se comprueba ANTES de cambiar nada: o caben todos o no se pone ninguno.
 */

/** El diseño de un centro: se define UNA vez y se usa en decorar_mesas (`disenos`, uno o dos) y en cambiar_centros (`diseno`). */
const DisenoSchema = z.object({
  tipo: z.enum(TIPOS_DISENO).describe("ramo_helio (ramo de helio con cintas, de pie), racimo (seis globos en copa), columna (chica de R-5), flores (flor de globos) o biblioteca (biblioteca_id)"),
  colores: z.array(z.string().min(1).max(40)).min(1).max(4).optional().describe("hasta 4, en ciclo"),
  alto_cm: z.number().min(10).max(250).optional().describe("ramo 70, racimo 26 y columna 60 si falta"),
  biblioteca_id: z.string().min(1).max(160).optional(),
});

const SELECCION = {
  mesas: z.array(z.string().min(1).max(80)).min(1).max(150).optional().describe("ids de mesas (los da ver_escena); sin mesas ni grupo = todas"),
  grupo: z.enum(GRUPOS_MESA).optional().describe("todas, redondas, imperiales, coctel, postres, principal (la mesa de honor), invitados (redondas e imperiales menos la principal); junto con mesas, las que cumplan ambas"),
};

const DecorarSchema = z.object({
  disenos: z.array(DisenoSchema).min(1).max(2).describe("un diseño, o dos que se alternan A, B, A, B (tablero de ajedrez) entre las mesas"),
  ...SELECCION,
  forzar: z.boolean().optional().describe("true: también las mesas que llevan algo encima (por defecto se saltan)"),
});
const CompletarSchema = z.object({ ...SELECCION, forzar: z.boolean().optional().describe("true: también las mesas que llevan algo encima") });
const CambiarSchema = z.object({
  ranura: z.enum(["a", "b", "todas"]).optional().describe("cuál diseño cambia (a o b); si falta, todos"),
  diseno: DisenoSchema.optional().describe("otro diseño entero para esa ranura (a o b)"),
  colores: z.array(z.string().min(1).max(40)).min(1).max(4).optional().describe("nuevos colores, en el orden en que aparecen en el centro"),
  alto_cm: z.number().min(10).max(250).optional().describe("nuevo alto de todos"),
  escala: z.number().min(0.4).max(2.5).optional().describe("multiplica el alto actual (1.3 = 30 % más alto); en vez de alto_cm"),
  ...SELECCION,
});
const QuitarSchema = z.object({ ranura: z.enum(["a", "b", "todas"]).optional().describe("solo los del diseño a o b; si falta, todos"), ...SELECCION });

const lista = (ids: readonly string[], max = 6) => (ids.length > max ? `${ids.slice(0, max).join(", ")} y ${ids.length - max} más` : ids.join(", "));
const letra = (r: Ranura) => (r === 0 ? "A" : "B");

function agrupar(motivos: ReadonlyArray<readonly [string, string]>): string {
  const por = new Map<string, string[]>();
  for (const [id, motivo] of motivos) por.set(motivo, [...(por.get(motivo) ?? []), id]);
  return [...por].map(([motivo, ids]) => `${lista(ids)}: ${motivo}`).join("; ");
}

/** El contexto de toda llamada: la escena armada y sus mesas. */
function contexto(escena: Escena) {
  const armada = armarEscena(escena);
  return { armada, mesas: mesasDeEscena(escena, armada), principal: principalDelSalon(escena) };
}

function mesasElegidas(mesas: readonly MesaDeEscena[], pedido: { mesas?: string[]; grupo?: (typeof GRUPOS_MESA)[number] }, notas: string[], principal?: string | null): MesaDeEscena[] {
  if (!mesas.length) return fallar("No hay mesas en la escena: agrégalas con agregar_mobiliario (mesa_redonda_mantel, mesa_redonda_sillas, mesa_imperial_mantel…).");
  const r = seleccionarMesas(mesas, { ids: pedido.mesas, grupo: pedido.grupo, principal });
  if (r.error) return fallar(r.error);
  if (r.aviso) notas.push(r.aviso);
  if (!r.mesas.length) return fallar(`Ninguna mesa cumple ${pedido.grupo ? `el grupo «${pedido.grupo}»` : "lo pedido"}. Mesas: ${mesas.map((m) => `${m.nodo.id} (${m.tipo})`).join(", ")}.`);
  return r.mesas;
}

/** Los centros de las mesas dadas (y de la ranura pedida). */
function centrosEn(escena: Escena, mesas: readonly MesaDeEscena[], ranura: "a" | "b" | "todas" | undefined): NodoEscena[] {
  const ids = new Set(mesas.map((m) => m.nodo.id));
  return centrosDe(escena).filter((c) => ids.has(padreDeCentro(c) ?? "") && (!ranura || ranura === "todas" || ranuraDe(c) === (ranura === "a" ? 0 : 1)));
}

const sinNodos = (escena: Escena, quitar: ReadonlySet<string>): Escena => ({ ...escena, nodos: escena.nodos.filter((n) => !quitar.has(n.id)) });

/** Falla si poner `nuevos` piezas más pasa el tope de la escena, diciendo cuántas caben. */
function comprobarTope(escena: Escena, nuevos: number, que: string): void {
  const sobran = escena.nodos.length + nuevos - MAX_NODOS;
  if (sobran <= 0) return;
  const caben = Math.max(0, MAX_NODOS - escena.nodos.length);
  fallar(`${que} necesita ${nuevos} piezas más y la escena ya tiene ${escena.nodos.length} (máximo ${MAX_NODOS}): caben ${caben}, faltan ${sobran}. Elige menos mesas (mesas o grupo), o quita piezas antes.`);
}

// ----------------------------------------------------------------------------------------------------------
// decorar_mesas
// ----------------------------------------------------------------------------------------------------------

function decorar(escena: Escena, argumentos: unknown) {
  const a = DecorarSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const { armada, mesas, principal } = contexto(escena);
  const elegidas = mesasElegidas(mesas, a, notas, principal);
  const disenos = a.disenos.map((d) => crearDiseno(d, notas));
  const saltadas: Array<readonly [string, string]> = [];
  const candidatas = elegidas.filter((m) => {
    const motivo = a.forzar ? null : cosaEncima(escena, armada, m);
    if (motivo) saltadas.push([m.nodo.id, motivo]);
    return !motivo;
  });
  if (!candidatas.length) return fallar(`Todas las mesas elegidas llevan algo encima (${agrupar(saltadas)}). Con forzar: true se ponen igual.`);

  const viejos = centrosEn(escena, candidatas, undefined);
  const trabajo = sinNodos(escena, new Set(viejos.map((c) => c.id)));
  comprobarTope(trabajo, candidatas.length, `Decorar ${candidatas.length} mesa${candidatas.length === 1 ? "" : "s"}`);
  const ranuras = disenos.length > 1 ? ranurasAlternas(candidatas) : new Map<string, Ranura>();

  let actual = trabajo;
  const puestos: Array<{ nodo: NodoEscena; ranura: Ranura }> = [];
  for (const mesa of candidatas) {
    const ranura = ranuras.get(mesa.nodo.id) ?? 0;
    const diseno = disenos[ranura]!;
    const hecho = centroDeMesa(actual, armada, mesa, diseno.pieza, { ranura, nombre: `${diseno.nombre} · ${mesa.nodo.nombre}` });
    if ("motivo" in hecho) {
      saltadas.push([mesa.nodo.id, hecho.motivo]);
      const previo = viejos.find((c) => padreDeCentro(c) === mesa.nodo.id);
      if (previo) actual = { ...actual, nodos: [...actual.nodos, previo] };
      continue;
    }
    actual = { ...actual, nodos: [...actual.nodos, hecho.nodo] };
    puestos.push({ nodo: hecho.nodo, ranura });
  }
  if (!puestos.length) return fallar(`No se pudo poner ningún centro: ${agrupar(saltadas)}.`);

  const porRanura = disenos.map((d, r) => ({ d, n: puestos.filter((p) => p.ranura === r).length })).filter((x) => x.n > 0);
  const reemplazados = viejos.filter((c) => puestos.some((p) => padreDeCentro(p.nodo) === padreDeCentro(c))).length;
  const resumen = [
    `Puse ${puestos.length} centro${puestos.length === 1 ? "" : "s"} de mesa (${porRanura.map((x, i) => `${disenos.length > 1 ? `${letra(i as Ranura)}: ` : ""}${x.d.nombre.replace("Centro de mesa · ", "")} × ${x.n}`).join("; ")}) sobre ${lista(puestos.map((p) => padreDeCentro(p.nodo)!))}.`,
    "Cada uno va sobre su mesa: si la mueves, su centro la sigue. Cambiarlos todos: cambiar_centros; mesas nuevas: completar_centros; quitarlos: quitar_centros.",
    reemplazados ? `Reemplacé ${reemplazados} centro${reemplazados === 1 ? "" : "s"} que ya había.` : "",
    saltadas.length ? `No quedaron (${saltadas.length}): ${agrupar(saltadas)}.` : "",
    ...new Set(notas),
  ].filter(Boolean).join(" ");
  return { escena: actual, resumen };
}

// ----------------------------------------------------------------------------------------------------------
// completar_centros
// ----------------------------------------------------------------------------------------------------------

function completar(escena: Escena, argumentos: unknown) {
  const a = CompletarSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const { armada, mesas, principal } = contexto(escena);
  const elegidas = mesasElegidas(mesas, a, notas, principal);
  const centros = centrosDe(escena);
  const referencia = ([0, 1] as const).map((r) => centros.find((c) => ranuraDe(c) === r));
  if (!referencia[0] && !referencia[1]) return fallar("Todavía no hay centros de mesa que repetir: usa decorar_mesas con un diseño primero.");
  const conCentro = new Set(centros.map((c) => padreDeCentro(c)));
  const faltan = elegidas.filter((m) => !conCentro.has(m.nodo.id));
  if (!faltan.length) return { escena, resumen: `Las ${elegidas.length} mesas elegidas ya tienen su centro: no puse nada.` };

  const saltadas: Array<readonly [string, string]> = [];
  const candidatas = faltan.filter((m) => {
    const motivo = a.forzar ? null : cosaEncima(escena, armada, m);
    if (motivo) saltadas.push([m.nodo.id, motivo]);
    return !motivo;
  });
  if (!candidatas.length) return fallar(`Las mesas sin centro llevan algo encima (${agrupar(saltadas)}). Con forzar: true se ponen igual.`);
  comprobarTope(escena, candidatas.length, `Completar ${candidatas.length} mesa${candidatas.length === 1 ? "" : "s"}`);

  // Con dos diseños, el tablero cuenta TODAS las mesas con centro y las nuevas: así las nuevas no repiten a su vecina.
  const conDos = Boolean(referencia[0] && referencia[1]);
  const tablero = conDos ? ranurasAlternas(mesas.filter((m) => conCentro.has(m.nodo.id) || candidatas.includes(m))) : null;
  let actual = escena;
  const puestos: NodoEscena[] = [];
  for (const mesa of candidatas) {
    const ranura: Ranura = tablero?.get(mesa.nodo.id) ?? (referencia[0] ? 0 : 1);
    const ref = referencia[ranura] ?? referencia[0] ?? referencia[1]!;
    const mesaRef = mesas.find((m) => m.nodo.id === padreDeCentro(ref));
    const base = mesaRef && ref.nombre.endsWith(` · ${mesaRef.nodo.nombre}`) ? ref.nombre.slice(0, -` · ${mesaRef.nodo.nombre}`.length) : ref.nombre;
    const hecho = centroDeMesa(actual, armada, mesa, structuredClone(ref.pieza), { ranura: ranuraDe(ref), nombre: `${base} · ${mesa.nodo.nombre}` });
    if ("motivo" in hecho) { saltadas.push([mesa.nodo.id, hecho.motivo]); continue; }
    actual = { ...actual, nodos: [...actual.nodos, hecho.nodo] };
    puestos.push(hecho.nodo);
  }
  if (!puestos.length) return fallar(`No se pudo poner ningún centro: ${agrupar(saltadas)}.`);
  const resumen = [
    `Completé ${puestos.length} mesa${puestos.length === 1 ? "" : "s"} sin centro con el mismo diseño: ${lista(puestos.map((n) => padreDeCentro(n)!))}.`,
    saltadas.length ? `No quedaron (${saltadas.length}): ${agrupar(saltadas)}.` : "",
    ...new Set(notas),
  ].filter(Boolean).join(" ");
  return { escena: actual, resumen };
}

// ----------------------------------------------------------------------------------------------------------
// cambiar_centros
// ----------------------------------------------------------------------------------------------------------

function cambiar(escena: Escena, argumentos: unknown) {
  const a = CambiarSchema.parse(argumentos ?? {});
  if (a.alto_cm !== undefined && a.escala !== undefined) fallar("Pasa alto_cm o escala, no los dos.");
  const notas: string[] = [];
  const { armada, mesas, principal } = contexto(escena);
  const elegidas = mesasElegidas(mesas, a, notas, principal);
  const enAlcance = centrosEn(escena, elegidas, a.ranura);
  if (!enAlcance.length) return fallar("No hay centros de mesa que cambiar en esas mesas: pónlos con decorar_mesas.");
  if (a.diseno && (!a.ranura || a.ranura === "todas") && new Set(enAlcance.map(ranuraDe)).size > 1) fallar("Hay dos diseños (A y B): indica ranura a o b para decir cuál se reemplaza por el diseno nuevo.");

  // El diseño nuevo de cada ranura se arma UNA vez, a partir del primer centro de esa ranura: todos quedan iguales.
  const nuevas = new Map<Ranura, { pieza: Pieza; nombre: string | null }>();
  for (const ranura of new Set(enAlcance.map(ranuraDe))) {
    const ref = enAlcance.find((c) => ranuraDe(c) === ranura)!;
    let pieza = ref.pieza, nombre: string | null = null;
    if (a.diseno) { const d = crearDiseno(a.diseno, notas); pieza = d.pieza; nombre = d.nombre; }
    if (a.colores) pieza = recolorearCentro(pieza, a.colores, notas);
    const alto = a.alto_cm ?? (a.escala !== undefined ? altoDe(pieza) * a.escala : undefined);
    if (alto !== undefined) pieza = reescalarCentro(pieza, alto) ?? fallar("Ese diseño no cambia de alto (es una flor o una decoración fija). Cámbialo por ramo_helio, racimo o columna con diseno.");
    nuevas.set(ranura, { pieza, nombre });
  }

  let actual = escena;
  const hechos: string[] = [];
  const saltadas: Array<readonly [string, string]> = [];
  for (const viejo of enAlcance) {
    const mesa = mesas.find((m) => m.nodo.id === padreDeCentro(viejo));
    if (!mesa) continue;
    const nueva = nuevas.get(ranuraDe(viejo))!;
    const nombre = nueva.nombre ? `${nueva.nombre} · ${mesa.nodo.nombre}` : viejo.nombre;
    const hecho = centroDeMesa(actual, armada, mesa, structuredClone(nueva.pieza), { ranura: ranuraDe(viejo), nombre, id: viejo.id });
    if ("motivo" in hecho) { saltadas.push([mesa.nodo.id, `se queda como estaba (${hecho.motivo})`]); continue; }
    actual = { ...actual, nodos: actual.nodos.map((n) => (n.id === viejo.id ? hecho.nodo : n)) };
    hechos.push(mesa.nodo.id);
  }
  if (!hechos.length) return fallar(`No cambió ningún centro: ${agrupar(saltadas)}.`);
  const queCambio = [a.diseno && "diseño", a.colores && "colores", (a.alto_cm !== undefined || a.escala !== undefined) && "alto"].filter(Boolean).join(", ") || "sin cambios de diseño: los volví a apoyar en su mesa";
  const alto = Math.round(altoDe(nuevas.values().next().value!.pieza));
  return {
    escena: actual,
    resumen: [`Cambié ${hechos.length} centro${hechos.length === 1 ? "" : "s"} (${queCambio}; ahora de ${alto} cm de alto): ${lista(hechos)}.`, saltadas.length ? `No cambiaron (${saltadas.length}): ${agrupar(saltadas)}.` : "", ...new Set(notas)].filter(Boolean).join(" "),
  };
}

// ----------------------------------------------------------------------------------------------------------
// quitar_centros
// ----------------------------------------------------------------------------------------------------------

function quitar(escena: Escena, argumentos: unknown) {
  const a = QuitarSchema.parse(argumentos ?? {});
  const notas: string[] = [];
  const { mesas, principal } = contexto(escena);
  const sinFiltro = !a.mesas?.length && (!a.grupo || a.grupo === "todas");
  const lasCentros = sinFiltro ? centrosDe(escena).filter((c) => !a.ranura || a.ranura === "todas" || ranuraDe(c) === (a.ranura === "a" ? 0 : 1)) : centrosEn(escena, mesasElegidas(mesas, a, notas, principal), a.ranura);
  if (!lasCentros.length) return fallar("No hay centros de mesa que quitar con eso.");
  return {
    escena: sinNodos(escena, new Set(lasCentros.map((c) => c.id))),
    resumen: `Quité ${lasCentros.length} centro${lasCentros.length === 1 ? "" : "s"} de mesa (de ${lista(lasCentros.map((c) => padreDeCentro(c) ?? c.id))}). Las mesas siguen igual.${notas.length ? ` ${[...new Set(notas)].join(" ")}` : ""}`,
  };
}

export const HERRAMIENTAS_CENTROS: Readonly<Record<string, HerramientaExtra>> = {
  decorar_mesas: {
    esquema: DecorarSchema,
    descripcion: "Pone un centro de mesa sobre cada mesa (todas, las de ids, o un grupo: redondas, imperiales, coctel, postres, principal, invitados), diseñado UNA vez: ramo_helio, racimo, columna, flores o un item de la biblioteca, con colores y alto. Con dos disenos los alterna (alto y bajo, o dos colores). Cada centro va sobre su mesa y la sigue si se mueve; se salta las mesas que ya llevan algo encima. Sirve en cualquier escena con mesas: 1 mesa o 35. Si ya había centros en esas mesas, los reemplaza. Úsala para «centros de mesa», «decora las mesas».",
    aplicar: decorar,
  },
  completar_centros: {
    esquema: CompletarSchema,
    descripcion: "Pone el MISMO centro (el que ya tienen las demás) solo en las mesas que todavía no tienen: para las mesas agregadas después de decorar_mesas. No toca los centros que ya hay.",
    aplicar: completar,
  },
  cambiar_centros: {
    esquema: CambiarSchema,
    descripcion: "Cambia los centros de mesa que ya hay, todos a la vez (o los de ciertas mesas o de la ranura a o b): colores, alto_cm o escala (más alto, más bajo), o un diseno nuevo. Quedan todos iguales. Sin cambios, los vuelve a apoyar en su mesa (si la mesa cambió de medida).",
    aplicar: cambiar,
  },
  quitar_centros: {
    esquema: QuitarSchema,
    descripcion: "Quita los centros de mesa (todos, los de ciertas mesas o grupo, o solo la ranura a o b). Las mesas no se tocan.",
    aplicar: quitar,
  },
};
