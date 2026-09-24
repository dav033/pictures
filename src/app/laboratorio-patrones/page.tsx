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
import type { PatronColor, PatronColorResuelto } from "@/lib/plan/patron-color";
import type { EstructuraResuelta, LineaMaterial, PlanResuelto } from "@/lib/plan/resuelto";
import planFixture from "../../../scripts/fixtures/patron-color-ui/plan-con-patrones.json";
import galeriaFixture from "../../../scripts/fixtures/patron-color-ui/galeria.json";
import vistasFixture from "../../../scripts/fixtures/patron-color-ui/vistas-previas.json";

/**
 * Laboratorio visual del patrón de color (ADR-0028 §13): la tarjeta real con
 * un plan de fixture, el editor, la hoja de armado y una galería por tipo de
 * estructura. No llama a Python en vivo: las vistas previas y la edición
 * responden con lo que Python devolvió al generar las fixtures
 * (`scripts/fixtures/patron-color-ui`), buscando el patrón pedido o, si no
 * está grabado, el de su estilo; un patrón pintado a mano no cambia el
 * conteo aquí. Solo para control visual; la protege la misma sesión que el
 * resto de la app (`src/proxy.ts`), como `/laboratorio-referencias`.
 */

/** Qué rechaza la Python simulada: nada, solo la sugerencia (pieza sin preset posible) o todo patrón. */
type Rechazo = "ninguno" | "sugerencia" | "todo";
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

/** El plan con el patrón aplicado (o quitado) como lo devolvería la edición; la vista pregrabada hace de expansión. */
function conPatronAplicado(actual: PlanResuelto, id: string, patron: PatronColor | null): PlanResuelto {
  const vista = patron ? vistaPregrabada(id, patron) : null;
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
  const [editor, setEditor] = useState<string | null>(null);
  const [hoja, setHoja] = useState<string | null>(null);
  const rechazarRef = useRef(rechazar);
  const planRef = useRef(plan);

  useEffect(() => {
    rechazarRef.current = rechazar;
    planRef.current = plan;
  }, [rechazar, plan]);

  // Respuestas simuladas de /api/plan-patron y de la acción `patron` de /api/plan-editar.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (entrada, init) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.includes("/api/catalogo/imagenes")) return respuestaJson({ imagenes: {} });
      if (url.includes("/api/plan-patron") && typeof init?.body === "string") {
        const cuerpo = JSON.parse(init.body) as { estructura_id: string; patron_color: PatronColor | null };
        await new Promise((listo) => window.setTimeout(listo, 350));
        if (rechazarRef.current === "todo" || (rechazarRef.current === "sugerencia" && !cuerpo.patron_color)) return respuestaJson(RECHAZO_PYTHON, 422);
        const vista = vistaPregrabada(cuerpo.estructura_id, cuerpo.patron_color);
        return vista ? respuestaJson({ patron: vista }) : respuestaJson({ error: "estructura_no_encontrada" }, 404);
      }
      if (url.includes("/api/plan-editar") && typeof init?.body === "string") {
        const cuerpo = JSON.parse(init.body) as { edicion?: { accion?: string; estructura_id?: string; patron_color?: PatronColor | null } };
        const edicion = cuerpo.edicion;
        if (edicion?.accion === "patron" && edicion.estructura_id) {
          await new Promise((listo) => window.setTimeout(listo, 450));
          // Como lo responde /api/plan-editar: la causa estable y la frase de Python.
          if (rechazarRef.current === "todo" && edicion.patron_color) return respuestaJson({ ...RECHAZO_PYTHON, error: RECHAZO_PYTHON.mensaje, causa: "PATRON_INVALIDO" }, 422);
          const actual = planRef.current;
          const id = edicion.estructura_id;
          const patron = edicion.patron_color ?? null;
          const siguiente = conPatronAplicado(actual, id, patron);
          return respuestaJson({ plan: siguiente });
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
          <p className="text-xs text-texto-suave">Fixtures sin Python: la vista previa y la edición se simulan; el conteo no cambia al editar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-texto-suave">
            Python rechaza
            <select value={rechazar} onChange={(evento) => setRechazar(evento.target.value as Rechazo)} className="ui-input h-8 w-auto py-0 text-xs" data-testid="simular-rechazo">
              <option value="ninguno">nada</option>
              <option value="sugerencia">solo la sugerencia</option>
              <option value="todo">todo patrón</option>
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
          onCerrar={() => setEditor(null)}
          plan={plan.plan}
          estructura={estructuraEditor}
          declarada={declaradaEditor}
          oficial={identificarEstructuraOficial({ tipo: estructuraEditor.tipo, ubicacion: estructuraEditor.ubicacion, nombre: estructuraEditor.nombre, estructura_oficial: declaradaEditor.estructura_oficial, densidad: declaradaEditor.densidad })}
          resuelto={(plan.patrones_color ?? []).find((entrada) => entrada.estructura_id === estructuraEditor.estructura_id && entrada.aplicado) ?? null}
          onAplicar={async (patron) => {
            await new Promise((listo) => window.setTimeout(listo, 400));
            if (rechazar === "todo" && patron) return RECHAZO_PYTHON.mensaje;
            setPlan((actual) => conPatronAplicado(actual, estructuraEditor.estructura_id, patron));
            setEditor(null);
            return null;
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
