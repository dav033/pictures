/**
 * La calificación guardada al recargar (REQ-010), sin DOM ni red (el fetch es falso):
 *   npx tsx scripts/test/test-feedback-ia-carga.ts
 * - montar no registra nada ni pide nada por cada turno: las calificaciones que se piden a la vez salen en UNA petición GET;
 * - la calificación guardada se muestra seleccionada, sin enviar nada, y no pisa lo que la persona ya eligió;
 * - un fallo de la consulta no se guarda: el turno se vuelve a pedir la próxima vez.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FALLO_TTL_MS, pedirCalificacionGuardada, recordarCalificacion, reiniciarCargasCalificacion } from "../../src/components/feedback-ia/carga-calificaciones";
import { reiniciarRegistros } from "../../src/components/feedback-ia/registro-turnos";
import { marcarProducido, reiniciarProducidos, esProducido } from "../../src/components/feedback-ia/producidos";
import { alMontar } from "../../src/components/feedback-ia/useCalificacionIA";
import { crearControlador, type ConfigCalificacion } from "../../src/components/feedback-ia/controlador-calificacion";

let pruebas = 0;
const prueba = async (nombre: string, fn: () => void | Promise<void>) => {
  reiniciarCargasCalificacion();
  reiniciarRegistros();
  reiniciarProducidos();
  await fn();
  pruebas += 1;
  console.log(`  ✓ ${nombre}`);
};

const OK = { ok: true, turnoId: "t1", producto: "taller", calificacion: null, creado: true, escenasGuardadas: true, actualizadoEn: "x" };
const GUARDADA = { turnoId: "t1", calificacion: 7, motivos: ["falto_algo"], comentario: "", deshecho: false };

/** Un servidor falso: las consultas GET de /api/feedback-ia contestan `guardadas` por turno; los POST, OK. */
function servidorFalso(guardadas: Record<string, unknown> = { t1: GUARDADA }, fallarGet = false, fallosPorGet = 0) {
  const gets: string[] = [];
  const posts: Record<string, unknown>[] = [];
  const buscar: typeof fetch = async (entrada, init) => {
    const ruta = String(entrada);
    if (init?.method === undefined || init.method === "GET") {
      gets.push(ruta);
      if (fallarGet || gets.length <= fallosPorGet) return Response.json({ error: "x", codigo: "BASE_NO_DISPONIBLE" }, { status: 503 });
      const turnos = new URL(ruta, "https://app.test").searchParams.get("turnos")?.split(",") ?? [];
      const calificaciones = turnos.filter((turno) => turno in guardadas).map((turno) => guardadas[turno]);
      return Response.json({ ok: true, calificaciones });
    }
    posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json(OK);
  };
  return { buscar, gets, posts };
}

function config(buscar: typeof fetch, turnoId = "t1"): ConfigCalificacion {
  return {
    producto: "taller",
    turnoId,
    conversacionId: () => "3d-20261009-120000-abcd",
    datos: () => ({ pedido: "hazla más alta", respuesta: "Listo." }),
    buscar,
  };
}

async function main() {
  console.log("Calificación guardada");
  await prueba("montar no registra nada: solo pide lo guardado, y lo muestra seleccionado", async () => {
    const srv = servidorFalso();
    const c = crearControlador(config(srv.buscar));
    await c.cargarGuardada();
    await c.esperar();
    assert.equal(srv.posts.length, 0, "ningún POST al montar");
    assert.equal(srv.gets.length, 1);
    const estado = c.leer();
    assert.equal(estado.nota, 7, "la nota guardada queda seleccionada");
    assert.deepEqual(estado.motivos, ["falto_algo"]);
    assert.equal(estado.gracias, true);
    assert.equal(estado.fase, "libre");
  });

  await prueba("sin calificación guardada no cambia nada y no manda nada", async () => {
    const srv = servidorFalso({});
    const c = crearControlador(config(srv.buscar));
    await c.cargarGuardada();
    assert.equal(c.leer().nota, null);
    assert.equal(c.leer().gracias, false);
    assert.equal(srv.posts.length, 0);
  });

  await prueba("lo que la persona ya eligió manda sobre lo guardado", async () => {
    const srv = servidorFalso();
    const c = crearControlador(config(srv.buscar));
    c.calificar(3);
    await c.cargarGuardada();
    await c.esperar();
    assert.equal(c.leer().nota, 3);
    assert.equal(srv.posts.length, 1, "solo la calificación de la persona");
  });

  await prueba("los turnos que se piden a la vez salen en UNA sola petición GET", async () => {
    const srv = servidorFalso({
      t1: GUARDADA,
      t2: { ...GUARDADA, turnoId: "t2", calificacion: 2 },
    });
    const [a, b, d] = await Promise.all([
      pedirCalificacionGuardada("taller", "t1", srv.buscar),
      pedirCalificacionGuardada("taller", "t2", srv.buscar),
      pedirCalificacionGuardada("taller", "t3", srv.buscar),
    ]);
    assert.equal(srv.gets.length, 1, srv.gets.join(" | "));
    assert.match(srv.gets[0] ?? "", /producto=taller&turnos=t1,t2,t3$/);
    assert.equal(a?.calificacion, 7);
    assert.equal(b?.calificacion, 2);
    assert.equal(d, null);
  });

  await prueba("un turno ya pedido no vuelve a pedirse en la página", async () => {
    const srv = servidorFalso();
    await pedirCalificacionGuardada("taller", "t1", srv.buscar);
    await pedirCalificacionGuardada("taller", "t1", srv.buscar);
    assert.equal(srv.gets.length, 1);
  });

  await prueba("un fallo de la consulta no se da por pedido: se vuelve a pedir", async () => {
    const fallida = servidorFalso({}, true);
    assert.equal(await pedirCalificacionGuardada("taller", "t1", fallida.buscar), null);
    const buena = servidorFalso();
    assert.equal(await pedirCalificacionGuardada("taller", "t1", buena.buscar), null, "dentro de la ventana: sin red");
    assert.equal((await pedirCalificacionGuardada("taller", "t1", buena.buscar, () => Date.now() + FALLO_TTL_MS + 1))?.calificacion, 7);
    assert.equal(buena.gets.length, 1);
  });

  await prueba("un id que el servidor no acepta no sale a la red", async () => {
    const srv = servidorFalso();
    assert.equal(await pedirCalificacionGuardada("taller", "malo id", srv.buscar), null);
    assert.equal(srv.gets.length, 0);
  });

  console.log("Lo que esta página ya guardó");
  await prueba("recordar: tras calificar 7 y luego 9, al volver a montar el turno se ve 9 y no se pide nada", async () => {
    const srv = servidorFalso({});
    const primera = crearControlador(config(srv.buscar));
    primera.calificar(7);
    await primera.esperar();
    primera.calificar(9);
    await primera.esperar();
    const segunda = crearControlador(config(srv.buscar));
    await segunda.cargarGuardada();
    assert.equal(segunda.leer().nota, 9);
    assert.equal(srv.gets.length, 0, "lo recordado no sale a la red");
  });
  await prueba("recordarCalificacion: lo que se guardó en la página gana sobre la red", async () => {
    const srv = servidorFalso({});
    recordarCalificacion("taller", { turnoId: "t5", calificacion: 4, motivos: [], comentario: "", deshecho: false });
    assert.equal((await pedirCalificacionGuardada("taller", "t5", srv.buscar))?.calificacion, 4);
    assert.equal(srv.gets.length, 0);
  });

  console.log("Producidos y restaurados");
  await prueba("un turno producido se registra UNA vez al terminar, con sus datos; restaurado, nunca", async () => {
    const srv = servidorFalso();
    const producido = crearControlador(config(srv.buscar));
    await producido.registrarTerminado();
    await producido.registrarTerminado();
    await producido.esperar();
    assert.equal(srv.posts.length, 1, "una vez por página");
    assert.equal(srv.posts[0]?.pedido, "hazla más alta");
    assert.equal("calificacion" in (srv.posts[0] ?? {}), false, "el registro no lleva nota");
    const restaurado = servidorFalso();
    const restauradoCtrl = crearControlador(config(restaurado.buscar, "t2"));
    await restauradoCtrl.cargarGuardada();
    await restauradoCtrl.esperar();
    assert.equal(restaurado.posts.length, 0, "restaurado: solo consulta");
    assert.equal(restaurado.gets.length, 1);
  });
  await prueba("un fallo al registrar se vuelve a intentar con el próximo montaje", async () => {
    let fallar = true;
    const buscar: typeof fetch = async (_entrada, init) => {
      if (init?.method === "POST" && fallar) return Response.json({ error: "x", codigo: "BASE_NO_DISPONIBLE" }, { status: 503 });
      return Response.json(OK);
    };
    const primera = crearControlador(config(buscar));
    await primera.registrarTerminado();
    await primera.esperar();
    fallar = false;
    const segunda = crearControlador(config(buscar));
    await segunda.registrarTerminado();
    await segunda.esperar();
    assert.equal(segunda.leer().fase, "libre");
  });

  console.log("Lecturas");
  await prueba("un fallo se recuerda 30 s: sin reintentos en bucle; después se vuelve a pedir", async () => {
    const srv = servidorFalso({ t1: GUARDADA }, false, 1);
    const pedido = (ahora: number) => pedirCalificacionGuardada("taller", "t1", srv.buscar, () => ahora);
    assert.equal(await pedido(0), null);
    assert.equal(await pedido(FALLO_TTL_MS - 1), null);
    assert.equal(srv.gets.length, 1, "dentro de la ventana no sale a la red");
    assert.equal((await pedido(FALLO_TTL_MS + 1))?.calificacion, 7);
    assert.equal(srv.gets.length, 2);
  });
  await prueba("motivos que el cliente no conoce se descartan y la fila se conserva", async () => {
    const srv = servidorFalso({ t1: { ...GUARDADA, motivos: ["falto_algo", "inventado"] } });
    const fila = await pedirCalificacionGuardada("taller", "t1", srv.buscar);
    assert.deepEqual(fila?.motivos, ["falto_algo"]);
    assert.equal(fila?.calificacion, 7);
  });
  await prueba("deshecho guardado sin nota: se ve «deshecho», no «gracias», y un rehacer posterior sí se manda", async () => {
    const srv = servidorFalso({ t1: { turnoId: "t1", calificacion: null, motivos: [], comentario: "", deshecho: true } });
    const c = crearControlador(config(srv.buscar));
    await c.cargarGuardada();
    assert.equal(c.leer().deshecho, true);
    assert.equal(c.leer().gracias, false);
    c.fijarDeshecho(false);
    await c.esperar();
    assert.equal(srv.posts.length, 1);
    assert.equal(srv.posts[0]?.deshecho, false);
  });
  await prueba("más de 100 turnos salen en lotes de 100 y de 50 (el servidor acepta 100 por petición)", async () => {
    const srv = servidorFalso({});
    const ids = Array.from({ length: 150 }, (_, i) => `t${i}`);
    await Promise.all(ids.map((id) => pedirCalificacionGuardada("taller", id, srv.buscar)));
    assert.equal(srv.gets.length, 2);
    const tamanos = srv.gets.map((ruta) => (new URL(ruta, "https://app.test").searchParams.get("turnos") ?? "").split(",").length).sort((a, b) => a - b);
    assert.deepEqual(tamanos, [50, 100]);
  });

  console.log("Lo producido en el envío");
  await prueba("una respuesta de un solo trozo se registra: el envío la marcó como producida", async () => {
    marcarProducido("m-un-trozo");
    const srv = servidorFalso();
    const c = crearControlador(config(srv.buscar, "m-un-trozo"));
    await alMontar(c, esProducido("m-un-trozo"));
    await c.esperar();
    assert.equal(srv.posts.length, 1, "el registro no depende de cuántos trozos llegaron");
    assert.equal(srv.posts[0]?.turnoId, "m-un-trozo");
  });
  await prueba("un mensaje restaurado del historial no se registra: solo consulta su calificación", async () => {
    const srv = servidorFalso({ "m-viejo": { turnoId: "m-viejo", calificacion: 5, motivos: [], comentario: "", deshecho: false } });
    const c = crearControlador(config(srv.buscar, "m-viejo"));
    await alMontar(c, esProducido("m-viejo"));
    await c.esperar();
    assert.equal(srv.posts.length, 0);
    assert.equal(srv.gets.length, 1);
    assert.equal(c.leer().nota, 5);
  });

  console.log("Cableado del envío");
  await prueba("remontar un turno ya registrado muestra su calificación guardada, sin volver a registrar", async () => {
    const srv = servidorFalso({});
    const primera = crearControlador(config(srv.buscar));
    await primera.registrarTerminado();
    await primera.esperar();
    primera.calificar(9);
    await primera.esperar();
    const remontada = crearControlador(config(srv.buscar));
    await remontada.registrarTerminado();
    await remontada.esperar();
    assert.equal(remontada.leer().nota, 9, "lo que ya se guardó");
    assert.equal(srv.posts.filter((post) => post.calificacion === undefined).length, 1, "el registro no se repite");
  });
  await prueba("el envío marca las respuestas que produce la página (guiada, clásica y Taller); el cableado existe en el código", async () => {
    const aqui = (ruta: string) => readFileSync(path.join(__dirname, "..", "..", "src", ...ruta.split("/")), "utf8");
    const exige = (ruta: string, fragmentos: string[]) => {
      const texto = aqui(ruta);
      for (const fragmento of fragmentos) assert.ok(texto.includes(fragmento), `${ruta} debe contener «${fragmento}»`);
    };
    exige("components/guiado/VistaGuiada.tsx", ["marcarProducido(idAsistente)", "marcarProducido(mensaje.id)"]);
    exige("app/page.tsx", ["marcarProducido(idRespuesta)", "marcarProducido(idCambio)", "marcarProducido(idCategoria)"]);
    exige("components/feedback-ia/CalificacionCliente.tsx", ["esProducido(turnoId)"]);
    exige("components/tres-d/ia/CalificacionTurno.tsx", ["esProducido(turno.id)"]);
    exige("components/tres-d/ia/useAsistenteIA.ts", ["marcarProducido(idRonda)", "marcarProducido(base.id)"]);
  });

  console.log(`\n${pruebas} pruebas OK`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
