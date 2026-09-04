"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import LoraTrainingWizard from "./LoraTrainingWizard";

type Slot = {
  slug: string;
  display_name: string;
  training_run_id: string | null;
  enforce_dataset_allowlist: boolean;
  lora_scale: number;
  enabled: boolean;
  updated_at: string;
};

type TrainingRun = {
  id: string;
  label: string;
  dataset_id: string;
  dataset_label: string;
  specialization: "product" | "structure";
  image_count: number;
  caption_count: number;
  coverage_status: string;
  provider: string;
  trainer_endpoint: string;
  steps: number;
  learning_rate: number;
  estimated_epochs: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  status: string;
  artifact_status: string;
  provider_request_id: string | null;
  weight_storage_key: string | null;
  weight_sha256: string | null;
  rank: number | null;
  architecture: string | null;
  evaluation_verdict: string | null;
  evaluation_passed_count: number | null;
  evaluation_total_count: number | null;
  evaluation_lora_scale: number | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  received_at: string | null;
};

type Job = {
  id: string;
  kind: string;
  resource_id: string;
  status: string;
  attempts: number;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

type Overview = {
  slots: Slot[];
  recentRuns: TrainingRun[];
  recentJobs: Job[];
  alerts: string[];
};

type LoadState = "loading" | "ready" | "error";

const numberFormat = new Intl.NumberFormat("es-CO");
const currencyFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" });

function formatDate(value: string | null): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha inválida" : dateFormat.format(date);
}

function formatMoney(value: number | null): string {
  return value == null ? "Sin estimar" : currencyFormat.format(value);
}

function formatAlert(value: string): string {
  const [code, detail] = value.split(":");
  if (code === "slot_sin_corrida") return `Slot sin corrida asignada: ${detail ?? "desconocido"}`;
  if (code === "datasets_con_cobertura_parcial") return `${detail ?? "Hay"} dataset(s) con cobertura parcial`;
  if (code === "jobs_fallidos") return `${detail ?? "Hay"} job(s) fallido(s) que requieren revisión`;
  return value;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const successful = ["succeeded", "completed", "approved", "backed_up"].includes(normalized);
  const failed = ["failed", "rejected", "invalid", "cancelled"].includes(normalized);
  const label: Record<string, string> = {
    succeeded: "Completada",
    completed: "Completada",
    approved: "Aprobada",
    backed_up: "Respaldado",
    failed: "Fallida",
    rejected: "Rechazada",
    invalid: "Inválido",
    cancelled: "Cancelada",
    queued: "En cola",
    running: "En curso",
    uploading: "Subiendo",
    pending: "Pendiente",
    draft: "Borrador",
  };
  const Icon = successful ? CheckCircle2 : failed ? XCircle : Clock3;
  const tone = successful
    ? "border-exito/20 bg-exito-suave text-exito"
    : failed
      ? "border-error/20 bg-error-suave text-error"
      : "border-aviso/20 bg-aviso-suave text-aviso";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {label[normalized] ?? status}
    </span>
  );
}

function ModeCard({ slot, run }: { slot: Slot; run: TrainingRun | undefined }) {
  const status = !slot.enabled ? "Desactivado" : !run ? "Sin corrida" : run.status;
  const modeLabel = slot.enforce_dataset_allowlist ? "Dataset restringido" : "Dataset abierto";
  const isReady = slot.enabled && ["succeeded", "completed"].includes(run?.status ?? "") && run?.artifact_status === "backed_up";

  return (
    <article className="rounded-2xl border border-borde bg-superficie p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-texto">{slot.display_name}</h3>
          <p className="mt-1 text-xs text-texto-suave">Actualizado {formatDate(slot.updated_at)}</p>
        </div>
        <span
          className={`mt-0.5 size-2.5 shrink-0 rounded-full ${isReady ? "bg-exito" : slot.enabled ? "bg-aviso" : "bg-texto-suave"}`}
          aria-label={isReady ? "Activo" : status}
        />
      </div>

      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-texto-suave">Corrida</dt>
          <dd className="max-w-[13rem] break-words text-right font-medium text-texto">{run?.label ?? "Sin asignar"}</dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="text-texto-suave">Dataset</dt>
          <dd className="max-w-[13rem] text-right font-medium text-texto">
            {run ? `${run.dataset_label} · ${numberFormat.format(run.image_count)} imágenes` : "Pendiente"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-borde pt-4 text-xs text-texto-suave">
        <span className="rounded-full bg-superficie-2 px-2.5 py-1">Escala {slot.lora_scale}</span>
        <span className="rounded-full bg-superficie-2 px-2.5 py-1">{modeLabel}</span>
        <StatusBadge status={status} />
      </div>
    </article>
  );
}

function RunEvaluation({ run }: { run: TrainingRun }) {
  if (!run.evaluation_verdict) return <span className="text-texto-suave">Pendiente</span>;
  if (run.evaluation_passed_count == null || run.evaluation_total_count == null) {
    return <StatusBadge status={run.evaluation_verdict} />;
  }
  return (
    <div className="space-y-1">
      <StatusBadge status={run.evaluation_verdict} />
      <p className="text-xs text-texto-suave">
        {run.evaluation_passed_count}/{run.evaluation_total_count} · escala {run.evaluation_lora_scale ?? "—"}
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <section className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7" aria-label="Cargando registro LoRA">
      <div className="animate-pulse space-y-5">
        <div className="h-5 w-56 rounded bg-superficie-2" />
        <div className="grid gap-3 lg:grid-cols-3">
          {[1, 2, 3].map((item) => <div key={item} className="h-44 rounded-2xl bg-superficie-2" />)}
        </div>
        <div className="h-32 rounded-2xl bg-superficie-2" />
      </div>
    </section>
  );
}

export default function LoraRegistryPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const loadOverview = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const response = await fetch("/api/lora/overview", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload = (await response.json()) as Overview | { message?: string };
      if (!response.ok || !("slots" in payload)) {
        throw new Error("message" in payload ? payload.message : "No se pudo leer el registro LoRA");
      }
      setData(payload);
      setUpdatedAt(new Date().toISOString());
      setState("ready");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo leer el registro LoRA");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  const runsById = useMemo(() => new Map((data?.recentRuns ?? []).map((run) => [run.id, run])), [data?.recentRuns]);

  if (state === "loading" && !data) return <LoadingPanel />;

  if (state === "error" && !data) {
    return (
      <section className="rounded-3xl border border-error/30 bg-error-suave p-5 sm:p-7" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-error" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-texto">Registro LoRA no disponible</h2>
            <p className="mt-1 text-sm leading-6 text-texto-suave">{error ?? "Revisa la conexión y vuelve a intentarlo."}</p>
            <button type="button" className="ui-button-secondary mt-4" onClick={() => void loadOverview()}>
              Reintentar
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const hasAlerts = data.alerts.length > 0;
  const systemLabel = hasAlerts ? "Requiere revisión" : "Todo operativo";

  return (
    <section className="space-y-5" aria-labelledby="registro-lora-heading">
      <div className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-texto-suave">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${hasAlerts ? "bg-aviso-suave text-aviso" : "bg-exito-suave text-exito"}`}>
                {hasAlerts ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
                {systemLabel}
              </span>
              <span>Registro conectado</span>
            </div>
            <h2 id="registro-lora-heading" className="mt-3 text-xl font-semibold tracking-tight text-texto">Control de entrenamientos</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-texto-suave">
              Estado vivo de datasets, corridas y modos activos. El envío requiere revisar parámetros y confirmar el posible cobro.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ui-button-primary" onClick={() => setWizardOpen(true)}>Nuevo entrenamiento</button>
            <button type="button" className="ui-button-secondary" onClick={() => void loadOverview()} disabled={state === "loading"}>
              <RefreshCw className={`mr-2 size-4 ${state === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
              {state === "loading" ? "Actualizando" : "Actualizar"}
            </button>
          </div>
        </div>

        {updatedAt && <p className="mt-4 text-xs text-texto-suave">Última lectura: {formatDate(updatedAt)}</p>}
      </div>

      {wizardOpen && <LoraTrainingWizard onClose={() => setWizardOpen(false)} onStarted={() => { void loadOverview(); }} />}

      {hasAlerts && (
        <div className="rounded-2xl border border-aviso/30 bg-aviso-suave px-4 py-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aviso" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-texto">Alertas del registro</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-6 text-texto-suave">
                {data.alerts.map((alert) => <li key={alert}>{formatAlert(alert)}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-texto">Modos activos</h2>
            <p className="mt-1 text-sm text-texto-suave">Asignaciones que usa el generador en producción.</p>
          </div>
          <ShieldCheck className="size-5 text-acento" aria-hidden="true" />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {data.slots.map((slot) => <ModeCard key={slot.slug} slot={slot} run={slot.training_run_id ? runsById.get(slot.training_run_id) : undefined} />)}
        </div>
      </div>

      <div className="rounded-3xl border border-borde bg-superficie p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-texto">Entrenamientos recientes</h2>
            <p className="mt-1 text-sm text-texto-suave">Historial auditable y solicitudes enviadas desde este panel.</p>
          </div>
          <Database className="size-5 text-acento" aria-hidden="true" />
        </div>

        {data.recentRuns.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-borde bg-fondo px-4 py-6 text-center">
            <Archive className="mx-auto size-5 text-texto-suave" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-texto">Todavía no hay corridas registradas</p>
            <p className="mt-1 text-sm text-texto-suave">El asistente de nuevo entrenamiento llegará en la siguiente fase.</p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-borde">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-superficie-2 text-xs text-texto-suave">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Corrida / dataset</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Estado</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Parámetros</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Evaluación</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Artefacto</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Creada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {data.recentRuns.map((run) => {
                  const assignedSlots = data.slots.filter((slot) => slot.training_run_id === run.id).map((slot) => slot.display_name);
                  return (
                    <tr key={run.id} className="align-top">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-texto">{run.label}</p>
                        <p className="mt-1 text-xs font-semibold text-acento">{run.specialization === "structure" ? "Estructuras" : "Producto"}</p>
                        <p className="mt-1 text-xs text-texto-suave">{run.dataset_label} · {numberFormat.format(run.image_count)} imágenes</p>
                        <p className="mt-1 text-xs text-texto-suave">{run.coverage_status === "partial" ? "Cobertura parcial" : "Cobertura completa"}</p>
                        {assignedSlots.length > 0 && <p className="mt-2 text-xs font-medium text-acento">{assignedSlots.join(" · ")}</p>}
                      </td>
                      <td className="px-4 py-4"><StatusBadge status={run.status} /></td>
                      <td className="px-4 py-4 text-xs leading-5 text-texto-suave">
                        <p>{numberFormat.format(run.steps)} pasos</p>
                        <p>LR {run.learning_rate}</p>
                        <p>{formatMoney(run.actual_cost_usd ?? run.estimated_cost_usd)}</p>
                      </td>
                      <td className="px-4 py-4"><RunEvaluation run={run} /></td>
                      <td className="px-4 py-4"><StatusBadge status={run.artifact_status} /></td>
                      <td className="px-4 py-4 text-xs text-texto-suave">{formatDate(run.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {state === "error" && error && (
        <p className="text-xs text-error" role="status">Lectura actualizada con error: {error}</p>
      )}
    </section>
  );
}
