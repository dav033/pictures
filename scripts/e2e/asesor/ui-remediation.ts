import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Route } from "playwright";

const conversationId = "conversation-ui-remediation";
const progress = { complete: true, completed: 5, required: 5, missing: [] as string[] };
const initialState = { directionOffers: [], selectedDirectionId: null, standardPackage: null, summary: null, approval: null };
const gardenDirection = { id: "garden", title: "Jardín luminoso", description: "Flores y globos para una celebración al aire libre.", photoUrl: "/biblioteca-sempertex/referencias/jardin.jpg",
  provenance: { kind: "real", label: "La foto es una referencia visual." }, themedItems: { status: "available", items: [{ id: "catalog-1", name: "Paquete floral", price: 125000, source: "package" }] } };
const packageProposal = { packageId: "pkg-1", name: "Paquete Fiesta", baseGuests: 40, guestCount: 80,
  estimate: { status: "available", subtotalCop: 250000, basis: "before_vat_and_commission", source: "postgres", fetchedAt: "2026-10-23T10:00:00.000Z", snapshotAgeSeconds: 120, notice: "Estimado sujeto a confirmación." },
  coverage: { event: "unknown", theme: "unknown", city: "unknown", guests: "differs_from_base" },
  disclosures: ["El catálogo no indica para qué tipo de evento aplica este paquete; hay que confirmarlo.", "El catálogo no indica temáticas para este paquete; no se garantiza que encaje con la temática.", "El catálogo no indica la ciudad de este paquete; no se garantiza cobertura en la ciudad del evento.", "El paquete está pensado para 40 invitados; el costo y la capacidad para 80 se confirman con el equipo."] };
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSZYAAAAASUVORK5CYII=", "base64");

type FixtureState = { directionOffers: typeof gardenDirection[]; selectedDirectionId: string | null; standardPackage: typeof packageProposal | null; summary: { version: number; briefVersion: number; text: string } | null; approval: { summaryVersion: number; confirmedAt: string } | null };
let state: FixtureState = structuredClone(initialState) as FixtureState;
let messages: Array<Record<string, unknown>> = [];
let uploadCalls = 0;
const uploadedTurnIds: string[] = [];

function event(type: string, extra: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({ type, state: structuredClone(state), progress, briefVersion: 9, ...extra })}\n\n`;
}

async function fixture(route: Route): Promise<void> {
  const request = route.request();
  assert.match(request.headers().cookie ?? "", /advisor_session=controlled-fixture/, "API fixture request did not include authenticated session cookie");
  const url = new URL(request.url());
  if (url.pathname === "/api/asesor/conversations" && request.method() === "POST") {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ conversation: { id: conversationId }, state: structuredClone(state), progress, briefVersion: 0 }) }); return;
  }
  if (url.pathname === `/api/asesor/conversations/${conversationId}` && request.method() === "GET") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversation: { id: conversationId }, state: structuredClone(state), progress, briefVersion: 9, messages }) }); return;
  }
  if (url.pathname === "/api/asesor/photos" && request.method() === "POST") {
    uploadCalls++;
    const payload = request.postDataBuffer()?.toString("latin1") ?? "";
    assert.match(request.headers()["content-type"] ?? "", /multipart\/form-data/);
    assert.match(payload, /venue/);
    assert.match(payload, /event-place\.png/);
    const turnMatch = payload.match(/name="turnId"\r\n\r\n([\s\S]*?)\r\n/);
    assert.ok(turnMatch?.[1], "photo request did not include the stable turn ID");
    uploadedTurnIds.push(turnMatch[1]);
    if (uploadCalls === 1) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "ADVISOR_STORAGE_UNAVAILABLE" }) }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ turnId: turnMatch[1], attachments: [{ id: "photo-1", mimeType: "image/png", byteSize: 68, kind: "venue" }] }) }); return;
  }
  if (url.pathname === "/api/asesor/photos/photo-1" && request.method() === "GET") {
    await route.fulfill({ status: 200, contentType: "image/png", body: imageBytes, headers: { "Cache-Control": "private, no-store" } }); return;
  }
  if (url.pathname === "/api/asesor/conversar" && request.method() === "POST") {
    const body = request.postDataJSON() as { turnId: string; content: string };
    if (body.content.startsWith("Me interesa esta dirección:")) state.selectedDirectionId = "garden";
    if (body.content.startsWith("Apruebo el resumen")) state.approval = { summaryVersion: state.summary?.version ?? 0, confirmedAt: "2026-10-23T12:00:00Z" };
    if (body.content.startsWith("Corrige el tema")) {
      state.summary = { version: (state.summary?.version ?? 0) + 1, briefVersion: 10, text: "Resumen corregido: Terraza azul en Bogotá." };
      state.approval = null;
    }
    if (body.content === "") {
      state = { directionOffers: [gardenDirection], selectedDirectionId: null, standardPackage: packageProposal, summary: { version: 1, briefVersion: 9, text: "Resumen inicial para revisar." }, approval: null };
    }
    const assistantId = `${body.turnId}:assistant`;
    messages = [...messages.filter((message) => message.id !== body.turnId && message.id !== assistantId),
      { id: body.turnId, role: "user", content: body.content, attachments: body.content === "" ? [{ id: "photo-1", mimeType: "image/png", byteSize: 68, kind: "venue", confirmed: null, preference: "neutral" }] : [] },
      { id: assistantId, role: "assistant", content: "Listo, revisemos los detalles." }];
    const text = body.content.startsWith("Apruebo") ? "El resumen quedó aprobado." : body.content.startsWith("Corrige") ? "Actualicé el resumen." : "Listo, revisemos los detalles.";
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: `${event("text", { delta: text })}${event("tool", { name: "fixture_state" })}${event("final", { messageId: assistantId, retryAvailable: false })}` }); return;
  }
  await route.fulfill({ status: 404, body: "not found" });
}

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pictures-advisor-ui-"));
  const bundlePath = path.join(directory, "chat.js");
  const root = process.cwd();
  try {
    await build({ entryPoints: [path.join(root, "scripts/e2e/asesor/chat-harness.tsx")], outfile: bundlePath, bundle: true, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent",
      plugins: [{ name: "project-alias", setup(buildApi) { buildApi.onResolve({ filter: /^@\// }, (args) => {
        const base = path.join(root, "src", args.path.slice(2));
        const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`].find((candidate) => existsSync(candidate));
        return resolved ? { path: resolved } : { errors: [{ text: `Could not resolve project alias ${args.path}` }] };
      }); } }] });
    const bundle = await readFile(bundlePath);
    const server = createServer((request, response) => {
      if (request.url === "/chat.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bundle); return; }
      if (request.url === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><html lang=es><body><div id=root></div><script type=module src=/chat.js></script></body></html>"); return; }
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: "advisor_session", value: "controlled-fixture", url: `http://127.0.0.1:${address.port}` }]);
      const page = await context.newPage();
      await page.route("**/api/asesor/**", fixture);
      await page.route("**/biblioteca-sempertex/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: imageBytes }));
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.getByRole("heading", { name: "Planeemos tu celebración" }).waitFor();
      assert.equal(await page.locator('button[aria-label="Tomar foto"]').isEnabled(), true);
      assert.equal(await page.locator('input[aria-label="Tomar foto"]').getAttribute("capture"), "environment");
      await page.getByLabel("Tipo de foto").selectOption("venue");
      await page.locator('input[aria-label="Elegir foto de la galería"]').setInputFiles({ name: "event-place.png", mimeType: "image/png", buffer: imageBytes });
      await page.getByRole("textbox", { name: "Tu mensaje" }).fill("");
      assert.equal(await page.getByRole("button", { name: "Enviar" }).isEnabled(), true, "a selected photo must enable sending without text");
      await page.getByRole("button", { name: "Enviar" }).click();
      await page.getByRole("alert").getByRole("button", { name: "Reintentar" }).waitFor();
      assert.equal(uploadCalls, 1, "the failed photo upload should not fall through to conversation streaming");
      await page.getByRole("alert").getByRole("button", { name: "Reintentar" }).click();
      await page.getByRole("heading", { name: /Resumen para revisar · versión 1/ }).waitFor();
      assert.equal(uploadCalls, 2);
      assert.equal(uploadedTurnIds.length, 2);
      assert.equal(uploadedTurnIds[0], uploadedTurnIds[1], "upload retry must reuse the original turn ID");
      assert.equal(await page.locator('ol[aria-label="Mensajes"] > li').filter({ has: page.locator('img[alt="Foto del lugar del evento"]') }).count(), 1, "the authenticated photo should render once in the user message");
      await page.locator('img[alt="Foto del lugar del evento"]').evaluate(async (image) => (image as HTMLImageElement).decode());
      assert.equal(await page.getByRole("button", { name: /Jardín luminoso/ }).count(), 1);
      assert.equal(await page.getByRole("button", { name: /Paquete Fiesta/ }).count(), 1);
      const packageCard = page.getByRole("button", { name: /Paquete Fiesta/ });
      assert.match(await packageCard.innerText(), /2026-10-23/);
      assert.match(await packageCard.innerText(), /no indica temáticas/);
      assert.match(await packageCard.innerText(), /capacidad para 80/);
      const directionCard = page.getByRole("button", { name: /Jardín luminoso/ });
      assert.match(await directionCard.locator("img").getAttribute("src") ?? "", /biblioteca-sempertex/);
      assert.match(await directionCard.innerText(), /Fuente: Catálogo Happia · paquete/);
      assert.match(await directionCard.innerText(), /125\.000/);
      await directionCard.click();
      await page.getByText("Resumen inicial para revisar.").waitFor();
      await page.getByRole("button", { name: "Aprobar resumen" }).click();
      await page.getByRole("link", { name: "Ver resumen aprobado" }).waitFor();
      await page.getByRole("textbox", { name: "Tu mensaje" }).fill("Corrige el tema a Terraza azul.");
      await page.getByRole("button", { name: "Enviar" }).click();
      await page.getByText("Resumen corregido: Terraza azul en Bogotá.").waitFor();
      assert.equal(await page.getByRole("link", { name: "Ver resumen aprobado" }).count(), 0, "a correction must invalidate the prior approval");
      await page.getByRole("button", { name: "Aprobar resumen" }).click();
      const briefLink = page.getByRole("link", { name: "Ver resumen aprobado" });
      await briefLink.waitFor();
      assert.equal(await briefLink.getAttribute("href"), `/asesor/brief/${conversationId}`);
      await page.reload();
      await page.getByRole("link", { name: "Ver resumen aprobado" }).waitFor();
      await page.getByText("Resumen corregido: Terraza azul en Bogotá.").waitFor();
      assert.equal(await page.locator('img[alt="Foto del lugar del evento"]').count(), 1, "reload should restore the persisted attachment reference");
      assert.equal(await page.getByRole("button", { name: /Jardín luminoso/ }).count(), 1, "reload should restore sourced direction cards");
      assert.equal(await page.getByRole("button", { name: /Paquete Fiesta/ }).count(), 1, "reload should restore package cards");
      const restoredPackageCard = page.getByRole("button", { name: /Paquete Fiesta/ });
      assert.match(await restoredPackageCard.innerText(), /2026-10-23/);
      assert.match(await restoredPackageCard.innerText(), /no indica para qué tipo de evento/);
      assert.match(await restoredPackageCard.innerText(), /no indica temáticas/);
      assert.match(await restoredPackageCard.innerText(), /no indica la ciudad/);
      assert.match(await restoredPackageCard.innerText(), /capacidad para 80/);
      assert.equal(await page.locator('ol[aria-label="Mensajes"] > li').count() >= 8, true, "reload should restore the transcript without losing turns");
      console.log("Advisor ChatView browser flow passed: camera/gallery controls, authenticated photo retry, SSE cards and summary, correction approval invalidation, brief link, and reload restore.");
      await context.close();
    } finally { await browser.close(); server.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) void main();
