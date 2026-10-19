/**
 * La lógica de la calificación de la IA en el navegador (REQ-010), sin DOM ni red (el fetch es falso):
 *   npx tsx scripts/test/test-feedback-ia-ui.ts
 * - qué mensajes del cliente cuentan como «corrección» («no, eso no») y cuáles no;
 * - el cuerpo que se arma: topes del contrato, ids inválidos, escenas demasiado grandes, pasos;
 * - el controlador: escenas y capturas una sola vez y solo al calificar/deshacer/comentar, sin almacén se sigue, 413 se reintenta
 *   sin escenas, error y reintento, dos acciones seguidas no se pisan; un turno que se monta sin acción no manda nada (el registro
 *   de los producidos y la consulta de los restaurados están en test-feedback-ia-carga);
 * - el flujo del taller trae la solicitud; el encuadre de las capturas.
 */
import assert from "node:assert/strict";
import { acotarPorPartes, armarEntrada, enviarCaptura, enviarFeedback, escenaAcotada, esIdSeguro } from "../../src/components/feedback-ia/cliente-feedback";
import { crearControlador, type ConfigCalificacion } from "../../src/components/feedback-ia/controlador-calificacion";
import { esCorreccion } from "../../src/components/feedback-ia/correccion";
import { corrigeLaRespuesta, estadoPrevio, pedidoDelTurno, type MensajeChat } from "../../src/components/feedback-ia/turnos-cliente";
import { cambioDeDeshecho } from "../../src/components/feedback-ia/useCalificacionIA";
import { turnoDeshechoParaCalificar } from "../../src/components/tres-d/ia/CalificacionTurno";
import { estadoDeTurno } from "../../src/lib/globos3d/deshacer-turno";
import { diffEscenas } from "../../src/lib/globos3d/diff-escenas";
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
  await prueba("«no, eso no» y las correcciones claras corrigen", () => {
    for (const si of ["No, eso no", "no eso no es lo que pedí", "No es lo que pedí", "no, así no", "Está mal", "quedó mal", "te equivocaste", "Deshaz eso", "no me gusta", "No me gusta.", "¡No, esa no!", "vuelve a como estaba", "No, eso no es lo que te pedí", "no era eso", "mal"]) assert.equal(esCorreccion(si), true, si);
  });
  await prueba("un «no» suelto, una duda, un elogio o una respuesta NO corrigen (los falsos positivos ensucian los datos)", () => {
    for (const no of ["no sé", "No tengo foto", "no hay presupuesto", "no", "", "Quiero un arco verde", "¿cuánto cuesta?", "no mucho, unos 50 globos", "perfecto, gracias",
      "No estoy segura, déjame pensarlo", "¿No es lo mismo en rosa que en lila?", "No, esa me encanta", "No así está perfecto", "Eso no lo sé todavía", "Eso no", "eso no me preocupa tanto", "no, eso no lo sé",
      "No me gusta tanto el rojo, prefiero el azul", "No es lo que imaginaba pero me gusta", "¿Por qué no me gusta?", "Esa me gusta", "no, gracias", "No era necesario, pero qué bien", "ese es el error del año, jaja"]) assert.equal(esCorreccion(no), false, no);
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
    c.fijarDeshecho(true);
    c.fijarDeshecho(true);
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
  await prueba("solo los cambios cuentan: lo primero que se ve (al montar o al volver a la escena) es el punto de partida", () => {
    assert.equal(cambioDeDeshecho(undefined, true), "nada", "al montar ya deshecho (o al volver a la escena): no manda nada");
    assert.equal(cambioDeDeshecho(undefined, false), "nada");
    assert.equal(cambioDeDeshecho(false, true), "deshizo");
    assert.equal(cambioDeDeshecho(true, false), "rehizo");
    assert.equal(cambioDeDeshecho(true, true), "nada");
    assert.equal(cambioDeDeshecho(false, false), "nada");
    assert.equal(cambioDeDeshecho(true, undefined), "nada", "turno de otra escena: no se sabe, no se hace nada");
  });
  await prueba("rehacer manda deshecho:false; deshacer de nuevo, deshecho:true", async () => {
    const srv = servidorFalso();
    const c = crearControlador(config(srv.buscar));
    c.fijarDeshecho(true);
    await c.esperar();
    c.fijarDeshecho(false);
    await c.esperar();
    c.fijarDeshecho(true);
    await c.esperar();
    assert.deepEqual(srv.posts().map((p) => p.cuerpo?.deshecho), [true, false, true]);
    assert.equal("escenaAntes" in (srv.posts()[1]?.cuerpo ?? {}), false);
    const sinHaber = servidorFalso();
    const d = crearControlador(config(sinHaber.buscar));
    d.fijarDeshecho(false);
    await d.esperar();
    assert.equal(sinHaber.posts().length, 0, "rehacer algo que nunca se marcó deshecho no manda nada");
  });
  await prueba("para calificar, «deshecho» es el botón, o un Ctrl+Z que se queda 5 s; en otra escena no se sabe", () => {
    const base = escenaPredefinida("arco_organico_columnas_guirnalda");
    const alta = { ...base, nodos: base.nodos.map((n) => (n.id === "columna-izq" && n.pieza.tipo === "columna" ? { ...n, pieza: { ...n.pieza, alturaCm: 220 } } : n)) };
    const diff = diffEscenas(base, alta);
    const aplicado = estadoDeTurno(alta, diff);
    const revertido = estadoDeTurno(base, diff);
    assert.equal(turnoDeshechoParaCalificar(undefined, true, true), undefined);
    assert.equal(turnoDeshechoParaCalificar(aplicado, true, true), false, "si hoy está aplicado no está deshecho");
    assert.equal(turnoDeshechoParaCalificar(revertido, true, false), true, "el botón cuenta al instante");
    assert.equal(turnoDeshechoParaCalificar(revertido, false, false), false, "Ctrl+Z recién hecho no cuenta");
    assert.equal(turnoDeshechoParaCalificar(revertido, false, true), true, "Ctrl+Z que se quedó 5 s sí");
  });
  await prueba("la escena de después que cambió desde el primer envío se manda UNA vez más (el plan del cliente llega tras el texto)", async () => {
    const srv = servidorFalso();
    let despues: Record<string, unknown> = { plan: null };
    const c = crearControlador(config(srv.buscar, { escenas: () => ({ antes: escena("antes"), despues }) }));
    c.calificar(5);
    await c.esperar();
    c.calificar(6);
    await c.esperar();
    assert.equal("escenaAntes" in (srv.posts()[1]?.cuerpo ?? {}), false, "sin cambios no se repite");
    despues = { plan: { piezas: 3 } };
    c.calificar(7);
    await c.esperar();
    assert.deepEqual(srv.posts()[2]?.cuerpo?.escenaDespues, { plan: { piezas: 3 } });
    despues = { plan: { piezas: 4 } };
    c.calificar(8);
    await c.esperar();
    assert.equal("escenaAntes" in (srv.posts()[3]?.cuerpo ?? {}), false, "solo una vez más");
  });
  await prueba("un turno calificado desde otro navegador (403 TURNO_AJENO) se deja en paz: sin reintentos ni más peticiones", async () => {
    const srv = servidorFalso(() => Response.json({ error: "x", codigo: "TURNO_AJENO" }, { status: 403 }));
    const c = crearControlador(config(srv.buscar));
    c.calificar(5);
    await c.esperar();
    assert.equal(c.leer().fase, "ajeno");
    c.calificar(6);
    c.enviarPorQue();
    c.reintentar();
    await c.esperar();
    assert.equal(srv.posts().length, 1);
    assert.equal(c.leer().gracias, false);
  });
  await prueba("sin acción no hay registro: montar no manda nada; la primera calificación lleva los datos del turno", async () => {
    const srv = servidorFalso();
    const cfg = config(srv.buscar);
    const c = crearControlador(cfg);
    await c.esperar();
    assert.equal(srv.llamadas.length, 0, "montar no pide ni registra nada");
    c.calificar(4);
    await c.esperar();
    assert.equal(srv.posts().length, 1);
    const cuerpo = srv.posts()[0]?.cuerpo ?? {};
    assert.equal(cuerpo.turnoId, "t1");
    assert.equal(cuerpo.pedido, "hazla más alta");
    assert.equal(cuerpo.calificacion, 4);
    assert.ok(cuerpo.escenaAntes, "las escenas van con la primera calificación");
    assert.equal(c.leer().gracias, true);
  });
  await prueba("acotar por partes: lo que cabe va entero; si no, se sueltan primero las partes más grandes y se dice cuáles", () => {
    assert.deepEqual(acotarPorPartes({ plan: { a: 1 }, cotizacion: { total: 5 } }), { plan: { a: 1 }, cotizacion: { total: 5 } });
    assert.equal(acotarPorPartes(undefined), undefined);
    const grande = acotarPorPartes({ plan: { a: 1 }, decoraciones: ["x".repeat(500)], cotizacion: { total: 5 } }, 400);
    assert.deepEqual(grande, { plan: { a: 1 }, cotizacion: { total: 5 }, omitido: ["decoraciones"] });
    const dos = acotarPorPartes({ pequena: 1, a: "x".repeat(300), b: "y".repeat(250) }, 500);
    assert.deepEqual(dos?.omitido, ["a"]);
    assert.ok(dos && "b" in dos && "pequena" in dos);
  });
  await prueba("lo que no se sabe no se manda: sin pasos, sin ms ni costes inventados", () => {
    const e = armarEntrada({ producto: "taller", turnoId: "t1", datos: { pedido: "x", pasos: [], latenciaMs: undefined, costeUsd: null } });
    assert.ok(e);
    for (const clave of ["pasos", "latenciaMs", "costeUsd"]) assert.equal(clave in e, false, clave);
    const conPaso = armarEntrada({ producto: "taller", turnoId: "t1", datos: { pasos: [{ nombre: "ver_escena", ok: false, resumen: "" }] } });
    assert.equal(conPaso?.pasos?.[0]?.ok, false);
    assert.equal(conPaso?.pasos?.[0] && "ms" in conPaso.pasos[0], false);
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
