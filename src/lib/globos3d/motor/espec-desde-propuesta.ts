import type { z } from "zod";
import type { BriefGuiado, MedidaCliente, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { nombresIndividuales, piezasIndividualesDePropuesta, recortarCantidades, type PiezaIndividual } from "@/lib/plan/piezas-individuales";
import { coloresDePalabras } from "./colores-espec";
import { MAX_COLORES_PIEZA, VERSION_ESPEC, type EspecClienteV1, type LugarEspec, type PiezaEspec } from "./espec-cliente-v1";
import { DENSIDAD_POR_DEFECTO, TAMANOS_POR_DEFECTO, UNIDADES_POR_DEFECTO, type MedidasEspec } from "./medidas-espec";

/**
 * **Propuesta → espec**, sin modelo y sin búsqueda en el catálogo: la propuesta ya trae las estructuras oficiales y los
 * colores en palabras del cliente; los códigos Sempertex salen de la tabla revisada (`colores-espec.ts`). Las medidas
 * son las de la pieza, las que dijo el cliente (`brief.medida`) o las de salón cerrado (`medidas-espec.ts`).
 */
type Propuesta = z.infer<typeof PropuestaComposicionSchema>;
type BriefParaEspec = Pick<BriefGuiado, "medida" | "estructura">;
export type ResultadoEspec = { espec: EspecClienteV1; avisos: string[] };

export const LUGAR_POR_OFICIAL: Partial<Record<EstructuraOficialId, LugarEspec>> = {
  semiarco: "fondo", semiarco_asimetrico: "fondo", guirnalda: "fondo", pared_densa: "fondo", pared_no_densa: "fondo", pared_organica: "fondo",
  techo_globos: "techo", bouquet: "mesa", centro_mesa: "mesa",
};
/** Las piezas cuya medida suelta («3 metros») es el alto; las demás, el ancho, y la guirnalda, el largo. */
const MIDE_POR_ALTO: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>(["columna", "columna_asimetrica", "columna_no_densa", "semiarco", "semiarco_asimetrico", "bouquet", "figura"]);
/** Las que el cliente vuelve orgánicas diciéndolo («arco orgánico»). */
const SE_VUELVEN_ORGANICAS: ReadonlySet<EstructuraOficialId> = new Set<EstructuraOficialId>(["arco", "columna", "guirnalda"]);

function lugarDe(oficial: EstructuraOficialId, ubicacion: PiezaIndividual["ubicacion"]): LugarEspec {
  if (ubicacion === "lateral_izquierdo") return "izquierda";
  if (ubicacion === "lateral_derecho") return "derecha";
  return LUGAR_POR_OFICIAL[oficial] ?? "centro";
}

function medidasDeCliente(oficial: EstructuraOficialId, medida: MedidaCliente): MedidasEspec {
  const explicitas: MedidasEspec = { ...(medida.ancho_m ? { anchoM: medida.ancho_m } : {}), ...(medida.alto_m ? { altoM: medida.alto_m } : {}), ...(medida.largo_m ? { largoM: medida.largo_m } : {}) };
  if (Object.keys(explicitas).length || !medida.metros) return explicitas;
  if (oficial === "guirnalda") return { largoM: medida.metros };
  return MIDE_POR_ALTO.has(oficial) ? { altoM: medida.metros } : { anchoM: medida.metros };
}

function medidasDePropuesta(medidas: NonNullable<Propuesta["piezas"][number]["medidas"]> | undefined): MedidasEspec {
  return { ...(medidas?.ancho_m ? { anchoM: medidas.ancho_m } : {}), ...(medidas?.alto_m ? { altoM: medidas.alto_m } : {}), ...(medidas?.largo_m ? { largoM: medidas.largo_m } : {}) };
}

/** Los nombres de cada grupo de piezas iguales («Columna izquierda», «Columna derecha»), en el orden de la propuesta. */
function nombresPorPieza(individuales: readonly PiezaIndividual[]): string[] {
  const nombres: string[] = new Array(individuales.length);
  const porOficial = new Map<EstructuraOficialId, number[]>();
  individuales.forEach((pieza, indice) => porOficial.set(pieza.estructura, [...(porOficial.get(pieza.estructura) ?? []), indice]));
  for (const [oficial, indices] of porOficial) {
    const lados = indices.length === 2 ? indices.map((i) => (individuales[i]!.ubicacion === "lateral_derecho" ? "derecho" : "izquierdo") as "izquierdo" | "derecho") : undefined;
    const lista = nombresIndividuales(oficial, indices.length, lados && lados.length === 2 ? [lados[0]!, lados[1]!] : undefined);
    indices.forEach((indice, k) => { nombres[indice] = lista[k] ?? ESTRUCTURAS_OFICIALES[oficial].nombre; });
  }
  return nombres;
}

/**
 * A qué piezas va la medida que dijo el cliente: a todas las de la estructura que nombró; sin estructura nombrada, a la
 * primera. Si nombró una que la propuesta no trae, no se aplica a otra y se dice. Gana siempre sobre la del modelo.
 */
function piezasConMedidaDelCliente(individuales: readonly PiezaIndividual[], brief: BriefParaEspec | undefined, avisos: string[]): Set<number> {
  if (!brief?.medida) return new Set();
  if (!brief.estructura) return new Set([0]);
  const nombradas = individuales.flatMap((p, i) => (p.estructura === brief.estructura!.id ? [i] : []));
  if (!nombradas.length) avisos.push(`La medida «${brief.medida.texto}» era de «${brief.estructura.texto}», que la propuesta no trae: no se aplicó a otra pieza.`);
  return new Set(nombradas);
}

export function especDesdePropuesta(propuesta: Propuesta, brief?: BriefParaEspec): ResultadoEspec {
  const avisos: string[] = [];
  const entradas = propuesta.piezas.map((p) => ({ estructura: p.estructura, cantidad: p.cantidad, ...(p.ubicacion ? { ubicacion: p.ubicacion } : {}) }));
  const { piezas: individuales, recortadas } = piezasIndividualesDePropuesta(entradas);
  if (recortadas > 0) avisos.push(`El plan lleva como máximo ${individuales.length} piezas: se quitaron ${recortadas}.`);
  const origenes = recortarCantidades(propuesta.piezas).piezas.flatMap((p) => Array.from({ length: p.cantidad }, () => p));
  const nombres = nombresPorPieza(individuales);
  const conMedidaDelCliente = piezasConMedidaDelCliente(individuales, brief, avisos);
  const piezas = individuales.map((individual, indice): PiezaEspec => {
    const origen = origenes[indice]!;
    const medidas = { ...medidasDePropuesta(origen.medidas), ...(conMedidaDelCliente.has(indice) && brief?.medida ? medidasDeCliente(individual.estructura, brief.medida) : {}) };
    const organica = brief?.estructura?.organica === true && brief.estructura.id === individual.estructura && SE_VUELVEN_ORGANICAS.has(individual.estructura);
    const densidad = DENSIDAD_POR_DEFECTO[individual.estructura];
    const unidades = UNIDADES_POR_DEFECTO[individual.estructura];
    return {
      id: individual.estructuraId,
      oficial: individual.estructura,
      nombre: origen.nombre && origen.cantidad === 1 ? origen.nombre : nombres[indice]!,
      lugar: lugarDe(individual.estructura, individual.ubicacion),
      medidas,
      colores: coloresDePalabras(origen.colores ?? propuesta.colores, MAX_COLORES_PIEZA, avisos),
      tamanos: organica ? "organica_fina" : TAMANOS_POR_DEFECTO[individual.estructura],
      ...(densidad ? { densidad } : {}),
      ...(unidades ? { unidades } : {}),
    };
  });
  return { espec: { version: VERSION_ESPEC, origen: { tipo: "propuesta" }, piezas }, avisos: [...new Set(avisos)] };
}
