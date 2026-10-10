import { TEXTO_REHECHO_EN_PYTHON } from "./Plan3DEnPreparacion";

type Props = {
  /** Lo que el widget del plan guardó: los avisos de la idea sumada y si el plan se recalculó con el método de siempre. */
  widget: { agregada?: { avisos?: string[] | undefined } | undefined; recalculado?: true | undefined };
  vigente: boolean;
};

/**
 * Las líneas sobre la tarjeta del plan. Van aquí y no en el texto del mensaje porque, con la tarjeta del plan, ese texto no
 * se pinta: lo que el cliente debe leer tiene que estar en lo que se ve.
 * - Recalculado (P-045): un plan del 3D rehecho entero con Python (tras el aviso del corte o del límite, o un 3D que no pudo):
 *   las cantidades y el precio pueden cambiar respecto a la versión anterior. Se dice sin quitarle importancia (D-023).
 * - La idea sumada no salió con sus cantidades exactas: por qué, en una línea discreta (verificador 127).
 */
export function NotasPlan({ widget, vigente }: Props) {
  const atenuada = vigente ? "" : "opacity-70";
  return (
    <>
      {widget.recalculado ? (
        <p role="note" className={`mt-1 px-3.5 text-sm font-medium text-texto ${atenuada}`} data-testid="plan-recalculado">
          {TEXTO_REHECHO_EN_PYTHON}
        </p>
      ) : null}
      {widget.agregada?.avisos?.length ? (
        <p className={`mt-1 px-3.5 text-xs text-texto-suave ${atenuada}`} data-testid="idea-no-exacta">
          {widget.agregada.avisos.join(" ")}
        </p>
      ) : null}
    </>
  );
}
