"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import type { CalibracionBomba } from "@/lib/globos3d/bomba-segundos";
import { DialogoTaller } from "./DialogoTaller";
import { HojaArmadoEscena } from "./HojaArmadoEscena";
import { ListaCompra } from "./ListaCompra";
import { useHojaArmadoActiva } from "./useHojaArmadoActiva";

type Props = {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  nombre: string;
  escena: Escena;
  armada: EscenaArmada | null;
  productosExactos: ReactNode;
};

/**
 * Devuelve el foco a lo que abrió la lista cuando la lista se cierra del todo. El `<dialog>` nativo lo hace solo si se abrió
 * una vez, pero tras la vuelta por la hoja se reabre con el foco en `<body>` (la hoja ya se desmontó y su retorno de foco cae
 * sobre el botón cuando aún está inerte): al cerrarse, devolvería el foco a `<body>`. Se guarda al abrir, en un efecto de
 * diseño (antes del `showModal()` de `DialogoTaller`, que corre en su efecto), y se devuelve después del `close()`, solo si el
 * foco quedó perdido (así no se le quita a otro diálogo del taller que se abra en ese momento).
 */
function useFocoDeQuienAbre(abierto: boolean): void {
  const quienAbre = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (abierto) quienAbre.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  }, [abierto]);
  useEffect(() => {
    if (abierto) return;
    const destino = quienAbre.current;
    quienAbre.current = null;
    const perdido = document.activeElement === null || document.activeElement === document.body;
    if (destino?.isConnected && perdido) destino.focus();
  }, [abierto]);
}

/**
 * La lista de compra (un `<dialog>` nativo modal) y, desde ella, la hoja de armado. La hoja NO se abre dentro de la lista: un
 * diálogo de Radix montado dentro de un `<dialog>` abierto con `showModal()` queda inerte (la capa superior del navegador) y
 * no responde. Al pedir la hoja se cierra la lista y se abre la hoja con la calibración de la bomba que tenía la lista; al
 * cerrar la hoja se vuelve a la lista. El botón solo sale con la bandera `taller_hoja_armado` encendida.
 */
export function DialogoCompra({ abierto, onCerrar, titulo, nombre, escena, armada, productosExactos }: Props) {
  const hojaActiva = useHojaArmadoActiva();
  const [hoja, setHoja] = useState<CalibracionBomba | null>(null);
  useFocoDeQuienAbre(abierto);
  // Si el taller cierra la lista (otro diálogo, una tecla) con la hoja abierta, la hoja se cierra con ella.
  if (!abierto && hoja !== null) setHoja(null);
  return (
    <>
      <DialogoTaller abierto={abierto && hoja === null} onCerrar={onCerrar} titulo={titulo} forma="cajon">
        {armada && abierto && hoja === null && (
          <ListaCompra nombre={nombre} escena={escena} armada={armada} productosExactos={productosExactos} onHojaDeArmado={hojaActiva ? setHoja : undefined} />
        )}
      </DialogoTaller>
      {armada && <HojaArmadoEscena abierta={abierto && hoja !== null} onCerrar={() => setHoja(null)} nombre={nombre} escena={escena} armada={armada} calibracion={hoja ?? {}} />}
    </>
  );
}
