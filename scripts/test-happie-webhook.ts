import assert from "node:assert/strict";
import { procesarTurnoConversacion, type EstadoConversacion } from "../src/lib/happie/conversacion-webhook";
import { manejarRecomendacionWebhook } from "../src/lib/happie/recomendar-paquetes-webhook";

const CLAVE_PRUEBA = "test-webhook-key-32-characters-minimum";
const URL = "http://localhost/api/happie/webhook/recommend-packages";

function solicitud(body: string, apiKey?: string): Request {
  return new Request(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body,
  });
}

async function ejecutar() {
  const claveOriginal = process.env.HAPPIE_WEBHOOK_API_KEY;

  try {
    delete process.env.HAPPIE_WEBHOOK_API_KEY;
    let respuesta = await manejarRecomendacionWebhook(solicitud("{}"), 3);
    assert.equal(respuesta.status, 503, "debe fallar de forma explícita sin secreto configurado");

    process.env.HAPPIE_WEBHOOK_API_KEY = CLAVE_PRUEBA;
    respuesta = await manejarRecomendacionWebhook(solicitud("{}", "incorrecta"), 3);
    assert.equal(respuesta.status, 401, "debe rechazar una clave incorrecta");

    respuesta = await manejarRecomendacionWebhook(solicitud("{", CLAVE_PRUEBA), 3);
    assert.equal(respuesta.status, 400, "debe rechazar JSON malformado");

    respuesta = await manejarRecomendacionWebhook(
      solicitud(JSON.stringify({ tipoEvento: "Boda", invitados: "60", presupuesto: 2_500_000 }), CLAVE_PRUEBA),
      3,
    );
    assert.equal(respuesta.status, 400, "debe rechazar tipos incorrectos");

    respuesta = await manejarRecomendacionWebhook(
      solicitud(
        JSON.stringify({ tipoEvento: "Boda", invitados: 60, presupuesto: 2_500_000, url: "javascript:alert(1)" }),
        CLAVE_PRUEBA,
      ),
      3,
    );
    assert.equal(respuesta.status, 400, "debe aceptar solo URL HTTP(S)");

    assert.equal(respuesta.headers.get("cache-control"), "no-store", "las respuestas no deben cachearse");

    let recomendacionesGeneradas = 0;
    const estadoInicial: EstadoConversacion = { fase: "descubrimiento", servicios: [], preferencias: [] };
    const primerTurno = await procesarTurnoConversacion(
      { mensaje: "Boda para 60, presupuesto 2.500.000", estado: estadoInicial },
      {
        extraer: async () => ({
          tipoEvento: "Boda",
          invitados: 60,
          presupuesto: 2_500_000,
          servicios: [],
          preferencias: [],
          respondioDetalles: false,
          confirmacion: "incierta",
          acuse: "Perfecto.",
        }),
        recomendar: async () => {
          recomendacionesGeneradas += 1;
          return { status: 200, body: { recomendaciones: [], resumen: "" } };
        },
      },
    );
    if (!("tipo" in primerTurno.body)) throw new Error("primer turno devolvió error");
    assert.equal(primerTurno.body.tipo, "pregunta", "no debe recomendar en el primer turno");
    assert.equal(primerTurno.body.estado.fase, "detalles");
    assert.equal(recomendacionesGeneradas, 0);

    const segundoTurno = await procesarTurnoConversacion(
      {
        mensaje: "Decoración y fotografía, estilo elegante",
        estado: "estado" in primerTurno.body ? primerTurno.body.estado : estadoInicial,
      },
      {
        extraer: async () => ({
          tipoEvento: "Boda",
          invitados: 60,
          presupuesto: 2_500_000,
          servicios: ["decoracion", "fotografia"],
          preferencias: ["estilo elegante"],
          respondioDetalles: true,
          confirmacion: "incierta",
          acuse: "Anotado.",
        }),
        recomendar: async () => {
          recomendacionesGeneradas += 1;
          return { status: 200, body: { recomendaciones: [], resumen: "" } };
        },
      },
    );
    if (!("tipo" in segundoTurno.body)) throw new Error("segundo turno devolvió error");
    assert.equal(segundoTurno.body.tipo, "pregunta", "debe pedir confirmación antes de recomendar");
    assert.equal(segundoTurno.body.estado.fase, "confirmacion");
    assert.equal(recomendacionesGeneradas, 0);

    const tercerTurno = await procesarTurnoConversacion(
      { mensaje: "Sí, busca opciones", estado: "estado" in segundoTurno.body ? segundoTurno.body.estado : estadoInicial },
      {
        extraer: async () => ({
          tipoEvento: "Boda",
          invitados: 60,
          presupuesto: 2_500_000,
          servicios: [],
          preferencias: [],
          respondioDetalles: false,
          confirmacion: "si",
          acuse: "",
        }),
        recomendar: async () => {
          recomendacionesGeneradas += 1;
          return {
            status: 200,
            body: {
              recomendaciones: [{ url: "https://www.happia.co/client/events/new?package=demo", razon: "Encaja." }],
              resumen: "Encontré una opción.",
            },
          };
        },
      },
    );
    if (!("tipo" in tercerTurno.body)) throw new Error("tercer turno devolvió error");
    assert.equal(tercerTurno.body.tipo, "recomendaciones");
    assert.equal(recomendacionesGeneradas, 1, "solo debe recomendar después de confirmación");
    console.log("Webhook Happie: autenticación, contrato y conversación válidos.");
  } finally {
    if (claveOriginal === undefined) delete process.env.HAPPIE_WEBHOOK_API_KEY;
    else process.env.HAPPIE_WEBHOOK_API_KEY = claveOriginal;
  }
}

ejecutar().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
