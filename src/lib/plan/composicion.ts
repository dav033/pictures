/**
 * Fuente única del vocabulario compositivo (PLAN-COMPOSICION-RICA-V001.md §6.2).
 *
 * `tipos.ts`, `lora-semantics.ts`, `lora/schema.ts`, herramientas y tests
 * importan estos enums de aquí cuando representan el mismo concepto. No se
 * mantiene una segunda lista manual de los mismos valores en ningún otro
 * archivo: si un consumidor necesita un subconjunto (por ejemplo, el enum
 * legado de Plan 1.0), se deriva programáticamente de las listas de abajo.
 *
 * Este archivo también reúne los invariantes puros de Plan 1.1 (targets,
 * ciclos, cobertura de partes) para que `tipos.ts`, `hash.ts` y
 * `coherencia.ts` compartan la misma lógica en vez de reimplementarla.
 */

// ---------------------------------------------------------------------------
// Tipos de estructura
// ---------------------------------------------------------------------------

/** Vocabulario completo de Plan 1.1. `escultura` es la única clase nueva. */
export const TIPOS_ESTRUCTURA = [
  "arco", "semiarco", "guirnalda", "columna", "pared",
  "centro_mesa", "backdrop", "kit", "accesorio", "escultura",
] as const;
export type TipoEstructura = typeof TIPOS_ESTRUCTURA[number];

/** Subconjunto aceptado por Plan 1.0: `escultura` no existía todavía. */
export const TIPOS_ESTRUCTURA_1_0 = TIPOS_ESTRUCTURA.filter((tipo): tipo is Exclude<TipoEstructura, "escultura"> => tipo !== "escultura");

/** Tipos que el backend mide por geometría (`src/lib/medidas/geometria.ts`). */
export const TIPOS_ESTRUCTURA_GEOMETRICOS = [
  "arco", "semiarco", "guirnalda", "columna", "pared", "centro_mesa",
] as const;
export type TipoEstructuraGeometrico = typeof TIPOS_ESTRUCTURA_GEOMETRICOS[number];

export function esTipoGeometrico(tipo: TipoEstructura): tipo is TipoEstructuraGeometrico {
  return (TIPOS_ESTRUCTURA_GEOMETRICOS as readonly string[]).includes(tipo);
}

export function esEscultura(tipo: TipoEstructura): tipo is "escultura" {
  return tipo === "escultura";
}

/**
 * Alias que un brief o un LLM puede escribir para pedir una escultura sin
 * usar la palabra canónica. Normalizan siempre a `escultura`; nunca crean un
 * tipo estructural nuevo (PLAN-COMPOSICION-RICA-V001.md §5.1).
 */
export const ALIASES_ESCULTURA: readonly string[] = [
  "figura", "personaje", "animal", "numero", "número", "letra",
  "forma tematica", "forma temática", "escultura de globos",
];

/** Normaliza un texto de tipo estructural a un `TipoEstructura` canónico, o `null` si no coincide con nada conocido. */
export function normalizarTipoEstructura(valor: string): TipoEstructura | null {
  const normalizado = valor.trim().toLowerCase();
  if ((TIPOS_ESTRUCTURA as readonly string[]).includes(normalizado)) return normalizado as TipoEstructura;
  if (ALIASES_ESCULTURA.includes(normalizado)) return "escultura";
  return null;
}

// ---------------------------------------------------------------------------
// Ubicaciones
// ---------------------------------------------------------------------------

/** Ubicaciones comunes a Plan 1.0 y 1.1 (ninguna nombra una estructura). */
const UBICACIONES_COMUNES = [
  "fondo_pared", "sobre_mesa_principal", "lateral_izquierdo", "lateral_derecho",
  "piso_frontal", "mesas_invitados", "entrada", "techo",
] as const;

/** Plan 1.0: conserva `arco_central`, con bboxes fijos de layout. */
export const UBICACIONES_1_0 = [...UBICACIONES_COMUNES, "arco_central"] as const;
export type Ubicacion1_0 = typeof UBICACIONES_1_0[number];

/**
 * Plan 1.1: `arco_central` se sustituye por `zona_central` (una región del
 * espacio no debe llevar el nombre de una estructura) y se añaden regiones
 * que rompen el eje focal + dos laterales.
 */
export const UBICACIONES_1_1_NUEVAS = [
  "zona_central", "fachada", "pared_lateral", "alrededor_mobiliario",
  "vegetacion", "techo_multipunto", "recorrido_suelo", "esquina",
] as const;
export const UBICACIONES_1_1 = [...UBICACIONES_COMUNES, ...UBICACIONES_1_1_NUEVAS] as const;
export type Ubicacion1_1 = typeof UBICACIONES_1_1[number];

/** Unión de ambos vocabularios, para consumidores genéricos como `ubicaciones.ts`. */
export type Ubicacion = Ubicacion1_0 | Ubicacion1_1;
export const UBICACIONES: readonly Ubicacion[] = [...new Set<Ubicacion>([...UBICACIONES_1_0, ...UBICACIONES_1_1])];

// ---------------------------------------------------------------------------
// Anclas del espacio
// ---------------------------------------------------------------------------

export const TIPOS_ANCLA_ESPACIO = [
  "puerta", "pared", "mesa", "arbol", "techo", "piso", "fachada", "esquina", "mobiliario_existente",
] as const;
export type TipoAnclaEspacio = typeof TIPOS_ANCLA_ESPACIO[number];

export const PROCEDENCIAS_ANCLA = ["cliente", "foto_espacio", "foto_referencia"] as const;
export type ProcedenciaAncla = typeof PROCEDENCIAS_ANCLA[number];

export const MAX_ANCLAS_ESPACIO = 16;

// ---------------------------------------------------------------------------
// Relaciones físicas
// ---------------------------------------------------------------------------

export const RELACIONES_FISICAS = [
  "enmarcar", "trepar_por", "envolver", "colgar_de", "derramarse_sobre",
  "montar_sobre", "apoyarse_en", "conectar_con", "quedar_detras_de", "quedar_debajo_de",
] as const;
export type RelacionFisicaTipo = typeof RELACIONES_FISICAS[number];

export const DISTRIBUCIONES_ESPACIALES = [
  "continua", "asimetrica", "en_racimos", "multipunto", "alturas_escalonadas", "recorrido",
] as const;
export type DistribucionEspacial = typeof DISTRIBUCIONES_ESPACIALES[number];

export const PRIORIDADES_RELACION = ["primaria", "secundaria"] as const;
export type PrioridadRelacion = typeof PRIORIDADES_RELACION[number];

/**
 * Anclas de espacio que satisfacen cada relación cuando el target es
 * `ancla_espacio` (PLAN-COMPOSICION-RICA-V001.md §6.5). Una relación sin
 * entrada aquí no restringe tipo de ancla. Cuando el target es
 * `elemento_plan` (una estructura o prop ya aprobado), se confía en que el
 * plan lo aprobó como capaz de soportar/enmarcar/recibir: no hay una lista
 * de "tipos de elemento que soportan" porque el catálogo no la declara.
 */
export const ANCLAS_REQUERIDAS_POR_RELACION: Partial<Record<RelacionFisicaTipo, readonly TipoAnclaEspacio[]>> = {
  colgar_de: ["techo", "arbol"],
  derramarse_sobre: ["piso", "mesa", "mobiliario_existente"],
  trepar_por: ["pared", "fachada"],
  enmarcar: ["puerta", "fachada", "mesa"],
};

/** Distribuciones que solo tienen sentido acompañando ciertas relaciones. */
export const DISTRIBUCIONES_COMPATIBLES_POR_RELACION: Partial<Record<DistribucionEspacial, readonly RelacionFisicaTipo[]>> = {
  alturas_escalonadas: ["colgar_de", "montar_sobre"],
  recorrido: ["conectar_con", "derramarse_sobre"],
};

export type RelacionFisicaTarget =
  | { kind: "ancla_espacio"; id: string }
  | { kind: "elemento_plan"; id: string };

export type RelacionFisicaInput = {
  relacion: RelacionFisicaTipo;
  target: RelacionFisicaTarget;
  prioridad: PrioridadRelacion;
  distribucion?: DistribucionEspacial;
};

/**
 * Invariantes locales de las relaciones de UN elemento: cardinalidad de
 * prioridad y compatibilidad relación/distribución. No valida existencia de
 * targets ni ciclos — eso requiere el grafo completo del plan
 * (`validarGrafoRelaciones`).
 */
export function validarRelacionesDeElemento(relaciones: readonly RelacionFisicaInput[]): string[] {
  const errores: string[] = [];
  const primarias = relaciones.filter((relacion) => relacion.prioridad === "primaria").length;
  const secundarias = relaciones.filter((relacion) => relacion.prioridad === "secundaria").length;
  if (primarias > 1) errores.push("Máximo una relación primaria por elemento.");
  if (secundarias > 1) errores.push("Máximo una relación secundaria por elemento.");
  for (const relacion of relaciones) {
    if (relacion.distribucion) {
      const compatibles = DISTRIBUCIONES_COMPATIBLES_POR_RELACION[relacion.distribucion];
      if (compatibles && !compatibles.includes(relacion.relacion)) {
        errores.push(`La distribución "${relacion.distribucion}" no acompaña a "${relacion.relacion}".`);
      }
    }
  }
  return errores;
}

/** ¿Un ancla de este tipo puede ser target de esta relación? `true` si la relación no restringe tipo de ancla. */
export function anclaSatisfaceRelacion(relacion: RelacionFisicaTipo, tipoAncla: TipoAnclaEspacio): boolean {
  const requeridas = ANCLAS_REQUERIDAS_POR_RELACION[relacion];
  return !requeridas || requeridas.includes(tipoAncla);
}

export type NodoConRelaciones = { id: string; relaciones: readonly RelacionFisicaInput[] };

/**
 * Valida el grafo completo de relaciones de un plan: todo target existe
 * (ancla o elemento), y las relaciones cuyo target es otro elemento del plan
 * no forman un ciclo de profundidad (A cuelga de B que cuelga de A).
 */
export function validarGrafoRelaciones(
  nodos: readonly NodoConRelaciones[],
  idsAnclasValidas: ReadonlySet<string>,
): string[] {
  const errores: string[] = [];
  const idsElementos = new Set(nodos.map((nodo) => nodo.id));
  const aristas: Array<[string, string]> = [];

  for (const nodo of nodos) {
    for (const relacion of nodo.relaciones) {
      if (relacion.target.kind === "ancla_espacio") {
        if (!idsAnclasValidas.has(relacion.target.id)) {
          errores.push(`${nodo.id}: la relación "${relacion.relacion}" apunta a un ancla inexistente (${relacion.target.id}).`);
        }
      } else {
        if (!idsElementos.has(relacion.target.id)) {
          errores.push(`${nodo.id}: la relación "${relacion.relacion}" apunta a un elemento inexistente (${relacion.target.id}).`);
        } else {
          aristas.push([nodo.id, relacion.target.id]);
        }
      }
    }
  }

  if (detectarCiclo(aristas)) {
    errores.push("Las relaciones entre elementos del plan forman un ciclo de profundidad.");
  }

  return errores;
}

/** DFS genérico de detección de ciclos sobre una lista de aristas dirigidas. */
export function detectarCiclo(aristas: ReadonlyArray<readonly [string, string]>): boolean {
  const adyacencia = new Map<string, string[]>();
  for (const [origen, destino] of aristas) {
    if (!adyacencia.has(origen)) adyacencia.set(origen, []);
    adyacencia.get(origen)!.push(destino);
  }
  const VISITANDO = 1;
  const VISITADO = 2;
  const estado = new Map<string, typeof VISITANDO | typeof VISITADO>();

  function visitar(nodo: string): boolean {
    estado.set(nodo, VISITANDO);
    for (const vecino of adyacencia.get(nodo) ?? []) {
      const estadoVecino = estado.get(vecino);
      if (estadoVecino === VISITANDO) return true;
      if (estadoVecino !== VISITADO && visitar(vecino)) return true;
    }
    estado.set(nodo, VISITADO);
    return false;
  }

  for (const nodo of adyacencia.keys()) {
    if (!estado.has(nodo) && visitar(nodo)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Escultura: BOM exacto
// ---------------------------------------------------------------------------

export const CATEGORIAS_SUJETO_ESCULTURA = [
  "animal", "personaje", "numero", "letra", "objeto", "simbolo", "forma_tematica",
] as const;
export type CategoriaSujetoEscultura = typeof CATEGORIAS_SUJETO_ESCULTURA[number];

export const FUNCIONES_PARTE_ESCULTURA = [
  "volumen_principal", "extremidad", "detalle", "base", "conexion",
] as const;
export type FuncionParteEscultura = typeof FUNCIONES_PARTE_ESCULTURA[number];

export type ParteEsculturaInput = {
  parte_id: string;
  variant_ids: readonly string[];
};

export type MaterialEsculturaInput = {
  variant_id?: string;
  unidades_por_instancia?: number;
};

/**
 * Invariantes de BOM<->partes de una escultura (PLAN-COMPOSICION-RICA-V001.md
 * §6.6): toda variante del BOM participa en al menos una parte, y toda
 * variante referenciada por una parte existe en el BOM. No valida shape de
 * zod (eso vive en `tipos.ts`); esto es la regla de negocio pura.
 */
export function validarCoberturaEsculturaBom(materiales: readonly MaterialEsculturaInput[], partes: readonly ParteEsculturaInput[]): string[] {
  const errores: string[] = [];
  const variantesBom = new Set(materiales.flatMap((material) => material.variant_id ? [material.variant_id] : []));
  const variantesUsadasPorPartes = new Set(partes.flatMap((parte) => parte.variant_ids));

  for (const variantId of variantesBom) {
    if (!variantesUsadasPorPartes.has(variantId)) {
      errores.push(`La variante ${variantId} del BOM no participa en ninguna parte de la escultura.`);
    }
  }
  for (const parte of partes) {
    for (const variantId of parte.variant_ids) {
      if (!variantesBom.has(variantId)) {
        errores.push(`La parte ${parte.parte_id} referencia la variante ${variantId}, que no está en el BOM de materiales.`);
      }
    }
  }
  return errores;
}
