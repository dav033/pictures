import { ErrorIA } from "@sempertex/agente-core";

/**
 * Tope de procesos `claude` a la vez: la detección de globos manda 9+ llamadas juntas y cada proceso ocupa cientos de MB
 * (el equipo del dueño tiene ~16 GB). Las demás esperan su turno, como mucho `esperaMaxMs`; un corte mientras esperan
 * las saca de la cola.
 */

export const MAX_PROCESOS_SIMULTANEOS = 3;

export type Cupo = { tomar(signal?: AbortSignal, esperaMaxMs?: number): Promise<() => void> };

export function crearCupo(maximo: number): Cupo {
  let enUso = 0;
  const espera: Array<() => void> = [];

  const liberar = () => {
    enUso -= 1;
    espera.shift()?.();
  };

  return {
    tomar(signal, esperaMaxMs) {
      return new Promise((resolve, reject) => {
        let reloj: ReturnType<typeof setTimeout> | undefined;
        const salir = () => {
          clearTimeout(reloj);
          signal?.removeEventListener("abort", alCortar);
          const indice = espera.indexOf(entrar);
          if (indice >= 0) espera.splice(indice, 1);
        };
        function entrar() {
          salir();
          enUso += 1;
          let liberado = false;
          resolve(() => {
            if (liberado) return;
            liberado = true;
            liberar();
          });
        }
        function alCortar() {
          salir();
          reject(signal?.reason ?? new DOMException("This operation was aborted", "AbortError"));
        }
        if (signal?.aborted) {
          alCortar();
          return;
        }
        if (enUso < maximo) {
          entrar();
          return;
        }
        signal?.addEventListener("abort", alCortar, { once: true });
        if (esperaMaxMs !== undefined) {
          reloj = setTimeout(() => {
            salir();
            reject(new ErrorIA("timeout", "claude", `Claude Code (CLI): ${maximo} procesos ocupados durante ${Math.round(esperaMaxMs / 1000)} s; no se lanzó otro.`, false));
          }, esperaMaxMs);
        }
        espera.push(entrar);
      });
    },
  };
}

declare global {
  // Un solo cupo por proceso de Node: `next dev` recarga los módulos (HMR) y un cupo por módulo dejaría pasar más procesos.
  var __cupoClaudeCli: Cupo | undefined;
}

export function cupoCompartido(): Cupo {
  globalThis.__cupoClaudeCli ??= crearCupo(MAX_PROCESOS_SIMULTANEOS);
  return globalThis.__cupoClaudeCli;
}
