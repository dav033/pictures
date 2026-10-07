import type { ReactNode } from "react";
import { useVozCliente } from "./voz-editor";

/**
 * Dónde va el editor mientras se edita una pieza del motor: **al lado del dibujo, no debajo**.
 *
 * El problema que resuelve es de los que no se ven leyendo el código. Los cuatro editores de ADR-0034 ya
 * dejaban el dibujo montado al abrirse —se apilaba el editor detrás, en `{pie}`— así que desde dentro
 * parecía correcto. En pantalla no lo era: el editor es largo, empuja todo hacia abajo y el dibujo se sale
 * por arriba. Mueves un deslizador, la pieza cambia de verdad… y no lo ves, porque para verlo hay que subir,
 * y al subir desaparecen los mandos. Visto en el navegador el 2026-10-04: la guirnalda pasó de 4 a 5,5 m sin
 * que se notara nada en la parte visible de la página.
 *
 * La cura es la que ya usaban el editor de patrón y el de guirnalda de ADR-0032: dos columnas, el dibujo
 * fijo a un lado y **los mandos con su propio scroll**. Aquí no se puede hacer con `position: sticky` —la
 * tarjeta del plan es `overflow-hidden`, y eso deja a un hijo pegajoso sin nada a lo que pegarse—, así que
 * lo que acota la altura es el scroll de la columna de los mandos: mientras esa columna no crezca, el dibujo
 * no se va.
 *
 * Sin `editor` no cambia absolutamente nada: devuelve sus hijos tal cual, que es como se ve una pieza que no
 * se está editando.
 */
export function MarcoEdicion({ editor, children }: { editor?: ReactNode; children: ReactNode }) {
  // En la guiada la pieza se edita dentro de una hoja que ya se desplaza: una caja con su propio scroll dentro
  // daba DOS desplazamientos en un teléfono (probador, latido 88). Allí los mandos van debajo, en el mismo scroll.
  const cliente = useVozCliente();
  if (!editor) return <>{children}</>;
  if (cliente) {
    return (
      <div className="grid items-start gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @3xl:gap-5">
        <div className="@container min-w-0">{children}</div>
        <div data-testid="mandos-edicion" className="min-w-0">{editor}</div>
      </div>
    );
  }
  return (
    <div className="grid items-start gap-3 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @3xl:gap-5">
      {/*
        Un `@container` propio: dentro el dibujo y las cifras miden contra ESTA columna y no contra la
        tarjeta, así que se apilan solos cuando la columna se estrecha. Sin esto, el `@md:flex-row` de las
        piezas seguía mirando el ancho de la tarjeta y dejaba las medidas en una tira de 180 px.
      */}
      <div className="@container min-w-0">{children}</div>
      <div
        data-testid="mandos-edicion"
        className="min-w-0 max-h-[52dvh] overflow-y-auto overscroll-contain @3xl:max-h-[64dvh]"
      >
        {editor}
      </div>
    </div>
  );
}
