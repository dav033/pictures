import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function exige(condicion: boolean, mensaje: string): void {
  assert.ok(condicion, mensaje);
  console.log(`✓ ${mensaje}`);
}

const listaCompra = source("src/components/tres-d/ListaCompra.tsx");
const precio = source("src/components/tres-d/SeccionPrecio.tsx");
const countUp = source("src/components/ui/reactbits/CountUp.tsx");
const piezas = source("src/components/tres-d/PanelPiezas.tsx");
const biblioteca = source("src/components/tres-d/GrillaCompacta.tsx");
const animatedList = source("src/components/ui/reactbits/AnimatedList.tsx");

exige(/<CountUp\s+value=\{escena\.nodos\.length\}/.test(listaCompra), "la lista de compra anima el total de piezas");
exige(/<CountUp\s+value=\{armada\.globos\.length\}/.test(listaCompra), "la lista de compra anima el total de globos");
exige(/<CountUp\s+value=\{estado\.cotizacion\.total\}/.test(precio), "la cotización anima el total exacto");
exige(/const next = progress === 1 \? value/.test(countUp), "CountUp termina en el valor exacto recibido");
exige(/aria-label=\{formatter\.format\(value\)\}/.test(countUp), "CountUp expone el valor final exacto a tecnologías de asistencia");

exige(/<AnimatedList\s+items=\{ramas\}/.test(piezas), "el árbol de piezas usa AnimatedList");
exige(/<AnimatedList\s+items=\{mostrados\}/.test(biblioteca), "los resultados de biblioteca usan AnimatedList");
exige(!/SpotlightCard/.test(biblioteca), "las tarjetas táctiles de biblioteca omiten SpotlightCard tras medir su coste");

exige(/useReducedMotionPreference/.test(countUp) && /prefersReducedMotion\s*\|\|/.test(countUp), "CountUp queda estático con movimiento reducido");
exige(/useReducedMotionPreference/.test(animatedList) && /if \(prefersReducedMotion\) return/.test(animatedList), "AnimatedList omite las entradas animadas con movimiento reducido");
