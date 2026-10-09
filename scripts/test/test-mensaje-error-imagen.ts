/**
 * El mensaje de «Ver cómo quedaría» cuando falla, por código del servidor: solo se ofrece reintentar lo que puede salir
 * bien repitiéndolo (red, tiempo, 502, tope global de la hora). Y el código del servidor llega hasta el cliente.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mensajeErrorImagen } from "../../src/components/guiado/mensaje-error-imagen";
import { ErrorImagen, pedirImagenConRecuperacion, type DependenciasImagen } from "../../src/lib/generacion/pedir-imagen";

const rechazo = (status: number, codigo?: string) => new ErrorImagen(status >= 500 || status === 429 ? "servidor" : "rechazo", `estado ${status}`, status, codigo);

test("se reintenta solo lo que puede pasar solo: red, tiempo, 502, respuesta cortada y el tope global", () => {
  for (const causa of [new ErrorImagen("red", "NetworkError"), new ErrorImagen("tiempo", "115 s"), new ErrorImagen("respuesta_invalida", "sin imagen"), rechazo(502, "NO_SE_PUDO_DIBUJAR"), rechazo(503), rechazo(429, "TOPE_DE_IMAGENES")]) {
    assert.equal(mensajeErrorImagen(causa).reintentable, true, `${causa.clase} ${causa.status ?? ""} ${causa.codigo ?? ""}`);
  }
  assert.match(mensajeErrorImagen(new ErrorImagen("red", "x")).texto, /Reintentar imagen/);
  assert.match(mensajeErrorImagen(rechazo(429, "TOPE_DE_IMAGENES")).texto, /límite de imágenes por hora del servicio/);
});

test("lo que repetir no arregla NO ofrece reintentar y dice la verdad de cada código", () => {
  const casos: Array<[ErrorImagen, RegExp]> = [
    [rechazo(409, "PLAN_ALTERADO"), /cambió|versión anterior/],
    [rechazo(409, "APROBACION_INVALIDA"), /aprobación/],
    [rechazo(409, "PLAN_NO_ES_DEL_MOTOR_3D"), /otra manera/],
    [rechazo(422, "PLAN_NO_REPRESENTABLE"), /piezas que todavía no se pueden dibujar/],
    [rechazo(422, "NO_SE_PUDO_DIBUJAR"), /daría lo mismo/],
    [rechazo(400, "CUERPO_INVALIDO"), /No pude leer este plan/],
    [rechazo(400, "ESPEC_INVALIDA"), /No pude leer este plan/],
    [rechazo(400, "CAPTURA_INVALIDA"), /vista del plan/],
    [rechazo(401, "SESION_REQUERIDA"), /sesión venció/],
    [rechazo(403, "ORIGEN_NO_PERMITIDO"), /dirección/],
    [rechazo(429, "TOPE_DE_IMAGENES_NAVEGADOR"), /varias imágenes en esta hora/],
    [rechazo(400), /No se pudo dibujar/],
    [new ErrorImagen("cancelada", "x"), /canceló/],
  ];
  for (const [causa, texto] of casos) {
    const m = mensajeErrorImagen(causa);
    assert.equal(m.reintentable, false, `${causa.status} ${causa.codigo ?? "sin código"}`);
    assert.match(m.texto, texto, `${causa.status} ${causa.codigo ?? "sin código"}`);
    assert.doesNotMatch(m.texto, /reintent/i, `${causa.codigo}: no promete un reintento que no va a servir`);
  }
  assert.equal(mensajeErrorImagen(new Error("boom")).reintentable, false);
});

function dependencias(respuestas: Response[]): { deps: Partial<DependenciasImagen>; pedidas: string[] } {
  const pedidas: string[] = [];
  const deps: Partial<DependenciasImagen> = {
    fetch: async (entrada) => { pedidas.push(entrada); return respuestas.shift() ?? new Response("{}", { status: 404 }); },
    nuevoId: () => "id-1", esperar: async () => undefined, ahora: () => 0,
  };
  return { deps, pedidas };
}
const json = (cuerpo: unknown, status: number) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const pedir = (deps: Partial<DependenciasImagen>) => pedirImagenConRecuperacion({ ruta: "/api/guiada/motor/imagen", cuerpo: {}, planHash: "h", senal: new AbortController().signal, limiteIntentoMs: 1000, reintentoSilencioso: false, dependencias: deps });

test("el código del servidor llega al error del cliente; el tope del navegador no se consulta ni se repite", async () => {
  const { deps, pedidas } = dependencias([json({ error: "tope", codigo: "TOPE_DE_IMAGENES_NAVEGADOR" }, 429)]);
  const error = await pedir(deps).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ErrorImagen);
  assert.deepEqual([error.clase, error.status, error.codigo], ["rechazo", 429, "TOPE_DE_IMAGENES_NAVEGADOR"]);
  assert.deepEqual(pedidas, ["/api/guiada/motor/imagen"], "sin consultar /recuperar: otra imagen no está en camino");
  assert.equal(mensajeErrorImagen(error).reintentable, false);
});

test("el tope global (429) y el 502 siguen siendo pasajeros: se consulta la recuperación y el error trae su código", async () => {
  for (const [status, codigo] of [[429, "TOPE_DE_IMAGENES"], [502, "NO_SE_PUDO_DIBUJAR"]] as const) {
    const { deps, pedidas } = dependencias([json({ error: "x", codigo }, status), json({ estado: "no_encontrada" }, 200), json({ estado: "no_encontrada" }, 200)]);
    const error = await pedir(deps).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof ErrorImagen);
    assert.deepEqual([error.clase, error.status, error.codigo], ["servidor", status, codigo]);
    assert.ok(pedidas.length > 1, "consultó /recuperar");
    assert.equal(mensajeErrorImagen(error).reintentable, true);
  }
});

test("una respuesta de error sin JSON o sin código sigue clasificándose por su estado", async () => {
  const { deps } = dependencias([new Response("<html>bad gateway</html>", { status: 502 }), json({}, 200), json({}, 200)]);
  const error = await pedir(deps).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ErrorImagen);
  assert.deepEqual([error.clase, error.status, error.codigo], ["servidor", 502, undefined]);
});
