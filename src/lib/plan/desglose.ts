import type { ReferenceBlueprintV2 } from "../ia/reference-blueprint";
import { ALCANCE_POR_CATEGORIA_REFERENCIA, type AlcanceReferencia } from "../rag/taxonomy/alcance-referencia";
import type { CompraConsolidada, PlanResuelto } from "./resuelto";
import type { MotivoOmissionReferencia } from "./tipos";

export type EstadoCoberturaReferencia = "pendiente" | "incluido" | "omitido" | "emulable_pendiente" | "fuera_de_catalogo";

export type ElementoCoberturaReferencia = {
  elementId: string;
  nombre: string;
  categoria: ReferenceBlueprintV2["elements"][number]["category"];
  alcance: AlcanceReferencia;
  estado: EstadoCoberturaReferencia;
  estructuraId?: string;
  estructuraNombre?: string;
  variantIds: string[];
  motivo?: string;
  motivoTipo?: MotivoOmissionReferencia;
  propuesta?: string;
};

export type CoberturaReferencia = {
  elementos: ElementoCoberturaReferencia[];
};

export type DesgloseMateriales = {
  por_estructura: Array<{
    estructura_id: string;
    nombre: string;
    tipo: string;
    eje_m: number | null;
    total_unidades: number;
    referencia_element_id?: string;
    referencia_nombre?: string;
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
  referencias_omitidas: Array<{
    element_id: string;
    nombre: string;
    categoria: ReferenceBlueprintV2["elements"][number]["category"];
    alcance: AlcanceReferencia;
    motivo: string;
    motivo_tipo: MotivoOmissionReferencia;
    propuesta?: string;
  }>;
  resumen_tamanos: Array<{ tamano: string; diam_pulg: number; diam_cm: number; unidades: number; pct: number }>;
  totales: { total_unidades: number; total_cop: number; incluye_iva: boolean; merma_porcentaje: number };
  notas: string[];
};

export function construirCoberturaReferencia(blueprint: ReferenceBlueprintV2, planResuelto?: PlanResuelto | null): CoberturaReferencia {
  const estructurasPorId = new Map(
    planResuelto?.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura]) ?? [],
  );
  const omitidasPorId = new Map(planResuelto?.plan.referencia_omitida?.map((item) => [item.element_id, item]) ?? []);

  return {
    elementos: blueprint.elements.map((elemento) => {
      if (!planResuelto) {
        return {
          elementId: elemento.element_id,
          nombre: elemento.name,
          categoria: elemento.category,
          alcance: ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.category].alcance,
          estado: "pendiente",
          variantIds: [],
        };
      }

      const estructuras = planResuelto.estructuras.filter((estructura) =>
        estructurasPorId.get(estructura.estructura_id)?.referencia_element_id === elemento.element_id,
      );
      if (estructuras.length > 0) {
        return {
          elementId: elemento.element_id,
          nombre: elemento.name,
          categoria: elemento.category,
          alcance: ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.category].alcance,
          estado: "incluido",
          estructuraId: estructuras[0]!.estructura_id,
          estructuraNombre: estructuras[0]!.nombre,
          variantIds: [...new Set(estructuras.flatMap((estructura) => estructura.lineas.map((linea) => linea.variant_id)))],
        };
      }

      const omitida = omitidasPorId.get(elemento.element_id);
      if (omitida) {
        const alcance = ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.category].alcance;
        const estado: EstadoCoberturaReferencia = omitida.motivo_tipo === "emulacion_propuesta"
          ? "emulable_pendiente"
          : omitida.motivo_tipo === "fuera_de_catalogo"
            ? "fuera_de_catalogo"
            : "omitido";
        return {
          elementId: elemento.element_id,
          nombre: elemento.name,
          categoria: elemento.category,
          alcance,
          estado,
          variantIds: [],
          motivo: omitida.motivo,
          motivoTipo: omitida.motivo_tipo,
          ...(omitida.propuesta ? { propuesta: omitida.propuesta } : {}),
        };
      }

      return {
        elementId: elemento.element_id,
        nombre: elemento.name,
        categoria: elemento.category,
        alcance: ALCANCE_POR_CATEGORIA_REFERENCIA[elemento.category].alcance,
        estado: "pendiente",
        variantIds: [],
      };
    }),
  };
}

export function construirDesglose(plan: PlanResuelto, blueprint?: ReferenceBlueprintV2): DesgloseMateriales {
  const porTamano = new Map<number, { unidades: number; forma: string | null }>();
  const estructurasPlanPorId = new Map(plan.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura]));
  const elementosReferenciaPorId = new Map(blueprint?.elements.map((elemento) => [elemento.element_id, elemento]) ?? []);
  const porEstructura = plan.estructuras.map((estructura) => {
    const estructuraPlan = estructurasPlanPorId.get(estructura.estructura_id);
    const referenciaElementId = estructuraPlan?.referencia_element_id;
    const referenciaNombre = referenciaElementId ? elementosReferenciaPorId.get(referenciaElementId)?.name : undefined;
    return {
      estructura_id: estructura.estructura_id,
      nombre: estructura.nombre,
      tipo: estructura.tipo,
      eje_m: estructura.eje_m,
      total_unidades: estructura.total_unidades,
      ...(referenciaElementId ? { referencia_element_id: referenciaElementId } : {}),
      ...(referenciaNombre ? { referencia_nombre: referenciaNombre } : {}),
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
    };
  });
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
  const referencias_omitidas = blueprint
    ? (plan.plan.referencia_omitida ?? []).map((item) => {
        const elemento = elementosReferenciaPorId.get(item.element_id);
        return {
          element_id: item.element_id,
          nombre: elemento?.name ?? item.element_id,
          categoria: elemento?.category ?? "other",
          alcance: ALCANCE_POR_CATEGORIA_REFERENCIA[elemento?.category ?? "other"].alcance,
          motivo: item.motivo,
          motivo_tipo: item.motivo_tipo,
          ...(item.propuesta ? { propuesta: item.propuesta } : {}),
        };
      })
    : [];
  return {
    por_estructura: porEstructura,
    compras: plan.compras,
    referencias_omitidas,
    resumen_tamanos,
    totales: plan.totales,
    notas: [...new Set(notas)],
  };
}
