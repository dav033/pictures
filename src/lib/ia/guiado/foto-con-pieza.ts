import type { ColorFotoFaltante } from "@/lib/plan/colores-foto-plan";
import { MENSAJE_SOLO_REFERENCIAS } from "@/lib/estado/mensaje-foto-referencia";
import { CREATIVIDAD_POR_DEFECTO } from "@/lib/ia/escena/creatividad";
import { ReferenceBlueprintV2Schema, type ReferenceBBox, type ReferenceBlueprintV2, type ReferenceElement } from "@/lib/ia/referencia/reference-blueprint";
import { ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import { MEDIDAS_ESTANDAR, ubicacionDePieza } from "@/lib/plan/pieza-nueva";
import type { Ubicacion } from "@/lib/plan/tipos";
import { UBICACIONES_1_0 } from "@/lib/plan/composicion";
import type { ContextoClienteGuiado } from "./contexto-cliente";
import { LUGAR_EN_PALABRAS, piezaIndefinida, type PiezaNuevaChat } from "./edicion-plan-chat";
import { briefChatGuiado, instruccionPlanFoto } from "./instruccion-plan";

/**
 * «¿Puedes agregar una guirnalda en medio?» con la lectura de una foto pendiente (dueño, 2026-10-07): la guiada armaba un
 * plan NUEVO solo con la guirnalda y perdía las dos columnas de la foto. Ahora el plan se pide por el MISMO camino del
 * plan con foto («Sí, armémoslo»: /api/chat con la lectura) con la lectura de la foto MÁS un elemento para la pieza
 * pedida: aprobado, con su lugar en la foto (entre las dos columnas, para «en medio»), los colores de las piezas de
 * globos de la foto y su medida. Así la confirmación tiene que materializarlo (cobertura de la lectura) y la imagen lo
 * coloca donde va. El elemento dice que no está en la foto y su confianza es baja (0,4): Python no mide nada con su caja.
 *
 * Puro e importable desde el navegador: lo usa `aceptarPlanFoto` de la vista y lo prueban sin red.
 */

/** Lo único que el plan con foto añade al texto de la clásica: la guiada necesita el plan confirmado en este turno. */
export const CONFIRMAR_PLAN_FOTO = "Confirma el plan con confirmar_plan_decoracion en este mismo turno, sin preguntarme nada.";

/** La confianza del elemento pedido: por debajo de 0,5 Python no ancla ni mide ninguna pieza con su caja. */
const CONFIANZA_PEDIDA = 0.4;

export type LecturaConPieza = {
  blueprint: ReferenceBlueprintV2;
  /** El elemento de la pieza pedida («REF_01_E13»). */
  elemento: string;
  ubicacion: Ubicacion;
  medidas: { ancho_m?: number; alto_m?: number; largo_m?: number };
};

function piezasDeGlobos(blueprint: ReferenceBlueprintV2): ReferenceElement[] {
  return blueprint.elements.filter((elemento) => elemento.approved && elemento.include_policy !== "exclude" && elemento.category === "balloon_structure");
}

function centroX(elemento: ReferenceElement): number {
  return elemento.reference_bbox.x + elemento.reference_bbox.width / 2;
}

function esUbicacionPlan(valor: string | undefined): valor is Ubicacion {
  return typeof valor === "string" && (UBICACIONES_1_0 as readonly string[]).includes(valor);
}

/** El lado de una pieza de la foto: el que dice la lectura, o el de su caja. */
function ladoDe(elemento: ReferenceElement): "izquierda" | "derecha" | null {
  const lugar = elemento.visual_semantics?.placement;
  if (lugar === "lateral_izquierdo") return "izquierda";
  if (lugar === "lateral_derecho") return "derecha";
  const centro = centroX(elemento);
  return centro < 0.45 ? "izquierda" : centro > 0.55 ? "derecha" : null;
}

function acotar(caja: ReferenceBBox): ReferenceBBox {
  const x = Math.min(0.97, Math.max(0.02, caja.x));
  const y = Math.min(0.97, Math.max(0.02, caja.y));
  const width = Math.max(0.02, Math.min(caja.width, 0.98 - x));
  const height = Math.max(0.02, Math.min(caja.height, 0.98 - y));
  const redondo = (valor: number) => Math.round(valor * 1000) / 1000;
  return { x: redondo(x), y: redondo(y), width: redondo(width), height: redondo(height) };
}

/**
 * Dónde va la pieza pedida en la foto. «En medio» con una pieza a cada lado: de centro a centro, en la parte de arriba
 * (una guirnalda que las une) o entre las dos (otra pieza). Si no, una caja del lugar pedido. Siempre dentro del marco:
 * una caja que toca el borde Python la lee como pieza cortada.
 */
function cajaDeLaPieza(ubicacion: Ubicacion, estructura: PiezaNuevaChat["estructura"], globos: readonly ReferenceElement[]): ReferenceBBox {
  const tipo = ESTRUCTURAS_OFICIALES[estructura].tipoBase;
  const tira = tipo === "guirnalda";
  const vertical = tipo === "columna";
  const izquierda = globos.filter((elemento) => ladoDe(elemento) === "izquierda");
  const derecha = globos.filter((elemento) => ladoDe(elemento) === "derecha");
  const arriba = globos.length ? Math.min(...globos.map((elemento) => elemento.reference_bbox.y)) : 0.1;
  const altoMedio = globos.length ? globos.reduce((suma, elemento) => suma + elemento.reference_bbox.height, 0) / globos.length : 0.7;
  if (ubicacion === "arco_central" && izquierda.length && derecha.length) {
    const desde = Math.max(...izquierda.map(centroX));
    const hasta = Math.min(...derecha.map(centroX));
    if (hasta - desde > 0.08) {
      if (tira) return acotar({ x: desde, y: arriba + 0.02, width: hasta - desde, height: Math.min(0.3, Math.max(0.1, altoMedio * 0.25)) });
      const ancho = Math.min(hasta - desde, vertical ? 0.14 : 0.4);
      return acotar({ x: (desde + hasta) / 2 - ancho / 2, y: arriba + 0.05, width: ancho, height: altoMedio * 0.85 });
    }
  }
  const generica: Readonly<Record<Ubicacion, ReferenceBBox>> = {
    arco_central: tira ? { x: 0.3, y: 0.15, width: 0.4, height: 0.15 } : vertical ? { x: 0.44, y: 0.15, width: 0.12, height: 0.75 } : { x: 0.25, y: 0.1, width: 0.5, height: 0.75 },
    fondo_pared: { x: 0.2, y: 0.05, width: 0.6, height: tira ? 0.15 : 0.6 },
    lateral_izquierdo: { x: 0.03, y: 0.15, width: vertical ? 0.14 : 0.25, height: tira ? 0.4 : 0.75 },
    lateral_derecho: { x: vertical ? 0.83 : 0.72, y: 0.15, width: vertical ? 0.14 : 0.25, height: tira ? 0.4 : 0.75 },
    piso_frontal: { x: 0.2, y: 0.8, width: 0.6, height: 0.15 },
    entrada: { x: 0.4, y: 0.15, width: 0.2, height: 0.75 },
    sobre_mesa_principal: { x: 0.38, y: 0.55, width: 0.24, height: 0.2 },
    mesas_invitados: { x: 0.38, y: 0.55, width: 0.24, height: 0.2 },
    techo: { x: 0.1, y: 0.02, width: 0.8, height: 0.12 },
  };
  return acotar(generica[ubicacion]);
}

/** El siguiente id de elemento de la imagen («REF_01_E13»), sin repetir. */
function idLibre(blueprint: ReferenceBlueprintV2, imagen: string): string {
  const usados = new Set(blueprint.elements.map((elemento) => elemento.element_id));
  for (let indice = blueprint.elements.length + 1; indice < 200; indice += 1) {
    const candidato = `${imagen}_E${String(indice).padStart(2, "0")}`;
    if (!usados.has(candidato)) return candidato;
  }
  return `${imagen}_PEDIDA`;
}

/** Los colores medidos de las piezas de globos, juntos: la parte media de cada color, de mayor a menor. */
function coloresMedidosJuntos(globos: readonly ReferenceElement[]): NonNullable<ReferenceElement["appearance"]["measured_colors"]> {
  const partes = new Map<string, number>();
  for (const elemento of globos) for (const medido of elemento.appearance.measured_colors ?? []) partes.set(medido.color, (partes.get(medido.color) ?? 0) + medido.share / globos.length);
  return [...partes].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([color, share]) => ({ color, share: Math.round(share * 10_000) / 10_000 }));
}

/** Las referencias Sempertex medidas en las piezas de globos, juntas (las que deciden qué globo se compra). */
function referenciasJuntas(globos: readonly ReferenceElement[]): NonNullable<ReferenceElement["appearance"]["referencias_medidas"]> {
  const porCodigo = new Map<string, NonNullable<ReferenceElement["appearance"]["referencias_medidas"]>[number]>();
  for (const elemento of globos) {
    for (const referencia of elemento.appearance.referencias_medidas ?? []) {
      const previa = porCodigo.get(referencia.codigo);
      porCodigo.set(referencia.codigo, previa ? { ...previa, parte: previa.parte + referencia.parte / globos.length, familia_fiable: previa.familia_fiable && referencia.familia_fiable } : { ...referencia, parte: referencia.parte / globos.length });
    }
  }
  return [...porCodigo.values()].sort((a, b) => b.parte - a.parte).slice(0, 5).map((referencia) => ({ ...referencia, parte: Math.min(1, Math.round(referencia.parte * 10_000) / 10_000) }));
}

/**
 * La lectura de la foto con un elemento más para la pieza pedida. Las piezas de la foto no cambian. Null si la lectura
 * resultante no fuera válida (la vista sigue entonces por el camino de siempre).
 */
export function lecturaConPiezaNueva(blueprint: ReferenceBlueprintV2, pieza: PiezaNuevaChat): LecturaConPieza | null {
  const globos = piezasDeGlobos(blueprint);
  const ocupadas = globos.flatMap((elemento): Ubicacion[] => {
    const lugar = elemento.visual_semantics?.placement;
    if (esUbicacionPlan(lugar)) return [lugar];
    const lado = ladoDe(elemento);
    return lado ? [lado === "izquierda" ? "lateral_izquierdo" : "lateral_derecho"] : [];
  });
  const ubicacion = ubicacionDePieza(pieza.ubicacion, pieza.estructura, ocupadas) ?? "arco_central";
  const medidas = { ...MEDIDAS_ESTANDAR[pieza.estructura], ...(pieza.medidas ?? {}) };
  const imagen = globos[0]?.source_image_id ?? blueprint.source_images[0]?.image_id;
  if (!imagen) return null;
  const elemento = idLibre(blueprint, imagen);
  const oficial = ESTRUCTURAS_OFICIALES[pieza.estructura];
  const conColores = pieza.colores.length > 0;
  const observados = conColores ? pieza.colores : [...new Set(globos.flatMap((item) => item.appearance.observed_colors))].slice(0, 8);
  const medidos = conColores ? [] : coloresMedidosJuntos(globos);
  const referencias = conColores ? [] : referenciasJuntas(globos);
  const modelo = globos[0];
  const nuevo: ReferenceElement = {
    element_id: elemento,
    source_image_id: imagen,
    name: `Client-requested ${oficial.sustantivoEn}`.slice(0, 160),
    category: "balloon_structure",
    scene_role: modelo?.scene_role ?? "foreground",
    detection_confidence: CONFIANZA_PEDIDA,
    visible_evidence: `No está en la foto: el cliente pidió sumar ${piezaIndefinida(pieza.estructura)}${pieza.ubicacion ? ` ${LUGAR_EN_PALABRAS[pieza.ubicacion]}` : ""} a las piezas de la foto.`.slice(0, 320),
    reference_bbox: cajaDeLaPieza(ubicacion, pieza.estructura, globos),
    depth_layer: modelo?.depth_layer ?? 1,
    include_policy: "include",
    approved: true,
    source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: {
      observed_colors: observados,
      resolved_colors: [],
      color_policy: conColores ? "custom" : modelo?.appearance.color_policy ?? "adapt_to_event_palette",
      material: "latex balloons",
      shape: `${oficial.sustantivoEn}, ${ubicacion === "arco_central" ? "centered between the photo's balloon pieces" : ubicacion.replace(/_/g, " ")}`.slice(0, 160),
      composition: (conColores ? `Balloons in ${pieza.colores.join(", ")}.` : "Same balloon colors, finishes and size mix as the photo's balloon pieces.").slice(0, 240),
      ...(medidos.length ? { measured_colors: medidos } : {}),
      ...(referencias.length ? { referencias_medidas: referencias } : {}),
    },
    relationships: [],
    visual_semantics: {
      structure_type: oficial.tipoBase,
      placement: ubicacion,
      design_role: "soporte",
      repetition_group: elemento,
      density: modelo?.visual_semantics?.density ?? "media",
      dimensions_m: {
        ...(medidas.ancho_m ? { width: medidas.ancho_m } : {}),
        ...(medidas.alto_m ? { height: medidas.alto_m } : {}),
        ...(medidas.largo_m ? { length: medidas.largo_m } : {}),
      },
    },
    quantity_semantics: "physical_instances",
    uncertainties: ["Pieza pedida por el cliente en el chat: su caja es el lugar donde va, no una detección."],
  };
  const valido = ReferenceBlueprintV2Schema.safeParse({ ...blueprint, elements: [...blueprint.elements, nuevo] });
  if (!valido.success) return null;
  return { blueprint: valido.data, elemento, ubicacion, medidas };
}

/**
 * Si el plan que armó /api/chat trae la pieza pedida: la estructura que materializa su elemento, o una pieza más de su
 * tipo que las de la foto. Si no la trae (el modelo la omitió), la vista la suma con el editor (`agregar_pieza`): el
 * cliente nunca recibe un plan sin lo que pidió.
 */
export function planLlevaPiezaPedida(plan: { plan: { estructuras: ReadonlyArray<{ tipo: string; referencia_element_id?: string }> } }, lectura: LecturaConPieza, pieza: PiezaNuevaChat): boolean {
  const estructuras = plan.plan.estructuras;
  if (estructuras.some((estructura) => estructura.referencia_element_id === lectura.elemento)) return true;
  const tipo = ESTRUCTURAS_OFICIALES[pieza.estructura].tipoBase;
  const enLaFoto = piezasDeGlobos(lectura.blueprint).filter((elemento) => elemento.element_id !== lectura.elemento && elemento.visual_semantics?.structure_type === tipo).length;
  return estructuras.filter((estructura) => estructura.tipo === tipo).length > enLaFoto;
}

/** La línea del pedido para la pieza nueva: es un elemento de la lectura y va en su propia estructura. */
export function lineaPiezaNuevaFoto(pieza: PiezaNuevaChat, lectura: LecturaConPieza): string {
  const medidas = Object.entries(lectura.medidas).map(([campo, valor]) => `${campo} ${valor}`).join(", ");
  const colores = pieza.colores.length ? `colores de esta pieza: ${pieza.colores.join(", ")}` : "en los mismos colores y acabados de las piezas de globos de la foto";
  return [
    `Además de las piezas de globos de la foto, el cliente pidió sumar ${piezaIndefinida(pieza.estructura)}${pieza.ubicacion ? ` ${LUGAR_EN_PALABRAS[pieza.ubicacion]}` : ""}: es el elemento ${lectura.elemento} de la lectura (no está en la foto).`,
    `Ponla en su propia estructura (estructura_oficial: ${pieza.estructura}; referencia_element_id: ${lectura.elemento}; ubicacion: ${lectura.ubicacion}; repeticiones: 1; medidas: ${medidas}), ${colores}.${pieza.organica ? " Mezcla al menos 3 tamaños en esa pieza." : ""}`,
    "Las piezas de la foto quedan como en la lectura.",
  ].join(" ");
}

export type PiezaNuevaDeFoto = { pieza: PiezaNuevaChat; lectura: LecturaConPieza };

/**
 * El cuerpo de /api/chat con que la guiada pide el plan de una foto («Sí, armémoslo»), con la pieza que el cliente pidió
 * sumar si la hay. El primer intento manda el MISMO texto que la clásica con una foto sola (`MENSAJE_SOLO_REFERENCIAS`);
 * el reintento, la instrucción guiada con los colores de la foto. La pieza pedida va en las dos: su línea y la lectura
 * con su elemento.
 */
export function cuerpoPlanFoto(opciones: {
  reintento: boolean;
  blueprint: ReferenceBlueprintV2;
  colores: readonly string[];
  cliente: ContextoClienteGuiado;
  imagen?: { base64: string; mime: string } | null;
  faltantes?: readonly ColorFotoFaltante[];
  piezaNueva?: PiezaNuevaDeFoto | null;
}) {
  const { reintento, blueprint, cliente, imagen, faltantes, piezaNueva } = opciones;
  const colores = [...new Set([...opciones.colores, ...(piezaNueva?.pieza.colores ?? [])])];
  const base = reintento ? instruccionPlanFoto({ reintento, colores, ...(faltantes?.length ? { faltantes } : {}) }) : `${MENSAJE_SOLO_REFERENCIAS}\n${CONFIRMAR_PLAN_FOTO}`;
  return {
    schema_version: "chat.v1" as const,
    messages: [{ role: "user" as const, content: piezaNueva ? `${base}\n${lineaPiezaNuevaFoto(piezaNueva.pieza, piezaNueva.lectura)}` : base }],
    brief: briefChatGuiado(colores, cliente),
    ...(cliente.solicitud ? { solicitudCliente: cliente.solicitud } : {}),
    creatividad: CREATIVIDAD_POR_DEFECTO,
    ...(imagen ? { imagenesReferencia: [imagen] } : {}),
    referenceBlueprint: piezaNueva ? piezaNueva.lectura.blueprint : blueprint,
    // Dos columnas de la foto son dos piezas: el servidor separa la pareja en espejo («Columna izquierda» y «derecha»).
    piezasIndividuales: true as const,
  };
}
