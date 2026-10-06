import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import Image from "next/image";

type Props = { decoraciones: DecoracionSempertex[]; onElegir: (decoracion: DecoracionSempertex, gusta: boolean) => void };

export function CarruselDecoraciones({ decoraciones, onElegir }: Props) {
  return (
    <section aria-label="Ideas de decoración" className="mt-3">
      <div className="mb-3 flex items-baseline justify-between gap-3"><h2 className="text-base font-semibold">Ideas Sempertex</h2><span className="text-xs text-texto-secundario">Contenido de ejemplo</span></div>
      <div className="flex snap-x gap-4 overflow-x-auto pb-3" data-testid="carrusel-decoraciones">
        {decoraciones.map((decoracion) => (
          <article key={decoracion.id} className="w-[min(82vw,21rem)] shrink-0 snap-start overflow-hidden rounded-2xl bg-superficie">
            <div className="relative aspect-[1.52] bg-[#f7f1eb]">
              {/* Ilustración sintética local, nunca presentada como foto real. */}
              <Image src={decoracion.fotos[0]?.url ?? "/biblioteca-sempertex/decoracion-ejemplo.svg"} alt={`Ilustración de ejemplo: ${decoracion.titulo}`} fill sizes="(max-width: 640px) 82vw, 336px" unoptimized className="object-cover" />
              <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#6d3c39]">Ejemplo</span>
            </div>
            <div className="p-4"><h3 className="font-semibold">{decoracion.titulo}</h3><p className="mt-1 text-sm text-texto-secundario">{decoracion.tematica}</p><p className="mt-2 text-xs text-texto-secundario">{decoracion.origen === "ejemplo" ? decoracion.aviso : "Referencia Sempertex"}</p>
              <div className="mt-4 flex gap-2"><button type="button" className="flex-1 rounded-xl bg-acento px-3 py-2.5 text-sm font-semibold text-white" onClick={() => onElegir(decoracion, true)}>Sí, me gusta</button><button type="button" className="flex-1 rounded-xl border border-borde-suave px-3 py-2.5 text-sm font-medium" onClick={() => onElegir(decoracion, false)}>No, ver otra</button></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
