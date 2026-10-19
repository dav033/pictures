import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerSharedQuote } from "@/components/shared-quotes/CustomerSharedQuote";
import { OwnerSharedQuoteList } from "@/components/shared-quotes/OwnerSharedQuotes";
import { ShareQuoteControl } from "@/components/shared-quotes/ShareQuoteControl";
import type { OwnerSharedQuote, PublicSharedQuote } from "@/lib/shared-quotes/contracts";

const quote: PublicSharedQuote = {
  sceneName: "Arco lila",
  validUntil: "2026-10-20",
  totalCop: 12345,
  currency: "COP",
  status: "pending",
  createdAt: "2026-10-16T17:00:00.000Z",
};

const customerHtml = renderToStaticMarkup(createElement(CustomerSharedQuote, {
  token: "signed.payload",
  quote,
  canRespond: true,
}));
assert.match(customerHtml, /Arco lila/);
assert.match(customerHtml, /12\.345/);
assert.match(customerHtml, /Válida hasta/);
assert.match(customerHtml, /Aprobar/);
assert.match(customerHtml, /Pedir cambios/);
assert.match(customerHtml, /\/api\/cotizacion-compartida\/signed\.payload\/imagen/);
assert.doesNotMatch(customerHtml, /\/_next\/image\?url=/, "la URL con token se carga directamente, sin pasar por el optimizador de Next");
assert.doesNotMatch(customerHtml, /Tu ganancia|total_costos_cop|utilidad_porcentaje|precio_paquete_cop/);

const answeredHtml = renderToStaticMarkup(createElement(CustomerSharedQuote, {
  token: "signed.payload",
  quote: { ...quote, status: "approved" },
  canRespond: true,
}));
assert.match(answeredHtml, /Aprobada/);
assert.doesNotMatch(answeredHtml, /Confirmar aprobación/);

const ownerQuote: OwnerSharedQuote = {
  id: "00000000-0000-4000-8000-000000000001",
  sceneName: "Arco lila",
  validUntil: "2026-10-20",
  status: "changes_requested",
  customerName: "Ana",
  comment: "Cambiar <img src=x onerror=alert(1)> por lila.",
  respondedAt: "2026-10-16T17:00:00.000Z",
  createdAt: "2026-10-16T16:00:00.000Z",
};
const ownerHtml = renderToStaticMarkup(createElement(OwnerSharedQuoteList, { quotes: [ownerQuote] }));
assert.match(ownerHtml, /Cambios solicitados/);
assert.match(ownerHtml, /Ana/);
assert.match(ownerHtml, /Cambiar &lt;img src=x onerror=alert\(1\)&gt; por lila\./);
assert.doesNotMatch(ownerHtml, /<img src=x/);

const gatedHtml = renderToStaticMarkup(createElement(ShareQuoteControl, {
  enabled: false,
  ready: true,
  sceneName: "Arco lila",
  sceneKey: "taller-key",
  quoteInput: null,
  captureStill: async () => new Blob(),
}));
assert.equal(gatedHtml, "", "el control no aparece hasta habilitar el escritor");

console.log("[PASS] el cliente ve escena, total y decisiones sin costos internos; el Taller escapa y muestra el comentario recibido.");
