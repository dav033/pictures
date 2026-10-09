/**
 * La lógica de la calificación de la IA en el navegador (REQ-010), sin DOM ni red (el fetch es falso):
 *   npx tsx scripts/test/test-feedback-ia-ui.ts
 * - qué mensajes del cliente cuentan como «corrección» («no, eso no») y cuáles no;
 * - el cuerpo que se arma: topes del contrato, ids inválidos, escenas demasiado grandes, pasos;
 * - el controlador: escenas y capturas una sola vez y solo al calificar/deshacer/comentar, sin almacén se sigue, 413 se reintenta
 *   sin escenas, error y reintento, dos acciones seguidas no se pisan;
 * - el flujo del taller trae la solicitud; el registro de turnos en memoria; el encuadre de las capturas.
 */
import assert from "node:assert/strict";
import { armarEntrada, enviarCaptura, enviarFeedback, escenaAcotada, esIdSeguro } from "../../src/components/feedback-ia/cliente-feedback";
import { crearControlador, type ConfigCalificacion } from "../../src/components/feedback-ia/controlador-calificacion";
import { esCorreccion } from "../../src/components/feedback-ia/correccion";
import { corrigeLaRespuesta, estadoPrevio, pedidoDelTurno, type MensajeChat } from "../../src/components/feedback-ia/turnos-cliente";
import { pasaADeshecho } from "../../src/components/feedback-ia/useCalificacionIA";
import { encuadreDeEscena } from "../../src/components/tres-d/ia/captura-feedback";
import { crearRegistroFeedback, pasosDelFlujo } from "../../src/components/tres-d/ia/registro-feedback";
import { TOPE_ESCENA_BYTES } from "../../src/lib/feedback-ia/contrato";
import { armarEscena } from "../../src/lib/globos3d/escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { TIPO_NDJSON, lineaNdjson, pedirEscenaIA } from "../../src/lib/globos3d/flujo-escena-ia";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => { await fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

type Llamada = { ruta: string; cuerpo: Record<string, unknown> | null; campos: Record<string, string> | null };
const OK = { ok: true, turnoId: "t1", producto: "taller", calificacion: null, creado: true, escenasGuardadas: true, actualizadoEn: "x" };
/** Un fetch falso que anota las llamadas y contesta lo que diga `contestar`. */
function servidorFalso(contestar: (llamada: Llamada, n: number) => Response = () => Response.json(OK)) {
  const llamadas: Llamada[] = [];
  const buscar: typeof fetch = async (entrada, init) => {
    const ruta = String(entrada);
    const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const campos = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `archivo:${v.size}`])) : null;
    const llamada = { ruta, cuerpo, campos };
    llamadas.push(llamada);
    return contestar(llamada, llamadas.length);
  };
  return { buscar, llamadas, posts: () => llamadas.filter((l) => l.ruta === "/api/feedback-ia"), capturas: () => llamadas.filter((l) => l.ruta.endsWith("/capturas")) };
}
const jpeg = (bytes = 1000) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
const escena = (marca: string) => ({ version: 1, marca, nodos: [] });
const almacenCaido = (l: Llamada) => (l.ruta.endsWith("/capturas") ? Response.json({ error: "x", codigo: "ALMACEN_NO_CONFIGURADO" }, { status: 503 }) : Response.json(OK));

function config(buscar: typeof fetch, extra: Partial<ConfigCalificacion> = {}): ConfigCalificacion & { vistas: { capturas: number } } {
  const vistas = { capturas: 0 };
  return {
    producto: "taller",
    turnoId: "t1",
    conversacionId: () => "3d-20261009-120000-abcd",
    datos: () => ({ pedido: "hazla más alta", respuesta: "Listo, subí la columna.", solicitudId: "11111111-2222-3333-4444-555555555555", costeUsd: 0.003, latenciaMs: 12000, pasos: [{ nombre: "ver_escena", ok: true, resumen: "Miré la escena" }] }),
    escenas: () => ({ antes: escena("antes"), despues: escena("despues") }),
    capturas: async () => { vistas.capturas += 1; return { antes: jpeg(), despues: jpeg() }; },
    buscar,
    vistas,
    ...extra,
  };
}

async function main() {
  console.log("Correcciones del cliente");
  await prueba("«no, eso no» y parecidos corrigen; un «no» suelto o una pregunta no", () => {
    for (const si of ["No, eso no", "no eso no es lo que pedí", "Eso no", "No es lo que pedí", "no, así no", "Está mal", "te equivocaste", "Deshaz eso", "no me gusta", "¡No, esa no!", "vuelve a como estaba"]) assert.equal(esCorreccion(si), true, si);
    for (const no of ["no sé", "No tengo foto", "no hay presupuesto", "no", "", "Quiero un arco verde", "¿cuánto cuesta?", "no mucho, unos 50 globos", "perfecto, gracias"]) assert.equal(esCorreccion(no), false, no);
  });

  console.log("Conversación del cliente");
  const chat: MensajeChat[] = [
    { id: "a0", role: "assistant", content: "Hola" },
    { id: "u1", role: "user", content: "Quiero un arco azul" },
    { id: "a1", role: "assistant", content: "Aquí tienes un arco azul" },
    { id: "u2", role: "user", content: "No, eso no" },
    { id: "a2", role: "assistant", content: "Perdón" },
  ];
  await prueba("el pedido es el último mensaje del cliente; corregido solo si el siguiente lo corrige", () => {
    assert.equal(pedidoDelTurno(chat, 2), "Quiero un arco azul");
    assert.equal(pedidoDelTurno(chat, 4), "No, eso no");
    assert.equal(pedidoDelTurno(chat, 0), undefined);
    assert.equal(corrigeLaRespuesta(chat, 2), true);
    assert.equal(corrigeLaRespuesta(chat, 4), false);
    assert.equal(corrigeLaRespuesta(chat, 0), false);
  });
  await prueba("el estado previo es el de la última respuesta de la IA anterior que lo tenga", () => {
    const planes: Record<number, string | undefined> = { 0: "p0", 2: undefined, 4: "p4" };
    assert.equal(estadoPrevio(chat, 4, (i) => planes[i]), "p0");
    assert.equal(estadoPrevio(chat, 2, (i) => planes[i]), "p0");
    assert.equal(estadoPrevio(chat, 0, (i) => planes[i]), undefined);
  });

  console.log("Cuerpo de la calificación");
  await prueba("lleva lo que se sabe, con los topes del contrato", () => {
    const e = armarEntrada({ producto: "taller", turnoId: "t1", conversacionId: "3d-1", datos: { pedido: "p ".repeat(3000), respuesta: "r", solicitudId: "abc-123", costeUsd: 0.5, latenciaMs: 1234.6, pasos: [{ nombre: "x".repeat(300), ok: false, resumen: "y".repeat(500), ms: 12.4 }] }, calificacion: 7, motivos: ["colores"], comentario: "  falta  ", escenas: { antes: escena("a"), despues: escena("d") } });
    assert.ok(e);
    assert.ok(e.pedido && e.pedido.length <= 4000);
    assert.equal(e.calificacion, 7);
    assert.deepEqual(e.motivos, ["colores"]);
    assert.equal(e.comentario, "falta");
    assert.equal(e.solicitudId, "abc-123");
    assert.equal(e.latenciaMs, 1235);
    assert.equal(e.pasos?.[0]?.nombre.length, 120);
    assert.equal(e.pasos?.[0]?.resumen.length, 300);
    assert.equal(e.pasos?.[0]?.ms, 12);
    assert.deepEqual(e.escenaAntes, escena("a"));
  });
  await prueba("ids inválidos: sin turno no hay petición; sin solicitud válida, se omite", () => {
    assert.equal(armarEntrada({ producto: "cliente", turnoId: "con espacios", datos: {} }), null);
    const e = armarEntrada({ producto: "cliente", turnoId: "ok", conversacionId: "no válido!", datos: { solicitudId: "a b" } });
    assert.ok(e);
    assert.equal("solicitudId" in e, false);
    assert.equal("conversacionId" in e, false);
    assert.equal(esIdSeguro("a".repeat(65)), false);
  });
  await prueba("una escena que no cabe o no es un objeto no viaja (mejor sin escena que perder la nota)", () => {
    assert.equal(escenaAcotada({ x: "a".repeat(TOPE_ESCENA_BYTES + 1) }), undefined);
    assert.equal(escenaAcotada([1]), undefined);
    assert.equal(escenaAcotada(null), undefined);
    const ciclica: Record<string, unknown> = {};
    ciclica.yo = ciclica;
    assert.equal(escenaAcotada(ciclica), undefined);
    assert.deepEqual(escenaAcotada({ ok: 1 }), { ok: 1 });
  });

  console.log("Llamadas");
  await prueba("enviarFeedback y enviarCaptura nunca lanzan", async () => {
    const roto: typeof fetch = async () => { throw new TypeError("sin red"); };
    const entrada = armarEntrada({ producto: "taller", turnoId: "t1", datos: {} });
    assert.ok(entrada);
    assert.deepEqual(await enviarFeedback(entrada, roto), { ok: false, estado: 0, codigo: null });
    assert.equal(await enviarCaptura({ turnoId: "t1", producto: "taller", momento: "antes", imagen: jpeg() }, roto), "error");
    const sinAlmacen = servidorFalso(() => Response.json({ error: "x", codigo: "ALMACEN_NO_CONFIGURADO" }, { status: 503 }));
    assert.equal(await enviarCaptura({ turnoId: "t1", producto: "taller", momento: "antes", conversacionId: "c1", imagen: jpeg() }, sinAlmacen.buscar), "sin_almacen");
    assert.deepEqual(sinAlmacen.llamadas[0]?.campos, { turnoId: "t1", producto: "taller", momento: "antes", conversacionId: "c1", imagen: "archivo:1000" });
    assert.equal(await enviarCaptura({ turnoId: "t1", producto: "taller", momento: "antes", imagen: jpeg(700 * 1024) }, sinAlmacen.buscar), "error", "más de 600 KB ni se intenta");
    assert.equal(sinAlmacen.llamadas.length, 1);
  });

  console.log("Controlador");
  await prueba("calificar: UNA petición con nota, escenas, pasos y solicitud; las capturas después, con la conversación, y nada antes", async () => {
    const srv = servidorFalso();
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    assert.equal(srv.llamadas.length, 0, "ver el turno no manda nada");
    assert.equal(cfg.vistas.capturas, 0, "ni captura");
    c.calificar(4);
    assert.equal(c.leer().fase, "enviando");
    await c.esperar();
    const [post] = srv.posts();
    assert.equal(srv.posts().length, 1);
    assert.equal(post?.cuerpo?.calificacion, 4);
    assert.deepEqual(post?.cuerpo?.escenaAntes, escena("antes"));
    assert.deepEqual(post?.cuerpo?.escenaDespues, escena("despues"));
    assert.equal(post?.cuerpo?.solicitudId, "11111111-2222-3333-4444-555555555555");
    assert.equal(post?.cuerpo?.conversacionId, "3d-20261009-120000-abcd");
    assert.deepEqual(post?.cuerpo?.pasos, [{ nombre: "ver_escena", ok: true, resumen: "Miré la escena" }]);
    assert.equal(post?.cuerpo?.deshecho, undefined);
    assert.equal(cfg.vistas.capturas, 1);
    assert.deepEqual(srv.capturas().map((x) => x.campos?.momento), ["antes", "despues"]);
    assert.equal(srv.capturas()[0]?.campos?.conversacionId, "3d-20261009-120000-abcd");
    assert.equal(c.leer().fase, "enviado");
    assert.equal(c.leer().gracias, true);
  });
  await prueba("cambiar la nota: otra petición SIN escenas y SIN volver a capturar", async () => {
    const srv = servidorFalso();
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    c.calificar(4);
    await c.esperar();
    c.calificar(9);
    await c.esperar();
    assert.equal(srv.posts().length, 2);
    assert.equal(srv.posts()[1]?.cuerpo?.calificacion, 9);
    assert.equal("escenaAntes" in (srv.posts()[1]?.cuerpo ?? {}), false);
    assert.equal(cfg.vistas.capturas, 1);
    assert.equal(srv.capturas().length, 2);
    c.calificar(9);
    await c.esperar();
    assert.equal(srv.posts().length, 2, "la misma nota no se vuelve a mandar");
    c.calificar(0);
    c.calificar(11);
    c.calificar(2.5);
    assert.equal(srv.posts().length, 2, "notas fuera de 1 a 10 se ignoran");
  });
  await prueba("deshacer: manda deshecho con las escenas, abre el «por qué» y todavía no dice «Gracias»", async () => {
    const srv = servidorFalso();
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    c.marcarDeshecho();
    c.marcarDeshecho();
    await c.esperar();
    assert.equal(srv.posts().length, 1);
    assert.equal(srv.posts()[0]?.cuerpo?.deshecho, true);
    assert.equal("calificacion" in (srv.posts()[0]?.cuerpo ?? {}), false);
    assert.ok(srv.posts()[0]?.cuerpo?.escenaAntes);
    assert.equal(c.leer().porQueAbierto, true);
    assert.equal(c.leer().gracias, false);
    assert.equal(cfg.vistas.capturas, 1);
  });
  await prueba("el «por qué» manda motivos y comentario con la nota, y se cierra", async () => {
    const srv = servidorFalso();
    const c = crearControlador(config(srv.buscar));
    c.calificar(3);
    await c.esperar();
    c.alternarPorQue();
    assert.equal(c.leer().porQueAbierto, true);
    c.alternarMotivo("colores");
    c.alternarMotivo("lento");
    c.alternarMotivo("colores");
    c.escribirComentario("  Faltó la guirnalda  ");
    assert.equal(srv.posts().length, 1, "elegir motivos no manda nada hasta «Enviar»");
    c.enviarPorQue();
    await c.esperar();
    const ultimo = srv.posts()[1]?.cuerpo;
    assert.deepEqual(ultimo?.motivos, ["lento"]);
    assert.equal(ultimo?.comentario, "Faltó la guirnalda");
    assert.equal(ultimo?.calificacion, 3);
    assert.equal(c.leer().porQueAbierto, false);
  });
  await prueba("comentar sin calificar también guarda las escenas y captura", async () => {
    const srv = servidorFalso();
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    c.escribirComentario("mejorar los colores");
    c.enviarPorQue();
    await c.esperar();
    assert.equal(srv.posts()[0]?.cuerpo?.comentario, "mejorar los colores");
    assert.ok(srv.posts()[0]?.cuerpo?.escenaDespues);
    assert.equal(cfg.vistas.capturas, 1);
    assert.equal(c.leer().gracias, true);
  });
  await prueba("sin almacén (503 ALMACEN_NO_CONFIGURADO) se sigue: la nota queda y no se insiste con las capturas", async () => {
    const srv = servidorFalso(almacenCaido);
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    c.calificar(5);
    await c.esperar();
    c.calificar(6);
    await c.esperar();
    assert.equal(c.leer().fase, "enviado");
    assert.equal(srv.capturas().length, 1, "la segunda captura (después) ni se intenta");
    assert.equal(cfg.vistas.capturas, 1);
  });
  await prueba("una captura que falla se reintenta en la siguiente acción; si la captura lanza, la nota no se pierde", async () => {
    let n = 0;
    const srv = servidorFalso((l) => (l.ruta.endsWith("/capturas") && (n += 1) <= 2 ? Response.json({ error: "x", codigo: "ALMACEN_NO_DISPONIBLE" }, { status: 502 }) : Response.json(OK)));
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    c.calificar(5);
    await c.esperar();
    c.calificar(6);
    await c.esperar();
    assert.equal(cfg.vistas.capturas, 2);
    const lanza = crearControlador(config(servidorFalso().buscar, { capturas: async () => { throw new Error("sin WebGL"); } }));
    lanza.calificar(8);
    await lanza.esperar();
    assert.equal(lanza.leer().fase, "enviado");
  });
  await prueba("413 por el peso de las escenas: se reintenta sin ellas y la nota queda", async () => {
    const srv = servidorFalso((l) => (l.cuerpo && "escenaAntes" in l.cuerpo ? Response.json({ error: "x", codigo: "CUERPO_DEMASIADO_GRANDE" }, { status: 413 }) : Response.json({ ...OK, escenasGuardadas: false })));
    const c = crearControlador(config(srv.buscar));
    c.calificar(5);
    await c.esperar();
    assert.equal(srv.posts().length, 2);
    assert.equal("escenaAntes" in (srv.posts()[1]?.cuerpo ?? {}), false);
    assert.equal(c.leer().fase, "enviado");
    c.calificar(6);
    await c.esperar();
    assert.equal("escenaAntes" in (srv.posts()[2]?.cuerpo ?? {}), false, "no se vuelve a probar con escenas");
  });
  await prueba("un error se dice sin molestar y «Reintentar» lo vuelve a mandar con lo mismo (incluidas las escenas)", async () => {
    let fallar = true;
    const srv = servidorFalso(() => (fallar ? Response.json({ error: "x", codigo: "BASE_NO_DISPONIBLE" }, { status: 503 }) : Response.json(OK)));
    const c = crearControlador(config(srv.buscar));
    c.calificar(2);
    await c.esperar();
    assert.equal(c.leer().fase, "error");
    assert.equal(c.leer().nota, 2, "la nota sigue elegida");
    assert.equal(c.leer().gracias, false);
    fallar = false;
    c.reintentar();
    await c.esperar();
    assert.equal(c.leer().fase, "enviado");
    assert.ok(srv.posts()[1]?.cuerpo?.escenaAntes, "las escenas no se dieron por enviadas");
    assert.equal(srv.posts()[1]?.cuerpo?.calificacion, 2);
  });
  await prueba("dos acciones seguidas no se pisan: se manda de una en una y la última lleva el estado final", async () => {
    let enVuelo = 0;
    let maximo = 0;
    const srv = servidorFalso();
    const buscar: typeof fetch = async (e, i) => {
      if (String(e) === "/api/feedback-ia") { enVuelo += 1; maximo = Math.max(maximo, enVuelo); await new Promise((r) => setTimeout(r, 5)); enVuelo -= 1; }
      return srv.buscar(e, i);
    };
    const c = crearControlador(config(buscar));
    c.calificar(3);
    c.calificar(8);
    c.alternarMotivo("feo");
    c.enviarPorQue();
    await c.esperar();
    assert.equal(maximo, 1);
    const ultimo = srv.posts().at(-1)?.cuerpo;
    assert.equal(ultimo?.calificacion, 8);
    assert.deepEqual(ultimo?.motivos, ["feo"]);
    assert.equal(srv.posts().filter((p) => p.cuerpo && "escenaAntes" in p.cuerpo).length, 1, "las escenas viajan una sola vez");
  });
  await prueba("un turno sin id válido no manda nada ni se rompe", async () => {
    const srv = servidorFalso();
    const c = crearControlador(config(srv.buscar, { turnoId: "no valido!" }));
    c.calificar(5);
    await c.esperar();
    assert.equal(srv.llamadas.length, 0);
    assert.equal(c.leer().fase, "libre");
  });
  await prueba("quien está suscrito se entera de cada cambio y puede soltarse", async () => {
    const c = crearControlador(config(servidorFalso().buscar));
    let avisos = 0;
    const soltar = c.suscribir(() => { avisos += 1; });
    c.calificar(5);
    await c.esperar();
    assert.ok(avisos >= 3);
    const antes = avisos;
    soltar();
    c.calificar(6);
    await c.esperar();
    assert.equal(avisos, antes);
  });
  await prueba("solo el paso a «deshecho» cuenta (un turno que ya llega deshecho no manda nada)", () => {
    assert.equal(pasaADeshecho(false, true), true);
    assert.equal(pasaADeshecho(true, true), false);
    assert.equal(pasaADeshecho(false, false), false);
    assert.equal(pasaADeshecho(true, false), false);
  });

  console.log("Taller");
  await prueba("el flujo del taller trae la cabecera x-request-id (también sin flujo); sin ella, nada cambia", async () => {
    const final = lineaNdjson({ tipo: "final", estado: 200, cuerpo: { ok: 1 } });
    const flujo = (cabeceras: Record<string, string>) => new Response(final, { headers: { "Content-Type": TIPO_NDJSON, ...cabeceras } });
    const senal = new AbortController().signal;
    assert.deepEqual(await pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: senal, buscar: async () => flujo({ "x-request-id": "r-1" }) }), { estado: 200, datos: { ok: 1 }, solicitudId: "r-1" });
    assert.deepEqual(await pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: senal, buscar: async () => flujo({}) }), { estado: 200, datos: { ok: 1 } });
    const json = await pedirEscenaIA({ cuerpo: {}, cabeceras: {}, signal: senal, buscar: async () => Response.json({ a: 1 }, { headers: { "x-request-id": "r-2" } }) });
    assert.equal(json.solicitudId, "r-2");
  });
  await prueba("el registro de turnos guarda los últimos y los pasos del flujo con su éxito", () => {
    const base = escenaPredefinida("arco_organico_columnas_guirnalda");
    const registro = crearRegistroFeedback(2);
    for (const id of ["a", "b", "c"]) registro.guardar(id, { pasos: [], escenaAntes: base, escenaDespues: base });
    assert.equal(registro.leer("a"), undefined);
    assert.ok(registro.leer("b") && registro.leer("c"));
    registro.vaciar();
    assert.equal(registro.leer("c"), undefined);
    assert.deepEqual(pasosDelFlujo([{ n: 1, herramienta: "cambiar_pieza", resumen: "alto 220 cm", consulta: false, ok: false }]), [{ nombre: "cambiar_pieza", ok: false, resumen: "alto 220 cm" }]);
  });
  await prueba("el encuadre de la captura deja ver toda la decoración dentro de los límites de la cámara de la foto", () => {
    const e = encuadreDeEscena(armarEscena(escenaPredefinida("arco_organico_columnas_guirnalda")));
    assert.ok(e.altoCm >= 60 && e.altoCm <= 1500, `altoCm ${e.altoCm}`);
    assert.equal(e.aspecto, 4 / 3);
    assert.ok(e.centroYCm > 0);
  });

  console.log(`\n${pruebas} pruebas OK`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
