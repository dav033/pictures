/**
 * Arnés del navegador para `test-hoja-armado-ui.ts`: monta la lista de compra del Taller 3D como la monta `Taller3D` (un botón
 * que abre `DialogoCompra` y lo cierra), con la escena que le pasa la prueba armada aquí mismo por el motor.
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DialogoCompra } from "../../../../src/components/tres-d/DialogoCompra";
import { armarEscena, type Escena } from "../../../../src/lib/globos3d/escena";

declare global {
  interface Window {
    __montarHoja: (nombre: string, escena: Escena) => void;
    __impresiones: number;
  }
}

function Taller({ nombre, escena }: { nombre: string; escena: Escena }) {
  const [abierto, setAbierto] = useState(false);
  const armada = useMemo(() => armarEscena(escena), [escena]);
  return (
    <div className="taller-3d min-h-dvh">
      <button type="button" onClick={() => setAbierto(true)}>Lista de compra</button>
      <DialogoCompra abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Lista de compra · ${armada.globos.length} globos`} nombre={nombre} escena={escena} armada={armada}
        productosExactos={<p>Productos exactos de la tienda (no se calculan en la prueba).</p>} />
    </div>
  );
}

window.__impresiones = 0;
window.print = () => { window.__impresiones += 1; };
window.__montarHoja = (nombre, escena) => {
  createRoot(document.getElementById("raiz") as HTMLElement).render(<Taller nombre={nombre} escena={escena} />);
};
