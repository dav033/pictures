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

export function generarPasosPlan(planGuardado: unknown): { pasos: PasoPlanGuiado[]; globos: GloboPlanGuiado[]; total: number; guias: GuiaPiezaPlan[] } {
  const plan = PlanMinimoSchema.parse(planGuardado);
  const grupos = new Map<string, GloboPlanGuiado>();
  for (const estructura of plan.estructuras) for (const linea of estructura.lineas) {
    const color = linea.color?.trim() || "color indicado en el plan";
    const tamano = linea.diam_pulg ? `${linea.diam_pulg}\"` : linea.tamano_codigo ? `${linea.tamano_codigo.replace(/^R-/i, "")}\"` : "tamaño indicado";
    const clave = `${color.toLocaleLowerCase("es")}\u0000${tamano}`;
    const previo = grupos.get(clave);
    if (previo) previo.cantidad += linea.unidades;
    else grupos.set(clave, { color, tamano, cantidad: linea.unidades });
  }
  const globos = [...grupos.values()];
  const total = globos.reduce((suma, item) => suma + item.cantidad, 0);
  const guias: GuiaPiezaPlan[] = plan.plan.estructuras.flatMap((pieza) => {
    const oficial = pieza.estructura_oficial ?? idOficialPorTipo(pieza.tipo, pieza.nombre);
    const guia = guiaParaEstructura(oficial);
    const lineas = plan.estructuras.find((item) => item.estructura_id === pieza.estructura_id)?.lineas ?? [];
    if (!guia) return [];
    const cantidades = new Map<string, GloboPlanGuiado>();
    for (const linea of lineas) {
      const color = linea.color?.trim() || "color indicado en el plan";
      const tamano = linea.diam_pulg ? `${linea.diam_pulg}\"` : linea.tamano_codigo ? `${linea.tamano_codigo.replace(/^R-/i, "")}\"` : "tamaño indicado";
      const clave = `${color.toLocaleLowerCase("es")}\u0000${tamano}`;
      const previo = cantidades.get(clave);
      if (previo) previo.cantidad += linea.unidades;
      else cantidades.set(clave, { color, tamano, cantidad: linea.unidades });
    }
    return [{ estructura_id: pieza.estructura_id, nombre: pieza.nombre, medidas: pieza.medidas, globos: [...cantidades.values()], guia }];
  });
  const listaGlobos = globos.map((item) => `${item.cantidad} globos ${item.color} de ${item.tamano}`).join(", ");
  const pasos: PasoPlanGuiado[] = [{ orden: 1, texto: `Prepara el soporte y los materiales del plan. En total son ${total} globos: ${listaGlobos}.`, globos: listaGlobos }];
  pasos.push({ orden: 2, texto: `Infla cada globo al tamaño indicado y separa los grupos por color y medida: ${listaGlobos}.`, globos: listaGlobos });
  for (const pieza of plan.plan.estructuras) {
    const armado = detalleArmado(pieza);
    const medidas = [pieza.medidas.ancho_m && `${pieza.medidas.ancho_m} m de ancho`, pieza.medidas.alto_m && `${pieza.medidas.alto_m} m de alto`, pieza.medidas.largo_m && `${pieza.medidas.largo_m} m de largo`].filter(Boolean).join(" por ");
    const globosPieza = plan.estructuras.find((item) => item.estructura_id === pieza.estructura_id)?.lineas
      .map((linea) => `${linea.unidades} ${linea.color ?? "globos"} de ${linea.diam_pulg ? `${linea.diam_pulg}\"` : linea.tamano_codigo ?? "tamaño indicado"}`).join(", ");
    pasos.push({ orden: pasos.length + 1, texto: `Arma ${pieza.nombre}${pieza.repeticiones > 1 ? ` (${pieza.repeticiones} piezas)` : ""}${medidas ? `, de ${medidas}` : ""}. ${armado}`, ...(globosPieza ? { globos: globosPieza } : {}) });
  }
  pasos.push({ orden: pasos.length + 1, texto: `Monta las piezas en el orden del plan y en sus ubicaciones indicadas; fija cada estructura a su soporte antes de continuar.` });
  pasos.push({ orden: pasos.length + 1, texto: "Ajusta los amarres, oculta soportes y remata la decoración. Revisa estabilidad y que las piezas queden en la posición prevista." });
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
    return `Monta ${cantidadCapas ? `las ${cantidadCapas} capas o discos` : "las capas o discos"} que indica el motor${armado.patron ? `, siguiendo el patrón ${armado.patron}` : ""}${armado.remate?.tipo && armado.remate.tipo !== "ninguno" ? ` y coloca el remate ${armado.remate.tipo}` : ""}.`;
  }
  const arco = pieza.armado_arco;
  if (arco && typeof arco === "object") {
    const armado = arco as { patron?: string; capas?: unknown[]; secciones?: unknown[] };
    const detalles = [armado.capas?.length ? `${armado.capas.length} capas` : "capas", armado.secciones?.length ? `${armado.secciones.length} ${armado.secciones.length === 1 ? "sección" : "secciones"} de color` : "secciones de color"];
    return `Arma el arco siguiendo el dibujo del plan (patrón ${armado.patron ?? "del plan"}); respeta ${detalles.join(" y ")}.`;
  }
  const organic = pieza.armado_arco_organico ?? pieza.armado_columna_organica ?? pieza.armado_guirnalda_organica;
  if (organic && typeof organic === "object") {
    const armado = organic as { volumen?: { racimo?: number }; tamanos?: { mezcla?: Record<string, number> }; corona?: { activa?: boolean } };
    const racimo = armado.volumen?.racimo;
    const tamanos = Object.entries(armado.tamanos?.mezcla ?? {}).filter(([, peso]) => peso > 0).map(([tamano]) => Number(tamano)).filter(Number.isFinite);
    return [racimo ? `forma racimos de ${racimo} globos como en el dibujo del plan` : "sigue el dibujo de armado del plan", tamanos?.length ? `usa la mezcla de tamaños indicada (${[...new Set(tamanos)].map((n) => `${n}\"`).join(", ")})` : "respeta los tamaños separados en el paso anterior", armado.corona?.activa ? "coloca la corona que define el plan" : ""]
      .filter(Boolean).join("; ") + ".";
  }
  const guirnalda = pieza.armado_guirnalda;
  if (guirnalda && typeof guirnalda === "object") {
    const armado = guirnalda as { racimo?: { unidad?: string }; relleno?: { proporcion?: number } | null; forma?: string; remates?: unknown[] };
    return `Une los globos en ${armado.racimo?.unidad ?? "racimos indicados"} sobre el soporte previsto, da forma de ${armado.forma ?? "guía"}${armado.relleno && armado.relleno.proporcion ? " y añade el relleno definido por el motor" : ""}${armado.remates?.length ? ", luego coloca los remates del plan" : ""}.`;
  }
  const bouquet = pieza.armado_bouquet;
  if (bouquet && typeof bouquet === "object") {
    const armado = bouquet as { niveles?: Array<{ cantidad?: number; unidad?: string }>; variante?: string };
    const niveles = armado.niveles?.map((nivel) => `${nivel.cantidad} ${nivel.unidad}`).join(", ");
    return `Arma el bouquet ${armado.variante === "base_aire" ? "con base de aire" : "como en el dibujo del plan"}${niveles ? `, de abajo hacia arriba (${niveles.replace(/\b(\d+) trio\b/g, (_, n) => `${n} ${n === "1" ? "grupo" : "grupos"} de 3`)})` : ""}; añade el remate y los números si aparecen en el plan.`;
  }
  return "Arma esta estructura siguiendo la guía de armado que acompaña el plan.";
}
