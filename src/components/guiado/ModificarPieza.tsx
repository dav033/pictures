"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { LoaderCircle, RotateCcw, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import type { z } from "zod";
import { EditorArco, PanelArco, useEditorArco } from "@/components/plan/arco";
import { EditorArcoOrganico, PanelArcoOrganico, useEditorArcoOrganico } from "@/components/plan/arco-organico";
import { EditorColumna, PanelColumna, useEditorColumna } from "@/components/plan/columna";
import { EditorColumnaOrganica, PanelColumnaOrganica, useEditorColumnaOrganica } from "@/components/plan/columna-organica";
import { EditorGuirnaldaOrganica, PanelGuirnaldaOrganica, useEditorGuirnaldaOrganica } from "@/components/plan/guirnalda-organica";
import { peticionVistaArco } from "@/components/plan/arco/vista-arco";
import { peticionVistaArcoOrganico } from "@/components/plan/arco-organico/vista-arco-organico";
import { peticionVistaColumna } from "@/components/plan/columna/vista-columna";
import { peticionVistaColumnaOrganica } from "@/components/plan/columna-organica/vista-columna-organica";
import { peticionVistaGuirnaldaOrganica } from "@/components/plan/guirnalda-organica/vista-guirnalda-organica";
import type { ColorLeyenda } from "@/components/plan/patron/leyenda";
import { VozEditorProvider } from "@/components/plan/motor/voz-editor";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ArmadoArcoV1Schema, type ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import { ArmadoArcoOrganicoV1Schema, type ArmadoArcoOrganicoV1 } from "@/lib/plan/armado-arco-organico";
import { ArmadoColumnaV1Schema, type ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import { ArmadoColumnaOrganicaV1Schema, type ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import { ArmadoGuirnaldaOrganicaV1Schema, type ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import type { EdicionPlan } from "@/lib/plan/edicion-esquemas";
import { mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoArco, type VistaArmadoArco } from "@/lib/plan/peticion-armado-arco";
import { pedirVistaArmadoArcoOrganico, type VistaArmadoArcoOrganico } from "@/lib/plan/peticion-armado-arco-organico";
import { pedirVistaArmadoColumna, type VistaArmadoColumna } from "@/lib/plan/peticion-armado-columna";
import { pedirVistaArmadoColumnaOrganica, type VistaArmadoColumnaOrganica } from "@/lib/plan/peticion-armado-columna-organica";
import { pedirVistaArmadoGuirnaldaOrganica, type VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { registrarEventoCliente } from "@/lib/registro/cliente";
import { EASE_SALIDA, RESORTE } from "./animacion/movimiento";
import { piezaConArticulo } from "./ajuste/ajuste-plan-guiado";
import { aplicarEnServidor, mensajeAjuste } from "./ajuste/ejecutar-ajuste";
import type { AjustePublicado } from "./ajuste/usarAjustePlanGuiado";
import { AvisoPiezaPlan, ConfirmarPiezaPlan } from "./AvisoPiezaPlan";
import { leyendaDePieza, motorDePieza, type CampoArmado } from "./motor-pieza";
import {
  abrirConElPlan,
  cifrasDelPlan,
  compararConPlan,
  conRellenoHacia,
  globosDelConteo,
  sembrarArcoOrganico,
  sembrarColumnaOrganica,
  sembrarGuirnaldaOrganica,
  type Apertura,
  type CifrasPieza,
  type GlobosDibujo,
  type OrigenApertura,
  type Siembra,
} from "./pieza-desde-plan";
import { conversacionGuiada, VISTA_GUIADA } from "./registro-guiado";

/**
 * «Modificar» una pieza de «Tu plan»: la gráfica grande que arma el motor y, debajo, los mismos mandos del editor
 * de la vista clásica (forma, alto, ancho, grosor, colores…). Nada se calcula aquí: el dibujo y las cifras son del
 * motor, y al guardar el armado viaja por `/api/plan-editar` con el plan firmado (la misma edición `armado_*` que
 * guarda la clásica); Python rehace y firma el plan y la MISMA tarjeta lo publica, como «Ajustar mi plan».
 *
 * Una pieza sin armado guardado (el plan exacto de una idea, todo plan que arma el chat) abre con LO QUE EL PLAN
 * TIENE (`pieza-desde-plan.ts`, probador 124, hallazgo 3): la receta del motor con el alto, el grosor o el largo, los
 * tamaños y el peso de cada color del plan, y lo lleno corregido una vez hacia su total. Antes abría con la receta tal
 * cual (48 globos y 1,14 m de ancho para una columna de 39 globos y 0,55 m) y guardar cualquier cambio dejaba el plan
 * con las cifras del motor sin decirlo. Si el dibujo no lleva exactamente lo del plan, se dice en palabras de cliente
 * (`AvisoPiezaPlan`) y guardar pregunta antes de reescribir la pieza; abrir y cerrar, o guardar sin tocar nada, no
 * cambia el plan (Guardar solo se ofrece con un cambio). Compatible con el Python del VPS: ni la vista previa ni la
 * edición mandan campos nuevos.
 */

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type PiezaMotor = { plan: PlanGuiado["plan"]; estructuraId: string; colores?: readonly string[] };
/** `dibujo`: los globos del dibujo que se va a guardar (para preguntar antes de reescribir la pieza). */
type Guardar = (edicion: EdicionPlan, dibujo: GlobosDibujo | null) => Promise<string | null>;
/** Lo que el plan dice de la pieza: sus cifras, si ya traía armado y cómo se nombra («la columna orgánica izquierda»). */
type DelPlan = { cifras: CifrasPieza | null; sinArmado: boolean; articulo: string };
type Comunes = { pieza: PiezaMotor; leyenda: readonly ColorLeyenda[]; nombre: string; repeticiones: number; guardar: Guardar; ocupado: boolean; onCerrar: () => void; delPlan: DelPlan };

function registrar(evento: string, datos: Record<string, unknown>, nivel?: "warn" | "error"): void {
  registrarEventoCliente(evento, datos, conversacionGuiada(), { vista: VISTA_GUIADA, ...(nivel ? { nivel, tipo: nivel === "error" ? "error" as const : "evento" as const } : {}) });
}

/**
 * Cómo se abre el editor de una pieza: con su armado guardado; sin él, con las cifras del plan (`sembrar`, solo los
 * motores orgánicos, que tienen alto, grosor, mezcla de tamaños y peso por color) o con la receta (los de patrón).
 * Queda registrado de dónde salió el dibujo y cuántos globos lleva frente al plan.
 */
async function abrirPieza<A, V extends { armado: A }>({ guardado, pedirVista, sembrar, corregir, globos, delPlan, estructuraId }: {
  guardado: A | null;
  pedirVista: (armado: A | null) => Promise<V>;
  sembrar: ((receta: V, cifras: CifrasPieza) => Siembra<A>) | null;
  corregir: ((armado: A, actual: number, objetivo: number) => A | null) | null;
  globos: (vista: V) => GlobosDibujo;
  delPlan: DelPlan;
  estructuraId: string;
}): Promise<Apertura<V>> {
  if (guardado) return { vista: await pedirVista(guardado), origen: "guardado", pedidos: 1 };
  const { cifras } = delPlan;
  const apertura: Apertura<V> = cifras && sembrar
    ? await abrirConElPlan<A, V>({
      pedir: pedirVista,
      sembrar: (receta) => sembrar(receta, cifras),
      globos: (vista) => globos(vista).total,
      corregir: corregir ?? (() => null),
      objetivo: cifras.total,
      esCancelacion,
    })
    : await pedirVista(null).then((vista): Apertura<V> => ({ vista, origen: "receta", ...(cifras ? {} : { motivo: "sin_cifras" as const }), pedidos: 1, ...(cifras ? { globosPlan: cifras.total } : {}), globosDibujo: globos(vista).total }));
  registrar("pieza.modificar_desde_plan", {
    estructura_id: estructuraId,
    origen: apertura.origen,
    motivo: apertura.motivo ?? null,
    pedidos: apertura.pedidos,
    globos_plan: apertura.globosPlan ?? null,
    globos_dibujo: apertura.globosDibujo ?? null,
    desde_el_plan: apertura.desdeElPlan ?? [],
    exacta: cifras ? compararConPlan(cifras, globos(apertura.vista)).exacta : null,
  });
  return apertura;
}

/** El dibujo que se ve ahora es el del borrador (no uno viejo ni uno en camino), o null. */
function vistaVigente<V>(panel: { fase: string; vista?: V; actualizando?: boolean; vencido?: boolean }): V | null {
  return panel.fase === "listo" && panel.vista !== undefined && !panel.actualizando && !panel.vencido ? panel.vista : null;
}

/**
 * Lo que el editor dice del plan bajo el dibujo (solo de una pieza que no traía armado) y los globos del dibujo
 * vigente, que `guardar` necesita para preguntar antes de reescribir la pieza.
 */
function useAvisoDelPlan(delPlan: DelPlan, origen: OrigenApertura, dibujo: GlobosDibujo | null, hayCambios: boolean, leyenda: readonly ColorLeyenda[]) {
  const dibujoRef = useRef<GlobosDibujo | null>(dibujo);
  useEffect(() => { dibujoRef.current = dibujo; });
  const aviso = delPlan.sinArmado && delPlan.cifras && origen !== "guardado" ? (
    <AvisoPiezaPlan
      comparacion={dibujo ? compararConPlan(delPlan.cifras, dibujo) : null}
      origen={origen}
      pieza={delPlan.articulo}
      leyenda={leyenda}
      hayCambios={hayCambios}
      fueraDelMotor={delPlan.cifras.fueraDelMotor}
    />
  ) : null;
  return { aviso, dibujoRef };
}

/** Prepara el editor: el dibujo del armado guardado o, sin él, el de las cifras del plan (`abrirPieza`). */
function useInicial<V>(pedir: (signal: AbortSignal) => Promise<Apertura<V>>, clave: string) {
  const [estado, setEstado] = useState<{ clave: string; fase: "listo"; inicial: Apertura<V> } | { clave: string; fase: "error"; mensaje: string } | null>(null);
  const [intento, setIntento] = useState(0);
  const pedirRef = useRef(pedir);
  useEffect(() => { pedirRef.current = pedir; }, [pedir]);
  useEffect(() => {
    const controller = new AbortController();
    pedirRef.current(controller.signal)
      .then((inicial) => { if (!controller.signal.aborted) setEstado({ clave: `${clave}#${intento}`, fase: "listo", inicial }); })
      .catch((error: unknown) => { if (!controller.signal.aborted && !esCancelacion(error)) setEstado({ clave: `${clave}#${intento}`, fase: "error", mensaje: mensajeFalloPlanArmado(error) }); });
    return () => controller.abort();
  }, [clave, intento]);
  const vigente = estado?.clave === `${clave}#${intento}` ? estado : null;
  return { estado: vigente, reintentar: () => setIntento((valor) => valor + 1) };
}

function Preparando({ estado, onReintentar }: { estado: { fase: "error"; mensaje: string } | null; onReintentar: () => void }) {
  if (estado?.fase === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl bg-error-suave px-3 py-3 text-sm text-error">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{estado.mensaje}</span>
        <button type="button" onClick={onReintentar} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-superficie px-3 text-sm font-semibold text-texto ring-1 ring-borde-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
          <RotateCcw className="size-4" aria-hidden />Reintentar
        </button>
      </div>
    );
  }
  return (
    <div role="status" className="space-y-3">
      <div className="brillo-carga grid h-72 place-items-center rounded-2xl bg-superficie-suave">
        <span className="inline-flex items-center gap-2 text-sm text-texto-suave"><LoaderCircle className="size-4 animate-spin text-acento motion-reduce:animate-none" aria-hidden />Armando tu pieza globo por globo…</span>
      </div>
      <div className="brillo-carga h-10 rounded-xl" />
      <div className="brillo-carga h-10 w-2/3 rounded-xl" />
    </div>
  );
}

// Los globos que LLEVA cada dibujo (el conteo del motor, sin la reserva de compra), por motor.
const globosColumnaOrganica = (vista: VistaArmadoColumnaOrganica) => globosDelConteo(vista.columna.conteo);
const globosColumna = (vista: VistaArmadoColumna) => globosDelConteo([...vista.columna.conteo, ...vista.columna.remate.globos]);
const globosArcoOrganico = (vista: VistaArmadoArcoOrganico) => globosDelConteo(vista.arco.conteo);
const globosArco = (vista: VistaArmadoArco) => globosDelConteo(vista.arco.conteo);
const globosGuirnaldaOrganica = (vista: VistaArmadoGuirnaldaOrganica) => globosDelConteo(vista.guirnalda.conteo);

function ColumnaOrganica({ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, guardado, delPlan }: Comunes & { guardado: ArmadoColumnaOrganicaV1 | null }) {
  const pedir = useCallback((signal: AbortSignal) => abrirPieza<ArmadoColumnaOrganicaV1, VistaArmadoColumnaOrganica>({
    guardado,
    pedirVista: (armado) => pedirVistaArmadoColumnaOrganica(peticionVistaColumnaOrganica(pieza, armado), { signal }),
    sembrar: (receta, cifras) => sembrarColumnaOrganica(receta.armado, cifras, receta.limites),
    corregir: conRellenoHacia,
    globos: globosColumnaOrganica,
    delPlan,
    estructuraId: pieza.estructuraId,
  }), [pieza, guardado, delPlan]);
  const { estado, reintentar } = useInicial(pedir, "columna-organica");
  if (estado?.fase !== "listo") return <Preparando estado={estado} onReintentar={reintentar} />;
  return <ColumnaOrganicaEditando inicial={estado.inicial.vista} origen={estado.inicial.origen} armado={guardado ?? estado.inicial.vista.armado} {...{ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }} />;
}

function ColumnaOrganicaEditando({ inicial, origen, armado, pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }: Comunes & { inicial: VistaArmadoColumnaOrganica; origen: OrigenApertura; armado: ArmadoColumnaOrganicaV1 }) {
  const onGuardar = (nuevo: ArmadoColumnaOrganicaV1) => guardar({ accion: "armado_columna_organica", estructura_id: pieza.estructuraId, armado_columna_organica: nuevo }, delPlanVivo.dibujoRef.current);
  const editor = useEditorColumnaOrganica({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  const vigente = vistaVigente(editor.panel);
  const delPlanVivo = useAvisoDelPlan(delPlan, origen, vigente ? globosColumnaOrganica(vigente) : null, editor.hayCambios, leyenda);
  // Sin tocar nada, «Así queda» dice las medidas de la tarjeta (las del plan), no el contorno que mide el motor
  // (probador 141: 0,76 m de ancho frente a 0,55 m en la tarjeta).
  const medidasPlan = editor.hayCambios ? undefined : pieza.plan.estructuras.find((estructura) => estructura.estructura_id === pieza.estructuraId)?.medidas;
  return (
    <PanelColumnaOrganica
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombre}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      {...(medidasPlan ? { medidasPlan } : {})}
      pie={<>{delPlanVivo.aviso}<EditorColumnaOrganica borrador={editor.borrador} vista={editor.vista} leyenda={leyenda} guardar={editor.guardar} guardando={editor.guardando} errorGuardado={editor.errorGuardado} planCambio={editor.planCambio} coloresCambiaron={editor.coloresCambiaron} hayCambios={editor.hayCambios} onCambiar={editor.cambiar} onGuardar={editor.pedirGuardar} onDescartar={editor.descartar} onRestablecer={editor.restablecer} onReintentar={editor.vista.reintentar} onSeguirConMiBorrador={editor.seguirConMiBorrador} onUsarColumnaDeLaPropuesta={editor.usarColumnaDeLaPropuesta} onReceta={editor.pedirReceta} /></>}
    />
  );
}

function Columna({ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, guardado, delPlan }: Comunes & { guardado: ArmadoColumnaV1 | null }) {
  // La columna de anillos no admite tamaños ni pesos por color: abre con su receta (con las medidas del plan) y el
  // aviso dice en qué se aparta del plan.
  const pedir = useCallback((signal: AbortSignal) => abrirPieza<ArmadoColumnaV1, VistaArmadoColumna>({
    guardado,
    pedirVista: (armado) => pedirVistaArmadoColumna(peticionVistaColumna(pieza, armado), { signal }),
    sembrar: null,
    corregir: null,
    globos: globosColumna,
    delPlan,
    estructuraId: pieza.estructuraId,
  }), [pieza, guardado, delPlan]);
  const { estado, reintentar } = useInicial(pedir, "columna");
  if (estado?.fase !== "listo") return <Preparando estado={estado} onReintentar={reintentar} />;
  return <ColumnaEditando inicial={estado.inicial.vista} origen={estado.inicial.origen} armado={guardado ?? estado.inicial.vista.armado} {...{ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }} />;
}

function ColumnaEditando({ inicial, origen, armado, pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }: Comunes & { inicial: VistaArmadoColumna; origen: OrigenApertura; armado: ArmadoColumnaV1 }) {
  const onGuardar = (nuevo: ArmadoColumnaV1) => guardar({ accion: "armado_columna", estructura_id: pieza.estructuraId, armado_columna: nuevo }, delPlanVivo.dibujoRef.current);
  const editor = useEditorColumna({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  const vigente = vistaVigente(editor.panel);
  const delPlanVivo = useAvisoDelPlan(delPlan, origen, vigente ? globosColumna(vigente) : null, editor.hayCambios, leyenda);
  return (
    <PanelColumna
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombre}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      pie={<>{delPlanVivo.aviso}<EditorColumna borrador={editor.borrador} vista={editor.vista} leyenda={leyenda} guardar={editor.guardar} guardando={editor.guardando} errorGuardado={editor.errorGuardado} planCambio={editor.planCambio} coloresCambiaron={editor.coloresCambiaron} hayCambios={editor.hayCambios} onCambiar={editor.cambiar} onGuardar={editor.pedirGuardar} onDescartar={editor.descartar} onRestablecer={editor.restablecer} onReintentar={editor.vista.reintentar} onSeguirConMiBorrador={editor.seguirConMiBorrador} onUsarColumnaDeLaPropuesta={editor.usarColumnaDeLaPropuesta} onReceta={editor.pedirReceta} /></>}
    />
  );
}

function ArcoOrganico({ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, guardado, sustantivo, delPlan }: Comunes & { guardado: ArmadoArcoOrganicoV1 | null; sustantivo: "arco" | "semiarco" }) {
  const pedir = useCallback((signal: AbortSignal) => abrirPieza<ArmadoArcoOrganicoV1, VistaArmadoArcoOrganico>({
    guardado,
    pedirVista: (armado) => pedirVistaArmadoArcoOrganico(peticionVistaArcoOrganico(pieza, armado), { signal }),
    sembrar: (receta, cifras) => sembrarArcoOrganico(receta.armado, cifras),
    corregir: conRellenoHacia,
    globos: globosArcoOrganico,
    delPlan,
    estructuraId: pieza.estructuraId,
  }), [pieza, guardado, delPlan]);
  const { estado, reintentar } = useInicial(pedir, "arco-organico");
  if (estado?.fase !== "listo") return <Preparando estado={estado} onReintentar={reintentar} />;
  return <ArcoOrganicoEditando inicial={estado.inicial.vista} origen={estado.inicial.origen} armado={guardado ?? estado.inicial.vista.armado} sustantivo={sustantivo} {...{ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }} />;
}

function ArcoOrganicoEditando({ inicial, origen, armado, sustantivo, pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }: Comunes & { inicial: VistaArmadoArcoOrganico; origen: OrigenApertura; armado: ArmadoArcoOrganicoV1; sustantivo: "arco" | "semiarco" }) {
  const onGuardar = (nuevo: ArmadoArcoOrganicoV1) => guardar({ accion: "armado_arco_organico", estructura_id: pieza.estructuraId, armado_arco_organico: nuevo }, delPlanVivo.dibujoRef.current);
  const editor = useEditorArcoOrganico({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  const vigente = vistaVigente(editor.panel);
  const delPlanVivo = useAvisoDelPlan(delPlan, origen, vigente ? globosArcoOrganico(vigente) : null, editor.hayCambios, leyenda);
  return (
    <PanelArcoOrganico
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombre}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      sustantivo={sustantivo}
      pie={<>{delPlanVivo.aviso}<EditorArcoOrganico borrador={editor.borrador} vista={editor.vista} leyenda={leyenda} guardar={editor.guardar} guardando={editor.guardando} errorGuardado={editor.errorGuardado} planCambio={editor.planCambio} coloresCambiaron={editor.coloresCambiaron} hayCambios={editor.hayCambios} onCambiar={editor.cambiar} onGuardar={editor.pedirGuardar} onDescartar={editor.descartar} onRestablecer={editor.restablecer} onReintentar={editor.vista.reintentar} onSeguirConMiBorrador={editor.seguirConMiBorrador} onUsarArcoDeLaPropuesta={editor.usarArcoDeLaPropuesta} onReceta={editor.pedirReceta} sustantivo={sustantivo} /></>}
    />
  );
}

function Arco({ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, guardado, delPlan }: Comunes & { guardado: ArmadoArcoV1 | null }) {
  // El arco de patrón no admite tamaños ni pesos por color: abre con su receta (con las medidas del plan) y el aviso
  // dice en qué se aparta del plan.
  const pedir = useCallback((signal: AbortSignal) => abrirPieza<ArmadoArcoV1, VistaArmadoArco>({
    guardado,
    pedirVista: (armado) => pedirVistaArmadoArco(peticionVistaArco(pieza, armado), { signal }),
    sembrar: null,
    corregir: null,
    globos: globosArco,
    delPlan,
    estructuraId: pieza.estructuraId,
  }), [pieza, guardado, delPlan]);
  const { estado, reintentar } = useInicial(pedir, "arco");
  if (estado?.fase !== "listo") return <Preparando estado={estado} onReintentar={reintentar} />;
  return <ArcoEditando inicial={estado.inicial.vista} origen={estado.inicial.origen} armado={guardado ?? estado.inicial.vista.armado} {...{ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }} />;
}

function ArcoEditando({ inicial, origen, armado, pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }: Comunes & { inicial: VistaArmadoArco; origen: OrigenApertura; armado: ArmadoArcoV1 }) {
  const onGuardar = (nuevo: ArmadoArcoV1) => guardar({ accion: "armado_arco", estructura_id: pieza.estructuraId, armado_arco: nuevo }, delPlanVivo.dibujoRef.current);
  const editor = useEditorArco({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  const vigente = vistaVigente(editor.panel);
  const delPlanVivo = useAvisoDelPlan(delPlan, origen, vigente ? globosArco(vigente) : null, editor.hayCambios, leyenda);
  return (
    <PanelArco
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombre}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      pie={<>{delPlanVivo.aviso}<EditorArco borrador={editor.borrador} vista={editor.vista} leyenda={leyenda} guardar={editor.guardar} guardando={editor.guardando} errorGuardado={editor.errorGuardado} planCambio={editor.planCambio} coloresCambiaron={editor.coloresCambiaron} hayCambios={editor.hayCambios} onCambiar={editor.cambiar} onGuardar={editor.pedirGuardar} onDescartar={editor.descartar} onRestablecer={editor.restablecer} onReintentar={editor.vista.reintentar} onSeguirConMiBorrador={editor.seguirConMiBorrador} onUsarArcoDeLaPropuesta={editor.usarArcoDeLaPropuesta} onReceta={editor.pedirReceta} /></>}
    />
  );
}

function GuirnaldaOrganica({ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, guardado, delPlan }: Comunes & { guardado: ArmadoGuirnaldaOrganicaV1 | null }) {
  const pedir = useCallback((signal: AbortSignal) => abrirPieza<ArmadoGuirnaldaOrganicaV1, VistaArmadoGuirnaldaOrganica>({
    guardado,
    pedirVista: (armado) => pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(pieza, armado), { signal }),
    sembrar: (receta, cifras) => sembrarGuirnaldaOrganica(receta.armado, cifras),
    corregir: conRellenoHacia,
    globos: globosGuirnaldaOrganica,
    delPlan,
    estructuraId: pieza.estructuraId,
  }), [pieza, guardado, delPlan]);
  const { estado, reintentar } = useInicial(pedir, "guirnalda-organica");
  if (estado?.fase !== "listo") return <Preparando estado={estado} onReintentar={reintentar} />;
  return <GuirnaldaOrganicaEditando inicial={estado.inicial.vista} origen={estado.inicial.origen} armado={guardado ?? estado.inicial.vista.armado} {...{ pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }} />;
}

function GuirnaldaOrganicaEditando({ inicial, origen, armado, pieza, leyenda, nombre, repeticiones, guardar, ocupado, onCerrar, delPlan }: Comunes & { inicial: VistaArmadoGuirnaldaOrganica; origen: OrigenApertura; armado: ArmadoGuirnaldaOrganicaV1 }) {
  const onGuardar = (nuevo: ArmadoGuirnaldaOrganicaV1) => guardar({ accion: "armado_guirnalda_organica", estructura_id: pieza.estructuraId, armado_guirnalda_organica: nuevo }, delPlanVivo.dibujoRef.current);
  const editor = useEditorGuirnaldaOrganica({ armadoEnPlan: armado, pieza, inicial, onGuardar, ocupado, onCerrar });
  const vigente = vistaVigente(editor.panel);
  const delPlanVivo = useAvisoDelPlan(delPlan, origen, vigente ? globosGuirnaldaOrganica(vigente) : null, editor.hayCambios, leyenda);
  return (
    <PanelGuirnaldaOrganica
      estado={editor.panel}
      leyenda={leyenda}
      nombrePieza={nombre}
      repeticiones={repeticiones}
      onReintentar={editor.vista.reintentar}
      pie={<>{delPlanVivo.aviso}<EditorGuirnaldaOrganica borrador={editor.borrador} vista={editor.vista} leyenda={leyenda} guardar={editor.guardar} guardando={editor.guardando} errorGuardado={editor.errorGuardado} planCambio={editor.planCambio} coloresCambiaron={editor.coloresCambiaron} hayCambios={editor.hayCambios} onCambiar={editor.cambiar} onGuardar={editor.pedirGuardar} onDescartar={editor.descartar} onRestablecer={editor.restablecer} onReintentar={editor.vista.reintentar} onSeguirConMiBorrador={editor.seguirConMiBorrador} onUsarGuirnaldaDeLaPropuesta={editor.usarGuirnaldaDeLaPropuesta} onReceta={editor.pedirReceta} /></>}
    />
  );
}

/** El armado guardado del campo, solo si cumple su contrato; si no, la pieza abre con la receta. */
function guardadoDe<T>(esquema: { safeParse: (valor: unknown) => { success: true; data: T } | { success: false } }, valor: unknown): T | null {
  if (valor === undefined || valor === null) return null;
  const leido = esquema.safeParse(valor);
  return leido.success ? leido.data : null;
}

/** Si la pieza se puede modificar aquí: la arma un motor (columna, arco, semiarco, guirnalda). */
export function piezaModificable(plan: PlanGuiado, estructuraId: string): boolean {
  const declarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  return Boolean(declarada && declarada.materiales.length > 0 && motorDePieza(declarada)?.tipo === "motor");
}

const sinSuscripcion = () => () => {};

type Props = {
  plan: PlanGuiado;
  /** La pieza abierta, o `null` (cerrado). */
  estructuraId: string | null;
  onCerrar: () => void;
  onPlanAjustado: (plan: PlanGuiado, cotizacion: unknown, ajuste: AjustePublicado) => void;
  /** «Colores y cantidades»: cierra y abre «Ajustar mi plan» (no se duplican sus mandos aquí). */
  onIrAAjustar?: () => void;
  ocupado: boolean;
};

export function ModificarPieza({ plan, estructuraId, onCerrar, onPlanAjustado, onIrAAjustar, ocupado }: Props) {
  // En el servidor no hay `document`: la hoja solo existe en el navegador.
  const enNavegador = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  if (!enNavegador) return null;
  return createPortal(
    <AnimatePresence>
      {estructuraId && <Hoja key={`${estructuraId}-${plan.plan_hash}`} plan={plan} estructuraId={estructuraId} onCerrar={onCerrar} onPlanAjustado={onPlanAjustado} onIrAAjustar={onIrAAjustar} ocupado={ocupado} />}
    </AnimatePresence>,
    document.body,  // prerender-seguro: tras `if (!enNavegador) return null`; en el servidor no se llega al portal
  );
}

function Hoja({ plan, estructuraId, onCerrar, onPlanAjustado, onIrAAjustar, ocupado }: Omit<Props, "estructuraId"> & { estructuraId: string }) {
  const idTitulo = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  // El plan con que se abrió: el editor trabaja sobre él aunque la tarjeta cambie detrás; guardar lo reemplaza.
  const [base] = useState(plan);
  const declarada = base.plan.estructuras.find((estructura) => estructura.estructura_id === estructuraId);
  // Fijos mientras la hoja está abierta: el editor compara contra ellos si la pieza cambió bajo sus pies.
  const [{ leyenda, pieza }] = useState(() => {
    const tonos = leyendaDePieza(plan, estructuraId);
    return { leyenda: tonos, pieza: { plan: plan.plan, estructuraId, colores: tonos.map((color) => color.hex) } satisfies PiezaMotor };
  });
  const motor = declarada ? motorDePieza(declarada) : null;
  const nombre = declarada?.nombre ?? "tu pieza";
  // Mientras sale (animación de cierre) la hoja ya no tapa la página ni bloquea su desplazamiento.
  const presente = useIsPresent();
  const desbordeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!presente && desbordeRef.current !== null) document.body.style.overflow = desbordeRef.current;
  }, [presente]);

  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const desborde = document.body.style.overflow;
    desbordeRef.current = desborde;
    document.body.style.overflow = "hidden";
    tituloRef.current?.focus({ preventScroll: true });
    registrar("pieza.modificar_abrir", { estructura_id: estructuraId, campo: motor?.tipo === "motor" ? motor.campo : null, receta: motor?.tipo === "motor" ? motor.armado === null : null, plan_hash: base.plan_hash });
    const alTeclear = (evento: KeyboardEvent) => { if (evento.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alTeclear);
    return () => {
      document.body.style.overflow = desborde;
      window.removeEventListener("keydown", alTeclear);
      anterior?.focus();
    };
    // Solo al abrir y al cerrar esta hoja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lo que el plan dice de la pieza, fijo mientras la hoja está abierta (con el plan con que se abrió).
  const [delPlan] = useState<DelPlan>(() => ({
    cifras: cifrasDelPlan(base, estructuraId),
    sinArmado: motor?.tipo === "motor" && motor.armado === null,
    articulo: declarada ? piezaConArticulo(declarada) : "la pieza",
  }));
  // Antes de reescribir con los globos del dibujo una pieza que no tenía armado, se pregunta (y se espera la respuesta).
  const [confirmacion, setConfirmacion] = useState<GlobosDibujo | null>(null);
  const responderRef = useRef<((guardar: boolean) => void) | null>(null);
  const pieRef = useRef<HTMLElement>(null);
  // Si la hoja se cierra con la pregunta abierta, no se guarda nada.
  useEffect(() => () => responderRef.current?.(false), []);
  useEffect(() => {
    if (confirmacion) pieRef.current?.querySelector<HTMLButtonElement>("[data-testid=confirmar-pieza-plan-guardar]")?.focus();
  }, [confirmacion]);
  const preguntar = useCallback((despues: GlobosDibujo) => new Promise<boolean>((resolver) => {
    responderRef.current = resolver;
    setConfirmacion(despues);
  }), []);
  const responder = (guardarLaPieza: boolean) => {
    const resolver = responderRef.current;
    responderRef.current = null;
    setConfirmacion(null);
    resolver?.(guardarLaPieza);
  };

  const guardar = useCallback<Guardar>(async (edicion, dibujo) => {
    const { cifras, sinArmado } = delPlan;
    if (sinArmado && cifras && dibujo && !compararConPlan(cifras, dibujo).exacta) {
      const acepta = await preguntar(dibujo);
      registrar("pieza.modificar_confirmar", { estructura_id: estructuraId, accion: edicion.accion, acepta, globos_plan: cifras.total, globos_dibujo: dibujo.total });
      if (!acepta) return "elegiste seguir editando.";
    }
    registrar("pieza.modificar_guardar", { estructura_id: estructuraId, accion: edicion.accion, plan_hash_base: base.plan_hash, globos_plan: delPlan.cifras?.total ?? null, globos_dibujo: dibujo?.total ?? null });
    try {
      const nuevo = await aplicarEnServidor(base, edicion);
      // «Cambios en…»: guardar puede ser la forma, el tamaño o el peso de un color (antes decía «nueva forma» siempre).
      const descripcion = declarada ? `cambios en ${piezaConArticulo(declarada)}` : "cambios en la pieza";
      onPlanAjustado(nuevo.plan, nuevo.cotizacion, { descripcion, baseHash: base.plan_hash });
      registrar("pieza.modificada", { estructura_id: estructuraId, accion: edicion.accion, plan_hash: nuevo.plan.plan_hash });
      return null;
    } catch (error) {
      const mensaje = mensajeAjuste(error);
      registrar("pieza.modificar_fallo", { estructura_id: estructuraId, accion: edicion.accion, mensaje, error: error instanceof Error ? error.message : String(error) }, "error");
      return mensaje;
    }
  }, [base, declarada, delPlan, estructuraId, onPlanAjustado, preguntar]);

  const comunes: Comunes = { pieza, leyenda, nombre, repeticiones: declarada?.repeticiones ?? 1, guardar, ocupado, onCerrar, delPlan };
  const editor = !declarada || motor?.tipo !== "motor" ? null
    : motor.campo === "armado_columna_organica" ? <ColumnaOrganica {...comunes} guardado={guardadoDe(ArmadoColumnaOrganicaV1Schema, declarada.armado_columna_organica)} />
    : motor.campo === "armado_columna" ? <Columna {...comunes} guardado={guardadoDe(ArmadoColumnaV1Schema, declarada.armado_columna)} />
    : motor.campo === "armado_arco_organico" ? <ArcoOrganico {...comunes} guardado={guardadoDe(ArmadoArcoOrganicoV1Schema, declarada.armado_arco_organico)} sustantivo={declarada.tipo === "semiarco" ? "semiarco" : "arco"} />
    : motor.campo === "armado_arco" ? <Arco {...comunes} guardado={guardadoDe(ArmadoArcoV1Schema, declarada.armado_arco)} />
    : <GuirnaldaOrganica {...comunes} guardado={guardadoDe(ArmadoGuirnaldaOrganicaV1Schema, declarada.armado_guirnalda_organica)} />;

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4 ${presente ? "" : "pointer-events-none"}`}>
      <motion.button
        type="button"
        aria-label="Cerrar sin guardar"
        tabIndex={-1}
        onClick={onCerrar}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ duration: 0.32, ease: EASE_SALIDA }}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-superficie shadow-[0_-8px_40px_var(--sombra)] sm:max-w-2xl sm:rounded-3xl"
      >
        <header className="flex items-start gap-3 border-b border-borde-suave px-4 pb-3 pt-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-acento">Modificar pieza</p>
            <h2 id={idTitulo} ref={tituloRef} tabIndex={-1} style={{ outline: "none" }} className="text-lg font-semibold leading-snug text-texto focus:outline-none">{nombre}</h2>
            <p className="mt-0.5 text-sm text-texto-suave">Cambia la forma, el tamaño o los colores y mira el dibujo al momento. Al guardar, recalculo tus globos y el precio.</p>
          </div>
          <motion.button
            type="button"
            onClick={onCerrar}
            whileTap={{ scale: 0.92 }}
            transition={RESORTE}
            aria-label="Cerrar"
            className="grid size-11 shrink-0 place-items-center rounded-full text-texto-suave hover:bg-superficie-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
          >
            <X className="size-5" aria-hidden />
          </motion.button>
        </header>
        {/* UN solo desplazamiento (el de la hoja): los editores hablan con la voz del cliente y no traen su propia caja con scroll. */}
        <div ref={cuerpoRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-4">
          <VozEditorProvider value="cliente">
            {editor ?? <p className="rounded-2xl bg-superficie-suave px-3 py-3 text-sm text-texto">Esta pieza no se puede modificar aquí. Pídelo con «Cambiar algo».</p>}
          </VozEditorProvider>
        </div>
        {confirmacion && delPlan.cifras ? (
          <footer ref={pieRef} className="border-t border-borde-suave bg-superficie-suave px-4 py-3 sm:px-5">
            <ConfirmarPiezaPlan pieza={delPlan.articulo} antes={delPlan.cifras.total} despues={compararConPlan(delPlan.cifras, confirmacion).dibujo} leyenda={leyenda} onGuardar={() => responder(true)} onSeguir={() => responder(false)} />
          </footer>
        ) : onIrAAjustar && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-borde-suave px-4 py-2.5 sm:px-5">
            <p className="text-xs text-texto-suave">¿Cuántos globos de cada color, otro globo del catálogo o medidas exactas?</p>
            <button type="button" onClick={onIrAAjustar} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-acento hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
              <SlidersHorizontal className="size-4" aria-hidden />Ajustar mi plan
            </button>
          </footer>
        )}
      </motion.div>
    </div>
  );
}

export type { CampoArmado };
