/**
 * Offline checks for the professional quote (`cotizacion-profesional.v1`).
 * Python owns every total (`services/ai-api/tests/test_cotizacion_profesional.py`);
 * here: how the browser reads what the decorator typed (Colombian pesos, one
 * or two decimals, blank vs. half-filled rows), which materials of the plan
 * quote can be sent, and `POST /api/cotizacion-profesional` — authentication,
 * a strict body with deliberate 400, the request it sends to Python (scope,
 * short deadline), the validation of the answer and Python being down.
 * `globalThis.fetch` is stubbed; there is no network and no database.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-cotizacion-profesional.ts
 */
import assert from "node:assert/strict";

process.env.PYTHON_BACKEND_URL = "http://python.test";
process.env.INTERNAL_HMAC_SECRET = "local-only-secret-0123456789abcdef";
delete process.env.APP_PASSWORD;

type Json = Record<string, unknown>;
type Llamada = { path: string; body: Json; headers: Headers };

function esObjeto(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function instalarFetch(responder: (llamada: Llamada) => Response): Llamada[] {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(esObjeto(body));
    const llamada = { path: new URL(String(input)).pathname, body, headers: new Headers(init?.headers) };
    llamadas.push(llamada);
    return responder(llamada);
  }) as typeof fetch;
  return llamadas;
}

function sobre(llamada: Llamada, payload: Json): Response {
  const ctx = llamada.body.context;
  assert.ok(esObjeto(ctx));
  return Response.json({ schema_version: "operational.v1", request_id: ctx.request_id, correlation_id: ctx.correlation_id, payload });
}

const MATERIALES = [
  { variant_id: "v1", descripcion: "R-5 SILK AMATISTA X 50", paquetes: 1, precio_paquete_catalogo_cop: 16900 },
  { variant_id: "v2", descripcion: "BURBUJA 24 X 1", paquetes: 2, precio_paquete_catalogo_cop: 6000, precio_paquete_cop: 5000 },
];
/** The same materials with no price typed by the decorator. */
const CATALOGO = MATERIALES.map(({ variant_id, descripcion, paquetes, precio_paquete_catalogo_cop }) => ({ variant_id, descripcion, paquetes, precio_paquete_catalogo_cop }));
const ENTRADA = {
  materiales: MATERIALES,
  mano_de_obra: [{ descripcion: "Hora de mano de obra propia", costo_unitario_cop: 12000, cantidad: 2 }],
  equipos_transporte: [{ descripcion: "Transporte ida", costo_unitario_cop: 40000, cantidad: 1 }],
  indirectos: [],
  utilidad_porcentaje: 30,
};

/** What Python answers for ENTRADA (checked for real by the Python suite, not recomputed here). */
function respuestaPython(cambios: Json = {}): Json {
  return {
    operation_schema_version: "cotizacion-profesional-result.v1",
    currency: "COP",
    materiales: {
      lineas: [
        { variant_id: "v1", descripcion: "R-5 SILK AMATISTA X 50", paquetes: 1, precio_paquete_catalogo_cop: 16900, precio_paquete_cop: 16900, precio_editado: false, subtotal_cop: 16900 },
        { variant_id: "v2", descripcion: "BURBUJA 24 X 1", paquetes: 2, precio_paquete_catalogo_cop: 6000, precio_paquete_cop: 5000, precio_editado: true, subtotal_cop: 10000 },
      ],
      total_cop: 26900,
    },
    mano_de_obra: { lineas: [{ descripcion: "Hora de mano de obra propia", costo_unitario_cop: 12000, cantidad: 2, subtotal_cop: 24000 }], total_cop: 24000 },
    equipos_transporte: { lineas: [{ descripcion: "Transporte ida", costo_unitario_cop: 40000, cantidad: 1, subtotal_cop: 40000 }], total_cop: 40000 },
    indirectos: { lineas: [], total_cop: 0 },
    total_costos_cop: 90900,
    utilidad_porcentaje: 30,
    utilidad_cop: 27270,
    precio_sugerido_cop: 118170,
    margen_porcentaje: 23.08,
    ...cambios,
  };
}

async function probarBorrador(): Promise<void> {
  const b = await import("../../src/lib/cotizacion/borrador-profesional");

  assert.equal(b.leerPesos("12.000"), 12000);
  assert.equal(b.leerPesos("$ 1.250.000"), 1250000);
  assert.equal(b.leerPesos("0"), 0);
  for (const texto of ["", "12,5", "-3", "doce", "1e5"]) assert.equal(b.leerPesos(texto), null, texto);
  // Los miles separados son SOLO esteticos: lo que se escribe se guarda ya
  // formateado y `leerPesos` quita los puntos, asi que el valor no cambia.
  assert.equal(b.formatearPesos("1000"), "1.000");
  assert.equal(b.formatearPesos("1000000"), "1.000.000");
  assert.equal(b.formatearPesos("999"), "999");
  assert.equal(b.formatearPesos("$ 12.000"), "12.000", "vuelve a formatear lo ya formateado sin duplicar puntos");
  assert.equal(b.formatearPesos("007"), "7", "sin ceros a la izquierda");
  assert.equal(b.formatearPesos(""), "", "se puede vaciar el campo");
  assert.equal(b.formatearPesos("doce"), "", "sin digitos no hay cifra");
  // La invariante que importa: formatear no mueve el valor.
  for (const crudo of ["1000", "1250000", "999", "0", "12.000"]) {
    assert.equal(b.leerPesos(b.formatearPesos(crudo)), b.leerPesos(crudo), crudo);
  }
  // El cursor se queda tras el mismo digito que tenia delante.
  assert.equal(b.posicionTrasDigitos("1.000", 1), 1, "tras el primer digito");
  assert.equal(b.posicionTrasDigitos("1.000", 2), 3, "el punto no cuenta como digito");
  assert.equal(b.posicionTrasDigitos("1.000", 4), 5);
  assert.equal(b.posicionTrasDigitos("1.000", 0), 0, "al principio");
  assert.equal(b.posicionTrasDigitos("1.000", 9), 5, "mas digitos de los que hay: al final");
  // La secuencia real de `EntradaPesos`: lo que pasa tecla a tecla.
  const teclear = (inicial: string, cursorInicial: number, teclas: string) => {
    let valor = inicial;
    let cursor = cursorInicial;
    for (const tecla of teclas) {
      const escrito = valor.slice(0, cursor) + tecla + valor.slice(cursor);
      const digitos = escrito.slice(0, cursor + 1).replace(/\D/g, "").length;
      valor = b.formatearPesos(escrito);
      cursor = b.posicionTrasDigitos(valor, digitos);
    }
    return { valor, cursor };
  };
  const mil = teclear("", 0, "1000");
  assert.equal(mil.valor, "1.000", "escribir 1000 se ve 1.000");
  assert.equal(mil.cursor, 5, "el cursor queda al final, no antes del punto");
  assert.equal(b.leerPesos(mil.valor), 1000, "y el valor sigue siendo 1000");
  const millon = teclear("", 0, "1250000");
  assert.equal(millon.valor, "1.250.000");
  assert.equal(b.leerPesos(millon.valor), 1250000);
  // Corregir en medio: un 5 tras el "1" de "1.000" da "15.000" y el cursor no
  // salta al final (era 1, queda 2: justo detras del 5 recien escrito).
  const enMedio = teclear("1.000", 1, "5");
  assert.equal(enMedio.valor, "15.000");
  assert.equal(enMedio.cursor, 2, "el cursor se queda donde se escribio");
  assert.equal(b.leerCantidad("1,5"), 1.5);
  assert.equal(b.leerCantidad("0.25"), 0.25);
  for (const texto of ["0", "1,234", "-1", "", "100001"]) assert.equal(b.leerCantidad(texto), null, texto);
  assert.equal(b.leerPorcentaje("30"), 30);
  assert.equal(b.leerPorcentaje("12,5 %"), 12.5);
  assert.equal(b.leerPorcentaje("0"), 0);
  for (const texto of ["-1", "1000,01", "abc"]) assert.equal(b.leerPorcentaje(texto), null, texto);
  console.log("[PASS] lectura: pesos enteros con puntos de miles o $, cantidades y porcentaje con coma o punto y hasta dos decimales");

  const { materiales, sinPrecio } = b.materialesDesdeCotizacion({
    lineas: [
      { id: "v1", varianteId: "v1", nombre: "R-5 SILK AMATISTA X 50", tamano: "R-5", cantidadNecesaria: 30, disponible: true, paquetes: 1, precioPaquete: 16900 },
      { id: "v1b", varianteId: "v1", nombre: "R-5 SILK AMATISTA X 50", tamano: "R-5", cantidadNecesaria: 30, disponible: true, paquetes: 2, precioPaquete: 16900 },
      { id: "sin", tamano: "R-12", color: "verde", cantidadNecesaria: 4, disponible: false, sinReferencia: true },
      { id: "v3", varianteId: "v3", tamano: "R-9", cantidadNecesaria: 4, disponible: true, paquetes: 1 },
    ],
  });
  assert.deepEqual(materiales, [{ variant_id: "v1", descripcion: "R-5 SILK AMATISTA X 50", paquetes: 3, precio_paquete_catalogo_cop: 16900 }], "one line per catalog variant, bags added");
  assert.equal(sinPrecio, 2, "without a catalog product or a price the line is not quoted, and is counted");
  console.log("[PASS] materiales: solo productos del catálogo con precio; una variante una sola vez; lo que no se puede cotizar se cuenta");

  const borrador = b.borradorVacio();
  let leido = b.leerBorrador(borrador, CATALOGO);
  assert.deepEqual(leido.entrada, { materiales: CATALOGO, mano_de_obra: [], equipos_transporte: [], indirectos: [], utilidad_porcentaje: null }, "nothing predefined: empty sections and no profit");
  borrador.costos.mano_de_obra = [b.filaVacia("a"), { id: "b", descripcion: " Horas ", costo: "12.000", cantidad: "2" }];
  borrador.precios = { v1: "16.900", v2: "5.000" };
  borrador.utilidad = "30";
  leido = b.leerBorrador(borrador, CATALOGO);
  assert.ok(leido.entrada);
  assert.deepEqual(leido.entrada.mano_de_obra, [{ descripcion: "Horas", costo_unitario_cop: 12000, cantidad: 2 }], "a blank row is ignored");
  assert.deepEqual(leido.enviadas.mano_de_obra, ["b"]);
  assert.equal("precio_paquete_cop" in leido.entrada.materiales[0]!, false, "the catalog price typed back is not an edit");
  assert.equal(leido.entrada.materiales[1]!.precio_paquete_cop, 5000);
  assert.equal(leido.entrada.utilidad_porcentaje, 30);
  borrador.costos.indirectos = [{ id: "c", descripcion: "Oficina", costo: "", cantidad: "1" }];
  borrador.precios.v2 = "cinco mil";
  borrador.utilidad = "treinta";
  leido = b.leerBorrador(borrador, MATERIALES);
  assert.equal(leido.entrada, null, "anything unreadable sends nothing");
  assert.deepEqual([...leido.invalidas], ["c"]);
  assert.deepEqual([...leido.preciosInvalidos], ["v2"]);
  assert.equal(leido.utilidadInvalida, true);
  console.log("[PASS] borrador: sin valores predefinidos; filas en blanco se ignoran, las incompletas y los números ilegibles se marcan y no se envía nada");
}

async function probarRuta(): Promise<void> {
  const { POST } = await import("../../src/app/api/cotizacion-profesional/route");
  const { UiErrorV1Schema } = await import("../../src/lib/ia/contracts/ui-error-v1");
  const { EDICION_PYTHON_DEADLINE_MS } = await import("../../src/lib/plan/edicion-python");
  const { SESSION_COOKIE, sessionToken } = await import("../../src/lib/auth/session");

  async function pedir(cuerpo: unknown, cabeceras: Record<string, string> = {}): Promise<{ status: number; cuerpo: Json }> {
    const respuesta = await POST(new Request("http://127.0.0.1/api/cotizacion-profesional", {
      method: "POST",
      headers: { "content-type": "application/json", ...cabeceras },
      body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }));
    const datos: unknown = await respuesta.json();
    assert.ok(esObjeto(datos));
    return { status: respuesta.status, cuerpo: datos };
  }

  let llamadas = instalarFetch((llamada) => sobre(llamada, respuestaPython()));
  let r = await pedir(ENTRADA);
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo).slice(0, 300));
  assert.deepEqual(r.cuerpo, respuestaPython(), "Python's totals, as they came");
  assert.equal(llamadas.length, 1);
  const peticion = llamadas[0]!;
  assert.equal(peticion.path, "/internal/v1/plan/cotizacion-profesional");
  assert.equal(peticion.body.schema_version, "cotizacion-profesional.v1");
  assert.deepEqual(peticion.body.materiales, MATERIALES);
  const contexto = peticion.body.context as Json;
  assert.deepEqual(contexto.scopes, ["plan.cotizacion_profesional"]);
  assert.equal(peticion.headers.get("x-internal-scopes"), "plan.cotizacion_profesional");
  assert.equal(contexto.deadline_ms, EDICION_PYTHON_DEADLINE_MS, "a short deadline: the decorator is typing");
  console.log("[PASS] ruta: petición cotizacion-profesional.v1 con scope plan.cotizacion_profesional y deadline corto; devuelve los totales de Python");

  llamadas = instalarFetch(() => { throw new Error("un cuerpo inválido no debe llegar a Python"); });
  for (const [caso, cuerpo] of [
    ["sin materiales", { ...ENTRADA, materiales: [] }],
    ["variante repetida", { ...ENTRADA, materiales: [MATERIALES[0], MATERIALES[0]] }],
    ["un campo de más", { ...ENTRADA, alquileres: [] }],
    ["costo con decimales", { ...ENTRADA, mano_de_obra: [{ descripcion: "Horas", costo_unitario_cop: 10.5, cantidad: 1 }] }],
    ["cantidad cero", { ...ENTRADA, mano_de_obra: [{ descripcion: "Horas", costo_unitario_cop: 1000, cantidad: 0 }] }],
    ["cantidad con tres decimales", { ...ENTRADA, mano_de_obra: [{ descripcion: "Horas", costo_unitario_cop: 1000, cantidad: 1.234 }] }],
    ["utilidad negativa", { ...ENTRADA, utilidad_porcentaje: -1 }],
    ["sin utilidad_porcentaje", { materiales: MATERIALES, mano_de_obra: [], equipos_transporte: [], indirectos: [] }],
  ] as const) {
    r = await pedir(cuerpo);
    assert.equal(r.status, 400, caso);
    assert.equal(UiErrorV1Schema.parse(r.cuerpo.ui_error).code, "SOLICITUD_INVALIDA", caso);
  }
  r = await pedir("{no json");
  assert.equal(r.status, 400);
  assert.equal(llamadas.length, 0);
  console.log("[PASS] cuerpo estricto: 400 sin llamar a Python");

  for (const [caso, cambios] of [
    ["otras líneas", { materiales: { lineas: [], total_cop: 0 } }],
    ["fuera del contrato", { precio_sugerido_cop: -1 }],
  ] as const) {
    instalarFetch((llamada) => sobre(llamada, respuestaPython(cambios)));
    r = await pedir(ENTRADA);
    assert.equal(r.status, 502, caso);
    assert.equal(r.cuerpo.code, "PYTHON_INVALID_RESPONSE", caso);
  }
  instalarFetch(() => { throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:8000"); });
  r = await pedir(ENTRADA);
  assert.equal(r.status, 502);
  assert.equal(r.cuerpo.code, "PYTHON_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /ECONNREFUSED/, "no internal detail reaches the browser");
  console.log("[PASS] respuesta validada: otras líneas o fuera del contrato → 502; Python caído → 502 sin detalles internos");

  process.env.APP_PASSWORD = "clave-de-prueba";
  llamadas = instalarFetch((llamada) => sobre(llamada, respuestaPython()));
  r = await pedir(ENTRADA);
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0);
  r = await pedir(ENTRADA, { cookie: `${SESSION_COOKIE}=${sessionToken("clave-de-prueba")}` });
  assert.equal(r.status, 200);
  delete process.env.APP_PASSWORD;
  console.log("[PASS] autenticación: sin sesión 401 y nada llega a Python; con la cookie de sesión 200");
}

async function main(): Promise<void> {
  await probarBorrador();
  await probarRuta();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
