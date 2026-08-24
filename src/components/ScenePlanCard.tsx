"use client";

import type { ResolvedScenePlan } from "@/lib/scene/resolver";

type Props = {
  plan: ResolvedScenePlan;
  onApprove?: () => void;
  approved?: boolean;
  degraded?: boolean;
};

export function ScenePlanCard({ plan, onApprove, approved = false, degraded = false }: Props) {
  const isBlocked = plan.approval === "BLOCKED";
  const isPartial = plan.approval === "PARTIAL";
  const canApprove = (plan.approval === "COMPLETE" || (isPartial && degraded)) && !approved;
  const mustDegrade = isPartial && !degraded;

  const lines = plan.lines.filter((l) => !l.item_id.startsWith("gap:"));
  const gaps = plan.lines.filter((l) => l.item_id.startsWith("gap:"));

  return (
    <section className="mt-3 max-w-[92%] space-y-3 rounded-xl border border-acento/30 bg-superficie p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-texto">
            Programa de escena V2
          </p>
          <p className="text-xs text-texto-suave">
            {lines.length} slots cubiertos · {gaps.length} brechas ·{" "}
            {plan.lines.filter((l) => l.source_class === "purchase").length} compras ·{" "}
            {plan.lines.filter((l) => l.source_class === "rental").length} alquileres
          </p>
        </div>
        {plan.totals.total_cop > 0 && (
          <span className="shrink-0 rounded-full bg-acento-suave px-2 py-1 text-[10px] font-semibold text-acento">
            {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(plan.totals.total_cop)}
          </span>
        )}
      </div>

      {/* Slots */}
      {lines.length > 0 && (
        <ol className="space-y-2">
          {lines.map((line) => (
            <li key={`${line.slot_id}-${line.item_id}`} className="rounded-lg bg-fondo/60 p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-texto">{line.slot_id}</span>
                <span className="text-[10px] uppercase text-texto-suave">
                  {line.source_class === "purchase" ? "compra" : line.source_class === "rental" ? "alquiler" : "existente"}
                </span>
              </div>
              <p className="mt-1 text-texto-suave">
                {line.instance_count} instancia{line.instance_count !== 1 ? "s" : ""}
                {line.billable_quantity > 0 && (
                  <> · {line.billable_quantity} paq. × {line.units_per_package}u</>
                )}
                {line.subtotal_cop > 0 && (
                  <> · {new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(line.subtotal_cop)}</>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* Gaps */}
      {gaps.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 p-2">
          <p className="text-xs font-semibold text-amber-700">Sin cobertura</p>
          {gaps.map((g) => (
            <p key={g.slot_id} className="text-[10px] text-amber-600">{g.slot_id}</p>
          ))}
        </div>
      )}

      {/* Blockers */}
      {plan.approval_blockers.length > 0 && (
        <div className="space-y-1 rounded-lg bg-red-50 p-2">
          <p className="text-xs font-semibold text-red-600">Pendiente de resolver</p>
          {plan.approval_blockers.map((b, i) => (
            <p key={i} className="text-[10px] text-red-500">{b}</p>
          ))}
        </div>
      )}

      {/* Approval actions */}
      {mustDegrade && onApprove && (
        <button
          type="button"
          onClick={onApprove}
          className="w-full rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-200 transition-colors"
        >
          Aceptar perfil degradado y generar
        </button>
      )}

      {canApprove && onApprove && (
        <button
          type="button"
          onClick={onApprove}
          className="w-full rounded-lg bg-acento px-3 py-2 text-xs font-semibold text-white hover:bg-acento/90 transition-colors"
        >
          Aprobar y generar imagen
        </button>
      )}

      {isBlocked && (
        <p className="text-xs text-red-500 text-center">
          No se puede generar: hay bloqeuos de aprobación pendientes.
        </p>
      )}

      {approved && (
        <p className="text-xs text-green-600 text-center font-semibold">
          Plan aprobado — generando visualización
        </p>
      )}
    </section>
  );
}
