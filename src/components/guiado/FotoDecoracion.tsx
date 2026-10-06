import Image from "next/image";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

/**
 * La imagen de una decoración: su foto si la representa, o una ilustración de globos en SUS colores si la única
 * foto disponible es de otro kit (una tarjeta «Espacio» con un ramo rojo de «Te amo» parecía un error). La
 * ilustración se dice como tal: nunca se presenta como foto de la decoración.
 */
export function FotoDecoracion({ decoracion, sizes }: { decoracion: DecoracionSempertex; sizes: string }) {
  const foto = decoracion.fotos[0];
  if (foto && decoracion.fotoRepresentativa !== false) {
    return <Image src={foto.url} alt={decoracion.titulo} fill sizes={sizes} unoptimized className="object-cover" />;
  }
  return <>
    <IlustracionGlobos colores={decoracion.paleta ?? ["#f7a8c4", "#c7a6d8", "#f6f3ee"]} titulo={decoracion.titulo} />
    <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2 py-0.5 text-[0.65rem] font-medium text-[#5b4a6b]">Ilustración de colores</span>
  </>;
}

/** Racimo de globos determinista (siempre igual para la misma paleta), con brillo y sombra suaves. */
function IlustracionGlobos({ colores, titulo }: { colores: readonly string[]; titulo: string }) {
  const fondo = mezclar(colores[0]!, "#ffffff", 0.86);
  return <svg viewBox="0 0 400 300" className="absolute inset-0 size-full" role="img" aria-label={`Ilustración de colores: ${titulo}`} preserveAspectRatio="xMidYMid slice">
    <rect width="400" height="300" fill={fondo} />
    {GLOBOS.map((globo, indice) => {
      const color = colores[indice % colores.length]!;
      return <g key={indice}>
        <ellipse cx={globo.x + 3} cy={globo.y + globo.r * 0.95} rx={globo.r * 0.8} ry={globo.r * 0.18} fill="#000" opacity="0.06" />
        <circle cx={globo.x} cy={globo.y} r={globo.r} fill={color} stroke={mezclar(color, "#000000", 0.12)} strokeWidth="1.2" />
        <ellipse cx={globo.x - globo.r * 0.35} cy={globo.y - globo.r * 0.4} rx={globo.r * 0.22} ry={globo.r * 0.14} fill="#fff" opacity="0.45" transform={`rotate(-30 ${globo.x - globo.r * 0.35} ${globo.y - globo.r * 0.4})`} />
      </g>;
    })}
  </svg>;
}

// Un arco orgánico visto de frente: grandes en la base, pequeños de relleno, en el orden en que se pintan.
const GLOBOS: ReadonlyArray<{ x: number; y: number; r: number }> = [
  { x: 70, y: 245, r: 40 }, { x: 330, y: 245, r: 40 }, { x: 110, y: 205, r: 30 }, { x: 290, y: 205, r: 30 },
  { x: 62, y: 175, r: 28 }, { x: 338, y: 175, r: 28 }, { x: 95, y: 130, r: 32 }, { x: 305, y: 130, r: 32 },
  { x: 140, y: 92, r: 28 }, { x: 260, y: 92, r: 28 }, { x: 200, y: 70, r: 34 }, { x: 160, y: 140, r: 16 },
  { x: 240, y: 140, r: 16 }, { x: 125, y: 175, r: 14 }, { x: 275, y: 175, r: 14 }, { x: 175, y: 105, r: 13 },
  { x: 225, y: 105, r: 13 }, { x: 45, y: 215, r: 18 }, { x: 355, y: 215, r: 18 }, { x: 200, y: 112, r: 12 },
];

function mezclar(hex: string, con: string, peso: number): string {
  const a = componentes(hex); const b = componentes(con);
  return `#${a.map((valor, indice) => Math.round(valor * (1 - peso) + b[indice]! * peso).toString(16).padStart(2, "0")).join("")}`;
}

function componentes(hex: string): [number, number, number] {
  const limpio = hex.replace("#", "");
  return [0, 2, 4].map((inicio) => parseInt(limpio.slice(inicio, inicio + 2), 16)) as [number, number, number];
}
