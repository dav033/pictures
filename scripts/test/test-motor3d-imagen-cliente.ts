/**
 * «Ver cómo quedaría» de un plan del motor 3D, del lado del navegador (REQ-007, fase 4). Sin red, sin WebGL y sin coste: el
 * gestor del visor y `fetch` son dobles; el plan es el sobre real del motor que graba `datos-vista-motor3d.ts`.
 * - la captura es la del visor compartido (misma cámara que la tarjeta, 1024 px) y viaja con la espec firmada a la ruta del 3D,
 *   NUNCA a /api/generate;
 * - sin WebGL, con el visor caído o con una vista que cayó a SVG, no hay captura: va la cámara y el servidor rasteriza;
 * - un corte se recupera con la misma consulta de siempre, sin pagar otra imagen; un rechazo (409) no se reintenta;
 * - un plan sin espec firmada no sale a ninguna ruta;
 * - un plan de Python sigue yendo a /api/generate y nunca a la ruta nueva (`pedirImagenConRecuperacion` conserva su ruta de siempre);
 * - VistaGuiada: el 3D toma su camino aparte antes de armar el cuerpo de Python.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-motor3d-imagen-cliente.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { AMBIENTE_IMAGEN_PLAN_3D, LADO_CAPTURA_IMAGEN, capturaDelVisor, pedirImagenPlan3D, type GestorCaptura } from "@/components/guiado/imagen-plan-3d";
import { firmaDePlan } from "@/components/guiado/motor3d/firma-plan";
import { FalloWebgl } from "@/components/guiado/motor3d/visor-compartido";
import { CABECERA_SOLICITUD_IMAGEN, ErrorImagen, RUTA_GENERAR_IMAGEN, RUTA_RECUPERAR_IMAGEN, pedirImagenConRecuperacion, type DependenciasImagen } from "@/lib/generacion/pedir-imagen";
import { CuerpoImagenSchema, RUTA_IMAGEN_MOTOR } from "@/lib/guiada-motor/imagen-contrato";

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try { await prueba(); casos += 1; console.log(`[PASS] ${nombre}`); } catch (error) { console.error(`[FAIL] ${nombre}`); throw error; }
}

type Datos = { plan: unknown };
const datos: Datos = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/test/datos-vista-motor3d.ts"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })) as Datos;
const plan = PlanGuiadoSchema.parse(datos.plan);
const firma = firmaDePlan(plan)!;
const sinEspec = PlanGuiadoSchema.parse(Object.fromEntries(Object.entries(plan).filter(([clave]) => clave !== "espec")));

const CAPTURA = "data:image/png;base64,iVBORw0KGgo=";
const IMAGEN = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Peticion = { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: unknown };
function red(respuestas: Array<(p: Peticion) => Response | Promise<Response>>) {
  const peticiones: Peticion[] = [];
  const dependencias: Partial<DependenciasImagen> = {
    fetch: async (url, init) => {
      const p: Peticion = { url, metodo: init?.method ?? "GET", cabeceras: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), cuerpo: init?.body ? JSON.parse(String(init.body)) as unknown : null };
      peticiones.push(p);
      const siguiente = respuestas[peticiones.length - 1];
      if (!siguiente) throw new Error(`petición inesperada ${p.metodo} ${p.url}`);
      return siguiente(p);
    },
    esperar: async () => undefined,
    nuevoId: (() => { let n = 0; return () => `0b1b3c8e-5f4a-4a53-9c0e-2d6f6f3a9d${String(n++).padStart(2, "0")}`; })(),
  };
  return { peticiones, dependencias };
}
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

type PedidoVisor = { vista: string; lado: number; pieza?: string };
function gestorDoble(opciones: { modo?: "webgl" | "svg"; imagen?: () => Promise<{ modo: "webgl" | "svg"; url: string }> } = {}) {
  const pedidos: PedidoVisor[] = [];
  const gestor: GestorCaptura = {
    modo: () => opciones.modo ?? "webgl",
    imagen: async (_firma, pedido) => { pedidos.push(pedido); return opciones.imagen ? opciones.imagen() : { modo: "webgl", url: CAPTURA }; },
  };
  return { gestor: async () => gestor, pedidos };
}
const senal = new AbortController().signal;
const pedir = (extra: Partial<Parameters<typeof pedirImagenPlan3D>[0]> = {}) => pedirImagenPlan3D({ plan, senal, limiteIntentoMs: 5_000, ...extra });

async function main(): Promise<void> {
  await caso("con WebGL: la captura del visor (cámara de la tarjeta, 1024 px) viaja con la espec firmada a la ruta del 3D, y a ninguna otra", async () => {
    const v = gestorDoble();
    const r = red([() => json({ imagen: IMAGEN })]);
    const eventos: string[] = [];
    const salida = await pedir({ gestor: v.gestor, dependencias: r.dependencias, alEvento: (e) => eventos.push(e) });
    assert.equal(salida.imagen, IMAGEN);
    assert.equal(salida.via, "directa");
    assert.equal(r.peticiones.length, 1);
    const p = r.peticiones[0]!;
    assert.deepEqual([p.url, p.metodo], [RUTA_IMAGEN_MOTOR, "POST"]);
    assert.ok(UUID.test(p.cabeceras[CABECERA_SOLICITUD_IMAGEN]!), "cada intento lleva su id de solicitud");
    assert.deepEqual(v.pedidos, [{ vista: "tres-cuartos", lado: LADO_CAPTURA_IMAGEN }], "la cámara de la tarjeta de dos columnas orgánicas (tres cuartos), a 1024 px, de toda la decoración");
    // El cuerpo cumple el esquema de la ruta y trae la firma tal cual está en el plan.
    const cuerpo = CuerpoImagenSchema.parse(p.cuerpo);
    assert.deepEqual([cuerpo.approval_token, cuerpo.plan_hash, cuerpo.motor, cuerpo.ambiente], [plan.approval_token, plan.plan_hash, firma.motor, AMBIENTE_IMAGEN_PLAN_3D]);
    assert.deepEqual(cuerpo.espec, firma.espec);
    assert.equal(cuerpo.captura, CAPTURA);
    assert.equal(cuerpo.vista, undefined, "con captura no hace falta la cámara");
    assert.ok(!r.peticiones.some((x) => x.url === RUTA_GENERAR_IMAGEN), "un plan 3D no va a /api/generate");
    assert.ok(eventos.includes("imagen.pedir_motor_3d"));
  });

  await caso("sin WebGL (o con el visor ya caído a SVG): no se abre el visor, no hay captura y va la cámara para que el servidor rasterice", async () => {
    const v = gestorDoble({ modo: "svg" });
    const r = red([() => json({ imagen: IMAGEN })]);
    await pedir({ gestor: v.gestor, dependencias: r.dependencias });
    assert.equal(v.pedidos.length, 0, "el visor no se pide");
    const cuerpo = CuerpoImagenSchema.parse(r.peticiones[0]!.cuerpo);
    assert.equal(cuerpo.captura, undefined);
    assert.equal(cuerpo.vista, "tres-cuartos");
    assert.equal(r.peticiones[0]!.url, RUTA_IMAGEN_MOTOR);
  });

  await caso("si el visor falla o cae a SVG a mitad de camino, la imagen se pide igual sin captura y el fallo queda en el registro", async () => {
    for (const imagen of [async () => { throw new FalloWebgl("se perdió el contexto"); }, async () => ({ modo: "svg" as const, url: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" })]) {
      const v = gestorDoble({ imagen });
      const r = red([() => json({ imagen: IMAGEN })]);
      const eventos: Array<[string, Record<string, unknown>]> = [];
      await pedir({ gestor: v.gestor, dependencias: r.dependencias, alEvento: (e, d) => eventos.push([e, d]) });
      const cuerpo = CuerpoImagenSchema.parse(r.peticiones[0]!.cuerpo);
      assert.equal(cuerpo.captura, undefined);
      assert.equal(cuerpo.vista, "tres-cuartos");
      assert.equal(r.peticiones.length, 1);
    }
    const v = gestorDoble({ imagen: async () => { throw new FalloWebgl("sin contexto"); } });
    const eventos: string[] = [];
    await pedir({ gestor: v.gestor, dependencias: red([() => json({ imagen: IMAGEN })]).dependencias, alEvento: (e) => eventos.push(e) });
    assert.ok(eventos.includes("imagen.captura_no_disponible"));
  });

  await caso("capturaDelVisor: solo devuelve píxeles de WebGL; una imagen SVG de reserva no es una captura", async () => {
    assert.equal(await capturaDelVisor(firma, "frente", gestorDoble().gestor), CAPTURA);
    assert.equal(await capturaDelVisor(firma, "frente", gestorDoble({ modo: "svg" }).gestor), null);
  });

  await caso("un corte de red se recupera con la consulta de siempre, sin pedir (ni pagar) otra imagen", async () => {
    const r = red([
      () => { throw new TypeError("NetworkError when attempting to fetch resource."); },
      (p) => { assert.ok(p.url.startsWith(`${RUTA_RECUPERAR_IMAGEN}?solicitud=`) && p.url.includes(`plan=${plan.plan_hash}`)); return json({ estado: "lista", imagen: IMAGEN }); },
    ]);
    const salida = await pedir({ gestor: gestorDoble().gestor, dependencias: r.dependencias });
    assert.equal(salida.via, "recuperada");
    assert.deepEqual(r.peticiones.map((p) => p.metodo), ["POST", "GET"]);
    assert.equal(r.peticiones.filter((p) => p.url === RUTA_IMAGEN_MOTOR).length, 1, "una sola petición de pago");
  });

  await caso("el cupo agotado (429) y los fallos del servidor se tratan como cortes; un rechazo del plan (409) no se reintenta", async () => {
    const rechazo = red([() => json({ codigo: "APROBACION_INVALIDA" }, 409)]);
    await assert.rejects(() => pedir({ gestor: gestorDoble().gestor, dependencias: rechazo.dependencias }), (e: unknown) => e instanceof ErrorImagen && e.clase === "rechazo" && e.status === 409);
    assert.equal(rechazo.peticiones.length, 1, "ni una consulta ni un reintento");
    // El cupo agotado (429) es un corte como cualquier otro, pero un plan 3D NO repite la petición solo: cada intento paga una imagen.
    const cupo = red([() => json({ codigo: "TOPE_DE_IMAGENES" }, 429), () => json({ estado: "no_encontrada" }), () => json({ estado: "no_encontrada" })]);
    await assert.rejects(() => pedir({ gestor: gestorDoble().gestor, dependencias: cupo.dependencias }), (e: unknown) => e instanceof ErrorImagen && e.clase === "servidor" && e.status === 429);
    assert.equal(cupo.peticiones.filter((p) => p.metodo === "POST").length, 1, "una sola petición de pago, sin reintento silencioso");
    assert.ok(cupo.peticiones.filter((p) => p.metodo === "POST").every((p) => p.url === RUTA_IMAGEN_MOTOR));
  });

  await caso("si el visor no responde (la hoja que gira lo tiene en pausa), la imagen sale sin captura en vez de quedarse esperando", async () => {
    const colgado: GestorCaptura = { modo: () => "webgl", imagen: () => new Promise(() => undefined) };
    const r = red([() => json({ imagen: IMAGEN })]);
    await pedir({ gestor: async () => colgado, dependencias: r.dependencias, esperaCapturaMs: 20 });
    const cuerpo = CuerpoImagenSchema.parse(r.peticiones[0]!.cuerpo);
    assert.deepEqual([cuerpo.captura, cuerpo.vista], [undefined, "tres-cuartos"]);
  });

  await caso("un plan sin espec firmada no sale a ninguna ruta; una señal abortada tampoco paga", async () => {
    const r = red([]);
    await assert.rejects(() => pedirImagenPlan3D({ plan: sinEspec, senal, limiteIntentoMs: 5_000, gestor: gestorDoble().gestor, dependencias: r.dependencias }), (e: unknown) => e instanceof ErrorImagen && e.clase === "rechazo");
    const control = new AbortController();
    const v = { modo: () => "webgl" as const, imagen: async () => { control.abort(); return { modo: "webgl" as const, url: CAPTURA }; } };
    await assert.rejects(() => pedirImagenPlan3D({ plan, senal: control.signal, limiteIntentoMs: 5_000, gestor: async () => v, dependencias: r.dependencias }), (e: unknown) => e instanceof ErrorImagen && e.clase === "cancelada");
    assert.equal(r.peticiones.length, 0);
  });

  await caso("un plan de Python sigue yendo a /api/generate: `pedirImagenConRecuperacion` conserva su ruta y la nueva solo se pide por nombre", async () => {
    const r = red([() => json({ imagen: IMAGEN })]);
    await pedirImagenConRecuperacion({ cuerpo: { plan: {} }, planHash: "hash-de-python-123", senal, limiteIntentoMs: 5_000, dependencias: r.dependencias });
    assert.equal(r.peticiones[0]!.url, RUTA_GENERAR_IMAGEN);
    assert.equal(RUTA_GENERAR_IMAGEN, "/api/generate");
    const fuente = readFileSync("src/lib/generacion/pedir-imagen.ts", "utf8");
    assert.ok(!fuente.includes("guiada/motor/imagen") && !fuente.includes("RUTA_IMAGEN_MOTOR"), "el módulo de Python no conoce la ruta del 3D");
  });

  await caso("VistaGuiada: el plan 3D toma su camino antes de armar el cuerpo de Python, y la rama de Python no lleva `ruta`", () => {
    const fuente = readFileSync("src/components/guiado/VistaGuiada.tsx", "utf8");
    const funcion = fuente.slice(fuente.indexOf("async function verComoQuedaria"), fuente.indexOf("// «Genera la imagen» sin plan"));
    const rama3d = funcion.indexOf('if (widget.motor === "3d") {');
    assert.ok(rama3d > 0, "hay una rama del 3D");
    assert.ok(rama3d < funcion.indexOf("cuerpoGeneracion("), "la rama del 3D va antes del cuerpo de Python");
    assert.ok(funcion.indexOf("pedirImagenPlan3D(") > rama3d && funcion.indexOf("pedirImagenPlan3D(") < funcion.indexOf("} else {", rama3d), "pedirImagenPlan3D es de la rama del 3D");
    assert.equal(funcion.split("pedirImagenPlan3D(").length - 1, 1);
    const python = funcion.slice(funcion.indexOf("} else {", rama3d));
    assert.ok(python.includes("pedirImagenConRecuperacion(") && !/ruta\s*:/.test(python) && !python.includes("RUTA_IMAGEN_MOTOR"), "Python no cambia de ruta");
    assert.ok(!fuente.includes("RUTA_IMAGEN_MOTOR"), "VistaGuiada no conoce la ruta: la conoce el módulo del 3D");
    // El plan 3D sin espec firmada se detiene antes de cualquier ruta.
    assert.match(funcion, /widget\.motor === "3d" && !firmaDePlan\(widget\.plan\)\)[^\n]*return;/);
  });

  console.log(`test-motor3d-imagen-cliente: ok (${casos} pruebas)`);
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
