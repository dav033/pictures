"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, Sparkles, X, CircleDot } from "lucide-react";
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
import { CotizacionGuiadaSchema, CotizacionPlanGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { prepararHistorialGuiado, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { ReferenciaInspiracion } from "./ReferenciaInspiracion";
import { ESTRUCTURAS_OFICIALES } from "@/lib/plan/estructuras-oficiales";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { WidgetGuiadoSchema, type WidgetGuiado } from "@/lib/ia/guiado/widgets";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { GraficaMotorGuiada } from "./GraficaMotorGuiada";
import { BarraTamanos, tramosPorTamano } from "@/components/plan/BarraTamanos";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";

/**
 * Lo que el asistente muestra además de su texto. Cada pieza va PEGADA al mensaje que la trajo, en el orden de la
 * conversación (antes todas se apilaban al final y no se sabía a qué respondían). Solo las del último mensaje del
 * asistente están activas; las anteriores quedan como historia (la idea elegida, el precio que salió…).
 */
type Widget = WidgetGuiado;
const ReferenciaSchema = z.object({ blueprint: ReferenceBlueprintV2Schema, frase: z.string(), aspecto: z.number().positive().optional(), piezas: z.array(z.object({ x: z.number(), y: z.number(), ancho: z.number(), alto: z.number() }).strict()), colores: z.array(z.object({ nombre: z.string(), hex: z.string() }).strict()) }).strict();
const MensajeSchema = z.object({ id: z.string(), role: z.enum(["user", "assistant"]), content: z.string(), widgets: z.array(WidgetGuiadoSchema).optional(), miniatura: z.string().regex(/^data:image\/jpeg;base64,/).max(80_000).optional(), referencia: ReferenciaSchema.optional(), notaFoto: z.string().optional() }).strict();
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
  propuesta: PropuestaComposicionSchema.optional(),
}).passthrough();

function nuevoId(): string { return crypto.randomUUID(); }

/**
 * La conversación la abre el asistente (pruebas del 5-oct: «el cliente se encuentra perdido» si nadie le pregunta
 * nada). El saludo es fijo, sale al instante y no viaja en el historial: el prompt guiado sabe que ya se hizo.
 */
const SALUDO = "¡Hola! Te hago unas preguntas cortas y te muestro decoraciones Sempertex que encajen con tu celebración.\n\n**¿Qué vas a celebrar?**";
const OPCIONES_SALUDO = ["Cumpleaños", "Baby shower", "Boda", "XV años", "Bautizo o comunión", "Otra celebración"] as const;

/** Widgets que ya hacen la pregunta: con ellos, los botones «Opciones:» del texto sobran (salían duplicados). */
const WIDGETS_QUE_PREGUNTAN = new Set<Widget["tipo"]>(["decoraciones", "opciones", "uso", "propuesta", "plan", "pregunta-propuesta"]);

export function VistaGuiada() {
  const { modo, cambiar } = useModoVista();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [brief, setBrief] = useState<BriefGuiado>({});
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionada, setSeleccionada] = useState<DecoracionSempertex | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [imagenCargando, setImagenCargando] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoReferencia, setFotoReferencia] = useState<{ base64: string; mime: string } | null>(null);
  // Hasta hidratar, un clic o una tecla se pierden sin aviso (pasaba en la demo con el servidor recién arrancado): se muestran
  // desactivados y se activan solos al quedar lista la página.
  const hidratado = useSyncExternalStore(suscribirNada, () => true, () => false);
  const entradaRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const turnoRef = useRef(0);
  const mensajesRef = useRef(mensajes);
  const aceptarPropuestaRef = useRef<((propuesta: z.infer<typeof PropuestaComposicionSchema>) => Promise<void>) | null>(null);

  useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);
  const fotosDePlanesRef = useRef(new Map<string, { base64: string; mime: string }>());

  const indiceActivo = useMemo(() => {
    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) if (mensajes[indice]!.role === "assistant") return indice;
    return -1;
  }, [mensajes]);
  const ultimo = mensajes.at(-1);
  const respuestasRapidas = useMemo(() => {
    if (cargando) return [];
    if (!mensajes.length) return [...OPCIONES_SALUDO];
    if (ultimo?.role !== "assistant" || ultimo.widgets?.some((widget) => WIDGETS_QUE_PREGUNTAN.has(widget.tipo))) return [];
    return [...separarOpciones(ultimo.content).opciones, "Propónme algo"];
  }, [mensajes.length, ultimo, cargando]);
  const hayEjemplos = useMemo(() => mensajes.some((mensaje) => mensaje.widgets?.some((widget) => (widget.tipo === "decoraciones" && widget.decoraciones.some((decoracion) => decoracion.origen === "ejemplo")) || ("decoracion" in widget && widget.decoracion.origen === "ejemplo"))), [mensajes]);
  const contexto = seleccionada ? `${seleccionada.titulo}${uso ? ` · ${uso === "negocio" ? "Para negocio" : "Uso personal"}` : ""}` : brief.tematica ? [brief.evento, brief.edad ? `${brief.edad} años` : null, /^por[ _-]?definir$/i.test(brief.tematica.trim()) ? null : brief.tematica].filter(Boolean).map((parte) => conMayuscula(String(parte))).join(" · ") : null;

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
    setMensajes([]); setBrief({}); setSeleccionada(null); setUso(null); setFoto(null); setFotoReferencia(null); fotosDePlanesRef.current.clear(); setCargando(false); setError(null);
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (cause) { console.warn("[asistente-guiado] no se pudo limpiar la sesión.", cause); }
  }, []);

  const enviar = useCallback(async (texto: string, opcionesEnvio?: { uso?: Uso; reintentar?: boolean }) => {
    const limpio = texto.trim();
    if (!limpio || cargando) return;
    if (/^(?:oye,?\s*)?(?:prop[oó]nme algo|qu[eé] me recomiendas armar\??|arma t[uú] algo\.?)[.!?]*$/i.test(limpio)) {
      const visibles = [...mensajes, { id: nuevoId(), role: "user" as const, content: limpio }, { id: nuevoId(), role: "assistant" as const, content: "¿Quieres una decoración completa (varias piezas) o una pieza individual?", widgets: [{ tipo: "pregunta-propuesta" as const, alcance: "tipo" as const }] }];
      setMensajes(visibles); setEntrada(""); setError(null);
      return;
    }
    const contenido = limpio.slice(0, 6000);
    const turno = ++turnoRef.current;
    const historial = prepararHistorialGuiado(mensajes, `${contenido}${foto ? "\nAdjunté una foto de inspiración." : ""}`, opcionesEnvio?.reintentar);
    const mensajesVisibles = (opcionesEnvio?.reintentar ? sinUltimoTurnoGuiado(mensajes) : mensajes).filter((mensaje) => mensaje.content.trim().length > 0 || mensaje.widgets?.length);
    const usoEnvio = opcionesEnvio?.uso ?? uso;
    const elegida = seleccionada;
    const idUsuario = nuevoId();
    setMensajes([...mensajesVisibles, { id: idUsuario, role: "user", content: contenido }, { id: nuevoId(), role: "assistant", content: "" }]);
    setEntrada(""); setError(null); setCargando(true);
    // El cliente ve en su mensaje la foto que mandó (miniatura pequeña: la conversación vive en sessionStorage).
    if (foto) void miniaturaDe(foto).then((miniatura) => setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === idUsuario ? { ...mensaje, miniatura } : mensaje)))
      .catch((cause: unknown) => console.warn("[asistente-guiado] no se pudo crear la miniatura de la foto.", cause));
    try {
      const imagen = foto ? await leerFoto(foto) : null;
      if (imagen) setFotoReferencia(imagen);
      const analisisFoto = imagen ? fetch("/api/references/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [imagen] }) })
        .then(async (respuesta) => {
          if (!respuesta.ok) throw new Error("No se pudo analizar la foto.");
          const analisis: unknown = await respuesta.json();
          const referencia = adaptarAnalisisReferencia(analisis);
          if (!referencia) throw new Error("No se encontraron piezas en la foto.");
          setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === idUsuario ? { ...mensaje, referencia } : mensaje));
          return referencia;
        })
        .catch((cause: unknown) => {
          console.warn("[asistente-guiado] no se pudo leer la foto de inspiración.", cause);
          setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === idUsuario ? { ...mensaje, notaFoto: "No pude distinguir bien los detalles, pero podemos seguir con tu idea." } : mensaje));
          return null;
        }) : null;
      // Da oportunidad breve al análisis para orientar búsqueda; chat no espera análisis completo.
      const referenciaRapida = analisisFoto ? await Promise.race([
        analisisFoto,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]) : null;
      const historialConLectura = referenciaRapida
        ? historial.map((mensaje, indice) => indice === historial.length - 1 ? { ...mensaje, content: `${mensaje.content.slice(0, 5400)}\n\nLectura de la foto: ${referenciaRapida.frase}`.slice(0, 6000) } : mensaje)
        : historial;
      const response = await fetch("/api/asistente-guiado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema_version: "asistente-guiado.v1", messages: historialConLectura, brief, estadoGuiado: { ...(elegida ? { decoracionId: elegida.id } : {}), ...(usoEnvio ? { uso: usoEnvio } : {}), ...( /prop[oó]n|arma t[uú]|cambia|sin guirnalda|m[aá]s rosa|solo un arco|decoraci[oó]n completa|pieza individual/i.test(contenido) ? { propuesta: true } : {}) }, ...(imagen ? { fotoInspiracion: imagen } : {}) }) });
      if (!response.ok || !response.body) throw new Error(`El asistente respondió con estado ${response.status}.`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textoFinal = "";
      let propuestaParaPlan: z.infer<typeof PropuestaComposicionSchema> | null = null;
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
            // Toda propuesta se convierte en plan en el acto (pedido del dueño: «cuando seleccione, me manda el plan»), venga del botón,
            // de un «Decoración completa» escrito o de un «cambia…».
            const resolverAhora = Boolean(datos.propuesta);
            if (datos.propuesta && !resolverAhora) widgets.push({ tipo: "propuesta", propuesta: datos.propuesta });
            if (resolverAhora) propuestaParaPlan = datos.propuesta!;
            reemplazarUltimo({ content: resolverAhora ? "Estoy preparando tu plan…" : textoFinal, ...(widgets.length ? { widgets } : {}) });
            if (!resolverAhora && !textoFinal.trim() && !widgets.length) setMensajes((actuales) => actuales.slice(0, -1));
          }
        }
      }
      if (propuestaParaPlan && turno === turnoRef.current) await aceptarPropuestaRef.current?.(propuestaParaPlan);
      if (turno === turnoRef.current) setFoto(null);
    } catch (cause) {
      if (turno !== turnoRef.current) return;
      // Al cliente, un mensaje amable; la causa real queda en la consola para diagnosticar.
      console.error("[asistente-guiado] turno fallido", cause);
      setError(cause instanceof Error ? cause.message : "No se pudo enviar el mensaje.");
      setMensajes((actuales) => actuales.filter((item) => item.content !== "" || item.widgets?.length));
    } finally { if (turno === turnoRef.current) setCargando(false); }
  }, [brief, cargando, mensajes, seleccionada, foto, uso]);

  const aceptarPropuesta = useCallback(async (propuesta: z.infer<typeof PropuestaComposicionSchema>) => {
    if (cargando) return;
    const piezas = propuesta.piezas.map((pieza) => `${pieza.cantidad} ${pieza.nombre ?? pieza.estructura}`).join(", ");
    const instruccion = `Resuelve ahora, sin pedir aceptación, el plan exacto de esta composición con Python: ${piezas}. Paleta Sempertex: ${propuesta.colores.join(", ")}. Contexto: ${brief.evento ?? "celebración"}${brief.edad ? `, ${brief.edad} años` : ""}, ${brief.tematica ?? "sin temática definida"}.`;
    const actuales = mensajesRef.current.filter((mensaje) => mensaje.content.trim() || mensaje.widgets?.length);
    const historial = prepararHistorialGuiado(actuales, instruccion);
    const visibles = [...actuales, { id: nuevoId(), role: "assistant" as const, content: "Estoy preparando tu plan…" }];
    setMensajes(visibles); setCargando(true); setError(null);
    const turno = ++turnoRef.current;
    try {
      const respuesta = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema_version: "chat.v1", messages: historial.slice(-16), brief: { tipo_evento: brief.evento, colores: propuesta.colores, estilo: brief.tematica } }) });
      if (!respuesta.ok || !respuesta.body) throw new Error("No pude preparar el plan. Inténtalo otra vez.");
      const reader = respuesta.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let plan: unknown; let cotizacion: unknown;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const paquetes = buffer.split("\n\n"); buffer = paquetes.pop() ?? "";
        for (const paquete of paquetes) {
          const linea = paquete.split("\n").find((item) => item.startsWith("data: ")); if (!linea) continue;
          const evento = ChatSseEventV1Schema.parse(JSON.parse(linea.slice(6)) as unknown);
          if (evento.type === "error") throw new Error(evento.error);
          if (evento.type === "fin") { plan = evento.plan; cotizacion = evento.cotizacion; }
        }
      }
      if (turno !== turnoRef.current) return;
      const validado = PlanGuiadoSchema.safeParse(plan);
      if (!validado.success) throw new Error("El plan no llegó completo. Podemos intentarlo de nuevo.");
      const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacion);
      const armado = generarPasosPlan(validado.data);
      setMensajes((actuales) => [...actuales.slice(0, -1), { id: nuevoId(), role: "assistant", content: "Listo. Este es tu plan; puedes costear, comprar, aprender a hacerlo o ver cómo quedaría.", widgets: [{ tipo: "plan", plan: validado.data, pasos: armado.pasos, ...(precio.success ? { cotizacion: precio.data } : {}) }] }]);
    } catch (cause) {
      console.error("[asistente-guiado] no se pudo preparar el plan", cause);
      setError(cause instanceof Error ? cause.message : "No pude preparar el plan.");
      setMensajes((actuales) => actuales.slice(0, -1));
    } finally { if (turno === turnoRef.current) setCargando(false); }
  }, [brief, cargando]);
  useEffect(() => { aceptarPropuestaRef.current = aceptarPropuesta; }, [aceptarPropuesta]);

  const aceptarPlanFoto = useCallback(async (referencia: z.infer<typeof ReferenceBlueprintV2Schema>) => {
    if (cargando) return;
    const instruccion = "Sí, armémoslo. Prepara el plan para reproducir las piezas de globos aprobadas en la foto y sus colores. Usa la lectura de referencia para resolverlo con Python.";
    const historial = prepararHistorialGuiado(mensajes, instruccion);
    setMensajes((actuales) => [...actuales, { id: nuevoId(), role: "user", content: "Sí, armémoslo." }, { id: nuevoId(), role: "assistant", content: "Estoy preparando el plan de tu foto…" }]);
    setCargando(true); setError(null);
    const turno = ++turnoRef.current;
    try {
      const respuesta = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schema_version: "chat.v1", messages: historial.slice(-16), brief: { tipo_evento: brief.evento, estilo: brief.tematica }, ...(fotoReferencia ? { imagenesReferencia: [fotoReferencia] } : {}), referenceBlueprint: referencia }) });
      if (!respuesta.ok || !respuesta.body) throw new Error("No pude resolver el plan de la foto. Inténtalo otra vez.");
      const reader = respuesta.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let plan: unknown; let cotizacion: unknown;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const paquetes = buffer.split("\n\n"); buffer = paquetes.pop() ?? "";
        for (const paquete of paquetes) {
          const linea = paquete.split("\n").find((item) => item.startsWith("data: ")); if (!linea) continue;
          const evento = ChatSseEventV1Schema.parse(JSON.parse(linea.slice(6)) as unknown);
          if (evento.type === "error") throw new Error(evento.error);
          if (evento.type === "fin") { plan = evento.plan; cotizacion = evento.cotizacion; }
        }
      }
      if (turno !== turnoRef.current) return;
      const validado = PlanGuiadoSchema.safeParse(plan);
      if (!validado.success) throw new Error("El plan de la foto no llegó completo. Podemos intentarlo de nuevo.");
      const armado = generarPasosPlan(validado.data);
      const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacion);
      if (fotoReferencia) fotosDePlanesRef.current.set(validado.data.plan_hash, fotoReferencia);
      setMensajes((actuales) => [...actuales.slice(0, -1), { id: nuevoId(), role: "assistant", content: "Listo. Aquí tienes el plan de las piezas de globos de tu foto.", widgets: [{ tipo: "plan", plan: validado.data, pasos: armado.pasos, fotoInspiracion: true, ...(precio.success ? { cotizacion: precio.data } : {}) }] }]);
    } catch (cause) {
      console.error("[asistente-guiado] no se pudo resolver el plan de la foto", cause);
      setError(cause instanceof Error ? cause.message : "No pude preparar el plan de la foto.");
      setMensajes((actuales) => actuales.slice(0, -1));
    } finally { if (turno === turnoRef.current) setCargando(false); }
  }, [brief, cargando, fotoReferencia, mensajes]);

  const verComoQuedaria = useCallback(async (plan: z.infer<typeof PlanGuiadoSchema>, mensajeId: string, usarFotoInspiracion = false) => {
    if (imagenCargando) return;
    setImagenCargando(true); setError(null);
    setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === mensajeId ? { ...mensaje, content: "Estoy dibujando tu decoración, tarda unos segundos…" } : mensaje));
    try {
      const imagenReferencia = usarFotoInspiracion ? fotosDePlanesRef.current.get(plan.plan_hash) : undefined;
      const respuesta = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, planHash: plan.plan_hash, brief: { tipo_evento: brief.evento, colores: plan.plan.concepto.paleta, estilo: brief.tematica }, solicitudUsuario: plan.plan.concepto.descripcion, ...(imagenReferencia ? { imagenesReferencia: [imagenReferencia] } : {}) }) });
      if (!respuesta.ok) throw new Error("No pude generar la imagen. Puedes reintentar.");
      const cuerpo: unknown = await respuesta.json();
      const salida = z.object({ imagen: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/), plan: PlanGuiadoSchema }).passthrough().parse(cuerpo);
      const guardado = await fetch("/api/guiada-imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagen: salida.imagen }) });
      if (!guardado.ok) throw new Error("La imagen se generó, pero no pude guardarla para tu sesión.");
      const referencia = z.object({ url: z.string().startsWith("/api/guiada-imagen/") }).strict().parse(await guardado.json());
      const url = new URL(referencia.url, window.location.origin).toString();
      setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === mensajeId ? { ...mensaje, content: "Imagen referencial generada con IA", widgets: (mensaje.widgets ?? []).map((widget) => widget.tipo === "plan" ? { ...widget, plan: salida.plan, imagen: url } : widget) } : mensaje));
    } catch (cause) {
      console.error("[asistente-guiado] error al generar imagen", cause);
      setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === mensajeId ? { ...mensaje, content: "No pude dibujarla esta vez. Tu plan sigue guardado.", widgets: (mensaje.widgets ?? []).map((widget) => widget.tipo === "plan" ? { ...widget, errorImagen: true } : widget) } : mensaje));
      setError("No pude dibujarla esta vez. Tu plan sigue guardado; puedes reintentar.");
    } finally { setImagenCargando(false); }
  }, [brief, imagenCargando]);

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
      aprender: seleccionada ? `Quiero aprender a hacerlo: armar «${seleccionada.titulo}» paso a paso.` : "Quiero aprender a hacerlo paso a paso.",
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

  function renderWidget(widget: Widget, activo: boolean, clave: string, mensajeId: string) {
    switch (widget.tipo) {
      case "decoraciones":
        return <CarruselDecoraciones key={clave} decoraciones={widget.decoraciones} activo={activo && !cargando} elegidaId={seleccionada?.id ?? null} onElegir={elegirDecoracion} onNinguna={() => void enviar("Ninguna me convence. Propónme algo distinto o puedo mostrarte una foto de inspiración.")} />;
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
      case "pasos-plan":
        return <section key={clave} className="mt-4 rounded-2xl border border-borde-suave bg-superficie p-4 shadow-sm" aria-label="Guía aproximada para aprender a hacerlo"><h3 className="font-semibold">Guía aproximada</h3><p className="mt-1 text-xs text-texto-secundario">Pasos orientativos combinados con las cantidades de tu plan.</p><div className="mt-4 space-y-4">{widget.guias.map((item) => <article key={item.estructura_id} className="rounded-xl border border-borde-suave p-3"><h4 className="font-semibold">{item.nombre}{item.medidas.ancho_m && item.medidas.alto_m ? ` · ${item.medidas.ancho_m} × ${item.medidas.alto_m} m` : item.medidas.largo_m ? ` · ${item.medidas.largo_m} m` : ""}</h4><p className="mt-2 text-xs text-texto-secundario">Materiales del plan: {item.globos.map((globo) => `${globo.cantidad} ${globo.color}, ${globo.tamano}`).join(" · ") || "sin globos contados"}</p><p className="mt-2 text-xs">{item.guia.dificultad} · {item.guia.tiempo_aprox}</p><p className="mt-3 text-sm font-medium">Herramientas y materiales base</p><ul className="ml-5 mt-1 list-disc space-y-1 text-sm">{[...item.guia.herramientas, ...item.guia.materiales_base].map((texto, i) => <li key={i}>{texto}</li>)}</ul><ol className="mt-3 space-y-3">{item.guia.pasos.map((paso, i) => <li key={i} className="text-sm"><strong>{i + 1}. {paso.titulo}.</strong> {paso.detalle}</li>)}</ol><details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Reglas aproximadas y consejos</summary><ul className="ml-5 mt-2 list-disc space-y-1">{[...item.guia.reglas_aproximadas, ...item.guia.consejos].map((texto, i) => <li key={i}>{texto}</li>)}</ul></details><details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Fuentes</summary><ul className="ml-5 mt-2 list-disc">{item.guia.fuentes.map((fuente) => <li key={fuente.url}><a className="text-acento underline" href={fuente.url} target="_blank" rel="noreferrer">{fuente.titulo}</a></li>)}</ul></details></article>)}</div><ol className="mt-4 space-y-3">{widget.pasos.map((paso) => <li key={paso.orden} className="flex gap-3 text-sm leading-6"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-acento text-xs font-bold text-white">{paso.orden}</span><span className="pt-0.5">{paso.texto}{paso.globos && <span className="mt-1 block text-xs text-texto-secundario">Globos: {paso.globos}</span>}</span></li>)}</ol></section>;
      case "pregunta-propuesta":
        return <div key={clave} className="mt-3 flex flex-wrap gap-2">{widget.alcance === "tipo" ? <><button type="button" className="rounded-xl border border-borde-suave px-3 py-2 text-sm" onClick={() => void enviar("Propónme algo para una decoración completa con varias piezas.")}>Decoración completa</button><button type="button" className="rounded-xl border border-borde-suave px-3 py-2 text-sm" onClick={() => setMensajes((actuales) => [...actuales, { id: nuevoId(), role: "assistant", content: "¿Qué pieza individual prefieres?", widgets: [{ tipo: "pregunta-propuesta", alcance: "pieza" }] }])}>Pieza individual</button></> : <>{["Arco orgánico", "Columna", "Guirnalda", "Semiarco", "Pared de globos", "Bouquet", "La que tú quieras"].map((pieza) => <button key={pieza} type="button" className="rounded-xl border border-borde-suave px-3 py-2 text-sm" onClick={() => void enviar(`Propónme una pieza individual: ${pieza}.`)}>{pieza}</button>)}</>}</div>;
      case "proveedores":
        return <TarjetasProveedores key={clave} proveedores={widget.proveedores} activo={activo && !cargando} onSolicitar={solicitarProveedor} />;
      case "comprar":
        return <ComprarMateriales key={clave} decoracion={widget.decoracion} onDistribuidor={() => void enviar("Busca un distribuidor de globos Sempertex cerca de mí.")} />;
      case "propuesta":
        return <article key={clave} className="mt-3 rounded-2xl border border-borde-suave bg-superficie p-4 shadow-sm">
          <h3 className="font-semibold">Una idea para tu celebración</h3>
          <p className="mt-2 text-sm text-texto-secundario">{widget.propuesta.frase}</p>
          <ul className="mt-3 space-y-2">{widget.propuesta.piezas.map((pieza, indice) => <li key={`${pieza.estructura}-${indice}`} className="flex items-center gap-2 text-sm"><CircleDot className="size-4 text-acento" aria-hidden />{pieza.cantidad > 1 ? `${pieza.cantidad} ` : ""}{pieza.nombre ?? ESTRUCTURAS_OFICIALES[pieza.estructura].nombre}</li>)}</ul>
          <div className="mt-3 flex items-center gap-2" aria-label={`Colores: ${widget.propuesta.colores.join(", ")}`}>{widget.propuesta.colores.map((color) => <span key={color} title={color} className="size-5 rounded-full border border-borde-suave" style={{ backgroundColor: HEX_COLORES_V2[color] }} />)}<span className="text-xs text-texto-secundario">{widget.propuesta.colores.join(", ")}</span></div>
          {activo && cargando && <p className="mt-3 text-xs text-texto-secundario">Estoy convirtiendo esta idea en un plan con cantidades.</p>}
        </article>;
      case "plan": {
        const piezas = widget.plan.plan.estructuras;
        const desglose = generarPasosPlan(widget.plan);
        const pasos = widget.pasos ?? desglose.pasos;
        const cantidadPiezas = piezas.reduce((suma, pieza) => suma + pieza.repeticiones, 0);
        const colores = [...new Set(desglose.globos.map((globo) => globo.color))];
        return <article key={clave} className="mt-3 rounded-2xl border border-borde-suave bg-superficie p-4 shadow-sm"><h3 className="font-semibold">Tu plan</h3>
          <p className="mt-2 text-sm">{cantidadPiezas} {cantidadPiezas === 1 ? "pieza" : "piezas"}: {piezas.map((pieza) => `${pieza.repeticiones > 1 ? `${pieza.repeticiones} ` : ""}${pieza.nombre}`).join(", ")}</p>
          <ul className="mt-3 space-y-3">{piezas.map((pieza) => { const grafica = desglose.guias.find((item) => item.estructura_id === pieza.estructura_id); const idOficial = ESTRUCTURAS_OFICIALES_IDS.includes((pieza.estructura_oficial ?? "") as typeof ESTRUCTURAS_OFICIALES_IDS[number]) ? pieza.estructura_oficial as typeof ESTRUCTURAS_OFICIALES_IDS[number] : null; const tamanos = tramosPorTamano(grafica?.globos.flatMap((globo) => { const pulgadas = Number.parseFloat(globo.tamano); return Number.isFinite(pulgadas) ? [{ pulgadas, unidades: globo.cantidad }] : []; }) ?? []); const mezclaReal = widget.plan.estructuras.find((resuelta) => resuelta.estructura_id === pieza.estructura_id)?.mezcla_real; return <li key={pieza.estructura_id} className="flex min-w-0 gap-3 rounded-xl bg-fondo p-3"><span className="grid size-12 shrink-0 place-items-center rounded-lg bg-acento-suave text-acento"><GraficaMotorGuiada plan={widget.plan.plan} pieza={pieza} mezclaReal={mezclaReal} id={idOficial ?? "arco"} nombre={pieza.nombre} /></span><div className="min-w-0 flex-1"><span className="font-medium">{pieza.nombre}</span><p className="text-xs text-texto-secundario">{pieza.medidas.ancho_m && pieza.medidas.alto_m ? `${pieza.medidas.ancho_m} m de ancho por ${pieza.medidas.alto_m} m de alto` : pieza.medidas.largo_m ? `${pieza.medidas.largo_m} m de largo` : "Medida según el plan"}</p>{tamanos.length > 0 && <BarraTamanos tramos={tamanos} className="mt-2" />}{grafica && <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">{grafica.globos.map((globo) => <li key={`${globo.color}-${globo.tamano}`} className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full border border-borde-suave" style={{ backgroundColor: HEX_COLORES_V2[globo.color as keyof typeof HEX_COLORES_V2] ?? "#999" }} />{globo.color}: {globo.cantidad}</li>)}</ul>}</div></li>; })}</ul>
          <p className="mt-3 text-sm font-medium">${desglose.total} globos en total</p>
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Ver detalle</summary><ul className="mt-2 space-y-1 text-texto-secundario">{desglose.globos.map((globo) => <li key={`${globo.color}-${globo.tamano}`}>{globo.cantidad} globos {globo.color} de {globo.tamano}</li>)}</ul><div className="mt-3 space-y-2">{desglose.guias.map((item) => <details key={item.estructura_id}><summary className="cursor-pointer">Tallas y guía técnica: {item.nombre}</summary><p className="mt-1 text-xs text-texto-secundario">{item.globos.map((globo) => `${globo.cantidad} ${globo.color} de ${globo.tamano}`).join(" · ")}</p><ul className="ml-5 mt-1 list-disc text-xs text-texto-secundario">{item.guia.reglas_aproximadas.map((regla, i) => <li key={i}>{regla}</li>)}</ul></details>)}</div></details>
          {widget.imagen && <div className="mt-4"><img src={widget.imagen} alt="Imagen referencial generada con IA" className="w-full rounded-xl"/><p className="mt-2 text-xs text-texto-secundario">Imagen referencial generada con IA</p></div>}
          {activo && <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={imagenCargando} onClick={() => void verComoQuedaria(widget.plan, mensajeId, widget.fotoInspiracion)} className="rounded-xl bg-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{imagenCargando ? "Dibujando…" : widget.errorImagen ? "Reintentar imagen" : "Ver cómo quedaría"}</button>{widget.cotizacion && <><button type="button" onClick={() => setUso("personal")} className="rounded-xl border border-borde-suave px-3 py-2 text-sm">Costear personal</button><button type="button" onClick={() => setUso("negocio")} className="rounded-xl border border-borde-suave px-3 py-2 text-sm">Costear negocio</button></>}<button type="button" onClick={() => setMensajes((actuales) => actuales.map((mensaje) => mensaje.id === mensajeId ? { ...mensaje, widgets: (mensaje.widgets ?? []).map((item) => item.tipo === "plan" ? { ...item, compraAbierta: true } : item) } : mensaje))} className="rounded-xl border border-borde-suave px-3 py-2 text-sm">Comprar</button><button type="button" onClick={() => setMensajes((actuales) => [...actuales, { id: nuevoId(), role: "assistant", content: "Aquí tienes una guía aproximada para armar tu plan.", widgets: [{ tipo: "pasos-plan", pasos, guias: desglose.guias }] }])} className="rounded-xl border border-borde-suave px-3 py-2 text-sm">Aprender a hacerlo</button><button type="button" onClick={() => void enviar(`Quiero contratar un decorador para ${piezas.map((pieza) => pieza.nombre).join(", ")} en ${brief.evento ?? "mi celebración"}.`)} className="rounded-xl border border-borde-suave px-3 py-2 text-sm">Contratar decorador</button></div>}
          {widget.compraAbierta && widget.cotizacion && <ComprarMateriales decoracion={decoracionDePlan(widget.plan, widget.cotizacion, brief)} onDistribuidor={() => void enviar(`Busca un distribuidor de Sempertex cerca de mí para ${colores.join(", ")}.`)} />}
          {activo && <button type="button" className="mt-2 rounded-xl border border-borde-suave px-3 py-2 text-sm" onClick={() => { setEntrada("Quiero cambiar algo: "); document.querySelector<HTMLInputElement>('input[aria-label="Escribe tu mensaje"]')?.focus(); }}>Cambiar algo por chat</button>}
          {widget.cotizacion && uso && <CostosMateriales cotizacion={widget.cotizacion} uso={uso} clave={`plan-${widget.plan.plan_hash}`} onProveedores={() => void enviar("Busca un proveedor cerca de mí para cotizar estos materiales.")} mensajePendiente="Todavía no tengo el precio de estos materiales." />}
        </article>;
      }
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
              ? <div key={mensaje.id} className="ml-auto flex max-w-[min(85%,36rem)] flex-col items-end gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local en data URL */}
                  {mensaje.miniatura && !mensaje.referencia && <img src={mensaje.miniatura} alt="Foto de inspiración enviada" className="h-28 w-auto rounded-2xl border border-borde-suave object-cover shadow-sm" />}
                  <div className="rounded-2xl rounded-br-md bg-acento px-4 py-2.5 text-sm text-white shadow-sm">{mensaje.content}</div>
                  {mensaje.miniatura && mensaje.referencia && <ReferenciaInspiracion miniatura={mensaje.miniatura} referencia={mensaje.referencia} onArmar={() => void aceptarPlanFoto(mensaje.referencia!.blueprint)} deshabilitado={cargando} />}
                  {mensaje.notaFoto && <p role="status" className="max-w-64 text-xs text-texto-secundario">{mensaje.notaFoto}</p>}
                </div>
              : <BurbujaAsistente key={mensaje.id}>
                  {mensaje.content.trim()
                    ? <Markdown>{separarOpciones(mensaje.content).texto}</Markdown>
                    : !mensaje.widgets?.length && cargando && indice === mensajes.length - 1 ? <Escribiendo /> : null}
                  {mensaje.widgets?.map((widget, posicion) => renderWidget(widget, indice === indiceActivo, `${mensaje.id}-${posicion}`, mensaje.id))}
                </BurbujaAsistente>)}
            {respuestasRapidas.length > 0 && <div className="pl-11"><RespuestasRapidas opciones={respuestasRapidas} deshabilitado={cargando || !hidratado} onElegir={(texto) => void enviar(texto)} /></div>}
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
          <input aria-label="Escribe tu mensaje" value={entrada} maxLength={6000} onChange={(event) => setEntrada(event.target.value)} placeholder={mensajes.length ? "Escribe tu respuesta…" : "O cuéntame con tus palabras qué quieres celebrar…"} className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-texto-secundario" disabled={cargando || !hidratado} />
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

function decoracionDePlan(
  plan: z.infer<typeof PlanGuiadoSchema>,
  cotizacion: z.infer<typeof CotizacionPlanGuiadoSchema>,
  brief: BriefGuiado,
): DecoracionSempertex {
  return DecoracionSempertexSchema.parse({
    id: `deco-plan-${plan.plan_hash.slice(0, 16)}`,
    origen: "sempertex_manual",
    titulo: plan.plan.concepto.titulo,
    tematica: brief.tematica ?? plan.plan.concepto.estilo ?? "Celebración",
    eventos: [brief.evento ?? "Celebración"],
    edad: brief.edad === undefined ? null : { min: brief.edad, max: brief.edad },
    fotos: [{ url: "/favicon.ico", fuente: "Catálogo de materiales", licencia: "ejemplo_sin_licencia" }],
    video: null,
    piezas: plan.plan.estructuras.flatMap((pieza) => pieza.estructura_oficial ? [{ estructura: pieza.estructura_oficial, cantidad: pieza.repeticiones }] : []),
    materiales: cotizacion.lineas.flatMap((linea) => linea.varianteId ? [{ variantId: linea.varianteId, sku: null, cantidad: linea.cantidadNecesaria, nota: linea.nombre ?? linea.tamano }] : []),
    pasos: [],
    shopifyHandle: null,
    fotoRepresentativa: false,
  });
}

async function miniaturaDe(archivo: File): Promise<string> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, 240 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala); lienzo.height = Math.round(imagen.height * escala);
  const contexto = lienzo.getContext("2d");
  if (!contexto) throw new Error("Sin contexto 2D para la miniatura.");
  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  return lienzo.toDataURL("image/jpeg", 0.7);
}

async function leerFoto(archivo: File): Promise<{ mime: string; base64: string }> {
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(archivo.type) || archivo.size > 6_000_000) throw new Error("La foto debe ser JPG, PNG o WebP y pesar menos de 6 MB.");
  const datos = await archivo.arrayBuffer();
  const bytes = new Uint8Array(datos);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return { mime: archivo.type, base64: btoa(binario) };
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

function suscribirNada(): () => void {
  return () => {};
}
