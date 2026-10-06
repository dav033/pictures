/**
 * Etapa (b) del rastreador (FUERA del repo): plan -> prompt de imagen / caption FLUX / guia de escena,
 * SIN llamar a ningun modelo de imagen.
 *
 * Ejecuta el handler REAL de /api/generate (`POST` de src/app/api/generate/route.ts) con el plan resuelto y firmado
 * que dejo la etapa (a) (`plan-resuelto.json`, con su `approval_token`). El unico punto cortado es la red hacia el
 * proveedor de imagen: `globalThis.fetch` se intercepta y toda peticion a fal.ai / modelo de imagen de Gemini se
 * captura (prompt, parametros, imagenes de guia) y se aborta ANTES de salir. Nada se factura.
 *
 *   modo "flux"   : usarLora=true, loraMode="base" (FLUX.2 base, el camino de las capturas) -> caption + guia de escena
 *   modo "gemini" : usarLora=false, proveedor gemini -> buildImagePrompt (prompt de Gemini)
 *
 * Postgres: el pool es de SOLO LECTURA (INSERT/UPDATE/DELETE se cuentan y se descartan).
 *
 *   cd <repo> && npx tsx --env-file=.env.local --conditions=react-server <este archivo> --casos 1,3,4,6,8 --corridas 3
 */
import { DATOS } from "../rutas";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const LB = `${DATOS}/linea-base`;
const SALIDA = (() => { const i = process.argv.indexOf("--salida"); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : `${DATOS}/validacion-fase4/planes`; })();
/** Fase 5: deja pasar como mucho `--max-imagenes` llamadas reales a Gemini-imagen (cada una se factura). */
const GENERAR = process.argv.includes("--generar");
const imp = (rel: string) => import(pathToFileURL(resolve(REPO, rel)).href);
const arg = (n: string, d: string) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };

class CapturaImagen extends Error { constructor(readonly destino: string) { super(`TRAZADO_CAPTURA: peticion a ${destino} capturada y abortada (no se factura)`); this.name = "CapturaImagen"; } }

async function main(): Promise<void> {
  const casos = arg("--casos", "1,3,4,6,8").split(",").map(Number);
  const corridas = Number(arg("--corridas", "3"));
  const modos = arg("--modos", "flux,gemini").split(",");
  const maxImagenes = Number(arg("--max-imagenes", "0"));
  let pasadas = 0;

  // Pool de solo lectura sobre el catalogo real.
  const { Pool } = await import(pathToFileURL(resolve(REPO, "node_modules/pg/lib/index.js")).href).then((m) => (m.default ?? m) as typeof import("pg"));
  const real = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 8000 });
  delete process.env.DATABASE_URL;
  const bloqueadas: Record<string, number> = {};
  (globalThis as { __ragPool?: unknown }).__ragPool = {
    query: async (sql: string, params?: unknown[]) => {
      const verbo = String(sql).trim().split(/\s+/)[0]!.toUpperCase();
      if (["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE"].includes(verbo)) {
        const tabla = /(?:INTO|UPDATE|FROM)\s+([a-z_\.]+)/i.exec(String(sql))?.[1] ?? "?";
        bloqueadas[`${verbo} ${tabla}`] = (bloqueadas[`${verbo} ${tabla}`] ?? 0) + 1;
        return { rows: [], rowCount: 0 };
      }
      return real.query(sql, params as never);
    },
    connect: async () => { throw new Error("pool de solo lectura: connect() no disponible"); },
    on: () => undefined,
    end: async () => undefined,
  };

  await imp("src/lib/ia/nucleo/telemetria-llamadas.ts");
  const core = await import(pathToFileURL(resolve(REPO, "packages/agente-core/src/index.ts")).href) as { configurarPersistenciaTelemetria: (x: undefined) => void };
  core.configurarPersistenciaTelemetria(undefined);

  // Interceptor: nada llega a un modelo de imagen.
  const fetchOriginal = globalThis.fetch;
  let captura: { destino: string; url: string; metodo: string; cuerpo: string } | null = null;
  const bloqueos: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).hostname;
    // Fase 5 con fal.ai: la petición pasa INTACTA (leer su cuerpo lo consume y fal recibía una petición vacía:
    // «fetch failed»). Solo un envío a la cola (POST a queue.fal.run) es una imagen facturable y cuenta para el tope.
    if (GENERAR && /(^|\.)fal\.(run|ai|media)$/.test(host)) {
      const metodo = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (metodo === "POST" && host === "queue.fal.run") {
        if (pasadas >= maxImagenes) { bloqueos.push(`POST ${host}`); throw new CapturaImagen("fal.ai (tope)"); }
        pasadas += 1;
        // Punto 3 del plan (evaluación): fuerza de la guía y pasos de /edit sin tocar el prompt.
        const guidance = arg("--guidance", ""), pasos = arg("--pasos", "");
        if ((guidance || pasos) && typeof init?.body === "string") {
          const cuerpoJson = JSON.parse(init.body) as Record<string, unknown>;
          if (guidance) cuerpoJson.guidance_scale = Number(guidance);
          if (pasos) cuerpoJson.num_inference_steps = Number(pasos);
          init = { ...init, body: JSON.stringify(cuerpoJson) };
        }
        console.log(`[generar] envío real a fal.ai ${pasadas}/${maxImagenes}`);
        captura = { destino: "fal", url: url.replace(/\?.*$/, ""), metodo, cuerpo: typeof init?.body === "string" ? init.body : "" };
      }
      return fetchOriginal(input, init);
    }
    let cuerpo = typeof init?.body === "string" ? init.body : "";
    if (!cuerpo && typeof Request !== "undefined" && input instanceof Request) cuerpo = await input.clone().text().catch(() => "");
    if (!cuerpo && init?.body && typeof init.body !== "string") { try { cuerpo = await new Response(init.body as BodyInit).text(); } catch { cuerpo = ""; } }
    const metodoReal = init?.method ?? (input instanceof Request ? input.method : "GET");
    const esFal = /(^|\.)fal\.(run|ai|media)$/.test(host);
    const esGeminiImagen = host === "generativelanguage.googleapis.com" && (/image/i.test(url) || /\/interactions/.test(url) || /"responseModalities"\s*:\s*\[[^\]]*IMAGE/i.test(cuerpo));
    if (esFal || esGeminiImagen) {
      if (!captura || (cuerpo.length > captura.cuerpo.length)) captura = { destino: esFal ? "fal" : "gemini-image", url: url.replace(/\?.*$/, ""), metodo: metodoReal, cuerpo };
      if (GENERAR && esGeminiImagen && pasadas < maxImagenes) {
        pasadas += 1;
        console.log(`[generar] llamada real a Gemini-imagen ${pasadas}/${maxImagenes}`);
        return fetchOriginal(input, init);
      }
      bloqueos.push(`${metodoReal} ${host}`);
      throw new CapturaImagen(esFal ? "fal.ai" : "gemini-image");
    }
    return fetchOriginal(input, init);
  }) as typeof fetch;

  const { POST } = await imp("src/app/api/generate/route.ts");

  for (const c of casos) for (let k = 1; k <= corridas; k += 1) {
    const base = `${SALIDA}/caso-${c}/corrida-${k}`;
    if (!existsSync(`${base}/plan-resuelto.json`)) { console.log(`[sin plan] caso ${c} corrida ${k}`); continue; }
    const plan = JSON.parse(readFileSync(`${base}/plan-resuelto.json`, "utf8"));
    const blueprint = JSON.parse(readFileSync(`${base}/blueprint.json`, "utf8"));
    const imagen = { base64: readFileSync(`${arg("--img-dir", `${LB}/sin-etiquetas`)}/case-00${c}-ref.png`).toString("base64"), mime: "image/png" };
    for (const modo of modos) {
      const dir = `${base}/imagen-${modo}`;
      if (existsSync(`${dir}/resumen.json`)) continue;
      mkdirSync(dir, { recursive: true });
      captura = null; bloqueos.length = 0;
      const cuerpo = {
        plan, planHash: plan.plan_hash, brief: {}, solicitudUsuario: "Adjunto imágenes de referencia del estilo que busco.",
        imagenesReferencia: [imagen], blueprint,
        ...(modo === "flux" ? { usarLora: true, loraMode: "base" } : { usarLora: false, proveedor: "gemini" }),
      };
      const logs: string[] = [];
      const infoOrig = console.info, warnOrig = console.warn;
      console.info = (...a: unknown[]) => { logs.push("INFO " + a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 1500)); };
      console.warn = (...a: unknown[]) => { logs.push("WARN " + a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ").slice(0, 1500)); };
      let status = 0, respuesta: unknown = null;
      try {
        const res = await POST(new Request("http://localhost/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
        status = res.status;
        respuesta = await res.json().catch(() => null);
      } catch (e) { respuesta = { excepcion: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }; }
      finally { console.info = infoOrig; console.warn = warnOrig; }
      const cap = captura as { destino: string; url: string; metodo: string; cuerpo: string } | null;
      let capturado: unknown = null;
      if (cap) {
        let json: unknown = null; try { json = JSON.parse(cap.cuerpo); } catch { /* no JSON */ }
        const imagenes: string[] = [];
        const guardar = (data: string, etiqueta: string) => {
          const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
          if (!m) return data;
          const ext = m[1]!.includes("png") ? "png" : m[1]!.includes("jpeg") ? "jpg" : "bin";
          const archivo = `${dir}/${etiqueta}-${imagenes.length + 1}.${ext}`;
          writeFileSync(archivo, Buffer.from(m[2]!, "base64"));
          imagenes.push(archivo.replace(`${SALIDA}/`, ""));
          return `[imagen guardada: ${archivo.replace(`${SALIDA}/`, "")} ${m[2]!.length} b64]`;
        };
        const limpiar = (v: unknown): unknown => typeof v === "string" ? (v.startsWith("data:") ? guardar(v, "entrada") : v) : Array.isArray(v) ? v.map(limpiar) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([kk, vv]) => [kk, (kk === "data" && typeof vv === "string" && vv.length > 2000) ? guardar(`data:image/png;base64,${vv}`, "entrada") : limpiar(vv)])) : v;
        capturado = { destino: cap.destino, url: cap.url, metodo: cap.metodo, cuerpo: json ? limpiar(json) : cap.cuerpo.slice(0, 4000), imagenes };
        writeFileSync(`${dir}/peticion-proveedor.json`, JSON.stringify(capturado, null, 1));
        const prompt = (json as { prompt?: string } | null)?.prompt
          ?? JSON.stringify(json).match(/"text":"((?:[^"\\]|\\.)*)"/)?.[1];
        if (typeof (json as { prompt?: unknown } | null)?.prompt === "string") writeFileSync(`${dir}/prompt.txt`, (json as { prompt: string }).prompt);
        else {
          // Gemini: concatena las partes de texto.
          const textos: string[] = [];
          const recorrer = (v: unknown) => { if (Array.isArray(v)) v.forEach(recorrer); else if (v && typeof v === "object") { for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) { if (kk === "text" && typeof vv === "string") textos.push(vv); else recorrer(vv); } } };
          recorrer(json);
          if (textos.length) writeFileSync(`${dir}/prompt.txt`, textos.join("\n\n-----\n\n"));
          void prompt;
        }
      }
      // Fase 5: la imagen final que devolvió la ruta, si se generó de verdad.
      const imagenFinal = JSON.stringify(respuesta ?? null).match(/"data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)"/);
      if (imagenFinal) writeFileSync(`${dir}/final.${imagenFinal[1] === "jpeg" ? "jpg" : imagenFinal[1]}`, Buffer.from(imagenFinal[2]!, "base64"));
      else {
        // fal devuelve una URL (fal.media): se descarga, no se factura.
        const url = JSON.stringify(respuesta ?? null).match(/"(https:\/\/[^"]*fal\.media[^"]*\.(?:png|jpe?g|webp))"/)?.[1];
        if (url) {
          const bytes = Buffer.from(await (await fetchOriginal(url)).arrayBuffer());
          writeFileSync(`${dir}/final.${url.split(".").pop()}`, bytes);
        }
      }
      writeFileSync(`${dir}/log-ruta.txt`, logs.join("\n"));
      writeFileSync(`${dir}/respuesta-ruta.json`, JSON.stringify({ status, respuesta }, null, 1).slice(0, 20000));
      const resumen = { caso: c, corrida: k, modo, status_ruta: status, captura: cap ? { destino: cap.destino, bytes_cuerpo: cap.cuerpo.length } : null, bloqueos: [...bloqueos], error: (respuesta as { error?: string; excepcion?: string } | null)?.error ?? (respuesta as { excepcion?: string } | null)?.excepcion ?? null };
      writeFileSync(`${dir}/resumen.json`, JSON.stringify(resumen, null, 1));
      console.log(`[caso ${c} #${k} ${modo}] status=${status} captura=${cap ? cap.destino : "NO"} bloqueos=${bloqueos.length} err=${String(resumen.error ?? "").slice(0, 160)}`);
    }
  }
  console.log(`[fin] escrituras a Postgres descartadas: ${JSON.stringify(bloqueadas)}`);
  await real.end();
}

main().catch((e) => { console.error(`[trazar-imagen] ${e instanceof Error ? e.stack : String(e)}`); process.exitCode = 1; });
