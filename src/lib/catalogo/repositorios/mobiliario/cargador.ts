import { LIMITES_MESA, MAX_SILLAS_POR_MESA, NOMBRE_MESA, TIPOS_MESA, TIPOS_SILLA } from "@/lib/globos3d/mobiliario-conjunto-tipos";
import { SILLAS } from "@/lib/globos3d/mobiliario-sillas-param";
import { crearEntrada, repositorioDeLista } from "../../construir";
import type { EntradaCatalogo, Repositorio } from "../../repositorio";
import { entradasDeFondos, PROCEDENCIA_TALLER } from "../fondos";
import { MANIFIESTO_MOBILIARIO } from "./manifiesto";

/** Los generadores de REQ-012, después del catálogo: la mesa a medida y el grupo de sillas de una mesa. */
function generadores(): EntradaCatalogo[] {
  return [
    crearEntrada("mobiliario", {
      clase: "generador", idLocal: "mesa_param", nombre: "Mesa a medida", procedencia: PROCEDENCIA_TALLER,
      descripcion: `Mesa paramétrica (${TIPOS_MESA.map((t) => NOMBRE_MESA[t].toLowerCase()).join(", ")}) con mantel hasta el piso, corto o sin mantel, y medidas dentro de los límites de su tipo.`,
      dato: () => ({ id: "mesa_param", tipos: TIPOS_MESA, limites: LIMITES_MESA }),
    }),
    crearEntrada("mobiliario", {
      clase: "generador", idLocal: "sillas_param", nombre: "Sillas a medida", procedencia: PROCEDENCIA_TALLER,
      descripcion: `Las sillas de una mesa (${TIPOS_SILLA.map((t) => SILLAS[t].nombre.toLowerCase()).join(", ")}), alrededor, a un lado, a los dos lados, en las cabeceras o de frente; hasta ${MAX_SILLAS_POR_MESA} por mesa.`,
      dato: () => ({ id: "sillas_param", tipos: TIPOS_SILLA, maxPorMesa: MAX_SILLAS_POR_MESA }),
    }),
  ];
}

export const cargarMobiliario = (): Repositorio => repositorioDeLista(MANIFIESTO_MOBILIARIO, () => [...entradasDeFondos("mobiliario"), ...generadores()]);
