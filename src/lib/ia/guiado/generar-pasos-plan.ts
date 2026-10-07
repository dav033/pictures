import { z } from "zod";
import { guiaParaEstructura, GuiaArmadoSchema } from "./guias-armado";

const PlanMinimoSchema = z.object({
  plan: z.object({
    concepto: z.object({ titulo: z.string().optional() }).passthrough(),
    estructuras: z.array(z.object({
      estructura_id: z.string(), nombre: z.string(), tipo: z.string(), estructura_oficial: z.string().optional(), repeticiones: z.number().int().positive(),
      medidas: z.object({ ancho_m: z.number().optional(), alto_m: z.number().optional(), largo_m: z.number().optional() }).passthrough(),
    }).passthrough()),
  }).passthrough(),
  estructuras: z.array(z.object({
    estructura_id: z.string(),
    lineas: z.array(z.object({ color: z.string().optional(), tamano_codigo: z.string().optional(), diam_pulg: z.number().optional(), unidades: z.number().int().nonnegative() }).passthrough()),
  }).passthrough()),
}).passthrough();

export type PasoPlanGuiado = { orden: number; texto: string; globos?: string };
export type GloboPlanGuiado = { color: string; tamano: string; cantidad: number };

/** Presenta cantidades ya resueltas por Python. Esta función nunca calcula consumo. */
export type GuiaPiezaPlan = { estructura_id: string; nombre: string; medidas: { ancho_m?: number; alto_m?: number; largo_m?: number }; globos: GloboPlanGuiado[]; guia: z.infer<typeof GuiaArmadoSchema> };

type LineaPlan = { color?: string; tamano_codigo?: string; diam_pulg?: number; unidades: number };

const PLURAL_COLOR: Record<string, string> = {
  negro: "negros", blanco: "blancos", dorado: "dorados", rosado: "rosados", rojo: "rojos", amarillo: "amarillos", azul: "azules", verde: "verdes",
  plateado: "plateados", morado: "morados", transparente: "transparentes",
};

/** «negro» → «negros»; plata, lila, fucsia, naranja, café, violeta y los compuestos no cambian. */
export function colorEnPlural(color: string): string {
  return PLURAL_COLOR[color.trim().toLocaleLowerCase("es")] ?? color;
}

/** Tamaño para el cliente: 12" (nunca «R-12»). */
function tamanoDe(linea: LineaPlan): string {
  if (linea.diam_pulg) return `${linea.diam_pulg}"`;
  if (linea.tamano_codigo) return `${linea.tamano_codigo.replace(/^R-/i, "")}"`;
  return "tamaño indicado";
}

/** Fusiona las líneas del mismo color y tamaño (Python puede partir una misma variante en varias líneas). */
function agruparGlobos(lineas: readonly LineaPlan[]): GloboPlanGuiado[] {
  const grupos = new Map<string, GloboPlanGuiado>();
  for (const linea of lineas) {
    const color = linea.color?.trim() || "color indicado en el plan";
    const tamano = tamanoDe(linea);
    const clave = `${color.toLocaleLowerCase("es")}\u0000${tamano}`;
    const previo = grupos.get(clave);
    if (previo) previo.cantidad += linea.unidades;
    else grupos.set(clave, { color, tamano, cantidad: linea.unidades });
  }
  return [...grupos.values()];
}

/** «69 globos negros de 12"». */
export function textoGlobos(globos: readonly GloboPlanGuiado[]): string {
  return globos.map((item) => `${item.cantidad} ${item.cantidad === 1 ? "globo" : "globos"} ${item.cantidad === 1 ? item.color : colorEnPlural(item.color)} de ${item.tamano}`).join(", ");
}

export function generarPasosPlan(planGuardado: unknown): { pasos: PasoPlanGuiado[]; globos: GloboPlanGuiado[]; total: number; guias: GuiaPiezaPlan[] } {
  const plan = PlanMinimoSchema.parse(planGuardado);
  const globos = agruparGlobos(plan.estructuras.flatMap((estructura) => estructura.lineas));
  const total = globos.reduce((suma, item) => suma + item.cantidad, 0);
  const globosDePieza = (estructuraId: string): GloboPlanGuiado[] => agruparGlobos(plan.estructuras.find((item) => item.estructura_id === estructuraId)?.lineas ?? []);
  const guias: GuiaPiezaPlan[] = plan.plan.estructuras.flatMap((pieza) => {
    const oficial = pieza.estructura_oficial ?? idOficialPorTipo(pieza.tipo, pieza.nombre);
    const guia = guiaParaEstructura(oficial);
    if (!guia) return [];
    return [{ estructura_id: pieza.estructura_id, nombre: pieza.nombre, medidas: pieza.medidas, globos: globosDePieza(pieza.estructura_id), guia }];
  });
  const listaGlobos = textoGlobos(globos);
  const pasos: PasoPlanGuiado[] = [{ orden: 1, texto: `Prepara el soporte y los materiales. En total son ${total} globos: ${listaGlobos}.`, globos: listaGlobos }];
  pasos.push({ orden: 2, texto: "Infla cada globo a su tamaño y sepáralos por color y tamaño antes de empezar a armar." });
  for (const pieza of plan.plan.estructuras) {
    const armado = detalleArmado(pieza);
    const medidas = [pieza.medidas.ancho_m && `${pieza.medidas.ancho_m} m de ancho`, pieza.medidas.alto_m && `${pieza.medidas.alto_m} m de alto`, pieza.medidas.largo_m && `${pieza.medidas.largo_m} m de largo`].filter(Boolean).join(" por ");
    const globosPieza = textoGlobos(globosDePieza(pieza.estructura_id));
    pasos.push({ orden: pasos.length + 1, texto: `Arma ${pieza.nombre}${pieza.repeticiones > 1 ? ` (${pieza.repeticiones} piezas)` : ""}${medidas ? `, de ${medidas}` : ""}. ${armado}`, ...(globosPieza ? { globos: globosPieza } : {}) });
  }
  pasos.push({ orden: pasos.length + 1, texto: "Monta las piezas en su lugar y fija cada una a su soporte antes de seguir con la siguiente." });
  pasos.push({ orden: pasos.length + 1, texto: "Ajusta los amarres, oculta los soportes y revisa que todo quede firme y en su sitio." });
  return { pasos, globos, total, guias };
}

function idOficialPorTipo(tipo: string, nombre: string): string {
  const texto = `${tipo} ${nombre}`.toLocaleLowerCase("es");
  if (texto.includes("semiarco")) return "semiarco";
  if (texto.includes("columna")) return "columna";
  if (texto.includes("pared")) return "pared_densa";
  if (texto.includes("guirnalda")) return "guirnalda";
  if (texto.includes("bouquet")) return "bouquet";
  if (texto.includes("mesa")) return "centro_mesa";
  if (texto.includes("techo")) return "techo_globos";
  if (texto.includes("aro")) return "aro_circular";
  if (texto.includes("arco")) return "arco";
  if (texto.includes("figura") || tipo === "escultura") return "figura";
  if (texto.includes("racimo")) return "racimo_pared";
  return "";
}

function detalleArmado(pieza: Record<string, unknown>): string {
  const columna = pieza.armado_columna;
  if (columna && typeof columna === "object") {
    const armado = columna as { modo?: string; patron?: string; capas?: unknown[]; remate?: { tipo?: string } };
    const cantidadCapas = armado.capas?.length;
    return `Monta ${cantidadCapas ? `las ${cantidadCapas} capas o discos` : "las capas o discos"} de abajo hacia arriba, girando cada una para que encaje en la anterior${armado.remate?.tipo && armado.remate.tipo !== "ninguno" ? ", y termina con el remate de arriba" : ""}.`;
  }
  const arco = pieza.armado_arco;
  if (arco && typeof arco === "object") {
    const armado = arco as { patron?: string; capas?: unknown[]; secciones?: unknown[] };
    const detalles = [armado.capas?.length ? `${armado.capas.length} capas` : "las capas", armado.secciones?.length ? `${armado.secciones.length} ${armado.secciones.length === 1 ? "sección" : "secciones"} de color` : "las secciones de color"];
    return `Arma el arco desde una base hasta la otra; respeta ${detalles.join(" y ")}.`;
  }
  const organic = pieza.armado_arco_organico ?? pieza.armado_columna_organica ?? pieza.armado_guirnalda_organica;
  if (organic && typeof organic === "object") {
    const armado = organic as { volumen?: { racimo?: number }; tamanos?: { mezcla?: Record<string, number> }; corona?: { activa?: boolean } };
    const racimo = armado.volumen?.racimo;
    const tamanos = Object.entries(armado.tamanos?.mezcla ?? {}).filter(([, peso]) => peso > 0).map(([tamano]) => Number(tamano)).filter(Number.isFinite);
    return [racimo ? `forma racimos de ${racimo} globos` : "forma racimos pequeños", tamanos.length ? `mezcla los tamaños (${[...new Set(tamanos)].map((n) => `${n}"`).join(", ")})` : "mezcla los tamaños que separaste antes", armado.corona?.activa ? "coloca la corona de globos" : ""]
      .filter(Boolean).join("; ").replace(/^./, (letra) => letra.toLocaleUpperCase("es")) + ".";
  }
  const guirnalda = pieza.armado_guirnalda;
  if (guirnalda && typeof guirnalda === "object") {
    const armado = guirnalda as { racimo?: { unidad?: string }; relleno?: { proporcion?: number } | null; forma?: string; remates?: unknown[] };
    return `Une los globos en ${armado.racimo?.unidad ?? "racimos"} sobre la cinta, dale forma de ${armado.forma ?? "guirnalda"}${armado.relleno && armado.relleno.proporcion ? " y rellena los huecos con globos pequeños" : ""}${armado.remates?.length ? "; luego coloca los remates" : ""}.`;
  }
  const bouquet = pieza.armado_bouquet;
  if (bouquet && typeof bouquet === "object") {
    const armado = bouquet as { niveles?: Array<{ cantidad?: number; unidad?: string }>; variante?: string };
    const niveles = armado.niveles?.map((nivel) => `${nivel.cantidad} ${nivel.unidad}`).join(", ");
    return `Arma el bouquet ${armado.variante === "base_aire" ? "con base de aire" : "sobre su peso"}${niveles ? `, de abajo hacia arriba (${niveles.replace(/\b(\d+) trio\b/g, (_, n) => `${n} ${n === "1" ? "grupo" : "grupos"} de 3`)})` : ""}, y termina con el remate.`;
  }
  return "Arma esta pieza siguiendo su guía de armado.";
}
