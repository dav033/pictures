/**
 * CUS-04 (D-023): cuando un cambio del cliente o del Taller no se puede hacer, el cliente lee «No pude: …» en palabras de
 * cliente (sin jerga del motor), nombra la cosa y nada cambia en silencio. Sin coste: sin IA, sin Python, sin red ni base.
 *   - cliente guiado: la ruta real de edición del motor 3D, el cliente real (crearDependenciasEdicion3d) y mensajeAjuste;
 *   - Taller: la ruta real /api/escena-ia (POST) con un Gemini de mentira por fetch que guiona las llamadas del modelo.
 *
 * Run: NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-honestidad-forzada.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { TEXTO_MOTOR_3D_APAGADO, avisosDelCambio, crearDependenciasEdicion3d, type DependenciasEdicion3d } from "../../src/components/guiado/edicion-motor3d";
import { mensajeAjuste } from "../../src/components/guiado/ajuste/ejecutar-ajuste";
import { RUTA_EDITAR_MOTOR, type EdicionDelCliente } from "../../src/lib/guiada-motor/editar-contrato";
import { armarDesdeEspec, cotizarBom, crearCachePiezas, crosswalkIncluido, type EspecClienteV1, type ResultadoCotizacionBom, type ResultadoMotorV1 } from "../../src/lib/globos3d/motor/v1";
import { pythonDoble } from "../lib/python-doble-precio";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import { TEXTO_CUOTA_IA, TEXTO_IA_CAIDA, TEXTO_SIN_IA, textoTopeHora } from "../../src/lib/globos3d/honestidad-respuesta";
import { reiniciarCupoEscenaIA, TOPE_POR_HORA, tomarCupoEscenaIA } from "../../src/lib/globos3d/cupo-escena-ia";

const CLAVE_APP = "clave-app-de-prueba";
const SESION = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`;
const NAVEGADOR = "feedback_usuario=" + "c3".repeat(16);
const cruce = crosswalkIncluido();

/** Jerga que el cliente no debe leer: códigos de formato, «armado», «motor», «spec», «hex» y nombres de campo (con guion bajo). */
const JERGA = /\bR-\d|armad|motor|\bspec\b|\bhex\b|\b[a-z]+_[a-z_]+\b/i;

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL, GUIADA_MOTOR: process.env.GUIADA_MOTOR, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
  delete process.env.GUIADA_MOTOR;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

// ---------- Cliente guiado: la ruta real, el cliente real y el texto que ve la persona ----------

type Opciones = { motor?: "3d" | "python"; cotizar?: DependenciasEditarMotor["cotizar"]; armar?: DependenciasEditarMotor["armar"]; tope?: number };
type Plan = ReturnType<typeof PlanGuiadoSchema.parse> & { espec: EspecClienteV1 };

function entorno(opciones: Opciones = {}) {
  const cachePiezas = crearCachePiezas(64);
  let ids = 0;
  const doble = pythonDoble(cruce);
  const deps: DependenciasEditarMotor = {
    leerBandera: async () => ({ motor: opciones.motor ?? "3d", fuente: "cookie" }),
    auditar: () => undefined,
    armar: opciones.armar ?? ((espec) => armarDesdeEspec(espec, { cachePiezas })),
    planGuardado: planGuardadoDeIdea,
    cotizar: opciones.cotizar ?? ((bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista })),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    tomarEdicion: crearTopePorNavegador(opciones.tope ?? 1000).tomar,
  };
  return { deps };
}

async function planDe(piezas: { estructura: string; cantidad: number }[], colores = ["azul", "dorado"]): Promise<Plan> {
  const e = entorno();
  const deps: DependenciasPlanMotor = {
    leerBandera: e.deps.leerBandera, auditar: e.deps.auditar, planGuardado: planGuardadoDeIdea,
    cotizar: (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista }),
    nuevoId: e.deps.nuevoId,
  };
  const propuesta = { frase: "Te propongo una decoración.", colores, piezas };
  const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", { method: "POST", headers: { "content-type": "application/json", cookie: [SESION, NAVEGADOR].join("; ") }, body: JSON.stringify({ desde: "propuesta", propuesta, brief: { evento: "boda", tematica: "boda azul y dorada" } }) }), deps);
  assert.equal(respuesta.status, 200, "el plan de prueba se arma");
  return ((await respuesta.json()) as { plan: Plan }).plan;
}

/** El cliente pide un cambio al servidor (la ruta real) y devuelve lo que la persona lee, o el plan nuevo si no hubo fallo. */
async function clienteEdita(e: ReturnType<typeof entorno>, plan: Plan, edicion: EdicionDelCliente) {
  let estado = 0;
  let cuerpo: Record<string, unknown> = {};
  const red = (async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, RUTA_EDITAR_MOTOR);
    const respuesta = await atenderEditarMotor(new Request(`https://app.test${RUTA_EDITAR_MOTOR}`, { method: "POST", headers: { "content-type": "application/json", cookie: [SESION, NAVEGADOR].join("; ") }, body: init?.body as string }), e.deps);
    estado = respuesta.status;
    cuerpo = await respuesta.clone().json() as Record<string, unknown>;
    return respuesta;
  }) as typeof fetch;
  const cliente: DependenciasEdicion3d = crearDependenciasEdicion3d({ red });
  try {
    const hecho = await cliente.editar(plan, edicion);
    return { hecho: true as const, estado, cuerpo, plan: hecho.plan, texto: [hecho.confirmacion, ...avisosDelCambio(plan, hecho)].join(" ") };
  } catch (error) {
    return { hecho: false as const, estado, cuerpo, texto: mensajeAjuste(error) };
  }
}

const pedido = (p: Record<string, unknown>): EdicionDelCliente => ({ tipo: "pedido", pedido: p } as EdicionDelCliente);

/** Lo que la persona lee tras un fallo: «No pude: …», sin jerga, con algo que nombra la cosa. */
function asertaNoPude(texto: string, nombra?: RegExp) {
  assert.match(texto, /^No pude: /, texto);
  assert.doesNotMatch(texto, JERGA, texto);
  if (nombra) assert.match(texto, nombra, texto);
}

test("G-01 un color que la tienda no vende en esa talla: 422 SIN_COBERTURA, «No pude:» y el plan no cambia", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno({ cotizar: async () => ({ ok: false, razon: "sin_cobertura", faltantes: [{ formatoId: "R-12", codigo: "015", motivo: "no_esta_en_la_tienda" }] }) as ResultadoCotizacionBom });
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] }));
  assert.equal(r.estado, 422);
  assert.equal(r.hecho, false, "un color que no se vende no cambia el plan");
  asertaNoPude(r.texto, /la tienda no vende/);
  assert.equal(r.cuerpo.plan, undefined, "no vuelve un plan nuevo");
});

test("G-02 un precio que no se puede calcular: 422 PRECIO_FALLIDO, «No pude:» y el plan queda como estaba", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno({ cotizar: async () => ({ ok: false, razon: "error_python" }) as unknown as ResultadoCotizacionBom });
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] }));
  assert.equal(r.estado, 422);
  assert.equal(r.hecho, false);
  asertaNoPude(r.texto, /precio/);
});

test("G-03 un cambio de tamaño de globos en una pieza que no lo admite: no se aplica, y se dice por qué", async () => {
  // Una pared de globos de un solo tamaño: no tiene proporción de tamaños que mover.
  const plan = await planDe([{ estructura: "pared_densa", cantidad: 1 }], ["azul", "rojo"]);
  const e = entorno();
  const r = await clienteEdita(e, plan, { tipo: "cambio", cambio: { tipo: "tamano-globos", estructuraId: plan.espec.piezas[0]!.id, direccion: 1 } });
  assert.equal(r.hecho, false, "una pieza de un solo tamaño no cambia");
  asertaNoPude(r.texto, /un solo tamaño/);
  assert.equal(r.cuerpo.plan, undefined);
});

test("G-04 una medida fuera del rango que se arma: se acota, el cliente lo lee y no se afirma la medida pedida", async () => {
  const plan = await planDe([{ estructura: "columna", cantidad: 1 }]);
  const e = entorno();
  const r = await clienteEdita(e, plan, { tipo: "cambio", cambio: { tipo: "medidas", estructuraId: "EST_01_COLUMNA", medidas: { alto_m: 9 } } });
  assert.equal(r.hecho, true, "con una medida fuera de rango el cambio se hace acotado, no en silencio");
  assert.match(r.texto, /queda fuera de lo que se arma \(de [^)]*\); quedó en 5 m/, r.texto);
  assert.doesNotMatch(r.texto, /Listo: .*\b9 m\b(?!.*queda fuera)/, "no afirma la medida pedida");
});

test("G-05 una pieza con el máximo de colores: no se agrega el color y el cliente lee el máximo con «No pude:»", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }], ["azul", "rojo", "blanco", "negro", "dorado", "rosado"]);
  const e = entorno();
  const r = await clienteEdita(e, plan, pedido({ tipo: "agregar_color", colores: ["verde"], piezas: [] }));
  assert.equal(r.hecho, false, "con el máximo de colores la pieza no cambia");
  asertaNoPude(r.texto, /El arco ya lleva el máximo de 6 colores/);
});

test("G-06 una palabra de color que no existe: el cliente lo nombra con «No pude:» y el plan no cambia", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno();
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "xyzfucsia", piezas: [] }));
  assert.equal(r.hecho, false);
  assert.equal(r.estado, 400, "el servidor no conoce ese color");
  asertaNoPude(r.texto, /no reconozco el color «xyzfucsia»/);
});

test("G-07 quitar la única pieza del plan: no se quita y lo dice «No pude:», el plan queda como estaba", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno();
  const r = await clienteEdita(e, plan, pedido({ tipo: "quitar_pieza", piezas: ["Arco"] }));
  assert.equal(r.hecho, false);
  asertaNoPude(r.texto, /al menos una pieza/);
  assert.equal(r.cuerpo.plan, undefined);
});

test("G-08 una idea que el motor no sabe armar (motivo técnico): el cliente lee una frase de cliente, sin códigos", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno({ armar: (espec) => ({ ...armarDesdeEspec(espec), noRepresentable: [{ piezaId: "EST_01_ARCO", motivo: "Ningún color de la paleta se fabrica en R-18, R-24: se usa Fashion Blanco (005)." }] }) as ResultadoMotorV1 });
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] }));
  assert.equal(r.hecho, false);
  asertaNoPude(r.texto, /ese color no se puede armar/);
});

test("G-09 cupo de cambios por hora agotado: 429 con «No pude:» (el plan queda como estaba)", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno({ tope: 0 });
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] }));
  assert.equal(r.estado, 429);
  assert.equal(r.hecho, false);
  asertaNoPude(r.texto, /demasiados cambios en una hora/);
});

test("G-10 el motor se rompe a mitad del cambio: 500 técnico, el cliente lee «No pude:» y el plan no se toca", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno({ armar: () => { throw new Error("TypeError: cannot read properties of undefined (reading 'bom')"); } });
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] }));
  assert.equal(r.estado, 500);
  assert.equal(r.hecho, false);
  asertaNoPude(r.texto);
  assert.doesNotMatch(r.texto, /TypeError|reading|undefined/);
  assert.equal(r.cuerpo.plan, undefined);
});

test("G-11 la bandera apaga el armado 3D: el cliente lee que el cambio no está disponible y su plan sigue", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno({ motor: "python" });
  const r = await clienteEdita(e, plan, pedido({ tipo: "reemplazar_color", color: "azul", colorNuevo: "rojo", piezas: [] }));
  assert.equal(r.hecho, false);
  assert.equal(r.texto, TEXTO_MOTOR_3D_APAGADO);
  asertaNoPude(r.texto);
});

test("G-12 una pieza que no está en el plan: se dice que no se encontró y no se inventa un cambio", async () => {
  const plan = await planDe([{ estructura: "arco", cantidad: 1 }]);
  const e = entorno();
  const r = await clienteEdita(e, plan, pedido({ tipo: "quitar_pieza", piezas: ["Estatua"] }));
  assert.equal(r.hecho, false);
  asertaNoPude(r.texto, /no encontré esa pieza/);
});

// ---------- Taller: la ruta real /api/escena-ia con un modelo de mentira ----------

type Turno = { llamadas: Array<{ nombre: string; args: Record<string, unknown> }> } | { texto: string } | { fallo: number; mensaje: string };
type RespuestaTaller = { escena?: { nodos: Array<{ id: string }> }; respuesta?: string; error?: string; acciones?: Array<{ herramienta: string; consulta: boolean }> };

/** Gemini por `fetch`: responde en orden lo que dice el guion (el último se repite); las otras URL van a la red de verdad (no hay). */
function modeloDeMentira(guion: Turno[]): () => void {
  const fetchOriginal = globalThis.fetch;
  let indice = 0;
  globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (!url.includes("generativelanguage.googleapis.com")) return fetchOriginal(entrada, init);
    const turno = guion[Math.min(indice, guion.length - 1)]!;
    indice += 1;
    if ("fallo" in turno) return new Response(JSON.stringify({ error: { code: turno.fallo, message: turno.mensaje, status: "ERROR" } }), { status: turno.fallo, headers: { "Content-Type": "application/json" } });
    const partes = "llamadas" in turno ? turno.llamadas.map((l) => ({ functionCall: { name: l.nombre, args: l.args } })) : [{ text: turno.texto }];
    const cuerpo = { candidates: [{ content: { role: "model", parts: partes }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } };
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return () => { globalThis.fetch = fetchOriginal; };
}

/** Un pedido de Taller por la ruta real, con el modelo guionado. */
async function pedirTaller(escena: ReturnType<typeof escenaPredefinida>, guion: Turno[], opciones: { sinClave?: boolean; cupoAgotado?: boolean } = {}) {
  process.env.GEMINI_API_KEY = opciones.sinClave ? "" : "clave-de-prueba-sin-red";
  reiniciarCupoEscenaIA();
  if (opciones.cupoAgotado) for (let i = 0; i < TOPE_POR_HORA; i += 1) tomarCupoEscenaIA();
  const restaurar = modeloDeMentira(guion);
  try {
    const { POST } = await import("@/app/api/escena-ia/route");
    const respuesta = await POST(new Request("http://localhost/api/escena-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ escena, mensaje: "Cambia la escena como te pido.", historial: [], seleccion: null }) }));
    return { estado: respuesta.status, cuerpo: await respuesta.json() as RespuestaTaller };
  } finally {
    restaurar();
  }
}

const escenaBase = () => escenaPredefinida("arco_organico_columnas_guirnalda");
const idsDe = (e: { nodos: Array<{ id: string }> } | undefined) => (e?.nodos ?? []).map((n) => n.id).sort().join(",");

test("T-01 el modelo pide mover una pieza que no existe: la escena no cambia y su «Listo» recibe «No pude:» con el nombre", async () => {
  const base = escenaBase();
  const { estado, cuerpo } = await pedirTaller(base, [
    { llamadas: [{ nombre: "mover_pieza", args: { id: "pieza-fantasma", donde: { en: "piso", x_cm: 100, z_cm: 100 } } }] },
    { texto: "Listo, la moví al centro." },
  ]);
  assert.equal(estado, 200);
  assert.match(cuerpo.respuesta ?? "", /No pude: /);
  assert.match(cuerpo.respuesta ?? "", /pieza-fantasma/);
  assert.doesNotMatch(cuerpo.respuesta ?? "", JERGA, cuerpo.respuesta ?? "");
  assert.equal(idsDe(cuerpo.escena), idsDe(base), "la escena queda como estaba");
});

test("T-02 una decoración sobre una pieza que no sirve de lienzo: el fallo no se calla aunque el modelo confirme", async () => {
  const base = escenaBase();
  const { cuerpo } = await pedirTaller(base, [
    { llamadas: [{ nombre: "poner_sobre", args: { decoracion_id: "flor5", padre_id: "pared-inexistente" } }] },
    { texto: "Coloqué la flor sobre la pared. Confirmado." },
  ]);
  assert.match(cuerpo.respuesta ?? "", /No pude: /);
  assert.doesNotMatch(cuerpo.respuesta ?? "", JERGA, cuerpo.respuesta ?? "");
  assert.equal(idsDe(cuerpo.escena), idsDe(base));
});

test("T-03 mesas que no caben en la sala: la herramienta las pone y el aviso llega aunque el modelo no lo diga", async () => {
  const { estado, cuerpo } = await pedirTaller(escenaBase(), [
    { llamadas: [{ nombre: "agregar_mesas", args: { cantidad: 60, sillas_por_mesa: 8, ancho_cm: 150 } }] },
    { texto: "Listo: agregué las mesas." },
  ]);
  assert.equal(estado, 200);
  assert.match(cuerpo.respuesta ?? "", /Aviso: .*se salen de la sala/, cuerpo.respuesta ?? "");
  assert.doesNotMatch(cuerpo.respuesta ?? "", JERGA, cuerpo.respuesta ?? "");
  assert.equal(cuerpo.acciones?.[0]?.herramienta, "agregar_mesas");
});

test("T-04 un tono de piso que no es un color: la sala no cambia y el cliente lee «No pude:» con el nombre del tono", async () => {
  const base = escenaBase();
  const { cuerpo } = await pedirTaller(base, [
    { llamadas: [{ nombre: "cambiar_sala", args: { tono_piso: "rosa-fantasma" } }] },
    { texto: "Hecho." },
  ]);
  assert.match(cuerpo.respuesta ?? "", /No pude: .*El tono del piso no es un color válido/);
  assert.doesNotMatch(cuerpo.respuesta ?? "", JERGA, cuerpo.respuesta ?? "");
  assert.equal(idsDe(cuerpo.escena), idsDe(base));
});

test("T-05 cuota, IA sin configurar, IA caída y tope por hora: la ruta responde exactamente con sus «No pude:»", async () => {
  const base = escenaBase();
  const sinClave = await pedirTaller(base, [{ texto: "x" }], { sinClave: true });
  assert.equal(sinClave.estado, 503);
  assert.equal(sinClave.cuerpo.error, TEXTO_SIN_IA);
  const cuota = await pedirTaller(base, [{ fallo: 429, mensaje: "RESOURCE_EXHAUSTED: quota" }]);
  assert.equal(cuota.estado, 429);
  assert.equal(cuota.cuerpo.error, TEXTO_CUOTA_IA);
  assert.match(cuota.cuerpo.error ?? "", /^No pude: /);
  const caida = await pedirTaller(base, [{ fallo: 400, mensaje: "solicitud rechazada" }]);
  assert.equal(caida.estado, 502);
  assert.equal(caida.cuerpo.error, TEXTO_IA_CAIDA);
  const tope = await pedirTaller(base, [{ texto: "x" }], { cupoAgotado: true });
  assert.equal(tope.estado, 429);
  assert.equal(tope.cuerpo.error, textoTopeHora(TOPE_POR_HORA));
  for (const texto of [sinClave.cuerpo.error, cuota.cuerpo.error, caida.cuerpo.error, tope.cuerpo.error]) assert.match(texto ?? "", /^No pude: /);
});

test("T-06 la IA se corta a mitad: lo aplicado se queda, lo que falló se dice con «No pude:» y no se tapa", async () => {
  const base = escenaBase();
  const { estado, cuerpo } = await pedirTaller(base, [
    { llamadas: [
      { nombre: "agregar_pieza", args: { formato: "R-18", tipo: "columna", donde: { en: "piso", x_cm: 0, z_cm: 0 } } },
      { nombre: "mover_pieza", args: { id: "columna-fantasma", donde: { en: "piso", x_cm: 50, z_cm: 50 } } },
    ] },
    { fallo: 400, mensaje: "solicitud rechazada" },
  ]);
  assert.equal(estado, 200);
  assert.match(cuerpo.respuesta ?? "", /La IA se cortó a mitad de camino/);
  assert.match(cuerpo.respuesta ?? "", /No pude: /);
  assert.match(cuerpo.respuesta ?? "", /columna-fantasma/);
  assert.equal((cuerpo.escena?.nodos.length ?? 0), base.nodos.length + 1, "lo que sí se hizo sigue aplicado");
});

test("T-07 un texto del modelo que ya admite el fallo no se repite: la respuesta queda igual", async () => {
  const texto = "No pude mover la pieza fantasma: no existe.";
  const { cuerpo } = await pedirTaller(escenaBase(), [
    { llamadas: [{ nombre: "mover_pieza", args: { id: "pieza-fantasma", donde: { en: "piso", x_cm: 100, z_cm: 100 } } }] },
    { texto },
  ]);
  assert.equal(cuerpo.respuesta, texto);
});

test("T-08 el modelo inventa una herramienta: «No pude:» nombra la acción y no se lista el catálogo interno", async () => {
  const { cuerpo } = await pedirTaller(escenaBase(), [
    { llamadas: [{ nombre: "volar_globos", args: {} }] },
    { texto: "Listo." },
  ]);
  assert.match(cuerpo.respuesta ?? "", /No pude: /);
  assert.doesNotMatch(cuerpo.respuesta ?? "", /Hay: |volar_globos/, cuerpo.respuesta ?? "");
  assert.doesNotMatch(cuerpo.respuesta ?? "", JERGA, cuerpo.respuesta ?? "");
});

test("T-09 una altura de pared que pasa del alto de la sala: la escena no cambia y el cliente lee el límite con «No pude:»", async () => {
  const base = escenaBase();
  const { cuerpo } = await pedirTaller(base, [
    { llamadas: [{ nombre: "mover_pieza", args: { id: "columna-izq", donde: { en: "pared", pared: "fondo", altura_cm: 9999 } } }] },
    { texto: "Listo, la moví a la pared." },
  ]);
  assert.match(cuerpo.respuesta ?? "", /No pude: .*pasa del alto de la sala/, cuerpo.respuesta ?? "");
  assert.doesNotMatch(cuerpo.respuesta ?? "", JERGA, cuerpo.respuesta ?? "");
  assert.equal(idsDe(cuerpo.escena), idsDe(base));
});
