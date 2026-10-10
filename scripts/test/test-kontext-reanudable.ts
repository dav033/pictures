/**
 * FLUX.1 Kontext max retomable (P-038, 2026-10-09). Sin red y sin coste: fal es un `fetch` simulado.
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-kontext-reanudable.ts
 *
 * Producción: una toma de Kontext max tardó 112,9 s de inferencia y la ruta cortaba a los 105 s en total; la imagen, ya pagada, se perdía.
 * Ahora la llamada guarda el `request_id`, y si su plazo se acaba (o la red se corta) con la solicitud viva lanza `KontextEnCursoError`:
 * la ruta responde 202 con un token firmado y el navegador repite la petición, que retoma LA MISMA solicitud sin enviar otra ni gastar cupo.
 * - una finalización lenta se trae sin reenviar (un solo POST) y deja UNA fila `imagen` en la auditoría;
 * - plazo vencido → `KontextEnCursoError` con el id; retomar con `solicitudPrevia` no hace POST y trae la imagen;
 * - un corte de red tras enviar se retoma; un FAILED, un POST rechazado o una cancelación de quien llama NO;
 * - el token: válido solo para el mismo texto, vence, no se falsifica; el id debe ser de fal;
 * - la ruta del Taller: 202 con token, y al retomar no gasta cupo ni envía otra solicitud; un token malo es 409 sin llamar a fal;
 * - el navegador (guiada y Taller) repite con el token hasta `MAX_REANUDACIONES_KONTEXT` veces;
 * - el plazo de Kontext cabe en el `maxDuration` de las dos rutas con 20 s de margen.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.FAL_KEY = "clave-falsa-de-prueba";
process.env.REGISTRO_ACTIVO = "1";
process.env.REGISTRO_DIR = mkdtempSync(path.join(tmpdir(), "reg-kontext-"));
process.env.REGISTRO_AUDITORIA_STDOUT = "0";
process.env.REGISTRO_NIVEL_STDOUT = "error";
process.env.PLAN_APPROVAL_SECRET = "secreto-de-prueba";

const ID = "01a1230e-ef48-7f13-a66d-429b391007a3";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

type Estado = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "red" | "http503" | "http404" | "error_de_codigo";
type Resultado = "ok" | "http503" | "http422" | "red" | "colgado";
const escenario = { id: ID, posts: 0, sondeos: 0, resultados: 0, rechazarPost: false, resultado: "ok" as Resultado, estados: [] as Estado[], urls: [] as string[] };
function reiniciar(estados: Estado[], opciones: { rechazarPost?: boolean; id?: string; resultado?: Resultado } = {}) {
  Object.assign(escenario, { id: opciones.id ?? ID, posts: 0, sondeos: 0, resultados: 0, rechazarPost: opciones.rechazarPost ?? false, resultado: opciones.resultado ?? "ok", estados: [...estados], urls: [] });
}

globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const metodo = init?.method ?? "GET";
  escenario.urls.push(`${metodo} ${url}`);
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  if (metodo === "POST") {
    escenario.posts += 1;
    if (escenario.rechazarPost) return json({ detail: "imagen no valida" }, 422);
    return json({ request_id: escenario.id, status_url: `https://queue.fal.run/fal-ai/flux-pro/requests/${escenario.id}/status`, response_url: `https://queue.fal.run/fal-ai/flux-pro/requests/${escenario.id}` });
  }
  if (url.endsWith("/status")) {
    escenario.sondeos += 1;
    const estado = escenario.estados.length > 1 ? escenario.estados.shift()! : escenario.estados[0]!;
    if (estado === "red") throw new TypeError("fetch failed");
    if (estado === "error_de_codigo") throw new TypeError("Cannot read properties of undefined (reading 'x')");
    if (estado === "http503") return json({ detail: "bad gateway" }, 503);
    if (estado === "http404") return json({ detail: "Request not found" }, 404);
    return json({ status: estado, ...(estado === "FAILED" ? { error: "fallo del modelo" } : {}) });
  }
  if (url === `https://queue.fal.run/fal-ai/flux-pro/requests/${escenario.id}`) {
    escenario.resultados += 1;
    if (escenario.resultado === "http503") return json({ detail: "bad gateway" }, 503);
    if (escenario.resultado === "http422") return json({ detail: [{ msg: "Failed to load the image" }] }, 422);
    if (escenario.resultado === "red") throw new TypeError("fetch failed");
    if (escenario.resultado === "colgado") return new Promise<Response>((_, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(init.signal!.reason), { once: true }));
    return json({ images: [{ url: "https://v3b.fal.media/files/x.png", content_type: "image/png" }], seed: 11 });
  }
  if (url.startsWith("https://v3b.fal.media/")) return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  return json({}, 404);
}) as typeof fetch;

let pruebas = 0;
async function prueba(nombre: string, cuerpo: () => Promise<void>): Promise<void> {
  await cuerpo();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
}

const imagen = { base64: PNG.toString("base64"), mime: "image/jpeg", ancho: 1024, alto: 1024 };

async function main() {
  const { generarConFluxKontext, KontextEnCursoError, PLAZO_KONTEXT_MS, SolicitudKontextInvalidaError } = await import("../../src/lib/ia/kagutsuchi/kontext");
  const { conContexto } = await import("../../src/lib/registro/contexto");
  const { esperarRegistros } = await import("../../src/lib/registro/escritor");

  /** Las filas `imagen` de la auditoría de esa conversación: una por llamada a `generarConFluxKontext`. */
  async function filasImagen(conversacion: string) {
    await esperarRegistros();
    const raiz = path.join(process.env.REGISTRO_DIR!, "conversaciones");
    const lineas = readdirSync(raiz).flatMap((dia) => {
      try { return readFileSync(path.join(raiz, dia, `${conversacion}.jsonl`), "utf8").split("\n").filter(Boolean); } catch { return []; }
    });
    return lineas.map((l) => JSON.parse(l) as { tipo: string; datos: { error?: { mensaje?: string }; costeEstimadoUsd?: number; parametros?: Record<string, unknown>; resultado?: { proveedorRequestId?: string } } }).filter((l) => l.tipo === "imagen");
  }

  await prueba("una finalización lenta se trae sin reenviar: un solo POST, el resultado una vez y UNA fila de auditoría", async () => {
    reiniciar(["IN_QUEUE", "IN_PROGRESS", "IN_PROGRESS", "COMPLETED"]);
    const viaje: string[] = [];
    const hecha = await conContexto({ conversacion: "kontext-lenta" }, () => generarConFluxKontext("x", { imagen, variante: "max", seed: 11, plazoMs: 30_000, alEnviar: (id) => viaje.push(id) }));
    assert.equal(hecha.mime, "image/png");
    assert.equal(escenario.posts, 1, "se envía una sola solicitud");
    assert.equal(escenario.sondeos, 4);
    assert.equal(escenario.resultados, 1);
    assert.deepEqual(viaje, [ID], "el id sale apenas fal acepta la solicitud");
    const filas = await filasImagen("kontext-lenta");
    assert.equal(filas.length, 1, "una llamada, una fila `imagen`");
    assert.equal(filas[0]!.datos.error, undefined);
    assert.equal(filas[0]!.datos.costeEstimadoUsd, 0.08);
    assert.equal(filas[0]!.datos.resultado?.proveedorRequestId, ID, "la fila lleva el id de fal");
  });

  await prueba("si el plazo se acaba con la solicitud viva: KontextEnCursoError con el id; retomarla no envía otra y trae la imagen", async () => {
    reiniciar(["IN_PROGRESS"]);
    const error = await conContexto({ conversacion: "kontext-plazo" }, () => generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 2_500 }).then(() => null, (e: unknown) => e));
    assert.ok(error instanceof KontextEnCursoError, String(error));
    assert.equal(error.requestId, ID);
    assert.equal(error.codigo, "KONTEXT_EN_CURSO");
    assert.equal(escenario.posts, 1);

    escenario.estados = ["COMPLETED"];
    const hecha = await conContexto({ conversacion: "kontext-plazo" }, () => generarConFluxKontext("x", { imagen, variante: "max", solicitudPrevia: ID }));
    assert.equal(hecha.mime, "image/png");
    assert.equal(escenario.posts, 1, "retomar NO vuelve a pagar: sigue habiendo un solo POST");
    assert.ok(escenario.urls.some((u) => u === `GET https://queue.fal.run/fal-ai/flux-pro/requests/${ID}/status`), "pregunta por el id");
    const filas = await filasImagen("kontext-plazo");
    assert.equal(filas.length, 2, "una fila por llamada: el corte (error) y la retoma");
    assert.match(filas[0]!.datos.error?.mensaje ?? "", /sigue generando/);
    assert.equal(filas[0]!.datos.costeEstimadoUsd, 0.08, "el envío es el que se cobra");
    assert.equal(filas[1]!.datos.costeEstimadoUsd, 0, "la retoma no suma otra imagen");
    assert.equal(filas[1]!.datos.parametros?.retomaSolicitud, ID);
  });

  await prueba("un corte de red tras enviar también se retoma; un FAILED de fal, un POST rechazado o una cancelación, no", async () => {
    reiniciar(["red"]);
    const corte = await generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 5_000 }).then(() => null, (e: unknown) => e);
    assert.ok(corte instanceof KontextEnCursoError && corte.requestId === ID, "el corte pasajero con la solicitud viva se retoma");

    reiniciar(["FAILED"]);
    const fallo = await generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 5_000 }).then(() => null, (e: unknown) => e);
    assert.ok(fallo instanceof Error && !(fallo instanceof KontextEnCursoError) && /no pudo completar Kontext: fallo del modelo/.test(fallo.message), "FAILED es un error de verdad");

    reiniciar(["IN_PROGRESS"], { rechazarPost: true });
    const rechazo = await generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 5_000 }).then(() => null, (e: unknown) => e);
    assert.ok(rechazo instanceof Error && !(rechazo instanceof KontextEnCursoError) && /rechazó la solicitud/.test(rechazo.message), "sin id no hay nada que retomar");

    reiniciar(["IN_PROGRESS"]);
    const control = new AbortController();
    setTimeout(() => control.abort(new Error("el navegador se fue")), 600);
    const cancelada = await generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 10_000, signal: control.signal }).then(() => null, (e: unknown) => e);
    assert.ok(cancelada instanceof Error && !(cancelada instanceof KontextEnCursoError), "quien cancela no recibe una solicitud para retomar");
  });

  await prueba("solo se retoma lo que la red o el plazo cortaron: un 5xx al preguntar el estado y un corte al bajar el resultado sí; un 5xx del resultado y un fallo del código, no", async () => {
    const intentar = (estados: Estado[], resultado: Resultado = "ok") => { reiniciar(estados, { resultado }); return generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 5_000 }).then(() => null, (e: unknown) => e); };
    assert.ok(await intentar(["http503"]) instanceof KontextEnCursoError, "un 503 al preguntar el estado es pasajero");
    assert.ok(await intentar(["COMPLETED"], "red") instanceof KontextEnCursoError, "un corte de red al bajar el resultado completo se retoma");
    const del503 = await intentar(["COMPLETED"], "http503");
    assert.ok(del503 instanceof Error && !(del503 instanceof KontextEnCursoError) && /\(503\)/.test(del503.message), "un 503 del resultado es un error de verdad");
    const delCodigo = await intentar(["error_de_codigo"]);
    assert.ok(delCodigo instanceof TypeError && !(delCodigo instanceof KontextEnCursoError), "un TypeError del código no se toma por un corte de red");
  });

  await prueba("retomar una solicitud que fal ya no tiene (FAILED, 404 o 422) es SolicitudKontextInvalidaError: el llamador responde 409 y el navegador pide una nueva", async () => {
    const retomar = (estados: Estado[], resultado: Resultado = "ok") => { reiniciar(estados, { resultado }); return generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 5_000, solicitudPrevia: ID }).then(() => null, (e: unknown) => e); };
    for (const [nombre, error] of [["FAILED", await retomar(["FAILED"])], ["404 al preguntar el estado", await retomar(["http404"])], ["422 al traer el resultado", await retomar(["COMPLETED"], "http422")]] as const) {
      assert.ok(error instanceof SolicitudKontextInvalidaError, `${nombre}: ${String(error)}`);
      assert.equal(error.codigo, "SOLICITUD_KONTEXT_INVALIDA");
      assert.equal(error.requestId, ID);
    }
    assert.equal(escenario.posts, 0, "retomar nunca envía otra solicitud");
    // Al ENVIAR no hay solicitud previa que invalidar: un FAILED es un error de verdad, y un 5xx pasajero al retomar sigue siendo «en curso».
    reiniciar(["FAILED"]);
    const alEnviar = await generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 5_000 }).then(() => null, (e: unknown) => e);
    assert.ok(alEnviar instanceof Error && !(alEnviar instanceof SolicitudKontextInvalidaError) && !(alEnviar instanceof KontextEnCursoError));
    assert.ok(await retomar(["http503"]) instanceof KontextEnCursoError);
  });

  await prueba("el resultado y su descarga caben en el plazo más el margen: una descarga colgada se corta a los ~15 s y la solicitud se retoma", async () => {
    reiniciar(["COMPLETED"], { resultado: "colgado" });
    // Los plazos de AbortSignal.timeout no sostienen el proceso (en producción lo sostiene el socket); aquí lo sostiene este reloj.
    const sostener = setTimeout(() => undefined, 30_000);
    const antes = Date.now();
    const error = await generarConFluxKontext("x", { imagen, variante: "max", plazoMs: 1_000 }).then(() => null, (e: unknown) => e);
    const ms = Date.now() - antes;
    clearTimeout(sostener);
    assert.ok(error instanceof KontextEnCursoError, String(error));
    assert.ok(ms >= 14_000 && ms <= 16_500, `la llamada entera (plazo 1 s + margen de 15 s) duró ${ms} ms`);
  });

  const { ultimosEventos } = await import("@sempertex/agente-core");
  const idNuevo = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  /** La última entrega (el evento más reciente) y si cobró: el registro de telemetría guarda pocos eventos, así que se mira el último de cada paso. */
  const ultimaEntregaCobra = () => ultimosEventos()[0]!.costeEstimado === 0.08;

  await prueba("la telemetría cobra solo la primera entrega de una solicitud: retomar un id ya entregado trae la imagen sin otro cobro, y el registro está acotado", async () => {
    const retomar = (id: string) => { reiniciar(["COMPLETED"], { id }); return generarConFluxKontext("x", { imagen, variante: "max", solicitudPrevia: id, telemetria: { superficie: "prueba-entregas" } }); };
    await retomar(idNuevo(1));
    assert.equal(ultimaEntregaCobra(), true, "la primera entrega cobra");
    await retomar(idNuevo(1));
    assert.equal(ultimaEntregaCobra(), false, "la segunda entrega del mismo id no cobra otra vez");
    for (let n = 2; n < 505; n += 1) await retomar(idNuevo(n));
    await retomar(idNuevo(504));
    assert.equal(ultimaEntregaCobra(), false, "uno reciente sigue en el registro: sin segundo cobro");
    await retomar(idNuevo(1));
    assert.equal(ultimaEntregaCobra(), true, "el registro está acotado (500): el más viejo ya salió y vuelve a contar como primera entrega");
  });

  await prueba("el plazo por defecto cabe en el maxDuration de las dos rutas con 20 s de margen", async () => {
    assert.equal(PLAZO_KONTEXT_MS, 100_000);
    for (const ruta of ["src/app/api/render-3d-imagen/route.ts", "src/app/api/guiada/motor/imagen/route.ts"]) {
      const duracion = Number(/export const maxDuration = (\d+);/.exec(readFileSync(path.resolve(__dirname, "..", "..", ruta), "utf8"))?.[1]);
      assert.ok(duracion * 1000 - PLAZO_KONTEXT_MS >= 20_000, `${ruta}: maxDuration ${duracion} s no deja 20 s sobre el plazo de Kontext`);
    }
  });

  const { abrirSolicitudKontext, firmarSolicitudKontext, solicitudPreviaDe, VIDA_SOLICITUD_KONTEXT_MS } = await import("../../src/lib/ia/kagutsuchi/solicitud-kontext");
  const { CABECERA_SOLICITUD_KONTEXT } = await import("../../src/lib/generacion/solicitud-kontext-contrato");

  await prueba("el token vale solo para el mismo texto, vence y no se falsifica; el id debe ser de fal", async () => {
    const ahora = 1_800_000_000_000;
    const token = firmarSolicitudKontext(ID, "texto A", ahora);
    assert.equal(abrirSolicitudKontext(token, "texto A", ahora + 1_000), ID);
    assert.equal(abrirSolicitudKontext(token, "texto B", ahora + 1_000), null, "de otro texto no sirve");
    assert.equal(abrirSolicitudKontext(token, "texto A", ahora + VIDA_SOLICITUD_KONTEXT_MS + 1), null, "vencido");
    const [, vence, firma] = token.split(".");
    assert.equal(abrirSolicitudKontext(`${ID.replace("01a1230e", "02b2341f")}.${vence}.${firma}`, "texto A", ahora), null, "otro id con la misma firma");
    assert.equal(abrirSolicitudKontext(`${ID}.${Number(vence) + 60_000}.${firma}`, "texto A", ahora), null, "vencimiento alargado");
    assert.equal(abrirSolicitudKontext(`${ID}.${vence}.${firma}x`, "texto A", ahora), null);
    const inventado = firmarSolicitudKontext("../../otra-ruta", "texto A", ahora);
    assert.equal(abrirSolicitudKontext(inventado, "texto A", ahora), null, "un id que no es de fal no pasa aunque esté firmado");
    for (const basura of ["", "a", "a.b", "a.b.c.d", `${ID}..`]) assert.equal(abrirSolicitudKontext(basura, "texto A", ahora), null, basura);
    const sin = solicitudPreviaDe(new Headers(), "texto A");
    assert.equal(sin.tipo, "ninguna");
    assert.equal(solicitudPreviaDe(new Headers({ [CABECERA_SOLICITUD_KONTEXT]: firmarSolicitudKontext(ID, "texto A") }), "texto A").tipo, "retomar");
    assert.equal(solicitudPreviaDe(new Headers({ [CABECERA_SOLICITUD_KONTEXT]: firmarSolicitudKontext(ID, "texto A") }), "texto B").tipo, "invalida", "con encabezado que no sirve se rechaza, no se envía otra solicitud");
  });

  const { POST } = await import("../../src/app/api/render-3d-imagen/route");
  const { reiniciarFotosPorHora, tomarFotoDeLaHora } = await import("../../src/lib/globos3d/tope-fotos-hora");
  const render = `data:image/png;base64,${PNG.toString("base64")}`;
  const cuerpoDelTaller = (cambios: { render?: string; aspecto?: string } = {}) => JSON.stringify({ render, descripcion: "Two balloon columns in a room.", ambiente: "igual_visor", aspecto: "3:2", ...cambios });
  const pedirTaller = (cabeceras: Record<string, string> = {}, cuerpoTaller = cuerpoDelTaller()) => POST(new Request("https://app.test/api/render-3d-imagen", { method: "POST", headers: { "content-type": "application/json", ...cabeceras }, body: cuerpoTaller }));

  await prueba("Taller: un corte tras enviar responde 202 con token; al retomar no envía otra solicitud ni gasta cupo; un token malo es 409 sin llamar a fal", async () => {
    reiniciarFotosPorHora();
    reiniciar(["red"]);
    const primera = await pedirTaller();
    assert.equal(primera.status, 202);
    const cuerpo = await primera.json() as { estado: string; codigo: string; solicitud_kontext: string };
    assert.equal(cuerpo.estado, "en_curso");
    assert.equal(cuerpo.codigo, "KONTEXT_EN_CURSO");
    assert.equal(escenario.posts, 1);

    escenario.estados = ["COMPLETED"];
    const segunda = await pedirTaller({ [CABECERA_SOLICITUD_KONTEXT]: cuerpo.solicitud_kontext });
    assert.equal(segunda.status, 200, await segunda.clone().text());
    assert.match((await segunda.json() as { imagen: string }).imagen, /^data:image\//);
    assert.equal(escenario.posts, 1, "retomar no paga otra imagen");
    assert.equal(tomarFotoDeLaHora(Date.now(), 30).usadas, 2, "el cupo es 1 de la primera petición + 1 de esta consulta: la retoma no gastó otro");

    const antes = escenario.posts;
    const mala = await pedirTaller({ [CABECERA_SOLICITUD_KONTEXT]: `${cuerpo.solicitud_kontext}x` });
    assert.equal(mala.status, 409);
    assert.equal((await mala.json() as { codigo: string }).codigo, "SOLICITUD_KONTEXT_INVALIDA");
    assert.equal(escenario.posts, antes, "con un token malo no se envía nada a fal");
  });


  await prueba("Taller: el token es de ESTA vista (captura y aspecto): otra vista nunca recibe la imagen vieja; y si fal ya no tiene la solicitud, 409", async () => {
    reiniciarFotosPorHora();
    reiniciar(["red"], { id: idNuevo(900) });
    const { solicitud_kontext } = await (await pedirTaller()).json() as { solicitud_kontext: string };
    const render2 = `data:image/png;base64,${Buffer.concat([PNG, Buffer.from("otra vista")]).toString("base64")}`;
    const antes = escenario.posts;
    for (const [nombre, cuerpo] of [["otra captura", cuerpoDelTaller({ render: render2 })], ["otro aspecto", cuerpoDelTaller({ aspecto: "16:9" })]] as const) {
      const r = await pedirTaller({ [CABECERA_SOLICITUD_KONTEXT]: solicitud_kontext }, cuerpo);
      assert.equal(r.status, 409, nombre);
      assert.equal((await r.json() as { codigo: string }).codigo, "SOLICITUD_KONTEXT_INVALIDA", nombre);
    }
    assert.equal(escenario.posts, antes, "con otra vista no se envía ni se retoma nada en fal");

    escenario.estados = ["FAILED"];
    const muerta = await pedirTaller({ [CABECERA_SOLICITUD_KONTEXT]: solicitud_kontext });
    assert.equal(muerta.status, 409, "retomar una solicitud que fal dio por FAILED es 409, no un 502 que deje el token vivo");
    assert.equal((await muerta.json() as { codigo: string }).codigo, "SOLICITUD_KONTEXT_INVALIDA");
    assert.equal(escenario.posts, antes);
  });

  console.log(`\n${pruebas} pruebas ok`);
}

main().catch((error) => { console.error(error); process.exit(1); });
