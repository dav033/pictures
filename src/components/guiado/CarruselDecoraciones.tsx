import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { FotoDecoracion } from "./FotoDecoracion";
import { Check } from "lucide-react";

type Props = {
  decoraciones: DecoracionSempertex[];
  /** Solo el carrusel del último mensaje se puede elegir; los anteriores quedan como historia. */
  activo: boolean;
  elegidaId: string | null;
  onElegir: (decoracion: DecoracionSempertex) => void;
  onNinguna: () => void;
};

export function CarruselDecoraciones({ decoraciones, activo, elegidaId, onElegir, onNinguna }: Props) {
  return (
    <section aria-label="Ideas de decoración" className="mt-4">
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3" data-testid="carrusel-decoraciones">
        {decoraciones.map((decoracion) => {
          const elegida = decoracion.id === elegidaId;
          return (
            <article key={decoracion.id} className={`w-[min(78vw,17rem)] shrink-0 snap-start overflow-hidden rounded-2xl border bg-superficie shadow-sm transition ${elegida ? "border-acento ring-2 ring-acento/30" : "border-borde-suave"} ${!activo && !elegida ? "opacity-50" : ""}`}>
              <div className="relative aspect-[4/3] bg-[#f7f1eb]">
                <FotoDecoracion decoracion={decoracion} sizes="(max-width: 640px) 78vw, 272px" />
                <span className="absolute left-2.5 top-2.5 flex gap-1.5">
                  {decoracion.origen === "ejemplo" && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[0.7rem] font-semibold text-[#6d3c39] shadow-sm">Ejemplo</span>}
                  {decoracion.origen === "referencia_real" && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[0.7rem] font-medium text-texto-secundario shadow-sm">Referencia</span>}
                  {decoracion.coincidencia === "cercana" && <span className="rounded-full bg-white/90 px-2 py-0.5 text-[0.7rem] font-semibold text-[#5b4a6b] shadow-sm">Parecida</span>}
                </span>
                {elegida && <span className="absolute right-2.5 top-2.5 grid size-7 place-items-center rounded-full bg-acento text-white shadow"><Check className="size-4" aria-label="Elegida" /></span>}
              </div>
              <div className="p-4">
                <h3 className="font-semibold leading-snug">{decoracion.titulo}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-texto-secundario">{decoracion.tematica}</p>
                {activo && <button type="button" className="mt-4 w-full rounded-xl bg-acento px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-acento-hover" onClick={() => onElegir(decoracion)}>Me gusta esta</button>}
              </div>
            </article>
          );
        })}
      </div>
      {activo && <button type="button" onClick={onNinguna} className="mt-1 text-sm font-medium text-acento underline-offset-4 hover:underline">Ninguna me convence</button>}
    </section>
  );
}
