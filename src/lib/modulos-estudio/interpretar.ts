import { z } from "zod";
import { TABLA_SEMPERTEX, referenciaDelCatalogo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { FORMATOS_ESTUDIO, resolverConfig, type ConfigModulo } from "./configuracion";

/**
 * De un pedido en palabras («un dúo de reflex rojo con azul mate») a la configuración del estudio (US-2). El modelo solo
 * separa las palabras (tipo, tamaño y, por globo, el nombre del color y el acabado que dijo la persona); los códigos del
 * catálogo salen de aquí, de `referenciaDelCatalogo`: un color o acabado que el catálogo no tiene se REPORTA, nunca se inventa.
 * Puro y sin red: lo usan la ruta y las pruebas.
 */

export const TIPOS_PEDIDO = ["pareja", "trio", "cuarteto", "quinteto", "sexteto"] as const;

export const SalidaInterpretacionSchema = z.object({
  tipo: z.enum(TIPOS_PEDIDO).nullable(),
  tamano: z.string().max(30).nullable(),
  globos: z.array(z.object({ color: z.string().min(1).max(60), acabado: z.string().max(40).nullable() })).max(12),
});
export type SalidaInterpretacion = z.infer<typeof SalidaInterpretacionSchema>;

/** El esquema que se le pasa a Gemini (JSON Schema simple, sin `additionalProperties`). */
export const ESQUEMA_INTERPRETACION = {
  type: "object",
  properties: {
    tipo: { type: "string", enum: [...TIPOS_PEDIDO], nullable: true },
    tamano: { type: "string", nullable: true },
    globos: {
      type: "array",
      items: { type: "object", properties: { color: { type: "string" }, acabado: { type: "string", nullable: true } }, required: ["color", "acabado"] },
    },
  },
  required: ["tipo", "tamano", "globos"],
} as const;

export const INSTRUCCION_INTERPRETACION = [
  "Eres el intérprete del estudio de módulos de globos. Recibes un pedido en español y devuelves SOLO el JSON del esquema.",
  "tipo: pareja (también «dúo» o «duo»), trio, cuarteto, quinteto o sexteto; null si no lo dice.",
  "tamano: el tamaño del globo tal como lo dice («12», «R-12», «9 pulgadas»); null si no lo dice.",
  "globos: un elemento por color que la persona nombra, en el orden en que lo dice. color: solo el nombre del color en español («rojo», «azul rey», «verde lima»), sin el acabado. acabado: la palabra del acabado si la dijo («reflex», «cromado», «mate», «perlado», «satín», «cristal», «neón»); null si no.",
  "Si la persona dice «dos rojos y un azul» escribe un elemento por globo (rojo, rojo, azul). No inventes colores ni acabados que no dijo.",
].join("\n");

export type Interpretacion =
  | { ok: true; config: ConfigModulo; avisos: string[]; desconocidos: [] }
  | { ok: false; errores: string[]; desconocidos: string[]; avisos: string[] };

/** «12», «R-12», «R12», «12 pulgadas», «12"» → «R-12»; `null` si no es un tamaño del estudio. */
export function tamanoDePedido(texto: string | null): string | null {
  const m = texto ? /(?:^|\D)(5|9|12|18|24)\s*(?:"|''|pulg|in)?/i.exec(texto) : null;
  const id = m ? `R-${m[1]}` : null;
  return id && FORMATOS_ESTUDIO.includes(id) ? id : null;
}

export function interpretarSalida(salida: SalidaInterpretacion): Interpretacion {
  const errores: string[] = [];
  const avisos: string[] = [];
  const desconocidos: string[] = [];
  const codigos: string[] = [];
  if (!salida.tipo) errores.push("No entendí qué módulo quieres: dúo, trío, cuarteto, quinteto o sexteto.");
  if (salida.globos.length === 0) errores.push("No entendí de qué colores lo quieres.");
  for (const g of salida.globos) {
    const { color, acabado } = separarAcabado(g.color, g.acabado);
    const ref = referenciaPedida(color, acabado) ?? referenciaDelCatalogo(color, acabado);
    if (!ref) {
      desconocidos.push(acabado ? `${color} ${acabado}` : color);
      continue;
    }
    // Pidió un acabado que ese color no tiene (el catálogo cae en otro): se dice, no se oculta.
    if (plegar(ref.nombre) !== plegar(color) && plegar(ref.nombre).includes(plegar(color))) avisos.push(`«${color}» en ${ref.familia === "reflex" ? "Reflex" : "ese acabado"} es ${ref.nombreCompleto} (${ref.codigo}).`);
    else if (acabado && !acabadoCoincide(acabado, ref.familia)) avisos.push(`«${color}» no existe en «${acabado}»: se usó ${ref.nombreCompleto} (${ref.codigo}).`);
    codigos.push(ref.codigo);
  }
  if (desconocidos.length > 0) errores.push(`Esos colores no están en el catálogo Sempertex: ${desconocidos.join(", ")}.`);
  if (errores.length > 0 || !salida.tipo) return { ok: false, errores, desconocidos, avisos };
  const tamano = tamanoDePedido(salida.tamano);
  if (salida.tamano && !tamano) avisos.push(`El tamaño «${salida.tamano}» no está en el estudio: se usó R-12.`);
  const resuelta = resolverConfig({ tipo: salida.tipo, ...(tamano ? { formatoId: tamano } : {}), colores: codigos });
  if (!resuelta.ok) return { ok: false, errores: resuelta.errores, desconocidos: [], avisos };
  return { ok: true, config: resuelta.config, avisos: [...avisos, ...resuelta.avisos], desconocidos: [] };
}

const FAMILIAS_DE_PALABRA: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/reflex|cromad|crom/i, ["reflex", "metal"]],
  [/metal/i, ["metal", "reflex"]],
  [/satin|perla|silk|nacar/i, ["satin", "silk"]],
  [/pastel/i, ["pastelMate", "pastelDusk"]],
  [/neon/i, ["neon"]],
  [/cristal|transparent|translucid/i, ["cristal"]],
  [/mate|fashion/i, ["fashion", "pastelMate", "neon"]],
];

const plegar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

const PALABRA_ACABADO = /\b(reflex|cromad[oa]s?|metal(?:izad[oa]s?)?|satin(?:ad[oa]s?)?|perlad[oa]s?|silk|pastel|neon|cristal|transparente|translucid[oa]|mate|fashion)\b/;

/** Si el modelo dejó el acabado pegado al color («rojo cristal», «reflex rojo») se separa; si lo único que queda es la palabra, es el color. */
function separarAcabado(color: string, acabado: string | null): { color: string; acabado: string | null } {
  if (acabado) return { color, acabado };
  const plano = plegar(color);
  // «Cristal» a secas es el globo transparente (390 «Cristal Transparente»), no un color.
  if (/^(cristal|transparente|cristal transparente|translucido)$/.test(plano)) return { color: "transparente", acabado: "cristal" };
  const m = PALABRA_ACABADO.exec(plano);
  const resto = m ? plano.replace(m[0], "").replace(/\s+/g, " ").trim() : "";
  return m && resto ? { color: resto, acabado: m[0] } : { color, acabado: null };
}

/**
 * El catálogo nombra distinto a los Reflex («Cristal Rojo», no «Rojo»): «rojo reflex» no es el Rojo de otra familia.
 * Con un acabado dicho, se busca primero en su familia (en orden de preferencia) un color cuyo nombre contenga la palabra
 * entera del color; `null` si ninguno, y entonces manda `referenciaDelCatalogo`.
 */
function referenciaPedida(color: string, acabado: string | null): ReferenciaSempertex | null {
  if (!acabado) return null;
  const regla = FAMILIAS_DE_PALABRA.find(([re]) => re.test(plegar(acabado)));
  if (!regla) return null;
  const palabra = ` ${plegar(color)} `;
  for (const familia of regla[1]) {
    const deFamilia = TABLA_SEMPERTEX.referencias.filter((r) => r.familia === familia);
    // El nombre exacto gana a uno que solo lo contiene («azul» es el Azul, no el Azul Rey).
    const hallada = deFamilia.find((r) => plegar(r.nombre) === plegar(color)) ?? deFamilia.find((r) => ` ${plegar(r.nombre)} `.includes(palabra));
    if (hallada) return hallada;
  }
  // «Cristal» también es el nombre de los Reflex («Cristal Rojo» 915): «rojo cristal» es ese, no un globo transparente rojo.
  if (/cristal|transparent|translucid/.test(plegar(acabado))) {
    return TABLA_SEMPERTEX.referencias.find((r) => r.familia === "reflex" && ` ${plegar(r.nombre)} `.includes(" cristal ") && ` ${plegar(r.nombre)} `.includes(palabra)) ?? null;
  }
  return null;
}

function acabadoCoincide(palabra: string, familia: string): boolean {
  const plegada = palabra.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const regla = FAMILIAS_DE_PALABRA.find(([re]) => re.test(plegada));
  return regla ? regla[1].includes(familia) : true;
}
