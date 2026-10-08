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
    "Keep partial and asymmetric shapes as they are: never complete, mirror or close them (a half arch stays a half arch, an open end stays open, empty wall stays empty).",
    "Make it a real photograph, not a 3D render: real latex balloons with natural soft highlights and subtle texture, tightly packed and slightly squashed where they touch (where the preview shows small gaps or see-through spots, the real decoration is full), knots hidden; chrome balloons with mirror reflections, clear balloons see-through.",
    `Replace the plain backdrop and the grid floor with ${lugar}.`,
    decoracion ? `The decoration: ${decoracion}.` : "",
    "Same camera angle and framing as the input; sharp detail, natural depth.",
  ].filter(Boolean).join(" ");
}

type PuntoSilueta = { x: number; y: number; z: number };

/**
 * La silueta de una estructura vista de frente (ejes x e y del mundo), para que FLUX no la «complete»: con solo «an
 * organic balloon piece» convertía una media guirnalda en un arco de dos patas. Reparte los centros de los globos en
 * una rejilla de 3 × 3 (izquierda/centro/derecha × abajo/medio/arriba) y dice qué lados tienen pata y qué queda vacío.
 * Vacío si la forma no es de arco (columna, guirnalda horizontal) o si hay muy pocos globos.
 */
export function siluetaEnIngles(globos: ReadonlyArray<{ nudo: PuntoSilueta; direccion: PuntoSilueta; infladoCm: number }>): string {
  if (globos.length < 12) return "";
  const centros = globos.map((g) => ({ x: g.nudo.x + (g.direccion.x * g.infladoCm) / 2, y: g.nudo.y + (g.direccion.y * g.infladoCm) / 2 }));
  const xs = centros.map((c) => c.x), ys = centros.map((c) => c.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ancho = x1 - x0, alto = y1 - y0;
  if (ancho < alto * 0.35 || alto < ancho * 0.35) return "";
  const celdas = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // [fila: 0 abajo … 2 arriba][columna: 0 izquierda … 2 derecha]
  for (const c of centros) {
    const col = Math.min(2, Math.floor(((c.x - x0) / ancho) * 3)), fila = Math.min(2, Math.floor(((c.y - y0) / alto) * 3));
    celdas[fila]![col]! += 1;
  }
  const minimo = Math.max(2, globos.length * 0.04);
  const lleno = (fila: number, col: number) => celdas[fila]![col]! >= minimo;
  const izquierda = lleno(0, 0), derecha = lleno(0, 2), centroAbajo = lleno(0, 1), arriba = lleno(2, 1) || (lleno(2, 0) && lleno(2, 2));
  if (izquierda && derecha && !centroAbajo && arriba) return "Its outline is a complete arch: two legs, left and right, with an open space between them";
  if (izquierda === derecha || !arriba) return "";
  const pata = izquierda ? "left" : "right", otro = izquierda ? "right" : "left", col = izquierda ? 2 : 0;
  const termina = lleno(1, col) ? `at mid height on the ${otro}` : `at the top ${otro}`;
  return `Its outline is an asymmetric HALF arch: it rises from the bottom ${pata}, curves over the top and stops in mid-air ${termina}; the bottom ${otro} is empty, it has only one leg (do not add a second leg or complete the arch)`;
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
 * La descripción que viaja con la captura: la estructura, los colores por proporción («about 60% Pastel Matte
 * Blue, 20% Fashion White…», de más a menos) y los tamaños como rango. Las cantidades por formato no van: FLUX
 * no cuenta globos (la cantidad la da la captura) y una lista larga solo le quita peso a lo importante.
 * Recortada a `MAX_DESCRIPCION`.
 */
export function descripcionRender3d(estructura: string, materiales: ReadonlyArray<{ cantidad: number; formatoId: string; colorEn: string }>, extra = ""): string {
  const total = materiales.reduce((suma, m) => suma + m.cantidad, 0);
  const porColor = new Map<string, number>();
  for (const m of materiales) porColor.set(m.colorEn, (porColor.get(m.colorEn) ?? 0) + m.cantidad);
  const colores = [...porColor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([color, n]) => `${Math.max(1, Math.round((100 * n) / total))}% ${color}`);
  const redondos = [...new Set(materiales.filter((m) => m.formatoId.startsWith("R-")).map((m) => Number(m.formatoId.slice(2))))].sort((a, b) => a - b);
  const otros = [...new Set(materiales.filter((m) => !m.formatoId.startsWith("R-")).map((m) => formatoEnIngles(m.formatoId).replace(/^\d+[- ]?(inch )?/, "")))];
  const tamanos = [
    redondos.length > 1 ? `round balloons from ${redondos[0]} to ${redondos[redondos.length - 1]} inches` : redondos.length === 1 ? `${redondos[0]}-inch round balloons` : "",
    ...otros.map((o) => (o.endsWith("tube") ? "twisting balloons" : `${o} balloons`)),
  ].filter(Boolean);
  const partes = [
    estructura.trim(),
    colores.length ? `Colors: about ${colores.join(", ")}` : "",
    tamanos.length ? `Sizes: ${tamanos.join(", ")}` : "",
    extra.trim(),
  ].filter(Boolean);
  const texto = partes.join(". ");
  return texto.length <= MAX_DESCRIPCION ? texto : `${texto.slice(0, MAX_DESCRIPCION - 1).replace(/[,\s]+\S*$/, "")}…`;
}
