/** Las clases de la calificación en cada superficie: el Taller usa la paleta `taller-*`, el chat del cliente la suya. */
export type TemaCalificacion = "taller" | "cliente";

export type ClasesCalificacion = {
  raiz: string;
  texto: string;
  suave: string;
  nota: string;
  notaElegida: string;
  enlace: string;
  panel: string;
  chip: string;
  chipElegido: string;
  campo: string;
  primario: string;
  secundario: string;
  error: string;
  foco: string;
};

const ENFOQUE = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";

export const CLASES: Readonly<Record<TemaCalificacion, ClasesCalificacion>> = {
  taller: {
    raiz: "rounded-lg border border-taller-linea bg-taller-tarjeta/60 px-2.5 py-2",
    texto: "text-taller-texto-2",
    suave: "text-taller-suave",
    nota: "border-taller-borde bg-taller-boton text-taller-texto hover:bg-taller-encima",
    notaElegida: "border-taller-resalte bg-taller-primario text-taller-sobre-primario",
    enlace: "text-taller-acento hover:underline",
    panel: "border-taller-linea bg-taller-panel",
    chip: "border-taller-borde bg-taller-boton text-taller-texto hover:bg-taller-encima",
    chipElegido: "border-taller-resalte bg-taller-elegido text-taller-texto",
    campo: "border-taller-borde bg-taller-visor text-taller-texto placeholder:text-taller-suave",
    primario: "bg-taller-primario text-taller-sobre-primario hover:bg-taller-primario-hover",
    secundario: "border border-taller-borde bg-taller-boton text-taller-texto hover:bg-taller-encima",
    error: "text-taller-peligro",
    foco: `${ENFOQUE} focus-visible:outline-taller-resalte`,
  },
  cliente: {
    raiz: "rounded-xl border border-borde-suave bg-superficie px-3 py-2.5",
    texto: "text-texto",
    suave: "text-texto-suave",
    nota: "border-borde bg-superficie-suave text-texto hover:bg-acento-suave",
    notaElegida: "border-acento bg-acento text-sobre-acento",
    enlace: "text-acento hover:underline",
    panel: "border-borde-suave bg-superficie-suave",
    chip: "border-borde bg-superficie text-texto hover:bg-acento-suave",
    chipElegido: "border-acento bg-acento-suave text-acento",
    campo: "border-borde bg-superficie text-texto placeholder:text-texto-suave",
    primario: "bg-acento text-sobre-acento hover:bg-acento-hover",
    secundario: "border border-borde bg-superficie text-texto hover:bg-superficie-suave",
    error: "text-error",
    foco: `${ENFOQUE} focus-visible:outline-acento`,
  },
};
