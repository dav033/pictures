"use client";

import { useCallback, type MouseEvent } from "react";

/**
 * El dibujo que emite el motor migrado del diseñador (ADR-0034), tal cual.
 *
 * **Esta vista no calcula geometría.** Es la diferencia con `VistaPatron`, que recibe una matriz de índices y
 * vuelve a decidir en el navegador dónde va cada globo: eso dejaba dos geometrías —la que cuenta en Python y
 * la que dibuja aquí— sin nada que las obligara a coincidir, y lo que se veía no era lo que se cobraba. El
 * motor coloca los globos, los cuenta y escribe su SVG; aquí se muestra.
 *
 * **Por qué `dangerouslySetInnerHTML` es seguro aquí.** El SVG no viene del usuario ni del modelo: lo escribe
 * `app/arco/motor.py` a partir de números y de colores que `normalizar_color` ya acotó a `#rrggbb` o a una
 * referencia del catálogo. No hay ninguna cadena libre en el documento. React no sabe serializar un árbol SVG
 * que llega como texto, y volver a parsearlo a elementos sería re-implementar el dibujo otra vez.
 *
 * **Pintar racimo por racimo** sale gratis: el motor envuelve cada globo en un `<g data-…>` con su sección por
 * altura (`b`), su capa a lo ancho (`c`), su fila (`f`), su color (`k`) y, si el patrón aún manda en él, su
 * elemento del patrón (`e`). Un clic busca el `<g>` más cercano y devuelve esas cuatro cosas, que es
 * exactamente lo que el editor necesita para repintar.
 */

/** Dónde cayó un clic dentro del dibujo, en el vocabulario del motor. */
export type GloboTocado = {
  /** Sección por altura (0 = la del piso). */
  seccion: number;
  /** Capa a lo ancho de la banda (0 = la de afuera). */
  carril: number;
  /** Fila a lo largo de la línea guía. */
  fila: number;
  /** El color con el que se pintó, `#rrggbb`. */
  color: string;
  /** El lugar en la lista de colores del patrón, o `null` si lo pinta una sección o una capa propia. */
  elemento: number | null;
};

type Props = {
  /** El interior del `<svg>` que escribió el motor: `<defs>` y un grupo por globo. */
  svg: string;
  /** Lado del lienzo cuadrado del motor, para el `viewBox`. */
  lienzo: number;
  /** Alto del lienzo cuando no es cuadrado (la guirnalda dibuja en horizontal). */
  alto?: number;
  /** Texto accesible del dibujo. */
  etiqueta: string;
  className?: string;
  /** Con esto puesto, el dibujo responde al clic y se puede pintar sobre él. */
  alTocar?: (globo: GloboTocado) => void;
};

function leerGrupo(elemento: Element): GloboTocado | null {
  const grupo = elemento.closest("g[data-f]");
  if (!(grupo instanceof SVGElement)) return null;
  const { b, c, f, k, e } = grupo.dataset;
  if (b === undefined || c === undefined || f === undefined || k === undefined) return null;
  const numero = (valor: string) => Number.parseInt(valor, 10);
  return {
    seccion: numero(b),
    carril: numero(c),
    fila: numero(f),
    color: k,
    elemento: e === undefined ? null : numero(e),
  };
}

export function VistaMotor({ svg, lienzo, alto, etiqueta, className, alTocar }: Props) {
  const alHacerClic = useCallback(
    (evento: MouseEvent<SVGSVGElement>) => {
      if (!alTocar || !(evento.target instanceof Element)) return;
      const tocado = leerGrupo(evento.target);
      if (tocado) alTocar(tocado);
    },
    [alTocar],
  );

  return (
    <svg
      viewBox={`0 0 ${lienzo} ${alto ?? lienzo}`}
      role="img"
      aria-label={etiqueta}
      className={className}
      // Un solo oyente para todos los globos, no uno por globo: un arco grande pasa de mil, y el `<g>` que
      // recibe el clic ya trae en sus `data-` todo lo que hay que saber.
      onClick={alTocar ? alHacerClic : undefined}
      style={alTocar ? { cursor: "pointer" } : undefined}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
