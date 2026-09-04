"use client";

import { useState } from "react";
import type { ImageQaReport } from "@/lib/ia/image-qa";
import type { LoraPromptPreflightReport } from "@/lib/ia/lora-prompt-preflight";

export type ResultadoComparacion = {
  id: "gemini" | "lora" | "lora-v1" | "lora-v2" | "lora-wrapper";
  nombre: string;
  modelo: string;
  imagen?: string;
  error?: string;
  prompt?: string;
  promptVersion?: string;
  promptHash?: string;
  compilerVersion?: string;
  seed?: number;
  qa?: ImageQaReport;
  preflight?: LoraPromptPreflightReport;
};

type Props = {
  resultados: ResultadoComparacion[];
  onOpen: (src: string) => void;
};

export function ComparacionModelos({ resultados, onOpen }: Props) {
  const [votos, setVotos] = useState<Record<string, "mejor" | "empate" | "peor">>({});
  const [razones, setRazones] = useState<Record<string, string>>({});
  if (!resultados.length) return null;

  const imagenesDisponibles = resultados.filter((resultado) => resultado.imagen).length;
  const comparacionLora = resultados.some((resultado) => ["lora-v1", "lora-v2", "lora-wrapper"].includes(resultado.id));

  return (
    <section className="material-panel space-y-3" aria-labelledby="comparacion-modelos-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="material-kicker">Laboratorio visual</p>
          <h2 id="comparacion-modelos-title" className="mt-1 text-sm font-semibold text-texto">
            {comparacionLora ? "Comparación de prompts LoRA" : "Comparación de modelos"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-texto-suave">
            {comparacionLora ? "Misma semilla y escena; cambia solo el texto enviado al modelo." : "Misma propuesta, dos salidas separadas para decidir con criterio."}
          </p>
        </div>
        <span className="material-status">{imagenesDisponibles}/{resultados.length} imágenes</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {resultados.map((resultado) => (
          <article key={resultado.id} className="material-comparison-card">
            <div className="flex items-center justify-between gap-2 px-3 pt-3">
              <div>
                <h3 className="text-xs font-semibold text-texto">{resultado.nombre}</h3>
                <p className="mt-0.5 text-[10px] text-texto-suave">{resultado.modelo}</p>
              </div>
              <span className="material-status">{resultado.imagen ? "Generada" : "No disponible"}</span>
            </div>

            {(resultado.promptVersion || resultado.seed !== undefined) && (
              <p className="px-3 pt-2 text-[10px] leading-4 text-texto-suave">
                {resultado.promptVersion ? `Versión ${resultado.promptVersion}` : ""}
                {resultado.seed !== undefined ? ` · seed ${resultado.seed}` : ""}
                {resultado.promptHash ? ` Â· hash ${resultado.promptHash.slice(0, 10)}` : ""}
              </p>
            )}

            {resultado.imagen ? (
              <button
                type="button"
                onClick={() => onOpen(resultado.imagen!)}
                className="ui-pressable group mt-3 block w-full overflow-hidden text-left"
                aria-label={`Ampliar resultado de ${resultado.nombre}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultado.imagen}
                  alt={`Resultado generado con ${resultado.nombre}`}
                  className="aspect-[3/2] w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                />
              </button>
            ) : (
              <div className="mx-3 mt-3 flex aspect-[3/2] items-center justify-center rounded-xl bg-superficie-2 p-4 text-center text-xs text-texto-suave">
                {resultado.error ?? "No hubo resultado."}
              </div>
            )}

            {resultado.error && resultado.imagen && (
              <p className="px-3 py-2 text-[11px] text-aviso">Aviso: {resultado.error}</p>
            )}
            {resultado.qa && (
              <details className="border-t border-borde px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-acento">QA independiente: {resultado.qa.pass === true ? "conforme" : resultado.qa.pass === false ? "con observaciones" : "sin concluir"}</summary>
                <p className="mt-2 text-[10px] leading-4 text-texto-suave">
                  Estructuras {resultado.qa.required_elements.filter((item) => item.present).length}/{resultado.qa.required_elements.length}
                  {resultado.qa.retry_reasons.length ? ` · ${resultado.qa.retry_reasons.slice(0, 2).join("; ")}` : " · sin fallos"}
                </p>
              </details>
            )}
            {resultado.preflight && (
              <details className="border-t border-borde px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-acento">Preflight: {resultado.preflight.ok ? "OK" : "bloqueado"}</summary>
                <p className="mt-2 text-[10px] leading-4 text-texto-suave">
                  Estructuras {resultado.preflight.structures.represented}/{resultado.preflight.structures.expected} · ubicaciones {resultado.preflight.locations.represented}/{resultado.preflight.locations.expected} · relaciones {resultado.preflight.relationships.represented}/{resultado.preflight.relationships.expected}
                </p>
              </details>
            )}
            {comparacionLora && resultado.imagen && (
              <div className="border-t border-borde px-3 py-2">
                <p className="text-[10px] font-medium text-texto-suave">Voto manual</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(["mejor", "empate", "peor"] as const).map((voto) => (
                    <button
                      key={voto}
                      type="button"
                      onClick={() => setVotos((previo) => ({ ...previo, [resultado.id]: voto }))}
                      className={`rounded-md border px-2 py-1 text-[10px] ${votos[resultado.id] === voto ? "border-acento bg-acento-suave text-acento" : "border-borde text-texto-suave"}`}
                    >
                      {voto}
                    </button>
                  ))}
                </div>
                <input
                  value={razones[resultado.id] ?? ""}
                  onChange={(event) => setRazones((previo) => ({ ...previo, [resultado.id]: event.target.value.slice(0, 120) }))}
                  placeholder="Razón corta"
                  aria-label={`Razón del voto para ${resultado.nombre}`}
                  className="mt-2 w-full rounded-md border border-borde bg-fondo px-2 py-1 text-[10px] text-texto outline-none focus:border-acento"
                />
              </div>
            )}
            {resultado.prompt && (
              <details className="border-t border-borde px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-acento">Ver prompt enviado</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-superficie-2 p-2 text-[10px] leading-4 text-texto-suave">{resultado.prompt}</pre>
              </details>
            )}
          </article>
        ))}
      </div>

      <p className="text-[11px] leading-4 text-texto-suave">
        {comparacionLora ? "La comparación aísla el texto: v1 y v2 usan el mismo LoRA y la misma semilla." : "La salida de Gemini conserva referencias e imágenes del espacio; LoRA compara el estilo aprendido desde texto."}
      </p>
    </section>
  );
}
