"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, X } from "lucide-react";
import { z } from "zod";
import { CabeceraApp } from "@/components/ui/shell/CabeceraApp";
import { Markdown } from "@/components/Markdown";
import { CarruselDecoraciones } from "./CarruselDecoraciones";
import { ChipsOpciones, type OpcionGuiada } from "./ChipsOpciones";
import { CostosMateriales } from "./CostosMateriales";
import { PasoAPaso } from "./PasoAPaso";
import { PreguntaUso } from "./PreguntaUso";
import { useModoVista } from "@/lib/estado/modo-vista";
import { bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { DecoracionSempertexSchema, ProveedorSempertexSchema, type DecoracionSempertex, type ProveedorSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { ChatSseEventV1Schema } from "@/lib/ia/contracts/chat-v1";
import { CotizacionGuiadaSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { cotizacionCorrespondeASeleccion, prepararHistorialGuiado, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";
import type { Cotizacion } from "@/lib/cotizacion/motor";

type Mensaje = { id: string; role: "user" | "assistant"; content: string };
type BriefGuiado = { evento?: string; edad?: number; tematica?: string };
const CLAVE_SESION = "demo_guiado_v1";
const EstadoGuardadoSchema = z.object({ mensajes: z.array(z.object({ id: z.string(), role: z.enum(["user", "assistant"]), content: z.string() }).strict()).max(80), brief: z.object({ evento: z.string().optional(), edad: z.number().int().optional(), tematica: z.string().optional() }).strict().optional() }).strict();
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

export function VistaGuiada() {
  const { modo, cambiar } = useModoVista();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [brief, setBrief] = useState<BriefGuiado>({});
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decoraciones, setDecoraciones] = useState<DecoracionSempertex[]>([]);
  const [seleccionada, setSeleccionada] = useState<DecoracionSempertex | null>(null);
  const [opciones, setOpciones] = useState(false);
  const [preguntaUso, setPreguntaUso] = useState(false);
  const [uso, setUso] = useState<"negocio" | "personal" | null>(null);
  const [pasos, setPasos] = useState(false);
  const [proveedores, setProveedores] = useState<ProveedorSempertex[]>([]);
  const [foto, setFoto] = useState<File | null>(null);
  const [cotizacion, setCotizacion] = useState<Cotizacion | null>(null);
  const [cotizacionDecoracionId, setCotizacionDecoracionId] = useState<string | null>(null);
  const entradaRef = useRef<HTMLInputElement>(null);
  const turnoRef = useRef(0);
  const galeriaInicial = useMemo(() => bibliotecaVisible(), []);
  const contexto = mensajes.length ? (seleccionada ? `${seleccionada.tematica}${uso ? ` · ${uso === "negocio" ? "Negocio" : "Uso personal"}` : ""}` : null) : null;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CLAVE_SESION);
      if (raw) {
        const parsed = EstadoGuardadoSchema.safeParse(JSON.parse(raw) as unknown);
        if (parsed.success) requestAnimationFrame(() => { setMensajes(parsed.data.mensajes); setBrief(parsed.data.brief ?? {}); });
        else console.warn("[asistente-guiado] sesión guardada inválida; se inicia una conversación nueva.");
      }
    } catch (cause) {
      console.warn("[asistente-guiado] no se pudo restaurar la conversación.", cause);
    }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ mensajes, brief })); }
    catch (cause) { console.warn("[asistente-guiado] no se pudo guardar la conversación.", cause); }
  }, [mensajes, brief]);

  const vaciar = useCallback(() => {
    setMensajes([]); setBrief({}); setDecoraciones([]); setSeleccionada(null); setOpciones(false); setPreguntaUso(false); setUso(null); setPasos(false); setProveedores([]); setCotizacion(null); setCotizacionDecoracionId(null); setError(null);
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (cause) { console.warn("[asistente-guiado] no se pudo limpiar la sesión.", cause); }
  }, []);

  const enviar = useCallback(async (texto: string, opcionesEnvio?: { uso?: "negocio" | "personal"; reintentar?: boolean }) => {
    const limpio = texto.trim();
    if (!limpio || cargando) return;
    const contenido = limpio.slice(0, 6000);
    const turno = ++turnoRef.current;
    const historial = prepararHistorialGuiado(mensajes, `${contenido}${foto ? "\nAdjunté una foto de inspiración." : ""}`, opcionesEnvio?.reintentar);
    const mensajesVisibles = (opcionesEnvio?.reintentar ? sinUltimoTurnoGuiado(mensajes) : mensajes).filter((mensaje) => mensaje.content.trim().length > 0);
    setMensajes([...mensajesVisibles, { id: nuevoId(), role: "user", content: contenido }, { id: nuevoId(), role: "assistant", content: "" }]);
    setEntrada(""); setError(null); setCargando(true);
    try {
      const usoEnvio = opcionesEnvio?.uso ?? uso;
      const response = await fetch("/api/asistente-guiado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema_version: "asistente-guiado.v1", messages: historial, brief, estadoGuiado: { ...(seleccionada ? { decoracionId: seleccionada.id } : {}), ...(usoEnvio ? { uso: usoEnvio } : {}) }, ...(foto ? { fotoInspiracion: await leerFoto(foto) } : {}) }) });
      if (!response.ok || !response.body) throw new Error(`El asistente respondió con estado ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textoFinal = "";
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
          if (parseado.data.type === "texto") {
            textoFinal += parseado.data.delta;
            setMensajes((actuales) => actuales.map((mensaje, indice, todos) => indice === todos.length - 1 ? { ...mensaje, content: textoFinal } : mensaje));
          }
          if (parseado.data.type === "error") throw new Error(parseado.data.error);
          if (parseado.data.type === "fin") {
            textoFinal = parseado.data.reply;
            const resultado = ResultadoSchema.safeParse(parseado.data.result ?? {});
            if (!resultado.success) throw new Error("Los datos devueltos por el asistente no son válidos.");
            if (resultado.data.decoraciones) setDecoraciones(resultado.data.decoraciones);
            if (resultado.data.brief) setBrief(resultado.data.brief);
            if (resultado.data.opciones) setOpciones(true);
            if (resultado.data.preguntaUso) setPreguntaUso(true);
            if (resultado.data.pasos) setPasos(true);
            if (resultado.data.proveedores) setProveedores(resultado.data.proveedores);
            if (resultado.data.uso) setUso(resultado.data.uso);
            if (resultado.data.cotizacion) {
              const valida = CotizacionGuiadaSchema.safeParse(resultado.data.cotizacion);
              if (!valida.success) throw new Error("La cotización recibida no cumple el contrato.");
              setCotizacion(valida.data);
              setCotizacionDecoracionId(seleccionada?.id ?? null);
            }
            setMensajes((actuales) => textoFinal.trim() ? actuales.map((mensaje, indice) => indice === actuales.length - 1 ? { ...mensaje, content: textoFinal.slice(0, 6000) } : mensaje) : actuales.filter((mensaje) => mensaje.content.trim().length > 0));
          }
        }
      }
      if (turno === turnoRef.current) setFoto(null);
    } catch (cause) {
      if (turno !== turnoRef.current) return;
      const mensaje = cause instanceof Error ? cause.message : "No se pudo enviar el mensaje.";
      setError(mensaje);
      setMensajes((actuales) => actuales.filter((item) => item.content !== ""));
    } finally { if (turno === turnoRef.current) setCargando(false); }
  }, [brief, cargando, mensajes, seleccionada, foto, uso]);

  function elegirDecoracion(decoracion: DecoracionSempertex, gusta: boolean): void {
    if (gusta) { turnoRef.current += 1; setCargando(false); setSeleccionada(decoracion); setCotizacion(null); setCotizacionDecoracionId(null); setUso(null); setPreguntaUso(false); setPasos(false); setProveedores([]); setOpciones(true); setMensajes((actuales) => [...actuales, { id: nuevoId(), role: "assistant", content: decoracion.origen === "ejemplo" ? `Elegiste **${decoracion.titulo}**. La temática, cantidades y pasos son de ejemplo; variantes y precios se consultan en el catálogo actual.` : `Elegiste **${decoracion.titulo}**. La referencia y sus materiales vienen del catálogo Sempertex.` }]); }
    else void enviar(`No me gusta ninguna todavía. Quiero buscar otra opción.`);
  }

  function elegirOpcion(opcion: OpcionGuiada): void {
    if (opcion === "costear") { setPreguntaUso(true); void enviar("Quiero conocer el precio de los materiales."); return; }
    if (opcion === "aprender" && seleccionada) { setPasos(true); void enviar(`Quiero aprender a hacer ${seleccionada.titulo}, paso a paso.`); return; }
    const mensajesOpcion: Record<OpcionGuiada, string> = { contratar: "Quiero contratar un decorador cerca de mí.", costear: "Quiero conocer el precio de los materiales.", comprar: "Quiero saber dónde puedo comprar los materiales.", aprender: "Quiero aprender a hacerla paso a paso." };
    void enviar(mensajesOpcion[opcion]);
  }

  function elegirUso(valor: "negocio" | "personal"): void { setUso(valor); setPreguntaUso(false); void enviar(`Es para ${valor === "negocio" ? "mi negocio" : "uso personal"}.`, { uso: valor }); }

  return <main className="app-shell">
    <CabeceraApp contexto={contexto} modoVista={modo} onModoVista={cambiar} onLimpiar={vaciar} limpiarDeshabilitado={!mensajes.length} totalSeleccion={0} />
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Asistente guiado">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6">
        {!mensajes.length && <div className="mb-6"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Cuéntame qué quieres hacer</h1><p className="mt-2 max-w-2xl text-texto-secundario">Encontramos una decoración que encaje con tu celebración y te acompañamos con ideas, materiales y pasos.</p></div>}
        <div className="flex flex-col gap-5" aria-live="polite">
          {mensajes.map((mensaje) => <article key={mensaje.id} className={`max-w-[min(100%,46rem)] ${mensaje.role === "user" ? "ml-auto rounded-2xl bg-superficie px-4 py-3" : "mr-auto w-full py-1"}`}><Markdown>{mensaje.content || (cargando ? "Estoy pensando…" : "")}</Markdown></article>)}
        </div>
        {decoraciones.length > 0 && <CarruselDecoraciones decoraciones={decoraciones} onElegir={elegirDecoracion} />}
        {!mensajes.length && <CarruselDecoraciones decoraciones={galeriaInicial} onElegir={elegirDecoracion} />}
        {seleccionada && opciones && <><p className="mt-5 text-sm font-medium">¿Qué te gustaría hacer ahora?</p><ChipsOpciones onElegir={elegirOpcion} /></>}
        {seleccionada && <section className="mt-4 rounded-2xl bg-superficie p-4" aria-label="Referencias y materiales"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Referencias y materiales</h2>{seleccionada.origen === "ejemplo" && <span className="rounded-full bg-[#f6e7d9] px-2.5 py-1 text-xs font-semibold text-[#6d3c39]">Ejemplo</span>}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{seleccionada.piezas.map((pieza, indice) => <li key={`${pieza.estructura}-${indice}`}>{pieza.cantidad} × {pieza.estructura.replaceAll("_", " ")}</li>)}{seleccionada.materiales.map((material) => <li key={material.variantId}>{material.cantidad} unidades · {material.nota ?? `Variante ${material.variantId}`}</li>)}</ul>{seleccionada.origen === "ejemplo" && <p className="mt-2 text-xs text-texto-secundario">Temática, edad, cantidades y pasos son de ejemplo. Las variantes y los precios se consultan en el catálogo actual.</p>}</section>}
        {preguntaUso && <PreguntaUso onElegir={elegirUso} />}
        {seleccionada && pasos && <PasoAPaso decoracion={seleccionada} alTerminar={() => { setPasos(false); setOpciones(true); }} />}
        {seleccionada && uso && <CostosMateriales cotizacion={cotizacionCorrespondeASeleccion(cotizacionDecoracionId, seleccionada.id) ? cotizacion : null} uso={uso} clave={`guiado-${seleccionada.id}`} mensajePendiente={seleccionada.origen === "ejemplo" ? "La temática, cantidades y pasos son de ejemplo. Las variantes y sus precios se consultan en el catálogo actual." : "La cotización de estos materiales aún no está disponible."} onProveedores={() => void enviar("Busca proveedores cerca de mí para cotizar los materiales.")} />}
        {proveedores.length > 0 && <section className="mt-4" aria-label="Proveedores"><h2 className="font-semibold">Proveedores</h2><div className="mt-2 flex flex-wrap gap-3">{proveedores.map((proveedor) => <a key={proveedor.id} href={proveedor.url} target="_blank" rel="noreferrer" className="rounded-xl bg-superficie p-4"><span className="block font-medium">{proveedor.nombre}</span><span className="text-sm text-texto-secundario">{proveedor.zona.ciudad}{proveedor.origen === "ejemplo" ? " · Ejemplo" : ""}</span></a>)}</div></section>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{error} <button type="button" className="ml-2 font-semibold underline" onClick={() => void enviar([...mensajes].reverse().find((mensaje) => mensaje.role === "user")?.content ?? "Continúa", { reintentar: true })}>Reintentar</button></p>}
      </div>
      <form className="sticky bottom-0 mx-auto w-full max-w-4xl bg-fondo px-4 pb-4 pt-2 sm:px-6" onSubmit={(event) => { event.preventDefault(); void enviar(entrada); }}>
        <div className="flex items-center gap-2 rounded-2xl border border-borde-suave bg-superficie p-2 shadow-sm focus-within:ring-2 focus-within:ring-acento/30">
          <input ref={entradaRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => setFoto(event.target.files?.[0] ?? null)} />
          <button type="button" aria-label="Adjuntar foto de inspiración" title="Adjuntar foto de inspiración" className="rounded-xl p-2 text-texto-secundario hover:bg-fondo" onClick={() => entradaRef.current?.click()}><ImagePlus className="size-5" /></button>
          {foto && <span className="flex max-w-40 items-center gap-1 rounded-lg bg-fondo px-2 py-1 text-xs"><span className="truncate">{foto.name}</span><button type="button" aria-label="Quitar foto" onClick={() => setFoto(null)}><X className="size-3.5" /></button></span>}
          <input aria-label="Escribe tu mensaje" value={entrada} maxLength={6000} onChange={(event) => setEntrada(event.target.value)} placeholder="Escribe tu mensaje…" className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-texto-secundario" disabled={cargando} />
          <button type="submit" aria-label="Enviar mensaje" disabled={cargando || !entrada.trim()} className="grid size-10 place-items-center rounded-xl bg-acento text-white disabled:opacity-40">{cargando ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}</button>
        </div>
        {error && <p className="mt-2 text-center text-xs text-texto-secundario">No se pudo enviar. Revisa la conexión y vuelve a intentar.</p>}
      </form>
    </section>
  </main>;
}

async function leerFoto(archivo: File): Promise<{ mime: string; base64: string }> {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(archivo.type) || archivo.size > 6_000_000) throw new Error("La foto debe ser JPG, PNG o WebP y pesar menos de 6 MB.");
  const datos = await archivo.arrayBuffer();
  const bytes = new Uint8Array(datos);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return { mime: archivo.type, base64: btoa(binario) };
}
