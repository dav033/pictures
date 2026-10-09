/**
 * Del taller 3D a una foto con IA (FLUX, nunca Gemini): la captura del visor viaja como imagen base y el texto pide
 * volverla foto sin tocar la decoración. La forma, la cantidad, la posición, el tamaño y el color de cada globo
 * vienen del 3D (que sale del motor); FLUX solo pone el realismo del látex y de la sala.
 *
 * Contra lo que FLUX inventaba (un quinto árbol, una mesa de postres, cupcakes, una segunda calabaza): los lugares
 * no traen muebles ni objetos (solo luz, paredes y piso), la descripción es un inventario cerrado (cada pieza con
 * su cantidad, forma y colores, y «nada más hay en la sala») y el lugar por defecto es la sala del propio visor.
 * Sin dependencias de servidor: lo usan la ruta, el taller y las pruebas.
 */
import { MARCA_LUZ_CALIDA } from "./luz-sala";
export type AmbienteRender = "igual_visor" | "salon_elegante" | "fiesta_infantil" | "boda_jardin" | "estudio";

/**
 * Los lugares: solo luz, paredes y piso (nada que FLUX pueda «amueblar»). `igual_visor` no cambia la sala: la de la
 * captura (paredes, piso y sus colores) se vuelve una sala fotografiada.
 */
export const AMBIENTES_RENDER: ReadonlyArray<{ id: AmbienteRender; nombre: string; frase: string }> = [
  { id: "igual_visor", nombre: "Igual al visor", frase: "the same room as in the input (same walls, floor, ceiling and colors), photographed for real" },
  { id: "salon_elegante", nombre: "Salón elegante", frase: "plain elegant event-hall walls with soft warm uplighting and a polished floor" },
  { id: "fiesta_infantil", nombre: "Fiesta infantil", frase: "plain bright pastel party-room walls, a light floor and soft daylight" },
  { id: "boda_jardin", nombre: "Jardín de boda", frase: "a trimmed green hedge as the walls, a lawn as the floor and warm golden-hour light" },
  { id: "estudio", nombre: "Estudio fotográfico", frase: "a seamless light photo-studio backdrop and floor with soft even studio lighting" },
];

export const AMBIENTE_POR_DEFECTO: AmbienteRender = "igual_visor";

/** Tope de la descripción: el inventario de una escena de 6 a 8 piezas con sus colores cabe entero. */
export const MAX_DESCRIPCION = 1800;

/** El cierre del inventario: va siempre al final de la descripción, aunque haya que recortar lo demás. */
export const NADA_MAS = "Nothing else is in the room: no furniture, tables, food, extra balloons or props";
/** El mismo cierre cuando la escena trae su escenografía (mesas, paneles): «ninguna otra», sin contradecirla. */
export const NADA_MAS_CON_UTILERIA = "Nothing else is in the room: no other furniture, tables, food, extra balloons or props";
/** Cómo empieza la frase de la escenografía de la escena en la descripción (`escenaEnIngles`). */
export const PREFIJO_UTILERIA = "Set pieces (not balloons):";
/**
 * Cómo empieza la frase del mobiliario (mesas y sillas) cuando la escena lo trae (`mobiliarioEnIngles`). Es la marca con que
 * `promptRender3d` sabe que las mesas y sillas SON la escena: sin ella (o con ella en un texto ajeno) el prompt conserva sus reglas de siempre
 * («sin muebles, sala vacía»); con ella las quita, porque FLUX borró las mesas de una boda que decían «no other furniture, tables».
 */
export const PREFIJO_MOBILIARIO = "Furniture (main items of the scene):";
/** El cierre del inventario cuando hay mobiliario: nombra lo que no se debe añadir sin negar las mesas y sillas de la escena. */
export const NADA_MAS_CON_MOBILIARIO = "Nothing else is in the room beyond the furniture and decorations listed: no extra tables or chairs, food, extra balloons or props";

/** Cómo empieza la frase de la sala en la descripción (la quita `promptRender3d` cuando el lugar es otro). */
export const PREFIJO_SALA = "The room as shown:";
const FRASE_SALA = /The room as shown:[^.]*\.?\s*/;

/** Lo que FLUX añadía por su cuenta y nunca debe aparecer. */
/**
 * Color: FLUX.2 calentaba y oscurecía toda la foto (la pared de L92 b*4 a L78 b*24) y volvía verde el celeste
 * (render-fiel, 2026-10-08). Con esta frase y el hex de cada color el error medio bajó de ΔE ~25 a ~15.
 */
const COLOR_FIEL = "Color fidelity: every balloon keeps exactly the color it has in the input image and the hex code given for it; do not darken, desaturate or tint the balloons.";
const LUZ_NEUTRA = "Neutral daylight white balance and the same exposure and brightness as the input: do not warm or darken the image.";
/** Si el visor iluminó la sala con luz cálida de estudio (ambiente de la sala), esa calidez es parte de la escena: no se pide quitarla. */
const LUZ_CALIDA = "Keep the warm studio lighting of the input and its exposure and brightness: do not darken the image or change its white balance.";

const NO_ANADIR = "Add nothing that is not in the input: no furniture, tables, desserts, cupcakes, gifts, plants, people, extra balloons, extra trees or extra figures.";
/** Con mobiliario en la escena: no se prohíben mesas ni sillas, solo las de más. */
const NO_ANADIR_CON_MOBILIARIO = "Add nothing that is not in the input: no extra tables or chairs, desserts, cupcakes, gifts, plants, people, extra balloons, extra trees or extra figures.";
const CONSERVAR_MOBILIARIO = "Keep every table, chair and centrepiece exactly as shown in the input: same number, same layout, same positions and sizes; the tables and chairs are main subjects of the photograph and must be clearly visible, not removed, merged or hidden.";

/**
 * El camino fiel para escenas con mobiliario («Igual al visor»): FLUX.1 [dev] imagen-a-imagen sobre la captura, que conserva mesas, sillas,
 * disposición y cámara. FLUX.2 `/edit` (sin control de fuerza) devolvía la sala reencuadrada, sin el panel o con otra disposición. Medido
 * el 2026-10-09 con la boda de prueba (scripts/exp/render-boda.ts): 0,40 casi no cambia la captura; 0,55 conserva mesas, sillas, marco y rótulo y
 * suma tela y látex más reales (los colores se corren un poco); 0,70 ya cambia el arco y borra el panel; con ControlNet salió peor.
 */
export const STRENGTH_FIEL_MOBILIARIO = 0.55;

/** Tamaño (px) de la base de FLUX.1 por proporción: menos de 1 MP (se cobra 1 MP) y múltiplos de 8. */
export const TAMANO_BASE_FIEL: Readonly<Record<"3:2" | "1:1" | "2:3" | "16:9", { ancho: number; alto: number }>> = {
  "3:2": { ancho: 1200, alto: 800 }, "1:1": { ancho: 1000, alto: 1000 }, "2:3": { ancho: 800, alto: 1200 }, "16:9": { ancho: 1280, alto: 720 },
};

/**
 * ¿Esta foto va por el camino fiel? Con mesas Y sillas (la disposición de un salón es lo que no se puede perder) y el lugar de la captura (con otro
 * lugar hay que rehacer paredes y luz, y FLUX.1 no lo hace). Una mesa de postres sola sigue por FLUX.2, que da la foto real.
 */
export function usaCaminoFiel(descripcion: string, ambiente: AmbienteRender): boolean {
  if (ambiente !== "igual_visor" || !traeMobiliario(descripcion)) return false;
  // Solo la frase del mobiliario: el cierre («no extra tables or chairs») también nombra sillas.
  const frase = descripcion.slice(descripcion.indexOf(PREFIJO_MOBILIARIO)).split(PREFIJO_SALA)[0]!.split("Nothing else is in the room")[0]!;
  // «has 4 chairs…» (las sillas de una mesa) o «24 × … chair» (el inventario); «has no chairs» no cuenta.
  return /\bhas [1-9]\d* chairs?\b/.test(frase) || /\b\d+ × [^,.]*\bchair\b/.test(frase);
}

/** ¿La descripción trae mesas o sillas como parte de la escena? (`mobiliarioEnIngles` deja su marca.) */
export const traeMobiliario = (descripcion: string): boolean => descripcion.includes(PREFIJO_MOBILIARIO);

function lugarDe(ambiente: AmbienteRender) {
  return AMBIENTES_RENDER.find((a) => a.id === ambiente) ?? AMBIENTES_RENDER[0]!;
}

/** La descripción lista para el texto: sin la frase de la sala si el lugar no es el del visor, y con su tope. */
function decoracionPara(descripcion: string, ambiente: AmbienteRender): string {
  const limpia = descripcion.replace(/\s+/g, " ").trim();
  const sinSala = ambiente === "igual_visor" ? limpia : limpia.replace(FRASE_SALA, "").trim();
  return sinSala.slice(0, MAX_DESCRIPCION).replace(/[.\s]+$/, "");
}

/** Texto para FLUX.2 `/edit` con la captura 3D como base. `descripcion` la arma el taller (inglés, sin marcas). */
export function promptRender3d(descripcion: string, ambiente: AmbienteRender): string {
  const decoracion = decoracionPara(descripcion, ambiente);
  const mobiliario = traeMobiliario(descripcion);
  // Con mesas y sillas en la escena «vacía» y «sin muebles» las contradicen: la sala es lisa, pero no está vacía.
  const sala = ambiente === "igual_visor"
    ? `Keep the room exactly as shown: same walls, floor, ceiling, colors and perspective, ${mobiliario ? "plain walls with the furniture and decorations described below standing in it" : "all plain and empty"}; only make it a real photographed room (real paint, a real floor, natural light and soft shadows).`
    : `Restyle only the walls, floor and light as ${lugarDe(ambiente).frase}; same room geometry and perspective, the walls stay plain${mobiliario ? ", with the furniture and decorations described below standing in the room" : " and empty"}.`;
  return [
    "Turn this 3D preview into a real professional event photograph.",
    "Keep the balloon decoration exactly as shown: same overall shape, height and width, same number, size, position and color of every balloon and of every decoration; do not add, remove, merge or recolor balloons.",
    "Keep partial and asymmetric shapes as they are: never complete, mirror or close them (a half arch stays a half arch, an open end stays open, empty wall stays empty).",
    "Make it a real photograph, not a 3D render: real latex balloons with natural soft highlights and subtle texture, tightly packed and slightly squashed where they touch (where the preview shows small gaps or see-through spots, the real decoration is full), knots hidden; chrome balloons with mirror reflections, clear balloons see-through.",
    sala,
    mobiliario ? CONSERVAR_MOBILIARIO : "",
    decoracion ? `The decoration: ${decoracion}.` : "",
    COLOR_FIEL,
    ambiente === "igual_visor" ? (descripcion.includes(MARCA_LUZ_CALIDA) ? LUZ_CALIDA : LUZ_NEUTRA) : "",
    mobiliario ? NO_ANADIR_CON_MOBILIARIO : NO_ANADIR,
    "Same camera angle and framing as the input; sharp detail, natural depth.",
  ].filter(Boolean).join(" ");
}

/**
 * Texto para FLUX.1 [dev] imagen-a-imagen (con o sin ControlNet): ese modelo no sigue órdenes («keep», «do not
 * add»), describe; la composición la fija la imagen base. Corto para su codificador de texto (512 tokens).
 */
export function promptRender3dFiel(descripcion: string, ambiente: AmbienteRender): string {
  const decoracion = decoracionPara(descripcion, ambiente);
  const mobiliario = traeMobiliario(descripcion);
  const sala = ambiente === "igual_visor" ? `${mobiliario ? "A room with plain real painted walls and a real floor" : "A plain empty room with real painted walls and a real floor"}, natural light and soft shadows.` : `The room: ${lugarDe(ambiente).frase}.`;
  return [
    "A real professional event photograph of a latex balloon decoration, photorealistic, not a 3D render.",
    decoracion ? `${decoracion}.` : "",
    sala,
    "Real latex balloons with natural soft highlights and subtle texture, tightly packed; sharp detail, natural depth.",
  ].filter(Boolean).join(" ");
}

/**
 * Un color de la sala (hex) en inglés llano: «#f1ece6» → «warm off-white», «#d8cbbb» → «light beige». Para que
 * FLUX conserve la sala del visor sin inventarle otra.
 */
export function tonoEnIngles(hex: string): string {
  const nombre = nombreDeTono(hex);
  return /^#?[0-9a-f]{6}$/i.test(hex.trim()) ? `${nombre} (#${hex.trim().replace("#", "").toUpperCase()})` : nombre;
}

function nombreDeTono(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "plain";
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), croma = max - min, luz = (max + min) / 2;
  let tono = 0;
  if (croma > 0) tono = max === r ? 60 * (((g - b) / croma) % 6) : max === g ? 60 * ((b - r) / croma + 2) : 60 * ((r - g) / croma + 4);
  if (tono < 0) tono += 360;
  if (croma < 0.03) return luz >= 0.95 ? "white" : luz >= 0.85 ? "off-white" : luz >= 0.7 ? "light gray" : luz >= 0.45 ? "gray" : luz >= 0.2 ? "dark gray" : "black";
  if (croma < 0.25 && tono >= 15 && tono < 60) return luz >= 0.88 ? "off-white" : luz >= 0.7 ? "light beige" : luz >= 0.5 ? "beige" : luz >= 0.3 ? "brown" : "dark brown";
  const nombre = tono < 15 || tono >= 345 ? "red" : tono < 40 ? "orange" : tono < 65 ? "yellow" : tono < 160 ? "green" : tono < 195 ? "turquoise" : tono < 250 ? "blue" : tono < 290 ? "purple" : "pink";
  return `${luz >= 0.75 ? "light " : luz < 0.3 ? "dark " : ""}${nombre}`;
}

/**
 * Un color de globo para FLUX: su nombre en inglés de la tabla oficial y su hex de globo, «light aqua blue
 * (#4BBBCF)». El nombre «turquoise» de un color que en el globo es más azul que verde (Fashion Azul Caribe) lo
 * leía FLUX como verde azulado: se dice «light aqua blue».
 */
export function colorDeGloboEnIngles(ref: { nombreEn: string; hexGlobo?: string | null }): string {
  const hex = ref.hexGlobo && /^#[0-9a-f]{6}$/i.test(ref.hexGlobo) ? ref.hexGlobo.toUpperCase() : null;
  const azulado = hex ? parseInt(hex.slice(5, 7), 16) > parseInt(hex.slice(3, 5), 16) : false;
  const nombre = azulado ? ref.nombreEn.replace(/\bturquoise\b/, "light aqua blue") : ref.nombreEn;
  return hex ? `${nombre} (${hex})` : nombre;
}

/**
 * Los colores de una pieza, de más a menos: los principales (≥ 15 %, hasta 3) y los acentos (lo demás ≥ 3 %, hasta
 * 2): «turquoise and matte lime green with matte red accents». Vacío si no hay globos.
 */
export function coloresEnIngles(colores: ReadonlyArray<{ nombre: string; cantidad: number }>): string {
  const suma = new Map<string, number>();
  for (const c of colores) if (c.cantidad > 0) suma.set(c.nombre, (suma.get(c.nombre) ?? 0) + c.cantidad);
  const total = [...suma.values()].reduce((a, b) => a + b, 0);
  if (!total) return "";
  const orden = [...suma.entries()].sort((a, b) => b[1] - a[1]);
  const principales = orden.filter(([, n], i) => i === 0 || n / total >= 0.15).slice(0, 3).map(([nombre]) => nombre);
  const acentos = orden.filter(([nombre, n]) => !principales.includes(nombre) && n / total >= 0.03).slice(0, 2).map(([nombre]) => nombre);
  return `${enLista(principales)}${acentos.length ? ` with ${enLista(acentos)} accents` : ""}`;
}

/** «a», «a and b», «a, b and c». */
export function enLista(l: readonly string[]): string {
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0] ?? "";
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
 * Cierra siempre con `NADA_MAS` (el inventario es cerrado) y respeta `MAX_DESCRIPCION` por prioridad: primero la
 * estructura (en una escena, el inventario pieza a pieza con su silueta), luego lo extra, los colores y los tamaños,
 * que solo entran si caben enteros.
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
  const nadaMas = traeMobiliario(estructura) ? NADA_MAS_CON_MOBILIARIO : estructura.includes(PREFIJO_UTILERIA) ? NADA_MAS_CON_UTILERIA : NADA_MAS;
  const cierre = `. ${nadaMas}`;
  const base = estructura.replace(nadaMas, "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const cupo = MAX_DESCRIPCION - cierre.length;
  // Si no cabe, se corta en el último «;» (entre piezas del inventario) o, si no hay, en la última palabra.
  const corte = base.slice(0, cupo - 1);
  const pieza = corte.lastIndexOf("; ");
  let texto = base.length <= cupo ? base : `${pieza > cupo * 0.6 ? corte.slice(0, pieza) : corte.replace(/[,;\s]+\S*$/, "")}…`;
  for (const parte of [extra.trim().replace(/[.\s]+$/, ""), colores.length && !/\(#[0-9A-F]{6}\)/.test(estructura) ? `Colors: about ${colores.join(", ")}` : "", tamanos.length ? `Sizes: ${tamanos.join(", ")}` : ""]) {
    if (parte && texto.length + 2 + parte.length <= cupo) texto = texto ? `${texto}. ${parte}` : parte;
  }
  return texto ? `${texto}${cierre}` : nadaMas;
}
