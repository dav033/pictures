import { PlanActualGuiadoSchema, type PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import type { EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";
import { plegar } from "./ediciones-comunes";
import { medidasDe } from "./medidas-espec";

/**
 * **El plan del 3D como lo ve el modelo del chat** (`estadoGuiado.planActual`, REQ-007 fase 5): una proyección EXACTA de la
 * espec, sin pérdida. `planActualDesdePlan` lee un plan de Python y lo aproxima (nombres, repeticiones, participaciones en
 * familias); aquí cada pieza lleva el nombre que tiene, las medidas con que se arma (las suyas o las de su oficial), y cada
 * color con el peso que tiene en la espec. Los nombres de color son los de la tarjeta («dorado», «Fashion Azul Rey»): son los
 * mismos que el cliente ve y los mismos que `edicion-desde-pedido.ts` sabe volver a encontrar.
 */
const numero = (valor: number): string => String(Math.round(valor * 100) / 100).replace(".", ",");

function medidasDePieza(pieza: PiezaEspec): NonNullable<PlanActualGuiado["piezas"][number]["medidas"]> {
  const m = medidasDe(pieza);
  return { ...(m.anchoM ? { ancho_m: m.anchoM } : {}), ...(m.altoM ? { alto_m: m.altoM } : {}), ...(m.largoM ? { largo_m: m.largoM } : {}) };
}

function frase(pieza: PiezaEspec): string {
  const { ancho_m: ancho, alto_m: alto, largo_m: largo } = medidasDePieza(pieza);
  const tipo = ESTRUCTURAS_OFICIALES[pieza.oficial].tipoBase;
  const medida = (tipo === "guirnalda" && largo ? `${numero(largo)} m de largo` : tipo === "columna" && alto ? `${numero(alto)} m de alto` : ancho && alto ? `${numero(ancho)} × ${numero(alto)} m` : (alto ?? ancho ?? largo) ? `${numero((alto ?? ancho ?? largo)!)} m` : "");
  return `${pieza.nombre.toLocaleLowerCase("es")}${medida ? ` de ${medida}` : ""}`;
}

function listaNatural(elementos: readonly string[]): string {
  if (elementos.length <= 1) return elementos[0] ?? "";
  return `${elementos.slice(0, -1).join(", ")} y ${elementos.at(-1)}`;
}

export type OpcionesPlanActual = { totalGlobos?: number };

export function planActualDesdeEspec(espec: EspecClienteV1, opciones: OpcionesPlanActual = {}): PlanActualGuiado {
  const nombresDeColor = new Map<string, string>();
  for (const color of espec.piezas.flatMap((pieza) => pieza.colores)) if (!nombresDeColor.has(plegar(color.nombre))) nombresDeColor.set(plegar(color.nombre), color.nombre.slice(0, 40));
  const colores = [...nombresDeColor.values()].slice(0, 8);
  const total = opciones.totalGlobos !== undefined && opciones.totalGlobos > 0 ? Math.trunc(opciones.totalGlobos) : undefined;
  const completo = `Tu plan: ${listaNatural(espec.piezas.map(frase))}, en ${listaNatural(colores.map((c) => c.toLocaleLowerCase("es")))}${total ? `; ${total} globos en total` : ""}.`;
  const sinMedidas = `Tu plan: ${listaNatural(espec.piezas.map((p) => p.nombre.toLocaleLowerCase("es")))}, en ${listaNatural(colores.map((c) => c.toLocaleLowerCase("es")))}${total ? `; ${total} globos en total` : ""}.`;
  const resumen = completo.length <= 400 ? completo : sinMedidas.length <= 400 ? sinMedidas : `${sinMedidas.slice(0, 398).trimEnd()}….`;
  const lateral = (pieza: PiezaEspec) => (pieza.lugar === "izquierda" ? "lateral_izquierdo" as const : pieza.lugar === "derecha" ? "lateral_derecho" as const : null);
  return PlanActualGuiadoSchema.parse({
    piezas: espec.piezas.map((pieza) => {
      const medidas = medidasDePieza(pieza);
      return {
        estructura: pieza.oficial,
        cantidad: 1,
        nombre: pieza.nombre.slice(0, 120),
        ...(lateral(pieza) ? { ubicacion: lateral(pieza) } : {}),
        ...(Object.keys(medidas).length ? { medidas } : {}),
        participacion: pieza.colores.map((color) => ({ color: color.nombre.slice(0, 40), parte: color.peso })),
      };
    }),
    colores,
    ...(total ? { totalGlobos: total } : {}),
    resumen,
  });
}
