"use client";

import type { ImageQaReport } from "@/lib/ia/image-qa";

export function GenerationQaSummary({ qa }: { qa?: ImageQaReport | null }) {
  if (!qa) return null;
  const pendiente = qa.confidence === "unknown";
  const estado = pendiente ? "pendiente" : qa.pass === true ? "aprobada" : "requiere revisión";
  return <div className={`rounded-xl border p-3 text-xs ${qa.pass && !pendiente ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}><p className="font-medium">QA visual: {estado}</p>{qa.retry_reasons.length > 0 && <ul className="mt-1 list-disc pl-4">{qa.retry_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}{pendiente && <p className="mt-1">La imagen todavía no fue verificada visualmente contra cada producto.</p>}</div>;
}
