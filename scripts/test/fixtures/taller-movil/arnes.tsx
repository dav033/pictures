import { createRoot, type Root } from "react-dom/client";
import { Taller3D } from "../../../../src/components/tres-d/Taller3D";

declare global {
  interface Window {
    __montarTallerMovil: () => void;
  }
}

let root: Root | null = null;
window.__montarTallerMovil = () => {
  root?.unmount();
  root = createRoot(document.getElementById("raiz")!);
  root.render(<Taller3D />);
};
