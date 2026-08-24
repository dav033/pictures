"use client";

import type { ResolvedScenePlan, ResolvedItemLine, SceneApprovalStatus } from "@/lib/scene/resolver";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function approvalLabel(status: SceneApprovalStatus): string {
  switch (status) {
    case "DRAFT": return "Borrador";
    case "PARTIAL": return "Parcial";
    case "COMPLETE": return "Completo";
    case "BLOCKED": return "Bloqueado";
    case "APPROVED": return "Aprobado";
  }
}

function approvalColor(status: SceneApprovalStatus): string {
  switch (status) {
    case "COMPLETE":
    case "APPROVED":
      return "bg-green-100 text-green-700";
    case "PARTIAL":
      return "bg-amber-100 text-amber-700";
    case "BLOCKED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function sourceLabel(line: ResolvedItemLine): string {
  switch (line.source_class) {
    case "purchase": return "Compra";
    case "rental": return "Alquiler";
    case "venue_existing": return "Existente";
    case "context_non_quotable": return "Contexto";
  }
}

export function SceneCoveragePanel({ plan }: { plan: ResolvedScenePlan }) {
  const lines = plan.lines.filter((l) => !l.item_id.startsWith("gap:"));
  const gapLines = plan.lines.filter((l) => l.item_id.startsWith("gap:"));

  return (
    <section className="mt-3 max-w-[92%] space-y-3 rounded-xl border border-acento/30 bg-superficie p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-texto">Plan de escena V2</p>
          <p className="text-xs text-texto-suave">
            {lines.length} slots cubiertos, {gapLines.length} brechas
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${approvalColor(plan.approval)}`}>
          {approvalLabel(plan.approval)}
        </span>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-fondo/60 p-3">
        <div className="text-center">
          <p className="text-lg font-bold text-texto">{pesos.format(plan.totals.total_cop)}</p>
          <p className="text-[10px] text-texto-suave">Total</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-texto">{plan.totals.distinct_items}</p>
          <p className="text-[10px] text-texto-suave">Ítems</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-texto">{plan.totals.shared_items}</p>
          <p className="text-[10px] text-texto-suave">Compartidos</p>
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
        <div>
          <span className="font-semibold text-texto">{pesos.format(plan.totals.breakdown.purchase)}</span>
          <p className="text-texto-suave">Compra</p>
        </div>
        <div>
          <span className="font-semibold text-texto">{pesos.format(plan.totals.breakdown.rental)}</span>
          <p className="text-texto-suave">Alquiler</p>
        </div>
        <div>
          <span className="font-semibold text-texto">{pesos.format(plan.totals.breakdown.venue_existing)}</span>
          <p className="text-texto-suave">Existente</p>
        </div>
        <div>
          <span className="font-semibold text-texto">{pesos.format(plan.totals.breakdown.context_non_quotable)}</span>
          <p className="text-texto-suave">Contexto</p>
        </div>
      </div>

      {/* Lines */}
      {lines.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-texto">Slots cubiertos</p>
          {lines.map((line) => (
            <div key={`${line.slot_id}-${line.item_id}`} className="flex items-center justify-between rounded-lg bg-fondo/60 p-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-texto truncate">{line.slot_id}</p>
                <p className="text-texto-suave">
                  {line.instance_count} instancia{line.instance_count !== 1 ? "s" : ""}
                  {line.billable_quantity > 0 && ` · ${line.billable_quantity} × ${line.units_per_package}u`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-texto">{line.subtotal_cop > 0 ? pesos.format(line.subtotal_cop) : "—"}</p>
                <p className="text-[10px] text-texto-suave">{sourceLabel(line)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gaps */}
      {gapLines.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-600">Brechas</p>
          {gapLines.map((line) => (
            <div key={line.slot_id} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
              <p className="font-medium">{line.slot_id}</p>
            </div>
          ))}
        </div>
      )}

      {/* Blockers */}
      {plan.approval_blockers.length > 0 && (
        <div className="space-y-1 rounded-lg bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-600">Bloqueos de aprobación</p>
          {plan.approval_blockers.map((blocker, i) => (
            <p key={i} className="text-[10px] text-red-500">{blocker}</p>
          ))}
        </div>
      )}
    </section>
  );
}
