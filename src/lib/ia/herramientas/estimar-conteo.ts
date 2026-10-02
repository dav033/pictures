import { z } from "zod";
import { EstimarConteoCandidatoV1Schema, EstimarConteoObjetivoV1Schema, ESTIMAR_CONTEO_MAX_CANDIDATOS, type EstimarConteoRequestV1 } from "@/lib/ia/contracts/domain-v1";
import { CLAVE_ARMADO, type TipoArmadoMotor } from "@/lib/plan/armado-estructura-ia";
import { incoherenciasEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { objetivoDelConteo } from "@/lib/ia/omoikane/prompt-sistema";
import type { ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import type { ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";

/**
 * La frontera de `estimar_conteo_globos` (ADR-0038): qué forma tienen que tener los argumentos del modelo
 * para que se ejecute, y cómo se traducen a la pregunta que se le hace a Python.
 *
 * Aquí **no se calcula ningún conteo**. Python es el único dueño de cuántos globos cuesta cada pieza, de si
 * pasa la puerta física, de la tolerancia y de qué variación de mandos acerca el total al objetivo
 * (`services/ai-api/app/estimar_conteo.py`); esto valida el borde y mapea. Tampoco hay aquí un valor de
 * partida, una tolerancia ni una fórmula: si apareciera una, habría un segundo dueño.
 *
 * Las restricciones de cada campo salen del contrato (`EstimarConteoCandidatoV1Schema`), no se repiten. Lo
 * único propio es `armado_de`: el modelo no pega el armado entero (es un objeto enorme que no podría
 * escribir sin errores), nombra la pieza que ya armó con `armar_estructura` y el servidor trae lo que
 * guardó en el turno.
 */

const candidato = EstimarConteoCandidatoV1Schema.shape;

export const ArgsEstimarConteoGlobosSchema = z
  .object({
    candidatos: z
      .array(
        z
          .object({
            etiqueta: candidato.etiqueta,
            tipo: candidato.tipo,
            estructura_oficial: candidato.estructura_oficial,
            medidas: candidato.medidas.optional(),
            densidad: candidato.densidad,
            mezcla: candidato.mezcla,
            colores: candidato.colores,
            repeticiones: candidato.repeticiones,
            /** El `estructura_id` de una pieza que `armar_estructura` ya validó en este turno. */
            armado_de: z.string().trim().min(1).max(160).optional(),
          })
          .strict()
          // La misma coherencia que el contrato: así el modelo recibe aquí qué corregir, no un rechazo de Python.
          .superRefine((value, ctx) => {
            for (const problema of incoherenciasEstructuraOficial(value)) {
              ctx.addIssue({ code: "custom", path: [problema.campo], message: problema.mensaje });
            }
          }),
      )
      .min(1)
      .max(ESTIMAR_CONTEO_MAX_CANDIDATOS),
    objetivo: EstimarConteoObjetivoV1Schema.optional(),
    /** De qué elemento de la foto sale el objetivo cuando no se manda `objetivo`. */
    referencia_element_id: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type ArgsEstimarConteoGlobos = z.infer<typeof ArgsEstimarConteoGlobosSchema>;

type ArmadoGuardado = { tipo: TipoArmadoMotor; armado: ArmadoArcoV1 | ArmadoColumnaV1 | ArmadoGuirnaldaOrganicaV1 };

export type ObjetivoDeLaEstimacion = {
  conteo: number;
  exacto: boolean;
  /** `modelo`: lo escribió quien llamó. `foto`: el conteo leído en la referencia, que Python tomó del blueprint. */
  origen: "modelo" | "foto";
  /** El elemento de la foto del que sale, cuando sale de la foto. */
  elemento?: string;
};

/**
 * El conteo de la foto como objetivo por defecto: el del elemento que el modelo nombre o, si no nombra
 * ninguno, el único elemento aprobado que trae un conteo que el prompt ya le presentó
 * (`objetivoDelConteo`, la misma regla de confianza y bandera). Con dos o más conteos y sin elemento
 * nombrado no se elige uno por el modelo: no hay objetivo y la respuesta lo dice.
 */
export function objetivoDeLaFoto(
  blueprint: ReferenceBlueprintV2 | undefined,
  elementoPedido?: string,
): { objetivo: ObjetivoDeLaEstimacion } | { ambiguo: string[] } | null {
  const elementos = (blueprint?.elements ?? []).filter((elemento) => elemento.approved);
  const conConteo = elementos
    .map((elemento) => ({ elemento: elemento.element_id, objetivo: objetivoDelConteo(elemento.appearance.conteo) }))
    .filter((par): par is { elemento: string; objetivo: { conteo: number; exacto: boolean } } => par.objetivo !== null);
  const elegido = elementoPedido === undefined
    ? conConteo.length === 1 ? conConteo[0] : undefined
    : conConteo.find((par) => par.elemento === elementoPedido);
  if (elegido) return { objetivo: { ...elegido.objetivo, origen: "foto", elemento: elegido.elemento } };
  return elementoPedido === undefined && conConteo.length > 1 ? { ambiguo: conConteo.map((par) => par.elemento) } : null;
}

export type ArmadoNoResuelto = { estructura_id: string; motivo: "no_guardado" | "tipo_distinto" };

/**
 * La pregunta para Python. Cada candidato lleva el armado que `armar_estructura` guardó para su
 * `armado_de`, en el campo del plan que le corresponde a su tipo; sin `armado_de`, ninguno. Un
 * `armado_de` que no existe en el turno o es de otro tipo no se manda: se devuelve para decírselo al modelo
 * en vez de estimar sin él, que daría un total que no es el de esa pieza.
 */
export function solicitudDeEstimacion(
  args: ArgsEstimarConteoGlobos,
  contexto: {
    armados: ReadonlyMap<string, ArmadoGuardado> | undefined;
    objetivo: { conteo: number; exacto: boolean } | undefined;
    tamanosObligatorios: readonly number[];
    medidasDelCliente: boolean;
  },
): { solicitud: Omit<EstimarConteoRequestV1, "schema_version"> } | { armadoNoResuelto: ArmadoNoResuelto } {
  const candidatos: EstimarConteoRequestV1["candidatos"] = [];
  for (const pedido of args.candidatos) {
    const { armado_de: armadoDe, medidas, ...resto } = pedido;
    const guardado = armadoDe === undefined ? undefined : contexto.armados?.get(armadoDe);
    if (armadoDe !== undefined && guardado === undefined) return { armadoNoResuelto: { estructura_id: armadoDe, motivo: "no_guardado" } };
    if (armadoDe !== undefined && guardado !== undefined && guardado.tipo !== pedido.tipo) {
      return { armadoNoResuelto: { estructura_id: armadoDe, motivo: "tipo_distinto" } };
    }
    candidatos.push({
      ...resto,
      medidas: medidas ?? {},
      ...(guardado === undefined ? {} : { [CLAVE_ARMADO[guardado.tipo]]: guardado.armado }),
    });
  }
  return {
    solicitud: {
      candidatos,
      ...(contexto.objetivo === undefined ? {} : { objetivo: { conteo: contexto.objetivo.conteo, exacto: contexto.objetivo.exacto } }),
      ...(contexto.tamanosObligatorios.length > 0 ? { tamanos_obligatorios: [...contexto.tamanosObligatorios] } : {}),
      medidas_del_cliente: contexto.medidasDelCliente,
    },
  };
}

/** Los errores de Zod en el formato que ya usan los demás resultados de herramienta. */
export function erroresDeEstimacion(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "estimacion"}: ${issue.message}`);
}
