import { esEstructuraOficialId, ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "./estructuras-oficiales";
import { FEMENINAS, MAX_PIEZAS_PLAN, PIEZAS_CON_LADO } from "./piezas-individuales";
import { PlanDecoracionSchema, type EstructuraPlan, type MaterialPlan, type PlanDecoracion, type Ubicacion } from "./tipos";

/**
 * «Agrégale una guirnalda en medio», «ponle otra columna», «mueve la guirnalda a la izquierda» POR CHAT (dueño,
 * 2026-10-07): tras leer una foto de dos columnas, «¿puedes agregar una guirnalda en medio?» armaba un plan NUEVO con
 * solo la guirnalda y perdía las columnas. Aquí se arma la ENTRADA del plan con una pieza más (o con una pieza movida o
 * renombrada) sin tocar las demás: mismas medidas, armados, materiales y nombres. No cuenta ningún globo: Python
 * (`/plan/resolve`) la vuelve a resolver y a firmar, y `piezasIntactas` comprueba que las piezas de antes compran
 * exactamente lo mismo (`ajuste-plan-entero.ts`, `agregarPiezaPlan` y `editarPiezaPlan`).
 *
 * La pieza nueva, por orden de preferencia:
 * 1. Copia de una pieza del plan de su misma oficial («otra columna»), con su armado, si el cliente no pidió otra medida
 *    ni otros colores (en el lado libre: una columna derecha junto a la izquierda, en espejo).
 * 2. Sin copia exacta: la pieza de la misma oficial sin su armado (Python la cuenta por su geometría), o la estándar del
 *    tipo (`MEDIDAS_ESTANDAR`, la medida más repetida en la biblioteca real), con los colores y productos del plan.
 *
 * Solo piezas que Python mide por geometría (`OFICIALES_AGREGABLES`): un bouquet o una figura se cuentan globo a globo y
 * necesitan variantes declaradas, así que esos pedidos rehacen el plan. Puro: lo usan el servidor, la vista y las pruebas.
 */

/** Piezas que se pueden sumar por chat: las que Python cuenta por su geometría (banda × eje). */
export const OFICIALES_AGREGABLES = [
  "arco", "arco_asimetrico", "arco_no_denso",
  "semiarco", "semiarco_asimetrico",
  "columna", "columna_asimetrica", "columna_no_densa",
  "pared_densa", "pared_no_densa", "pared_organica",
  "guirnalda", "centro_mesa", "aro_circular", "techo_globos",
] as const satisfies readonly EstructuraOficialId[];
export type OficialAgregable = (typeof OFICIALES_AGREGABLES)[number];

export function esOficialAgregable(valor: unknown): valor is OficialAgregable {
  return typeof valor === "string" && (OFICIALES_AGREGABLES as readonly string[]).includes(valor);
}

/** Dónde la pidió el cliente, en sus palabras («en medio», «arriba», «a la izquierda»); null = no lo dijo. */
export const UBICACIONES_PIEZA_NUEVA = ["centro", "arriba", "fondo", "izquierda", "derecha", "piso", "entrada", "mesa", "techo"] as const;
export type UbicacionPiezaNueva = (typeof UBICACIONES_PIEZA_NUEVA)[number];

type Medidas = { ancho_m?: number; alto_m?: number; largo_m?: number };

/**
 * Medida estándar de cada tipo cuando el cliente no dice otra: la más repetida en los planes de la biblioteca real
 * (`planes-ideas.json`, 2026-10-07: guirnalda 2,4 m en 6 de 9; columna 2 × 0,55 m; arco 2,4 × 2,2 m; aro 2 × 2 m). Las
 * paredes y el techo no tienen ideas en la biblioteca: un fondo de 2,4 × 2,2 m (el del arco) y un techo de 3 m.
 */
export const MEDIDAS_ESTANDAR: Readonly<Record<OficialAgregable, Medidas>> = {
  arco: { ancho_m: 2.4, alto_m: 2.2 },
  arco_asimetrico: { ancho_m: 2.4, alto_m: 2.2 },
  arco_no_denso: { ancho_m: 2.4, alto_m: 2.2 },
  semiarco: { ancho_m: 2.46, alto_m: 2.91 },
  semiarco_asimetrico: { ancho_m: 2.06, alto_m: 2.9 },
  columna: { ancho_m: 0.55, alto_m: 2 },
  columna_asimetrica: { ancho_m: 0.55, alto_m: 2 },
  columna_no_densa: { ancho_m: 0.55, alto_m: 2 },
  pared_densa: { ancho_m: 2.4, alto_m: 2.2 },
  pared_no_densa: { ancho_m: 2.4, alto_m: 2.2 },
  pared_organica: { ancho_m: 2.4, alto_m: 2.2 },
  guirnalda: { largo_m: 2.4 },
  centro_mesa: { ancho_m: 0.4, alto_m: 0.5 },
  aro_circular: { ancho_m: 2, alto_m: 2 },
  techo_globos: { largo_m: 3 },
};

/** Las que mezclan tamaños en la biblioteca (semiarcos, guirnaldas, aros y las orgánicas); las demás, la clásica. */
const MEZCLA_ORGANICA: ReadonlySet<OficialAgregable> = new Set<OficialAgregable>([
  "arco_asimetrico", "semiarco", "semiarco_asimetrico", "columna_asimetrica", "pared_organica", "guirnalda", "aro_circular",
]);

/** La medida que manda en cada tipo: una guirnalda se mide en largo, una columna en alto, un arco en ancho. */
export function campoPrincipal(oficial: EstructuraOficialId): keyof Medidas {
  const tipo = ESTRUCTURAS_OFICIALES[oficial].tipoBase;
  if (tipo === "guirnalda") return "largo_m";
  if (tipo === "columna" || tipo === "centro_mesa") return "alto_m";
  return "ancho_m";
}

const UBICACIONES_UNICAS: ReadonlySet<Ubicacion> = new Set<Ubicacion>(["fondo_pared", "techo"]);

function normal(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

function libre(ubicacion: Ubicacion, ocupadas: readonly Ubicacion[]): boolean {
  return !UBICACIONES_UNICAS.has(ubicacion) || !ocupadas.includes(ubicacion);
}

/**
 * La ubicación del plan para la pieza nueva. Lo que dijo el cliente manda («en medio» = `arco_central`, entre las dos
 * columnas; «arriba» = sobre el fondo); sin decirlo: una pieza de lado al lado libre, una guirnalda entre dos laterales
 * (o sobre el fondo), un arco al centro, una pared al fondo, un techo al techo. Null si el lugar pedido solo admite una
 * pieza y ya está ocupado (el fondo o el techo).
 */
export function ubicacionDePieza(pedida: UbicacionPiezaNueva | null, oficial: EstructuraOficialId, ocupadas: readonly Ubicacion[]): Ubicacion | null {
  const tipo = ESTRUCTURAS_OFICIALES[oficial].tipoBase;
  const fondoOCentro: Ubicacion = libre("fondo_pared", ocupadas) ? "fondo_pared" : "arco_central";
  if (oficial === "techo_globos") return libre("techo", ocupadas) ? "techo" : null;
  switch (pedida) {
    case "centro": return "arco_central";
    case "arriba": return tipo === "guirnalda" || tipo === "pared" ? fondoOCentro : "arco_central";
    case "fondo": return libre("fondo_pared", ocupadas) ? "fondo_pared" : tipo === "pared" ? null : "arco_central";
    case "izquierda": return "lateral_izquierdo";
    case "derecha": return "lateral_derecho";
    case "piso": return "piso_frontal";
    case "entrada": return "entrada";
    case "mesa": return "sobre_mesa_principal";
    case "techo": return libre("techo", ocupadas) ? "techo" : null;
    case null: break;
  }
  if (PIEZAS_CON_LADO.has(oficial)) {
    if (!ocupadas.includes("lateral_izquierdo")) return "lateral_izquierdo";
    if (!ocupadas.includes("lateral_derecho")) return "lateral_derecho";
    return "entrada";
  }
  if (tipo === "guirnalda") return ocupadas.includes("lateral_izquierdo") && ocupadas.includes("lateral_derecho") ? "arco_central" : fondoOCentro;
  if (tipo === "pared") return libre("fondo_pared", ocupadas) ? "fondo_pared" : null;
  if (tipo === "centro_mesa") return "sobre_mesa_principal";
  return ocupadas.includes("arco_central") ? fondoOCentro : "arco_central";
}

/** Lo que pidió el cliente, ya con los productos: los colores del plan que lleva y los globos nuevos admitidos. */
export type PiezaNuevaEntrada = {
  estructura: OficialAgregable;
  ubicacion: UbicacionPiezaNueva | null;
  medidas?: Medidas;
  /** «Arco orgánico»: mezcla de tamaños aunque su oficial no sea de las orgánicas. */
  organica?: boolean;
  /** Familias de color del plan que lleva la pieza («dorado», «rosado»); vacío o ausente = las del plan. */
  colores?: readonly string[];
  /** Globos del catálogo de colores que el plan no lleva, ya admitidos en su snapshot (`/catalog/selection`). */
  materialesNuevos?: ReadonlyArray<{ product_id: string; color: string }>;
};

export type PiezaNuevaArmada =
  | {
    ok: true;
    plan: PlanDecoracion;
    nueva: string;
    nombre: string;
    ubicacion: Ubicacion;
    medidas: Medidas;
    /** «copia»: igual a otra pieza del plan, con su armado; «plan»: la de su oficial sin armado; «estandar»: medida estándar. */
    plantilla: "copia" | "plan" | "estandar";
    materiales: Array<{ product_id: string; color: string | null; participacion: number }>;
    /** Piezas de antes que cambiaron solo de nombre (la «Columna» que pasa a «Columna izquierda» junto a la nueva). */
    renombradas: Array<{ estructura_id: string; antes: string; despues: string }>;
  }
  | { ok: false; motivo: "tope_piezas" | "ubicacion_ocupada" | "sin_colores" | "esquema"; detalle: string };

/** Las participaciones redondeadas a 4 decimales y que suman 1 (el resto, a la mayor). */
function repartir(pesos: readonly number[]): number[] {
  const total = pesos.reduce((suma, peso) => suma + peso, 0) || 1;
  const partes = pesos.map((peso) => Math.max(0.0001, Math.round((peso / total) * 10_000) / 10_000));
  const resto = Math.round((1 - partes.reduce((suma, parte) => suma + parte, 0)) * 10_000) / 10_000;
  const mayor = partes.indexOf(Math.max(...partes));
  partes[mayor] = Math.round((partes[mayor]! + resto) * 10_000) / 10_000;
  return partes;
}

/**
 * Los materiales de la pieza nueva con los colores del plan: por color, el producto que llevan más piezas (el mismo
 * globo que ya se compra) y su parte media en las piezas del plan. Con `pedidos` (el cliente dijo colores): solo esas
 * familias del plan y los globos nuevos, en partes iguales. Como mucho seis (`MaterialPlanSchema`).
 */
export function materialesDelPlan(plan: PlanDecoracion, pedidos: { colores: readonly string[]; nuevos: ReadonlyArray<{ product_id: string; color: string }> } | null = null): MaterialPlan[] {
  const soloColores = pedidos ? pedidos.colores : undefined;
  const nuevos = pedidos?.nuevos ?? [];
  type Acumulado = { color: string; productos: Map<string, { veces: number; acabado?: string }>; parte: number; piezas: number; orden: number };
  const porColor = new Map<string, Acumulado>();
  let orden = 0;
  for (const estructura of plan.estructuras) {
    const total = estructura.materiales.reduce((suma, material) => suma + material.participacion, 0) || 1;
    for (const material of estructura.materiales) {
      const clave = normal(material.color) || `producto:${material.product_id}`;
      const actual: Acumulado = porColor.get(clave) ?? { color: normal(material.color), productos: new Map<string, { veces: number; acabado?: string }>(), parte: 0, piezas: 0, orden: orden++ };
      const producto: { veces: number; acabado?: string } = actual.productos.get(material.product_id) ?? { veces: 0, ...(material.acabado ? { acabado: material.acabado } : {}) };
      producto.veces += 1;
      actual.productos.set(material.product_id, producto);
      actual.parte += material.participacion / total;
      actual.piezas += 1;
      porColor.set(clave, actual);
    }
  }
  const elegidos = soloColores ? new Set(soloColores.map(normal)) : null;
  const delPlan = [...porColor.values()]
    .filter((item) => !elegidos || elegidos.has(item.color))
    .sort((a, b) => (elegidos ? a.orden - b.orden : b.parte / b.piezas - a.parte / a.piezas || a.orden - b.orden));
  const filas: Array<{ product_id: string; color: string; acabado?: string; peso: number }> = [
    ...delPlan.map((item) => {
      const [productId, producto] = [...item.productos.entries()].sort((a, b) => b[1].veces - a[1].veces)[0]!;
      return { product_id: productId, color: item.color, ...(producto.acabado ? { acabado: producto.acabado } : {}), peso: elegidos ? 1 : item.parte / item.piezas };
    }),
    ...nuevos.filter((nuevo) => !delPlan.some((item) => item.color === normal(nuevo.color) && item.productos.has(nuevo.product_id))).map((nuevo) => ({ product_id: nuevo.product_id, color: normal(nuevo.color), peso: 1 })),
  ].slice(0, 6);
  const partes = repartir(filas.map((fila) => fila.peso));
  return filas.map((fila, indice): MaterialPlan => ({
    product_id: fila.product_id,
    ...(fila.color ? { color: fila.color } : {}),
    ...(fila.acabado ? { acabado: fila.acabado } : {}),
    participacion: partes[indice]!,
    rol_material: indice === 0 ? "principal" : "secundario",
  }));
}

/** `EST_04_GUIRNALDA`: el número que sigue y la oficial, sin repetir un id del plan. */
function idLibre(plan: PlanDecoracion, oficial: OficialAgregable): string {
  const usados = new Set(plan.estructuras.map((estructura) => estructura.estructura_id));
  let candidato = `EST_${String(plan.estructuras.length + 1).padStart(2, "0")}_${oficial.toUpperCase()}`;
  while (usados.has(candidato)) candidato = `${candidato}_B`;
  return candidato;
}

const LADO_EN_NOMBRE = /\s+(?:izquierd[ao]|derech[ao]|central|\d+)$/i;

function palabraLado(oficial: EstructuraOficialId, ubicacion: Ubicacion): string | null {
  if (ubicacion !== "lateral_izquierdo" && ubicacion !== "lateral_derecho") return null;
  const femenina = FEMENINAS.has(oficial);
  return ubicacion === "lateral_izquierdo" ? (femenina ? "izquierda" : "izquierdo") : (femenina ? "derecha" : "derecho");
}

/** Un nombre que ninguna otra pieza del plan lleva (sin tildes ni mayúsculas): el chat y el editor las buscan por nombre. */
function nombreUnico(deseado: string, otros: readonly string[], base: string): string {
  const tomados = new Set(otros.map(normal));
  if (!tomados.has(normal(deseado))) return deseado;
  for (let numero = 2; numero < 20; numero += 1) {
    const candidato = `${base} ${numero}`;
    if (!tomados.has(normal(candidato))) return candidato;
  }
  return `${base} ${otros.length + 1}`;
}

/**
 * Los nombres al sumar una pieza: la nueva con el de su oficial («Guirnalda»); con lado si es de las que van de a una
 * por lado y hay otra igual al otro lado («Columna derecha», y la de antes, si se llamaba solo «Columna», pasa a
 * «Columna izquierda»); si no, numerada («Columna 3»). Las demás piezas no cambian de nombre.
 */
function nombresAlSumar(plan: PlanDecoracion, oficial: OficialAgregable, ubicacion: Ubicacion): { nombre: string; renombrar: Map<string, string> } {
  const base = ESTRUCTURAS_OFICIALES[oficial].nombre;
  const iguales = plan.estructuras.filter((estructura) => estructura.estructura_oficial === oficial);
  const renombrar = new Map<string, string>();
  const lado = palabraLado(oficial, ubicacion);
  if (lado && PIEZAS_CON_LADO.has(oficial) && iguales.length === 1) {
    const otra = iguales[0]!;
    const ladoOtra = palabraLado(oficial, otra.ubicacion);
    if (ladoOtra && ladoOtra !== lado && normal(otra.nombre) === normal(base)) renombrar.set(otra.estructura_id, `${base} ${ladoOtra}`);
    if (ladoOtra && ladoOtra !== lado) {
      const otros = plan.estructuras.map((estructura) => renombrar.get(estructura.estructura_id) ?? estructura.nombre);
      return { nombre: nombreUnico(`${base} ${lado}`, otros, base), renombrar };
    }
  }
  const otros = plan.estructuras.map((estructura) => estructura.nombre);
  if (!iguales.length) return { nombre: nombreUnico(base, otros, base), renombrar };
  return { nombre: nombreUnico(`${base} ${iguales.length + 1}`, otros, base), renombrar };
}

/** La pieza sin lo que la ata a su lugar o a sus materiales: armados, patrón, sustituciones y elemento de la foto. */
function sinAtaduras(estructura: EstructuraPlan): EstructuraPlan {
  const {
    armado_arco: _arco, armado_arco_organico: _arcoOrganico, armado_columna: _columna, armado_columna_organica: _columnaOrganica,
    armado_guirnalda: _guirnalda, armado_guirnalda_organica: _guirnaldaOrganica, armado_bouquet: _bouquet, patron_color: _patron,
    variant_overrides: _overrides, referencia_element_id: _referencia, colores_referencia: _coloresReferencia, ...resto
  } = estructura;
  void [_arco, _arcoOrganico, _columna, _columnaOrganica, _guirnalda, _guirnaldaOrganica, _bouquet, _patron, _overrides, _referencia, _coloresReferencia];
  return resto;
}

/** La copia de una pieza del plan en su lado opuesto: el semiarco y la columna orgánica se dibujan en espejo. */
function enEspejo(estructura: EstructuraPlan): EstructuraPlan {
  const copia: EstructuraPlan = { ...estructura };
  if (copia.armado_arco_organico) {
    const forma = copia.armado_arco_organico.forma;
    copia.armado_arco_organico = { ...copia.armado_arco_organico, forma: { ...forma, espejo: !forma.espejo, carga: -forma.carga } };
  }
  if (copia.armado_columna_organica) {
    const forma = copia.armado_columna_organica.forma;
    copia.armado_columna_organica = { ...copia.armado_columna_organica, forma: { ...forma, inclinacionM: -forma.inclinacionM } };
  }
  return copia;
}

function opuestos(a: Ubicacion, b: Ubicacion): boolean {
  return (a === "lateral_izquierdo" && b === "lateral_derecho") || (a === "lateral_derecho" && b === "lateral_izquierdo");
}

/**
 * El plan con la pieza nueva al final y las de antes intactas (solo puede cambiar el nombre de una «Columna» que pasa a
 * «Columna izquierda»). No cuenta nada: Python resuelve el plan entero.
 */
export function planConPiezaNueva(plan: PlanDecoracion, pedida: PiezaNuevaEntrada): PiezaNuevaArmada {
  if (plan.estructuras.length >= MAX_PIEZAS_PLAN) return { ok: false, motivo: "tope_piezas", detalle: `el plan ya tiene ${plan.estructuras.length} piezas (máximo ${MAX_PIEZAS_PLAN})` };
  const oficial = pedida.estructura;
  const ubicacion = ubicacionDePieza(pedida.ubicacion, oficial, plan.estructuras.map((estructura) => estructura.ubicacion));
  if (!ubicacion) return { ok: false, motivo: "ubicacion_ocupada", detalle: `no queda sitio en ${pedida.ubicacion ?? "su lugar"} para ${oficial}` };
  const iguales = plan.estructuras.filter((estructura) => estructura.estructura_oficial === oficial);
  // La de su lado opuesto primero (la pareja en espejo), si no la última de su oficial.
  const modelo = iguales.find((estructura) => opuestos(estructura.ubicacion, ubicacion)) ?? iguales.at(-1) ?? null;
  const conColores = Boolean(pedida.colores?.length || pedida.materialesNuevos?.length);
  const medidasPedidas = pedida.medidas && Object.keys(pedida.medidas).length ? pedida.medidas : null;
  const id = idLibre(plan, oficial);
  const { nombre, renombrar } = nombresAlSumar(plan, oficial, ubicacion);
  let nueva: EstructuraPlan;
  let plantilla: "copia" | "plan" | "estandar";
  if (modelo && !conColores && !medidasPedidas && !pedida.organica) {
    // 1. Copia exacta (con su armado y sus productos), en espejo si va al lado opuesto. No materializa ningún
    // elemento de la foto: es una pieza que pidió el cliente.
    const copia: EstructuraPlan = { ...modelo };
    delete copia.referencia_element_id;
    delete copia.colores_referencia;
    nueva = opuestos(modelo.ubicacion, ubicacion) ? enEspejo(copia) : copia;
    plantilla = "copia";
  } else {
    const materiales = materialesDelPlan(plan, conColores ? { colores: pedida.colores ?? [], nuevos: pedida.materialesNuevos ?? [] } : null);
    if (!materiales.length) return { ok: false, motivo: "sin_colores", detalle: `ningún material del plan es de ${(pedida.colores ?? []).join(", ")}` };
    const oficialInfo = ESTRUCTURAS_OFICIALES[oficial];
    const densidad = modelo?.densidad ?? oficialInfo.densidades?.[0] ?? "media";
    const mezcla = pedida.organica ? "organica_fina" : modelo?.mezcla ?? (MEZCLA_ORGANICA.has(oficial) ? "organica_fina" : "clasica");
    const medidasBase = modelo?.medidas ?? MEDIDAS_ESTANDAR[oficial];
    const medidas = { ...medidasBase, ...(medidasPedidas ?? {}) };
    nueva = {
      ...(modelo ? sinAtaduras(modelo) : {}),
      estructura_id: id,
      nombre,
      tipo: oficialInfo.tipoBase as EstructuraPlan["tipo"],
      estructura_oficial: oficial,
      rol_escena: "soporte",
      ubicacion,
      medidas,
      repeticiones: 1,
      densidad,
      mezcla,
      materiales,
      porque: "La pidió el cliente en el chat para sumarla a su plan.",
    };
    plantilla = modelo ? "plan" : "estandar";
  }
  nueva = { ...nueva, estructura_id: id, nombre, ubicacion, repeticiones: 1, rol_escena: nueva.rol_escena === "focal" ? "soporte" : nueva.rol_escena, porque: "La pidió el cliente en el chat para sumarla a su plan." };
  const renombradas: Array<{ estructura_id: string; antes: string; despues: string }> = [];
  const estructuras = plan.estructuras.map((estructura) => {
    const despues = renombrar.get(estructura.estructura_id);
    if (!despues || despues === estructura.nombre) return estructura;
    renombradas.push({ estructura_id: estructura.estructura_id, antes: estructura.nombre, despues });
    return { ...estructura, nombre: despues };
  });
  const paleta = [...new Set([...plan.concepto.paleta, ...nueva.materiales.map((material) => material.color ?? "").filter(Boolean)])].slice(0, 8);
  const candidato: PlanDecoracion = { ...plan, concepto: { ...plan.concepto, paleta }, estructuras: [...estructuras, nueva] };
  const valido = PlanDecoracionSchema.safeParse(candidato);
  if (!valido.success) return { ok: false, motivo: "esquema", detalle: valido.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 400) };
  return {
    ok: true, plan: valido.data, nueva: id, nombre, ubicacion, medidas: { ...nueva.medidas }, plantilla, renombradas,
    materiales: nueva.materiales.map((material) => ({ product_id: material.product_id, color: material.color ?? null, participacion: material.participacion })),
  };
}

export type PiezaEditada =
  | { ok: true; plan: PlanDecoracion; antes: { nombre: string; ubicacion: Ubicacion }; despues: { nombre: string; ubicacion: Ubicacion } }
  | { ok: false; motivo: "sin_pieza" | "ubicacion_ocupada" | "nombre_repetido" | "sin_cambio" | "esquema"; detalle: string };

/**
 * Mover o renombrar UNA pieza («pon la guirnalda arriba», «mueve la columna al centro», «llama a la guirnalda Cascada»):
 * solo cambian su `ubicacion` y su `nombre`; medidas, materiales y armados quedan igual. Al pasar de un lado al otro, el
 * nombre cambia de lado («Columna izquierda» → «Columna derecha») y su armado se dibuja en espejo.
 */
export function planConPiezaEditada(plan: PlanDecoracion, estructuraId: string, cambios: { ubicacion?: UbicacionPiezaNueva; nombre?: string }): PiezaEditada {
  const pieza = plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  if (!pieza) return { ok: false, motivo: "sin_pieza", detalle: `no hay ${estructuraId} en el plan` };
  const otras = plan.estructuras.filter((estructura) => estructura.estructura_id !== estructuraId);
  const oficial = esEstructuraOficialId(pieza.estructura_oficial) ? pieza.estructura_oficial : null;
  let ubicacion = pieza.ubicacion;
  if (cambios.ubicacion) {
    const nueva = oficial ? ubicacionDePieza(cambios.ubicacion, oficial, otras.map((estructura) => estructura.ubicacion)) : null;
    if (!nueva) return { ok: false, motivo: "ubicacion_ocupada", detalle: `no se puede llevar ${pieza.nombre} a ${cambios.ubicacion}` };
    ubicacion = nueva;
  }
  let nombre = pieza.nombre;
  if (cambios.nombre?.trim()) {
    nombre = cambios.nombre.trim().replace(/\s+/g, " ").slice(0, 60);
    if (otras.some((estructura) => normal(estructura.nombre) === normal(nombre))) return { ok: false, motivo: "nombre_repetido", detalle: `ya hay una pieza llamada ${nombre}` };
  } else if (ubicacion !== pieza.ubicacion && oficial && LADO_EN_NOMBRE.test(pieza.nombre)) {
    // «Columna izquierda» que se va a la derecha (o al centro) cambia el lado de su nombre.
    const base = pieza.nombre.replace(LADO_EN_NOMBRE, "");
    const lado = palabraLado(oficial, ubicacion);
    nombre = nombreUnico(lado ? `${base} ${lado}` : base, otras.map((estructura) => estructura.nombre), base);
  }
  if (ubicacion === pieza.ubicacion && nombre === pieza.nombre) return { ok: false, motivo: "sin_cambio", detalle: "la pieza ya está ahí y se llama así" };
  const movida = opuestos(pieza.ubicacion, ubicacion) ? enEspejo(pieza) : pieza;
  const candidato: PlanDecoracion = { ...plan, estructuras: plan.estructuras.map((estructura) => (estructura.estructura_id === estructuraId ? { ...movida, ubicacion, nombre } : estructura)) };
  const valido = PlanDecoracionSchema.safeParse(candidato);
  if (!valido.success) return { ok: false, motivo: "esquema", detalle: valido.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ").slice(0, 400) };
  return { ok: true, plan: valido.data, antes: { nombre: pieza.nombre, ubicacion: pieza.ubicacion }, despues: { nombre, ubicacion } };
}

type LineaConGlobos = { variant_id: string; product_id?: unknown; tamano_codigo?: unknown; diam_pulg?: unknown; color?: unknown; unidades?: unknown };
type ConLineas = { estructuras: ReadonlyArray<{ estructura_id: string; lineas: ReadonlyArray<LineaConGlobos> }> };

/**
 * Los globos de una pieza: unidades por producto, tamaño y color. Sin la variante a propósito: la variante es el
 * PAQUETE (x12, x20, x50) y Python reparte las unidades de cada tamaño entre paquetes según lo que compra el plan
 * entero (azul R-12: 12 en el x12 y 20 en el x20). Al sumar una pieza con los mismos globos cambia ese reparto, pero
 * no los globos de las demás.
 */
function huellaGlobos(lineas: ReadonlyArray<LineaConGlobos>): string {
  const porGlobo = new Map<string, number>();
  for (const linea of lineas) {
    const producto = typeof linea.product_id === "string" ? linea.product_id : `variante:${linea.variant_id}`;
    const tamano = typeof linea.tamano_codigo === "string" && linea.tamano_codigo ? linea.tamano_codigo : typeof linea.diam_pulg === "number" ? `${linea.diam_pulg}"` : typeof linea.product_id === "string" ? `variante:${linea.variant_id}` : "";
    const color = typeof linea.color === "string" ? normal(linea.color) : "";
    const clave = `${producto}|${tamano}|${color}`;
    porGlobo.set(clave, (porGlobo.get(clave) ?? 0) + (typeof linea.unidades === "number" ? linea.unidades : Number.NaN));
  }
  return [...porGlobo].map(([clave, unidades]) => `${clave}:${unidades}`).sort().join(",");
}

/**
 * Las piezas del plan de antes (todas, o solo `soloEstas`) llevan exactamente los mismos globos en el plan nuevo: mismo
 * producto, tamaño, color y unidades (`huellaGlobos`). Es la garantía de «agregar una pieza conserva las demás».
 */
export function piezasIntactas(base: ConLineas, resuelto: ConLineas, soloEstas?: ReadonlySet<string>): boolean {
  const huella = huellaGlobos;
  return base.estructuras.filter((antes) => !soloEstas || soloEstas.has(antes.estructura_id)).every((antes) => {
    const despues = resuelto.estructuras.find((estructura) => estructura.estructura_id === antes.estructura_id);
    return Boolean(despues) && huella(antes.lineas) === huella(despues!.lineas);
  });
}

/** Las piezas de antes cuyos globos cambiaron (para el registro y el mensaje). */
export function piezasCambiadas(base: ConLineas, resuelto: ConLineas): string[] {
  return base.estructuras.filter((antes) => !piezasIntactas({ estructuras: [antes] }, resuelto)).map((antes) => antes.estructura_id);
}
