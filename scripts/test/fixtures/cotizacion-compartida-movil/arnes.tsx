import { createRoot, type Root } from "react-dom/client";

declare global {
  interface Window {
    __montarMovil: () => void;
  }
}

let root: Root | null = null;

function CotizacionCompartidaMovil() {
  return <main className="mx-auto min-h-dvh w-full max-w-3xl overflow-x-hidden px-4 py-5 text-texto">
    <header className="mb-5">
      <p className="text-sm text-texto-suave">Sempertex · Cotización compartida</p>
      <h1 className="mt-2 text-2xl font-semibold">Decoración para cumpleaños</h1>
      <p className="mt-2 text-texto-suave">Materiales y precios estimados</p>
    </header>
    <section aria-label="Resumen de la cotización" className="rounded-2xl border bg-superficie p-4">
      <h2 className="text-lg font-semibold">Materiales</h2>
      <ul className="mt-3 divide-y">
        <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3">
          <span className="min-w-0 flex-1">Globo R12 blanco perlado</span><span className="shrink-0 tabular-nums">$ 24.000</span>
        </li>
        <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-3">
          <span className="min-w-0 flex-1">Globo R12 rosa pastel</span><span className="shrink-0 tabular-nums">$ 18.000</span>
        </li>
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-4 font-semibold">
        <span>Total estimado</span><span className="tabular-nums">$ 42.000</span>
      </div>
    </section>
    <p className="mt-4 text-sm text-texto-suave">Los precios pueden cambiar según disponibilidad.</p>
    <a className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-acento px-5 text-white" href="#materiales">Ver materiales</a>
  </main>;
}

window.__montarMovil = () => {
  root?.unmount();
  root = createRoot(document.getElementById("raiz")!);
  root.render(<CotizacionCompartidaMovil />);
};
