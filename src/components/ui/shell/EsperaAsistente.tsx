"use client";

/**
 * "El asistente está pensando" (maqueta Estados): se muestra mientras el
 * turno no trae texto ni pasos todavía. Frase con tres puntos y un esqueleto
 * con brillo; `role="status"` para lectores de pantalla.
 */
export function EsperaAsistente({ texto = "Pensando" }: { texto?: string }) {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-live="polite" data-testid="espera-asistente">
      <p className="flex items-center gap-2 text-sm text-texto-suave">
        {texto}
        <span className="puntos" aria-hidden="true"><span /><span /><span /></span>
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        <div className="brillo-carga h-4 w-[70%] rounded-lg" />
        <div className="grid grid-cols-3 gap-2.5">
          <div className="brillo-carga h-14 rounded-2xl" />
          <div className="brillo-carga h-14 rounded-2xl" />
          <div className="brillo-carga h-14 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
