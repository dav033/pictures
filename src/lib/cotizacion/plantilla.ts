/**
 * La hoja de cotización que el decorador llena a mano — la que hoy vive en el
 * archivo `Plantilla de cotización`, con su cabecera, sus costos directos, sus
 * costos indirectos y su utilidad.
 *
 * Es un envoltorio: todos los importes de aquí los escribe la persona. Lo único
 * que la app sabe llenar es la sección de materias primas, y la llena copiando
 * los números que el plan ya firmó (`precio_paquete`, `paquetes`) — no los
 * vuelve a derivar.
 *
 * La aritmética de este módulo (total de fila, subtotales, utilidad, total del
 * proyecto) es la de la hoja, sobre valores que son del usuario. A propósito NO
 * es una verificación de la cotización del plan: volver a derivar aquí una cifra
 * del plan crearía un segundo dueño de una regla comercial, que es justo lo que
 * prohíbe AGENTS.md ("Python owns the commercial rules").
 *
 * El dinero son pesos colombianos enteros: la hoja no maneja centavos.
 */

/** Una fila de la hoja: qué es, cuánto vale la unidad y cuántas unidades van. */
export type FilaPlantilla = {
  /** Estable mientras la fila viva, para React y para editarla o borrarla. */
  id: string;
  descripcion: string;
  /** COP por bolsa (materias primas) o por unidad (el resto de las secciones). */
  costoUnitario: number;
  cantidad: number;
};

export type ClaveSeccion = "materias" | "manoObra" | "equipos" | "indirectos";

export type GrupoSeccion = "directos" | "indirectos";

export type DescriptorSeccion = {
  clave: ClaveSeccion;
  grupo: GrupoSeccion;
  titulo: string;
  /** La hoja llama distinto a la misma columna según la sección. */
  etiquetaCosto: string;
  etiquetaCantidad: string;
  /** `"1"` donde la unidad es indivisible (bolsas); `"any"` donde media hora existe. */
  pasoCantidad: "1" | "any";
  /**
   * Descripciones que la persona escribe seguido, ofrecidas como texto para no
   * volver a teclearlas. Nunca traen importe: el importe siempre lo pone ella.
   */
  sugerencias: readonly string[];
};

/** Las cuatro secciones de la hoja, en su orden y con sus nombres reales. */
export const SECCIONES: readonly DescriptorSeccion[] = [
  {
    clave: "materias",
    grupo: "directos",
    titulo: "Materias primas e insumos",
    etiquetaCosto: "Costo x bolsa",
    etiquetaCantidad: "Cantidad de bolsas",
    pasoCantidad: "1",
    sugerencias: [],
  },
  {
    clave: "manoObra",
    grupo: "directos",
    titulo: "Mano de obra",
    etiquetaCosto: "Costo unitario",
    etiquetaCantidad: "Cantidad de unidades",
    pasoCantidad: "any",
    sugerencias: ["Hora de mano de obra propia", "Hora de mano de obra contratada", "Montaje en sitio", "Desmontaje"],
  },
  {
    clave: "equipos",
    grupo: "directos",
    titulo: "Equipos y transporte",
    etiquetaCosto: "Costo unitario",
    etiquetaCantidad: "Cantidad de unidades",
    pasoCantidad: "any",
    sugerencias: ["Transporte ida", "Transporte regreso", "Alquiler de equipos", "Parqueadero"],
  },
  {
    clave: "indirectos",
    grupo: "indirectos",
    titulo: "Costos indirectos",
    etiquetaCosto: "Costo unitario",
    etiquetaCantidad: "Cantidad de unidades",
    pasoCantidad: "any",
    sugerencias: ["Publicidad x mes", "Gastos de oficina", "Personal administrativo"],
  },
];

export const CLAVES_SECCION: readonly ClaveSeccion[] = SECCIONES.map((seccion) => seccion.clave);

export type CabeceraPlantilla = {
  proyecto: string;
  /** `yyyy-mm-dd`, tal como lo entrega un `<input type="date">`. */
  fecha: string;
  contacto: string;
  numero: string;
  lugar: string;
  celular: string;
};

export type PlantillaCotizacion = {
  cabecera: CabeceraPlantilla;
  secciones: Record<ClaveSeccion, FilaPlantilla[]>;
  /** Porcentaje sobre el total de costos. La hoja real trae 30. */
  utilidadPorcentaje: number;
};

/** La utilidad con la que arranca la hoja real. */
export const UTILIDAD_POR_DEFECTO = 30;

/**
 * Pesos enteros y no negativos. Un costo negativo no existe en esta hoja; si
 * alguna vez hicieran falta descuentos, entran como su propio tipo de fila en
 * vez de relajar esto.
 */
export function pesosEnteros(valor: number): number {
  return Number.isFinite(valor) ? Math.max(0, Math.round(valor)) : 0;
}

/** Cantidades no negativas; admite decimales porque media hora de trabajo existe. */
export function cantidadValida(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/** Porcentaje de utilidad no negativo. Sin techo: un 120% es raro, no inválido. */
export function porcentajeValido(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}

/** Costo total de una fila, redondeado a pesos enteros. */
export function totalFila(fila: FilaPlantilla): number {
  return pesosEnteros(pesosEnteros(fila.costoUnitario) * cantidadValida(fila.cantidad));
}

/** Subtotal de una sección: el "TOTAL" que la hoja pone al cerrar cada bloque. */
export function subtotalSeccion(filas: readonly FilaPlantilla[]): number {
  return filas.reduce((suma, fila) => suma + totalFila(fila), 0);
}

/** La utilidad en pesos que corresponde a un total de costos. */
export function utilidadEnPesos(totalCostos: number, porcentaje: number): number {
  return pesosEnteros(pesosEnteros(totalCostos) * (porcentajeValido(porcentaje) / 100));
}

export type TotalesPlantilla = {
  subtotales: Record<ClaveSeccion, number>;
  costosDirectos: number;
  costosIndirectos: number;
  totalCostos: number;
  utilidad: number;
  totalProyecto: number;
};

/** Todo lo que la hoja calcula, de una sola pasada y desde una sola fuente. */
export function totalesPlantilla(plantilla: PlantillaCotizacion): TotalesPlantilla {
  const subtotales = {
    materias: subtotalSeccion(plantilla.secciones.materias),
    manoObra: subtotalSeccion(plantilla.secciones.manoObra),
    equipos: subtotalSeccion(plantilla.secciones.equipos),
    indirectos: subtotalSeccion(plantilla.secciones.indirectos),
  };
  const costosDirectos = SECCIONES.filter((seccion) => seccion.grupo === "directos").reduce((suma, seccion) => suma + subtotales[seccion.clave], 0);
  const costosIndirectos = SECCIONES.filter((seccion) => seccion.grupo === "indirectos").reduce((suma, seccion) => suma + subtotales[seccion.clave], 0);
  const totalCostos = costosDirectos + costosIndirectos;
  const utilidad = utilidadEnPesos(totalCostos, plantilla.utilidadPorcentaje);
  return { subtotales, costosDirectos, costosIndirectos, totalCostos, utilidad, totalProyecto: totalCostos + utilidad };
}

/**
 * Lo mínimo que este módulo necesita de una compra consolidada del plan.
 * Estructural a propósito: `CompraConsolidada` encaja sin que la hoja tenga que
 * importar el motor de cotización (que es `server-only`).
 */
export type CompraParaPlantilla = {
  variant_id: string;
  titulo: string;
  unidades_paquete: number;
  paquetes: number;
  precio_paquete: number;
};

/**
 * El nombre de la bolsa como lo escribe el proveedor ("R-5 SILK AMATISTA X 50").
 * Los títulos del catálogo ya suelen terminar en la cuenta del paquete; cuando
 * no, se le añade para que la fila se pueda comparar con la factura.
 */
export function descripcionMateriaPrima(compra: CompraParaPlantilla): string {
  const titulo = compra.titulo.trim();
  if (/x\s*\d+\s*$/i.test(titulo)) return titulo;
  const unidades = Math.round(compra.unidades_paquete);
  return Number.isFinite(unidades) && unidades > 0 ? `${titulo} X ${unidades}` : titulo;
}

/**
 * Las filas de materias primas precargadas desde las compras del plan.
 * `costoUnitario` y `cantidad` son el `precio_paquete` y los `paquetes` del
 * plan, copiados tal cual — no recalculados. Después la persona los corrige a
 * mano si la factura dice otra cosa.
 */
export function filasMateriasPrimas(compras: readonly CompraParaPlantilla[]): FilaPlantilla[] {
  return compras.map((compra, indice) => ({
    id: `materias:plan:${indice}:${compra.variant_id}`,
    descripcion: descripcionMateriaPrima(compra),
    costoUnitario: compra.precio_paquete,
    cantidad: compra.paquetes,
  }));
}

export type OrigenPlantilla = {
  proyecto: string;
  /** `yyyy-mm-dd`. Quien llama decide el día; el módulo no lee el reloj. */
  fecha: string;
  compras: readonly CompraParaPlantilla[];
};

/**
 * Una hoja nueva. Solo vienen puestos el nombre del proyecto, la fecha y las
 * materias primas: las otras tres secciones arrancan vacías a propósito, porque
 * la app no inventa importes de mano de obra, transporte ni gastos de oficina.
 */
export function plantillaInicial(origen: OrigenPlantilla): PlantillaCotizacion {
  return {
    cabecera: { proyecto: origen.proyecto, fecha: origen.fecha, contacto: "", numero: "", lugar: "", celular: "" },
    secciones: { materias: filasMateriasPrimas(origen.compras), manoObra: [], equipos: [], indirectos: [] },
    utilidadPorcentaje: UTILIDAD_POR_DEFECTO,
  };
}

/** Una fila en blanco. Sin importe: el importe lo escribe la persona. */
export function filaVacia(clave: ClaveSeccion, consecutivo: number): FilaPlantilla {
  return { id: `${clave}:nueva:${consecutivo}`, descripcion: "", costoUnitario: 0, cantidad: 1 };
}
