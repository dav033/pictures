"use client";

type Uso = "personal" | "negocio";
/** Cómo se fijó el uso del costeo: lo eligió aquí, ya lo sabíamos (lo dijo antes) o lo cambió con el enlace. */
export type OrigenUsoCosteo = "elegido" | "conocido" | "cambio";

type Props = {
  /** El uso con que se costea ESTE plan, o el que el cliente ya dijo (idea, «soy decorador», «para mi casa»). */
  uso: Uso | null;
  ocupado: boolean;
  onElegir: (uso: Uso, origen: OrigenUsoCosteo) => void;
};

const ETIQUETA: Record<Uso, string> = { personal: "Uso personal", negocio: "Para mi negocio" };

/**
 * «¿Para qué es la decoración?» solo cuando todavía no se sabe. Usabilidad 97, punto 2: la mamá ya había contestado «Para
 * uso personal» al pedir el precio de la idea y el decorador había escrito «Soy decorador… necesito cotizarle», y «Cuánto
 * cuesta» en «Tu plan» se lo volvía a preguntar (con otra interfaz y en otro orden). Con el uso ya dicho, el precio sale
 * directo y queda un enlace discreto para cambiarlo.
 */
export function SelectorUsoCosteo({ uso, ocupado, onElegir }: Props) {
  if (uso) {
    const otro: Uso = uso === "negocio" ? "personal" : "negocio";
    return (
      <p className="text-sm text-texto-suave" data-testid="uso-costeo-conocido">
        {uso === "negocio" ? "Precio para tu negocio" : "Precio para uso personal"}
        <span aria-hidden> · </span>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => onElegir(otro, "cambio")}
          className="font-medium text-acento underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-60"
        >
          {otro === "negocio" ? "¿Es para tu negocio?" : "¿Es para uso personal?"}
        </button>
      </p>
    );
  }
  return (
    <>
      <p className="mb-2 text-sm font-medium text-texto">¿Para qué es la decoración?</p>
      <div role="radiogroup" aria-label="Para qué es la decoración" className="grid grid-cols-2 gap-1 rounded-2xl bg-superficie-2 p-1">
        {(["personal", "negocio"] as const).map((opcion) => (
          <button
            key={opcion}
            type="button"
            role="radio"
            aria-checked={false}
            disabled={ocupado}
            onClick={() => onElegir(opcion, "elegido")}
            className="relative min-h-11 rounded-xl px-2 text-sm font-medium text-texto-suave transition-colors hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-60"
          >
            {ETIQUETA[opcion]}
          </button>
        ))}
      </div>
    </>
  );
}
