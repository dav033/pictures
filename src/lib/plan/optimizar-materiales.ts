export type OpcionPaquete = {
  variantId: string;
  unidadesPaquete: number;
  precio: number;
  minPaquetes?: number;
};

export type CompraOptimizada = OpcionPaquete & { paquetes: number; capacidad: number };

export type ResultadoCobertura = {
  unidadesObjetivo: number;
  unidadesConMerma: number;
  costo: number;
  sobrante: number;
  paquetes: number;
  compras: CompraOptimizada[];
};

function comparar(a: ResultadoCobertura, b: ResultadoCobertura): number {
  return a.costo - b.costo
    || a.sobrante - b.sobrante
    || a.paquetes - b.paquetes
    || a.compras.map((item) => item.variantId).join("|").localeCompare(b.compras.map((item) => item.variantId).join("|"));
}

/**
 * Cobertura mínima de paquetes cerrados. El límite es deliberado: una
 * presentación real no necesita más de 200 paquetes para una decoración y
 * la búsqueda acotada mantiene el cálculo determinista y fácil de auditar.
 */
export function optimizarCobertura(
  unidadesObjetivo: number,
  opciones: readonly OpcionPaquete[],
  merma = 0,
): ResultadoCobertura | null {
  const candidatas = opciones
    .filter((item) => Number.isInteger(item.unidadesPaquete) && item.unidadesPaquete > 0 && Number.isFinite(item.precio) && item.precio > 0)
    .map((item) => ({ ...item, minPaquetes: Math.max(0, Math.floor(item.minPaquetes ?? 0)), paquetes: 0 }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  if (unidadesObjetivo <= 0 || candidatas.length === 0) return null;

  const unidadesConMerma = Math.ceil(unidadesObjetivo * (1 + merma));
  const maxPaquetes = Math.max(
    1,
    Math.max(...candidatas.map((item) => item.minPaquetes ?? 0)),
    Math.ceil(unidadesConMerma / Math.min(...candidatas.map((item) => item.unidadesPaquete))) + 2,
  );
  let mejor: ResultadoCobertura | null = null;

  function visitar(indice: number, restantes: number, elegidas: CompraOptimizada[]): void {
    if (indice === candidatas.length) {
      if (restantes > 0) return;
      const compras = elegidas.filter((item) => item.paquetes > 0);
      const capacidad = compras.reduce((sum, item) => sum + item.capacidad, 0);
      const candidato: ResultadoCobertura = {
        unidadesObjetivo,
        unidadesConMerma,
        costo: compras.reduce((sum, item) => sum + item.paquetes * item.precio, 0),
        sobrante: capacidad - unidadesObjetivo,
        paquetes: compras.reduce((sum, item) => sum + item.paquetes, 0),
        compras,
      };
      if (!mejor || comparar(candidato, mejor) < 0) mejor = candidato;
      return;
    }

    const opcion = candidatas[indice]!;
    const min = opcion.minPaquetes;
    const max = Math.min(maxPaquetes, Math.max(min, Math.ceil(restantes / opcion.unidadesPaquete) + 1));
    for (let paquetes = 0; paquetes <= max; paquetes += 1) {
      if (paquetes > 0 && paquetes < min) continue;
      const capacidad = paquetes * opcion.unidadesPaquete;
      visitar(indice + 1, restantes - capacidad, [
        ...elegidas,
        { ...opcion, paquetes, capacidad },
      ]);
    }
  }

  visitar(0, unidadesConMerma, []);
  return mejor;
}

export type DemandaReservaProyecto = {
  id: string;
  designQuantity: number;
  purchaseQuantity: number;
  compatibilityKey: string;
  eligible?: boolean;
};

export type ResultadoReservaProyecto = {
  targetWasteReserve: number;
  naturalSurplus: number;
  coveredWasteReserve: number;
  uncoveredWasteReserve: number;
  allocations: Map<string, number>;
};

/**
 * Distribuye una sola reserva estadística de proyecto entre los sobrantes de
 * paquete que ya existen. El objetivo es del proyecto entero, no de cada
 * grupo: un paquete exacto de R-24 no se duplica solo por merma cuando el
 * sobrante natural de otro grupo ya cubre el objetivo (regla comercial
 * fijada por `scripts/test-plan-presupuesto.ts`).
 *
 * La clave de compatibilidad la decide el llamador (por ejemplo, tamaño y
 * color) y solo controla en qué líneas puede quedar la reserva, no qué
 * demanda cubre: no se asume que un R-5 pueda reemplazar a un R-24 en la
 * línea, pero el objetivo sí es común. Lo que el sobrante no cubre se compra
 * aparte (ver el bucle de paquetes adicionales en `resolver.ts`).
 */
export function distribuirReservaProyecto(
  demandas: readonly DemandaReservaProyecto[],
  wasteRate: number,
): ResultadoReservaProyecto {
  const elegibles = demandas
    .filter((demanda) => demanda.eligible !== false && demanda.designQuantity > 0)
    .map((demanda) => ({
      ...demanda,
      designQuantity: Math.max(0, Math.floor(demanda.designQuantity)),
      purchaseQuantity: Math.max(0, Math.floor(demanda.purchaseQuantity)),
    }));
  const targetWasteReserve = Math.ceil(elegibles.reduce((sum, demanda) => sum + demanda.designQuantity, 0) * Math.max(0, wasteRate));
  const naturalSurplus = elegibles.reduce((sum, demanda) => sum + Math.max(0, demanda.purchaseQuantity - demanda.designQuantity), 0);
  const byCompatibility = new Map<string, { surplus: number }>();
  for (const demanda of elegibles) {
    const grupo = byCompatibility.get(demanda.compatibilityKey) ?? { surplus: 0 };
    grupo.surplus += Math.max(0, demanda.purchaseQuantity - demanda.designQuantity);
    byCompatibility.set(demanda.compatibilityKey, grupo);
  }

  let remaining = targetWasteReserve;
  const coveredByGroup = new Map<string, number>();
  for (const [key, grupo] of [...byCompatibility.entries()].sort((a, b) => b[1].surplus - a[1].surplus || a[0].localeCompare(b[0]))) {
    const covered = Math.min(remaining, grupo.surplus);
    coveredByGroup.set(key, covered);
    remaining -= covered;
    if (remaining <= 0) break;
  }

  const allocations = new Map<string, number>();
  for (const demanda of elegibles) {
    const groupRemaining = coveredByGroup.get(demanda.compatibilityKey) ?? 0;
    const available = Math.max(0, demanda.purchaseQuantity - demanda.designQuantity);
    const allocation = Math.min(groupRemaining, available);
    if (allocation > 0) allocations.set(demanda.id, allocation);
    coveredByGroup.set(demanda.compatibilityKey, groupRemaining - allocation);
  }
  const coveredWasteReserve = [...allocations.values()].reduce((sum, value) => sum + value, 0);
  return {
    targetWasteReserve,
    naturalSurplus,
    coveredWasteReserve,
    uncoveredWasteReserve: Math.max(0, targetWasteReserve - coveredWasteReserve),
    allocations,
  };
}

/**
 * Paquetes que una compra suma por encima de la cobertura mínima del diseño,
 * es decir los que se compraron solo para la reserva de merma. Antes se
 * reportaban TODOS los paquetes de la línea marcada (golden 08 decía 10
 * paquetes adicionales donde se añadió 1).
 *
 * `design-material-estimate-v1` no guarda el conteo base, así que el valor se
 * deriva de los campos de la línea y `validateMaterialEstimate` recalcula
 * exactamente lo mismo. Espejo: `_waste_extra_packages` en
 * `services/ai-api/app/plan.py`.
 */
export function paquetesExtraPorMerma(designQuantity: number, unidadesPaquete: number, paquetes: number): number {
  if (!(unidadesPaquete > 0)) return 0;
  return Math.max(0, paquetes - Math.max(1, Math.ceil(Math.max(0, designQuantity) / unidadesPaquete)));
}

/**
 * Ahorro real de una compra por no comprar paquetes solo por merma: lo que
 * habría costado el enfoque ingenuo (cada línea con su merma completa) menos
 * los paquetes que de verdad se compraron. Antes se comparaba contra la
 * cobertura mínima del diseño e ignoraba los paquetes que la reserva sí
 * obligó a comprar, así que se reportaba un ahorro inexistente.
 *
 * Devuelve un valor sin redondear: el llamador suma todas las compras y
 * redondea una sola vez (un precio por paquete puede ser fraccionario cuando
 * sale de `purchase_cost / package_count`).
 */
export function ahorroSoloMermaCop(
  designQuantity: number,
  unidadesPaquete: number,
  paquetes: number,
  precioPaquete: number,
  merma: number,
): number {
  if (!(unidadesPaquete > 0)) return 0;
  const paquetesIngenuos = Math.ceil(Math.ceil(Math.max(0, designQuantity) * (1 + merma)) / unidadesPaquete);
  return Math.max(0, (paquetesIngenuos - paquetes) * precioPaquete);
}

export function asignarUnidades(
  unidadesObjetivo: number,
  compras: readonly CompraOptimizada[],
): Map<string, number> {
  let restantes = unidadesObjetivo;
  const asignadas = new Map<string, number>();
  for (const compra of compras) {
    const unidades = Math.min(restantes, compra.capacidad);
    if (unidades > 0) asignadas.set(compra.variantId, unidades);
    restantes -= unidades;
    if (restantes <= 0) break;
  }
  return asignadas;
}
