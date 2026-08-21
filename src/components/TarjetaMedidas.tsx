import type { ResultadoMedidas } from "@/lib/medidas/geometria";

const NOMBRES_FIGURA: Record<ResultadoMedidas["figura"], string> = {
  arco: "Arco",
  semiarco: "Semiarco",
  guirnalda: "Guirnalda",
  columna: "Columna",
  pared: "Pared / backdrop",
  centro_mesa: "Centro de mesa",
};

export function TarjetaMedidas({ medidas }: { medidas: ResultadoMedidas }) {
  return (
    <div className="mt-3 max-w-[85%] space-y-2 rounded-xl border border-borde bg-superficie p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-texto">{NOMBRES_FIGURA[medidas.figura]}</span>
        <span className="rounded-full bg-aviso-suave px-2 py-0.5 text-xs text-aviso">
          Estimado preliminar
        </span>
      </div>

      <p className="text-xs text-texto-suave">
        Eje real: <strong>{medidas.ejeM} m</strong> · {medidas.totalGlobos} globos en total
      </p>

      <ul className="space-y-0.5 text-sm text-texto">
        {medidas.despiece.map((linea, i) => (
          <li key={i} className="flex justify-between">
            <span>
              {linea.tamano}
              {linea.color ? ` ${linea.color}` : ""}
            </span>
            <span className="text-texto-suave">{linea.cantidad}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-texto-suave">Supuestos: {medidas.supuestos.join(" · ")}</p>
      <p className="text-xs text-aviso">{medidas.aviso}</p>
    </div>
  );
}
