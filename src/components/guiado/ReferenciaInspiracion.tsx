import type { ReferenciaGuiada } from "@/lib/ia/guiado/adaptar-analisis-referencia";

export function ReferenciaInspiracion({ miniatura, referencia }: { miniatura: string; referencia: ReferenciaGuiada }) {
  return <section aria-label="Lo que veo en tu foto" className="mt-2 w-full max-w-64 overflow-hidden rounded-2xl border border-borde-suave bg-superficie shadow-sm">
    <div className="relative w-full overflow-hidden bg-fondo" style={referencia.aspecto ? { aspectRatio: referencia.aspecto } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local optimizada en el navegador */}
      <img src={miniatura} alt="Tu foto de inspiración" className="block h-full max-h-44 w-full object-contain" />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {referencia.piezas.map((pieza, indice) => <span key={indice} className="absolute rounded-xl border border-white/80 shadow-[0_0_0_1px_rgb(15_23_42/0.16)]" style={{ left: `${pieza.x * 100}%`, top: `${pieza.y * 100}%`, width: `${pieza.ancho * 100}%`, height: `${pieza.alto * 100}%` }} />)}
      </div>
    </div>
    <div className="space-y-2 p-3">
      <p className="text-sm text-texto">{referencia.frase}</p>
      {referencia.colores.length > 0 && <ul aria-label="Colores que veo" className="flex gap-2">
        {referencia.colores.map((color) => <li key={color.nombre}>
          <span role="img" aria-label={color.nombre} title={color.nombre} className="block size-4 rounded-full border border-borde-suave" style={{ backgroundColor: color.hex }} />
        </li>)}
      </ul>}
    </div>
  </section>;
}
