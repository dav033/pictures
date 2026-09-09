import assert from "node:assert/strict";
import test from "node:test";
import { ejecutarConversacion } from "../src/ejecutar";
import type { ChatPort, LlamadaHerramienta, TurnoChat } from "../src/tipos";

function espera(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chat falso: en la vuelta 0 devuelve las llamadas dadas; en cualquier vuelta
 * posterior termina con texto, sin más llamadas. */
function chatFalso(llamadas: LlamadaHerramienta[]): ChatPort {
  let vuelta = 0;
  return {
    id: "gemini",
    modelo: "modelo-de-prueba",
    async turno(): Promise<TurnoChat> {
      const actual = vuelta++;
      return {
        texto: actual === 0 ? "" : "listo",
        llamadas: actual === 0 ? llamadas : [],
        uso: { entrada: 0, salida: 0 },
        modelo: "modelo-de-prueba",
      };
    },
    turnoStream(): AsyncIterable<never> {
      throw new Error("no usado en este test");
    },
  };
}

test("Fase 3.9: dos herramientas marcadas solo-lectura corren en paralelo", async () => {
  const bitacora: string[] = [];
  const llamadas: LlamadaHerramienta[] = [
    { id: "a", nombre: "buscar_catalogo", args: {} },
    { id: "b", nombre: "consultar_disponibilidad", args: {} },
  ];
  const registro = {
    buscar_catalogo: async () => {
      bitacora.push("catalogo:inicio");
      await espera(20);
      bitacora.push("catalogo:fin");
      return { ok: true };
    },
    consultar_disponibilidad: async () => {
      bitacora.push("disponibilidad:inicio");
      await espera(5);
      bitacora.push("disponibilidad:fin");
      return { ok: true };
    },
  };

  await ejecutarConversacion({
    chat: chatFalso(llamadas),
    sistema: "",
    historial: [],
    herramientas: [],
    registro,
    herramientasSoloLectura: new Set(["buscar_catalogo", "consultar_disponibilidad"]),
    telemetria: { flujo: "armador_decoracion" },
  });

  // Si corrieran en secuencia, "disponibilidad:inicio" llegaría después de
  // "catalogo:fin". En paralelo, ambas arrancan antes de que cualquiera termine.
  assert.deepEqual(bitacora.slice(0, 2), ["catalogo:inicio", "disponibilidad:inicio"]);
});

test("Fase 3.9: el historial conserva el orden de llamada, no el de finalización", async () => {
  const llamadas: LlamadaHerramienta[] = [
    { id: "lenta", nombre: "lenta", args: {} },
    { id: "rapida", nombre: "rapida", args: {} },
  ];
  const registro = {
    lenta: async () => { await espera(20); return { quien: "lenta" }; },
    rapida: async () => { await espera(1); return { quien: "rapida" }; },
  };

  const resultado = await ejecutarConversacion({
    chat: chatFalso(llamadas),
    sistema: "",
    historial: [],
    herramientas: [],
    registro,
    herramientasSoloLectura: new Set(["lenta", "rapida"]),
    telemetria: { flujo: "armador_decoracion" },
  });

  const nombresDeHerramientas = resultado.historial
    .filter((m): m is Extract<typeof m, { rol: "herramienta" }> => m.rol === "herramienta")
    .map((m) => m.nombre);
  assert.deepEqual(nombresDeHerramientas, ["lenta", "rapida"]);
});

test("Fase 3.9: un nombre de herramienta repetido en la misma vuelta cae a secuencial", async () => {
  const bitacora: string[] = [];
  const llamadas: LlamadaHerramienta[] = [
    { id: "1", nombre: "buscar_catalogo", args: { que: "primero" } },
    { id: "2", nombre: "buscar_catalogo", args: { que: "segundo" } },
  ];
  const registro = {
    buscar_catalogo: async (args: Record<string, unknown>) => {
      bitacora.push(`inicio:${args.que as string}`);
      await espera(args.que === "primero" ? 20 : 1);
      bitacora.push(`fin:${args.que as string}`);
      return { que: args.que };
    },
  };

  await ejecutarConversacion({
    chat: chatFalso(llamadas),
    sistema: "",
    historial: [],
    herramientas: [],
    registro,
    // Marcada solo-lectura, pero se repite el nombre — debe seguir secuencial.
    herramientasSoloLectura: new Set(["buscar_catalogo"]),
    telemetria: { flujo: "armador_decoracion" },
  });

  assert.deepEqual(bitacora, ["inicio:primero", "fin:primero", "inicio:segundo", "fin:segundo"]);
});

test("Fase 3.9: sin herramientasSoloLectura, todo sigue secuencial (comportamiento por defecto)", async () => {
  const bitacora: string[] = [];
  const llamadas: LlamadaHerramienta[] = [
    { id: "a", nombre: "buscar_catalogo", args: {} },
    { id: "b", nombre: "consultar_disponibilidad", args: {} },
  ];
  const registro = {
    buscar_catalogo: async () => { bitacora.push("catalogo:inicio"); await espera(10); bitacora.push("catalogo:fin"); return {}; },
    consultar_disponibilidad: async () => { bitacora.push("disponibilidad:inicio"); return {}; },
  };

  await ejecutarConversacion({
    chat: chatFalso(llamadas),
    sistema: "",
    historial: [],
    herramientas: [],
    registro,
    telemetria: { flujo: "armador_decoracion" },
  });

  assert.deepEqual(bitacora, ["catalogo:inicio", "catalogo:fin", "disponibilidad:inicio"]);
});
