import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarjetaCotizacion } from "../../src/components/TarjetaCotizacion";
import { GuiaPlan } from "../../src/components/guiado/GuiaPlan";
import { CountUp } from "../../src/components/ui/reactbits/CountUp";
import { pasosFixture, cotizacionFixture } from "./fixtures/ui-reactbits-cliente";

const ROOT = path.resolve(__dirname, "..", "..");
const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(cotizacionFixture.total);

const pasosMarkup = renderToStaticMarkup(createElement(GuiaPlan, { pasos: pasosFixture, guias: [] }));
assert.match(pasosMarkup, /aria-label="Pasos de armado"/);
assert.match(pasosMarkup, /role="progressbar"[^>]+aria-valuemax="2" aria-valuenow="0"/);
assert.equal((pasosMarkup.match(/role="checkbox"/g) ?? []).length, pasosFixture.length);
for (const paso of pasosFixture) assert.ok(pasosMarkup.includes(paso.texto), `missing guided step: ${paso.texto}`);

const cotizacionMarkup = renderToStaticMarkup(createElement(TarjetaCotizacion, { cotizacion: cotizacionFixture }));
assert.ok(cotizacionMarkup.includes(`aria-label="${pesos}"`), `CountUp must expose the stored quote total ${pesos}`);
assert.ok(cotizacionMarkup.includes(pesos), `CountUp must render the stored quote total ${pesos}`);

const staticPriceMarkup = renderToStaticMarkup(createElement(CountUp, { value: cotizacionFixture.total, format: { style: "currency", currency: "COP", maximumFractionDigits: 0 } }));
assert.ok(staticPriceMarkup.includes(`aria-label="${pesos}"`));
assert.ok(staticPriceMarkup.includes(pesos));
assert.doesNotMatch(staticPriceMarkup, /animation|transition/i, "reduced-motion server output stays static");

const countUpSource = readFileSync(path.join(ROOT, "src/components/ui/reactbits/CountUp.tsx"), "utf8");
const stepperSource = readFileSync(path.join(ROOT, "src/components/ui/reactbits/Stepper.tsx"), "utf8");
assert.match(countUpSource, /prefersReducedMotion\s*\|\|/);
assert.match(stepperSource, /prefersReducedMotion\s*\?/);

console.log("✓ el asistente muestra los pasos reales en un Stepper con su progreso");
console.log(`✓ la cotización usa CountUp y termina exactamente en ${pesos}`);
console.log("✓ los pasos y el precio conservan salida estática para movimiento reducido");
