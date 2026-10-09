import { armarEscena, escenaEnIngles } from "../escena";
import { follajeEnIngles } from "../flores-artificiales";
import { descripcionRender3d } from "../render-ia";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { escenaDesdeEspec } from "./espec-a-escena";
import type { EspecClienteV1 } from "./espec-cliente-v1";

/**
 * **La espec → lo que se le cuenta a FLUX junto con la captura** (REQ-007, fase 4). PRIVADO del motor (lo exporta `v1.ts`):
 * vuelve a armar la escena de la espec FIRMADA y la cuenta en inglés con el mismo código del Taller (`escenaEnIngles` +
 * `descripcionRender3d`): un inventario cerrado de piezas, cantidades, sitios y colores oficiales.
 *
 * Nada de lo que escribió el cliente llega aquí: ni el nombre de las piezas, ni el nombre del color que dijo, ni el motivo de
 * una pieza declarada. El texto sale solo de la geometría armada, de los códigos Sempertex y de las tablas del motor.
 */
export type DescripcionImagen = {
  /** El inventario en inglés, con su cierre «nada más hay en la sala». */
  descripcion: string;
  /** Piezas que ningún constructor dibuja: la imagen no las mostraría, así que quien llama no la pide. */
  noRepresentable: Array<{ piezaId: string; motivo: string }>;
};

export function descripcionImagenDeEspec(espec: EspecClienteV1): DescripcionImagen {
  const { escena, cache, declaradas, noRepresentables } = escenaDesdeEspec(espec);
  const armada = armarEscena(escena, cache);
  const materiales = armada.materiales.map((m) => ({ cantidad: m.cantidad, formatoId: m.formatoId, colorEn: referenciaPorCodigo(m.codigo)?.nombreEn ?? m.codigo }));
  return {
    descripcion: descripcionRender3d(escenaEnIngles(escena, armada), materiales, follajeEnIngles(armada.flores)),
    // Una pieza declarada (se cuenta de una lista, no se dibuja) quedaría fuera de la imagen que dice «nada más»: no se pide.
    noRepresentable: [...noRepresentables, ...declaradas.filter((p) => p.declarada).map((p) => ({ piezaId: p.id, motivo: "pieza declarada: se cuenta pero no se dibuja" }))],
  };
}
