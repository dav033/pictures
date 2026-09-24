"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ClipboardList, Palette } from "lucide-react";
import { InterruptorTema } from "@/components/ui/interruptor-tema";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { DialogoHojaArmado, EditorPatron, GraficaPatron, HojaArmado, LeyendaPatron, leyendaPatron, MiniPatron, ResumenPatron, VistaPatron } from "@/components/plan/patron";
import { clavePatron } from "@/components/plan/patron/borrador";
import { estiloDe } from "@/components/plan/patron/modos";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import type { Mezcla } from "@/lib/plan/mezclas";
import type { ModoAdmitido, ModoPatronColor, PatronColor, PatronColorResuelto } from "@/lib/plan/patron-color";
import { pedirPlanEditarPatron, pedirVistaPatronDetallada, type PeticionVistaPatron } from "@/lib/plan/peticion-patron";
import { mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import type { EstructuraResuelta, LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
import planFixture from "../../../scripts/fixtures/patron-color-ui/plan-con-patrones.json";
import galeriaFixture from "../../../scripts/fixtures/patron-color-ui/galeria.json";
import vistasFixture from "../../../scripts/fixtures/patron-color-ui/vistas-previas.json";

/**
 * Laboratorio visual del patrón de color (ADR-0028 §13): la tarjeta real con
 * un plan de fixture, el editor, la hoja de armado y una galería por tipo de
 * estructura.
 *
 * Las vistas previas (/api/plan-patron) salen de una de dos fuentes:
 * - **grabadas** (sin red): lo que Python devolvió al generar las fixtures
 *   (`scripts/fixtures/patron-color-ui`), buscando el patrón pedido o, si no
 *   está grabado, el de su estilo. Un patrón pintado a mano o un reparto del
 *   deslizador no cambian el dibujo aquí. Los estilos admitidos son los
 *   grabados (sus modos, direcciones y espejo).
 * - **Python real**: la ruta de verdad con el plan de la fixture (que es una
 *   salida real de Python): dibujo, conteo, estilos y avisos en vivo.
 *
 * La edición (/api/plan-editar) siempre es simulada: firma cada plan con un
 * hash falso nuevo, como el servidor, para ejercitar el autoguardado
 * (patrón, colores y tamaños); se puede volver lenta o hacer fallar. Con
 * Python real, el patrón que guarda (y el confeti que deja un reparto) lo
 * expande Python. Solo para control visual; la protege la misma sesión que el
 * resto de la app (`src/proxy.ts`), como `/laboratorio-referencias`.
 */

/** Qué rechaza la Python simulada: nada, solo la sugerencia (pieza sin preset posible) o todo patrón. */
type Rechazo = "ninguno" | "sugerencia" | "todo";
/** De dónde salen las vistas previas: las grabadas o /api/plan-patron con Python real. */
type FuenteVista = "grabada" | "python";
const RECHAZO_PYTHON = { error: "patron_invalido", motivo: "material_sin_uso", mensaje: "Negro no aparece en el patrón: úsalo en alguna posición o quítalo de la pieza." };

type VistasPrevias = Record<string, { sugerencia: PatronColorResuelto; porClave: Record<string, PatronColorResuelto>; porEstilo: Record<string, PatronColorResuelto> }>;
type EstructuraDeclarada = PlanResuelto["plan"]["estructuras"][number];
/** Una pieza de la galería: la estructura como la devolvió el resolvedor, sus líneas y su patrón expandido. */
type PiezaGaleria = {
  id: string;
  titulo: string;
  estructura: EstructuraDeclarada;
  lineas: LineaMaterial[];
  resuelto: PatronColorResuelto;
};

// Fixtures JSON: los tipos del JSON importado son más anchos que los del dominio.
const PLAN_INICIAL = planFixture as unknown as PlanResuelto;
const GALERIA = galeriaFixture as unknown as PiezaGaleria[];
const VISTAS = vistasFixture as unknown as VistasPrevias;

/** Cómo responde la edición simulada: al ritmo normal, lenta (~1,5 s) o sin conexión. */
type Guardado = "normal" | "lento" | "falla";
const ESPERA_GUARDADO_MS: Record<Guardado, number> = { normal: 450, lento: 1500, falla: 600 };

let firmas = 0;

/** Lo que hace el servidor al editar: un plan nuevo con su propio hash y su token de aprobación. */
function firmado(plan: PlanResuelto): PlanResuelto {
  firmas += 1;
  return { ...plan, plan_hash: `lab-${Date.now().toString(36)}-${firmas}`, approval_token: `lab-token-${firmas}` };
}

/** Una estructura declarada del plan cambiada por `cambio`; el resto igual. */
function conEstructura(actual: PlanResuelto, id: string, cambio: (estructura: EstructuraDeclarada) => EstructuraDeclarada): PlanResuelto {
  const estructuras = actual.plan.estructuras.map((estructura) => (estructura.estructura_id === id ? cambio(estructura) : estructura));
  return { ...actual, plan: { ...actual.plan, estructuras } as PlanResuelto["plan"] };
}

type EdicionSimulada = { accion?: string; estructura_id?: string; patron_color?: PatronColor | null; participaciones?: number[]; mezcla?: Mezcla };

/** Una vista previa de la Python real (la ruta de verdad), sin pasar por el simulador. */
async function vistaPython(fetchReal: typeof fetch, cuerpo: PeticionVistaPatron): Promise<PatronColorResuelto> {
  return (await pedirVistaPatronDetallada(cuerpo, { fetcher: fetchReal })).patron;
}

/**
 * La edición que la tarjeta pide a /api/plan-editar, aplicada sobre la base
 * que manda (la última firmada). Con `fetchReal` (Python real) el patrón que
 * queda lo expande Python: el guardado y el confeti que deja un reparto, con
 * los avisos de ese reparto como los devolvería la edición.
 */
async function editarSimulado(base: PlanResuelto, edicion: EdicionSimulada, fetchReal: typeof fetch | null): Promise<{ plan: PlanResuelto; avisos: string[] } | null> {
  const id = edicion.estructura_id;
  if (!id) return null;
  switch (edicion.accion) {
    case "patron": {
      const patron = edicion.patron_color ?? null;
      const vista = !patron ? null : fetchReal ? await vistaPython(fetchReal, { plan: base.plan, estructura_id: id, patron_color: patron }) : vistaPregrabada(id, patron);
      return { plan: conPatronAplicado(base, id, patron, vista), avisos: [] };
    }
    case "repartir": {
      const participaciones = edicion.participaciones ?? [];
      const repartido = conEstructura(base, id, (estructura) => ({ ...estructura, materiales: estructura.materiales.map((material, indice) => ({ ...material, participacion: participaciones[indice] ?? material.participacion })) }));
      const confeti = base.plan.estructuras.find((estructura) => estructura.estructura_id === id)?.patron_color?.base.modo === "aleatorio";
      if (!fetchReal || !confeti) return { plan: repartido, avisos: [] };
      // El mismo `repartir` que la vista previa del deslizador, y la expansión del confeti que deja.
      const previa = await vistaPython(fetchReal, { plan: base.plan, estructura_id: id, patron_color: null, participaciones });
      const aplicado = await vistaPython(fetchReal, { plan: repartido.plan, estructura_id: id, patron_color: previa.patron });
      return { plan: conPatronAplicado(repartido, id, previa.patron, aplicado), avisos: previa.avisos.filter((aviso) => !aplicado.avisos.includes(aviso)) };
    }
    case "mezcla": {
      const mezcla = edicion.mezcla;
      return mezcla ? { plan: conEstructura(base, id, (estructura) => ({ ...estructura, mezcla })), avisos: [] } : null;
    }
    default:
      return null;
  }
}

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
}

/** Vista previa pregrabada más parecida al patrón pedido: la exacta, la de su estilo o la sugerencia. */
function vistaPregrabada(estructuraId: string, patron: PatronColor | null): PatronColorResuelto | null {
  const vistas = VISTAS[estructuraId];
  if (!vistas) return null;
  if (!patron) return vistas.sugerencia;
  return vistas.porClave[clavePatron(patron)] ?? vistas.porEstilo[estiloDe(patron)] ?? vistas.sugerencia;
}

/**
 * Estilos que Python admitió al grabar las fixtures: los modos grabados (en
 * su orden), las direcciones que aparecen en lo grabado y si algo grabado
 * llevaba espejo. Solo para la fuente "grabada"; con Python real los dice Python.
 */
function modosGrabados(estructuraId: string): ModoAdmitido[] {
  const vistas = VISTAS[estructuraId];
  if (!vistas) return [];
  const todas = [vistas.sugerencia, ...Object.values(vistas.porClave), ...Object.values(vistas.porEstilo)];
  const modos = [...new Set(Object.values(vistas.porEstilo).map((vista) => vista.patron.base.modo))];
  return modos.map((modo) => {
    const delModo = todas.filter((vista) => vista.patron.base.modo === modo);
    const otras = [...new Set(delModo.flatMap((vista) => (vista.patron.direccion && vista.patron.direccion !== "longitudinal" ? [vista.patron.direccion] : [])))];
    return { modo, direcciones: ["longitudinal", ...otras], espejo: delModo.some((vista) => vista.patron.simetria === "espejo") };
  });
}

type PeticionPatronLab = { plan?: PlanResuelto["plan"]; estructura_id: string; patron_color: PatronColor | null; participaciones?: number[]; modo?: ModoPatronColor };

/** /api/plan-patron con lo grabado: el patrón pedido, el punto de partida de un estilo o el confeti de un reparto (sin redibujarlo). */
function vistaSimulada(cuerpo: PeticionPatronLab): { status: number; datos: unknown } {
  const id = cuerpo.estructura_id;
  const vistas = VISTAS[id];
  if (!vistas) return { status: 404, datos: { error: "estructura_no_encontrada" } };
  const responder = (vista: PatronColorResuelto) => ({ status: 200, datos: { patron: vista, modos_admitidos: modosGrabados(id) } });
  if (cuerpo.participaciones) {
    const patron = cuerpo.plan?.estructuras.find((estructura) => estructura.estructura_id === id)?.patron_color;
    if (!patron) return { status: 409, datos: { error: "Esta pieza no tiene un patrón de color que dibujar." } };
    if (patron.base.modo !== "aleatorio") return { status: 409, datos: { error: "Esta pieza usa un patrón de color: cambia sus colores desde el patrón.", causa: "PATRON_ACTIVO" } };
    const vista = vistaPregrabada(id, patron);
    return vista ? responder({ ...vista, patron }) : { status: 404, datos: { error: "estructura_no_encontrada" } };
  }
  if (cuerpo.modo) {
    const grabada = vistas.porEstilo[cuerpo.modo] ?? vistas.sugerencia;
    return responder({ ...grabada, aplicado: false, patron: { ...grabada.patron, origen: "sugerido" } });
  }
  const vista = vistaPregrabada(id, cuerpo.patron_color);
  return vista ? responder(vista) : { status: 404, datos: { error: "estructura_no_encontrada" } };
}

/** El plan con el patrón aplicado (o quitado) como lo devolvería la edición, con `vista` como su expansión. */
function conPatronAplicado(actual: PlanResuelto, id: string, patron: PatronColor | null, vista: PatronColorResuelto | null): PlanResuelto {
  const estructuras = actual.plan.estructuras.map((estructura) => {
    if (estructura.estructura_id !== id) return estructura;
    const copia = { ...estructura };
    if (patron) copia.patron_color = patron;
    else delete copia.patron_color;
    return copia;
  });
  return {
    ...actual,
    plan: { ...actual.plan, estructuras } as PlanResuelto["plan"],
    patrones_color: [
      ...(actual.patrones_color ?? []).filter((entrada) => entrada.estructura_id !== id),
      ...(vista && patron ? [{ ...vista, aplicado: true, patron }] : []),
    ],
  };
}

function estructuraGaleria(pieza: PiezaGaleria): EstructuraResuelta {
  return {
    estructura_id: pieza.estructura.estructura_id,
    nombre: pieza.estructura.nombre,
    tipo: pieza.estructura.tipo,
    ubicacion: pieza.estructura.ubicacion,
    repeticiones: pieza.estructura.repeticiones,
    eje_m: null,
    total_unidades: pieza.lineas.reduce((suma, linea) => suma + linea.unidades, 0),
    lineas: pieza.lineas,
    mezcla_real: [],
    supuestos: [],
  };
}

export default function LaboratorioPatronesPage() {
  const [plan, setPlan] = useState<PlanResuelto>(PLAN_INICIAL);
  const [aprobado, setAprobado] = useState(false);
  const [rechazar, setRechazar] = useState<Rechazo>("ninguno");
  const [guardado, setGuardado] = useState<Guardado>("normal");
  const [fuente, setFuente] = useState<FuenteVista>("grabada");
  const [editor, setEditor] = useState<string | null>(null);
  const [hoja, setHoja] = useState<string | null>(null);
  // Qué firmó la edición simulada, en orden: deja ver que el autoguardado junta los cambios.
  const [firmadas, setFirmadas] = useState<string[]>([]);
  const rechazarRef = useRef(rechazar);
  const guardadoRef = useRef(guardado);
  const fuenteRef = useRef(fuente);
  const planRef = useRef(plan);

  useEffect(() => {
    rechazarRef.current = rechazar;
    guardadoRef.current = guardado;
    fuenteRef.current = fuente;
    planRef.current = plan;
  }, [rechazar, guardado, fuente, plan]);

  // Respuestas de /api/plan-patron (grabadas o de la Python real) y de la edición simulada de /api/plan-editar.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (entrada, init) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.includes("/api/catalogo/imagenes")) return respuestaJson({ imagenes: {} });
      if (url.includes("/api/plan-patron") && typeof init?.body === "string") {
        const cuerpo = JSON.parse(init.body) as PeticionPatronLab;
        const sugerencia = !cuerpo.patron_color && !cuerpo.participaciones && !cuerpo.modo;
        if (rechazarRef.current === "todo" || (rechazarRef.current === "sugerencia" && sugerencia)) {
          await new Promise((listo) => window.setTimeout(listo, 250));
          return respuestaJson(RECHAZO_PYTHON, 422);
        }
        if (fuenteRef.current === "python") return original(entrada, init);
        await new Promise((listo) => window.setTimeout(listo, 250));
        const { status, datos } = vistaSimulada(cuerpo);
        return respuestaJson(datos, status);
      }
      if (url.includes("/api/plan-editar") && typeof init?.body === "string") {
        const cuerpo = JSON.parse(init.body) as { modo?: string; base?: PlanResuelto; edicion?: EdicionSimulada };
        const edicion = cuerpo.edicion;
        if (cuerpo.modo === "aplicar" && cuerpo.base && edicion && ["patron", "repartir", "mezcla"].includes(edicion.accion ?? "")) {
          const modo = guardadoRef.current;
          await new Promise((listo) => window.setTimeout(listo, ESPERA_GUARDADO_MS[modo]));
          if (modo === "falla") throw new TypeError("Failed to fetch");
          // Como lo responde /api/plan-editar: la causa estable y la frase de Python.
          if (edicion.accion === "patron" && rechazarRef.current === "todo" && edicion.patron_color) return respuestaJson({ ...RECHAZO_PYTHON, error: RECHAZO_PYTHON.mensaje, causa: "PATRON_INVALIDO" }, 422);
          const siguiente = await editarSimulado(cuerpo.base, edicion, fuenteRef.current === "python" ? original : null);
          if (!siguiente) return respuestaJson({ error: "estructura_no_encontrada" }, 404);
          const nuevo = firmado(siguiente.plan);
          setFirmadas((previas) => [...previas, `${edicion.accion} sobre ${cuerpo.base?.plan_hash ?? "?"}`]);
          // Como /api/plan-editar: `avisos` solo cuando Python tiene algo que decir.
          return respuestaJson({ plan: nuevo, ...(siguiente.avisos.length ? { avisos: siguiente.avisos } : {}) });
        }
      }
      return original(entrada, init);
    };
    return () => { window.fetch = original; };
  }, []);

  const declaradas = new Map(plan.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura]));
  const estructuraEditor = editor ? plan.estructuras.find((estructura) => estructura.estructura_id === editor) : undefined;
  const declaradaEditor = editor ? declaradas.get(editor) : undefined;
  const piezaHoja = hoja ? GALERIA.find((pieza) => pieza.id === hoja) : undefined;
  const hojaEnPagina = (() => {
    const resuelto = (plan.patrones_color ?? []).find((entrada) => entrada.aplicado);
    const estructura = resuelto ? plan.estructuras.find((item) => item.estructura_id === resuelto.estructura_id) : undefined;
    const declarada = resuelto ? declaradas.get(resuelto.estructura_id) : undefined;
    return resuelto && estructura && declarada ? { resuelto, estructura, declarada } : null;
  })();

  return (
    <div className="min-h-dvh bg-fondo text-texto">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borde-suave bg-fondo px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Laboratorio · Patrones de color</h1>
          <p className="text-xs text-texto-suave" data-testid="lab-fuente">
            {fuente === "python"
              ? "Vista previa con Python real (/api/plan-patron) sobre el plan de la fixture; la edición se simula y Python expande lo que guarda."
              : "Vistas previas grabadas, sin red: el dibujo no cambia al editar ni al mover los colores; la edición se simula."}
          </p>
          <p data-testid="registro-firmas" data-firmas={firmadas.length} className="text-[11px] text-texto-suave">
            Ediciones firmadas: {firmadas.length}{firmadas.length ? ` · última: ${firmadas.at(-1)}` : ""} · plan {plan.plan_hash.slice(0, 18)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-texto-suave">
            Vista previa
            <select value={fuente} onChange={(evento) => setFuente(evento.target.value as FuenteVista)} className="ui-input h-8 w-auto py-0 text-xs" data-testid="fuente-vista">
              <option value="grabada">grabada (sin red)</option>
              <option value="python">Python real</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-texto-suave">
            Python rechaza
            <select value={rechazar} onChange={(evento) => setRechazar(evento.target.value as Rechazo)} className="ui-input h-8 w-auto py-0 text-xs" data-testid="simular-rechazo">
              <option value="ninguno">nada</option>
              <option value="sugerencia">solo la sugerencia</option>
              <option value="todo">todo patrón</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-texto-suave">
            Guardado
            <select value={guardado} onChange={(evento) => setGuardado(evento.target.value as Guardado)} className="ui-input h-8 w-auto py-0 text-xs" data-testid="simular-guardado">
              <option value="normal">normal</option>
              <option value="lento">lento (1,5 s)</option>
              <option value="falla">falla (sin conexión)</option>
            </select>
          </label>
          <Link href="/" className="ui-button-ghost rounded-lg px-2 py-1.5">← Volver al chat</Link>
          <InterruptorTema />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-4 py-6 sm:px-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Tarjeta de la propuesta</h2>
          <div className="flex flex-wrap gap-2">
            {plan.estructuras.map((estructura) => (
              <button key={estructura.estructura_id} type="button" data-testid={`abrir-editor-${estructura.estructura_id}`} onClick={() => setEditor(estructura.estructura_id)} className="ui-chip ui-pressable inline-flex items-center gap-1.5">
                <Palette className="size-3.5" aria-hidden="true" />Editor: {estructura.nombre}
              </button>
            ))}
            <button type="button" onClick={() => { setPlan(PLAN_INICIAL); setAprobado(false); }} className="ui-chip ui-pressable">Reiniciar plan</button>
          </div>
          <TarjetaPlanDecoracion plan={plan} aprobado={aprobado} onAprobar={() => setAprobado(true)} onPlanActualizado={(siguiente) => { setPlan(siguiente); setAprobado(false); }} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Galería por estructura</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GALERIA.map((pieza) => {
              const leyenda = leyendaPatron(pieza.estructura.materiales, pieza.lineas);
              const oficialId = pieza.estructura.estructura_oficial;
              return (
                <li key={pieza.id} data-testid={`galeria-${pieza.id}`} className="ui-card @container flex flex-col gap-3 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold">{pieza.titulo}</h3>
                    <MiniPatron resuelto={pieza.resuelto} leyenda={leyenda} className="h-4 w-auto max-w-24" />
                  </div>
                  <div className="h-56 rounded-xl bg-superficie-suave ring-1 ring-borde-suave ring-inset">
                    <VistaPatron resuelto={pieza.resuelto} leyenda={leyenda} tipo={pieza.estructura.tipo} oficialId={oficialId} espejo={pieza.estructura.ubicacion === "lateral_derecho"} proporcion={pieza.estructura.medidas.alto_m && pieza.estructura.medidas.ancho_m ? pieza.estructura.medidas.alto_m / pieza.estructura.medidas.ancho_m : undefined} etiqueta={pieza.titulo} className="size-full p-2" />
                  </div>
                  <LeyendaPatron leyenda={leyenda} />
                  <div className="scroll-suave max-h-48 overflow-y-auto rounded-xl bg-superficie-suave p-2">
                    <GraficaPatron resuelto={pieza.resuelto} leyenda={leyenda} tipo={pieza.estructura.tipo} oficialId={oficialId} />
                  </div>
                  <ResumenPatron conteo={pieza.resuelto.conteo} repeticiones={pieza.resuelto.repeticiones} leyenda={leyenda} compacto />
                  <button type="button" data-testid={`hoja-${pieza.id}`} onClick={() => setHoja(pieza.id)} className="ui-button-secondary ui-pressable mt-auto">
                    <ClipboardList className="size-4" aria-hidden="true" />Hoja de armado
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Hoja de armado en la página</h2>
          <div className="ui-card p-4 sm:p-6">
            {hojaEnPagina && (
              <HojaArmado
                resuelto={hojaEnPagina.resuelto}
                leyenda={leyendaPatron(hojaEnPagina.declarada.materiales, hojaEnPagina.estructura.lineas)}
                estructura={hojaEnPagina.estructura}
                declarada={hojaEnPagina.declarada}
                oficial={identificarEstructuraOficial(hojaEnPagina.declarada)}
                tituloPlan={plan.plan.concepto.titulo}
              />
            )}
          </div>
        </section>
      </main>

      {estructuraEditor && declaradaEditor && (
        <EditorPatron
          key={estructuraEditor.estructura_id}
          plan={plan.plan}
          estructura={estructuraEditor}
          declarada={declaradaEditor}
          oficial={identificarEstructuraOficial({ tipo: estructuraEditor.tipo, ubicacion: estructuraEditor.ubicacion, nombre: estructuraEditor.nombre, estructura_oficial: declaradaEditor.estructura_oficial, densidad: declaradaEditor.densidad })}
          resuelto={(plan.patrones_color ?? []).find((entrada) => entrada.estructura_id === estructuraEditor.estructura_id && entrada.aplicado) ?? null}
          aprobada={aprobado}
          onCerrar={() => setEditor(null)}
          // Sin la tarjeta: la misma edición simulada, cada una sobre el último plan firmado.
          onGuardar={async (patron) => {
            try {
              const datos = await pedirPlanEditarPatron({ modo: "aplicar", base: planRef.current, edicion: { accion: "patron", estructura_id: estructuraEditor.estructura_id, patron_color: patron } }, "No se pudo actualizar la pieza.") as { plan?: PlanResuelto };
              if (!datos.plan) return "No se pudo actualizar la pieza.";
              planRef.current = datos.plan;
              setPlan(datos.plan);
              setAprobado(false);
              return null;
            } catch (error) {
              return mensajeFalloPlanEditar(error, "No se pudo actualizar la pieza.");
            }
          }}
        />
      )}
      {piezaHoja && (
        <DialogoHojaArmado
          abierto
          onAbiertoChange={(abierta) => { if (!abierta) setHoja(null); }}
          resuelto={piezaHoja.resuelto}
          leyenda={leyendaPatron(piezaHoja.estructura.materiales, piezaHoja.lineas)}
          estructura={estructuraGaleria(piezaHoja)}
          declarada={piezaHoja.estructura}
          oficial={identificarEstructuraOficial(piezaHoja.estructura)}
          tituloPlan="Laboratorio"
        />
      )}
    </div>
  );
}
