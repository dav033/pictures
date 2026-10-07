/**
 * Los hallazgos de interfaz del probador 124 (producción, 2026-10-07), sin red, sin modelo y sin coste:
 *   2 / 14  versión nueva con la pestaña abierta, «Reintentar» tras recargar y sin burbuja repetida (version-pagina.ts,
 *           cabecera x-version-app de `conRegistro`), con los registros guardados de la conversación C;
 *   5       la cotización personal nombra el globo del plan («Fashion Blush Crema», no «Pastel Dusk Crema»);
 *   6       el panel de negocio en una columna que no crece y los chips «Sumar:» que bajan de línea;
 *   10      «Último ajuste: añadí Silk Dorado»;
 *   11      una idea que sigue en el plan tras quitar una de sus piezas dice «Está en tu plan» (botón desactivado);
 *   13      porcentajes de la lectura de la foto que suman 100 y un total de globos con la cifra de cada pieza;
 *   15      «Empezar de nuevo» con confirmación dentro de la página y la sesión de la guiada limpia;
 *   18      una fila recién agregada y vacía no pone el precio en gris.
 *
 * Run: npx tsx scripts/test/test-interfaz-probador-124.ts
 */
process.env.REGISTRO_ACTIVO = "1";

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { BriefGuiadoSchema, CotizacionPlanGuiadoSchema, PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";
import { fijarConfiguracionParaPruebas } from "@/lib/registro/configuracion";
import { esperarRegistros } from "@/lib/registro/escritor";
import { conRegistro } from "@/lib/registro/ruta";
import { versionCodigo } from "@/lib/registro/version";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { leerBorrador, borradorVacio, type BorradorProfesional } from "@/lib/cotizacion/borrador-profesional";
import { leyendaDelPrecio, vigenciaDe } from "@/lib/cotizacion/vigencia";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { AVISO_VERSION_NUEVA, CABECERA_VERSION_APP, RespuestaIncompatibleError, camposInvalidos, clasificarIncompatible, hayVersionNueva, idParaReintento, turnoSinRespuesta, versionComparable } from "@/components/guiado/version-pagina";
import { borrarEstadoGuiado, clavesDeLaGuiada } from "@/components/guiado/empezar-de-nuevo";
import { ConfirmarEmpezarDeNuevo } from "@/components/guiado/ConfirmarEmpezarDeNuevo";
import { TarjetaError } from "@/components/guiado/TarjetaError";
import { CotizacionPersonalGuiada } from "@/components/guiado/CotizacionPersonalGuiada";
import { nombreLineaCliente, fraseAjuste } from "@/components/guiado/formato";
import { piezasVistaDePlan, titulosDelPlan } from "@/components/guiado/piezas-vista";
import { TarjetaPlan } from "@/components/guiado/TarjetaPlan";
import { ideasQueSiguenEnPlan } from "@/components/guiado/agregar-idea";
import { CarruselDecoraciones } from "@/components/guiado/CarruselDecoraciones";
import { lecturaFoto, porcentajesQueSuman, totalGlobosLeidos } from "@/components/guiado/lectura-foto";
import { ReferenciaInspiracion } from "@/components/guiado/ReferenciaInspiracion";
import { SeccionGastos } from "@/components/cotizacion/SeccionGastos";
import { FilaGasto } from "@/components/cotizacion/FilaGasto";

const P124 = "C:/Users/davidt/AppData/Local/Temp/claude/C--Users-davidt-Downloads-pictures-workspace/46a78670-2b14-4fff-9d3c-699a35e6bcb9/scratchpad/ritmo/p124";
const sinAccion = () => undefined;
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replace(/\s+/g, " ");
type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
const resultados: string[] = [];
const ok = (nombre: string) => { resultados.push(nombre); console.log(`[PASS] ${nombre}`); };

// ── 2. Versión nueva con la pestaña abierta ──────────────────────────────────────────────────────────────────────────
{
  // Las versiones de la conversación C, de sus registros de producción guardados: la página se abrió con fc0829f y el
  // turno lo respondió ff92855 (el despliegue de las 05:23).
  let versionPagina = "fc0829f2ed3e";
  let versionServidor = "ff92855fab07";
  const archivo = path.join(P124, "C-vercel.jsonl");
  if (existsSync(archivo)) {
    const lineas = readFileSync(archivo, "utf8").split("\n").filter((linea) => linea.startsWith("{")).map((linea) => JSON.parse(linea) as { evento: string; version: string; datos?: { datos?: { texto?: string; error?: { mensaje?: string } } } });
    const abierta = lineas.find((linea) => linea.evento === "cliente.vista.abierta");
    const fallo = lineas.find((linea) => linea.evento === "cliente.sse.fallo");
    assert.ok(abierta && fallo, "los registros guardados de C tienen la apertura y el fallo");
    assert.equal(fallo.datos?.datos?.error?.mensaje, "Los datos devueltos por el asistente no son válidos.", "el fallo de producción es el del esquema");
    versionPagina = abierta.version;
    versionServidor = fallo.version;
  }
  assert.ok(hayVersionNueva(versionPagina, versionServidor), `${versionPagina} → ${versionServidor} es otra versión`);
  assert.ok(!hayVersionNueva(versionServidor, versionServidor));
  assert.ok(!hayVersionNueva("ff92855fab07+local", "0123456789ab+local"), "en local (árbol con cambios) no se compara");
  assert.ok(!hayVersionNueva("desconocida", versionServidor) && !hayVersionNueva(undefined, versionServidor) && !hayVersionNueva(versionPagina, null));
  assert.ok(versionComparable("ff92855fab07") && !versionComparable("") && !versionComparable("abc+local"));

  // El cliente viejo (fc0829f) validaba el brief con su esquema estricto de 3 campos; el servidor nuevo ya mandaba el uso,
  // la medida y la estructura que dijo el decorador. Se reproduce sin red: es justo «Los datos… no son válidos».
  const BriefViejo = z.object({ evento: z.string().min(1).max(120).optional(), edad: z.number().int().min(0).max(120).optional(), tematica: z.string().min(1).max(160).optional() }).strict();
  const ResultadoViejo = z.object({ brief: BriefViejo.optional() }).passthrough();
  const briefNuevo = { evento: "Boda", tematica: "Blanco y dorado", uso: "negocio", medida: { texto: "unos 3 metros", metros: 3 }, estructura: { id: "arco", texto: "arco orgánico", organica: true } };
  assert.ok(BriefGuiadoSchema.safeParse(briefNuevo).success, "el brief nuevo es válido para el contrato nuevo");
  const viejo = ResultadoViejo.safeParse({ brief: briefNuevo });
  assert.ok(!viejo.success, "el esquema viejo lo rechaza");
  const campos = camposInvalidos(viejo.error);
  assert.ok(campos.some((campo) => campo.startsWith("brief") && campo.includes("estructura")), `los campos dicen qué cambió: ${campos.join(" | ")}`);
  const contrato = new RespuestaIncompatibleError("contrato", "Los datos devueltos por el asistente no son válidos.", versionServidor, { campos });
  assert.equal(clasificarIncompatible(contrato, versionPagina), "version-nueva", "otro despliegue: pedir recargar");
  assert.equal(clasificarIncompatible(contrato, versionServidor), "contrato", "misma versión: recargar no lo arregla, «Reintentar»");
  assert.equal(clasificarIncompatible(contrato, "fc0829f2ed3e+local"), "version-nueva", "sin versiones comparables, recargar trae el código del servidor");
  assert.equal(clasificarIncompatible(new RespuestaIncompatibleError("version", "otra versión", versionServidor), versionServidor), "version-nueva");
  assert.equal(AVISO_VERSION_NUEVA.titulo, "Hay una versión nueva de la página");
  assert.equal(AVISO_VERSION_NUEVA.detalle, "Recarga para seguir; tu conversación se conserva.");
  assert.equal(AVISO_VERSION_NUEVA.etiqueta, "Recargar");

  // La tarjeta: «Recargar», en el color de acento y sin la nube tachada del error de red.
  const tarjeta = renderToStaticMarkup(createElement(TarjetaError, { titulo: AVISO_VERSION_NUEVA.titulo, detalle: AVISO_VERSION_NUEVA.detalle, reintentarEtiqueta: AVISO_VERSION_NUEVA.etiqueta, variante: "actualizar", onReintentar: sinAccion, onCerrar: sinAccion }));
  assert.ok(texto(tarjeta).includes("Hay una versión nueva de la página") && texto(tarjeta).includes("Recarga para seguir; tu conversación se conserva.") && texto(tarjeta).includes("Recargar"));
  assert.match(tarjeta, /data-variante="actualizar"/);
  assert.ok(!tarjeta.includes("bg-error-suave"), "no se pinta como un error");
  ok("2: una respuesta de otro despliegue (cabecera o esquema) pide «Recargar»; con la misma versión, «Reintentar»");
}

// ── 2. El servidor dice con qué código respondió ─────────────────────────────────────────────────────────────────────
async function pruebaCabecera(): Promise<void> {
  const raiz = mkdtempSync(path.join(tmpdir(), "probador-124-"));
  fijarConfiguracionParaPruebas({ activo: true, raiz, raizAlterna: path.join(raiz, "alterna"), archivosActivos: false, nivelStdout: "error", auditoriaEnStdout: false });
  const ruta = conRegistro("/api/prueba-version", async () => Response.json({ ok: true }));
  const respuesta = await ruta(new Request("http://localhost/api/prueba-version", { method: "POST", headers: { "content-type": "application/json", "x-conversacion-id": "guiada-prueba-124" }, body: "{}" }));
  assert.equal(respuesta.headers.get(CABECERA_VERSION_APP), versionCodigo().corta, "toda respuesta de conRegistro lleva x-version-app");
  // La auditoría de la salida se escribe después (lee una copia del cuerpo): se espera antes de soltar la configuración de
  // prueba, para que nada caiga en data/registros.
  await respuesta.text();
  await new Promise((resolver) => setTimeout(resolver, 100));
  await esperarRegistros();
  fijarConfiguracionParaPruebas(undefined);
  rmSync(raiz, { recursive: true, force: true });
  ok(`2: conRegistro añade ${CABECERA_VERSION_APP}: ${versionCodigo().corta}`);
}

// ── 2 / 14. Tras recargar, el mensaje sin respuesta tiene «Reintentar»; reintentar no repite la burbuja ─────────────────
{
  const pedido = "Propónme una pieza individual: Arco orgánico.";
  const conversacion = [
    { id: "u0", role: "user" as const, content: "Soy decorador, un cliente me pide un arco orgánico de unos 3 metros en blanco y dorado para una boda y necesito cotizarle" },
    { id: "a0", role: "assistant" as const, content: "¿Qué pieza individual prefieres?" },
    { id: "u1", role: "user" as const, content: pedido, envio: { alcance: "individual" as const, pieza: "arco_asimetrico" as const } },
  ];
  const pendiente = turnoSinRespuesta(conversacion);
  assert.equal(pendiente?.id, "u1", "la conversación restaurada termina en el mensaje sin respuesta");
  assert.deepEqual(pendiente?.envio, { alcance: "individual", pieza: "arco_asimetrico" }, "y conserva lo que viajó con él (alcance y pieza)");
  assert.equal(turnoSinRespuesta([...conversacion, { id: "a1", role: "assistant" as const, content: "Listo" }]), null);

  // «Reintentar»: el mismo id (React conserva la burbuja) y una sola burbuja con ese texto.
  const id = idParaReintento(conversacion, pedido);
  assert.equal(id, "u1");
  const despues = [...sinUltimoTurnoGuiado(conversacion), { id: id ?? "nuevo", role: "user" as const, content: pedido }, { id: "a2", role: "assistant" as const, content: "" }];
  assert.equal(despues.filter((mensaje) => mensaje.role === "user" && mensaje.content === pedido).length, 1, "la burbuja del cliente no se repite");
  assert.equal(new Set(despues.map((mensaje) => mensaje.id)).size, despues.length);
  // Si se detuvo con texto a medias, se reintenta igual sobre el mismo mensaje del cliente.
  assert.equal(idParaReintento([...conversacion, { id: "a1", role: "assistant" as const, content: "Te propongo…" }], pedido), "u1");
  assert.equal(idParaReintento(conversacion, "otro texto"), null, "otro texto es otro mensaje");
  ok("2/14: el turno pendiente vuelve con su envío y «Reintentar» conserva la misma burbuja");
}

// ── 5. La cotización personal nombra el globo del plan ──────────────────────────────────────────────────────────────
{
  const datos = JSON.parse(readFileSync("data/biblioteca-real/analisis/real-09-images-24.plan.json", "utf8")) as { plan_resuelto: Record<string, unknown>; quote: unknown };
  const plan = PlanGuiadoSchema.parse({ ...datos.plan_resuelto, approval_token: "prueba" });
  const cruda = CotizacionPlanGuiadoSchema.parse(datos.quote);
  // Como `colocarPlan`: la línea de la cotización llega con el nombre de cliente («Globo blush crema de 12"»).
  const cotizacion = { ...cruda, lineas: cruda.lineas.map((linea) => ({ ...linea, nombre: nombreLineaCliente(linea) })) } as unknown as Cotizacion;
  const antes = texto(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion })));
  assert.ok(antes.includes("Pastel Dusk Crema"), "sin los títulos del plan, el nombre salía de otro globo (el fallo del probador)");
  const titulos = titulosDelPlan(plan);
  const ahora = texto(renderToStaticMarkup(createElement(CotizacionPersonalGuiada, { cotizacion, titulos })));
  assert.ok(ahora.includes("Sempertex Fashion Blush Crema de 5\"") && ahora.includes("Sempertex Fashion Blush Crema de 12\""), `nombra el globo del plan: ${ahora.slice(0, 400)}`);
  assert.ok(!ahora.includes("Pastel Dusk"), "ningún globo de otro producto");
  // El mismo producto que la tarjeta y «Ver detalle».
  const productosTarjeta = new Set(piezasVistaDePlan(plan).flatMap((pieza) => pieza.lineas.map((linea) => linea.producto)).filter((producto): producto is string => producto !== null));
  assert.ok(productosTarjeta.has("Fashion Blush Crema"));
  for (const producto of productosTarjeta) assert.ok(ahora.includes(`Sempertex ${producto}`), `«${producto}» de la tarjeta está en la cotización`);
  ok("5: la cotización personal dice «Sempertex Fashion Blush Crema» como la tarjeta y «Ver detalle»");
}

// ── 6 / 18. Panel de negocio: una columna que no crece, chips que bajan de línea, fila nueva sin alarma ──────────────
{
  const fuente = readFileSync("src/components/cotizacion/CotizacionProfesional.tsx", "utf8");
  assert.match(fuente, /className="grid grid-cols-\[minmax\(0,1fr\)\] gap-6[^"]*@3xl:grid-cols-\[minmax\(0,1fr\)_17rem\]"/, "la rejilla tiene plantilla también bajo @3xl");
  assert.match(fuente, /<aside className="min-w-0 /);
  const filas = [{ id: "f1", descripcion: "Mi trabajo", costo: "50000", cantidad: "1" }];
  const seccion = renderToStaticMarkup(createElement(SeccionGastos, {
    seccion: "mano_de_obra", clave: "k", filas, errores: {}, atenuar: false, subtotal: () => 50_000, total: 50_000, quitada: null, foco: null,
    onFocoListo: sinAccion, onCambiar: sinAccion, onAgregar: sinAccion, onQuitar: sinAccion, onDeshacer: sinAccion,
  }));
  const sumar = /<div role="group" aria-label="Sumar otro a [^"]*" class="([^"]*)"/.exec(seccion);
  assert.ok(sumar, "hay fila «Sumar:»");
  assert.ok(sumar[1]!.includes("flex-wrap") && !sumar[1]!.includes("overflow-x-auto"), `los chips bajan de línea: ${sumar[1]}`);

  // 18: «+ Montaje» deja una fila con qué es y 1 unidad, sin valor.
  const montaje = { id: "f2", descripcion: "Montaje", costo: "", cantidad: "1" };
  const borrador: BorradorProfesional = { ...borradorVacio(), costos: { mano_de_obra: [...filas, montaje], equipos_transporte: [], indirectos: [] } };
  const material = { variant_id: "v1", descripcion: "Globo", paquetes: 1, precio_paquete_catalogo_cop: 10_000 };
  const sinTocar = leerBorrador(borrador, [material], { enCurso: new Set(["f2"]) });
  assert.ok(sinTocar.entrada, "la fila recién agregada y vacía no frena el precio");
  assert.deepEqual(sinTocar.enviadas.mano_de_obra, ["f1"], "y no se envía hasta tener valor");
  assert.ok(sinTocar.erroresFila.f2?.costo, "la lista sigue sabiendo qué le falta («Completa los datos para sumarlo»)");
  const leyendaNueva = leyendaDelPrecio({ vigencia: vigenciaDe({ estado: "listo", hayResultado: true, hayErroresEscritos: sinTocar.entrada === null }), mensajeError: null, ganancia: null });
  assert.ok(!leyendaNueva.texto.includes("no se actualizó"), `el precio no se pone en gris: ${leyendaNueva.texto}`);
  const aMedias = leerBorrador(borrador, [material]);
  assert.equal(aMedias.entrada, null, "al dejarla a medias (ya no en curso) sí cuenta");
  const leyendaMedias = leyendaDelPrecio({ vigencia: vigenciaDe({ estado: "listo", hayResultado: true, hayErroresEscritos: aMedias.entrada === null }), mensajeError: null, ganancia: null });
  assert.equal(leyendaMedias.texto, "Este precio es el anterior y no se actualizó: revisa lo que está en rojo.");
  const malEscrita = leerBorrador({ ...borrador, costos: { ...borrador.costos, mano_de_obra: [...filas, { ...montaje, costo: "abc" }] } }, [material], { enCurso: new Set(["f2"]) });
  assert.equal(malEscrita.entrada, null, "algo mal escrito frena aunque la fila sea nueva");
  // La fila nueva sugiere en gris lo que falta; al salir de ella, en rojo.
  const fila = (tocada: boolean) => renderToStaticMarkup(createElement("ul", null, createElement(FilaGasto, {
    seccion: "mano_de_obra", base: "mano_de_obra-k-f2", titulo: "Tu trabajo", fila: montaje, errores: sinTocar.erroresFila.f2 ?? {}, tocada,
    subtotal: null, atenuar: false, onCambiar: sinAccion, onConcepto: sinAccion, onPaso: sinAccion, onQuitar: sinAccion, onSalir: sinAccion,
  })));
  assert.match(fila(false), /<span class="block text-xs text-texto-suave font-medium">Falta el valor<\/span>/, "recién agregada: sin rojo");
  assert.match(fila(true), /<span class="block text-xs text-error font-semibold">Falta el valor<\/span>/, "dejada a medias: en rojo");
  assert.ok(!fila(false).includes("border-error") && fila(true).includes("border-error"), "la casilla se marca al salir de la fila, no antes");
  ok("6/18: rejilla con plantilla, chips con salto de línea y una fila nueva y vacía que no alarma hasta dejarla a medias");
}

// ── 10. «Último ajuste: añadí Silk Dorado» ──────────────────────────────────────────────────────────────────────────
{
  assert.equal(fraseAjuste("con Silk Dorado"), "añadí Silk Dorado");
  assert.equal(fraseAjuste("con Silk Dorado en la columna izquierda"), "añadí Silk Dorado en la columna izquierda");
  assert.equal(fraseAjuste("sin la columna derecha"), "quité la columna derecha");
  assert.equal(fraseAjuste("Reflex Plata en lugar de dorado"), "Reflex Plata en lugar de dorado");
  const plan = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
  const tarjeta = texto(renderToStaticMarkup(createElement(TarjetaPlan, {
    plan, estadoImagen: "nada", usoCosteo: null, compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {},
    onAccion: sinAccion, onCosteo: sinAccion, onProveedores: sinAccion, onDistribuidor: sinAccion, onPlanAjustado: sinAccion, ajustes: ["con Silk Dorado"],
  })));
  assert.ok(tarjeta.includes("Último ajuste: añadí Silk Dorado"), "frase completa en la tarjeta");
  assert.ok(!tarjeta.includes("Último ajuste: con "));
  ok("10: «Último ajuste: añadí Silk Dorado»");
}

// ── 11. La idea que sigue en el plan dice «Está en tu plan» ──────────────────────────────────────────────────────────
{
  const ideas = bibliotecaVisible();
  const columnas = ideas.find((idea) => idea.id === "deco-real-07-eb12910e210c94b6184d025127acce95")!;
  const guirnalda = ideas.find((idea) => idea.id === "deco-real-09-images-24")!;
  assert.ok(columnas && guirnalda);
  const planDe = (archivo: string): PlanGuiado => PlanGuiadoSchema.parse({ ...(JSON.parse(readFileSync(archivo, "utf8")) as { plan_resuelto: Record<string, unknown> }).plan_resuelto, approval_token: "prueba" });
  const dosColumnas = planDe("data/biblioteca-real/analisis/real-07-eb12910e210c94b6184d025127acce95.plan.json");
  assert.equal(dosColumnas.plan.estructuras.length, 2);
  const unaColumna: PlanGuiado = { ...dosColumnas, plan: { ...dosColumnas.plan, estructuras: dosColumnas.plan.estructuras.slice(0, 1) } };
  const buscar = (id: string) => ideas.find((idea) => idea.id === id) ?? null;
  // A: quitar la columna derecha (87 → 39 globos) ya no borra la idea del plan.
  assert.deepEqual(ideasQueSiguenEnPlan([columnas.id], dosColumnas, unaColumna, buscar), [columnas.id]);
  // Si se quitan TODAS sus piezas, sale (y se puede volver a agregar).
  const soloGuirnalda = planDe("data/biblioteca-real/analisis/real-09-images-24.plan.json");
  const dosMasGuirnalda: PlanGuiado = { ...dosColumnas, plan: { ...dosColumnas.plan, estructuras: [...dosColumnas.plan.estructuras, ...soloGuirnalda.plan.estructuras] } };
  assert.deepEqual(ideasQueSiguenEnPlan([columnas.id, guirnalda.id], dosMasGuirnalda, soloGuirnalda, buscar), [guirnalda.id]);
  assert.deepEqual(ideasQueSiguenEnPlan([columnas.id], dosColumnas, dosColumnas, buscar), [columnas.id], "sin piezas quitadas, todas siguen");
  assert.deepEqual(ideasQueSiguenEnPlan(["deco-que-no-esta"], dosColumnas, unaColumna, () => null), [], "una idea que no se puede comprobar sale");

  const html = renderToStaticMarkup(createElement(CarruselDecoraciones, {
    decoraciones: [columnas, guirnalda], activo: true, elegidaId: null, onElegir: sinAccion, onNinguna: sinAccion,
    estadosAgregar: { [columnas.id]: "agregada", [guirnalda.id]: "listo" }, agregarDeshabilitado: false, onAgregar: sinAccion,
  }));
  assert.match(html, /<button type="button" disabled="" aria-disabled="true"[^>]*>.*?Está en tu plan<\/button>/, "botón desactivado «Está en tu plan»");
  assert.equal((texto(html).match(/Agregar a mi plan/g) ?? []).length, 1, "solo la guirnalda ofrece agregarse");
  ok("11: quitar una de las dos columnas no olvida la idea; el carrusel dice «Está en tu plan» y no la duplica");
}

// ── 13. Lectura de la foto: porcentajes que suman 100 y total con la cifra de cada pieza ─────────────────────────────
{
  const suma = (valores: Array<number | null>) => valores.reduce<number>((total, valor) => total + (valor ?? 0), 0);
  // Columna izquierda de B: 57 + 32 + 27 + 10 = 126 % y un transparente sin medir.
  const izquierda = porcentajesQueSuman([0.57, 0.32, 0.27, 0.1, null]);
  assert.equal(suma(izquierda), 100, `izquierda: ${izquierda.join(" + ")}`);
  assert.deepEqual(izquierda, [45, 25, 22, 8, null]);
  // Columna derecha de B: 65 + 15 + 3 = 83 % y «Transparente» sin cifra: el transparente es el resto.
  const derecha = porcentajesQueSuman([0.65, 0.15, 0.03, null]);
  assert.deepEqual(derecha, [65, 15, 3, 17]);
  assert.equal(suma(porcentajesQueSuman([0.333, 0.333, 0.334])), 100);
  assert.deepEqual(porcentajesQueSuman([0.5, null, null]), [100, null, null], "con varios sin medir no se inventa un reparto");
  assert.deepEqual(porcentajesQueSuman([0.995, 0.004]), [99, 1], "ningún color medido baja de 1 %");
  assert.deepEqual(porcentajesQueSuman([null, null]), [null, null]);
  // «≈ 90 globos a la vista» con piezas de ≈ 75 y ≈ 85: el total suma lo que dice cada pieza.
  assert.equal(totalGlobosLeidos([{ valor: 75, clase: "estimado" }, { valor: 85, clase: "estimado" }]), "≈ 160 globos en total");
  assert.equal(totalGlobosLeidos([{ valor: 45, clase: "visibles" }, null]), "≈ 45 globos a la vista");
  assert.equal(totalGlobosLeidos([{ valor: 30, clase: "exacto" }, { valor: 12, clase: "exacto" }]), "42 globos");
  assert.equal(totalGlobosLeidos([null]), null);

  // La lectura entera, con dos columnas contadas por estimación (como B) y colores medidos con bases distintas.
  const elemento = (id: string, x: number, ubicacion: string, apariencia: Record<string, unknown>) => ({
    element_id: id, source_image_id: "REF_01", name: `${id} organic column`, category: "balloon_structure", scene_role: "midground",
    detection_confidence: 0.95, visible_evidence: "columna de globos", reference_bbox: { x, y: 0.05, width: 0.3, height: 0.8 },
    depth_layer: 2, include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 }, quantity_semantics: "physical_instances",
    visual_semantics: { structure_type: "columna", placement: ubicacion, design_role: "focal", repetition_group: id, density: "lujosa" },
    appearance: { observed_colors: ["chrome silver", "pearl white", "soft pink", "clear"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "tall dense organic column", composition: "mixta", ...apariencia },
    relationships: [], uncertainties: [],
  });
  const conteo = (visibles: number, estimado: number) => ({ globos_visibles: visibles, exacto: false, estimado_total: estimado, racimos: null, globos_por_racimo: null, por_tamano: [{ clase: "chico", proporcion: 0.333 }, { clase: "mediano", proporcion: 0.333 }, { clase: "grande", proporcion: 0.333 }], largo_relativo: null, alto_relativo: null, confianza: 0.85 });
  const referencia = adaptarAnalisisReferencia({
    blueprint: {
      schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"], aspect_ratio: 1.5 }],
      elements: [
        elemento("E01", 0.05, "lateral_izquierdo", { measured_colors: [{ color: "plateado", share: 0.57 }, { color: "blanco", share: 0.27 }, { color: "rosado", share: 0.32 }], conteo: conteo(45, 75) }),
        elemento("E02", 0.6, "lateral_derecho", { measured_colors: [{ color: "plateado", share: 0.65 }, { color: "rosado", share: 0.15 }, { color: "blanco", share: 0.03 }], conteo: conteo(45, 85) }),
      ],
      composition: { focal_point: "globos", density: "dense", symmetry: "symmetric", negative_space: [] },
      palette: { observed: ["chrome silver"], priority: ["chrome silver"] }, unresolved_decisions: [],
    },
  });
  assert.ok(referencia);
  const lectura = lecturaFoto(referencia.blueprint);
  assert.ok(lectura);
  for (const pieza of lectura.piezas) {
    assert.equal(suma(pieza.colores.map((color) => color.porcentaje)), 100, `${pieza.nombre}: ${pieza.colores.map((color) => `${color.nombre} ${color.porcentaje}`).join(", ")}`);
    assert.equal(pieza.tamanos.reduce((total, tamano) => total + tamano.porcentaje, 0), 100, `${pieza.nombre}: tamaños que suman 100`);
  }
  assert.equal(lectura.globosTotal, "≈ 160 globos en total");
  assert.ok(lectura.piezas[0]!.colores.some((color) => color.parte === 0.57), "la lectura guardada no cambia: solo lo que se muestra");
  const html = texto(renderToStaticMarkup(createElement(ReferenciaInspiracion, { miniatura: "data:image/jpeg;base64,AAAA", referencia, onArmar: sinAccion })));
  assert.ok(html.includes("≈ 160 globos en total") && !html.includes("≈ 90 globos"), "la cabecera usa la cifra de cada pieza");
  // Izquierda: 57/32/27 (116 %) → 49/28/23; derecha: 65/15/3 y el transparente es el 17 % que falta.
  assert.ok(html.includes("49%") && html.includes("17%") && !html.includes("57%"), "los porcentajes que se ven ya están repartidos");
  ok("13: colores y tamaños de cada pieza suman 100 al mostrarse; el total dice ≈ 160 (75 + 85), no ≈ 90");
}

// ── 15. «Empezar de nuevo»: confirmación en la página y sesión limpia ───────────────────────────────────────────────
{
  const claves = ["demo_guiado_v2", "cotizacion-profesional:plan-9ac671", "cotizacion-profesional:guiado-deco-real-09-images-24", "cotizacion-granel:plan-9ac671", "cotizacion-profesional:6f1c2d3e-0000-4000-8000-000000000000", "registro:sesion", "registro:conversacion:guiada"];
  assert.deepEqual(clavesDeLaGuiada(claves), ["cotizacion-profesional:plan-9ac671", "cotizacion-profesional:guiado-deco-real-09-images-24", "cotizacion-granel:plan-9ac671"]);
  const datos = new Map(claves.map((clave) => [clave, "x"]));
  const almacen = { get length() { return datos.size; }, key: (indice: number) => [...datos.keys()][indice] ?? null, removeItem: (clave: string) => { datos.delete(clave); } };
  assert.equal(borrarEstadoGuiado(almacen), 3);
  assert.ok(datos.has("cotizacion-profesional:6f1c2d3e-0000-4000-8000-000000000000") && datos.has("registro:sesion"), "lo de la clásica y del registro no se toca (la conversación la cambia vaciarConversacionGuiada)");

  const abierta = renderToStaticMarkup(createElement(ConfirmarEmpezarDeNuevo, { abierto: true, conPlan: true, onConfirmar: sinAccion, onCancelar: sinAccion }));
  assert.match(abierta, /role="alertdialog"/);
  assert.match(abierta, /aria-modal="true"/);
  for (const visible of ["¿Empezar de nuevo?", "Se borran esta conversación y tu plan, y vuelves al inicio. No se puede deshacer.", "Seguir con esta", "Sí, empezar de nuevo"]) assert.ok(texto(abierta).includes(visible), `Falta «${visible}»`);
  assert.equal(renderToStaticMarkup(createElement(ConfirmarEmpezarDeNuevo, { abierto: false, conPlan: false, onConfirmar: sinAccion, onCancelar: sinAccion })), "");
  const vista = readFileSync("src/components/guiado/VistaGuiada.tsx", "utf8");
  assert.match(vista, /onLimpiar=\{pedirEmpezarDeNuevo\}[^>]*etiquetaLimpiar="Empezar de nuevo"/, "el menú «Más opciones» lo ofrece");
  assert.match(vista, /function confirmarEmpezarDeNuevo\(\): void \{\s*registrarAccion\("conversacion\.empezar_de_nuevo"[^]*?vaciar\(\);/, "confirmar registra y reutiliza `vaciar`");
  for (const archivo of ["src/components/guiado/VistaGuiada.tsx", "src/components/guiado/ConfirmarEmpezarDeNuevo.tsx"]) assert.ok(!/window\.confirm|\bconfirm\(/.test(readFileSync(archivo, "utf8")), `${archivo}: sin diálogo del navegador`);
  const cabecera = readFileSync("src/components/ui/shell/CabeceraApp.tsx", "utf8");
  assert.match(cabecera, /etiqueta: etiquetaLimpiar/);
  ok("15: «Empezar de nuevo» confirma dentro de la página, registra y deja la sesión de la guiada limpia");
}

pruebaCabecera().then(
  () => console.log(`\ntest-interfaz-probador-124: ${resultados.length} bloques bien.`),
  (error: unknown) => { console.error(error); process.exitCode = 1; },
);
