"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Layers3 } from "lucide-react";
import type { LoraModeSlug, LoraSelection } from "@/lib/lora/schema";

export type LoraSelectionState = {
  product: { artifactId: string; scale: number } | null;
  structure: { artifactId: string; scale: number } | null;
};

type Artifact = {
  id: string;
  label: string;
  specialization: "product" | "structure";
  trigger_token: string;
  created_at: string;
};

type ModeOption = {
  slug: LoraModeSlug;
  display_name: string;
  enabled: boolean;
  ready: boolean;
  status: string;
  trigger_token: string | null;
  selection: LoraSelection | null;
};

const EMPTY_SELECTION: LoraSelectionState = { product: null, structure: null };

export default function LoraPairSelector({ value, onChange, mode, onModeChange }: { value: LoraSelectionState; onChange: (value: LoraSelectionState) => void; mode: LoraModeSlug | null; onModeChange: (mode: LoraModeSlug | null) => void }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [modes, setModes] = useState<ModeOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/lora/artifacts", { cache: "no-store", headers: { Accept: "application/json" } }),
      fetch("/api/lora/modes", { cache: "no-store", headers: { Accept: "application/json" } }),
    ])
      .then(async ([artifactsResponse, modesResponse]) => {
        if (!artifactsResponse.ok || !modesResponse.ok) throw new Error("Registro de pesos no disponible");
        return {
          artifacts: (await artifactsResponse.json() as { artifacts?: Artifact[] }).artifacts ?? [],
          modes: (await modesResponse.json() as { modes?: ModeOption[] }).modes ?? [],
        };
      })
      .then((payload) => { if (active) { setArtifacts(payload.artifacts); setModes(payload.modes); } })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los pesos"); });
    return () => { active = false; };
  }, []);

  const products = artifacts.filter((artifact) => artifact.specialization === "product");
  const structures = artifacts.filter((artifact) => artifact.specialization === "structure");
  const selectableModes = modes.filter((candidate) => candidate.slug !== "unlimited");
  const selectedMode = selectableModes.find((candidate) => candidate.slug === mode);
  const update = (specialization: "product" | "structure", artifactId: string) => {
    const artifact = artifacts.find((candidate) => candidate.id === artifactId);
    onChange({ ...value, [specialization]: artifactId ? { artifactId, scale: value[specialization]?.scale ?? (specialization === "structure" ? 0.6 : 0.3) } : null });
    if (artifact && artifact.specialization !== specialization) onChange(EMPTY_SELECTION);
  };
  const updateMode = (slug: string) => {
    if (!slug) {
      onModeChange(null);
      onChange(EMPTY_SELECTION);
      return;
    }
    const next = selectableModes.find((candidate) => candidate.slug === slug);
    if (!next?.ready || !next.selection) return;
    onModeChange(next.slug);
    onChange({
      product: next.selection.product ? { artifactId: next.selection.product.artifactId, scale: next.selection.product.scale ?? 0.3 } : null,
      structure: next.selection.structure ? { artifactId: next.selection.structure.artifactId, scale: next.selection.structure.scale ?? 0.6 } : null,
    });
  };

  return (
    <details className="relative max-w-[25rem] rounded-2xl border border-borde bg-superficie px-3 py-2 text-left">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-texto [&::-webkit-details-marker]:hidden">
        <Layers3 className="size-4 text-acento" aria-hidden="true" />
        <span>LoRA compuesto</span>
        <span className="ml-auto text-xs font-normal text-texto-suave">{mode === "training_1" ? "producto v007" : value.product || value.structure ? "personalizado" : "base"}</span>
      </summary>
      <div className="mt-3 space-y-3 border-t border-borde pt-3">
        {error && <p className="flex items-start gap-2 rounded-xl bg-aviso-suave px-3 py-2 text-xs text-texto"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-aviso" aria-hidden="true" />{error}</p>}
        <label className="block text-xs font-semibold text-texto-suave">Modo
          <select value={mode ?? ""} onChange={(event) => updateMode(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-borde bg-superficie px-2.5 text-sm font-normal text-texto">
            <option value="">Selección manual / LoRA actual</option>
            {selectableModes.map((candidate) => <option key={candidate.slug} value={candidate.slug} disabled={!candidate.enabled || !candidate.ready}>{candidate.slug === "training_1" ? "Producto Sempertex v007" : candidate.display_name}{candidate.status === "experimental" ? " · experimental" : candidate.ready ? "" : " · no disponible"}</option>)}
          </select>
        </label>
        {selectedMode && <p className="rounded-xl bg-acento-suave px-3 py-2 text-xs leading-5 text-texto">{selectedMode.status === "experimental" ? "Modo experimental: la evaluación visual aún no está aprobada. " : "Modo preparado: "}Usa {selectedMode.trigger_token ?? "su trigger registrado"} y escala registrada. La generación se valida de nuevo en el servidor.</p>}
        {!mode && <>
        <label className="block text-xs font-semibold text-texto-suave">Producto
          <select value={value.product?.artifactId ?? ""} onChange={(event) => update("product", event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-borde bg-superficie px-2.5 text-sm font-normal text-texto">
            <option value="">Sin LoRA producto</option>
            {products.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.label} · {artifact.trigger_token}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-texto-suave">Estructuras
          <select value={value.structure?.artifactId ?? ""} onChange={(event) => update("structure", event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-borde bg-superficie px-2.5 text-sm font-normal text-texto">
            <option value="">Sin LoRA estructuras</option>
            {structures.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.label} · {artifact.trigger_token}</option>)}
          </select>
        </label>
        {(value.product || value.structure) && <div className="grid gap-2 sm:grid-cols-2">
          {value.product && <label className="text-xs font-semibold text-texto-suave">Escala producto<input type="number" min="0" max="1.5" step="0.1" value={value.product.scale} onChange={(event) => onChange({ ...value, product: { ...value.product!, scale: Number(event.target.value) } })} className="mt-1 min-h-9 w-full rounded-xl border border-borde bg-superficie px-2.5 text-sm font-normal text-texto" /></label>}
          {value.structure && <label className="text-xs font-semibold text-texto-suave">Escala estructuras<input type="number" min="0" max="1.5" step="0.1" value={value.structure.scale} onChange={(event) => onChange({ ...value, structure: { ...value.structure!, scale: Number(event.target.value) } })} className="mt-1 min-h-9 w-full rounded-xl border border-borde bg-superficie px-2.5 text-sm font-normal text-texto" /></label>}
        </div>}
        </>}
        <p className="text-xs leading-5 text-texto-suave">Los pesos se validan en servidor. Dos LoRA requieren compatibilidad confirmada del proveedor.</p>
      </div>
    </details>
  );
}
