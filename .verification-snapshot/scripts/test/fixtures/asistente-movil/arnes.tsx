import { createRoot, type Root } from "react-dom/client";
import { VistaGuiada } from "../../../../src/components/guiado/VistaGuiada";

declare global {
  interface Window {
    __montarMovil: () => void;
  }
}

let root: Root | null = null;

window.__montarMovil = () => {
  root?.unmount();
  root = createRoot(document.getElementById("raiz")!);
  root.render(<VistaGuiada versionPagina="fixture-movil" />);
};
