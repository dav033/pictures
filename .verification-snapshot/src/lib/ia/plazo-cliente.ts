/**
 * El factor de los plazos del navegador que esperan a la IA, el mismo que `factorPlazoIA` del servidor: ×4 con Claude por
 * Claude Code en local (cada llamada tarda minutos). En el bundle de producción NODE_ENV es "production": no se pide
 * nada, el factor queda en 1 y cada plazo en su número de siempre. En `next dev` se lee una vez de `/api/ia/salud`
 * (`factorPlazo`, presente solo cuando es mayor que 1); un fallo deja 1.
 */

let factor = 1;
let pedido: Promise<void> | undefined;

export function factorPlazoCliente(): number {
  return factor;
}

export function cargarFactorPlazoCliente(pedirSalud: () => Promise<Response> = () => fetch("/api/ia/salud")): Promise<void> {
  if (process.env.NODE_ENV !== "development") return Promise.resolve();
  pedido ??= pedirSalud()
    .then((respuesta) => (respuesta.ok ? (respuesta.json() as Promise<unknown>) : null))
    .then((datos) => {
      const valor = typeof datos === "object" && datos !== null ? (datos as { factorPlazo?: unknown }).factorPlazo : undefined;
      if (typeof valor === "number" && Number.isFinite(valor) && valor >= 1) factor = valor;
    })
    .catch(() => undefined);
  return pedido;
}
