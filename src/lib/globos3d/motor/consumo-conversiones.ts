import type { z } from "zod";
import type { PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { EstructuraPlan, PlanDecoracion } from "@/lib/plan/tipos";

/**
 * **Los campos del plan y de la propuesta que las conversiones a espec leen, y los que ignoran a propósito.** Es el
 * mismo registro de huérfanos que `consumo.ts`, del lado de la entrada: un campo nuevo de `EstructuraPlan`,
 * `PlanDecoracion` o de la propuesta no compila hasta que alguien decida si la espec lo usa o por qué no.
 */
type Propuesta = z.infer<typeof PropuestaComposicionSchema>;
type Uso = "usado" | { ignorado: string };

const MANDOS_DE_PYTHON = "Mandos del diseñador de Python (cima, curva, ondulación, salientes, racimo): el motor 3D arma con sus propias semillas y proporciones.";

export const CAMPOS_ESTRUCTURA_PLAN = {
  estructura_id: "usado",
  nombre: "usado",
  tipo: { ignorado: "La primitiva la dice la estructura oficial, que sí se lee." },
  rol_escena: { ignorado: "El peso visual de la pieza en la escena lo decide el layout, por lugar." },
  ubicacion: "usado",
  medidas: "usado",
  repeticiones: "usado",
  densidad: "usado",
  mezcla: "usado",
  materiales: "usado",
  unidades_declaradas: "usado",
  porque: { ignorado: "Texto explicativo para el cliente; la espec no lo guarda." },
  variant_overrides: { ignorado: "Cambia una variante por talla; el motor reparte las tallas por proporción y no elige variantes." },
  referencia_element_id: { ignorado: "Enlace con la foto de referencia, que el motor 3D no lee." },
  estructura_oficial: "usado",
  forma: "usado",
  colores_referencia: { ignorado: "Colores dominantes de la foto de referencia; los de la pieza salen de sus materiales." },
  patron_color: { ignorado: "Dónde va cada color (ADR-0028): el motor reparte por peso, no por zonas." },
  armado_bouquet: { ignorado: "Armado del bouquet por niveles de Python: el ramo del motor es un ramo de helio sencillo." },
  armado_guirnalda: { ignorado: MANDOS_DE_PYTHON },
  armado_arco: { ignorado: MANDOS_DE_PYTHON },
  armado_columna: { ignorado: "Solo se lee el remate (el globo grande de arriba); " + MANDOS_DE_PYTHON },
  armado_guirnalda_organica: { ignorado: MANDOS_DE_PYTHON },
  armado_columna_organica: { ignorado: MANDOS_DE_PYTHON },
  armado_arco_organico: { ignorado: MANDOS_DE_PYTHON },
  flores: "usado",
} as const satisfies Record<keyof EstructuraPlan, Uso>;

export const CAMPOS_PLAN = {
  plan_version: { ignorado: "Versión del contrato de Python." },
  plan_id: { ignorado: "Identidad del plan de Python; la espec tiene su propio hash." },
  concepto: { ignorado: "Título, descripción y paleta del plan: la paleta de cada pieza sale de sus materiales." },
  espacio: { ignorado: "El tipo de espacio no cambia las medidas: ya vienen en cada estructura." },
  estructuras: "usado",
  supuestos: { ignorado: "Frases de Python sobre cómo resolvió; no son datos." },
  restricciones: { ignorado: "Restricciones de conversación (presupuesto, tallas): se aplican antes, al elegir el plan." },
  referencia_omitida: { ignorado: "Elementos de la foto que el plan no cubrió." },
} as const satisfies Record<keyof PlanDecoracion, Uso>;

export const CAMPOS_PROPUESTA = {
  frase: { ignorado: "Texto para el cliente." },
  colores: "usado",
  piezas: "usado",
} as const satisfies Record<keyof Propuesta, Uso>;

export const CAMPOS_PIEZA_PROPUESTA = {
  estructura: "usado",
  cantidad: "usado",
  nombre: "usado",
  ubicacion: "usado",
  colores: "usado",
  medidas: "usado",
} as const satisfies Record<keyof Propuesta["piezas"][number], Uso>;
