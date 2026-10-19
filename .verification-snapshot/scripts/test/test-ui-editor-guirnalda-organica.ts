/**
 * Editor de guirnaldas del motor con vista previa en vivo (ADR-0035, paso 3). Módulos sin React y render estático,
 * sin red ni proveedores, como `test-ui-editor-arco.ts`. La salida del motor es REAL: `vista-guirnalda-organica.json`
 * (la guirnalda, sus herramientas y sus rangos) y `limites-por-grosor.json` (los rangos vivos de `limites_de` y los
 * avisos de lo que el motor corrige, por grosor de banda), ambos escritos por Python. Nada de lo que el motor decide
 * está escrito a mano aquí.
 *
 * Lo que vigila:
 * - **el cliente no calcula**: el armado que se manda al motor es exactamente el borrador, y cada cambio del
 *   borrador es UN campo; los rangos y los avisos son los del motor, cifra por cifra;
 * - **los rangos viven en el motor**: al engrosar la banda sube el largo mínimo, y los mandos de los acabados y los
 *   repartos salen de `opciones_admitidas`;
 * - **operación concurrente**: pausa, cancelación, gana la última respuesta y una respuesta vieja nunca se pinta;
 * - **estados explícitos** y Guardar solo con un dibujo del motor, por la ruta de edición que ya existe.
 *
 * Run: npx tsx scripts/test/test-ui-editor-guirnalda-organica.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Reloj } from "@/components/plan/autoguardado";
import { PanelGuirnaldaOrganica } from "@/components/plan/guirnalda-organica/BloqueGuirnaldaOrganica";
import {
  conAcabado,
  conAdorno,
  conColorAgregado,
  conColorQuitado,
  conForma,
  conMaterial,
  conMezclaDeColores,
  conPesoDeColor,
  conPesoDeTamano,
  conReparto,
  conRol,
  conTamanos,
  conVolumen,
  mismoArmadoGuirnaldaOrganica,
  pesoDeTamano,
  rangoDeAltura,
  rangoDeColgado,
  rangoDeFestones,
  rangoDeGrosorCentro,
  rangoDeGrosorExtremos,
  rangoDeLargo,
  rangoDeOnda,
  rangoDePendiente,
  rangoDelContrato,
  valorEnRango,
} from "@/components/plan/guirnalda-organica/borrador-guirnalda-organica";
import { ControlesGuirnaldaOrganica } from "@/components/plan/guirnalda-organica/ControlesGuirnaldaOrganica";
import { EditorGuirnaldaOrganica } from "@/components/plan/guirnalda-organica/EditorGuirnaldaOrganica";
import { puedeGuardarGuirnaldaOrganica } from "@/components/plan/guirnalda-organica/guardar-guirnalda-organica";
import { peticionVistaGuirnaldaOrganica, type PiezaVistaGuirnaldaOrganica } from "@/components/plan/guirnalda-organica/vista-guirnalda-organica";
import {
  alBorradorGuirnaldaOrganica,
  crearVistaBorradorGuirnaldaOrganica,
  panelDeBorradorGuirnaldaOrganica,
  type EstadoVistaBorradorGuirnaldaOrganica,
} from "@/components/plan/guirnalda-organica/vista-borrador-guirnalda-organica";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoGuirnaldaOrganicaV1Schema, FormaGuirnaldaOrganicaSchema, type ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { EdicionArmadoGuirnaldaOrganicaSchema } from "@/lib/plan/edicion-esquemas";
import type { LimitesGuirnaldaOrganica } from "@/lib/plan/opciones-armado-guirnalda-organica";
import { FalloPlanArmado, pedirPlanEditarArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoGuirnaldaOrganica, type VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
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

const FIXTURE = leerJson("scripts/fixtures/guirnalda-organica-ui/vista-guirnalda-organica.json") as {
  peticion: { estructura_id: string; armado_guirnalda_organica: ArmadoGuirnaldaOrganicaV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const MOTOR = leerJson("scripts/fixtures/guirnalda-organica-ui/limites-por-grosor.json") as {
  base: ArmadoGuirnaldaOrganicaV1;
  colores: string[];
  por_grosor: Record<string, { armado: ArmadoGuirnaldaOrganicaV1; limites: LimitesGuirnaldaOrganica; avisos: string[]; globos: number }>;
  avisos_largo_imposible: { armado: ArmadoGuirnaldaOrganicaV1; avisos: string[] };
  rechazo: { armado: ArmadoGuirnaldaOrganicaV1; motivo: string; mensaje: string };
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const BASE = ArmadoGuirnaldaOrganicaV1Schema.parse(FIXTURE.peticion.armado_guirnalda_organica);
const PIEZA: PiezaVistaGuirnaldaOrganica = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
const DECLARADA = RESUELTO.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const RESUELTA = RESUELTO.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const LEYENDA = leyendaPatron(DECLARADA.materiales, RESUELTA.lineas, undefined);
const COLORES_DE_PIEZA = LEYENDA.length;

/** El dibujo del motor de la fixture, validado por la misma frontera que usa la pantalla. */
async function vistaDeLaFixture(): Promise<VistaArmadoGuirnaldaOrganica> {
  const fetcher = (async () => new Response(JSON.stringify(FIXTURE.respuesta), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  return pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(PIEZA, BASE), { fetcher });
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

type Peticion = { armado: ArmadoGuirnaldaOrganicaV1; signal: AbortSignal; resolver: (vista: VistaArmadoGuirnaldaOrganica) => void; rechazar: (error: unknown) => void };

function puertoFalso() {
  const peticiones: Peticion[] = [];
  const pedir = (armado: ArmadoGuirnaldaOrganicaV1, signal: AbortSignal): Promise<VistaArmadoGuirnaldaOrganica> =>
    new Promise<VistaArmadoGuirnaldaOrganica>((resolver, rechazar) => {
      signal.addEventListener("abort", () => rechazar(new DOMException("cancelada", "AbortError")));
      peticiones.push({ armado, signal, resolver, rechazar });
    });
  return { pedir, peticiones };
}

/** Un dibujo del motor "de" un armado: el de la fixture con su eco cambiado (el puerto simulado no calcula nada). */
function vistaDe(base: VistaArmadoGuirnaldaOrganica, armado: ArmadoGuirnaldaOrganicaV1, marca: string): VistaArmadoGuirnaldaOrganica {
  return { ...base, armado, guirnalda: { ...base.guirnalda, avisos: [marca] } };
}

const tick = () => new Promise<void>((listo) => setTimeout(listo, 0));

async function main(): Promise<void> {
  const VISTA = await vistaDeLaFixture();

  await caso("el borrador: cada cambio es UN campo del armado, marcado del decorador, sin tocar el original", () => {
    const copia = structuredClone(BASE);
    const casosCambio: Array<[string, ArmadoGuirnaldaOrganicaV1, string]> = [
      ["largo", conForma(BASE, "largoM", 4), ".forma.largoM"],
      ["altura", conForma(BASE, "alturaM", 2.4), ".forma.alturaM"],
      ["pendiente", conForma(BASE, "pendienteM", 0.4), ".forma.pendienteM"],
      ["ondulación", conForma(BASE, "ondaM", 0.3), ".forma.ondaM"],
      ["festones", conForma(BASE, "festones", 2), ".forma.festones"],
      ["lado cargado", conForma(BASE, "carga", -0.5), ".forma.carga"],
      ["grosor en los extremos", conVolumen(BASE, "grosorPatasM", 0.6), ".volumen.grosorPatasM"],
      ["relleno", conVolumen(BASE, "relleno", 0.5), ".volumen.relleno"],
      ["racimo", conVolumen(BASE, "racimo", 3), ".volumen.racimo"],
      ["inflado", conTamanos(BASE, "inflado", 0.9), ".tamanos.inflado"],
      ["grandes abajo", conTamanos(BASE, "grandesAbajo", 0.6), ".tamanos.grandesAbajo"],
      ["reparto", conReparto(BASE, "racimos"), ".colores.reparto"],
      ["mezcla entre colores", conMezclaDeColores(BASE, 0.9), ".colores.mezcla"],
      ["follaje", conAdorno(BASE, "follaje", 1.5), ".adornos.follaje"],
      ["flores", conAdorno(BASE, "flores", 1.5), ".adornos.flores"],
    ];
    for (const [nombre, siguiente, campo] of casosCambio) {
      assert.deepEqual(diferencias(BASE, siguiente).filter((ruta) => ruta !== ".origen"), [campo], `${nombre}: debe cambiar solo ${campo}`);
      assert.equal(siguiente.origen, "decorador", `${nombre}: lo cambió el decorador`);
      assert.ok(ArmadoGuirnaldaOrganicaV1Schema.safeParse(siguiente).success, `${nombre}: sigue cumpliendo armado-guirnalda-organica.v1`);
    }
    assert.deepEqual(BASE, copia, "el armado original no se muta");
    // Lo que el contrato no admite deja el borrador como estaba, sin inventar un valor.
    assert.equal(conForma(BASE, "largoM", 99), BASE);
    assert.equal(conVolumen(BASE, "racimo", 2.5), BASE);
    assert.equal(conMezclaDeColores(BASE, 4), BASE);
    // Y lo que no cambia, no se vuelve a crear.
    assert.equal(conReparto(BASE, BASE.colores.reparto), BASE);
    assert.ok(mismoArmadoGuirnaldaOrganica(BASE, { ...BASE, origen: "decorador" }), "quién lo firmó no lo vuelve otro armado");
    assert.ok(!mismoArmadoGuirnaldaOrganica(BASE, conForma(BASE, "largoM", 4)));
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
    assert.equal(conColorQuitado(sinUno, 0), sinUno, "el último color no se quita: una guirnalda sin colores no se arma");
    // Agregar toma el primer color de la pieza que la paleta no usa; con todos usados, nada.
    const conUno = conColorAgregado(sinUno, COLORES_DE_PIEZA, 8);
    assert.equal(conUno.colores.paleta.length, paleta.length);
    assert.deepEqual(conUno.colores.paleta.map((entrada) => entrada.material).sort(), paleta.map((entrada) => entrada.material).sort());
    assert.equal(conColorAgregado(BASE, COLORES_DE_PIEZA, 8), BASE, "ya están todos los colores de la pieza");
    assert.equal(conColorAgregado(sinUno, COLORES_DE_PIEZA, 1), sinUno, "ni pasar del máximo que dice el motor");
  });

  await caso("la mezcla de tamaños: el peso de cada uno, y nunca una mezcla sin ningún tamaño", () => {
    assert.ok(pesoDeTamano(BASE, 12) > 0);
    const sin12 = conPesoDeTamano(BASE, 12, 0);
    assert.equal(pesoDeTamano(sin12, 12), 0);
    assert.equal(sin12.tamanos.mezcla["12"], undefined, "un tamaño sin peso sale de la mezcla");
    assert.ok(ArmadoGuirnaldaOrganicaV1Schema.safeParse(sin12).success);
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

  await caso("los rangos salen de limites_de: suben con el grosor y son los del motor, cifra por cifra", () => {
    const rangos = (grosor: string) => {
      const { limites } = MOTOR.por_grosor[grosor]!;
      return { limites, largo: rangoDeLargo(limites), altura: rangoDeAltura(limites), pendiente: rangoDePendiente(limites), onda: rangoDeOnda(limites), colgado: rangoDeColgado(limites), festones: rangoDeFestones(limites), extremos: rangoDeGrosorExtremos(limites), centro: rangoDeGrosorCentro(limites) };
    };
    const fino = rangos("0.4");
    const grueso = rangos("1.2");
    assert.ok(grueso.largo.min > fino.largo.min, "una banda gruesa pide más largo");
    assert.equal(fino.largo.min, MOTOR.por_grosor["0.4"]!.limites.largoMin);
    assert.equal(grueso.largo.min, MOTOR.por_grosor["1.2"]!.limites.largoMin);
    for (const grosor of ["0.4", "0.8", "1.2"]) {
      const { limites, largo, altura, pendiente, onda, colgado, festones, extremos, centro } = rangos(grosor);
      assert.deepEqual([largo.min, largo.max, altura.min, altura.max, extremos.min, extremos.max, centro.min, centro.max], [limites.largoMin, limites.largoMax, limites.alturaMin, limites.alturaMax, limites.grosorExtremosMin, limites.grosorExtremosMax, limites.grosorCentroMin, limites.grosorCentroMax]);
      assert.deepEqual([pendiente.min, pendiente.max], [-limites.pendienteMax, limites.pendienteMax]);
      assert.deepEqual([onda.max, colgado.max, festones.min, festones.max], [limites.ondaMax, limites.colgadoMax, 1, limites.festonesMax]);
    }
    // Lo que el motor no publica sale del contrato, no de un número escrito aquí.
    const ondas = rangoDelContrato(FormaGuirnaldaOrganicaSchema.shape.ondas, 1);
    assert.equal(ondas.min, FormaGuirnaldaOrganicaSchema.shape.ondas.minValue);
    assert.equal(ondas.max, FormaGuirnaldaOrganicaSchema.shape.ondas.maxValue);
    // Pintar un valor fuera de su rango lo deja en el borde, sin decidir nada por el motor.
    assert.equal(valorEnRango(0.8, grueso.largo), grueso.largo.min);
    assert.equal(valorEnRango(99, grueso.largo), grueso.largo.max);
    assert.equal(valorEnRango(5, grueso.largo), 5);
  });

  await caso("la petición al motor lleva exactamente el borrador, y nada más que el contrato de la ruta", () => {
    const borrador = conVolumen(conForma(BASE, "largoM", 4.2), "grosorPatasM", 0.7);
    const cuerpo = peticionVistaGuirnaldaOrganica(PIEZA, borrador);
    assert.deepEqual(Object.keys(cuerpo).sort(), ["armado_guirnalda_organica", "colores", "estructura_id", "plan"]);
    assert.deepEqual(cuerpo.armado_guirnalda_organica, borrador, "el armado viaja sin tocar: ni conteo, ni medidas, ni geometría calculada");
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
  });

  await caso("pausa: varios cambios seguidos son UNA petición, la del último", () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorGuirnaldaOrganica({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "largoM", 3.4));
    avanzar(200);
    control.mostrar(conForma(BASE, "largoM", 3.6));
    avanzar(200);
    control.mostrar(conForma(BASE, "largoM", 3.8));
    assert.equal(peticiones.length, 0, "dentro de la pausa no se pide nada");
    avanzar(299);
    assert.equal(peticiones.length, 0);
    avanzar(1);
    assert.equal(peticiones.length, 1, "pasada la pausa sin otro cambio, una sola petición");
    assert.deepEqual(peticiones[0]!.armado, conForma(BASE, "largoM", 3.8), "y es la del último borrador");
    assert.equal(control.estado().borrador, "pendiente");
    assert.equal(control.estado().enVuelo, true);
  });

  await caso("gana la última: otro borrador cancela el que vuela y una respuesta vieja que llega igual no se pinta", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorGuirnaldaOrganica({ pedir, inicial: VISTA, reloj });
    const a = conForma(BASE, "largoM", 3.4);
    const b = conForma(BASE, "largoM", 3.9);
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
    assert.equal(control.estado().vista?.guirnalda.avisos[0] !== "vieja", true, "una respuesta vieja nunca se pinta");
    assert.equal(control.estado().borrador, "pendiente");
    peticiones[1]!.resolver(vistaDe(VISTA, b, "nueva"));
    await tick();
    assert.equal(control.estado().borrador, "listo");
    assert.deepEqual(control.estado().vista?.guirnalda.avisos, ["nueva"]);
    assert.equal(control.estado().enVuelo, false);
  });

  await caso("mientras llega el dibujo nuevo se conserva el último que sí llegó, marcado como pendiente", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorGuirnaldaOrganica({ pedir, inicial: VISTA, reloj });
    assert.equal(control.estado().borrador, "listo", "el dibujo del plan se ve desde el primer momento, sin petición");
    assert.equal(peticiones.length, 0);
    const siguiente = conForma(BASE, "largoM", 3.9);
    control.mostrar(siguiente);
    assert.equal(control.estado().vista, VISTA, "el dibujo que hay sigue a la vista");
    assert.equal(control.estado().borrador, "pendiente");
    assert.deepEqual(panelDeBorradorGuirnaldaOrganica(control.estado()), { fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, siguiente, "listo"));
    await tick();
    assert.deepEqual(panelDeBorradorGuirnaldaOrganica(control.estado()), { fase: "listo", vista: control.estado().vista!, actualizando: false, fallo: null });
  });

  await caso("volver a un borrador que el motor ya dibujó no vuelve a pedirlo", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorGuirnaldaOrganica({ pedir, inicial: VISTA, reloj });
    const otro = conVolumen(BASE, "relleno", 0.5);
    control.mostrar(otro);
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, otro, "r50"));
    await tick();
    control.mostrar(BASE);
    assert.equal(control.estado().borrador, "listo", "el del plan ya estaba dibujado");
    control.mostrar(otro);
    assert.equal(control.estado().borrador, "listo");
    avanzar(1000);
    assert.equal(peticiones.length, 1, "ninguna petición más");
  });

  await caso("rechazo del motor: llega con su frase en español y no se reintenta solo; un fallo se reintenta con Reintentar", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorGuirnaldaOrganica({ pedir, inicial: VISTA, reloj });
    control.mostrar(MOTOR.rechazo.armado);
    avanzar(300);
    peticiones[0]!.rechazar(new FalloPlanArmado(MOTOR.rechazo.mensaje, { motivo: MOTOR.rechazo.motivo, armadoInvalido: true }));
    await tick();
    assert.equal(control.estado().borrador, "rechazado");
    assert.deepEqual(control.estado().error, { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true });
    assert.equal(control.estado().vista, VISTA, "el último dibujo sigue ahí");
    assert.deepEqual(panelDeBorradorGuirnaldaOrganica(control.estado()), { fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    avanzar(5000);
    assert.equal(peticiones.length, 1, "lo que el motor rechazó no se vuelve a pedir solo");
    // Un fallo de transporte: tampoco solo, pero sí con "Reintentar".
    const otro = conForma(BASE, "largoM", 4.4);
    control.mostrar(otro);
    avanzar(300);
    peticiones[1]!.rechazar(new FalloPlanArmado("Sin conexión.", { armadoInvalido: false }));
    await tick();
    assert.equal(control.estado().borrador, "fallido");
    avanzar(5000);
    assert.equal(peticiones.length, 2);
    control.reintentar();
    avanzar(300);
    assert.equal(peticiones.length, 3, "Reintentar vuelve a pedir el mismo borrador");
    assert.deepEqual(peticiones[2]!.armado, otro);
    // Una cancelación no es un fallo.
    control.mostrar(conForma(BASE, "largoM", 4.6));
    assert.equal(control.estado().error, null);
  });

  await caso("cerrar el editor cancela lo que quede, y el estado de este render no confunde el «listo» del borrador anterior", () => {
    const { reloj, avanzar, pendientes } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorGuirnaldaOrganica({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "largoM", 3.9));
    avanzar(300);
    control.cerrar();
    assert.equal(peticiones[0]!.signal.aborted, true);
    control.mostrar(conForma(BASE, "largoM", 4.1));
    assert.equal(pendientes(), 1, "después de cerrar, un borrador nuevo empieza de cero");
    control.cerrar();
    assert.equal(pendientes(), 0, "cerrar apaga la pausa que esperaba");
    const estado: EstadoVistaBorradorGuirnaldaOrganica = { vista: VISTA, borrador: "listo", enVuelo: false, error: null, clave: JSON.stringify("otra") };
    assert.equal(alBorradorGuirnaldaOrganica(estado, conForma(BASE, "largoM", 5)).borrador, "pendiente");
  });

  await caso("Guardar solo con un dibujo del motor, sin cambios que perder ni otro ajuste en curso", () => {
    const listo = { borrador: "listo" as const, error: null };
    const entra = { hayCambios: true, guardando: false, ocupado: false };
    assert.deepEqual(puedeGuardarGuirnaldaOrganica({ estado: listo, ...entra }), { puede: true });
    assert.deepEqual(puedeGuardarGuirnaldaOrganica({ estado: { borrador: "pendiente", error: null }, ...entra }), { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" });
    const rechazado = puedeGuardarGuirnaldaOrganica({ estado: { borrador: "rechazado", error: { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true } }, ...entra });
    assert.deepEqual(rechazado, { puede: false, motivo: MOTOR.rechazo.mensaje, tipo: "error" }, "la frase del motor, tal cual");
    assert.equal(puedeGuardarGuirnaldaOrganica({ estado: { borrador: "fallido", error: { mensaje: "Sin conexión.", armadoInvalido: false } }, ...entra }).puede, false);
    assert.equal(puedeGuardarGuirnaldaOrganica({ estado: listo, ...entra, hayCambios: false }).puede, false);
    assert.equal(puedeGuardarGuirnaldaOrganica({ estado: listo, ...entra, ocupado: true }).puede, false);
    assert.equal(puedeGuardarGuirnaldaOrganica({ estado: listo, ...entra, guardando: true }).puede, false);
    const colores = puedeGuardarGuirnaldaOrganica({ estado: listo, ...entra, coloresCambiaron: true });
    assert.equal(colores.puede, false);
    assert.match(colores.puede ? "" : colores.motivo, /revisa la paleta/);
  });

  await caso("Guardar va por la ruta de edición que ya existe, con el borrador tal cual", async () => {
    const borrador = conVolumen(BASE, "relleno", 0.5);
    const edicion = { accion: "armado_guirnalda_organica", estructura_id: ESTRUCTURA_ID, armado_guirnalda_organica: borrador };
    assert.deepEqual(EdicionArmadoGuirnaldaOrganicaSchema.parse(edicion), edicion, "la edición lleva el armado entero, sin tocar");
    assert.equal(EdicionArmadoGuirnaldaOrganicaSchema.parse({ ...edicion, armado_guirnalda_organica: null }).armado_guirnalda_organica, null, "quitar el armado también");
    assert.equal(EdicionArmadoGuirnaldaOrganicaSchema.safeParse({ ...edicion, armado_guirnalda_organica: { ...borrador, campo_nuevo: 1 } }).success, false);
    assert.equal(EdicionArmadoGuirnaldaOrganicaSchema.safeParse({ ...edicion, extra: 1 }).success, false);
    const llamadas: Array<{ url: string; cuerpo: unknown }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify({ error: "armado_invalido", motivo: MOTOR.rechazo.motivo, mensaje: MOTOR.rechazo.mensaje }), { status: 422, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    await assert.rejects(
      () => pedirPlanEditarArmado({ modo: "aplicar", base: {}, edicion }, "No se pudo.", { fetcher }),
      (error: unknown) => error instanceof FalloPlanArmado && error.armadoInvalido && error.message === MOTOR.rechazo.mensaje,
    );
    assert.equal(llamadas[0]!.url, "/api/plan-editar", "la ruta de siempre: no hay otra");
    assert.deepEqual((llamadas[0]!.cuerpo as { edicion: unknown }).edicion, edicion);
  });

  // --- Lo que se ve -------------------------------------------------------------------------------------------------

  const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const pintarControles = (borrador: ArmadoGuirnaldaOrganicaV1, limites: LimitesGuirnaldaOrganica = VISTA.limites) =>
    renderToStaticMarkup(React.createElement(ControlesGuirnaldaOrganica, { borrador, opciones: VISTA.opciones, limites, leyenda: LEYENDA, onCambiar: () => {} }));
  const pintarEditor = (sobre: Partial<React.ComponentProps<typeof EditorGuirnaldaOrganica>> = {}) =>
    renderToStaticMarkup(React.createElement(EditorGuirnaldaOrganica, {
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
      onUsarGuirnaldaDeLaPropuesta: () => {},
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
    const repartoActual = VISTA.opciones.repartos.find((reparto) => reparto.valor === BASE.colores.reparto)!;
    if (repartoActual.ayuda) assert.ok(visible.includes(repartoActual.ayuda), "la ayuda del reparto sale del motor");
    for (const pulgadas of VISTA.opciones.tamanos) assert.ok(visible.includes(`Globos de ${pulgadas}″`), `un deslizador por tamaño: ${pulgadas}″`);
    for (const interno of ["largoM", "alturaM", "grosorPatasM", "grandesAbajo", "armado-guirnalda-organica", "festones:"]) {
      assert.ok(!visible.includes(interno), `clave interna visible: ${interno}`);
    }
    // Los rangos del largo, la altura y los grosores son los vivos del motor.
    for (const valor of [VISTA.limites.largoMin, VISTA.limites.alturaMin, VISTA.limites.grosorExtremosMin, VISTA.limites.grosorCentroMin]) assert.ok(html.includes(`min="${valor}"`), `falta el rango ${valor}`);
    // Una paleta por color de la pieza, cada una con su selector de color, de acabado y de papel.
    assert.equal((html.match(/data-testid="color-guirnalda-\d"/g) ?? []).length, BASE.colores.paleta.length);
    assert.ok(html.includes("Acabado del color 1") && html.includes("Papel del color 2") && html.includes("Cuánto pesa el color 1"));
    // Accesibilidad: deslizadores con etiqueta y texto de valor, grupo de radio y lo que se toca mide 44 px.
    assert.ok((html.match(/type="range"/g) ?? []).length >= 12);
    assert.ok(html.includes("aria-valuetext") && html.includes('role="radiogroup"'));
    assert.ok((html.match(/min-h-11/g) ?? []).length >= 4, "los botones y las listas miden al menos 44 px");
    assert.ok(html.includes('data-testid="apartado-colores-guirnalda"') && /<details open=""[^>]*data-testid="apartado-colores-guirnalda"/.test(html), "el apartado de los colores va abierto");
    assert.ok(!/<details open=""[^>]*data-testid="apartado-forma-guirnalda"/.test(html), "los demás van plegados para no agrandar la tarjeta");
  });

  await caso("los mandos hablan en palabras de oficio, y ninguno se queda sin decir qué cambia en la pieza", () => {
    const html = pintarControles(BASE);
    const visible = texto(html);
    // La jerga del motor que esta pantalla ya no enseña, con lo que el decorador lee en su lugar.
    for (const [antes, ahora] of [
      ["Festones", "Cuántas caídas"],
      ["Lado más cargado", "Qué lado va más grueso"],
      ["Irregularidad", "Qué tan desparejo queda el borde"],
      ["Grandes abajo", "Dónde van los globos grandes"],
      ["Variación de tamaño", "Globos de distinto tamaño"],
      ["Globos que se salen de la banda", "Globos que asoman del borde"],
      ["Inflado", "Qué tan inflados"],
    ] as const) {
      assert.ok(!visible.includes(antes), `jerga del motor a la vista: ${antes}`);
      assert.ok(visible.includes(ahora), `falta el mando en palabras de oficio: ${ahora}`);
    }
    // Ni claves del contrato ni huecos de desarrollo: lo que se lee es español de decoración.
    assert.ok(!/\bnull\b|\bundefined\b|armado_guirnalda|grosorCimaM|pendienteM|colgadoM|salientes/.test(visible), "sin claves técnicas a la vista");
    // Cada mando lleva su frase de ayuda (`aria-describedby`), menos los pesos de cada tamaño, que la llevan juntos
    // en el párrafo del apartado.
    const mandos = [...html.matchAll(/<(?:input|select)\b[^>]*data-testid="[^"]*"[^>]*>/g)].map((hallado) => hallado[0]);
    assert.ok(mandos.length >= 25, `se esperaban todos los mandos de la pantalla, no ${mandos.length}`);
    const sinAyuda = mandos.filter((mando) => !mando.includes('data-testid="peso-tamano-') && !mando.includes("aria-describedby"));
    assert.deepEqual(sinAyuda, [], "cada mando dice en una frase qué cambia en la pieza");
  });

  await caso("con una banda gruesa el rango del largo cambia: es el que dice el motor", () => {
    const fino = pintarControles(MOTOR.por_grosor["0.4"]!.armado, MOTOR.por_grosor["0.4"]!.limites);
    const grueso = pintarControles(MOTOR.por_grosor["1.2"]!.armado, MOTOR.por_grosor["1.2"]!.limites);
    const minimoDelLargo = (html: string): number => Number(/<input[^>]*data-testid="largo-guirnalda"[^>]*>/.exec(html)![0].match(/min="([^"]+)"/)![1]);
    assert.equal(minimoDelLargo(fino), MOTOR.por_grosor["0.4"]!.limites.largoMin);
    assert.equal(minimoDelLargo(grueso), MOTOR.por_grosor["1.2"]!.limites.largoMin);
    assert.ok(minimoDelLargo(grueso) > minimoDelLargo(fino), "una banda gruesa pide más largo");
  });

  await caso("el editor: listo para guardar, con cada estado explícito y los botones de siempre", () => {
    const listo = pintarEditor();
    assert.ok(listo.includes('data-testid="editor-guirnalda-organica"') && listo.includes(">Editar guirnalda<"));
    assert.match(texto(listo), /Listo para guardar\. Al guardar se recalcula la compra con el catálogo/);
    assert.ok(/data-testid="guardar-guirnalda-organica"/.test(listo) && !/disabled=""[^>]*data-testid="guardar-guirnalda-organica"/.test(listo));
    assert.ok(texto(listo).includes("Guardar guirnalda") && texto(listo).includes("Descartar cambios") && texto(listo).includes("Restablecer") && texto(listo).includes("Volver a la receta"));
    assert.ok(listo.includes("la propuesta cambia de firma"), "se dice qué pasa al guardar");
    // Sin cambios: Cerrar en lugar de Descartar, y Guardar espera.
    const quieto = pintarEditor({ hayCambios: false, guardar: { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" } });
    assert.ok(texto(quieto).includes("Todavía no cambiaste nada.") && texto(quieto).includes("Cerrar") && !texto(quieto).includes("Descartar cambios"));
    assert.ok(/disabled=""[^>]*data-testid="guardar-guirnalda-organica"|data-testid="guardar-guirnalda-organica"[^>]*disabled=""/.test(quieto));
    // El motor rechazó el borrador: su frase, tal cual y con rol de alerta.
    const rechazo = pintarEditor({ vista: { vista: VISTA, borrador: "rechazado", error: { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true } }, guardar: { puede: false, motivo: MOTOR.rechazo.mensaje, tipo: "error" } });
    assert.ok(rechazo.includes(MOTOR.rechazo.mensaje) && rechazo.includes('role="alert"'));
    assert.ok(!rechazo.includes("reintentar-editor-guirnalda-organica"), "un rechazo del motor no se reintenta");
    const fallo = pintarEditor({ vista: { vista: VISTA, borrador: "fallido", error: { mensaje: "Sin conexión.", armadoInvalido: false } }, guardar: { puede: false, motivo: "Sin conexión.", tipo: "error" } });
    assert.ok(fallo.includes("Sin conexión.") && fallo.includes("reintentar-editor-guirnalda-organica"));
    // Sin las herramientas del motor todavía: cargando, sin mandos inventados.
    const cargando = pintarEditor({ vista: { vista: null, borrador: "pendiente", error: null }, guardar: { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" } });
    assert.ok(cargando.includes("Cargando los ajustes del motor…") && !cargando.includes('type="range"'));
    // Lo que el guardado no pudo meter en el plan.
    const noGuardo = pintarEditor({ errorGuardado: "El catálogo no vende los globos que esa guirnalda necesita (R-36)." });
    assert.ok(noGuardo.includes("No se guardó: El catálogo no vende los globos") && noGuardo.includes("La propuesta sigue como estaba."));
    // Los colores de la pieza cambiaron y la paleta está sin revisar; la propuesta cambió bajo el borrador.
    const colores = pintarEditor({ coloresCambiaron: true, guardar: { puede: false, motivo: "revisa", tipo: "colores" } });
    assert.ok(colores.includes("Los colores de la pieza cambiaron: revisa la paleta.") && colores.includes("Seguir con mi borrador") && colores.includes("Usar la guirnalda de la propuesta"));
    assert.ok(pintarEditor({ planCambio: true }).includes("La propuesta cambió mientras editabas la guirnalda."));
  });

  await caso("el bloque: «Editar guirnalda» en el encabezado y el dibujo apagado cuando no es el del borrador", () => {
    const pintar = (estado: React.ComponentProps<typeof PanelGuirnaldaOrganica>["estado"], accion?: React.ReactNode) =>
      renderToStaticMarkup(React.createElement(PanelGuirnaldaOrganica, { estado, leyenda: LEYENDA, nombrePieza: "Guirnalda", repeticiones: 1, onReintentar: () => {}, accion }));
    const boton = React.createElement("button", { type: "button", "data-testid": "editar-guirnalda-organica" }, "Editar guirnalda");
    assert.ok(pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }, boton).includes("Editar guirnalda"));
    assert.ok(!pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes("Editar guirnalda"), "sin onGuardar es de solo lectura");
    const nuevo = pintar({ fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    assert.ok(nuevo.includes("opacity-60") && nuevo.includes("Actualizando…") && nuevo.includes('aria-busy="true"'));
    const vencido = pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    assert.ok(vencido.includes("opacity-60") && vencido.includes("Es el último dibujo que llegó."));
    assert.ok(!pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes("opacity-60"));
    assert.ok(pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes('data-testid="avisos-vivos-armado-guirnalda-organica"'), "la región de avisos siempre está montada");
  });

  await caso("al editar, el dibujo y los mandos se ven A LA VEZ: dos columnas y el scroll en los mandos", () => {
    // La prueba que faltaba y que habria cazado lo que el usuario reporto. Las cuatro piezas del motor ya
    // dejaban el dibujo montado al abrir el editor, asi que desde el codigo parecia correcto; en pantalla no
    // lo era, porque el editor se apilaba DEBAJO y empujaba el dibujo fuera de la vista. Movias un deslizador,
    // la pieza cambiaba de verdad y no se veia nada (2026-10-04).
    const pintar = (conEditor: boolean) =>
      renderToStaticMarkup(React.createElement(PanelGuirnaldaOrganica, {
        estado: { fase: "listo", vista: VISTA, actualizando: false, fallo: null },
        leyenda: LEYENDA, nombrePieza: "Guirnalda", repeticiones: 1, onReintentar: () => {},
        ...(conEditor ? { pie: React.createElement("div", { "data-testid": "editor-de-prueba" }, "mandos") } : {}),
      } as React.ComponentProps<typeof PanelGuirnaldaOrganica>));

    const editando = pintar(true);
    assert.ok(editando.includes('data-testid="editor-de-prueba"'), "el editor se monta");
    assert.ok(editando.includes("Armado de la guirnalda"), "y el dibujo sigue ahi, en el mismo render");
    assert.ok(editando.includes('data-testid="mandos-edicion"'), "los mandos van en su propia columna");
    assert.ok(editando.includes("@3xl:grid-cols-"), "dos columnas cuando la tarjeta da el ancho");
    const bloqueMandos = /data-testid="mandos-edicion"[^>]*>/.exec(editando)?.[0] ?? "";
    assert.ok(bloqueMandos.includes("overflow-y-auto"), "el scroll es de los mandos: es lo que impide que el dibujo se vaya");
    assert.ok(bloqueMandos.includes("max-h-"), "y tienen altura tope, o volverian a empujar el dibujo fuera");
    // El orden importa: el dibujo primero y los mandos despues, para que el foco y el lector sigan la pieza.
    assert.ok(editando.indexOf("Armado de la guirnalda") < editando.indexOf('data-testid="mandos-edicion"'));

    // Sin editor nada cambia: una pieza que solo se mira se ve exactamente como antes.
    const soloLectura = pintar(false);
    assert.ok(!soloLectura.includes('data-testid="mandos-edicion"'));
    assert.ok(!soloLectura.includes("@3xl:grid-cols-"), "la rejilla de edicion no aparece fuera de la edicion");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
