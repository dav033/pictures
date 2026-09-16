/**
 * Evaluación PAGADA (Gemini) de jerga interna en respuestas reales del chat.
 *
 * Envía los casos versionados de eval/chat/jerga-v001.json a /api/chat de un
 * servidor en marcha y revisa todo el texto del asistente con
 * detectarJergaInterna. No es una prueba rápida: requiere el servidor local,
 * APP_PASSWORD y llamadas reales al proveedor.
 *
 * Uso: npx tsx --conditions=react-server scripts/eval-chat-jerga.ts [--base http://127.0.0.1:3100] [--salida ruta.json] [--solo id1,id2]
 * Los resultados son un artefacto de ejecución: por defecto van a %TEMP%, no al repositorio.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { detectarJergaInterna } from "../src/lib/ia/jerga-interna";
import { construirSistema } from "../src/lib/ia/prompt-sistema";

const CasoSchema = z.object({ id: z.string().min(1), mensaje: z.string().min(1), loraMode: z.string().optional() }).strict();
const SuiteSchema = z.object({ version: z.string(), descripcion: z.string(), criterio: z.string(), seguimiento: z.string(), casos: z.array(CasoSchema).min(1) }).strict();
const EventoSchema = z.object({ type: z.string() }).passthrough();

function argumento(nombre: string): string | undefined {
  const indice = process.argv.indexOf(nombre);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

type Turno = { texto: string; herramientas: string[]; plan: boolean; modelo?: string; error?: string };

async function login(base: string): Promise<string> {
  const password = process.env.APP_PASSWORD;
  if (!password) throw new Error("Falta APP_PASSWORD en el entorno.");
  const respuesta = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ password }), redirect: "manual" });
  const cookie = respuesta.headers.getSetCookie().map((valor) => valor.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`Login sin cookie (HTTP ${respuesta.status}).`);
  return cookie;
}

async function turno(base: string, cookie: string, messages: Array<{ role: "user" | "assistant"; content: string }>, brief: unknown, loraMode?: string): Promise<Turno & { brief: unknown }> {
  const respuesta = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: JSON.stringify({ messages, brief, ...(loraMode ? { loraMode } : {}) }),
  });
  const cuerpo = await respuesta.text();
  const eventos = cuerpo.split("\n\n").flatMap((bloque) => {
    const data = bloque.split("\n").filter((linea) => linea.startsWith("data: ")).map((linea) => linea.slice(6)).join("");
    if (!data) return [];
    const parsed = EventoSchema.safeParse(JSON.parse(data));
    return parsed.success ? [parsed.data] : [];
  });
  const deltas = eventos.filter((evento) => evento.type === "texto").map((evento) => String(evento.delta ?? "")).join("");
  const fin = eventos.find((evento) => evento.type === "fin");
  const error = eventos.find((evento) => evento.type === "error");
  const reply = typeof fin?.reply === "string" ? fin.reply : "";
  return {
    texto: [deltas, reply].filter(Boolean).join("\n"),
    herramientas: eventos.filter((evento) => evento.type === "herramienta" && evento.estado === "ejecutando").map((evento) => String(evento.nombre)),
    plan: Boolean(fin?.plan),
    modelo: typeof fin?.modelo === "string" ? fin.modelo : undefined,
    error: error ? `${String(error.code)}: ${String(error.error)}` : respuesta.ok ? undefined : `HTTP ${respuesta.status}`,
    brief: fin?.brief ?? brief,
  };
}

async function main(): Promise<void> {
  const base = argumento("--base") ?? "http://127.0.0.1:3100";
  const suite = SuiteSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "eval", "chat", "jerga-v001.json"), "utf8")));
  const solo = argumento("--solo")?.split(",");
  const casos = solo ? suite.casos.filter((caso) => solo.includes(caso.id)) : suite.casos;
  const promptVersion = createHash("sha256").update(construirSistema({ ragEnabled: true })).digest("hex").slice(0, 16);
  const cookie = await login(base);
  const resultados = [];
  for (const caso of casos) {
    const inicio = Date.now();
    const mensajes: Array<{ role: "user" | "assistant"; content: string }> = [{ role: "user", content: caso.mensaje }];
    const primero = await turno(base, cookie, mensajes, {}, caso.loraMode);
    const turnos: Turno[] = [primero];
    if (!primero.plan && !primero.error && primero.texto.trim()) {
      mensajes.push({ role: "assistant", content: primero.texto.split("\n").pop() || primero.texto }, { role: "user", content: "Sí, avanza con lo que propones y arma la propuesta." });
      turnos.push(await turno(base, cookie, mensajes, primero.brief, caso.loraMode));
    }
    const jerga = [...new Set(turnos.flatMap((t) => detectarJergaInterna(t.texto)))];
    const resultado = {
      id: caso.id,
      ok: jerga.length === 0 && turnos.every((t) => !t.error),
      jerga,
      errores: turnos.map((t) => t.error).filter(Boolean),
      herramientas: turnos.map((t) => t.herramientas),
      plan: turnos.some((t) => t.plan),
      modelo: turnos.find((t) => t.modelo)?.modelo,
      segundos: Math.round((Date.now() - inicio) / 1000),
      respuestas: turnos.map((t) => t.texto),
    };
    resultados.push(resultado);
    console.log(`${resultado.ok ? "PASS" : "FAIL"} ${caso.id} (${resultado.segundos}s, plan=${resultado.plan}, herramientas=${resultado.herramientas.flat().join(",") || "-"})${jerga.length ? ` jerga=${jerga.join("; ")}` : ""}${resultado.errores.length ? ` errores=${resultado.errores.join("; ")}` : ""}`);
  }
  const salida = argumento("--salida") ?? path.join(tmpdir(), `eval-chat-${suite.version}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const informe = { suite: suite.version, fecha: new Date().toISOString(), base, prompt_version: promptVersion, modelo: resultados.find((r) => r.modelo)?.modelo ?? null, pasan: resultados.filter((r) => r.ok).length, total: resultados.length, resultados };
  writeFileSync(salida, `${JSON.stringify(informe, null, 2)}\n`, "utf8");
  console.log(`\n${informe.pasan}/${informe.total} sin jerga · modelo=${informe.modelo} · prompt=${promptVersion} · informe: ${salida}`);
  process.exitCode = informe.pasan === informe.total ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});
