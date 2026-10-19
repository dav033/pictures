import { ESTRUCTURAS_OFICIALES, incoherenciasEstructuraOficial, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { PlanDecoracionSchema, type PlanDecoracion } from "@/lib/plan/tipos";
import { MEZCLAS } from "@/lib/plan/tipos";
import type { CompraMotor } from "./cotizar-bom";
import type { EspecClienteV1, LugarEspec, PiezaEspec } from "./espec-cliente-v1";
import { lineasDeFlores } from "./flores-espec";
import { DENSIDAD_POR_DEFECTO, medidasDe } from "./medidas-espec";
import type { BomLinea } from "./resultado-motor-v1";
import { claveCruce } from "./crosswalk-variantes";
import { colorDeCompra } from "./plan-de-compra";

/**
 * **Espec -> `PlanDecoracion`** (el contrato que la tarjeta, los pasos y la compra ya entienden). Es una PROYECCIÓN: el
 * plan del motor 3D no lo cuenta Python, así que esta pieza del contrato no decide ninguna cantidad (las cantidades
 * viajan en `estructuras[].lineas`, que salen de la lista de materiales del motor). Sirve para que lo que ya existe
 * (nombre, tipo, medidas, colores, densidad, ubicación) se pinte igual que en un plan de Python, y para que
 * `PlanDecoracionSchema` siga siendo el guardián del sobre.
 */
export type ConceptoPlan = { titulo: string; descripcion: string; estilo?: string; ocasion?: string };

const UBICACION_POR_LUGAR: Readonly<Record<LugarEspec, string>> = {
  izquierda: "lateral_izquierdo", derecha: "lateral_derecho", fondo: "fondo_pared", techo: "techo", mesa: "sobre_mesa_principal", centro: "piso_frontal",
};
const ARCOS_AL_CENTRO: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>(["arco", "arco_asimetrico", "arco_no_denso", "aro_circular"]);
/** El plan admite una sola pieza en la pared del fondo y una sola en el techo (`PlanDecoracionSchema`). */
const UBICACIONES_UNICAS: ReadonlySet<string> = new Set(["fondo_pared", "techo"]);
const ROLES_ESCENA = ["focal", "soporte", "relleno"] as const;
const ROLES_MATERIAL = ["principal", "secundario", "acento"] as const;

/** Lo que se dice de una línea de globos en el plan: nombre del color, acabado y forma, como los escribe el catálogo. */
export function datosDeLinea(compra: Pick<CompraMotor, "codigo" | "variante" | "formatoId">): { color: string; acabado: string | null } {
  const referencia = referenciaPorCodigo(compra.codigo);
  return { color: colorDeCompra(compra.variante, compra.codigo), acabado: referencia ? ACABADO_POR_FAMILIA[referencia.familia] ?? referencia.familia : null };
}

const ACABADO_POR_FAMILIA: Readonly<Record<string, string>> = {
  fashion: "fashion", reflex: "reflex", silk: "silk", satin: "satin", metal: "metal", neon: "neon", cristal: "cristal", pastelMate: "pastel mate", pastelDusk: "pastel dusk",
};

function densidadDe(pieza: PiezaEspec): PlanDecoracion["estructuras"][number]["densidad"] {
  const oficial = ESTRUCTURAS_OFICIALES[pieza.oficial];
  const pedida = pieza.densidad ?? DENSIDAD_POR_DEFECTO[pieza.oficial] ?? "media";
  return oficial.densidades && !(oficial.densidades as readonly string[]).includes(pedida) ? oficial.densidades[0]! : pedida;
}

function ubicacionDe(pieza: PiezaEspec, usadas: Set<string>): PlanDecoracion["estructuras"][number]["ubicacion"] {
  let ubicacion = pieza.lugar === "centro" && ARCOS_AL_CENTRO.has(pieza.oficial) ? "arco_central" : UBICACION_POR_LUGAR[pieza.lugar];
  if (UBICACIONES_UNICAS.has(ubicacion) && usadas.has(ubicacion)) ubicacion = "piso_frontal";
  usadas.add(ubicacion);
  return ubicacion as PlanDecoracion["estructuras"][number]["ubicacion"];
}

/** Los pesos de color, con los códigos que el motor no llegó a comprar fuera, sumando 1 con tres decimales. */
function participaciones(pesos: readonly number[]): number[] {
  const suma = pesos.reduce((total, peso) => total + peso, 0);
  const redondeadas = pesos.map((peso) => Math.round((peso / suma) * 1000) / 1000);
  const resto = Math.round((1 - redondeadas.reduce((total, p) => total + p, 0)) * 1000) / 1000;
  redondeadas[redondeadas.length - 1] = Math.round((redondeadas[redondeadas.length - 1]! + resto) * 1000) / 1000;
  return redondeadas;
}

export type ProyeccionPlan = { ok: true; plan: PlanDecoracion } | { ok: false; motivo: string };

export type EntradaProyeccion = {
  espec: EspecClienteV1;
  /** La lista de materiales del motor, por pieza. */
  porPieza: Readonly<Record<string, readonly BomLinea[]>>;
  /** Lo que se compra, por (formato|código). */
  compras: ReadonlyMap<string, CompraMotor>;
  concepto: ConceptoPlan;
  avisos: readonly string[];
  planId: string;
};

function textoAcotado(texto: string, maximo: number): string {
  const limpio = texto.trim().replace(/\s+/g, " ");
  return limpio.length <= maximo ? limpio : `${limpio.slice(0, maximo - 1).trimEnd()}…`;
}

export function proyectarPlan(entrada: EntradaProyeccion): ProyeccionPlan {
  const { espec, porPieza, compras, concepto, avisos, planId } = entrada;
  const productoDeCodigo = (codigo: string, preferidas: readonly BomLinea[]): CompraMotor | undefined => {
    for (const linea of preferidas) if (linea.codigo === codigo) return compras.get(claveCruce(linea.formatoId, linea.codigo));
    return [...compras.values()].find((compra) => compra.codigo === codigo);
  };
  const ubicacionesUsadas = new Set<string>();
  const estructuras: PlanDecoracion["estructuras"] = [];
  for (const [indice, pieza] of espec.piezas.entries()) {
    const oficial = ESTRUCTURAS_OFICIALES[pieza.oficial];
    const lineas = porPieza[pieza.id] ?? [];
    if (!lineas.length) return { ok: false, motivo: `La pieza ${pieza.id} no trae globos en la lista del motor.` };
    const conProducto = pieza.colores.flatMap((color) => {
      const compra = productoDeCodigo(color.codigo, lineas);
      return compra ? [{ color, compra }] : [];
    });
    // Ningún color del cliente se pierde en silencio: si alguno no llegó a la lista de compra, el plan no se arma así.
    const sinProducto = pieza.colores.filter((color) => !conProducto.some((c) => c.color === color));
    if (sinProducto.length) return { ok: false, motivo: `Los colores ${sinProducto.map((c) => `${c.nombre} (${c.codigo})`).join(", ")} de ${pieza.id} no están en su lista de materiales.` };
    const pesos = participaciones(conProducto.map(({ color }) => color.peso));
    const sinGeometria = !["arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa"].includes(oficial.tipoBase);
    const unidades = lineas.reduce((suma, linea) => suma + linea.cantidad, 0);
    const flores = pieza.flores ? (() => {
      const petalo = productoDeCodigo(pieza.flores.codigo, lineasDeFlores(pieza.flores, []));
      const centro = pieza.flores.centro ? productoDeCodigo(pieza.flores.centro, lineasDeFlores(pieza.flores, [])) : undefined;
      return petalo ? { cantidad: pieza.flores.cantidad, petalos: pieza.flores.petalos, petalo: { product_id: petalo.variante.productId, color: petalo.variante.color ?? pieza.flores.codigo }, ...(centro ? { centro: { product_id: centro.variante.productId, color: centro.variante.color ?? pieza.flores.centro! } } : {}) } : null;
    })() : null;
    const medidas = medidasDe(pieza);
    const ubicacion = ubicacionDe(pieza, ubicacionesUsadas);
    estructuras.push({
      estructura_id: pieza.id,
      nombre: textoAcotado(pieza.nombre, 160),
      tipo: oficial.tipoBase as PlanDecoracion["estructuras"][number]["tipo"],
      rol_escena: ROLES_ESCENA[Math.min(indice, ROLES_ESCENA.length - 1)]!,
      ubicacion,
      medidas: { ...(medidas.anchoM ? { ancho_m: medidas.anchoM } : {}), ...(medidas.altoM ? { alto_m: medidas.altoM } : {}), ...(medidas.largoM ? { largo_m: medidas.largoM } : {}) },
      repeticiones: 1,
      densidad: densidadDe(pieza),
      mezcla: (MEZCLAS as readonly string[]).includes(pieza.tamanos) ? pieza.tamanos : "clasica",
      materiales: conProducto.map(({ color, compra }, k) => ({
        product_id: compra.variante.productId,
        ...(sinGeometria ? { variant_id: compra.variante.variantId } : {}),
        color: textoAcotado(color.nombre, 80),
        participacion: pesos[k]!,
        rol_material: ROLES_MATERIAL[Math.min(k, ROLES_MATERIAL.length - 1)]!,
      })),
      ...(sinGeometria ? { unidades_declaradas: Math.min(999, Math.max(1, unidades)) } : {}),
      porque: "Pieza armada y contada por el motor 3D.",
      estructura_oficial: pieza.oficial,
      ...(flores ? { flores } : {}),
    });
  }
  const paleta = [...new Set(espec.piezas.flatMap((pieza) => pieza.colores.map((color) => textoAcotado(color.nombre, 80))))].slice(0, 8);
  const plan = PlanDecoracionSchema.safeParse({
    plan_version: "1.0",
    plan_id: planId,
    concepto: { titulo: textoAcotado(concepto.titulo, 160), descripcion: textoAcotado(concepto.descripcion, 320), paleta, ...(concepto.estilo ? { estilo: textoAcotado(concepto.estilo, 80) } : {}), ...(concepto.ocasion ? { ocasion: textoAcotado(concepto.ocasion, 160) } : {}) },
    espacio: { tipo: "salón", fuente: "supuesto" },
    estructuras,
    supuestos: avisos.slice(0, 30).map((aviso) => textoAcotado(aviso, 240)),
    referencia_omitida: [],
  });
  if (!plan.success) return { ok: false, motivo: `El plan proyectado no cumple el contrato: ${plan.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  const incoherencias = plan.data.estructuras.flatMap((e) => incoherenciasEstructuraOficial(e));
  return incoherencias.length ? { ok: false, motivo: incoherencias[0]!.mensaje } : { ok: true, plan: plan.data };
}
