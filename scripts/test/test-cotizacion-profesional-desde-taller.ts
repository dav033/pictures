import assert from "node:assert/strict";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { cotizarBom, crosswalkIncluido, type BomLinea } from "../../src/lib/globos3d/motor/v1";
import { resumenHelio } from "../../src/lib/globos3d/helio-cinta";
import { atenderCotizacionTaller, atenderCotizacionTallerV2 } from "../../src/lib/taller/cotizacion-taller";
import { cotizacionProfesionalDesdeTaller, claveDeCotizacionTaller } from "../../src/lib/taller/cotizacion-profesional-desde-taller";
import { CotizacionTallerSchema, CotizacionTallerV2Schema } from "../../src/lib/taller/cotizacion-taller-tipos";
import { borradorVacio, FalloCotizacionProfesional, leerBorrador, materialesDesdeCotizacion, pedirCotizacionProfesional } from "../../src/lib/cotizacion/borrador-profesional";
import { pythonDoble } from "../lib/python-doble-precio";

const CLAVE_APP = "clave-de-prueba-cotizacion-profesional-taller";
const COOKIES = [`${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}`, `feedback_usuario=${"a7".repeat(16)}`].join("; ");
process.env.APP_PASSWORD = CLAVE_APP;
delete process.env.DATABASE_URL;

const cruce = crosswalkIncluido();
const dependencias = {
  cotizar: (bom: { total: readonly BomLinea[]; porPieza: Readonly<Record<string, readonly BomLinea[]>> }) => cotizarBom(bom, {
    crosswalk: async () => cruce,
    cotizarLista: (entrada) => pythonDoble(cruce).cotizarLista(entrada),
  }),
  auditar: () => undefined,
};
const pedir = (ruta: string, materiales: BomLinea[]) => new Request(`https://app.test${ruta}`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: COOKIES },
  body: JSON.stringify({ materiales }),
});

async function main(): Promise<void> {
  const disponibles = Object.keys(cruce.entradas).filter((clave) => clave.startsWith("R-12|")).sort().slice(0, 3);
  assert.equal(disponibles.length, 3, "la fixture del catálogo ofrece tres colores R-12");
  const pares = disponibles.map((clave) => {
    const [formatoId, codigo] = clave.split("|") as [string, string];
    return { formatoId, codigo };
  });
  const fixtures: BomLinea[][] = [
    [{ ...pares[0]!, cantidad: 11 }],
    [{ ...pares[0]!, cantidad: 17 }, { ...pares[1]!, cantidad: 23 }],
    [{ ...pares[0]!, cantidad: 12 }, { ...pares[1]!, cantidad: 19 }, { ...pares[2]!, cantidad: 25 }],
  ];

  for (const [indice, materiales] of fixtures.entries()) {
    const v1Response = await atenderCotizacionTaller(pedir("/api/taller/cotizacion", materiales), dependencias);
    const v2Response = await atenderCotizacionTallerV2(pedir("/api/taller/cotizacion/v2", materiales), dependencias);
    assert.equal(v1Response.status, 200, await v1Response.clone().text());
    assert.equal(v2Response.status, 200, await v2Response.clone().text());
    const v1 = CotizacionTallerSchema.parse(await v1Response.json());
    const v2 = CotizacionTallerV2Schema.parse(await v2Response.json());
    assert.equal(v2.total, v1.total, `fixture ${indice + 1}: el contrato ampliado conserva el precio D-038`);
    assert.equal(v2.lineas.reduce((suma, linea) => suma + linea.subtotal, 0), v1.total, `fixture ${indice + 1}: las líneas suman el total del Taller`);
    assert.equal(new Set(v2.lineas.map((linea) => linea.varianteId)).size, v2.lineas.length, `fixture ${indice + 1}: una línea por variante/producto/tamaño/color`);

    const cotizacion = cotizacionProfesionalDesdeTaller(v2);
    const desdeCotizacion = materialesDesdeCotizacion(cotizacion);
    assert.equal(desdeCotizacion.sinPrecio, 0, `fixture ${indice + 1}: todas las líneas del BOM tienen precio`);
    assert.equal(desdeCotizacion.materiales.length, v2.lineas.length, `fixture ${indice + 1}: no se pierden líneas al entrar al cotizador profesional`);
    for (const [linea, material] of v2.lineas.map((linea) => [linea, desdeCotizacion.materiales.find((m) => m.variant_id === linea.varianteId)!] as const)) {
      assert.equal(material.paquetes, linea.paquetes);
      assert.equal(material.precio_paquete_catalogo_cop, linea.precioPaquete);
      assert.match(material.descripcion, new RegExp(linea.tamano));
    }
    const inicial = leerBorrador(borradorVacio(), desdeCotizacion.materiales);
    assert.deepEqual(inicial.entrada?.mano_de_obra, []);
    assert.deepEqual(inicial.entrada?.equipos_transporte, []);
    assert.deepEqual(inicial.entrada?.indirectos, []);
    assert.equal(inicial.entrada?.utilidad_porcentaje, null);
  }

  const escena = { sala: { anchoCm: 400, fondoCm: 400, altoCm: 280, tonos: { piso: "#fff", paredes: "#fff", techo: "#fff" }, mostrar: { piso: true, fondo: true, laterales: true, techo: true } }, nodos: [] };
  const materiales = [{ formatoId: "R-12", codigo: pares[0]!.codigo, cantidad: 11 }];
  const helio = resumenHelio([{ globos: Array.from({ length: 2 }, () => ({ formatoId: "R-12", infladoCm: 30, parte: "helio" })), metrosCinta: 2.4 }]);
  const clave = claveDeCotizacionTaller({ nombre: "Arco", escena, materiales, helio });
  assert.notEqual(clave, claveDeCotizacionTaller({ nombre: "Arco", escena: { ...escena, sala: { ...escena.sala, anchoCm: 410 } }, materiales, helio }), "una escena modificada recibe otra clave y no reutiliza un borrador vigente");

  const cotizacionDemo = CotizacionTallerV2Schema.parse(await (await atenderCotizacionTallerV2(pedir("/api/taller/cotizacion/v2", fixtures[0]!), dependencias)).json());
  const entrada = leerBorrador(borradorVacio(), materialesDesdeCotizacion(cotizacionProfesionalDesdeTaller(cotizacionDemo)).materiales).entrada;
  assert.ok(entrada);
  let intentos = 0;
  const fetcher: typeof fetch = async () => {
    intentos += 1;
    return Response.json({ error: "No pude calcular el precio ahora.", codigo: "PRECIO_FALLIDO" }, { status: 502 });
  };
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(pedirCotizacionProfesional(entrada, { fetcher }), (error: unknown) => error instanceof FalloCotizacionProfesional);
  }
  assert.equal(intentos, 2, "tras un fallo de Python la petición se puede volver a ejecutar; no se fabrica un precio");
  console.log("[PASS] 3 fixtures conservan la paridad D-038 y pasan al cotizador profesional con trabajo/margen vacíos; el fallo se devuelve y la petición admite reintento");
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
