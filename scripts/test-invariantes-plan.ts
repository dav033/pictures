/**
 * Invariantes cruzadas del plan sobre TODOS los vectores golden.
 *
 * Los vectores de `contracts/domain/v1/golden/plan-resolution` bloquean la
 * salida exacta de cada resolutor (`plan:test-paridad`, `plan:test-paridad-python`),
 * pero un valor bloqueado solo dice "esto no cambió", no "esto cuadra". Después
 * de fusionar cuatro frentes que tocan conteo, color, prompting del plan y
 * prompt de imagen, lo que hace falta es la comprobación transversal: que las
 * líneas, el despiece, las compras, el estimado, la cotización y los bloques del
 * prompt de imagen cuenten la misma historia en cada vector.
 *
 * Invariantes (una por superficie, con mensaje por vector y por estructura):
 *
 *   a) líneas ↔ estructura: la suma de `linea.unidades` es `total_unidades`,
 *      `mezcla_real` cuadra con las líneas que tienen diámetro y sus totales
 *      por tamaño respetan la mezcla efectiva dentro de la tolerancia del
 *      reparto (ADR 0022).
 *   b) plan ↔ estimado: las cantidades de diseño del estimado (globos +
 *      elementos especiales) suman lo mismo que las unidades de las líneas.
 *   c) compras: `purchase_quantity >= required_quantity` en cada compra y los
 *      totales recalculados por `validateMaterialEstimate` coinciden.
 *   d) cotización: el total es la suma de sus líneas y es el costo de compra
 *      del estimado, línea por línea.
 *   e) bloque de tamaños del prompt (`bloqueMezclaPorEstructura`): la cantidad
 *      por instancia × `repeticiones` es la de la estructura y los porcentajes
 *      suman 100.
 *   f) color del prompt de imagen: cada color no nulo de una línea está en los
 *      colores de SU estructura en la escena y en su línea de color del prompt
 *      (`verificarCoherenciaPrompt`, el dueño de esa regla). La escena se arma
 *      con la cadena de producción entera, colores incluidos: salen de
 *      `resolverProductosParaGeneracion`, no de una regla propia de la prueba.
 *
 * Un vector cuya forma no admite una invariante se OMITE con la razón impresa
 * (una estructura sin geometría no tiene mezcla efectiva; un vector sin
 * cobertura no tiene producto de catálogo con el que armar la escena). Todo lo
 * demás falla ruidosamente.
 *
 * Determinista y sin red: el catálogo del vector entra por el mismo doble del
 * `Pool` que usa `scripts/test-paridad-plan-python.ts` (`scripts/lib/vectores-golden.ts`).
 * Run: npx tsx --conditions=react-server scripts/test-invariantes-plan.ts
 */
import { bloqueMezclaPorEstructura } from "@/lib/ia/tamano-fisico";
import { cotizarPlan, type Cotizacion } from "@/lib/cotizacion/motor";
import { estimateFromPlan, validateMaterialEstimate, type DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { calcularDespieceEstructura, proporcionesEfectivas, tamanosObligatorios } from "@/lib/medidas/geometria";
import { verificarCoherenciaPrompt } from "@/lib/plan/coherencia";
import type { EstructuraResuelta, PlanResuelto } from "@/lib/plan/resuelto";
import { coloresDeProduccionPorVariante, escenaDeVector } from "./lib/escena-de-vector";
import { loadVectors, resolverVector, type GoldenVector } from "./lib/vectores-golden";

/**
 * Tolerancia del margen de tamaños (ADR 0022): UN globo por instancia.
 *
 * `repartirHamilton` deja cada cuota en su piso o en su piso + 1, así que el
 * total por tamaño de una instancia se desvía menos de un globo de su cuota
 * exacta, y el despiece multiplica cada celda por `repeticiones`. Por eso la
 * comparación se hace por instancia y no sobre el total: con la cota flojo de
 * `repeticiones` globos, una pieza repetida seis veces escondería justo el
 * defecto D2 (un solo Hamilton sobre celdas, que conserva el total pero pierde
 * el margen de tamaños y borra los acentos R-18/R-24 al añadir un color).
 * No es un margen elegido a ojo: es la cota del método de reparto.
 */
const TOLERANCIA_TAMANO_POR_INSTANCIA = 1;

/** Suma con nombres, para que el mensaje de fallo diga de dónde sale cada lado. */
function suma(valores: readonly number[]): number {
  return valores.reduce((total, valor) => total + valor, 0);
}

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

type Informe = {
  /** Fallos reales: cada uno tumba la suite. */
  errores: string[];
  /** Invariantes que este vector no admite, con la razón. */
  omisiones: string[];
};

function comprobar(informe: Informe, condicion: boolean, mensaje: string): void {
  if (!condicion) informe.errores.push(mensaje);
}

// ---------------------------------------------------------------------------
// (a) líneas ↔ estructura ↔ mezcla efectiva
// ---------------------------------------------------------------------------

function invarianteEstructuras(vector: GoldenVector, plan: PlanResuelto, informe: Informe): void {
  const etiqueta = vector.name;
  const tamanosDelCliente = tamanosObligatorios(plan.plan.restricciones);
  const sinCoberturaPorEstructura = new Set(plan.sin_cobertura.map((hueco) => hueco.estructura_id));

  for (const estructura of plan.estructuras) {
    const donde = `${etiqueta} / ${estructura.estructura_id}`;
    const unidadesDeLineas = suma(estructura.lineas.map((linea) => linea.unidades));
    comprobar(
      informe,
      unidadesDeLineas === estructura.total_unidades,
      `${donde}: la suma de las líneas (${unidadesDeLineas}) no es total_unidades (${estructura.total_unidades})`,
    );

    const conDiametro = suma(estructura.lineas.filter((linea) => linea.diam_pulg != null).map((linea) => linea.unidades));
    const enMezcla = suma(estructura.mezcla_real.map((fila) => fila.unidades));
    comprobar(
      informe,
      enMezcla === conDiametro,
      `${donde}: mezcla_real suma ${enMezcla} y las líneas con diámetro suman ${conDiametro}`,
    );
    for (const fila of estructura.mezcla_real) {
      const esperado = estructura.total_unidades
        ? Number(((fila.unidades / estructura.total_unidades) * 100).toFixed(2))
        : 0;
      comprobar(
        informe,
        fila.pct === esperado,
        `${donde}: el pct de R-${fila.diam_pulg} es ${fila.pct} y sus ${fila.unidades} de ${estructura.total_unidades} dan ${esperado}`,
      );
    }

    invarianteMezclaEfectiva(vector, plan, estructura, tamanosDelCliente, sinCoberturaPorEstructura, informe);
  }
}

function invarianteMezclaEfectiva(
  vector: GoldenVector,
  plan: PlanResuelto,
  estructura: EstructuraResuelta,
  tamanosDelCliente: readonly number[],
  sinCobertura: ReadonlySet<string>,
  informe: Informe,
): void {
  const donde = `${vector.name} / ${estructura.estructura_id}`;
  // `eje_m` es el marcador de estructura geométrica que ya usa `estimateFromPlan`:
  // un kit, un backdrop o una escultura no tienen mezcla efectiva que comprobar.
  if (estructura.eje_m == null) {
    informe.omisiones.push(`${donde}: sin mezcla efectiva (${estructura.tipo} no es geométrica)`);
    return;
  }
  if (sinCobertura.has(estructura.estructura_id)) {
    informe.omisiones.push(`${donde}: sin mezcla efectiva (la whitelist dejó celdas del despiece sin variante)`);
    return;
  }
  const declarada = plan.plan.estructuras.find((item) => item.estructura_id === estructura.estructura_id);
  if (!declarada) {
    informe.errores.push(`${donde}: la estructura resuelta no existe en el plan declarado`);
    return;
  }

  const geometria = calcularDespieceEstructura({
    tipo: declarada.tipo as Parameters<typeof calcularDespieceEstructura>[0]["tipo"],
    medidas: { anchoM: declarada.medidas.ancho_m, altoM: declarada.medidas.alto_m, largoM: declarada.medidas.largo_m },
    repeticiones: declarada.repeticiones,
    densidad: declarada.densidad,
    mezcla: declarada.mezcla,
    tamanos: [...tamanosDelCliente],
    materiales: declarada.materiales.map((material) => ({ color: material.color, participacion: material.participacion ?? 0 })),
    estructuraOficial: declarada.estructura_oficial,
  });
  comprobar(
    informe,
    geometria.totalGlobos === estructura.total_unidades,
    `${donde}: el despiece pide ${geometria.totalGlobos} globos y la estructura resolvió ${estructura.total_unidades}`,
  );

  const { proporciones } = proporcionesEfectivas(declarada.mezcla, tamanosDelCliente);
  const pedidoPorTamano = new Map<number, number>();
  for (const linea of geometria.despiece) {
    pedidoPorTamano.set(linea.pulgadas, (pedidoPorTamano.get(linea.pulgadas) ?? 0) + linea.cantidad);
  }
  const repeticiones = Math.max(1, Math.round(declarada.repeticiones));
  for (const proporcion of proporciones) {
    const real = pedidoPorTamano.get(proporcion.pulgadas) ?? 0;
    comprobar(
      informe,
      real % repeticiones === 0,
      `${donde}: R-${proporcion.pulgadas} recibió ${real} globos, que no es múltiplo de las ${repeticiones} repeticiones (el reparto es por instancia)`,
    );
    const porInstancia = real / repeticiones;
    const exactoPorInstancia = (geometria.totalGlobos / repeticiones) * proporcion.proporcion;
    comprobar(
      informe,
      Math.abs(porInstancia - exactoPorInstancia) < TOLERANCIA_TAMANO_POR_INSTANCIA + 1e-9,
      `${donde}: R-${proporcion.pulgadas} recibe ${porInstancia} globos por instancia y la mezcla efectiva pide ${exactoPorInstancia.toFixed(3)} (tolerancia ${TOLERANCIA_TAMANO_POR_INSTANCIA} globo)`,
    );
  }

  // Los tamaños entregados solo tienen que ser los pedidos cuando la whitelist
  // tenía el diámetro exacto: una sustitución admisible mueve unidades a otro
  // diámetro a propósito y `linea.sustitucion` es su registro.
  if (estructura.lineas.some((linea) => linea.sustitucion)) {
    informe.omisiones.push(`${donde}: sin comparación pedido↔entregado por tamaño (la estructura tiene sustituciones admisibles)`);
    return;
  }
  const entregadoPorTamano = new Map<number, number>();
  for (const fila of estructura.mezcla_real) {
    entregadoPorTamano.set(fila.diam_pulg, (entregadoPorTamano.get(fila.diam_pulg) ?? 0) + fila.unidades);
  }
  for (const [pulgadas, pedido] of pedidoPorTamano) {
    if (pedido === 0) continue;
    const entregado = entregadoPorTamano.get(pulgadas) ?? 0;
    comprobar(
      informe,
      entregado === pedido,
      `${donde}: el despiece pide ${pedido} globos de R-${pulgadas} y las líneas entregan ${entregado}`,
    );
  }
  for (const [pulgadas, entregado] of entregadoPorTamano) {
    comprobar(
      informe,
      (pedidoPorTamano.get(pulgadas) ?? 0) > 0,
      `${donde}: las líneas entregan ${entregado} globos de R-${pulgadas}, que el despiece no pidió`,
    );
  }
}

// ---------------------------------------------------------------------------
// (b) plan ↔ estimado  ·  (c) compras  ·  (d) cotización
// ---------------------------------------------------------------------------

function invarianteEstimado(vector: GoldenVector, plan: PlanResuelto, estimate: DesignMaterialEstimate, informe: Informe): void {
  const donde = vector.name;
  const unidadesPlan = suma(plan.estructuras.map((estructura) => estructura.total_unidades));
  const unidadesEstimado = suma([...estimate.balloons, ...estimate.special_elements].map((linea) => linea.design_quantity));
  comprobar(
    informe,
    unidadesEstimado === unidadesPlan,
    `${donde}: el estimado instala ${unidadesEstimado} unidades (globos + elementos especiales) y las líneas del plan suman ${unidadesPlan}`,
  );
  comprobar(
    informe,
    estimate.totals.design_quantity === unidadesPlan,
    `${donde}: totals.design_quantity es ${estimate.totals.design_quantity} y las líneas del plan suman ${unidadesPlan}`,
  );
  if (plan.props?.length) {
    // `estimateFromPlan` solo recorre `plan.estructuras`; los props de catálogo
    // (Plan 1.1) son otra superficie y no entran en esta comparación.
    informe.omisiones.push(`${donde}: los ${plan.props.length} prop(s) de catálogo quedan fuera de la comparación plan↔estimado`);
  }
}

function invarianteCompras(vector: GoldenVector, estimate: DesignMaterialEstimate, informe: Informe): void {
  const donde = vector.name;
  for (const compra of estimate.purchases) {
    comprobar(
      informe,
      compra.purchase_quantity >= compra.required_quantity,
      `${donde} / ${compra.variant_id}: se compran ${compra.purchase_quantity} unidades y hacen falta ${compra.required_quantity}`,
    );
    comprobar(
      informe,
      compra.purchase_quantity === compra.package_count * compra.units_per_package,
      `${donde} / ${compra.variant_id}: ${compra.package_count} paquetes de ${compra.units_per_package} no dan ${compra.purchase_quantity} unidades`,
    );
  }
  const validacion = validateMaterialEstimate(estimate);
  comprobar(
    informe,
    validacion.ok,
    `${donde}: validateMaterialEstimate no cuadra: ${validacion.errors.join("; ")}`,
  );
}

function invarianteCotizacion(vector: GoldenVector, quote: Cotizacion, estimate: DesignMaterialEstimate, informe: Informe): void {
  const donde = vector.name;
  const sumaSubtotales = suma(quote.lineas.map((linea) => linea.subtotal ?? 0));
  comprobar(informe, quote.total === sumaSubtotales, `${donde}: el total de la cotización es ${quote.total} y sus líneas suman ${sumaSubtotales}`);
  comprobar(
    informe,
    quote.total === estimate.totals.purchase_cost,
    `${donde}: el total de la cotización es ${quote.total} y el costo de compra del estimado es ${estimate.totals.purchase_cost}`,
  );
  comprobar(
    informe,
    quote.purchaseCost === estimate.totals.purchase_cost,
    `${donde}: purchaseCost de la cotización es ${quote.purchaseCost} y el del estimado es ${estimate.totals.purchase_cost}`,
  );
  comprobar(
    informe,
    quote.lineas.length === estimate.purchases.length,
    `${donde}: la cotización tiene ${quote.lineas.length} líneas y el estimado ${estimate.purchases.length} compras`,
  );
  for (const linea of quote.lineas) {
    const compra = estimate.purchases.find((item) => item.variant_id === linea.varianteId);
    if (!compra) {
      informe.errores.push(`${donde} / ${linea.varianteId ?? linea.id}: la línea cotizada no tiene compra en el estimado`);
      continue;
    }
    comprobar(
      informe,
      linea.subtotal === compra.purchase_cost,
      `${donde} / ${compra.variant_id}: la línea cotiza ${linea.subtotal} y la compra del estimado cuesta ${compra.purchase_cost}`,
    );
  }
}

// ---------------------------------------------------------------------------
// (e) bloque de tamaños del prompt
// ---------------------------------------------------------------------------

const CABECERA_UNICA = /^"(?:.+)", (\d+) balloons total:$/;
const CABECERA_REPETIDA = /^"(?:.+)": (\d+) separate identical structures, (\d+)(?:-(\d+))? balloons each \((\d+) total across (?:both|all \d+)\):$/;
const FILA = /^- (\d+)(?:-(\d+))? balloons(?: each)? \((\d+)%\): (\d+(?:\.\d+)?)-inch/;

/**
 * Comprueba el bloque de UNA estructura. Se llama por estructura a propósito:
 * con una sola estructura `bloqueMezclaPorEstructura` no añade la ubicación
 * para desambiguar nombres homónimos, así que la cabecera es siempre la misma
 * forma y lo que se comprueba son las cantidades, no el desambiguador (eso ya
 * lo cubre `plan:test-color-prompt`).
 */
function invarianteBloqueTamanos(vector: GoldenVector, estructura: EstructuraResuelta, informe: Informe): void {
  const donde = `${vector.name} / ${estructura.estructura_id}`;
  if (estructura.mezcla_real.length === 0) {
    informe.omisiones.push(`${donde}: sin bloque de tamaños (la estructura no compró ningún globo con diámetro)`);
    return;
  }
  const repeticiones = Math.max(1, Math.round(estructura.repeticiones));
  const bloque = bloqueMezclaPorEstructura([{
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    mezcla_real: estructura.mezcla_real.map((fila) => ({ diamPulg: fila.diam_pulg, forma: fila.forma, unidades: fila.unidades })),
  }]);
  if (!bloque) {
    informe.errores.push(`${donde}: bloqueMezclaPorEstructura no emitió bloque para una estructura con ${estructura.mezcla_real.length} tamaño(s)`);
    return;
  }
  const lineas = bloque.split("\n");

  const cabecera = lineas.find((linea) => CABECERA_UNICA.test(linea) || CABECERA_REPETIDA.test(linea));
  if (!cabecera) {
    informe.errores.push(`${donde}: el bloque no trae una cabecera reconocible:\n${bloque}`);
    return;
  }
  const unica = CABECERA_UNICA.exec(cabecera);
  if (unica) {
    comprobar(
      informe,
      repeticiones === 1,
      `${donde}: la cabecera es de una sola pieza y la estructura tiene ${repeticiones} repeticiones`,
    );
    comprobar(
      informe,
      Number(unica[1]) === estructura.total_unidades,
      `${donde}: la cabecera anuncia ${unica[1]} globos y la estructura instala ${estructura.total_unidades}`,
    );
  } else {
    const repetida = CABECERA_REPETIDA.exec(cabecera)!;
    comprobar(
      informe,
      Number(repetida[1]) === repeticiones,
      `${donde}: la cabecera anuncia ${repetida[1]} piezas y la estructura tiene ${repeticiones} repeticiones`,
    );
    comprobar(
      informe,
      Number(repetida[4]) === estructura.total_unidades,
      `${donde}: la cabecera anuncia ${repetida[4]} globos en total y la estructura instala ${estructura.total_unidades}`,
    );
    comprobarRango(informe, `${donde} (cabecera)`, Number(repetida[2]), repetida[3] == null ? undefined : Number(repetida[3]), repeticiones, estructura.total_unidades);
  }

  const filas = lineas.map((linea) => FILA.exec(linea)).filter((encontrado): encontrado is RegExpExecArray => encontrado !== null);
  const ordenadas = estructura.mezcla_real.slice().sort((a, b) => b.unidades - a.unidades || b.diam_pulg - a.diam_pulg);
  if (filas.length !== ordenadas.length) {
    informe.errores.push(`${donde}: el bloque trae ${filas.length} fila(s) y la mezcla real tiene ${ordenadas.length}:\n${bloque}`);
    return;
  }
  for (const [indice, fila] of filas.entries()) {
    const esperada = ordenadas[indice]!;
    comprobar(
      informe,
      Number(fila[4]) === esperada.diam_pulg,
      `${donde}: la fila ${indice + 1} del bloque dice R-${fila[4]} y la mezcla real, en ese orden, dice R-${esperada.diam_pulg}`,
    );
    comprobarRango(informe, `${donde} (R-${esperada.diam_pulg})`, Number(fila[1]), fila[2] == null ? undefined : Number(fila[2]), repeticiones, esperada.unidades);
  }
  const porcentajes = suma(filas.map((fila) => Number(fila[3])));
  comprobar(informe, porcentajes === 100, `${donde}: los porcentajes del bloque suman ${porcentajes}, no 100`);
}

/**
 * La cantidad "por instancia" del bloque es `N` o el rango `N-N+1` (piso y
 * techo del reparto entre instancias). Lo que se comprueba es que multiplicada
 * por `repeticiones` contenga las unidades reales, y que el rango no sea más
 * ancho de un globo.
 */
function comprobarRango(informe: Informe, donde: string, piso: number, techo: number | undefined, repeticiones: number, unidades: number): void {
  const alto = techo ?? piso;
  comprobar(informe, alto - piso <= 1, `${donde}: el rango por instancia ${piso}-${alto} abarca más de un globo`);
  comprobar(
    informe,
    piso * repeticiones <= unidades && unidades <= alto * repeticiones,
    `${donde}: ${piso}${techo == null ? "" : `-${techo}`} globos por instancia × ${repeticiones} no contiene las ${unidades} unidades de la estructura`,
  );
  // Una cantidad exacta por instancia solo puede anunciarse cuando el reparto
  // es exacto; si no, el bloque tiene que decir el rango o le está prometiendo
  // al modelo de imagen una densidad que ninguna instancia tendrá.
  comprobar(
    informe,
    unidades % repeticiones === 0 || techo != null,
    `${donde}: ${unidades} unidades no se reparten exactas entre ${repeticiones} instancias y el bloque anuncia ${piso} por instancia sin rango`,
  );
}

// ---------------------------------------------------------------------------
// (f) color del prompt de imagen
// ---------------------------------------------------------------------------

/**
 * La escena y el prompt se arman con la cadena de producción completa
 * (`scripts/lib/escena-de-vector.ts`), colores incluidos: `catalogProducts` se
 * llena con lo que devuelve `resolverProductosParaGeneracion`, igual que en
 * `/api/generate`. Una regla de color propia de la prueba dejaba pasar en verde
 * un prompt que producción sí rompía (vectores 19 y 25).
 */
async function invarianteColorPrompt(vector: GoldenVector, plan: PlanResuelto, estimate: DesignMaterialEstimate, informe: Informe): Promise<void> {
  const donde = vector.name;
  const sinLineas = plan.estructuras.filter((estructura) => estructura.lineas.length === 0);
  if (sinLineas.length > 0) {
    informe.omisiones.push(
      `${donde}: sin prompt de imagen (${sinLineas.map((estructura) => estructura.estructura_id).join(", ")} no compró nada, así que la escena no tiene producto de catálogo)`,
    );
    return;
  }

  const colores = await coloresDeProduccionPorVariante(vector.catalog_rows);
  const { prompt, coherencia: escenaCoherencia } = escenaDeVector(plan, estimate, colores);

  // El dueño de la regla estructural de color es `verificarCoherenciaPrompt`:
  // comprueba que cada estructura esté nombrada, que cada diámetro comprado
  // aparezca con su descripción física y que la línea de color de cada elemento
  // liste exactamente sus colores.
  const coherencia = verificarCoherenciaPrompt(prompt, plan, escenaCoherencia);
  comprobar(informe, coherencia.ok, `${donde}: el prompt de imagen no es coherente con el plan: ${coherencia.errores.join(" | ")}`);

  // Y el enunciado literal de la invariante, que no depende de que la escena
  // tenga un elemento por estructura: ningún color comprado puede desaparecer.
  for (const estructura of plan.estructuras) {
    const elementos = escenaCoherencia.elementos.filter((elemento) => elemento.estructura_id === estructura.estructura_id);
    const enEscena = new Set(elementos.flatMap((elemento) => elemento.resolved_colors).map(plegar));
    for (const color of new Set(estructura.lineas.map((linea) => linea.color).filter((color): color is string => Boolean(color)))) {
      comprobar(
        informe,
        enEscena.has(plegar(color)),
        `${vector.name} / ${estructura.estructura_id}: la línea compra ${color} y los colores de la estructura en el prompt son [${[...enEscena].join(", ")}]`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const vectores = loadVectors();
  if (vectores.length === 0) throw new Error("No hay vectores golden que comprobar");

  const errores: string[] = [];
  let omitidas = 0;
  for (const { vector } of vectores) {
    const informe: Informe = { errores: [], omisiones: [] };
    const plan = await resolverVector(vector);
    const estimate = estimateFromPlan(plan);
    const quote = cotizarPlan(plan);

    invarianteEstructuras(vector, plan, informe);
    invarianteEstimado(vector, plan, estimate, informe);
    invarianteCompras(vector, estimate, informe);
    invarianteCotizacion(vector, quote, estimate, informe);
    for (const estructura of plan.estructuras) invarianteBloqueTamanos(vector, estructura, informe);
    await invarianteColorPrompt(vector, plan, estimate, informe);

    for (const razon of informe.omisiones) console.log(`[OMITIDA] ${razon}`);
    omitidas += informe.omisiones.length;
    if (informe.errores.length === 0) {
      console.log(`[PASS] ${vector.name}`);
      continue;
    }
    for (const error of informe.errores) console.log(`[FAIL] ${error}`);
    errores.push(...informe.errores);
  }

  console.log(`\n${vectores.length} vector(es), ${omitidas} invariante(s) omitida(s) con razón, ${errores.length} fallo(s).`);
  if (errores.length > 0) throw new Error(`${errores.length} invariante(s) rota(s) en los vectores golden.`);
}

main().catch((error: unknown) => {
  console.error("[FAIL] invariantes del plan", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
