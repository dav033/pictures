/**
 * Banco de pedidos a la IA de escena (`fixtures/banco-escena-ia.json`) contra las HERRAMIENTAS, sin modelo y sin coste:
 *   npx tsx scripts/test/test-banco-escena-ia.ts            # todo el banco
 *   npx tsx scripts/test/test-banco-escena-ia.ts --caso id  # un caso, con detalle
 * Para cada caso: arma su escena de partida, aplica la secuencia IDEAL de herramientas (escrita a mano) con
 * `aplicarHerramienta` y comprueba los efectos esperados (checks). Así se sabe qué pedidos del dueño pueden
 * hacerse ya con las herramientas y cuáles no (los marcados `backlog`, que se esperan fallidos: si uno pasa, avisa
 * para quitarle la marca). Falla si un caso sin backlog no se cumple, o si el banco está mal formado.
 * La evaluación con el modelo real (de pago, con tope) es scripts/exp/evaluar-escena-ia.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicarHerramienta, NOMBRES_HERRAMIENTAS } from "../../src/lib/globos3d/herramientas-escena";
import { comprobarTodos, escenaDeContexto, type Banco, type Caso, type Extra } from "./banco-escena-ia";

const banco = JSON.parse(readFileSync(new URL("./fixtures/banco-escena-ia.json", import.meta.url), "utf8")) as Banco;
const soloCaso = process.argv.includes("--caso") ? process.argv[process.argv.indexOf("--caso") + 1] : null;

type Resultado = { caso: Caso; fallos: string[] };

function correr(caso: Caso): Resultado {
  const antes = escenaDeContexto(caso.contexto);
  if (!caso.esperado?.herramientas.length) return { caso, fallos: ["sin secuencia ideal"] };
  let escena = antes;
  const extra: Extra = {};
  const fallos: string[] = [];
  for (const ll of caso.esperado.herramientas) {
    if (!NOMBRES_HERRAMIENTAS.includes(ll.herramienta)) { fallos.push(`falta la herramienta ${ll.herramienta}`); break; }
    const r = aplicarHerramienta(escena, ll.herramienta, ll.args);
    if (soloCaso) console.log(`    ${ll.herramienta} → ${r.ok ? r.resumen.slice(0, 600) : `ERROR ${r.error}`}`);
    if (!r.ok) { fallos.push(`${ll.herramienta}: ${r.error}`); break; }
    escena = r.escena;
    if (ll.herramienta === "preguntar_usuario") {
      const a = ll.args as { pregunta: string; opciones: string[] };
      extra.pregunta = { texto: a.pregunta, opciones: a.opciones };
      break;
    }
  }
  if (!fallos.length) fallos.push(...comprobarTodos(antes, escena, caso.checks, extra));
  return { caso, fallos };
}

// Forma del banco: ids únicos, cada caso con checks, cobertura y (si no es pendiente) su secuencia ideal.
const ids = new Set<string>();
for (const c of banco.casos) {
  assert.ok(!ids.has(c.id), `id repetido: ${c.id}`);
  ids.add(c.id);
  assert.ok(c.checks.length > 0, `${c.id}: sin checks`);
  assert.ok(c.cobertura.length > 0, `${c.id}: sin cobertura`);
  assert.ok(c.esperado?.herramientas.length || c.backlog, `${c.id}: sin secuencia ideal ni backlog`);
  assert.ok(!/@|\+?\d{9,}/.test(c.texto), `${c.id}: el texto parece traer datos personales`);
}

const casos = banco.casos.filter((c) => !soloCaso || c.id === soloCaso);
assert.ok(casos.length, `no hay ningún caso «${soloCaso}»`);
const resultados: Resultado[] = [];
for (const caso of casos) {
  if (soloCaso) console.log(`  «${caso.texto}»`);
  const r = correr(caso);
  resultados.push(r);
  const marca = !r.fallos.length ? (caso.backlog ? "✓!" : "✓ ") : caso.backlog ? "· " : "✗ ";
  console.log(`  ${marca} ${caso.id}${r.fallos.length ? ` — ${r.fallos.slice(0, 2).join(" | ")}` : ""}${caso.backlog && r.fallos.length ? ` [pendiente: ${caso.backlog}]` : ""}`);
}

const rotos = resultados.filter((r) => r.fallos.length && !r.caso.backlog);
const yaPasan = resultados.filter((r) => !r.fallos.length && r.caso.backlog);
const pendientes = resultados.filter((r) => r.fallos.length && r.caso.backlog);
const cobertura = new Map<string, { total: number; ok: number }>();
for (const r of resultados) for (const k of r.caso.cobertura) {
  const c = cobertura.get(k) ?? { total: 0, ok: 0 };
  c.total += 1; if (!r.fallos.length) c.ok += 1;
  cobertura.set(k, c);
}
console.log(`\nBanco: ${resultados.length} casos (${resultados.filter((r) => r.caso.origen === "real").length} reales del dueño, ${resultados.filter((r) => r.caso.origen === "estilo").length} en su estilo) · las herramientas cumplen ${resultados.length - pendientes.length - rotos.length} · pendientes ${pendientes.length}`);
console.log(`Cobertura: ${[...cobertura].sort().map(([k, c]) => `${k} ${c.ok}/${c.total}`).join(" · ")}`);
if (yaPasan.length) console.log(`AVISO: ya pasan y siguen marcados como pendientes (quita «backlog»): ${yaPasan.map((r) => r.caso.id).join(", ")}`);
assert.deepEqual(rotos.map((r) => `${r.caso.id}: ${r.fallos.join(" | ")}`), [], "casos que las herramientas deberían cumplir y no cumplen");
console.log("test-banco-escena-ia: OK");
