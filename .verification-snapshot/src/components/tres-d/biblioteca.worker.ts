import { crearMotor, type PedidoMotor } from "./biblioteca-motor";

/**
 * El Web Worker de la pestaña Biblioteca: corre el motor (`biblioteca-motor.ts`) fuera del hilo de la página, así armar
 * las escenas (a veces segundos cada una) no traba la grilla ni el visor. Lo crea `biblioteca-cliente.ts`.
 */
const motor = crearMotor((aviso) => self.postMessage(aviso));
self.addEventListener("message", (e: MessageEvent<PedidoMotor>) => motor.recibir(e.data));
