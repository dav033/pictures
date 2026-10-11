/**
 * D-038, la lista curada de una idea sin plan guardado se cotiza con el cotizador único (`cotizarListaCurada`), como lo haría el
 * Taller con los mismos globos. Sin red, sin base, sin IA: Python se sustituye por el doble que cotiza con los paquetes del cruce y
 * el catálogo por una copia de las filas reales de los globos impresos (`presentaciones-impresos`).
 * 1. `curadaABom`: cada variante del cruce es el globo (formato y código) al que pertenece; dos paquetes del mismo globo se suman;
 *    lo que el cruce no conoce (un impreso) queda aparte, nunca como otro globo.
 * 2. `cotizarListaCurada`: el total es el de `cotizarBom` sobre esos globos (repuestos por globo, el paquete más barato), no el de
 *    comprar cada variante tal cual.
 * 3. Un globo que el cruce no conoce (los impresos de 8 ideas de ejemplo) se COTIZA: con los paquetes de su producto en esa talla,
 *    la misma regla y Python como todo lo demás. Solo lo que de verdad no tiene precio queda en `fuera` (con su variante, para la
 *    auditoría), y nunca se suma ni se resta en silencio; un catálogo que no se pudo leer no calla: no hay precio.
 * 4. Si el cruce incluido no conoce una variante que el de ahora sí, se usa el de ahora; si la tienda ya no vende un color, se cotiza
 *    el resto y ese color queda fuera, como en el Taller.
 * 5. Sin ningún globo que cotizar, con Python caído o con el cotizador roto, no hay precio y la tarjeta no inventa otro (`sin_precio`).
 * 6. `costearDecoracion`: lo que lee el modelo repite lo que no está en el precio; la cotización que se pinta y se guarda en la sesión
 *    no lleva ninguna clave nueva (D-035): la nota viaja aparte, en `datos.noIncluidos`, que solo existe si hay nota y que el evento
 *    `fin` del chat (JSON puro, sin `undefined`) acepta en todos los casos.
 * 7. Lo que queda en la auditoría durable (`filaDeCotizacionDeIdea`) dice que el precio salió del cotizador único, sin error, y qué
 *    variantes quedaron fuera.
 * 8. `leerPresentacionesDeVariantes` y `productosDePresentaciones`: la consulta pide las variantes y arma las presentaciones por producto y talla.
 * 9. Las dependencias de costeo de la ruta cargan el cotizador de la lista curada solo al costear, y toda lectura del catálogo lleva plazo.
 * 10. Un catálogo que no responde (sin conexión o sin respuesta) no cuelga el turno: el costeo termina dentro de su plazo, cotiza lo que sí puede
 *     y deja lo demás FUERA con su motivo (`catalogo_no_respondio`), en la nota de la tarjeta y en la auditoría.
 * 11. Las presentaciones se leen primero y a la vez que el snapshot; el cruce de ahora solo para lo que ellas no resuelven (nunca si el catálogo
 *     no respondió); un fallo del cruce de ahora se recuerda un minuto y que un cliente cierre su turno no cuenta como fallo de la base.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-cotizar-curada.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decoracionesSempertex } from "../../src/lib/biblioteca-sempertex/biblioteca";
import { CotizacionGuiadaSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { CHAT_SSE_CONTRACT_VERSION, ChatSseEventV1Schema } from "../../src/lib/ia/contracts/chat-v1";
import type { Pool } from "pg";
import { leerPresentacionesDeVariantes } from "../../src/lib/globos3d/motor/crosswalk-consulta";
import { olvidarCrosswalk } from "../../src/lib/globos3d/motor/crosswalk-vigente";
import { cotizarBom, crosswalkEnVivo, crosswalkIncluido, extenderCruce, presentacionesDeVariantes, productosDePresentaciones, snapshotPublicado } from "../../src/lib/globos3d/motor/v1";
import { filaDeCotizacionDeIdea } from "../../src/lib/guiada-motor/auditoria-plan";
import { consultaDelCosteo } from "../../src/lib/guiada-motor/consulta-del-costeo";
import { costearDecoracion, type DependenciasCosteo } from "../../src/lib/guiada-motor/costear-idea";
import { datosDelCosteo } from "../../src/lib/guiada-motor/dependencias-costeo";
import { curadaABom, cotizarListaCurada, type DependenciasCurada, type MaterialCurado } from "../../src/lib/guiada-motor/cotizar-curada";
import { notaNoIncluidos } from "../../src/lib/guiada-motor/no-incluidos";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { PlazoDeLecturaError } from "../../src/lib/rag/consulta-con-plazo";
import { FILAS_IMPRESOS, presentacionesDeImpresos, variantesDeImpresos } from "../lib/presentaciones-impresos";
import { pythonDoble } from "../lib/python-doble-precio";

type PoolDeLectura = Pick<Pool, "connect">;
const RAIZ = path.resolve(__dirname, "..", "..");
const cruce = crosswalkIncluido();
const doble = pythonDoble(cruce, { variantesExtra: variantesDeImpresos() });
const nada = () => undefined;
const deps: DependenciasCurada = { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista, presentaciones: presentacionesDeImpresos };
/** Lo mismo con un catálogo que no vende nada de lo que el cruce no conoce. */
const sinCatalogo: DependenciasCurada = { ...deps, presentaciones: async () => [] };

const ideaCurada = (id: string): { id: string; materiales: MaterialCurado[] } => {
  const idea = decoracionesSempertex.find((d) => d.id === id);
  assert.ok(idea, `la idea ${id} existe`);
  assert.equal(planGuardadoDeIdea(id), null, `${id} no tiene plan guardado`);
  return { id, materiales: idea.materiales.map((m) => ({ variantId: m.variantId, cantidad: m.cantidad, ...(m.nota ? { nota: m.nota } : {}) })) };
};

const depsDeLaTarjeta = (extra: Partial<DependenciasCosteo> = {}, curada: DependenciasCurada = deps): DependenciasCosteo => ({
  leerMotor: async () => "3d",
  tienePlanGuardado: async (id) => planGuardadoDeIdea(id) !== null,
  cotizarConMotor: async () => { throw new Error("una idea sin plan no pasa por el motor"); },
  cotizarConPython: async () => { throw new Error("una idea sin plan no pasa por Python"); },
  cotizarCurada: (materiales) => cotizarListaCurada(materiales, curada),
  auditar: nada,
  ...extra,
});

const IMPRESO_BAUTIZO = "46594207908135";

async function main(): Promise<void> {
  // 1. De variantes de la tienda a globos.
  const blanco = cruce.entradas["R-12|005"]!;
  const [paqueteChico, paqueteGrande] = [blanco.variantes[0]!, blanco.variantes.at(-1)!];
  assert.notEqual(paqueteChico.variantId, paqueteGrande.variantId, "el blanco de 12″ se vende en más de un paquete");
  const mezcla = curadaABom([
    { variantId: paqueteChico.variantId, cantidad: 7 }, { variantId: paqueteGrande.variantId, cantidad: 5 }, { variantId: "variante-que-el-cruce-no-conoce", cantidad: 3, nota: "Globo látex R-12 impreso de prueba, paquete x50" },
  ], cruce);
  assert.deepEqual(mezcla.globos, [{ formatoId: "R-12", codigo: "005", cantidad: 7 }, { formatoId: "R-12", codigo: "005", cantidad: 5 }], "cada paquete es el mismo globo");
  assert.deepEqual(mezcla.sinCruce.map((m) => m.variantId), ["variante-que-el-cruce-no-conoce"]);
  assert.deepEqual([...mezcla.porClave.keys()], ["R-12|005"]);
  console.log("[PASS] las variantes del cruce son globos (formato y código) y lo desconocido queda aparte");

  // 2. El precio es el del cotizador único, no el de comprar cada variante tal cual.
  const princesas = ideaCurada("ej-princesas");
  const cotizada = await cotizarListaCurada(princesas.materiales, deps);
  assert.ok(cotizada.ok);
  const globos = curadaABom(princesas.materiales, cruce).globos;
  const delCotizador = await cotizarBom({ total: globos, porPieza: {} }, deps);
  assert.ok(delCotizador.ok);
  assert.equal(cotizada.cotizacion.total, delCotizador.total, "mismo total que el cotizador único sobre los mismos globos");
  assert.equal(cotizada.cotizacion.mermaPorcentaje, delCotizador.cotizacion.mermaPorcentaje, "con los repuestos de la regla única");
  assert.equal(cotizada.globos, princesas.materiales.reduce((suma, m) => suma + m.cantidad, 0));
  assert.deepEqual(cotizada.fuera, [], "todo era un globo del cruce: nada queda fuera");
  // A mano: 40 rosewood + 4 repuestos (8 %) = 44 → un paquete de 50 (13 037) gana a cuatro de 12; 20 lila (o blanco) + 2 repuestos = 22 → dos de 12
  // (2 × 3 963) gana a un paquete de 20 más uno de 12 y a uno de 50. Total 13 037 + 7 926 + 7 926.
  assert.deepEqual(cotizada.cotizacion.lineas.map((l) => [l.cantidadNecesaria, l.paquetes, l.unidadesPaquete, l.subtotal]).sort(), [[20, 2, 12, 7926], [20, 2, 12, 7926], [40, 1, 50, 13037]]);
  assert.equal(cotizada.cotizacion.total, 28_889);
  const comoVenia = (await doble.cotizarLista({ schema_version: "lista-materiales.v1", materiales: princesas.materiales.map((m) => ({ variant_id: m.variantId, cantidad: m.cantidad })) })).total;
  assert.ok(cotizada.cotizacion.total < comoVenia, `con el paquete más barato cuesta menos que comprar cada variante tal cual (${cotizada.cotizacion.total} contra ${comoVenia})`);
  console.log(`[PASS] ej-princesas ${cotizada.cotizacion.total} (antes ${comoVenia} como venía)`);

  // 3. Lo que el cruce no conoce se cotiza con los paquetes de su producto.
  const bautizo = ideaCurada("ej-bautizo-comunion");
  const conImpreso = await cotizarListaCurada(bautizo.materiales, deps);
  assert.ok(conImpreso.ok);
  assert.deepEqual(conImpreso.fuera, [], "el impreso tiene precio: nada queda fuera");
  const lisos = bautizo.materiales.filter((m) => m.variantId !== IMPRESO_BAUTIZO);
  const soloLisos = await cotizarListaCurada(lisos, deps);
  assert.ok(soloLisos.ok);
  // A mano: 20 impresos + 2 repuestos = 22 → dos paquetes de 12 (2 × 5 281 = 10 562; sobran 4) cuestan menos que uno de 50 (18 271).
  assert.equal(conImpreso.cotizacion.total, soloLisos.cotizacion.total + 10_562, "el impreso suma lo que cuestan sus paquetes de 12, no el de 50 de la lista");
  const lineaImpresa = conImpreso.cotizacion.lineas.find((l) => /Mi Bautizo/.test(l.nombre));
  assert.deepEqual([lineaImpresa?.cantidadNecesaria, lineaImpresa?.paquetes, lineaImpresa?.unidadesPaquete, lineaImpresa?.precioPaquete, lineaImpresa?.subtotal, lineaImpresa?.sobrante], [20, 2, 12, 5281, 10562, 4]);
  assert.equal(conImpreso.globos, bautizo.materiales.reduce((suma, m) => suma + m.cantidad, 0), "los 80 globos, impresos incluidos");
  // La misma regla de siempre en el impreso: dos variantes pedidas del mismo producto y talla se compran juntas.
  const doblePedido = await cotizarListaCurada([{ variantId: IMPRESO_BAUTIZO, cantidad: 10 }, { variantId: "46594207875367", cantidad: 10 }], deps);
  const unSoloPedido = await cotizarListaCurada([{ variantId: IMPRESO_BAUTIZO, cantidad: 20 }], deps);
  assert.ok(doblePedido.ok && unSoloPedido.ok);
  assert.equal(doblePedido.cotizacion.total, unSoloPedido.cotizacion.total, "10 + 10 del mismo impreso son 20");
  assert.equal(doblePedido.cotizacion.lineas.length, unSoloPedido.cotizacion.lineas.length);
  console.log(`[PASS] ej-bautizo-comunion ${conImpreso.cotizacion.total}: el impreso (20) se cotiza con los paquetes de su producto, 10 562 en vez de los 18 271 de su paquete de 50`);

  // Lo que de verdad no tiene precio queda fuera, con su variante, y no se suma ni se resta en silencio.
  const sinPrecioDelImpreso = await cotizarListaCurada(bautizo.materiales, sinCatalogo);
  assert.ok(sinPrecioDelImpreso.ok);
  assert.equal(sinPrecioDelImpreso.cotizacion.total, soloLisos.cotizacion.total, "sin precio del impreso, el total es el de los lisos");
  assert.deepEqual(sinPrecioDelImpreso.fuera, [{ variantId: IMPRESO_BAUTIZO, nombre: "Globo de látex 12\" impreso para bautizo", cantidad: 20, motivo: "sin_presentaciones" }]);
  const sinCatalogoAlguno = await cotizarListaCurada(bautizo.materiales, { crosswalk: deps.crosswalk, cotizarLista: deps.cotizarLista });
  assert.ok(sinCatalogoAlguno.ok && sinCatalogoAlguno.fuera.length === 1, "sin catálogo que consultar, lo que el cruce no conoce no tiene precio");
  // Un catálogo que no se pudo leer no calla: el impreso queda fuera del precio CON su motivo (no hay presentaciones que comprar) y el resto se cotiza.
  const catalogoCaido = await cotizarListaCurada(bautizo.materiales, { ...deps, presentaciones: async () => { throw new Error("la base no responde"); } });
  assert.ok(catalogoCaido.ok);
  assert.equal(catalogoCaido.cotizacion.total, soloLisos.cotizacion.total, "sin leer el catálogo, el total es el de los lisos");
  assert.deepEqual(catalogoCaido.fuera.map((f) => [f.variantId, f.cantidad, f.motivo]), [[IMPRESO_BAUTIZO, 20, "catalogo_no_respondio"]]);
  console.log("[PASS] lo que de verdad no tiene precio queda fuera con su variante y su motivo; un catálogo caído no lo calla");

  // 4. El cruce de ahora reconoce lo que el incluido no; y un color que la tienda ya no vende no tumba el resto.
  const lila = cruce.entradas["R-12|050"]!;
  const sinLila = { ...cruce, snapshot: "snapshot-vivo-sin-lila", entradas: Object.fromEntries(Object.entries(cruce.entradas).filter(([clave]) => clave !== "R-12|050")) };
  const incluidoViejo = await cotizarListaCurada(princesas.materiales, { ...sinCatalogo, crosswalk: async () => sinLila, crosswalkEnVivo: async () => cruce });
  assert.ok(incluidoViejo.ok);
  assert.equal(incluidoViejo.cotizacion.total, cotizada.cotizacion.total, "el cruce incluido no conocía el lila y el de ahora sí: se usa el de ahora y nada queda fuera");
  assert.deepEqual(incluidoViejo.fuera, []);
  const conHueco = await cotizarListaCurada(princesas.materiales, { ...deps, crosswalkEnVivo: async () => sinLila, snapshotPublicado: async () => "snapshot-vivo-sin-lila" });
  const sinElLila = await cotizarListaCurada(princesas.materiales.filter((m) => !lila.variantes.some((v) => v.variantId === m.variantId)), { ...deps, crosswalk: async () => sinLila });
  assert.ok(conHueco.ok && sinElLila.ok);
  assert.equal(conHueco.cotizacion.total, sinElLila.cotizacion.total, "el color que la tienda ya no vende no tumba el precio: se cotiza el resto");
  assert.deepEqual(conHueco.fuera.map((f) => [f.nombre, f.cantidad]), [["Globo de látex 12\" Lila", 20]], "y queda fuera, con su nombre de cliente");
  assert.equal(conHueco.globos, 60);
  // Un producto que el cruce no conoce sigue cotizándose cuando el cruce que se usa cambia de snapshot a mitad del precio.
  const impresoConCruceNuevo = await cotizarListaCurada(bautizo.materiales, { ...deps, crosswalkEnVivo: async () => ({ ...cruce, snapshot: "snapshot-nuevo" }), snapshotPublicado: async () => "snapshot-nuevo" });
  assert.ok(impresoConCruceNuevo.ok);
  assert.equal(impresoConCruceNuevo.cotizacion.total, conImpreso.cotizacion.total);
  console.log("[PASS] el cruce de ahora se usa si reconoce más; un color retirado queda fuera y el resto se cotiza");

  // 5. Sin precio.
  const soloImpresos = { id: bautizo.id, materiales: bautizo.materiales.filter((m) => m.variantId === IMPRESO_BAUTIZO) };
  assert.deepEqual(await cotizarListaCurada(soloImpresos.materiales, sinCatalogo), { ok: false, razon: "sin_cobertura", detalle: "la lista curada no trae nada que la tienda venda y se pueda cotizar" });
  const sinGlobos = await costearDecoracion(soloImpresos, "personal", depsDeLaTarjeta({}, sinCatalogo));
  assert.equal(sinGlobos.cotizacion, null);
  assert.deepEqual([sinGlobos.decision.usar, sinGlobos.respuesta.ok, sinGlobos.respuesta.motivo], ["sin_precio", false, "cotizacion_no_disponible"]);
  const soloElImpreso = await cotizarListaCurada(soloImpresos.materiales, deps);
  assert.ok(soloElImpreso.ok, "una lista solo de impresos también se cotiza");
  const caido = pythonDoble(cruce, { fallo: new Error("Python caído") });
  const sinPython = await cotizarListaCurada(princesas.materiales, { crosswalk: async () => cruce, cotizarLista: caido.cotizarLista });
  assert.deepEqual([sinPython.ok, !sinPython.ok && sinPython.razon], [false, "precio_fallido"]);
  const tarjetaSinPython = await costearDecoracion(princesas, "personal", depsDeLaTarjeta({ cotizarCurada: (m) => cotizarListaCurada(m, { crosswalk: async () => cruce, cotizarLista: caido.cotizarLista }) }));
  assert.deepEqual([tarjetaSinPython.cotizacion, tarjetaSinPython.decision.usar], [null, "sin_precio"]);
  const roto = await costearDecoracion(princesas, "personal", depsDeLaTarjeta({ cotizarCurada: async () => { throw new Error("el cruce no cargó"); } }));
  assert.deepEqual([roto.cotizacion, roto.decision.usar, roto.decision.usar === "sin_precio" && roto.decision.motivo, roto.respuesta.motivo], [null, "sin_precio", "error_del_motor", "cotizacion_no_disponible"], "un fallo del cotizador no escapa de la tarjeta");
  const sinMateriales = await costearDecoracion({ id: princesas.id, materiales: [] }, "personal", depsDeLaTarjeta());
  assert.deepEqual([sinMateriales.cotizacion, sinMateriales.decision.usar, sinMateriales.respuesta.motivo], [null, "curada", "costeo_pendiente_datos_de_catalogo"]);
  console.log("[PASS] sin globos que cotizar, con Python caído, con el cotizador roto y sin materiales no hay precio inventado");

  // 6. Lo que lee el modelo y la cotización que se guarda.
  const tarjeta = await costearDecoracion(bautizo, "personal", depsDeLaTarjeta());
  assert.equal(tarjeta.noIncluidos, undefined, "con todo cotizado no hay nota");
  assert.doesNotMatch(String(tarjeta.respuesta.aviso), /No incluido en el precio/);
  const conFuera = await costearDecoracion(bautizo, "personal", depsDeLaTarjeta({}, sinCatalogo));
  const nota = notaNoIncluidos(conFuera.noIncluidos);
  assert.deepEqual(conFuera.noIncluidos, [{ nombre: "Globo de látex 12\" impreso para bautizo", cantidad: 20 }], "el cliente ve el nombre y la cantidad, sin la variante");
  assert.match(nota ?? "", /^No incluido en el precio: 20 × Globo de látex 12" impreso para bautizo\./);
  assert.ok(String(conFuera.respuesta.aviso).includes(nota!), "el aviso del modelo repite la nota de la tarjeta");
  // La cotización es la de siempre (D-035): ninguna clave que el esquema estricto de un despliegue anterior no conozca.
  for (const cotizacion of [tarjeta.cotizacion, conFuera.cotizacion, (await costearDecoracion(princesas, "personal", depsDeLaTarjeta())).cotizacion]) {
    assert.ok(cotizacion && CotizacionGuiadaSchema.safeParse(cotizacion).success);
    assert.deepEqual(Object.keys(cotizacion).sort(), ["complementosSoportados", "incluyeIva", "lineas", "mermaPorcentaje", "total"]);
    assert.ok(cotizacion.lineas.every((linea) => Object.keys(linea).every((clave) => ["id", "tamano", "color", "cantidadNecesaria", "disponible", "varianteId", "nombre", "precioPaquete", "unidadesPaquete", "paquetes", "subtotal", "sobrante"].includes(clave))));
  }
  console.log("[PASS] la nota de «no incluido en el precio» viaja aparte de la cotización, que no lleva ninguna clave nueva");

  // El evento `fin` del chat solo admite JSON: sin nota la clave no puede existir ni valer `undefined`, y la de un turno anterior no se arrastra.
  const finDe = (datos: Record<string, unknown>) => ChatSseEventV1Schema.safeParse({
    schema_version: CHAT_SSE_CONTRACT_VERSION, type: "fin", request_id: "00000000-0000-4000-8000-0000000000f1", correlation_id: "00000000-0000-4000-8000-0000000000f2",
    reply: "Los materiales suman", brief: {}, proveedor: "proveedor", modelo: "modelo", result: datos,
  });
  for (const [caso, costeo, conNota] of [["todo cotizado", tarjeta, false], ["con algo fuera del precio", conFuera, true], ["sin precio", roto, false], ["sin materiales", sinMateriales, false]] as const) {
    const datos: Record<string, unknown> = { uso: "personal", noIncluidos: [{ nombre: "de un turno anterior", cantidad: 1 }] };
    datosDelCosteo(datos, costeo);
    assert.equal("noIncluidos" in datos, conNota, `${caso}: la clave solo existe si hay nota`);
    const fin = finDe(datos);
    assert.ok(fin.success, `${caso}: el evento fin del chat acepta lo que deja el costeo: ${fin.success ? "" : JSON.stringify(fin.error.issues.slice(0, 2))}`);
  }
  assert.equal(finDe({ cotizacion: null, noIncluidos: undefined }).success, false, "(y un undefined sí lo rechazaría: la prueba muerde)");

  // 7. La auditoría durable.
  const filaDelPrecio = filaDeCotizacionDeIdea(conFuera.decision, bautizo.id, "00000000-0000-4000-8000-0000000000a1", "/api/asistente-guiado");
  assert.deepEqual([filaDelPrecio.estado, filaDelPrecio.error, filaDelPrecio.resultado.precio, filaDelPrecio.resultado.origen, filaDelPrecio.resultado.globos, filaDelPrecio.resultado.lineas, filaDelPrecio.totalCop],
    ["COTIZACION_IDEA_CURADA", undefined, "cotizador_unico", "curada", 60, 2, conFuera.cotizacion?.total], "un precio no es un error");
  assert.deepEqual(filaDelPrecio.resultado.fuera_del_precio, [{ variant_id: IMPRESO_BAUTIZO, cantidad: 20, motivo: "sin_presentaciones" }], "la fila dice qué variante, cuántos globos y por qué quedaron fuera, no solo cuántas");
  const filaCompleta = filaDeCotizacionDeIdea(tarjeta.decision, bautizo.id, "00000000-0000-4000-8000-0000000000a3", "/api/asistente-guiado");
  assert.deepEqual([filaCompleta.estado, filaCompleta.resultado.globos, filaCompleta.resultado.fuera_del_precio], ["COTIZACION_IDEA_CURADA", 80, []]);
  const filaSinPrecio = filaDeCotizacionDeIdea(roto.decision, princesas.id, "00000000-0000-4000-8000-0000000000a2", "/api/asistente-guiado");
  assert.deepEqual([filaSinPrecio.estado, filaSinPrecio.error, filaSinPrecio.resultado.origen, filaSinPrecio.resultado.precio], ["COTIZACION_IDEA_SIN_PRECIO", "error_del_motor", "curada", undefined], "sin precio no hay «cotizador_unico»");
  assert.doesNotMatch(JSON.stringify([filaDelPrecio, filaCompleta, filaSinPrecio]), /el cruce no cargó|No pude|No incluido/, "la fila lleva códigos y cifras, nunca el texto del aviso ni del error");
  console.log("[PASS] la auditoría durable dice que el precio salió del cotizador único, sin error, y qué quedó fuera");

  // 8. La consulta del catálogo y su paso al cruce.
  const consultas: Array<{ texto: string; parametros: readonly unknown[] | undefined }> = [];
  // La consulta trae, de cada variante pedida, todas las de su producto con lo que decide si son del mismo globo, y la regla de Python se aplica en TypeScript
  // (los vectores sacados de Python están en `test-mismo-globo`). Aquí: la forma de la consulta y que lo que la base no vende se descarta.
  const filaSql = (pedida: string, variantId: string, unidades: number, precio: number, extra: Record<string, unknown> = {}) => ({
    pedida, snapshot: "snap", product_id: "p1", titulo_producto: "B2b Globo Impreso", colores_producto: [], variant_id: variantId, titulo_variante: `R-12 / PAQUETE X ${unidades}`,
    codigo_tamano: "R-12", forma: "redondo", diam_pulg: 12, derived_colors: null, unidades_paq: unidades, price: precio, vendible: true, ...extra,
  });
  const conexion = {
    query: async (texto: string, parametros?: readonly unknown[]) => {
      consultas.push({ texto, parametros });
      return { rows: [
        filaSql("a", "a", 50, 24143), filaSql("a", "b", 12, 6624), filaSql("a", "c", 0, 100), filaSql("a", "d", 12, 0),
        filaSql("a", "f", 12, 6000, { vendible: false }), filaSql("a", "g", 12, 6624, { forma: "corazon" }), filaSql("a", "h", 12, 6624, { codigo_tamano: "R-5", diam_pulg: 5 }),
        { ...filaSql("a", "e", 12, 6624), pedida: 7 },
      ] };
    },
  };
  const leidas = await leerPresentacionesDeVariantes(conexion, ["a"]);
  assert.deepEqual(leidas.map((f) => [f.pedida, f.variantId, f.unidadesPaq, f.precio]), [["a", "a", 50, 24143], ["a", "b", 12, 6624]],
    "se descartan lo que la base no vende (sin unidades, sin precio, agotado), lo de otra forma o talla, y la fila sin pedida válida");
  assert.deepEqual(consultas[0]?.parametros, [["a"]], "se piden las variantes en un arreglo");
  // El SQL, condición por condición (una errata aquí cambia qué se compra): el producto de la pedida, el snapshot publicado y lo que Python vende.
  const sql = consultas[0]!.texto.replace(/\s+/g, " ");
  for (const condicion of [
    "WITH snapshot AS ( SELECT source_snapshot_id FROM rag_source_snapshots WHERE source_kind = 'products_catalog' AND status = 'published' ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1 )",
    "pedidas AS ( SELECT v.variant_id::text AS pedida, v.product_id FROM catalog_variants v JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id WHERE v.variant_id::text = ANY($1::text[]) )",
    "FROM pedidas q JOIN catalog_variants v ON v.product_id = q.product_id JOIN catalog_products p ON p.product_id = v.product_id JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id",
    "WHERE p.source_snapshot_id = s.source_snapshot_id AND p.status = 'ACTIVE' AND p.available = TRUE",
    "AND (v.variant_id::text = q.pedida OR (v.available = TRUE AND v.currency = 'COP' AND v.price > 0 AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0))",
    "(v.available = TRUE AND v.currency = 'COP' AND v.price > 0 AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0) AS vendible",
    "ORDER BY q.pedida, v.variant_id",
  ]) assert.ok(sql.includes(condicion), `la consulta de presentaciones lleva «${condicion}»`);
  for (const columna of ["v.codigo_tamano", "v.forma", "v.diam_pulg", "v.derived_colors", "p.derived->'colors'", "p.title AS titulo_producto"]) {
    assert.ok(sql.includes(columna), `${columna}: lo que decide «el mismo globo» de Python (producto, talla, diámetro, forma y colores) viaja en la fila`);
  }
  assert.ok(!sql.includes("IS NOT DISTINCT FROM"), "la igualdad de talla, forma, diámetro y colores no está en el SQL: la base no normaliza texto ni colores como Python, así que se aplica en TypeScript");
  assert.deepEqual(await leerPresentacionesDeVariantes(conexion, []), [], "sin variantes no se consulta");
  assert.equal(consultas.length, 1);
  const productos = productosDePresentaciones([
    ...leidas, { ...leidas[0]!, pedida: "b" }, { ...leidas[1]!, pedida: "b" },
    // Otro producto con dos variantes del mismo tamaño que NO son paquetes del mismo globo (la consulta solo devuelve a cada una consigo misma).
    { ...leidas[0]!, productId: "2", variantId: "z", codigoTamano: null, pedida: "z" }, { ...leidas[0]!, productId: "2", variantId: "y", codigoTamano: null, pedida: "y" },
  ]);
  assert.equal(productos.length, 3, "dos pedidas del mismo globo son un producto; globos distintos del mismo producto (otro color o diseño), productos distintos");
  assert.deepEqual(productos.filter((p) => p.pedidas.includes("z") || p.pedidas.includes("y")).map((p) => [p.formatoId, p.codigo]).sort(), [["sin tamaño aplicable", "p2-y"], ["sin tamaño aplicable", "p2-z"]], "sin código de talla la línea dice lo de siempre y cada globo tiene su clave");
  assert.equal(new Set(productos.map((p) => p.codigo)).size, 3, "ninguna clave se repite");
  assert.deepEqual(productos.find((p) => p.pedidas.includes("a"))?.pedidas, ["a", "b"]);
  assert.deepEqual(productos.find((p) => p.pedidas.includes("a"))?.entrada.variantes.map((v) => v.unidadesPaq), [12, 50], "sus paquetes, de menor a mayor");
  const extendido = extenderCruce(cruce, productos);
  assert.equal(Object.keys(extendido.entradas).length, Object.keys(cruce.entradas).length + 3);
  assert.equal(Object.keys(cruce.entradas).length, Object.keys(crosswalkIncluido().entradas).length, "el cruce original no se toca");
  assert.ok(FILAS_IMPRESOS.length === 16, "la copia de las filas reales trae los 8 impresos con sus dos paquetes");
  console.log("[PASS] la consulta pide las variantes y se queda con lo que Python vende; las presentaciones se juntan por producto y talla");

  // 9. Las dependencias de costeo de la ruta cargan el cotizador de la lista curada solo al costear.
  const dependencias = readFileSync(path.join(RAIZ, "src", "lib", "guiada-motor", "dependencias-costeo.ts"), "utf8");
  const estaticos = [...dependencias.matchAll(/^import (?!type\b).* from "([^"]+)";$/gm)].map((m) => m[1]!);
  for (const prohibido of ["@/lib/globos3d/motor/v1", "./cotizar-idea", "./cotizar-curada", "./cotizar-idea-python", "@/lib/plan/planes-ideas-guardados", "@/lib/rag/db"]) assert.ok(!estaticos.includes(prohibido), `${prohibido} no se importa de forma estática en dependencias-costeo`);
  assert.match(dependencias, /import\("\.\/cotizar-curada"\)/);
  assert.ok(dependencias.includes("presentacionesDeVariantes(variantIds, { conexion })"), "con el catálogo puesto por la ruta, con plazo");
  assert.ok(dependencias.includes("crosswalkEnVivo({ conexion })"), "el cruce de ahora, con el mismo plazo");
  assert.ok(dependencias.includes("snapshotPublicado({ conexion })"), "el snapshot publicado, con el mismo plazo");
  assert.ok(!readFileSync(path.join(RAIZ, "src", "lib", "guiada-motor", "consulta-del-costeo.ts"), "utf8").includes('from "@/lib/rag/db"'), "el pool del RAG se carga al consultar, no al cargar la ruta");
  console.log("[PASS] el cotizador de la lista curada se carga solo al costear");

  // 10. Un catálogo lento o caído no cuelga el turno (D-038): cada lectura tiene su plazo y el precio sale igual, con lo que no se pudo leer FUERA y dicho.
  const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));
  const poolSinConexion = { connect: () => new Promise<never>(() => undefined) } as unknown as PoolDeLectura;
  const poolSinRespuesta = { connect: async () => ({ query: () => new Promise<never>(() => undefined), release: () => undefined }) } as unknown as PoolDeLectura;
  const conLaBase = (pool: PoolDeLectura): DependenciasCurada => {
    const conexion = consultaDelCosteo(new AbortController().signal, async () => pool, { presupuestoMs: 600, conexionMs: 80, consultaMs: 80 });
    return { ...deps, presentaciones: (ids) => presentacionesDeVariantes(ids, { conexion }), crosswalkEnVivo: () => crosswalkEnVivo({ conexion }), snapshotPublicado: () => snapshotPublicado({ conexion }) };
  };
  for (const [caso, pool] of [["la conexión no llega", poolSinConexion], ["la consulta no responde", poolSinRespuesta]] as const) {
    olvidarCrosswalk();
    const auditadas: unknown[] = [];
    const inicio = performance.now();
    const lenta = await costearDecoracion(bautizo, "personal", depsDeLaTarjeta({ auditar: (_quien, _que, resultado) => { auditadas.push(resultado); } }, conLaBase(pool)));
    const ms = performance.now() - inicio;
    assert.ok(ms < 1_500, `${caso}: el costeo termina dentro de su plazo y no se queda esperando (${Math.round(ms)} ms)`);
    assert.ok(lenta.cotizacion, `${caso}: hay precio, el de lo que sí se pudo cotizar`);
    assert.equal(lenta.cotizacion.total, soloLisos.cotizacion.total, `${caso}: el total es el de los lisos; el impreso no se inventa`);
    assert.deepEqual(lenta.noIncluidos, [{ nombre: "Globo de látex 12\" impreso para bautizo", cantidad: 20 }], `${caso}: lo que no se pudo cotizar sale en la nota de la tarjeta`);
    assert.ok(String(lenta.respuesta.aviso).includes(notaNoIncluidos(lenta.noIncluidos)!), `${caso}: y el modelo lo repite`);
    assert.deepEqual(lenta.decision.usar === "curada" ? lenta.decision.fuera?.map((f) => [f.variantId, f.motivo]) : null, [[IMPRESO_BAUTIZO, "catalogo_no_respondio"]]);
    const filaLenta = filaDeCotizacionDeIdea(lenta.decision, bautizo.id, "00000000-0000-4000-8000-0000000000b1", "/api/asistente-guiado");
    assert.deepEqual(filaLenta.resultado.fuera_del_precio, [{ variant_id: IMPRESO_BAUTIZO, cantidad: 20, motivo: "catalogo_no_respondio" }], `${caso}: la auditoría dice que el catálogo no respondió`);
    assert.deepEqual(auditadas.map((a) => (a as { fuera?: unknown }).fuera), [[{ variantId: IMPRESO_BAUTIZO, cantidad: 20, motivo: "catalogo_no_respondio" }]]);
    // Una lista que SOLO trae lo que el catálogo no respondió no tiene precio, y lo dice sin colgarse.
    olvidarCrosswalk();
    const inicioSolo = performance.now();
    const solo = await costearDecoracion(soloImpresos, "personal", depsDeLaTarjeta({}, conLaBase(pool)));
    assert.ok(performance.now() - inicioSolo < 1_500, `${caso}: tampoco se cuelga sin nada que cotizar`);
    assert.deepEqual([solo.cotizacion, solo.decision.usar, solo.respuesta.motivo], [null, "sin_precio", "cotizacion_no_disponible"], `${caso}: sin nada cotizable no hay precio y se dice`);
  }
  olvidarCrosswalk();
  console.log("[PASS] un catálogo que no responde (sin conexión o sin respuesta) no cuelga el turno: el impreso queda fuera con su motivo, en la nota y en la auditoría");

  // 11. Las lecturas del catálogo: las presentaciones primero, el cruce de ahora solo para lo que ellas no resuelven, y el snapshot una sola vez.
  const llamadas = { vivo: 0, snapshot: 0, presentaciones: 0 };
  const contando = (extra: Partial<DependenciasCurada> = {}): DependenciasCurada => ({
    ...deps,
    crosswalkEnVivo: async () => { llamadas.vivo += 1; return cruce; },
    snapshotPublicado: async () => { llamadas.snapshot += 1; return cruce.snapshot; },
    presentaciones: async (ids) => { llamadas.presentaciones += 1; return presentacionesDeImpresos(ids); },
    ...extra,
  });
  const reiniciar = () => { llamadas.vivo = 0; llamadas.snapshot = 0; llamadas.presentaciones = 0; };
  reiniciar();
  const resueltaPorPresentaciones = await cotizarListaCurada(bautizo.materiales, contando());
  assert.ok(resueltaPorPresentaciones.ok && resueltaPorPresentaciones.fuera.length === 0);
  assert.deepEqual(llamadas, { vivo: 0, snapshot: 1, presentaciones: 1 }, "si las presentaciones resuelven los impresos no se lee el cruce de ahora; el snapshot se lee una vez para las dos cotizaciones");
  reiniciar();
  const sinPedirPresentaciones = await cotizarListaCurada(princesas.materiales, contando());
  assert.ok(sinPedirPresentaciones.ok);
  assert.deepEqual(llamadas, { vivo: 0, snapshot: 1, presentaciones: 0 }, "si el cruce incluido lo conoce todo no se lee nada más que el snapshot");
  reiniciar();
  const conDesconocida = await cotizarListaCurada([...princesas.materiales, { variantId: "variante-que-nadie-conoce", cantidad: 3, nota: "Globo látex R-12 que nadie vende, paquete x50" }], contando());
  assert.ok(conDesconocida.ok);
  assert.deepEqual(llamadas, { vivo: 1, snapshot: 1, presentaciones: 1 }, "una variante que ni el cruce ni las presentaciones conocen sí pide el cruce de ahora, una vez");
  assert.deepEqual(conDesconocida.fuera.map((f) => [f.variantId, f.motivo]), [["variante-que-nadie-conoce", "sin_presentaciones"]]);
  reiniciar();
  const catalogoSinResponder = await cotizarListaCurada([...bautizo.materiales, { variantId: "variante-que-nadie-conoce", cantidad: 3 }], contando({ presentaciones: async () => { llamadas.presentaciones += 1; throw new PlazoDeLecturaError("consulta", "plazo"); } }));
  assert.ok(catalogoSinResponder.ok);
  assert.deepEqual(llamadas, { vivo: 0, snapshot: 1, presentaciones: 1 }, "si el catálogo no respondió no se insiste con otra lectura del mismo catálogo");
  assert.deepEqual(catalogoSinResponder.fuera.map((f) => f.motivo), ["catalogo_no_respondio", "catalogo_no_respondio"]);
  // Las dos lecturas independientes (presentaciones y snapshot publicado) se piden a la vez.
  let presentacionesIniciada = false;
  let snapshotIniciado = false;
  const vio = { snapshotVioPresentaciones: false, presentacionesVioSnapshot: false };
  await cotizarListaCurada(bautizo.materiales, {
    ...deps,
    snapshotPublicado: async () => { snapshotIniciado = true; await esperar(40); vio.snapshotVioPresentaciones = presentacionesIniciada; return cruce.snapshot; },
    presentaciones: async (ids) => { presentacionesIniciada = true; await esperar(40); vio.presentacionesVioSnapshot = snapshotIniciado; return presentacionesDeImpresos(ids); },
  });
  assert.deepEqual(vio, { snapshotVioPresentaciones: true, presentacionesVioSnapshot: true }, "ninguna espera a que termine la otra");
  // El cruce de ahora que falla se recuerda un minuto (no cada «¿cuánto cuesta?» vuelve a esperar su plazo); cerrar el turno no se recuerda como fallo de la base.
  olvidarCrosswalk();
  let lecturas = 0;
  let reloj = 1_000_000;
  const ahora = () => reloj;
  const baseCaida = { query: async () => { lecturas += 1; throw new Error("la base no responde"); } };
  await assert.rejects(crosswalkEnVivo({ conexion: baseCaida, ahora }), /la base no responde/);
  reloj += 59_000;
  await assert.rejects(crosswalkEnVivo({ conexion: baseCaida, ahora }), /la base no responde/);
  assert.equal(lecturas, 1, "a los 59 s el fallo recordado responde sin volver a leer");
  reloj += 2_000;
  await assert.rejects(crosswalkEnVivo({ conexion: baseCaida, ahora }), /la base no responde/);
  assert.equal(lecturas, 2, "a los 61 s se vuelve a intentar");
  olvidarCrosswalk();
  lecturas = 0;
  const turnoCerrado = { query: async () => { lecturas += 1; throw new PlazoDeLecturaError("consulta", "cancelada"); } };
  await assert.rejects(crosswalkEnVivo({ conexion: turnoCerrado, ahora }), PlazoDeLecturaError);
  await assert.rejects(crosswalkEnVivo({ conexion: turnoCerrado, ahora }), PlazoDeLecturaError);
  assert.equal(lecturas, 2, "que un cliente cierre su turno no deja el cruce de ahora sin leer para los demás");
  assert.equal(await snapshotPublicado({ conexion: turnoCerrado, ahora }), null);
  assert.equal(await snapshotPublicado({ conexion: turnoCerrado, ahora }), null);
  assert.equal(lecturas, 4, "ni el snapshot publicado se recuerda como no leído");
  olvidarCrosswalk();
  console.log("[PASS] las presentaciones se leen primero y el cruce de ahora solo si falta algo; el fallo del cruce se recuerda un minuto");

  console.log("\ntest-cotizar-curada: ok");
}

// `AbortSignal.timeout` no mantiene vivo el proceso: sin este latido, una espera que solo depende de un plazo dejaría salir a Node con 0 sin acabar.
const latido = setInterval(() => undefined, 1_000);
let acabo = false;
process.on("exit", (codigo) => { if (!acabo && codigo === 0) { console.error("test-cotizar-curada: el proceso terminó sin acabar la prueba"); process.exitCode = 1; } });
main().then(() => { acabo = true; clearInterval(latido); }, (error: unknown) => { console.error(error); process.exit(1); });
