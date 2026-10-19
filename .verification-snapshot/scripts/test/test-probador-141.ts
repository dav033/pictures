/**
 * Probador 141 (2026-10-07, producción, vista guiada): los arreglos de raíz de sus hallazgos, sin red, sin modelo y sin
 * coste (los «fetch» son falsos y los planes, fixtures reales de la biblioteca).
 *
 *  I-2  «Ajustes que hice» solo de las piezas que siguen en el plan; tallas normalizadas; la lista se reemplaza en el acto.
 *  I-3  La pieza sumada por chat lleva el globo que COMPRA el plan (variant_overrides de la idea), no el declarado.
 *  I-5  Los avisos de tallas dicen el color de cada cambio y no repiten el hecho (idea + «Ajustes que hice»).
 *  I-6  Un pedido completo de una pieza («arco orgánico de unos 3 metros…») va directo a su propuesta.
 *  I-7  El 429 `motor_ocupado` se reintenta con espera creciente y tope (~8 s); la gráfica espera sin error.
 *  Menores: «Último ajuste» con lo que quedó en cada pieza; «Hacer lo mismo» marcado solo si son iguales; «Así queda»
 *  con la medida del plan sin cambios; el acabado de la foto que el plan no compra se dice.
 *
 * Run: npx tsx scripts/test/test-probador-141.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AjustesPropuesta } from "@/components/plan/AjustesPropuesta";
import { describirCambio, confirmacionDelCambio, piezasAjustables, type PlanGuiado } from "@/components/guiado/ajuste/ajuste-plan-guiado";
import { acabadosFotoSinComprar } from "@/components/guiado/acabados-foto-plan";
import { contadores, esperaTrasOcupado, graficaGuardada, INTENTOS_MOTOR_OCUPADO, pedirGrafica, reiniciarGraficasParaPruebas } from "@/components/guiado/grafica-motor-cola";
import { PanelColumnaOrganica, peticionVistaColumnaOrganica, type PiezaVistaColumnaOrganica } from "@/components/plan/columna-organica";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { sha256Body } from "@/lib/ia/contracts/operational-v1";
import { ajustesDePython } from "@/lib/ia/guiado/ajustes-python";
import { pedidoCompletoDePieza, piezasNombradas } from "@/lib/ia/guiado/hechos-cliente";
import { esperaMotorOcupado, isPythonAdapterError, llamarPythonEcho, PRESUPUESTO_MOTOR_OCUPADO_MS } from "@/lib/ia/nucleo/python-adapter";
import { ArmadoColumnaOrganicaV1Schema } from "@/lib/plan/armado-columna-organica";
import { avisosPlanDeIdea } from "@/lib/plan/avisos-plan-idea";
import { pedirVistaArmadoColumnaOrganica } from "@/lib/plan/peticion-armado-columna-organica";
import { planConPiezaNueva, productoComprado } from "@/lib/plan/pieza-nueva";
import { separarEstructurasRepetidas } from "@/lib/plan/piezas-individuales";
import { faltantesCliente, sustitucionesCliente } from "@/lib/plan/presentacion-cliente";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";

let fallos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try {
    await prueba();
    console.log(`[PASS] ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`[FAIL] ${nombre}`);
    console.error(error);
  }
}

const leer = (ruta: string): string => readFileSync(resolve(process.cwd(), ruta), "utf8");
const leerJson = (ruta: string): unknown => JSON.parse(leer(ruta)) as unknown;

// La idea real «Dos columnas rosa, lila y dorado» (biblioteca real-07): su plan declarado (con `variant_overrides` del
// lila a Pastel Dusk Lavanda) y lo que Python resolvió (con sus sustituciones de talla y su motivo).
const IDEA07 = leerJson("data/biblioteca-real/analisis/real-07-eb12910e210c94b6184d025127acce95.plan.json") as { plan_declarado: unknown; plan_resuelto: PlanResuelto };
const DECLARADO07 = PlanDecoracionSchema.parse(IDEA07.plan_declarado);
const RESUELTO07 = IDEA07.plan_resuelto;
const MATE_LILA = "8634258424103";
const DUSK_LAVANDA = "8634309804327";

async function main(): Promise<void> {
  await caso("I-2: tras quitar la guirnalda no queda «…y la guirnalda»; la misma talla escrita distinto es un solo hecho", () => {
    const plan = {
      plan: { estructuras: [{ estructura_id: "EST_01_COLUMNA", nombre: "Columna orgánica izquierda", estructura_oficial: "columna_asimetrica" }, { estructura_id: "EST_02_COLUMNA", nombre: "Columna orgánica derecha", estructura_oficial: "columna_asimetrica" }], supuestos: [] },
      sustituciones: [
        { estructura_id: "EST_01_COLUMNA", pedido: "R-18", entregado: "R-24", motivo: "La whitelist no tiene R-18; se usó el diámetro más cercano disponible para rosado." },
        { estructura_id: "EST_02_COLUMNA", pedido: "18", entregado: "R-24", motivo: "La whitelist no tiene R-18; se usó el diámetro más cercano disponible para rosado." },
        // La guirnalda que ya no está en el plan (una propiedad huérfana que antes llegaba a la tarjeta).
        { estructura_id: "EST_03_GUIRNALDA", pedido: "R-18", entregado: "R-24", motivo: "La whitelist no tiene R-18; se usó el diámetro más cercano disponible para rosado." },
      ],
      sin_cobertura: [{ estructura_id: "EST_03_GUIRNALDA", product_id: "P", tamano: "R-5" }],
      advertencias: ["color_sin_globos:EST_03_GUIRNALDA:dorado: Guirnalda: el dorado se queda sin globos."],
      conteos_referencia: [{ estructura_id: "EST_03_GUIRNALDA", decision: "ajustado", globos_foto: 90, globos_despues: 40 }],
    };
    const textos = ajustesDePython(plan).map((ajuste) => ajuste.texto);
    assert.deepEqual(textos, ["Para la columna orgánica izquierda y la columna orgánica derecha no hay globos de 18 pulgadas en rosado; usamos globos de 24 pulgadas."], textos.join(" | "));
    assert.ok(!textos.some((texto) => /guirnalda/i.test(texto)), "nada de la pieza quitada");
  });

  await caso("I-2: la insignia cuenta lo mismo que la lista y un plan nuevo la reemplaza (sin frases viejas animándose)", () => {
    const ajustes = [{ tipo: "tamano" as const, texto: "A" }, { tipo: "tamano" as const, texto: "B" }, { tipo: "supuesto" as const, texto: "C" }];
    const html = renderToStaticMarkup(React.createElement(AjustesPropuesta, { ajustes }));
    const insignia = Number(/Ajustes que hice<span[^>]*>(\d+)<\/span>/.exec(html)?.[1]);
    const visibles = (html.match(/<li /g) ?? []).length;
    const ocultos = Number(/Ver (\d+) más/.exec(html)?.[1] ?? 0);
    assert.equal(insignia, 3);
    assert.equal(visibles + ocultos, insignia, "lo que se ve más lo plegado = la insignia");
    const fuente = leer("src/components/plan/AjustesPropuesta.tsx");
    assert.match(fuente, /<ul key=\{firma\}/, "otro conjunto de ajustes reemplaza la lista en el acto");
  });

  await caso("I-3: la guirnalda sumada al plan de la idea compra el lila del plan (Pastel Dusk Lavanda), no el declarado", () => {
    const lila = DECLARADO07.estructuras[0]!.materiales.findIndex((material) => material.color === "lila");
    assert.equal(DECLARADO07.estructuras[0]!.materiales[lila]!.product_id, MATE_LILA, "la idea DECLARA Pastel Mate Lila");
    const lineas = RESUELTO07.estructuras.find((estructura) => estructura.estructura_id === DECLARADO07.estructuras[0]!.estructura_id)!.lineas;
    assert.equal(productoComprado(DECLARADO07.estructuras[0]!, lila, lineas), DUSK_LAVANDA, "y COMPRA Pastel Dusk Lavanda");
    assert.equal(productoComprado(DECLARADO07.estructuras[0]!, lila), DUSK_LAVANDA, "sin líneas, por la sustitución de su variante");
    const conGuirnalda = planConPiezaNueva(DECLARADO07, { estructura: "guirnalda", ubicacion: "centro" }, RESUELTO07.estructuras);
    assert.ok(conGuirnalda.ok, JSON.stringify(conGuirnalda));
    const guirnalda = conGuirnalda.plan.estructuras.at(-1)!;
    const productos = Object.fromEntries(guirnalda.materiales.map((material) => [material.color, material.product_id]));
    assert.equal(productos.lila, DUSK_LAVANDA, `el mismo lila que las columnas: ${JSON.stringify(productos)}`);
    assert.ok(!guirnalda.materiales.some((material) => material.product_id === MATE_LILA), "ningún Pastel Mate Lila");
    assert.deepEqual(conGuirnalda.comprados, [{ color: "lila", declarado: MATE_LILA, comprado: DUSK_LAVANDA }], "queda registrado (decidir: productosComprados)");
    assert.deepEqual(conGuirnalda.plan.estructuras.slice(0, 2), DECLARADO07.estructuras, "las columnas quedan idénticas");
    assert.match(leer("src/lib/plan/ajuste-plan-entero.ts"), /planConPiezaNueva\(input\.base\.plan, [^\n]*, input\.base\.estructuras\)/, "el servidor le pasa las líneas del plan firmado");
  });

  await caso("I-5: el aviso de la idea dice los colores, no contradice tallas y deja el detalle a «Ajustes que hice»", () => {
    // La primera línea del plan de la idea de 2 columnas (conversación A).
    const idea = avisosPlanDeIdea({
      globosIdea: 87, globosDeIdeaEnPlan: 87, nuevas: RESUELTO07.plan.estructuras.map((estructura) => estructura.estructura_id),
      sustituciones: RESUELTO07.sustituciones, sinCobertura: RESUELTO07.sin_cobertura, sinTallasDeIdea: false,
    });
    assert.equal(idea.exacto, false);
    assert.deepEqual(idea.avisos, ["El catálogo no tiene algunos tamaños de la idea en rosado, lila y dorado: usé los más cercanos (el detalle está en «Ajustes que hice»)."]);
    assert.ok(!idea.avisos.some((aviso) => /″/.test(aviso)), "sin tallas sueltas que se lean como contradicción");
    // Conversación F: una talla sustituida de un color y otra que falta de otro color.
    const f = avisosPlanDeIdea({
      globosIdea: 101, globosDeIdeaEnPlan: 101, nuevas: ["EST_01_SEMIARCO"],
      sustituciones: [{ estructura_id: "EST_01_SEMIARCO", pedido: "R-24", entregado: "R-18", motivo: "La whitelist no tiene R-24; se usó el diámetro más cercano disponible para verde." }],
      sinCobertura: [{ estructura_id: "EST_01_SEMIARCO", product_id: "P-NARANJA", tamano: "R-24" }],
      sinTallasDeIdea: false, coloresDeProducto: { "P-NARANJA": "naranja" },
    });
    assert.deepEqual(f.avisos, ["El catálogo no tiene algunos tamaños de la idea en verde y naranja: usé los más cercanos y, donde no había ninguno, va sin ellos (el detalle está en «Ajustes que hice»)."]);
    // «Ajustes que hice» (la misma tarjeta): cada cambio con su color y su pieza, una frase por hecho.
    const nombres = new Map([["EST_01_COLUMNA_ASIMETRICA", "la columna izquierda"], ["EST_02_COLUMNA_ASIMETRICA", "la columna derecha"]]);
    assert.deepEqual(sustitucionesCliente(RESUELTO07.sustituciones, nombres), [
      "Para la columna izquierda y la columna derecha no hay globos de 18 pulgadas en rosado; usamos globos de 24 pulgadas.",
      "Para la columna izquierda y la columna derecha no hay globos de 24 pulgadas en lila ni en dorado; usamos globos de 18 pulgadas.",
    ]);
    assert.deepEqual(faltantesCliente([{ estructura_id: "EST_01_COLUMNA_ASIMETRICA", product_id: "P-NARANJA", tamano: "R-24" }, { estructura_id: "EST_02_COLUMNA_ASIMETRICA", product_id: "P-NARANJA", tamano: "24" }], nombres, new Map([["P-NARANJA", "naranja"]])), [
      "Todavía no tenemos globos de 24 pulgadas en naranja para la columna izquierda y la columna derecha.",
    ]);
    assert.match(leer("src/lib/plan/plan-desde-idea.ts"), /coloresDeProducto: Object\.fromEntries/, "la ruta de la idea pasa el color de cada producto");
  });

  await caso("I-6: un pedido completo de una pieza va directo a su propuesta (sin ideas de la biblioteca)", () => {
    const decorador = "Soy decorador, un cliente me pide un arco orgánico de unos 3 metros en blanco y dorado para una boda y necesito cotizarle";
    const pedido = pedidoCompletoDePieza(decorador);
    assert.equal(pedido?.estructura.id, "arco");
    assert.equal(pedido?.estructura.organica, true);
    assert.equal(pedido?.medida.metros, 3);
    assert.equal(pedidoCompletoDePieza("Quiero un arco de 3 metros y dos columnas para un bautizo"), null, "varias piezas: no es UNA pieza");
    assert.deepEqual(piezasNombradas("un medio arco orgánico de 2 metros"), ["semiarco"], "«medio arco» no cuenta también como «arco»");
    assert.equal(pedidoCompletoDePieza("Quiero un arco orgánico en blanco y dorado para una boda"), null, "sin medida: se pregunta o se buscan ideas");
    assert.equal(pedidoCompletoDePieza("Muéstrame ideas de arcos de 3 metros"), null, "pedir ver ideas no es pedir la pieza");
    assert.equal(pedidoCompletoDePieza("Propónme una pieza individual: Arco orgánico."), null, "un texto de la interfaz no cuenta");
    const ruta = leer("src/app/api/asistente-guiado/route.ts");
    assert.match(ruta, /const pedidoDirecto = !alcanceDeBoton && !planActual && !estado\?\.decoracionId && !parsed\.data\.fotoInspiracion \? pedidoCompletoDePieza\(ultimoUsuario\) : null;/);
    assert.match(ruta, /const alcancePropuesta = alcanceDeBoton \?\? \(pedidoDirecto \? "individual" : null\);/, "alcance «individual»: solo propuesta y brief, sin buscar ideas");
    assert.match(ruta, /pedidoDirecto: pedidoDirecto \?/, "queda registrado en regla:alcance_turno_guiado");
  });

  await caso("I-7: el 429 motor_ocupado espera cada vez más, con jitter y tope de ~8 s (servidor)", async () => {
    const minimas = Array.from({ length: 12 }, (_, intento) => esperaMotorOcupado(intento, () => 0));
    const maximas = Array.from({ length: 12 }, (_, intento) => esperaMotorOcupado(intento, () => 1));
    assert.deepEqual(minimas.slice(0, 5), [75, 150, 300, 600, 800], "crece desde lo corto");
    assert.deepEqual(maximas.slice(0, 5), [150, 300, 600, 1200, 1600]);
    assert.ok(maximas.every((espera) => espera <= 1600), "con tope por espera");
    assert.equal(PRESUPUESTO_MOTOR_OCUPADO_MS, 8_000);
    // Antes: 3 reintentos de 120/240/360 ms (720 ms) frente a trabajos de 200-2900 ms. Ahora: hasta 8 s si el plazo da.
    const cubre = minimas.reduce((suma, espera) => (suma + espera <= PRESUPUESTO_MOTOR_OCUPADO_MS ? suma + espera : suma), 0);
    assert.ok(cubre > 2_900 * 2, `cubre más de dos trabajos largos seguidos (${cubre} ms)`);
    // Con red falsa: ocupado 4 veces (≈ 1,1–2,3 s de espera) y luego libre; con plazo amplio, sale bien.
    let intentos = 0;
    const ocupadoCuatro: typeof fetch = async () => {
      intentos += 1;
      if (intentos <= 4) return Response.json({ detail: { code: "motor_ocupado" } }, { status: 429, headers: { "Retry-After": "1" } });
      return Response.json({ schema_version: "operational.v1", request_id: REQUEST_ID, correlation_id: CORRELATION_ID, payload: { message: "python" } });
    };
    const inicio = Date.now();
    const ok = await llamarPythonEcho(entradaEcho(ocupadoCuatro, 20_000));
    assert.equal(ok.payload.message, "python");
    assert.equal(intentos, 5, "cuatro 429 y el quinto pasa (antes salía el 429 al cuarto)");
    assert.ok(Date.now() - inicio < 4_000, "y no espera de más");
    // Un 429 que no es del cupo de los motores no se reintenta; el que sigue ocupado sale con su código, acotado.
    let otros = 0;
    const otro = await llamarPythonEcho(entradaEcho(async () => { otros += 1; return Response.json({ detail: { code: "rate_limited" } }, { status: 429 }); }, 20_000)).then(() => null, (error: unknown) => error);
    assert.ok(isPythonAdapterError(otro) && otro.code === "PYTHON_BUSY");
    assert.equal(otros, 1);
    let siempre = 0;
    const fallo = await llamarPythonEcho(entradaEcho(async () => { siempre += 1; return Response.json({ detail: { code: "motor_ocupado" } }, { status: 429 }); }, 1_000)).then(() => null, (error: unknown) => error);
    assert.ok(isPythonAdapterError(fallo) && fallo.code === "PYTHON_BUSY" && fallo.domainCode === "motor_ocupado");
    assert.ok(siempre >= 2 && siempre <= 4, `el plazo de la llamada manda (${siempre} intentos en 1 s)`);
  });

  await caso("I-7: la gráfica espera turno sin error visible (sigue «cargando») y reintenta con espera creciente", async () => {
    assert.ok(INTENTOS_MOTOR_OCUPADO >= 4);
    assert.deepEqual([0, 1, 2, 3].map((intento) => esperaTrasOcupado(intento, "1", () => 0.5)), [1000, 2000, 4000, 4000], "1 s, 2 s, 4 s (tope)");
    assert.equal(esperaTrasOcupado(0, null, () => 0), 750, "sin Retry-After, 1 s ± 25 %");
    type Pendiente = (estado: number, datos?: unknown) => void;
    const pendientes: Pendiente[] = [];
    reiniciarGraficasParaPruebas((() => new Promise<Response>((resolver) => {
      pendientes.push((estado, datos) => resolver(new Response(JSON.stringify(datos ?? {}), { status: estado, headers: { "Content-Type": "application/json", "Retry-After": "0.005" } })));
    })) as typeof fetch);
    const clave = "ruta|v|EST_01|-||-";
    const grafica = pedirGrafica(clave, "/api/plan-armado-columna-organica", () => ({ estructura_id: "EST_01" }));
    for (let vez = 0; vez < INTENTOS_MOTOR_OCUPADO - 1; vez += 1) {
      while (!pendientes.length) await new Promise((listo) => setTimeout(listo, 5));
      pendientes.shift()!(429, { error: "ocupado" });
      await new Promise((listo) => setTimeout(listo, 1));
      assert.equal(graficaGuardada(clave), undefined, `tras el 429 n.º ${vez + 1} sigue «cargando», sin icono de fallo`);
    }
    while (!pendientes.length) await new Promise((listo) => setTimeout(listo, 5));
    pendientes.shift()!(200, { grafica: { svg: "<svg/>", ancho: 600, alto: 720 } });
    assert.equal((await grafica)?.svg, "<svg/>");
    assert.equal(contadores.pedidas, INTENTOS_MOTOR_OCUPADO);
  });

  // --- Menores -------------------------------------------------------------------------------------------------------
  const crudo = PlanGuiadoSchema.parse(leerJson("scripts/test/fixtures/plan-guiado-columnas-repetidas.json"));
  const separado = separarEstructurasRepetidas(crudo.plan).plan;
  const [, IZQUIERDA, DERECHA] = separado.estructuras.map((estructura) => estructura.estructura_id) as [string, string, string];
  const columna = crudo.estructuras[1]!;
  const conRosados = (izquierda: [number, number], derecha: [number, number]): PlanGuiado => {
    const lineas = (unidades: [number, number]) => { let rosado = 0; return columna.lineas.map((linea) => (linea.color === "rosado" ? { ...linea, unidades: unidades[rosado++]! } : linea)); };
    return PlanGuiadoSchema.parse({ ...crudo, approval_token: "token", plan: separado, estructuras: [crudo.estructuras[0]!, { ...columna, estructura_id: IZQUIERDA, lineas: lineas(izquierda) }, { ...columna, estructura_id: DERECHA, lineas: lineas(derecha) }] });
  };

  await caso("Menor 1: «Último ajuste» dice lo que quedó en cada pieza (la pareja recibe la diferencia, no la cifra)", () => {
    const antes = conRosados([5, 15], [5, 15]);
    const despues = conRosados([10, 14], [5, 15]);
    const indice = separado.estructuras[1]!.materiales.findIndex((material) => material.color === "rosado");
    const cambio = { tipo: "cantidad" as const, estructuraId: IZQUIERDA, indice, objetivo: 24, desde: 20, pareja: true };
    assert.equal(describirCambio(antes, cambio), "24 globos rosados en la columna izquierda y la columna derecha", "antes de saber el resultado, lo pedido");
    assert.equal(describirCambio(antes, cambio, despues), "24 globos rosados en la columna izquierda y 20 en la columna derecha");
    assert.match(confirmacionDelCambio(antes, cambio, undefined, despues), /la columna izquierda lleva 24 globos rosados y la columna derecha, 20 globos rosados\./);
    assert.match(leer("src/components/guiado/ajuste/usarAjustePlanGuiado.ts"), /const hecho = describirCambio\(base, cambio, nuevo\.plan\);/, "el hook publica lo que quedó");
  });

  await caso("Menor 2: «Hacer lo mismo…» viene marcado solo si las dos piezas son hoy iguales", () => {
    assert.equal(piezasAjustables(conRosados([5, 15], [5, 15]))[1]!.pareja?.iguales, true);
    assert.equal(piezasAjustables(conRosados([10, 14], [5, 15]))[1]!.pareja?.iguales, false, "columnas distintas (39 y 48 en el probador)");
    const ajustar = leer("src/components/guiado/ajuste/AjustarPlan.tsx");
    assert.match(ajustar, /useState<boolean \| null>\(null\)/);
    assert.match(ajustar, /aLasDos=\{aLasDos \?\? Boolean\(pieza\.pareja\?\.iguales\)\}/);
    assert.match(ajustar, /nota=\{pieza\.pareja\.iguales \? "quedan iguales" : /, "«quedan iguales» solo cuando es verdad");
  });

  await caso("Menor 3: «Así queda» dice la medida del plan mientras no se toque nada", async () => {
    const fixture = leerJson("scripts/fixtures/columna-organica-ui/vista-columna-organica.json") as { peticion: { estructura_id: string; armado_columna_organica: unknown; colores: string[] }; respuesta: Record<string, unknown> };
    const resuelto = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;
    const pieza: PiezaVistaColumnaOrganica = { plan: resuelto.plan, estructuraId: fixture.peticion.estructura_id, colores: fixture.peticion.colores };
    const armado = ArmadoColumnaOrganicaV1Schema.parse(fixture.peticion.armado_columna_organica);
    const vista = await pedirVistaArmadoColumnaOrganica(peticionVistaColumnaOrganica(pieza, armado), { fetcher: (async () => new Response(JSON.stringify(fixture.respuesta), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch });
    const declarada = resuelto.plan.estructuras.find((estructura) => estructura.estructura_id === pieza.estructuraId)!;
    const resuelta = resuelto.estructuras.find((estructura) => estructura.estructura_id === pieza.estructuraId)!;
    const leyenda = leyendaPatron(declarada.materiales, resuelta.lineas, undefined);
    const pintar = (medidasPlan?: { ancho_m?: number; alto_m?: number }) => renderToStaticMarkup(React.createElement(PanelColumnaOrganica, { estado: { fase: "listo", vista, actualizando: false, fallo: null }, leyenda, nombrePieza: "Columna", repeticiones: 1, onReintentar: () => {}, ...(medidasPlan ? { medidasPlan } : {}) }));
    const motor = pintar();
    assert.ok(!motor.includes("0,55 m"), "sin medidas del plan, las del motor");
    const conPlan = pintar({ ancho_m: 0.55, alto_m: 2 });
    assert.match(conPlan, /Ancho:<\/dt><dd[^>]*>0,55 m/);
    assert.match(conPlan, /Alto:<\/dt><dd[^>]*>2 m/);
    assert.match(leer("src/components/guiado/ModificarPieza.tsx"), /const medidasPlan = editor\.hayCambios \? undefined : /, "solo sin cambios");
  });

  await caso("Menor 4: el acabado que la foto muestra y el plan no compra se dice con discreción", () => {
    const lectura = { colores: [
      { clave: "rosado", nombre: "rosa satinado", color: "rosa", adjetivo: "satinado", hex: "#f4b6c2", acabado: "satin" as const, parte: 0.24, porcentaje: 24, sempertex: null },
      { clave: "plateado", nombre: "plata cromado", color: "plata", adjetivo: "cromado", hex: "#c0c0c0", acabado: "reflex" as const, parte: null, porcentaje: null, sempertex: null },
      { clave: "transparente", nombre: "transparente", color: "transparente", adjetivo: null, hex: "#ffffff", acabado: "cristal" as const, parte: null, porcentaje: null, sempertex: null },
    ] };
    const plan = { estructuras: [{ lineas: [
      { color: "rosado", titulo: "B2b Globo Latex Redondo Pastel Mate Rosado — R-12 / PAQUETE X 50", unidades: 57 },
      { color: "plateado", titulo: "B2b Globo Latex Redondo Reflex Plata — R-12", unidades: 42 },
      { color: "transparente", titulo: "Globo Latex Redondo Cristal Transparente — R-12", unidades: 16 },
    ] }] };
    assert.deepEqual(acabadosFotoSinComprar(lectura, plan), ["La foto muestra rosa satinado; tu plan lo lleva en acabado pastel."]);
    assert.deepEqual(acabadosFotoSinComprar(lectura, { estructuras: [{ lineas: [{ color: "rosado", titulo: "Globo Satín Rosado", unidades: 3 }] }] }), [], "con el mismo acabado no hay nada que decir");
    assert.match(leer("src/components/guiado/TarjetaPlan.tsx"), /\.\.\.\(avisosFoto \?\? \[\]\)\.map\(\(texto\) => \(\{ tipo: "color" as const, texto \}\)\)/, "va en «Ajustes que hice»");
    assert.match(leer("src/components/guiado/VistaGuiada.tsx"), /widget\.fotoInspiracion \? \{ avisosFoto: avisosFotoDelPlan\(mensajes, mensajeId, widget\.plan\) \}/);
  });

  if (fallos) {
    console.error(`\n${fallos} caso(s) fallaron.`);
    process.exit(1);
  }
  console.log("\nProbador 141: OK");
}

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000002";
function entradaEcho(fetchImpl: typeof fetch, deadlineMs: number) {
  return {
    payload: { message: "hello" }, requestId: REQUEST_ID, correlationId: CORRELATION_ID, bodySha256: sha256Body('{"message":"hello"}'), deadlineMs,
    env: { PYTHON_BACKEND_URL: "http://python.test", INTERNAL_HMAC_SECRET: "local-only-secret-0123456789abcdef" }, fetchImpl,
  };
}

void main().catch((error: unknown) => { console.error(error); process.exit(1); });
