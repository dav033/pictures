import { FotoDecoracion } from "./FotoDecoracion";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { nombreGlobosCliente } from "./formato";

/**
 * La decoración que el cliente eligió y lo que lleva, en palabras de cliente: «40 globos de 12" Palo de rosa», no
 * «R-12 Rosewood, paquete x50; precio actual de catálogo». Los datos técnicos siguen en la biblioteca.
 */
export function TarjetaEleccion({ decoracion }: { decoracion: DecoracionSempertex }) {
  const piezas = decoracion.piezas.map((pieza) => `${pieza.cantidad} ${nombrePieza(pieza.estructura, pieza.cantidad)}`);
  return <section className="mt-4 flex flex-col overflow-hidden rounded-2xl border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra)] sm:flex-row" aria-label="Tu elección">
    <div className="relative aspect-[4/3] shrink-0 bg-superficie-2 sm:aspect-auto sm:w-48">
      <FotoDecoracion decoracion={decoracion} sizes="(max-width: 640px) 100vw, 192px" />
    </div>
    <div className="flex-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{decoracion.titulo}</h3>
        {decoracion.origen === "referencia_real" && <span className="shrink-0 rounded-full border border-borde-suave px-2 py-0.5 text-[0.7rem] font-medium text-texto-suave">Referencia</span>}
      </div>
      {piezas.length > 0 && <p className="mt-1 text-sm text-texto-suave">{piezas.join(" · ")}</p>}
      {decoracion.materiales.length > 0 && <ul className="mt-3 space-y-1.5 text-sm">
        {decoracion.materiales.map((material) => <li key={material.variantId} className="flex gap-2"><span className="font-semibold tabular-nums">{material.cantidad}</span><span>{minusculaInicial(nombreMaterial(material.nota) ?? "globos")}</span></li>)}
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

/**
 * «Globo látex R-12 Rosewood, paquete x50; precio…» → «Globos palo de rosa de 12"». Usa el mismo mapa de colores
 * que el costeo (presentacion-material-guiado.ts: Rosewood → Palo de rosa), para que la idea y su precio digan
 * el mismo color. Sin nota no se inventa nada.
 */
export function nombreMaterial(nota: string | undefined): string | null {
  if (!nota) return null;
  const primeraParte = nota.split(/[,;]/)[0]!.trim();
  // Solo un tamaño («12"», sin nombre de producto): sigue siendo un globo.
  if (!/\p{L}/u.test(primeraParte)) return nombreGlobosCliente({ nombre: "Globo", tamano: primeraParte });
  // Notas de ejemplo («R-12 Rosewood»): el mapa del costeo. Notas del catálogo real («… — R-12 / PAQUETE X 50 · R-12 ·
  // rosado»): su color de cliente, el mismo que dice el precio personal (formato.ts).
  const base = /\bR-\d+\s+\p{L}/u.test(primeraParte) ? presentacionMaterialGuiado(nota).nombre : primeraParte;
  return nombreGlobosCliente({ nombre: base });
}

function minusculaInicial(texto: string): string {
  return texto.charAt(0).toLocaleLowerCase("es") + texto.slice(1);
}
