/**
 * Arnés de entrenamiento (W4): el contador de llamadas y gasto alimentado por el observador de cierre del registro de
 * auditoría (llamadas máximas, proveedor permitido, costes inválidos, flujos interrumpidos, transporte cli, observador roto):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-contador.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-contador-"));
delete process.env.DATABASE_URL;
Object.assign(process.env, { REGISTRO_ACTIVO: "1", REGISTRO_DIR: path.join(tmp, "registro"), REGISTRO_NIVEL_STDOUT: "error" });

async function main(): Promise<void> {
  let pruebas = 0;
  const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

  const { ContadorLlamadas, RESERVA_LLAMADA_FALLIDA_USD } = await import("../entrenamiento/lib-contador");
  const { CupoGasto } = await import("../entrenamiento/lib-cupo-gasto");
  const { iniciarLlamadaIa } = await import("../../src/lib/registro/envoltorios");
  const { observarLlamadasIa } = await import("../../src/lib/registro/observadores-llamadas");

  const evento = (cambios: Partial<Parameters<InstanceType<typeof ContadorLlamadas>["observar"]>[0]> = {}) =>
    ({ proveedor: "claude", proposito: "t", modelo: "claude-haiku-5-5", costeEstimadoUsd: 0.01, error: false, interrumpida: false, ...cambios });
  const nuevo = (transporte: "api" | "cli" | "seco" = "api", maxLlamadas = 400, tope = 1) => {
    const contador = new ContadorLlamadas(new CupoGasto(tope), maxLlamadas, transporte);
    const controlador = new AbortController();
    contador.vigilar(controlador);
    return { contador, controlador };
  };
  const abrir = () => iniciarLlamadaIa({ proveedor: "claude", modelo: "claude-haiku-5-5", proposito: "prueba_contador" });

  console.log("Contador de llamadas y gasto (arnés W4):");

  await prueba("--max-llamadas: al llegar al máximo para la pasada, aborta la petición y la siguiente llamada solo se cuenta", () => {
    const { contador, controlador } = nuevo("api", 2);
    contador.observar(evento());
    assert.equal(contador.margen(), true);
    assert.equal(contador.paro, null);
    contador.observar(evento());
    assert.match(contador.paro ?? "", /máximo de llamadas \(2\)/);
    assert.equal(controlador.signal.aborted, true);
    assert.equal(contador.margen(), false);
    assert.throws(() => new ContadorLlamadas(new CupoGasto(1), 0, "api"));
  });

  await prueba("las llamadas que volaban al parar y cierran después suman su coste real, aunque pasen del tope; la reserva no", () => {
    const { contador } = nuevo("api", 400, 0.05);
    contador.observar(evento({ costeEstimadoUsd: 0.06 }));
    assert.match(contador.paro ?? "", /Tope de gasto/);
    const alParar = contador.gastado;
    assert.doesNotThrow(() => contador.observar(evento({ costeEstimadoUsd: 0.04 })), "el tope ya cruzado no vuelve a lanzar");
    assert.ok(Math.abs(contador.gastado - (alParar + 0.04)) < 1e-9, "el gasto real de la llamada tardía queda en el registro");
    const sumado = contador.gastado;
    contador.observar(evento({ costeEstimadoUsd: undefined, error: true }));
    contador.observar(evento({ costeEstimadoUsd: Number.NaN }));
    contador.observar(evento({ proveedor: "gemini", costeEstimadoUsd: 0.5 }));
    assert.equal(contador.gastado, sumado, "sin coste conocido, con coste inválido o de otro proveedor no se carga nada");
    assert.equal(contador.llamadas, 5);
    assert.equal(contador.errores, 1, "y la llamada fallida tardía se anota");
  });

  await prueba("«proveedor no permitido»: una llamada que no es de Claude para la pasada sin cargar coste", () => {
    const { contador, controlador } = nuevo();
    contador.observar(evento({ proveedor: "gemini", costeEstimadoUsd: 0.5 }));
    assert.match(contador.paro ?? "", /proveedor no permitido en el arnés: gemini/);
    assert.equal(controlador.signal.aborted, true);
    assert.equal(contador.gastado, 0);
    const permitido = nuevo();
    permitido.contador.observar(evento({ proveedor: "anthropic" }));
    assert.equal(permitido.contador.paro, null, "«anthropic» es el nombre del mismo proveedor en la telemetría");
  });

  await prueba("transporte cli: una llamada fallida o sin coste no carga nada y no para la pasada", () => {
    const { contador } = nuevo("cli");
    contador.observar(evento({ costeEstimadoUsd: undefined, error: true }));
    contador.observar(evento({ costeEstimadoUsd: undefined, modelo: "haiku" }));
    assert.equal(contador.gastado, 0);
    assert.equal(contador.paro, null);
    assert.equal(contador.llamadas, 2, "pero cada llamada cuenta para --max-llamadas");
    assert.equal(contador.margen(), true);
  });

  await prueba("transporte api: una llamada fallida sin coste carga la reserva conservadora", () => {
    const { contador } = nuevo("api");
    contador.observar(evento({ costeEstimadoUsd: undefined, error: true }));
    assert.equal(contador.gastado, RESERVA_LLAMADA_FALLIDA_USD);
    assert.equal(contador.paro, null);
  });

  await prueba("un coste no válido (NaN, negativo, infinito) para la pasada: no se traga", async () => {
    for (const malo of [Number.NaN, -0.5, Number.POSITIVE_INFINITY]) {
      const { contador, controlador } = nuevo();
      contador.activar();
      try {
        abrir().terminar({ costeEstimadoUsd: malo });
      } finally {
        contador.desactivar();
      }
      assert.match(contador.paro ?? "", /coste no válido/, `coste ${malo}: ${contador.paro}`);
      assert.equal(controlador.signal.aborted, true);
      assert.equal(contador.gastado, 0);
    }
  });

  await prueba("un flujo interrumpido sin coste no se reporta como «modelo sin precio»: carga la reserva", () => {
    const { contador } = nuevo("api");
    contador.activar();
    try {
      abrir().terminar({ texto: "parcial", interrumpida: true });
    } finally {
      contador.desactivar();
    }
    assert.equal(contador.paro, null, `paro: ${contador.paro}`);
    assert.equal(contador.gastado, RESERVA_LLAMADA_FALLIDA_USD);
    const sinPrecio = nuevo("api");
    sinPrecio.contador.activar();
    try {
      abrir().terminar({ texto: "completo" });
    } finally {
      sinPrecio.contador.desactivar();
    }
    assert.match(sinPrecio.contador.paro ?? "", /modelo sin precio/, "una llamada completa sin coste sí es un modelo sin precio");
  });

  await prueba("un resultado que no se puede leer al avisar el cierre no rompe la llamada que ya terminó", () => {
    const { contador } = nuevo();
    contador.activar();
    try {
      const ilegible = { get costeEstimadoUsd(): number { throw new Error("resultado ilegible"); } };
      assert.doesNotThrow(() => abrir().terminar(ilegible));
      assert.doesNotThrow(() => abrir().fallar(new Error("fallo"), ilegible));
    } finally {
      contador.desactivar();
    }
  });

  await prueba("un observador que lanza no rompe la llamada ni a los demás observadores", () => {
    const { contador } = nuevo();
    const quitarRoto = observarLlamadasIa(() => { throw new Error("observador roto"); });
    contador.activar();
    try {
      const llamada = abrir();
      assert.doesNotThrow(() => llamada.terminar({ costeEstimadoUsd: 0.01 }));
      assert.equal(contador.llamadas, 1, "el contador, registrado después, recibe el cierre");
      assert.doesNotThrow(() => abrir().fallar(new Error("fallo de red")));
      assert.equal(contador.llamadas, 2);
    } finally {
      contador.desactivar();
      quitarRoto();
    }
  });

  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pruebas} pruebas del contador de llamadas: OK`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
