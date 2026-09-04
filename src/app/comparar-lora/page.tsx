"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Caso = "cumpleanos" | "xv";

type Resultado = {
  caso: Caso;
  plan: { titulo: string; estructuras: Array<{ id: string; nombre: string; tipo: string; ubicacion: string }> };
  promptV1: string;
  promptV2: string;
  compilerVersion: string;
  preflight: { ok: boolean; errors: string[]; warnings: string[] };
};

const CASOS: Record<Caso, string> = {
  cumpleanos: "Cumpleaños — arco rojo y dorado en la entrada",
  xv: "XV años — arco central + columnas + centro de mesa",
};

export default function CompararLoraPage() {
  const [caso, setCaso] = useState<Caso>("cumpleanos");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError(null);
      try {
        const response = await fetch(`/api/debug/lora-prompt-compare?caso=${caso}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!cancelado) setResultado(data);
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : "error desconocido");
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    void cargar();
    return () => { cancelado = true; };
  }, [caso]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Comparar prompt LoRA v1 vs v2</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Compara el texto exacto que se le manda al modelo de imágenes, sin generar ninguna imagen ni llamar a fal.ai.
      </p>

      <div className="mt-6 w-80">
        <Select value={caso} onValueChange={(value) => setCaso(value as Caso)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CASOS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {cargando && <p className="mt-6 text-sm text-neutral-500">Compilando prompts…</p>}
      {error && <p className="mt-6 text-sm text-red-600">Error: {error}</p>}

      {resultado && !cargando && (
        <div className="mt-8 space-y-8">
          <div>
            <h2 className="text-sm font-medium text-neutral-500">Plan: {resultado.plan.titulo}</h2>
            <ul className="mt-1 text-sm text-neutral-600">
              {resultado.plan.estructuras.map((estructura) => (
                <li key={estructura.id}>{estructura.nombre} — {estructura.tipo} en {estructura.ubicacion}</li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-neutral-200 p-4">
              <h3 className="text-sm font-semibold">V1 (legacy)</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{resultado.promptV1}</p>
              <p className="mt-3 text-xs text-neutral-400">{resultado.promptV1.length} caracteres</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-4">
              <h3 className="text-sm font-semibold">V2 (compilador — {resultado.compilerVersion})</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{resultado.promptV2}</p>
              <p className="mt-3 text-xs text-neutral-400">{resultado.promptV2.length} caracteres</p>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 p-4">
            <h3 className="text-sm font-semibold">
              Preflight V2: {resultado.preflight.ok ? <span className="text-green-600">OK</span> : <span className="text-red-600">bloqueado</span>}
            </h3>
            {resultado.preflight.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-red-600">
                {resultado.preflight.errors.map((err) => <li key={err}>{err}</li>)}
              </ul>
            )}
            {resultado.preflight.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-600">
                {resultado.preflight.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
