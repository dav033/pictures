import type { z } from "zod";
import { MAX_COLORES_PROPUESTA, PropuestaComposicionSchema, type PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { listaNatural, piezaEnPalabras } from "@/lib/ia/guiado/propuesta-composicion";
import { ESTRUCTURAS_OFICIALES, esEstructuraOficialId, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { MAX_PIEZAS_PLAN, PIEZAS_CON_LADO, nombresIndividuales, type Lateral } from "@/lib/plan/piezas-individuales";
import { PALETA_COLORES_V2, clasificarColores } from "@/lib/rag/taxonomy/v2";
import { detalleDeIdea } from "@/lib/biblioteca-sempertex/detalle-idea";
import { colorCliente } from "./formato";

/**
 * «Agregar al plan» (pedido 3): suma las piezas de una idea de la biblioteca al plan vigente, o crea el plan si no hay.
 * Puro, sin React ni red. No calcula cantidades: arma la PROPUESTA (las piezas que ya tenía el plan más las nuevas, cada
 * una individual y con sus colores lisos) que se resuelve por el camino de siempre (`aceptarPropuesta` → /api/chat →
 * Python, que es el dueño de las cantidades). Los topes se dicen ANTES de llamar al modelo.
 */

type Propuesta = z.infer<typeof PropuestaComposicionSchema>;
type PiezaPropuesta = Propuesta["piezas"][number];
type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
export type ColorPaleta = (typeof PALETA_COLORES_V2)[number];

/** Colores de una pieza nueva: los más presentes de la idea (una idea con más es un arcoíris; la pieza sigue legible). */
export const MAX_COLORES_PIEZA_IDEA = 5;
/** Colores del plan entero (`concepto.paleta` admite 8). */
export const MAX_COLORES_PLAN_TOTAL = MAX_COLORES_PROPUESTA;
export { MAX_PIEZAS_PLAN };

/** Lo que no es un globo liso de un color: impresos, Infinity, metalizados, cortinas, frases entre comillas. */
const NO_LISO = /impres|estampad|2 caras|dos caras|feliz|cumplea|happy|birthday|infinity|bal[oó]n|f[uú]tbol|\bcopa\b|«|metalizad|cortina|\blove\b|te amo|surtido/i;
/** Globos para modelar (T160, T260): tallos, hojas y flores; su color no es el de la pieza. */
const PARA_MODELAR = /·\s*T\d{3}\s*·|\btubito\b/i;
const PALETA: ReadonlySet<string> = new Set(PALETA_COLORES_V2);

function esColorPaleta(valor: string): valor is ColorPaleta {
  return PALETA.has(valor);
}

/**
 * Color de la paleta de un texto de color: «rosado» tal cual; «verde eucalipto» → verde; «verde menta» → menta (la palabra
 * que precisa el tono va al final); «café con leche» → cafe. Null si no es un color de la paleta (o es «multicolor»).
 */
export function colorDePaleta(texto: string | undefined | null): ColorPaleta | null {
  const limpio = (texto ?? "").trim().toLocaleLowerCase("es");
  if (!limpio) return null;
  if (esColorPaleta(limpio)) return limpio === "multicolor" ? null : limpio;
  return clasificarColores(limpio).values.filter((color) => color !== "multicolor").at(-1) ?? null;
}

/**
 * Color liso de un material de la biblioteca, por su nota («… — R-12 / PAQUETE X 50 · R-12 · rosado» → rosado). Null si
 * no es un globo liso (impreso, metalizado, cortina) o es para modelar.
 */
export function colorLisoDeMaterial(nota: string | undefined): ColorPaleta | null {
  if (!nota || NO_LISO.test(nota) || PARA_MODELAR.test(nota)) return null;
  const partes = nota.split(" · ").map((parte) => parte.trim()).filter(Boolean);
  return partes.length >= 3 ? colorDePaleta(partes.at(-1)) : null;
}

/** Por id: la vista pide el estado de cada idea en cada render (también mientras llega texto) y la idea no cambia. */
const coloresPorIdea = new Map<string, ColorPaleta[]>();

/** Los colores lisos de la idea, del más presente al menos (por cantidad de globos), como mucho cinco. */
export function coloresDeIdea(decoracion: DecoracionSempertex): ColorPaleta[] {
  const guardados = coloresPorIdea.get(decoracion.id);
  if (guardados) return guardados;
  const porColor = new Map<ColorPaleta, number>();
  for (const material of decoracion.materiales) {
    const color = colorLisoDeMaterial(material.nota);
    if (color) porColor.set(color, (porColor.get(color) ?? 0) + material.cantidad);
  }
  // `sort` es estable: a igual cantidad queda el que apareció primero.
  const colores = [...porColor].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, MAX_COLORES_PIEZA_IDEA);
  coloresPorIdea.set(decoracion.id, colores);
  return colores;
}

export type MotivoBloqueo = "figura" | "sin-piezas" | "sin-colores" | "pieza-sin-oficial" | "demasiadas-piezas" | "demasiados-colores" | "invalida";
type Bloqueo = { ok: false; motivo: MotivoBloqueo; mensaje: string };
type Medidas = { ancho_m?: number; alto_m?: number; largo_m?: number };
/** Una pieza individual de la idea, con sus colores lisos y, si la biblioteca las tiene, sus medidas. */
export type PiezaNueva = { estructura: EstructuraOficialId; colores: ColorPaleta[]; medidas?: Medidas };
type IdeaLista = { ok: true; piezas: PiezaNueva[]; colores: ColorPaleta[] };

/** Solo las medidas que admite el contrato (positivas, hasta 100 m); undefined si no queda ninguna. */
function medidasValidas(medidas: Medidas | undefined): Medidas | undefined {
  if (!medidas) return undefined;
  const validas = Object.fromEntries((["ancho_m", "alto_m", "largo_m"] as const).flatMap((campo) => {
    const valor = medidas[campo];
    return valor !== undefined && valor > 0 && valor <= 100 ? [[campo, Math.round(valor * 100) / 100]] : [];
  })) as Medidas;
  return Object.keys(validas).length ? validas : undefined;
}

/**
 * Si la idea se puede sumar a un plan, sus piezas INDIVIDUALES («2 columnas» → dos piezas) y sus colores lisos. Con el
 * detalle precalculado de la biblioteca (`detalles-ideas.json`), cada pieza lleva SUS colores y SUS medidas (las del
 * plan de Python de la foto: el plan sale del tamaño que el cliente vio); sin él, los colores lisos de los materiales.
 * No se suma una idea con figura (sombrero, balón: el plan guiado no la arma) ni una sin globos lisos de la paleta.
 */
export function ideaAgregable(decoracion: DecoracionSempertex): IdeaLista | Bloqueo {
  const detalle = detalleDeIdea(decoracion.id);
  if (decoracion.piezas.some((pieza) => pieza.estructura === "figura") || detalle?.piezas.some((pieza) => pieza.estructura === "figura")) {
    return { ok: false, motivo: "figura", mensaje: "Esta idea lleva una figura de globos, que todavía no puedo sumar a un plan." };
  }
  const deLaIdea = coloresDeIdea(decoracion);
  const piezas: PiezaNueva[] = detalle
    ? detalle.piezas.flatMap((pieza) => {
      const medidas = medidasValidas(pieza.medidas);
      const colores = pieza.colores.length ? [...pieza.colores] : deLaIdea;
      return Array.from({ length: Math.max(1, pieza.repeticiones) }, () => ({ estructura: pieza.estructura, colores, ...(medidas ? { medidas } : {}) }));
    })
    : decoracion.piezas.flatMap((pieza) => Array.from({ length: Math.max(1, pieza.cantidad) }, () => ({ estructura: pieza.estructura, colores: deLaIdea })));
  if (!piezas.length) return { ok: false, motivo: "sin-piezas", mensaje: "Esta idea no trae piezas que pueda sumar a un plan." };
  const colores = [...new Set(piezas.flatMap((pieza) => pieza.colores))];
  if (!colores.length || piezas.some((pieza) => !pieza.colores.length)) {
    return { ok: false, motivo: "sin-colores", mensaje: "Esta idea no tiene globos lisos que pueda sumar a tu plan." };
  }
  return { ok: true, piezas, colores };
}

export type PiezaDelPlan = { estructura: EstructuraOficialId; cantidad: number; nombre: string; ubicacion?: Lateral; colores: ColorPaleta[] };

function esLateral(valor: string | undefined): valor is Lateral {
  return valor === "lateral_izquierdo" || valor === "lateral_derecho";
}

/**
 * Las piezas del plan vigente, en su orden y SIEMPRE individuales, con sus colores de la paleta (los de sus materiales,
 * como mucho seis). Una pieza repetida de un plan anterior a las piezas individuales («2 × Columna») pasa a dos, la
 * izquierda y la derecha si tienen lado: el servidor la separaría igual al resolver.
 */
export function piezasDelPlan(plan: PlanGuiado): { ok: true; piezas: PiezaDelPlan[] } | Bloqueo {
  const piezas: PiezaDelPlan[] = [];
  for (const estructura of plan.plan.estructuras) {
    const oficial = estructura.estructura_oficial;
    if (!esEstructuraOficialId(oficial)) {
      return { ok: false, motivo: "pieza-sin-oficial", mensaje: `No puedo sumar ideas a este plan sin perder «${estructura.nombre}». Pídeme el cambio en el chat.` };
    }
    const colores = [...new Set(estructura.materiales.map((material) => colorDePaleta(material.color)).filter((color): color is ColorPaleta => color !== null))].slice(0, 6);
    const repeticiones = Math.min(12, Math.max(1, Math.trunc(estructura.repeticiones)));
    if (repeticiones === 1) {
      piezas.push({ estructura: oficial, cantidad: 1, nombre: estructura.nombre, ...(esLateral(estructura.ubicacion) ? { ubicacion: estructura.ubicacion } : {}), colores });
      continue;
    }
    const lados: readonly Lateral[] = repeticiones === 2 && PIEZAS_CON_LADO.has(oficial) ? ["lateral_izquierdo", "lateral_derecho"] : [];
    for (let indice = 0; indice < repeticiones; indice += 1) {
      const lado = lados[indice];
      piezas.push({ estructura: oficial, cantidad: 1, nombre: ESTRUCTURAS_OFICIALES[oficial].nombre, ...(lado ? { ubicacion: lado } : {}), colores });
    }
  }
  return { ok: true, piezas };
}

/**
 * Los nombres que verá el cliente, como los pondrá el servidor (`nombrarPiezasIndividuales`): una pieza sola conserva
 * su nombre; dos con lado son la izquierda y la derecha; tres o más van numeradas. Un grupo con alguna pieza repetida
 * (un plan anterior a las piezas individuales) no se renombra.
 */
function nombresFinales(piezas: ReadonlyArray<{ estructura: EstructuraOficialId; cantidad: number; nombre?: string; ubicacion?: Lateral }>): string[] {
  const nombres = piezas.map((pieza) => pieza.nombre ?? ESTRUCTURAS_OFICIALES[pieza.estructura].nombre);
  const grupos = new Map<EstructuraOficialId, number[]>();
  piezas.forEach((pieza, indice) => grupos.set(pieza.estructura, [...(grupos.get(pieza.estructura) ?? []), indice]));
  for (const [oficial, indices] of grupos) {
    if (indices.some((indice) => piezas[indice]!.cantidad > 1)) continue;
    if (indices.length === 1) {
      const indice = indices[0]!;
      if (!piezas[indice]!.nombre) nombres[indice] = ESTRUCTURAS_OFICIALES[oficial].nombre;
      continue;
    }
    if (indices.length === 2 && PIEZAS_CON_LADO.has(oficial)) {
      // El servidor respeta el lado que ya tenga una («la columna que queda sigue a la derecha»).
      const derechaPrimero = piezas[indices[0]!]!.ubicacion === "lateral_derecho" || piezas[indices[1]!]!.ubicacion === "lateral_izquierdo";
      const [izquierda, derecha] = nombresIndividuales(oficial, 2) as [string, string];
      nombres[indices[0]!] = derechaPrimero ? derecha : izquierda;
      nombres[indices[1]!] = derechaPrimero ? izquierda : derecha;
      continue;
    }
    indices.forEach((indice, posicion) => { nombres[indice] = `${ESTRUCTURAS_OFICIALES[oficial].nombre} ${posicion + 1}`; });
  }
  return nombres;
}

/** «dos columnas», «un semiarco y dos bouquets de globos». */
function piezasEnPalabras(piezas: readonly EstructuraOficialId[]): string {
  const cuenta = new Map<EstructuraOficialId, number>();
  for (const pieza of piezas) cuenta.set(pieza, (cuenta.get(pieza) ?? 0) + 1);
  return listaNatural([...cuenta].map(([estructura, cantidad]) => piezaEnPalabras(estructura, cantidad)));
}

function recortar(texto: string, maximo: number): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1).trimEnd()}…`;
}

export type PropuestaAgregada = {
  ok: true;
  propuesta: Propuesta;
  /** Nombres de las piezas nuevas («Columna izquierda», «Columna derecha»). */
  nuevas: string[];
  piezasAntes: number;
  piezasDespues: number;
  /** Colores lisos de la idea y los que el plan no tenía. */
  colores: ColorPaleta[];
  coloresNuevos: ColorPaleta[];
};

/**
 * La propuesta que suma la idea al plan (o lo crea con ella): primero las piezas que ya había, cada una con sus colores,
 * su nombre y su lado; después las de la idea, cada una individual, en sus colores lisos y con sus medidas. Los colores
 * de la propuesta son la unión. Si se pasa de 8 piezas o de 8 colores, lo dice con un mensaje que explica qué hacer.
 */
export function propuestaAgregarIdea(decoracion: DecoracionSempertex, plan: PlanGuiado | null): PropuestaAgregada | Bloqueo {
  const idea = ideaAgregable(decoracion);
  if (!idea.ok) return idea;
  const delPlan = plan ? piezasDelPlan(plan) : { ok: true as const, piezas: [] };
  if (!delPlan.ok) return delPlan;
  const actuales = delPlan.piezas;
  const titulo = decoracion.titulo;
  const piezasAntes = actuales.reduce((suma, pieza) => suma + pieza.cantidad, 0);
  const piezasDespues = piezasAntes + idea.piezas.length;
  if (piezasDespues > MAX_PIEZAS_PLAN) {
    return {
      ok: false,
      motivo: "demasiadas-piezas",
      mensaje: plan
        ? `Tu plan tiene ${piezasAntes} ${piezasAntes === 1 ? "pieza" : "piezas"}; con esta idea serían ${piezasDespues} y el máximo es ${MAX_PIEZAS_PLAN}. Quita una pieza en «Ajustar mi plan» y vuelve a intentarlo.`
        : `Esta idea tiene ${piezasDespues} piezas y un plan admite como mucho ${MAX_PIEZAS_PLAN}.`,
    };
  }
  // Una pieza del plan sin colores de la paleta va con los del concepto: también tienen que caber.
  const paletaPlan = plan && actuales.some((pieza) => !pieza.colores.length)
    ? plan.plan.concepto.paleta.map(colorDePaleta).filter((color): color is ColorPaleta => color !== null)
    : [];
  const coloresAntes = [...new Set([...actuales.flatMap((pieza) => pieza.colores), ...paletaPlan])];
  const colores = [...new Set([...coloresAntes, ...idea.colores])];
  if (colores.length > MAX_COLORES_PLAN_TOTAL) {
    return {
      ok: false,
      motivo: "demasiados-colores",
      mensaje: `Tu plan tiene ${coloresAntes.length} colores; con esta idea serían ${colores.length} y el máximo es ${MAX_COLORES_PLAN_TOTAL}. Quita un color en «Ajustar mi plan» y vuelve a intentarlo.`,
    };
  }
  const coloresNuevos = idea.colores.filter((color) => !coloresAntes.includes(color));

  const entradas: Array<{ estructura: EstructuraOficialId; cantidad: number; nombre?: string; ubicacion?: Lateral; colores: ColorPaleta[]; medidas?: Medidas }> = [
    ...actuales,
    ...idea.piezas.map((pieza) => ({ ...pieza, cantidad: 1 })),
  ];
  const nombres = nombresFinales(entradas);
  const piezas: PiezaPropuesta[] = entradas.map((pieza, indice) => ({
    estructura: pieza.estructura,
    cantidad: pieza.cantidad,
    nombre: nombres[indice]!.slice(0, 120),
    ...(pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
    ...(pieza.colores.length ? { colores: pieza.colores.slice(0, 6) } : {}),
    ...(pieza.medidas ? { medidas: pieza.medidas } : {}),
  }));
  const enPalabras = piezasEnPalabras(idea.piezas.map((pieza) => pieza.estructura));
  const frase = plan
    ? `Sumo a tu plan ${enPalabras} de «${titulo}» en ${listaNatural(idea.colores)}. Tu plan quedará con ${piezasDespues} piezas.`
    : `Armo tu plan con «${titulo}»: ${enPalabras} en ${listaNatural(idea.colores)}.`;
  const candidata = { frase: recortar(frase, 360), colores, piezas };
  const valida = PropuestaComposicionSchema.safeParse(candidata);
  if (!valida.success) return { ok: false, motivo: "invalida", mensaje: "No pude preparar esta idea para tu plan." };
  return {
    ok: true,
    propuesta: valida.data,
    nuevas: nombres.slice(actuales.length),
    piezasAntes,
    piezasDespues,
    colores: idea.colores,
    coloresNuevos,
  };
}

export type EstadoIdeaEnPlan = "listo" | "agregando" | "agregada" | "bloqueada";

/** Motivos que dependen del plan de ahora (se dicen junto al botón); los demás son de la idea y no muestran botón. */
const BLOQUEOS_DEL_PLAN: ReadonlySet<MotivoBloqueo> = new Set<MotivoBloqueo>(["demasiadas-piezas", "demasiados-colores", "pieza-sin-oficial"]);

/**
 * Lo que muestra el botón «Agregar al plan» de una idea con el plan vigente (o sin plan): el estado, el texto de ayuda
 * («Tu plan quedará con 3 piezas, ahora también en negro…») o el motivo y qué hacer. Null: la idea no se puede agregar nunca
 * (figura, sin globos lisos) y no se ofrece.
 */
export function estadoAgregarIdea(
  decoracion: DecoracionSempertex,
  plan: PlanGuiado | null,
  opciones: { ideasDelPlan?: readonly string[]; agregandoId?: string | null } = {},
): { estado: EstadoIdeaEnPlan; ayuda?: string; motivo?: string } | null {
  if (opciones.ideasDelPlan?.includes(decoracion.id)) return { estado: "agregada" };
  if (opciones.agregandoId === decoracion.id) return { estado: "agregando" };
  const resultado = propuestaAgregarIdea(decoracion, plan);
  if (!resultado.ok) return BLOQUEOS_DEL_PLAN.has(resultado.motivo) ? { estado: "bloqueada", motivo: resultado.mensaje } : null;
  if (!plan) return { estado: "listo", ayuda: "Te armo el plan con las cantidades exactas para esta idea." };
  const nuevos = resultado.coloresNuevos.length ? `, ahora también en ${listaNatural(resultado.coloresNuevos.map(colorCliente))}` : "";
  return { estado: "listo", ayuda: `Tu plan quedará con ${resultado.piezasDespues} piezas${nuevos}. Recalculo las cantidades de todo.` };
}
