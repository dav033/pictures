/**
 * Contador de gasto y de llamadas de una pasada. Se alimenta del observador de cierre de llamadas del envoltorio de
 * auditoría (`observarLlamadasIa`): ahí llega cada llamada a Claude, la fallida y la de detección, sea cual sea el
 * transporte. Si se supera el tope, se agotan las llamadas o aparece un modelo sin precio, para la pasada: aborta la
 * petición en curso (`AbortController`). Las llamadas se cuentan al cerrar, así que las que ya volaban al parar (la lectura
 * y los trozos de la detección van en paralelo) terminan y suman su coste real; no se les carga reserva, porque no se sabe si
 * llegaron a salir.
 */
import { observarLlamadasIa, type EventoCierreLlamadaIa } from "@/lib/registro/observadores-llamadas";
import { TopeGastoSuperado, type CupoGasto } from "./lib-cupo-gasto";
import type { TransporteArnes } from "./lib-agregado";

/** Coste que se carga por una llamada que falló o se cortó sin dejar coste visible (conservador: el proveedor puede haber cobrado). */
export const RESERVA_LLAMADA_FALLIDA_USD = 0.02;

/** El envoltorio de Claude reporta «claude»; «anthropic» es su nombre en la telemetría de la base. */
const esProveedorDeClaude = (proveedor: string) => proveedor === "claude" || proveedor === "anthropic";

export class ContadorLlamadas {
  private hechas = 0;
  private fallidas = 0;
  private paroMotivo: string | null = null;
  private controlador: AbortController | null = null;
  private quitar: (() => void) | null = null;

  constructor(readonly cupo: CupoGasto, readonly maxLlamadas: number, readonly transporte: TransporteArnes) {
    if (!Number.isInteger(maxLlamadas) || maxLlamadas < 1) throw new Error(`El máximo de llamadas debe ser un entero positivo (recibido: ${maxLlamadas}).`);
  }

  get llamadas(): number { return this.hechas; }
  /** Llamadas cerradas con error o cortadas a medias, antes o después del paro. */
  get errores(): number { return this.fallidas; }
  get gastado(): number { return this.cupo.gastado; }
  get paro(): string | null { return this.paroMotivo; }

  /** `true` si aún cabe otra llamada: sin paro, con llamadas disponibles y con margen de coste. */
  margen(): boolean {
    return this.paroMotivo === null && this.hechas < this.maxLlamadas && this.cupo.hayMargen();
  }

  /** La petición en curso que se aborta si la pasada para. `null` entre fotos. */
  vigilar(controlador: AbortController | null): void { this.controlador = controlador; }

  activar(): void { this.quitar ??= observarLlamadasIa((evento) => this.observar(evento)); }
  desactivar(): void { this.quitar?.(); this.quitar = null; }

  /** Registra una llamada cerrada. Nunca lanza (el registro de auditoría se tragaría el error): el paro se decide aquí y se expresa en `paro`. */
  observar(evento: EventoCierreLlamadaIa): void {
    this.hechas += 1;
    if (evento.error || evento.interrumpida) this.fallidas += 1;
    if (this.paroMotivo !== null) return this.cargarTrasElParo(evento);
    if (!esProveedorDeClaude(evento.proveedor)) return this.parar(`proveedor no permitido en el arnés: ${evento.proveedor}`);
    const coste = this.costeDe(evento);
    if (coste === undefined) return this.parar(`modelo sin precio en la telemetría: ${evento.modelo}`);
    if (!Number.isFinite(coste) || coste < 0) return this.parar(`coste no válido en la telemetría: ${coste}`);
    try {
      this.cupo.registrar(coste);
    } catch (error) {
      this.parar(error instanceof TopeGastoSuperado ? error.message : `no se pudo registrar el coste: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (this.hechas >= this.maxLlamadas) this.parar(`máximo de llamadas (${this.maxLlamadas}) alcanzado`);
  }

  /** Una llamada que volaba al parar y cierra con coste conocido: el gasto es real, se suma aunque pase del tope. */
  private cargarTrasElParo(evento: EventoCierreLlamadaIa): void {
    const coste = evento.costeEstimadoUsd;
    if (!esProveedorDeClaude(evento.proveedor) || coste === undefined || !Number.isFinite(coste) || coste < 0) return;
    try {
      this.cupo.registrar(coste);
    } catch {
      // El tope ya se cruzó al parar: el coste queda sumado igual y no hay nada más que parar.
    }
  }

  /**
   * El coste que se carga por una llamada. La suscripción (`cli`) no cobra por llamada. Sin coste visible, una llamada
   * fallida o cortada a medias se carga con la reserva (el proveedor pudo cobrarla); una completa es un modelo sin precio.
   */
  private costeDe(evento: EventoCierreLlamadaIa): number | undefined {
    if (evento.costeEstimadoUsd !== undefined) return evento.costeEstimadoUsd;
    if (this.transporte === "cli") return 0;
    return evento.error || evento.interrumpida ? RESERVA_LLAMADA_FALLIDA_USD : undefined;
  }

  private parar(motivo: string): void {
    this.paroMotivo ??= motivo;
    this.controlador?.abort();
  }
}
