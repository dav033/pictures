"use client";

export type ResultadoComparacion = {
  id: "gemini" | "lora";
  nombre: string;
  modelo: string;
  imagen?: string;
  error?: string;
};

type Props = {
  resultados: ResultadoComparacion[];
  onOpen: (src: string) => void;
};

export function ComparacionModelos({ resultados, onOpen }: Props) {
  if (!resultados.length) return null;

  const imagenesDisponibles = resultados.filter((resultado) => resultado.imagen).length;

  return (
    <section className="material-panel space-y-3" aria-labelledby="comparacion-modelos-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="material-kicker">Laboratorio visual</p>
          <h2 id="comparacion-modelos-title" className="mt-1 text-sm font-semibold text-texto">
            Comparación de modelos
          </h2>
          <p className="mt-1 text-xs leading-5 text-texto-suave">
            Misma propuesta, dos salidas separadas para decidir con criterio.
          </p>
        </div>
        <span className="material-status">{imagenesDisponibles}/2 imágenes</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {resultados.map((resultado) => (
          <article key={resultado.id} className="material-comparison-card">
            <div className="flex items-center justify-between gap-2 px-3 pt-3">
              <div>
                <h3 className="text-xs font-semibold text-texto">{resultado.nombre}</h3>
                <p className="mt-0.5 text-[10px] text-texto-suave">{resultado.modelo}</p>
              </div>
              <span className="material-status">{resultado.imagen ? "Generada" : "No disponible"}</span>
            </div>

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
          </article>
        ))}
      </div>

      <p className="text-[11px] leading-4 text-texto-suave">
        La salida de Gemini conserva referencias e imágenes del espacio; LoRA compara el estilo aprendido desde texto.
      </p>
    </section>
  );
}
