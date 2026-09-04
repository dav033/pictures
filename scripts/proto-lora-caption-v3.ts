import fs from "node:fs";
import path from "node:path";
import { medirAfinidad } from "./lora-caption-affinity";

/**
 * PROTOTIPO (no productivo) del compilador de captions v3.
 *
 * Objetivo: demostrar que se puede expresar el MISMO contenido semántico del
 * plan usando la gramática real de los 154 captions de entrenamiento, y que
 * eso sube la afinidad de -6/100 (compilador v2 actual) a ~88/100 (techo del
 * dataset) sin perder ninguna estructura.
 *
 * Plantilla derivada empíricamente del dataset:
 *
 *   <trigger>, <apertura: "an organic balloon <tipo>"> of <tamaño+acabado+color>
 *   round balloons[, accented with <relleno>][, <conector> <estructura 2>]…
 *   [, beside <objeto de contexto>], set against <superficie> under
 *   <cualidad> indoor lighting.
 *
 * Frecuencias que la plantilla respeta (medidas sobre los 154 captions):
 *   matte/glossy/chrome 82% · "round balloons" 62% · cierre con lighting 75%
 *   conector espacial 60% · superficie pared/piso 55% · large/small 45%
 */

type Estructura = {
  tipo: "arco" | "columna" | "guirnalda" | "centro_mesa" | "backdrop" | "pared" | "cluster";
  ubicacion: "arco_central" | "entrada" | "lateral_izquierdo" | "lateral_derecho" | "sobre_mesa_principal" | "fondo_pared" | "techo" | "piso_frontal" | "mesas_invitados";
  rol: "focal" | "soporte" | "acento";
  colores: string[];
  acabados: string[];
  diametrosPulg?: number[];
  grupo?: string;
};

type Escena = { nombre: string; estructuras: Estructura[]; espacio: "salon" | "jardin"; iluminacion?: "soft warm" | "bright even" | "soft" };

// --- Léxico calcado del dataset (no inventado) ---

/**
 * Sustantivo de estructura con el modificador de apertura más frecuente.
 *
 * `arco` -> "balloon garland arch" a propósito: en el corpus el token `arch`
 * solo está repartido entre tres referentes visuales (arco 3D de globos,
 * panel plano con silueta de arco en 6 captions, y aro/marco metálico en 9),
 * y esa ambigüedad es la explicación más directa de los "arcos que salen como
 * portal rectangular". El bigrama `garland arch` (16 captions) fuerza el
 * referente 3D orgánico y desambigua.
 */
const NUCLEO: Record<Estructura["tipo"], string> = {
  arco: "balloon garland arch",
  columna: "balloon column",
  guirnalda: "organic balloon garland",
  centro_mesa: "low balloon centerpiece",
  backdrop: "balloon backdrop panel",
  pared: "dense balloon wall",
  cluster: "organic balloon cluster",
};

/**
 * Traducción de acabado Sempertex -> inglés, tomada del MISMO mapeo que usó el
 * generador de captions de entrenamiento (src/lib/ordenes/generarCaption.ts):
 * Fashion = matte solid, Reflex = glossy chrome/mirror, Silk = satin,
 * Pastel Matte = soft pastel matte, Metalizado = metallic foil.
 * El compilador v2 en producción emite "Reflex" (1% del dataset) y "fashion"
 * (3%) en crudo — por eso quedan fuera de distribución.
 */
const ACABADO: Record<string, string> = {
  reflex: "glossy chrome",
  fashion: "matte solid",
  mate: "matte",
  matte: "matte",
  metalizado: "metallic foil",
  metal: "metallic foil",
  satin: "satin",
  silk: "satin",
  perlado: "pearl",
  "pastel matte": "soft pastel matte",
  deluxe: "premium matte",
  transparente: "clear",
};

const COLOR: Record<string, string> = {
  rojo: "red", rosado: "pink", rosa: "pink", "dorado rosa": "rose gold", dorado: "gold",
  plateado: "silver", blanco: "white", negro: "black", azul: "navy blue", celeste: "light blue",
  verde: "green", amarillo: "yellow", naranja: "orange", morado: "purple", lila: "lilac",
  crema: "cream", marfil: "ivory", cafe: "chocolate brown", gris: "grey", nude: "nude",
};

/**
 * Ancla física concreta, tomada literalmente del corpus. Las 9
 * PLACEMENT_PHRASES del compilador v2 en producción tienen frecuencia 0/154
 * ("standing on the left side", "installed against the rear wall",
 * "centered around the stage photo area"…) — son invención propia y empujan
 * el sampling fuera de distribución justo en el eje que falla.
 */
const ANCLA: Record<Estructura["ubicacion"], string> = {
  arco_central: "framing a backdrop panel",  // "framing" 24 captions
  entrada: "framing a doorway",              // "doorway" 4 captions; "entrance" 0
  lateral_izquierdo: "on one side",          // patrón de 15716-1
  lateral_derecho: "on the other",
  sobre_mesa_principal: "on a party table",  // "party table" 6; "main table" 0
  fondo_pared: "set against a wall",         // "against a … wall" 51 captions
  techo: "hanging from the ceiling",         // "ceiling" 27 captions
  piso_frontal: "in a room corner",          // "corner" 22 captions
  mesas_invitados: "on party tables",
};

/** Superficies de cierre atestiguadas: "tiled floor" 8, "white wall" 7, "grass" 8. */
const SUPERFICIE: Record<Escena["espacio"], string> = {
  salon: "a white wall and tiled floor",
  jardin: "a garden wall and artificial grass",
};

const norm = (value: string): string => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const traducirColor = (value: string): string => COLOR[norm(value)] ?? norm(value);
const traducirAcabado = (value: string): string => ACABADO[norm(value)] ?? norm(value);

function unir(items: string[]): string {
  const unicos = [...new Set(items.filter(Boolean))];
  if (unicos.length <= 1) return unicos[0] ?? "";
  return `${unicos.slice(0, -1).join(", ")} and ${unicos[unicos.length - 1]}`;
}

/** "large matte pink and glossy rose gold chrome round balloons" */
function frasesDeMaterial(estructura: Estructura, tamano: "large" | "small" | ""): string {
  const acabados = estructura.acabados.map(traducirAcabado);
  const colores = estructura.colores.map(traducirColor);
  // El dataset entrelaza acabado+color por globo, no los lista por separado.
  const partes = colores.map((color, index) => {
    const acabado = acabados[index] ?? acabados[0] ?? "matte";
    return `${acabado} ${color}`;
  });
  const prefijo = tamano ? `${tamano} ` : "";
  return `${prefijo}${unir(partes)} round balloons`;
}

/** Glosa de diámetro en el formato del dataset: "R-12 (12-inch)" — 26% lo usa. */
function frasesDeTamano(diametros: number[] | undefined): string {
  if (!diametros?.length) return "";
  const unicos = [...new Set(diametros)].sort((a, b) => b - a);
  return ` in ${unir(unicos.map((d) => `R-${d} (${d}-inch)`))} sizes`;
}

export function compilarV3(escena: Escena): string {
  const focal = escena.estructuras.find((e) => e.rol === "focal") ?? escena.estructuras[0]!;
  const resto = escena.estructuras.filter((e) => e !== focal);

  // 1) Sujeto: estructura focal con material y ancla física.
  const sujeto = `an ${NUCLEO[focal.tipo].replace(/^(a|an) /, "")} of ${frasesDeMaterial(focal, "large")}${frasesDeTamano(focal.diametrosPulg)}, ${ANCLA[focal.ubicacion]}`;

  // 2) Pares bilaterales: el dataset dice "flanked by two tall matching
  //    balloon columns", nunca "one standing on the left and one on the right".
  const clausulas: string[] = [];
  const porGrupo = new Map<string, Estructura[]>();
  for (const estructura of resto) {
    const clave = estructura.grupo ?? estructura.tipo + Math.random();
    porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), estructura]);
  }
  for (const grupo of porGrupo.values()) {
    const primera = grupo[0]!;
    const esPar = grupo.length === 2
      && grupo.some((e) => e.ubicacion === "lateral_izquierdo")
      && grupo.some((e) => e.ubicacion === "lateral_derecho");
    if (esPar) {
      // Patrón literal de 14684-1: "two tall balloon columns in <material>
      // flanking <objeto>". Es el único ejemplo bilateral con estructura real
      // y numeral del corpus, junto con 15716-1.
      clausulas.push(`flanked by two tall ${NUCLEO[primera.tipo].replace(/^organic /, "")}s of ${frasesDeMaterial(primera, "")}`);
    } else if (primera.tipo === "centro_mesa") {
      // "beside" NO se usa entre dos estructuras de globo: en el corpus une la
      // estructura con MOBILIARIO (31 de 45 casos: gift table, dessert table,
      // pedestal, neon sign). Acá el complemento sí es un mueble, así que es
      // el uso correcto y atestiguado.
      clausulas.push(`beside a party table holding a ${NUCLEO[primera.tipo].replace(/^(a|an) /, "")} of ${frasesDeMaterial(primera, "small")}`);
    } else {
      // Para una segunda estructura de globo que no es par ni centro de mesa,
      // se evita "beside" (leería "mueble") y se usa "with … <ancla>".
      clausulas.push(`with ${grupo.length > 1 ? `${grupo.length} ` : "a "}${NUCLEO[primera.tipo].replace(/^(a|an) /, "")} of ${frasesDeMaterial(primera, "")} ${ANCLA[primera.ubicacion]}`);
    }
  }

  // 3) Cierre obligatorio: superficie + iluminación (75% del dataset).
  const luz = escena.iluminacion ?? "soft warm";
  const cierre = `set against ${SUPERFICIE[escena.espacio]} under ${luz} indoor lighting`;

  return [sujeto, ...clausulas, cierre].join(", ") + ".";
}

// --- Validación sobre escenas reales del producto ---

function main(): void {
  const captions = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/processed/export-general-2026-08-27.json"), "utf8")) as { entradas: Array<{ texto: string }> })
    .entradas.map((entrada) => entrada.texto.replace(/^eventdecor_style_v2,\s*/i, "").toLowerCase());

  const escenas: Escena[] = [
    {
      nombre: "XV años — arco central + 2 columnas + centro de mesa (el caso que falla)",
      espacio: "salon",
      estructuras: [
        { tipo: "arco", ubicacion: "arco_central", rol: "focal", colores: ["rosado", "dorado rosa"], acabados: ["reflex", "metalizado"], diametrosPulg: [12, 5] },
        { tipo: "columna", ubicacion: "lateral_izquierdo", rol: "soporte", colores: ["rosado", "dorado rosa"], acabados: ["reflex", "metalizado"], grupo: "col" },
        { tipo: "columna", ubicacion: "lateral_derecho", rol: "soporte", colores: ["rosado", "dorado rosa"], acabados: ["reflex", "metalizado"], grupo: "col" },
        { tipo: "centro_mesa", ubicacion: "sobre_mesa_principal", rol: "acento", colores: ["dorado rosa"], acabados: ["metalizado"] },
      ],
    },
    {
      nombre: "Cumpleaños — un arco en la entrada",
      espacio: "salon",
      estructuras: [{ tipo: "arco", ubicacion: "entrada", rol: "focal", colores: ["rojo", "dorado"], acabados: ["fashion", "metalizado"], diametrosPulg: [12] }],
    },
    {
      nombre: "Boda jardín — guirnalda + backdrop",
      espacio: "jardin",
      iluminacion: "soft",
      estructuras: [
        { tipo: "guirnalda", ubicacion: "fondo_pared", rol: "focal", colores: ["blanco", "crema"], acabados: ["mate", "perlado"], diametrosPulg: [18, 9, 5] },
        { tipo: "backdrop", ubicacion: "fondo_pared", rol: "soporte", colores: ["marfil"], acabados: ["satin"] },
      ],
    },
  ];

  let suma = 0;
  for (const escena of escenas) {
    const prompt = compilarV3(escena);
    const reporte = medirAfinidad(prompt, captions);
    suma += reporte.score;
    console.log(`\n${"=".repeat(80)}\n${escena.nombre}\nSCORE ${reporte.score}/100 — ${reporte.longitud} chars — unigramas ${reporte.unigramaEnDistribucion}% / bigramas ${reporte.bigramaEnDistribucion}%\n${"=".repeat(80)}`);
    console.log(`eventdecor_style_v2, ${prompt}`);
    const faltan = reporte.rasgosCubiertos.filter((rasgo) => !rasgo.presente);
    if (faltan.length) console.log(`  FALTAN: ${faltan.map((rasgo) => rasgo.nombre).join(" | ")}`);
    if (reporte.frasesFueraDeDistribucion.length) console.log(`  FUERA DE DISTRIBUCIÓN: ${reporte.frasesFueraDeDistribucion.join(" | ")}`);
    if (reporte.tokensDesconocidos.length) console.log(`  tokens nunca vistos: ${reporte.tokensDesconocidos.join(", ")}`);
  }
  console.log(`\n>>> Score medio v3: ${Math.round(suma / escenas.length)}/100   (techo del dataset: 88 · compilador v2 actual: -6)`);
}

main();
