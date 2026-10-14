"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Baby, Cake, Church, CircleCheck, Crown, Heart, ImagePlus, RotateCcw, Sparkles } from "lucide-react";
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
import type { DatosAgregarIdea, EstadoAgregarIdea } from "./AgregarIdea";
import { estadoAgregarIdea, propuestaAgregarIdea } from "./agregar-idea";
import { TarjetasProveedores } from "./TarjetasProveedores";
import { ReferenciaInspiracion } from "./ReferenciaInspiracion";
import { acabadosFotoSinComprar } from "./acabados-foto-plan";
import { avisosFloresFotoSinComprar } from "@/lib/plan/flores-pieza";
import { lecturaFoto } from "./lectura-foto";
import { TarjetaPlan, type AccionPlan, type EstadoImagen } from "./TarjetaPlan";
import { cancelarPrecioIdea, empezarPrecioIdea, fijarPrecioIdea, precioIdeaDesdePlanVigente, resolverPrecioIdea, reutilizarPlanIdea, vistaPrecioIdea, type EstadoPrecioIdea, type PlanIdeaGuardado } from "./precio-idea-elegida";
import { accionIdeaAlElegirUso, avanzarOpcionIdea, estadoDelTurnoDeIdea, ideasTrasArmarIdea, marcarChipAlElegir, resultadoPlanIdea, rutaOpcionIdea, TEXTO_OPCION_IDEA, type AccionIdea, type EsperaOpcionIdea, type EventoOpcionIdea, type PasoOpcionIdea, type ResultadoPlanIdea } from "./opcion-idea";
import { respuestaPrecioPlan, SELECTOR_PRECIO_TOTAL } from "./precio-chat";
import { contenidoPlanAjustado } from "./ajuste/ajuste-plan-guiado";
import { usePublicarAjustePlan } from "./ajuste/publicar-ajuste-plan";
import { planDelMensaje, totalDePlan } from "./plan-del-mensaje";
import type { AjustePublicado } from "./ajuste/usarAjustePlanGuiado";
import { useDeshacerAjuste } from "./usarDeshacerAjuste";
import { agregarPiezaEnServidor, avisoEdicionChat, editarPiezaEnServidor, ejecutarEdicionChat, type DependenciasEdicionChat } from "./ajuste/edicion-chat-guiada";
import { agregarColorEnServidor, aplicarEnServidor, mensajeAjuste, quitarPiezaEnServidor, reemplazarColorEnServidor } from "./ajuste/ejecutar-ajuste";
import { armarBusqueda, LIMITE_MAXIMO } from "@/components/plan/ajuste/ajuste-propuesta";
import { pedirBusqueda } from "@/components/plan/ajuste/cliente-explorador";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { detectarPiezaNueva, IdeaElegidaSchema, LUGAR_EN_PALABRAS, PedidoEdicionPlanSchema, piezaIndefinida, type PedidoEdicionPlan, type PiezaNuevaChat } from "@/lib/ia/guiado/edicion-plan-chat";
import { TarjetaPropuesta } from "./TarjetaPropuesta";
import { TarjetaError } from "./TarjetaError";
import { PreguntaPropuesta } from "./PreguntaPropuesta";
import { GuiaPlan } from "./GuiaPlan";
import { BarraPlanVigente } from "./BarraPlanVigente";
import { Compositor } from "./Compositor";
import { FotosEjemploGuiada } from "./FotosEjemploGuiada";
import { fotoSubidaValida } from "./foto-subida";
import { BurbujaAsistente, BurbujaUsuario } from "./Burbujas";
import { CalificacionGuiada } from "./CalificacionGuiada";
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
import { BriefGuiadoSchema, CotizacionGuiadaSchema, CotizacionPlanGuiadoSchema, IdeaVisibleGuiadaSchema, PlanGuiadoSchema, PropuestaComposicionSchema, type BriefGuiado, type IdeaVisibleGuiada, type PlanActualGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { contextoClienteGuiado, entradaImagenGuiada, type ContextoClienteGuiado } from "@/lib/ia/guiado/contexto-cliente";
import { cargarFactorPlazoCliente, factorPlazoCliente } from "@/lib/ia/plazo-cliente";
import { prepararHistorialGuiado, sinUltimoTurnoGuiado } from "@/lib/ia/guiado/utilidades";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { prepararFotoReferencia } from "@/lib/imagen-cliente/preparar-foto";
import type { WidgetGuiado } from "@/lib/ia/guiado/widgets";
import { CLAVE_ACCIONES_IDEA, EstadoGuardadoSchema, juntarAccionesIdea, MAX_MENSAJES_GUARDADOS, PREPARANDO_PLAN_IDEA, ReferenciaSchema, separarAccionesIdea, sinEsperaTransitoria, type Mensaje } from "./estado-guardado";
import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import { coloresFaltantesPlanGuiado, cuerpoPlanGuiado, defectoPlanGuiado, referenciaDelPlan, resumenPlanGuiado, type ReferenciaDelPlan } from "@/lib/ia/guiado/instruccion-plan";
import { cuerpoPlanFoto, lecturaConPiezaNueva, planLlevaPiezaPedida } from "@/lib/ia/guiado/foto-con-pieza";
import { responderConsultaPlan } from "@/lib/ia/guiado/consulta-plan-chat";
import type { ColorFotoFaltante } from "@/lib/plan/colores-foto-plan";
import { lecturaSinRemateGrande, tieneRemateGrande } from "@/lib/ia/guiado/remate-foto";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { cuerpoGeneracion, fuentesDelPlan, resumenCuerpoGeneracion } from "@/lib/generacion/cuerpo-generacion";
// De /api/generate interesan la imagen y su aviso de lo no cotizado (el plan que devuelve no trae approval_token y el de
// la tarjeta sí): `ImagenGeneradaSchema` vive ahora en pedir-imagen.ts, con la recuperación ante cortes.
import { ErrorImagen, pedirImagenConRecuperacion, type ImagenObtenida } from "@/lib/generacion/pedir-imagen";
import { abrirConversacionGuiada, registrarAccionGuiada, registrarFalloGuiado, vaciarConversacionGuiada, type EstadoParaInstantanea } from "./registro-guiado";
import { AVISO_VERSION_NUEVA, CABECERA_VERSION_APP, RespuestaIncompatibleError, camposInvalidos, clasificarIncompatible, hayVersionNueva, idParaReintento, turnoSinRespuesta } from "./version-pagina";
import { borrarEstadoGuiado } from "./empezar-de-nuevo";
import { useMotorGuiada } from "./usarMotorGuiada";
import { useCorte3d } from "./useCorte3d";
import { claveDeWidget, useNoIncluidos } from "./useNoIncluidos";
import { avisarSiEsCorteDeLaImagen, sinAvisoDeCorte, TIPO_ACCION_RECALCULAR_3D } from "./aviso-corte-3d";
import { avisarAlCargarPlan } from "./avisar-corte-3d-al-cargar";
import { propuestaParaGuardar } from "./recalculo-3d";

import { TEXTO_IMAGEN_PLAN_3D } from "./Plan3DEnPreparacion";
import { falloDelPlan } from "./fallo-plan";
import { TEXTO_AVISO_DIBUJO_RECALCULO } from "@/lib/guiada-motor/mensajes-cliente";
import { NotasPlan } from "./NotasPlan";
import { pedirImagenPlan3D } from "./imagen-plan-3d";
import { mensajeErrorImagen } from "./mensaje-error-imagen";
import { firmaDePlan } from "./motor3d/firma-plan";
import { crearDependenciasEdicion3d } from "./edicion-motor3d";
import { planActualDelPlan } from "./plan-actual";
import { NoIncluidosSchema } from "@/lib/guiada-motor/no-incluidos";
import type { MotorGuiada } from "@/lib/guiada-motor/tipos";
import { ConfirmarEmpezarDeNuevo } from "./ConfirmarEmpezarDeNuevo";
import { borrarImagenesNavegador, borrarImagenNavegador, guardarImagenNavegador, leerImagenesNavegador } from "./imagenes-navegador";
import { marcarProducido } from "@/components/feedback-ia/producidos";

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
type Uso = "negocio" | "personal";
type FotoInspiracion = { base64: string; mime: "image/jpeg" | "image/png" | "image/webp" };
type PreguntaCiudad = "ciudad-decorador" | "ciudad-distribuidor";
type OpcionesEnvio = { uso?: Uso; reintentar?: boolean; alcance?: "completa" | "individual"; pieza?: EstructuraOficialId; accionIdea?: AccionIdea };

/** La idea de la biblioteca que trae un plan («Agregar al plan»): queda en el widget y dice «Está en tu plan». `sumada`: había plan. */
/** `avisos`: si el plan exacto de la idea no salió exacto, por qué (en palabras de cliente, de `/api/plan-idea`). */
type IdeaAgregada = { id: string; titulo: string; sumada: boolean; avisos?: string[] };
/** Qué repite «Reintentar»: se guarda la acción (no un cierre) para ejecutarla con el estado del momento del clic. */
type AccionFallo =
  | { tipo: "turno"; texto: string; opciones: OpcionesEnvio }
  | { tipo: "plan"; propuesta: Propuesta; mensajeId: string; planAnterior?: PlanActualGuiado; idea?: IdeaAgregada }
  | { tipo: "foto"; referenciaId: string; mensajeId: string; sinRemate?: boolean; piezaNueva?: PiezaNuevaChat }
  /** Un cambio del plan pedido por chat (`edicion-chat-guiada.ts`) que no salió: se repite ESE cambio, sin el modelo. */
  | { tipo: "edicion"; pedido: PedidoEdicionPlan; mensajeId: string }
  /** «Cuánto cuesta» / «Aprender» de una idea cuyo plan exacto no llegó: se pide ESE plan otra vez, sin el modelo. */
  | { tipo: "opcion-idea"; accion: AccionIdea; ideaId: string; usuarioId: string; mensajeId: string; opcionesId: string | null }
  /** «Recalcular mi plan» del aviso de corte del 3D (P-049): da el consentimiento y pide el plan de nuevo (Python, sin preguntar otra vez). */
  | { tipo: typeof TIPO_ACCION_RECALCULAR_3D; planHash: string; mensajeId: string }
  | { tipo: "subir-foto" }
  /** La página es de otro despliegue que el servidor (version-pagina.ts): recargar trae la nueva; la conversación queda. */
  | { tipo: "recargar" };
type AlternativaFallo = "otros-colores" | "otra-pieza" | "idea-parecida" | "otra-foto";
type Fallo = { titulo: string; detalle?: string; etiqueta?: string; accion: AccionFallo; alternativas?: AlternativaFallo[]; mensajeId?: string; variante?: "actualizar" };

const CLAVE_SESION = "demo_guiado_v2";
const ResultadoSchema = z.object({
  brief: BriefGuiadoSchema.optional(),
  decoraciones: z.array(DecoracionSempertexSchema).optional(),
  opciones: z.array(z.enum(["contratar", "costear", "comprar", "aprender"])).optional(),
  preguntaUso: z.boolean().optional(),
  cotizacion: z.unknown().optional(),
  noIncluidos: NoIncluidosSchema,
  uso: z.enum(["negocio", "personal"]).optional(),
  pasos: z.array(z.object({ orden: z.number().int().positive(), texto: z.string().min(1) }).strict()).optional(),
  proveedores: z.array(ProveedorSempertexSchema).optional(),
  propuesta: PropuestaComposicionSchema.optional(),
  ciudadProveedores: z.string().optional(),
  ciudadesDisponibles: z.array(z.string()).optional(),
  accionPlan: z.string().optional(),
}).passthrough();
const AccionModeloSchema = z.enum(["ver", "costear", "comprar", "aprender", "contratar"]);

const LIMITE_TURNO_MS = 75_000;
const LIMITE_PLAN_MS = 75_000;
/** El plan exacto de una idea solo pasa por Python (sin modelo): si tarda más, se arma por el camino de siempre. */
const LIMITE_PLAN_IDEA_MS = 40_000;
/**
 * Confirmaciones rechazadas que aguanta un intento de plan. El servidor ya repara solo lo reparable tras 2 rechazos
 * (`RECHAZOS_PARA_CONVERGER`): un tercero es que el catálogo no tiene lo que la lectura pide (ej04: un remate de 36"
 * dorado que no existe), y seguir solo gasta llamadas.
 */
const MAX_RECHAZOS_INTENTO = 3;
const LIMITE_IMAGEN_MS = 90_000;
// La lectura tarda 12-27 s en local y más en Vercel (va por el Python del VPS): con 12 s se cortaba siempre en
// producción, la guiada seguía sin la foto y adivinaba las piezas («un arco» donde había dos columnas; 2026-10-06).
const LIMITE_FOTO_MS = 100_000;

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
/**
 * «Genera la imagen», «hazme la foto», «quiero ver cómo quedaría» con un plan a la vista: vuelve a la tarjeta del plan y
 * lanza «Ver cómo quedaría» sin pasar por el modelo (dueño, 2026-10-07). Se compara sin tildes; una negación no cuenta.
 */
const PIDE_IMAGEN_LOCAL = /\b(?:genera(?:r|me|la)?|crea(?:r|me|la)?|haz(?:me|la)?|hacer|dibuja(?:r|me|la)?|muestra(?:r|me|la)?|ensena(?:r|me|la)?|quiero ver|ver|veamos|dame)\b[^.?!]{0,40}\b(?:imagen|imagenes|foto|render|como (?:se ve|se veria|quedaria|queda))\b/;
function pideImagenDelPlan(texto: string): boolean {
  const plano = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return !/\bno\b/.test(plano) && PIDE_IMAGEN_LOCAL.test(plano);
}
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

/** `versionPagina`: con qué código se sirvió la página (`versionCodigo().corta`); sin ella no se compara la del servidor. */
export function VistaGuiada({ versionPagina }: { versionPagina?: string } = {}) {
  const { modo, cambiar } = useModoVista();
  const reducido = useReducedMotion();
  const { planDePropuesta: planDePropuestaMotor, planDeIdea: planDeIdeaMotor } = useMotorGuiada();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [brief, setBrief] = useState<BriefGuiado>({});
  const [entrada, setEntrada] = useState("");
  const [cargando, setCargandoEstado] = useState(false);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [seleccionada, setSeleccionada] = useState<DecoracionSempertex | null>(null);
  const [precioIdea, setPrecioIdea] = useState<EstadoPrecioIdea | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [imagenEnCurso, setImagenEnCurso] = useState<string | null>(null);
  /** Imágenes ya pagadas, en memoria, por id del mensaje del plan: se ven en el acto aunque guardarlas falle. */
  const [imagenesLocales, setImagenesLocales] = useState<Readonly<Record<string, string>>>({});
  /** Los planes de antes de cada ajuste de un plan del 3D (solo en memoria), para «Deshacer» (REQ-016, P-042). */
  const deshacerAjuste = useDeshacerAjuste();
  const limpiarDeshacer = deshacerAjuste.limpiar;

  // Las imágenes guardadas en este navegador vuelven tras una recarga (el servidor no guarda ninguna).
  useEffect(() => {
    void cargarFactorPlazoCliente();
    void leerImagenesNavegador().then((guardadas) => {
      if (Object.keys(guardadas).length) setImagenesLocales((actuales) => ({ ...guardadas, ...actuales }));
    });
  }, []);
  const [etapaPlan, setEtapaPlan] = useState<Readonly<Record<string, EtapaPlan>>>({});
  const { noIncluidos, registrarNoIncluidos } = useNoIncluidos();
  const [foto, setFoto] = useState<File | null>(null);
  const [analizandoFoto, setAnalizandoFoto] = useState(false);
  const [transmitiendoId, setTransmitiendoId] = useState<string | null>(null);
  const [placeholderForzado, setPlaceholderForzado] = useState<string | null>(null);
  const [sugerenciasCambio, setSugerenciasCambio] = useState<string[] | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const ajustarPlan = usePublicarAjustePlan({
    mensajes, setMensajes, setImagenesLocales, setAnuncio,
    recordar: deshacerAjuste.recordar, decoracionDeLaConversacion,
  });
  /** La idea que se está sumando al plan («Agregar al plan»): su botón dice «Agregando a tu plan…». */
  const [agregandoId, setAgregandoId] = useState<string | null>(null);
  /** El plan (id de su mensaje) que se está cambiando por chat: su tarjeta muestra el esqueleto del recálculo. */
  const [editandoPlanId, setEditandoPlanId] = useState<string | null>(null);
  const [restaurado, setRestaurado] = useState(false);
  /** «Empezar de nuevo» del menú espera la confirmación, dentro de la página (sin diálogo del navegador). */
  const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
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
  /** El cliente pidió «Elegir otra pieza»: «Propónme algo» vuelve a preguntar la pieza aunque ya hubiera nombrado una. */
  const otraPiezaRef = useRef(false);
  const controlRef = useRef<AbortController | null>(null);
  const imagenControlRef = useRef<AbortController | null>(null);
  const imagenEnCursoRef = useRef<string | null>(null);
  /** «Genera la imagen» sin plan: el plan que había (o ninguno); al llegar uno distinto se dibuja su imagen. */
  const imagenTrasPlanRef = useRef<{ planPrevio: string | null } | null>(null);
  /** «Cuánto cuesta» / «Aprender» elegidos con una idea y sin plan: esperan el plan exacto de la idea en SU mensaje (opcion-idea.ts). */
  const esperaOpcionIdeaRef = useRef<EsperaOpcionIdea | null>(null);
  /** El plan exacto ya resuelto de la idea elegida (sin plan base): la tarjeta y el chip «Cuánto cuesta» dicen la misma cifra. */
  const planIdeaRef = useRef<PlanIdeaGuardado<Extract<Awaited<ReturnType<typeof planDeIdeaMotor>>, { ok: true }>> | null>(null);
  const fotosRef = useRef(new Map<string, FotoInspiracion>());
  const restauradoRef = useRef(false);
  const flujoRef = useRef<{ id: string; texto: string } | null>(null);
  const cuadroRef = useRef<number | null>(null);
  const vistaPendienteRef = useRef<{ tipo: "final"; instantaneo?: boolean } | { tipo: "mensaje" | "llegada"; id: string } | null>(null);

  const { pegado, hayNuevo, irAlFinal, mostrarMensaje, mostrarLlegada, irALoNuevo, seguirSiPegado } = useSeguirFinal({ contenedorRef, contenidoRef });

  const marcarCargando = useCallback((valor: boolean) => { cargandoRef.current = valor; setCargandoEstado(valor); }, []);

  // ── Derivados ────────────────────────────────────────────────────────────────────────────────────────────────
  const planVigente = useMemo(() => buscarPlanVigente(mensajes), [mensajes]);
  const idPlanVigente = planVigente?.mensajeId ?? null;
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
    // El rango que eligió («4 a 6 años»), no la edad que guardó el modelo («5 años»); y el uso si es para su negocio.
    const edad = cumple ? brief.edadTexto ?? (brief.edad ? `${brief.edad} años` : null) : null;
    const partes = [valido(brief.evento) ? brief.evento : null, edad, valido(brief.tematica) ? brief.tematica : null, uso === "negocio" ? "Para negocio" : null];
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
      // Un turno que se cortó (p. ej. «Hay una versión nueva… Recarga») vuelve con su «Reintentar»: antes el mensaje del
      // cliente quedaba sin respuesta y sin salida, y había que escribirlo otra vez (probador 124, hallazgo 2).
      const pendiente = turnoSinRespuesta(guardado.mensajes);
      if (pendiente) {
        const falloPendiente: Fallo = pendiente.miniatura
          ? { titulo: "Tu foto quedó sin leer", detalle: "Elígela otra vez para seguir.", etiqueta: "Elegir la foto", accion: { tipo: "subir-foto" } }
          : { titulo: "Tu último mensaje quedó sin respuesta", detalle: "Tu conversación sigue guardada.", accion: { tipo: "turno", texto: pendiente.content, opciones: pendiente.envio ?? {} } };
        setFallo(falloPendiente);
        registrarAccionGuiada("turno.pendiente_restaurado", { texto: pendiente.content.slice(0, 300), envio: pendiente.envio ?? null, conFoto: Boolean(pendiente.miniatura), versionPagina: versionPagina ?? null }, {
          mensajes: guardado.mensajes, brief: guardado.brief, seleccionada: guardado.seleccionada, uso: guardado.uso,
          planVigente: buscarPlanVigente(guardado.mensajes), cargando: false, fallo: falloPendiente,
        });
      }
    }
    setRestaurado(true);
    // Un plan del 3D abierto al cargar: si el corte está puesto, el aviso va ya, sin esperar a que el cliente pida un cambio.
    void avisarAlCargarPlan(guardado ? buscarPlanVigente(guardado.mensajes)?.widget ?? null : null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [versionPagina]);

  useEffect(() => {
    // Durante la transmisión no se guarda en cada fotograma: se guarda al terminar.
    if (!restaurado || transmitiendoId) return;
    try {
      const { mensajes: guardables, acciones } = separarAccionesIdea(sinEsperaTransitoria(mensajes, esperaOpcionIdeaRef.current?.mensajeId ?? null).slice(-MAX_MENSAJES_GUARDADOS));
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ mensajes: guardables, brief, seleccionadaId: seleccionada?.id ?? null, uso }));
      if (Object.keys(acciones).length) sessionStorage.setItem(CLAVE_ACCIONES_IDEA, JSON.stringify(acciones)); else sessionStorage.removeItem(CLAVE_ACCIONES_IDEA);
    }
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
  function agregar(nuevos: Mensaje[]): void { for (const mensaje of nuevos) if (mensaje.role === "assistant") marcarProducido(mensaje.id); setMensajes((actuales) => [...actuales, ...nuevos]); }
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
    esperaOpcionIdeaRef.current = avanzarOpcionIdea(esperaOpcionIdeaRef.current, { tipo: "reinicio" }).espera;
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
    void borrarImagenesNavegador();
    limpiarDeshacer();
    setImagenEnCurso(null); setImagenesLocales({}); setEtapaPlan({}); setAnalizandoFoto(false); setTransmitiendoId(null);
    setPlaceholderForzado(null); setSugerenciasCambio(null); setAnuncio(""); setEditandoPlanId(null); setAgregandoId(null);
    marcarCargando(false);
    setConfirmandoReinicio(false);
    try { sessionStorage.removeItem(CLAVE_SESION); sessionStorage.removeItem(CLAVE_ACCIONES_IDEA); } catch (cause) { console.warn("[asistente-guiado] no se pudo limpiar la sesión.", cause); }
    // Como una pestaña nueva: también los borradores del precio de negocio de esta vista (un plan con el mismo hash, como
    // el plan exacto de una idea, recuperaba el montaje y la ganancia de la conversación borrada).
    try { borrarEstadoGuiado(sessionStorage); } catch (cause) { console.warn("[asistente-guiado] no se pudieron limpiar los borradores del precio.", cause); }
    // Arriba de inmediato: con la posición del scroll de la conversación anterior, la pantalla quedaba en blanco unos 2 s
    // (verificador, 2026-10-06).
    contenedorRef.current?.scrollTo({ top: 0, behavior: "auto" });
    vaciarConversacionGuiada();
  }, [marcarCargando, limpiarDeshacer]);

  // ── Registro de acciones y fallos (auditoría del servidor; con la instantánea del estado, sin fotos) ─────────────
  function estadoRegistro(): EstadoParaInstantanea {
    return { mensajes, brief, seleccionada, uso, planVigente, cargando: cargandoRef.current, fallo };
  }
  function registrarAccion(evento: string, datos: Record<string, unknown> = {}): void { registrarAccionGuiada(evento, datos, estadoRegistro()); }
  function registrarFallo(evento: string, causa: unknown, datos: Record<string, unknown> = {}, nivel: "warn" | "error" = "error"): void { registrarFalloGuiado(evento, causa, datos, estadoRegistro(), nivel); }
  // El corte del 3D (P-049) vive en `useCorte3d`: el aviso al verlo y «Recalcular mi plan».
  const { recalcularPlan3d } = useCorte3d({ planVigente, cargandoRef, hayFallo: fallo !== null, setFallo, agregar, pedirFinal, registrarAccion, aceptarPropuesta });

  // ── «Empezar de nuevo» (menú «Más opciones»): se confirma dentro de la página y deja la vista como una pestaña nueva ──
  function pedirEmpezarDeNuevo(): void {
    registrarAccion("conversacion.empezar_de_nuevo.pedir", { mensajes: mensajes.length });
    setConfirmandoReinicio(true);
  }
  function confirmarEmpezarDeNuevo(): void {
    registrarAccion("conversacion.empezar_de_nuevo", { mensajes: mensajes.length, plan_hash: planVigente?.widget.plan.plan_hash ?? null, enCurso: cargandoRef.current });
    vaciar();
  }
  function cancelarEmpezarDeNuevo(): void {
    registrarAccion("conversacion.empezar_de_nuevo.cancelar", { mensajes: mensajes.length });
    setConfirmandoReinicio(false);
  }

  function detener(): void { controlRef.current?.abort("usuario"); }

  // ── Turno con el asistente guiado ────────────────────────────────────────────────────────────────────────────
  async function enviar(texto: string, opcionesEnvio: OpcionesEnvio = {}): Promise<void> {
    const archivo = foto;
    let limpio = texto.trim();
    if ((!limpio && !archivo) || cargandoRef.current) return;
    registrarAccion("turno.enviar", { texto: limpio, opciones: opcionesEnvio, conFoto: Boolean(archivo) });
    avanzarEspera({ tipo: "otra-accion" });
    limpiarAvisos();
    if (!limpio) limpio = "Mira esta foto de inspiración.";

    // «Propónme algo» se resuelve aquí mismo: la pregunta de tipo no necesita al modelo.
    if (!archivo && PROPONME_LOCAL.test(limpio)) {
      // El uso es del cliente, no de la idea: se conserva (no se le vuelve a preguntar; usabilidad 97, punto 2).
      setSeleccionada(null); setEntrada("");
      // La pieza que ya nombró («arco orgánico de unos 3 metros») no se le vuelve a preguntar (probador 124, hallazgo 4).
      if (proponerPiezaConocida("proponme")) return;
      agregar([
        { id: nuevoId(), role: "user", content: limpio },
        { id: nuevoId(), role: "assistant", content: PREGUNTA_TIPO, widgets: [{ tipo: "pregunta-propuesta", alcance: "tipo" }] },
      ]);
      pedirFinal();
      return;
    }

    // CRUD por chat (dueño, 2026-10-07). R · «¿qué lleva mi plan?», «¿cuántos globos tiene la columna izquierda?»: se
    // responde con el plan que se ve (las cifras que contó Python), sin modelo y sin cambiar nada.
    if (!archivo && planVigente && !opcionesEnvio.accionIdea && !opcionesEnvio.alcance && !opcionesEnvio.reintentar) {
      const respuesta = responderConsultaPlan(limpio, planVigente.widget.plan, planActualDelPlan(planVigente.widget.plan, planVigente.widget.motor));
      if (respuesta) {
        setEntrada("");
        agregar([
          { id: nuevoId(), role: "user", content: limpio.slice(0, 6000) },
          { id: nuevoId(), role: "assistant", content: respuesta.texto },
        ]);
        registrarAccion("plan.consulta_chat", { texto: limpio, consulta: respuesta.consulta, respuesta: respuesta.texto, plan_hash: planVigente.widget.plan.plan_hash });
        setAnuncio(respuesta.texto);
        pedirFinal();
        return;
      }
    }
    // «Genera la imagen» con un plan a la vista: a la tarjeta del plan y a generar, sin modelo (dueño, 2026-10-07).
    // Sin plan (o con una foto leída después del último): primero se arma el plan y, en cuanto llega, se dibuja su
    // imagen (`imagenTrasPlanRef`). Con la lectura de una foto, por el camino del plan con foto; si no, el modelo arma
    // el plan con lo conversado.
    const pideImagen = !archivo && !opcionesEnvio.alcance && !opcionesEnvio.reintentar && pideImagenDelPlan(limpio);
    const lecturaSinPlan = pideImagen ? lecturaPendiente(mensajes, planVigente?.mensajeId ?? null) : null;
    if (pideImagen && (!planVigente || lecturaSinPlan)) {
      imagenTrasPlanRef.current = { planPrevio: planVigente?.mensajeId ?? null };
      registrarAccion("plan.imagen_por_chat_sin_plan", { texto: limpio, referenciaId: lecturaSinPlan?.id ?? null, planPrevio: planVigente?.mensajeId ?? null });
      if (lecturaSinPlan) {
        setEntrada("");
        agregar([{ id: nuevoId(), role: "user", content: limpio.slice(0, 6000) }]);
        await aceptarPlanFoto(lecturaSinPlan.id);
        return;
      }
      limpio = "Arma mi plan con lo que hablamos y genera la imagen.";
    }
    if (pideImagen && planVigente && !lecturaSinPlan) {
      setEntrada("");
      const idPlan = planVigente.mensajeId;
      const yaEnCurso = imagenEnCursoRef.current === idPlan;
      const respuesta = yaEnCurso ? "Ya estoy dibujando la imagen de tu plan: aparece en su tarjeta." : "Listo, dibujo la imagen de tu plan: aparece en su tarjeta en unos 20 a 30 segundos (en casos raros, hasta unos 5 minutos).";
      agregar([
        { id: nuevoId(), role: "user", content: limpio.slice(0, 6000) },
        { id: nuevoId(), role: "assistant", content: respuesta },
      ]);
      registrarAccion("plan.imagen_por_chat", { texto: limpio, mensajeId: idPlan, yaEnCurso, plan_hash: planVigente.widget.plan.plan_hash });
      setAnuncio(respuesta);
      pedirVista(idPlan);
      if (!yaEnCurso) void verComoQuedaria(idPlan);
      return;
    }
    // C · Con la lectura de una foto pendiente (sin plan armado después de ella): «¿puedes agregar una guirnalda en medio?»
    // arma el plan con las piezas de la foto MÁS la pedida, por el camino del plan con foto. Antes iba al modelo, que
    // armaba un plan nuevo solo con la guirnalda y perdía las columnas.
    if (!archivo && !opcionesEnvio.alcance) {
      const lectura = lecturaPendiente(mensajes, planVigente?.mensajeId ?? null);
      const pieza = lectura ? detectarPiezaNueva(limpio) : null;
      if (lectura && pieza) {
        setEntrada("");
        registrarAccion("foto.sumar_pieza_chat", { texto: limpio, referenciaId: lectura.id, pieza });
        await aceptarPlanFoto(lectura.id, { piezaNueva: pieza, textoCliente: limpio.slice(0, 6000) });
        return;
      }
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
    const sesionTurno = sesionRef.current;
    const control = new AbortController();
    controlRef.current = control;
    const reloj = window.setTimeout(() => control.abort("tiempo"), LIMITE_TURNO_MS * factorPlazoCliente());
    // «Reintentar» repite el MISMO mensaje del cliente: conserva su burbuja (mismo id) en vez de quitarla y poner otra
    // igual, que se veía dos veces mientras la vieja salía (probador 124, hallazgo 14).
    const idUsuario = (opciones.reintentar ? idParaReintento(mensajes, contenido) : null) ?? nuevoId();
    const idAsistente = nuevoId();
    // Lo que viaja con el texto (uso, alcance, pieza): queda en el mensaje para repetirlo igual tras recargar.
    const accionIdea = seleccionada ? opciones.accionIdea : undefined;
    const envio: NonNullable<Mensaje["envio"]> = { ...(opciones.uso ? { uso: opciones.uso } : {}), ...(opciones.alcance ? { alcance: opciones.alcance } : {}), ...(opciones.pieza ? { pieza: opciones.pieza } : {}), ...(accionIdea ? { accionIdea } : {}) };
    const base = (opciones.reintentar ? sinUltimoTurnoGuiado(mensajes) : mensajes).filter((mensaje) => mensaje.content.trim().length > 0 || mensaje.widgets?.length || mensaje.referencia);
    const historial = prepararHistorialGuiado(base, `${contenido}${archivo ? "\nAdjunté una foto de inspiración." : ""}`);
    const usoEnvio = opciones.uso ?? uso ?? undefined;
    const planActual = planVigente ? planActualDelPlan(planVigente.widget.plan, planVigente.widget.motor) : null;
    const planAnterior = planActual ?? undefined;
    // Las ideas del último carrusel, en orden: «me quedo con la primera» la elige como «Me gusta esta» (elegir_idea).
    const ideasMostradas = ideasALaVista(mensajes);
    const estadoGuiado = estadoDelTurnoDeIdea({
      ...(seleccionada && !planVigente ? { decoracionId: seleccionada.id } : {}),
      ...(usoEnvio ? { uso: usoEnvio } : {}),
      ...(opciones.alcance ? { alcancePropuesta: opciones.alcance } : {}),
      ...(opciones.alcance === "individual" && opciones.pieza ? { piezaPedida: opciones.pieza } : {}),
      ...(planActual ? { planActual, ...(planVigente?.widget.motor === "3d" ? { motorPlan: "3d" as const } : {}) } : {}),
      ...(ideasMostradas.length ? { ideasMostradas } : {}),
      // El chip de la idea (o el uso elegido tras él): el servidor lo responde por reglas, sin modelo (D-043).
      ...(accionIdea ? { accionIdea } : {}),
    }, accionIdea, seleccionada?.id);
    const elegida = seleccionada && (accionIdea || !planVigente) ? seleccionada : null;
    // Funcional: conserva lo que la acción que llamó acaba de marcar (la opción elegida en su widget).
    setMensajes((actuales) => [
      ...(opciones.reintentar ? sinUltimoTurnoGuiado(actuales) : actuales).filter((mensaje) => mensaje.content.trim().length > 0 || mensaje.widgets?.length || mensaje.referencia),
      { id: idUsuario, role: "user", content: contenido, ...(Object.keys(envio).length ? { envio } : {}) },
      { id: idAsistente, role: "assistant", content: "" },
    ]);
    marcarProducido(idAsistente);
    setEntrada("");
    marcarCargando(true);
    setTransmitiendoId(idAsistente);
    setAnuncio("El asistente está escribiendo");
    pedirFinal();

    let propuestaParaPlan: Propuesta | null = null;
    let clienteTurno: ContextoClienteGuiado | null = null;
    let accionModelo: z.infer<typeof AccionModeloSchema> | null = null;
    /** Un cambio puntual del plan pedido por chat: se hace con el editor al terminar el turno, sin rehacer el plan. */
    let edicionDelTurno: PedidoEdicionPlan | null = null;
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
      // Otro despliegue respondió (la pestaña se abrió antes): su respuesta no se lee con el código de esta página, ni
      // siquiera un error (un 400 puede ser solo que el servidor nuevo ya no acepta la petición vieja).
      const versionServidor = respuesta.headers.get(CABECERA_VERSION_APP);
      if (hayVersionNueva(versionPagina, versionServidor)) {
        void respuesta.body?.cancel().catch(() => undefined);
        throw new RespuestaIncompatibleError("version", "El asistente respondió con otra versión de la página.", versionServidor);
      }
      if (!respuesta.ok || !respuesta.body) throw new Error(`El asistente respondió con estado ${respuesta.status}.`);
      let acumulado = "";
      await leerSse(respuesta, (evento) => {
        if (turno !== turnoRef.current) return;
        if (evento.type === "texto") { acumulado += evento.delta; empujarTexto(idAsistente, acumulado); return; }
        if (evento.type === "error") throw new Error(evento.error);
        if (evento.type !== "fin") return;
        cancelarFlujo();
        const resultado = ResultadoSchema.safeParse(evento.result ?? {});
        if (!resultado.success) throw new RespuestaIncompatibleError("contrato", "Los datos devueltos por el asistente no son válidos.", versionServidor, { campos: camposInvalidos(resultado.error) });
        const datos = resultado.data;
        if (datos.brief) setBrief(datos.brief);
        // El uso que dijo con sus palabras («soy decorador») o que ya eligió: «Cuánto cuesta» no lo vuelve a preguntar.
        const usoDicho = datos.uso ?? datos.brief?.uso;
        if (usoDicho) setUso(usoDicho);
        // Lo que dijo el cliente, con el brief recién guardado y su mensaje de este turno (el estado aún no los tiene).
        clienteTurno = contextoClienteGuiado(datos.brief ?? brief, [...textosDelCliente(base), contenido]);
        const widgets: Widget[] = [];
        if (datos.decoraciones?.length) widgets.push({ tipo: "decoraciones", decoraciones: datos.decoraciones });
        if (datos.preguntaUso && elegida) widgets.push({ tipo: "uso" });
        const usoCotizado = datos.uso ?? usoEnvio;
        if (elegida && usoCotizado && datos.cotizacion !== undefined) {
          const valida = datos.cotizacion == null ? null : CotizacionGuiadaSchema.safeParse(datos.cotizacion);
          if (valida && !valida.success) throw new RespuestaIncompatibleError("contrato", "La cotización recibida no cumple el contrato.", versionServidor, { campos: camposInvalidos(valida.error).map((campo) => `cotizacion.${campo}`) });
          widgets.push({ tipo: "cotizacion", cotizacion: valida ? valida.data : null, uso: usoCotizado, decoracion: elegida });
          if (accionIdea === "costear") planIdeaRef.current = null;
          setPrecioIdea((actual) => fijarPrecioIdea(actual, { ideaId: elegida.id, sesion: sesionTurno, sesionVigente: sesionRef.current, cotizacion: datos.cotizacion }));
          registrarNoIncluidos(claveDeWidget(idAsistente, widgets.length - 1), datos.noIncluidos);
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
        // «¿Cuánto me sale?»: el costeo se abre en la tarjeta del plan y la respuesta dice el total (no «Aquí tienes…»).
        const textoFinal = accion.success && accion.data === "costear" && planVigente
          ? respuestaPrecioPlan(planVigente.widget, planVigente.widget.usoCosteo ?? uso ?? "personal")
          : evento.reply.slice(0, 6000);
        // Un cambio puntual del plan (edicion-plan-chat.ts): se hace al terminar el turno con el editor; lo demás no cambia.
        const edicion = planVigente && datos.edicionPlan !== undefined ? PedidoEdicionPlanSchema.safeParse(datos.edicionPlan) : null;
        if (edicion?.success) edicionDelTurno = edicion.data;
        else if (edicion) registrarFallo("plan.edicion_chat.invalida", "el pedido de edición no cumple el contrato", { edicionPlan: datos.edicionPlan }, "warn");
        // La idea que eligió con palabras («me quedo con la primera»): lo mismo que «Me gusta esta».
        const ideaChat = datos.ideaElegida !== undefined ? IdeaElegidaSchema.safeParse(datos.ideaElegida) : null;
        const decoracionChat = ideaChat?.success ? decoracionDeLaConversacion(mensajes, ideaChat.data.id) : null;
        if (ideaChat && !decoracionChat) registrarFallo("idea.elegir_chat_sin_idea", "la idea elegida por chat no está en la conversación", { ideaElegida: datos.ideaElegida }, "warn");
        if (decoracionChat && !datos.propuesta) {
          marcarIdeaElegida(decoracionChat, mensajeDelCarrusel(mensajes, decoracionChat.id), { origen: "chat", posicion: ideaChat?.success ? ideaChat.data.posicion : null, texto: contenido });
          actualizarMensaje(idAsistente, (mensaje) => ({ ...mensaje, content: textoIdeaElegida(decoracionChat.titulo), widgets: [{ tipo: "seleccion", decoracion: decoracionChat }, { tipo: "opciones" }] }));
          pedirLlegada(idAsistente);
        } else if (edicionDelTurno) {
          // Mientras Python rehace el plan, la frase del modelo («Cambio el azul por celeste…») o el aviso de siempre.
          const aviso = avisoEdicionChat(edicionDelTurno);
          actualizarMensaje(idAsistente, (mensaje) => ({ ...mensaje, content: textoFinal.trim() ? textoFinal : aviso }));
        } else if (datos.propuesta) {
          propuestaParaPlan = datos.propuesta;
          setSeleccionada(null);
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
      // El cambio puntual, sobre el plan que se ve y con el editor (el resto del plan queda igual); «Detener» lo corta.
      if (edicionDelTurno && planVigente) await aplicarEdicionChat(edicionDelTurno, { planMensajeId: planVigente.mensajeId, base: planVigente.widget.plan, mensajeId: idAsistente, signal: control.signal });
      else if (propuestaParaPlan) await aceptarPropuesta(propuestaParaPlan, { mensajeId: idAsistente, desdeTurno: true, ...(planAnterior ? { planAnterior } : {}), ...(clienteTurno ? { cliente: clienteTurno } : {}) });
    } catch (causa) {
      if (turno !== turnoRef.current) return;
      cancelarFlujo();
      const detenido = control.signal.aborted && control.signal.reason === "usuario";
      const porTiempo = control.signal.aborted && control.signal.reason === "tiempo";
      // Una respuesta que el código de esta página no puede leer: otro despliegue (pedir recargar) o, con la misma versión,
      // un contrato roto (recargar no lo arregla: «Reintentar»). Antes las dos decían «Se cortó la conexión».
      const incompatible = !detenido && causa instanceof RespuestaIncompatibleError ? causa : null;
      const tipoIncompatible = incompatible ? clasificarIncompatible(incompatible, versionPagina) : null;
      const evento = etapa === "foto" ? "foto.fallo" : detenido ? "turno.detenido" : tipoIncompatible === "version-nueva" ? "turno.version_nueva" : tipoIncompatible === "contrato" ? "turno.contrato_invalido" : "sse.fallo";
      registrarFallo(evento, causa, {
        etapa, detenido, texto: contenido, cortadoPor: control.signal.aborted ? String(control.signal.reason) : null,
        ...(incompatible ? { motivo: incompatible.motivo, versionPagina: versionPagina ?? null, versionServidor: incompatible.versionServidor, campos: incompatible.campos } : {}),
      }, detenido || tipoIncompatible === "version-nueva" ? "warn" : "error");
      // warn y no error: en desarrollo, console.error abre el aviso rojo de Next en plena demo.
      if (!detenido) console.warn("[asistente-guiado] turno fallido", causa);
      // Si el cliente detuvo, se queda lo que alcanzó a llegar; si falló, el mensaje vacío o a medias se quita. El del
      // cliente se queda siempre: tras recargar vuelve con su «Reintentar» (`turnoSinRespuesta`).
      setMensajes((actuales) => actuales.filter((mensaje) => mensaje.id !== idAsistente || (detenido && (mensaje.content.trim() || mensaje.widgets?.length))));
      if (etapa === "foto" && !detenido) {
        setFallo({ titulo: "No pude leer tu foto", detalle: "Usa una foto JPG, PNG o WebP de menos de 6 MB.", etiqueta: "Elegir otra foto", accion: { tipo: "subir-foto" } });
      } else if (tipoIncompatible === "version-nueva") {
        setFallo({ titulo: AVISO_VERSION_NUEVA.titulo, detalle: AVISO_VERSION_NUEVA.detalle, etiqueta: AVISO_VERSION_NUEVA.etiqueta, accion: { tipo: "recargar" }, variante: "actualizar" });
      } else {
        // El título dice lo que pasó: la conexión solo si fue la red (fetch lanza TypeError), no un error del servidor.
        const titulo = detenido ? "Detuviste la respuesta"
          : tipoIncompatible === "contrato" ? "No pude leer la respuesta"
            : porTiempo ? "La respuesta tardó demasiado"
              : causa instanceof TypeError ? "Se cortó la conexión"
                : "No pude responder esta vez";
        setFallo({
          titulo,
          detalle: detenido ? "Puedes pedirla otra vez cuando quieras." : "Tu conversación sigue guardada.",
          accion: { tipo: "turno", texto: contenido, opciones: { ...opciones, reintentar: undefined } },
        });
      }
      setAnuncio(detenido ? "Respuesta detenida" : tipoIncompatible === "version-nueva" ? `${AVISO_VERSION_NUEVA.titulo}. ${AVISO_VERSION_NUEVA.detalle}` : "No pude responder");
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
  async function ejecutarPlan(mensajeId: string, armarCuerpo: (reintento: boolean, faltantes?: readonly ColorFotoFaltante[]) => Record<string, unknown>, soloReintento: boolean, coloresPedidos?: readonly string[]): Promise<{ turno: number } & ({ estado: "ok"; plan: PlanGuiado; cotizacion: unknown } | { estado: "detenido" } | { estado: "obsoleto" } | { estado: "fallo"; sinConverger?: true })> {
    const turno = ++turnoRef.current;
    const control = new AbortController();
    controlRef.current = control;
    marcarCargando(true);
    fijarEtapa(mensajeId, soloReintento ? "reintentando" : "preparando");
    let respaldo: { plan: PlanGuiado; cotizacion: unknown } | null = null;
    // Colores de la foto que perdió el primer plan: el reintento los pide uno por uno (`instruccionPlanFoto`).
    let faltantes: ColorFotoFaltante[] = [];
    let sinConverger = false;
    for (const reintento of soloReintento ? [true] : [false, true]) {
      // Un intento que no convergió (el catálogo rechazó el plan una y otra vez) no se repite igual: con la misma
      // lectura vuelve a fallar igual (ej04: 16 llamadas, ~65 s, US$0,125). Se ofrecen salidas en su lugar.
      if (reintento && sinConverger && !respaldo) break;
      if (reintento && !soloReintento) fijarEtapa(mensajeId, "reintentando");
      const intento = new AbortController();
      const cortar = () => intento.abort();
      control.signal.addEventListener("abort", cortar);
      const reloj = window.setTimeout(cortar, LIMITE_PLAN_MS * factorPlazoCliente());
      let rechazos = 0;
      try {
        const respuesta = await pedirPlanChat(armarCuerpo(reintento, faltantes), intento.signal, (nombre, estado, ok) => {
          if (turno !== turnoRef.current) return;
          // Tope de llamadas por intento: tras MAX_RECHAZOS_INTENTO confirmaciones rechazadas se corta la petición
          // (el servidor deja de llamar al modelo al abortarse) en vez de dejar que el modelo pruebe hasta 10 vueltas.
          if (nombre === "confirmar_plan_decoracion" && estado === "lista" && ok === false && ++rechazos >= MAX_RECHAZOS_INTENTO) {
            sinConverger = true;
            intento.abort();
            return;
          }
          const siguiente: EtapaPlan | null = nombre === "buscar_catalogo_rag" ? "buscando"
            : nombre === "confirmar_plan_decoracion" ? (estado === "ejecutando" ? "calculando" : ok !== false ? "precio" : null)
              : null;
          if (siguiente) avanzarEtapa(mensajeId, siguiente);
        });
        if (turno !== turnoRef.current) return { turno, estado: "obsoleto" };
        const plan = PlanGuiadoSchema.safeParse(respuesta.plan);
        if (plan.success) {
          const defecto = reintento ? null : defectoPlanGuiado(plan.data, respuesta.cotizacion, { ...(coloresPedidos ? { coloresPedidos } : {}) });
          if (!defecto) {
            registrarAccion("plan.listo", { intento: reintento ? 2 : 1, plan_hash: plan.data.plan_hash });
            return { turno, estado: "ok", plan: plan.data, cotizacion: respuesta.cotizacion };
          }
          faltantes = coloresFaltantesPlanGuiado(plan.data, { ...(coloresPedidos ? { coloresPedidos } : {}) });
          registrarFallo("plan.defecto", defecto, { intento: 1, plan_hash: plan.data.plan_hash, accion: "se pide otra vez", ...(faltantes.length ? { colores_faltantes: faltantes } : {}) }, "warn");
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
        if (sinConverger) registrarFallo("plan.no_converge", "el catálogo rechazó el plan varias veces en el mismo intento: se corta", { intento: reintento ? 2 : 1, rechazos, tope: MAX_RECHAZOS_INTENTO }, "warn");
        else registrarFallo("plan.intento_fallido", causa, { intento: reintento ? 2 : 1 }, "warn");
        console.warn("[asistente-guiado] falló un intento de plan", { intento: reintento ? 2 : 1, causa, sinConverger });
      } finally {
        window.clearTimeout(reloj);
        control.signal.removeEventListener("abort", cortar);
      }
    }
    if (respaldo) registrarFallo("plan.respaldo", "el reintento no dio un plan mejor: se queda el primero", { plan_hash: respaldo.plan.plan_hash }, "warn");
    else registrarFallo("plan.fallo", "ningún intento dio un plan confirmado", { sinConverger });
    return respaldo ? { turno, estado: "ok", ...respaldo } : { turno, estado: "fallo", ...(sinConverger ? { sinConverger: true as const } : {}) };
  }

  /**
   * REQ-007: con la bandera en `3d` la propuesta se arma con el motor 3D (`/api/guiada/motor/plan`). La bandera manda
   * solo en un plan nuevo: rehacer un plan sigue en su motor (si deja el 3D, antes avisa: `usarMotorGuiada.ts`). Si el 3D no la arma (pieza sin constructor, precio
   * que falla, base rechazada, red), el plan se rehace ENTERO con Python y el motivo queda en el registro; el cliente nunca
   * se queda sin plan. Un plan de foto va siempre por Python. «Detener» durante la lectura de la bandera no arma ningún plan.
   */
  async function ejecutarPlanConMotor(mensajeId: string, entrada: { propuesta: Propuesta; anterior3d: PlanGuiado | null; deFoto: boolean; anteriorPython: boolean }, python: () => ReturnType<typeof ejecutarPlan>): Promise<Awaited<ReturnType<typeof ejecutarPlan>> & { motor: MotorGuiada; rehechoEnPython?: true; aviso?: string }> {
    const turno = ++turnoRef.current;
    const control = new AbortController();
    controlRef.current = control;
    marcarCargando(true);
    fijarEtapa(mensajeId, "preparando");
    const intento = await planDePropuestaMotor({
      ...entrada, ...(brief ? { brief } : {}), signal: control.signal,
      alFallback: (fallo) => registrarFallo("plan.motor_3d_fallback", fallo.detalle, { razon: fallo.razon, estado: fallo.estado, accion: fallo.aviso ? "el plan deja el 3D: se avisa al cliente y su plan queda como estaba" : entrada.anterior3d ? "el plan era del 3D: se rehace entero con Python" : "se arma con Python" }, "warn"),
    });
    if (turno !== turnoRef.current) return { turno, estado: "obsoleto", motor: "3d" };
    // «Detener» durante la lectura de la bandera: ni plan del 3D ni plan de Python (que usa el modelo y se paga).
    if (control.signal.aborted || (intento !== null && !intento.ok && intento.detenido)) return { turno, estado: "detenido", motor: "3d" };
    if (intento === null) return { ...(await python()), motor: "python", ...(entrada.anterior3d ? { rehechoEnPython: true as const } : {}) };
    if (intento.ok) return { turno, estado: "ok", plan: intento.plan, cotizacion: intento.cotizacion, motor: "3d" };
    return { turno, estado: "fallo", motor: "3d", ...(intento.aviso ? { aviso: intento.aviso } : {}) };
  }

  function terminarPlan(turno: number, mensajeId: string): void {
    quitarEtapa(mensajeId);
    if (turno === turnoRef.current) { marcarCargando(false); controlRef.current = null; }
  }

  /**
   * Deja el plan en el MISMO mensaje (la propuesta pasa a «Tu plan») y marca como versión anterior el que había. Con
   * `idea` («Agregar al plan»), el plan nuevo recuerda las ideas que lleva y dice qué se agregó y cuántos globos tiene.
   */
  function colocarPlan(mensajeId: string, plan: PlanGuiado, cotizacionCruda: unknown, fotoInspiracion: boolean, idea?: IdeaAgregada, referenciaId?: string, motor: MotorGuiada = "python", propuesta?: Propuesta): void {
    const precio = CotizacionPlanGuiadoSchema.safeParse(cotizacionCruda);
    const cotizacion = precio.success ? { ...precio.data, lineas: precio.data.lineas.map((linea) => ({ ...linea, nombre: nombreLineaCliente(linea) })) } : undefined;
    const armado = generarPasosPlan(plan);
    const resumen = resumenPlanGuiado(plan);
    const total = totalDePlan(plan);
    const propuestaGuardada = propuesta ? propuestaParaGuardar(motor, propuesta) : undefined;
    setMensajes((actuales) => {
      const previo = buscarPlanVigente(actuales.filter((mensaje) => mensaje.id !== mensajeId));
      const totalAnterior = previo ? totalDePlan(previo.widget.plan) : undefined;
      // Las ideas solo se heredan al agregar otra: un plan rehecho por «Cambiar algo» ya no sabe qué ideas lleva.
      const ideas = ideasTrasArmarIdea(idea, previo?.widget.ideas ?? []);
      const nuevo: WidgetPlan = {
        tipo: "plan", plan, pasos: armado.pasos, motor,
        ...(propuestaGuardada ? { propuesta: propuestaGuardada } : {}),
        ...(cotizacion ? { cotizacion } : {}),
        ...(totalAnterior !== undefined ? { totalAnterior } : {}),
        ...(fotoInspiracion ? { fotoInspiracion: true, ...(referenciaId ? { referenciaId } : {}) } : {}),
        ...(ideas.length ? { ideas } : {}),
        ...(idea ? { agregada: { titulo: idea.titulo.slice(0, 160), total, ...(idea.avisos?.length ? { avisos: idea.avisos.slice(0, 4) } : {}) } } : {}),
      };
      return actuales.map((mensaje) => {
        if (mensaje.id === mensajeId) return { ...mensaje, content: resumen, widgets: [nuevo] };
        if (!mensaje.widgets?.some((widget) => widget.tipo === "plan" && !widget.reemplazado)) return mensaje;
        return { ...mensaje, widgets: mensaje.widgets.map((widget): Widget => (widget.tipo === "plan" ? { ...widget, reemplazado: true } : widget)) };
      });
    });
    setSugerenciasCambio(null);
    // Un plan nuevo deja atrás el aviso de un plan del 3D que el corte ya no nombra (P-049).
    setFallo(sinAvisoDeCorte);
    pedirLlegada(mensajeId);
    setAnuncio(idea ? [textoIdeaAgregada(idea.titulo, total, idea.sumada), ...(idea.avisos ?? [])].join(" ") : "Tu plan está listo");
  }


  /**
   * «Deshacer» el último ajuste de un plan del 3D (REQ-016, P-042): la tarjeta vuelve al plan que tenía antes de ese ajuste —su
   * espec, su firma y su precio tal como estaban—, sin pedirle al servidor un ajuste inverso (agrandar y achicar un paso no
   * deja la medida de antes). Si ya no hay plan de antes (se recargó la página, o el plan cambió) lo dice y no toca nada.
   */
  function deshacerUltimoAjuste(mensajeId: string): string | null {
    const vigente = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!vigente || vigente.reemplazado) return "No pude deshacer: ese plan ya no es el que ves. Tu plan sigue como está.";
    const resultado = deshacerAjuste.deshacer(mensajeId, vigente);
    if (!resultado.ok) {
      registrarAccion("plan.ajuste.deshacer_rechazado", { mensajeId, codigo: resultado.codigo, plan_hash: vigente.plan.plan_hash });
      setAnuncio(resultado.mensaje);
      return resultado.mensaje;
    }
    const restaurado = resultado.widget;
    const resumen = resumenPlanGuiado(restaurado.plan);
    setMensajes((actuales) => actuales.map((mensaje) => {
      const actual = mensaje.id === mensajeId ? planDelMensaje(mensaje) : undefined;
      if (!actual || actual.reemplazado || actual.plan.plan_hash !== vigente.plan.plan_hash) return mensaje;
      return { ...mensaje, content: contenidoPlanAjustado(resumen, restaurado.ajustes ?? []), widgets: mensaje.widgets?.map((widget): Widget => (widget.tipo === "plan" ? restaurado : widget)) };
    }));
    setImagenesLocales((actuales) => (mensajeId in actuales ? Object.fromEntries(Object.entries(actuales).filter(([id]) => id !== mensajeId)) : actuales));
    // La imagen guardada en el navegador es por mensaje y puede ser de otro plan que el que vuelve: una recarga no debe traerla.
    void borrarImagenNavegador(mensajeId);
    registrarAccion("plan.ajuste.deshacer", { mensajeId, plan_hash_antes: vigente.plan.plan_hash, plan_hash: restaurado.plan.plan_hash });
    setAnuncio(`Listo: volví a tu plan de antes. Tiene ${totalDePlan(restaurado.plan)} globos.`);
    return null;
  }

  /**
   * Un cambio del plan pedido POR CHAT («el azul cámbialo por celeste en las dos columnas»): lo hace el editor «Ajustar
   * mi plan» sobre el plan firmado que se ve (`ejecutarEdicionChat` → `/api/plan-editar`, sin modelo) y la tarjeta se
   * actualiza en su sitio con «Último ajuste: …», como un ajuste del panel. Antes el chat rehacía el plan entero con
   * /api/chat y cambiaba título, acabados y cantidades (probador 104). Si falla, el plan no se toca y «Intentar de nuevo»
   * repite ESE cambio.
   */
  /**
   * La red de un cambio por chat: los mismos `/api/plan-editar` del editor (y, para sumar o mover una pieza, sus modos
   * `agregar_pieza` y `editar_pieza`), cortables con «Detener» además de su propio plazo.
   */
  function dependenciasEdicionChat(signal?: AbortSignal, del3d?: { turnoId: string }): DependenciasEdicionChat {
    const conSenal: typeof fetch = (entrada, init) => fetch(entrada, { ...init, ...(signal ? { signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal } : {}) });
    return {
      aplicar: (sobre, edicion) => aplicarEnServidor(sobre, edicion, conSenal),
      quitarPieza: (sobre, estructuraId) => quitarPiezaEnServidor(sobre, estructuraId, conSenal),
      agregarColor: (sobre, globo, estructuraIds) => agregarColorEnServidor(sobre, globo, conSenal, estructuraIds),
      reemplazarColor: (sobre, cambio) => reemplazarColorEnServidor(sobre, cambio, conSenal),
      // CRUD por chat: sumar una pieza (las demás intactas) y mover o renombrar una; Python cuenta y firma.
      agregarPieza: (sobre, pieza) => agregarPiezaEnServidor(sobre, pieza, conSenal),
      editarPieza: (sobre, cambio) => editarPiezaEnServidor(sobre, cambio, conSenal),
      // La misma búsqueda del selector de «Cambiar»: globos lisos de esa familia en el catálogo firmado del plan.
      buscarGlobos: async (familia, approvalToken, palabra) => (await pedirBusqueda(armarBusqueda({ texto: `globo latex redondo${palabra ? ` ${palabra}` : ""}`, colores: [familia], tamanos: [], limite: LIMITE_MAXIMO, approvalToken }), signal)).candidatos,
      // Un plan del motor 3D no pasa por Python: el cambio va a `/api/guiada/motor/editar` (REQ-007, fase 5).
      ...(del3d ? { motor3d: { dependencias: crearDependenciasEdicion3d(signal ? { signal } : {}), turnoId: del3d.turnoId } } : {}),
    };
  }

  async function aplicarEdicionChat(pedido: PedidoEdicionPlan, destino: { planMensajeId: string; base: PlanGuiado; mensajeId: string; signal?: AbortSignal }): Promise<void> {
    const { planMensajeId, base, mensajeId, signal } = destino;
    // Un plan del motor 3D se cambia en el servidor del 3D (no pasa por Python); el turno lleva el id de este mensaje para calificarlo.
    const vigente = planDelMensaje(mensajes.find((mensaje) => mensaje.id === planMensajeId));
    const del3d = vigente?.motor === "3d";
    const transcurrido = cronometro();
    registrarAccion("plan.edicion_chat.pedir", { pedido, mensajeId, planMensajeId, plan_hash: base.plan_hash });
    setFallo(null);
    setEditandoPlanId(planMensajeId);
    setAnuncio(avisoEdicionChat(pedido));
    try {
      const hecha = await ejecutarEdicionChat(base, pedido, dependenciasEdicionChat(signal, del3d ? { turnoId: mensajeId } : undefined), { cotizacionAntes: vigente?.cotizacion, uso: vigente?.usoCosteo ?? uso ?? null });
      const publicado = ajustarPlan(planMensajeId, hecha.plan, hecha.cotizacion, { descripcion: hecha.descripcion, baseHash: base.plan_hash });
      actualizarMensaje(mensajeId, (mensaje) => ({
        ...mensaje,
        content: publicado ? hecha.confirmacion : "Tu plan cambió mientras hacía el cambio; pídemelo otra vez sobre el plan nuevo.",
        ...(publicado && hecha.turno ? { edicion3d: { turnoId: hecha.turno.turnoId, antes: hecha.turno.antes.espec, despues: hecha.turno.despues.espec } } : {}),
      }));
      registrarAccion(publicado ? "plan.edicion_chat.listo" : "plan.edicion_chat.obsoleta", {
        tipo: pedido.tipo, descripcion: hecha.descripcion, confirmacion: hecha.confirmacion, cambios: hecha.cambios.map((cambio) => cambio.tipo),
        globos: hecha.globos.map((elegido) => ({ product_id: elegido.globo.productId, nombre: elegido.globo.nombre, titulo: elegido.titulo, acabado: elegido.acabado, candidatos: elegido.candidatos, cubreTamanos: elegido.cubreTamanos, variantes: elegido.globo.variantIds.length })),
        plan_hash_base: base.plan_hash, plan_hash: hecha.plan.plan_hash, ms: transcurrido(),
        ...(hecha.nueva ? { nueva: hecha.nueva, piezas: hecha.plan.plan.estructuras.map((estructura) => ({ id: estructura.estructura_id, nombre: estructura.nombre, ubicacion: estructura.ubicacion })) } : {}),
      });
    } catch (causa) {
      const cancelado = Boolean(signal?.aborted) || esCancelacion(causa);
      const mensaje = cancelado ? "Detuviste el cambio. Tu plan sigue como estaba." : mensajeAjuste(causa);
      if (!cancelado) console.warn("[asistente-guiado] no se pudo hacer el cambio pedido por chat", causa);
      registrarFallo("plan.edicion_chat.fallo", causa, { tipo: pedido.tipo, pedido, mensaje, cancelado, plan_hash: base.plan_hash, ms: transcurrido() }, "warn");
      actualizarMensaje(mensajeId, (actual) => ({ ...actual, content: mensaje }));
      setFallo({ titulo: cancelado ? "Detuviste el cambio" : "No pude hacer ese cambio", etiqueta: "Intentar de nuevo", accion: { tipo: "edicion", pedido, mensajeId }, mensajeId });
      setAnuncio(mensaje);
    } finally {
      setEditandoPlanId(null);
    }
  }

  /** «Intentar de nuevo» de un cambio por chat que no salió: el mismo cambio sobre el plan que se ve ahora. */
  async function reintentarEdicion(accion: Extract<AccionFallo, { tipo: "edicion" }>): Promise<void> {
    if (cargandoRef.current || !planVigente) return;
    const control = new AbortController();
    controlRef.current = control;
    marcarCargando(true);
    try {
      await aplicarEdicionChat(accion.pedido, { planMensajeId: planVigente.mensajeId, base: planVigente.widget.plan, mensajeId: accion.mensajeId, signal: control.signal });
    } finally {
      marcarCargando(false);
      if (controlRef.current === control) controlRef.current = null;
    }
  }

  /** Resuelve la propuesta con /api/chat (Python, dueño de las cantidades). Devuelve cómo terminó; quien no lo necesita lo ignora. */
  async function aceptarPropuesta(propuesta: Propuesta, opciones: { mensajeId: string; desdeTurno?: boolean; reintento?: boolean; planAnterior?: PlanActualGuiado; idea?: IdeaAgregada; cliente?: ContextoClienteGuiado }): Promise<"ok" | "fallo" | "detenido" | "obsoleto" | "ocupado"> {
    if (cargandoRef.current && !opciones.desdeTurno) return "ocupado";
    const { mensajeId, planAnterior, idea } = opciones;
    // Lo que dijo el cliente (evento, lugar, momento, medida, presupuesto y sus palabras): al brief y a la instrucción del
    // plan, y sus palabras como `original_request` (comparador 100, I2/I4). Desde un turno llega ya armado.
    const cliente = opciones.cliente ?? contextoClienteGuiado(brief, textosDelCliente(mensajes));
    // Rehacer un plan que salió de una foto («Cambiar algo», «Hazla más sencilla», «Otros colores», «Agregar al plan»)
    // la conserva, por el mismo camino que la clásica: la foto, su lectura y cada pieza atada a su elemento de la foto.
    // Sin ella el plan nuevo perdía la escenografía y las cajas, y la imagen salía inventada (2026-10-06, ci54dg).
    const foto = planAnterior ? fotoDelPlan(mensajes, planVigente, fotosRef.current) : null;
    registrarAccion("propuesta.aceptar", {
      mensajeId, desdeTurno: Boolean(opciones.desdeTurno), reintento: Boolean(opciones.reintento), propuesta, ...(idea ? { idea: idea.id } : {}),
      cliente: { ...cliente, solicitud: cliente.solicitud?.slice(0, 300) ?? null },
      ...(foto ? { foto: { referenciaId: foto.referenciaId, conImagen: Boolean(foto.imagen), piezasDeLaFoto: foto.referencia?.piezas.length ?? 0 } } : {}),
    });
    setFallo(null);
    setSeleccionada(null);
    actualizarMensaje(mensajeId, (mensaje) => ({ ...mensaje, content: propuesta.frase, widgets: [{ tipo: "propuesta", propuesta, estado: "resolviendo" }] }));
    // Piezas SIEMPRE individuales y, con foto, la foto y su lectura (`cuerpoPlanGuiado`).
    const armar = (reintento: boolean, faltantes?: readonly ColorFotoFaltante[]) => cuerpoPlanGuiado(propuesta, { reintento, ...(planAnterior ? { planAnterior } : {}), foto, ...(faltantes?.length ? { faltantes } : {}), cliente });
    // Con foto, de sus colores solo se exigen los que siguen en la propuesta: «Otros colores» los cambió el cliente.
    const anterior3d = planAnterior && planVigente?.widget.motor === "3d" ? planVigente.widget.plan : null;
    const resultado = await ejecutarPlanConMotor(mensajeId, { propuesta, anterior3d, deFoto: Boolean(foto), anteriorPython: Boolean(planAnterior) && planVigente?.widget.motor === "python" }, () => ejecutarPlan(mensajeId, armar, Boolean(opciones.reintento), propuesta.colores));
    if (resultado.estado === "obsoleto") return "obsoleto";
    if (resultado.estado === "ok") {
      if (foto?.imagen) fotosRef.current.set(mensajeId, foto.imagen);
      // Un plan del 3D guarda la propuesta que lo armó: «Recalcular mi plan» (P-049) la repite por este mismo camino.
      colocarPlan(mensajeId, resultado.plan, resultado.cotizacion, Boolean(foto), idea, foto?.referenciaId, resultado.motor, propuesta);
      // Un plan del 3D que se rehízo con Python se dice, sin tecnicismos.
      if (resultado.rehechoEnPython) actualizarWidget(mensajeId, "plan", (widget) => ({ ...widget, recalculado: true }));
    } else {
      actualizarMensaje(mensajeId, (mensaje) => ({ ...mensaje, widgets: [{ tipo: "propuesta", propuesta, estado: resultado.aviso ? "en_espera" : "fallo" }] }));
      const accion: AccionFallo = { tipo: "plan", propuesta, mensajeId, ...(planAnterior ? { planAnterior } : {}), ...(idea ? { idea } : {}) };
      const dicho = falloDelPlan({ estado: resultado.estado, ...(resultado.aviso ? { aviso: resultado.aviso } : {}), ...(idea ? { idea } : {}), accion, mensajeId });
      setFallo(dicho.fallo);
      setAnuncio(dicho.anuncio);
    }
    terminarPlan(resultado.turno, mensajeId);
    return resultado.estado;
  }

  /**
   * «Sí, armémoslo» con la lectura de una foto. `mensajeId` es el del plan cuando se reintenta. `sinRemate`: la salida
   * «Armarlo sin el remate grande» de un plan que no convergió (la lectura del mensaje no cambia; solo la que se manda).
   * `piezaNueva`: la pieza que el cliente pidió sumar por chat («¿puedes agregar una guirnalda en medio?»): el plan lleva
   * las piezas de la foto MÁS esa (`foto-con-pieza.ts`); `textoCliente`, sus palabras, que van en su burbuja.
   */
  async function aceptarPlanFoto(referenciaId: string, opciones?: { mensajeId?: string; sinRemate?: boolean; piezaNueva?: PiezaNuevaChat; textoCliente?: string }): Promise<void> {
    if (cargandoRef.current) return;
    const origen = mensajes.find((mensaje) => mensaje.id === referenciaId);
    if (!origen?.referencia) return;
    const referencia = origen.referencia;
    const blueprint = opciones?.sinRemate ? lecturaSinRemateGrande(referencia.blueprint) : referencia.blueprint;
    const imagen = fotosRef.current.get(referenciaId);
    // La lectura con un elemento más para la pieza pedida (entre las dos columnas, para «en medio»).
    const piezaNueva = opciones?.piezaNueva ?? null;
    const conPieza = piezaNueva ? lecturaConPiezaNueva(blueprint, piezaNueva) : null;
    if (piezaNueva && !conPieza) registrarFallo("foto.sumar_pieza_invalida", "la lectura con la pieza pedida no cumple el contrato: el plan sale solo con las piezas de la foto", { referenciaId, piezaNueva }, "warn");
    registrarAccion("foto.armar_plan", {
      referenciaId, colores: referencia.colores.map((color) => color.nombre), conFoto: Boolean(imagen), ...(opciones?.sinRemate ? { sinRemate: true } : {}),
      ...(piezaNueva ? { piezaNueva, elemento: conPieza?.elemento ?? null, ubicacion: conPieza?.ubicacion ?? null } : {}),
    });
    limpiarAvisos();
    setSeleccionada(null);
    // Lo que dijo el cliente: evento, lugar y momento al brief y sus palabras como `original_request` (comparador 100, I4).
    const cliente = contextoClienteGuiado(brief, [...textosDelCliente(mensajes), ...(opciones?.textoCliente ? [opciones.textoCliente] : [])]);
    let mensajeId = opciones?.mensajeId;
    if (!mensajeId) {
      mensajeId = nuevoId();
      agregar([
        { id: nuevoId(), role: "user", content: opciones?.textoCliente ?? "Sí, armémoslo." },
        { id: mensajeId, role: "assistant", content: piezaNueva && conPieza ? `Preparo el plan con las piezas de tu foto y ${piezaIndefinida(piezaNueva.estructura)}${piezaNueva.ubicacion ? ` ${LUGAR_EN_PALABRAS[piezaNueva.ubicacion]}` : ""}.` : "Preparo el plan con las piezas y los colores de tu foto." },
      ]);
      pedirFinal();
    }
    const idPlan = mensajeId;
    const colores = referencia.colores.map((color) => color.nombre);
    // Primer intento: el MISMO texto que manda la clásica con una foto sola (`MENSAJE_SOLO_REFERENCIAS`), y el plan sale
    // de la lectura como en la clásica; el reintento, la instrucción guiada con los colores que el cliente vio
    // (`cuerpoPlanFoto`). La pieza pedida va en los dos.
    const armar = (reintento: boolean, faltantes?: readonly ColorFotoFaltante[]) => cuerpoPlanFoto({
      reintento, blueprint, colores, cliente, imagen: imagen ?? null, ...(faltantes?.length ? { faltantes } : {}),
      piezaNueva: piezaNueva && conPieza ? { pieza: piezaNueva, lectura: conPieza } : null,
    });
    const resultado = await ejecutarPlan(idPlan, armar, false);
    if (resultado.estado === "obsoleto") return;
    if (resultado.estado === "ok") {
      let planListo = resultado.plan;
      let cotizacionLista = resultado.cotizacion;
      let sinLaPieza = false;
      if (piezaNueva && conPieza && !planLlevaPiezaPedida(planListo, conPieza, piezaNueva)) {
        // El modelo omitió la pieza pedida: se suma con el editor (Python la cuenta; las piezas de la foto no cambian).
        try {
          const sumada = await ejecutarEdicionChat(planListo, { tipo: "agregar_pieza", pieza: piezaNueva }, dependenciasEdicionChat(controlRef.current?.signal));
          registrarAccion("foto.sumar_pieza_editor", { referenciaId, pieza: piezaNueva, nueva: sumada.nueva ?? null, plan_hash_base: planListo.plan_hash, plan_hash: sumada.plan.plan_hash });
          planListo = sumada.plan;
          cotizacionLista = sumada.cotizacion;
        } catch (causa) {
          sinLaPieza = true;
          registrarFallo("foto.sumar_pieza_editor_fallo", causa, { referenciaId, pieza: piezaNueva, mensaje: mensajeAjuste(causa) }, "warn");
        }
        if (resultado.turno !== turnoRef.current) return;
      }
      if (imagen) fotosRef.current.set(idPlan, imagen);
      colocarPlan(idPlan, planListo, cotizacionLista, true, undefined, referenciaId);
      if (sinLaPieza && piezaNueva) {
        setFallo({ titulo: `No pude sumar ${piezaIndefinida(piezaNueva.estructura)} a tu plan`, detalle: "Tu plan con las piezas de la foto está listo. Pídemela otra vez y la sumo.", etiqueta: "Intentar de nuevo", accion: { tipo: "turno", texto: opciones?.textoCliente ?? `Agrega ${piezaIndefinida(piezaNueva.estructura)}${piezaNueva.ubicacion ? ` ${LUGAR_EN_PALABRAS[piezaNueva.ubicacion]}` : ""}`, opciones: {} }, mensajeId: idPlan });
      }
      // La lectura guardada suma el elemento de la pieza pedida si el plan lo materializa: «Ver cómo quedaría» y los
      // cambios siguientes mandan la lectura con él.
      const elementoPedido = conPieza && planListo.plan.estructuras.some((estructura) => estructura.referencia_element_id === conPieza.elemento)
        ? conPieza.blueprint.elements.find((elemento) => elemento.element_id === conPieza.elemento)
        : undefined;
      actualizarMensaje(referenciaId, (mensaje) => ({
        ...mensaje, fotoArmada: true,
        ...(elementoPedido && mensaje.referencia && !mensaje.referencia.blueprint.elements.some((elemento) => elemento.element_id === elementoPedido.element_id)
          ? { referencia: { ...mensaje.referencia, blueprint: { ...mensaje.referencia.blueprint, elements: [...mensaje.referencia.blueprint.elements, elementoPedido] } } }
          : {}),
      }));
    } else if (resultado.estado === "detenido") {
      setFallo({ titulo: "Detuviste la respuesta", detalle: "Puedes pedir el plan otra vez cuando quieras.", etiqueta: "Preparar el plan", accion: { tipo: "foto", referenciaId, mensajeId: idPlan, ...(opciones?.sinRemate ? { sinRemate: true } : {}), ...(piezaNueva ? { piezaNueva } : {}) }, mensajeId: idPlan });
      setAnuncio("No pude terminar tu plan");
    } else {
      // Salida digna: un «Reintentar» con la misma lectura vuelve a fallar igual. Si el catálogo rechazó el plan y la
      // lectura trae un remate grande, la acción principal es armarlo sin él; siempre hay una idea parecida del
      // catálogo y otra foto.
      const sinRemate = resultado.sinConverger === true && !opciones?.sinRemate && tieneRemateGrande(referencia.blueprint);
      setFallo({
        titulo: resultado.sinConverger ? "No pude armar tu plan con el catálogo" : "No pude terminar tu plan",
        detalle: resultado.sinConverger ? "Algunos globos de tu foto no están en el catálogo en ese color o tamaño." : "Tu conversación sigue guardada.",
        ...(sinRemate ? { etiqueta: "Armarlo sin el remate grande" } : {}),
        accion: { tipo: "foto", referenciaId, mensajeId: idPlan, ...(sinRemate || opciones?.sinRemate ? { sinRemate: true } : {}), ...(piezaNueva ? { piezaNueva } : {}) },
        alternativas: ["idea-parecida", "otra-foto"],
        mensajeId: idPlan,
      });
      registrarAccion("plan.salida_foto", { referenciaId, sinConverger: Boolean(resultado.sinConverger), ofreceSinRemate: sinRemate });
      setAnuncio(resultado.sinConverger ? "No pude armar tu plan con el catálogo" : "No pude terminar tu plan");
    }
    terminarPlan(resultado.turno, idPlan);
  }

  // ── «Ver cómo quedaría» ──────────────────────────────────────────────────────────────────────────────────────
  async function verComoQuedaria(mensajeId: string): Promise<void> {
    if (imagenEnCursoRef.current) return;
    const widget = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!widget || widget.reemplazado) return;
    // Un plan del motor 3D sin su espec firmada (guardado antes de la fase 3) no tiene de dónde armar la imagen, y nunca va a Python.
    if (widget.motor === "3d" && !firmaDePlan(widget.plan)) { registrarAccion("imagen.pendiente_motor_3d", { mensajeId, plan_hash: widget.plan.plan_hash }); setAnuncio(TEXTO_IMAGEN_PLAN_3D); return; }
    const sesion = sesionRef.current;
    imagenEnCursoRef.current = mensajeId;
    setImagenEnCurso(mensajeId);
    setFallo(null);
    actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, errorImagen: false }));
    // Solo cancela desde fuera (empezar de nuevo); el tope de tiempo va por intento dentro de `pedirImagenConRecuperacion`.
    const control = new AbortController();
    imagenControlRef.current = control;
    const plan = widget.plan;
    try {
      let salida: ImagenObtenida;
      if (widget.motor === "3d") {
        // Un plan del motor 3D se dibuja por su ruta: la captura del visor que el cliente ve + la espec firmada, nunca el cuerpo de Python (otro dueño de las cantidades).
        salida = await pedirImagenPlan3D({ plan, senal: control.signal, limiteIntentoMs: LIMITE_IMAGEN_MS, alEvento: (evento, datos) => registrarAccion(evento, { mensajeId, ...datos }) });
      } else {
        const referencia = widget.fotoInspiracion ? fotosRef.current.get(mensajeId) : undefined;
        // El mismo cuerpo que manda la clásica al aprobar (`cuerpoGeneracion`): productos y paquetes del plan, creatividad por
        // defecto y, si el plan salió de una foto, su lectura (blueprint). Sin la lectura el servidor no tenía la escenografía,
        // las cajas de cada pieza ni el encuadre de la foto, y FLUX unía las dos columnas en un arco (2026-10-06).
        // Como en la clásica: el brief de esta conversación (evento, temática, lugar, momento) y las palabras del cliente como
        // solicitud (la escena y la auditoría); antes iban la descripción que escribió la IA y un brief sin lugar ni momento
        // (comparador 100, I4). `entradaImagenGuiada` es lo mismo que comprueba test-cuerpo-generacion.
        const cuerpo = cuerpoGeneracion({
          plan,
          ...fuentesDelPlan(plan),
          ...entradaImagenGuiada(plan, contextoClienteGuiado(brief, textosDelCliente(mensajes))),
          imagenesReferencia: referencia ? [referencia] : [],
          blueprint: widget.fotoInspiracion ? lecturaDelPlan(mensajes, mensajeId)?.blueprint : undefined,
        });
        registrarAccion("imagen.pedir", { mensajeId, cuerpo: resumenCuerpoGeneracion(cuerpo) });
        // Producción, 2026-10-07: el servidor hizo la imagen pero en el móvil la respuesta se cortó («NetworkError») y se
        // vio un error. Cada intento lleva su id; ante un corte se pregunta primero si el servidor ya la tiene (sin pagar
        // otra) y, solo si no, un reintento silencioso. Cada paso queda en la auditoría.
        salida = await pedirImagenConRecuperacion({
          cuerpo,
          planHash: plan.plan_hash,
          senal: control.signal,
          limiteIntentoMs: LIMITE_IMAGEN_MS,
          alEvento: (evento, datos) => registrarAccion(evento, { mensajeId, ...datos }),
        });
      }
      if (sesion !== sesionRef.current) return;
      if (salida.via !== "directa") registrarAccion("imagen.llego_tras_corte", { mensajeId, via: salida.via, intentos: salida.intentos });
      // Se ve en el acto; el plan de la tarjeta (con su approval_token) no se toca.
      setImagenesLocales((actuales) => ({ ...actuales, [mensajeId]: salida.imagen }));
      // Como en la clásica: lo que la imagen muestra y no se cotiza (el entorno del evento) se dice junto a la imagen.
      actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, errorImagen: false, hechas: conHecha(actual.hechas, "ver"), avisoImagen: salida.avisoNoCotizado }));
      setAnuncio("La imagen de tu decoración está lista");
      // Solo en el navegador (IndexedDB), nunca en el servidor: así una recarga la vuelve a mostrar.
      void guardarImagenNavegador(mensajeId, salida.imagen);
    } catch (causa) {
      if (sesion !== sesionRef.current) return;
      // El corte del 3D (P-049): no es un error de la imagen; el aviso de recálculo es el que la explica. Lo pidió el cliente con un
      // toque, así que se le contesta aunque ya lo hubiera leído, y se anuncia por si la tarjeta no puede salir (hay otra a la vista).
      if (avisarSiEsCorteDeLaImagen(causa, plan.plan_hash, () => registrarAccion("imagen.motor_3d_cortado", { mensajeId, plan_hash: plan.plan_hash }))) { setAnuncio(TEXTO_AVISO_DIBUJO_RECALCULO); return; }
      registrarFallo("imagen.fallo", causa, { mensajeId, plan_hash: plan.plan_hash, clase: causa instanceof ErrorImagen ? causa.clase : null });
      console.warn("[asistente-guiado] no se pudo dibujar la decoración", causa);
      // Sin tarjeta de error aparte: la del plan dice por qué falló y, solo si repetir puede servir, su botón principal es «Reintentar imagen».
      const fallo = mensajeErrorImagen(causa);
      actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, errorImagen: true, falloImagen: fallo }));
      setAnuncio(fallo.texto);
    } finally {
      if (imagenControlRef.current === control) imagenControlRef.current = null;
      if (imagenEnCursoRef.current === mensajeId) { imagenEnCursoRef.current = null; setImagenEnCurso(null); }
    }
  }

  // «Genera la imagen» sin plan: en cuanto aparece un plan distinto del que había, se lleva a la vista y se dibuja.
  useEffect(() => {
    const pendiente = imagenTrasPlanRef.current;
    if (!pendiente || !idPlanVigente || idPlanVigente === pendiente.planPrevio) return;
    imagenTrasPlanRef.current = null;
    registrarAccion("plan.imagen_tras_plan", { mensajeId: idPlanVigente });
    vistaPendienteRef.current = { tipo: "mensaje", id: idPlanVigente };
    void verComoQuedaria(idPlanVigente);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando aparece un plan nuevo
  }, [idPlanVigente]);

  // ── Acciones del plan (tarjeta, barra o pedidas al modelo) ───────────────────────────────────────────────────
  /** `origen` «opcion»: el chip de una idea elegida, cuya petición ya está en el chat (no se repite). */
  function accionPlan(accion: AccionPlan, mensajeId: string, origen: "tarjeta" | "barra" | "modelo" | "opcion" = "tarjeta"): void {
    const widget = planDelMensaje(mensajes.find((mensaje) => mensaje.id === mensajeId));
    if (!widget || widget.reemplazado) return;
    registrarAccion("plan.accion", { accion, origen, mensajeId, plan_hash: widget.plan.plan_hash });
    if (accion !== "costear" && accion !== "comprar") limpiarAvisos();
    const delCliente = origen === "tarjeta" || origen === "barra";
    switch (accion) {
      case "ver":
        void verComoQuedaria(mensajeId);
        if (origen !== "tarjeta") revelarEnTarjeta(mensajeId, '[role="status"]');
        return;
      case "costear":
        actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, usoCosteo: actual.usoCosteo ?? uso ?? "personal", hechas: conHecha(actual.hechas, "costear") }));
        if (origen !== "tarjeta") revelarEnTarjeta(mensajeId, SELECTOR_PRECIO_TOTAL);
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
        // Los cambios rápidos («Otros colores», «Agregar una pieza», «Hacerla más grande», «Hacerla más sencilla») viven
        // DENTRO de «Ajustar mi plan» (pedido del dueño): desde la tarjeta, «Cambiar algo» abre ese editor; desde la barra
        // o el modelo, se deja escribir el cambio. Ya no salen como chips sueltos bajo la tarjeta.
        if (origen === "tarjeta") return;
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
  /**
   * Lo que hace «Me gusta esta» con la idea: la deja elegida y marcada en su carrusel. También la usa una idea elegida
   * con palabras («me quedo con el primero», `elegir_idea`), para que las dos cosas hagan exactamente lo mismo.
   */
  function marcarIdeaElegida(decoracion: DecoracionSempertex, carruselId: string | null, extra: Record<string, unknown> = {}): void {
    registrarAccion("idea.elegir", { id: decoracion.id, titulo: decoracion.titulo, mensajeId: carruselId, usoConservado: uso, ...extra });
    limpiarAvisos();
    // El uso es del cliente, no de la idea: si ya lo dijo, la idea nueva se cotiza sin volver a preguntarlo.
    setSeleccionada(decoracion);
    if (carruselId) actualizarWidget(carruselId, "decoraciones", (widget) => ({ ...widget, elegidaId: decoracion.id }));
  }

  function elegirDecoracion(decoracion: DecoracionSempertex, mensajeId: string): void {
    if (cargandoRef.current) return;
    marcarIdeaElegida(decoracion, mensajeId);
    agregar([
      { id: nuevoId(), role: "user", content: `Me gusta «${decoracion.titulo}».` },
      { id: nuevoId(), role: "assistant", content: textoIdeaElegida(decoracion.titulo), widgets: [{ tipo: "seleccion", decoracion }, { tipo: "opciones" }] },
    ]);
    pedirFinal();
  }

  /**
   * El plan EXACTO de la idea (`/api/plan-idea`): sus piezas, medidas, productos Sempertex y tamaños, que Python cuenta y
   * firma sin modelo; con `base`, sumadas a las del plan vigente. Verificador (2026-10-06, v43qux): por /api/chat la
   * guirnalda de 51 globos de 12″ y 18″ volvía como 77 globos de otros productos, y las columnas negras y doradas perdían
   * la bola negra de 36″. Quien llama decide qué hacer si no llega (`trasFallo` lo dice en el registro): «Agregar al plan»
   * sigue por el camino de siempre; los chips de la idea, nunca por el modelo (`opcion-idea.ts`).
   */
  async function planExactoDeIdea(mensajeId: string, decoracion: DecoracionSempertex, base: PlanGuiado | null, idea: IdeaAgregada, trasFallo: string): Promise<ResultadoPlanIdea> {
    const turno = ++turnoRef.current;
    const control = new AbortController();
    controlRef.current = control;
    marcarCargando(true);
    fijarEtapa(mensajeId, "calculando");
    let porTiempo = false;
    const reloj = window.setTimeout(() => { porTiempo = true; control.abort("tiempo"); }, LIMITE_PLAN_IDEA_MS);
    try {
      const sesion = sesionRef.current;
      const yaResuelto = base ? null : reutilizarPlanIdea(planIdeaRef.current, decoracion.id, sesion);
      const resultado = yaResuelto ?? await planDeIdeaMotor({
        ideaId: decoracion.id, base: base ? { plan: base, motor: planVigente?.widget.motor ?? "python" } : null, signal: control.signal,
        alFallback: (fallo) => registrarFallo("plan.motor_3d_fallback", fallo.detalle, { razon: fallo.razon, estado: fallo.estado, idea: decoracion.id, accion: base ? "se sigue en el 3D (propuesta)" : "se arma con Python" }, "warn"),
      });
      if (turno !== turnoRef.current) return "obsoleto";
      if (resultado.ok && !base && !yaResuelto && sesion === sesionRef.current) {
        planIdeaRef.current = { ideaId: decoracion.id, sesion, resultado };
        setPrecioIdea((actual) => fijarPrecioIdea(actual, { ideaId: decoracion.id, sesion, sesionVigente: sesionRef.current, cotizacion: resultado.cotizacion }));
      }
      if (resultado.ok) {
        registrarAccion("idea.plan_exacto", { id: decoracion.id, plan_hash: resultado.plan.plan_hash, nuevas: resultado.nuevas, globosIdea: resultado.globosIdea, globosPlan: totalDePlan(resultado.plan), sumada: idea.sumada, exacto: resultado.exacto, avisos: resultado.avisos, reutilizado: Boolean(yaResuelto) });
        // Si no salió exacto, la tarjeta dice por qué en una línea discreta (antes el cliente no se enteraba).
        colocarPlan(mensajeId, resultado.plan, resultado.cotizacion, false, resultado.avisos.length ? { ...idea, avisos: resultado.avisos } : idea, undefined, resultado.motor);
        return "ok";
      }
      const final = resultadoPlanIdea(resultado, porTiempo);
      if (final !== "detenido") registrarFallo("idea.plan_exacto_fallo", resultado.motivo, { id: decoracion.id, estado: resultado.estado, porTiempo, resultado: final, accion: trasFallo }, "warn");
      return final;
    } finally {
      window.clearTimeout(reloj);
      terminarPlan(turno, mensajeId);
    }
  }

  /**
   * «Agregar al plan» (pedido 3): primero la idea EXACTA (`planExactoDeIdea`); si no se puede, las piezas de la idea,
   * individuales y en sus colores lisos, se suman a las del plan vigente (o crean el plan) por el camino de siempre:
   * propuesta → `aceptarPropuesta` → /api/chat → Python, dueño de las cantidades. Los topes (8 piezas, 8 colores) se
   * dicen antes de llamar al modelo. El plan de antes no se toca hasta que llega el nuevo, que lo deja como versión
   * anterior; si falla, sigue vigente y hay «Reintentar».
   */
  async function agregarIdeaAlPlan(decoracion: DecoracionSempertex, origen: "eleccion" | "carrusel", mensajeOrigenId: string): Promise<void> {
    if (cargandoRef.current) return;
    avanzarEspera({ tipo: "otra-accion" });
    const vigente = planVigente;
    const resultado = propuestaAgregarIdea(decoracion, vigente?.widget.plan ?? null);
    const datos = { id: decoracion.id, titulo: decoracion.titulo, origen, mensajeId: mensajeOrigenId, plan_hash_base: vigente?.widget.plan.plan_hash ?? null };
    if (!resultado.ok) {
      registrarAccion("idea.agregar_bloqueada", { ...datos, motivo: resultado.motivo, mensaje: resultado.mensaje });
      setAnuncio(resultado.mensaje);
      return;
    }
    registrarAccion("idea.agregar_al_plan", {
      ...datos,
      piezas_antes: resultado.piezasAntes, piezas_despues: resultado.piezasDespues, nuevas: resultado.nuevas,
      colores: resultado.propuesta.colores, colores_nuevos: resultado.coloresNuevos,
    });
    limpiarAvisos();
    setAgregandoId(decoracion.id);
    const idPlan = nuevoId();
    agregar([
      { id: nuevoId(), role: "user", content: vigente ? `Agrega «${decoracion.titulo}» a mi plan.` : `Arma mi plan con «${decoracion.titulo}».` },
      { id: idPlan, role: "assistant", content: resultado.propuesta.frase, widgets: [{ tipo: "propuesta", propuesta: resultado.propuesta, estado: "resolviendo" }] },
    ]);
    pedirFinal();
    const planAnterior = vigente ? planActualDelPlan(vigente.widget.plan, vigente.widget.motor) : null;
    const idea: IdeaAgregada = { id: decoracion.id, titulo: decoracion.titulo, sumada: Boolean(vigente) };
    try {
      // Un plan que salió de una foto se rehace por el camino de siempre, que conserva la foto y su lectura.
      const exacto = vigente?.widget.fotoInspiracion ? "fallo" : await planExactoDeIdea(idPlan, decoracion, vigente?.widget.plan ?? null, idea, "se arma por el camino de siempre (/api/chat)");
      if (exacto === "detenido") {
        actualizarMensaje(idPlan, (mensaje) => ({ ...mensaje, widgets: [{ tipo: "propuesta", propuesta: resultado.propuesta, estado: "fallo" }] }));
        setFallo({ titulo: "Detuviste la respuesta", detalle: "Puedes pedir el plan otra vez cuando quieras.", etiqueta: "Preparar el plan", accion: { tipo: "plan", propuesta: resultado.propuesta, mensajeId: idPlan, ...(planAnterior ? { planAnterior } : {}), idea }, mensajeId: idPlan });
      }
      if (exacto !== "fallo" && exacto !== "sin-plan-guardado") {
        registrarAccion(exacto === "ok" ? "idea.agregada" : "idea.agregar_sin_plan", { id: decoracion.id, estado: exacto, exacto: true });
        return;
      }
      const estado = await aceptarPropuesta(resultado.propuesta, {
        mensajeId: idPlan,
        idea,
        ...(planAnterior ? { planAnterior } : {}),
      });
      registrarAccion(estado === "ok" ? "idea.agregada" : "idea.agregar_sin_plan", { id: decoracion.id, estado });
    } finally {
      setAgregandoId(null);
    }
  }

  /** «Reintentar» de un plan que no llegó; si traía una idea, su botón vuelve a decir «Agregando a tu plan…». */
  async function reintentarPlan(accion: Extract<AccionFallo, { tipo: "plan" }>): Promise<void> {
    const { idea } = accion;
    if (idea && !cargandoRef.current) setAgregandoId(idea.id);
    try {
      const estado = await aceptarPropuesta(accion.propuesta, { mensajeId: accion.mensajeId, ...(accion.planAnterior ? { planAnterior: accion.planAnterior } : {}), ...(idea ? { idea } : {}) });
      if (idea) registrarAccion(estado === "ok" ? "idea.agregada" : "idea.agregar_sin_plan", { id: idea.id, estado, reintento: true });
    } finally {
      if (idea) setAgregandoId(null);
    }
  }

  /** Lo que muestra el botón «Agregar al plan» de una idea con el plan vigente de este momento. */
  function datosAgregar(decoracion: DecoracionSempertex): DatosAgregarIdea | undefined {
    const estado = estadoAgregarIdea(decoracion, planVigente?.widget.plan ?? null, { ideasDelPlan: planVigente?.widget.ideas ?? [], agregandoId });
    if (!estado) return undefined;
    return {
      etiqueta: planVigente ? "Agregar a mi plan" : "Crear mi plan con esta idea",
      etiquetaCargando: planVigente ? "Agregando a tu plan…" : "Armando tu plan…",
      estado: estado.estado,
      ...(estado.ayuda ? { ayuda: estado.ayuda } : {}),
      ...(estado.motivo ? { motivo: estado.motivo } : {}),
      deshabilitado: cargando,
    };
  }

  /** «Ver mi plan» desde la idea ya agregada: lleva a la tarjeta del plan vigente. */
  function verPlanDesdeIdea(id: string): void {
    if (!planVigente) return;
    registrarAccion("idea.ver_plan", { id, mensajeId: planVigente.mensajeId });
    mostrarMensaje(planVigente.mensajeId);
  }

  /**
   * «Cuánto cuesta» / «Aprender» sobre el plan a la vista, por reglas: el precio dicho es el `cotizacion.total` de la tarjeta.
   * `conPeticion`: false cuando el cliente ya dijo lo que quería al tocar el chip de la idea (una sola burbuja suya).
   */
  function resolverOpcionConPlan(accion: AccionIdea, plan: NonNullable<typeof planVigente>, conPeticion: boolean): void {
    accionPlan(accion, plan.mensajeId, conPeticion ? "barra" : "opcion");
    if (accion !== "costear") return;
    agregar([
      ...(conPeticion ? [{ id: nuevoId(), role: "user" as const, content: TEXTO_OPCION_IDEA.costear(null) }] : []),
      { id: nuevoId(), role: "assistant", content: respuestaPrecioPlan(plan.widget, plan.widget.usoCosteo ?? uso ?? "personal") },
    ]);
  }

  function avanzarEspera(evento: EventoOpcionIdea): PasoOpcionIdea {
    const paso = avanzarOpcionIdea(esperaOpcionIdeaRef.current, evento);
    esperaOpcionIdeaRef.current = paso.espera;
    return paso;
  }

  function marcarChipOpcion(espera: EsperaOpcionIdea): void {
    if (espera.opcionesId) actualizarWidget(espera.opcionesId, "opciones", (widget) => ({ ...widget, elegida: espera.accion }));
  }

  /**
   * «Cuánto cuesta» / «Aprender» con una idea elegida y sin plan: UNA petición del cliente y el plan EXACTO guardado de la
   * idea en el mensaje siguiente, sin modelo; con él a la vista, la acción se resuelve por reglas (efecto de abajo). No
   * depende de que la idea se pueda sumar a un plan (las figuras también tienen precio). Si la idea no tiene plan guardado,
   * esa misma petición va al servidor con `accionIdea`, que la responde por reglas sin modelo (D-043); si el plan no llega (red,
   * plazo, «Detener»), se dice y se ofrece repetirlo, nunca un plan del modelo con otras cifras. `reintento`: los mensajes
   * del intento anterior, que se reutilizan.
   */
  async function pedirOpcionDeIdea(accion: AccionIdea, decoracion: DecoracionSempertex, opcionesId: string | null, reintento?: { usuarioId: string; mensajeId: string }): Promise<void> {
    if (cargandoRef.current) return;
    limpiarAvisos();
    const texto = TEXTO_OPCION_IDEA[accion](decoracion.titulo);
    const usuarioId = reintento?.usuarioId ?? nuevoId();
    const mensajeId = reintento?.mensajeId ?? nuevoId();
    const preparando = `${PREPARANDO_PLAN_IDEA} «${decoracion.titulo}» con sus globos exactos.`;
    if (reintento) actualizarMensaje(mensajeId, (mensaje) => ({ ...mensaje, content: preparando }));
    else agregar([{ id: usuarioId, role: "user", content: texto, envio: { accionIdea: accion } }, { id: mensajeId, role: "assistant", content: preparando }]);
    pedirFinal();
    esperaOpcionIdeaRef.current = { accion, ideaId: decoracion.id, mensajeId, sesion: sesionRef.current, opcionesId };
    registrarAccion("opcion.plan_exacto", { accion, id: decoracion.id, mensajeId, reintento: Boolean(reintento) });
    const resultado = await planExactoDeIdea(mensajeId, decoracion, null, { id: decoracion.id, titulo: decoracion.titulo, sumada: false }, "se dice y se ofrece repetirlo (sin modelo)");
    const paso = avanzarEspera({ tipo: "resultado", mensajeId, resultado });
    if (paso.turnoReglas) {
      registrarAccion("opcion.sin_plan_guardado", { accion, id: decoracion.id });
      marcarChipOpcion(paso.turnoReglas);
      setMensajes((actuales) => actuales.filter((mensaje) => mensaje.id !== usuarioId && mensaje.id !== mensajeId));
      void enviar(texto, { accionIdea: accion });
      return;
    }
    if (paso.reintento) {
      const detenido = resultado === "detenido";
      actualizarMensaje(mensajeId, (mensaje) => ({ ...mensaje, content: detenido ? "Detuviste la respuesta." : `No pude preparar el plan de «${decoracion.titulo}» ahora.` }));
      setFallo({
        titulo: detenido ? "Detuviste la respuesta" : "No pude preparar el plan de esta idea",
        detalle: detenido ? "Puedes pedirlo otra vez cuando quieras." : "Solo uso el plan de la idea para no darte cifras distintas. Inténtalo de nuevo en un momento.",
        etiqueta: "Intentar de nuevo",
        accion: { tipo: "opcion-idea", accion, ideaId: decoracion.id, usuarioId, mensajeId, opcionesId },
        mensajeId,
      });
    }
  }

  // «Cuánto cuesta» / «Aprender» de una idea elegida: con el plan exacto de la idea ya en SU mensaje, se resuelven por reglas
  // (la tarjeta del plan y su cotización única), sin turno de modelo ni otra burbuja del cliente.
  useEffect(() => {
    const paso = avanzarEspera({ tipo: "plan", mensajeId: idPlanVigente, ideas: planVigente?.widget.ideas ?? [], sesion: sesionRef.current });
    if (!paso.resolver || !planVigente) return;
    marcarChipOpcion(paso.resolver);
    resolverOpcionConPlan(paso.resolver.accion, planVigente, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando aparece un plan nuevo
  }, [idPlanVigente]);

  // El precio de la tarjeta «Tu elección»: UN pedido del plan exacto por idea elegida (sin modelo), con el mismo motor que la
  // cotización; si cambia la idea o se reinicia, el pedido de antes se cancela y su respuesta no cuenta (`precio-idea-elegida.ts`).
  const ideaElegidaId = seleccionada?.id ?? null;
  useEffect(() => {
    if (!ideaElegidaId) return;
    const sesion = sesionRef.current;
    const precioDelPlan = precioIdeaDesdePlanVigente(ideaElegidaId, sesion, planVigente?.widget ?? null);
    if (precioDelPlan) {
      setPrecioIdea(precioDelPlan);
      return;
    }
    const control = new AbortController();
    const reloj = window.setTimeout(() => control.abort("tiempo"), LIMITE_PLAN_IDEA_MS);
    setPrecioIdea(empezarPrecioIdea(ideaElegidaId, sesion));
    const cerrar = (respuesta: { ok: true; cotizacion: unknown } | { ok: false }) => control.signal.reason === "cambio" ? undefined : setPrecioIdea((actual) => resolverPrecioIdea(actual, { ideaId: ideaElegidaId, sesion, sesionVigente: sesionRef.current, respuesta }));
    planDeIdeaMotor({ ideaId: ideaElegidaId, base: null, signal: control.signal, alFallback: (fallo) => registrarFallo("plan.motor_3d_fallback", fallo.detalle, { razon: fallo.razon, estado: fallo.estado, idea: ideaElegidaId, accion: "precio de la tarjeta con Python" }, "warn") })
      .then((resultado) => {
        if (resultado.ok && control.signal.reason !== "cambio" && !reutilizarPlanIdea(planIdeaRef.current, ideaElegidaId, sesion)) planIdeaRef.current = { ideaId: ideaElegidaId, sesion, resultado };
        cerrar(resultado.ok ? { ok: true, cotizacion: resultado.cotizacion } : { ok: false });
      }, () => cerrar({ ok: false }));
    return () => { window.clearTimeout(reloj); control.abort("cambio"); setPrecioIdea((actual) => cancelarPrecioIdea(actual, ideaElegidaId)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia la idea elegida
  }, [ideaElegidaId]);

  function elegirOpcion(opcion: OpcionGuiada, mensajeId?: string): void {
    if (cargandoRef.current) return;
    registrarAccion("opcion.elegir", { opcion, mensajeId: mensajeId ?? null });
    avanzarEspera({ tipo: "otra-accion" });
    const ruta = rutaOpcionIdea(opcion, { hayIdea: Boolean(seleccionada), hayPlan: Boolean(planVigente), ideaEnElPlan: Boolean(seleccionada && planVigente?.widget.ideas?.includes(seleccionada.id)) });
    if (mensajeId && marcarChipAlElegir(ruta)) actualizarWidget(mensajeId, "opciones", (widget) => ({ ...widget, elegida: opcion }));
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
    if (ruta === "accion-plan" && planVigente && (opcion === "costear" || opcion === "aprender")) {
      resolverOpcionConPlan(opcion, planVigente, true);
      return;
    }
    if (ruta === "plan-exacto-de-idea" && seleccionada && (opcion === "costear" || opcion === "aprender")) {
      // Tras un fallo, tocar otra vez el mismo chip es «Intentar de nuevo»: reutiliza su burbuja y su mensaje.
      const previo = fallo?.accion.tipo === "opcion-idea" && fallo.accion.accion === opcion && fallo.accion.ideaId === seleccionada.id ? fallo.accion : null;
      void pedirOpcionDeIdea(opcion, seleccionada, mensajeId ?? null, previo ? { usuarioId: previo.usuarioId, mensajeId: previo.mensajeId } : undefined);
      return;
    }
    if (ruta === "turno-reglas" && seleccionada && (opcion === "costear" || opcion === "aprender")) {
      void enviar(TEXTO_OPCION_IDEA[opcion](seleccionada.titulo), { accionIdea: opcion });
      return;
    }
    const textos: Record<Exclude<OpcionGuiada, "contratar">, string> = {
      costear: TEXTO_OPCION_IDEA.costear(null),
      comprar: "Quiero saber dónde comprar los materiales.",
      aprender: TEXTO_OPCION_IDEA.aprender(seleccionada?.titulo ?? null),
    };
    void enviar(textos[opcion]);
  }

  function elegirUso(valor: Uso, mensajeId: string): void {
    if (cargandoRef.current) return;
    registrarAccion("uso.elegir", { uso: valor, mensajeId });
    actualizarWidget(mensajeId, "uso", (widget) => ({ ...widget, elegido: valor }));
    setUso(valor);
    const accionIdea = accionIdeaAlElegirUso({ hayIdea: Boolean(seleccionada), hayPlan: Boolean(planVigente), ideaEnElPlan: Boolean(seleccionada && planVigente?.widget.ideas?.includes(seleccionada.id)) });
    void enviar(valor === "negocio" ? "Es para mi negocio." : "Es para uso personal.", { uso: valor, ...(accionIdea ? { accionIdea } : {}) });
  }

  function elegirTipo(tipo: "completa" | "individual", mensajeId: string): void {
    if (cargandoRef.current) return;
    registrarAccion("propuesta.tipo", { tipo, mensajeId });
    actualizarWidget(mensajeId, "pregunta-propuesta", (widget) => ({ ...widget, elegida: tipo === "completa" ? "Decoración completa" : "Pieza individual" }));
    if (tipo === "completa") { void enviar("Propónme algo para una decoración completa con varias piezas.", { alcance: "completa" }); return; }
    if (proponerPiezaConocida("tipo")) return;
    limpiarAvisos();
    agregar([
      { id: nuevoId(), role: "user", content: "Una pieza individual." },
      { id: nuevoId(), role: "assistant", content: "¿Qué pieza individual prefieres?", widgets: [{ tipo: "pregunta-propuesta", alcance: "pieza" }] },
    ]);
    pedirFinal();
  }

  /**
   * La pieza que el cliente ya nombró con sus palabras (`brief.estructura`, hechos-cliente.ts: «arco orgánico» → el
   * arco completo con mezcla de tamaños) se propone directamente, como si la hubiera elegido en «¿Qué pieza individual
   * prefieres?»: el servidor lee la etiqueta como el texto (`piezaOrganicaDelBoton`) y la medida que dijo va a la pieza
   * (`propuestaConLoPedido`). Probador 124, hallazgo 4: el decorador dijo «arco orgánico de unos 3 metros» y «Propónme
   * algo» le volvió a preguntar «¿completa o pieza individual?» y «¿Qué pieza individual prefieres?».
   */
  function proponerPiezaConocida(origen: "proponme" | "tipo"): boolean {
    const pedida = brief.estructura;
    // Con un plan a la vista, o tras «Elegir otra pieza», «Propónme algo» pide otra cosa: se pregunta como siempre.
    if (!pedida || planVigente || otraPiezaRef.current) return false;
    const etiqueta = `${pedida.texto.charAt(0).toLocaleUpperCase("es")}${pedida.texto.slice(1)}`;
    registrarAccion("propuesta.pieza_conocida", { pieza: etiqueta, estructura: pedida.id, organica: Boolean(pedida.organica), medida: brief.medida?.texto ?? null, origen });
    void enviar(`Propónme una pieza individual: ${etiqueta}.`, { alcance: "individual", pieza: pedida.id });
    return true;
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
    const valida = fotoSubidaValida(archivo);
    registrarAccion("foto.elegir", { tipo: archivo.type, bytes: archivo.size, valida });
    if (!valida) {
      setFoto(null);
      setFallo({ titulo: "No pude leer tu foto", detalle: "Usa una foto JPG, PNG o WebP de menos de 6 MB.", etiqueta: "Elegir otra foto", accion: { tipo: "subir-foto" } });
      irAlFinal();
      return;
    }
    setFallo(null);
    setFoto(archivo);
    pedirEscritura("Envíala o cuéntame qué te gusta de ella…");
  }

  /** La foto de ejemplo no se pudo descargar de `public/`: se dice y se ofrece subir una propia. */
  function falloFotoEjemplo(ejemplo: { id: string; titulo: string }, causa: unknown): void {
    registrarFallo("foto.ejemplo.cargar", causa, { id: ejemplo.id, titulo: ejemplo.titulo });
    setFallo({ titulo: "No pude cargar esa foto de ejemplo", detalle: "Prueba con otra o sube una tuya.", etiqueta: "Subir una foto", accion: { tipo: "subir-foto" } });
    irAlFinal();
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
      case "plan": void reintentarPlan(accion); return;
      case "foto": void aceptarPlanFoto(accion.referenciaId, { mensajeId: accion.mensajeId, ...(accion.sinRemate ? { sinRemate: true } : {}), ...(accion.piezaNueva ? { piezaNueva: accion.piezaNueva } : {}) }); return;
      case "edicion": void reintentarEdicion(accion); return;
      case "opcion-idea": {
        setFallo(null);
        // Ya hay un plan con la idea: la acción se resuelve sobre él; si no, ese pedido quedó atrás y el mensaje lo dice.
        if (planVigente?.widget.ideas?.includes(accion.ideaId)) {
          marcarChipOpcion({ accion: accion.accion, ideaId: accion.ideaId, mensajeId: accion.mensajeId, sesion: sesionRef.current, opcionesId: accion.opcionesId });
          resolverOpcionConPlan(accion.accion, planVigente, false);
          return;
        }
        const decoracion = seleccionada?.id === accion.ideaId ? seleccionada : null;
        if (!decoracion) {
          actualizarMensaje(accion.mensajeId, (mensaje) => ({ ...mensaje, content: "Ese pedido quedó atrás: elige la idea otra vez y vuelve a tocar la opción." }));
          return;
        }
        void pedirOpcionDeIdea(accion.accion, decoracion, accion.opcionesId, { usuarioId: accion.usuarioId, mensajeId: accion.mensajeId });
        return;
      }
      case "recalcular-3d": recalcularPlan3d(accion.planHash); return;
      case "subir-foto": setFallo(null); archivoRef.current?.click(); return;
      // La conversación ya está en la sesión (se guarda en cada cambio) y el mensaje sin respuesta vuelve con «Reintentar».
      case "recargar": window.location.reload(); return;
    }
  }

  function alternativa(tipo: AlternativaFallo, actual: Fallo): { etiqueta: string; onElegir: () => void } {
    if (tipo === "otros-colores") return { etiqueta: "Usar otros colores", onElegir: () => { setFallo(null); pedirEscritura(PLACEHOLDER_CAMBIO, "Quiero otros colores: "); } };
    // Las dos salidas de un plan de foto que no salió: lo mismo que «Ver ideas parecidas» de la lectura, y subir otra.
    if (tipo === "idea-parecida") {
      const referenciaId = actual.accion.tipo === "foto" ? actual.accion.referenciaId : undefined;
      const frase = referenciaId ? mensajes.find((mensaje) => mensaje.id === referenciaId)?.referencia?.frase : undefined;
      return { etiqueta: "Elegir una idea parecida del catálogo", onElegir: () => { setFallo(null); registrarAccion("fallo.alternativa", { tipo }); void enviar((frase ? `Muéstrame ideas parecidas a mi foto: ${frase}` : "Muéstrame ideas parecidas a mi foto.").slice(0, 600)); } };
    }
    if (tipo === "otra-foto") return { etiqueta: "Probar con otra foto", onElegir: () => { setFallo(null); registrarAccion("fallo.alternativa", { tipo }); archivoRef.current?.click(); } };
    return { etiqueta: "Elegir otra pieza", onElegir: () => { setFallo(null); otraPiezaRef.current = true; void enviar(PROPONME); } };
  }

  function tarjetaFallo(actual: Fallo): ReactNode {
    return <TarjetaError
      titulo={actual.titulo}
      {...(actual.detalle ? { detalle: actual.detalle } : {})}
      {...(actual.etiqueta ? { reintentarEtiqueta: actual.etiqueta } : {})}
      {...(actual.variante ? { variante: actual.variante } : {})}
      onReintentar={() => reintentar(actual.accion)}
      onCerrar={() => setFallo(null)}
      {...(actual.alternativas?.length ? { alternativas: actual.alternativas.map((tipo) => alternativa(tipo, actual)) } : {})}
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
        // «Agregar a mi plan» en el carrusel solo con un plan vigente (sin plan, «Me gusta esta» lleva a crearlo).
        const vigenteAhora = planVigente;
        const estadosAgregar: Record<string, EstadoAgregarIdea | null> | undefined = vigenteAhora
          ? Object.fromEntries(widget.decoraciones.map((decoracion) => [decoracion.id, estadoAgregarIdea(decoracion, vigenteAhora.widget.plan, { ideasDelPlan: vigenteAhora.widget.ideas ?? [], agregandoId })?.estado ?? null]))
          : undefined;
        return <CarruselDecoraciones
          key={clave} decoraciones={widget.decoraciones} activo={activo && !elegidaId} elegidaId={elegidaId}
          onElegir={(decoracion) => elegirDecoracion(decoracion, mensajeId)} onNinguna={ningunaMeConvence} onProponer={() => void enviar(PROPONME)} onSubirFoto={() => archivoRef.current?.click()}
          estadosAgregar={estadosAgregar} agregarDeshabilitado={cargando}
          onAgregar={vigenteAhora ? (decoracion) => void agregarIdeaAlPlan(decoracion, "carrusel", mensajeId) : undefined}
        />;
      }
      case "seleccion":
        return <TarjetaEleccion
          key={clave} decoracion={widget.decoracion} agregar={datosAgregar(widget.decoracion)}
          onAgregar={() => void agregarIdeaAlPlan(widget.decoracion, "eleccion", mensajeId)}
          onVerPlan={planVigente ? () => verPlanDesdeIdea(widget.decoracion.id) : undefined}
          precio={vistaPrecioIdea(precioIdea, widget.decoracion.id, uso)}
        />;
      case "opciones":
        return <ChipsOpciones key={clave} activo={activo && !widget.elegida} elegida={widget.elegida ?? null} hechas={hechasOpciones} deshabilitado={cargando} onElegir={(opcion) => elegirOpcion(opcion, mensajeId)} />;
      case "uso":
        return <PreguntaUso key={clave} activo={activo && !widget.elegido} elegido={widget.elegido ?? null} deshabilitado={cargando} onElegir={(valor) => elegirUso(valor, mensajeId)} />;
      case "cotizacion":
        return <CostosMateriales key={clave} cotizacion={widget.cotizacion} noIncluidos={noIncluidos[clave]} decoracion={widget.decoracion} uso={widget.uso} clave={`guiado-${widget.decoracion.id}`} mensajePendiente="Todavía no tengo el precio de estos materiales. Puedo buscarte un proveedor cerca." onProveedores={() => preguntarCiudad("ciudad-decorador", "Quiero cotizar con un proveedor cerca")} />;
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
        const estado = widget.estado === "en_espera" ? "en_espera" : widget.estado === "fallo" || !cargando ? "fallo" : "resolviendo";
        return <TarjetaPropuesta key={clave} frase={widget.propuesta.frase} piezas={widget.propuesta.piezas} colores={widget.propuesta.colores} estado={estado} {...(etapaPlan[mensajeId] ? { etapa: etapaPlan[mensajeId] } : {})} />;
      }
      case "plan": {
        const vigente = !widget.reemplazado;
        const imagen = imagenesLocales[mensajeId] ?? widget.imagen ?? null;
        const estadoImagen: EstadoImagen = imagenEnCurso === mensajeId ? "cargando" : widget.errorImagen ? "error" : imagen ? "lista" : "nada";
        return <div key={clave} className="w-full">
          {widget.agregada && (
            <motion.p
              initial={reducido || restaurados.has(mensajeId) ? false : { opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: DUR.media, ease: EASE_SALIDA }}
              className={`mt-3 flex items-start gap-2 rounded-2xl bg-exito-suave px-3.5 py-2.5 text-sm font-medium text-exito ${vigente ? "" : "opacity-70"}`}
              data-testid="idea-agregada"
            >
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{textoIdeaAgregada(widget.agregada.titulo, widget.agregada.total, widget.totalAnterior !== undefined)}</span>
            </motion.p>
          )}
          <NotasPlan widget={widget} vigente={vigente} />
          <TarjetaPlan
            plan={widget.plan}
            {...(widget.cotizacion ? { cotizacion: widget.cotizacion } : {})}
            imagen={imagen}
            {...(widget.avisoImagen ? { avisoImagen: widget.avisoImagen } : {})}
            estadoImagen={estadoImagen}
            {...(widget.falloImagen ? { falloImagen: widget.falloImagen } : {})}
            motor={widget.motor}
            usoCosteo={widget.usoCosteo ?? null}
            usoConocido={uso}
            compraAbierta={Boolean(widget.compraAbierta)}
            vigente={vigente}
            ocupado={cargando || imagenEnCurso !== null}
            hechas={widget.hechas ?? []}
            {...(widget.totalAnterior !== undefined ? { totalAnterior: widget.totalAnterior } : {})}
            contextoCompra={brief}
            onAccion={(accion) => accionPlan(accion, mensajeId, "tarjeta")}
            onCosteo={(valor, origen) => {
              // `origen`: «conocido» = ya lo había dicho (no se le preguntó); «elegido» o «cambio» = lo dijo aquí y pasa a ser su uso.
              registrarAccion("plan.costeo_uso", { uso: valor, mensajeId, origen });
              if (origen !== "conocido") setUso(valor);
              actualizarWidget(mensajeId, "plan", (actual) => ({ ...actual, usoCosteo: valor, hechas: conHecha(actual.hechas, "costear") }));
            }}
            onProveedores={() => preguntarCiudad("ciudad-decorador", "Quiero cotizar con un proveedor cerca")}
            onDistribuidor={() => preguntarCiudad("ciudad-distribuidor", "Quiero comprar con un distribuidor cerca")}
            {...(widget.ajustes?.length ? { ajustes: widget.ajustes } : {})}
            recalculandoPorChat={editandoPlanId === mensajeId}
            {...(widget.fotoInspiracion ? { avisosFoto: avisosFotoDelPlan(mensajes, mensajeId, widget.plan) } : {})}
            {...(vigente && deshacerAjuste.puede(mensajeId, widget) ? { onDeshacer: () => deshacerUltimoAjuste(mensajeId) } : {})}
            {...(vigente ? {
              onPlanAjustado: (nuevo: PlanGuiado, cotizacionNueva: unknown, ajuste: AjustePublicado) => { ajustarPlan(mensajeId, nuevo, cotizacionNueva, ajuste); },
              // Los cambios rápidos que rehace el asistente, desde «Ajustar mi plan» (los mismos de antes como chips).
              onSugerencia: (texto: string) => elegirRapida(texto),
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
        ? { titulo: "No pude terminar tu plan", detalle: "Tu conversación sigue guardada.", accion: { tipo: "plan", propuesta: propuestaFallida.propuesta, mensajeId: mensaje.id, ...(planVigente ? { planAnterior: planActualDelPlan(planVigente.widget.plan, planVigente.widget.motor) ?? undefined } : {}) }, alternativas: ["otros-colores", "otra-pieza"] } satisfies Fallo
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
      {mensaje.widgets?.map((widget, posicion) => renderWidget(widget, activo, claveDeWidget(mensaje.id, posicion), mensaje, indice))}
      {falloPropio && tarjetaFallo(falloPropio)}
    </>;
  }

  const falloSuelto = fallo && (!fallo.mensajeId || !mensajes.some((mensaje) => mensaje.id === fallo.mensajeId)) ? fallo : null;
  const barraVisible = Boolean(planVigente && ultimoAsistente && ultimoAsistente.id !== planVigente.mensajeId);
  const totalVigente = useMemo(() => (planVigente ? totalDePlan(planVigente.widget.plan) : 0), [planVigente]);

  return <main className="app-shell h-dvh overflow-hidden">
    {/* «Empezar de nuevo» (probador 124, hallazgo 15): la misma limpieza que «Limpiar chat» (`vaciar`), con confirmación. */}
    <CabeceraApp contexto={contexto} modoVista={modo} onModoVista={cambiar} onLimpiar={pedirEmpezarDeNuevo} limpiarDeshabilitado={!mensajes.length} etiquetaLimpiar="Empezar de nuevo" iconoLimpiar={<RotateCcw className="size-4" />} totalSeleccion={0} ocultarModoDev />
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
            {/* La galería de la clásica (las 10 fotos de ejemplo): la elegida entra por `elegirFoto`, como una subida. */}
            {restaurado && !mensajes.length && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: DUR.media }} className="mt-1.5">
                <FotosEjemploGuiada deshabilitado={!hidratado} fotoActual={foto} onFoto={elegirFoto} onRegistrar={registrarAccion} onFallo={falloFotoEjemplo} />
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
                <CalificacionGuiada mensajes={mensajes} indice={indice} listo={transmitiendoId !== mensaje.id} />
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
    <ConfirmarEmpezarDeNuevo abierto={confirmandoReinicio} conPlan={Boolean(planVigente)} onConfirmar={confirmarEmpezarDeNuevo} onCancelar={cancelarEmpezarDeNuevo} />
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

function buscarPlanVigente(lista: readonly Mensaje[]): { mensajeId: string; widget: WidgetPlan } | null {
  for (let indice = lista.length - 1; indice >= 0; indice -= 1) {
    const widget = lista[indice]!.widgets?.find((item): item is WidgetPlan => item.tipo === "plan" && !item.reemplazado);
    if (widget) return { mensajeId: lista[indice]!.id, widget };
  }
  return null;
}

function ultimoIndiceConReferencia(lista: readonly Mensaje[]): number {
  for (let indice = lista.length - 1; indice >= 0; indice -= 1) if (lista[indice]!.referencia) return indice;
  return -1;
}

/**
 * La lectura de foto que todavía espera «Sí, armémoslo»: la última, sin plan armado con ella y posterior al plan vigente
 * (si lo hay). Con ella, «agrégale una guirnalda» suma la pieza a las de la foto.
 */
function lecturaPendiente(lista: readonly Mensaje[], planMensajeId: string | null): Mensaje | null {
  const indice = ultimoIndiceConReferencia(lista);
  const mensaje = indice >= 0 ? lista[indice] : undefined;
  if (!mensaje?.referencia || mensaje.fotoArmada) return null;
  const indicePlan = planMensajeId ? lista.findIndex((item) => item.id === planMensajeId) : -1;
  return indice > indicePlan ? mensaje : null;
}

/**
 * El mensaje con la lectura de la foto de la que salió el plan de `mensajeId`: el que el plan recuerda (`referenciaId`,
 * que pasa a cada versión rehecha) o, en un plan guardado antes de recordarlo, la última foto leída ANTES de ese mensaje
 * («Sí, armémoslo» siempre deja el plan después de su lectura). Vive en el mensaje guardado, así que sobrevive a recargar
 * aunque la foto no.
 */
function mensajeLecturaDelPlan(lista: readonly Mensaje[], mensajeId: string): Mensaje | undefined {
  const indicePlan = lista.findIndex((mensaje) => mensaje.id === mensajeId);
  const recordado = planDelMensaje(lista[indicePlan])?.referenciaId;
  const delPlan = recordado ? lista.find((mensaje) => mensaje.id === recordado && mensaje.referencia) : undefined;
  if (delPlan) return delPlan;
  for (let indice = indicePlan - 1; indice >= 0; indice -= 1) if (lista[indice]!.referencia) return lista[indice];
  return undefined;
}

function lecturaDelPlan(lista: readonly Mensaje[], mensajeId: string): Mensaje["referencia"] {
  return mensajeLecturaDelPlan(lista, mensajeId)?.referencia;
}

/** Los acabados que la foto del plan muestra y el plan no compra («La foto muestra rosa satinado; …»), probador 141. */
function avisosFotoDelPlan(lista: readonly Mensaje[], mensajeId: string, plan: PlanGuiado): string[] {
  const referencia = lecturaDelPlan(lista, mensajeId);
  // Y las flores de globo que la lectura prometió y el plan no lleva (o sin su centro): la tarjeta no enseña el texto
  // del modelo, así que `avisos_cliente` no llega aquí (`flores-pieza.ts`).
  return referencia ? [...acabadosFotoSinComprar(lecturaFoto(referencia.blueprint), plan), ...avisosFloresFotoSinComprar(referencia.blueprint, plan.plan)] : [];
}

type FotoDelPlan = {
  referenciaId: string;
  blueprint: NonNullable<Mensaje["referencia"]>["blueprint"];
  /** La foto, si sigue en memoria (no sobrevive a recargar; la lectura sí). */
  imagen?: FotoInspiracion;
  /** Cada pieza del plan con su elemento de la foto y lo que el plan no arma (`referenciaDelPlan`). */
  referencia: ReferenciaDelPlan | null;
};

/** La foto de la que salió el plan vigente, para rehacerlo sin perderla; null si el plan no salió de una foto. */
function fotoDelPlan(lista: readonly Mensaje[], vigente: { mensajeId: string; widget: WidgetPlan } | null, fotos: ReadonlyMap<string, FotoInspiracion>): FotoDelPlan | null {
  if (!vigente?.widget.fotoInspiracion) return null;
  const lectura = mensajeLecturaDelPlan(lista, vigente.mensajeId);
  if (!lectura?.referencia) return null;
  const imagen = fotos.get(vigente.mensajeId) ?? fotos.get(lectura.id);
  return { referenciaId: lectura.id, blueprint: lectura.referencia.blueprint, ...(imagen ? { imagen } : {}), referencia: referenciaDelPlan(vigente.widget.plan) };
}

/** Lo que escribió (o eligió con un botón) el cliente, en orden: de aquí salen sus palabras para el plan y la imagen. */
function textosDelCliente(lista: readonly Mensaje[]): string[] {
  return lista.filter((mensaje) => mensaje.role === "user").map((mensaje) => mensaje.content);
}

/** El aviso de «Agregar al plan» (en la tarjeta y para el lector de pantalla). `sumada`: la idea se sumó a un plan que ya había. */
function textoIdeaAgregada(titulo: string, total: number, sumada: boolean): string {
  return sumada ? `Agregué «${titulo}» a tu plan: ahora tiene ${total} globos.` : `Armé tu plan con «${titulo}»: tiene ${total} globos.`;
}

function conHecha(hechas: WidgetPlan["hechas"], accion: AccionPlan): NonNullable<WidgetPlan["hechas"]> {
  const actuales = hechas ?? [];
  return actuales.includes(accion) ? actuales : [...actuales, accion];
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
    let accionesCrudas: unknown = null;
    try { accionesCrudas = JSON.parse(sessionStorage.getItem(CLAVE_ACCIONES_IDEA) ?? "null") as unknown; } catch { accionesCrudas = null; }
    const mensajes = juntarAccionesIdea(parsed.data.mensajes, accionesCrudas)
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

/** Milisegundos desde que se llama (para el registro de un cambio por chat; nunca durante el pintado). */
function cronometro(): () => number {
  const inicio = performance.now();
  return () => Math.round(performance.now() - inicio);
}

/** «¡Buena elección! Esto es lo que lleva…»: lo que responde «Me gusta esta» (y elegir una idea con palabras). */
function textoIdeaElegida(titulo: string): string {
  return `¡Buena elección! Esto es lo que lleva **${titulo}**. ¿Qué te gustaría hacer ahora?`;
}

/** Las ideas del último carrusel de la conversación, en su orden (id y título), para `elegir_idea`. */
function ideasALaVista(mensajes: readonly Mensaje[]): IdeaVisibleGuiada[] {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const carrusel = mensajes[indice]!.widgets?.find((widget) => widget.tipo === "decoraciones");
    if (carrusel?.tipo !== "decoraciones") continue;
    return carrusel.decoraciones.slice(0, 12).flatMap((decoracion) => {
      const idea = IdeaVisibleGuiadaSchema.safeParse({ id: decoracion.id, titulo: decoracion.titulo.slice(0, 160) });
      return idea.success ? [idea.data] : [];
    });
  }
  return [];
}

/** El mensaje del último carrusel que trae esa idea (para marcarla elegida, como «Me gusta esta»). */
function mensajeDelCarrusel(mensajes: readonly Mensaje[], id: string): string | null {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    if (mensajes[indice]!.widgets?.some((widget) => widget.tipo === "decoraciones" && widget.decoraciones.some((decoracion) => decoracion.id === id))) return mensajes[indice]!.id;
  }
  return null;
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
    // Un evento que esta página no entiende suele ser de otro despliegue: quien llama decide si pide recargar.
    if (!evento.success) throw new RespuestaIncompatibleError("contrato", "La respuesta del asistente no cumple el contrato.", respuesta.headers.get(CABECERA_VERSION_APP), { campos: camposInvalidos(evento.error) });
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
  const reloj = window.setTimeout(cortar, LIMITE_FOTO_MS * factorPlazoCliente());
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

/**
 * La foto de inspiración preparada EXACTAMENTE como la prepara la clásica (`prepararFotoReferencia`: rotación EXIF,
 * lado mayor 1800 px, JPEG 0,9), para que `/api/references/analyze` lea la misma imagen en las dos vistas. Antes la
 * guiada mandaba el archivo crudo (otra resolución, otra compresión y sin girar una foto de celular).
 */
async function leerFoto(archivo: File): Promise<FotoInspiracion> {
  const { base64 } = await prepararFotoReferencia(archivo);
  return { mime: "image/jpeg", base64 };
}

function suscribirNada(): () => void {
  return () => {};
}
