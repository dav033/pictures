"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, RefreshCw, ShieldCheck } from "lucide-react";
import LoraTrainingWizard from "./LoraTrainingWizard";

type StructureDataset = {
  id: string;
  label: string;
  specialization: "product" | "structure";
  status: string;
  image_count: number;
  caption_count: number;
  coverage_status: string;
  structure_types: unknown;
  caption_audit: unknown;
  license_status: string;
  evaluation_status: string;
  zip_storage_key: string | null;
};

type StructureTraining = {
  id: string;
  label: string;
  status: string;
  steps: number;
  learning_rate: number;
  created_at: string;
  evaluation_status: string;
};

type StructureArtifact = {
  id: string;
  label: string;
  status: string;
  evaluation_status: string;
  created_at: string;
};

const CLASS_LABELS = [
  ["arco", "Arcos orgánicos"],
  ["semiarco", "Semiarcos"],
  ["guirnalda", "Guirnaldas"],
  ["columna", "Columnas"],
  ["bouquet", "Bouquets"],
  ["backdrop", "Backdrops"],
  ["instalacion_completa", "Instalaciones completas"],
] as const;

const dateFormat = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" });

function statusLabel(status: string): string {
  const labels: Record<string, string> = { ready: "Listo", completed: "Completada", pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", draft: "Borrador", running: "En curso", failed: "Fallida" };
  return labels[status] ?? status;
}

function coverageCount(dataset: StructureDataset | undefined, key: string): number {
  if (!dataset || !Array.isArray(dataset.structure_types)) return 0;
  const match = dataset.structure_types.find((item) => item === key || (typeof item === "object" && item !== null && "canonicalId" in item && item.canonicalId === key));
  return match ? 1 : 0;
}

export default function LoraStructureConsole() {
  const [datasets, setDatasets] = useState<StructureDataset[]>([]);
  const [trainings, setTrainings] = useState<StructureTraining[]>([]);
  const [artifacts, setArtifacts] = useState<StructureArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [datasetsResponse, trainingsResponse, artifactsResponse] = await Promise.all([
        fetch("/api/lora/datasets?specialization=structure", { cache: "no-store" }),
        fetch("/api/lora/trainings?specialization=structure", { cache: "no-store" }),
        fetch("/api/lora/artifacts?specialization=structure", { cache: "no-store" }),
      ]);
      if (!datasetsResponse.ok || !trainingsResponse.ok || !artifactsResponse.ok) throw new Error("No se pudo leer el registro de estructuras.");
      const datasetsPayload = await datasetsResponse.json() as { datasets?: StructureDataset[] };
      const trainingsPayload = await trainingsResponse.json() as { trainings?: StructureTraining[] };
      const artifactsPayload = await artifactsResponse.json() as { artifacts?: StructureArtifact[] };
      setDatasets(datasetsPayload.datasets ?? []);
      setTrainings(trainingsPayload.trainings ?? []);
      setArtifacts(artifactsPayload.artifacts ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo leer el registro de estructuras.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dataset = datasets[0];
  const audit = dataset?.caption_audit && typeof dataset.caption_audit === "object" ? dataset.caption_audit as { vocabularyPass?: boolean; captionsWithExactTrigger?: number; totalImages?: number } : undefined;
  const readyForTraining = dataset?.status === "ready" && dataset.license_status === "verified" && dataset.evaluation_status === "approved";
  const classSummary = useMemo(() => CLASS_LABELS.map(([key, label]) => ({ key, label, present: coverageCount(dataset, key) })), [dataset]);

  return (
    <section className="space-y-5" aria-labelledby="lora-estructuras-heading">
      <div className="rounded-3xl border border-acento/25 bg-superficie p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-acento"><ShieldCheck className="size-4" aria-hidden="true" /> Especialización independiente</div>
            <h2 id="lora-estructuras-heading" className="mt-3 text-xl font-semibold tracking-tight text-texto">Entrenamientos de estructuras</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-texto-suave">Arcos, semiarcos, guirnaldas, columnas, bouquets, backdrops e instalaciones completas. Nunca se mezclan con el dataset de producto.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-button-primary" onClick={() => setWizardOpen(true)}>Nuevo entrenamiento</button>
            <button type="button" className="ui-button-secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              Actualizar
            </button>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-superficie-2 px-4 py-3"><dt className="text-xs text-texto-suave">Dataset</dt><dd className="mt-1 break-words text-sm font-semibold text-texto">{dataset?.label ?? "Sin crear"}</dd></div>
          <div className="rounded-2xl bg-superficie-2 px-4 py-3"><dt className="text-xs text-texto-suave">Trigger</dt><dd className="mt-1 text-sm font-semibold text-texto">eventdecor_structure_v1</dd></div>
          <div className="rounded-2xl bg-superficie-2 px-4 py-3"><dt className="text-xs text-texto-suave">Imágenes</dt><dd className="mt-1 text-sm font-semibold text-texto">{dataset?.image_count ?? 0}</dd></div>
          <div className="rounded-2xl bg-superficie-2 px-4 py-3"><dt className="text-xs text-texto-suave">Estado</dt><dd className="mt-1 text-sm font-semibold text-texto">{dataset ? statusLabel(dataset.status) : "Pendiente"}</dd></div>
        </dl>
      </div>

      {error && <div className="flex items-start gap-3 rounded-2xl border border-error/25 bg-error-suave px-4 py-3 text-sm text-texto" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden="true" />{error}</div>}

      {loading && !dataset ? (
        <div className="grid gap-3 sm:grid-cols-2"><div className="h-52 animate-pulse rounded-3xl bg-superficie-2" /><div className="h-52 animate-pulse rounded-3xl bg-superficie-2" /></div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7" aria-labelledby="cobertura-estructuras-heading">
            <div className="flex items-start justify-between gap-3"><div><h3 id="cobertura-estructuras-heading" className="text-sm font-semibold text-texto">Cobertura por clase</h3><p className="mt-1 text-sm text-texto-suave">La clase debe aparecer en el manifest y en los splits antes de entrenar.</p></div><Database className="size-5 text-acento" aria-hidden="true" /></div>
            <div className="mt-5 space-y-3">
              {classSummary.map((item) => <div key={item.key} className="flex items-center justify-between gap-3 rounded-2xl bg-superficie-2 px-4 py-3"><span className="text-sm text-texto">{item.label}</span><span className={`text-xs font-semibold ${item.present ? "text-exito" : "text-aviso"}`}>{item.present ? "Presente" : "Pendiente"}</span></div>)}
            </div>
          </section>

          <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7" aria-labelledby="auditoria-estructuras-heading">
            <h3 id="auditoria-estructuras-heading" className="text-sm font-semibold text-texto">Preflight del dataset</h3>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-texto-suave">Captions</dt><dd className="font-medium text-texto">{dataset?.caption_count ?? 0}/{dataset?.image_count ?? 0}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-texto-suave">Trigger exacto</dt><dd className="font-medium text-texto">{audit?.captionsWithExactTrigger ?? 0}/{audit?.totalImages ?? dataset?.image_count ?? 0}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-texto-suave">Vocabulario</dt><dd className="font-medium text-texto">{audit?.vocabularyPass ? "Aprobado" : "Pendiente"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-texto-suave">Licencia</dt><dd className="font-medium text-texto">{statusLabel(dataset?.license_status ?? "pending")}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-texto-suave">Evaluación</dt><dd className="font-medium text-texto">{statusLabel(dataset?.evaluation_status ?? "pending")}</dd></div>
            </dl>
            {!readyForTraining && <div className="mt-5 rounded-2xl border border-aviso/25 bg-aviso-suave px-4 py-3 text-sm leading-6 text-texto">El envío permanece bloqueado hasta completar cobertura, licencia, captions y revisión.</div>}
            {readyForTraining && <div className="mt-5 flex items-center gap-2 rounded-2xl border border-exito/25 bg-exito-suave px-4 py-3 text-sm text-texto"><CheckCircle2 className="size-4 text-exito" aria-hidden="true" />Dataset listo para revisión final.</div>}
          </section>
        </div>
      )}

      <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7" aria-labelledby="historial-estructuras-heading">
        <div className="flex items-start justify-between gap-3"><div><h3 id="historial-estructuras-heading" className="text-sm font-semibold text-texto">Historial y pesos independientes</h3><p className="mt-1 text-sm text-texto-suave">Los pesos de estructuras solo se activan después de una evaluación aprobada.</p></div><span className="text-xs text-texto-suave">{artifacts.length} artifact(s) respaldado(s)</span></div>
        {trainings.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-borde px-4 py-6 text-center text-sm text-texto-suave">Todavía no hay corridas de estructuras.</p> : <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs text-texto-suave"><tr><th className="px-3 py-2 font-semibold">Corrida</th><th className="px-3 py-2 font-semibold">Estado</th><th className="px-3 py-2 font-semibold">Parámetros</th><th className="px-3 py-2 font-semibold">Creada</th></tr></thead><tbody>{trainings.map((training) => <tr key={training.id} className="border-t border-borde"><td className="px-3 py-3 font-medium text-texto">{training.label}</td><td className="px-3 py-3 text-texto">{statusLabel(training.status)}</td><td className="px-3 py-3 text-texto-suave">{training.steps} pasos · LR {training.learning_rate}</td><td className="px-3 py-3 text-texto-suave">{dateFormat.format(new Date(training.created_at))}</td></tr>)}</tbody></table></div>}
      </section>

      {wizardOpen && <LoraTrainingWizard specialization="structure" onClose={() => setWizardOpen(false)} onStarted={() => { setWizardOpen(false); void load(); }} />}
    </section>
  );
}
