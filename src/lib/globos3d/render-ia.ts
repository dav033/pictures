/**
 * Del taller 3D a una foto con IA (FLUX base por `/edit`, nunca Gemini): la captura del visor viaja como imagen
 * base y el texto pide volverla foto sin tocar la decoración. La forma, la cantidad, la posición, el tamaño y el
 * color de cada globo vienen del 3D (que sale del motor); FLUX solo pone el realismo del látex y el salón.
 * Sin dependencias de servidor: lo usan la ruta y las pruebas.
 */
export type AmbienteRender = "salon_elegante" | "fiesta_infantil" | "boda_jardin" | "estudio";

export const AMBIENTES_RENDER: ReadonlyArray<{ id: AmbienteRender; nombre: string; frase: string }> = [
  { id: "salon_elegante", nombre: "Salón elegante", frase: "an elegant event hall with soft warm uplighting, a polished floor and blurred guests and tables far behind" },
  { id: "fiesta_infantil", nombre: "Fiesta infantil", frase: "a bright kids' birthday party room with a dessert table at one side and soft daylight" },
  { id: "boda_jardin", nombre: "Jardín de boda", frase: "a lush garden wedding reception at golden hour with string lights and greenery behind" },
  { id: "estudio", nombre: "Estudio fotográfico", frase: "a clean photo studio with a seamless light backdrop and soft even studio lighting" },
];

export const MAX_DESCRIPCION = 700;

/** Texto para FLUX `/edit` con la captura 3D como base. `descripcion` la arma el taller (inglés, sin marcas). */
export function promptRender3d(descripcion: string, ambiente: AmbienteRender): string {
  const lugar = AMBIENTES_RENDER.find((a) => a.id === ambiente)?.frase ?? AMBIENTES_RENDER[0]!.frase;
  const decoracion = descripcion.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPCION);
  return [
    "Turn this 3D preview into a real professional event photograph.",
    "Keep the balloon decoration exactly as shown: same overall shape, height and width, same number, size, position and color of every balloon and of every decoration; do not add, remove, merge or recolor balloons.",
    "Make it photorealistic: real latex balloons with natural soft highlights, slight squash where balloons touch, knots hidden; chrome balloons with mirror reflections, clear balloons see-through.",
    `Replace the plain backdrop and the grid floor with ${lugar}.`,
    decoracion ? `The decoration: ${decoracion}.` : "",
    "Same camera angle and framing as the input; sharp detail, natural depth.",
  ].filter(Boolean).join(" ");
}

/** Nombre del formato en inglés para el texto de FLUX: «R-12» → «12-inch round». */
export function formatoEnIngles(formatoId: string): string {
  const [familia, numero] = formatoId.split("-");
  if (familia === "R") return `${numero}-inch round`;
  if (familia === "LOL") return `${numero}-inch Link-O-Loon`;
  if (familia === "C") return `${numero}-inch heart`;
  if (familia === "T") return `${numero} twisting tube`;
  return formatoId;
}

/**
 * La descripción que viaja con la captura: la estructura y su lista de materiales en inglés, de mayor a menor
 * cantidad («40 × 12-inch round Pastel Matte Blue»), recortada a `MAX_DESCRIPCION`.
 */
export function descripcionRender3d(estructura: string, materiales: ReadonlyArray<{ cantidad: number; formatoId: string; colorEn: string }>, extra = ""): string {
  const lista = [...materiales].sort((a, b) => b.cantidad - a.cantidad).map((m) => `${m.cantidad} × ${formatoEnIngles(m.formatoId)} ${m.colorEn}`);
  const partes = [estructura.trim(), lista.length ? `Balloons: ${lista.join(", ")}` : "", extra.trim()].filter(Boolean);
  const texto = partes.join(". ");
  return texto.length <= MAX_DESCRIPCION ? texto : `${texto.slice(0, MAX_DESCRIPCION - 1).replace(/[,\s]+\S*$/, "")}…`;
}
