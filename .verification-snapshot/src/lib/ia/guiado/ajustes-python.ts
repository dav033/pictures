import { z } from "zod";
import { esSustitucionDeColor } from "@/lib/plan/colores-referencia";
import { ESTRUCTURAS_OFICIALES, esEstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { clienteDioMedidasEspacio, estructurasMedidasPorCliente } from "@/lib/plan/medidas-defecto";
import { TIPOS_ESTRUCTURA, type TipoEstructura } from "@/lib/plan/tipos";
import { FEMENINAS } from "@/lib/plan/piezas-individuales";
import { faltantesCliente, supuestoCliente, sustitucionesCliente, tallaNormal } from "@/lib/plan/presentacion-cliente";

function esTipoEstructura(valor: string): valor is TipoEstructura {
  return (TIPOS_ESTRUCTURA as readonly string[]).includes(valor);
}

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
    estructuras: z.array(z.object({ estructura_id: z.string(), nombre: z.string().optional(), estructura_oficial: z.string().optional(), tipo: z.string().optional() }).passthrough()),
    supuestos: z.array(z.string()).optional(),
  }).passthrough(),
  sustituciones: z.array(z.object({ estructura_id: z.string(), pedido: z.string(), entregado: z.string(), motivo: z.string().optional() }).passthrough()).optional(),
  sin_cobertura: z.array(z.object({ estructura_id: z.string(), tamano: z.string(), product_id: z.string().optional() }).passthrough()).optional(),
  advertencias: z.array(z.string()).optional(),
  /** Las palabras del cliente con que se pidió el plan (`solicitudCliente` → `original_request`). */
  original_request: z.string().optional(),
}).passthrough();

/**
 * Lo que Python hizo con el conteo de globos de la foto (`plan_resuelto.conteos_referencia`, ADR-0031), solo lo que
 * hace falta para decirlo. Se lee aparte y sin romper nada: un plan sin conteos (o con otra forma) no lo trae.
 */
const ConteosFotoSchema = z.array(z.object({
  estructura_id: z.string(),
  decision: z.string(),
  globos_foto: z.number().int().nonnegative().nullable(),
  globos_despues: z.number().int().nonnegative(),
}).passthrough());

/** Por debajo de esto la diferencia con la foto es redondeo de la cuenta aproximada (la misma tolerancia de Python, ±15 %). */
const TOLERANCIA_CONTEO = 0.15;

const SUPUESTO_SIN_TAMANO = /^Usé medidas estándar para (.+) \((.+)\) porque no me diste el tamaño del espacio\.$/;

/**
 * El supuesto de medidas cuando el cliente SÍ dio una medida para esa pieza (probador 124, hallazgo 4): Python escribe
 * «no nos diste el tamaño» en cuanto falta UN eje («arco orgánico de unos 3 metros»: el ancho es suyo y solo el alto es
 * el estándar), y el decorador leía «porque no me diste el tamaño» después de haberlo dado. Se dice lo que pasó.
 */
function supuestoConMedidaDelCliente(texto: string, pieza: string | undefined): string {
  const coincidencia = SUPUESTO_SIN_TAMANO.exec(texto);
  if (!coincidencia) return texto;
  return `Para ${pieza ?? coincidencia[1]} usé la medida que me diste y completé con la estándar lo que no me dijiste: queda de ${coincidencia[2]}.`;
}

/**
 * Las piezas cuyas medidas dio el cliente con sus palabras, por su tipo («arco», «columna»): las que el supuesto de
 * medidas nombra (`medidas asumidas para <tipo>`).
 */
function tiposMedidosPorCliente(estructuras: ReadonlyArray<{ estructura_id: string; nombre?: string | undefined; estructura_oficial?: string | undefined; tipo?: string | undefined }>, solicitud: string | undefined): Map<string, string[]> {
  if (!solicitud || !clienteDioMedidasEspacio(solicitud)) return new Map();
  const conTipo = estructuras.flatMap((estructura) => {
    const tipo = estructura.tipo ?? (esEstructuraOficialId(estructura.estructura_oficial) ? ESTRUCTURAS_OFICIALES[estructura.estructura_oficial].tipoBase : undefined);
    return tipo && esTipoEstructura(tipo) ? [{ estructura_id: estructura.estructura_id, tipo, nombre: estructura.nombre ?? "" }] : [];
  });
  const medidas = new Set(estructurasMedidasPorCliente(conTipo, solicitud));
  const porTipo = new Map<string, string[]>();
  for (const estructura of conTipo.filter((item) => medidas.has(item.estructura_id))) porTipo.set(estructura.tipo, [...(porTipo.get(estructura.tipo) ?? []), estructura.estructura_id]);
  return porTipo;
}

/**
 * Cuando la foto muestra la pieza claramente más llena de lo que el plan pudo armar con las medidas que se leyeron de
 * ella (probador 124, hallazgo 7: columnas de ≈ 75 y ≈ 85 globos en la foto, 44 en el plan). La cuenta y la decisión son
 * de Python; aquí solo se dice, con la salida que tiene el cliente.
 */
function conteosFotoCliente(plan: unknown, nombres: ReadonlyMap<string, string>): string[] {
  const leidos = ConteosFotoSchema.safeParse((plan as { conteos_referencia?: unknown } | null)?.conteos_referencia);
  if (!leidos.success) return [];
  return leidos.data.flatMap((conteo) => {
    const foto = conteo.globos_foto;
    // Una pieza que ya no está en el plan no tiene nada que decir (probador 141, I-2).
    if (foto === null || conteo.decision === "coincide" || conteo.decision === "no_confiable" || !nombres.has(conteo.estructura_id)) return [];
    if (foto - conteo.globos_despues <= Math.max(2, foto * TOLERANCIA_CONTEO)) return [];
    const nombre = nombres.get(conteo.estructura_id) ?? "la decoración";
    return [`En la foto, ${nombre} lleva unos ${foto} globos; en tu plan lleva ${conteo.globos_despues} con las medidas que tomé de la foto. Si la quieres igual de llena, pídela más grande.`];
  });
}

/**
 * El color de cada producto que declara el plan (`materiales[].product_id` → `color`): `sin_cobertura` nombra el
 * producto pedido que no se pudo comprar y así el aviso dice de qué color es la talla que falta. Leído sin romper nada:
 * un material sin color o con otra forma no cuenta.
 */
function colorDeProductoDelPlan(estructuras: ReadonlyArray<Record<string, unknown>>): Map<string, string> {
  const colores = new Map<string, string>();
  for (const estructura of estructuras) {
    const materiales = Array.isArray(estructura.materiales) ? (estructura.materiales as unknown[]) : [];
    for (const material of materiales) {
      if (typeof material !== "object" || material === null) continue;
      const { product_id: producto, color } = material as { product_id?: unknown; color?: unknown };
      if (typeof producto === "string" && typeof color === "string" && color.trim() && !colores.has(producto)) colores.set(producto, color.trim());
    }
  }
  return colores;
}

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
  // La advertencia de una pieza que ya no está en el plan no sale (probador 141, I-2).
  const pieza = /^(?:color_sin_globos|reparto_distinto|pista_patron_incompleta):([^:]+):/.exec(aviso)?.[1];
  if (pieza !== undefined && !nombres.has(pieza)) return null;
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
  // Solo lo de las piezas que SIGUEN en el plan (probador 141, I-2: tras «quita la guirnalda» seguía «…y la guirnalda»):
  // un aviso de una pieza que ya no está es una propiedad huérfana. Las tallas se comparan normalizadas («R-18» = «18»).
  const vigentes = new Set(declarado.estructuras.map((estructura) => estructura.estructura_id));
  const sust = unicos(sustituciones.filter((item) => vigentes.has(item.estructura_id)), (item) => `${item.estructura_id}|${tallaNormal(item.pedido)}|${tallaNormal(item.entregado)}|${item.motivo ?? ""}`).map((item) => ({ ...item, motivo: item.motivo ?? "" }));
  const faltan = unicos(sinCobertura.filter((item) => vigentes.has(item.estructura_id)), (item) => `${item.estructura_id}|${item.product_id ?? ""}|${tallaNormal(item.tamano)}`);
  // Las piezas que el cliente midió con sus palabras: su supuesto de medidas no dice «no me diste el tamaño».
  const medidasDelCliente = tiposMedidosPorCliente(declarado.estructuras, leido.data.original_request);
  const supuesto = (texto: string): string => {
    const tipo = /^medidas asumidas para ([a-z_]+):/i.exec(texto.trim())?.[1];
    const medidas = tipo ? medidasDelCliente.get(tipo) : undefined;
    // «el arco principal», como lo nombra la tarjeta, si es una sola pieza de ese tipo.
    return medidas ? supuestoConMedidaDelCliente(supuestoCliente(texto), medidas.length === 1 ? nombres.get(medidas[0]!) : undefined) : supuestoCliente(texto);
  };
  const ajustes: AjusteGuiado[] = [
    ...faltantesCliente(faltan, nombres, colorDeProductoDelPlan(declarado.estructuras)).map((texto): AjusteGuiado => ({ tipo: "faltante", texto })),
    ...(opciones.sinColoresDeFoto ? [] : sustitucionesCliente(sust.filter(esSustitucionDeColor), nombres).map((texto): AjusteGuiado => ({ tipo: "color", texto }))),
    ...sustitucionesCliente(sust.filter((item) => !esSustitucionDeColor(item)), nombres).map((texto): AjusteGuiado => ({ tipo: "tamano", texto })),
    ...[...new Set(declarado.supuestos ?? [])].map((texto): AjusteGuiado => ({ tipo: "supuesto", texto: supuesto(texto) })),
    ...conteosFotoCliente(plan, nombres).map((texto): AjusteGuiado => ({ tipo: "supuesto", texto })),
    ...advertencias.flatMap((aviso): AjusteGuiado[] => { const texto = advertenciaCliente(aviso, nombres); return texto ? [{ tipo: "color", texto }] : []; }),
  ];
  return unicos(ajustes, (ajuste) => ajuste.texto);
}
