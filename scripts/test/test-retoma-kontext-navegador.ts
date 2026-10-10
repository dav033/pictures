/**
 * El navegador retoma una imagen de Kontext que sigue en curso (P-038), sin pagar otra. Sin red y sin coste: `fetch` y las pausas son dobles.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-retoma-kontext-navegador.ts
 *
 * - ante un 202 con token se repite la MISMA petición con `x-solicitud-kontext`, con una pausa antes de cada retoma, hasta el máximo;
 * - una retoma que falla por la red o por un 5xx se repite con el mismo token (con pausa) y, si no sale, el token SE CONSERVA: el próximo
 *   «Reintentar» retoma la solicitud ya pagada en vez de enviar otra (la guiada y el Taller);
 * - un token que el servidor ya no acepta (409 `SOLICITUD_KONTEXT_INVALIDA`) se suelta y se pide una imagen nueva;
 * - el token se suelta al recibir la imagen y vale solo para el MISMO cuerpo (otra vista, otro plan u otro aspecto no lo reciben);
 * - el token persiste en sessionStorage: tras una recarga la imagen se retoma en vez de pagarse otra vez; sin almacenamiento todo sigue;
 * - `post-reanudable.ts` no usa `Response.json` estático (Safari antiguo).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ErrorImagen, pedirImagenConRecuperacion, type DependenciasImagen } from "../../src/lib/generacion/pedir-imagen";
import { postReanudable } from "../../src/lib/generacion/post-reanudable";
import { CLAVE_ALMACEN_RETOMA, claveDeRetoma, guardarTokenDeRetoma, MAX_REINTENTOS_DE_RETOMA, olvidarMemoriaDeRetoma, PAUSA_ENTRE_RETOMAS_MS, tokenDeRetoma, VIDA_TOKEN_EN_NAVEGADOR_MS } from "../../src/lib/generacion/retoma-kontext";
import { CABECERA_SOLICITUD_KONTEXT, MAX_REANUDACIONES_KONTEXT } from "../../src/lib/generacion/solicitud-kontext-contrato";

const IMAGEN = `data:image/png;base64,${Buffer.from("png-simulado").toString("base64")}`;
const json = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const enCurso = (n: number) => json({ estado: "en_curso", codigo: "KONTEXT_EN_CURSO", solicitud_kontext: `token-${n}` }, 202);
const lista = () => json({ imagen: IMAGEN }, 200);
const invalido = () => json({ error: "no sirve", codigo: "SOLICITUD_KONTEXT_INVALIDA" }, 409);
const CUERPO_1 = JSON.stringify({ v: 1 });
const CUERPO_2 = JSON.stringify({ v: 2 });
const CUERPO_3 = JSON.stringify({ v: 3 });
const CUERPO_4 = JSON.stringify({ v: 4 });
const CUERPO_5 = JSON.stringify({ v: 5 });
const CUERPO_6 = JSON.stringify({ v: 6 });
const CUERPO_7 = JSON.stringify({ v: 7 });
const RED = Symbol("corte de red");

type Paso = Response | typeof RED;
/** Un `fetch` que responde en orden lo que se le da (o se corta, o lanza si se acabaron) y anota el token de cada petición. */
function doble(pasos: Paso[]) {
  const tokens: Array<string | undefined> = [];
  const pausas: number[] = [];
  const fetchDoble = async (_entrada: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "GET") return json({}, 503);
    tokens.push((init?.headers as Record<string, string>)[CABECERA_SOLICITUD_KONTEXT]);
    const paso = pasos.shift();
    if (paso === undefined) throw new Error("el doble se quedó sin respuestas");
    if (paso === RED) throw new TypeError("Failed to fetch");
    return paso;
  };
  return { fetchDoble, tokens, pausas, esperar: async (ms: number) => { pausas.push(ms); } };
}

let pruebas = 0;
async function prueba(nombre: string, cuerpo: () => Promise<void>): Promise<void> {
  await cuerpo();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

/** El cuerpo de la petición de la guiada: plan y captura de la vista. */
const cuerpoGuiada = (planHash: string, captura = "captura-1") => ({ plan_hash: planHash, captura });
const RUTA_GUIADA = "/api/guiada/motor/imagen";
const pedirGuiada = (planHash: string, d: ReturnType<typeof doble>, captura?: string) => {
  const dependencias: Partial<DependenciasImagen> = { fetch: d.fetchDoble, nuevoId: () => "solicitud-1", esperar: d.esperar, ahora: () => 0 };
  return pedirImagenConRecuperacion({ ruta: RUTA_GUIADA, cuerpo: cuerpoGuiada(planHash, captura), planHash, senal: new AbortController().signal, limiteIntentoMs: 125_000, reintentoSilencioso: false, dependencias });
};
const claveGuiada = (planHash: string, captura?: string) => claveDeRetoma(RUTA_GUIADA, JSON.stringify(cuerpoGuiada(planHash, captura)));

async function main() {
  await prueba("Taller: repite la misma petición con el último token, con pausa antes de cada retoma, y se rinde con un mensaje tras el máximo", async () => {
    const d = doble([enCurso(1), enCurso(2), lista()]);
    const respuesta = await postReanudable("/r", CUERPO_1, { fetch: d.fetchDoble, esperar: d.esperar });
    assert.equal(respuesta.status, 200);
    assert.deepEqual(d.tokens, [undefined, "token-1", "token-2"], "la primera sin token; cada retoma lleva el último");
    assert.deepEqual(d.pausas, [PAUSA_ENTRE_RETOMAS_MS, PAUSA_ENTRE_RETOMAS_MS], "una pausa antes de cada retoma");
    assert.equal(tokenDeRetoma(claveDeRetoma("/r", CUERPO_1)), undefined, "con la imagen en la mano el token se suelta");

    const sinFin = doble(Array.from({ length: MAX_REANUDACIONES_KONTEXT + 1 }, (_, n) => enCurso(10 + n)));
    const agotada = await postReanudable("/r", CUERPO_2, { fetch: sinFin.fetchDoble, esperar: sinFin.esperar });
    assert.equal(agotada.status, 504);
    assert.match((await agotada.json() as { error: string }).error, /tardando más de lo normal/);
    assert.equal(sinFin.tokens.length, MAX_REANUDACIONES_KONTEXT + 1, "no retoma sin fin");
    assert.equal(tokenDeRetoma(claveDeRetoma("/r", CUERPO_2)), `token-${10 + MAX_REANUDACIONES_KONTEXT}`, "agotadas las retomas el token se conserva");

    const rota = doble([json({}, 202)]);
    assert.equal((await postReanudable("/r", CUERPO_3, { fetch: rota.fetchDoble, esperar: rota.esperar })).status, 504, "un 202 sin token no se queda esperando");
  });

  await prueba("Taller: una retoma que falla por la red o por un 5xx se repite con el MISMO token; si no sale, el token se conserva y el próximo clic retoma", async () => {
    const d = doble([enCurso(1), RED, json({}, 503), RED]);
    const sinSalida = await postReanudable("/r", CUERPO_4, { fetch: d.fetchDoble, esperar: d.esperar }).then(() => null, (e: unknown) => e);
    assert.ok(sinSalida instanceof TypeError, "agotados los reintentos de la retoma el error llega a quien llama (la interfaz lo traduce)");
    assert.deepEqual(d.tokens, [undefined, "token-1", "token-1", "token-1"], `la primera petición y ${MAX_REINTENTOS_DE_RETOMA + 1} con el mismo token`);
    assert.equal(MAX_REINTENTOS_DE_RETOMA, 2);
    assert.equal(tokenDeRetoma(claveDeRetoma("/r", CUERPO_4)), "token-1", "el token NO se perdió");

    const otro = doble([lista()]);
    assert.equal((await postReanudable("/r", CUERPO_4, { fetch: otro.fetchDoble, esperar: otro.esperar })).status, 200);
    assert.deepEqual(otro.tokens, ["token-1"], "el próximo clic retoma con el token guardado en vez de enviar una solicitud nueva");
    assert.equal(tokenDeRetoma(claveDeRetoma("/r", CUERPO_4)), undefined);

    const repetido = doble([enCurso(7), json({}, 503), lista()]);
    assert.equal((await postReanudable("/r", CUERPO_5, { fetch: repetido.fetchDoble, esperar: repetido.esperar })).status, 200, "un 503 aislado en la retoma se repite y sale");
    assert.deepEqual(repetido.tokens, [undefined, "token-7", "token-7"]);
  });

  await prueba("Taller: un token que el servidor ya no acepta (409 SOLICITUD_KONTEXT_INVALIDA) se suelta y se pide una imagen nueva; otro 409 no", async () => {
    const d = doble([enCurso(1), invalido(), lista()]);
    assert.equal((await postReanudable("/r", CUERPO_6, { fetch: d.fetchDoble, esperar: d.esperar })).status, 200);
    assert.deepEqual(d.tokens, [undefined, "token-1", undefined], "tras el 409 la tercera petición va SIN token");
    const otro = doble([enCurso(1), json({ error: "x", codigo: "OTRO" }, 409)]);
    assert.equal((await postReanudable("/r", CUERPO_7, { fetch: otro.fetchDoble, esperar: otro.esperar })).status, 409);
  });

  await prueba("guiada: una retoma que falla se repite con el mismo token; si no sale el token se conserva y el próximo «Reintentar» retoma en vez de pagar otra imagen", async () => {
    const d = doble([enCurso(1), RED, json({}, 502), RED]);
    const error = await pedirGuiada("plan-a", d).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof ErrorImagen && error.clase === "red");
    assert.deepEqual(d.tokens, [undefined, "token-1", "token-1", "token-1"]);
    assert.equal(tokenDeRetoma(claveGuiada("plan-a")), "token-1", "el token se conservó");

    const reintentar = doble([lista()]);
    const salida = await pedirGuiada("plan-a", reintentar);
    assert.equal(salida.via, "directa");
    assert.deepEqual(reintentar.tokens, ["token-1"], "«Reintentar» retoma con el token guardado: no es una petición nueva sin token");
    assert.equal(tokenDeRetoma(claveGuiada("plan-a")), undefined, "con la imagen el token se suelta");

    const otroPlan = doble([lista()]);
    await pedirGuiada("plan-b", otroPlan);
    assert.deepEqual(otroPlan.tokens, [undefined], "el token de un plan no se usa para otro");
  });

  await prueba("guiada: pausa antes de cada retoma, agotadas las retomas es un «tiempo» con el token guardado, y un token vencido pide una imagen nueva", async () => {
    const d = doble([enCurso(1), enCurso(2), lista()]);
    assert.equal((await pedirGuiada("plan-c", d)).intentos, 1, "retomar no cuenta como otro intento");
    assert.deepEqual(d.pausas, [PAUSA_ENTRE_RETOMAS_MS, PAUSA_ENTRE_RETOMAS_MS]);

    const sinFin = doble(Array.from({ length: MAX_REANUDACIONES_KONTEXT + 1 }, (_, n) => enCurso(20 + n)));
    const agotada = await pedirGuiada("plan-d", sinFin).then(() => null, (e: unknown) => e);
    assert.ok(agotada instanceof ErrorImagen && agotada.clase === "tiempo", "tras el máximo, el cliente decide con «Reintentar»");
    assert.equal(sinFin.tokens.length, MAX_REANUDACIONES_KONTEXT + 1, "las retomas, no más");
    assert.equal(tokenDeRetoma(claveGuiada("plan-d")), `token-${20 + MAX_REANUDACIONES_KONTEXT}`);

    const vencido = doble([enCurso(1), invalido(), lista()]);
    assert.equal((await pedirGuiada("plan-e", vencido)).via, "directa");
    assert.deepEqual(vencido.tokens, [undefined, "token-1", undefined], "el 409 suelta el token y la tercera petición va sin él");
  });

  await prueba("una vista distinta (otra captura u otro plan) no recibe el token de la anterior: el token es del MISMO cuerpo", async () => {
    const d = doble([enCurso(1), RED, RED, RED]);
    await pedirGuiada("plan-v", d, "captura-1").then(() => null, () => null);
    assert.equal(tokenDeRetoma(claveGuiada("plan-v", "captura-1")), "token-1");
    assert.equal(tokenDeRetoma(claveGuiada("plan-v", "captura-2")), undefined, "otra captura del mismo plan: otra clave");
    const otra = doble([lista()]);
    await pedirGuiada("plan-v", otra, "captura-2");
    assert.deepEqual(otra.tokens, [undefined], "la vista nueva se pide sin token");
    assert.equal(tokenDeRetoma(claveGuiada("plan-v", "captura-1")), "token-1", "y el token de la vista anterior sigue esperando su clic");

    const taller = doble([enCurso(8), RED, RED, RED]);
    const cuerpoA = JSON.stringify({ render: "captura-a", aspecto: "3:2" });
    await postReanudable("/r", cuerpoA, { fetch: taller.fetchDoble, esperar: taller.esperar }).then(() => null, () => null);
    const otraVista = doble([lista(), lista()]);
    await postReanudable("/r", JSON.stringify({ render: "captura-b", aspecto: "3:2" }), { fetch: otraVista.fetchDoble, esperar: otraVista.esperar });
    await postReanudable("/r", JSON.stringify({ render: "captura-a", aspecto: "16:9" }), { fetch: otraVista.fetchDoble, esperar: otraVista.esperar });
    assert.deepEqual(otraVista.tokens, [undefined, undefined], "otra captura u otro aspecto se piden sin el token");
    assert.equal(tokenDeRetoma(claveDeRetoma("/r", cuerpoA)), "token-8");
  });

  await prueba("el token persiste en sessionStorage: tras recargar la pestaña la imagen se retoma en vez de pagarse otra; sin almacenamiento todo sigue", async () => {
    const guardado = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const falso = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => { guardado.set(k, v); }, removeItem: (k: string) => { guardado.delete(k); } };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: falso });
    try {
      const d = doble([enCurso(1), RED, RED, RED]);
      await pedirGuiada("plan-r", d).then(() => null, () => null);
      assert.ok(guardado.get(CLAVE_ALMACEN_RETOMA)?.includes("token-1"), "el token quedó en sessionStorage");

      olvidarMemoriaDeRetoma(); // la pestaña se recarga: la memoria se pierde, sessionStorage no
      const trasRecargar = doble([lista()]);
      assert.equal((await pedirGuiada("plan-r", trasRecargar)).via, "directa");
      assert.deepEqual(trasRecargar.tokens, ["token-1"], "tras la recarga se retoma con el token guardado: no es una petición nueva sin token");
      assert.equal(JSON.parse(guardado.get(CLAVE_ALMACEN_RETOMA)!)[claveGuiada("plan-r")], undefined, "con la imagen el token sale de sessionStorage");

      // Un token vencido que quedó guardado no se manda, y soltar uno no borra los demás.
      const ahora = Date.now();
      guardarTokenDeRetoma("otra|clave", "token-vivo", ahora);
      guardarTokenDeRetoma("vencida|clave", "token-viejo", ahora - VIDA_TOKEN_EN_NAVEGADOR_MS - 1_000);
      olvidarMemoriaDeRetoma();
      assert.equal(tokenDeRetoma("vencida|clave"), undefined);
      assert.equal(tokenDeRetoma("otra|clave"), "token-vivo");
      olvidarMemoriaDeRetoma();
      await pedirGuiada("plan-s", doble([lista()]));
      assert.equal((JSON.parse(guardado.get(CLAVE_ALMACEN_RETOMA)!) as Record<string, { token: string }>)["otra|clave"]?.token, "token-vivo", "soltar un token tras una recarga no borra los demás");
    } finally {
      if (original) Object.defineProperty(globalThis, "sessionStorage", original); else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      olvidarMemoriaDeRetoma();
    }

    // Un almacenamiento que lanza (modo privado, bloqueado): nada se rompe y queda la memoria de la pestaña.
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    try {
      const d = doble([enCurso(1), RED, RED, RED]);
      await pedirGuiada("plan-p", d).then(() => null, () => null);
      assert.equal(tokenDeRetoma(claveGuiada("plan-p")), "token-1", "sin sessionStorage el token sigue en la memoria de la pestaña");
    } finally {
      delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      olvidarMemoriaDeRetoma();
    }
  });

  await prueba("post-reanudable.ts no usa Response.json estático (Safari antiguo)", async () => {
    const codigo = readFileSync(path.resolve(__dirname, "..", "..", "src", "lib", "generacion", "post-reanudable.ts"), "utf8");
    assert.doesNotMatch(codigo.replace(/\/\*[\s\S]*?\*\//g, ""), /Response\.json\(/);
  });

  console.log(`\n${pruebas} pruebas ok`);
}

main().catch((error) => { console.error(error); process.exit(1); });
