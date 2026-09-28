import type { PythonPlanArmadoGuirnaldaLinea } from "@/lib/ia/nucleo/python-adapter";
import { ArmadoGuirnaldaResueltoSchema, type ArmadoGuirnaldaResuelto, type ArmadoGuirnaldaV1 } from "./armado-guirnalda";
import { OpcionesArmadoGuirnaldaSchema, type OpcionesArmadoGuirnalda } from "./opciones-armado-guirnalda";
import { FalloPlanArmado, publicar } from "./peticion-armado";
import type { LineaMaterial, PlanResuelto } from "./resuelto";

/**
 * Vista previa del editor de armado de guirnaldas (ADR-0032, E6): el
 * navegador manda el armado declarativo (o `null` para pedir la receta) a
 * /api/plan-armado-guirnalda con las líneas resueltas de la pieza, y recibe
 * la leyenda, los racimos, el relleno, los remates, los insumos y los textos
 * que escribe Python, más lo que el editor puede ofrecer (`opciones`). Aquí
 * no se cuenta ni se valida nada del armado: la respuesta se valida con el
 * mismo esquema que viaja en `plan_resuelto.armados_guirnalda`.
 *
 * Los errores son los de la vista previa del bouquet (`FalloPlanArmado`): un
 * armado que Python rechaza (`armado_invalido`) trae `motivo` estable y la
 * frase de Python para el decorador. El rechazo no trae opciones: el editor
 * conserva las últimas que conoció. Sin React.
 */

export const RESPALDO_VISTA_ARMADO_GUIRNALDA = "No pude dibujar la guirnalda. Intenta de nuevo en un momento.";

export type LineaVistaGuirnalda = PythonPlanArmadoGuirnaldaLinea;
export type { OpcionesArmadoGuirnalda };

export type PeticionVistaArmadoGuirnalda = {
  plan: PlanResuelto["plan"];
  estructura_id: string;
  /** `null` pide la receta de Python para la pieza. */
  armado_guirnalda: ArmadoGuirnaldaV1 | null;
  /** Las líneas resueltas de la pieza: nombran cada código como al resolver, nunca cuentan. */
  lineas?: readonly LineaVistaGuirnalda[];
};

/** La vista previa con lo que Python admite para la pieza. */
export type VistaArmadoGuirnalda = { armado: ArmadoGuirnaldaResuelto; opciones: OpcionesArmadoGuirnalda };

/** Solo los campos del contrato: la ruta es estricta y una `LineaMaterial` trae muchos más. */
export function lineaVistaGuirnalda(linea: LineaVistaGuirnalda | LineaMaterial): LineaVistaGuirnalda {
  return {
    product_id: linea.product_id,
    variant_id: linea.variant_id,
    color: linea.color,
    ...(linea.acabado === undefined ? {} : { acabado: linea.acabado }),
    unidades: linea.unidades,
    ...(linea.diam_pulg === undefined ? {} : { diam_pulg: linea.diam_pulg }),
    ...(linea.tamano_codigo === undefined ? {} : { tamano_codigo: linea.tamano_codigo }),
  };
}

function cuerpoVista(cuerpo: PeticionVistaArmadoGuirnalda): PeticionVistaArmadoGuirnalda {
  return cuerpo.lineas === undefined ? cuerpo : { ...cuerpo, lineas: cuerpo.lineas.map(lineaVistaGuirnalda) };
}

/**
 * POST a /api/plan-armado-guirnalda. Devuelve el `ArmadoGuirnaldaResuelto`
 * validado de la estructura pedida y las opciones de la pieza. Una
 * cancelación se relanza tal cual; cualquier otro fallo es un `FalloPlanArmado`.
 */
export async function pedirVistaArmadoGuirnalda(
  cuerpo: PeticionVistaArmadoGuirnalda,
  opciones: { signal?: AbortSignal; fetcher?: typeof fetch; respaldo?: string } = {},
): Promise<VistaArmadoGuirnalda> {
  const respaldo = opciones.respaldo ?? RESPALDO_VISTA_ARMADO_GUIRNALDA;
  const datos = await publicar("/api/plan-armado-guirnalda", cuerpoVista(cuerpo), respaldo, opciones);
  const objeto = typeof datos === "object" && datos !== null ? (datos as Record<string, unknown>) : {};
  const armado = ArmadoGuirnaldaResueltoSchema.safeParse(objeto.armado);
  const admitidas = OpcionesArmadoGuirnaldaSchema.safeParse(objeto.opciones);
  // Una respuesta que no es un armado resuelto, o que es de otra estructura, no se dibuja.
  if (!armado.success || !admitidas.success || armado.data.estructura_id !== cuerpo.estructura_id) {
    throw new FalloPlanArmado(respaldo, { cause: armado.success ? admitidas.error : armado.error });
  }
  return { armado: armado.data, opciones: admitidas.data };
}
