import assert from "node:assert/strict";
import { getHappiaCatalogue, type HappiaCatalogueData, type HappiaPackage } from "@/lib/asesor/catalogue";
import { jsonResponse, login, requireFinal, sendTurn, type SseEvent } from "./m1";

type PackageScenarioOptions = { origin: string; userPassword: string };

const BIRTHDAY = ["birthday", "cumpleanos"];

const normalise = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function metadata(pkg: HappiaPackage, keys: readonly string[]): string[] {
  const record = pkg as Record<string, unknown>;
  return keys.flatMap((key) => {
    const value = record[key];
    return (typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []).map(normalise);
  });
}

/** An active live package with an active item; one whose metadata declares a birthday is preferred over one that is silent. */
export function pickLivePackage(data: HappiaCatalogueData): { pkg: HappiaPackage; city: string } {
  const usable = data.packages.filter((pkg) => pkg.is_active && pkg.package_items.some((item) => item.is_active));
  const declared = (pkg: HappiaPackage) => metadata(pkg, ["event_kind", "event_kinds"]);
  const pkg = usable.find((candidate) => declared(candidate).some((kind) => BIRTHDAY.includes(kind)))
    ?? usable.find((candidate) => declared(candidate).length === 0);
  assert.ok(pkg, "the live catalogue has no active package that can serve a birthday");
  const city = pkg.city ?? pkg.city_slug?.replace(/-/g, " ") ?? "Bogotá";
  return { pkg, city };
}

const asks = [
  "Quiero que me propongas un paquete estándar de Happia para este cumpleaños.",
  "Por favor usa la herramienta de paquetes estándar y muéstrame el paquete con su precio estimado.",
  "Necesito ver ya el paquete estándar de Happia que mejor encaje con mi cumpleaños.",
];

export async function runPackageScenario(options: PackageScenarioOptions): Promise<{ checks: string[]; conversationId: string }> {
  const catalogue = await getHappiaCatalogue();
  assert.equal(catalogue.status, "available", "the live Happia catalogue is unavailable");
  const { pkg, city } = pickLivePackage(catalogue.data);
  const checks = [`live catalogue read with ${catalogue.data.packages.length} packages`];

  const cookie = await login(options.origin, "user", options.userPassword);
  const created = await fetch(`${options.origin}/api/asesor/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: options.origin, cookie },
    body: JSON.stringify({ id: crypto.randomUUID(), title: "Aceptación paquete" }),
  });
  assert.equal(created.status, 201, "conversation creation failed");
  const conversationId = String(((await jsonResponse(created)).conversation as Record<string, unknown>).id);

  const request = `Evento inicial: cumpleaños de Ana Prueba, que cumple 8 años, el 14 de diciembre de 2026 a las 15:00 para ${pkg.base_guests} invitados, en un salón en ${city}, dirección Calle 1 # 1-01. Mi nombre es Cliente de prueba y mi correo de prueba es cliente@example.invalid; autorizo que me contacten y autorizo compartir mi dirección para este evento. Guarda los datos.`;
  requireFinal(await sendTurn(options.origin, cookie, conversationId, request), "birthday request");
  checks.push("complete birthday request for a live package's city and base guests");

  let events: SseEvent[] = [];
  let proposed = false;
  for (const ask of asks) {
    events = await sendTurn(options.origin, cookie, conversationId, ask);
    proposed = events.some((event) => event.type === "tool" && event.data.name === "propose_standard_package");
    if (proposed) break;
  }
  assert.ok(proposed, "the advisor never called propose_standard_package");
  const state = requireFinal(events, "package proposal");
  const standard = state.standardPackage as { packageId: string; estimate: Record<string, unknown> } | null;
  assert.ok(standard, "the final state has no standard package");
  assert.ok(catalogue.data.packages.some(({ id }) => id === standard.packageId), "the proposed package is not in the live catalogue");
  const { estimate } = standard;
  assert.equal(estimate.status, "available", "the package estimate is unavailable");
  assert.equal(typeof estimate.subtotalCop, "number", "the package estimate has no numeric subtotal");
  assert.equal(estimate.source, "happia_api", "the estimate is not sourced from the Happia API");
  assert.equal(typeof estimate.fetchedAt, "string", "the estimate has no read time");
  checks.push("propose_standard_package returned a live package card with an available estimate sourced from happia_api");
  return { checks, conversationId };
}
