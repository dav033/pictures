import { descripcionFisicaTamano } from "@/lib/ia/escena/tamano-fisico";
import type { PlanResuelto } from "./resuelto";

export type ResultadoCoherencia = { ok: boolean; errores: string[] };

/**
 * Lo que la escena aprobada dice de una instalación, en la forma mínima que
 * necesita esta comprobación: la capa del plan no depende del SceneSpec.
 */
export type ElementoEscenaCoherencia = {
  element_id: string;
  /** Nombre tal como aparece en el prompt (`promptElementName`). */
  nombre_en_prompt: string;
  /** `visual_semantics.repetition_group`: la estructura del plan a la que pertenece. */
  estructura_id: string;
  resolved_colors: readonly string[];
  /** El prompt emite una línea de color para este elemento (`tieneContratoDeColor`). */
  espera_linea_de_color: boolean;
};

export type EscenaParaCoherencia = {
  elementos: readonly ElementoEscenaCoherencia[];
};

export type CaptionParaCoherencia = {
  /** Cláusulas compiladas, con los colores ya traducidos al inglés. */
  clausulas: ReadonlyArray<{ elementIds: readonly string[]; colors: readonly string[] }>;
  /** El mismo traductor con el que se compiló el caption (`translateLoraColor`). */
  traducirColor: (color: string) => string;
};

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function conjunto(colores: Iterable<string>): Set<string> {
  return new Set([...colores].map(plegar).filter(Boolean));
}

function iguales(esperado: ReadonlySet<string>, encontrado: ReadonlySet<string>): boolean {
  return esperado.size === encontrado.size && [...esperado].every((color) => encontrado.has(color));
}

function diferencia(esperado: ReadonlySet<string>, encontrado: ReadonlySet<string>): string {
  const faltan = [...esperado].filter((color) => !encontrado.has(color));
  const sobran = [...encontrado].filter((color) => !esperado.has(color));
  return [faltan.length ? `faltan ${faltan.join(", ")}` : "", sobran.length ? `sobran ${sobran.join(", ")}` : ""].filter(Boolean).join("; ") || "orden distinto";
}

function faltantes(esperado: ReadonlySet<string>, encontrado: ReadonlySet<string>): string[] {
  return [...esperado].filter((color) => !encontrado.has(color));
}

/**
 * Las líneas de color por elemento del prompt (`colorVarietyContract`), por el
 * nombre con que aparecen. Se leen del prompt real, no del generador: lo que
 * se comprueba es lo que se va a enviar.
 *
 * Un nombre puede repetirse: `PlanDecoracionSchema` no exige que el `nombre` de
 * dos estructuras sea distinto y `promptElementName` además borra el paréntesis
 * de medidas ("Arco (2 m)" y "Arco (3 m)" colapsan). Por eso se guardan TODAS
 * las líneas de cada nombre y no solo la última: quedarse con una sola hacía
 * fallar cerrado un prompt correcto con dos estructuras homónimas.
 */
const LINEA_COLOR = /^- (.+?): (?:APPROVED COLOR VARIETY — use exactly these catalog colors: ([^.]+)\.|MONOCHROME LOCK — use only ([^;]+);)/;

function coloresPorElementoEnPrompt(prompt: string): Map<string, Array<Set<string>>> {
  const lineas = new Map<string, Array<Set<string>>>();
  for (const linea of prompt.split("\n")) {
    const match = LINEA_COLOR.exec(linea);
    if (!match) continue;
    lineas.set(match[1]!, [...(lineas.get(match[1]!) ?? []), conjunto((match[2] ?? match[3] ?? "").split(","))]);
  }
  return lineas;
}

function coloresDeEstructura(estructura: PlanResuelto["estructuras"][number]): Set<string> {
  return conjunto(estructura.lineas.map((linea) => linea.color).filter((color): color is string => Boolean(color)));
}

function elementosDeEstructura(escena: EscenaParaCoherencia, estructuraId: string): ElementoEscenaCoherencia[] {
  return escena.elementos.filter((elemento) => elemento.estructura_id === estructuraId);
}

/**
 * Última comprobación antes de una llamada pagada al modelo de imagen. Falla
 * cerrado: cada estructura del plan tiene que estar nombrada, cada diámetro
 * comprado tiene que aparecer con su descripción física, no puede aparecer uno
 * que no se cotizó y —con la escena aprobada— los colores de cada estructura
 * tienen que ser exactamente los de sus líneas compradas.
 *
 * La comprobación de color es ESTRUCTURAL, no una búsqueda de subcadenas: el
 * bloque global "Installed color distribution" nombra todos los colores de la
 * escena, así que un "aparece en el prompt" se cumpliría aunque una estructura
 * perdiera o cambiara el suyo.
 */
export function verificarCoherenciaPrompt(prompt: string, plan: PlanResuelto, escena?: EscenaParaCoherencia): ResultadoCoherencia {
  const errores: string[] = [];
  for (const estructura of plan.estructuras) {
    if (!prompt.includes(estructura.estructura_id) && !prompt.includes(estructura.nombre)) errores.push(`falta estructura ${estructura.estructura_id} en el prompt`);
  }
  const comprados = new Set(plan.compras.filter((compra) => compra.diam_pulg != null).map((compra) => compra.diam_pulg));
  for (const compra of plan.compras) {
    if (compra.diam_pulg == null) continue;
    const descripcion = descripcionFisicaTamano(compra.diam_pulg, "redondo");
    if (!descripcion || !prompt.includes(`${compra.diam_pulg}-inch`) || !prompt.includes(`${Math.round(compra.diam_pulg * 2.54 * 10) / 10} cm`)) {
      errores.push(`falta tamaño físico ${compra.tamano_codigo ?? `R-${compra.diam_pulg}`} en el prompt`);
    }
  }
  const sizeLines = [...prompt.matchAll(/(\d+(?:\.\d+)?)-inch/g)].map((match) => Number(match[1]));
  for (const diametro of sizeLines) if (!comprados.has(diametro)) errores.push(`el prompt menciona diámetro no cotizado: ${diametro} pulgadas`);
  if (escena) errores.push(...erroresDeColor(prompt, plan, escena));
  return { ok: errores.length === 0, errores };
}

function erroresDeColor(prompt: string, plan: PlanResuelto, escena: EscenaParaCoherencia): string[] {
  const errores: string[] = [];
  const lineasDelPrompt = coloresPorElementoEnPrompt(prompt);
  // El prompt emite exactamente una línea por elemento con contrato de color
  // (`tieneContratoDeColor`, su único dueño), así que el conteo por nombre tiene
  // que cuadrar: es lo que detecta una línea perdida cuando dos elementos
  // comparten nombre y una sola línea valdría para los dos.
  const esperadasPorNombre = new Map<string, number>();
  for (const elemento of escena.elementos) {
    if (!elemento.espera_linea_de_color) continue;
    esperadasPorNombre.set(elemento.nombre_en_prompt, (esperadasPorNombre.get(elemento.nombre_en_prompt) ?? 0) + 1);
  }
  for (const [nombre, esperadas] of esperadasPorNombre) {
    const encontradas = lineasDelPrompt.get(nombre)?.length ?? 0;
    if (encontradas !== esperadas) errores.push(`el prompt trae ${encontradas} línea(s) de color de "${nombre}" y la escena espera ${esperadas}`);
  }
  for (const estructura of plan.estructuras) {
    const esperados = coloresDeEstructura(estructura);
    const elementos = elementosDeEstructura(escena, estructura.estructura_id);
    if (elementos.length === 0) {
      errores.push(`la escena no tiene ningún elemento de ${estructura.estructura_id}`);
      continue;
    }
    // Se comprueba que no FALTE ningún color comprado, no la igualdad exacta:
    // los colores del elemento salen de la variante del catálogo, que puede
    // declarar más colores que los que compró la línea. Un color que se pierde
    // o se sustituye —el fallo que esto cierra— aparece siempre como faltante.
    const enEscena = conjunto(elementos.flatMap((elemento) => elemento.resolved_colors));
    const perdidos = faltantes(esperados, enEscena);
    if (perdidos.length) {
      errores.push(`los colores de ${estructura.estructura_id} en la escena no son los comprados (faltan ${perdidos.join(", ")})`);
    }
    if (esperados.size === 0) continue;
    for (const elemento of elementos) {
      if (!elemento.espera_linea_de_color) continue;
      const enPrompt = lineasDelPrompt.get(elemento.nombre_en_prompt) ?? [];
      if (enPrompt.length === 0) {
        errores.push(`falta la línea de color de "${elemento.nombre_en_prompt}" en el prompt`);
        continue;
      }
      const propios = conjunto(elemento.resolved_colors);
      // Basta con que ALGUNA línea de ese nombre liste exactamente sus colores:
      // dos líneas homónimas son indistinguibles en el texto, y el conteo de
      // arriba ya garantiza que hay una por elemento. Lo que esto cierra —una
      // estructura que pierde o cambia un color— sigue apareciendo, porque
      // ninguna línea listaría ese conjunto.
      if (!enPrompt.some((linea) => iguales(propios, linea))) {
        errores.push(`la línea de color de "${elemento.nombre_en_prompt}" no lista sus colores (${diferencia(propios, enPrompt[0]!)})`);
      }
    }
  }
  return errores;
}

/**
 * Misma regla sobre el caption compilado del LoRA, que nunca pasa por
 * `verificarCoherenciaPrompt`: sus cláusulas tienen que nombrar exactamente
 * los colores comprados de cada estructura, ya traducidos al inglés. Se
 * comprueban las CLÁUSULAS y no el texto renderizado porque la compactación
 * puede referir un color repetido ("in matching white") sin volver a nombrarlo.
 */
export function verificarColoresCaptionLora(plan: PlanResuelto, escena: EscenaParaCoherencia, caption: CaptionParaCoherencia): ResultadoCoherencia {
  const errores: string[] = [];
  for (const estructura of plan.estructuras) {
    const esperados = coloresDeEstructura(estructura);
    if (esperados.size === 0) continue;
    const ids = new Set(elementosDeEstructura(escena, estructura.estructura_id).map((elemento) => elemento.element_id));
    if (ids.size === 0) continue;
    const clausulas = caption.clausulas.filter((clausula) => clausula.elementIds.some((id) => ids.has(id)));
    if (clausulas.length === 0) {
      errores.push(`el caption LoRA no describe ${estructura.estructura_id}`);
      continue;
    }
    const traducidos = conjunto([...esperados].map(caption.traducirColor));
    const enCaption = conjunto(clausulas.flatMap((clausula) => clausula.colors));
    const perdidos = faltantes(traducidos, enCaption);
    if (perdidos.length) {
      errores.push(`los colores de ${estructura.estructura_id} en el caption LoRA no son los comprados (faltan ${perdidos.join(", ")})`);
    }
  }
  return { ok: errores.length === 0, errores };
}
