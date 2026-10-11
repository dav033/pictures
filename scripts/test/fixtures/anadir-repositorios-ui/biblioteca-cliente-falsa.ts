/**
 * Sustituye a `components/tres-d/biblioteca-cliente.ts` en el arnés del navegador de `test-anadir-repositorios-ui.ts`: el motor
 * de la biblioteca (un Web Worker que arma las ~3 000 escenas) no es lo que se prueba y, sin Worker en un `iife`, correría en la
 * página y ahogaría el navegador. Mismo contrato: un estado vacío y un armado que nunca contesta.
 */
import type { Armado, EstadoMotor } from "../../../../src/components/tres-d/biblioteca-cliente";

const VACIO: EstadoMotor = { hechos: new Map(), indices: new Map(), hechas: 0, total: 0, escenasHechas: 0, escenas: 0 };

export type { Armado, EstadoMotor };
export const useMotorBiblioteca = (): EstadoMotor => VACIO;
export const armarEnMotor = (): Promise<Armado> => new Promise<Armado>(() => {});
