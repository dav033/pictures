import type { CompraConsolidada, PlanResuelto } from "./resuelto";

export type DesgloseMateriales = {
  por_estructura: Array<{
    estructura_id: string;
    nombre: string;
    tipo: string;
    eje_m: number | null;
    total_unidades: number;
    lineas: Array<{
      tamano: string | null;
      diam_cm: number | null;
      color: string | null;
      titulo: string;
      sku: string | null;
      unidades: number;
      sustitucion: string | null;
    }>;
  }>;
  compras: CompraConsolidada[];
  resumen_tamanos: Array<{ tamano: string; diam_pulg: number; diam_cm: number; unidades: number; pct: number }>;
  totales: { total_unidades: number; total_cop: number; incluye_iva: boolean; merma_porcentaje: number };
  notas: string[];
};

export function construirDesglose(plan: PlanResuelto): DesgloseMateriales {
  const porTamano = new Map<number, { unidades: number; forma: string | null }>();
  const porEstructura = plan.estructuras.map((estructura) => ({
    estructura_id: estructura.estructura_id,
    nombre: estructura.nombre,
    tipo: estructura.tipo,
    eje_m: estructura.eje_m,
    total_unidades: estructura.total_unidades,
    lineas: estructura.lineas.map((linea) => {
      if (linea.diam_pulg != null) {
        const previo = porTamano.get(linea.diam_pulg);
        porTamano.set(linea.diam_pulg, { unidades: (previo?.unidades ?? 0) + linea.unidades, forma: linea.forma });
      }
      return {
        tamano: linea.tamano_codigo,
        diam_cm: linea.diam_cm,
        color: linea.color,
        titulo: linea.titulo,
        sku: linea.sku,
        unidades: linea.unidades,
        sustitucion: linea.sustitucion ? `${linea.sustitucion.pedido} → ${linea.sustitucion.entregado}: ${linea.sustitucion.motivo}` : null,
      };
    }),
  }));
  const totalConTamano = [...porTamano.values()].reduce((sum, item) => sum + item.unidades, 0);
  const resumen_tamanos = [...porTamano.entries()].sort(([a], [b]) => a - b).map(([diam_pulg, item]) => ({
    tamano: `R-${diam_pulg}`,
    diam_pulg,
    diam_cm: Math.round(diam_pulg * 2.54 * 10) / 10,
    unidades: item.unidades,
    pct: totalConTamano ? Number(((item.unidades / totalConTamano) * 100).toFixed(2)) : 0,
  }));
  const notas = [
    "Los paquetes se compran una sola vez para toda la decoración; el precio no se reparte por estructura.",
    ...plan.plan.supuestos,
    ...plan.sustituciones.map((item) => `${item.estructura_id}: ${item.pedido} → ${item.entregado}.`),
    ...plan.compras.filter((compra) => compra.sobrante > 0).map((compra) => `${compra.titulo}: sobran ${compra.sobrante} unidades después de comprar paquetes completos.`),
    ...plan.sin_cobertura.map((item) => `${item.estructura_id}: sin cobertura para ${item.tamano}.`),
  ];
  return {
    por_estructura: porEstructura,
    compras: plan.compras,
    resumen_tamanos,
    totales: plan.totales,
    notas: [...new Set(notas)],
  };
}
