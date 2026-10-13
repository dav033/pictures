/**
 * REQ-015 T10 (P2-2): `envio.accionIdea` no puede viajar dentro de la sesión guardada (`demo_guiado_v2`): un despliegue
 * anterior la lee con un esquema estricto y descartaría la conversación entera. Se guarda aparte y se vuelve a juntar al leer.
 *
 *   npx tsx scripts/test/test-sesion-guardada-accion-idea.ts
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { turnoSinRespuesta } from "../../src/components/guiado/version-pagina";
import { EstadoGuardadoSchema, juntarAccionesIdea, PREPARANDO_PLAN_IDEA, separarAccionesIdea, sinEsperaTransitoria, type Mensaje } from "../../src/components/guiado/estado-guardado";

/** Solo prueba el contrato de `envio` (lo único que cambió); no sustituye comparar con el esquema desplegado. El esquema de la sesión antes de `accionIdea`: `envio` estricto con uso, alcance y pieza. */
const EnvioAnterior = z.object({ uso: z.enum(["negocio", "personal"]).optional(), alcance: z.enum(["completa", "individual"]).optional(), pieza: z.string().optional() }).strict();
const SesionAnterior = EstadoGuardadoSchema.extend({ mensajes: z.array(EstadoGuardadoSchema.shape.mensajes.element.extend({ envio: EnvioAnterior.optional() })) });

const mensajes: Mensaje[] = [
  { id: "m1", role: "user", content: "¿Cuánto cuesta?", envio: { uso: "personal", accionIdea: "costear" } },
  { id: "m2", role: "assistant", content: "Preparo el plan…" },
  { id: "m3", role: "user", content: "Es para uso personal.", envio: { uso: "personal" } },
];

const { mensajes: guardables, acciones } = separarAccionesIdea(mensajes);
const estado = { mensajes: guardables, brief: {}, seleccionadaId: "deco-1", uso: "personal" };
assert.ok(SesionAnterior.safeParse(estado).success, "lo que se guarda lo lee el esquema anterior (estricto)");
assert.ok(!SesionAnterior.safeParse({ mensajes, brief: {} }).success, "control: con accionIdea dentro, el esquema anterior sí descarta la sesión");
assert.ok(EstadoGuardadoSchema.safeParse(estado).success, "y el de ahora");
assert.ok(EstadoGuardadoSchema.safeParse(JSON.parse(JSON.stringify(estado))).success);
assert.deepEqual(acciones, { m1: "costear" });
assert.equal(guardables[0]?.envio?.uso, "personal", "el resto del envío se conserva");
assert.equal(mensajes[0]?.envio?.accionIdea, "costear", "no muta el original");

const leidos = juntarAccionesIdea(guardables, JSON.parse(JSON.stringify(acciones)));
assert.deepEqual(leidos, mensajes, "al leer, cada mensaje recupera su acción");
assert.deepEqual(juntarAccionesIdea(guardables, null), guardables, "sin acciones guardadas, igual");
assert.deepEqual(juntarAccionesIdea(guardables, { m1: "no-existe" }), guardables, "una acción ilegible se ignora");
const sinEnvio = juntarAccionesIdea([{ id: "m2", role: "assistant", content: "x" }], { m2: "costear" });
assert.equal(sinEnvio[0]?.envio?.accionIdea, "costear");
const mezcla = juntarAccionesIdea([mensajes[0]!, mensajes[2]!].map((m) => separarAccionesIdea([m]).mensajes[0]!), { m1: "costear", m3: "futura" });
assert.equal(mezcla[0]?.envio?.accionIdea, "costear", "una acción desconocida no tira las demás");
assert.equal(mezcla[1]?.envio?.accionIdea, undefined);

// P2-4: la burbuja «Preparo el plan…» del chip no se guarda mientras viene el plan; al recargar la petición vuelve con su reintento por reglas.
const enCamino: Mensaje[] = [
  { id: "u1", role: "user", content: "¿Cuánto cuesta?", envio: { accionIdea: "costear" } },
  { id: "a1", role: "assistant", content: `${PREPARANDO_PLAN_IDEA} «Dino» con sus globos exactos.` },
];
const guardadoEnCamino = separarAccionesIdea(sinEsperaTransitoria(enCamino, "a1"));
const recargado = juntarAccionesIdea(EstadoGuardadoSchema.parse(JSON.parse(JSON.stringify({ mensajes: guardadoEnCamino.mensajes }))).mensajes, JSON.parse(JSON.stringify(guardadoEnCamino.acciones)));
assert.equal(recargado.length, 1, "la burbuja transitoria no se guardó");
assert.equal(turnoSinRespuesta(recargado)?.id, "u1", "la petición del cliente vuelve como turno sin respuesta");
assert.equal(turnoSinRespuesta(recargado)?.envio?.accionIdea, "costear", "y se reintenta por reglas, no con el modelo");
assert.equal(turnoSinRespuesta(enCamino), null, "control: guardada con la burbuja, no había nada que recuperar");
assert.equal(sinEsperaTransitoria(enCamino, null).length, 2, "sin espera en curso no se quita nada");
assert.equal(sinEsperaTransitoria([enCamino[0]!, { ...enCamino[1]!, widgets: [{ tipo: "opciones" }] }], "a1").length, 2, "si la burbuja ya trae el plan se guarda");
assert.equal(sinEsperaTransitoria([enCamino[0]!, { ...enCamino[1]!, content: "No pude preparar el plan ahora." }], "a1").length, 2, "el fallo dicho sí se guarda");
console.log("sesion-guardada-accion-idea: OK");
