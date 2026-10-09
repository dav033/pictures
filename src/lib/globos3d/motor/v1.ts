import "server-only";
import { armarEscena } from "../escena";
import { armadaCompacta } from "./armada-compacta";
import { bomDeEscena } from "./bom";
import { escenaDesdeEspec } from "./espec-a-escena";
import { EspecClienteV1Schema, type EspecClienteV1 } from "./espec-cliente-v1";
import { especHashDe } from "./hash-espec";
import type { ResultadoMotorV1 } from "./resultado-motor-v1";

/**
 * **La fachada del motor 3D para el producto guiado: la ÚNICA entrada que el chat guiado puede importar.** Solo
 * servidor: la receta del motor (constructores, semillas, tablas) no viaja al navegador (D-019); el cliente recibe la
 * armada compacta, ya armada.
 *
 * `VERSION_MOTOR` sube con cualquier cambio del motor que mueva una lista de materiales o la geometría: las fixtures
 * doradas de `contracts/domain/v1/golden/motor-guiada/` guardan la versión con que se tomaron y fallan si el motor
 * cambia sin subirla.
 */
export const VERSION_MOTOR = "1.2.0";

export type { EspecClienteV1, PiezaEspec } from "./espec-cliente-v1";
export type { BomLinea, ResultadoMotorV1 } from "./resultado-motor-v1";
export type { ArmadaCompactaV1 } from "./armada-compacta";
export { EspecClienteV1Schema } from "./espec-cliente-v1";
export { especDesdePropuesta } from "./espec-desde-propuesta";
export { especDesdePlan } from "./espec-desde-plan";
export { especDesdeIdeaGuardada, sumarIdeaAEspec, type SumaDeIdea } from "./espec-desde-idea";
export { especHashDe } from "./hash-espec";
export type { ResultadoEspec } from "./espec-desde-propuesta";
// Precio (fase 2): la merma, el cruce con la tienda, la cotización de la lista y el sobre del plan para la vista guiada.
export { MERMA, MERMA_PORCENTAJE, cantidadConMerma } from "./merma";
export { crosswalkEnVivo, crosswalkIncluido, snapshotPublicado } from "./crosswalk-vigente";
export { POLITICA_PAQUETES, POLITICAS_PAQUETES, planearCompra, type PoliticaPaquetes, type ReservaPlan } from "./plan-de-compra";
export { cotizarBom, type CompraMotor, type CotizacionDelMotor, type DependenciasCotizacion, type FalloCotizacion, type ResultadoCotizacionBom } from "./cotizar-bom";
export { sobreDelMotor, SobreMotorSchema, type EntradaSobre, type PlanGuiadoMotor, type SobreDelMotor } from "./plan-guiado-desde-motor";
export type { ConceptoPlan } from "./proyeccion-plan";
// Vista (fase 3): la armada compacta proyectada a SVG, para el cliente sin WebGL.
export { svgDeArmada, type OpcionesVistaSvg } from "./vista2d-svg";

export function armarDesdeEspec(entrada: EspecClienteV1): ResultadoMotorV1 {
  const espec = EspecClienteV1Schema.parse(entrada);
  const { escena, cache, declaradas, lineasDeFlores, noRepresentables, avisos } = escenaDesdeEspec(espec);
  const armada = armarEscena(escena, cache);
  return {
    motor: { id: "globos3d", version: VERSION_MOTOR },
    especHash: especHashDe(espec, VERSION_MOTOR),
    armada: armadaCompacta(armada),
    bom: bomDeEscena(armada, declaradas, lineasDeFlores),
    avisos: [...new Set([...avisos, ...armada.avisos])],
    noRepresentable: noRepresentables,
  };
}
