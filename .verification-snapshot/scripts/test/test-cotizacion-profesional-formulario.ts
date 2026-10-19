/**
 * Offline checks for the «Precio al cliente» FORM (docs/formulario-precio-al-cliente.md):
 * what the screen shows as current or stale, what each cell says when it is
 * wrong, what an emptied material price means, the row limit, the draft that
 * must not open the panel by itself, and the wording. Python owns every total
 * (`test-cotizacion-profesional.ts` covers the request/response); nothing here
 * adds, multiplies or recomputes money. No network, no browser.
 *
 * Run: npx tsx scripts/test/test-cotizacion-profesional-formulario.ts (no react-server condition: it renders React to static markup)
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CotizacionProfesionalResultado } from "../../src/lib/cotizacion/profesional";

const COP_CATALOGO = 16900;
const MATERIAL = { variant_id: "v1", descripcion: "B2b Globo Latex Redondo Fashion Blanco — R-5 / PAQUETE X 12", paquetes: 1, precio_paquete_catalogo_cop: COP_CATALOGO };

async function probarVigencia(): Promise<void> {
  const v = await import("../../src/lib/cotizacion/vigencia");

  // R1: tras un error o con un campo ilegible, el resultado anterior NO es vigente.
  assert.deepEqual(v.vigenciaDe({ estado: "listo", hayResultado: true, hayErroresEscritos: false }), { tipo: "vigente" });
  assert.deepEqual(v.vigenciaDe({ estado: "error", hayResultado: true, hayErroresEscritos: false }), { tipo: "no-vigente", motivo: "error-de-calculo" });
  assert.deepEqual(v.vigenciaDe({ estado: "listo", hayResultado: true, hayErroresEscritos: true }), { tipo: "no-vigente", motivo: "campo-ilegible" }, "un campo ilegible invalida lo que se ve aunque el último cálculo saliera bien");
  assert.deepEqual(v.vigenciaDe({ estado: "error", hayResultado: true, hayErroresEscritos: true }), { tipo: "no-vigente", motivo: "campo-ilegible" }, "lo escrito manda sobre el error");
  assert.deepEqual(v.vigenciaDe({ estado: "calculando", hayResultado: true, hayErroresEscritos: false }), { tipo: "recalculando" });
  assert.deepEqual(v.vigenciaDe({ estado: "error", hayResultado: false, hayErroresEscritos: false }), { tipo: "sin-resultado", motivo: "error-de-calculo" });
  assert.deepEqual(v.vigenciaDe({ estado: "vacio", hayResultado: false, hayErroresEscritos: false }), { tipo: "sin-resultado", motivo: null });
  assert.equal(v.esNoVigente(v.vigenciaDe({ estado: "error", hayResultado: true, hayErroresEscritos: false })), true);
  assert.equal(v.esNoVigente(v.vigenciaDe({ estado: "calculando", hayResultado: true, hayErroresEscritos: false })), false, "mientras calcula se dice «Calculando…», no se atenúa en cada tecla");

  const ganancia = { cop: 27270, margenPorcentaje: 23.08 };
  const noVigente = (motivo: "campo-ilegible" | "error-de-calculo") => ({ tipo: "no-vigente", motivo }) as const;
  const ilegible = v.leyendaDelPrecio({ vigencia: noVigente("campo-ilegible"), mensajeError: null, ganancia });
  assert.match(ilegible.texto, /anterior y no se actualiz/);
  assert.match(ilegible.texto, /rojo/, "dice qué hacer");
  assert.equal(ilegible.reintentar, false, "un campo mal escrito se corrige, no se reintenta");
  const fallo = v.leyendaDelPrecio({ vigencia: noVigente("error-de-calculo"), mensajeError: "No pude calcular tu precio. Intenta de nuevo en un momento.", ganancia });
  assert.match(fallo.texto, /No pude calcular tu precio\. Intenta de nuevo en un momento\. Este precio es el anterior y no se actualiz/);
  assert.equal(fallo.reintentar, true, "un fallo del cálculo se reintenta");
  assert.equal(fallo.tono, "error");
  assert.equal(v.leyendaDelPrecio({ vigencia: { tipo: "recalculando" }, mensajeError: null, ganancia }).texto, "Calculando…");
  assert.match(v.leyendaDelPrecio({ vigencia: { tipo: "vigente" }, mensajeError: null, ganancia }).texto, /Incluye tu ganancia: el 23,08 % del precio es tuyo/);
  assert.equal(v.leyendaDelPrecio({ vigencia: { tipo: "vigente" }, mensajeError: null, ganancia: { cop: 0, margenPorcentaje: null } }).texto, "Todavía no incluye tu ganancia.");
  assert.match(v.subtituloDelPrecio(true), /con IVA/);
  assert.match(v.subtituloDelPrecio(false), /sin IVA/);

  // R2: una lista que no estuvo en el cálculo no vale $ 0: no tiene total.
  assert.equal(v.totalDeLista(0, 0), null, "lista ausente del cálculo: «—», no $ 0");
  assert.equal(v.totalDeLista(0, 1), 0, "una fila completa que de verdad suma 0 sí es un 0 de Python");
  assert.equal(v.totalDeLista(100000, 2), 100000);
  assert.equal(v.totalDeLista(undefined, 3), null);
  console.log("[PASS] R1+R2 vigencia: el resultado anterior se marca no vigente tras error o campo ilegible; una lista ausente no es $ 0");
}

async function probarLectura(): Promise<void> {
  const l = await import("../../src/lib/cotizacion/lectura-numeros");
  const b = await import("../../src/lib/cotizacion/borrador-profesional");

  // R4: cada caso real del documento dice qué pasa y qué escribir.
  const VACIO = "Escribe cuánto cuesta.";
  assert.match(l.errorDePesos("12,5", VACIO) ?? "", /no lleva decimales: escribe 13, no 12,5/);
  assert.match(l.errorDePesos("12,5", VACIO) ?? "", /punto separa los miles/);
  assert.match(l.errorDePesos("40,000", VACIO) ?? "", /Para los miles usa punto: 40\.000/);
  assert.equal(l.errorDePesos("12.500", VACIO), null, "el punto es de miles y se lee");
  assert.equal(l.errorDePesos("$ 40.000", VACIO), null);
  assert.equal(l.errorDePesos("", VACIO), VACIO);
  assert.match(l.errorDePesos("9999999999999999", VACIO) ?? "", /máximo es \$ 1\.000\.000\.000\.000/);
  assert.match(l.errorDePesos("-3", VACIO) ?? "", /negativo/);
  assert.match(l.errorDePesos("doce", VACIO) ?? "", /solo cifras/);
  assert.match(l.errorDeCantidad("") ?? "", /cuántas unidades/);
  assert.equal(l.errorDeCantidad("1.25"), null, "en cantidad el punto es decimal");
  assert.match(l.errorDeCantidad("12.500") ?? "", /separa decimales, no miles: para 12\.500 escribe 12500/);
  assert.match(l.errorDeCantidad("1,234") ?? "", /hasta 2 decimales/i);
  assert.match(l.errorDeCantidad("0") ?? "", /mayor que 0/);
  assert.match(l.errorDeCantidad("100001") ?? "", /máximo es 100\.000/);
  assert.match(l.errorDeGanancia("1500") ?? "", /No puede pasar de 1\.000 %/);
  assert.match(l.errorDeGanancia("12,345") ?? "", /hasta 2 decimales/i);
  assert.equal(l.errorDeGanancia(""), null, "en blanco es «sin ganancia»");
  assert.equal(l.errorDeGanancia("30"), null);
  assert.match(l.errorDeGanancia("abc") ?? "", /porcentaje/);
  // Cada mensaje explica en lenguaje de persona: sin códigos ni jerga.
  for (const texto of [l.errorDePesos("12,5", VACIO), l.errorDeCantidad("0"), l.errorDeGanancia("1500")]) assert.doesNotMatch(texto ?? "", /null|undefined|COP\b|NaN|error/i);

  // Lo que se escribe en el campo de pesos: la coma decimal ya no se traga en silencio (12,5 -> 125 era 10 veces más).
  const teclear = (inicial: string, teclas: string): string => {
    let valor = inicial;
    for (const tecla of teclas) valor = l.escrituraPesos(valor + tecla, false);
    return valor;
  };
  assert.equal(teclear("", "12,5"), "12,5", "los decimales se dejan a la vista, no se convierten en 125");
  assert.equal(l.leerPesos(teclear("", "12,5")), null, "y no se leen como pesos");
  assert.equal(teclear("", "12,"), "12,", "la coma sola tampoco se pierde");
  assert.equal(teclear("", "40,000"), "40.000", "la coma de miles de otro país se formatea como siempre");
  assert.equal(l.leerPesos(teclear("", "40,000")), 40000);
  assert.equal(teclear("", "12.500"), "12.500");
  assert.equal(teclear("", "1500000"), "1.500.000");
  assert.equal(l.escrituraPesos("1.00", true), "100", "borrar un dígito de 1.000 reformatea, no acusa decimales");
  assert.equal(l.escrituraPesos("12,5", true), "125", "al borrar sí se reformatea (quien borra no está escribiendo decimales)");
  assert.equal(l.escrituraPesos("$ 12.000", false), "12.000", "un valor pegado con $ se limpia");
  assert.equal(l.escrituraPesos("", false), "");

  // Decisión 7: «= $ 125» refleja lo que leyó `leerPesos` y solo habla cuando sirve.
  assert.match(l.ecoDePesos("12.5", "125") ?? "", /^= \$\s125$/, "12.5 con punto queda 125 y ahora se dice");
  assert.equal(l.ecoDePesos("1000", "1.000"), null, "los miles se separan solos: sin puntos escritos, nada que aclarar");
  assert.equal(l.ecoDePesos("$ 40.000", "40.000"), null, "un valor pegado con $ ya se ve igual: nada");
  assert.match(l.ecoDePesos("40,000", "40.000") ?? "", /^= \$\s40\.000$/);
  assert.equal(l.ecoDePesos("13", "13"), null, "si ya se ve igual, nada");
  assert.match(l.ecoDePesos("12.50", "1.250") ?? "", /^= \$\s1\.250$/, "12.50 con punto se lee 1.250: se dice");
  assert.equal(l.ecoDePesos("12.", "12") === null, false, "a mitad de escribir «12.» dice «= $ 12» (el campo lo espera con debounce)");
  assert.equal(l.ecoDePesos("12.500", "12.500"), null, "12.500 escrito completo, nada");
  assert.equal(l.ecoDePesos("12,5", "12,5"), null, "lo ilegible lo explica el error, no el eco");
  assert.equal(l.ecoDePesos("", ""), null);
  for (const [crudo, formateado] of [["12.5", "125"], ["1000", "1.000"]] as const) assert.equal(l.leerPesos(formateado), l.leerPesos(crudo.replace(/\./g, "")) ?? l.leerPesos(formateado), "el eco no cambia la lectura");
  // Decisión 3: fichas de ganancia (atajo, no valor por defecto).
  assert.deepEqual([...l.FICHAS_GANANCIA], [20, 30, 40]);
  assert.equal(l.fichaActiva("30"), 30);
  assert.equal(l.fichaActiva("30,00"), 30, "la ficha se marca con el mismo valor escrito de otra forma");
  assert.equal(l.fichaActiva("30 %"), 30);
  assert.equal(l.fichaActiva(""), null, "vacío: ninguna");
  assert.equal(l.fichaActiva("25"), null);
  assert.equal(l.fichaActiva("abc"), null);

  // R3: el error es de cada celda, no de la fila.
  const borrador = b.borradorVacio();
  borrador.costos.mano_de_obra = [{ id: "a", descripcion: "Montaje", costo: "12,5", cantidad: "2" }, { id: "b", descripcion: "", costo: "1.000", cantidad: "1" }];
  const leido = b.leerBorrador(borrador, [MATERIAL]);
  assert.equal(leido.entrada, null);
  assert.ok(leido.erroresFila.a?.costo, "el costo mal escrito se marca");
  assert.equal(leido.erroresFila.a?.cantidad, undefined, "la cantidad, que está bien, NO se marca");
  assert.equal(leido.erroresFila.a?.descripcion, undefined, "la descripción tampoco");
  assert.deepEqual(Object.keys(leido.erroresFila.b ?? {}), ["descripcion"], "solo falta la descripción");
  assert.match(leido.erroresFila.b?.descripcion ?? "", /qué es este gasto/);
  assert.deepEqual([...leido.invalidas].sort(), ["a", "b"], "las filas con algo malo siguen listadas");
  console.log("[PASS] R3+R4 celdas: cada celda dice qué pasa y qué escribir; la coma decimal no se traga; solo se marca la celda mala");
}

async function probarFilas(): Promise<void> {
  const b = await import("../../src/lib/cotizacion/borrador-profesional");
  const f = await import("../../src/lib/cotizacion/limites-filas");
  const { MAX_LINEAS_SECCION } = await import("../../src/lib/cotizacion/profesional");
  const llenas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, descripcion: `Gasto ${i + 1}`, costo: "1.000", cantidad: "1" }));

  // R6: ya no se descartan en silencio las filas 51 en adelante.
  const exacto = b.borradorVacio();
  exacto.costos.mano_de_obra = llenas(MAX_LINEAS_SECCION);
  const unoMas = b.borradorVacio();
  unoMas.costos.mano_de_obra = llenas(MAX_LINEAS_SECCION + 2);
  assert.equal(b.leerBorrador(exacto, [MATERIAL]).entrada?.mano_de_obra.length, 50, "50 filas se envían las 50");
  const leido = b.leerBorrador(unoMas, [MATERIAL]);
  assert.equal(leido.entrada, null, "52 filas: no se calcula con 50 y se calla");
  assert.match(leido.excesos.mano_de_obra ?? "", /Tienes 52 gastos y el máximo es 50: quita 2 para ver el precio/);
  // Las filas en blanco no cuentan, y una fila con datos después de ellas no se pierde.
  const conBlancos = b.borradorVacio();
  conBlancos.costos.indirectos = [...Array.from({ length: 49 }, (_, i) => b.filaVacia(`b${i}`)), ...llenas(2)];
  const leidoBlancos = b.leerBorrador(conBlancos, [MATERIAL]);
  assert.equal(leidoBlancos.entrada?.indirectos.length, 2, "las dos filas con datos se envían aunque vengan tras 49 en blanco");
  const estado = f.estadoFilas(50);
  assert.equal(estado.llena, true);
  assert.equal(estado.contador, "50 de 50 gastos");
  assert.match(estado.motivoSinAgregar ?? "", /máximo de 50 gastos/);
  assert.equal(f.estadoFilas(f.FILAS_PARA_AVISAR - 1).contador, null, "lejos del tope no hay ruido");
  assert.equal(f.estadoFilas(f.FILAS_PARA_AVISAR).contador, `${f.FILAS_PARA_AVISAR} de 50 gastos`, "se avisa antes de llegar");
  assert.equal(f.estadoFilas(f.FILAS_PARA_AVISAR).llena, false);
  assert.equal(f.estadoFilas(10).motivoSinAgregar, null);
  assert.equal(f.estadoFilas(52).sobran, 2);
  console.log("[PASS] R6 filas: el tope se avisa antes, el botón de agregar sabe por qué se bloquea y nunca se calcula con menos filas de las que se ven");
}

async function probarPrecioDeMaterial(): Promise<void> {
  const b = await import("../../src/lib/cotizacion/borrador-profesional");

  // R7: vaciar el campo NO manda el precio de catálogo disfrazado de «precio tuyo».
  assert.equal(b.estadoPrecioMaterial(undefined, COP_CATALOGO), "catalogo");
  assert.equal(b.estadoPrecioMaterial("", COP_CATALOGO), "vacio");
  assert.equal(b.estadoPrecioMaterial("   ", COP_CATALOGO), "vacio");
  assert.equal(b.estadoPrecioMaterial("cinco", COP_CATALOGO), "ilegible");
  assert.equal(b.estadoPrecioMaterial("16.900", COP_CATALOGO), "catalogo", "escribir el de catálogo no es un precio propio");
  assert.equal(b.estadoPrecioMaterial("15.000", COP_CATALOGO), "propio");
  const borrador = b.borradorVacio();
  borrador.precios = { v1: "" };
  const vacio = b.leerBorrador(borrador, [MATERIAL]);
  assert.equal(vacio.entrada, null, "con el precio en blanco no se envía nada: no se cobra un precio que el campo no muestra");
  assert.ok(vacio.preciosInvalidos.has("v1"));
  assert.match(vacio.erroresPrecio.v1 ?? "", /Escribe el precio por paquete o vuelve al de catálogo/);
  borrador.precios = { v1: "15.000" };
  assert.equal(b.leerBorrador(borrador, [MATERIAL]).entrada?.materiales[0]?.precio_paquete_cop, 15000);
  borrador.precios = {};
  const catalogo = b.leerBorrador(borrador, [MATERIAL]).entrada?.materiales[0];
  assert.equal(catalogo && "precio_paquete_cop" in catalogo, false, "volver al catálogo (sin entrada) no envía precio propio");
  assert.deepEqual(Object.values(b.TEXTO_ESTADO_PRECIO), ["precio de catálogo", "tu precio", "falta el precio", "precio no válido"], "la fila dice la verdad en cada estado");
  console.log("[PASS] R7 precio de material: en blanco = a medio escribir (no se envía nada y la fila lo dice); el de catálogo no se hace pasar por «tu precio»");
}

async function probarBorradorVacioYAvisos(): Promise<void> {
  const b = await import("../../src/lib/cotizacion/borrador-profesional");

  // R5: un borrador vacío no cuenta como «había algo» (y por tanto no abre el panel).
  assert.equal(b.borradorConContenido(b.borradorVacio()), false);
  const conFilaEnBlanco = b.borradorVacio();
  conFilaEnBlanco.costos.indirectos = [b.filaVacia("x")];
  assert.equal(b.borradorConContenido(conFilaEnBlanco), false, "una fila recién agregada y vacía tampoco");
  const conUtilidad = { ...b.borradorVacio(), utilidad: "30" };
  assert.equal(b.borradorConContenido(conUtilidad), true);
  assert.equal(b.borradorConContenido({ ...b.borradorVacio(), precios: { v1: "" } }), true, "un precio a medio escribir es una edición empezada");
  const conFila = b.borradorVacio();
  conFila.costos.mano_de_obra = [{ id: "a", descripcion: "Montaje", costo: "", cantidad: "" }];
  assert.equal(b.borradorConContenido(conFila), true);

  // R10: lo que no se incluye se dice con una frase, visible fuera de cualquier desplegable.
  assert.equal(b.avisoProductosExcluidos(0), null);
  assert.match(b.avisoProductosExcluidos(1) ?? "", /^Un producto de esta propuesta no tiene precio en el catálogo y no está en este precio\.$/);
  assert.match(b.avisoProductosExcluidos(3) ?? "", /^3 productos de esta propuesta no tienen precio en el catálogo y no están en este precio\.$/);
  // R9: sin materiales, el porqué y qué hacer.
  assert.match(b.textoSinMateriales(2), /Ningún producto de esta propuesta tiene precio en el catálogo.*Cámbialos en la propuesta/);
  assert.match(b.textoSinMateriales(0), /todavía no tiene materiales/);

  // R11: dos paquetes del mismo producto no se llaman igual.
  assert.equal(b.nombreMaterialCliente(MATERIAL.descripcion), "Globo Latex Redondo Fashion Blanco de 5 pulgadas");
  assert.equal(b.nombreMaterialCliente("B2b Globo Latex Redondo Fashion Blanco — R-12 / PAQUETE X 12"), "Globo Latex Redondo Fashion Blanco de 12 pulgadas");
  assert.equal(b.nombreMaterialCliente("BURBUJA 24 X 1"), "BURBUJA 24 X 1", "un producto sin código de tamaño queda como está");
  console.log("[PASS] R5/R9/R10/R11: el borrador vacío no abre el panel; lo que no se incluye y la falta de materiales se explican; los materiales se distinguen");
}

async function probarDeshacer(): Promise<void> {
  const d = await import("../../src/lib/cotizacion/deshacer-fila");
  const b = await import("../../src/lib/cotizacion/borrador-profesional");
  const a = { id: "a", descripcion: "Montaje", costo: "50.000", cantidad: "2" };
  const c = { id: "c", descripcion: "Ayudante", costo: "30.000", cantidad: "1" };
  const filas = [a, b.filaVacia("v"), c];
  const quitandoC = d.quitarConRastro(filas, "c");
  assert.deepEqual(quitandoC.filas.map((fila) => fila.id), ["a", "v"]);
  assert.deepEqual(quitandoC.quitada, { fila: c, indice: 2 });
  assert.equal(d.quitarConRastro(filas, "v").quitada, null, "una fila en blanco no se guarda para deshacer: no hay nada que perder");
  assert.equal(d.quitarConRastro(filas, "no-existe").quitada, null);
  assert.deepEqual(d.reponerFila(quitandoC.filas, quitandoC.quitada!).map((fila) => fila.id), ["a", "v", "c"], "vuelve a su sitio");
  assert.deepEqual(d.reponerFila([a], { fila: c, indice: 9 }).map((fila) => fila.id), ["a", "c"], "si la lista es más corta, al final");
  assert.deepEqual(d.reponerFila([a, c], { fila: c, indice: 1 }).map((fila) => fila.id), ["a", "c"], "no duplica");
  console.log("[PASS] deshacer: quitar un gasto con datos se puede devolver a su sitio");
}

async function probarLenguaje(): Promise<void> {
  const b = await import("../../src/lib/cotizacion/borrador-profesional");
  const v = await import("../../src/lib/cotizacion/vigencia");
  // Una palabra por concepto: lo que antes sonaba a contabilidad o a pantalla de desarrollo no vuelve.
  const JERGA = /utilidad|costos? indirectos?|mano de obra|margen real|cotización profesional|\bbolsas?\b|\bnull\b|\bCOP\b/i;
  const textos = [
    ...Object.values(b.TITULOS_SECCION),
    ...Object.values(b.DESCRIPCIONES_SECCION),
    ...Object.values(b.TEXTO_ESTADO_PRECIO),
    b.RESPALDO_COTIZACION_PROFESIONAL,
    b.textoSinMateriales(0),
    b.textoSinMateriales(2),
    b.avisoProductosExcluidos(1) ?? "",
    v.subtituloDelPrecio(true),
    v.leyendaDelPrecio({ vigencia: { tipo: "vigente" }, mensajeError: null, ganancia: { cop: 1, margenPorcentaje: 10 } }).texto,
    v.leyendaDelPrecio({ vigencia: { tipo: "no-vigente", motivo: "campo-ilegible" }, mensajeError: null, ganancia: null }).texto,
  ];
  for (const texto of textos) assert.doesNotMatch(texto, JERGA, texto);
  assert.deepEqual(Object.values(b.TITULOS_SECCION), ["Tu trabajo y ayudantes", "Transporte y equipos", "Otros gastos"]);
  console.log("[PASS] lenguaje: sin utilidad, indirectos, mano de obra ni «margen real» a la vista; una palabra por concepto");
}

const h = React.createElement;
/** Datos de Python tal como llegan (los números no se calculan aquí). */
const DATOS: CotizacionProfesionalResultado = {
  operation_schema_version: "cotizacion-profesional-result.v1",
  currency: "COP",
  materiales: { lineas: [], total_cop: 26900 },
  mano_de_obra: { lineas: [], total_cop: 24000 },
  equipos_transporte: { lineas: [], total_cop: 0 },
  indirectos: { lineas: [], total_cop: 0 },
  total_costos_cop: 50900,
  utilidad_porcentaje: 30,
  utilidad_cop: 15270,
  precio_sugerido_cop: 66170,
  margen_porcentaje: 23.08,
};
const ENVIADAS = { mano_de_obra: ["a"], equipos_transporte: [], indirectos: [] };
const JERGA_VISIBLE = /utilidad|indirectos|mano de obra|margen real|cotización profesional|\bbolsas?\b|\bnull\b|undefined|\bCOP\b/i;

async function probarPantalla(): Promise<void> {
  const { EncabezadoPrecio } = await import("../../src/components/cotizacion/EncabezadoPrecio");
  const { SeccionGastos } = await import("../../src/components/cotizacion/SeccionGastos");
  const { PreciosMateriales } = await import("../../src/components/cotizacion/PreciosMateriales");
  const { fichaGlobo } = await import("../../src/components/guiado/ficha-globo");
  const { ResumenPrecio } = await import("../../src/components/cotizacion/ResumenPrecio");
  const v = await import("../../src/lib/cotizacion/vigencia");
  const b = await import("../../src/lib/cotizacion/borrador-profesional");
  const sinAccion = () => undefined;
  type Vig = Parameters<typeof v.leyendaDelPrecio>[0]["vigencia"];
  const leyenda = (vigencia: Vig, mensajeError: string | null = null) => v.leyendaDelPrecio({ vigencia, mensajeError, ganancia: { cop: 15270, margenPorcentaje: 23.08 } });
  const encabezado = (vigencia: Vig, datos: typeof DATOS | null, mensajeError: string | null = null, aviso: string | null = null) => renderToStaticMarkup(h(EncabezadoPrecio, {
    datos, enviadas: datos ? ENVIADAS : null, atenuar: v.esNoVigente(vigencia), leyenda: leyenda(vigencia, mensajeError), incluyeIva: true, avisoExcluidos: aviso,
    abierta: false, idPanel: "p", onAlternar: sinAccion, onReintentar: sinAccion,
  }));

  // R1: el precio, las fichas y el aviso: vigente se ve normal; no vigente, atenuado y con el motivo.
  const vigente = encabezado({ tipo: "vigente" }, DATOS);
  assert.doesNotMatch(vigente, /opacity-55/);
  assert.match(vigente, /\$\s66\.170/);
  assert.match(vigente, /Incluye tu ganancia/);
  const ilegible = encabezado({ tipo: "no-vigente", motivo: "campo-ilegible" }, DATOS);
  assert.equal(ilegible.match(/opacity-55/g)?.length, 2, "el precio grande y las fichas se atenúan");
  assert.match(ilegible, /precio anterior, no actualizado/, "y el lector de pantalla lo oye");
  assert.match(ilegible, /Este precio es el anterior y no se actualizó: revisa lo que está en rojo/);
  assert.doesNotMatch(ilegible, /Reintentar/, "un campo mal escrito se corrige");
  const fallo = encabezado({ tipo: "no-vigente", motivo: "error-de-calculo" }, DATOS, "No pude calcular tu precio. Intenta de nuevo en un momento.");
  assert.match(fallo, /opacity-55/);
  assert.match(fallo, /Reintentar/, "un fallo del cálculo se reintenta");
  assert.match(fallo, /text-error/);
  const sinResultado = encabezado({ tipo: "sin-resultado", motivo: "campo-ilegible" }, null);
  assert.match(sinResultado, /—/, "sin resultado, un guion");
  assert.doesNotMatch(sinResultado, /opacity-55|\$\s0\b/);
  // R2/R10 en la cabecera: solo las listas que entraron en el cálculo tienen ficha (nada de «$ 0»), y lo que no se incluye se dice a la vista.
  assert.match(vigente, /Tu trabajo y ayudantes <span[^>]*>\$\s24\.000/);
  assert.doesNotMatch(vigente, /Transporte y equipos|Otros gastos|\$\s0\b/);
  const conAviso = encabezado({ tipo: "vigente" }, DATOS, null, b.avisoProductosExcluidos(2));
  assert.match(conAviso, /2 productos de esta propuesta no tienen precio en el catálogo y no están en este precio/);
  assert.doesNotMatch(conAviso, /<details/, "visible sin abrir ningún desplegable");

  // Resumen: lo mismo, y sin filas de $ 0 de listas ausentes.
  const resumen = (vigencia: Vig) => renderToStaticMarkup(h(ResumenPrecio, { datos: DATOS, enviadas: ENVIADAS, atenuar: v.esNoVigente(vigencia), leyenda: leyenda(vigencia), onReintentar: sinAccion, incluyeIva: false }));
  assert.match(resumen({ tipo: "no-vigente", motivo: "error-de-calculo" }), /opacity-55[\s\S]*Último precio calculado/);
  assert.doesNotMatch(resumen({ tipo: "vigente" }), /opacity-55|\$\s0\b|Transporte y equipos/);
  assert.match(resumen({ tipo: "vigente" }), /Materiales \(sin IVA\) \+ tus gastos \+ tu ganancia/);
  // La suma a la vista: materiales + gastos + ganancia = precio al cliente, todos de Python.
  assert.match(resumen({ tipo: "vigente" }), />Materiales<\/span><\/dt><dd[^>]*>\$\s26\.900[\s\S]*>\+<\/span>[\s\S]*Tu trabajo y ayudantes[\s\S]*\$\s24\.000[\s\S]*Lo que te cuesta todo[\s\S]*\$\s50\.900[\s\S]*Tu ganancia \(30 %\)[\s\S]*\$\s15\.270[\s\S]*>=<\/span>Precio al cliente[\s\S]*\$\s66\.170/);

  // R2/R3/R4/R6/R11/R12: la lista de gastos.
  const fila = (id: string, descripcion: string, costo: string, cantidad: string) => ({ id, descripcion, costo, cantidad });
  const lista = (filas: ReturnType<typeof fila>[], extra: Record<string, unknown> = {}) => {
    const borrador = b.borradorVacio();
    borrador.costos.equipos_transporte = filas;
    const leido = b.leerBorrador(borrador, [MATERIAL]);
    return renderToStaticMarkup(h(SeccionGastos, {
      seccion: "equipos_transporte", clave: "k", filas, errores: leido.erroresFila, exceso: leido.excesos.equipos_transporte, atenuar: false,
      subtotal: () => null, total: null, quitada: null, foco: null, onFocoListo: sinAccion, onCambiar: sinAccion, onAgregar: sinAccion, onQuitar: sinAccion, onDeshacer: sinAccion, ...extra,
    }));
  };
  const malaUnCampo = lista([fila("a", "Camión", "12,5", "2")]);
  assert.match(malaUnCampo, /id="equipos_transporte-k-a-costo"[^>]*aria-invalid="true"[^>]*aria-errormessage="equipos_transporte-k-a-costo-error"/, "el costo malo se marca y apunta a su mensaje");
  assert.match(malaUnCampo, /id="equipos_transporte-k-a-cantidad"[^>]*aria-invalid="false"/, "la cantidad, que está bien, no");
  assert.match(malaUnCampo, /id="equipos_transporte-k-a-descripcion"[^>]*aria-invalid="false"/);
  assert.match(malaUnCampo, /<li id="equipos_transporte-k-a-costo-error">El peso no lleva decimales: escribe 13, no 12,5/, "el mensaje existe y dice qué escribir");
  assert.doesNotMatch(malaUnCampo, /aria-errormessage="equipos_transporte-k-a-cantidad/);
  assert.match(malaUnCampo, />Total<\/span><span[^>]*>Completa los datos para sumarlo<\/span>/, "una lista que no entró en el cálculo no vale $ 0: dice qué falta");
  assert.doesNotMatch(malaUnCampo, /—|\$\s0/, "ni «—» ni $ 0 inventados");
  assert.match(malaUnCampo, /<span[^>]*text-error[^>]*>Revisa el valor<\/span>/, "donde irá el total, qué revisar");
  assert.match(malaUnCampo, /id="equipos_transporte-k-a-costo"[^>]*inputMode="numeric"/, "teclado numérico para el valor");
  assert.match(malaUnCampo, /id="equipos_transporte-k-a-cantidad"[^>]*inputMode="decimal"/, "y decimal para la cantidad");
  assert.match(malaUnCampo, /aria-label="Una menos de Camión"/, "la cantidad tiene − / +");
  assert.match(malaUnCampo, /aria-label="Una más de Camión"/);
  assert.match(malaUnCampo, /<label[^>]*for="equipos_transporte-k-a-costo"[^>]*>Valor por unidad<\/label>/, "etiqueta visible, no solo placeholder");
  assert.match(malaUnCampo, /<button[^>]*class="[^"]*size-11[^"]*"[^>]*aria-label="Quitar Camión"|<button[^>]*aria-label="Quitar Camión"[^>]*class="[^"]*size-11/, "la papelera mide 44 px");
  assert.match(malaUnCampo, /class="[^"]*h-11[^"]*"/, "los campos miden 44 px");
  assert.doesNotMatch(malaUnCampo, JERGA_VISIBLE);
  const tope = lista(Array.from({ length: 50 }, (_, i) => fila(`f${i}`, `Gasto ${i + 1}`, "1.000", "1")));
  assert.match(tope, /50 de 50 gastos\. Llegaste al máximo de 50 gastos en esta lista\./);
  assert.match(tope, /<button[^>]*disabled=""[^>]*>/, "el botón de agregar va deshabilitado");
  assert.match(tope, /aria-describedby="equipos_transporte-k-limite"/, "y apunta al motivo");
  const exceso = lista(Array.from({ length: 52 }, (_, i) => fila(`f${i}`, `Gasto ${i + 1}`, "1.000", "1")));
  assert.match(exceso, /Tienes 52 gastos y el máximo es 50: quita 2 para ver el precio/);
  assert.doesNotMatch(lista([fila("a", "Camión", "1.000", "1")]), /de 50 gastos/, "lejos del tope no hay contador");
  assert.match(lista([fila("a", "Camión", "1.000", "1")], { quitada: { fila: fila("z", "Peaje", "5.000", "1"), indice: 0 } }), /Quitaste «Peaje»\.[\s\S]*Deshacer/);
  // Rediseño: lista vacía invita con ideas de un toque; fila en blanco sin «—» y con ideas; total de Python a la derecha.
  const listaVacia = lista([]);
  assert.match(listaVacia, /Toca uno para sumarlo/, "una lista vacía invita");
  assert.match(listaVacia, /aria-label="Agregar Transporte"[^>]*>[\s\S]*?Transporte<\/button>/, "con ideas de un toque");
  assert.match(listaVacia, /aria-label="Agregar Alquiler de base"/);
  assert.doesNotMatch(listaVacia, /—|Total/);
  assert.match(lista([], { quitada: { fila: fila("z", "Peaje", "5.000", "1"), indice: 0 } }), /Quitaste «Peaje»\.[\s\S]*Deshacer[\s\S]*Toca uno para sumarlo/, "quitada la última fila, deshacer sigue a mano, sobre la invitación");
  assert.match(lista([fila("a", "Camión", "1.000", "1"), fila("b", "Peaje", "1.000", "1")], { quitada: { fila: fila("z", "Bus", "5.000", "1"), indice: 1 } }), /Quitar Camión[\s\S]*Quitaste «Bus»[\s\S]*Quitar Peaje/, "el aviso va donde estaba la fila");
  const enBlanco = lista([fila("a", "", "", "")]);
  assert.doesNotMatch(enBlanco, /—|Total|Falta|aria-invalid="true"/, "una fila en blanco no muestra «—» ni errores");
  assert.match(enBlanco, /placeholder="¿Qué es\? Ej\. Transporte"/, "placeholder que dice qué escribir");
  assert.match(enBlanco, /role="group" aria-label="Ideas para Transporte y equipos"/, "ideas para la descripción");
  assert.match(enBlanco, /placeholder="50\.000"/);
  const unaUnidad = lista([fila("a", "Transporte", "50.000", "1")]);
  assert.match(unaUnidad, /<button[^>]*disabled=""[^>]*aria-label="Una menos de Transporte"|aria-label="Una menos de Transporte"[^>]*disabled=""/, "no baja de 1 con el −");
  const conTotal = lista([fila("a", "Transporte", "50.000", "2")], { subtotal: () => 100000, total: 100000 });
  assert.match(conTotal, /\$\s100\.000[\s\S]*>Total<\/span>[\s\S]*\$\s100\.000/, "el total de la fila y el de la lista son los de Python");
  assert.match(lista([fila("a", "Transporte", "", "1")]), /Falta el valor/, "a la fila a medias se le dice qué falta");

  // R7: el material con el precio vaciado lo dice la fila, el campo y el botón; y el desplegable se abre solo.
  const materiales = (precios: Record<string, string>) => {
    const borrador = b.borradorVacio();
    borrador.precios = precios;
    const leido = b.leerBorrador(borrador, [MATERIAL]);
    return renderToStaticMarkup(h(PreciosMateriales, { clave: "k", materiales: [MATERIAL], precios, errores: leido.erroresPrecio, atenuar: false, subtotalDe: () => null, total: null, onPrecio: sinAccion }));
  };
  const vaciado = materiales({ v1: "" });
  // Cada fila: «1 paquete de 12» (los globos por paquete salen del nombre de catálogo) y, debajo, el estado del precio.
  assert.match(vaciado, /1 paquete de 12<\/span><span[^>]*text-error[^>]*>falta el precio/, "la fila ya no dice «precio tuyo»");
  assert.doesNotMatch(vaciado, /tu precio/);
  assert.match(vaciado, /aria-invalid="true"[^>]*aria-errormessage="precio-k-v1-error"/);
  assert.match(vaciado, /Escribe el precio por paquete o vuelve al de catálogo/);
  assert.match(vaciado, /aria-label="Volver al precio de catálogo de Globo Latex Redondo Fashion Blanco de 5 pulgadas"/, "el botón para volver al catálogo sigue ahí");
  assert.match(vaciado, /<details[^>]*open=""/, "con un precio a medias el desplegable no lo esconde");
  const propio = materiales({ v1: "15.000" });
  assert.match(propio, /1 paquete de 12<\/span><span[^>]*>tu precio/);
  assert.doesNotMatch(propio, /<details[^>]*open=""/, "sin errores sigue plegado");
  const catalogo = materiales({});
  assert.match(catalogo, /1 paquete de 12<\/span><span[^>]*>precio de catálogo/);
  // El globo se ve (dibujo con su color, o la foto del catálogo) y se dice qué producto Sempertex es y su tamaño.
  assert.match(catalogo, /<svg[^>]*viewBox="0 0 100 100"/, "cada producto con su globo dibujado");
  assert.match(catalogo, />Fashion Blanco<\/p>/, "el producto Sempertex, sin «B2b» ni paquete");
  assert.match(catalogo, />Sempertex Fashion<\/span>/);
  assert.match(catalogo, />5″<\/span>/, "el tamaño en un chip");
  const conFoto = renderToStaticMarkup(h(PreciosMateriales, { clave: "k", materiales: [MATERIAL], precios: {}, errores: {}, atenuar: false, subtotalDe: () => 16900, total: 16900, onPrecio: sinAccion, fichas: { v1: { ...fichaGlobo({ nombre: MATERIAL.descripcion, foto: "https://cdn.shopify.com/s/files/1/0825/6100/7911/files/R5_Blanco.jpg?v=1" }) } } }));
  assert.match(conFoto, /<img[^>]*src="https:\/\/cdn\.shopify\.com\/s\/files\/1\/0825\/6100\/7911\/files\/R5_Blanco\.jpg\?v=1&amp;width=160"/, "con foto del catálogo, la foto (a tamaño de miniatura)");
  assert.match(conFoto, /\$\s16\.900/, "el subtotal de Python se ve");
  assert.doesNotMatch(catalogo, /Volver al precio de catálogo/, "nada que deshacer");
  assert.match(catalogo, /Globo Latex Redondo Fashion Blanco de 5 pulgadas/, "nombre con su tamaño");
  assert.doesNotMatch(vaciado + propio + catalogo, JERGA_VISIBLE);
  // Decisión 3: «Tu ganancia» con fichas 20 / 30 / 40 %, sin valor por defecto.
  const { CampoGanancia } = await import("../../src/components/cotizacion/CampoGanancia");
  const ganancia = (valor: string, error: string | null = null) => renderToStaticMarkup(h(CampoGanancia, { clave: "k", valor, error, onValor: sinAccion }));
  const vacia = ganancia("");
  assert.match(vacia, /id="ganancia-k"[^>]*value=""/, "el campo empieza vacío");
  assert.equal(vacia.match(/aria-pressed="true"/g), null, "sin valor no hay ficha activa");
  assert.equal(vacia.match(/aria-pressed="false"/g)?.length, 3);
  for (const n of [20, 30, 40]) assert.match(vacia, new RegExp(`>${n} %</button>`));
  assert.match(vacia, /role="group" aria-label="Ganancias sugeridas"/);
  assert.match(vacia, /<button[^>]*class="[^"]*h-11 min-w-11[^"]*"/, "las fichas miden 44 px");
  const treinta = ganancia("30");
  assert.equal(treinta.match(/aria-pressed="true"/g)?.length, 1);
  assert.match(treinta, /aria-pressed="true"[^>]*>30 %<\/button>/, "la ficha que coincide se marca");
  assert.equal(ganancia("25").match(/aria-pressed="true"/g), null, "otro valor: ninguna");
  assert.match(ganancia("1500", "No puede pasar de 1.000 %."), /aria-errormessage="ganancia-k-error"[\s\S]*No puede pasar de 1\.000 %/);
  assert.match(renderToStaticMarkup(h(CampoGanancia, { clave: "k", valor: "30", error: null, ganancia: { cop: 15270, atenuar: false }, onValor: sinAccion })), /Ganas <span[^>]*><span[^>]*>\$\s15\.270/, "lo que ganas, de Python");
  assert.doesNotMatch(treinta, /Ganas/, "sin cálculo no se inventa la ganancia");
  assert.doesNotMatch(vacia + treinta, JERGA_VISIBLE);
  // El texto «Todavía no incluye tu ganancia» sigue mientras el campo esté vacío (lo dice la leyenda, no el campo).
  assert.equal(leyenda({ tipo: "vigente" }).texto === "Incluye tu ganancia: el 23,08 % del precio es tuyo.", true);
  assert.equal(v.leyendaDelPrecio({ vigencia: { tipo: "vigente" }, mensajeError: null, ganancia: { cop: 0, margenPorcentaje: null } }).texto, "Todavía no incluye tu ganancia.");
  console.log("[PASS] pantalla: precio no vigente atenuado y explicado; celdas con su mensaje; tope de filas; precio vaciado coherente; sin jerga");
}

async function probarFormularioCompleto(): Promise<void> {
  const { CotizacionProfesional } = await import("../../src/components/cotizacion/CotizacionProfesional");
  const linea = (id: string, extra: Record<string, unknown> = {}) => ({ id, varianteId: id, nombre: `B2b Globo Latex Redondo Fashion Blanco — R-${id.length + 4} / PAQUETE X 12`, tamano: "R-5", cantidadNecesaria: 10, disponible: true, paquetes: 1, precioPaquete: 1826, ...extra });
  const cotizacion = (lineas: unknown[]) => ({ lineas, total: 0, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false }) as never;
  const conAlmacenamiento = (guardado: unknown) => {
    const g = globalThis as { window?: unknown };
    const previo = g.window;
    // Los escuchas vacíos: con un `window` presente, motion (la lista de materiales anima) cree estar en el navegador.
    g.window = { sessionStorage: { getItem: () => (guardado === null ? null : JSON.stringify(guardado)), setItem: () => undefined, removeItem: () => undefined }, addEventListener: () => undefined, removeEventListener: () => undefined };
    return () => { g.window = previo; };
  };
  const pintar = (props: { cotizacion: never; clave: string }) => renderToStaticMarkup(h(CotizacionProfesional, props));

  // R9: sin un solo producto cotizable el bloque no desaparece: dice por qué.
  const sinNada = pintar({ cotizacion: cotizacion([linea("a", { sinReferencia: true, varianteId: undefined }), linea("b", { precioPaquete: undefined })]), clave: "k" });
  assert.match(sinNada, /data-testid="cotizacion-profesional-sin-materiales"/);
  assert.match(sinNada, /Ningún producto de esta propuesta tiene precio en el catálogo.*Cámbialos en la propuesta/);
  assert.doesNotMatch(sinNada, JERGA_VISIBLE);
  assert.match(pintar({ cotizacion: cotizacion([]), clave: "k" }), /todavía no tiene materiales/);

  // R5: un borrador vacío guardado no abre el panel; uno con algo escrito, sí.
  const vacio = { costos: { mano_de_obra: [], equipos_transporte: [], indirectos: [] }, precios: {}, utilidad: "" };
  let restaurar = conAlmacenamiento(vacio);
  const cerrado = pintar({ cotizacion: cotizacion([linea("a")]), clave: "k" });
  restaurar();
  assert.match(cerrado, /aria-expanded="false"/, "un borrador vacío no abre el panel");
  assert.doesNotMatch(cerrado, /Tu ganancia<\/label>/);
  restaurar = conAlmacenamiento({ ...vacio, utilidad: "30" });
  const abierto = pintar({ cotizacion: cotizacion([linea("a"), linea("b", { precioPaquete: undefined })]), clave: "k" });
  restaurar();
  assert.match(abierto, /aria-expanded="true"/);
  // R13: «Tu ganancia» abre el panel: primero en el DOM, antes de cualquier lista y de los precios.
  const orden = ["Tu ganancia</label>", "Tu trabajo y ayudantes</h3>", "Transporte y equipos</h3>", "Otros gastos</h3>", "Tus materiales", "Así se arma tu precio"].map((texto) => abierto.indexOf(texto));
  assert.ok(orden.every((i) => i >= 0), `faltan bloques: ${orden}`);
  assert.deepEqual([...orden].sort((x, y) => x - y), orden, "el orden del DOM es el orden visual: ganancia, gastos, materiales, resumen");
  // R10: el aviso de lo que no se incluye está en la cabecera, antes del panel y fuera del desplegable.
  const aviso = abierto.indexOf("no tiene precio en el catálogo y no está en este precio");
  assert.ok(aviso > 0 && aviso < abierto.indexOf("<details"));
  assert.match(abierto, /placeholder="Ej\. 30"/);
  assert.match(abierto, /Se suma a lo que te cuesta todo/);
  assert.match(abierto, /Tus cambios se guardan solos/);
  assert.doesNotMatch(abierto, JERGA_VISIBLE, "el formulario abierto no usa la jerga retirada");
  assert.doesNotMatch(cerrado, JERGA_VISIBLE);
  assert.match(cerrado, /Ajustar mi precio/);
  console.log("[PASS] formulario: sin materiales dice por qué; un borrador vacío no abre el panel; «Tu ganancia» va primero; el aviso de excluidos está a la vista");
}

async function probarAyudasDeEscritura(): Promise<void> {
  const c = await import("../../src/components/cotizacion/conceptos-gasto");
  const fila = (descripcion: string, costo: string, cantidad: string) => ({ id: "a", descripcion, costo, cantidad });
  // − / +: en blanco cuenta como 1 (lo que se ve en gris); nunca baja a 0 ni pasa del tope; escribe con coma decimal.
  assert.equal(c.pasoCantidad("", 1), "2");
  assert.equal(c.pasoCantidad("", -1), null);
  assert.equal(c.pasoCantidad("1", -1), null, "no baja de lo vendible");
  assert.equal(c.pasoCantidad("3", -1), "2");
  assert.equal(c.pasoCantidad("1,5", 1), "2,5");
  assert.equal(c.pasoCantidad("1,5", -1), "0,5");
  assert.equal(c.pasoCantidad("100000", 1), null, "tope de Python");
  assert.equal(c.pasoCantidad("abc", 1), "1", "con algo ilegible, + vuelve a empezar");
  assert.equal(c.pasoCantidad("abc", -1), null);
  // Empezar a escribir una fila sin cantidad la deja en 1; no toca una cantidad escrita ni una fila que se vacía.
  assert.deepEqual(c.cambiosConCantidad(fila("", "", ""), { descripcion: "Montaje" }), { descripcion: "Montaje", cantidad: "1" });
  assert.deepEqual(c.cambiosConCantidad(fila("", "", ""), { costo: "5" }), { costo: "5", cantidad: "1" });
  assert.deepEqual(c.cambiosConCantidad(fila("Montaje", "", "3"), { costo: "5" }), { costo: "5" });
  assert.deepEqual(c.cambiosConCantidad(fila("M", "", ""), { descripcion: "" }), { descripcion: "" });
  assert.deepEqual(c.cambiosConCantidad(fila("", "", ""), { cantidad: "" }), { cantidad: "" });
  // Ideas: no se ofrece dos veces lo ya escrito (sin importar mayúsculas).
  assert.ok(!c.conceptosLibres("mano_de_obra", [fila(" montaje ", "", "")]).includes("Montaje"));
  assert.ok(c.conceptosLibres("mano_de_obra", []).includes("Ayudante"));
  for (const seccion of ["mano_de_obra", "equipos_transporte", "indirectos"] as const) assert.ok(c.CONCEPTOS_GASTO[seccion].length >= 3);
  assert.equal(c.faltaEnFila({ costo: "x" }, fila("T", "", "1")), "Falta el valor");
  assert.equal(c.faltaEnFila({ costo: "x" }, fila("T", "12,5", "1")), "Revisa el valor");
  assert.equal(c.faltaEnFila({ descripcion: "x" }, fila("", "5", "1")), "Falta qué es");
  assert.equal(c.faltaEnFila({}, fila("T", "5", "1")), null);
  console.log("[PASS] ayudas de escritura: − / + seguros, cantidad 1 al empezar, ideas sin repetir, qué falta en dos palabras");
}

async function main(): Promise<void> {
  await probarAyudasDeEscritura();
  await probarVigencia();
  await probarLectura();
  await probarFilas();
  await probarPrecioDeMaterial();
  await probarBorradorVacioYAvisos();
  await probarDeshacer();
  await probarLenguaje();
  await probarPantalla();
  await probarFormularioCompleto();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
