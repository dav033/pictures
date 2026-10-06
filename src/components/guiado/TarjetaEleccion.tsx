import Image from "next/image";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

/**
 * La decoración que el cliente eligió y lo que lleva, en palabras de cliente: «40 globos de 12" Palo de rosa», no
 * «R-12 Rosewood, paquete x50; precio actual de catálogo». Los datos técnicos siguen en la biblioteca.
 */
export function TarjetaEleccion({ decoracion }: { decoracion: DecoracionSempertex }) {
  const piezas = decoracion.piezas.map((pieza) => `${pieza.cantidad} ${nombrePieza(pieza.estructura, pieza.cantidad)}`);
  return <section className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-borde-suave bg-superficie shadow-sm sm:flex-row" aria-label="Tu elección">
    <div className="relative aspect-[4/3] shrink-0 bg-[#f7f1eb] sm:aspect-auto sm:w-48">
      <Image src={decoracion.fotos[0]?.url ?? "/biblioteca-sempertex/decoracion-ejemplo.svg"} alt={decoracion.titulo} fill sizes="(max-width: 640px) 100vw, 192px" unoptimized className="object-cover" />
    </div>
    <div className="flex-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{decoracion.titulo}</h3>
        {decoracion.origen === "ejemplo" && <span className="shrink-0 rounded-full bg-acento-suave px-2 py-0.5 text-[0.7rem] font-semibold text-acento">Ejemplo</span>}
      </div>
      {piezas.length > 0 && <p className="mt-1 text-sm text-texto-secundario">{piezas.join(" · ")}</p>}
      {decoracion.materiales.length > 0 && <ul className="mt-3 space-y-1.5 text-sm">
        {decoracion.materiales.map((material) => <li key={material.variantId} className="flex gap-2"><span className="font-semibold tabular-nums">{material.cantidad}</span><span>{nombreMaterial(material.nota) ?? "globos"}</span></li>)}
      </ul>}
    </div>
  </section>;
}

const NOMBRES_PIEZA: Readonly<Record<string, [string, string]>> = {
  arco: ["arco", "arcos"], arco_asimetrico: ["arco asimétrico", "arcos asimétricos"], arco_no_denso: ["arco ligero", "arcos ligeros"],
  semiarco: ["medio arco", "medios arcos"], semiarco_asimetrico: ["medio arco asimétrico", "medios arcos asimétricos"],
  columna: ["columna", "columnas"], columna_asimetrica: ["columna asimétrica", "columnas asimétricas"], columna_no_densa: ["columna ligera", "columnas ligeras"],
  pared_densa: ["pared de globos", "paredes de globos"], pared_no_densa: ["pared ligera de globos", "paredes ligeras de globos"], pared_organica: ["pared orgánica", "paredes orgánicas"],
  guirnalda: ["guirnalda", "guirnaldas"], centro_mesa: ["centro de mesa", "centros de mesa"], bouquet: ["bouquet", "bouquets"], figura: ["figura", "figuras"],
  aro_circular: ["aro", "aros"], techo_globos: ["techo de globos", "techos de globos"], racimo_pared: ["racimo de pared", "racimos de pared"],
};

function nombrePieza(estructura: string, cantidad: number): string {
  const nombres = NOMBRES_PIEZA[estructura];
  if (nombres) return cantidad === 1 ? nombres[0] : nombres[1];
  return estructura.replaceAll("_", " ");
}

/** «Globo látex R-12 Rosewood, paquete x50; precio…» → «globos de 12" Rosewood». Sin nota no se inventa nada. */
function nombreMaterial(nota: string | undefined): string | null {
  if (!nota) return null;
  const nombre = nota.split(/[,;]/)[0]!.trim();
  const tamano = /\bR-?(\d{1,2})\b/i.exec(nombre)?.[1];
  const color = nombre.replace(/^globos?\s+(de\s+)?l[aá]tex\s*/i, "").replace(/\bR-?\d{1,2}\b/i, "").trim();
  return `globos${tamano ? ` de ${tamano}"` : ""}${color ? ` ${color}` : ""}`;
}
