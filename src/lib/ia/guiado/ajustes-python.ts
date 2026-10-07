import { z } from "zod";
import { esSustitucionDeColor } from "@/lib/plan/colores-referencia";
import { esEstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";
import { faltantesCliente, supuestoCliente, sustitucionesCliente } from "@/lib/plan/presentacion-cliente";

/**
 * «Ajustes que hice» de la vista guiada: lo que Python cambió o supuso al resolver el plan, en palabras de cliente.
 *
 * Comparador 100, I5: la clásica muestra «Ajustes que hice» (p. ej. «no hay 18″ en ese color; usamos 24″») y los avisos
 * del reparto; ningún componente de la guiada leía `sustituciones`, `sin_cobertura`, `supuestos` ni `advertencias`, así
 * que el cliente no se enteraba de lo que Python sustituyó. Las mismas frases que la clásica (`presentacion-cliente.ts`) y,
 * de las advertencias, solo las que le dicen algo al cliente; las internas (sobrantes, merma, puerta física) no salen.
 * Puro e importable desde el cliente.
 */

export type TipoAjusteGuiado = "color" | "supuesto" | "tamano" | "faltante";
export type AjusteGuiado = { tipo: TipoAjusteGuiado; texto: string };

const PlanConAvisosSchema = z.object({
  plan: z.object({
    estructuras: z.array(z.object({ estructura_id: z.string(), nombre: z.string().optional(), estructura_oficial: z.string().optional() }).passthrough()),
    supuestos: z.array(z.string()).optional(),
  }).passthrough(),
  sustituciones: z.array(z.object({ estructura_id: z.string(), pedido: z.string(), entregado: z.string(), motivo: z.string().optional() }).passthrough()).optional(),
  sin_cobertura: z.array(z.object({ estructura_id: z.string(), tamano: z.string() }).passthrough()).optional(),
  advertencias: z.array(z.string()).optional(),
}).passthrough();

function unicos<T>(items: readonly T[], clave: (item: T) => string): T[] {
  const vistos = new Set<string>();
  return items.filter((item) => { const llave = clave(item); if (vistos.has(llave)) return false; vistos.add(llave); return true; });
}

function conMayuscula(texto: string): string {
  return texto ? `${texto.charAt(0).toLocaleUpperCase("es")}${texto.slice(1)}` : texto;
}

/**
 * Las advertencias de Python que le dicen algo al cliente (las que la clásica le explica por el modelo): un color que se
 * quedó sin globos, un reparto de colores distinto al pedido y lo que la foto mostraba y el patrón no pudo seguir.
 */
function advertenciaCliente(aviso: string, nombres: ReadonlyMap<string, string>): string | null {
  const sinGlobos = /^color_sin_globos:([^:]+):([^:]+):/.exec(aviso);
  if (sinGlobos) return `${conMayuscula(nombres.get(sinGlobos[1]!) ?? "la decoración")} no lleva ${sinGlobos[2]!.trim()}: no alcanzan sus globos para todos sus colores.`;
  const reparto = /^reparto_distinto:([^:]+):[^:]*: el plan declara [^;]+; lo que se compra es ([^(]+?)\s*(?:\(|\.?$)/.exec(aviso);
  if (reparto) return `En ${nombres.get(reparto[1]!) ?? "la decoración"} los colores quedan así: ${reparto[2]!.trim()}.`;
  const pista = /^pista_patron_incompleta:([^:]+):[^:]*:\s*(.+)$/.exec(aviso);
  if (pista) return conMayuscula(pista[2]!.trim().replace(/\.?$/, "."));
  return null;
}

/**
 * Los ajustes de un plan confirmado, o [] si no hay ninguno (o el plan no los trae). `sinColoresDeFoto`: la tarjeta ya
 * dice en su aviso qué color de la foto no se pudo comprar (`avisoColoresFoto`, que sale de esas mismas sustituciones).
 */
export function ajustesDePython(plan: unknown, opciones: { sinColoresDeFoto?: boolean } = {}): AjusteGuiado[] {
  const leido = PlanConAvisosSchema.safeParse(plan);
  if (!leido.success) return [];
  const { plan: declarado, sustituciones = [], sin_cobertura: sinCobertura = [], advertencias = [] } = leido.data;
  // «la columna izquierda», «el arco»: cómo nombra cada pieza la tarjeta.
  const nombres = new Map(declarado.estructuras.map((estructura) => {
    const oficial = esEstructuraOficialId(estructura.estructura_oficial) ? estructura.estructura_oficial : undefined;
    const nombre = (estructura.nombre ?? "la pieza").trim().toLocaleLowerCase("es");
    return [estructura.estructura_id, /^(?:el|la|los|las) /.test(nombre) ? nombre : `${oficial && FEMENINAS.has(oficial) ? "la" : "el"} ${nombre}`] as const;
  }));
  const sust = unicos(sustituciones, (item) => `${item.estructura_id}|${item.pedido}|${item.entregado}|${item.motivo ?? ""}`).map((item) => ({ ...item, motivo: item.motivo ?? "" }));
  const faltan = unicos(sinCobertura, (item) => `${item.estructura_id}|${item.tamano}`);
  const ajustes: AjusteGuiado[] = [
    ...faltantesCliente(faltan, nombres).map((texto): AjusteGuiado => ({ tipo: "faltante", texto })),
    ...(opciones.sinColoresDeFoto ? [] : sustitucionesCliente(sust.filter(esSustitucionDeColor), nombres).map((texto): AjusteGuiado => ({ tipo: "color", texto }))),
    ...sustitucionesCliente(sust.filter((item) => !esSustitucionDeColor(item)), nombres).map((texto): AjusteGuiado => ({ tipo: "tamano", texto })),
    ...[...new Set(declarado.supuestos ?? [])].map((supuesto): AjusteGuiado => ({ tipo: "supuesto", texto: supuestoCliente(supuesto) })),
    ...advertencias.flatMap((aviso): AjusteGuiado[] => { const texto = advertenciaCliente(aviso, nombres); return texto ? [{ tipo: "color", texto }] : []; }),
  ];
  return unicos(ajustes, (ajuste) => ajuste.texto);
}
