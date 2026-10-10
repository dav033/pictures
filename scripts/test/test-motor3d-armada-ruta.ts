/**
 * `POST /api/guiada/motor/armada` (REQ-007, fase 3): la armada compacta (o el SVG de reserva) del plan 3D que el navegador
 * tiene en pantalla. Sin coste: sin red, base, IA ni Python (la ruta no cotiza).
 * - sesión (401), mismo origen (403) y cuerpo (400);
 * - el token manda: uno de Python, de otro navegador, sin navegador, de otro hash o con la espec cambiada responde 409; sin
 *   espec, 400; el rechazo queda en la auditoría;
 * - con un plan firmado: la armada es la del motor (mismos bytes), cumple su esquema y no pasa de 30 KB;
 * - caché por `especHash`: la segunda petición del mismo plan no vuelve a armar; otro plan, sí; la caché tiene tope;
 * - `salida: "svg"`: imagen SVG con sus cabeceras de seguridad, con tantos círculos como globos, y por pieza;
 * - con la bandera en `python` (sin corte) un plan 3D ya en pantalla se sigue viendo; con el corte del 3D (P-049) responde
 *   409 `MOTOR_3D_CORTADO` con el aviso de recálculo, sin armar ni mirar el plan, y sin el corte vuelve a dar la armada.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-motor3d-armada-ruta.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { crearTokenPlan } from "../../src/lib/plan/aprobacion";
import { atenderArmadaMotor, crearCacheArmada, type DependenciasArmada } from "../../src/lib/guiada-motor/armada-motor";
import { huellaDeNavegador } from "../../src/lib/guiada-motor/plan-motor";
import { TEXTO_DIBUJO_RECALCULO } from "../../src/lib/guiada-motor/mensajes-cliente";
import type { RespuestaMotor } from "../../src/lib/guiada-motor/tipos";
import { crearAuditoriaDeCortes } from "../../src/lib/guiada-motor/corte-motor3d";
import { armarDesdeEspec, especHashDe, VERSION_MOTOR, type EspecClienteV1 } from "../../src/lib/globos3d/motor/v1";
import { ArmadaCompactaV1Schema, TOPE_BYTES_ARMADA } from "../../src/lib/globos3d/motor/armada-compacta";
import { todosLosCasos } from "../lib/casos-motor-guiada";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const IDENTIDAD = "a1".repeat(16);
const NAVEGADOR = `feedback_usuario=${IDENTIDAD}`;
const OTRO_NAVEGADOR = `feedback_usuario=${"b2".repeat(16)}`;
const HUELLA = huellaDeNavegador(`nav-${IDENTIDAD}`);

const casos = todosLosCasos().filter((caso) => armarDesdeEspec(caso.espec).noRepresentable.length === 0);
const ESPEC = casos.find((c) => c.id.includes("columna"))!.espec;
const OTRA_ESPEC = casos.find((c) => c.id.includes("oficial-arco") && c.espec !== ESPEC)!.espec;

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, GUIADA_MOTOR: process.env.GUIADA_MOTOR };
  process.env.APP_PASSWORD = CLAVE_APP;
  process.env.GUIADA_MOTOR = "python";
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

type Auditoria = { quien: string; resultado: Record<string, unknown>; entrada?: unknown };
function entorno(tope = 48, bandera: RespuestaMotor = { motor: "python", fuente: "env" }) {
  const auditorias: Auditoria[] = [];
  let armados = 0;
  const deps: DependenciasArmada = {
    leerBandera: async () => bandera,
    armar: (espec) => { armados += 1; return armarDesdeEspec(espec); },
    cache: crearCacheArmada(tope),
    auditar: (quien, _que, resultado, extra) => { auditorias.push({ quien, resultado: resultado as Record<string, unknown>, entrada: extra?.entrada }); },
  };
  return { deps, auditorias, armados: () => armados };
}

/** Lo que el navegador tiene de un plan 3D: token (atado a su navegador), hash, motor y espec. */
function plan(espec: EspecClienteV1, opciones: { backend?: "globos3d" | "python"; navegador?: string | null; hashDelToken?: string } = {}) {
  const hash = especHashDe(espec, VERSION_MOTOR);
  const navegador = opciones.navegador === undefined ? HUELLA : opciones.navegador;
  const approval_token = crearTokenPlan({ planHash: opciones.hashDelToken ?? hash, requestId: "r", backend: opciones.backend ?? "globos3d", catalogSnapshotId: null, allowlist: [], ...(navegador ? { navegador } : {}) });
  return { approval_token, plan_hash: hash, motor: { id: "globos3d" as const, version: VERSION_MOTOR }, espec };
}

const pedir = (cuerpo: unknown, cookies: string[] = [SESION, NAVEGADOR], cabeceras: Record<string, string> = {}) => new Request("https://app.test/api/guiada/motor/armada", {
  method: "POST", headers: { "content-type": "application/json", ...(cookies.length ? { cookie: cookies.join("; ") } : {}), ...cabeceras }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
});
/** El objeto sin una de sus claves (el cuerpo que el navegador no mandó). */
const sinClave = <T extends object>(objeto: T, clave: string) => Object.fromEntries(Object.entries(objeto).filter(([k]) => k !== clave));
const codigoDe = async (r: Response) => (await r.json() as { codigo: string }).codigo;

test("sin sesión: 401 sin armar nada", async () => {
  const e = entorno();
  const r = await atenderArmadaMotor(pedir(plan(ESPEC), []), e.deps);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(e.armados(), 0);
});

test("otro origen: 403 sin armar nada", async () => {
  const e = entorno();
  const r = await atenderArmadaMotor(pedir(plan(ESPEC), [SESION, NAVEGADOR], { origin: "https://malo.test" }), e.deps);
  assert.equal(r.status, 403);
  assert.equal(e.armados(), 0);
});

test("valida el cuerpo: JSON roto, vacío, enorme, campos de más, hash corto, salida desconocida, motor ajeno", async () => {
  const base = plan(ESPEC);
  for (const cuerpo of ["no es json", "", `{"relleno":"${"x".repeat(400_001)}"}`, { ...base, extra: 1 }, { ...base, plan_hash: "abc" }, { ...base, salida: "png" }, { ...base, motor: { id: "python", version: "1" } }, { ...base, vista: "arriba" }]) {
    const e = entorno();
    const r = await atenderArmadaMotor(pedir(cuerpo), e.deps);
    assert.equal(r.status, 400, JSON.stringify(cuerpo).slice(0, 80));
    assert.equal(await codigoDe(r), "CUERPO_INVALIDO");
    assert.equal(e.armados(), 0);
  }
});

test("un cuerpo enorme se rechaza por su cabecera, sin leerlo", async () => {
  const e = entorno();
  const enorme = new Request("https://app.test/api/guiada/motor/armada", { method: "POST", headers: { "content-type": "application/json", "content-length": "5000000", cookie: [SESION, NAVEGADOR].join("; ") }, body: JSON.stringify(plan(ESPEC)) });
  const r = await atenderArmadaMotor(enorme, e.deps);
  assert.equal(r.status, 400);
  assert.equal(await codigoDe(r), "CUERPO_INVALIDO");
  assert.equal(e.armados(), 0);
});

test("un plan firmado da su armada: la del motor, válida y de menos de 30 KB", async () => {
  const e = entorno();
  const r = await atenderArmadaMotor(pedir(plan(ESPEC)), e.deps);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const cuerpo = await r.json() as { armada: unknown; especHash: string };
  assert.equal(cuerpo.especHash, especHashDe(ESPEC, VERSION_MOTOR));
  const armada = ArmadaCompactaV1Schema.parse(cuerpo.armada);
  assert.deepEqual(armada, armarDesdeEspec(ESPEC).armada);
  assert.ok(JSON.stringify(armada).length < TOPE_BYTES_ARMADA);
  assert.equal(e.auditorias.length, 0, "lo normal no deja rastro; solo los rechazos");
});

test("con GUIADA_MOTOR=python (sin corte) un plan 3D ya en pantalla se sigue viendo", async () => {
  assert.equal(process.env.GUIADA_MOTOR, "python");
  const r = await atenderArmadaMotor(pedir(plan(ESPEC)), entorno().deps);
  assert.equal(r.status, 200);
});

test("con el corte del 3D la armada responde 409 MOTOR_3D_CORTADO con el aviso de recálculo, sin armar", async () => {
  const e = entorno(48, { motor: "python", fuente: "corte" });
  for (const salida of ["armada", "svg"] as const) {
    const r = await atenderArmadaMotor(pedir({ ...plan(ESPEC), salida }), e.deps);
    assert.equal(r.status, 409, salida);
    const cuerpo = await r.json() as { codigo: string; error: string };
    assert.equal(cuerpo.codigo, "MOTOR_3D_CORTADO");
    assert.equal(cuerpo.error, TEXTO_DIBUJO_RECALCULO);
    assert.match(cuerpo.error, /^No pude: .*tengo que volver a calcular tu plan completo.*las cantidades y el precio pueden cambiar/);
  }
  assert.equal(e.armados(), 0, "no arma: el plan no se toca");
  assert.ok(e.auditorias.some((a) => a.quien === "regla:motor_guiada" && a.resultado.razon === "motor_3d_cortado" && a.resultado.fuente === "corte"));
});

test("con el corte, el 409 llega antes de validar el cuerpo: un cuerpo roto también recibe el aviso", async () => {
  const e = entorno(48, { motor: "python", fuente: "corte" });
  const r = await atenderArmadaMotor(pedir("{no es json"), e.deps);
  assert.equal(r.status, 409);
  assert.equal((await r.json() as { codigo: string }).codigo, "MOTOR_3D_CORTADO");
});

test("con el corte, el 409 consume el cuerpo original (el registro apagado no lo lee): la conexión no queda esperando", async () => {
  const e = entorno(48, { motor: "python", fuente: "corte" });
  const TROZOS = 64;
  let pedidos = 0;
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(controlador) {
      pedidos += 1;
      if (pedidos <= TROZOS) controlador.enqueue(new TextEncoder().encode("x".repeat(1024)));
      else controlador.close();
    },
  }, { highWaterMark: 0 });
  const peticion = new Request("https://app.test/api/guiada/motor/armada", {
    method: "POST", headers: { "content-type": "application/json", cookie: [SESION, NAVEGADOR].join("; ") }, body: cuerpo, duplex: "half",
  } as RequestInit);
  const r = await atenderArmadaMotor(peticion, e.deps);
  assert.equal(r.status, 409);
  await new Promise((resolver) => setTimeout(resolver, 50));
  assert.equal(pedidos, TROZOS + 1, "el cuerpo se leyó hasta el cierre, no solo la cabeza de la copia");
  assert.equal(e.armados(), 0);
});

test("la cookie de administrador (fuente cookie) no se corta: la armada sigue dando el plan con el corte puesto", async () => {
  const r = await atenderArmadaMotor(pedir(plan(ESPEC)), entorno(48, { motor: "3d", fuente: "cookie" }).deps);
  assert.equal(r.status, 200);
});

test("la auditoría del corte lleva el plan_hash y efectivo ninguno, y un plan cortado repetido (miniaturas) queda una sola vez", async () => {
  const e = entorno(48, { motor: "python", fuente: "corte" });
  const deps = { ...e.deps, auditoriaCortes: crearAuditoriaDeCortes() };
  for (let i = 0; i < 3; i += 1) assert.equal((await atenderArmadaMotor(pedir(plan(ESPEC)), deps)).status, 409);
  assert.equal(e.auditorias.length, 1, "una fila por plan, no por miniatura");
  assert.equal(e.auditorias[0]!.resultado.efectivo, "ninguno");
  assert.equal((e.auditorias[0]!.entrada as { plan_hash?: string }).plan_hash, plan(ESPEC).plan_hash);
});

test("la auditoría del corte etiqueta el plan_hash también con un cuerpo de más de 1,5 MB sin Content-Length, y deduplica por conversación y plan", async () => {
  const e = entorno(48, { motor: "python", fuente: "corte" });
  const deps = { ...e.deps, auditoriaCortes: crearAuditoriaDeCortes() };
  const enorme = { ...plan(ESPEC), relleno: "x".repeat(1_600_000) };
  const peticion = pedir(enorme, [SESION, NAVEGADOR], { "x-conversacion-id": "conversacion-uno" });
  assert.equal(peticion.headers.get("content-length"), null);
  assert.equal((await atenderArmadaMotor(peticion, deps)).status, 409);
  assert.equal((e.auditorias[0]!.entrada as { plan_hash?: string }).plan_hash, plan(ESPEC).plan_hash, "el hash sale de la cabeza del cuerpo, no de todo él");

  assert.equal((await atenderArmadaMotor(pedir(plan(ESPEC), [SESION, NAVEGADOR], { "x-conversacion-id": "conversacion-uno" }), deps)).status, 409);
  assert.equal(e.auditorias.length, 1, "la misma conversación y el mismo plan: una fila");
  assert.equal((await atenderArmadaMotor(pedir(plan(ESPEC), [SESION, NAVEGADOR], { "x-conversacion-id": "conversacion-dos" }), deps)).status, 409);
  assert.equal(e.auditorias.length, 2, "otra conversación con el mismo plan: otra fila");
});

test("con la bandera en python por ajuste (no el corte) la armada sigue dando el plan", async () => {
  const r = await atenderArmadaMotor(pedir(plan(ESPEC)), entorno(48, { motor: "python", fuente: "ajuste" }).deps);
  assert.equal(r.status, 200);
});

test("el token manda: Python, otro navegador, sin navegador, otro hash, espec cambiada, sin token válido: 409", async () => {
  const casosMalos: Array<[string, unknown, string[] | undefined, string]> = [
    ["token de Python", plan(ESPEC, { backend: "python" }), undefined, "PLAN_NO_ES_DEL_MOTOR_3D"],
    ["otro navegador", plan(ESPEC), [SESION, OTRO_NAVEGADOR], "APROBACION_INVALIDA"],
    ["token sin navegador", plan(ESPEC, { navegador: null }), undefined, "APROBACION_INVALIDA"],
    ["token atado a otro hash", plan(ESPEC, { hashDelToken: "a".repeat(64) }), undefined, "APROBACION_INVALIDA"],
    ["hash ajeno al token", { ...plan(ESPEC), plan_hash: "b".repeat(64) }, undefined, "APROBACION_INVALIDA"],
    ["token inventado", { ...plan(ESPEC), approval_token: "basura.basura" }, undefined, "APROBACION_INVALIDA"],
    ["espec cambiada en el navegador", { ...plan(ESPEC), espec: { ...ESPEC, piezas: ESPEC.piezas.map((p) => ({ ...p, medidas: { ...p.medidas, altoM: 9.9 } })) } }, undefined, "PLAN_ALTERADO"],
    ["versión de motor cambiada", { ...plan(ESPEC), motor: { id: "globos3d", version: "0.0.1" } }, undefined, "PLAN_ALTERADO"],
  ];
  for (const [nombre, cuerpo, cookies, codigo] of casosMalos) {
    const e = entorno();
    const r = await atenderArmadaMotor(pedir(cuerpo, cookies), e.deps);
    assert.equal(r.status, 409, nombre);
    assert.equal(await codigoDe(r), codigo, nombre);
    assert.equal(e.armados(), 0, `${nombre}: no arma nada`);
    assert.equal(e.auditorias.length, 1, `${nombre}: el rechazo queda en la auditoría`);
    assert.equal(e.auditorias[0]!.quien, "regla:motor_guiada");
  }
});

test("sin espec o con una inválida: 400, y no se arma nada", async () => {
  const sinEspec = sinClave(plan(ESPEC), "espec");
  const sin = await atenderArmadaMotor(pedir(sinEspec), entorno().deps);
  assert.equal(sin.status, 400);
  assert.equal(await codigoDe(sin), "CUERPO_INVALIDO", "la espec es obligatoria en el cuerpo");
  for (const espec of [null, { version: "espec-cliente.v1", piezas: [] }, "texto"]) {
    const e = entorno();
    const r = await atenderArmadaMotor(pedir({ ...sinEspec, espec }), e.deps);
    assert.equal(r.status, 400);
    assert.equal(await codigoDe(r), "ESPEC_INVALIDA");
    assert.equal(e.armados(), 0);
  }
});

test("caché por especHash: el mismo plan se arma una vez, otro plan otra, y el tope saca el menos usado", async () => {
  const e = entorno();
  for (let i = 0; i < 3; i++) assert.equal((await atenderArmadaMotor(pedir(plan(ESPEC)), e.deps)).status, 200);
  assert.equal(e.armados(), 1, "tres peticiones, un armado");
  assert.equal((await atenderArmadaMotor(pedir(plan(OTRA_ESPEC)), e.deps)).status, 200);
  assert.equal(e.armados(), 2);
  // El SVG sale de la misma armada guardada.
  assert.equal((await atenderArmadaMotor(pedir({ ...plan(ESPEC), salida: "svg" }), e.deps)).status, 200);
  assert.equal(e.armados(), 2, "el SVG no vuelve a armar");

  const chica = entorno(1);
  await atenderArmadaMotor(pedir(plan(ESPEC)), chica.deps);
  await atenderArmadaMotor(pedir(plan(OTRA_ESPEC)), chica.deps);
  await atenderArmadaMotor(pedir(plan(ESPEC)), chica.deps);
  assert.equal(chica.armados(), 3, "con tope 1 la primera salió al entrar la segunda");

  // Un token rechazado no toca la caché.
  const e2 = entorno();
  await atenderArmadaMotor(pedir(plan(ESPEC), [SESION, OTRO_NAVEGADOR]), e2.deps);
  await atenderArmadaMotor(pedir(plan(ESPEC)), e2.deps);
  assert.equal(e2.armados(), 1);
});

test("la caché guarda los más usados: leer renueva", () => {
  const cache = crearCacheArmada(2);
  const a = armarDesdeEspec(ESPEC).armada, b = armarDesdeEspec(OTRA_ESPEC).armada;
  cache.guardar("a", a); cache.guardar("b", b);
  assert.equal(cache.leer("a"), a);
  cache.guardar("c", a);
  assert.equal(cache.leer("b"), undefined, "b era el menos usado");
  assert.equal(cache.leer("a"), a);
  assert.equal(cache.leer("c"), a);
});

test("salida svg: imagen con cabeceras de seguridad, un círculo por globo, y por pieza", async () => {
  const resultado = armarDesdeEspec(ESPEC);
  const e = entorno();
  const r = await atenderArmadaMotor(pedir({ ...plan(ESPEC), salida: "svg", vista: "frente" }), e.deps);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /^image\/svg\+xml/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const svg = await r.text();
  assert.ok(svg.startsWith("<svg"));
  assert.equal([...svg.matchAll(/<circle data-c=/g)].length, resultado.armada.globos.length / 5);

  const primera = resultado.armada.piezas[0]!;
  const unaSola = await (await atenderArmadaMotor(pedir({ ...plan(ESPEC), salida: "svg", pieza: primera.id }), e.deps)).text();
  assert.equal([...unaSola.matchAll(/<circle data-c=/g)].length, primera.globos[1]);
  // Una pieza que no existe (o sin nada que dibujar) no es un cuadro gris: 404, y el cliente se queda con el icono de la pieza.
  const ninguna = await atenderArmadaMotor(pedir({ ...plan(ESPEC), salida: "svg", pieza: "EST_99_NADA" }), e.deps);
  assert.equal(ninguna.status, 404);
  assert.equal(await codigoDe(ninguna), "PIEZA_SIN_DIBUJO");
});

test("un fallo del motor es 500 tipado y no se guarda", async () => {
  const e = entorno();
  let fallos = 0;
  const deps: DependenciasArmada = { ...e.deps, armar: () => { fallos += 1; throw new Error("boom"); } };
  const aviso = console.warn;
  console.warn = () => undefined;
  try {
    const r = await atenderArmadaMotor(pedir(plan(ESPEC)), deps);
    assert.equal(r.status, 500);
    assert.equal(await codigoDe(r), "ERROR_DEL_MOTOR");
    await atenderArmadaMotor(pedir(plan(ESPEC)), deps);
    assert.equal(fallos, 2, "el fallo no entra a la caché");
  } finally { console.warn = aviso; }
});
