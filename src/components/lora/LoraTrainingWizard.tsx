"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, CircleDollarSign, Database, LockKeyhole, X } from "lucide-react";

type Dataset = {
  id: string;
  label: string;
  specialization?: "product" | "structure";
  status: string;
  trigger_token: string;
  image_count: number;
  caption_count: number;
  coverage_status: string;
  zip_storage_key: string | null;
  license_status?: string;
  evaluation_status?: string;
  structure_types?: unknown;
};

type Draft = {
  id: string;
  label: string;
  status: string;
  estimated_cost_usd: number;
  dataset: {
    id: string;
    label: string;
    imageCount: number;
    captionCount: number;
    coverageStatus: string;
  };
};

type Stage = "configure" | "confirm" | "sending" | "sent";

const DEFAULT_COST_PER_STEP_USD = 0.0064;
const currencyFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

async function apiMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: string };
    return payload.message ?? "La operación no pudo completarse.";
  } catch {
    return "La operación no pudo completarse.";
  }
}

export default function LoraTrainingWizard({ onClose, onStarted, specialization = "product" }: { onClose: () => void; onStarted: () => void; specialization?: "product" | "structure" }) {
  const isStructure = specialization === "structure";
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(true);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState("");
  const [label, setLabel] = useState(isStructure ? "structure-v001-1000" : "nueva-corrida-1000");
  const [steps, setSteps] = useState("1000");
  const [learningRate, setLearningRate] = useState("0.00005");
  const [stage, setStage] = useState<Stage>("configure");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/lora/datasets?specialization=${specialization}`, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiMessage(response));
        return await response.json() as { datasets?: Dataset[] };
      })
      .then((payload) => {
        if (!active) return;
        const ready = (payload.datasets ?? []).filter((dataset) => dataset.status === "ready" && dataset.zip_storage_key && (dataset.specialization ?? "product") === specialization);
        setDatasets(ready);
        setDatasetId((current) => current || ready[0]?.id || "");
        setDatasetsLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setDatasetsError(loadError instanceof Error ? loadError.message : "No se pudieron cargar datasets.");
        setDatasetsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [specialization]);

  const selectedDataset = useMemo(() => datasets.find((dataset) => dataset.id === datasetId), [datasets, datasetId]);
  const parsedSteps = Number(steps);
  const parsedLearningRate = Number(learningRate);
  const estimatedCost = Number.isInteger(parsedSteps) && parsedSteps > 0 ? parsedSteps * DEFAULT_COST_PER_STEP_USD : 0;
  const validConfiguration = Boolean(
    selectedDataset
      && /^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(label)
      && Number.isInteger(parsedSteps)
      && parsedSteps >= 100
      && parsedSteps <= 2000
      && parsedLearningRate > 0
      && parsedLearningRate <= 0.0001,
  );

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validConfiguration || !selectedDataset) return;
    setError(null);
    setStage("sending");
    try {
      const response = await fetch("/api/lora/trainings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ datasetId, label, specialization, steps: parsedSteps, learningRate: parsedLearningRate }),
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      const payload = await response.json() as { training: Draft };
      setDraft(payload.training);
      setStage("confirm");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo preparar la corrida.");
      setStage("configure");
    }
  }

  async function startTraining() {
    if (!draft || !confirmChecked || confirmText !== "ENVIAR ENTRENAMIENTO") return;
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    setError(null);
    setStage("sending");
    try {
      const response = await fetch(`/api/lora/trainings/${encodeURIComponent(draft.id)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ confirmText, idempotencyKey: key }),
      });
      if (!response.ok) throw new Error(await apiMessage(response));
      setStage("sent");
      onStarted();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "No se pudo enviar el entrenamiento.");
      setStage("confirm");
    }
  }

  return (
    <section className="rounded-3xl border border-acento/30 bg-superficie p-5 shadow-sm sm:p-7" aria-labelledby="nuevo-entrenamiento-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-acento">{isStructure ? "Estructuras" : "Producto"}</p>
          <h2 id="nuevo-entrenamiento-heading" className="mt-2 text-xl font-semibold tracking-tight text-texto">Enviar entrenamiento</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-texto-suave">Prepara una corrida, revisa su estimación y confirma el envío pagado a fal.ai.</p>
        </div>
        <button type="button" className="rounded-xl p-2 text-texto-suave hover:bg-superficie-2 hover:text-texto" onClick={onClose} aria-label="Cerrar nuevo entrenamiento">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <ol className="mt-6 grid gap-2 sm:grid-cols-3" aria-label="Progreso del envío">
        {["Configurar", "Confirmar", "Enviado"].map((step, index) => {
          const active = index === 0 ? stage === "configure" : index === 1 ? stage === "confirm" : stage === "sent";
          const complete = index === 0 ? stage !== "configure" : index === 1 ? stage === "sent" : false;
          return (
            <li key={step} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${active ? "bg-acento-suave text-acento" : complete ? "bg-exito-suave text-exito" : "bg-superficie-2 text-texto-suave"}`}>
              <span className="flex size-5 items-center justify-center rounded-full border border-current text-[0.7rem]">{complete ? "✓" : index + 1}</span>
              {step}
            </li>
          );
        })}
      </ol>

      {stage === "configure" || stage === "sending" && !draft ? (
        <form className="mt-6 space-y-5" onSubmit={createDraft}>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <div className="space-y-4">
              <div>
                <label htmlFor="lora-dataset" className="text-sm font-semibold text-texto">Dataset</label>
                <p className="mt-1 text-xs leading-5 text-texto-suave">Solo aparecen datasets de {isStructure ? "estructuras" : "producto"} listos, con ZIP y manifiesto respaldados.</p>
                {datasetsLoading ? (
                  <div className="mt-2 h-11 animate-pulse rounded-xl bg-superficie-2" />
                ) : datasetsError ? (
                  <p className="mt-2 rounded-xl bg-error-suave px-3 py-2 text-sm text-error" role="alert">{datasetsError}</p>
                ) : datasets.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-aviso-suave px-3 py-2 text-sm text-texto">No hay datasets listos para enviar.</p>
                ) : (
                  <select id="lora-dataset" value={datasetId} onChange={(event) => setDatasetId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-borde bg-superficie px-3 text-sm text-texto">
                    {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.label} · {dataset.image_count} imágenes</option>)}
                  </select>
                )}
              </div>

              <div>
                <label htmlFor="lora-label" className="text-sm font-semibold text-texto">Etiqueta de corrida</label>
                <input id="lora-label" value={label} onChange={(event) => setLabel(event.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,80}" required className="mt-2 min-h-11 w-full rounded-xl border border-borde bg-superficie px-3 text-sm text-texto" />
                <p className="mt-1 text-xs text-texto-suave">Única en el historial. Ejemplo: v005-1000.</p>
              </div>
            </div>

            <div className="rounded-2xl bg-superficie-2 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-texto"><Database className="size-4 text-acento" aria-hidden="true" /> Parámetros</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <label className="text-xs font-semibold text-texto-suave">Pasos
                  <input type="number" min="100" max="2000" step="100" value={steps} onChange={(event) => setSteps(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-borde bg-superficie px-3 text-sm font-normal text-texto" />
                </label>
                <label className="text-xs font-semibold text-texto-suave">Learning rate
                  <input type="number" min="0.000001" max="0.0001" step="0.00001" value={learningRate} onChange={(event) => setLearningRate(event.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-borde bg-superficie px-3 text-sm font-normal text-texto" />
                </label>
              </div>
            </div>
          </div>

          {selectedDataset?.coverage_status === "partial" && (
            <div className="flex items-start gap-3 rounded-2xl border border-aviso/30 bg-aviso-suave px-4 py-3 text-sm leading-6 text-texto">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aviso" aria-hidden="true" />
              <p><strong>Cobertura parcial.</strong> Dataset tiene imágenes válidas, pero algunas relaciones de catálogo aún no están revisadas.</p>
            </div>
          )}

          {isStructure && selectedDataset && (selectedDataset.license_status !== "verified" || selectedDataset.evaluation_status !== "approved") && (
            <div className="flex items-start gap-3 rounded-2xl border border-aviso/30 bg-aviso-suave px-4 py-3 text-sm leading-6 text-texto">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-aviso" aria-hidden="true" />
              <p><strong>Entrenamiento bloqueado.</strong> Estructuras requiere licencia verificada y revisión aprobada antes de crear una corrida pagada.</p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-5">
            <p className="text-sm text-texto-suave">Estimación local: <strong className="text-texto">{currencyFormat.format(estimatedCost)}</strong> · no es cobro todavía.</p>
            <button type="submit" className="ui-button-primary" disabled={!validConfiguration || stage === "sending" || datasetsLoading}>
              {stage === "sending" ? "Preparando…" : "Revisar envío"}
            </button>
          </div>
        </form>
      ) : stage === "confirm" && draft ? (
        <div className="mt-6 space-y-5">
          <div className="rounded-2xl border border-borde bg-superficie-2 p-4 sm:p-5">
            <p className="text-sm font-semibold text-texto">Revisión antes de enviar</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-texto-suave">Corrida</dt><dd className="mt-1 font-semibold text-texto">{draft.label}</dd></div>
              <div><dt className="text-xs text-texto-suave">Dataset</dt><dd className="mt-1 font-semibold text-texto">{draft.dataset.label} · {draft.dataset.imageCount} imágenes</dd></div>
              <div><dt className="text-xs text-texto-suave">Costo estimado</dt><dd className="mt-1 font-semibold text-texto">{currencyFormat.format(draft.estimated_cost_usd)}</dd></div>
              <div><dt className="text-xs text-texto-suave">Proveedor</dt><dd className="mt-1 font-semibold text-texto">fal.ai · FLUX.2 LoRA</dd></div>
            </dl>
          </div>

          <div className="rounded-2xl border border-error/30 bg-error-suave p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <CircleDollarSign className="mt-0.5 size-5 shrink-0 text-error" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-texto">Este paso puede generar un cobro real</p>
                <p className="mt-1 text-sm leading-6 text-texto-suave">Se subirá el ZIP y se creará una solicitud de entrenamiento. El costo mostrado es una estimación; fal.ai factura según su tarifa vigente.</p>
              </div>
            </div>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-texto">
              <input type="checkbox" checked={confirmChecked} onChange={(event) => setConfirmChecked(event.target.checked)} className="mt-1 size-4 accent-[var(--acento)]" />
              <span>Confirmo dataset, parámetros y posible cobro.</span>
            </label>
            <label htmlFor="lora-confirm-text" className="mt-4 block text-xs font-semibold text-texto-suave">Escribe ENVIAR ENTRENAMIENTO</label>
            <input id="lora-confirm-text" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" className="mt-1 min-h-11 w-full rounded-xl border border-borde bg-superficie px-3 text-sm font-semibold uppercase tracking-wide text-texto" />
          </div>

          {error && <p className="rounded-xl bg-error-suave px-3 py-2 text-sm text-error" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" className="ui-button-secondary" onClick={() => { setError(null); setStage("configure"); }}><ChevronLeft className="mr-2 size-4" aria-hidden="true" />Cambiar parámetros</button>
            <button type="button" className="ui-button-primary" onClick={() => void startTraining()} disabled={!confirmChecked || confirmText !== "ENVIAR ENTRENAMIENTO"}>
              <LockKeyhole className="mr-2 size-4" aria-hidden="true" />Enviar entrenamiento pagado
            </button>
          </div>
        </div>
      ) : stage === "sending" ? (
        <div className="mt-6 rounded-2xl bg-superficie-2 px-4 py-8 text-center">
          <CircleDollarSign className="mx-auto size-6 animate-pulse text-acento" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-texto">Enviando solicitud a fal.ai…</p>
          <p className="mt-1 text-sm text-texto-suave">No cierres esta ventana.</p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-exito/30 bg-exito-suave px-4 py-6 text-center">
          <CheckCircle2 className="mx-auto size-6 text-exito" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-texto">Entrenamiento enviado</p>
          <p className="mt-1 text-sm text-texto-suave">La corrida quedó en cola. El historial se actualizará al sincronizar su estado.</p>
          <button type="button" className="ui-button-secondary mt-4" onClick={onClose}>Cerrar</button>
        </div>
      )}
    </section>
  );
}
