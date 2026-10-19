/**
 * Las rutas del estudio de módulos (REQ-011) con el servicio de memoria y un generador doble (sin red ni coste):
 * - GET `?meta=1` dice si hay render, si el caché está disponible y si esta sesión puede escribir (`puedeEscribir`);
 * - la imagen se sirve por una URL versionada e inmutable (`v` = huella del contenido); con una `v` vieja no se sirve;
 * - POST de generación y DELETE pasan por UNA puerta (`puedeEscribirCacheModulos`): cerrada, el POST solo devuelve lo ya
 *   guardado (si no hay, 403) y el DELETE da 403; abierta, genera, guarda y se puede descartar y volver a generar;
 * - el intérprete limita a 20 por minuto y por IP.
 * Se ejecuta con: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-modulos-rutas.ts
 */
import assert from "node:assert/strict";
import { crearAlmacenMemoria, crearRepositorioMemoria } from "../../src/lib/modulos-estudio/adaptadores/memoria";
import { crearServicioRenders } from "../../src/lib/modulos-estudio/servicio-renders";
import { DELETE, GET, POST } from "../../src/app/api/modulos-render/route";
import { POST as INTERPRETAR } from "../../src/app/api/modulos-interpretar/route";

const entorno = process.env as Record<string, string | undefined>;
const URL_BASE = "http://localhost/api/modulos-render";
const CONSULTA = "tipo=pareja&formato=R-12&colores=915,040";
const CAPTURA = "data:image/png;base64,iVBORw0KGgo=";

async function principal() {
  const perro = setTimeout(() => { console.error("[FAIL] test-modulos-rutas: una promesa no se resolvió en 60 s"); process.exit(1); }, 60_000);
  let generaciones = 0;
  const repositorio = crearRepositorioMemoria();
  const almacen = crearAlmacenMemoria();
  (globalThis as { __servicioRendersModulo?: unknown }).__servicioRendersModulo = crearServicioRenders({
    repositorio, almacen,
    generar: async () => { generaciones++; return { bytes: new Uint8Array([0xff, 0xd8, generaciones, 0xff, 0xd9]), mime: "image/jpeg", costeUsd: 0.05 }; },
  });
  const pedir = (metodo: string, query = CONSULTA, cuerpo?: unknown) => new Request(`${URL_BASE}?${query}`, {
    method: metodo, ...(cuerpo ? { headers: { "content-type": "application/json", cookie: "session=abc" }, body: JSON.stringify(cuerpo) } : {}),
  });
  const cuerpoPost = { tipo: "pareja", colores: ["915", "040"], captura: CAPTURA };
  const guardado = { modo: entorno.MODULOS_ESCRITURA, nodo: entorno.NODE_ENV };
  const entornoDe = (modo: string | undefined, nodo: string) => { if (modo === undefined) delete entorno.MODULOS_ESCRITURA; else entorno.MODULOS_ESCRITURA = modo; entorno.NODE_ENV = nodo; };

  // ---- Producción y sin puerta abierta: se puede leer, no escribir. ----
  entornoDe(undefined, "production");
  let meta = await (await GET(pedir("GET", `${CONSULTA}&meta=1`))).json() as { encontrada: boolean; cache: string; puedeEscribir: boolean; imagen?: string };
  assert.deepEqual({ e: meta.encontrada, c: meta.cache, p: meta.puedeEscribir }, { e: false, c: "disponible", p: false });
  const cerradoPost = await POST(pedir("POST", "", cuerpoPost));
  assert.equal(cerradoPost.status, 403);
  assert.equal(generaciones, 0, "cerrada, el POST no paga nada");
  assert.equal((await DELETE(pedir("DELETE"))).status, 403);
  assert.equal((await GET(pedir("GET"))).status, 404, "sin render, el GET de la imagen es 404");

  // ---- Abierta: genera, guarda, sirve por URL versionada. ----
  entornoDe("abierta", "production");
  const generada = await POST(pedir("POST", "", cuerpoPost));
  assert.equal(generada.status, 200);
  const datos = await generada.json() as { origen: string; guardada: boolean; imagen: string; costeUsd: number };
  assert.deepEqual({ o: datos.origen, g: datos.guardada, c: datos.costeUsd }, { o: "generada", g: true, c: 0.05 });
  assert.equal(generaciones, 1);
  assert.match(datos.imagen, /^data:image\/jpeg;base64,/);
  const fila = [...repositorio.filas.values()][0]!;
  assert.match(fila.capturaSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.match(fila.sesion ?? "", /^[0-9a-f]{16}$/, "la sesión se guarda como huella, no como cookie");
  assert.notEqual(fila.sesion, "abc");

  meta = await (await GET(pedir("GET", `${CONSULTA}&meta=1`))).json() as typeof meta;
  assert.ok(meta.encontrada && meta.imagen && meta.puedeEscribir);
  assert.match(meta.imagen!, /&v=[0-9a-f]{16}$/);
  const imagen = await GET(new Request(`http://localhost${meta.imagen}`));
  assert.equal(imagen.status, 200);
  assert.equal(imagen.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(imagen.headers.get("content-type"), "image/jpeg");
  const sinVersion = await GET(pedir("GET"));
  assert.equal(sinVersion.status, 200);
  assert.equal(sinVersion.headers.get("cache-control"), "private, no-cache", "sin versión no se declara inmutable");
  const vieja = await GET(pedir("GET", `${CONSULTA}&v=0000000000000000`));
  assert.equal(vieja.status, 404, "una huella que ya no es la del render no sirve la imagen nueva");
  // El orden equivalente es el mismo render: acierto, sin pagar.
  const equivalente = await POST(pedir("POST", "", { tipo: "pareja", colores: ["040", "915"] }));
  assert.equal(((await equivalente.json()) as { origen: string }).origen, "cache");
  assert.equal(generaciones, 1);

  // ---- Cerrada otra vez: lo guardado se lee por POST (gratis), pero no se descarta. ----
  entornoDe("cerrada", "production");
  const lecturaCerrada = await POST(pedir("POST", "", { tipo: "pareja", colores: ["915", "040"] }));
  assert.equal(lecturaCerrada.status, 200);
  assert.equal(((await lecturaCerrada.json()) as { origen: string }).origen, "cache");
  assert.equal((await DELETE(pedir("DELETE"))).status, 403);
  assert.equal(repositorio.filas.size, 1);
  assert.equal(((await (await GET(pedir("GET", `${CONSULTA}&meta=1`))).json()) as typeof meta).puedeEscribir, false);

  // ---- Abierta: descartar y volver a generar da otra imagen y otra URL. ----
  entornoDe("abierta", "production");
  const urlAntes = meta.imagen;
  const descartado = await DELETE(pedir("DELETE"));
  assert.equal(descartado.status, 200);
  assert.deepEqual(await descartado.json(), { descartado: true });
  assert.equal(repositorio.filas.size, 0);
  assert.equal(almacen.objetos.size, 0);
  const viejaUrl = await GET(new Request(`http://localhost${urlAntes}`));
  assert.equal(viejaUrl.status, 404, "la URL versionada del render descartado ya no sirve");
  assert.equal(((await (await POST(pedir("POST", "", cuerpoPost))).json()) as { origen: string }).origen, "generada");
  assert.equal(generaciones, 2);
  const urlDespues = ((await (await GET(pedir("GET", `${CONSULTA}&meta=1`))).json()) as typeof meta).imagen;
  assert.notEqual(urlDespues, urlAntes, "otra imagen, otra URL");

  // ---- Entradas inválidas. ----
  assert.equal((await GET(pedir("GET", "tipo=octeto&colores=915"))).status, 400);
  assert.equal((await POST(pedir("POST", "", { tipo: "pareja", colores: ["915", "040", "015"], captura: CAPTURA }))).status, 400);
  assert.equal((await POST(pedir("POST", "", { tipo: "trio", colores: ["915"] }))).status, 409, "sin captura y sin render: pide la captura");

  // ---- El intérprete: 20 por minuto y por IP (sin Gemini configurado la 1.ª..20.ª dan 503, la 21.ª 429). ----
  entornoDe(guardado.modo, guardado.nodo ?? "test");
  delete entorno.GEMINI_API_KEY;
  const estados: number[] = [];
  for (let i = 0; i < 21; i++) {
    const r = await INTERPRETAR(new Request("http://localhost/api/modulos-interpretar", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" }, body: JSON.stringify({ texto: "un dúo rojo" }) }));
    estados.push(r.status);
  }
  assert.deepEqual([...new Set(estados.slice(0, 20))], [503]);
  assert.equal(estados[20], 429);
  const otraIp = await INTERPRETAR(new Request("http://localhost/api/modulos-interpretar", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" }, body: JSON.stringify({ texto: "un dúo rojo" }) }));
  assert.equal(otraIp.status, 503, "otra IP no comparte la cuenta");

  if (guardado.modo === undefined) delete entorno.MODULOS_ESCRITURA; else entorno.MODULOS_ESCRITURA = guardado.modo;
  if (guardado.nodo === undefined) delete entorno.NODE_ENV; else entorno.NODE_ENV = guardado.nodo;
  clearTimeout(perro);
  console.log("[PASS] test-modulos-rutas");
}

principal().catch((error) => { console.error(error); process.exit(1); });
