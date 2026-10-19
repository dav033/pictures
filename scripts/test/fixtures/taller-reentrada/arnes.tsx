import { Activity, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Taller3D } from "../../../../src/components/tres-d/Taller3D";

declare global {
  interface Window {
    __montarTallerReentrada: () => void;
    __ocultarTallerReentrada?: () => void;
    __mostrarTallerReentrada?: () => void;
  }
}

let root: Root | null = null;
function TallerEnActividad() {
  const [modo, setModo] = useState<"visible" | "hidden">("visible");
  useEffect(() => {
    window.__ocultarTallerReentrada = () => setModo("hidden");
    window.__mostrarTallerReentrada = () => setModo("visible");
    return () => {
      delete window.__ocultarTallerReentrada;
      delete window.__mostrarTallerReentrada;
    };
  }, []);
  return <Activity mode={modo}><Taller3D /></Activity>;
}

window.__montarTallerReentrada = () => {
  root?.unmount();
  root = createRoot(document.getElementById("raiz")!);
  root.render(<TallerEnActividad />);
};
