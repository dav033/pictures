/**
 * Editor de arcos orgánicos del motor con vista previa en vivo (ADR-0035). Módulos sin React y render estático,
 * sin red ni proveedores, como `test-ui-editor-columna-organica.ts`. La salida del motor es REAL:
 * `vista-arco-organico.json` (el arco colocado globo a globo, su SVG, sus herramientas y sus rangos vivos), escrita
 * por Python. Nada de lo que el motor decide está escrito a mano aquí.
 *
 * Lo que vigila:
 * - **el cliente no calcula**: el armado que se manda al motor es exactamente el borrador, y cada cambio del
 *   borrador es UN campo; los rangos y los textos de los mandos son los del motor, cifra por cifra;
 * - **el medio arco es este mismo armado** cortado antes de bajar (`forma.corte` menor que 1) y su espejo, que es
 *   lo único que la taxonomía de 12 clases dejó para un semiarco;
 * - **los rangos viven en el motor**: el alto, el ancho y los dos grosores salen de `limites_de`, y lo que el motor
 *   no publica sale del contrato `armado-arco-organico.v1`, no de un número escrito aquí;
 * - **operación concurrente**: pausa, cancelación, gana la última respuesta y una respuesta vieja nunca se pinta;
 * - **estados explícitos**, con el fallo del motor y su «Reintentar» saliendo del estado del dibujo y no de si se
 *   puede guardar, y Guardar solo con un dibujo del motor.
 *
 * **Lo que esta prueba no cubre y por qué**: la edición `armado_arco_organico` del plan todavía no existe (ni
 * `edicion-esquemas.ts` la declara ni `services/ai-api/app/plan_edicion.py` la aplica), así que no hay ruta de
 * guardado que probar; `puedeGuardarArcoOrganico` sí se prueba, que es la decisión del cliente. Tampoco hay
 * fixture de `limites_de` por grosor —la de la columna es `limites-por-grosor.json`—, así que los rangos se
 * comprueban contra los `limites` reales de la única respuesta que hay, campo por campo.
 *
 * Run: npx tsx scripts/test/test-ui-editor-arco-organico.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Reloj } from "@/components/plan/autoguardado";
import { PanelArcoOrganico } from "@/components/plan/arco-organico/BloqueArcoOrganico";
import {
  conAcabado,
  conAdorno,
  conColorAgregado,
  conColorQuitado,
  conEstilo,
  conForma,
  conFormaLista,
  conInterruptorDeForma,
  conMaterial,
  conMezclaDeColores,
  conPesoDeColor,
  conPesoDeTamano,
  conReparto,
  conRol,
  conSemilla,
  conTamanos,
  conVolumen,
  mismoArmadoArcoOrganico,
  pesoDeTamano,
  rangoDeAlto,
  rangoDeAncho,
  rangoDeGrosorCima,
  rangoDeGrosorPatas,
  rangoDelContrato,
  valorEnRango,
} from "@/components/plan/arco-organico/borrador-arco-organico";
import { ControlesArcoOrganico } from "@/components/plan/arco-organico/ControlesArcoOrganico";
import { EditorArcoOrganico } from "@/components/plan/arco-organico/EditorArcoOrganico";
import { puedeGuardarArcoOrganico } from "@/components/plan/arco-organico/guardar-arco-organico";
import { peticionVistaArcoOrganico, type PiezaVistaArcoOrganico } from "@/components/plan/arco-organico/vista-arco-organico";
import {
  alBorradorArcoOrganico,
  crearVistaBorradorArcoOrganico,
  panelDeBorradorArcoOrganico,
  type EstadoVistaBorradorArcoOrganico,
} from "@/components/plan/arco-organico/vista-borrador-arco-organico";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoArcoOrganicoV1Schema, FormaArcoOrganicoSchema, type ArmadoArcoOrganicoV1 } from "@/lib/plan/armado-arco-organico";
import type { LimitesArcoOrganico } from "@/lib/plan/opciones-armado-arco-organico";
import { FalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoArcoOrganico, type VistaArmadoArcoOrganico } from "@/lib/plan/peticion-armado-arco-organico";
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

const FIXTURE = leerJson("scripts/fixtures/arco-organico-ui/vista-arco-organico.json") as {
  peticion: { estructura_id: string; armado_arco_organico: ArmadoArcoOrganicoV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const BASE = ArmadoArcoOrganicoV1Schema.parse(FIXTURE.peticion.armado_arco_organico);
const PIEZA: PiezaVistaArcoOrganico = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
const DECLARADA = RESUELTO.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const RESUELTA = RESUELTO.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const LEYENDA = leyendaPatron(DECLARADA.materiales, RESUELTA.lineas, undefined);
const COLORES_DE_PIEZA = LEYENDA.length;

/**
 * Frases de prueba para el camino del error. **No son del motor**: lo que se vigila es que la frase que llegue se
 * muestre tal cual y que un rechazo no se reintente, no su redacción —esa es de Python y viaja en la respuesta—.
 */
const RECHAZO = { motivo: "armado_invalido", mensaje: "Una frase del motor sobre por qué este arco no se sostiene." };
const SIN_CONEXION = "Sin conexión.";

/** El dibujo del motor de la fixture, validado por la misma frontera que usa la pantalla. */
async function vistaDeLaFixture(): Promise<VistaArmadoArcoOrganico> {
  const fetcher = (async () => new Response(JSON.stringify(FIXTURE.respuesta), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  return pedirVistaArmadoArcoOrganico(peticionVistaArcoOrganico(PIEZA, BASE), { fetcher });
}

/** Rutas hasta cada hoja que distingue dos armados. */
function diferencias(a: unknown, b: unknown, ruta = ""): string[] {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...claves].flatMap((clave) => diferencias((a as Record<string, unknown>)[clave], (b as Record<string, unknown>)[clave], `${ruta}.${clave}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [ruta];
}

// --- Un reloj y un puerto simulados ------------------------------------------------------------------------------

function relojFalso() {
  let ahora = 0;
  const pendientes = new Map<number, { en: number; accion: () => void }>();
  let id = 0;
  const reloj: Reloj = (accion, ms) => {
    const propio = ++id;
    pendientes.set(propio, { en: ahora + ms, accion });
    return () => { pendientes.delete(propio); };
  };
  return {
    reloj,
    avanzar(ms: number) {
      ahora += ms;
      for (const [clave, tarea] of [...pendientes]) {
        if (tarea.en <= ahora) {
          pendientes.delete(clave);
          tarea.accion();
        }
      }
    },
    pendientes: () => pendientes.size,
  };
}

type Peticion = { armado: ArmadoArcoOrganicoV1; signal: AbortSignal; resolver: (vista: VistaArmadoArcoOrganico) => void; rechazar: (error: unknown) => void };

function puertoFalso() {
  const peticiones: Peticion[] = [];
  const pedir = (armado: ArmadoArcoOrganicoV1, signal: AbortSignal): Promise<VistaArmadoArcoOrganico> =>
    new Promise<VistaArmadoArcoOrganico>((resolver, rechazar) => {
      signal.addEventListener("abort", () => rechazar(new DOMException("cancelada", "AbortError")));
      peticiones.push({ armado, signal, resolver, rechazar });
    });
  return { pedir, peticiones };
}

/** Un dibujo del motor "de" un armado: el de la fixture con su eco cambiado (el puerto simulado no calcula nada). */
function vistaDe(base: VistaArmadoArcoOrganico, armado: ArmadoArcoOrganicoV1, marca: string): VistaArmadoArcoOrganico {
  return { ...base, armado, arco: { ...base.arco, avisos: [marca] } };
}

const tick = () => new Promise<void>((listo) => setTimeout(listo, 0));

async function main(): Promise<void> {
  const VISTA = await vistaDeLaFixture();

  await caso("el borrador: cada cambio es UN campo del armado, marcado del decorador, sin tocar el original", () => {
    const copia = structuredClone(BASE);
    const casosCambio: Array<[string, ArmadoArcoOrganicoV1, string]> = [
      ["ancho", conForma(BASE, "anchoM", 4.2), ".forma.anchoM"],
      ["alto", conForma(BASE, "altoM", 2.8), ".forma.altoM"],
      ["cima", conForma(BASE, "cima", 0.55), ".forma.cima"],
      ["curva", conForma(BASE, "curva", 2.8), ".forma.curva"],
      ["ondulación", conForma(BASE, "ondulacion", 0.6), ".forma.ondulacion"],
      ["lado cargado", conForma(BASE, "carga", -0.5), ".forma.carga"],
      ["hasta dónde llega", conForma(BASE, "corte", 0.8), ".forma.corte"],
      ["espejo", conInterruptorDeForma(BASE, "espejo", !BASE.forma.espejo), ".forma.espejo"],
      ["suelo", conInterruptorDeForma(BASE, "suelo", !BASE.forma.suelo), ".forma.suelo"],
      ["grosor en los pies", conVolumen(BASE, "grosorPatasM", 0.9), ".volumen.grosorPatasM"],
      ["grosor en la cima", conVolumen(BASE, "grosorCimaM", 0.6), ".volumen.grosorCimaM"],
      ["relleno", conVolumen(BASE, "relleno", 0.7), ".volumen.relleno"],
      ["qué tan desparejo", conVolumen(BASE, "irregularidad", 0.6), ".volumen.irregularidad"],
      ["racimo", conVolumen(BASE, "racimo", 4), ".volumen.racimo"],
      ["salientes", conVolumen(BASE, "salientes", 0.5), ".volumen.salientes"],
      ["inflado", conTamanos(BASE, "inflado", 0.9), ".tamanos.inflado"],
      ["grandes abajo", conTamanos(BASE, "grandesAbajo", 0.3), ".tamanos.grandesAbajo"],
      ["variación", conTamanos(BASE, "variacion", 0.2), ".tamanos.variacion"],
      ["reparto", conReparto(BASE, "racimos"), ".colores.reparto"],
      ["mezcla entre colores", conMezclaDeColores(BASE, 0.9), ".colores.mezcla"],
      ["follaje", conAdorno(BASE, "follaje", 1.5), ".adornos.follaje"],
      ["flores", conAdorno(BASE, "flores", 1.5), ".adornos.flores"],
      ["otra disposición", conSemilla(BASE, 4242), ".aspecto.semilla"],
    ];
    for (const [nombre, siguiente, campo] of casosCambio) {
      assert.deepEqual(diferencias(BASE, siguiente).filter((ruta) => ruta !== ".origen"), [campo], `${nombre}: debe cambiar solo ${campo}`);
      assert.equal(siguiente.origen, "decorador", `${nombre}: lo cambió el decorador`);
      assert.ok(ArmadoArcoOrganicoV1Schema.safeParse(siguiente).success, `${nombre}: sigue cumpliendo armado-arco-organico.v1`);
    }
    assert.deepEqual(BASE, copia, "el armado original no se muta");
    // Lo que el contrato no admite deja el borrador como estaba, sin inventar un valor.
    assert.equal(conForma(BASE, "anchoM", 99), BASE);
    assert.equal(conForma(BASE, "corte", 0.2), BASE, "un corte por debajo del mínimo del contrato no se admite");
    assert.equal(conVolumen(BASE, "racimo", 2.5), BASE);
    assert.equal(conMezclaDeColores(BASE, 4), BASE);
    assert.equal(conSemilla(BASE, 0), BASE);
    assert.equal(conSemilla(BASE, 100000), BASE);
    // Y lo que no cambia, no se vuelve a crear.
    assert.equal(conReparto(BASE, BASE.colores.reparto), BASE);
    assert.equal(conInterruptorDeForma(BASE, "suelo", BASE.forma.suelo), BASE);
    assert.ok(mismoArmadoArcoOrganico(BASE, { ...BASE, origen: "decorador" }), "quién lo firmó no lo vuelve otro armado");
    assert.ok(!mismoArmadoArcoOrganico(BASE, conForma(BASE, "altoM", 2.8)));
  });

  await caso("las formas listas y los estilos son los del motor: se copian sus campos, sin escribir una cifra aquí", () => {
    const { formas, estilos } = VISTA.opciones;
    assert.equal(formas.length, 15);
    for (const lista of formas) {
      const aplicada = conFormaLista(BASE, lista);
      assert.ok(ArmadoArcoOrganicoV1Schema.safeParse(aplicada).success, `${lista.id}: sigue cumpliendo el contrato`);
      // La silueta va COMPLETA, al contrario que en la columna: un medio arco es una forma lista con su `corte` y
      // su `espejo`, así que recortarla aquí haría imposible elegir uno.
      assert.deepEqual(aplicada.forma, lista.forma, `${lista.id}: la silueta entera es la de la forma`);
      assert.deepEqual(aplicada.volumen, lista.volumen, `${lista.id}: el volumen es el de la forma`);
      assert.deepEqual(aplicada.tamanos, lista.tamanos, `${lista.id}: los tamaños son los de la forma`);
      assert.equal(aplicada.aspecto.semilla, lista.semilla);
      // Lo que no es de la forma no se toca: los colores y los adornos.
      assert.deepEqual([aplicada.colores, aplicada.adornos], [BASE.colores, BASE.adornos], `${lista.id}: no toca lo que no es suyo`);
      assert.equal(aplicada.origen, "decorador");
    }
    assert.equal(estilos.length, 4);
    for (const estilo of estilos) {
      const aplicado = conEstilo(BASE, estilo);
      assert.deepEqual(aplicado.volumen, estilo.volumen, `${estilo.id}: el volumen es el del estilo`);
      assert.deepEqual([aplicado.forma, aplicado.colores, aplicado.adornos], [BASE.forma, BASE.colores, BASE.adornos], `${estilo.id}: solo cambia cuánto se llena`);
      // El inflado y la variación de tamaño se quedan como el decorador los tenía; la mezcla solo cambia si el estilo la describe.
      assert.equal(aplicado.tamanos.inflado, BASE.tamanos.inflado);
      assert.equal(aplicado.tamanos.variacion, BASE.tamanos.variacion);
      if (estilo.tamanos) assert.deepEqual([aplicado.tamanos.mezcla, aplicado.tamanos.grandesAbajo], [estilo.tamanos.mezcla, estilo.tamanos.grandesAbajo]);
      else assert.deepEqual(aplicado.tamanos, BASE.tamanos);
    }
    assert.ok(estilos.some((estilo) => estilo.tamanos), "el estilo de los gigantes también cambia la mezcla de tamaños");
  });

  await caso("el medio arco es este mismo armado cortado antes de bajar, y el espejo solo cambia por qué lado sube", () => {
    assert.equal(BASE.forma.corte, 1, "la fixture trae un arco completo");
    const medio = conForma(BASE, "corte", 0.75);
    assert.ok(medio.forma.corte < 1, "un medio arco no es otro contrato: es `forma.corte` menor que 1");
    assert.deepEqual(diferencias(BASE, medio).filter((ruta) => ruta !== ".origen"), [".forma.corte"]);
    const alOtroLado = conInterruptorDeForma(medio, "espejo", true);
    assert.deepEqual(diferencias(medio, alOtroLado).filter((ruta) => ruta !== ".origen"), [".forma.espejo"]);
    // El motor publica medios arcos entre sus formas listas: aplicarlos trae su corte y su espejo, no un id.
    const mediosDelMotor = VISTA.opciones.formas.filter((lista) => lista.forma.corte < 1);
    assert.ok(mediosDelMotor.length > 0, "el motor publica formas listas de medio arco");
    for (const lista of mediosDelMotor) {
      const aplicada = conFormaLista(BASE, lista);
      assert.equal(aplicada.forma.corte, lista.forma.corte);
      assert.equal(aplicada.forma.espejo, lista.forma.espejo);
      assert.ok(!("id" in aplicada), "lo guardado es la disposición, no el nombre de una receta");
    }
  });

  await caso("la paleta: cada papel es de un color de la pieza; agregar y quitar respetan los topes", () => {
    const paleta = BASE.colores.paleta;
    assert.equal(paleta.length, COLORES_DE_PIEZA, "la receta toma un color por material de la pieza");
    const otro = conMaterial(BASE, 0, 1);
    assert.deepEqual(diferencias(BASE, otro).filter((ruta) => ruta !== ".origen"), [".colores.paleta.0.material"]);
    assert.deepEqual(diferencias(BASE, conPesoDeColor(BASE, 1, 7)).filter((ruta) => ruta !== ".origen"), [".colores.paleta.1.peso"]);
    assert.deepEqual(diferencias(BASE, conAcabado(BASE, 0, "cromado")).filter((ruta) => ruta !== ".origen"), [".colores.paleta.0.acabado"]);
    assert.deepEqual(diferencias(BASE, conRol(BASE, 1, "acento")).filter((ruta) => ruta !== ".origen"), [".colores.paleta.1.rol"]);
    assert.equal(conMaterial(BASE, 9, 1), BASE, "una posición que no existe no cambia nada");
    // Quitar uno deja los demás; nunca una paleta vacía.
    const sinUno = conColorQuitado(BASE, 1);
    assert.equal(sinUno.colores.paleta.length, paleta.length - 1);
    let uno = BASE;
    while (uno.colores.paleta.length > 1) uno = conColorQuitado(uno, 0);
    assert.equal(conColorQuitado(uno, 0), uno, "el último color no se quita: un arco sin colores no se arma");
    // Agregar toma el primer color de la pieza que la paleta no usa; con todos usados, nada.
    const conUno = conColorAgregado(sinUno, COLORES_DE_PIEZA, VISTA.opciones.max_materiales);
    assert.equal(conUno.colores.paleta.length, paleta.length);
    assert.deepEqual(conUno.colores.paleta.map((entrada) => entrada.material).sort(), paleta.map((entrada) => entrada.material).sort());
    assert.equal(conColorAgregado(BASE, COLORES_DE_PIEZA, VISTA.opciones.max_materiales), BASE, "ya están todos los colores de la pieza");
    assert.equal(conColorAgregado(sinUno, COLORES_DE_PIEZA, 1), sinUno, "ni pasar del máximo que dice el motor");
  });

  await caso("la mezcla de tamaños: el peso de cada uno, y nunca una mezcla sin ningún tamaño", () => {
    assert.ok(pesoDeTamano(BASE, 12) > 0);
    const sin12 = conPesoDeTamano(BASE, 12, 0);
    assert.equal(pesoDeTamano(sin12, 12), 0);
    assert.equal(sin12.tamanos.mezcla["12"], undefined, "un tamaño sin peso sale de la mezcla");
    assert.ok(ArmadoArcoOrganicoV1Schema.safeParse(sin12).success);
    const con36 = conPesoDeTamano(BASE, 36, 10);
    assert.equal(con36.tamanos.mezcla["36"], 10);
    assert.deepEqual(diferencias(BASE, con36).filter((ruta) => ruta !== ".origen"), [".tamanos.mezcla.36"]);
    // Quitar el último tamaño que queda dejaría una mezcla vacía, que el motor rechaza: el borrador no la admite.
    let unico = BASE;
    for (const pulgadas of [5, 9, 12, 18, 24, 36]) unico = pesoDeTamano(unico, pulgadas) > 0 && Object.keys(unico.tamanos.mezcla).length > 1 ? conPesoDeTamano(unico, pulgadas, 0) : unico;
    assert.equal(Object.keys(unico.tamanos.mezcla).length, 1);
    const ultimo = Object.keys(unico.tamanos.mezcla)[0]!;
    assert.equal(conPesoDeTamano(unico, Number(ultimo), 0), unico);
  });

  await caso("los rangos salen de limites_de y del contrato: ni una cifra escrita en el cliente", () => {
    const limites: LimitesArcoOrganico = VISTA.limites;
    const ancho = rangoDeAncho(limites);
    const alto = rangoDeAlto(limites);
    const patas = rangoDeGrosorPatas(limites);
    const cima = rangoDeGrosorCima(limites);
    assert.deepEqual(
      [ancho.min, ancho.max, alto.min, alto.max, patas.min, patas.max, cima.min, cima.max],
      [limites.anchoMin, limites.anchoMax, limites.altoMin, limites.altoMax, limites.grosorPatasMin, limites.grosorPatasMax, limites.grosorCimaMin, limites.grosorCimaMax],
      "los cuatro rangos vivos son los del motor, cifra por cifra",
    );
    // El tope del grosor baja respecto al del contrato: una banda gruesa taparía la abertura, y eso lo decide el motor.
    assert.ok(limites.grosorPatasMax < 1.6, "el motor acota el grosor por debajo del tope del contrato");
    // Lo que el motor no publica sale del contrato, no de un número escrito aquí.
    for (const campo of ["cima", "curva", "ondulacion", "carga", "corte"] as const) {
      const rango = rangoDelContrato(FormaArcoOrganicoSchema.shape[campo], 0.05);
      assert.equal(rango.min, FormaArcoOrganicoSchema.shape[campo].minValue, `${campo}: el mínimo es el del contrato`);
      assert.equal(rango.max, FormaArcoOrganicoSchema.shape[campo].maxValue, `${campo}: el máximo es el del contrato`);
    }
    // Pintar un valor fuera de su rango lo deja en el borde, sin decidir nada por el motor.
    assert.equal(valorEnRango(0.5, alto), alto.min);
    assert.equal(valorEnRango(99, alto), alto.max);
    assert.equal(valorEnRango(BASE.forma.altoM, alto), BASE.forma.altoM);
  });

  await caso("la petición al motor lleva exactamente el borrador, y nada más que el contrato de la ruta", () => {
    const borrador = conVolumen(conForma(BASE, "altoM", 2.8), "grosorPatasM", 0.9);
    const cuerpo = peticionVistaArcoOrganico(PIEZA, borrador);
    assert.deepEqual(Object.keys(cuerpo).sort(), ["armado_arco_organico", "colores", "estructura_id", "plan"]);
    assert.deepEqual(cuerpo.armado_arco_organico, borrador, "el armado viaja sin tocar: ni conteo, ni medidas, ni geometría calculada");
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
    // La receta se pide con el armado en `null`, y nada más cambia.
    assert.equal(peticionVistaArcoOrganico(PIEZA, null).armado_arco_organico, null);
  });

  await caso("pausa: varios cambios seguidos son UNA petición, la del último", () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArcoOrganico({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "altoM", 2.6));
    avanzar(200);
    control.mostrar(conForma(BASE, "altoM", 2.8));
    avanzar(200);
    control.mostrar(conForma(BASE, "altoM", 3));
    assert.equal(peticiones.length, 0, "dentro de la pausa no se pide nada");
    avanzar(299);
    assert.equal(peticiones.length, 0);
    avanzar(1);
    assert.equal(peticiones.length, 1, "pasada la pausa sin otro cambio, una sola petición");
    assert.deepEqual(peticiones[0]!.armado, conForma(BASE, "altoM", 3), "y es la del último borrador");
    assert.equal(control.estado().borrador, "pendiente");
    assert.equal(control.estado().enVuelo, true);
  });

  await caso("gana la última: otro borrador cancela el que vuela y una respuesta vieja que llega igual no se pinta", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArcoOrganico({ pedir, inicial: VISTA, reloj });
    const a = conForma(BASE, "altoM", 2.6);
    const b = conForma(BASE, "altoM", 3.2);
    control.mostrar(a);
    avanzar(300);
    assert.equal(peticiones.length, 1);
    control.mostrar(b);
    assert.equal(peticiones[0]!.signal.aborted, true, "mostrar otro borrador cancela la petición en vuelo (AbortController)");
    avanzar(300);
    assert.equal(peticiones.length, 2);
    // La vieja contesta tarde, aunque ya estaba cancelada: no cuenta.
    peticiones[0]!.resolver(vistaDe(VISTA, a, "vieja"));
    await tick();
    assert.equal(control.estado().vista?.arco.avisos[0] !== "vieja", true, "una respuesta vieja nunca se pinta");
    assert.equal(control.estado().borrador, "pendiente");
    peticiones[1]!.resolver(vistaDe(VISTA, b, "nueva"));
    await tick();
    assert.equal(control.estado().borrador, "listo");
    assert.deepEqual(control.estado().vista?.arco.avisos, ["nueva"]);
    assert.equal(control.estado().enVuelo, false);
  });

  await caso("mientras llega el dibujo nuevo se conserva el último que sí llegó, marcado como pendiente", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArcoOrganico({ pedir, inicial: VISTA, reloj });
    assert.equal(control.estado().borrador, "listo", "el dibujo del plan se ve desde el primer momento, sin petición");
    assert.equal(peticiones.length, 0);
    const siguiente = conForma(BASE, "altoM", 3.2);
    control.mostrar(siguiente);
    assert.equal(control.estado().vista, VISTA, "el dibujo que hay sigue a la vista");
    assert.equal(control.estado().borrador, "pendiente");
    assert.deepEqual(panelDeBorradorArcoOrganico(control.estado()), { fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, siguiente, "listo"));
    await tick();
    assert.deepEqual(panelDeBorradorArcoOrganico(control.estado()), { fase: "listo", vista: control.estado().vista!, actualizando: false, fallo: null });
  });

  await caso("volver a un borrador que el motor ya dibujó no vuelve a pedirlo", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArcoOrganico({ pedir, inicial: VISTA, reloj });
    const otro = conVolumen(BASE, "relleno", 0.7);
    control.mostrar(otro);
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, otro, "r70"));
    await tick();
    control.mostrar(BASE);
    assert.equal(control.estado().borrador, "listo", "el del plan ya estaba dibujado");
    control.mostrar(otro);
    assert.equal(control.estado().borrador, "listo");
    avanzar(1000);
    assert.equal(peticiones.length, 1, "ninguna petición más");
  });

  await caso("rechazo del motor: llega con su frase tal cual y no se reintenta solo; un fallo se reintenta con Reintentar", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArcoOrganico({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "anchoM", 9.5));
    avanzar(300);
    peticiones[0]!.rechazar(new FalloPlanArmado(RECHAZO.mensaje, { motivo: RECHAZO.motivo, armadoInvalido: true }));
    await tick();
    assert.equal(control.estado().borrador, "rechazado");
    assert.deepEqual(control.estado().error, { mensaje: RECHAZO.mensaje, armadoInvalido: true });
    assert.equal(control.estado().vista, VISTA, "el último dibujo sigue ahí");
    assert.deepEqual(panelDeBorradorArcoOrganico(control.estado()), { fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    avanzar(5000);
    assert.equal(peticiones.length, 1, "lo que el motor rechazó no se vuelve a pedir solo");
    // Un fallo de transporte: tampoco solo, pero sí con "Reintentar".
    const otro = conForma(BASE, "altoM", 3.4);
    control.mostrar(otro);
    avanzar(300);
    peticiones[1]!.rechazar(new FalloPlanArmado(SIN_CONEXION, { armadoInvalido: false }));
    await tick();
    assert.equal(control.estado().borrador, "fallido");
    avanzar(5000);
    assert.equal(peticiones.length, 2);
    control.reintentar();
    avanzar(300);
    assert.equal(peticiones.length, 3, "Reintentar vuelve a pedir el mismo borrador");
    assert.deepEqual(peticiones[2]!.armado, otro);
    // Una cancelación no es un fallo.
    control.mostrar(conForma(BASE, "altoM", 3.6));
    assert.equal(control.estado().error, null);
  });

  await caso("cerrar el editor cancela lo que quede, y el estado de este render no confunde el «listo» del borrador anterior", () => {
    const { reloj, avanzar, pendientes } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArcoOrganico({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "altoM", 3.2));
    avanzar(300);
    control.cerrar();
    assert.equal(peticiones[0]!.signal.aborted, true);
    control.mostrar(conForma(BASE, "altoM", 3.4));
    assert.equal(pendientes(), 1, "después de cerrar, un borrador nuevo empieza de cero");
    control.cerrar();
    assert.equal(pendientes(), 0, "cerrar apaga la pausa que esperaba");
    const estado: EstadoVistaBorradorArcoOrganico = { vista: VISTA, borrador: "listo", enVuelo: false, error: null, clave: JSON.stringify("otra") };
    assert.equal(alBorradorArcoOrganico(estado, conForma(BASE, "altoM", 4)).borrador, "pendiente");
  });

  await caso("Guardar solo con un dibujo del motor, sin cambios que perder ni otro ajuste en curso", () => {
    const listo = { borrador: "listo" as const, error: null };
    const entra = { hayCambios: true, guardando: false, ocupado: false };
    assert.deepEqual(puedeGuardarArcoOrganico({ estado: listo, ...entra }), { puede: true });
    assert.deepEqual(puedeGuardarArcoOrganico({ estado: { borrador: "pendiente", error: null }, ...entra }), { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" });
    const rechazado = puedeGuardarArcoOrganico({ estado: { borrador: "rechazado", error: { mensaje: RECHAZO.mensaje, armadoInvalido: true } }, ...entra });
    assert.deepEqual(rechazado, { puede: false, motivo: RECHAZO.mensaje, tipo: "error" }, "la frase del motor, tal cual");
    assert.equal(puedeGuardarArcoOrganico({ estado: { borrador: "fallido", error: { mensaje: SIN_CONEXION, armadoInvalido: false } }, ...entra }).puede, false);
    assert.equal(puedeGuardarArcoOrganico({ estado: listo, ...entra, hayCambios: false }).puede, false);
    assert.equal(puedeGuardarArcoOrganico({ estado: listo, ...entra, ocupado: true }).puede, false);
    assert.equal(puedeGuardarArcoOrganico({ estado: listo, ...entra, guardando: true }).puede, false);
    const colores = puedeGuardarArcoOrganico({ estado: listo, ...entra, coloresCambiaron: true });
    assert.equal(colores.puede, false);
    assert.match(colores.puede ? "" : colores.motivo, /revisa la paleta/);
  });

  // --- Lo que se ve -------------------------------------------------------------------------------------------------

  const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const pintarControles = (borrador: ArmadoArcoOrganicoV1, limites: LimitesArcoOrganico = VISTA.limites) =>
    renderToStaticMarkup(React.createElement(ControlesArcoOrganico, { borrador, opciones: VISTA.opciones, limites, leyenda: LEYENDA, onCambiar: () => {} }));
  const pintarEditor = (sobre: Partial<React.ComponentProps<typeof EditorArcoOrganico>> = {}) =>
    renderToStaticMarkup(React.createElement(EditorArcoOrganico, {
      borrador: BASE,
      vista: { vista: VISTA, borrador: "listo", error: null },
      leyenda: LEYENDA,
      guardar: { puede: true },
      guardando: false,
      errorGuardado: null,
      planCambio: false,
      coloresCambiaron: false,
      hayCambios: true,
      onSeguirConMiBorrador: () => {},
      onUsarArcoDeLaPropuesta: () => {},
      onReceta: async () => null,
      onCambiar: () => {},
      onGuardar: () => {},
      onDescartar: () => {},
      onRestablecer: () => {},
      onReintentar: () => {},
      ...sobre,
    }));

  await caso("los ajustes: textos del motor, rangos vivos, sin claves internas visibles y con foco y 44 px", () => {
    const html = pintarControles(BASE);
    const visible = texto(html);
    for (const acabado of VISTA.opciones.acabados) assert.ok(visible.includes(acabado.texto), `falta el acabado del motor: ${acabado.texto}`);
    for (const reparto of VISTA.opciones.repartos) assert.ok(visible.includes(reparto.texto), `falta el reparto del motor: ${reparto.texto}`);
    for (const forma of VISTA.opciones.formas) assert.ok(visible.includes(forma.nombre), `falta la forma lista del motor: ${forma.nombre}`);
    for (const estilo of VISTA.opciones.estilos) assert.ok(visible.includes(estilo.nombre), `falta el estilo del motor: ${estilo.nombre}`);
    const repartoActual = VISTA.opciones.repartos.find((reparto) => reparto.valor === BASE.colores.reparto)!;
    if (repartoActual.ayuda) assert.ok(visible.includes(repartoActual.ayuda), "la ayuda del reparto sale del motor");
    for (const pulgadas of VISTA.opciones.tamanos) assert.ok(visible.includes(`Globos de ${pulgadas}″`), `un deslizador por tamaño: ${pulgadas}″`);
    for (const interno of ["anchoM", "altoM", "grosorPatasM", "grosorCimaM", "grandesAbajo", "armado-arco-organico"]) {
      assert.ok(!visible.includes(interno), `clave interna visible: ${interno}`);
    }
    // Los rangos del ancho, del alto y de los dos grosores son los vivos del motor.
    for (const valor of [VISTA.limites.anchoMin, VISTA.limites.altoMin, VISTA.limites.grosorPatasMin, VISTA.limites.grosorCimaMin]) {
      assert.ok(html.includes(`min="${valor}"`), `falta el rango ${valor}`);
    }
    // Una paleta por color de la pieza, cada una con su selector de color, de acabado y de papel.
    assert.equal((html.match(/data-testid="color-arco-organico-\d"/g) ?? []).length, BASE.colores.paleta.length);
    assert.ok(html.includes("Acabado del color 1") && html.includes("Papel del color 2") && html.includes("Cuánto pesa el color 1"));
    // Accesibilidad: deslizadores con etiqueta y texto de valor, grupo de radio y lo que se toca mide 44 px.
    assert.ok((html.match(/type="range"/g) ?? []).length >= 20);
    assert.ok(html.includes("aria-valuetext") && html.includes('role="radiogroup"') && html.includes('role="switch"'));
    assert.ok((html.match(/min-h-11/g) ?? []).length >= 4, "los botones y las listas miden al menos 44 px");
    assert.ok(/<details open=""[^>]*data-testid="apartado-colores-arco-organico"/.test(html), "el apartado de los colores va abierto");
    assert.ok(!/<details open=""[^>]*data-testid="apartado-forma-arco-organico"/.test(html), "los demás van plegados para no agrandar la tarjeta");
  });

  await caso("los mandos hablan en palabras de oficio, y ninguno se queda sin decir qué cambia en la pieza", () => {
    const html = pintarControles(BASE);
    const visible = texto(html);
    // La jerga del motor que esta pantalla no enseña, con lo que el decorador lee en su lugar.
    for (const [antes, ahora] of [
      ["Corte", "Hasta dónde llega la banda"],
      ["Carga", "Lado más cargado"],
      ["Curva", "Qué tan cerrada va la curva"],
      ["Irregularidad", "Qué tan desparejo queda el borde"],
      ["Grandes abajo", "Dónde van los globos grandes"],
      ["Variación de tamaño", "Globos de distinto tamaño"],
      ["Inflado", "Qué tan inflados"],
      ["Globos que se salen de la banda", "Globos que asoman del borde"],
    ] as const) {
      assert.ok(!visible.includes(antes), `jerga del motor a la vista: ${antes}`);
      assert.ok(visible.includes(ahora), `falta el mando en palabras de oficio: ${ahora}`);
    }
    // El espejo solo existe con un medio arco, así que su palabra de oficio se lee en ese render.
    assert.ok(!visible.includes("Espejo"), "jerga del motor a la vista: Espejo");
    assert.ok(texto(pintarControles(conForma(BASE, "corte", 0.75))).includes("Que suba por la derecha"), "falta el mando en palabras de oficio: Que suba por la derecha");
    // Cada mando lleva su frase de ayuda (`aria-describedby`), menos los pesos de cada tamaño, que la llevan juntos
    // en el párrafo del apartado.
    const mandos = [...html.matchAll(/<(?:input|select|button)\b[^>]*data-testid="[^"]*"[^>]*>/g)].map((hallado) => hallado[0]);
    assert.ok(mandos.length >= 25, `se esperaban todos los mandos de la pantalla, no ${mandos.length}`);
    // Los botones de la paleta y el de otra disposición no son mandos con rango: su propio texto dice lo que hacen.
    const sinAyuda = mandos.filter(
      (mando) => !/data-testid="(?:peso-tamano-|quitar-color|agregar-color|otra-disposicion)/.test(mando) && !mando.includes("aria-describedby"),
    );
    assert.deepEqual(sinAyuda, [], "cada mando dice en una frase qué cambia en la pieza");
  });

  await caso("hasta dónde llega la banda es lo primero que se ve, y el espejo solo con un medio arco", () => {
    const completo = pintarControles(BASE);
    const medio = pintarControles(conForma(BASE, "corte", 0.75));
    // El mando del corte va antes que cualquier apartado: es lo que distingue un arco de un medio arco.
    assert.ok(completo.indexOf("corte-arco-organico") < completo.indexOf("apartado-forma-arco-organico"));
    assert.ok(!completo.includes("espejo-arco-organico"), "en un arco completo el espejo no haría nada");
    assert.ok(medio.includes("espejo-arco-organico"), "con el medio arco se elige por qué lado sube");
    assert.match(/<button[^>]*data-testid="espejo-arco-organico"[^>]*>/.exec(medio)![0], /aria-checked="false"/);
    assert.match(/<button[^>]*data-testid="espejo-arco-organico"[^>]*>/.exec(pintarControles(conInterruptorDeForma(conForma(BASE, "corte", 0.75), "espejo", true)))![0], /aria-checked="true"/);
    // Y el valor se lee en palabras, no con el número del motor.
    assert.match(texto(completo), /hasta el otro pie/);
    assert.match(texto(medio), /del recorrido/);
  });

  await caso("con otros límites del motor el rango del alto cambia: es el que dice el motor, no uno del cliente", () => {
    // El motor sube el alto mínimo cuando el arco es más ancho o la banda más gruesa; aquí se comprueba que el
    // mando lo obedece, dándole los dos límites que el motor publicaría.
    const minimoDelAlto = (html: string): number => Number(/<input[^>]*data-testid="alto-arco-organico"[^>]*>/.exec(html)![0].match(/min="([^"]+)"/)![1]);
    const estrecho = pintarControles(BASE, VISTA.limites);
    const ancho = pintarControles(conForma(BASE, "anchoM", 6), { ...VISTA.limites, altoMin: 2.4 });
    assert.equal(minimoDelAlto(estrecho), VISTA.limites.altoMin);
    assert.equal(minimoDelAlto(ancho), 2.4);
    assert.ok(minimoDelAlto(ancho) > minimoDelAlto(estrecho), "un arco más ancho pide más alto");
  });

  await caso("el editor: listo para guardar, con cada estado explícito y los botones de siempre", () => {
    const listo = pintarEditor();
    assert.ok(listo.includes('data-testid="editor-arco-organico"') && listo.includes(">Editar arco<"));
    assert.match(texto(listo), /Listo para guardar\. Al guardar se recalcula la compra con el catálogo/);
    assert.ok(/data-testid="guardar-arco-organico"/.test(listo) && !/disabled=""[^>]*data-testid="guardar-arco-organico"/.test(listo));
    assert.ok(texto(listo).includes("Guardar arco") && texto(listo).includes("Descartar cambios") && texto(listo).includes("Restablecer") && texto(listo).includes("Volver a la receta"));
    assert.ok(listo.includes("la propuesta cambia de firma"), "se dice qué pasa al guardar");
    // Sin cambios: Cerrar en lugar de Descartar, y Guardar espera.
    const quieto = pintarEditor({ hayCambios: false, guardar: { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" } });
    assert.ok(texto(quieto).includes("Todavía no cambiaste nada.") && texto(quieto).includes("Cerrar") && !texto(quieto).includes("Descartar cambios"));
    assert.ok(/disabled=""[^>]*data-testid="guardar-arco-organico"|data-testid="guardar-arco-organico"[^>]*disabled=""/.test(quieto));
    // El motor rechazó el borrador: su frase, tal cual y con rol de alerta.
    const rechazo = pintarEditor({ vista: { vista: VISTA, borrador: "rechazado", error: { mensaje: RECHAZO.mensaje, armadoInvalido: true } }, guardar: { puede: false, motivo: RECHAZO.mensaje, tipo: "error" } });
    assert.ok(rechazo.includes(RECHAZO.mensaje) && rechazo.includes('role="alert"'));
    assert.ok(!rechazo.includes("reintentar-editor-arco-organico"), "un rechazo del motor no se reintenta");
    const fallo = pintarEditor({ vista: { vista: VISTA, borrador: "fallido", error: { mensaje: SIN_CONEXION, armadoInvalido: false } }, guardar: { puede: false, motivo: SIN_CONEXION, tipo: "error" } });
    assert.ok(fallo.includes(SIN_CONEXION) && fallo.includes("reintentar-editor-arco-organico"));
    // Sin las herramientas del motor todavía: cargando, sin mandos inventados.
    const cargando = pintarEditor({ vista: { vista: null, borrador: "pendiente", error: null }, guardar: { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" } });
    assert.ok(cargando.includes("Cargando los ajustes del motor…") && !cargando.includes('type="range"'));
    // Lo que el guardado no pudo meter en el plan.
    const noGuardo = pintarEditor({ errorGuardado: "El catálogo no vende los globos que ese arco necesita (R-36)." });
    assert.ok(noGuardo.includes("No se guardó: El catálogo no vende los globos") && noGuardo.includes("La propuesta sigue como estaba."));
    // Los colores de la pieza cambiaron y la paleta está sin revisar; la propuesta cambió bajo el borrador.
    const colores = pintarEditor({ coloresCambiaron: true, guardar: { puede: false, motivo: "revisa", tipo: "colores" } });
    assert.ok(colores.includes("Los colores de la pieza cambiaron: revisa la paleta.") && colores.includes("Seguir con mi borrador") && colores.includes("Usar el arco de la propuesta"));
    assert.ok(pintarEditor({ planCambio: true }).includes("La propuesta cambió mientras editabas el arco."));
  });

  await caso("el error del motor y su «Reintentar» salen del dibujo, no de si se puede guardar", () => {
    // Salían de `guardar.*`, que contesta por orden de prioridad: con la tarjeta ocupada, sin cambios o con los
    // colores recién cambiados devuelve otro `tipo` y el error del motor no llegaba a pintarse nunca — ni el botón
    // de reintentar, que vive dentro de ese bloque. Y `ocupado` se enciende justo cuando el motor rechaza por estar
    // ocupado, así que las dos cosas coincidían casi siempre (2026-10-04).
    const ocupado = pintarEditor({
      vista: { vista: VISTA, borrador: "fallido", error: { mensaje: SIN_CONEXION, armadoInvalido: false } },
      guardar: { puede: false, motivo: "Hay otro ajuste guardándose. Espera un momento.", tipo: "espera" },
    });
    assert.ok(ocupado.includes('data-testid="error-editor-arco-organico"'), "con la tarjeta ocupada, el fallo del motor se ve igual");
    assert.ok(ocupado.includes(SIN_CONEXION) && ocupado.includes("reintentar-editor-arco-organico"), "y su «Reintentar» también");
    const sinCambios = pintarEditor({
      hayCambios: false,
      vista: { vista: VISTA, borrador: "rechazado", error: { mensaje: RECHAZO.mensaje, armadoInvalido: true } },
      guardar: { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" },
    });
    assert.ok(sinCambios.includes(RECHAZO.mensaje), "y la frase del rechazo tampoco depende de poder guardar");
    // Sin fallo del dibujo no hay bloque de error, aunque no se pueda guardar.
    assert.ok(!pintarEditor({ guardar: { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" } }).includes('data-testid="error-editor-arco-organico"'));
  });

  await caso("el bloque: «Editar arco» en el encabezado y el dibujo apagado cuando no es el del borrador", () => {
    const pintar = (estado: React.ComponentProps<typeof PanelArcoOrganico>["estado"], accion?: React.ReactNode) =>
      renderToStaticMarkup(React.createElement(PanelArcoOrganico, { estado, leyenda: LEYENDA, nombrePieza: "Arco", repeticiones: 1, onReintentar: () => {}, accion }));
    const boton = React.createElement("button", { type: "button", "data-testid": "editar-arco-organico" }, "Editar arco");
    assert.ok(pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }, boton).includes("Editar arco"));
    assert.ok(!pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes("Editar arco"), "sin onGuardar es de solo lectura");
    const nuevo = pintar({ fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    assert.ok(nuevo.includes("opacity-60") && nuevo.includes("Actualizando…") && nuevo.includes('aria-busy="true"'));
    const vencido = pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    assert.ok(vencido.includes("opacity-60") && vencido.includes("Es el último dibujo que llegó."));
    assert.ok(!pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes("opacity-60"));
    assert.ok(pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes('data-testid="avisos-vivos-armado-arco-organico"'), "la región de avisos siempre está montada");
    // El lienzo es cuadrado, pero el `viewBox` sale de los DOS lados que publica el motor: el cliente no inventa ninguno.
    const dibujado = pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null });
    assert.ok(dibujado.includes(`viewBox="0 0 ${VISTA.grafica.ancho} ${VISTA.grafica.alto}"`), "ancho y alto van tal cual al viewBox");
    assert.equal(VISTA.grafica.ancho, VISTA.grafica.alto, "y en este motor son iguales: 600 × 600");
  });

  await caso("un semiarco se nombra semiarco: «Armado del semiarco», no «del arco»", () => {
    // El usuario vio la tarjeta de un «Semiarco orgánico derecho» titulada «Armado del arco» con «Editar arco»
    // (2026-10-04): el bloque es el mismo motor, pero la pieza no es un arco.
    const pintar = (fase: "listo" | "cargando") =>
      renderToStaticMarkup(React.createElement(PanelArcoOrganico, {
        estado: fase === "listo" ? { fase, vista: VISTA, actualizando: false, fallo: null } : { fase },
        leyenda: LEYENDA, nombrePieza: "Semiarco orgánico derecho", repeticiones: 2, onReintentar: () => {}, sustantivo: "semiarco",
      } as React.ComponentProps<typeof PanelArcoOrganico>));
    const listo = pintar("listo");
    assert.ok(listo.includes("Armado del semiarco") && listo.includes('aria-label="Armado del semiarco"'));
    assert.ok(!listo.includes("Armado del arco"), "ningún texto dice arco");
    assert.ok(listo.includes("Las cifras son de un solo semiarco"));
    assert.ok(pintar("cargando").includes("Armando el semiarco globo por globo"));
  });

  await caso("al editar, el dibujo y los mandos se ven A LA VEZ: dos columnas y el scroll en los mandos", () => {
    // Las piezas del motor ya dejaban el dibujo montado al abrir el editor, así que desde el código parecía
    // correcto; en pantalla no lo era, porque el editor se apilaba DEBAJO y empujaba el dibujo fuera de la vista.
    // Ninguna prueba miraba la maquetación, así que nadie lo vio hasta que lo reportó el usuario (2026-10-04).
    const conMarco = (conEditor: boolean) =>
      renderToStaticMarkup(React.createElement(PanelArcoOrganico, {
        estado: { fase: "listo", vista: VISTA, actualizando: false, fallo: null },
        leyenda: LEYENDA, nombrePieza: "Arco", repeticiones: 1, onReintentar: () => {},
        ...(conEditor ? { pie: React.createElement("div", { "data-testid": "editor-de-prueba" }, "mandos") } : {}),
      } as React.ComponentProps<typeof PanelArcoOrganico>));

    const editando = conMarco(true);
    assert.ok(editando.includes('data-testid="editor-de-prueba"'), "el editor se monta");
    assert.ok(editando.includes("Armado del arco"), "y el dibujo sigue ahí, en el mismo render");
    assert.ok(editando.includes('data-testid="mandos-edicion"'), "los mandos van en su propia columna");
    assert.ok(editando.includes("@3xl:grid-cols-"), "dos columnas cuando la tarjeta da el ancho");
    const bloqueMandos = /data-testid="mandos-edicion"[^>]*>/.exec(editando)?.[0] ?? "";
    assert.ok(bloqueMandos.includes("overflow-y-auto"), "el scroll es de los mandos: es lo que impide que el dibujo se vaya");
    assert.ok(bloqueMandos.includes("max-h-"), "y tienen altura tope, o volverían a empujar el dibujo fuera");
    assert.ok(editando.indexOf("Armado del arco") < editando.indexOf('data-testid="mandos-edicion"'), "el dibujo va primero");

    const soloLectura = conMarco(false);
    assert.ok(!soloLectura.includes('data-testid="mandos-edicion"'));
    assert.ok(!soloLectura.includes("@3xl:grid-cols-"), "la rejilla de edición no aparece fuera de la edición");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
