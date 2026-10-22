import assert from "node:assert/strict";
import { runDirectionsScenario } from "./directions";

type ScenarioOptions = {
  origin: string;
  userPassword: string;
  adminPassword: string;
  live: boolean;
  providerFailureToken?: string;
};

type SseEvent = { type: string; data: Record<string, unknown> };

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  assert.equal(typeof value, "object");
  assert.ok(value !== null);
  return value as Record<string, unknown>;
}

async function login(origin: string, username: "user" | "admin", password: string): Promise<string> {
  const response = await fetch(`${origin}/api/asesor/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    const details = await response.text();
    assert.fail(`${username} login failed: ${response.status} ${details}`);
  }
  const body = await jsonResponse(response);
  assert.equal(body.role, username);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("asesor_session="), "login did not issue advisor session cookie");
  if (!cookie) throw new Error("Advisor login cookie missing.");
  return cookie;
}

async function getJson(origin: string, path: string, cookie: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin}${path}`, { headers: { cookie } });
  assert.equal(response.status, 200, `GET ${path} returned ${response.status}`);
  return jsonResponse(response);
}

async function sendTurn(origin: string, cookie: string, conversationId: string, content: string, providerFailureToken?: string): Promise<SseEvent[]> {
  const headers: Record<string, string> = { "content-type": "application/json", origin, cookie };
  if (providerFailureToken) headers["x-asesor-e2e-token"] = providerFailureToken;
  const response = await fetch(`${origin}/api/asesor/conversar`, {
    method: "POST",
    headers,
    body: JSON.stringify({ conversationId, turnId: crypto.randomUUID(), content }),
  });
  assert.equal(response.status, 200, `advisor turn returned ${response.status}`);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const body = await response.text();
  const events: SseEvent[] = [];
  for (const block of body.split("\n\n")) {
    const type = block.match(/^event: ([^\n]+)/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!type || !data) continue;
    const parsed: unknown = JSON.parse(data);
    assert.equal(typeof parsed, "object");
    assert.ok(parsed !== null);
    events.push({ type, data: parsed as Record<string, unknown> });
  }
  const terminal = events.at(-1);
  assert.ok(terminal && (terminal.type === "final" || terminal.type === "error"), "turn did not return a terminal SSE event");
  return events;
}

function latestState(events: SseEvent[]): Record<string, unknown> {
  const terminal = events.at(-1);
  assert.ok(terminal);
  const state: unknown = terminal.data.state;
  assert.equal(typeof state, "object");
  assert.ok(state !== null);
  return state as Record<string, unknown>;
}

function requireFinal(events: SseEvent[], label: string): Record<string, unknown> {
  const terminal = events.at(-1);
  assert.ok(terminal);
  assert.equal(terminal.type, "final", `${label} did not complete: ${String(terminal.data.code ?? terminal.type)}`);
  assert.ok(events.some((event) => event.type === "text"), `${label} returned no assistant text`);
  return latestState(events);
}

function briefFrom(state: Record<string, unknown>): Record<string, unknown> {
  const brief: unknown = state.brief;
  assert.equal(typeof brief, "object");
  assert.ok(brief !== null);
  return brief as Record<string, unknown>;
}

export async function runM1Scenario(options: ScenarioOptions): Promise<{ checks: string[]; conversationId: string }> {
  const checks: string[] = [];
  const userCookie = await login(options.origin, "user", options.userPassword);
  const createdResponse = await fetch(`${options.origin}/api/asesor/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: options.origin, cookie: userCookie },
    body: JSON.stringify({ id: crypto.randomUUID(), title: "Aceptación M1" }),
  });
  assert.equal(createdResponse.status, 201, "conversation creation failed");
  const created = await jsonResponse(createdResponse);
  const conversation = created.conversation as Record<string, unknown>;
  const conversationId = String(conversation.id);
  checks.push("user login and persisted conversation creation");

  const facts = "Evento inicial: evento corporativo el 14 de noviembre de 2026 a las 18:00 para 80 personas, en el salón Casa Jardín en Bogotá, dirección Calle 1 # 1-01, presupuesto COP 4000000, colores verde y marfil. La empresa se llama Empresa de prueba y el tema es Jardín clásico. Mi nombre es Cliente de prueba y mi correo de prueba es cliente@example.invalid; autorizo que me contacten y autorizo compartir mi dirección para este evento. Guarda los datos y propón un resumen para que pueda revisarlo.";
  const firstTurn = requireFinal(await sendTurn(options.origin, userCookie, conversationId, facts), "initial conversation");
  const firstState = await getJson(options.origin, `/api/asesor/conversations/${conversationId}`, userCookie);
  const persisted = firstState.state as Record<string, unknown>;
  assert.equal((briefFrom(persisted).guestCount), 80, "event facts were not persisted");
  assert.ok(persisted.summary, "initial summary was not proposed");
  assert.ok(firstTurn.summary, "initial turn omitted summary state");
  checks.push(options.live ? "real Gemini text conversation and proposed summary" : "offline model conversation and proposed summary");
  checks.push(...await runDirectionsScenario({ origin: options.origin, cookie: userCookie, conversationId }));

  const reloaded = await fetch(`${options.origin}/asesor`, { headers: { cookie: userCookie } });
  assert.equal(reloaded.status, 200, "same-device page reload failed");
  const listAfterReload = await getJson(options.origin, "/api/asesor/conversations", userCookie);
  const conversations = listAfterReload.conversations as Array<Record<string, unknown>>;
  assert.ok(conversations.some((item) => item.id === conversationId), "conversation did not survive reload");
  checks.push("same-device reload restores persisted conversation");

  requireFinal(await sendTurn(options.origin, userCookie, conversationId, "Corrige el tema a Terraza azul."), "summary correction");
  const correctedState = await getJson(options.origin, `/api/asesor/conversations/${conversationId}`, userCookie);
  const corrected = correctedState.state as Record<string, unknown>;
  assert.match(String(briefFrom(corrected).theme).toLowerCase(), /terraza azul/, "corrected theme was not persisted");
  const regenerated = corrected.summary as Record<string, unknown> | null;
  assert.ok(regenerated, "field correction did not regenerate the summary");
  assert.ok(Number(regenerated.version) > Number((persisted.summary as Record<string, unknown>).version), "field correction reused the old summary version");
  assert.match(String(regenerated.text).toLowerCase(), /terraza azul/, "regenerated summary omitted the corrected theme");
  assert.equal(corrected.approval, null, "field correction did not invalidate the old approval");
  checks.push("correction persisted and invalidated stale summary");

  const summaryEvents = await sendTurn(options.origin, userCookie, conversationId, "Muestra el resumen corregido para revisarlo.");
  const summaryState = requireFinal(summaryEvents, "corrected summary");
  const current = summaryState.summary as Record<string, unknown>;
  assert.ok(Number.isSafeInteger(current.version), "corrected summary has no version");
  assert.notEqual(current.version, (persisted.summary as Record<string, unknown>).version, "corrected summary reused a stale version");
  checks.push("corrected summary has a new version");

  const approved = requireFinal(await sendTurn(options.origin, userCookie, conversationId, `Apruebo el resumen versión ${current.version}.`), "summary approval");
  const approval = approved.approval as Record<string, unknown> | null;
  assert.equal(approval?.summaryVersion, current.version, "current summary was not approved");
  const approvedBrief = await getJson(options.origin, `/api/asesor/briefs/${conversationId}`, userCookie);
  assert.equal((approvedBrief.approval as Record<string, unknown>).summaryVersion, current.version);
  checks.push("approved brief is persisted and visible to the user");

  const denied = await fetch(`${options.origin}/api/asesor/admin/conversations`, { headers: { cookie: userCookie } });
  assert.equal(denied.status, 403, "advisor user unexpectedly accessed the admin API");
  const deniedPage = await fetch(`${options.origin}/asesor/admin`, { headers: { cookie: userCookie }, redirect: "manual" });
  assert.equal(deniedPage.status, 403, "advisor user unexpectedly accessed the admin page");
  checks.push("admin API and page deny advisor role");

  const adminCookie = await login(options.origin, "admin", options.adminPassword);
  const adminDetail = await getJson(options.origin, `/api/asesor/admin/conversations/${conversationId}`, adminCookie);
  const visibleConversation = adminDetail.conversation as Record<string, unknown>;
  const visibleApproval = visibleConversation.approvedBrief as Record<string, unknown> | null;
  assert.equal(visibleConversation.status, "approved");
  assert.equal(visibleApproval?.version, current.version, "approved brief is not visible to admin");
  const adminPage = await fetch(`${options.origin}/asesor/admin`, { headers: { cookie: adminCookie } });
  assert.equal(adminPage.status, 200, "admin monitor page did not load");
  checks.push("admin login sees approved brief");

  if (options.providerFailureToken) {
    const failureConversation = await fetch(`${options.origin}/api/asesor/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: options.origin, cookie: userCookie },
      body: JSON.stringify({ title: "Fallo de proveedor M1" }),
    });
    assert.equal(failureConversation.status, 201);
    const failurePayload = await jsonResponse(failureConversation);
    const failureId = String((failurePayload.conversation as Record<string, unknown>).id);
    const failureEvents = await sendTurn(options.origin, userCookie, failureId, "PROVIDER_FAILURE", options.providerFailureToken);
    assert.equal(failureEvents.at(-1)?.type, "error");
    assert.equal(failureEvents.at(-1)?.data.code, "PROVIDER_FAILURE");
    const failedTurn = await getJson(options.origin, `/api/asesor/conversations/${failureId}`, userCookie);
    assert.ok((failedTurn.messages as Array<Record<string, unknown>>).some((message) => message.role === "user"), "failed provider turn was not persisted");
    checks.push("provider failure is reported and the customer message remains persisted");
  }

  return { checks, conversationId };
}
