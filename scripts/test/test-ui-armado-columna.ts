/**
 * UI de la columna armada con el motor del diseñador (ADR-0034, ADR-0035 paso 3). Render estático
 * (`renderToStaticMarkup`) y módulos sin React, como las pruebas de UI del arco, del patrón, del bouquet y de la
 * guirnalda: comprueba qué datos del motor llegan al decorador, no la animación. Sin red ni proveedores.
 *
 * La salida de Python es real: `scripts/fixtures/columna-ui/vista-columna.json` es la respuesta de
 * /api/plan-armado-columna para la columna `EST_01_COLUMNA` de
 * `scripts/fixtures/patron-color-ui/plan-con-patrones.json` —la columna colocada globo a globo, el SVG que emitió
 * el motor, sus herramientas y sus rangos—. Así la frontera del cliente se valida contra lo que el motor devuelve
 * de verdad y no contra un objeto escrito a mano que se desincroniza en silencio.
 *
 * Lo que esta prueba vigila es la regla de ADR-0034: **el cliente no recalcula**. Las medidas, el conteo y los
 * avisos que aparecen en la pantalla son los de la respuesta, carácter por carácter, y el dibujo es el SVG del
 * motor sin tocar. Y las reglas del editor (ADR-0035): cada mando cambia UN campo del armado, marca el borrador como
 * del decorador y nunca guarda sin que el motor lo haya dibujado.
 *
 * Run: npx tsx scripts/test/test-ui-armado-columna.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ControlesColumna, PanelColumna, claveVistaColumna, panelVistaColumna, peticionVistaColumna, puedeGuardarColumna, type PanelVistaColumna, type PiezaVistaColumna } from "@/components/plan/columna";
import {
  claveArmadoColumna,
  conAlto,
  conBase,
  conColor,
  conColorAgregado,
  conControl,
  conGloboGrande,
  conGlobosCapa,
  conModoAltura,
  conOtraVariacion,
  conPatron,
  conRemateColor,
  conRemateTipo,
  conTamanoAbajo,
  conUltimoColorQuitado,
  materialesParaPatron,
  mismoArmadoColumna,
  pasoDeMando,
  patronDisponible,
  rangoDeAlto,
  rangoDeFoil,
  rangoDeInflado,
  tamanosDeRemate,
  valorEnRango,
} from "@/components/plan/columna/borrador-columna";
import { alBorradorColumna, crearVistaBorradorColumna, panelDeBorradorColumna } from "@/components/plan/columna/vista-borrador-columna";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoColumnaV1Schema, type ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import { FalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoColumna, RESPALDO_VISTA_ARMADO_COLUMNA, type VistaArmadoColumna } from "@/lib/plan/peticion-armado-columna";
import type { OpcionesArmadoColumna } from "@/lib/plan/opciones-armado-columna";
import type { PlanResuelto } from "@/lib/plan/resuelto";

let casos = 0;
function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(prueba)
    .then(() => {
      casos += 1;
      console.log(`[PASS] ${nombre}`);
    })
    .catch((error: unknown) => {
      console.error(`[FAIL] ${nombre}`);
      throw error;
    });
}

const leerJson = (ruta: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as unknown;

const FIXTURE = leerJson("scripts/fixtures/columna-ui/vista-columna.json") as {
  peticion: { estructura_id: string; armado_columna: ArmadoColumnaV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const ARMADO = ArmadoColumnaV1Schema.parse(FIXTURE.peticion.armado_columna);
const PIEZA: PiezaVistaColumna = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
const DECLARADA = RESUELTO.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const RESUELTA = RESUELTO.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const LEYENDA = leyendaPatron(
  DECLARADA.materiales,
  RESUELTA.lineas,
  RESUELTO.patrones_color?.find((patron) => patron.estructura_id === ESTRUCTURA_ID)?.conteo,
);

/** Un `fetch` que contesta lo que se le dé, y anota el cuerpo con el que se le llamó. */
function fetcherDe(responder: () => { status: number; cuerpo: unknown }): { fetch: typeof fetch; cuerpos: unknown[] } {
  const cuerpos: unknown[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    cuerpos.push(JSON.parse(String(init?.body)) as unknown);
    const { status, cuerpo } = responder();
    return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetcher as unknown as typeof fetch, cuerpos };
}

async function vistaDeLaFixture(): Promise<VistaArmadoColumna> {
  const { fetch: fetcher } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
  return pedirVistaArmadoColumna(peticionVistaColumna(PIEZA, ARMADO), { fetcher });
}

function pintar(estado: PanelVistaColumna, repeticiones = 1): string {
  return renderToStaticMarkup(
    React.createElement(PanelColumna, { estado, leyenda: LEYENDA, nombrePieza: "Columna de la entrada", repeticiones, onReintentar: () => {} }),
  );
}

async function main(): Promise<void> {
  await caso("petición: solo el contrato de la ruta, con los tonos de la pieza y el armado tal cual", async () => {
    const { fetch: fetcher, cuerpos } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
    await pedirVistaArmadoColumna(peticionVistaColumna(PIEZA, ARMADO), { fetcher });
    assert.equal(cuerpos.length, 1);
    assert.deepEqual(Object.keys(cuerpos[0] as object).sort(), ["armado_columna", "colores", "estructura_id", "plan"]);
    const cuerpo = cuerpos[0] as { estructura_id: string; armado_columna: unknown; colores: string[] };
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
    assert.deepEqual(cuerpo.armado_columna, ARMADO, "el armado viaja sin tocar: sus mandos son del motor");
    assert.deepEqual(cuerpo.colores, FIXTURE.peticion.colores);
    // Sin tonos resueltos no se inventa ninguno: el motor dibuja en su gris y lo avisa.
    const { fetch: otro, cuerpos: sinTonos } = fetcherDe(() => ({ status: 200, cuerpo: FIXTURE.respuesta }));
    await pedirVistaArmadoColumna(peticionVistaColumna({ plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID }, ARMADO), { fetcher: otro });
    assert.ok(!("colores" in (sinTonos[0] as object)));
    // Pedir la receta es mandar el armado en `null`.
    assert.equal(peticionVistaColumna(PIEZA, null).armado_columna, null);
  });

  await caso("respuesta: la del motor pasa validada; una fuera del contrato no se dibuja", async () => {
    const vista = await vistaDeLaFixture();
    assert.equal(vista.columna.version, "armado-columna.v1");
    assert.ok(vista.columna.globos.length > 0, "el motor coloca cada globo");
    assert.ok(vista.grafica.svg.length > 1000, "el dibujo viene del motor, no de aquí");
    assert.deepEqual(vista.grafica.lienzo, { ancho: 600, alto: 720 }, "el lienzo de la columna no es cuadrado");
    assert.deepEqual(vista.armado, ARMADO, "el eco del armado es el que se pidió");
    assert.equal(vista.opciones.patrones.length, 9, "los nueve patrones de la columna");
    assert.ok(vista.limites.altoMin > 0 && vista.limites.foilMax > vista.limites.foilMin);
    for (const roto of [
      { ...FIXTURE.respuesta, columna: { ...(FIXTURE.respuesta.columna as object), globos: "muchos" } },
      { ...FIXTURE.respuesta, grafica: { lienzo: 600, svg: "<g/>" } },
      { ...FIXTURE.respuesta, opciones: {} },
      { ...FIXTURE.respuesta, limites: { altoMin: 1 } },
    ]) {
      const { fetch: fetcher } = fetcherDe(() => ({ status: 200, cuerpo: roto }));
      await assert.rejects(
        () => pedirVistaArmadoColumna(peticionVistaColumna(PIEZA, ARMADO), { fetcher }),
        (error: unknown) => error instanceof FalloPlanArmado && error.message === RESPALDO_VISTA_ARMADO_COLUMNA,
      );
    }
  });

  await caso("rechazo del motor: llega con la frase de Python y no se reintenta", async () => {
    const { fetch: fetcher } = fetcherDe(() => ({
      status: 422,
      cuerpo: { error: "armado_invalido", motivo: "material_fuera_de_rango", mensaje: "El armado nombra un color que la columna no lleva." },
    }));
    await assert.rejects(
      () => pedirVistaArmadoColumna(peticionVistaColumna(PIEZA, ARMADO), { fetcher }),
      (error: unknown) =>
        error instanceof FalloPlanArmado
        && error.armadoInvalido
        && error.motivo === "material_fuera_de_rango"
        && error.message === "El armado nombra un color que la columna no lleva.",
    );
  });

  await caso("clave: la pieza, su armado y sus tonos; el resto del plan no mueve el dibujo", () => {
    const clave = claveVistaColumna(PIEZA, ARMADO);
    assert.equal(clave, claveVistaColumna({ ...PIEZA, plan: { ...RESUELTO.plan, supuestos: ["otro supuesto"] } }, ARMADO));
    assert.notEqual(clave, claveVistaColumna({ ...PIEZA, estructuraId: "EST_09_OTRO" }, ARMADO));
    assert.notEqual(clave, claveVistaColumna({ ...PIEZA, colores: ["#000000", "#1f4fbf", "#c9a227"] }, ARMADO));
    assert.notEqual(clave, claveVistaColumna(PIEZA, { ...ARMADO, patron: "solido" }));
    // El eco de Python puede traer las claves en otro orden: el mismo armado es la misma clave.
    const alRevés = Object.fromEntries(Object.entries(ARMADO).reverse()) as ArmadoColumnaV1;
    assert.equal(clave, claveVistaColumna(PIEZA, alRevés));
  });

  await caso("fases: cargando, vacío, error, y el dibujo anterior mientras llega el nuevo", async () => {
    const vista = await vistaDeLaFixture();
    const clave = claveVistaColumna(PIEZA, ARMADO);
    assert.deepEqual(panelVistaColumna(clave, null, null), { fase: "cargando" });
    assert.deepEqual(panelVistaColumna(clave, null, { clave, mensaje: "No se arma.", armadoInvalido: true }), { fase: "vacio", mensaje: "No se arma." });
    assert.deepEqual(panelVistaColumna(clave, null, { clave, mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "error", mensaje: "Sin conexión." });
    assert.deepEqual(panelVistaColumna(clave, { clave, vista }, null), { fase: "listo", vista, actualizando: false, fallo: null });
    assert.deepEqual(panelVistaColumna("otra", { clave, vista }, null), { fase: "listo", vista, actualizando: true, fallo: null });
    assert.deepEqual(panelVistaColumna("otra", { clave, vista }, { clave: "otra", mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "listo", vista, actualizando: false, fallo: "Sin conexión." });
    assert.deepEqual(panelVistaColumna(clave, null, { clave: "otra", mensaje: "Sin conexión.", armadoInvalido: false }), { fase: "cargando" });
  });

  await caso("la columna dibujada: el SVG del motor y sus cifras, sin recalcular ninguna", async () => {
    const vista = await vistaDeLaFixture();
    const { columna, grafica } = vista;
    const html = pintar({ fase: "listo", vista, actualizando: false, fallo: null }, 2);
    assert.ok(html.includes('aria-label="Armado de la columna"'));
    // El dibujo es el del motor, carácter por carácter: si la pantalla lo volviera a pintar, esto cambiaría.
    assert.ok(html.includes(grafica.svg), "el SVG del motor entra tal cual");
    assert.ok(html.includes(`viewBox="0 0 ${grafica.lienzo.ancho} ${grafica.lienzo.alto}"`), "con el lienzo vertical del motor");
    assert.ok(html.includes('role="img"') && html.includes("Columna de la entrada: columna de"), "texto alternativo descriptivo");
    // Las medidas reales de la columna armada, no las declaradas en el plan.
    const metros = (valor: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(valor);
    for (const medida of [columna.alto_total_m, columna.alto_cuerpo_m, columna.diametro_m]) {
      assert.ok(html.includes(`${metros(medida)} m`), `falta la medida ${medida}`);
    }
    assert.ok(html.includes(`>${columna.capas}<`) || html.includes(String(columna.capas)), "falta el número de capas");
    // El conteo del motor, cifra por cifra: por color y por tamaño.
    for (const linea of columna.conteo) {
      assert.ok(html.includes(`>${linea.cantidad}<`), `falta el conteo de ${linea.material}`);
      assert.ok(html.includes(`>R${linea.tamano}<`), `falta el tamaño de ${linea.material}`);
    }
    // El remate lo describe el motor.
    assert.ok(html.includes(columna.remate.descripcion), "falta la descripción del remate");
    assert.ok(html.includes("2 iguales"), "las cifras son de una sola columna");
    // La compra no se pinta: la cuenta plan.py y la columna resuelta no la publica.
    assert.ok(!html.includes("Comprar") && !html.includes("Total a comprar"));
    // El nombre del patrón lo escribe el motor.
    const patron = vista.opciones.patrones.find((descrito) => descrito.id === vista.armado.patron)!;
    assert.ok(html.includes(patron.nombre));
  });

  await caso("los avisos del motor se leen, no se tiran", async () => {
    const vista = await vistaDeLaFixture();
    const avisos = ["El alto se ajustó a 1,6 m para que quepan las capas.", "El remate pasó a R12 para guardar proporción."];
    const conAvisos: VistaArmadoColumna = { ...vista, columna: { ...vista.columna, avisos } };
    const html = pintar({ fase: "listo", vista: conAvisos, actualizando: false, fallo: null });
    assert.ok(html.includes('aria-label="Avisos del armado"'));
    for (const aviso of avisos) assert.ok(html.includes(aviso), `falta el aviso: ${aviso}`);
  });

  await caso("estados sin dibujo: cargando con role status, vacío con la frase y error con Reintentar", () => {
    const cargando = pintar({ fase: "cargando" });
    assert.ok(cargando.includes('role="status"') && cargando.includes('data-fase="cargando"'));
    assert.ok(!cargando.includes("<button"), "cargando no ofrece nada que tocar");
    const vacio = pintar({ fase: "vacio", mensaje: "La columna no se puede armar con estos globos." });
    assert.ok(vacio.includes("La columna no se puede armar con estos globos."));
    assert.ok(!vacio.includes("Reintentar"), "un rechazo del motor no se reintenta");
    const error = pintar({ fase: "error", mensaje: "No pude dibujar la columna." });
    assert.ok(error.includes('role="alert"'));
    assert.ok(error.includes('type="button"') && error.includes("Reintentar"), "control semántico y enfocable");
  });

  // --- El editor (ADR-0035, paso 3) ---------------------------------------------------------------------

  await caso("el borrador: cada mando cambia UN campo y lo marca como del decorador", async () => {
    const sugerido: ArmadoColumnaV1 = { ...ARMADO, origen: "sugerido" };
    const cambiado = conAlto(sugerido, 2.4);
    assert.equal(cambiado.origen, "decorador");
    assert.deepEqual({ ...cambiado, cuerpo: sugerido.cuerpo, origen: "sugerido" }, sugerido, "solo cambió el alto");
    assert.equal(cambiado.cuerpo.alto_m, 2.4);
    assert.equal(conGlobosCapa(sugerido, 5).cuerpo.globos_capa, 5);
    assert.equal(conTamanoAbajo(sugerido, 18).cuerpo.abajo, 18);
    assert.equal(conBase(sugerido, !sugerido.cuerpo.base).cuerpo.base, !sugerido.cuerpo.base);
    assert.equal(conRemateTipo(sugerido, "estrella").remate.tipo, "estrella");
    assert.equal(conRemateColor(sugerido, 2).remate.material, 2);
    // El globo grande de arriba se quita y se pone: apagado es «ninguno», encendido es «globo».
    const sinGlobo = conGloboGrande({ ...sugerido, remate: { ...sugerido.remate, tipo: "globo" } }, false);
    assert.equal(sinGlobo.remate.tipo, "ninguno");
    assert.equal(sinGlobo.origen, "decorador");
    assert.equal(conGloboGrande(sinGlobo, true).remate.tipo, "globo");
    assert.equal(conGloboGrande({ ...sugerido, remate: { ...sugerido.remate, tipo: "racimo" } }, true).remate.tipo, "globo", "encender lo reemplaza por un globo");
    assert.equal(conGloboGrande(sinGlobo, false), sinGlobo, "ya estaba apagado: el borrador no cambia");
    assert.equal(conOtraVariacion(sugerido).inflado.semilla, sugerido.inflado.semilla + 1);
    assert.equal(conOtraVariacion({ ...sugerido, inflado: { ...sugerido.inflado, semilla: 99999 } }).inflado.semilla, 1, "la semilla da la vuelta");
    // Lo que no cambia, no cambia el borrador (ni lo vuelve del decorador).
    assert.equal(conGlobosCapa(sugerido, sugerido.cuerpo.globos_capa), sugerido);
    assert.equal(conTamanoAbajo(sugerido, sugerido.cuerpo.abajo), sugerido);
    assert.ok(mismoArmadoColumna(sugerido, { ...sugerido, origen: "decorador" }), "quién lo firmó no cuenta");
    assert.notEqual(claveArmadoColumna(sugerido), claveArmadoColumna(cambiado));
  });

  await caso("el patrón: cambia de patrón con los colores de la pieza y sus mandos del motor", async () => {
    const vista = await vistaDeLaFixture();
    const solido = vista.opciones.patrones.find((patron) => patron.id === "solido")!;
    const ombre = vista.opciones.patrones.find((patron) => patron.id === "ombre")!;
    const sobre = conPatron(ARMADO, solido, 3);
    assert.deepEqual([sobre.patron, sobre.opciones, sobre.materiales, sobre.modo], ["solido", {}, [0], "altura"], "el sólido usa un color");
    assert.equal(conPatron(sobre, solido, 3), sobre, "elegir el mismo patrón no cambia nada");
    assert.deepEqual(conPatron(ARMADO, ombre, 3).materiales, [0, 1, 2], "los demás toman los colores de la pieza");
    assert.equal(patronDisponible(ombre, 2), false, "el ombré pide tres colores");
    assert.equal(patronDisponible(ombre, 3), true);
    assert.deepEqual(materialesParaPatron(solido, 3), [0]);
    // Un mando que el contrato no admite deja el borrador como estaba.
    assert.equal(conControl(ARMADO, "vueltas", 2).opciones.vueltas, 2);
    assert.equal(conControl(ARMADO, "no_existe", 1), ARMADO);
    assert.equal(conControl(ARMADO, "vueltas", 9999), ARMADO, "fuera del rango del contrato");
    assert.equal(pasoDeMando({ clave: "inclinacion" }), 0.1);
    assert.equal(pasoDeMando({ clave: "vueltas" }), 1);
    // Una columna por capas vuelve a «por altura» al elegir un patrón o al pedirlo, y sin capas.
    const porCapas: ArmadoColumnaV1 = { ...ARMADO, modo: "capas", capas: [{ tamano: 12, materiales: [0, 1, 2] }] };
    const vuelta = conModoAltura(porCapas);
    assert.deepEqual([vuelta.modo, vuelta.capas], ["altura", []]);
    assert.deepEqual([conPatron(porCapas, solido, 3).modo, conPatron(porCapas, solido, 3).capas], ["altura", []]);
  });

  await caso("los colores del patrón: se eligen uno por uno y se agregan o quitan dentro de lo que cabe", async () => {
    const vista = await vistaDeLaFixture();
    const espiral = vista.opciones.patrones.find((patron) => patron.id === "espiral")!;
    const dos: ArmadoColumnaV1 = { ...ARMADO, materiales: [0, 1] };
    assert.deepEqual(conColor(dos, 1, 2).materiales, [0, 2]);
    assert.equal(conColor(dos, 7, 2), dos, "una posición que no existe no cambia nada");
    assert.deepEqual(conColorAgregado(dos, espiral, 3).materiales, [0, 1, 2], "agrega el primer color de la pieza sin usar");
    assert.equal(conColorAgregado({ ...dos, materiales: [0, 1, 2, 0, 1, 2, 0, 1] }, espiral, 3).materiales.length, 8, "el tope del contrato son ocho");
    assert.deepEqual(conUltimoColorQuitado({ ...dos, materiales: [0, 1, 2] }, espiral).materiales, [0, 1]);
    assert.equal(conUltimoColorQuitado(dos, espiral), dos, "no baja del mínimo del patrón");
  });

  await caso("el remate: qué tamaños caben, lo dice el motor", async () => {
    const vista = await vistaDeLaFixture();
    assert.deepEqual(tamanosDeRemate(vista.limites, "globo"), vista.limites.rematesGlobo);
    assert.deepEqual(tamanosDeRemate(vista.limites, "racimo"), vista.limites.rematesRacimo);
    assert.deepEqual(tamanosDeRemate(vista.limites, "estrella"), [], "el foil no elige tamaño de globo");
  });

  await caso("los rangos salen del motor y del contrato, no de la interfaz", async () => {
    const vista = await vistaDeLaFixture();
    const alto = rangoDeAlto(vista.limites);
    assert.deepEqual([alto.min, alto.max], [vista.limites.altoMin, vista.limites.altoMax]);
    const foil = rangoDeFoil(vista.limites);
    assert.deepEqual([foil.min, foil.max], [vista.limites.foilMin, vista.limites.foilMax]);
    // El inflado lo publica el contrato (`armado-columna.v1`), que el propio motor usa para acotarlo.
    const inflado = rangoDeInflado("inflado", 0.05);
    assert.deepEqual([inflado.min, inflado.max], [0.8, 1.1]);
    assert.equal(valorEnRango(0.5, alto), alto.min, "un control no enseña un valor fuera de su rango");
    assert.equal(valorEnRango(99, alto), alto.max);
    // El alto mínimo y máximo vienen de los límites vivos: son los que el motor da para este armado.
    assert.ok(alto.max > alto.min);
  });

  await caso("los ajustes: lo que el motor ofrece, con nombres de persona y sin jerga", async () => {
    const vista = await vistaDeLaFixture();
    const html = renderToStaticMarkup(
      React.createElement(ControlesColumna, { borrador: ARMADO, opciones: vista.opciones, limites: vista.limites, leyenda: LEYENDA, onCambiar: () => {} }),
    );
    assert.ok(html.includes('data-testid="controles-columna"'));
    for (const apartado of ["Diseño de color", "Forma y tamaño", "Remate", "Globos"]) assert.ok(html.includes(apartado), `falta el apartado ${apartado}`);
    for (const patron of vista.opciones.patrones) assert.ok(html.includes(patron.nombre), `falta el patrón ${patron.nombre}`);
    assert.ok(html.includes('data-testid="mando-globo-grande"') && html.includes("Globo grande arriba"), "el interruptor del globo grande está a la vista, sin abrir nada");
    for (const mando of ["Vueltas", "Inclinación", "Alto", "Globos por capa", "Capas escalonadas", "Base con peso", "Qué tan inflados", "Globos fuera de su lugar", "Otra variación"]) {
      assert.ok(html.includes(mando), `falta el mando ${mando}`);
    }
    // Una columna por capas dice que el patrón no decide nada y ofrece pasar a un patrón.
    const porCapas = renderToStaticMarkup(
      React.createElement(ControlesColumna, {
        borrador: { ...ARMADO, modo: "capas", capas: [{ tamano: 12, materiales: [0, 1, 2] }] },
        opciones: vista.opciones,
        limites: vista.limites,
        leyenda: LEYENDA,
        onCambiar: () => {},
      }),
    );
    assert.ok(porCapas.includes('data-testid="columna-por-capas"') && porCapas.includes("Armarla con un patrón"));
    // Sin jerga de desarrollo ni claves del contrato a la vista.
    assert.ok(!/null|undefined|armado_columna|alto_m|globos_capa|variacion_tam/.test(html.replace(/data-testid="[^"]*"/g, "").replace(/ id="[^"]*"/g, "")), "sin claves técnicas a la vista");
    // Cada control mide al menos 44 px de alto en lo que se toca.
    assert.ok(html.includes("min-h-11"), "los botones y selectores miden 44 px");
  });

  await caso("cada mando del patrón se nombra en palabras de oficio; la clave cruda del motor no se enseña nunca", async () => {
    const vista = await vistaDeLaFixture();
    const leer = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const pintarControles = (opciones: OpcionesArmadoColumna, borrador: ArmadoColumnaV1) =>
      renderToStaticMarkup(React.createElement(ControlesColumna, { borrador, opciones, limites: vista.limites, leyenda: LEYENDA, onCambiar: () => {} }));
    // Patrón por patrón: ninguno cae en el nombre de reserva, así que todos los mandos que el motor publica hoy
    // tienen su nombre aquí; y ninguna clave del motor (`sepCapas`, `variacion_tam`) llega a la pantalla.
    const leidos: string[] = [];
    for (const patron of vista.opciones.patrones) {
      const leido = leer(pintarControles(vista.opciones, conPatron(ARMADO, patron, LEYENDA.length)));
      leidos.push(leido);
      assert.ok(!leido.includes("Otro ajuste de este patrón"), `el patrón ${patron.id} trae un mando que esta pantalla no sabe nombrar`);
      for (const control of patron.controles) {
        if (/[A-Z_]/.test(control.clave)) assert.ok(!leido.includes(control.clave), `clave cruda del motor a la vista: ${patron.id}.${control.clave}`);
      }
    }
    const todo = leidos.join(" ");
    // La jerga del motor que esta pantalla ya no enseña, y el nombre de oficio que se lee en su lugar.
    for (const jerga of [/\bDesorden\b/, /\bInflado\b/, /Qué tan marcado(?! el zigzag)/, /Qué tan apretados(?! van en la capa)/]) {
      assert.ok(!jerga.test(todo), `jerga del motor a la vista: ${jerga.source}`);
    }
    for (const oficio of ["Qué tan marcado el zigzag", "Qué tan apretados van en la capa", "Globos fuera de su lugar", "Qué tan inflados"]) {
      assert.ok(todo.includes(oficio), `falta el mando en palabras de oficio: ${oficio}`);
    }
    // Un mando que el motor añada y que aquí todavía no tenga nombre se sigue ofreciendo, pero con una frase: antes
    // esta pantalla enseñaba la clave tal cual (`?? { etiqueta: control.clave }`).
    const conMandoNuevo: OpcionesArmadoColumna = {
      ...vista.opciones,
      patrones: vista.opciones.patrones.map((patron) =>
        patron.id === ARMADO.patron ? { ...patron, controles: [...patron.controles, { clave: "turbulenciaFase", min: 0, max: 3, defecto: 1 }] } : patron,
      ),
    };
    const html = pintarControles(conMandoNuevo, ARMADO);
    assert.ok(html.includes('data-testid="mando-patron-turbulenciaFase"'), "el mando se sigue ofreciendo: solo cambia cómo se llama");
    assert.ok(!leer(html).includes("turbulenciaFase"), "la clave del motor no se lee en la pantalla");
    assert.ok(leer(html).includes("Otro ajuste de este patrón"), "se nombra con una frase de oficio mientras falte su nombre");
  });

  await caso("guardar: solo con un borrador que el motor ya dibujó y con cambios", () => {
    const base = { hayCambios: true, guardando: false, ocupado: false };
    const listo = { borrador: "listo" as const, error: null };
    assert.deepEqual(puedeGuardarColumna({ ...base, estado: listo }), { puede: true });
    assert.deepEqual(puedeGuardarColumna({ ...base, hayCambios: false, estado: listo }), { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" });
    const pendiente = puedeGuardarColumna({ ...base, estado: { borrador: "pendiente", error: null } });
    assert.ok(!pendiente.puede && pendiente.tipo === "espera");
    const rechazado = puedeGuardarColumna({ ...base, estado: { borrador: "rechazado", error: { mensaje: "El alto no cabe.", armadoInvalido: true } } });
    assert.ok(!rechazado.puede && rechazado.tipo === "error" && rechazado.motivo === "El alto no cabe.");
    assert.ok(!puedeGuardarColumna({ ...base, ocupado: true, estado: listo }).puede, "otro ajuste se está guardando");
    assert.ok(!puedeGuardarColumna({ ...base, guardando: true, estado: listo }).puede);
    const colores = puedeGuardarColumna({ ...base, coloresCambiaron: true, estado: listo });
    assert.ok(!colores.puede && colores.tipo === "colores", "los colores de la pieza cambiaron bajo el borrador");
  });

  await caso("el controlador del borrador: pausa, gana el último y no pinta respuestas viejas", async () => {
    const vista = await vistaDeLaFixture();
    const trabajos: Array<() => void> = [];
    const reloj = (accion: () => void) => {
      trabajos.push(accion);
      return () => {
        const posicion = trabajos.indexOf(accion);
        if (posicion >= 0) trabajos.splice(posicion, 1);
      };
    };
    const pedidos: string[] = [];
    const respuestas = new Map<string, (vista: VistaArmadoColumna) => void>();
    const control = crearVistaBorradorColumna({
      pedir: (armado) => new Promise<VistaArmadoColumna>((resolver) => {
        pedidos.push(claveArmadoColumna(armado));
        respuestas.set(claveArmadoColumna(armado), resolver);
      }),
      inicial: vista,
      reloj,
    });
    // Con el dibujo del plan en la mano, el borrador a la vista es ese y no hay nada pendiente.
    assert.equal(control.estado().borrador, "listo");
    const uno = conAlto(ARMADO, 2.1);
    const dos = conAlto(ARMADO, 2.3);
    control.mostrar(uno);
    control.mostrar(dos);
    assert.equal(trabajos.length, 1, "dos cambios seguidos esperan una sola pausa");
    trabajos.shift()!();
    assert.deepEqual(pedidos, [claveArmadoColumna(dos)], "se pide el último borrador, no el primero");
    assert.equal(control.estado().borrador, "pendiente");
    respuestas.get(claveArmadoColumna(dos))!({ ...vista, armado: dos });
    await Promise.resolve();
    assert.equal(control.estado().borrador, "listo");
    // El estado para el borrador de ESTE render: el "listo" de otro no vale para el nuevo.
    assert.equal(alBorradorColumna(control.estado(), uno).borrador, "pendiente");
    assert.equal(panelDeBorradorColumna(alBorradorColumna(control.estado(), dos)).fase, "listo");
    control.cerrar();
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
