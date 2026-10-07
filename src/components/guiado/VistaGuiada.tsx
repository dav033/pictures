"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Baby, Cake, Church, Crown, Heart, ImagePlus, Sparkles } from "lucide-react";
import { z } from "zod";
import { CabeceraApp } from "@/components/ui/shell/CabeceraApp";
import { Markdown } from "@/components/Markdown";
import { CarruselDecoraciones } from "./CarruselDecoraciones";
import { ComprarMateriales } from "./ComprarMateriales";
import { ChipsOpciones, OPCIONES_GUIADAS, type OpcionGuiada } from "./ChipsOpciones";
import { CostosMateriales } from "./CostosMateriales";
import { PasoAPaso } from "./PasoAPaso";
import { PreguntaUso } from "./PreguntaUso";
import { RespuestasRapidas, dedupeOpciones, separarOpciones } from "./RespuestasRapidas";
import { TarjetaEleccion } from "./TarjetaEleccion";
import { TarjetasProveedores } from "./TarjetasProveedores";
import { ReferenciaInspiracion } from "./ReferenciaInspiracion";
import { TarjetaPlan, type AccionPlan, type EstadoImagen } from "./TarjetaPlan";
import { contenidoPlanAjustado } from "./ajuste/ajuste-plan-guiado";
import type { AjustePublicado } from "./ajuste/usarAjustePlanGuiado";
import { TarjetaPropuesta } from "./TarjetaPropuesta";
import { TarjetaError } from "./TarjetaError";
import { PreguntaPropuesta } from "./PreguntaPropuesta";
import { GuiaPlan } from "./GuiaPlan";
import { BarraPlanVigente } from "./BarraPlanVigente";
import { Compositor } from "./Compositor";
import { BurbujaAsistente, BurbujaUsuario } from "./Burbujas";
import { IndicadorEscribiendo } from "./IndicadorEscribiendo";
import type { EtapaPlan } from "./Esqueletos";
import { EsqueletoPlan } from "./Esqueletos";
import { claveTexto, conMayuscula, nombreLineaCliente } from "./formato";
import { BotonIrAlFinal, useSeguirFinal } from "./animacion/useSeguirFinal";
import { DUR, EASE_SALIDA, entradaMensaje, entradaUsuario, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";
import { useModoVista } from "@/lib/estado/modo-vista";
import { DecoracionSempertexSchema, ProveedorSempertexSchema, type DecoracionSempertex, type ProveedorSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { CIUDADES_PROVEEDORES } from "@/lib/biblioteca-sempertex/ciudades";
import { ChatSseEventV1Schema } from "@/lib/ia/contracts/chat-v1";
import { CotizacionGuiadaSchema, CotizacionPlanGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema, type PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { prepararHistorialGuiado, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { WidgetGuiadoSchema, type WidgetGuiado } from "@/lib/ia/guiado/widgets";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { briefChatGuiado, defectoPlanGuiado, instruccionPlanFoto, instruccionPlanGuiado, planActualDesdePlan, resumenPlanGuiado } from "@/lib/ia/guiado/instruccion-plan";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { cuerpoGeneracion, fuentesDelPlan, resumenCuerpoGeneracion } from "@/lib/generacion/cuerpo-generacion";
import { MENSAJE_SOLO_REFERENCIAS } from "@/lib/estado/mensaje-foto-referencia";
import { CREATIVIDAD_POR_DEFECTO } from "@/lib/ia/escena/creatividad";
import { abrirConversacionGuiada, registrarAccionGuiada, registrarFalloGuiado, vaciarConversacionGuiada, type EstadoParaInstantanea } from "./registro-guiado";

/**
 * Vista guiada (/asistente). Cada pieza (ideas, plan, proveedores…) va PEGADA al mensaje que la trajo; solo las del
 * último mensaje del asistente se pueden usar y las anteriores quedan como historia con lo que se eligió. En todo
 * momento hay una siguiente acción a la vista: una pregunta con botones, la acción principal del plan, la barra del
 * plan vigente o, si algo falla, una tarjeta con «Reintentar» que repite LA ACCIÓN que falló.
 */
type Widget = WidgetGuiado;
type WidgetPlan = Extract<Widget, { tipo: "plan" }>;
type Propuesta = z.infer<typeof PropuestaComposicionSchema>;
type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type BriefGuiado = { evento?: string; edad?: number; tematica?: string };
type Uso = "negocio" | "personal";
type FotoInspiracion = { base64: string; mime: "image/jpeg" | "image/png" | "image/webp" };
type PreguntaCiudad = "ciudad-decorador" | "ciudad-distribuidor";
type OpcionesEnvio = { uso?: Uso; reintentar?: boolean; alcance?: "completa" | "individual"; pieza?: EstructuraOficialId };

/** Qué repite «Reintentar»: se guarda la acción (no un cierre) para ejecutarla con el estado del momento del clic. */
type AccionFallo =
  | { tipo: "turno"; texto: string; opciones: OpcionesEnvio }
  | { tipo: "plan"; propuesta: Propuesta; mensajeId: string; planAnterior?: PlanActualGuiado }
  | { tipo: "foto"; referenciaId: string; mensajeId: string }
  | { tipo: "subir-foto" };
type AlternativaFallo = "otros-colores" | "otra-pieza";
type Fallo = { titulo: string; detalle?: string; etiqueta?: string; accion: AccionFallo; alternativas?: AlternativaFallo[]; mensajeId?: string };

const ReferenciaSchema = z.object({ blueprint: ReferenceBlueprintV2Schema, frase: z.string(), aspecto: z.number().positive().optional(), piezas: z.array(z.object({ x: z.number(), y: z.number(), ancho: z.number(), alto: z.number() }).strict()), colores: z.array(z.object({ nombre: z.string(), hex: z.string() }).strict()) }).strict();
const MensajeSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  widgets: z.array(WidgetGuiadoSchema).optional(),
  miniatura: z.string().regex(/^data:image\/jpeg;base64,/).max(80_000).optional(),
  referencia: ReferenciaSchema.optional(),
  notaFoto: z.string().optional(),
  /** La lectura de esta foto ya produjo un plan: «Sí, armémoslo» deja de mostrarse. */
  fotoArmada: z.boolean().optional(),
  /** Respuestas rápidas de una pregunta local (sin modelo). */
  rapidas: z.array(z.string().min(1).max(60)).max(8).optional(),
  destacadas: z.array(z.string().min(1).max(60)).max(4).optional(),
  /** Pregunta local de ciudad: lo que el cliente elija o escriba se convierte en la búsqueda correspondiente. */
  pregunta: z.enum(["ciudad-decorador", "ciudad-distribuidor"]).optional(),
}).strict();
type Mensaje = z.infer<typeof MensajeSchema>;

const CLAVE_SESION = "demo_guiado_v2";
const MAX_MENSAJES_GUARDADOS = 80;
const EstadoGuardadoSchema = z.object({
  mensajes: z.array(MensajeSchema).max(MAX_MENSAJES_GUARDADOS),
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
  ciudadProveedores: z.string().optional(),
  ciudadesDisponibles: z.array(z.string()).optional(),
  accionPlan: z.string().optional(),
}).passthrough();
const AccionModeloSchema = z.enum(["ver", "costear", "comprar", "aprender", "contratar"]);
/** De /api/generate solo interesa la imagen: el plan que devuelve no trae approval_token y el de la tarjeta sí. */
const ImagenGeneradaSchema = z.object({ imagen: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,/) }).passthrough();

const LIMITE_TURNO_MS = 75_000;
const LIMITE_PLAN_MS = 75_000;
const LIMITE_IMAGEN_MS = 90_000;
// La lectura tarda 12-27 s en local y más en Vercel (va por el Python del VPS): con 12 s se cortaba siempre en
// producción, la guiada seguía sin la foto y adivinaba las piezas («un arco» donde había dos columnas; 2026-10-06).
const LIMITE_FOTO_MS = 100_000;
/** Lo único que el plan con foto añade al texto de la clásica (`aceptarPlanFoto`): la guiada necesita el plan confirmado en este turno. */
const CONFIRMAR_PLAN_FOTO = "Confirma el plan con confirmar_plan_decoracion en este mismo turno, sin preguntarme nada.";

/** El saludo es fijo, sale al instante y no viaja en el historial: el prompt guiado sabe que ya se hizo. */
const SALUDO = "¡Hola! Te hago unas preguntas cortas y te muestro decoraciones Sempertex que encajen con tu celebración.\n\n**¿Qué vas a celebrar?**";
const CHIP_FOTO = "Tengo una foto de inspiración";
const OPCIONES_SALUDO: ReadonlyArray<{ texto: string; icono: ReactNode }> = [
  { texto: "Cumpleaños", icono: <Cake className="size-4" aria-hidden /> },
  { texto: "Baby shower", icono: <Baby className="size-4" aria-hidden /> },
  { texto: "Boda", icono: <Heart className="size-4" aria-hidden /> },
  { texto: "XV años", icono: <Crown className="size-4" aria-hidden /> },
  { texto: "Bautizo o comunión", icono: <Church className="size-4" aria-hidden /> },
  { texto: "Otra celebración", icono: <Sparkles className="size-4" aria-hidden /> },
];
const OTRAS_CELEBRACIONES = ["Divorcio", "Graduación", "Jubilación", "Fiesta de empresa", "Aniversario"];
const PROPONME = "Propónme algo";
const PROPONME_LOCAL = /^(?:oye,?\s*)?(?:prop[oó]nme algo|qu[eé] me recomiendas armar\??|arma t[uú] algo\.?)[.!?]*$/i;
const PREGUNTA_TIPO = "¿Quieres una decoración completa (varias piezas) o una pieza individual?";
const PLACEHOLDER_CAMBIO = "Pide un cambio: más rosa, sin columnas…";
const PLACEHOLDER_CIUDAD = "Escribe tu ciudad…";
/** Widgets que ya hacen la pregunta: con ellos, los botones «Opciones:» del texto sobran. */
const WIDGETS_QUE_PREGUNTAN = new Set<Widget["tipo"]>(["decoraciones", "opciones", "uso", "propuesta", "plan", "pregunta-propuesta", "pasos-plan"]);
/** Widgets altos: al llegar se muestra su cabecera, no su final. */
const WIDGETS_ALTOS = new Set<Widget["tipo"]>(["decoraciones", "propuesta", "plan", "proveedores", "pasos-plan"]);
const ORDEN_ETAPA: Record<EtapaPlan, number> = { preparando: 0, reintentando: 0, buscando: 1, calculando: 2, precio: 3 };
const SIN_DEFINIR = /^(?:pendiente|por[ _-]?definir|sin definir|ninguna)$/i;
/** Cursor de escritura al final del texto que llega (el Markdown es compartido: se aplica desde fuera). */
const CARET = "[&_.prose-chat>:last-child]:after:ml-0.5 [&_.prose-chat>:last-child]:after:inline-block [&_.prose-chat>:last-child]:after:h-[1em] [&_.prose-chat>:last-child]:after:w-0.5 [&_.prose-chat>:last-child]:after:bg-acento [&_.prose-chat>:last-child]:after:align-[-2px] [&_.prose-chat>:last-child]:after:content-[''] [&_.prose-chat>:last-child]:after:animate-[caret_1s_steps(2)_infinite]";

function nuevoId(): string { return crypto.randomUUID(); }

export function VistaGuiada() {
  const { modo, cambiar } = useModoVista();
  const reducido = useReducedMotion();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [brief, setBrief] = useState<BriefGuiado>({});
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargandoEstado] = useState(false);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [seleccionada, setSeleccionada] = useState<DecoracionSempertex | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [imagenEnCurso, setImagenEnCurso] = useState<string | null>(null);
  /** Imágenes ya pagadas, en memoria, por id del mensaje del plan: se ven en el acto aunque guardarlas falle. */
  const [imagenesLocales, setImagenesLocales] = useState<Readonly<Record<string, string>>>({});
  const [etapaPlan, setEtapaPlan] = useState<Readonly<Record<string, EtapaPlan>>>({});
  const [foto, setFoto] = useState<File | null>(null);
  const [analizandoFoto, setAnalizandoFoto] = useState(false);
  const [transmitiendoId, setTransmitiendoId] = useState<string | null>(null);
  const [placeholderForzado, setPlaceholderForzado] = useState<string | null>(null);
  const [sugerenciasCambio, setSugerenciasCambio] = useState<string[] | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [restaurado, setRestaurado] = useState(false);
  /** Ids restaurados de la sesión: no se vuelven a animar al montar. */
  const [restaurados, setRestaurados] = useState<ReadonlySet<string>>(() => new Set());
  // Hasta hidratar, un clic se perdería sin aviso: el compositor sale desactivado y se activa solo.
  const hidratado = useSyncExternalStore(suscribirNada, () => true, () => false);

  const textoRef = useRef<HTMLInputElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const turnoRef = useRef(0);
  const sesionRef = useRef(0);
  const cargandoRef = useRef(false);
  const controlRef = useRef<AbortController | null>(null);
  const imagenControlRef = useRef<AbortController | null>(null);
  const imagenEnCursoRef = useRef<string | null>(null);
  const fotosRef = useRef(new Map<string, FotoInspiracion>());
  const restauradoRef = useRef(false);
  const flujoRef = useRef<{ id: string; texto: string } | null>(null);
  const cuadroRef = useRef<number | null>(null);
  const vistaPendienteRef = useRef<{ tipo: "final"; instantaneo?: boolean } | { tipo: "mensaje" | "llegada"; id: string } | null>(null);

  const { pegado, hayNuevo, irAlFinal, mostrarMensaje, mostrarLlegada, irALoNuevo, seguirSiPegado } = useSeguirFinal({ contenedorRef, contenidoRef });

  const marcarCargando = useCallback((valor: boolean) => { cargandoRef.current = valor; setCargandoEstado(valor); }, []);

  // ── Derivados ────────────────────────────────────────────────────────────────────────────────────────────────
  const planVigente = useMemo(() => buscarPlanVigente(mensajes), [mensajes]);
  const ultimo = mensajes.at(-1);
  const indiceActivo = useMemo(() => {
    for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) if (mensajes[indice]!.role === "assistant") return indice;
    return -1;
  }, [mensajes]);
  const ultimoAsistente = indiceActivo >= 0 ? mensajes[indiceActivo] : undefined;
  const opcionesModelo = useMemo(() => (ultimo?.role === "assistant" ? separarOpciones(ultimo.content).opciones : []), [ultimo]);
  const preguntaCiudad = Boolean(ultimo?.role === "assistant" && (ultimo.pregunta || opcionesModelo.some((opcion) => claveTexto(opcion) === "otra ciudad")));
  const preguntaEdad = Boolean(ultimo?.role === "assistant" && /cu[aá]ntos años|qu[eé] edad/i.test(ultimo.content));
  const hechasOpciones = useMemo(() => {
    let desde = -1;
    mensajes.forEach((mensaje, indice) => { if (mensaje.widgets?.some((widget) => widget.tipo === "seleccion")) desde = indice; });
    const hechas = new Set<OpcionGuiada>();
    mensajes.slice(Math.max(0, desde)).forEach((mensaje) => mensaje.widgets?.forEach((widget) => { if (widget.tipo === "opciones" && widget.elegida) hechas.add(widget.elegida); }));
    return [...hechas];
  }, [mensajes]);

  const respuestasRapidas = useMemo((): { opciones: string[]; destacadas: string[] } => {
    const vacio = { opciones: [], destacadas: [] };
    if (cargando || !mensajes.length || ultimo?.role !== "assistant") return vacio;
    if (sugerenciasCambio?.length) return { opciones: sugerenciasCambio, destacadas: [] };
    if (ultimo.rapidas?.length) return { opciones: dedupeOpciones(ultimo.rapidas), destacadas: ultimo.destacadas ?? [] };
    if (ultimo.referencia || ultimo.widgets?.some((widget) => WIDGETS_QUE_PREGUNTAN.has(widget.tipo))) return vacio;
    const opciones = [...opcionesModelo];
    // Respaldo: con una idea elegida y sin botones, las cuatro opciones siguen a mano.
    if (!opciones.length && seleccionada && !planVigente) opciones.push(...OPCIONES_GUIADAS.map((opcion) => opcion.titulo));
    const conProponer = !planVigente && !seleccionada && !preguntaCiudad && !preguntaEdad;
    if (conProponer) opciones.push(PROPONME);
    return { opciones: dedupeOpciones(opciones), destacadas: conProponer ? [PROPONME] : [] };
  }, [cargando, mensajes.length, ultimo, sugerenciasCambio, opcionesModelo, seleccionada, planVigente, preguntaCiudad, preguntaEdad]);

  const contexto = useMemo(() => {
    if (seleccionada && !planVigente) return `${seleccionada.titulo}${uso ? ` · ${uso === "negocio" ? "Para negocio" : "Uso personal"}` : ""}`;
    const valido = (valor: string | undefined): valor is string => Boolean(valor?.trim() && !SIN_DEFINIR.test(valor.trim()));
    const cumple = /cumple/i.test(brief.evento ?? "");
    const partes = [valido(brief.evento) ? brief.evento : null, cumple && brief.edad ? `${brief.edad} años` : null, valido(brief.tematica) ? brief.tematica : null];
    const visibles = partes.filter((parte): parte is string => Boolean(parte)).map(conMayuscula);
    return visibles.length ? visibles.join(" · ") : null;
  }, [brief, seleccionada, planVigente, uso]);

  const placeholder = useMemo(() => {
    if (placeholderForzado) return placeholderForzado;
    if (!mensajes.length) return "Cuéntame qué quieres celebrar…";
    if (cargando) return "Escribe mientras preparo tu respuesta…";
    if (preguntaCiudad) return PLACEHOLDER_CIUDAD;
    if (ultimoAsistente?.widgets?.some((widget) => widget.tipo === "decoraciones")) return "Cuéntame qué te gustó…";
    // Una pregunta abierta manda sobre el plan vigente: primero se contesta.
    const pregunta = ultimoAsistente?.widgets?.some((widget) => widget.tipo === "pregunta-propuesta" || widget.tipo === "opciones" || widget.tipo === "uso");
    if (pregunta || (respuestasRapidas.opciones.length && !sugerenciasCambio)) return "Elige una opción o escríbela…";
    if (planVigente) return PLACEHOLDER_CAMBIO;
    return "Escribe tu respuesta…";
  }, [placeholderForzado, mensajes.length, cargando, preguntaCiudad, planVigente, ultimoAsistente, respuestasRapidas.opciones.length, sugerenciasCambio]);

  // ── Sesión ───────────────────────────────────────────────────────────────────────────────────────────────────
  // Se restaura UNA vez y antes del primer guardado: en modo estricto el guardado del montaje ya no pisa lo guardado.
  useLayoutEffect(() => {
    if (restauradoRef.current) return;
    restauradoRef.current = true;
    const guardado = leerSesion();
    // Conversación del servidor (registro y auditoría): la de esta sesión, o una nueva; todo fetch a /api/* la lleva.
    abrirConversacionGuiada(Boolean(guardado), guardado?.mensajes.length ?? 0);
    /* eslint-disable react-hooks/set-state-in-effect -- restauración única desde sessionStorage (sistema externo) */
    if (guardado) {
      setMensajes(guardado.mensajes);
      setBrief(guardado.brief);
      setSeleccionada(guardado.seleccionada);
      setUso(guardado.uso);
      setRestaurados(new Set(guardado.mensajes.map((mensaje) => mensaje.id)));
      vistaPendienteRef.current = { tipo: "final", instantaneo: true };
    }
    setRestaurado(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    // Durante la transmisión no se guarda en cada fotograma: se guarda al terminar.
    if (!restaurado || transmitiendoId) return;
    try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ mensajes: mensajes.slice(-MAX_MENSAJES_GUARDADOS), brief, seleccionadaId: seleccionada?.id ?? null, uso })); }
    catch (cause) { console.warn("[asistente-guiado] no se pudo guardar la conversación.", cause); }
  }, [restaurado, transmitiendoId, mensajes, brief, seleccionada, uso]);

  // Desplazamiento pedido por una acción: se hace después de pintar el mensaje.
  useEffect(() => {
    const pendiente = vistaPendienteRef.current;
    if (!pendiente) return;
    vistaPendienteRef.current = null;
    if (pendiente.tipo === "final") irAlFinal(pendiente.instantaneo ? "auto" : undefined);
    else if (pendiente.tipo === "llegada") mostrarLlegada(pendiente.id);
    else mostrarMensaje(pendiente.id);
  }, [mensajes, irAlFinal, mostrarMensaje, mostrarLlegada]);

  // ── Utilidades de estado ─────────────────────────────────────────────────────────────────────────────────────
  function pedirFinal(): void { vistaPendienteRef.current = { tipo: "final" }; }
  function pedirVista(id: string): void { vistaPendienteRef.current = { tipo: "mensaje", id }; }
  /** Lo que llega solo, tras una espera (plan, propuesta, ideas): no saca al cliente de lo que está releyendo. */
  function pedirLlegada(id: string): void { vistaPendienteRef.current = { tipo: "llegada", id }; }
  /** Lleva a la vista lo que se acaba de abrir dentro de la tarjeta (compra, costeo, imagen); si no está, su final. */
  function revelarEnTarjeta(id: string, selector: string): void {
    window.setTimeout(() => {
      const mensaje = contenedorRef.current?.querySelector<HTMLElement>(`[data-mensaje-id="${CSS.escape(id)}"]`);
      const objetivo = mensaje?.querySelector<HTMLElement>(selector);
      // Instantáneo: un desplazamiento suave competía con el seguimiento del final y no llegaba a mostrarlo.
      if (objetivo) objetivo.scrollIntoView({ block: "center", behavior: "auto" });
      else mensaje?.scrollIntoView({ block: "end", behavior: "auto" });
    }, 380);
  }
  function actualizarMensaje(id: string, cambio: (mensaje: Mensaje) => Mensaje): void {
    setMensajes((actuales) => actuales.map((mensaje) => (mensaje.id === id ? cambio(mensaje) : mensaje)));
  }
  function actualizarWidget<T extends Widget["tipo"]>(id: string, tipo: T, cambio: (widget: Extract<Widget, { tipo: T }>) => Extract<Widget, { tipo: T }>): void {
    actualizarMensaje(id, (mensaje) => ({ ...mensaje, widgets: mensaje.widgets?.map((widget): Widget => (widget.tipo === tipo ? cambio(widget as Extract<Widget, { tipo: T }>) : widget)) }));
  }
  function agregar(nuevos: Mensaje[]): void { setMensajes((actuales) => [...actuales, ...nuevos]); }
  function fijarEtapa(id: string, etapa: EtapaPlan): void { setEtapaPlan((actuales) => ({ ...actuales, [id]: etapa })); }
  function avanzarEtapa(id: string, etapa: EtapaPlan): void {
    setEtapaPlan((actuales) => {
      const actual = actuales[id];
      if (actual && actual !== "reintentando" && ORDEN_ETAPA[actual] >= ORDEN_ETAPA[etapa]) return actuales;
      return { ...actuales, [id]: etapa };
    });
  }
  function quitarEtapa(id: string): void {
    setEtapaPlan((actuales) => (id in actuales ? Object.fromEntries(Object.entries(actuales).filter(([clave]) => clave !== id)) : actuales));
  }
  function pedirEscritura(texto: string, prefijo?: string): void {
    setPlaceholderForzado(texto);
    if (prefijo !== undefined) setEntrada(prefijo);
    requestAnimationFrame(() => {
      const caja = textoRef.current;
      if (!caja) return;
      caja.focus();
      const fin = caja.value.length;
      caja.setSelectionRange(fin, fin);
    });
  }
  function limpiarAvisos(): void { setFallo(null); setSugerenciasCambio(null); setPlaceholderForzado(null); }

  // Texto en streaming: como mucho un render por fotograma.
  function empujarTexto(id: string, texto: string): void {
    flujoRef.current = { id, texto };
    if (cuadroRef.current !== null) return;
    cuadroRef.current = requestAnimationFrame(() => {
      cuadroRef.current = null;
      const flujo = flujoRef.current;
      if (!flujo) return;
      actualizarMensaje(flujo.id, (mensaje) => ({ ...mensaje, content: flujo.texto }));
      seguirSiPegado();
    });
  }
  function cancelarFlujo(): void {
    if (cuadroRef.current !== null) cancelAnimationFrame(cuadroRef.current);
    cuadroRef.current = null;
    flujoRef.current = null;
  }

  const vaciar = useCallback(() => {
    turnoRef.current += 1;
    sesionRef.current += 1;
    controlRef.current?.abort("usuario");
    imagenControlRef.current?.abort("usuario");
    controlRef.current = null;
    imagenControlRef.current = null;
    imagenEnCursoRef.current = null;
    if (cuadroRef.current !== null) cancelAnimationFrame(cuadroRef.current);
    cuadroRef.current = null;
    flujoRef.current = null;
    fotosRef.current.clear();
    setMensajes([]); setBrief({}); setSeleccionada(null); setUso(null); setFoto(null); setFallo(null); setEntrada("");
    setImagenEnCurso(null); setImagenesLocales({}); setEtapaPlan({}); setAnalizandoFoto(false); setTransmitiendoId(null);
    setPlaceholderForzado(null); setSugerenciasCambio(null); setAnuncio("");
    marcarCargando(false);
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (cause) { console.warn("[asistente-guiado] no se pudo limpiar la sesión.", cause); }
    vaciarConversacionGuiada();
  }, [marcarCargando]);

  // ── Registro de acciones y fallos (auditoría del servidor; con la instantánea del estado, sin fotos) ─────────────
  function estadoRegistro(): EstadoParaInstantanea {
    return { mensajes, brief, seleccionada, uso, planVigente, cargando: cargandoRef.current, fallo };
  }
  function registrarAccion(evento: string, datos: Record<string, unknown> = {}): void { registrarAccionGuiada(evento, datos, estadoRegistro()); }
  function registrarFallo(evento: string, causa: unknown, datos: Record<string, unknown> = {}, nivel: "warn" | "error" = "error"): void { registrarFalloGuiado(evento, causa, datos, estadoRegistro(), nivel); }

  function detener(): void { controlRef.current?.abort("usuario"); }

  // ── Turno con el asistente guiado ────────────────────────────────────────────────────────────────────────────
  async function enviar(texto: string, opcionesEnvio: OpcionesEnvio = {}): Promise<void> {
    const archivo = foto;
    let limpio = texto.trim();
    if ((!limpio && !archivo) || cargandoRef.current) return;
    registrarAccion("turno.enviar", { texto: limpio, opciones: opcionesEnvio, conFoto: Boolean(archivo) });
    limpiarAvisos();
    if (!limpio) limpio = "Mira esta foto de inspiración.";

    // «Propónme algo» se resuelve aquí mismo: la pregunta de tipo no necesita al modelo.
    if (!archivo && PROPONME_LOCAL.test(limpio)) {
      setSeleccionada(null); setUso(null); setEntrada("");
      agregar([
        { id: nuevoId(), role: "user", content: limpio },
        { id: nuevoId(), role: "assistant", content: PREGUNTA_TIPO, widgets: [{ tipo: "pregunta-propuesta", alcance: "tipo" }] },
      ]);
      pedirFinal();
      return;
    }

    const opciones: OpcionesEnvio = { ...opcionesEnvio };
    let contenido = limpio.slice(0, 6000);
    const previo = ultimoAsistente;
    const tipoAbierto = previo && indiceActivo === mensajes.length - 1 ? previo.widgets?.find((widget) => widget.tipo === "pregunta-propuesta" && widget.alcance === "tipo" && !widget.elegida) : undefined;
    if (!opciones.alcance && tipoAbierto && previo) {
      const alcance = /completa/i.test(contenido) ? "completa" : /individual/i.test(contenido) ? "individual" : null;
      if (alcance) {
        opciones.alcance = alcance;
        actualizarWidget(previo.id, "pregunta-propuesta", (widget) => ({ ...widget, elegida: alcance === "completa" ? "Decoración completa" : "Pieza individual" }));
      }
    }
    if (!opciones.reintentar && previo?.pregunta && indiceActivo === mensajes.length - 1 && contenido.length <= 40 && !/\bbusca/i.test(contenido)) {
      contenido = textoBusquedaCiudad(previo.pregunta, contenido, Boolean(planVigente));
    }

    const turno = ++turnoRef.current;
    const control = new AbortController();
    controlRef.current = control;
    const reloj = window.setTimeout(() => control.abort("tiempo"), LIMITE_TURNO_MS);
    const idUsuario = nuevoId();
    const idAsistente = nuevoId();
    const base = (opciones.reintentar ? sinUltimoTurnoGuiado(mensajes) : mensajes).filter((mensaje) => mensaje.content.trim().length > 0 || mensaje.widgets?.length || mensaje.referencia);
    const historial = prepararHistorialGuiado(base, `${contenido}${archivo ? "\nAdjunté una foto de inspiración." : ""}`);
    const usoEnvio = opciones.uso ?? uso ?? undefined;
    const planActual = planVigente ? planActualDesdePlan(planVigente.widget.plan) : null;
    const planAnterior = planActual ?? undefined;
    const estadoGuiado = {
      ...(seleccionada && !planVigente ? { decoracionId: seleccionada.id } : {}),
      ...(usoEnvio ? { uso: usoEnvio } : {}),
      ...(opciones.alcance ? { alcancePropuesta: opciones.alcance } : {}),
      ...(opciones.alcance === "individual" && opciones.pieza ? { piezaPedida: opciones.pieza } : {}),
      ...(planActual ? { planActual } : {}),
    };
    const elegida = seleccionada && !planVigente ? seleccionada : null;
    // Funcional: conserva lo que la acción que llamó acaba de marcar (la opción elegida en su widget).
    setMensajes((actuales) => [
      ...(opciones.reintentar ? sinUltimoTurnoGuiado(actuales) : actuales).filter((mensaje) => mensaje.content.trim().length > 0 || mensaje.widgets?.length || mensaje.referencia),
      { id: idUsuario, role: "user", content: contenido },
      { id: idAsistente, role: "assistant", content: "" },
    ]);
    setEntrada("");
    marcarCargando(true);
    setTransmitiendoId(idAsistente);
    setAnuncio("El asistente está escribiendo");
    pedirFinal();

    let propuestaParaPlan: Propuesta | null = null;
    let accionModelo: z.infer<typeof AccionModeloSchema> | null = null;
    let etapa: "foto" | "turno" = "turno";
    try {
      let imagen: FotoInspiracion | null = null;
      if (archivo) {
        etapa = "foto";
        setFoto(null);
        const miniatura = await miniaturaDe(archivo).catch((cause: unknown) => { console.warn("[asistente-guiado] no se pudo crear la miniatura de la foto.", cause); return undefined; });
        if (turno !== turnoRef.current) return;
        if (miniatura) actualizarMensaje(idUsuario, (mensaje) => ({ ...mensaje, miniatura }));
        imagen = await leerFoto(archivo);
        setAnalizandoFoto(true);
        const referencia = await analizarFoto(imagen, control.signal);
        setAnalizandoFoto(false);
        if (turno !== turnoRef.current) return;
        if (referencia) {
          // Con la lectura no hace falta el modelo: el asistente muestra lo que vio y ofrece armarlo.
          fotosRef.current.set(idAsistente, imagen);
          actualizarMensaje(idAsistente, (mensaje) => ({ ...mensaje, content: "Esto es lo que veo en tu foto.", referencia, ...(miniatura ? { miniatura } : {}) }));
          pedirLlegada(idAsistente);
          setAnuncio("Ya leí tu foto");
          return;
        }
        actualizarMensaje(idUsuario, (mensaje) => ({ ...mensaje, notaFoto: "No pude distinguir bien los detalles, pero podemos seguir con tu idea." }));
        registrarFallo("foto.sin_lectura", "la lectura de la foto no devolvió piezas", {}, "warn");
        etapa = "turno";
      }

      const respuesta = await fetch("/api/asistente-guiado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema_version: "asistente-guiado.v1", messages: historial, brief, estadoGuiado, ...(imagen ? { fotoInspiracion: imagen } : {}) }),
        signal: control.signal,
      });
      if (!respuesta.ok || !respuesta.body) throw new Error(`El asistente respondió con estado ${respuesta.status}.`);
      let acumulado = "";
      await leerSse(respuesta, (evento) => {
        if (turno !== turnoRef.current) return;
        if (evento.type === "texto") { acumulado += evento.delta; empujarTexto(idAsistente, acumulado); return; }
        if (evento.type === "error") throw new Error(evento.error);
        if (evento.type !== "fin") return;
        cancelarFlujo();
        const resultado = ResultadoSchema.safeParse(evento.result ?? {});
        if (!resultado.success) throw new Error("Los datos devueltos por el asistente no son válidos.");
        const datos = resultado.data;
        if (datos.brief) setBrief(datos.brief);
        if (datos.uso) setUso(datos.uso);
        const widgets: Widget[] = [];
        if (datos.decoraciones?.length) widgets.push({ tipo: "decoraciones", decoraciones: datos.decoraciones });
        if (datos.preguntaUso && elegida) widgets.push({ tipo: "uso" });
        const usoCotizado = datos.uso ?? usoEnvio;
        if (elegida && usoCotizado && datos.cotizacion !== undefined) {
          const valida = datos.cotizacion == null ? null : CotizacionGuiadaSchema.safeParse(datos.cotizacion);
          if (valida && !valida.success) throw new Error("La cotización recibida no cumple el contrato.");
          widgets.push({ tipo: "cotizacion", cotizacion: valida ? valida.data : null, uso: usoCotizado, decoracion: elegida });
        }
        if (datos.pasos && elegida) widgets.push({ tipo: "pasos", decoracion: elegida });
        // Sin ciudad no hay directorio vacío: el modelo pregunta la ciudad.
        if (datos.proveedores && (datos.proveedores.length || datos.ciudadProveedores)) {
          widgets.push({ tipo: "proveedores", proveedores: datos.proveedores, ...(datos.ciudadProveedores ? { ciudad: datos.ciudadProveedores } : {}), ...(datos.ciudadesDisponibles?.length ? { ciudadesDisponibles: datos.ciudadesDisponibles } : {}) });
        }
        // Las otras opciones van SIEMPRE al final: tras una guía larga o el precio, la siguiente acción queda debajo, a mano.
        if (elegida && (datos.opciones || widgets.some((widget) => widget.tipo === "cotizacion" || widget.tipo === "pasos"))) widgets.push({ tipo: "opciones" });
        const accion = AccionModeloSchema.safeParse(datos.accionPlan);
        if (accion.success) accionModelo = accion.data;
        const textoFinal = evento.reply.slice(0, 6000);
        if (datos.propuesta) {
          propuestaParaPlan = datos.propuesta;
          setSeleccionada(null); setUso(null);
          actualizarMensaje(idAsistente, (mensaje) => ({ ...mensaje, content: datos.propuesta!.frase, widgets: [{ tipo: "propuesta", propuesta: datos.propuesta!, estado: "resolviendo" }] }));
          pedirLlegada(idAsistente);
        } else if (!textoFinal.trim() && !widgets.length) {
          setMensajes((actuales) => actuales.filter((mensaje) => mensaje.id !== idAsistente));
        } else {
          actualizarMensaje(idAsistente, (mensaje) => ({ ...mensaje, content: textoFinal, ...(widgets.length ? { widgets } : {}) }));
          if (widgets.some((widget) => WIDGETS_ALTOS.has(widget.tipo))) pedirLlegada(idAsistente);
        }
        setAnuncio("Respuesta lista");
      });
      if (turno !== turnoRef.current) return;
      window.clearTimeout(reloj);
      setTransmitiendoId(null);
      if (accionModelo && planVigente && !(accionModelo === "ver" && planVigente.widget.reemplazado)) accionPlan(accionModelo, planVigente.mensajeId, "modelo");
      if (propuestaParaPlan) await aceptarPropuesta(propuestaParaPlan, { mensajeId: idAsistente, desdeTurno: true, ...(planAnterior ? { planAnterior } : {}) });
    } catch (causa) {
      if (turno !== turnoRef.current) return;
      cancelarFlujo();
      const detenido = control.signal.aborted && control.signal.reason === "usuario";
      registrarFallo(etapa === "foto" ? "foto.fallo" : detenido ? "turno.detenido" : "sse.fallo", causa, { etapa, detenido, texto: contenido, cortadoPor: control.signal.aborted ? String(control.signal.reason) : null }, detenido ? "warn" : "error");
      // warn y no error: en desarrollo, console.error abre el aviso rojo de Next en plena demo.
      if (!detenido) console.warn("[asistente-guiado] turno fallido", causa);
      // Si el cliente detuvo, se queda lo que alcanzó a llegar; si falló, el mensaje vacío o a medias se quita.
      setMensajes((actuales) => actuales.filter((mensaje) => mensaje.id !== idAsistente || (detenido && (mensaje.content.trim() || mensaje.widgets?.length))));
      if (etapa === "foto" && !detenido) {
        setFallo({ titulo: "No pude leer tu foto", detalle: "Usa una foto JPG, PNG o WebP de menos de 6 MB.", etiqueta: "Elegir otra foto", accion: { tipo: "subir-foto" } });
      } else {
        setFallo({
          titulo: detenido ? "Detuviste la respuesta" : "Se cortó la conexión",
          detalle: detenido ? "Puedes pedirla otra vez cuando quieras." : "Tu conversación sigue guardada.",
          accion: { tipo: "turno", texto: contenido, opciones: { ...opciones, reintentar: undefined } },
        });
      }
      setAnuncio(detenido ? "Respuesta detenida" : "No pude responder");
    } finally {
      window.clearTimeout(reloj);
      if (turno === turnoRef.current) { marcarCargando(false); setTransmitiendoId(null); setAnalizandoFoto(false); controlRef.current = null; }
    }
  }

  // ── Plan con cantidades (/api/chat) ──────────────────────────────────────────────────────────────────────────
  /**
   * Pide el plan a /api/chat con un reintento automático. No toca los mensajes: eso lo hace quien llama. Un plan confirmado
   * pero defectuoso (pieza orgánica de un solo tamaño, globos estampados) gasta ese reintento; si el segundo no llega, se
   * queda el primero: un plan imperfecto es mejor que un error.
   */
  async function ejecutarPlan(mensajeId: string, armarCuerpo: (reintento: boolean) => Record<string, unknown>, soloReintento: boolean): Promise<{ turno: number } & ({ estado: "ok"; plan: PlanGuiado; cotizacion: unknown } | { estado: "detenido" | "fallo" | "obsoleto" })> {
    const turno = ++turnoRef.current;
    const control = new AbortController();
    controlRef.current = control;
    marcarCargando(true);
    fijarEtapa(mensajeId, soloReintento ? "reintentando" : "preparando");
    let respaldo: { plan: PlanGuiado; cotizacion: unknown } | null = null;
    for (const reintento of soloReintento ? [true] : [false, true]) {
      if (reintento && !soloReintento) fijarEtapa(mensajeId, "reintentando");
      const intento = new AbortController();
      const cortar = () => intento.abort();
      control.signal.addEventListener("abort", cortar);
      const reloj = window.setTimeout(cortar, LIMITE_PLAN_MS);
      try {
        const respuesta = await pedirPlanChat(armarCuerpo(reintento), intento.signal, (nombre, estado, ok) => {
          if (turno !== turnoRef.current) return;
          const siguiente: EtapaPlan | null = nombre === "buscar_catalogo_rag" ? "buscando"
            : nombre === "confirmar_plan_decoracion" ? (estado === "ejecutando" ? "calculando" : ok !== false ? "precio" : null)
              : null;
          if (siguiente) avanzarEtapa(mensajeId, siguiente);
        });
        if (turno !== turnoRef.current) return { turno, estado: "obsoleto" };
        const plan = PlanGuiadoSchema.safeParse(respuesta.plan);
        if (plan.success) {
          const defecto = reintento ? null : defectoPlanGuiado(plan.data, respuesta.cotizacion);
          if (!defecto) {
            registrarAccion("plan.listo", { intento: reintento ? 2 : 1, plan_hash: plan.data.plan_hash });
            return { turno, estado: "ok", plan: plan.data, cotizacion: respuesta.cotizacion };
          }
          registrarFallo("plan.defecto", defecto, { intento: 1, plan_hash: plan.data.plan_hash, accion: "se pide otra vez" }, "warn");
          console.warn("[asistente-guiado] el plan no cumple la guía; se pide otra vez", { defecto });
          respaldo = { plan: plan.data, cotizacion: respuesta.cotizacion };
          continue;
        }
        // La respuesta del agente clásico trae jerga: solo a la consola.
        registrarFallo("plan.sin_confirmar", "el plan no llegó confirmado", { intento: reintento ? 2 : 1, respuesta: respuesta.reply.slice(0, 600) }, "warn");
        console.warn("[asistente-guiado] el plan no llegó confirmado", { intento: reintento ? 2 : 1, respuesta: respuesta.reply.slice(0, 600) });
      } catch (causa) {
        if (turno !== turnoRef.current) return { turno, estado: "obsoleto" };
        if (control.signal.aborted) return { turno, estado: "detenido" };
        registrarFallo("plan.intento_fallido", causa, { intento: reintento ? 2 : 1 }, "warn");
        console.warn("[asistente-guiado] falló un intento de plan", { intento: reintento ? 2 : 1, causa });
      } finally {
        window.clearTimeout(reloj);
        control.signal.removeEventListener("abort", cortar);
      }
    }
    if (respaldo) registrarFallo("plan.respaldo", "el reintento no dio un plan mejor: se queda el primero", { plan_hash: respaldo.plan.plan_hash }, "warn");
    else registrarFallo("plan.fallo", "ningún intento dio un plan confirmado", {});
    return respaldo ? { turno, estado: "ok", ...respaldo } : { turno, estado: "fallo" };
  }

  function terminarPlan(turno: number, mensajeId: string): void {
    quitarEtapa(mensajeId);
    if (turno === turnoRef.current) { marcarCargando(false); controlRef.current = null; }
  }

  /** Deja el plan en el MISMO mensaje (la propuesta pasa a «Tu plan») y marca como versión anterior el que había. */
  function colocarPlan(mensajeId: string, plan: PlanGuiado, cotizacionCruda: unknown, fotoInspiracion: boolean): void {
    const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacionCruda);
    const cotizacion = precio.success ? { ...precio.data, lineas: precio.data.lineas.map((linea) => ({ ...linea, nombre: nombreLineaCliente(linea) })) } : undefined;
    const armado = generarPasosPlan(plan);
    const resumen = resumenPlanGuiado(plan);
    setMensajes((actuales) => {
      const previo = buscarPlanVigente(actuales.filter((mensaje) => mensaje.id !== mensajeId));
      const totalAnterior = previo ? totalDePlan(previo.widget.plan) : undefined;
      const nuevo: WidgetPlan = {
        tipo: "plan", plan, pasos: armado.pasos,
        ...(cotizacion ? { cotizacion } : {}),
        ...(totalAnterior !== undefined ? { totalAnterior } : {}),
        ...(fotoInspiracion ? { fotoInspiracion: true } : {}),
      };
      return actuales.map((mensaje) => {
        if (mensaje.id === mensajeId) return { ...mensaje, content: resumen, widgets: [nuevo] };
        if (!mensaje.widgets?.some((widget) => widget.tipo === "plan" && !widget.reemplazado)) return mensaje;
        return { ...mensaje, widgets: mensaje.widgets.map((widget): Widget => (widget.tipo === "plan" ? { ...widget, reemplazado: true } : widget)) };
      });
    });
    setSugerenciasCambio(null);
    pedirLlegada(mensajeId);
    setAnuncio("Tu plan está listo");
  }

  /**
   * «Ajustar mi plan»: el plan que Python rehizo queda en la MISMA tarjeta (no es una versión nueva) y su mensaje, que
   * viaja en el historial, dice el ajuste («Ajusté: más rosado…») para que «Cambiar algo» parta de lo que se ve. Solo
   * se publica sobre el plan en que se hizo: si entretanto llegó otro, el ajuste no lo pisa.
   */
  function ajustarPlan(mensajeId: string, plan: PlanGuiado, cotizacionCruda: unknown, { descripcion, baseHash }: AjustePublicado): void {
    const vigente = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!vigente || vigente.reemplazado || vigente.plan.plan_hash !== baseHash) return;
    const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacionCruda);
    const cotizacion = precio.success ? { ...precio.data, lineas: precio.data.lineas.map((linea) => ({ ...linea, nombre: nombreLineaCliente(linea) })) } : undefined;
    const armado = generarPasosPlan(plan);
    const resumen = resumenPlanGuiado(plan);
    setMensajes((actuales) => actuales.map((mensaje) => {
      const actual = mensaje.id === mensajeId ? planDelMensaje(mensaje) : undefined;
      if (!actual || actual.reemplazado || actual.plan.plan_hash !== baseHash) return mensaje;
      // Ningún ajuste rehace el plan con el modelo (quitar una pieza o añadir un color tampoco): los de antes siguen en él.
      const ajustes = [...(actual.ajustes ?? []), descripcion.slice(0, 160)].slice(-4);
      const nuevo: WidgetPlan = {
        tipo: "plan", plan, pasos: armado.pasos, ajustes, totalAnterior: totalDePlan(actual.plan),
        ...(cotizacion ? { cotizacion } : {}),
        ...(actual.fotoInspiracion ? { fotoInspiracion: true } : {}),
        ...(actual.usoCosteo ? { usoCosteo: actual.usoCosteo } : {}),
        ...(actual.compraAbierta ? { compraAbierta: true } : {}),
        // La imagen era del plan de antes: «Ver cómo quedaría» vuelve a ser la acción principal.
        hechas: (actual.hechas ?? []).filter((hecha) => hecha !== "ver"),
      };
      return { ...mensaje, content: contenidoPlanAjustado(resumen, ajustes), widgets: mensaje.widgets?.map((widget): Widget => (widget.tipo === "plan" ? nuevo : widget)) };
    }));
    setImagenesLocales((actuales) => (mensajeId in actuales ? Object.fromEntries(Object.entries(actuales).filter(([id]) => id !== mensajeId)) : actuales));
    setAnuncio(`Listo: ${descripcion}. Tu plan tiene ${totalDePlan(plan)} globos.`);
  }

  async function aceptarPropuesta(propuesta: Propuesta, opciones: { mensajeId: string; desdeTurno?: boolean; reintento?: boolean; planAnterior?: PlanActualGuiado }): Promise<void> {
    if (cargandoRef.current && !opciones.desdeTurno) return;
    const { mensajeId, planAnterior } = opciones;
    registrarAccion("propuesta.aceptar", { mensajeId, desdeTurno: Boolean(opciones.desdeTurno), reintento: Boolean(opciones.reintento), propuesta });
    setFallo(null);
    setSeleccionada(null); setUso(null);
    actualizarMensaje(mensajeId, (mensaje) => ({ ...mensaje, content: propuesta.frase, widgets: [{ tipo: "propuesta", propuesta, estado: "resolviendo" }] }));
    const armar = (reintento: boolean) => ({
      schema_version: "chat.v1",
      messages: [{ role: "user", content: instruccionPlanGuiado(propuesta, { reintento, ...(planAnterior ? { planAnterior } : {}) }) }],
      brief: briefChatGuiado(propuesta.colores),
      // Piezas SIEMPRE individuales: el servidor separa cualquier estructura repetida y nombra cada pieza.
      piezasIndividuales: true,
    });
    const resultado = await ejecutarPlan(mensajeId, armar, Boolean(opciones.reintento));
    if (resultado.estado === "obsoleto") return;
    if (resultado.estado === "ok") colocarPlan(mensajeId, resultado.plan, resultado.cotizacion, false);
    else {
      actualizarMensaje(mensajeId, (mensaje) => ({ ...mensaje, widgets: [{ tipo: "propuesta", propuesta, estado: "fallo" }] }));
      const accion: AccionFallo = { tipo: "plan", propuesta, mensajeId, ...(planAnterior ? { planAnterior } : {}) };
      setFallo(resultado.estado === "detenido"
        ? { titulo: "Detuviste la respuesta", detalle: "Puedes pedir el plan otra vez cuando quieras.", etiqueta: "Preparar el plan", accion, mensajeId }
        : { titulo: "No pude terminar tu plan", detalle: "Tu conversación sigue guardada.", accion, alternativas: ["otros-colores", "otra-pieza"], mensajeId });
      setAnuncio("No pude terminar tu plan");
    }
    terminarPlan(resultado.turno, mensajeId);
  }

  /** «Sí, armémoslo» con la lectura de una foto. `mensajeId` es el del plan cuando se reintenta. */
  async function aceptarPlanFoto(referenciaId: string, opciones?: { mensajeId?: string }): Promise<void> {
    if (cargandoRef.current) return;
    const origen = mensajes.find((mensaje) => mensaje.id === referenciaId);
    if (!origen?.referencia) return;
    const referencia = origen.referencia;
    const imagen = fotosRef.current.get(referenciaId);
    registrarAccion("foto.armar_plan", { referenciaId, colores: referencia.colores.map((color) => color.nombre), conFoto: Boolean(imagen) });
    limpiarAvisos();
    setSeleccionada(null); setUso(null);
    let mensajeId = opciones?.mensajeId;
    if (!mensajeId) {
      mensajeId = nuevoId();
      agregar([
        { id: nuevoId(), role: "user", content: "Sí, armémoslo." },
        { id: mensajeId, role: "assistant", content: "Preparo el plan con las piezas y los colores de tu foto." },
      ]);
      pedirFinal();
    }
    const idPlan = mensajeId;
    const colores = referencia.colores.map((color) => color.nombre);
    const armar = (reintento: boolean) => ({
      schema_version: "chat.v1",
      // Primer intento: el MISMO texto que manda la clásica con una foto sola (`MENSAJE_SOLO_REFERENCIAS`), y el plan sale
      // de la lectura como en la clásica. Con «usa EXACTAMENTE estos colores» la guiada perdía el transparente y el cromado
      // de la foto (2026-10-06). A propósito distinto: la guiada no conversa la aprobación, así que pide confirmar ya; los
      // colores que el cliente vio van solo en el brief, como dato. El reintento (plan sin confirmar o defectuoso) usa la
      // instrucción guiada con esos colores.
      messages: [{ role: "user", content: reintento ? instruccionPlanFoto({ reintento, colores }) : `${MENSAJE_SOLO_REFERENCIAS}\n${CONFIRMAR_PLAN_FOTO}` }],
      brief: briefChatGuiado(colores),
      creatividad: CREATIVIDAD_POR_DEFECTO,
      ...(imagen ? { imagenesReferencia: [imagen] } : {}),
      referenceBlueprint: referencia.blueprint,
      // Dos columnas de la foto son dos piezas: el servidor separa la pareja en espejo («Columna izquierda» y «derecha»).
      piezasIndividuales: true,
    });
    const resultado = await ejecutarPlan(idPlan, armar, false);
    if (resultado.estado === "obsoleto") return;
    if (resultado.estado === "ok") {
      if (imagen) fotosRef.current.set(idPlan, imagen);
      colocarPlan(idPlan, resultado.plan, resultado.cotizacion, true);
      actualizarMensaje(referenciaId, (mensaje) => ({ ...mensaje, fotoArmada: true }));
    } else {
      setFallo(resultado.estado === "detenido"
        ? { titulo: "Detuviste la respuesta", detalle: "Puedes pedir el plan otra vez cuando quieras.", etiqueta: "Preparar el plan", accion: { tipo: "foto", referenciaId, mensajeId: idPlan }, mensajeId: idPlan }
        : { titulo: "No pude terminar tu plan", detalle: "Tu conversación sigue guardada.", accion: { tipo: "foto", referenciaId, mensajeId: idPlan }, mensajeId: idPlan });
      setAnuncio("No pude terminar tu plan");
    }
    terminarPlan(resultado.turno, idPlan);
  }

  // ── «Ver cómo quedaría» ──────────────────────────────────────────────────────────────────────────────────────
  async function verComoQuedaria(mensajeId: string): Promise<void> {
    if (imagenEnCursoRef.current) return;
    const widget = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!widget || widget.reemplazado) return;
    const sesion = sesionRef.current;
    imagenEnCursoRef.current = mensajeId;
    setImagenEnCurso(mensajeId);
    setFallo(null);
    actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, errorImagen: false }));
    const control = new AbortController();
    imagenControlRef.current = control;
    const reloj = window.setTimeout(() => control.abort("tiempo"), LIMITE_IMAGEN_MS);
    const plan = widget.plan;
    try {
      const referencia = widget.fotoInspiracion ? fotosRef.current.get(mensajeId) : undefined;
      // El mismo cuerpo que manda la clásica al aprobar (`cuerpoGeneracion`): productos y paquetes del plan, creatividad por
      // defecto y, si el plan salió de una foto, su lectura (blueprint). Sin la lectura el servidor no tenía la escenografía,
      // las cajas de cada pieza ni el encuadre de la foto, y FLUX unía las dos columnas en un arco (2026-10-06).
      // A propósito distinto de la clásica: el brief es el de esta conversación y la solicitud la descripción del plan.
      const cuerpo = cuerpoGeneracion({
        plan,
        ...fuentesDelPlan(plan),
        brief: { tipo_evento: brief.evento, colores: plan.plan.concepto.paleta, estilo: brief.tematica },
        solicitudUsuario: plan.plan.concepto.descripcion,
        imagenesReferencia: referencia ? [referencia] : [],
        blueprint: widget.fotoInspiracion ? lecturaDelPlan(mensajes, mensajeId)?.blueprint : undefined,
      });
      registrarAccion("imagen.pedir", { mensajeId, cuerpo: resumenCuerpoGeneracion(cuerpo) });
      const respuesta = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
      if (!respuesta.ok) throw new Error(`/api/generate respondió con estado ${respuesta.status}.`);
      const salida = ImagenGeneradaSchema.parse(await respuesta.json() as unknown);
      if (sesion !== sesionRef.current) return;
      // Se ve en el acto; el plan de la tarjeta (con su approval_token) no se toca.
      setImagenesLocales((actuales) => ({ ...actuales, [mensajeId]: salida.imagen }));
      actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, errorImagen: false, hechas: conHecha(actual.hechas, "ver") }));
      setAnuncio("La imagen de tu decoración está lista");
      void guardarImagen(salida.imagen).then((url) => {
        if (url && sesion === sesionRef.current) actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, imagen: url }));
      });
    } catch (causa) {
      if (sesion !== sesionRef.current) return;
      registrarFallo("imagen.fallo", causa, { mensajeId, plan_hash: plan.plan_hash });
      console.warn("[asistente-guiado] no se pudo dibujar la decoración", causa);
      // Sin tarjeta de error aparte: la del plan ya dice «No pude dibujarla esta vez» y su botón principal es «Reintentar imagen».
      actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, errorImagen: true }));
      setAnuncio("No pude dibujar la imagen");
    } finally {
      window.clearTimeout(reloj);
      if (imagenControlRef.current === control) imagenControlRef.current = null;
      if (imagenEnCursoRef.current === mensajeId) { imagenEnCursoRef.current = null; setImagenEnCurso(null); }
    }
  }

  // ── Acciones del plan (tarjeta, barra o pedidas al modelo) ───────────────────────────────────────────────────
  function accionPlan(accion: AccionPlan, mensajeId: string, origen: "tarjeta" | "barra" | "modelo" = "tarjeta"): void {
    const widget = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!widget || widget.reemplazado) return;
    registrarAccion("plan.accion", { accion, origen, mensajeId, plan_hash: widget.plan.plan_hash });
    if (accion !== "costear" && accion !== "comprar") limpiarAvisos();
    const delCliente = origen !== "modelo";
    switch (accion) {
      case "ver":
        void verComoQuedaria(mensajeId);
        if (origen !== "tarjeta") revelarEnTarjeta(mensajeId, '[role="status"]');
        return;
      case "costear":
        actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, usoCosteo: actual.usoCosteo ?? uso ?? "personal", hechas: conHecha(actual.hechas, "costear") }));
        if (origen !== "tarjeta") revelarEnTarjeta(mensajeId, '[role="radiogroup"]');
        return;
      case "comprar":
        actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, compraAbierta: origen === "tarjeta" ? !actual.compraAbierta : true, hechas: conHecha(actual.hechas, "comprar") }));
        if (origen !== "tarjeta") revelarEnTarjeta(mensajeId, '[aria-label="Comprar materiales"]');
        return;
      case "aprender": {
        const desglose = generarPasosPlan(widget.plan);
        const id = nuevoId();
        actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, hechas: conHecha(actual.hechas, "aprender") }));
        agregar([
          ...(delCliente ? [{ id: nuevoId(), role: "user" as const, content: "Quiero aprender a hacerlo" }] : []),
          { id, role: "assistant", content: "Así se arma, pieza por pieza.", widgets: [{ tipo: "pasos-plan", pasos: widget.pasos ?? desglose.pasos, guias: desglose.guias }] },
        ]);
        pedirVista(id);
        return;
      }
      case "contratar":
        actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, hechas: conHecha(actual.hechas, "contratar") }));
        preguntarCiudad("ciudad-decorador", delCliente ? "Quiero contratar un decorador" : null);
        return;
      case "cambiar":
        actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, hechas: conHecha(actual.hechas, "cambiar") }));
        setFallo(null);
        setSugerenciasCambio(sugerenciasDeCambio(widget.plan));
        pedirEscritura(PLACEHOLDER_CAMBIO);
        irAlFinal();
        return;
    }
  }

  function preguntarCiudad(tipo: PreguntaCiudad, textoCliente: string | null): void {
    limpiarAvisos();
    agregar([
      ...(textoCliente ? [{ id: nuevoId(), role: "user" as const, content: textoCliente }] : []),
      { id: nuevoId(), role: "assistant", content: tipo === "ciudad-decorador" ? "¿En qué ciudad será tu celebración?" : "¿En qué ciudad quieres comprar los globos?", rapidas: [...CIUDADES_PROVEEDORES, "Otra ciudad"].slice(0, 8), pregunta: tipo },
    ]);
    pedirFinal();
  }

  // ── Acciones locales (sin modelo) ────────────────────────────────────────────────────────────────────────────
  function elegirDecoracion(decoracion: DecoracionSempertex, mensajeId: string): void {
    if (cargandoRef.current) return;
    registrarAccion("idea.elegir", { id: decoracion.id, titulo: decoracion.titulo, mensajeId });
    limpiarAvisos();
    setSeleccionada(decoracion); setUso(null);
    actualizarWidget(mensajeId, "decoraciones", (widget) => ({ ...widget, elegidaId: decoracion.id }));
    agregar([
      { id: nuevoId(), role: "user", content: `Me gusta «${decoracion.titulo}».` },
      { id: nuevoId(), role: "assistant", content: `¡Buena elección! Esto es lo que lleva **${decoracion.titulo}**. ¿Qué te gustaría hacer ahora?`, widgets: [{ tipo: "seleccion", decoracion }, { tipo: "opciones" }] },
    ]);
    pedirFinal();
  }

  function elegirOpcion(opcion: OpcionGuiada, mensajeId?: string): void {
    if (cargandoRef.current) return;
    registrarAccion("opcion.elegir", { opcion, mensajeId: mensajeId ?? null });
    if (mensajeId) actualizarWidget(mensajeId, "opciones", (widget) => ({ ...widget, elegida: opcion }));
    if (opcion === "comprar" && seleccionada) {
      limpiarAvisos();
      agregar([
        { id: nuevoId(), role: "user", content: "Quiero comprar los materiales." },
        { id: nuevoId(), role: "assistant", content: `Puedes comprar los globos de **${seleccionada.titulo}** en la tienda en línea de Sempertex o con un distribuidor cerca de ti.`, widgets: [{ tipo: "comprar", decoracion: seleccionada }, { tipo: "opciones" }] },
      ]);
      pedirFinal();
      return;
    }
    if (opcion === "contratar") { preguntarCiudad("ciudad-decorador", "Quiero contratar un decorador"); return; }
    const textos: Record<Exclude<OpcionGuiada, "contratar">, string> = {
      costear: "Quiero saber cuánto cuestan los materiales.",
      comprar: "Quiero saber dónde comprar los materiales.",
      aprender: seleccionada ? `Quiero aprender a hacerlo: armar «${seleccionada.titulo}» paso a paso.` : "Quiero aprender a hacerlo paso a paso.",
    };
    void enviar(textos[opcion]);
  }

  function elegirUso(valor: Uso, mensajeId: string): void {
    if (cargandoRef.current) return;
    registrarAccion("uso.elegir", { uso: valor, mensajeId });
    actualizarWidget(mensajeId, "uso", (widget) => ({ ...widget, elegido: valor }));
    setUso(valor);
    void enviar(valor === "negocio" ? "Es para mi negocio." : "Es para uso personal.", { uso: valor });
  }

  function elegirTipo(tipo: "completa" | "individual", mensajeId: string): void {
    if (cargandoRef.current) return;
    registrarAccion("propuesta.tipo", { tipo, mensajeId });
    actualizarWidget(mensajeId, "pregunta-propuesta", (widget) => ({ ...widget, elegida: tipo === "completa" ? "Decoración completa" : "Pieza individual" }));
    if (tipo === "completa") { void enviar("Propónme algo para una decoración completa con varias piezas.", { alcance: "completa" }); return; }
    limpiarAvisos();
    agregar([
      { id: nuevoId(), role: "user", content: "Una pieza individual." },
      { id: nuevoId(), role: "assistant", content: "¿Qué pieza individual prefieres?", widgets: [{ tipo: "pregunta-propuesta", alcance: "pieza" }] },
    ]);
    pedirFinal();
  }

  function elegirPieza(pieza: { etiqueta: string; estructura: EstructuraOficialId | null }, mensajeId: string): void {
    if (cargandoRef.current) return;
    registrarAccion("propuesta.pieza", { pieza: pieza.etiqueta, estructura: pieza.estructura, mensajeId });
    actualizarWidget(mensajeId, "pregunta-propuesta", (widget) => ({ ...widget, elegida: pieza.etiqueta }));
    void enviar(`Propónme una pieza individual: ${pieza.etiqueta}.`, { alcance: "individual", ...(pieza.estructura ? { pieza: pieza.estructura } : {}) });
  }

  function ningunaMeConvence(): void {
    if (cargandoRef.current) return;
    registrarAccion("idea.ninguna");
    limpiarAvisos();
    agregar([
      { id: nuevoId(), role: "user", content: "Ninguna me convence." },
      { id: nuevoId(), role: "assistant", content: "Sin problema. ¿Te propongo algo a la medida o prefieres mostrarme una foto que te guste?", rapidas: [PROPONME, "Subir una foto", "Ver otros estilos"], destacadas: [PROPONME] },
    ]);
    pedirFinal();
  }

  function otraCelebracion(): void {
    registrarAccion("chip.otra_celebracion");
    limpiarAvisos();
    agregar([
      { id: nuevoId(), role: "user", content: "Otra celebración" },
      { id: nuevoId(), role: "assistant", content: "¡Me encanta! ¿Qué vas a celebrar?", rapidas: OTRAS_CELEBRACIONES },
    ]);
    pedirFinal();
  }

  function solicitarProveedor(proveedor: ProveedorSempertex, mensajeId: string): void {
    const decorador = proveedor.tipo === "decorador_happia" || proveedor.tipo === "mbp";
    registrarAccion("proveedor.elegir", { id: proveedor.id, nombre: proveedor.nombre, tipo: proveedor.tipo, mensajeId });
    actualizarWidget(mensajeId, "proveedores", (widget) => ({ ...widget, solicitadoId: proveedor.id }));
    limpiarAvisos();
    const respuesta = decorador
      ? `Elegiste a **${proveedor.nombre}** para tu decoración. ¿Qué más quieres hacer mientras tanto?`
      : `En **${proveedor.nombre}** encuentras los globos de ${planVigente ? "tu plan" : "tu decoración"}.`;
    // La siguiente acción siempre a la vista: la barra del plan, las opciones de la idea o una salida para empezar.
    const siguiente: Partial<Mensaje> = planVigente ? {} : seleccionada ? { widgets: [{ tipo: "opciones" }] } : { rapidas: [PROPONME, "Ver ideas"], destacadas: [PROPONME] };
    agregar([
      { id: nuevoId(), role: "user", content: decorador ? `Elijo a ${proveedor.nombre}.` : `Quiero comprar en ${proveedor.nombre}.` },
      { id: nuevoId(), role: "assistant", content: respuesta, ...siguiente },
    ]);
    pedirFinal();
  }

  function elegirFoto(archivo: File | null): void {
    if (!archivo) { setFoto(null); setPlaceholderForzado(null); return; }
    registrarAccion("foto.elegir", { tipo: archivo.type, bytes: archivo.size, valida: TIPOS_FOTO.has(archivo.type) && archivo.size <= 6_000_000 });
    if (!TIPOS_FOTO.has(archivo.type) || archivo.size > 6_000_000) {
      setFoto(null);
      setFallo({ titulo: "No pude leer tu foto", detalle: "Usa una foto JPG, PNG o WebP de menos de 6 MB.", etiqueta: "Elegir otra foto", accion: { tipo: "subir-foto" } });
      irAlFinal();
      return;
    }
    setFallo(null);
    setFoto(archivo);
    pedirEscritura("Envíala o cuéntame qué te gusta de ella…");
  }

  function elegirRapida(texto: string): void {
    const clave = claveTexto(texto);
    const mensaje = ultimo?.role === "assistant" ? ultimo : undefined;
    registrarAccion("chip.respuesta_rapida", { texto });
    if (clave === claveTexto("Subir una foto") || clave === claveTexto(CHIP_FOTO)) { archivoRef.current?.click(); return; }
    if (clave === "otra ciudad") { pedirEscritura(PLACEHOLDER_CIUDAD); return; }
    if (clave === claveTexto("Otra celebración")) { otraCelebracion(); return; }
    if (mensaje?.pregunta) { void enviar(textoBusquedaCiudad(mensaje.pregunta, texto, Boolean(planVigente))); return; }
    if (clave === "ver ideas") { void enviar("Muéstrame ideas de decoración para mi celebración."); return; }
    // Sugerencias de «Cambiar algo».
    if (clave === "otros colores") { setSugerenciasCambio(null); pedirEscritura(PLACEHOLDER_CAMBIO, "Quiero otros colores: "); return; }
    if (clave === "quitar una pieza") { setSugerenciasCambio(null); pedirEscritura(PLACEHOLDER_CAMBIO, "Quítale "); return; }
    if (clave === "agregar una pieza") { void enviar("Agrégale una pieza que combine con lo que tengo."); return; }
    if (clave === "hacerla mas grande") { void enviar("Hazla más grande."); return; }
    if (clave === "hacerla mas sencilla") { void enviar("Hazla más sencilla, con menos globos."); return; }
    const opcion = seleccionada ? OPCIONES_GUIADAS.find((item) => claveTexto(item.titulo) === clave) : undefined;
    if (opcion) { elegirOpcion(opcion.id); return; }
    void enviar(texto);
  }

  function reintentar(accion: AccionFallo): void {
    registrarAccion("fallo.reintentar", { tipo: accion.tipo, ...(accion.tipo === "turno" ? { texto: accion.texto } : {}) });
    switch (accion.tipo) {
      case "turno": void enviar(accion.texto, { ...accion.opciones, reintentar: true }); return;
      case "plan": void aceptarPropuesta(accion.propuesta, { mensajeId: accion.mensajeId, ...(accion.planAnterior ? { planAnterior: accion.planAnterior } : {}) }); return;
      case "foto": void aceptarPlanFoto(accion.referenciaId, { mensajeId: accion.mensajeId }); return;
      case "subir-foto": setFallo(null); archivoRef.current?.click(); return;
    }
  }

  function alternativa(tipo: AlternativaFallo): { etiqueta: string; onElegir: () => void } {
    if (tipo === "otros-colores") return { etiqueta: "Usar otros colores", onElegir: () => { setFallo(null); pedirEscritura(PLACEHOLDER_CAMBIO, "Quiero otros colores: "); } };
    return { etiqueta: "Elegir otra pieza", onElegir: () => { setFallo(null); void enviar(PROPONME); } };
  }

  function tarjetaFallo(actual: Fallo): ReactNode {
    return <TarjetaError
      titulo={actual.titulo}
      {...(actual.detalle ? { detalle: actual.detalle } : {})}
      {...(actual.etiqueta ? { reintentarEtiqueta: actual.etiqueta } : {})}
      onReintentar={() => reintentar(actual.accion)}
      onCerrar={() => setFallo(null)}
      {...(actual.alternativas?.length ? { alternativas: actual.alternativas.map(alternativa) } : {})}
    />;
  }

  // ── Pintado de widgets ───────────────────────────────────────────────────────────────────────────────────────
  function renderWidget(widget: Widget, activo: boolean, clave: string, mensaje: Mensaje, indice: number): ReactNode {
    const mensajeId = mensaje.id;
    switch (widget.tipo) {
      case "decoraciones": {
        // Solo la elegida EN ESTE carrusel: con «otras ideas» que repetían la ya elegida, el carrusel nuevo salía marcado y sin
        // botones (ni «Me gusta esta» ni las salidas de abajo), un callejón sin salida.
        const elegidaId = widget.elegidaId ?? null;
        return <CarruselDecoraciones key={clave} decoraciones={widget.decoraciones} activo={activo && !elegidaId} elegidaId={elegidaId} onElegir={(decoracion) => elegirDecoracion(decoracion, mensajeId)} onNinguna={ningunaMeConvence} onProponer={() => void enviar(PROPONME)} onSubirFoto={() => archivoRef.current?.click()} />;
      }
      case "seleccion":
        return <TarjetaEleccion key={clave} decoracion={widget.decoracion} />;
      case "opciones":
        return <ChipsOpciones key={clave} activo={activo && !widget.elegida} elegida={widget.elegida ?? null} hechas={hechasOpciones} deshabilitado={cargando} onElegir={(opcion) => elegirOpcion(opcion, mensajeId)} />;
      case "uso":
        return <PreguntaUso key={clave} activo={activo && !widget.elegido} elegido={widget.elegido ?? null} deshabilitado={cargando} onElegir={(valor) => elegirUso(valor, mensajeId)} />;
      case "cotizacion":
        return <CostosMateriales key={clave} cotizacion={widget.cotizacion} decoracion={widget.decoracion} uso={widget.uso} clave={`guiado-${widget.decoracion.id}`} mensajePendiente="Todavía no tengo el precio de estos materiales. Puedo buscarte un proveedor cerca." onProveedores={() => preguntarCiudad("ciudad-decorador", "Quiero cotizar con un proveedor cerca")} />;
      case "pasos":
        return <PasoAPaso key={clave} decoracion={widget.decoracion} />;
      case "pasos-plan":
        return <GuiaPlan key={clave} pasos={widget.pasos} guias={widget.guias} />;
      case "pregunta-propuesta":
        return <PreguntaPropuesta key={clave} alcance={widget.alcance} activo={activo && !widget.elegida} deshabilitado={cargando} elegida={widget.elegida ?? null} onTipo={(tipo) => elegirTipo(tipo, mensajeId)} onPieza={(pieza) => elegirPieza(pieza, mensajeId)} />;
      case "proveedores": {
        const anterior = mensajes[indice - 1];
        const tipoBuscado = anterior?.role === "user" && /distribuidor/i.test(anterior.content) ? "distribuidor" : "decorador";
        const tipoPregunta: PreguntaCiudad = tipoBuscado === "distribuidor" ? "ciudad-distribuidor" : "ciudad-decorador";
        const hacerloYo = planVigente ? () => accionPlan("aprender", planVigente.mensajeId, "barra") : seleccionada ? () => elegirOpcion("aprender") : undefined;
        return <TarjetasProveedores key={clave} proveedores={widget.proveedores} activo={activo} solicitadoId={widget.solicitadoId ?? null} ciudadesDisponibles={widget.ciudadesDisponibles ?? (widget.proveedores.length ? [] : CIUDADES_PROVEEDORES)} tipoBuscado={tipoBuscado} onSolicitar={(proveedor) => solicitarProveedor(proveedor, mensajeId)} onElegirCiudad={(ciudad) => void enviar(textoBusquedaCiudad(tipoPregunta, ciudad, Boolean(planVigente)))} onHacerloYo={hacerloYo} />;
      }
      case "comprar":
        return <ComprarMateriales key={clave} decoracion={widget.decoracion} onDistribuidor={() => preguntarCiudad("ciudad-distribuidor", "Quiero comprar con un distribuidor cerca")} />;
      case "propuesta": {
        // Una propuesta «resolviendo» sin nada en curso (p. ej. tras recargar) es un plan que no llegó.
        const estado = widget.estado === "fallo" || !cargando ? "fallo" : "resolviendo";
        return <TarjetaPropuesta key={clave} frase={widget.propuesta.frase} piezas={widget.propuesta.piezas} colores={widget.propuesta.colores} estado={estado} {...(etapaPlan[mensajeId] ? { etapa: etapaPlan[mensajeId] } : {})} />;
      }
      case "plan": {
        const vigente = !widget.reemplazado;
        const imagen = imagenesLocales[mensajeId] ?? widget.imagen ?? null;
        const estadoImagen: EstadoImagen = imagenEnCurso === mensajeId ? "cargando" : widget.errorImagen ? "error" : imagen ? "lista" : "nada";
        return <div key={clave} className="w-full">
          <TarjetaPlan
            plan={widget.plan}
            {...(widget.cotizacion ? { cotizacion: widget.cotizacion } : {})}
            imagen={imagen}
            estadoImagen={estadoImagen}
            usoCosteo={widget.usoCosteo ?? null}
            compraAbierta={Boolean(widget.compraAbierta)}
            vigente={vigente}
            ocupado={cargando || imagenEnCurso !== null}
            hechas={widget.hechas ?? []}
            {...(widget.totalAnterior !== undefined ? { totalAnterior: widget.totalAnterior } : {})}
            contextoCompra={brief}
            onAccion={(accion) => accionPlan(accion, mensajeId, "tarjeta")}
            onCosteo={(valor) => { registrarAccion("plan.costeo_uso", { uso: valor, mensajeId }); actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, usoCosteo: valor, hechas: conHecha(actual.hechas, "costear") })); }}
            onProveedores={() => preguntarCiudad("ciudad-decorador", "Quiero cotizar con un proveedor cerca")}
            onDistribuidor={() => preguntarCiudad("ciudad-distribuidor", "Quiero comprar con un distribuidor cerca")}
            {...(widget.ajustes?.length ? { ajustes: widget.ajustes } : {})}
            {...(vigente ? {
              onPlanAjustado: (nuevo: PlanGuiado, cotizacionNueva: unknown, ajuste: AjustePublicado) => ajustarPlan(mensajeId, nuevo, cotizacionNueva, ajuste),
            } : {})}
          />
        </div>;
      }
    }
  }

  function contenidoAsistente(mensaje: Mensaje, indice: number): ReactNode {
    const activo = indice === indiceActivo && !cargando;
    const transmitiendo = transmitiendoId === mensaje.id;
    // Con la propuesta o el plan, la tarjeta ya lo dice todo: el texto (que sí viaja en el historial) no se repite.
    const conTarjeta = mensaje.widgets?.some((widget) => widget.tipo === "propuesta" || widget.tipo === "plan") ?? false;
    const texto = conTarjeta ? "" : separarOpciones(mensaje.content).texto;
    const propuestaFallida = mensaje.widgets?.find((widget) => widget.tipo === "propuesta" && (widget.estado === "fallo" || !cargando));
    const falloPropio = fallo?.mensajeId === mensaje.id ? fallo
      // Tras recargar a mitad de un plan no hay fallo guardado: se deriva para que siempre haya un «Reintentar».
      : !fallo && indice === indiceActivo && propuestaFallida?.tipo === "propuesta" && !cargando
        ? { titulo: "No pude terminar tu plan", detalle: "Tu conversación sigue guardada.", accion: { tipo: "plan", propuesta: propuestaFallida.propuesta, mensajeId: mensaje.id, ...(planVigente ? { planAnterior: planActualDesdePlan(planVigente.widget.plan) ?? undefined } : {}) }, alternativas: ["otros-colores", "otra-pieza"] } satisfies Fallo
        : null;
    return <>
      {texto.trim()
        ? <div className={transmitiendo ? CARET : undefined}><Markdown>{texto}</Markdown></div>
        : !mensaje.widgets?.length && transmitiendo ? <IndicadorEscribiendo fase={analizandoFoto ? "foto" : "respuesta"} /> : null}
      {mensaje.referencia && (
        <ReferenciaInspiracion
          miniatura={mensaje.miniatura ?? PIXEL_VACIO}
          referencia={mensaje.referencia}
          activo={!mensaje.fotoArmada && indice === ultimoIndiceConReferencia(mensajes)}
          deshabilitado={cargando}
          onArmar={() => void aceptarPlanFoto(mensaje.id)}
          onVerIdeas={() => void enviar(`Muéstrame ideas parecidas a mi foto: ${mensaje.referencia!.frase}`.slice(0, 600))}
        />
      )}
      {etapaPlan[mensaje.id] && !mensaje.widgets?.some((widget) => widget.tipo === "propuesta" || widget.tipo === "plan") && <EsqueletoPlan etapa={etapaPlan[mensaje.id]!} />}
      {mensaje.widgets?.map((widget, posicion) => renderWidget(widget, activo, `${mensaje.id}-${posicion}`, mensaje, indice))}
      {falloPropio && tarjetaFallo(falloPropio)}
    </>;
  }

  const falloSuelto = fallo && (!fallo.mensajeId || !mensajes.some((mensaje) => mensaje.id === fallo.mensajeId)) ? fallo : null;
  const barraVisible = Boolean(planVigente && ultimoAsistente && ultimoAsistente.id !== planVigente.mensajeId);
  const totalVigente = useMemo(() => (planVigente ? totalDePlan(planVigente.widget.plan) : 0), [planVigente]);

  return <main className="app-shell h-dvh overflow-hidden">
    <CabeceraApp contexto={contexto} modoVista={modo} onModoVista={cambiar} onLimpiar={vaciar} limpiarDeshabilitado={!mensajes.length} totalSeleccion={0} ocultarModoDev />
    <section className="relative flex min-h-0 flex-1 flex-col" aria-label="Asistente guiado">
      <div ref={contenedorRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div ref={contenidoRef} className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-6 pt-4 sm:px-6 sm:pt-8">
          <AnimatePresence initial={false}>
            {restaurado && !mensajes.length && (
              <motion.header
                key="bienvenida"
                variants={grupoConRitmo(0.08)}
                initial="oculto"
                animate="visible"
                exit={{ opacity: 0, y: -12, height: 0, marginBottom: 0, transition: { duration: 0.3, ease: EASE_SALIDA } }}
                className="mb-8 overflow-hidden text-center"
              >
                <motion.span variants={hijoEscalonado} className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-acento-suave text-acento">
                  <motion.span className="inline-flex" animate={reducido ? undefined : { y: [0, -4, 0], rotate: [0, -6, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}>
                    <Sparkles className="size-7" aria-hidden />
                  </motion.span>
                </motion.span>
                <motion.h1 variants={hijoEscalonado} className="text-balance text-3xl font-semibold tracking-tight text-texto sm:text-4xl">Diseñemos tu decoración con globos</motion.h1>
                <motion.p variants={hijoEscalonado} className="mx-auto mt-3 max-w-xl text-balance text-texto-suave">Te muestro ideas Sempertex para tu celebración y te digo qué globos necesitas, cuánto cuestan y cómo armarla.</motion.p>
              </motion.header>
            )}
          </AnimatePresence>

          <BurbujaAsistente mostrarAvatar transmitiendo={false}>
            <Markdown>{SALUDO}</Markdown>
            {restaurado && !mensajes.length && (
              <motion.div variants={grupoConRitmo(0.04, 0.1)} initial="oculto" animate="visible" role="group" aria-label="Qué vas a celebrar" className="mt-3 flex flex-wrap gap-2">
                {OPCIONES_SALUDO.map((opcion) => <ChipSaludo key={opcion.texto} icono={opcion.icono} deshabilitado={!hidratado} onClick={() => (opcion.texto === "Otra celebración" ? otraCelebracion() : void enviar(opcion.texto))}>{opcion.texto}</ChipSaludo>)}
                <ChipSaludo destacado icono={<ImagePlus className="size-4" aria-hidden />} deshabilitado={!hidratado} onClick={() => archivoRef.current?.click()}>{CHIP_FOTO}</ChipSaludo>
              </motion.div>
            )}
          </BurbujaAsistente>

          {/* Se monta con la conversación ya restaurada: con initial={false}, lo restaurado no se vuelve a animar. */}
          {restaurado && <AnimatePresence initial={false}>
            {mensajes.map((mensaje, indice) => {
              const anterior = mensajes[indice - 1];
              const separacion = !anterior || anterior.role !== mensaje.role ? "mt-5" : "mt-2";
              return <motion.div
                key={mensaje.id}
                layout="position"
                variants={mensaje.role === "user" ? entradaUsuario : entradaMensaje}
                initial={restaurados.has(mensaje.id) ? false : "oculto"}
                animate="visible"
                exit={{ opacity: 0, transition: { duration: DUR.corta } }}
                style={mensaje.role === "user" ? { transformOrigin: "100% 100%" } : undefined}
                className={separacion}
              >
                {mensaje.role === "user"
                  ? <>
                      <BurbujaUsuario id={mensaje.id} {...(mensaje.miniatura ? { miniatura: mensaje.miniatura } : {})}>{mensaje.content}</BurbujaUsuario>
                      {mensaje.notaFoto && <p role="status" className="ml-auto mt-1.5 max-w-64 text-right text-xs text-texto-suave">{mensaje.notaFoto}</p>}
                    </>
                  : <BurbujaAsistente id={mensaje.id} mostrarAvatar={anterior?.role !== "assistant"} transmitiendo={transmitiendoId === mensaje.id}>
                      {contenidoAsistente(mensaje, indice)}
                    </BurbujaAsistente>}
              </motion.div>;
            })}
          </AnimatePresence>}

          {falloSuelto && <div className="mt-5"><BurbujaAsistente mostrarAvatar transmitiendo={false}>{tarjetaFallo(falloSuelto)}</BurbujaAsistente></div>}

          {respuestasRapidas.opciones.length > 0 && (
            <div className="pl-11">
              <RespuestasRapidas opciones={respuestasRapidas.opciones} destacadas={respuestasRapidas.destacadas} deshabilitado={cargando || !hidratado} onElegir={elegirRapida} />
            </div>
          )}
        </div>
      </div>
      <BotonIrAlFinal visible={!pegado && mensajes.length > 0} hayNuevo={hayNuevo} onClick={() => (hayNuevo ? irALoNuevo() : irAlFinal())} />
    </section>
    <BarraPlanVigente
      visible={barraVisible}
      titulo={planVigente?.widget.plan.plan.concepto.titulo ?? ""}
      totalGlobos={totalVigente}
      ocupado={cargando || imagenEnCurso !== null}
      hechas={planVigente?.widget.hechas ?? []}
      onAccion={(accion) => { if (planVigente) accionPlan(accion, planVigente.mensajeId, "barra"); }}
      onIrAlPlan={() => { if (planVigente) mostrarMensaje(planVigente.mensajeId); }}
    />
    <Compositor
      valor={entrada}
      onCambiar={setEntrada}
      onEnviar={() => void enviar(entrada)}
      placeholder={placeholder}
      cargando={cargando}
      onDetener={detener}
      deshabilitado={!hidratado}
      foto={foto}
      onFoto={elegirFoto}
      textoRef={textoRef}
      archivoRef={archivoRef}
    />
    <p role="status" aria-live="polite" className="sr-only">{anuncio}</p>
  </main>;
}

function ChipSaludo({ children, icono, onClick, deshabilitado, destacado = false }: { children: string; icono: ReactNode; onClick: () => void; deshabilitado: boolean; destacado?: boolean }) {
  return <motion.button
    type="button"
    variants={hijoEscalonado}
    whileHover={deshabilitado ? undefined : { y: -1 }}
    whileTap={deshabilitado ? undefined : { scale: 0.95 }}
    disabled={deshabilitado}
    onClick={onClick}
    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[0.9rem] font-medium shadow-[0_1px_2px_var(--sombra)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50 ${destacado ? "border-acento/40 bg-superficie text-acento hover:border-acento hover:bg-acento-suave" : "border-borde bg-superficie text-texto hover:border-acento hover:bg-acento-suave hover:text-acento"}`}
  >
    <span className="text-acento">{icono}</span>
    <span className="whitespace-nowrap">{children}</span>
  </motion.button>;
}

// ── Funciones puras ────────────────────────────────────────────────────────────────────────────────────────────
/** Si la miniatura no se pudo crear, la lectura y «Sí, armémoslo» se muestran igual. */
const PIXEL_VACIO = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const TIPOS_FOTO: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

function buscarPlanVigente(lista: readonly Mensaje[]): { mensajeId: string; widget: WidgetPlan } | null {
  for (let indice = lista.length - 1; indice >= 0; indice -= 1) {
    const widget = lista[indice]!.widgets?.find((item): item is WidgetPlan => item.tipo === "plan" && !item.reemplazado);
    if (widget) return { mensajeId: lista[indice]!.id, widget };
  }
  return null;
}

function planDelMensaje(mensaje: Mensaje | undefined): WidgetPlan | undefined {
  return mensaje?.widgets?.find((item): item is WidgetPlan => item.tipo === "plan");
}

function ultimoIndiceConReferencia(lista: readonly Mensaje[]): number {
  for (let indice = lista.length - 1; indice >= 0; indice -= 1) if (lista[indice]!.referencia) return indice;
  return -1;
}

/**
 * La lectura de la foto de la que salió el plan de `mensajeId`: la última foto leída ANTES de ese mensaje («Sí, armémoslo»
 * siempre deja el plan después de su lectura). Vive en el mensaje guardado, así que sobrevive a recargar aunque la foto no.
 */
function lecturaDelPlan(lista: readonly Mensaje[], mensajeId: string): Mensaje["referencia"] {
  const indicePlan = lista.findIndex((mensaje) => mensaje.id === mensajeId);
  for (let indice = indicePlan - 1; indice >= 0; indice -= 1) if (lista[indice]!.referencia) return lista[indice]!.referencia;
  return undefined;
}

function totalDePlan(plan: PlanGuiado): number {
  try { return generarPasosPlan(plan).total; } catch { return 0; }
}

function conHecha(hechas: WidgetPlan["hechas"], accion: AccionPlan): NonNullable<WidgetPlan["hechas"]> {
  const actuales = hechas ?? [];
  return actuales.includes(accion) ? actuales : [...actuales, accion];
}

/** Sugerencias de «Cambiar algo» según lo que tiene el plan. */
function sugerenciasDeCambio(plan: PlanGuiado): string[] {
  const piezas = plan.plan.estructuras.length;
  return ["Otros colores", ...(piezas > 1 ? ["Quitar una pieza"] : []), "Agregar una pieza", "Hacerla más grande", "Hacerla más sencilla"];
}

function textoBusquedaCiudad(pregunta: PreguntaCiudad, ciudad: string, hayPlan: boolean): string {
  const lugar = ciudad.trim().replace(/[.!?]+$/, "");
  return pregunta === "ciudad-decorador"
    ? `Busca decoradores en ${lugar} para ${hayPlan ? "mi plan" : "mi decoración"}.`
    : `Busca un distribuidor de globos Sempertex en ${lugar}.`;
}

function leerSesion(): { mensajes: Mensaje[]; brief: BriefGuiado; seleccionada: DecoracionSempertex | null; uso: Uso | null } | null {
  try {
    const raw = sessionStorage.getItem(CLAVE_SESION);
    if (!raw) return null;
    const parsed = EstadoGuardadoSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) { console.warn("[asistente-guiado] sesión guardada inválida; se inicia una conversación nueva."); return null; }
    // Un plan que estaba en camino al recargar ya no va a llegar: la propuesta queda como fallida, con su «Reintentar».
    const mensajes = parsed.data.mensajes
      .filter((mensaje) => mensaje.content.trim() || mensaje.widgets?.length || mensaje.referencia)
      .map((mensaje) => (mensaje.widgets?.some((widget) => widget.tipo === "propuesta" && widget.estado !== "fallo")
        ? { ...mensaje, widgets: mensaje.widgets.map((widget): WidgetGuiado => (widget.tipo === "propuesta" ? { ...widget, estado: "fallo" } : widget)) }
        : mensaje));
    const seleccionada = parsed.data.seleccionadaId ? decoracionDeLaConversacion(mensajes, parsed.data.seleccionadaId) : null;
    return { mensajes, brief: parsed.data.brief ?? {}, seleccionada, uso: parsed.data.uso ?? null };
  } catch (cause) {
    console.warn("[asistente-guiado] no se pudo restaurar la conversación.", cause);
    return null;
  }
}

function decoracionDeLaConversacion(mensajes: readonly Mensaje[], id: string): DecoracionSempertex | null {
  for (const mensaje of [...mensajes].reverse()) for (const widget of mensaje.widgets ?? []) {
    if (widget.tipo === "decoraciones") { const encontrada = widget.decoraciones.find((decoracion) => decoracion.id === id); if (encontrada) return encontrada; }
    if ("decoracion" in widget && widget.decoracion.id === id) return widget.decoracion;
  }
  return null;
}

async function leerSse(respuesta: Response, alEvento: (evento: z.infer<typeof ChatSseEventV1Schema>) => void): Promise<void> {
  if (!respuesta.body) throw new Error("La respuesta llegó sin contenido.");
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = "";
  const procesar = (paquete: string) => {
    const linea = paquete.split("\n").find((item) => item.startsWith("data: "));
    if (!linea) return;
    let dato: unknown;
    try { dato = JSON.parse(linea.slice(6)) as unknown; } catch (cause) { throw new Error("El asistente envió una respuesta incompleta.", { cause }); }
    const evento = ChatSseEventV1Schema.safeParse(dato);
    if (!evento.success) throw new Error("La respuesta del asistente no cumple el contrato.");
    alEvento(evento.data);
  };
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    buffer += decodificador.decode(value, { stream: true });
    const paquetes = buffer.split("\n\n");
    buffer = paquetes.pop() ?? "";
    for (const paquete of paquetes) procesar(paquete);
  }
  buffer += decodificador.decode();
  if (buffer.trim()) procesar(buffer);
}

/** /api/chat (agente del plan): devuelve el plan y la cotización del «fin» y avisa de cada herramienta para el esqueleto. */
async function pedirPlanChat(cuerpo: Record<string, unknown>, signal: AbortSignal, alHerramienta: (nombre: string, estado: "ejecutando" | "lista", ok: boolean | undefined) => void): Promise<{ plan: unknown; cotizacion: unknown; reply: string }> {
  const respuesta = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal });
  if (!respuesta.ok || !respuesta.body) throw new Error(`/api/chat respondió con estado ${respuesta.status}.`);
  let plan: unknown;
  let cotizacion: unknown;
  let reply = "";
  await leerSse(respuesta, (evento) => {
    if (evento.type === "herramienta") alHerramienta(evento.nombre, evento.estado, evento.ok);
    else if (evento.type === "error") throw new Error(evento.error);
    else if (evento.type === "fin") { plan = evento.plan; cotizacion = evento.cotizacion; reply = evento.reply; }
  });
  return { plan, cotizacion, reply };
}

/** Lee la foto con /api/references/analyze; null si no se pudo o tardó más de 100 s (se sigue sin la lectura). */
async function analizarFoto(imagen: FotoInspiracion, senalTurno: AbortSignal): Promise<z.infer<typeof ReferenciaSchema> | null> {
  const control = new AbortController();
  const cortar = () => control.abort();
  senalTurno.addEventListener("abort", cortar);
  const reloj = window.setTimeout(cortar, LIMITE_FOTO_MS);
  try {
    const respuesta = await fetch("/api/references/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [imagen] }), signal: control.signal });
    if (!respuesta.ok) throw new Error(`/api/references/analyze respondió con estado ${respuesta.status}.`);
    const referencia = adaptarAnalisisReferencia(await respuesta.json() as unknown);
    const valida = ReferenciaSchema.safeParse(referencia);
    if (!valida.success) throw new Error("No se encontraron piezas en la foto.");
    return valida.data;
  } catch (causa) {
    if (senalTurno.aborted) throw causa;
    console.warn("[asistente-guiado] no se pudo leer la foto de inspiración.", causa);
    return null;
  } finally {
    window.clearTimeout(reloj);
    senalTurno.removeEventListener("abort", cortar);
  }
}

/** Guarda la imagen para esta sesión; si falla, la imagen sigue viéndose desde memoria. */
async function guardarImagen(imagen: string): Promise<string | null> {
  try {
    const respuesta = await fetch("/api/guiada-imagen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagen }) });
    if (!respuesta.ok) throw new Error(`/api/guiada-imagen respondió con estado ${respuesta.status}.`);
    return z.object({ url: z.string().startsWith("/api/guiada-imagen/") }).strict().parse(await respuesta.json() as unknown).url;
  } catch (causa) {
    console.warn("[asistente-guiado] la imagen se ve en esta sesión, pero no se pudo guardar.", causa);
    return null;
  }
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

async function leerFoto(archivo: File): Promise<FotoInspiracion> {
  const mime = archivo.type;
  if ((mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") || archivo.size > 6_000_000) throw new Error("La foto debe ser JPG, PNG o WebP y pesar menos de 6 MB.");
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  let binario = "";
  for (let inicio = 0; inicio < bytes.length; inicio += 0x8000) binario += String.fromCharCode(...bytes.subarray(inicio, inicio + 0x8000));
  return { mime, base64: btoa(binario) };
}

function suscribirNada(): () => void {
  return () => {};
}
