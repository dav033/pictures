import type { FormaGuirnalda } from "./armado-guirnalda";
import type { TipoEstructura } from "./composicion";
import type { PlanDecoracion } from "./tipos";

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

/**
 * Cómo nombra el corpus del LoRA una columna, medido sobre sus 345 captions (`data/staging/lora-v007`):
 * **`balloon column`, 91 veces** (74 como «a balloon column», 9 en plural). Ni una sola dice «organic
 * balloon column»: «organic» solo acompaña a `organic balloon garland` (128) y `organic balloon arch`
 * (107), que sí son suyos y por eso se conservan. «airy» aparece 0 veces; «installation», 0.
 *
 * Y «asymmetrical» aparece 14 veces, **las 14 en `asymmetrical balloon half-arch`**. Nunca en una columna.
 * Por eso una columna orgánica pedida como «asymmetrical organic balloon column» salía dibujada doblándose
 * como un medio arco (2026-10-03): el modelo hacía exactamente lo que se le pedía, con la única pieza que
 * aprendió que ese adjetivo nombra.
 *
 * Lo que esas palabras querían decir —que mezcla diámetros— ya lo dice el corpus a su manera y 218 veces:
 * `mixed organically rather than graded`, que `fraseRelacionTamanos` emite sola cuando la pieza mezcla
 * tallas. Lo que se pierde al quitarlas es la distinción «no densa»: el corpus no tiene cómo decirla, y
 * escribir una palabra que el modelo no vio es justo el fallo que este comentario documenta.
 *
 * **Por qué solo cambió la columna.** `sustantivoEn` lo lee el dialecto de escena (`eventdecor_style_v2`,
 * el LoRA v004); el de producto (v007) nombra por `STRUCTURE_NOUNS` en `caption-flux.ts`, que ya
 * coincide con este corpus pieza por pieza. Del dataset de v004 no queda copia, así que sus sustantivos no
 * se pueden medir: los que siguen fuera de corpus («airy organic balloon garland arch», «asymmetrical
 * organic balloon wall installation») se dejan como están, porque nadie ha visto fallar la imagen que
 * producen y hay hallazgos observados que dependen de esa redacción —«arch» cerraba dos medios arcos en
 * uno, de ahí `one-sided curved organic balloon garland`—. La columna se cambió porque sí se vio fallar.
 * Cambiar los demás sin una imagen que lo justifique sería adivinar.
 */
export const FORMAS_ESTRUCTURA = ["simetrica", "asimetrica", "organica", "circular", "libre"] as const;
export type FormaEstructura = (typeof FORMAS_ESTRUCTURA)[number];

export type DensidadEstructura = "sencilla" | "media" | "lujosa";

export const ESTRUCTURAS_OFICIALES_IDS = [
  "arco", "arco_asimetrico", "arco_no_denso",
  "semiarco", "semiarco_asimetrico",
  "columna", "columna_asimetrica", "columna_no_densa",
  "pared_densa", "pared_no_densa", "pared_organica",
  "guirnalda", "centro_mesa", "bouquet", "figura",
  // Sugeridas y aprobadas: se construyen con los mismos tipos base.
  "aro_circular", "techo_globos",
  // Aprobada por el dueño el 2026-10-06 (F7-3): un racimo fijado a la pared no es un bouquet.
  "racimo_pared",
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
 * Solo la aplica el resolutor Python (`services/ai-api/app/plan.py`, `_eje` y
 * `_total_globos`), que la lee del contrato exportado
 * (`x-geometria-estructuras-oficiales`), así que esta tabla es la única fuente.
 */
export type GeometriaEstructuraOficial = {
  /**
   * "circunferencia": el eje es el perímetro de un círculo inscrito en ancho × alto.
   * "largo": el eje es `largo_m` (o `ancho_m` si falta), como en una guirnalda.
   */
  eje?: "circunferencia" | "largo";
  /**
   * Ancho de la banda en el extremo delgado, como fracción del ancho completo.
   * La banda se afina linealmente de un extremo al otro, así que el volumen
   * es el de una banda completa por (1 + anchoFinalBanda) / 2. Supuesto de
   * diseño sin calibrar, igual que λ.
   */
  anchoFinalBanda?: number;
  /**
   * Geometría por forma de una guirnalda con `armado_guirnalda` (ADR-0032).
   * `factorPerfil` multiplica la banda como `anchoFinalBanda` (1 = banda
   * completa; sin calibrar, igual que λ). Con `conCaida` y `caida_m` el eje es
   * el largo real de la cuerda que cuelga: un arco de parábola por tramo entre
   * anclajes, que para caídas chicas es largo + 8/3 · caída² / largo. Con
   * `desnivel_m` (en cualquier forma) los extremos van a distinta altura: la
   * cuerda es la parábola entre ellos con esa caída bajo la recta que los une
   * o, sin caída, esa recta inclinada. Sin armado, la guirnalda se cuenta con
   * su largo, como siempre.
   */
  formas?: Readonly<Record<FormaGuirnalda, { factorPerfil: number; conCaida: boolean }>>;
};

export type GeometriaEstructurasOficialesContrato = Partial<Record<EstructuraOficialId, GeometriaEstructuraOficial>>;

export const ESTRUCTURAS_OFICIALES: Readonly<Record<EstructuraOficialId, EstructuraOficial>> = {
  arco: { id: "arco", nombre: "Arco", descripcion: "Curva completa de globos con dos bases en el piso.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "simetrica", sustantivoEn: "organic balloon garland arch" },
  arco_asimetrico: { id: "arco_asimetrico", nombre: "Arco orgánico", descripcion: "Arco con un lado más cargado o más alto que el otro.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "asimetrica", sustantivoEn: "asymmetrical organic balloon garland arch", geometria: { anchoFinalBanda: 0.4 } },
  arco_no_denso: { id: "arco_no_denso", nombre: "Arco no denso", descripcion: "Arco ligero, con espacios entre los globos.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "simetrica", densidades: ["sencilla"], sustantivoEn: "airy organic balloon garland arch" },
  semiarco: { id: "semiarco", nombre: "Semiarco", descripcion: "Un solo lado que sube y se curva, abierto arriba.", tipoBase: "semiarco", tiposAdmitidos: ["semiarco"], forma: "simetrica", sustantivoEn: "one-sided curved organic balloon garland" },
  semiarco_asimetrico: { id: "semiarco_asimetrico", nombre: "Semiarco orgánico", descripcion: "Semiarco de contorno irregular, más grueso en una parte.", tipoBase: "semiarco", tiposAdmitidos: ["semiarco"], forma: "asimetrica", sustantivoEn: "asymmetrical one-sided curved organic balloon garland", geometria: { anchoFinalBanda: 0.4 } },
  columna: { id: "columna", nombre: "Columna", descripcion: "Torre recta de globos.", tipoBase: "columna", tiposAdmitidos: ["columna"], forma: "simetrica", sustantivoEn: "balloon column" },
  columna_asimetrica: { id: "columna_asimetrica", nombre: "Columna orgánica", descripcion: "Columna de contorno irregular, con racimos a un lado.", tipoBase: "columna", tiposAdmitidos: ["columna"], forma: "asimetrica", sustantivoEn: "balloon column" },
  columna_no_densa: { id: "columna_no_densa", nombre: "Columna no densa", descripcion: "Columna ligera, con espacios entre los globos.", tipoBase: "columna", tiposAdmitidos: ["columna"], forma: "simetrica", densidades: ["sencilla"], sustantivoEn: "balloon column" },
  pared_densa: { id: "pared_densa", nombre: "Pared de globos densa", descripcion: "Fondo completo de globos, sin huecos.", tipoBase: "pared", tiposAdmitidos: ["pared"], forma: "simetrica", densidades: ["media", "lujosa"], sustantivoEn: "dense balloon wall installation" },
  pared_no_densa: { id: "pared_no_densa", nombre: "Pared de globos no densa", descripcion: "Fondo de globos ligero, deja ver la pared.", tipoBase: "pared", tiposAdmitidos: ["pared"], forma: "organica", densidades: ["sencilla"], sustantivoEn: "airy balloon wall installation" },
  pared_organica: { id: "pared_organica", nombre: "Pared orgánica", descripcion: "Fondo completo de globos con racimos irregulares y borde vivo.", tipoBase: "pared", tiposAdmitidos: ["pared"], forma: "asimetrica", densidades: ["media", "lujosa"], sustantivoEn: "asymmetrical organic balloon wall installation" },
  guirnalda: { id: "guirnalda", nombre: "Guirnalda", descripcion: "Tira orgánica de globos sobre una superficie o el piso.", tipoBase: "guirnalda", tiposAdmitidos: ["guirnalda"], forma: "organica", sustantivoEn: "organic balloon garland", geometria: {
    eje: "largo",
    formas: {
      recta: { factorPerfil: 1, conCaida: false },
      curva: { factorPerfil: 1, conCaida: false },
      ondulada: { factorPerfil: 1, conCaida: false },
      u_invertida: { factorPerfil: 1, conCaida: true },
      arco_caido: { factorPerfil: 1, conCaida: true },
    },
  } },
  centro_mesa: { id: "centro_mesa", nombre: "Centro de mesa con globos", descripcion: "Arreglo bajo de globos sobre una mesa.", tipoBase: "centro_mesa", tiposAdmitidos: ["centro_mesa"], forma: "libre", sustantivoEn: "small balloon cluster centerpiece" },
  bouquet: { id: "bouquet", nombre: "Bouquet de globos", descripcion: "Ramillete de globos atados que flota o se apoya en un peso.", tipoBase: "kit", tiposAdmitidos: ["kit"], forma: "libre", sustantivoEn: "balloon bouquet", unidadesMinimasPorInstancia: 5 },
  figura: { id: "figura", nombre: "Figura con globos", descripcion: "Figura armada con globos (animal, número, personaje).", tipoBase: "kit", tiposAdmitidos: ["kit", "escultura"], forma: "libre", sustantivoEn: "balloon sculpture figure", unidadesMinimasPorInstancia: 20 },
  aro_circular: { id: "aro_circular", nombre: "Aro circular", descripcion: "Marco redondo cubierto de globos.", tipoBase: "arco", tiposAdmitidos: ["arco"], forma: "circular", sustantivoEn: "circular balloon hoop", geometria: { eje: "circunferencia" } },
  techo_globos: { id: "techo_globos", nombre: "Techo de globos", descripcion: "Globos suspendidos que cubren el techo.", tipoBase: "guirnalda", tiposAdmitidos: ["guirnalda"], forma: "libre", ubicacion: "techo", sustantivoEn: "ceiling balloon installation" },
  // F7-3 (2026-10-06): el análisis veía un `cluster` separado del suelo y el chat solo tenía «bouquet», que FLUX
  // pinta con helio y cintas. El corpus del LoRA dice «balloon cluster» (33) y «cluster of … mounted on the wall».
  racimo_pared: { id: "racimo_pared", nombre: "Racimo de pared", descripcion: "Grupo orgánico de globos de varios tamaños fijado a la pared, sin base, sin peso y sin cintas.", tipoBase: "kit", tiposAdmitidos: ["kit"], forma: "libre", sustantivoEn: "balloon cluster mounted on the wall", unidadesMinimasPorInstancia: 8 },
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
export function incoherenciasEstructuraOficial(estructura: { estructura_oficial?: string; tipo: string; densidad: string; ubicacion?: string }): Array<{ campo: "estructura_oficial" | "tipo" | "densidad" | "ubicacion"; mensaje: string }> {
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
  // Sin `ubicacion` (una consulta que no la lleva, como `estimar-conteo.v1`) no hay nada que comparar: igual que el JSON Schema exportado.
  if (estructura.ubicacion !== undefined && oficial.ubicacion === "techo" && !["techo", "techo_multipunto"].includes(estructura.ubicacion)) {
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
  if (/\bracimo de pared|\bracimo_pared|\bwall cluster/.test(nombre)) return oficial("racimo_pared");
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
      // Una pared puede ser densa y orgánica a la vez: cubre todo el fondo con
      // racimos irregulares. Sin esta rama caía en `pared_densa`, que es
      // simétrica, y el prompt de imagen pedía un muro plano.
      if (asimetrica || /\borg[áa]nic/.test(nombre)) return oficial("pared_organica");
      return noDensa && !densa ? oficial("pared_no_densa") : oficial("pared_densa");
    case "guirnalda":
      return oficial("guirnalda");
    case "centro_mesa":
      return oficial("centro_mesa");
    default:
      return undefined;
  }
}

/**
 * Sella en el plan la estructura oficial que cada pieza ya es, para la pieza que no la declaró.
 *
 * **Por qué aquí y no en Python.** La inferencia por tipo, densidad y nombre tiene un dueño, esta función de
 * arriba (`identificarEstructuraOficial`), y Python no la tiene: solo lee `estructura_oficial`. Sin el campo,
 * la confirmación armaba un aro circular como un arco y un techo de globos como una guirnalda —el `tipo` de los
 * dos es el de su primitiva—, mientras la tarjeta los llamaba «Aro circular» y «Techo de globos». Portarla
 * habría sido mantener la misma regla en dos lenguajes; sellarla antes de confirmar la deja en el plan, que
 * es lo que Python lee (`_pieza_del_plan`, `_armado_del_motor`, el dibujo esquemático) y lo que `plan_hash`
 * cubre: lo que se aprueba es exactamente la pieza que se arma.
 *
 * Solo completa: una oficial declarada manda siempre, y una inferida que el contrato rechazaría
 * (`incoherenciasEstructuraOficial`: un «techo de globos» de tipo `pared`, una «pared no densa» de densidad
 * media) no se sella; la pieza sigue como venía. Un plan que no cambia se devuelve tal cual.
 *
 * Solo para planes nuevos, al confirmar (`registro-herramientas.ts`): sellar uno ya aprobado cambiaría su
 * `plan_hash` y rompería su aprobación.
 */
export function sellarEstructurasOficiales<T extends PlanDecoracion>(plan: T): T {
  let cambiado = false;
  const estructuras = plan.estructuras.map((estructura) => {
    if (estructura.estructura_oficial !== undefined) return estructura;
    const oficial = identificarEstructuraOficial(estructura);
    if (oficial === undefined) return estructura;
    if (incoherenciasEstructuraOficial({ ...estructura, estructura_oficial: oficial.id }).length > 0) return estructura;
    cambiado = true;
    return { ...estructura, estructura_oficial: oficial.id };
  });
  return cambiado ? { ...plan, estructuras } : plan;
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

/** Resumen informativo para el cliente, ej. "Semiarco orgánico · a la izquierda · 1,8 m de alto". */
export function resumenEstructuraParaCliente(estructura: EstructuraPlanLigera & { altoM?: number }): string {
  const oficial = identificarEstructuraOficial(estructura);
  const partes: string[] = [oficial?.nombre ?? estructura.nombre ?? estructura.tipo];
  const ubicacion = estructura.ubicacion ? UBICACION_PARA_CLIENTE[estructura.ubicacion] : undefined;
  if (ubicacion) partes.push(ubicacion);
  if (estructura.altoM !== undefined) partes.push(`${String(Number(estructura.altoM.toFixed(2))).replace(".", ",")} m de alto`);
  return partes.join(" · ");
}

/** Repeticiones que usa el ejemplo de `unidades_declaradas`. */
const REPETICIONES_EJEMPLO = 2;

/**
 * Ejemplo de `unidades_declaradas` para la herramienta y el prompt, derivado de
 * la tabla (mínimo por pieza × repeticiones). Vive aquí para que el mínimo
 * tenga un solo dueño: `unidadesMinimasPorInstancia`, que es el mismo que
 * aplica `validarUnidadesDeclaradas` (restricciones.ts).
 */
export const EJEMPLO_UNIDADES_DECLARADAS = Object.values(ESTRUCTURAS_OFICIALES)
  .flatMap((estructura) => estructura.unidadesMinimasPorInstancia === undefined
    ? []
    : [`${estructura.nombre} con repeticiones ${REPETICIONES_EJEMPLO} → unidades_declaradas ${estructura.unidadesMinimasPorInstancia * REPETICIONES_EJEMPLO} o más (${estructura.unidadesMinimasPorInstancia} por pieza)`])
  .join("; ");

/**
 * Guía para el modelo del chat: qué estructuras existen y cómo expresarlas en
 * el plan actual (tipo + densidad + nombre con la etiqueta oficial).
 */
export const GUIA_ESTRUCTURAS_OFICIALES = `

ESTRUCTURAS OFICIALES
Solo diseña con estas estructuras. En confirmar_plan_decoracion pon en cada estructura estructura_oficial con el id indicado, el tipo indicado, una densidad admitida cuando se indique, y empieza el nombre con su etiqueta oficial (ej. "Semiarco orgánico derecho"):
${Object.values(ESTRUCTURAS_OFICIALES).map((estructura) => `- ${estructura.nombre} (estructura_oficial ${estructura.id}): tipo ${estructura.tipoBase}${estructura.densidades ? `, densidad ${estructura.densidades.join(" o ")}` : ""}${estructura.ubicacion ? `, ubicación ${estructura.ubicacion}` : ""}. ${estructura.descripcion}`).join("\n")}
- Racimo de pared frente a bouquet: un grupo de globos de varios tamaños fijado a la pared, sin base, sin peso y sin cintas (la foto lo describe como «cluster» separado del suelo) es un Racimo de pared, nunca un bouquet.
- Bouquet, Figura con globos y Racimo de pared no tienen geometría calculada: indica variant_id y unidades_declaradas. unidades_declaradas es el total de globos de la pieza sumando sus repeticiones (no el número de figuras): al menos ${Object.values(ESTRUCTURAS_OFICIALES).filter((estructura) => estructura.unidadesMinimasPorInstancia).map((estructura) => `${estructura.unidadesMinimasPorInstancia} globos por ${estructura.nombre}`).join(" y ")} y nunca menos unidades que materiales.
- Orgánica significa un contorno irregular o un lado más cargado, que se adapta al espacio o imita formas de la naturaleza; dos piezas separadas de alturas distintas son dos estructuras, no una orgánica.`;

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

export type FormasEstructurasOficialesContrato = Readonly<Record<EstructuraOficialId, FormaEstructura>>;

/**
 * Las formas que **ningún motor de globos produce**. Un motor arma una banda,
 * una torre o una tira: sabe hacer una curva simétrica, una asimétrica y un
 * contorno orgánico. Un aro cerrado y una pieza de forma libre (un techo, un
 * centro de mesa, un bouquet, una figura) no son ninguna de esas tres cosas, y
 * se cuentan con la fórmula (el aro, con su `π × diámetro`).
 *
 * Único dueño de la regla: se exporta al contrato (`x-formas-sin-motor`) para
 * que `services/ai-api/app/plan.py` la lea de aquí en vez de repetirla.
 */
export const FORMAS_SIN_MOTOR: readonly FormaEstructura[] = ["circular", "libre"];

/**
 * Las estructuras oficiales que no arma ningún motor, derivadas de la tabla.
 * Hoy: `aro_circular`, `techo_globos`, `centro_mesa`, `bouquet` y `figura`.
 *
 * Importa porque ningún motor mira `estructura_oficial`: la puerta pregunta por
 * el `tipo`, y el `tipoBase` de un aro es `arco` y el de un techo `guirnalda`.
 * Una pieza de esta lista no lleva armado de motor, así que su tarjeta no monta
 * el bloque de un arco ni el de una guirnalda aunque el plan traiga uno viejo.
 */
export const OFICIALES_SIN_MOTOR: ReadonlySet<EstructuraOficialId> = new Set(
  Object.values(ESTRUCTURAS_OFICIALES)
    .filter((estructura) => FORMAS_SIN_MOTOR.includes(estructura.forma))
    .map((estructura) => estructura.id),
);

/**
 * Tabla de `forma` por variante, en la forma que se exporta al contrato para
 * Python. Esta tabla sigue siendo la única fuente: Python la lee de
 * `x-formas-estructuras-oficiales`, igual que lee la geometría.
 *
 * La necesita el resolutor para saber **qué piezas no arma ningún motor**: un
 * oficial de forma `circular` o `libre` no es una forma que un motor de globos
 * produzca (son `aro_circular`, `techo_globos`, `centro_mesa`, `bouquet` y
 * `figura`), y su conteo es el de la fórmula —el aro, por ejemplo, se cuenta
 * con `π × diámetro`—. Sin esto, el armado se elegía solo por `tipo` y un aro
 * circular (tipo base `arco`) recibía el armado de un arco: se contaba y se
 * dibujaba como otra pieza.
 */
export function formasEstructurasOficiales(): FormasEstructurasOficialesContrato {
  return Object.fromEntries(
    Object.values(ESTRUCTURAS_OFICIALES).map((estructura) => [estructura.id, estructura.forma]),
  ) as FormasEstructurasOficialesContrato;
}
