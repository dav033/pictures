/**
 * Editor de arcos con vista previa en vivo (ADR-0035, paso 1). Módulos sin React y render estático, sin red ni
 * proveedores, como `test-ui-armado-arco.ts`. La salida del motor es REAL: `vista-arco.json` (sus catorce
 * patrones y sus rangos) y `limites-por-globo.json` (los rangos vivos de `limites_de` y los avisos de lo que el
 * motor corrige, por tamaño de globo), ambos escritos por Python. Nada de lo que el motor decide está escrito
 * a mano aquí.
 *
 * Lo que vigila:
 * - **el cliente no calcula**: el armado que se manda al motor es exactamente el borrador, y cada cambio del
 *   borrador es UN campo; los rangos y los avisos son los del motor, carácter por carácter;
 * - **los rangos viven en el motor**: al cambiar el tamaño de globo cambian los del ancho y los de los globos a
 *   lo ancho, y los mandos del patrón salen de `opciones_admitidas` (los catorce, con la forma del contrato);
 * - **operación concurrente**: pausa, cancelación, gana la última respuesta y una respuesta vieja nunca se pinta;
 * - **estados explícitos** y Guardar solo con un dibujo del motor, por la ruta de edición que ya existe.
 *
 * Run: npx tsx scripts/test/test-ui-editor-arco.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelArco } from "@/components/plan/arco/BloqueArco";
import { ControlesArco } from "@/components/plan/arco/ControlesArco";
import { EditorArco } from "@/components/plan/arco/EditorArco";
import {
  conAlto,
  conAncho,
  conColor,
  conColorAgregado,
  conControl,
  conForma,
  conGlobosAncho,
  conInflado,
  conPatron,
  conTamanoGlobo,
  conUltimoColorQuitado,
  materialesParaPatron,
  mismoArmadoArco,
  patronDisponible,
  rangoDeAlto,
  rangoDeAncho,
  rangoDeGlobosAncho,
  rangoDeInflado,
  valorDeControl,
  valorEnRango,
} from "@/components/plan/arco/borrador-arco";
import { puedeGuardarArco } from "@/components/plan/arco/guardar-arco";
import { peticionVistaArco, type PiezaVistaArco } from "@/components/plan/arco/vista-arco";
import { alBorradorArco, crearVistaBorradorArco, panelDeBorradorArco, type EstadoVistaBorradorArco } from "@/components/plan/arco/vista-borrador-arco";
import type { Reloj } from "@/components/plan/autoguardado";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoArcoV1Schema, GloboArcoSchema, type ArmadoArcoV1, type TamanoArco } from "@/lib/plan/armado-arco";
import { EdicionArmadoArcoSchema } from "@/lib/plan/edicion-esquemas";
import type { LimitesArco } from "@/lib/plan/opciones-armado-arco";
import { OpcionesArmadoArcoSchema } from "@/lib/plan/opciones-armado-arco";
import { FalloPlanArmado, pedirPlanEditarArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoArco, type VistaArmadoArco } from "@/lib/plan/peticion-armado-arco";
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

const FIXTURE = leerJson("scripts/fixtures/arco-ui/vista-arco.json") as {
  peticion: { estructura_id: string; armado_arco: ArmadoArcoV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const MOTOR = leerJson("scripts/fixtures/arco-ui/limites-por-globo.json") as {
  base: ArmadoArcoV1;
  colores: string[];
  por_tamano: Record<string, { limites: LimitesArco; avisos: string[]; globos: number }>;
  avisos_alto_imposible: { armado: ArmadoArcoV1; avisos: string[] };
  rechazo: { armado: ArmadoArcoV1; motivo: string; mensaje: string };
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const BASE = ArmadoArcoV1Schema.parse(FIXTURE.peticion.armado_arco);
const PIEZA: PiezaVistaArco = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
const DECLARADA = RESUELTO.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const RESUELTA = RESUELTO.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const LEYENDA = leyendaPatron(DECLARADA.materiales, RESUELTA.lineas, undefined);
const COLORES_DE_PIEZA = LEYENDA.length;

/** El dibujo del motor de la fixture, validado por la misma frontera que usa la pantalla. */
async function vistaDeLaFixture(): Promise<VistaArmadoArco> {
  const fetcher = (async () => new Response(JSON.stringify(FIXTURE.respuesta), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  return pedirVistaArmadoArco(peticionVistaArco(PIEZA, BASE), { fetcher });
}

/** Cuántos campos (rutas hasta una hoja) distinguen dos armados. */
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

type Peticion = { armado: ArmadoArcoV1; signal: AbortSignal; resolver: (vista: VistaArmadoArco) => void; rechazar: (error: unknown) => void };

function puertoFalso() {
  const peticiones: Peticion[] = [];
  const pedir = (armado: ArmadoArcoV1, signal: AbortSignal): Promise<VistaArmadoArco> =>
    new Promise<VistaArmadoArco>((resolver, rechazar) => {
      signal.addEventListener("abort", () => rechazar(new DOMException("cancelada", "AbortError")));
      peticiones.push({ armado, signal, resolver, rechazar });
    });
  return { pedir, peticiones };
}

/** Un dibujo del motor "de" un armado: el de la fixture con su eco cambiado (el puerto simulado no calcula nada). */
function vistaDe(base: VistaArmadoArco, armado: ArmadoArcoV1, marca: string): VistaArmadoArco {
  return { ...base, armado, arco: { ...base.arco, avisos: [marca] } };
}

const tick = () => new Promise<void>((listo) => setTimeout(listo, 0));

async function main(): Promise<void> {
  const VISTA = await vistaDeLaFixture();

  await caso("el borrador: cada cambio es UN campo del armado, marcado del decorador, sin tocar el original", () => {
    const copia = structuredClone(BASE);
    const casosCambio: Array<[string, ArmadoArcoV1, string]> = [
      ["mando del patrón", conControl(BASE, "ancho", 4), ".opciones.ancho"],
      ["forma", conForma(BASE, "semi"), ".geometria.forma"],
      ["ancho", conAncho(BASE, 4.5), ".geometria.anchoM"],
      ["alto", conAlto(BASE, 2.8), ".geometria.altoM"],
      ["globos a lo ancho", conGlobosAncho(BASE, 3), ".geometria.globosAncho"],
      ["tamaño de globo", conTamanoGlobo(BASE, 18), ".globo.nominal"],
      ["inflado", conInflado(BASE, 0.9), ".globo.inflado"],
    ];
    for (const [nombre, siguiente, campo] of casosCambio) {
      assert.deepEqual(diferencias(BASE, siguiente).filter((ruta) => ruta !== ".origen"), [campo], `${nombre}: debe cambiar solo ${campo}`);
      assert.equal(siguiente.origen, "decorador", `${nombre}: lo cambió el decorador`);
      assert.ok(ArmadoArcoV1Schema.safeParse(siguiente).success, `${nombre}: sigue cumpliendo armado-arco.v1`);
    }
    assert.deepEqual(BASE, copia, "el armado original no se muta");
    // Lo que no cambia, no se vuelve a crear.
    assert.equal(conForma(BASE, BASE.geometria.forma), BASE);
    assert.equal(conTamanoGlobo(BASE, BASE.globo.nominal), BASE);
    assert.ok(mismoArmadoArco(BASE, { ...BASE, origen: "decorador" }), "quién lo firmó no lo vuelve otro armado");
    assert.ok(!mismoArmadoArco(BASE, conAncho(BASE, 4.5)));
  });

  await caso("el patrón: sus mandos arrancan en lo que el motor dice y toma los colores que admite", () => {
    const opciones = VISTA.opciones;
    assert.equal(opciones.patrones.length, 14, "los catorce patrones salen del motor");
    const arcoiris = opciones.patrones.find((patron) => patron.id === "arcoiris")!;
    const solido = opciones.patrones.find((patron) => patron.id === "solido")!;
    const siguiente = conPatron(BASE, arcoiris, COLORES_DE_PIEZA);
    assert.equal(siguiente.patron, "arcoiris");
    assert.deepEqual(siguiente.opciones, {}, "el cliente no copia valores por defecto: el motor rellena los que falten");
    assert.deepEqual(siguiente.materiales, materialesParaPatron(arcoiris, COLORES_DE_PIEZA));
    assert.equal(conPatron(BASE, opciones.patrones.find((patron) => patron.id === BASE.patron)!, COLORES_DE_PIEZA), BASE, "el mismo patrón no cambia nada");
    // Un patrón de color fijo toma los que pide; uno de lista, todos los de la pieza hasta su máximo.
    assert.deepEqual(materialesParaPatron(solido, 3), [0]);
    assert.deepEqual(materialesParaPatron({ lista: { min: 2, max: 8, etiqueta: "Bloque" }, min_colores: 2, max_colores: 8 }, 3), [0, 1, 2]);
    assert.deepEqual(materialesParaPatron({ lista: { min: 2, max: 4, etiqueta: "Franja" }, min_colores: 2, max_colores: 4 }, 6), [0, 1, 2, 3]);
    // Solo se impide el patrón al que la pieza no le da colores.
    assert.ok(patronDisponible({ min_colores: 3 }, 3) && !patronDisponible({ min_colores: 3 }, 2));
  });

  await caso("los mandos del motor caben en el contrato: cada uno, en su mínimo, su máximo y su defecto, es un armado válido", () => {
    let mandos = 0;
    for (const patron of VISTA.opciones.patrones) {
      for (const control of patron.controles) {
        mandos += 1;
        for (const valor of [control.min, control.max, control.defecto]) {
          const siguiente = conControl({ ...BASE, patron: patron.id, opciones: {} }, control.clave, valor);
          assert.equal(valorDeControl(siguiente, control), valor, `${patron.id}.${control.clave}=${valor} no entró en el armado: el contrato y el motor se separaron`);
          assert.ok(ArmadoArcoV1Schema.safeParse(siguiente).success, `${patron.id}.${control.clave}`);
        }
        assert.ok(control.etiqueta && control.paso > 0, "etiqueta y paso salen del motor");
      }
    }
    assert.ok(mandos >= 20, `esperaba los mandos de los catorce patrones, hay ${mandos}`);
    // Un mando que el contrato no conoce deja el borrador como estaba, sin inventar un campo.
    assert.equal(conControl(BASE, "mando_inventado", 1), BASE);
    // Un mando sin valor en el armado muestra el defecto que dice el motor.
    assert.equal(valorDeControl({ ...BASE, opciones: {} }, { clave: "ancho", defecto: 2 }), 2);
  });

  await caso("los rangos salen de limites_de: cambian con el tamaño del globo y son los del motor, cifra por cifra", () => {
    const rangos = (nominal: TamanoArco) => {
      const { limites } = MOTOR.por_tamano[String(nominal)]!;
      return { ancho: rangoDeAncho(limites), alto: rangoDeAlto(limites), globos: rangoDeGlobosAncho(limites), limites };
    };
    const r12 = rangos(12);
    const r36 = rangos(36);
    assert.equal(r12.ancho.min, MOTOR.por_tamano["12"]!.limites.anchoMin);
    assert.equal(r36.ancho.min, MOTOR.por_tamano["36"]!.limites.anchoMin);
    assert.ok(r36.ancho.min > r12.ancho.min, "un globo R36 sube el ancho mínimo del arco");
    assert.ok(r36.globos.max < r12.globos.max, "y baja los globos que caben a lo ancho");
    assert.ok(r36.alto.min > r12.alto.min, "y el alto mínimo de la herradura");
    assert.equal(r36.ancho.max, MOTOR.por_tamano["36"]!.limites.anchoMax);
    assert.equal(r12.globos.paso, MOTOR.por_tamano["12"]!.limites.nPaso);
    for (const nominal of [5, 9, 12, 18, 24, 36] as const) {
      const { limites, ancho, alto, globos } = rangos(nominal);
      assert.deepEqual([ancho.min, ancho.max, alto.min, alto.max, globos.min, globos.max], [limites.anchoMin, limites.anchoMax, limites.altoMin, limites.altoMax, limites.nMin, limites.nMax]);
    }
    // El inflado no lo publica `opciones_admitidas`: su rango es el del contrato, leído del esquema.
    const inflado = rangoDeInflado();
    assert.equal(inflado.min, GloboArcoSchema.shape.inflado.minValue);
    assert.equal(inflado.max, GloboArcoSchema.shape.inflado.maxValue);
    // Pintar un valor fuera de su rango lo deja en el borde, sin decidir nada por el motor.
    assert.equal(valorEnRango(3.0, r36.ancho), r36.ancho.min);
    assert.equal(valorEnRango(99, r36.ancho), r36.ancho.max);
    assert.equal(valorEnRango(5, r36.ancho), 5);
  });

  await caso("la petición al motor lleva exactamente el borrador, y nada más que el contrato de la ruta", () => {
    const borrador = conTamanoGlobo(conAncho(BASE, 4.2), 18);
    const cuerpo = peticionVistaArco(PIEZA, borrador);
    assert.deepEqual(Object.keys(cuerpo).sort(), ["armado_arco", "colores", "estructura_id", "plan"]);
    assert.deepEqual(cuerpo.armado_arco, borrador, "el armado viaja sin tocar: ni conteo, ni medidas, ni geometría calculada");
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
  });

  await caso("pausa: varios cambios seguidos son UNA petición, la del último", () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    control.mostrar(conAncho(BASE, 3.4));
    avanzar(200);
    control.mostrar(conAncho(BASE, 3.6));
    avanzar(200);
    control.mostrar(conAncho(BASE, 3.8));
    assert.equal(peticiones.length, 0, "dentro de la pausa no se pide nada");
    avanzar(299);
    assert.equal(peticiones.length, 0);
    avanzar(1);
    assert.equal(peticiones.length, 1, "pasada la pausa sin otro cambio, una sola petición");
    assert.deepEqual(peticiones[0]!.armado, conAncho(BASE, 3.8), "y es la del último borrador");
    assert.equal(control.estado().borrador, "pendiente");
    assert.equal(control.estado().enVuelo, true);
  });

  await caso("gana la última: otro borrador cancela el que vuela y una respuesta vieja que llega igual no se pinta", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    const a = conAncho(BASE, 3.4);
    const b = conAncho(BASE, 3.9);
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
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    assert.equal(control.estado().borrador, "listo", "el dibujo del plan se ve desde el primer momento, sin petición");
    assert.equal(peticiones.length, 0);
    const siguiente = conAncho(BASE, 3.9);
    control.mostrar(siguiente);
    assert.equal(control.estado().vista, VISTA, "el dibujo que hay sigue a la vista");
    assert.equal(control.estado().borrador, "pendiente");
    assert.deepEqual(panelDeBorradorArco(control.estado()), { fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, siguiente, "listo"));
    await tick();
    assert.deepEqual(panelDeBorradorArco(control.estado()), { fase: "listo", vista: control.estado().vista!, actualizando: false, fallo: null });
  });

  await caso("volver a un borrador que el motor ya dibujó no vuelve a pedirlo", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    const otro = conTamanoGlobo(BASE, 18);
    control.mostrar(otro);
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, otro, "r18"));
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
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    const malo = MOTOR.rechazo.armado;
    control.mostrar(malo);
    avanzar(300);
    peticiones[0]!.rechazar(new FalloPlanArmado(MOTOR.rechazo.mensaje, { motivo: MOTOR.rechazo.motivo, armadoInvalido: true }));
    await tick();
    assert.equal(control.estado().borrador, "rechazado");
    assert.deepEqual(control.estado().error, { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true });
    assert.equal(control.estado().vista, VISTA, "el último dibujo sigue ahí");
    assert.deepEqual(panelDeBorradorArco(control.estado()), { fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    avanzar(5000);
    assert.equal(peticiones.length, 1, "lo que el motor rechazó no se vuelve a pedir solo");
    // Un fallo de transporte: tampoco solo, pero sí con "Reintentar".
    const otro = conAncho(BASE, 4.4);
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
    control.mostrar(conAncho(BASE, 4.6));
    assert.equal(control.estado().error, null);
  });

  await caso("cerrar el editor cancela lo que quede, y un fallo de otro borrador no ensucia el que se ve", async () => {
    const { reloj, avanzar, pendientes } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    control.mostrar(conAncho(BASE, 3.9));
    avanzar(300);
    control.cerrar();
    assert.equal(peticiones[0]!.signal.aborted, true);
    control.mostrar(conAncho(BASE, 4.1));
    assert.equal(pendientes(), 1, "después de cerrar, un borrador nuevo empieza de cero");
    control.cerrar();
    assert.equal(pendientes(), 0, "cerrar apaga la pausa que esperaba");
    // El estado de este render no confunde el "listo" del borrador anterior con el del nuevo.
    const estado: EstadoVistaBorradorArco = { vista: VISTA, borrador: "listo", enVuelo: false, error: null, clave: JSON.stringify("otra") };
    assert.equal(alBorradorArco(estado, conAncho(BASE, 5)).borrador, "pendiente");
  });

  await caso("Guardar solo con un dibujo del motor, sin cambios que perder ni otro ajuste en curso", () => {
    const listo = { borrador: "listo" as const, error: null };
    const entra = { hayCambios: true, guardando: false, ocupado: false };
    assert.deepEqual(puedeGuardarArco({ estado: listo, ...entra }), { puede: true });
    assert.deepEqual(puedeGuardarArco({ estado: { borrador: "pendiente", error: null }, ...entra }), { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" });
    const rechazado = puedeGuardarArco({ estado: { borrador: "rechazado", error: { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true } }, ...entra });
    assert.deepEqual(rechazado, { puede: false, motivo: MOTOR.rechazo.mensaje, tipo: "error" }, "la frase del motor, tal cual");
    assert.equal(puedeGuardarArco({ estado: { borrador: "fallido", error: { mensaje: "Sin conexión.", armadoInvalido: false } }, ...entra }).puede, false);
    assert.equal(puedeGuardarArco({ estado: listo, ...entra, hayCambios: false }).puede, false);
    assert.equal(puedeGuardarArco({ estado: listo, ...entra, ocupado: true }).puede, false);
    assert.equal(puedeGuardarArco({ estado: listo, ...entra, guardando: true }).puede, false);
  });

  await caso("Guardar va por la ruta de edición que ya existe, con el borrador tal cual", async () => {
    const borrador = conTamanoGlobo(BASE, 18);
    const edicion = { accion: "armado_arco", estructura_id: ESTRUCTURA_ID, armado_arco: borrador };
    assert.deepEqual(EdicionArmadoArcoSchema.parse(edicion), edicion, "la edición lleva el armado entero, sin tocar");
    assert.equal(EdicionArmadoArcoSchema.parse({ ...edicion, armado_arco: null }).armado_arco, null, "quitar el armado también");
    assert.equal(EdicionArmadoArcoSchema.safeParse({ ...edicion, armado_arco: { ...borrador, patron: "inventado" } }).success, false);
    assert.equal(EdicionArmadoArcoSchema.safeParse({ ...edicion, extra: 1 }).success, false);
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
  const pintarControles = (borrador: ArmadoArcoV1, limites: LimitesArco = VISTA.limites) =>
    renderToStaticMarkup(React.createElement(ControlesArco, { borrador, opciones: VISTA.opciones, limites, leyenda: LEYENDA, onCambiar: () => {} }));
  const pintarEditor = (sobre: Partial<React.ComponentProps<typeof EditorArco>> = {}) =>
    renderToStaticMarkup(React.createElement(EditorArco, {
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

  await caso("los ajustes: etiquetas y ayudas del motor, sin claves internas visibles, con sus rangos", () => {
    const html = pintarControles(BASE);
    const visible = texto(html);
    const chevron = VISTA.opciones.patrones.find((patron) => patron.id === "chevron")!;
    for (const control of chevron.controles) {
      assert.ok(visible.includes(control.etiqueta), `falta la etiqueta del motor: ${control.etiqueta}`);
      if (control.ayuda) assert.ok(visible.includes(control.ayuda), `falta la ayuda del motor: ${control.ayuda}`);
    }
    assert.ok(!visible.includes(chevron.descripcion), "la frase del patrón ya está sobre el dibujo (PanelArco): no se repite en los ajustes");
    for (const patron of VISTA.opciones.patrones) assert.ok(visible.includes(patron.nombre), `el patrón ${patron.nombre} sale del motor`);
    for (const interno of ["anchoM", "altoM", "globosAncho", "variacionTono", "espiralPunteada", "cadaN", "armado-arco"]) {
      assert.ok(!visible.includes(interno), `clave interna visible: ${interno}`);
    }
    // El rango de cada mando del patrón es el que el motor publica.
    const ancho = chevron.controles.find((control) => control.clave === "ancho")!;
    assert.ok(html.includes(`min="${ancho.min}"`) && html.includes(`max="${ancho.max}"`) && html.includes(`step="${ancho.paso}"`));
    // El ancho y el alto, los rangos vivos con el armado puesto.
    assert.ok(html.includes(`min="${VISTA.limites.anchoMin}"`) && html.includes(`min="${VISTA.limites.altoMin}"`));
    // Accesibilidad: cada deslizador con su etiqueta y su texto de valor.
    assert.ok((html.match(/type="range"/g) ?? []).length >= 5);
    assert.ok(html.includes("aria-valuetext") && html.includes('role="radiogroup"') && html.includes('role="switch"'));
  });

  await caso("con globos R36 los rangos del control cambian y los globos a lo ancho ya no se pueden mover", () => {
    const r12 = pintarControles(BASE, MOTOR.por_tamano["12"]!.limites);
    const armado36 = conTamanoGlobo(BASE, 36);
    const r36 = pintarControles(armado36, MOTOR.por_tamano["36"]!.limites);
    const limites36 = MOTOR.por_tamano["36"]!.limites;
    assert.ok(r12.includes(`min="${MOTOR.por_tamano["12"]!.limites.anchoMin}"`));
    assert.ok(r36.includes(`min="${limites36.anchoMin}"`) && !r36.includes(`min="${MOTOR.por_tamano["12"]!.limites.anchoMin}"`), "el ancho mínimo sube con el globo");
    assert.match(r36, /type="range"[^>]*disabled=""[^>]*data-testid="mando-globos-ancho"|data-testid="mando-globos-ancho"[^>]*disabled=""/, "con R36 caben 2 a lo ancho: no hay recorrido");
    // El ancho pedido (3,2 m) queda por debajo del mínimo nuevo: se pinta en el borde, como el dibujo del motor.
    assert.ok(texto(r36).includes("3,8 m"));
  });

  await caso("el semicírculo no tiene alto que elegir y la pantalla lo dice", () => {
    const html = pintarControles(conForma(BASE, "semi"));
    assert.ok(html.includes('data-testid="alto-del-semicirculo"'));
    assert.ok(!html.includes('data-testid="mando-alto"'));
  });

  await caso("el editor: listo, pendiente, rechazado, sin respuesta, sin cambios y plan cambiado", () => {
    const listo = pintarEditor();
    assert.ok(listo.includes('data-testid="editor-arco"') && texto(listo).includes("Listo para guardar"));
    assert.ok(/data-testid="guardar-arco"/.test(listo) && !/disabled=""[^>]*data-testid="guardar-arco"|data-testid="guardar-arco"[^>]*disabled=""/.test(listo), "Guardar habilitado con un dibujo del motor");
    assert.ok(texto(listo).includes("es otra decoración"), "se dice que guardar cambia la firma del plan");

    const pendiente = pintarEditor({ vista: { vista: VISTA, borrador: "pendiente", error: null }, guardar: { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" } });
    assert.ok(texto(pendiente).includes("Dibujando tus cambios…"));
    assert.match(pendiente, /data-testid="guardar-arco"[^>]*disabled=""|disabled=""[^>]*data-testid="guardar-arco"/);
    assert.ok(!pendiente.includes('role="alert"'));

    const rechazado = pintarEditor({ vista: { vista: VISTA, borrador: "rechazado", error: { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true } }, guardar: { puede: false, motivo: MOTOR.rechazo.mensaje, tipo: "error" } });
    assert.ok(rechazado.includes('role="alert"') && texto(rechazado).includes(MOTOR.rechazo.mensaje), "la frase del motor, tal cual");
    assert.ok(!rechazado.includes("Reintentar"), "un rechazo no se reintenta");
    assert.match(rechazado, /data-testid="guardar-arco"[^>]*disabled=""|disabled=""[^>]*data-testid="guardar-arco"/);

    const fallido = pintarEditor({ vista: { vista: VISTA, borrador: "fallido", error: { mensaje: "No pude dibujar el arco.", armadoInvalido: false } }, guardar: { puede: false, motivo: "No pude dibujar el arco.", tipo: "error" } });
    assert.ok(fallido.includes('data-testid="reintentar-editor-arco"') && fallido.includes('type="button"'));

    const sinCambios = pintarEditor({ hayCambios: false, guardar: { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" } });
    assert.ok(texto(sinCambios).includes("Todavía no cambiaste nada.") && !sinCambios.includes('data-testid="restablecer-arco"') && texto(sinCambios).includes("Cerrar"));

    const guardando = pintarEditor({ guardando: true, guardar: { puede: false, motivo: "Guardando el arco…", tipo: "espera" } });
    assert.ok(texto(guardando).includes("Guardando…"));
    const conError = pintarEditor({ errorGuardado: "El plan base cambió." });
    assert.ok(texto(conError).includes("No se guardó: El plan base cambió.") && texto(conError).includes("sigue como estaba"));

    assert.ok(pintarEditor({ planCambio: true }).includes('data-testid="plan-cambio-arco"'));
    assert.ok(!listo.includes('data-testid="plan-cambio-arco"'));

    const cargando = pintarEditor({ vista: { vista: null, borrador: "pendiente", error: null } });
    assert.ok(texto(cargando).includes("Cargando los ajustes del motor"));
  });

  await caso("los avisos del motor por lo que corrige se leen tal cual (alto imposible, ancho que sube)", () => {
    assert.equal(MOTOR.avisos_alto_imposible.avisos.length, 1);
    assert.match(MOTOR.avisos_alto_imposible.avisos[0]!, /^El alto se ajustó a/, "la frase real del motor, en español");
    assert.match(MOTOR.por_tamano["36"]!.avisos[0]!, /^Con globos R36 el arco necesita al menos 3,8 m de ancho/);
    // El dibujo de ese borrador los enseña carácter por carácter (BloqueArco los pinta de `arco.avisos`).
    const conAvisos: VistaArmadoArco = { ...VISTA, arco: { ...VISTA.arco, avisos: MOTOR.avisos_alto_imposible.avisos } };
    const panel = panelDeBorradorArco({ vista: conAvisos, borrador: "listo", enVuelo: false, error: null, clave: "x" });
    const html = renderToStaticMarkup(React.createElement(PanelArco, { estado: panel, leyenda: LEYENDA, nombrePieza: "Arco", repeticiones: 1, onReintentar: () => {} }));
    for (const aviso of MOTOR.avisos_alto_imposible.avisos) assert.ok(html.includes(aviso), `falta el aviso del motor: ${aviso}`);
    assert.ok(!html.includes("opacity-60"), "un dibujo vigente no se apaga");
    // Y uno que no es el del borrador (el nuevo viene en camino, o no se pudo dibujar) se ve apagado y dice por qué.
    const pendiente = renderToStaticMarkup(React.createElement(PanelArco, { estado: { ...panel, fase: "listo", actualizando: true } as typeof panel, leyenda: LEYENDA, nombrePieza: "Arco", repeticiones: 1, onReintentar: () => {} }));
    assert.ok(pendiente.includes("opacity-60") && pendiente.includes("Actualizando…") && pendiente.includes('aria-busy="true"'));
    const vencido = panelDeBorradorArco({ vista: conAvisos, borrador: "rechazado", enVuelo: false, error: { mensaje: "x", armadoInvalido: true }, clave: "x" });
    const htmlVencido = renderToStaticMarkup(React.createElement(PanelArco, { estado: vencido, leyenda: LEYENDA, nombrePieza: "Arco", repeticiones: 1, onReintentar: () => {} }));
    assert.ok(htmlVencido.includes("opacity-60") && htmlVencido.includes("Es el último dibujo que llegó."));
  });

  await caso("cambiar de patrón quita las capas y las secciones: nombran posiciones que ya no son las mismas", () => {
    const conCapas: ArmadoArcoV1 = { ...BASE, patron: "apilado", materiales: [0, 1, 2], capas: [[2], null, [0, 1]], secciones: [[2, 1]] };
    const punteado = VISTA.opciones.patrones.find((patron) => patron.id === "punteado")!;
    const siguiente = conPatron(conCapas, punteado, COLORES_DE_PIEZA);
    assert.deepEqual([siguiente.capas, siguiente.secciones], [[], []], "sin esto, una capa en la posición 2 apuntaba a ninguna y el motor rechazaba el borrador");
    assert.ok(ArmadoArcoV1Schema.safeParse(siguiente).success);
  });

  await caso("los colores de la pieza se eligen uno por uno, dentro de lo que el patrón admite", () => {
    const bloques = VISTA.opciones.patrones.find((patron) => patron.id === "bloques")!;
    assert.ok(COLORES_DE_PIEZA >= 3, "la fixture lleva tres colores");
    // Elegir el color de una posición cambia solo esa posición.
    const otro = conColor(BASE, 1, 2);
    assert.deepEqual([otro.materiales, otro.origen], [[0, 2], "decorador"]);
    assert.deepEqual(diferencias(BASE, otro).filter((ruta) => ruta !== ".origen"), [".materiales.1"]);
    assert.equal(conColor(BASE, 1, 1), BASE, "el mismo color no cambia nada");
    assert.equal(conColor(BASE, 7, 0), BASE, "una posición que no existe no cambia nada");
    // Un patrón de lista admite más posiciones (hasta su máximo) y menos (hasta su mínimo); uno fijo, ninguna.
    const dos: ArmadoArcoV1 = { ...BASE, patron: "bloques", materiales: [0, 1] };
    const tres = conColorAgregado(dos, bloques, COLORES_DE_PIEZA);
    assert.deepEqual(tres.materiales, [0, 1, 2], "agrega el primer color de la pieza que todavía no usa");
    assert.equal(conColorAgregado(conColorAgregado(tres, bloques, COLORES_DE_PIEZA), bloques, COLORES_DE_PIEZA).materiales.length <= bloques.max_colores, true);
    assert.deepEqual(conUltimoColorQuitado(tres, bloques).materiales, [0, 1]);
    assert.equal(conUltimoColorQuitado(dos, bloques), dos, "en su mínimo (2) no baja más");
    const solido = VISTA.opciones.patrones.find((patron) => patron.id === "solido")!;
    const soloUno: ArmadoArcoV1 = { ...BASE, patron: "solido", opciones: {}, materiales: [0] };
    assert.equal(conColorAgregado(soloUno, solido, COLORES_DE_PIEZA), soloUno, "un patrón de colores fijos no suma posiciones");
    // Quitar una posición quita lo que las capas y las secciones tenían puesto en ella.
    const conCapas = conUltimoColorQuitado({ ...tres, capas: [[2, 0], [2], null], secciones: [[2]] }, bloques);
    assert.deepEqual([conCapas.capas, conCapas.secciones], [[[0], null, null], [null]]);
  });

  await caso("Guardar espera mientras los colores de la pieza cambiaron sin revisar el patrón", () => {
    const listo = { borrador: "listo" as const, error: null };
    const entra = { hayCambios: true, guardando: false, ocupado: false };
    const r = puedeGuardarArco({ estado: listo, ...entra, coloresCambiaron: true });
    assert.deepEqual(r, { puede: false, motivo: "Los colores de la pieza cambiaron: revisa el patrón antes de guardar.", tipo: "colores" });
    assert.deepEqual(puedeGuardarArco({ estado: listo, ...entra, coloresCambiaron: false }), { puede: true });
  });

  await caso("los colores cambian bajo el borrador: se olvida lo dibujado y se vuelve a pedir con los colores de ahora", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorArco({ pedir, inicial: VISTA, reloj });
    assert.equal(control.estado().borrador, "listo");
    control.reiniciar();
    assert.equal(control.estado().borrador, "pendiente", "el dibujo del plan se hizo con otros colores: ya no vale");
    avanzar(300);
    assert.equal(peticiones.length, 1, "se vuelve a pedir el borrador a la vista");
    assert.deepEqual(peticiones[0]!.armado, BASE);
    // Una respuesta en vuelo de los colores de antes tampoco cuenta.
    control.reiniciar();
    assert.equal(peticiones[0]!.signal.aborted, true);
    peticiones[0]!.resolver(vistaDe(VISTA, BASE, "de los colores viejos"));
    await tick();
    assert.notDeepEqual(control.estado().vista?.arco.avisos, ["de los colores viejos"]);
  });

  await caso("la lista de patrones del motor tolera uno que el contrato aún no conoce, en vez de tumbar la vista previa", () => {
    const respuesta = FIXTURE.respuesta as { opciones: { patrones: unknown[] } };
    const conNuevo = { ...respuesta.opciones, patrones: [...respuesta.opciones.patrones, { ...(respuesta.opciones.patrones[0] as object), id: "patron_nuevo_del_motor" }] };
    const leido = OpcionesArmadoArcoSchema.safeParse(conNuevo);
    assert.ok(leido.success, "no rompe");
    assert.equal(leido.success && leido.data.patrones.length, 14, "y no lo ofrece: no se podría guardar");
    assert.ok(!OpcionesArmadoArcoSchema.safeParse({ ...conNuevo, patrones: "muchos" }).success, "lo que no es una lista sigue siendo un error");
  });

  await caso("el editor: colores cambiados, elegir colores, receta y estado «listo» sin prometer la compra", () => {
    const html = pintarEditor({ coloresCambiaron: true, guardar: { puede: false, motivo: "x", tipo: "colores" } });
    assert.ok(html.includes('data-testid="colores-cambiaron-arco"') && texto(html).includes("Los colores de la pieza cambiaron: revisa el patrón"));
    assert.ok(html.includes('data-testid="seguir-con-mi-borrador"') && html.includes('data-testid="usar-arco-de-la-propuesta"'), "se elige qué hacer con el borrador: no se pierde en silencio");
    assert.ok(!pintarEditor().includes('data-testid="colores-cambiaron-arco"'));
    const normal = pintarEditor();
    assert.ok(normal.includes('data-testid="mando-color-0"') && normal.includes('data-testid="mando-color-1"'), "un selector de color por posición del patrón");
    assert.ok(normal.includes('data-testid="volver-a-la-receta"'), "hay salida: volver a la receta");
    assert.ok(texto(normal).includes("recalcula la compra con el catálogo"), "«listo» no promete la compra: el catálogo se mira al guardar");
    assert.ok(!texto(normal).includes("así queda"));
    assert.ok(normal.includes("<h3") && normal.includes('tabindex="-1"'), "un encabezado al que pasa el foco al abrir");
    // Los avisos de lo que el motor corrige, y los colores que el arco no toma, se anuncian (región viva siempre montada).
    const sinAvisos = renderToStaticMarkup(React.createElement(PanelArco, { estado: { fase: "listo", vista: VISTA, actualizando: false, fallo: null }, leyenda: LEYENDA, nombrePieza: "Arco", repeticiones: 1, onReintentar: () => {} }));
    assert.ok(sinAvisos.includes('aria-live="polite"') && sinAvisos.includes('data-testid="avisos-vivos-armado-arco"'));
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
