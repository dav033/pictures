/** Arnés del navegador para `test-voz-hook.ts`: monta `useDictado` en una página y deja sus controles en `window`. */
import { useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDictado, type Dictado } from "../../../../src/components/voz/useDictado";
import { instalarFalsos } from "./falsos";

declare global {
  interface Window {
    __dictado: Dictado;
    __textos: string[];
    __montar: () => void;
    __desmontar: () => void;
  }
}

instalarFalsos();
window.__textos = [];

function Prueba() {
  const dictado = useDictado((texto) => window.__textos.push(texto));
  useLayoutEffect(() => {
    window.__dictado = dictado;
  });
  const { estado } = dictado;
  return <p id="fase">{estado.fase === "reposo" ? `reposo:${estado.error ?? ""}` : estado.fase}</p>;
}

let raiz: Root | null = null;
window.__montar = () => {
  raiz = createRoot(document.getElementById("raiz") as HTMLElement);
  raiz.render(<Prueba />);
};
window.__desmontar = () => {
  raiz?.unmount();
  raiz = null;
};
