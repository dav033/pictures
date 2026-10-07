import { strict as assert } from "node:assert";
import { claveGrafica, contadores, graficaGuardada, GraficaMotorSchema, MAX_EN_VUELO, pedirGrafica, reiniciarGraficasParaPruebas } from "@/components/guiado/grafica-motor-cola";

// Probador (2026-10-06): 19 POST /api/plan-armado-columna-organica para 2 columnas, 9 cancelados y 17 cuerpos vacíos (400).
// Sin coste y sin red: la red es falsa. Comprueba que el dibujo se pide UNA vez por clave, sin abortar y con pocos a la vez.

type Peticion = { ruta: string; cuerpo: string; responder: (estado: number, datos?: unknown, cabeceras?: Record<string, string>) => void };
const pendientes: Peticion[] = [];
const redFalsa: typeof fetch = (entrada, opciones) => new Promise<Response>((resolver) => {
  assert.equal(opciones?.signal, undefined, "la gráfica nunca cancela una petición en curso");
  pendientes.push({
    ruta: String(entrada),
    cuerpo: String(opciones?.body ?? ""),
    responder: (estado, datos, cabeceras) => resolver(new Response(JSON.stringify(datos ?? {}), { status: estado, headers: { "Content-Type": "application/json", ...cabeceras } })),
  });
});
const SVG = { grafica: { svg: "<svg/>", ancho: 600, alto: 720 } };
const tic = () => new Promise((listo) => setTimeout(listo, 0));
const RUTA = "/api/plan-armado-columna-organica";

async function main(): Promise<void> {
  // 1) La misma pieza pedida muchas veces (re-render, remontaje, doble montaje de desarrollo) sale UNA vez.
  reiniciarGraficasParaPruebas(redFalsa);
  const clave = claveGrafica({ ruta: RUTA, version: "a".repeat(64), estructuraId: "EST_01", armado: null, tonos: "#ffffff,#000000" });
  let cuerpos = 0;
  const cuerpo = () => { cuerpos += 1; return { plan: { x: 1 }, estructura_id: "EST_01", armado_columna_organica: null }; };
  const promesas = Array.from({ length: 6 }, () => pedirGrafica(clave, RUTA, cuerpo));
  await tic();
  assert.equal(pendientes.length, 1, "seis pedidos de la misma pieza = una petición");
  assert.equal(cuerpos, 1, "el cuerpo (el plan entero) se arma una sola vez");
  assert.ok(JSON.parse(pendientes[0]!.cuerpo).estructura_id === "EST_01" && pendientes[0]!.cuerpo.length > 2, "el cuerpo nunca va vacío");
  pendientes.shift()!.responder(200, SVG);
  const resultados = await Promise.all(promesas);
  assert.ok(resultados.every((grafica) => grafica?.svg === "<svg/>"));
  assert.equal(graficaGuardada(clave)?.svg, "<svg/>", "queda guardado para el siguiente montaje");
  await pedirGrafica(clave, RUTA, cuerpo);
  assert.equal(contadores.pedidas, 1, "un montaje posterior usa el guardado");

  // 2) La clave cambia con la versión del plan, el armado y los tonos; no con un objeto nuevo de igual contenido.
  const base = { ruta: RUTA, version: "b".repeat(64), estructuraId: "EST_02", armado: { capas: [1, 2] }, tonos: "#111111" };
  assert.equal(claveGrafica(base), claveGrafica({ ...base, armado: { capas: [1, 2] } }));
  assert.notEqual(claveGrafica(base), claveGrafica({ ...base, version: "c".repeat(64) }));
  assert.notEqual(claveGrafica(base), claveGrafica({ ...base, armado: { capas: [1, 3] } }));
  assert.notEqual(claveGrafica(base), claveGrafica({ ...base, tonos: "#222222" }));

  // 3) Varias piezas: a lo sumo MAX_EN_VUELO a la vez y la más reciente primero.
  reiniciarGraficasParaPruebas(redFalsa);
  const claves = Array.from({ length: 5 }, (_, indice) => claveGrafica({ ...base, estructuraId: `EST_${indice}` }));
  const varias = claves.map((unaClave, indice) => pedirGrafica(unaClave, RUTA, () => ({ estructura_id: `EST_${indice}` })));
  await tic();
  assert.equal(pendientes.length, MAX_EN_VUELO, `solo ${MAX_EN_VUELO} a la vez`);
  const orden: string[] = [];
  while (pendientes.length) {
    const siguiente = pendientes.shift()!;
    orden.push(JSON.parse(siguiente.cuerpo).estructura_id as string);
    siguiente.responder(200, SVG);
    await tic(); await tic();
    assert.ok(pendientes.length <= MAX_EN_VUELO);
  }
  await Promise.all(varias);
  assert.equal(contadores.enVueloMaximo, MAX_EN_VUELO);
  assert.deepEqual(orden, ["EST_0", "EST_1", "EST_4", "EST_3", "EST_2"], "las que esperan salen de la más reciente a la más vieja");

  // 4) 429 del motor: un reintento tras Retry-After; un fallo se recuerda un rato (no se pide en cada render).
  reiniciarGraficasParaPruebas(redFalsa);
  const ocupada = pedirGrafica(claves[0]!, RUTA, () => ({ estructura_id: "EST_0" }));
  await tic();
  pendientes.shift()!.responder(429, { error: "ocupado" }, { "Retry-After": "0.01" });
  await new Promise((listo) => setTimeout(listo, 40));
  assert.equal(pendientes.length, 1, "reintenta una vez");
  pendientes.shift()!.responder(200, SVG);
  assert.equal((await ocupada)?.svg, "<svg/>");
  const fallida = pedirGrafica(claves[1]!, RUTA, () => ({ estructura_id: "EST_1" }));
  await tic();
  pendientes.shift()!.responder(500, { error: "x" });
  assert.equal(await fallida, null);
  assert.equal(graficaGuardada(claves[1]!), null, "el fallo reciente se recuerda");
  assert.equal(await pedirGrafica(claves[1]!, RUTA, () => ({})), null);
  assert.equal(pendientes.length, 0, "y no se vuelve a pedir enseguida");
  assert.equal(graficaGuardada(claves[1]!, Date.now() + 60_000), undefined, "pasado el rato, se puede volver a pedir");

  // 5) La columna clásica trae `lienzo: { ancho, alto }`: antes no pasaba el esquema y la tarjeta mostraba el icono.
  const columna = GraficaMotorSchema.parse({ svg: "<g/>", lienzo: { ancho: 600, alto: 720 } });
  assert.equal(columna.lienzo, 600);
  assert.equal(columna.alto, 720);
  assert.equal(GraficaMotorSchema.parse({ svg: "<g/>", lienzo: 600 }).lienzo, 600);

  // 6) Un fallo permanente (4xx o un dibujo que no pasa el esquema) no se vuelve a pedir nunca en la sesión: antes las
  //    columnas clásicas se pedían cada ~20 s (verificador, 2026-10-06: ≈30 POST en 5 min y 429 motor_ocupado).
  reiniciarGraficasParaPruebas(redFalsa);
  const rota = pedirGrafica(claves[2]!, RUTA, () => ({ estructura_id: "EST_2" }));
  await tic();
  pendientes.shift()!.responder(200, { grafica: { svg: "", lienzo: "ancho" } });
  assert.equal(await rota, null);
  assert.equal(graficaGuardada(claves[2]!, Date.now() + 3_600_000), null, "un dibujo inválido no caduca");
  const rechazada = pedirGrafica(claves[3]!, RUTA, () => ({ estructura_id: "EST_3" }));
  await tic();
  pendientes.shift()!.responder(422, { error: "sin dibujo" });
  assert.equal(await rechazada, null);
  assert.equal(graficaGuardada(claves[3]!, Date.now() + 3_600_000), null, "un 422 no caduca");
  await pedirGrafica(claves[3]!, RUTA, () => ({}));
  assert.equal(pendientes.length, 0, "y no sale otra petición");

  console.log("test-grafica-motor-cola: OK");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
