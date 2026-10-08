/**
 * Evaluación PAGADA de la IA de escena (2026-10-08): corre la ruta real `/api/escena-ia` (Gemini Flash con las
 * herramientas, el sistema y las reglas del agente) con cada caso del banco `scripts/test/fixtures/banco-escena-ia.json`
 * y puntúa sus checks sobre la escena que devuelve (y la pregunta y la respuesta: «respuesta_con_numeros»).
 *
 * Tope declarado: US$0,50 (cambiable con --tope, nunca más de US$2). Antes de cada caso se estima lo que costará (el
 * promedio de lo gastado, mínimo US$0,03); si lo gastado más eso pasa el tope, se detiene. El gasto de cada caso es
 * el `uso.costeEstimadoUsd` que devuelve la ruta (precios de Gemini Flash). La ruta también tiene su tope de 60
 * pedidos por hora: con un 429 se detiene. Todo queda en el registro (REGISTRO_ACTIVO=1: `decidir` por herramienta,
 * verificación y respuesta final) en la conversación `exp-evaluar-escena-ia-<fecha>`.
 *
 * Sin `--pagar` NO llama a la IA: lista los casos que correría y el tope (ensayo en seco).
 *
 * Uso: NODE_OPTIONS=--use-system-ca npx tsx scripts/exp/evaluar-escena-ia.ts [--pagar] [--tope 0.5] [--caso id]
 *        [--limite N] [--solo-reales] [--sin-pendientes]
 * Salida: data/exp/evaluar-escena-ia-<fecha>.json (por caso: aprobado, fallos, herramientas usadas vs. ideales, coste).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { comprobarTodos, escenaDeContexto, type Banco, type Caso } from "../test/banco-escena-ia";
import type { Escena } from "../../src/lib/globos3d/escena";

for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
process.env.REGISTRO_ACTIVO = "1";

const TOPE_MAXIMO_USD = 2;
const COSTE_MINIMO_POR_CASO = 0.03;

const arg = (nombre: string) => (process.argv.includes(nombre) ? process.argv[process.argv.indexOf(nombre) + 1] : undefined);
const tope = Math.min(TOPE_MAXIMO_USD, Number(arg("--tope") ?? 0.5));
const pagar = process.argv.includes("--pagar");

type Respuesta = { escena?: Escena; respuesta?: string; acciones?: Array<{ herramienta: string; resumen: string; consulta: boolean }>; pregunta?: { texto: string; opciones: string[] }; uso?: { pasos: number; llamadas: number; costeEstimadoUsd: number }; error?: string };
type Fila = { id: string; origen: Caso["origen"]; texto: string; aprobado: boolean; fallos: string[]; herramientas: string[]; ideales: string[]; respuesta: string; pregunta: Respuesta["pregunta"] | null; costeUsd: number; pasos: number; backlog: string | null; estado: number };

function casosElegidos(banco: Banco): Caso[] {
  const caso = arg("--caso"), limite = Number(arg("--limite") ?? Infinity);
  return banco.casos
    .filter((c) => !caso || c.id === caso)
    .filter((c) => !process.argv.includes("--solo-reales") || c.origen === "real")
    .filter((c) => !process.argv.includes("--sin-pendientes") || !c.backlog)
    .slice(0, Number.isFinite(limite) ? limite : undefined);
}

async function main() {
  const banco = JSON.parse(readFileSync(path.join(__dirname, "../test/fixtures/banco-escena-ia.json"), "utf8")) as Banco;
  const casos = casosElegidos(banco);
  console.log(`Evaluación de la IA de escena: ${casos.length} casos · tope US$${tope.toFixed(2)}${pagar ? "" : " · EN SECO (sin --pagar no se llama a la IA)"}`);
  if (!pagar) {
    for (const c of casos) console.log(`  - ${c.id}${c.backlog ? " (pendiente)" : ""}: «${c.texto.slice(0, 90)}»`);
    console.log(`Con --pagar correría hasta que lo gastado + ~US$${COSTE_MINIMO_POR_CASO} por caso pase US$${tope.toFixed(2)}.`);
    return;
  }
  if (!process.env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY en .env.local o .env");
  const { POST } = await import("../../src/app/api/escena-ia/route");
  const { decidir } = await import("../../src/lib/registro/servidor");
  const conversacion = `exp-evaluar-escena-ia-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`;

  const filas: Fila[] = [];
  let gastado = 0;
  for (const caso of casos) {
    const estimado = Math.max(COSTE_MINIMO_POR_CASO, filas.length ? gastado / filas.length : 0);
    if (gastado + estimado > tope) { console.log(`Tope: gastado US$${gastado.toFixed(4)} + ~US$${estimado.toFixed(3)} pasaría US$${tope.toFixed(2)}. Me detengo.`); break; }
    const antes = escenaDeContexto(caso.contexto);
    const elegida = caso.contexto.seleccion ? antes.nodos.find((n) => n.id === caso.contexto.seleccion) : undefined;
    const cuerpo = { escena: antes, mensaje: caso.texto, historial: caso.contexto.historial ?? [], seleccion: elegida ? { id: elegida.id, nombre: elegida.nombre } : null };
    const r = await POST(new Request("http://localhost/api/escena-ia", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-conversacion-id": conversacion, "x-vista": "3d" },
      body: JSON.stringify(cuerpo),
    }));
    const datos = (await r.json().catch(() => ({}))) as Respuesta;
    const coste = datos.uso?.costeEstimadoUsd ?? estimado;
    gastado += coste;
    const despues = datos.escena ?? antes;
    const fallos = r.ok ? comprobarTodos(antes, despues, caso.checks, { pregunta: datos.pregunta ?? null, respuesta: datos.respuesta, evaluacion: true }) : [`HTTP ${r.status}: ${datos.error ?? "sin cuerpo"}`];
    const fila: Fila = {
      id: caso.id, origen: caso.origen, texto: caso.texto, aprobado: !fallos.length, fallos,
      herramientas: (datos.acciones ?? []).map((a) => a.herramienta), ideales: (caso.esperado?.herramientas ?? []).map((h) => h.herramienta),
      respuesta: datos.respuesta ?? "", pregunta: datos.pregunta ?? null, costeUsd: Math.round(coste * 1e5) / 1e5, pasos: datos.uso?.pasos ?? 0, backlog: caso.backlog ?? null, estado: r.status,
    };
    filas.push(fila);
    console.log(`  ${fila.aprobado ? "✓" : "✗"} ${caso.id} · US$${coste.toFixed(4)} · ${fila.herramientas.join(",") || "(sin herramientas)"}${fallos.length ? ` — ${fallos.slice(0, 2).join(" | ")}` : ""}`);
    if (r.status === 429) { console.log("La ruta respondió 429 (tope por hora o cuota): me detengo."); break; }
  }

  const aprobados = filas.filter((f) => f.aprobado).length;
  const resumen = { fecha: new Date().toISOString(), tope, gastadoUsd: Math.round(gastado * 1e4) / 1e4, casos: filas.length, aprobados, tasa: filas.length ? Math.round((aprobados / filas.length) * 1000) / 10 : 0, conversacion };
  decidir("regla:evaluacion_escena_ia", "evaluación pagada del banco de la IA de escena", resumen);
  const carpeta = path.resolve("data/exp");
  mkdirSync(carpeta, { recursive: true });
  const salida = path.join(carpeta, `evaluar-escena-ia-${resumen.fecha.slice(0, 16).replace(/[:T]/g, "-")}.json`);
  writeFileSync(salida, JSON.stringify({ resumen, filas }, null, 2));
  console.log(`\n${aprobados}/${filas.length} casos aprobados (${resumen.tasa} %) · gastado US$${resumen.gastadoUsd} de US$${tope} · ${salida}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
