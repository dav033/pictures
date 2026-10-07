import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { ESTRUCTURAS_OFICIALES, esEstructuraOficialId, type EstructuraOficialId } from "./estructuras-oficiales";
import { esCuentaGeometrica, type EstructuraPlan, type PlanDecoracion, type Ubicacion } from "./tipos";

/**
 * Piezas SIEMPRE individuales (regla del dueño, 2026-10-06): dos columnas son dos piezas, «Columna izquierda» y
 * «Columna derecha», cada una con su dibujo, sus globos y su botón de quitar; nunca «2 × Columna».
 *
 * Puro y sin servidor (lo importan el navegador, /api/asistente-guiado y `confirmar_plan_decoracion`):
 * - `piezasIndividualesDePropuesta`: la lista de piezas que la vista guiada le pide al modelo, una por línea, con
 *   su id y su lado. Sin nombres: un nombre con número («Columna 1») en el texto lo lee `extraerRestriccionesUsuario`
 *   como «el cliente pidió UNA columna» y el plan de dos se rechazaría en bucle.
 * - `separarEstructurasRepetidas`: la garantía determinista. Una estructura con `repeticiones` N (la escribió el
 *   modelo, o la foto con una pareja en espejo) pasa a N estructuras de 1 ANTES de resolver con Python, que sigue
 *   siendo el dueño de las cantidades: resuelve N piezas de 1 en vez de 1 de N (la compra se consolida por variante).
 * - `nombrarPiezasIndividuales`: los nombres los pone el servidor, nunca el modelo.
 */

/** Tope de piezas de un plan: `PlanDecoracionSchema.estructuras.max(8)` (y el JSON exportado a Python). */
export const MAX_PIEZAS_PLAN = 8;

/** Género gramatical de cada pieza oficial («una columna», «la columna derecha»). */
export const FEMENINAS: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>([
  "columna", "columna_asimetrica", "columna_no_densa", "pared_densa", "pared_no_densa", "pared_organica", "guirnalda", "figura",
]);

/** Piezas que van de a una por lado: dos de ellas son la izquierda y la derecha (el semiarco derecho se dibuja en espejo). */
export const PIEZAS_CON_LADO: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>([
  "columna", "columna_asimetrica", "columna_no_densa", "semiarco", "semiarco_asimetrico",
]);

export type Lateral = "lateral_izquierdo" | "lateral_derecho";
type Lado = "izquierdo" | "derecho";

const LADO_DE_LATERAL: Readonly<Record<Lateral, Lado>> = { lateral_izquierdo: "izquierdo", lateral_derecho: "derecho" };
/** Ubicaciones de un lado o que se flanquean: dos piezas iguales ahí son la izquierda y la derecha. */
const UBICACIONES_DE_PAR: ReadonlySet<Ubicacion> = new Set<Ubicacion>(["lateral_izquierdo", "lateral_derecho", "entrada"]);
/** Una sola pieza cabe en cada una (`PlanDecoracionSchema`): una repetición ahí no se separa. */
const UBICACIONES_UNICAS: ReadonlySet<Ubicacion> = new Set<Ubicacion>(["fondo_pared", "techo"]);
const SUFIJOS = "BCDEFGHIJ";

function esLateral(ubicacion: string | undefined): ubicacion is Lateral {
  return ubicacion === "lateral_izquierdo" || ubicacion === "lateral_derecho";
}

function opuesto(lateral: Lateral): Lateral {
  return lateral === "lateral_izquierdo" ? "lateral_derecho" : "lateral_izquierdo";
}

function palabraLado(oficial: EstructuraOficialId, lado: Lado): string {
  const femenina = FEMENINAS.has(oficial);
  if (lado === "izquierdo") return femenina ? "izquierda" : "izquierdo";
  return femenina ? "derecha" : "derecho";
}

/** `EST_02_COLUMNA`: el formato que exige el plan, por posición en la lista. */
export function estructuraIdDe(indice: number, oficial: EstructuraOficialId): string {
  return `EST_${String(indice + 1).padStart(2, "0")}_${oficial.toUpperCase()}`;
}

/**
 * Los nombres de `cantidad` piezas iguales: una sola conserva el de su oficial («Columna»); dos con lado son
 * «Columna izquierda» y «Columna derecha» («Semiarco orgánico izquierdo»); tres o más, o dos sin lado, van
 * numeradas («Columna 1», «Centro de mesa con globos 2»).
 */
export function nombresIndividuales(oficial: EstructuraOficialId, cantidad: number, lados?: readonly [Lado, Lado]): string[] {
  const base = ESTRUCTURAS_OFICIALES[oficial].nombre;
  if (cantidad <= 1) return [base];
  if (cantidad === 2 && PIEZAS_CON_LADO.has(oficial)) {
    const [primero, segundo] = lados && lados[0] !== lados[1] ? lados : (["izquierdo", "derecho"] as const);
    return [`${base} ${palabraLado(oficial, primero)}`, `${base} ${palabraLado(oficial, segundo)}`];
  }
  return Array.from({ length: cantidad }, (_, indice) => `${base} ${indice + 1}`);
}

/**
 * Cantidades que suman como mucho `maximo`: la pieza más numerosa (la primera si empatan) pierde una cada vez, sin
 * bajar de 1. `recortadas` dice cuántas piezas se quitaron (se registra quién lo decidió).
 */
export function recortarCantidades<T extends { cantidad: number }>(piezas: readonly T[], maximo = MAX_PIEZAS_PLAN): { piezas: T[]; recortadas: number } {
  const cantidades = piezas.map((pieza) => Math.max(1, Math.trunc(pieza.cantidad)));
  let total = cantidades.reduce((suma, cantidad) => suma + cantidad, 0);
  let recortadas = 0;
  while (total > maximo) {
    let indice = -1;
    for (const [posicion, cantidad] of cantidades.entries()) if (cantidad > 1 && (indice < 0 || cantidad > cantidades[indice]!)) indice = posicion;
    if (indice < 0) break;
    cantidades[indice]! -= 1;
    total -= 1;
    recortadas += 1;
  }
  let lista = piezas.map((pieza, posicion) => ({ ...pieza, cantidad: cantidades[posicion]! }));
  if (total > maximo) {
    recortadas += total - maximo;
    lista = lista.slice(0, maximo);
  }
  return { piezas: lista, recortadas };
}

export type PiezaPropuestaEntrada = { estructura: EstructuraOficialId; cantidad: number; ubicacion?: Lateral };
export type PiezaIndividual = { estructura: EstructuraOficialId; estructuraId: string; ubicacion?: Lateral };

/**
 * La propuesta de la guiada («un semiarco y dos columnas») como piezas individuales: cada una con su
 * `estructura_id` por posición y, en una pareja con lado, `lateral_izquierdo` y `lateral_derecho`. Respeta el lado
 * que ya traiga una pieza (al quitar la columna derecha, la que queda sigue a la izquierda). Nunca más de 8.
 */
export function piezasIndividualesDePropuesta(piezas: readonly PiezaPropuestaEntrada[]): { piezas: PiezaIndividual[]; recortadas: number } {
  const { piezas: acotadas, recortadas } = recortarCantidades(piezas);
  const planas: Array<{ estructura: EstructuraOficialId; ubicacion?: Lateral }> = acotadas.flatMap((pieza) => Array.from({ length: pieza.cantidad }, () => ({
    estructura: pieza.estructura,
    ...(pieza.cantidad === 1 && pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}),
  })));
  const porOficial = new Map<EstructuraOficialId, number[]>();
  for (const [indice, pieza] of planas.entries()) porOficial.set(pieza.estructura, [...(porOficial.get(pieza.estructura) ?? []), indice]);
  for (const [oficial, indices] of porOficial) {
    if (indices.length !== 2 || !PIEZAS_CON_LADO.has(oficial)) continue;
    const primera = planas[indices[0]!]!;
    const segunda = planas[indices[1]!]!;
    if (primera.ubicacion && (!segunda.ubicacion || segunda.ubicacion === primera.ubicacion)) segunda.ubicacion = opuesto(primera.ubicacion);
    else if (!primera.ubicacion && segunda.ubicacion) primera.ubicacion = opuesto(segunda.ubicacion);
    else if (!primera.ubicacion) {
      primera.ubicacion = "lateral_izquierdo";
      segunda.ubicacion = "lateral_derecho";
    }
  }
  return {
    piezas: planas.map((pieza, indice) => ({ estructura: pieza.estructura, estructuraId: estructuraIdDe(indice, pieza.estructura), ...(pieza.ubicacion ? { ubicacion: pieza.ubicacion } : {}) })),
    recortadas,
  };
}

// --- La garantía: separar repeticiones antes de resolver --------------------------------------------------------

export type Separacion = { origen: string; nuevas: string[] };
export type SinSeparar = { estructura_id: string; repeticiones: number; motivo: string };
export type Renombrada = { estructura_id: string; antes: string; despues: string; ubicacion?: Ubicacion };
export type ResultadoSeparar = { plan: PlanDecoracion; separadas: Separacion[]; sinSeparar: SinSeparar[]; renombradas: Renombrada[] };

type Elemento = ReferenceBlueprintV2["elements"][number];

function centroX(elemento: Elemento): number {
  return elemento.reference_bbox.x + elemento.reference_bbox.width / 2;
}

/** Los elementos aprobados de la foto que son la misma pieza (mismo `repetition_group`), de izquierda a derecha. */
function grupoDeLaFoto(blueprint: ReferenceBlueprintV2 | undefined, elementId: string | undefined): Elemento[] {
  if (!blueprint || !elementId) return [];
  const elemento = blueprint.elements.find((item) => item.element_id === elementId);
  const grupo = elemento?.visual_semantics?.repetition_group;
  if (!elemento || !grupo) return [];
  return blueprint.elements
    .filter((item) => item.approved && item.visual_semantics?.repetition_group === grupo)
    .sort((a, b) => centroX(a) - centroX(b));
}

function minimoPorPieza(estructura: EstructuraPlan): number {
  const oficial = esEstructuraOficialId(estructura.estructura_oficial) ? estructura.estructura_oficial : undefined;
  return Math.max(estructura.materiales.length, oficial ? ESTRUCTURAS_OFICIALES[oficial].unidadesMinimasPorInstancia ?? 1 : 1);
}

function motivoParaNoSeparar(estructura: EstructuraPlan, totalSiSe: number): string | null {
  if (totalSiSe > MAX_PIEZAS_PLAN) return `pasaría de ${MAX_PIEZAS_PLAN} piezas`;
  if (UBICACIONES_UNICAS.has(estructura.ubicacion)) return `solo cabe una pieza en ${estructura.ubicacion}`;
  if (!esCuentaGeometrica(estructura)) {
    const unidades = estructura.unidades_declaradas ?? 0;
    if (Math.floor(unidades / estructura.repeticiones) < minimoPorPieza(estructura)) return "las unidades declaradas no alcanzan para cada pieza";
  }
  return null;
}

function idsNuevos(base: string, cuantos: number, usados: Set<string>): string[] {
  const ids = [base];
  for (let indice = 1; indice < cuantos; indice += 1) {
    let candidato = `${base}_${SUFIJOS[indice - 1] ?? "Z"}`;
    while (usados.has(candidato)) candidato = `${candidato}${SUFIJOS[indice - 1] ?? "Z"}`;
    usados.add(candidato);
    ids.push(candidato);
  }
  return ids;
}

function copiasDe(estructura: EstructuraPlan, blueprint: ReferenceBlueprintV2 | undefined, usados: Set<string>): EstructuraPlan[] {
  const cuantas = estructura.repeticiones;
  const ids = idsNuevos(estructura.estructura_id, cuantas, usados);
  const unidades = estructura.unidades_declaradas;
  const reparto = unidades === undefined ? null : Array.from({ length: cuantas }, (_, indice) => Math.floor(unidades / cuantas) + (indice < unidades % cuantas ? 1 : 0));
  // Con foto: la copia k es el k-ésimo elemento del grupo (de izquierda a derecha), con su propio conteo y colores.
  const delGrupo = grupoDeLaFoto(blueprint, estructura.referencia_element_id);
  const cabeza = delGrupo.findIndex((elemento) => elemento.element_id === estructura.referencia_element_id);
  const ordenFoto = cabeza < 0 ? [] : [delGrupo[cabeza]!, ...delGrupo.filter((_, indice) => indice !== cabeza)];
  const deUnPar = UBICACIONES_DE_PAR.has(estructura.ubicacion);
  const parFlanqueado = deUnPar && cuantas % 2 === 0;
  return ids.map((id, indice): EstructuraPlan => {
    const elemento = ordenFoto[indice];
    const ubicacion: Ubicacion = elemento && deUnPar
      ? (centroX(elemento) < 0.5 ? "lateral_izquierdo" : "lateral_derecho")
      : parFlanqueado ? (indice % 2 === 0 ? "lateral_izquierdo" : "lateral_derecho") : estructura.ubicacion;
    return {
      ...estructura,
      estructura_id: id,
      repeticiones: 1,
      ubicacion,
      ...(reparto ? { unidades_declaradas: reparto[indice]! } : {}),
      ...(elemento ? { referencia_element_id: elemento.element_id } : {}),
    };
  });
}

/**
 * Cada estructura con `repeticiones` N > 1 pasa a N estructuras de 1. La primera conserva su id; las demás reciben
 * `_B`, `_C`… (cumplen `^EST_\d{2}_[A-Z_]+$` y quedan a la derecha en `cajasDeEstructuras`). Una pareja en un lateral
 * o en la entrada queda una a cada lado; con foto, la copia k materializa el k-ésimo elemento de su grupo en espejo.
 * `unidades_declaradas` se reparte (piso + resto, primero las primeras). No se separa lo que no cabe (más de 8
 * piezas, una pared o un techo repetidos, unidades que no alcanzan): queda en `sinSeparar`. Idempotente.
 */
export function separarEstructurasRepetidas(plan: PlanDecoracion, blueprint?: ReferenceBlueprintV2): ResultadoSeparar {
  const usados = new Set(plan.estructuras.map((estructura) => estructura.estructura_id));
  const separadas: Separacion[] = [];
  const sinSeparar: SinSeparar[] = [];
  const estructuras: EstructuraPlan[] = [];
  let total = plan.estructuras.length;
  for (const estructura of plan.estructuras) {
    if (estructura.repeticiones <= 1) {
      estructuras.push(estructura);
      continue;
    }
    const motivo = motivoParaNoSeparar(estructura, total + estructura.repeticiones - 1);
    if (motivo) {
      sinSeparar.push({ estructura_id: estructura.estructura_id, repeticiones: estructura.repeticiones, motivo });
      estructuras.push(estructura);
      continue;
    }
    const copias = copiasDe(estructura, blueprint, usados);
    total += copias.length - 1;
    separadas.push({ origen: estructura.estructura_id, nuevas: copias.slice(1).map((copia) => copia.estructura_id) });
    estructuras.push(...copias);
  }
  const nombrado = nombrarPiezasIndividuales({ ...plan, estructuras });
  return { plan: nombrado.plan, separadas, sinSeparar, renombradas: nombrado.renombradas };
}

/**
 * Nombres individuales que pone el servidor: dos piezas iguales con lado son la izquierda y la derecha (por su
 * ubicación; si las dos están en el mismo lado o en la entrada, la primera pasa a la izquierda y la segunda a la
 * derecha), y tres o más, o dos sin lado, van numeradas en el orden del plan. Una pieza única conserva su nombre.
 * Un grupo con alguna pieza repetida (que no se pudo separar) no se renombra.
 */
export function nombrarPiezasIndividuales(plan: PlanDecoracion): { plan: PlanDecoracion; renombradas: Renombrada[] } {
  const grupos = new Map<EstructuraOficialId, number[]>();
  for (const [indice, estructura] of plan.estructuras.entries()) {
    if (!esEstructuraOficialId(estructura.estructura_oficial)) continue;
    grupos.set(estructura.estructura_oficial, [...(grupos.get(estructura.estructura_oficial) ?? []), indice]);
  }
  const cambios = new Map<number, { nombre: string; ubicacion?: Ubicacion }>();
  for (const [oficial, indices] of grupos) {
    if (indices.length < 2 || indices.some((indice) => plan.estructuras[indice]!.repeticiones > 1)) continue;
    if (indices.length === 2 && PIEZAS_CON_LADO.has(oficial)) {
      const [a, b] = indices.map((indice) => plan.estructuras[indice]!) as [EstructuraPlan, EstructuraPlan];
      if (esLateral(a.ubicacion) && esLateral(b.ubicacion) && a.ubicacion !== b.ubicacion) {
        const nombres = nombresIndividuales(oficial, 2, [LADO_DE_LATERAL[a.ubicacion], LADO_DE_LATERAL[b.ubicacion]]);
        cambios.set(indices[0]!, { nombre: nombres[0]! });
        cambios.set(indices[1]!, { nombre: nombres[1]! });
        continue;
      }
      if (a.ubicacion === b.ubicacion) {
        const nombres = nombresIndividuales(oficial, 2);
        if (UBICACIONES_DE_PAR.has(a.ubicacion)) {
          cambios.set(indices[0]!, { nombre: nombres[0]!, ubicacion: "lateral_izquierdo" });
          cambios.set(indices[1]!, { nombre: nombres[1]!, ubicacion: "lateral_derecho" });
        } else {
          // Misma ubicación centrada: `cajasDeEstructuras` parte la caja por id, el menor a la izquierda.
          const [izquierda, derecha] = a.estructura_id.localeCompare(b.estructura_id) <= 0 ? indices : [indices[1]!, indices[0]!];
          cambios.set(izquierda!, { nombre: nombres[0]! });
          cambios.set(derecha!, { nombre: nombres[1]! });
        }
        continue;
      }
    }
    const nombres = Array.from({ length: indices.length }, (_, posicion) => `${ESTRUCTURAS_OFICIALES[oficial].nombre} ${posicion + 1}`);
    indices.forEach((indice, posicion) => cambios.set(indice, { nombre: nombres[posicion]! }));
  }
  if (!cambios.size) return { plan, renombradas: [] };
  const renombradas: Renombrada[] = [];
  const estructuras = plan.estructuras.map((estructura, indice) => {
    const cambio = cambios.get(indice);
    if (!cambio || (cambio.nombre === estructura.nombre && (!cambio.ubicacion || cambio.ubicacion === estructura.ubicacion))) return estructura;
    renombradas.push({ estructura_id: estructura.estructura_id, antes: estructura.nombre, despues: cambio.nombre, ...(cambio.ubicacion ? { ubicacion: cambio.ubicacion } : {}) });
    return { ...estructura, nombre: cambio.nombre, ...(cambio.ubicacion ? { ubicacion: cambio.ubicacion } : {}) };
  });
  return { plan: { ...plan, estructuras }, renombradas };
}

// --- Parejas simétricas -------------------------------------------------------------------------------------------

/**
 * Dos piezas que salen de UNA línea de la propuesta («2 × Columna») son la izquierda y la derecha de la misma pieza y
 * van iguales. Verificador (2026-10-06, guiada-20261006-231824-v43qux): la propuesta solo traía los colores del plan
 * entero y el modelo los repartió, y la columna izquierda salió dorada y fucsia y la derecha rosada y oro rosa.
 * La instrucción de la guiada declara cada pareja con esta línea (con ids, nunca con nombres numerados) y
 * `confirmar_plan_decoracion` la lee de la solicitud y la hace cumplir con `igualarParejas` antes de resolver.
 */
const PREFIJO_PAREJA = "Pareja simétrica:";
const PAREJA = /Pareja simétrica: (EST_\d{2}_[A-Z_]+) y (EST_\d{2}_[A-Z_]+)/g;

export function lineaPareja(izquierda: string, derecha: string): string {
  return `${PREFIJO_PAREJA} ${izquierda} y ${derecha} van a los dos lados y son iguales: llevan exactamente los mismos materiales (mismo product_id y misma participacion por color), las mismas medidas, la misma densidad y la misma mezcla.`;
}

/** Las parejas que declaró la instrucción de la guiada (vacío en cualquier otro texto). */
export function parejasDeInstruccion(texto: string): Array<[string, string]> {
  return [...texto.matchAll(PAREJA)].map((coincidencia) => [coincidencia[1]!, coincidencia[2]!]);
}

/** Las piezas que la propuesta declara pareja: las dos individuales de una misma línea de cantidad 2 con lado. */
export function parejasDePropuesta(individuales: readonly PiezaIndividual[], origen: readonly number[]): Array<[PiezaIndividual, PiezaIndividual]> {
  const porOrigen = new Map<number, PiezaIndividual[]>();
  individuales.forEach((pieza, indice) => {
    const linea = origen[indice];
    if (linea === undefined) return;
    porOrigen.set(linea, [...(porOrigen.get(linea) ?? []), pieza]);
  });
  const parejas: Array<[PiezaIndividual, PiezaIndividual]> = [];
  for (const piezas of porOrigen.values()) {
    if (piezas.length !== 2) continue;
    const [a, b] = piezas as [PiezaIndividual, PiezaIndividual];
    if (a.estructura !== b.estructura || !PIEZAS_CON_LADO.has(a.estructura) || !a.ubicacion || !b.ubicacion || a.ubicacion === b.ubicacion) continue;
    parejas.push(a.ubicacion === "lateral_izquierdo" ? [a, b] : [b, a]);
  }
  return parejas;
}

export type Igualada = { piezas: [string, string]; modo: "copia" | "union"; desde: string | null; copiado: string[] };
export type NoIgualada = { izquierda: string; derecha: string; motivo: string };

function claveColor(material: EstructuraPlan["materiales"][number]): string {
  return (material.color ?? material.product_id).trim().toLocaleLowerCase("es");
}

function colores(estructura: EstructuraPlan): Set<string> {
  return new Set(estructura.materiales.map(claveColor));
}

function contiene(mayor: Set<string>, menor: Set<string>): boolean {
  return [...menor].every((color) => mayor.has(color));
}

const tieneArmado = (estructura: EstructuraPlan) => Boolean(estructura.armado_arco || estructura.armado_arco_organico || estructura.armado_columna || estructura.armado_columna_organica || estructura.armado_guirnalda || estructura.armado_guirnalda_organica || estructura.armado_bouquet);

/** Materiales máximos de una pieza (`EstructuraPlanSchema.materiales.max(6)`). */
const MAX_MATERIALES = 6;

/**
 * Los materiales de las dos piezas juntos: cada color una vez (con el producto de la izquierda si las dos lo tienen) y
 * su parte, la media de las dos (cada pieza suma 1, así que la unión también). El de mayor parte es el principal.
 */
function unionDeMateriales(a: EstructuraPlan, b: EstructuraPlan): EstructuraPlan["materiales"] | null {
  const porColor = new Map<string, { material: EstructuraPlan["materiales"][number]; parte: number }>();
  for (const material of [...a.materiales, ...b.materiales]) {
    const clave = claveColor(material);
    const previo = porColor.get(clave);
    if (previo) previo.parte += material.participacion / 2;
    else porColor.set(clave, { material, parte: material.participacion / 2 });
  }
  if (porColor.size > MAX_MATERIALES) return null;
  const lista = [...porColor.values()];
  const mayor = lista.reduce((indice, actual, posicion) => (actual.parte > lista[indice]!.parte ? posicion : indice), 0);
  return lista.map(({ material, parte }, posicion) => ({
    ...material,
    participacion: Math.round(parte * 10_000) / 10_000,
    rol_material: posicion === mayor ? "principal" as const : parte >= 0.2 ? "secundario" as const : "acento" as const,
  }));
}

/**
 * Hace iguales las parejas declaradas. Si los colores de una pieza están todos en la otra, la que los tiene todos (la
 * izquierda si son los mismos) presta a la otra sus materiales, medidas, densidad, mezcla y patrón; si el modelo los
 * repartió (izquierda dorado y fucsia, derecha rosado y oro rosa), las dos llevan todos los colores con la parte media
 * de cada uno, sin quitar ninguno del plan. No toca lo que no es seguro tocar: una pieza de la foto
 * (`referencia_element_id`, sus colores son los de su elemento), una con armado guardado o una unión de más de 6
 * colores. Python sigue contando.
 */
export function igualarParejas(plan: PlanDecoracion, parejas: ReadonlyArray<readonly [string, string]>): { plan: PlanDecoracion; igualadas: Igualada[]; noIgualadas: NoIgualada[] } {
  const igualadas: Igualada[] = [];
  const noIgualadas: NoIgualada[] = [];
  let estructuras = plan.estructuras;
  const igual = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  for (const [idA, idB] of parejas) {
    const a = estructuras.find((estructura) => estructura.estructura_id === idA);
    const b = estructuras.find((estructura) => estructura.estructura_id === idB);
    if (!a || !b) continue;
    const pareja = { izquierda: idA, derecha: idB };
    if (a.referencia_element_id || b.referencia_element_id) { noIgualadas.push({ ...pareja, motivo: "pieza de la foto" }); continue; }
    if (tieneArmado(a) || tieneArmado(b)) { noIgualadas.push({ ...pareja, motivo: "pieza con armado guardado" }); continue; }
    const coloresA = colores(a);
    const coloresB = colores(b);
    const contenedora = contiene(coloresA, coloresB) ? a : contiene(coloresB, coloresA) ? b : null;
    let modelo: EstructuraPlan;
    if (contenedora) modelo = contenedora;
    else {
      const union = unionDeMateriales(a, b);
      if (!union) { noIgualadas.push({ ...pareja, motivo: `más de ${MAX_MATERIALES} colores entre las dos` }); continue; }
      modelo = { ...a, materiales: union };
    }
    const copiado = new Set<string>();
    const igualar = (pieza: EstructuraPlan): EstructuraPlan => {
      const cambios: string[] = [];
      if (!igual(modelo.materiales, pieza.materiales)) cambios.push("materiales");
      if (!igual(modelo.medidas, pieza.medidas)) cambios.push("medidas");
      if (modelo.densidad !== pieza.densidad) cambios.push("densidad");
      if (modelo.mezcla !== pieza.mezcla) cambios.push("mezcla");
      if (!igual(modelo.patron_color, pieza.patron_color)) cambios.push("patron_color");
      if (!cambios.length) return pieza;
      for (const cambio of cambios) copiado.add(cambio);
      const nueva: EstructuraPlan = {
        ...pieza,
        materiales: modelo.materiales.map((material) => ({ ...material })),
        medidas: { ...modelo.medidas },
        densidad: modelo.densidad,
        mezcla: modelo.mezcla,
      };
      if (modelo.patron_color) nueva.patron_color = modelo.patron_color;
      else delete nueva.patron_color;
      const coloresModelo = [...new Set(modelo.materiales.map((material) => material.color).filter((color): color is string => Boolean(color)))];
      if (pieza.colores_referencia) nueva.colores_referencia = coloresModelo.slice(0, 8);
      return nueva;
    };
    const nuevaA = igualar(a);
    const nuevaB = igualar(b);
    if (nuevaA === a && nuevaB === b) continue;
    estructuras = estructuras.map((estructura) => (estructura.estructura_id === idA ? nuevaA : estructura.estructura_id === idB ? nuevaB : estructura));
    igualadas.push({ piezas: [idA, idB], modo: contenedora ? "copia" : "union", desde: contenedora?.estructura_id ?? null, copiado: [...copiado] });
  }
  return { plan: igualadas.length ? { ...plan, estructuras } : plan, igualadas, noIgualadas };
}

/** «izquierda» o «derecha» de una pieza por su ubicación (para el chat y la tarjeta), o null. */
export function ladoDeUbicacion(ubicacion: string | undefined): Lado | null {
  return esLateral(ubicacion) ? LADO_DE_LATERAL[ubicacion] : null;
}
