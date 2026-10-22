import type { ChatPort, FragmentoChat, LlamadaHerramienta, Mensaje, PeticionChat } from "@/lib/ia/nucleo/tipos";

function lastCustomerText(history: Mensaje[]): string {
  return [...history].reverse().find((message) => message.rol === "usuario")?.texto ?? "";
}

function hasToolCall(history: Mensaje[], name: string): boolean {
  return history.some((message) => message.rol === "asistente" && "llamadas" in message
    && message.llamadas.some((call) => call.nombre === name));
}

function callsFor(text: string, history: Mensaje[]): LlamadaHerramienta[] {
  if (/\bPROVIDER_FAILURE\b/.test(text)) throw new Error("e2e_fake_provider_failure");
  if (/aún no sé qué idea elegir/i.test(text)) return [{ nombre: "show_directions", args: {} }];
  const directionId = text.match(/(deco-real-[a-z0-9-]+)/i)?.[1];
  if (directionId && /elegir esta dirección/i.test(text)) return [{ nombre: "select_direction", args: { directionId } }];
  if (/M2_START/.test(text)) {
    if (hasToolCall(history, "propose_summary")) return [];
    return [
      { nombre: "save_event_fields", args: {
        eventKind: "corporate", eventName: "Evento de aceptación", date: "2026-11-14", guestCount: 24,
        startTime: "18:00", venueType: "salón", venueName: "Salón de prueba", city: "Bogotá",
        address: "Dirección de prueba", contactName: "Contacto de prueba", contactEmail: "m2@example.invalid",
        companyName: "Empresa de prueba", theme: "Jardín", colors: ["verde"],
      } },
      { nombre: "propose_summary", args: {} },
    ];
  }
  const m2Correction = text.match(/M2_CORRECT:\s*([^\n.]+)/i);
  if (m2Correction) return hasToolCall(history, "save_event_fields") ? [] : [{ nombre: "save_event_fields", args: { theme: m2Correction[1].trim() } }];
  if (/M2_SUMMARY/.test(text)) return hasToolCall(history, "propose_summary") ? [] : [{ nombre: "propose_summary", args: {} }];
  if (/M2_APPROVE/.test(text)) {
    if (hasToolCall(history, "approve_summary")) return [];
    const version = Number(text.match(/version\s+(\d+)/i)?.[1] ?? 1);
    return [{ nombre: "approve_summary", args: { summaryVersion: version } }];
  }
  if (/evento inicial/i.test(text)) {
    if (hasToolCall(history, "propose_summary")) return [];
    return [
      {
        nombre: "save_event_fields",
        args: {
          eventKind: "corporate", eventName: "Encuentro de equipo", date: "2026-11-14", guestCount: 80,
          startTime: "18:00", venueType: "salón", venueName: "Casa Jardín", city: "Bogotá", address: "Calle 1 # 1-01",
          contactName: "Cliente de prueba", contactEmail: "cliente@example.invalid", budget: 4_000_000,
          companyName: "Empresa de prueba", theme: "Jardín clásico", colors: ["verde", "marfil"],
        },
      },
      { nombre: "propose_summary", args: {} },
    ];
  }
  const correction = text.match(/tema a ([^,.\n]+)/i);
  if (correction) return hasToolCall(history, "save_event_fields") ? [] : [{ nombre: "save_event_fields", args: { theme: correction[1].trim() } }];
  if (/muestra el resumen corregido/i.test(text)) return hasToolCall(history, "propose_summary") ? [] : [{ nombre: "propose_summary", args: {} }];
  if (/apruebo el resumen/i.test(text)) {
    if (hasToolCall(history, "approve_summary")) return [];
    const version = Number(text.match(/versi[oó]n\s+(\d+)/i)?.[1] ?? 1);
    return [{ nombre: "approve_summary", args: { summaryVersion: version } }];
  }
  return [];
}

/** Deterministic provider for the local production-server acceptance run only. */
export function createE2EFakeAdvisorChat(): ChatPort {
  return {
    id: "gemini",
    modelo: "e2e-fake",
    async turno() { throw new Error("e2e_fake_only_supports_streaming"); },
    async *turnoStream(input: PeticionChat): AsyncIterable<FragmentoChat> {
      const text = lastCustomerText(input.historial);
      const calls = callsFor(text, input.historial);
      if (calls.length) {
        yield { tipo: "fin", texto: "", llamadas: calls, modelo: "e2e-fake", uso: { entrada: 1, salida: 1 } };
        return;
      }
      const reply = (/M2_APPROVE|apruebo el resumen/i.test(text))
        ? "El resumen corregido quedó aprobado."
        : /M2_SUMMARY|muestra el resumen corregido/i.test(text)
          ? "Aquí tienes el resumen corregido para revisar."
          : "Ya guardé la información del evento.";
      yield { tipo: "texto", delta: reply };
      yield { tipo: "fin", texto: reply, llamadas: [], modelo: "e2e-fake", uso: { entrada: 1, salida: 1 } };
    },
  };
}
