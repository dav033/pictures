/**
 * Arnés de entrenamiento (W4) con el transporte `cli` (Claude Code por la suscripción), con un proceso hijo FALSO: sin red ni
 * llamadas reales. Comprueba que el paro de la pasada llega al subproceso: la señal de aborto mata los `claude` en curso, el que
 * esperaba turno no se lanza y, aunque alguien no propague la señal, la guarda de procesos no deja lanzar otro.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-cli.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-cli-"));
delete process.env.DATABASE_URL;
Object.assign(process.env, { REGISTRO_ACTIVO: "1", REGISTRO_DIR: path.join(tmp, "registro"), REGISTRO_NIVEL_STDOUT: "error" });

type Proceso = { cwd: string; matado: boolean };
type Guion = "colgar" | string[];

async function main(): Promise<void> {
  let pruebas = 0;
  const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

  const { crearClienteClaudeCli } = await import("../../src/lib/ia/claude/cli/cliente");
  const { crearCupo } = await import("../../src/lib/ia/claude/cli/cupo");
  const { envolverClienteAnthropic } = await import("../../src/lib/registro/envoltorios-anthropic");
  const { ContadorLlamadas } = await import("../entrenamiento/lib-contador");
  const { CupoGasto } = await import("../entrenamiento/lib-cupo-gasto");
  const { instalarGuardaProcesos } = await import("../entrenamiento/lib-procesos-cli");

  const INIT = JSON.stringify({ type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], model: "claude-haiku-5-5" });
  const RESULTADO = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", session_id: "s1", usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { "claude-haiku-5-5": {} }, num_turns: 1, duration_ms: 100, duration_api_ms: 90 });
  const OK: Guion = [INIT, RESULTADO];
  const cuerpo = { model: "haiku", max_tokens: 1000, thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const }, messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hola" }] }] };

  /** Un `claude` falso: al recibir la línea de entrada responde con el guion de su turno (o se cuelga); se cierra al cerrar stdin o al matarlo. */
  function lanzadorFalso(guiones: Guion[]) {
    const procesos: Proceso[] = [];
    const lanzar: import("../../src/lib/ia/claude/cli/proceso").LanzarProceso = (_ejecutable, _argumentos, { cwd }) => {
      const guion = guiones[procesos.length] ?? "colgar";
      const proceso: Proceso = { cwd, matado: false };
      procesos.push(proceso);
      const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough();
      let cerrar: (codigo: number | null) => void = () => undefined;
      const terminado = new Promise<number | null>((resolve) => { cerrar = resolve; });
      const terminar = (codigo: number | null) => { stdout.once("end", () => cerrar(codigo)); stdout.end(); stderr.end(); };
      stdin.setEncoding("utf8");
      stdin.once("data", () => { if (guion !== "colgar") for (const linea of guion) stdout.write(`${linea}\n`); });
      stdin.on("finish", () => terminar(0));
      return { stdin, stdout, stderr, terminado, matar: () => { proceso.matado = true; terminar(null); } };
    };
    return { lanzar, procesos };
  }

  const cliente = (lanzar: import("../../src/lib/ia/claude/cli/proceso").LanzarProceso, cupo?: ReturnType<typeof crearCupo>) =>
    envolverClienteAnthropic(crearClienteClaudeCli({ ejecutable: "claude-falso", lanzar, entorno: { NODE_ENV: "development", PATH: "/bin" }, plazoMs: 60_000, ...(cupo ? { cupo } : {}) }), { proposito: "prueba_entrenamiento_cli", transporte: "cli" });
  const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
  const hasta = async (condicion: () => boolean, descripcion: string) => {
    for (let i = 0; i < 200 && !condicion(); i += 1) await esperar(10);
    assert.ok(condicion(), descripcion);
  };

  console.log("Paro de la pasada con el transporte cli (arnés W4):");

  await prueba("al llegar al máximo de llamadas la señal de aborto mata los claude que seguían corriendo", async () => {
    const { lanzar, procesos } = lanzadorFalso([ "colgar", "colgar", OK ]);
    const contador = new ContadorLlamadas(new CupoGasto(1), 1, "cli");
    const controlador = new AbortController();
    contador.vigilar(controlador);
    contador.activar();
    try {
      const claude = cliente(lanzar, crearCupo(3));
      const llamar = () => claude.messages.create(cuerpo, { signal: controlador.signal });
      const colgadas = [llamar(), llamar()].map((p) => p.then(() => "ok", (e: unknown) => (e as Error).name));
      await hasta(() => procesos.length === 2, "dos procesos corriendo");
      await llamar();
      assert.match(contador.paro ?? "", /máximo de llamadas \(1\)/);
      assert.deepEqual(await Promise.all(colgadas), ["AbortError", "AbortError"]);
      assert.deepEqual(procesos.map((p) => p.matado), [true, true, false], "los dos colgados murieron; el que terminó solo, no");
      await esperar(20);
      assert.ok(procesos.every((p) => !existsSync(p.cwd)), "las carpetas temporales se borran");
      assert.equal(contador.gastado, 0, "la suscripción no cuesta por llamada");
      assert.equal(contador.errores, 2);
    } finally {
      contador.desactivar();
    }
  });

  await prueba("--max-llamadas es exacto con cli: el turno que libera la llamada que cierra no lanza un proceso de más", async () => {
    const { lanzar, procesos } = lanzadorFalso([ "colgar", "colgar", OK ]);
    const restaurar = instalarGuardaProcesos(() => null, 3);
    const sostener = new AbortController();
    try {
      const claude = cliente(lanzar);
      const colgadas = [1, 2].map(() => claude.messages.create(cuerpo, { signal: sostener.signal }).then(() => "ok", (e: unknown) => (e as Error).name));
      await hasta(() => procesos.length === 2, "dos procesos corriendo");
      await claude.messages.create(cuerpo);
      const cuarta = await claude.messages.create(cuerpo).then(() => "ok", (e: unknown) => (e as Error).message);
      assert.match(cuarta, /máximo de llamadas \(3\) alcanzado/);
      await esperar(30);
      assert.equal(procesos.length, 3, "solo tres procesos lanzados");
      sostener.abort();
      assert.deepEqual(await Promise.all(colgadas), ["AbortError", "AbortError"]);
    } finally {
      restaurar();
    }
  });

  await prueba("la guarda de procesos no deja lanzar claude con la pasada detenida, ni al que esperaba turno ni a una llamada sin señal", async () => {
    const { lanzar, procesos } = lanzadorFalso([ "colgar", "colgar", "colgar", OK ]);
    let motivo: string | null = null;
    const restaurar = instalarGuardaProcesos(() => motivo, 99);
    try {
      const claude = cliente(lanzar);
      const ocupan = new AbortController();
      const ocupando = [1, 2, 3].map(() => claude.messages.create(cuerpo, { signal: ocupan.signal }).then(() => "ok", (e: unknown) => (e as Error).name));
      await hasta(() => procesos.length === 3, "el cupo compartido llena sus tres procesos");
      const enCola = claude.messages.create(cuerpo).then(() => "ok", (e: unknown) => (e as Error).message);
      await esperar(20);
      motivo = "Tope de gasto de la pasada superado";
      ocupan.abort();
      assert.deepEqual(await Promise.all(ocupando), ["AbortError", "AbortError", "AbortError"]);
      assert.match(await enCola, /pasada detenida.*Tope de gasto/, "el que esperaba obtuvo turno, pero la guarda lo devolvió sin lanzar nada");
      const nueva = await claude.messages.create(cuerpo).then(() => "ok", (e: unknown) => (e as Error).message);
      assert.match(nueva, /pasada detenida/);
      assert.equal(procesos.length, 3, "ningún proceso nuevo tras el paro");
    } finally {
      restaurar();
    }
  });

  await prueba("al restaurar, el cupo vuelve a ser el compartido de la app y sin paro la guarda no estorba", async () => {
    const { lanzar, procesos } = lanzadorFalso([OK, OK]);
    const compartido = globalThis.__cupoClaudeCli;
    const restaurar = instalarGuardaProcesos(() => null, 10);
    assert.notEqual(globalThis.__cupoClaudeCli, compartido);
    const claude = cliente(lanzar);
    assert.ok((await claude.messages.create(cuerpo)).content.length > 0);
    restaurar();
    assert.equal(globalThis.__cupoClaudeCli, compartido);
    await claude.messages.create(cuerpo);
    assert.equal(procesos.length, 2);
  });

  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pruebas} pruebas del paro con el transporte cli: OK`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
