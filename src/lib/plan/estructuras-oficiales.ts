import type { TipoEstructura } from "./composicion";

/**
 * Catálogo interno de estructuras oficiales.
 *
 * Única fuente de verdad de QUÉ estructuras decorativas soporta el sistema,
 * cómo se llaman para el cliente y cómo se describen al modelo de imagen.
 *
 * Contrato (ADR 0008): cada estructura del plan puede declarar
 * `estructura_oficial` con uno de estos ids. El `tipo` sigue siendo la
 * primitiva que mide la geometría y resuelve el backend (Next y Python), así
 * que cada estructura oficial fija con qué tipos, densidades y ubicación es
 * coherente. Planes anteriores sin el campo se reconocen por tipo, densidad y
 * nombre.
 *
 * Puro: sin proveedor, HTTP, base de datos ni variables de entorno.
 */

export const FORMAS_ESTRUCTURA = ["simetrica", "asimetrica", "organica", "circular", "libre"] as const;
export type FormaEstructura = (typeof FORMAS_ESTRUCTURA)[number];

export type DensidadEstructura = "sencilla" | "media" | "lujosa";

export const ESTRUCTURAS_OFICIALES_IDS = [
  "arco", "arco_asimetrico", "arco_no_denso",
  "semiarco", "semiarco_asimetrico",
  "columna", "columna_asimetrica", "columna_no_densa",
  "pared_densa", "pared_no_densa",
  "guirnalda", "centro_mesa", "bouquet", "figura",
  // Sugeridas y aprobadas: se construyen con los mismos tipos base.
  "aro_circular", "techo_globos",
] as const;
export type EstructuraOficialId = (typeof ESTRUCTURAS_OFICIALES_IDS)[number];

export type EstructuraOficial = {
  id: EstructuraOficialId;
  /** Nombre para el cliente (y etiqueta que el chat pone en `nombre`). */
  nombre: string;
  /** Una frase para el cliente: qué es, sin jerga. */
  descripcion: string;
  /** Tipo del plan con el que se construye (Plan 1.0). */
  tipoBase: TipoEstructura;
  /** Tipos coherentes con esta estructura (Plan 1.1 puede usar `escultura` para la figura). */
  tiposAdmitidos: readonly TipoEstructura[];
  forma: FormaEstructura;
  /** Densidades coherentes; undefined = cualquiera. */
  densidades?: readonly DensidadEstructura[];
  /** Ubicación obligatoria cuando la estructura la implica (techo). */
  ubicacion?: "techo";
  /** Sustantivo en inglés para el prompt de imagen. */
  sustantivoEn: string;
  /** Diferencias de geometría frente al tipo base; ausente = misma geometría. */
  geometria?: GeometriaEstructuraOficial;
  /**
   * Realistic minimum of loose latex balloons per instance for structures
   * without computed geometry (`unidades_declaradas`). A design assumption, not
   * a calibrated figure; `validarUnidadesDeclaradas` (restricciones.ts) applies it.
   */
  unidadesMinimasPorInstancia?: number;
};

/**
 * Cómo cambia el cálculo de globos de una variante respecto a su tipo base.
 * Next (`src/lib/medidas/geometria.ts`) la aplica directamente y el servicio
 * Python la lee del contrato exportado (`x-geometria-estructuras-oficiales`),
 * así que esta tabla es la única fuente.
 */
export type GeometriaEstructuraOficial = {
  /** "circunferencia": el eje es el perímetro de un círculo inscrito en ancho × alto. */
  eje?: "circunferencia";
  /**
   * Ancho de la banda en el extremo delgado, como fracción del ancho completo.
   * La banda se afina linealmente de un extremo al otro, así que el volumen
   * es el de una banda completa por (1 + anchoFinalBanda) / 2. Supuesto de
   * diseño sin calibrar, igual que λ.
   */
  anchoFinalBanda?: number;
};

export type GeometriaEstructurasOficialesContrato = Partial<Record<EstructuraOficialId, GeometriaEstructuraOficial>>;

export const ESTRUCTURAS_OFICIALES: Readonly<Record<EstructuraOficialId, EstructuraOficial>> = {
  arco: { id: "arco", nombre: "Arco", descripcion: "Curva completa de globos con dos bases en el piso.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "simetrica", sustantivoEn: "organic balloon garland arch" },
  arco_asimetrico: { id: "arco_asimetrico", nombre: "Arco asimétrico", descripcion: "Arco con un lado más cargado o más alto que el otro.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "asimetrica", sustantivoEn: "asymmetrical organic balloon garland arch", geometria: { anchoFinalBanda: 0.4 } },
  arco_no_denso: { id: "arco_no_denso", nombre: "Arco no denso", descripcion: "Arco ligero, con espacios entre los globos.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "simetrica", densidades: ["sencilla"], sustantivoEn: "airy organic balloon garland arch" },
  semiarco: { id: "semiarco", nombre: "Semiarco", descripcion: "Un solo lado que sube y se curva, abierto arriba.", tipoBase: "semiarco", tiposAdmitidos: ["semiarco"], forma: "simetrica", sustantivoEn: "one-sided curved organic balloon garland" },
  semiarco_asimetrico: { id: "semiarco_asimetrico", nombre: "Semiarco asimétrico", descripcion: "Semiarco de contorno irregular, más grueso en una parte.", tipoBase: "semiarco", tiposAdmitidos: ["semiarco"], forma: "asimetrica", sustantivoEn: "asymmetrical one-sided curved organic balloon garland", geometria: { anchoFinalBanda: 0.4 } },
  columna: { id: "columna", nombre: "Columna", descripcion: "Torre recta de globos.", tipoBase: "columna", tiposAdmitidos: ["columna"], forma: "simetrica", sustantivoEn: "organic balloon column" },
  columna_asimetrica: { id: "columna_asimetrica", nombre: "Columna asimétrica", descripcion: "Columna de contorno irregular, con racimos a un lado.", tipoBase: "columna", tiposAdmitidos: ["columna"], forma: "asimetrica", sustantivoEn: "asymmetrical organic balloon column" },
  columna_no_densa: { id: "columna_no_densa", nombre: "Columna no densa", descripcion: "Columna ligera, con espacios entre los globos.", tipoBase: "columna", tiposAdmitidos: ["columna"], forma: "simetrica", densidades: ["sencilla"], sustantivoEn: "airy organic balloon column" },
  pared_densa: { id: "pared_densa", nombre: "Pared de globos densa", descripcion: "Fondo completo de globos, sin huecos.", tipoBase: "pared", tiposAdmitidos: ["pared"], forma: "simetrica", densidades: ["media", "lujosa"], sustantivoEn: "dense balloon wall installation" },
  pared_no_densa: { id: "pared_no_densa", nombre: "Pared de globos no densa", descripcion: "Fondo de globos ligero, deja ver la pared.", tipoBase: "pared", tiposAdmitidos: ["pared"], forma: "organica", densidades: ["sencilla"], sustantivoEn: "airy balloon wall installation" },
  guirnalda: { id: "guirnalda", nombre: "Guirnalda", descripcion: "Tira orgánica de globos sobre una superficie o el piso.", tipoBase: "guirnalda", tiposAdmitidos: ["guirnalda"], forma: "organica", sustantivoEn: "organic balloon garland" },
  centro_mesa: { id: "centro_mesa", nombre: "Centro de mesa con globos", descripcion: "Arreglo bajo de globos sobre una mesa.", tipoBase: "centro_mesa", tiposAdmitidos: ["centro_mesa"], forma: "libre", sustantivoEn: "small balloon cluster centerpiece" },
  bouquet: { id: "bouquet", nombre: "Bouquet de globos", descripcion: "Ramillete de globos atados que flota o se apoya en un peso.", tipoBase: "kit", tiposAdmitidos: ["kit"], forma: "libre", sustantivoEn: "balloon bouquet", unidadesMinimasPorInstancia: 5 },
  figura: { id: "figura", nombre: "Figura con globos", descripcion: "Figura armada con globos (animal, número, personaje).", tipoBase: "kit", tiposAdmitidos: ["kit", "escultura"], forma: "libre", sustantivoEn: "balloon sculpture figure", unidadesMinimasPorInstancia: 20 },
  aro_circular: { id: "aro_circular", nombre: "Aro circular", descripcion: "Marco redondo cubierto de globos.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "circular", sustantivoEn: "circular balloon hoop", geometria: { eje: "circunferencia" } },
  techo_globos: { id: "techo_globos", nombre: "Techo de globos", descripcion: "Globos suspendidos que cubren el techo.", tipoBase: "guirnalda", tiposAdmitidos: ["guirnalda"], forma: "libre", ubicacion: "techo", sustantivoEn: "ceiling balloon installation" },
};

function normalizar(texto: string | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export type EstructuraPlanLigera = {
  tipo: string;
  densidad?: string;
  ubicacion?: string;
  nombre?: string;
  estructura_oficial?: string;
};

export function esEstructuraOficialId(valor: unknown): valor is EstructuraOficialId {
  return typeof valor === "string" && (ESTRUCTURAS_OFICIALES_IDS as readonly string[]).includes(valor);
}

/**
 * Incoherencias entre la estructura oficial declarada y los campos que miden y
 * resuelven la estructura. Vacío = coherente. El backend Python aplica la
 * misma tabla (`services/ai-api/app/plan.py`).
 */
export function incoherenciasEstructuraOficial(estructura: { estructura_oficial?: string; tipo: string; densidad: string; ubicacion: string }): Array<{ campo: "estructura_oficial" | "tipo" | "densidad" | "ubicacion"; mensaje: string }> {
  if (estructura.estructura_oficial === undefined) return [];
  if (!esEstructuraOficialId(estructura.estructura_oficial)) {
    return [{ campo: "estructura_oficial", mensaje: "Estructura oficial desconocida." }];
  }
  const oficial = ESTRUCTURAS_OFICIALES[estructura.estructura_oficial];
  const problemas: Array<{ campo: "estructura_oficial" | "tipo" | "densidad" | "ubicacion"; mensaje: string }> = [];
  if (!(oficial.tiposAdmitidos as readonly string[]).includes(estructura.tipo)) {
    problemas.push({ campo: "tipo", mensaje: `${oficial.nombre} se construye con tipo ${oficial.tiposAdmitidos.join(" o ")}.` });
  }
  if (oficial.densidades && !(oficial.densidades as readonly string[]).includes(estructura.densidad)) {
    problemas.push({ campo: "densidad", mensaje: `${oficial.nombre} requiere densidad ${oficial.densidades.join(" o ")}.` });
  }
  if (oficial.ubicacion === "techo" && !["techo", "techo_multipunto"].includes(estructura.ubicacion)) {
    problemas.push({ campo: "ubicacion", mensaje: `${oficial.nombre} se ubica en el techo.` });
  }
  return problemas;
}

/**
 * Estructura oficial que corresponde a una estructura del plan. Un tipo de
 * globos sin variante reconocible cae en su estructura base; las piezas que no
 * son estructuras de globos (backdrop, kit o accesorio sin etiqueta de bouquet
 * o figura) devuelven undefined en vez de inventar una.
 */
export function identificarEstructuraOficial(estructura: EstructuraPlanLigera): EstructuraOficial | undefined {
  // The declared contract field is authoritative; name inference only covers plans created before it.
  if (esEstructuraOficialId(estructura.estructura_oficial)) return ESTRUCTURAS_OFICIALES[estructura.estructura_oficial];
  const nombre = normalizar(estructura.nombre);
  const asimetrica = /\basimetric|\basymmetr/.test(nombre);
  const noDensa = estructura.densidad === "sencilla" || /\bno dens|\bliger|\bairy\b/.test(nombre);
  const densa = estructura.densidad === "lujosa" || (/\bdens[ao]\b/.test(nombre) && !/\bno dens/.test(nombre));
  const oficial = (id: EstructuraOficialId) => ESTRUCTURAS_OFICIALES[id];
  if (/\bbouquet|\bramillete/.test(nombre)) return oficial("bouquet");
  if (/\bfigura|\bescultura|\bsculpture/.test(nombre) || estructura.tipo === "escultura") return oficial("figura");
  if (estructura.ubicacion === "techo" || /\btecho de globos|\bcielo de globos/.test(nombre)) {
    if (estructura.tipo === "guirnalda" || estructura.tipo === "pared") return oficial("techo_globos");
  }
  switch (estructura.tipo) {
    case "arco":
      if (/\baro\b|\bcircular|\bhoop/.test(nombre)) return oficial("aro_circular");
      if (asimetrica) return oficial("arco_asimetrico");
      return noDensa ? oficial("arco_no_denso") : oficial("arco");
    case "semiarco":
      return asimetrica ? oficial("semiarco_asimetrico") : oficial("semiarco");
    case "columna":
      if (asimetrica) return oficial("columna_asimetrica");
      return noDensa ? oficial("columna_no_densa") : oficial("columna");
    case "pared":
      return noDensa && !densa ? oficial("pared_no_densa") : oficial("pared_densa");
    case "guirnalda":
      return oficial("guirnalda");
    case "centro_mesa":
      return oficial("centro_mesa");
    default:
      return undefined;
  }
}

/** Ubicaciones del plan en palabras del cliente. */
export const UBICACION_PARA_CLIENTE: Readonly<Record<string, string>> = {
  arco_central: "al centro",
  zona_central: "al centro",
  entrada: "en la entrada",
  sobre_mesa_principal: "sobre la mesa principal",
  lateral_izquierdo: "a la izquierda",
  lateral_derecho: "a la derecha",
  fondo_pared: "contra la pared del fondo",
  piso_frontal: "en el piso, al frente",
  mesas_invitados: "en las mesas de invitados",
  techo: "en el techo",
  fachada: "en la fachada",
  pared_lateral: "en una pared lateral",
  alrededor_mobiliario: "alrededor del mobiliario",
  vegetacion: "entre la vegetación",
  techo_multipunto: "colgando del techo en varios puntos",
  recorrido_suelo: "a lo largo del piso",
  esquina: "en una esquina",
};

export const DENSIDAD_PARA_CLIENTE: Readonly<Record<DensidadEstructura, string>> = {
  sencilla: "ligera",
  media: "equilibrada",
  lujosa: "abundante",
};

/** Resumen informativo para el cliente, ej. "Semiarco asimétrico · a la izquierda · 1,8 m de alto". */
export function resumenEstructuraParaCliente(estructura: EstructuraPlanLigera & { altoM?: number }): string {
  const oficial = identificarEstructuraOficial(estructura);
  const partes: string[] = [oficial?.nombre ?? estructura.nombre ?? estructura.tipo];
  const ubicacion = estructura.ubicacion ? UBICACION_PARA_CLIENTE[estructura.ubicacion] : undefined;
  if (ubicacion) partes.push(ubicacion);
  if (estructura.altoM !== undefined) partes.push(`${String(Number(estructura.altoM.toFixed(2))).replace(".", ",")} m de alto`);
  return partes.join(" · ");
}

/**
 * Guía para el modelo del chat: qué estructuras existen y cómo expresarlas en
 * el plan actual (tipo + densidad + nombre con la etiqueta oficial).
 */
export const GUIA_ESTRUCTURAS_OFICIALES = `

ESTRUCTURAS OFICIALES
Solo diseña con estas estructuras. En confirmar_plan_decoracion pon en cada estructura estructura_oficial con el id indicado, el tipo indicado, una densidad admitida cuando se indique, y empieza el nombre con su etiqueta oficial (ej. "Semiarco asimétrico derecho"):
${Object.values(ESTRUCTURAS_OFICIALES).map((estructura) => `- ${estructura.nombre} (estructura_oficial ${estructura.id}): tipo ${estructura.tipoBase}${estructura.densidades ? `, densidad ${estructura.densidades.join(" o ")}` : ""}${estructura.ubicacion ? `, ubicación ${estructura.ubicacion}` : ""}. ${estructura.descripcion}`).join("\n")}
- Bouquet y Figura con globos no tienen geometría calculada: indica variant_id y unidades_declaradas. unidades_declaradas es el total de globos de la pieza sumando sus repeticiones (no el número de figuras): al menos ${Object.values(ESTRUCTURAS_OFICIALES).filter((estructura) => estructura.unidadesMinimasPorInstancia).map((estructura) => `${estructura.unidadesMinimasPorInstancia} globos por ${estructura.nombre}`).join(" y ")} y nunca menos unidades que materiales.
- Asimétrica significa un contorno irregular o un lado más cargado; dos piezas separadas de alturas distintas son dos estructuras, no una asimétrica.`;

/**
 * The coherence table as JSON Schema `allOf` rules for an estructura object.
 * The domain contract export injects them, so the Python service (which only
 * sees the generated JSON Schema) enforces exactly the same table as
 * `incoherenciasEstructuraOficial`; this file stays the single owner.
 */
export function reglasJsonSchemaEstructuraOficial(): Array<Record<string, unknown>> {
  return Object.values(ESTRUCTURAS_OFICIALES).map((estructura) => ({
    if: { properties: { estructura_oficial: { const: estructura.id } }, required: ["estructura_oficial"] },
    then: {
      properties: {
        tipo: { enum: [...estructura.tiposAdmitidos] },
        ...(estructura.densidades ? { densidad: { enum: [...estructura.densidades] } } : {}),
        ...(estructura.ubicacion === "techo" ? { ubicacion: { enum: ["techo", "techo_multipunto"] } } : {}),
      },
    },
  }));
}


/** Tabla de geometría por variante, en la forma que se exporta al contrato para Python. */
export function geometriaEstructurasOficiales(): GeometriaEstructurasOficialesContrato {
  return Object.fromEntries(
    Object.values(ESTRUCTURAS_OFICIALES)
      .filter((estructura) => estructura.geometria)
      .map((estructura) => [estructura.id, estructura.geometria]),
  );
}
