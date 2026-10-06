"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, Sparkles, X } from "lucide-react";
import { z } from "zod";
import { CabeceraApp } from "@/components/ui/shell/CabeceraApp";
import { Markdown } from "@/components/Markdown";
import { CarruselDecoraciones } from "./CarruselDecoraciones";
import { ComprarMateriales } from "./ComprarMateriales";
import { ChipsOpciones, type OpcionGuiada } from "./ChipsOpciones";
import { CostosMateriales } from "./CostosMateriales";
import { PasoAPaso } from "./PasoAPaso";
import { PreguntaUso } from "./PreguntaUso";
import { RespuestasRapidas, separarOpciones } from "./RespuestasRapidas";
import { TarjetaEleccion } from "./TarjetaEleccion";
import { TarjetasProveedores } from "./TarjetasProveedores";
import { useModoVista } from "@/lib/estado/modo-vista";
import { DecoracionSempertexSchema, ProveedorSempertexSchema, type DecoracionSempertex, type ProveedorSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { ChatSseEventV1Schema } from "@/lib/ia/contracts/chat-v1";
import { CotizacionGuiadaSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { prepararHistorialGuiado, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";

/**
 * Lo que el asistente muestra además de su texto. Cada pieza va PEGADA al mensaje que la trajo, en el orden de la
 * conversación (antes todas se apilaban al final y no se sabía a qué respondían). Solo las del último mensaje del
 * asistente están activas; las anteriores quedan como historia (la idea elegida, el precio que salió…).
 */
const WidgetSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("decoraciones"), decoraciones: z.array(DecoracionSempertexSchema) }).strict(),
  z.object({ tipo: z.literal("seleccion"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("opciones") }).strict(),
  z.object({ tipo: z.literal("uso") }).strict(),
  z.object({ tipo: z.literal("cotizacion"), cotizacion: CotizacionGuiadaSchema.nullable(), uso: z.enum(["negocio", "personal"]), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("pasos"), decoracion: DecoracionSempertexSchema }).strict(),
  z.object({ tipo: z.literal("proveedores"), proveedores: z.array(ProveedorSempertexSchema) }).strict(),
  z.object({ tipo: z.literal("comprar"), decoracion: DecoracionSempertexSchema }).strict(),
]);
type Widget = z.infer<typeof WidgetSchema>;
const MensajeSchema = z.object({ id: z.string(), role: z.enum(["user", "assistant"]), content: z.string(), widgets: z.array(WidgetSchema).optional() }).strict();
type Mensaje = z.infer<typeof MensajeSchema>;
type BriefGuiado = { evento?: string; edad?: number; tematica?: string };
type Uso = "negocio" | "personal";

const CLAVE_SESION = "demo_guiado_v2";
const EstadoGuardadoSchema = z.object({
  mensajes: z.array(MensajeSchema).max(80),
  brief: z.object({ evento: z.string().optional(), edad: z.number().int().optional(), tematica: z.string().optional() }).strict().optional(),
  seleccionadaId: z.string().nullable().optional(),
  uso: z.enum(["negocio", "personal"]).nullable().optional(),
}).strict();
const ResultadoSchema = z.object({
  brief: z.object({ evento: z.string().min(1).max(120), edad: z.number().int().min(0).max(120), tematica: z.string().min(1).max(160) }).strict().optional(),
  decoraciones: z.array(DecoracionSempertexSchema).optional(),
  opciones: z.array(z.enum(["contratar", "costear", "comprar", "aprender"])).optional(),
  preguntaUso: z.boolean().optional(),
  cotizacion: z.unknown().optional(),
  uso: z.enum(["negocio", "personal"]).optional(),
  pasos: z.array(z.object({ orden: z.number().int().positive(), texto: z.string().min(1) }).strict()).optional(),
  proveedores: z.array(ProveedorSempertexSchema).optional(),
}).passthrough();

function nuevoId(): string { return crypto.randomUUID(); }

/**
 * La conversación la abre el asistente (pruebas del 5-oct: «el cliente se encuentra perdido» si nadie le pregunta
 * nada). El saludo es fijo, sale al instante y no viaja en el historial: el prompt guiado sabe que ya se hizo.
 */
const SALUDO = "¡Hola! Te hago unas preguntas cortas y te muestro decoraciones Sempertex que encajen con tu celebración.\n\n**¿Qué vas a celebrar?**";
const OPCIONES_SALUDO = ["Cumpleaños", "Baby shower", "Boda", "XV años", "Bautizo o comunión", "Otra celebración"] as const;

/** Widgets que ya hacen la pregunta: con ellos, los botones «Opciones:» del texto sobran (salían duplicados). */
const WIDGETS_QUE_PREGUNTAN = new Set<Widget["tipo"]>(["decoraciones", "opciones", "uso"]);

export function VistaGuiada() {
  const { modo, cambiar } = useModoVista();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [brief, setBrief] = useState<BriefGuiado>({});
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionada, setSeleccionada] = useState<DecoracionSempertex | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const entradaRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const turnoRef = useRef(0);

  const indiceActivo = useMemo(() => {
    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) if (mensajes[indice]!.role === "assistant") return indice;
    return -1;
  }, [mensajes]);
  const ultimo = mensajes.at(-1);
  const respuestasRapidas = useMemo(() => {
    if (cargando) return [];
    if (!mensajes.length) return [...OPCIONES_SALUDO];
    if (ultimo?.role !== "assistant" || ultimo.widgets?.some((widget) => WIDGETS_QUE_PREGUNTAN.has(widget.tipo))) return [];
    return separarOpciones(ultimo.content).opciones;
  }, [mensajes.length, ultimo, cargando]);
  const hayEjemplos = useMemo(() => mensajes.some((mensaje) => mensaje.widgets?.some((widget) => (widget.tipo === "decoraciones" && widget.decoraciones.some((decoracion) => decoracion.origen === "ejemplo")) || ("decoracion" in widget && widget.decoracion.origen === "ejemplo"))), [mensajes]);
  const contexto = seleccionada ? `${seleccionada.titulo}${uso ? ` · ${uso === "negocio" ? "Para negocio" : "Uso personal"}` : ""}` : brief.tematica ? `${brief.evento ?? ""}${brief.edad ? ` · ${brief.edad} años` : ""} · ${brief.tematica}` : null;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CLAVE_SESION);
      if (!raw) return;
      const parsed = EstadoGuardadoSchema.safeParse(JSON.parse(raw) as unknown);
      if (!parsed.success) { console.warn("[asistente-guiado] sesión guardada inválida; se inicia una conversación nueva."); return; }
      const elegida = parsed.data.seleccionadaId ? decoracionDeLaConversacion(parsed.data.mensajes, parsed.data.seleccionadaId) : null;
      requestAnimationFrame(() => { setMensajes(parsed.data.mensajes); setBrief(parsed.data.brief ?? {}); setSeleccionada(elegida); setUso(parsed.data.uso ?? null); });
    } catch (cause) {
      console.warn("[asistente-guiado] no se pudo restaurar la conversación.", cause);
    }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ mensajes, brief, seleccionadaId: seleccionada?.id ?? null, uso })); }
    catch (cause) { console.warn("[asistente-guiado] no se pudo guardar la conversación.", cause); }
  }, [mensajes, brief, seleccionada, uso]);

  // Lo nuevo siempre a la vista: el texto que llega, las ideas, el precio.
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [mensajes, cargando, error]);

  const vaciar = useCallback(() => {
    turnoRef.current += 1;
    setMensajes([]); setBrief({}); setSeleccionada(null); setUso(null); setFoto(null); setCargando(false); setError(null);
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (cause) { console.warn("[asistente-guiado] no se pudo limpiar la sesión.", cause); }
  }, []);

  const enviar = useCallback(async (texto: string, opcionesEnvio?: { uso?: Uso; reintentar?: boolean }) => {
    const limpio = texto.trim();
    if (!limpio || cargando) return;
    const contenido = limpio.slice(0, 6000);
    const turno = ++turnoRef.current;
    const historial = prepararHistorialGuiado(mensajes, `${contenido}${foto ? "\nAdjunté una foto de inspiración." : ""}`, opcionesEnvio?.reintentar);
    const mensajesVisibles = (opcionesEnvio?.reintentar ? sinUltimoTurnoGuiado(mensajes) : mensajes).filter((mensaje) => mensaje.content.trim().length > 0 || mensaje.widgets?.length);
    const usoEnvio = opcionesEnvio?.uso ?? uso;
    const elegida = seleccionada;
    setMensajes([...mensajesVisibles, { id: nuevoId(), role: "user", content: contenido }, { id: nuevoId(), role: "assistant", content: "" }]);
    setEntrada(""); setError(null); setCargando(true);
    try {
      const response = await fetch("/api/asistente-guiado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema_version: "asistente-guiado.v1", messages: historial, brief, estadoGuiado: { ...(elegida ? { decoracionId: elegida.id } : {}), ...(usoEnvio ? { uso: usoEnvio } : {}) }, ...(foto ? { fotoInspiracion: await leerFoto(foto) } : {}) }) });
      if (!response.ok || !response.body) throw new Error(`El asistente respondió con estado ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textoFinal = "";
      const reemplazarUltimo = (cambio: Partial<Mensaje>) => setMensajes((actuales) => actuales.map((mensaje, indice) => indice === actuales.length - 1 ? { ...mensaje, ...cambio } : mensaje));
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const paquetes = buffer.split("\n\n"); buffer = paquetes.pop() ?? "";
        for (const paquete of paquetes) {
          if (turno !== turnoRef.current) return;
          const linea = paquete.split("\n").find((item) => item.startsWith("data: "));
          if (!linea) continue;
          let dato: unknown;
          try { dato = JSON.parse(linea.slice(6)) as unknown; } catch (cause) { throw new Error("El asistente envió una respuesta incompleta.", { cause }); }
          const parseado = ChatSseEventV1Schema.safeParse(dato);
          if (!parseado.success) throw new Error("La respuesta del asistente no cumple el contrato.");
          if (parseado.data.type === "texto") { textoFinal += parseado.data.delta; reemplazarUltimo({ content: textoFinal }); }
          if (parseado.data.type === "error") throw new Error(parseado.data.error);
          if (parseado.data.type === "fin") {
            textoFinal = parseado.data.reply.slice(0, 6000);
            const resultado = ResultadoSchema.safeParse(parseado.data.result ?? {});
            if (!resultado.success) throw new Error("Los datos devueltos por el asistente no son válidos.");
            const datos = resultado.data;
            if (datos.brief) setBrief(datos.brief);
            if (datos.uso) setUso(datos.uso);
            const widgets: Widget[] = [];
            if (datos.decoraciones?.length) widgets.push({ tipo: "decoraciones", decoraciones: datos.decoraciones });
            if (datos.opciones && elegida) widgets.push({ tipo: "opciones" });
            if (datos.preguntaUso) widgets.push({ tipo: "uso" });
            const usoCotizado = datos.uso ?? usoEnvio;
            if (elegida && usoCotizado && datos.cotizacion !== undefined) {
              const valida = datos.cotizacion == null ? null : CotizacionGuiadaSchema.safeParse(datos.cotizacion);
              if (valida && !valida.success) throw new Error("La cotización recibida no cumple el contrato.");
              widgets.push({ tipo: "cotizacion", cotizacion: valida ? valida.data : null, uso: usoCotizado, decoracion: elegida });
            }
            if (datos.pasos && elegida) widgets.push({ tipo: "pasos", decoracion: elegida });
            // Después del precio o de los pasos, el cliente sigue teniendo las otras opciones a mano (comprar, decorador...).
            if (elegida && widgets.some((widget) => widget.tipo === "cotizacion" || widget.tipo === "pasos") && !widgets.some((widget) => widget.tipo === "opciones")) widgets.push({ tipo: "opciones" });
            if (datos.proveedores) widgets.push({ tipo: "proveedores", proveedores: datos.proveedores });
            reemplazarUltimo({ content: textoFinal, ...(widgets.length ? { widgets } : {}) });
            if (!textoFinal.trim() && !widgets.length) setMensajes((actuales) => actuales.slice(0, -1));
          }
        }
      }
      if (turno === turnoRef.current) setFoto(null);
    } catch (cause) {
      if (turno !== turnoRef.current) return;
      // Al cliente, un mensaje amable; la causa real queda en la consola para diagnosticar.
      console.error("[asistente-guiado] turno fallido", cause);
      setError(cause instanceof Error ? cause.message : "No se pudo enviar el mensaje.");
      setMensajes((actuales) => actuales.filter((item) => item.content !== "" || item.widgets?.length));
    } finally { if (turno === turnoRef.current) setCargando(false); }
  }, [brief, cargando, mensajes, seleccionada, foto, uso]);

  function elegirDecoracion(decoracion: DecoracionSempertex): void {
    turnoRef.current += 1;
    setCargando(false); setSeleccionada(decoracion); setUso(null); setError(null);
    setMensajes((actuales) => [
      ...actuales,
      { id: nuevoId(), role: "user", content: `Me gusta «${decoracion.titulo}».` },
      { id: nuevoId(), role: "assistant", content: `¡Buena elección! Esto es lo que lleva **${decoracion.titulo}**. ¿Qué te gustaría hacer ahora?`, widgets: [{ tipo: "seleccion", decoracion }, { tipo: "opciones" }] },
    ]);
  }

  function elegirOpcion(opcion: OpcionGuiada): void {
    // «Comprar» no necesita al modelo: la lista y las dos salidas (tienda en línea, distribuidor) salen al instante.
    if (opcion === "comprar" && seleccionada) {
      setMensajes((actuales) => [
        ...actuales,
        { id: nuevoId(), role: "user", content: "Quiero comprar los materiales." },
        { id: nuevoId(), role: "assistant", content: `Puedes comprar los globos de **${seleccionada.titulo}** en la tienda en línea de Sempertex o con un distribuidor cerca de ti.`, widgets: [{ tipo: "comprar", decoracion: seleccionada }, { tipo: "opciones" }] },
      ]);
      return;
    }
    const textos: Record<OpcionGuiada, string> = {
      contratar: "Quiero contratar un decorador cerca de mí.",
      costear: "Quiero saber cuánto cuestan los materiales.",
      comprar: "Quiero saber dónde comprar los materiales.",
      aprender: seleccionada ? `Quiero aprender a hacer «${seleccionada.titulo}» paso a paso.` : "Quiero aprender a hacerla paso a paso.",
    };
    void enviar(textos[opcion]);
  }

  // Los registros son de ejemplo: la solicitud se explica en la conversación, sin fingir que se envió a alguien.
  function solicitarProveedor(proveedor: ProveedorSempertex): void {
    const decorador = proveedor.tipo === "decorador_happia" || proveedor.tipo === "mbp";
    const idea = seleccionada ? ` con tu idea **${seleccionada.titulo}**` : "";
    const respuesta = decorador
      ? `¡Perfecto! En la versión final, **${proveedor.nombre}** recibirá tu solicitud${idea} y te contactará para cotizar el montaje. Por ahora es un decorador de ejemplo. ¿Qué más te gustaría hacer?`
      : `¡Perfecto! En la versión final verás aquí la dirección y el horario de **${proveedor.nombre}**. Por ahora es un distribuidor de ejemplo. ¿Qué más te gustaría hacer?`;
    setMensajes((actuales) => [
      ...actuales,
      { id: nuevoId(), role: "user", content: decorador ? `Quiero cotizar con ${proveedor.nombre}.` : `Quiero comprar en ${proveedor.nombre}.` },
      { id: nuevoId(), role: "assistant", content: respuesta, widgets: seleccionada ? [{ tipo: "opciones" }] : [] },
    ]);
  }

  function elegirUso(valor: Uso): void { setUso(valor); void enviar(valor === "negocio" ? "Es para mi negocio." : "Es para uso personal.", { uso: valor }); }

  function renderWidget(widget: Widget, activo: boolean, clave: string) {
    switch (widget.tipo) {
      case "decoraciones":
        return <CarruselDecoraciones key={clave} decoraciones={widget.decoraciones} activo={activo && !cargando} elegidaId={seleccionada?.id ?? null} onElegir={elegirDecoracion} onNinguna={() => void enviar("Ninguna me convence. Quiero ver otras ideas o mostrarte una foto de inspiración.")} />;
      case "seleccion":
        return <TarjetaEleccion key={clave} decoracion={widget.decoracion} />;
      case "opciones":
        return activo ? <ChipsOpciones key={clave} onElegir={elegirOpcion} deshabilitado={cargando} /> : null;
      case "uso":
        return activo ? <PreguntaUso key={clave} onElegir={elegirUso} deshabilitado={cargando} /> : null;
      case "cotizacion":
        return <CostosMateriales key={clave} cotizacion={widget.cotizacion} uso={widget.uso} clave={`guiado-${widget.decoracion.id}`} mensajePendiente="Todavía no tengo el precio de estos materiales. Puedo buscarte un proveedor cerca." onProveedores={() => void enviar("Busca proveedores cerca de mí para cotizar los materiales.")} />;
      case "pasos":
        return <PasoAPaso key={clave} decoracion={widget.decoracion} />;
      case "proveedores":
        return <TarjetasProveedores key={clave} proveedores={widget.proveedores} activo={activo && !cargando} onSolicitar={solicitarProveedor} />;
      case "comprar":
        return <ComprarMateriales key={clave} decoracion={widget.decoracion} onDistribuidor={() => void enviar("Busca un distribuidor de globos Sempertex cerca de mí.")} />;
    }
  }

  // Alto fijo también en celular: el compositor queda siempre a la vista y solo se desplaza la conversación.
  return <main className="app-shell h-dvh">
    <CabeceraApp contexto={contexto} modoVista={modo} onModoVista={cambiar} onLimpiar={vaciar} limpiarDeshabilitado={!mensajes.length} totalSeleccion={0} />
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Asistente guiado">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10">
          {!mensajes.length && <header className="mb-8 text-center">
            <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-acento-suave text-acento"><Sparkles className="size-7" aria-hidden /></span>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Diseñemos tu decoración con globos</h1>
            <p className="mx-auto mt-3 max-w-xl text-balance text-texto-secundario">Te muestro ideas Sempertex para tu celebración y te digo qué globos necesitas, cuánto cuestan y cómo armarla.</p>
          </header>}
          <div className="flex flex-col gap-6" aria-live="polite">
            <BurbujaAsistente><Markdown>{SALUDO}</Markdown></BurbujaAsistente>
            {mensajes.map((mensaje, indice) => mensaje.role === "user"
              ? <div key={mensaje.id} className="ml-auto max-w-[min(85%,36rem)] rounded-2xl rounded-br-md bg-acento px-4 py-2.5 text-sm text-white shadow-sm">{mensaje.content}</div>
              : <BurbujaAsistente key={mensaje.id}>
                  {mensaje.content.trim()
                    ? <Markdown>{separarOpciones(mensaje.content).texto}</Markdown>
                    : !mensaje.widgets?.length && cargando && indice === mensajes.length - 1 ? <Escribiendo /> : null}
                  {mensaje.widgets?.map((widget, posicion) => renderWidget(widget, indice === indiceActivo, `${mensaje.id}-${posicion}`))}
                </BurbujaAsistente>)}
            {respuestasRapidas.length > 0 && <div className="pl-11"><RespuestasRapidas opciones={respuestasRapidas} deshabilitado={cargando} onElegir={(texto) => void enviar(texto)} /></div>}
          </div>
          {error && <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <span className="flex-1">No pude responder esta vez. Inténtalo de nuevo.</span>
            <button type="button" className="rounded-xl bg-rose-900 px-4 py-2 font-semibold text-white" onClick={() => void enviar([...mensajes].reverse().find((mensaje) => mensaje.role === "user")?.content ?? "Continúa", { reintentar: true })}>Reintentar</button>
          </div>}
          <div ref={finRef} className="h-2" />
        </div>
      </div>
      <form className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2 sm:px-6" onSubmit={(event) => { event.preventDefault(); void enviar(entrada); }}>
        <div className="flex items-center gap-2 rounded-2xl border border-borde-suave bg-superficie p-2 shadow-sm focus-within:ring-2 focus-within:ring-acento/30">
          <input ref={entradaRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setFoto(event.target.files?.[0] ?? null)} />
          <button type="button" aria-label="Adjuntar foto de inspiración" title="Adjuntar foto de inspiración" className="rounded-xl p-2 text-texto-secundario hover:bg-fondo" onClick={() => entradaRef.current?.click()}><ImagePlus className="size-5" /></button>
          {foto && <span className="flex max-w-40 items-center gap-1 rounded-lg bg-fondo px-2 py-1 text-xs"><span className="truncate">{foto.name}</span><button type="button" aria-label="Quitar foto" onClick={() => setFoto(null)}><X className="size-3.5" /></button></span>}
          <input aria-label="Escribe tu mensaje" value={entrada} maxLength={6000} onChange={(event) => setEntrada(event.target.value)} placeholder={mensajes.length ? "Escribe tu respuesta…" : "O cuéntame con tus palabras qué quieres celebrar…"} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-texto-secundario" disabled={cargando} />
          <button type="submit" aria-label="Enviar mensaje" disabled={cargando || !entrada.trim()} className="grid size-10 place-items-center rounded-xl bg-acento text-white transition-opacity disabled:opacity-40">{cargando ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}</button>
        </div>
        {hayEjemplos && <p className="mt-2 text-center text-xs text-texto-secundario">Las ideas marcadas «Ejemplo» son ilustrativas; los precios salen del catálogo actual de Sempertex.</p>}
      </form>
    </section>
  </main>;
}

function BurbujaAsistente({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-3">
    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-acento-suave text-acento" aria-hidden><Sparkles className="size-4" /></span>
    <div className="min-w-0 flex-1 text-[0.95rem] leading-relaxed">{children}</div>
  </div>;
}

function Escribiendo() {
  return <span className="inline-flex items-center gap-1 py-2" aria-label="El asistente está escribiendo">
    {[0, 150, 300].map((retraso) => <span key={retraso} className="size-2 animate-bounce rounded-full bg-texto-secundario/60" style={{ animationDelay: `${retraso}ms` }} />)}
  </span>;
}

function decoracionDeLaConversacion(mensajes: readonly Mensaje[], id: string): DecoracionSempertex | null {
  for (const mensaje of [...mensajes].reverse()) for (const widget of mensaje.widgets ?? []) {
    if (widget.tipo === "decoraciones") { const encontrada = widget.decoraciones.find((decoracion) => decoracion.id === id); if (encontrada) return encontrada; }
    if ("decoracion" in widget && widget.decoracion.id === id) return widget.decoracion;
  }
  return null;
}

async function leerFoto(archivo: File): Promise<{ mime: string; base64: string }> {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(archivo.type) || archivo.size > 6_000_000) throw new Error("La foto debe ser JPG, PNG o WebP y pesar menos de 6 MB.");
  const datos = await archivo.arrayBuffer();
  const bytes = new Uint8Array(datos);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return { mime: archivo.type, base64: btoa(binario) };
}
