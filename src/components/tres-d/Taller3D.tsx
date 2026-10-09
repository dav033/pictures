"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, Camera, Check, ChevronDown, CircleHelp, House, Layers, LayoutGrid, MoveVertical, Plus, Redo2, RotateCw, Scan, ShoppingCart, SlidersHorizontal, Sparkles, Undo2, X,
} from "lucide-react";
import { ControlesPieza } from "./ControlesTactiles";
import { FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { papelDeConfeti } from "./armada-visor";
import type { EscenaGlobos, GloboColocadoEnEscena, GloboEnEscena, TuboEnEscena, VistaFija } from "./escena-globos";
import { DIBUJO_VACIO, globoAEscena, materialesEnIngles, R12, tuboAEscena, type DibujoEscena } from "./dibujo-escena";
import { descripcionRender3d, formatoEnIngles } from "@/lib/globos3d/render-ia";
import { GeneradorIA } from "./GeneradorIA";
import { PaletaEscena } from "./PaletaEscena";
import { reemplazarColor } from "@/lib/globos3d/recolorear";
import { armarEscena, escenaEnIngles, idNuevo, type Escena, type EscenaArmada, type NodoEscena } from "@/lib/globos3d/escena";
import { ESCENAS_PREDEFINIDAS, escenaPredefinida } from "@/lib/globos3d/escenas-presets";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { useEdicionEscena, useHistorialEscena, type PiezaEnVivo } from "./useEdicionEscena";
import { useLienzoDecoraciones, type CopiaElegida } from "./useLienzoDecoraciones";
import { ArrastreDecoracionContexto } from "./arrastre-decoracion";
import { follajeEnIngles } from "@/lib/globos3d/flores-artificiales";
import { medirFuera } from "./medicion-visor";
import { MenuContextual, type AccionMenu } from "./MenuContextual";
import { useMenuContextual } from "./useMenuContextual";
import { cargarSolitario, useEditorSolitario } from "./useEditorSolitario";
import type { InfoMenuPieza } from "@/lib/globos3d/editor-solitario";
import type { ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import type { SeleccionIA } from "@/lib/globos3d/cuerpo-escena-ia";
import { Ayuda } from "./AyudaTaller";
import { MenuMas } from "./MenuMas";
import { BannerVerAntes } from "./ia/BannerVerAntes";
import { PanelIA } from "./ia/PanelIA";
import { PestanasLaterales, type PestanaLateral } from "./ia/PestanasLaterales";
import { useAsistenteIA } from "./ia/useAsistenteIA";
import { useNombresDePasos } from "./ia/useNombresDePasos";
import { useResaltadoIA } from "./ia/useResaltadoIA";
import { DialogoTaller } from "./DialogoTaller";
import { Inspector } from "./Inspector";
import { PanelPiezas } from "./PanelPiezas";
import { PartesSolitario } from "./PartesSolitario";
import { EditorSala } from "./PanelEscena";
import { ListaCompra } from "./ListaCompra";
import { BarraHerramientas, EtiquetaElegida, ReglaAlturas, type Herramienta } from "./SobreVisor";
import { medidaPrincipal, NOMBRE_TIPO } from "./tipos-pieza";
import { leerGuardada, guardarEscena } from "./guardado-escena";
import type { PestanaAnadir } from "./PanelAnadir";
import type { PiezaParaAnadir } from "./nuevas-taller";
import type { VistaSolitario } from "./ParametrosPieza";
import { BTN, BTN_ICO, BTN_PRI, FLOTANTE, RIEL, RIEL_ON } from "./ui-taller";

/**
 * Lo pesado se carga aparte, al abrirlo: el panel «Añadir» (con la Biblioteca: todas las ideas de Sempertex, su índice
 * y sus fichas), las plantillas con miniatura, los productos exactos de la tienda y los parámetros del editor solitario.
 * Importarlos con la página la hacía pesada (y, cuando los lotes armaban al importarse, congelaba /3d ~20 s).
 */
const Cargando = () => <p className="p-4 text-sm text-taller-suave" role="status">Cargando…</p>;
const PanelAnadir = dynamic(() => import("./PanelAnadir").then((m) => m.PanelAnadir), { ssr: false, loading: Cargando });
const FichaDialogo = dynamic(() => import("./Biblioteca").then((m) => m.FichaDialogo), { ssr: false, loading: Cargando });
const TarjetasPlantillas = dynamic(() => import("./Biblioteca").then((m) => m.TarjetasPlantillas), { ssr: false, loading: Cargando });
const ProductosEscena = dynamic(() => import("./Biblioteca").then((m) => m.ProductosEscena), { ssr: false, loading: Cargando });
const AccionesPieza = dynamic(() => import("./Biblioteca").then((m) => m.AccionesPieza), { ssr: false });
const ParametrosPieza = dynamic(() => import("./ParametrosPieza").then((m) => m.ParametrosPieza), { ssr: false, loading: Cargando });

/** El mismo corte que `lg:` de Tailwind: desde 1024 px, riel + paneles + inspector; menos, visor a pantalla y hoja. */
const CONSULTA_ANCHO = "(min-width: 1024px)";
function suscribirAncho(aviso: () => void) {
  const consulta = window.matchMedia(CONSULTA_ANCHO);
  consulta.addEventListener("change", aviso);
  return () => consulta.removeEventListener("change", aviso);
}
/** Pantalla ancha (escritorio o tablet acostada). En el servidor se supone ancha; el navegador corrige al hidratar. */
function useEsAncho() {
  return useSyncExternalStore(suscribirAncho, () => window.matchMedia(CONSULTA_ANCHO).matches, () => true);
}

type Panel = "anadir" | "piezas" | "plantillas" | "sala";
type AlturaHoja = "cerrada" | "media" | "alta";
type PestanaHoja = "anadir" | "piezas" | "pieza" | "ia" | "parametros" | "partes";
const ALTURAS: readonly AlturaHoja[] = ["cerrada", "media", "alta"];
/** Alto de la hoja del teléfono (el visor sigue a pantalla completa debajo). */
const ALTURA_HOJA: Readonly<Record<AlturaHoja, string>> = { cerrada: "h-auto", media: "h-[44dvh]", alta: "h-[78dvh]" };

const PANELES: ReadonlyArray<{ id: Panel; nombre: string; icono: ReactNode }> = [
  { id: "anadir", nombre: "Añadir", icono: <Plus className="size-5" aria-hidden /> },
  { id: "piezas", nombre: "Piezas", icono: <Layers className="size-5" aria-hidden /> },
  { id: "plantillas", nombre: "Plantillas", icono: <LayoutGrid className="size-5" aria-hidden /> },
  { id: "sala", nombre: "Sala", icono: <House className="size-5" aria-hidden /> },
];

/** Una tecla del taller, como si se pulsara (los botones táctiles usan la misma lógica del teclado). */
function pulsar(key: string, opciones: { shiftKey?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opciones }));
}

/**
 * Una función estable que siempre llama a la última versión de `f`: así los paneles memorizados (y los ocultos) no se
 * vuelven a pintar porque cambió una función.
 */
function useEstable<A extends unknown[], R>(f: (...args: A) => R): (...args: A) => R {
  const ref = useRef(f);
  useLayoutEffect(() => { ref.current = f; });
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Para saber si ya se hidrató (en el servidor, `false`). */
const sinSuscripcion = () => () => {};

function escribiendo(objetivo: EventTarget | null): boolean {
  return objetivo instanceof HTMLElement && (objetivo.isContentEditable || Boolean(objetivo.closest("input, textarea, select, [contenteditable='true'], [role='menu'], dialog")));
}

/**
 * Página /3d: el Taller 3D. Barra superior (escena, deshacer, imagen con IA, lista de compra), riel de paneles (Añadir,
 * Piezas, Plantillas, Sala), el visor a todo lo que queda (herramientas flotantes, etiqueta de la pieza elegida,
 * contador y la IA al pie) e inspector de la pieza elegida. «Editar sola» abre el editor solitario de una pieza con
 * los parámetros completos de su tipo. En teléfono y tablet: visor a pantalla completa y hoja inferior con pestañas.
 */
export function Taller3D() {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const escenaRef = useRef<EscenaGlobos | null>(null);
  const visorCajaRef = useRef<HTMLElement>(null);
  const [visor, setVisor] = useState<EscenaGlobos | null>(null);
  const listo = visor !== null;
  const [error, setError] = useState<string | null>(null);

  // Escena (con deshacer y rehacer: Ctrl+Z / Ctrl+Y) y su nombre; se guarda sola en el navegador.
  // La última escena guardada en este navegador (si hay) en vez de la de partida. En el servidor no hay navegador: hasta
  // hidratar (`cargada`) no se pinta nada que dependa de la escena, así lo del servidor y lo del navegador coinciden.
  const [guardadaAlAbrir] = useState(() => (typeof window === "undefined" ? null : leerGuardada()));
  const historialEscena = useHistorialEscena(() => guardadaAlAbrir?.escena ?? escenaPredefinida("arco_organico_columnas_guirnalda"));
  const escenaEdit = historialEscena.escena;
  const setEscenaEdit = historialEscena.cambiar;
  const [nombreEscena, setNombreEscena] = useState(() => guardadaAlAbrir?.nombre ?? ESCENAS_PREDEFINIDAS.find((p) => p.id === "arco_organico_columnas_guirnalda")?.nombre ?? "Mi escena");
  const cargada = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  const [ultimoGuardado, setUltimoGuardado] = useState<{ escena: Escena; nombre: string; ok: boolean } | null>(null);
  const guardado = !ultimoGuardado ? (guardadaAlAbrir ? "guardado" : "guardando") : ultimoGuardado.escena !== escenaEdit || ultimoGuardado.nombre !== nombreEscena ? "guardando" : ultimoGuardado.ok ? "guardado" : "sin-guardar";
  // Piezas ya armadas por su JSON: mover una pieza no rehace el arco orgánico (medio segundo).
  const [cacheEscena] = useState(() => new Map<string, PiezaArmada>());
  // Editor solitario: lo que se ve y se edita es la estructura aislada con su propio deshacer; «Listo» la devuelve.
  const solitario = useEditorSolitario({ escena: escenaEdit, cambiarEscena: setEscenaEdit, cache: cacheEscena, visorRef: escenaRef });
  const escenaVista = solitario.escena;
  const cambiarVista = solitario.activo ? solitario.cambiar : setEscenaEdit;
  const deshacerVista = solitario.activo ? solitario.deshacer : historialEscena.deshacer;
  const rehacerVista = solitario.activo ? solitario.rehacer : historialEscena.rehacer;
  const puedeDeshacerVista = solitario.activo ? solitario.puedeDeshacer : historialEscena.puedeDeshacer;
  const puedeRehacerVista = solitario.activo ? solitario.puedeRehacer : historialEscena.puedeRehacer;
  // La IA (pestaña «IA» del panel derecho): cada turno es UN paso nombrado del historial global; Ctrl+Z y «Deshacer turno» van juntos.
  const nombresPasos = useNombresDePasos();
  const aplicarIA = useCallback((escena: Escena, etiqueta: string) => { nombresPasos.nombrar(escena, etiqueta); cambiarVista(escena); }, [nombresPasos, cambiarVista]);
  const ia = useAsistenteIA({ escena: escenaVista, ambito: solitario.activo ? "pieza" : "escena", cache: cacheEscena, aplicar: aplicarIA, inicial: guardadaAlAbrir?.conversacion ?? [] });
  const pasoDeshacer = nombresPasos.nombreDe(escenaVista);
  const rotuloDeshacer = pasoDeshacer ? `Deshacer ${pasoDeshacer}` : "Deshacer";
  /** Una pieza recién creada desde «Añadir → Nuevas» y abierta en el editor: «Cancelar» la quita. */
  const nuevaRef = useRef<string | null>(null);
  const [pestanaLado, setPestanaLado] = useState<PestanaLateral>("pieza");
  const [vistaSolitario, setVistaSolitario] = useState<VistaSolitario>({ verAnclas: false, todosLosGlobos: false });

  const [seleccionElegida, setSeleccion] = useState<string | null>(null);
  const seleccion = seleccionElegida && escenaVista.nodos.some((n) => n.id === seleccionElegida) ? seleccionElegida : null;
  const [enVivo, setEnVivo] = useState<PiezaEnVivo | null>(null);
  const [copiaTocada, setCopiaTocada] = useState<CopiaElegida | null>(null);
  const copiaElegida = copiaTocada && copiaTocada.id === seleccion ? copiaTocada : null;
  const [avisoLienzo, setAvisoLienzo] = useState<string | null>(null);
  const [vueltaEncuadre, setVueltaEncuadre] = useState(0);
  const encuadradoRef = useRef<number | null>(null);
  const [armadas] = useState(() => new WeakMap<Escena, EscenaArmada>());
  const [dibujos] = useState(() => new WeakMap<EscenaArmada, DibujoEscena>());
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; tactil: boolean } | null>(null);
  const [infoMenu, setInfoMenu] = useState<{ id: string; info: InfoMenuPieza } | null>(null);
  const [avisoQuitar, setAvisoQuitar] = useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState<{ id: string; decoraciones: number } | null>(null);
  /** Piezas ocultas en el visor (siguen en la escena y en la lista de compra). */
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set());
  // Interfaz: panel abierto, pestaña de «Añadir», herramienta del visor, vista fija, diálogos.
  const esAncho = useEsAncho();
  const [panel, setPanelElegido] = useState<Panel | null>("piezas");
  /** Los paneles que ya se abrieron alguna vez (quedan montados). */
  const [panelesVistos, setPanelesVistos] = useState<ReadonlySet<Panel>>(() => new Set<Panel>(["piezas"]));
  const setPanel = useCallback((p: Panel | null | ((actual: Panel | null) => Panel | null)) => {
    setPanelElegido((actual) => {
      const nuevo = typeof p === "function" ? p(actual) : p;
      if (nuevo) setPanelesVistos((v) => (v.has(nuevo) ? v : new Set(v).add(nuevo)));
      return nuevo;
    });
  }, []);
  const [pestanaAnadir, setPestanaAnadir] = useState<PestanaAnadir>("estructuras");
  const [herramienta, setHerramienta] = useState<Herramienta>("mover");
  const [vistaFija, setVistaFija] = useState<VistaFija | null>("3d");
  const [dialogo, setDialogo] = useState<"lista" | "imagen" | "ayuda" | null>(null);
  const [ficha, setFicha] = useState<ItemBiblioteca | null>(null);
  const [pedirGuardar, setPedirGuardar] = useState(0);
  const [renombrando, setRenombrando] = useState(false);
  const [menuMas, setMenuMas] = useState(false);
  const [colgarEnSolitario, setColgarEnSolitario] = useState(false);
  // Teléfono y tablet: la hoja inferior.
  const [hoja, setHoja] = useState<AlturaHoja>("media");
  const [pestanaHoja, setPestanaHoja] = useState<PestanaHoja>("piezas");
  const [hojasVistas, setHojasVistas] = useState<ReadonlySet<PestanaHoja>>(() => new Set<PestanaHoja>());
  const deslizarHoja = useRef<number | null>(null);
  const [alturaMovil, setAlturaMovil] = useState(false);

  // El visor se crea una vez (three.js se carga solo en el navegador).
  useEffect(() => {
    let vivo = true;
    let observador: ResizeObserver | null = null;
    void import("./escena-globos").then(({ crearEscena }) => {
      if (!vivo || !lienzoRef.current) return;
      try {
        const escena = crearEscena(lienzoRef.current);
        escenaRef.current = escena;
        observador = new ResizeObserver(() => escena.redimensionar());
        observador.observe(lienzoRef.current);
        setVisor(escena);
      } catch (causa) {
        setError("Tu navegador no pudo abrir el visor 3D (WebGL). Prueba con Chrome o Edge actualizados.");
        console.error("[3d]", causa);
      }
    });
    return () => {
      vivo = false;
      observador?.disconnect();
      escenaRef.current?.destruir();
      escenaRef.current = null;
    };
  }, []);

  // Guardar solo (medio segundo después del último cambio).
  useEffect(() => {
    if (!cargada) return;
    const t = setTimeout(() => setUltimoGuardado({ escena: escenaEdit, nombre: nombreEscena, ok: guardarEscena({ nombre: nombreEscena, escena: escenaEdit, conversacion: ia.turnos }) }), 500);
    return () => clearTimeout(t);
  }, [cargada, escenaEdit, nombreEscena, ia.turnos]);

  const armadaEscena = useMemo(() => {
    if (!cargada) return null;
    const hecha = armadas.get(escenaVista);
    if (hecha) return hecha;
    const nueva = medirFuera("armarEscena", () => armarEscena(escenaVista, cacheEscena));
    armadas.set(escenaVista, nueva);
    return nueva;
  }, [cargada, escenaVista, cacheEscena, armadas]);

  // «Ver antes» (IA): el visor dibuja la escena sin lo del turno; los paneles y la edición siguen con la real (y se bloquea editar).
  const armadaAntes = useMemo(() => (ia.escenaAntes ? armarEscena(ia.escenaAntes, cacheEscena) : null), [ia.escenaAntes, cacheEscena]);
  const armadaMostrada = armadaAntes ?? armadaEscena;

  // Lo que dibuja el visor. Cada cosa lleva el id de su pieza: un clic la elige y al arrastrarla se mueve todo lo suyo.
  const dibujoEscena = useMemo((): DibujoEscena | null => {
    if (!armadaMostrada) return null;
    const hecho = dibujos.get(armadaMostrada);
    if (hecho) return hecho;
    const dibujo: DibujoEscena = {
      globos: armadaMostrada.porNodo.flatMap((n) => {
        const papel = n.globos.some((g) => g.confeti) ? papelDeConfeti(n.globos) : null;
        return n.globos.map((g): GloboColocadoEnEscena => ({ ...globoAEscena(g, R12), ...(g.confeti ? { confeti: true, ...(papel ? { confetiHex: papel } : {}) } : {}), nodo: n.id }));
      }),
      tubos: armadaMostrada.porNodo.flatMap((n) => n.tubos.map((t): TuboEnEscena => ({ ...tuboAEscena(t), nodo: n.id }))),
      flores: armadaMostrada.porNodo.flatMap((n) => n.flores.map((f) => ({ ...f, nodo: n.id }))),
      solidos: armadaMostrada.porNodo.flatMap((n) => n.solidos.map((x) => ({ ...x, nodo: n.id }))),
    };
    dibujos.set(armadaMostrada, dibujo);
    return dibujo;
  }, [armadaMostrada, dibujos]);
  // Sin lo oculto (las listas nuevas solo cuando hay algo oculto: elegir una pieza no rehace nada).
  const dibujoVisible = useMemo(() => {
    if (!dibujoEscena || ocultos.size === 0) return dibujoEscena;
    const ve = (x: { nodo?: string }) => !x.nodo || !ocultos.has(x.nodo);
    return { globos: dibujoEscena.globos.filter(ve), tubos: dibujoEscena.tubos.filter(ve), flores: dibujoEscena.flores.filter(ve), solidos: dibujoEscena.solidos.filter(ve) };
  }, [dibujoEscena, ocultos]);

  const raizSolitario = solitario.solitario ? escenaVista.nodos.find((n) => n.id === solitario.solitario?.raizId) ?? null : null;
  const todosLosGlobos = solitario.activo && vistaSolitario.todosLosGlobos && raizSolitario?.pieza.tipo === "globo" ? raizSolitario.pieza : null;
  // La IA recibe la pieza elegida (y, en el editor solitario, su raíz): «cámbiale el color» va sobre ella.
  const elegidaIA = seleccion ? escenaVista.nodos.find((n) => n.id === seleccion) ?? null : null;
  const baseIA = elegidaIA ?? raizSolitario;
  const seleccionIA: SeleccionIA | null = baseIA ? { id: baseIA.id, nombre: baseIA.nombre, raizSolitario: raizSolitario ? { id: raizSolitario.id, nombre: raizSolitario.nombre } : null } : null;

  // Lo que se ve.
  useEffect(() => {
    if (!visor || !armadaMostrada) return;
    if (todosLosGlobos) {
      // Globo suelto: todos los redondos de su color lado a lado, a su tamaño real (la vieja vista de la pestaña Globos).
      const ref = referenciaPorCodigo(todosLosGlobos.codigo);
      const fila: GloboEnEscena[] = FORMATOS_GLOBO.filter((f) => f.tipo === "redondo" && (ref?.formatos.includes(f.id) ?? true))
        .map((f) => ({ formato: f, infladoCm: f.infladoDecoracionCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion" }));
      visor.mostrar(fila);
      encuadradoRef.current = null;
      return;
    }
    // Si la pieza elegida cuelga de otra, se ven las anclas de esa otra; en el editor solitario, las de la raíz si se piden.
    const elegido = escenaVista.nodos.find((n) => n.id === seleccion);
    const padreId = elegido?.colocacion.en === "ancla" || elegido?.colocacion.en === "sobre" ? elegido.colocacion.padreId : null;
    const deQuien = solitario.activo && vistaSolitario.verAnclas ? solitario.solitario?.raizId ?? null : padreId;
    const anclas = deQuien ? armadaMostrada.porNodo.find((n) => n.id === deQuien)?.anclas.map((a) => a.posicion) ?? [] : [];
    // Al salir del editor solitario la cámara vuelve a donde estaba (no se reencuadra).
    const vistaVuelta = solitario.activo ? null : solitario.tomarVista();
    const encuadrar = !vistaVuelta && encuadradoRef.current !== vueltaEncuadre;
    encuadradoRef.current = vueltaEncuadre;
    // Elegir otra pieza pasa las mismas listas: el visor solo cambia la caja y las anclas, sin rehacer los globos.
    const { globos, tubos, flores, solidos } = dibujoVisible ?? DIBUJO_VACIO;
    const hecho = armadaMostrada.porNodo.find((n) => n.id === seleccion);
    visor.mostrarModulo(globos, anclas, tubos, {
      flores, cilindros: armadaMostrada.cilindros, sala: armadaMostrada.sala, solidos,
      // La copia tocada de un reparto se resalta sola; si no, la pieza entera.
      // En el editor solitario la estructura está sola: no se encierra en su caja (sí sus decoraciones al elegirlas).
      resaltado: solitario.activo && seleccion === solitario.solitario?.raizId ? null : (copiaElegida ? hecho?.puestas[copiaElegida.copia]?.caja : undefined) ?? hecho?.caja ?? null, encuadrar,
    });
    if (encuadrar) setVistaFija("3d");
    if (vistaVuelta) visor.ponerVistaCamara(vistaVuelta);
  }, [visor, armadaMostrada, dibujoVisible, escenaVista, seleccion, vueltaEncuadre, copiaElegida, solitario, vistaSolitario.verAnclas, todosLosGlobos]);
  useResaltadoIA(visor, armadaMostrada, ia.marcas);

  // Estables: así los catálogos (cientos de tarjetas con su dibujo) no se vuelven a pintar al elegir una pieza.
  const cambiarDesdePanel = useCallback((e: Escena) => cambiarVista(e, { agrupar: "panel" }), [cambiarVista]);
  const elegir = useCallback((id: string | null) => { setSeleccion(id); setCopiaTocada(null); setConfirmarEliminar(null); }, []);
  /** Elegir en el visor: en el teléfono, la hoja pasa a «Pieza» (sus medidas, colores y botones). */
  const elegirEnVisor = useCallback((id: string | null) => {
    elegir(id);
    if (id && !window.matchMedia(CONSULTA_ANCHO).matches) setPestanaHoja((p) => (p === "piezas" ? "pieza" : p));
  }, [elegir]);
  const ponNodo = useCallback((id: string, cambio: Partial<NodoEscena>, agrupar?: string) => {
    cambiarVista({ ...escenaVista, nodos: escenaVista.nodos.map((n) => (n.id === id ? { ...n, ...cambio } : n)) }, agrupar ? { agrupar } : undefined);
  }, [cambiarVista, escenaVista]);

  // Escena a mano en el visor: clic elige, arrastrar mueve/gira/sube, teclado (flechas, Q/E, RePág/AvPág, Supr, Ctrl+D/Z/Y, Esc).
  const editable = listo && armadaEscena !== null && !todosLosGlobos && !ia.escenaAntes;
  useEdicionEscena({
    lienzoRef, visorRef: escenaRef, activo: editable, escena: escenaVista, armada: armadaEscena, seleccion, herramienta: solitario.activo ? "mover" : herramienta,
    onSeleccion: elegirEnVisor, onCambio: cambiarVista, onEnVivo: setEnVivo, onDeshacer: deshacerVista, onRehacer: rehacerVista,
  });
  // La estructura como lienzo: arrastrar decoraciones (y piezas de «Añadir») al visor, coger una copia colgada y moverla.
  const lienzoDecoraciones = useLienzoDecoraciones({
    lienzoRef, visorRef: escenaRef, activo: editable, escena: escenaVista, armada: armadaEscena, seleccion, copia: copiaElegida,
    onCopia: setCopiaTocada, onSeleccion: elegir, onCambio: cambiarVista, onAviso: setAvisoLienzo, cache: cacheEscena,
    aEscena: (n) => {
      const papel = n.globos.some((g) => g.confeti) ? papelDeConfeti(n.globos) : null;
      return { globos: n.globos.map((g) => ({ ...globoAEscena(g, R12), ...(g.confeti ? { confeti: true, ...(papel ? { confetiHex: papel } : {}) } : {}) })), tubos: n.tubos.map(tuboAEscena) };
    },
  });

  // ----------------------------------------------------------------------------------------------------------
  // Menú contextual, editor solitario y acciones de la pieza
  // ----------------------------------------------------------------------------------------------------------
  const abrirMenu = useCallback((id: string, x: number, y: number, tactil: boolean) => {
    setSeleccion(id);
    setCopiaTocada(null);
    setMenu({ id, x, y, tactil });
    setInfoMenu(null);
  }, []);
  useEffect(() => {
    if (!menu || !armadaEscena) return;
    let vivo = true;
    void cargarSolitario().then((m) => { if (vivo) setInfoMenu({ id: menu.id, info: m.infoMenuPieza(escenaVista, menu.id, armadaEscena) }); });
    return () => { vivo = false; };
  }, [menu, escenaVista, armadaEscena]);
  useMenuContextual({
    lienzoRef, visorRef: escenaRef, activo: editable, onAbrir: abrirMenu,
    elegida: () => {
      const caja = seleccion ? armadaEscena?.porNodo.find((n) => n.id === seleccion)?.caja : undefined;
      return seleccion && caja ? { id: seleccion, centro: { x: (caja.min.x + caja.max.x) / 2, y: (caja.min.y + caja.max.y) / 2, z: (caja.min.z + caja.max.z) / 2 } } : null;
    },
  });
  const cerrarMenu = useCallback(() => setMenu(null), []);

  const [historialColor, setHistorialColor] = useState<Escena[]>([]);
  const [avisoColor, setAvisoColor] = useState<string | null>(null);

  async function entrarSolitario(id: string, escena?: Escena, armada?: EscenaArmada) {
    const a = armada ?? armadaEscena;
    if (!a || solitario.activo) return false;
    if (await solitario.entrar(id, a, escena)) {
      setSeleccion(id);
      setCopiaTocada(null);
      setVueltaEncuadre((v) => v + 1);
      setHistorialColor([]);
      setAvisoColor(null);
      setVistaSolitario({ verAnclas: false, todosLosGlobos: false });
      setColgarEnSolitario(false);
      setPestanaHoja("parametros");
      return true;
    }
    return false;
  }
  function salirSolitario(aplicar: boolean) {
    const id = aplicar ? solitario.aplicar() : solitario.cancelar();
    if (id === null) return;
    const nueva = nuevaRef.current;
    nuevaRef.current = null;
    // Cancelar una pieza recién creada en «Nuevas»: se quita (deshace su llegada).
    if (!aplicar && nueva === id) { historialEscena.deshacer(); setSeleccion(null); }
    else setSeleccion(id);
    setCopiaTocada(null);
    setHistorialColor([]);
    setColgarEnSolitario(false);
    setPestanaHoja("pieza");
  }

  /** «Añadir → Nuevas»: la pieza entra a la escena (con lo que la acompaña) y se abre su editor solitario. */
  function crearYEditar(p: PiezaParaAnadir) {
    if (solitario.activo) {
      // Dentro del editor solitario se suma a la escena aislada (y vuelve con «Listo»).
      const id = idNuevo(escenaVista, p.idBase);
      cambiarVista({ ...escenaVista, nodos: [...escenaVista.nodos, { id, nombre: p.nombre, pieza: structuredClone(p.pieza), colocacion: p.colocacion }] });
      setSeleccion(id);
      return;
    }
    let escena = escenaEdit;
    const id = idNuevo(escena, p.idBase);
    // Lo que va al piso entra un poco delante para no quedar dentro de lo que ya hay.
    const delante = (c: PiezaParaAnadir["colocacion"]) => (c.en === "piso" ? { ...c, zCm: c.zCm + Math.round(escena.sala.fondoCm * 0.15) } : c);
    escena = { ...escena, nodos: [...escena.nodos, { id, nombre: p.nombre, pieza: structuredClone(p.pieza), colocacion: delante(p.colocacion) }] };
    for (const extra of p.extras ?? []) {
      const otro = idNuevo(escena, extra.idBase);
      escena = { ...escena, nodos: [...escena.nodos, { id: otro, nombre: extra.nombre, pieza: structuredClone(extra.pieza), colocacion: delante(extra.colocacion) }] };
    }
    setEscenaEdit(escena);
    const armada = medirFuera("armarEscena", () => armarEscena(escena, cacheEscena));
    armadas.set(escena, armada);
    nuevaRef.current = id;
    void entrarSolitario(id, escena, armada).then((ok) => { if (!ok) { nuevaRef.current = null; setSeleccion(id); } });
  }

  const crearYEditarEstable = useEstable(crearYEditar);

  async function duplicar(id: string) {
    if (!armadaEscena) return;
    const m = await cargarSolitario();
    const r = m.duplicarPieza(escenaVista, id, armadaEscena, cacheEscena);
    cambiarVista(r.escena);
    if (r.id) setSeleccion(r.id);
  }
  async function eliminar(id: string, conDecoraciones: boolean) {
    if (!armadaEscena) return;
    const m = await cargarSolitario();
    const nombre = escenaVista.nodos.find((n) => n.id === id)?.nombre ?? id;
    const cuantas = conDecoraciones ? m.decoracionesDe(escenaVista, id, armadaEscena).length : 0;
    cambiarVista(m.eliminarPieza(escenaVista, id, { conDecoraciones, armada: armadaEscena }));
    setSeleccion(null);
    setConfirmarEliminar(null);
    setAvisoQuitar(`Quitaste «${nombre}»${conDecoraciones && cuantas ? ` con sus ${cuantas} decoraciones` : ""}.`);
  }
  /** «Eliminar» del inspector: si lleva decoraciones, pregunta si con ellas. */
  async function pedirEliminar(id: string) {
    if (!armadaEscena) return;
    const m = await cargarSolitario();
    const n = m.decoracionesDe(escenaVista, id, armadaEscena).length;
    if (n > 0 && !(solitario.activo && solitario.solitario?.raizId === id)) setConfirmarEliminar({ id, decoraciones: n });
    else await eliminar(id, false);
  }
  /** «Colgar otra»: el panel Añadir en Decoraciones, con la pieza elegida (sus tarjetas ofrecen colgarla de ella). */
  function colgarEn(id: string) {
    setSeleccion(id);
    setPestanaAnadir("decoraciones");
    if (solitario.activo) { setColgarEnSolitario(true); return; }
    setPanel("anadir");
    setPestanaHoja("anadir");
    if (hoja === "cerrada") setHoja("media");
    const nombre = escenaVista.nodos.find((n) => n.id === id)?.nombre ?? "la pieza";
    setAvisoLienzo(`Arrastra una decoración hasta «${nombre}» (se marca en verde donde se puede) o tócala y elige «Colgar en «${nombre}»».`);
  }
  async function editarSostiene(id: string) {
    if (!armadaEscena) return;
    const m = await cargarSolitario();
    const sostiene = m.infoMenuPieza(escenaVista, id, armadaEscena).sostiene;
    if (sostiene) await entrarSolitario(sostiene.id);
  }

  async function accionMenu(accion: AccionMenu) {
    const abierto = menu;
    setMenu(null);
    if (!abierto || !armadaEscena) return;
    const { id } = abierto;
    if (accion === "editar") { if (solitario.activo) setSeleccion(id); else await entrarSolitario(id); return; }
    if (accion === "editar-sostiene") { const s = infoMenu?.id === id ? infoMenu.info.sostiene : null; if (s) await entrarSolitario(s.id); return; }
    if (accion === "colores") {
      setSeleccion(id);
      if (!esAncho) { setPestanaHoja("pieza"); if (hoja === "cerrada") setHoja("media"); }
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-label='Colores de la pieza'] button")?.focus());
      return;
    }
    if (accion === "colgar") { colgarEn(id); return; }
    if (accion === "guardar") { setSeleccion(id); setPedirGuardar((n) => n + 1); if (!esAncho) setPestanaHoja("pieza"); return; }
    if (accion === "duplicar") { await duplicar(id); return; }
    await eliminar(id, accion === "eliminar-con");
  }

  // Los avisos sobre el visor se van solos.
  useEffect(() => { if (!avisoQuitar) return; const t = setTimeout(() => setAvisoQuitar(null), 7000); return () => clearTimeout(t); }, [avisoQuitar]);
  useEffect(() => { if (!avisoLienzo) return; const t = setTimeout(() => setAvisoLienzo(null), 7000); return () => clearTimeout(t); }, [avisoLienzo]);

  // Colores de la escena (o de la estructura aislada en el editor solitario): cambiar uno en todo, con su deshacer.
  function reemplazarEnEscena(de: string, a: string) {
    setHistorialColor((h) => [...h.slice(-19), escenaVista]);
    const r = reemplazarColor(escenaVista, de, a);
    cambiarVista(r.valor);
    const nombre = referenciaPorCodigo(a)?.nombreCompleto ?? a;
    setAvisoColor(r.omitidos.length ? `${nombre} no se fabrica en ${r.omitidos.join(", ")}: esas piezas quedan como estaban.` : r.cambios ? null : "No había nada de ese color para cambiar.");
  }
  function deshacerColor() {
    const ultima = historialColor[historialColor.length - 1];
    if (!ultima) return;
    cambiarVista(ultima);
    setHistorialColor(historialColor.slice(0, -1));
    setAvisoColor(null);
  }

  // Lo que se le cuenta a FLUX junto con la captura: la escena y sus globos (en inglés, sin marcas).
  const descripcionIA = useMemo(() => {
    if (todosLosGlobos) {
      const ref = referenciaPorCodigo(todosLosGlobos.codigo);
      return descripcionRender3d(`A row of round latex balloons of every size side by side, all ${ref?.nombreEn ?? ""}`, []);
    }
    if (!armadaEscena) return "";
    if (solitario.activo && raizSolitario?.pieza.tipo === "globo" && escenaVista.nodos.length === 1) {
      const ref = referenciaPorCodigo(raizSolitario.pieza.codigo);
      return descripcionRender3d(`A single ${formatoEnIngles(raizSolitario.pieza.formatoId)} latex balloon, ${ref?.nombreEn ?? ""}`, []);
    }
    return descripcionRender3d(escenaEnIngles(escenaVista, armadaEscena), materialesEnIngles(armadaEscena.materiales), follajeEnIngles(armadaEscena.flores));
  }, [armadaEscena, escenaVista, solitario.activo, raizSolitario, todosLosGlobos]);

  // Teclado del taller: Enter abre la pieza elegida en el editor solitario; Esc cierra el panel donde está el foco.
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.defaultPrevented || escribiendo(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Enter" && seleccion && !solitario.activo && !menu && !dialogo && !ficha) {
        const enBoton = e.target instanceof HTMLElement && e.target.closest("button, a, summary");
        if (enBoton) return;
        e.preventDefault();
        void entrarSolitario(seleccion);
      }
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  });

  const nodoElegido = escenaVista.nodos.find((n) => n.id === seleccion) ?? null;
  const nodoEnVivo = nodoElegido && enVivo?.id === nodoElegido.id ? { ...nodoElegido, colocacion: enVivo.colocacion } : nodoElegido;
  const hechoElegido = nodoElegido ? armadaEscena?.porNodo.find((n) => n.id === nodoElegido.id) : undefined;
  const totalGlobos = armadaEscena?.globos.length ?? 0;
  const medida = nodoElegido ? medidaPrincipal(nodoElegido.pieza, hechoElegido?.caja) : null;
  const elegirPanel = (p: Panel) => setPanel((actual) => (actual === p ? null : p));
  const cambiarAltura = (paso: 1 | -1) => setHoja((h) => ALTURAS[Math.max(0, Math.min(ALTURAS.length - 1, ALTURAS.indexOf(h) + paso))] ?? h);
  const elegirPestanaHoja = (p: PestanaHoja) => { setPestanaHoja(p); if (hoja === "cerrada" || p === "ia") setHoja("media"); };
  /** Tras mandar un pedido a la IA en el teléfono, la hoja baja a media altura: queda a la vista la escena y la tarjeta del turno. */
  const alEnviarIA = () => {
    if (esAncho) return;
    setHoja("media");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };
  const panelIA = armadaEscena ? (
    <PanelIA ia={ia} escena={escenaVista} ambito={solitario.activo ? "pieza" : "escena"} seleccion={seleccionIA} enHoja={!esAncho}
      alFotoRealista={() => setDialogo("imagen")} alElegirPieza={elegir} alEnviado={alEnviarIA} />
  ) : <Cargando />;
  const plantilla = (id: string) => {
    if (solitario.activo) salirSolitario(false);
    setEscenaEdit(escenaPredefinida(id));
    setNombreEscena(ESCENAS_PREDEFINIDAS.find((p) => p.id === id)?.nombre ?? "Mi escena");
    setSeleccion(null); setOcultos(new Set()); setVueltaEncuadre((v) => v + 1); setAvisoColor(null); setHistorialColor([]);
  };
  const salaVacia = () => {
    if (solitario.activo) salirSolitario(false);
    setEscenaEdit({ ...escenaEdit, nodos: [] });
    setNombreEscena("Escena nueva");
    setSeleccion(null); setOcultos(new Set());
  };
  const abrirEnEscena = (escena: Escena, item: ItemBiblioteca) => {
    if (solitario.activo) salirSolitario(false);
    setEscenaEdit(escena);
    setNombreEscena(item.nombre);
    setSeleccion(null); setCopiaTocada(null); setOcultos(new Set()); setVueltaEncuadre((v) => v + 1); setAvisoColor(null); setFicha(null);
  };
  const anadirItem = (item: ItemBiblioteca) => {
    // La biblioteca ya está cargada (de ahí viene el item): este import no trae nada nuevo.
    void import("@/lib/globos3d/biblioteca").then(({ insertarEnEscena }) => {
      const r = insertarEnEscena(escenaVista, item, undefined, cacheEscena);
      cambiarVista(r.escena);
      setSeleccion(r.raizId); setCopiaTocada(null); setFicha(null);
    });
  };
  const alternarOculto = useCallback((id: string) => setOcultos((o) => { const s = new Set(o); if (s.has(id)) s.delete(id); else s.add(id); return s; }), []);
  const renombrarPieza = useCallback((id: string, nombre: string) => ponNodo(id, { nombre }), [ponNodo]);

  // ----------------------------------------------------------------------------------------------------------
  // Piezas de la interfaz
  // ----------------------------------------------------------------------------------------------------------
  const reemplazarEstable = useEstable((de: string, a: string) => reemplazarEnEscena(de, a));
  const deshacerColorEstable = useEstable(deshacerColor);
  const puedeDeshacerColor = historialColor.length > 0;
  const enSolitario = solitario.activo;
  const materialesVista = armadaEscena?.materiales;
  // Memorizada: la lista de piezas (y su paleta) no se vuelve a pintar al elegir una pieza.
  const paleta = useMemo(() => materialesVista ? (
    <PaletaEscena variante="lista" grupos={[{ id: "todo", nombre: "", materiales: materialesVista }]} onReemplazar={reemplazarEstable}
      aviso={avisoColor} puedeDeshacer={puedeDeshacerColor} onDeshacer={deshacerColorEstable}
      titulo={enSolitario ? "Colores de la pieza" : "Colores de la escena"} ayuda={enSolitario ? "Toca un color para cambiarlo en toda la pieza y sus decoraciones." : "Toca un color para cambiarlo en toda la escena."} />
  ) : null, [materialesVista, avisoColor, puedeDeshacerColor, enSolitario, reemplazarEstable, deshacerColorEstable]);

  const biblioteca = armadaEscena ? <AccionesPieza escena={escenaVista} armada={armadaEscena} nodoId={nodoElegido && !solitario.activo ? nodoElegido.id : null} onVer={setFicha} pedirGuardar={pedirGuardar} /> : null;

  const inspector = armadaEscena ? (
    <Inspector escena={escenaVista} armada={armadaEscena} nodo={nodoEnVivo} copia={copiaElegida?.copia ?? null}
      onNodo={ponNodo} onSeleccion={elegir} onEditarSola={(id) => { if (solitario.activo) setSeleccion(id); else void entrarSolitario(id); }}
      onDuplicar={(id) => void duplicar(id)} onEliminar={(id) => void pedirEliminar(id)} confirmarEliminar={confirmarEliminar}
      onConfirmarEliminar={(con) => { const c = confirmarEliminar; if (!c || con === null) { setConfirmarEliminar(null); return; } void eliminar(c.id, con); }}
      onColgarOtra={colgarEn} onEditarSostiene={(id) => void editarSostiene(id)} paletaEscena={paleta} biblioteca={biblioteca} nombreEscena={nombreEscena}
      onSala={() => { setPanel("sala"); }} onPlantillas={() => setPanel("plantillas")} enHoja={!esAncho}
      onMas={esAncho ? undefined : (id) => setMenu({ id, x: window.innerWidth / 2, y: window.innerHeight * 0.45, tactil: false })} />
  ) : null;

  // Oculto, el panel no sigue la pieza elegida (elegir no lo vuelve a pintar); al mostrarse, la toma.
  const anadirVisible = esAncho ? (panel === "anadir" && !solitario.activo) || (solitario.activo && colgarEnSolitario) : pestanaHoja === "anadir";
  const panelAnadir = armadaEscena ? (
    <PanelAnadir escena={escenaVista} armada={armadaEscena} onEscena={cambiarDesdePanel} seleccion={anadirVisible ? seleccion : null} onSeleccion={elegir}
      pestana={pestanaAnadir} onPestana={setPestanaAnadir} onNueva={crearYEditarEstable} onFicha={setFicha} enHoja={!esAncho} />
  ) : <Cargando />;

  const abrirAnadir = useEstable(() => { setPanel("anadir"); setPestanaHoja("anadir"); });
  const abrirSala = useEstable(() => setPanel("sala"));
  const panelPiezas = !cargada ? <Cargando /> : (
    <PanelPiezas escena={escenaVista} armada={armadaEscena} seleccion={seleccion} onSeleccion={elegir} onRenombrar={renombrarPieza}
      ocultos={ocultos} onOcultar={alternarOculto} onAnadir={abrirAnadir} paleta={paleta} onSala={abrirSala} enHoja={!esAncho} />
  );

  const panelPlantillas = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-3 pt-4">
        {esAncho && <h2 className="text-[15px] font-semibold">Plantillas</h2>}
        <p className="mt-1 text-xs text-taller-suave">Empieza de una escena armada (reemplaza la que tienes; Ctrl+Z la recupera).</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <TarjetasPlantillas plantillas={ESCENAS_PREDEFINIDAS.map((p) => ({ id: p.id, nombre: p.nombre, descripcion: p.descripcion }))} onElegir={plantilla} onVacia={salaVacia} />
      </div>
    </div>
  );

  const panelSala = (
    <div className="flex min-h-0 flex-1 flex-col">
      {esAncho && <h2 className="px-4 pb-3 pt-4 text-[15px] font-semibold">Sala</h2>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"><EditorSala sala={escenaVista.sala} onSala={(sala) => cambiarVista({ ...escenaVista, sala }, { agrupar: "sala" })} plegable={false} /></div>
    </div>
  );

  const parametros = solitario.solitario && raizSolitario ? (() => {
    const parte = nodoElegido ?? raizSolitario;
    return (
      <ParametrosPieza escena={escenaVista} raizId={raizSolitario.id} nodo={parte}
        onPieza={(pieza, agrupar) => ponNodo(parte.id, { pieza }, agrupar ? `${agrupar}-${parte.id}` : undefined)} onEscena={(e) => cambiarVista(e)} vista={vistaSolitario} onVista={setVistaSolitario} />
    );
  })() : null;

  const listaParte = armadaEscena ? (
    <div className="border-t border-taller-linea bg-taller-barra px-4 py-3">
      <div className="flex justify-between text-[13px]"><span className="font-medium">Lista de esta pieza</span><span><span className="font-mono">{totalGlobos}</span> globos</span></div>
      <ul className="mt-1.5 max-h-28 overflow-y-auto font-mono text-[11px] leading-relaxed text-taller-suave">
        {[...armadaEscena.materiales].sort((a, b) => b.cantidad - a.cantidad).map((x) => <li key={`${x.formatoId}|${x.codigo}`}>{x.cantidad} × {x.formatoId} {referenciaPorCodigo(x.codigo)?.nombreCompleto ?? x.codigo} {x.codigo}</li>)}
      </ul>
    </div>
  ) : null;

  const nombreRaiz = raizSolitario?.nombre ?? solitario.solitario?.nombre ?? "";
  const inicialSolitario = solitario.solitario ? { escena: solitario.solitario.escena, armada: armadas.get(solitario.solitario.escena) ?? null } : null;

  // --- Barra superior (escritorio) -------------------------------------------------------------------------------
  const barraEscena = (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-taller-linea bg-taller-barra pl-4 pr-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-taller-primario text-taller-sobre-primario" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="12" cy="10" r="6" /><path d="M12 16v5" /></svg>
        </span>
        <span className="shrink-0 text-sm font-semibold">Taller 3D</span>
        <span className="text-taller-borde" aria-hidden>/</span>
        {!cargada ? <span className="h-9" /> : renombrando ? (
          <input autoFocus defaultValue={nombreEscena} aria-label="Nombre de la escena" maxLength={120}
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v) setNombreEscena(v); setRenombrando(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.preventDefault(); setRenombrando(false); } }}
            className="h-9 w-[min(28rem,40vw)] rounded-[10px] border border-taller-resalte bg-taller-tarjeta px-2 text-[13px] font-medium text-taller-texto outline-none" />
        ) : (
          <button type="button" onClick={() => setRenombrando(true)} title="Cambiar el nombre de la escena" className="h-9 min-w-0 truncate rounded-[10px] px-1.5 text-[13px] font-medium hover:bg-taller-encima">{nombreEscena}</button>
        )}
        <div className="relative">
          <button type="button" onClick={() => setMenuMas(!menuMas)} aria-expanded={menuMas} aria-haspopup="menu" aria-label="Más opciones de la escena" title="Más opciones" className="grid size-7 place-items-center rounded-md text-taller-suave hover:bg-taller-encima hover:text-taller-texto">
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
          {menuMas && <MenuMas onCerrar={() => setMenuMas(false)} onRenombrar={() => setRenombrando(true)} onPlantillas={() => setPanel("plantillas")} onAyuda={() => setDialogo("ayuda")}
            onGuardar={() => { setSeleccion(null); setPedirGuardar((n) => n + 1); }} />}
        </div>
        <span className="shrink-0 text-xs text-taller-suave" role="status" aria-live="polite">{!cargada ? "" : guardado === "guardado" ? "Guardado" : guardado === "guardando" ? "Guardando…" : "Sin guardar (el navegador no deja)"}</span>
      </div>
      <div className="ml-3 flex gap-1">
        <button type="button" onClick={deshacerVista} disabled={!puedeDeshacerVista} aria-label={rotuloDeshacer} title={`${rotuloDeshacer} (Ctrl+Z)`} className={BTN_ICO}><Undo2 className="size-[18px]" aria-hidden /></button>
        <button type="button" onClick={rehacerVista} disabled={!puedeRehacerVista} aria-label="Rehacer" title="Rehacer (Ctrl+Y)" className={BTN_ICO}><Redo2 className="size-[18px]" aria-hidden /></button>
      </div>
      <div className="flex-1" />
      <button type="button" onClick={() => setDialogo("imagen")} disabled={!listo} className={BTN}><Camera className="size-[18px]" aria-hidden />Foto realista</button>
      <button type="button" onClick={() => setDialogo("lista")} disabled={!armadaEscena} className={BTN_PRI}><ShoppingCart className="size-[18px]" aria-hidden />Lista de compra · <span className="font-mono">{totalGlobos}</span> globos</button>
    </header>
  );

  const barraSolitario = (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-taller-solitario-borde bg-taller-solitario pl-4 pr-3">
      <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 text-sm">
        <button type="button" onClick={() => salirSolitario(true)} className="shrink-0 text-taller-acento hover:underline" title="Volver a la escena (aplica los cambios)">Escena</button>
        <span className="text-taller-suave" aria-hidden>›</span>
        <span className="truncate font-semibold" aria-current="page">{nombreRaiz}</span>
        <span className="ml-1.5 shrink-0 rounded-md bg-taller-elegido px-2 py-[3px] text-[11px] font-semibold uppercase tracking-[0.06em] text-taller-acento">Editando sola</span>
      </nav>
      <div className="ml-2 flex gap-1">
        <button type="button" onClick={deshacerVista} disabled={!puedeDeshacerVista} aria-label="Deshacer en el editor" title="Deshacer (Ctrl+Z)" className={BTN_ICO}><Undo2 className="size-[18px]" aria-hidden /></button>
        <button type="button" onClick={rehacerVista} disabled={!puedeRehacerVista} aria-label="Rehacer en el editor" title="Rehacer (Ctrl+Y)" className={BTN_ICO}><Redo2 className="size-[18px]" aria-hidden /></button>
      </div>
      <div className="flex-1" />
      <span className="text-xs text-taller-medio max-xl:hidden">Los cambios se aplican a la escena al pulsar Listo</span>
      <button type="button" onClick={() => setDialogo("imagen")} disabled={!listo} className={BTN} title="Foto realista de esta pieza sola"><Camera className="size-[18px]" aria-hidden /><span className="max-xl:sr-only">Foto realista</span></button>
      <button type="button" onClick={() => salirSolitario(false)} className={BTN}>Cancelar</button>
      <button type="button" onClick={() => salirSolitario(true)} className={BTN_PRI}><Check className="size-[18px]" aria-hidden />Listo</button>
    </header>
  );

  // --- El visor y lo que flota sobre él ---------------------------------------------------------------------------
  const sobreVisor = (
    <>
      {!listo && !error && <p className="absolute inset-0 grid place-items-center text-sm text-taller-suave">Cargando el visor 3D…</p>}
      {error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm">{error}</p>}
      {esAncho && (
        <div className="pointer-events-none absolute inset-x-0 top-3.5 z-10 flex justify-center px-3">
          <BarraHerramientas solitario={solitario.activo} herramienta={herramienta} onHerramienta={setHerramienta} vista={vistaFija}
            onVista={(v) => { setVistaFija(v); visor?.verDesde(v); }} onEncuadrar={() => { setVistaFija("3d"); visor?.verDesde("3d"); }} />
        </div>
      )}
      {nodoElegido && hechoElegido && !todosLosGlobos && !(solitario.activo && nodoElegido.id === solitario.solitario?.raizId) && (
        <EtiquetaElegida visor={visor} caja={(copiaElegida ? hechoElegido.puestas[copiaElegida.copia]?.caja : undefined) ?? hechoElegido.caja} contenedor={visorCajaRef}
          texto={`${nodoElegido.nombre}${medida ? ` · ${medida}` : ""}`} />
      )}
      {solitario.activo && raizSolitario && !todosLosGlobos && (
        <ReglaAlturas visor={visor} caja={armadaEscena?.porNodo.find((n) => n.id === raizSolitario.id)?.caja ?? null} contenedor={visorCajaRef} />
      )}
      {esAncho && herramienta === "altura" && nodoElegido?.colocacion.en === "piso" && !solitario.activo && (
        <p role="status" className={`pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-lg px-3 py-1.5 text-xs ${FLOTANTE}`}>Lo del piso no sube ni baja: ponlo «suelto» o en una pared (Lugar → Cambiar dónde va).</p>
      )}
      {menu && (() => {
        const nodoMenu = escenaVista.nodos.find((n) => n.id === menu.id);
        if (!nodoMenu) return null;
        const info = infoMenu?.id === menu.id ? infoMenu.info : null;
        const esRaiz = solitario.solitario?.raizId === menu.id;
        return (
          <MenuContextual x={menu.x} y={menu.y} tactil={menu.tactil} nombre={nodoMenu.nombre} globos={armadaEscena?.porNodo.find((n) => n.id === menu.id)?.globos.length ?? null}
            decoraciones={info ? info.decoraciones.length : null} sostiene={solitario.activo || !info?.sostiene ? null : info.sostiene}
            ocultar={esRaiz ? ["editar", "duplicar", "eliminar-con", "eliminar-sin", "guardar"] : solitario.activo ? ["guardar"] : []}
            onAccion={(a) => { void accionMenu(a); }} onCerrar={cerrarMenu} />
        );
      })()}
      {avisoQuitar && (
        <div role="status" className={`absolute bottom-6 left-1/2 z-20 flex w-[min(28rem,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-xl px-3 py-2 text-sm ${FLOTANTE}`}>
          <span className="min-w-0 flex-1">{avisoQuitar}</span>
          <button type="button" onClick={() => { deshacerVista(); setAvisoQuitar(null); }} className="min-h-9 rounded-lg px-2 font-medium text-taller-acento hover:bg-taller-encima">Deshacer</button>
        </div>
      )}
      {avisoLienzo && (
        <p role="status" className={`pointer-events-none absolute left-1/2 z-20 w-[min(36rem,calc(100%-24px))] -translate-x-1/2 rounded-xl px-3 py-2 text-center text-sm ${FLOTANTE} ${esAncho ? "bottom-6" : "top-20"}`}>{avisoLienzo}</p>
      )}
      {esAncho && armadaEscena && (
        <div className={`pointer-events-none absolute bottom-[18px] left-3.5 z-10 rounded-lg px-2.5 py-1.5 text-xs text-taller-texto-2 ${FLOTANTE}`}>
          <span className="font-mono">{escenaVista.nodos.length}</span> {escenaVista.nodos.length === 1 ? "pieza" : "piezas"} · <span className="font-mono">{totalGlobos}</span> globos{ocultos.size ? ` · ${ocultos.size} oculta${ocultos.size === 1 ? "" : "s"}` : ""}
        </div>
      )}
      {ia.escenaAntes && <BannerVerAntes numero={ia.turnos.find((t) => t.id === ia.antesId)?.numero ?? 0} alVolver={() => ia.verAntes(null)} />}
    </>
  );

  // --- Teléfono y tablet: barra compacta, botones de la pieza y hoja inferior ----------------------------------
  const pestanasHoja: ReadonlyArray<{ id: PestanaHoja; nombre: string; icono: ReactNode }> = solitario.activo
    ? [
      { id: "parametros", nombre: "Parámetros", icono: <LayoutGrid className="size-5" aria-hidden /> },
      { id: "partes", nombre: "Partes", icono: <Layers className="size-5" aria-hidden /> },
      { id: "anadir", nombre: "Colgar", icono: <Plus className="size-5" aria-hidden /> },
      { id: "ia", nombre: "IA", icono: <Sparkles className="size-5" aria-hidden /> },
    ]
    : [
      { id: "anadir", nombre: "Añadir", icono: <Plus className="size-5" aria-hidden /> },
      { id: "piezas", nombre: "Piezas", icono: <Layers className="size-5" aria-hidden /> },
      { id: "pieza", nombre: "Pieza", icono: <SlidersHorizontal className="size-5" aria-hidden /> },
      { id: "ia", nombre: "IA", icono: <Sparkles className="size-5" aria-hidden /> },
    ];
  const pestanaVista = pestanasHoja.some((p) => p.id === pestanaHoja) ? pestanaHoja : pestanasHoja[0]!.id;
  const contenidoDe = (pestana: PestanaHoja): ReactNode => {
    switch (pestana) {
      case "anadir": return panelAnadir;
      case "piezas": return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex gap-2 px-4 pt-3">
            <button type="button" onClick={() => setPanel("plantillas")} className={`${BTN} h-11 flex-1 justify-center`}><LayoutGrid className="size-4" aria-hidden />Plantillas</button>
            <button type="button" onClick={() => setPanel("sala")} className={`${BTN} h-11 flex-1 justify-center`}><House className="size-4" aria-hidden />Sala</button>
          </div>
          {panelPiezas}
        </div>
      );
      case "pieza": return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {inspector}
          {nodoEnVivo && <div className="border-t border-taller-linea px-4 py-3"><h3 className="taller-rotulo mb-2">Mover con botones</h3><ControlesPieza nombre={nodoEnVivo.nombre} colocacion={nodoEnVivo.colocacion} enLinea /></div>}
        </div>
      );
      case "ia": return panelIA;
      case "parametros": return <div className="taller-seccionado min-h-0 flex-1 overflow-y-auto">{parametros}{listaParte}</div>;
      case "partes": return armadaEscena && inicialSolitario && raizSolitario ? (
        <PartesSolitario escena={escenaVista} armada={armadaEscena} inicial={inicialSolitario} raizId={raizSolitario.id} seleccion={seleccion ?? raizSolitario.id}
          onSeleccion={(id) => { setSeleccion(id); setPestanaHoja("parametros"); }} onColgar={() => { setPestanaAnadir("decoraciones"); setPestanaHoja("anadir"); }} />
      ) : null;
    }
  };
  if (!esAncho && !hojasVistas.has(pestanaVista)) setHojasVistas(new Set(hojasVistas).add(pestanaVista));
  const contenidoHoja = pestanasHoja.filter((p) => hojasVistas.has(p.id) || p.id === pestanaVista).map((p) => (
    <div key={p.id} hidden={p.id !== pestanaVista} className={`min-h-0 flex-1 flex-col ${p.id === pestanaVista ? "flex" : "hidden"}`}>{contenidoDe(p.id)}</div>
  ));

  const movil = !esAncho && (
    <>
      {/* Barra compacta flotante arriba. */}
      <div className="absolute inset-x-3 top-3 z-20 flex items-center gap-2" style={{ top: "max(12px, env(safe-area-inset-top))" }}>
        {solitario.activo ? (
          <>
            <button type="button" onClick={() => salirSolitario(false)} aria-label="Cancelar y volver a la escena" className={`grid size-11 shrink-0 place-items-center rounded-xl ${FLOTANTE}`}><X className="size-5" aria-hidden /></button>
            <div className="flex h-11 min-w-0 flex-1 flex-col justify-center rounded-xl border border-taller-solitario-borde bg-taller-solitario/95 px-3">
              <div className="truncate text-[13px] font-semibold">{nombreRaiz}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-taller-acento">Editando sola</div>
            </div>
            <button type="button" onClick={deshacerVista} disabled={!puedeDeshacerVista} aria-label="Deshacer" className={`grid size-11 shrink-0 place-items-center rounded-xl disabled:opacity-45 ${FLOTANTE}`}><Undo2 className="size-5" aria-hidden /></button>
            <button type="button" onClick={() => salirSolitario(true)} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-taller-primario px-3 text-sm font-medium text-taller-sobre-primario"><Check className="size-5" aria-hidden />Listo</button>
          </>
        ) : (
          <>
            <Link href="/asistente" aria-label="Volver al asistente" className={`grid size-11 shrink-0 place-items-center rounded-xl ${FLOTANTE}`}><ArrowLeft className="size-5" aria-hidden /></Link>
            <button type="button" onClick={() => setRenombrando(true)} className={`flex h-11 min-w-0 flex-1 flex-col justify-center rounded-xl px-3 text-left ${FLOTANTE}`} aria-label={`Escena: ${nombreEscena}. Cambiar el nombre`}>
              {renombrando || !cargada ? null : <span className="truncate text-[13px] font-semibold">{nombreEscena}</span>}
              <span className="text-[11px] text-taller-medio"><span className="font-mono">{totalGlobos}</span> globos · {escenaVista.nodos.length} piezas</span>
            </button>
            <button type="button" onClick={deshacerVista} disabled={!puedeDeshacerVista} aria-label={rotuloDeshacer} className={`grid size-11 shrink-0 place-items-center rounded-xl disabled:opacity-45 ${FLOTANTE}`}><Undo2 className="size-5" aria-hidden /></button>
            {puedeRehacerVista && <button type="button" onClick={rehacerVista} aria-label="Rehacer" className={`grid size-11 shrink-0 place-items-center rounded-xl ${FLOTANTE}`}><Redo2 className="size-5" aria-hidden /></button>}
            <button type="button" onClick={() => setDialogo("lista")} aria-label={`Lista de compra: ${totalGlobos} globos`} className="grid size-11 shrink-0 place-items-center rounded-xl border border-taller-primario bg-taller-primario text-taller-sobre-primario"><ShoppingCart className="size-5" aria-hidden /></button>
          </>
        )}
      </div>
      {/* Acceso directo y con texto al render con IA (en escritorio vive en la barra superior). */}
      <div className="pointer-events-none absolute inset-x-3 z-20 flex justify-center" style={{ top: "calc(max(12px, env(safe-area-inset-top)) + 52px)" }}>
        <button type="button" onClick={() => setDialogo("imagen")} disabled={!listo}
          title={solitario.activo ? "Foto realista con IA de esta pieza sola" : "Foto realista con IA de la escena"}
          className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full border border-taller-primario bg-taller-primario px-5 text-sm font-semibold text-taller-sobre-primario shadow-[0_8px_24px_var(--sombra)] disabled:cursor-not-allowed disabled:opacity-45">
          <Camera className="size-5" aria-hidden />Foto realista
        </button>
      </div>
      {renombrando && !esAncho && (
        <div className="absolute inset-x-3 top-16 z-30">
          <input autoFocus defaultValue={nombreEscena} aria-label="Nombre de la escena" maxLength={120}
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v) setNombreEscena(v); setRenombrando(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenombrando(false); }}
            className="h-11 w-full rounded-xl border border-taller-resalte bg-taller-tarjeta px-3 text-base text-taller-texto outline-none" />
        </div>
      )}
      {/* Botones de la pieza elegida, flotando a la derecha. */}
      {nodoEnVivo && hoja !== "alta" && (
        <div className="absolute right-3 top-[120px] z-20 flex flex-col gap-2">
          <button type="button" onClick={() => pulsar("e")} aria-label="Girar la pieza" title="Girar 15°" className={`grid size-11 place-items-center rounded-xl ${FLOTANTE}`}><RotateCw className="size-5" aria-hidden /></button>
          <button type="button" onClick={() => setAlturaMovil(!alturaMovil)} aria-expanded={alturaMovil} aria-label="Subir o bajar" className={`grid size-11 place-items-center rounded-xl ${FLOTANTE} ${alturaMovil ? "border-taller-resalte" : ""}`}><MoveVertical className="size-5" aria-hidden /></button>
          {alturaMovil && (
            <div className="flex flex-col gap-1 rounded-xl p-1" role="group" aria-label="Subir o bajar">
              <button type="button" onClick={() => pulsar(nodoEnVivo.colocacion.en === "techo" ? "PageUp" : "ArrowUp")} className={`grid size-11 place-items-center rounded-xl text-sm ${FLOTANTE}`} aria-label="Subir">▲</button>
              <button type="button" onClick={() => pulsar(nodoEnVivo.colocacion.en === "techo" ? "PageDown" : "ArrowDown")} className={`grid size-11 place-items-center rounded-xl text-sm ${FLOTANTE}`} aria-label="Bajar">▼</button>
            </div>
          )}
          <button type="button" onClick={() => visor?.verDesde("3d")} aria-label="Encuadrar todo" className={`grid size-11 place-items-center rounded-xl ${FLOTANTE}`}><Scan className="size-5" aria-hidden /></button>
        </div>
      )}
      {/* Hoja inferior con asa y pestañas. */}
      <section aria-label="Paneles del taller"
        onFocusCapture={(e) => { if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type !== "range" && e.target.type !== "checkbox")) setHoja("alta"); }}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[20px] border-t border-taller-borde bg-taller-panel shadow-[0_-10px_30px_var(--sombra)] ${ALTURA_HOJA[hoja]}`}>
        <div onPointerDown={(e) => { deslizarHoja.current = e.clientY; }} onPointerCancel={() => { deslizarHoja.current = null; }}
          onPointerUp={(e) => { const inicio = deslizarHoja.current; deslizarHoja.current = null; if (inicio === null) return; const dy = e.clientY - inicio; if (Math.abs(dy) < 8) cambiarAltura(hoja === "alta" ? -1 : 1); else cambiarAltura(dy < 0 ? 1 : -1); }}
          className="flex h-6 shrink-0 cursor-row-resize touch-none items-center justify-center" role="button" tabIndex={0} aria-label={hoja === "alta" ? "Achicar el panel" : "Agrandar el panel"}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cambiarAltura(hoja === "alta" ? -1 : 1); } if (e.key === "ArrowUp") cambiarAltura(1); if (e.key === "ArrowDown") cambiarAltura(-1); }}>
          <span className="h-1 w-10 rounded-full bg-taller-borde" aria-hidden />
        </div>
        {hoja !== "cerrada" && (
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden max-lg:[&_input[type=range]]:min-h-11 max-lg:[&_input[type=checkbox]]:size-5 max-lg:[&_summary]:min-h-11`}>{contenidoHoja}</div>
        )}
        <nav aria-label="Secciones" className="flex shrink-0 border-t border-taller-linea pb-[max(6px,env(safe-area-inset-bottom))]">
          {pestanasHoja.map((p) => (
            <button key={p.id} type="button" onClick={() => elegirPestanaHoja(p.id)} aria-current={pestanaVista === p.id ? "page" : undefined}
              className={`flex h-[52px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${pestanaVista === p.id ? "text-taller-acento" : "text-taller-medio"}`}>
              {p.icono}{p.nombre}
            </button>
          ))}
        </nav>
      </section>
    </>
  );

  // Paneles que en el teléfono se abren como diálogos (Plantillas y Sala no tienen pestaña propia).
  const panelEnDialogo = !esAncho && (panel === "plantillas" || panel === "sala");

  return (
    <div className="taller-3d fixed inset-0 flex flex-col overflow-hidden font-sans">
      {esAncho && (solitario.activo ? barraSolitario : barraEscena)}
      <ArrastreDecoracionContexto.Provider value={editable ? lienzoDecoraciones.empezarArrastre : null}>
        <div className="flex min-h-0 flex-1">
          {esAncho && !solitario.activo && (
            <nav aria-label="Paneles" className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-r border-taller-linea bg-taller-barra pt-2.5">
              {PANELES.map((p) => (
                <button key={p.id} type="button" onClick={() => elegirPanel(p.id)} aria-pressed={panel === p.id} aria-label={p.nombre} title={p.nombre} className={`${RIEL} ${panel === p.id ? RIEL_ON : ""}`}>{p.icono}</button>
              ))}
              <div className="flex-1" />
              <Link href="/asistente" aria-label="Volver al asistente" title="Volver al asistente" className={RIEL}><ArrowLeft className="size-5" aria-hidden /></Link>
              <button type="button" onClick={() => setDialogo("ayuda")} aria-label="Ayuda y atajos de teclado" title="Ayuda y atajos" className={`${RIEL} mb-2.5`}><CircleHelp className="size-5" aria-hidden /></button>
            </nav>
          )}
          {esAncho && (
            // Los paneles ya abiertos quedan montados y ocultos: volver a abrirlos no los pinta de nuevo (ni rehace la
            // biblioteca, que sigue al día por debajo).
            <aside aria-label={PANELES.find((p) => p.id === panel)?.nombre} hidden={solitario.activo || !panel}
              onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !escribiendo(e.target)) { e.preventDefault(); setPanel(null); } }}
              className={`min-h-0 shrink-0 flex-col border-r border-taller-linea bg-taller-panel ${solitario.activo || !panel ? "hidden" : "flex"} ${panel === "anadir" ? "w-[340px]" : panel === "plantillas" ? "w-[320px]" : "w-[272px]"}`}>
              {PANELES.filter((p) => panelesVistos.has(p.id)).map((p) => (
                <div key={p.id} hidden={panel !== p.id} className={`min-h-0 flex-1 flex-col ${panel === p.id ? "flex" : "hidden"}`}>
                  {p.id === "anadir" ? panelAnadir : p.id === "piezas" ? panelPiezas : p.id === "plantillas" ? panelPlantillas : panelSala}
                </div>
              ))}
            </aside>
          )}
          {esAncho && solitario.activo && armadaEscena && inicialSolitario && raizSolitario && (
            <aside aria-label="Partes de la pieza" className="flex w-60 shrink-0 flex-col border-r border-taller-linea bg-taller-panel">
              <PartesSolitario escena={escenaVista} armada={armadaEscena} inicial={inicialSolitario} raizId={raizSolitario.id} seleccion={seleccion ?? raizSolitario.id}
                onSeleccion={elegir} onColgar={() => colgarEn(raizSolitario.id)} />
            </aside>
          )}
          <main ref={visorCajaRef} aria-label="Visor 3D" className={`relative min-w-0 flex-1 overflow-hidden ${solitario.activo ? "bg-[radial-gradient(circle_at_50%_40%,var(--taller-encima)_0,var(--taller-visor)_70%)]" : "bg-taller-visor"}`}>
            {/* En el teléfono el lienzo termina donde empieza la hoja (al encuadrar, la escena queda a la vista). */}
            <canvas ref={lienzoRef} className={`absolute inset-x-0 top-0 block w-full touch-none ${esAncho ? "h-full" : hoja === "cerrada" ? "h-[calc(100%-84px)]" : "h-[56%]"}`} aria-label="Escena en 3D: arrastra con un dedo o el ratón para girar; pellizca o usa la rueda para acercar. Clic en una pieza para elegirla." />
            {sobreVisor}
            {esAncho && solitario.activo && colgarEnSolitario && (
              <aside aria-label="Colgar decoración" onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); setColgarEnSolitario(false); } }}
                className="absolute inset-y-0 left-0 z-30 flex w-[340px] flex-col border-r border-taller-linea bg-taller-panel shadow-[8px_0_24px_var(--sombra)]">
                <button type="button" onClick={() => setColgarEnSolitario(false)} aria-label="Cerrar" title="Cerrar (Esc)" className={`${BTN_ICO} absolute right-3 top-3 z-10`}><X className="size-4" aria-hidden /></button>
                {panelAnadir}
              </aside>
            )}
            {movil}
          </main>
          {esAncho && (
            <aside aria-label={solitario.activo ? "Parámetros de la pieza e IA" : nodoElegido ? "Pieza elegida e IA" : "Escena e IA"}
              className={`flex min-h-0 shrink-0 flex-col border-l border-taller-linea bg-taller-panel ${pestanaLado === "ia" ? "w-[360px]" : solitario.activo ? "w-[340px]" : "w-80"}`}>
              <PestanasLaterales activa={pestanaLado} alCambiar={setPestanaLado} turnos={ia.turnos.length} trabajando={ia.ocupado} ia={panelIA}
                pieza={solitario.activo ? (
                  <>
                    <div className="px-4 pt-4"><div className="taller-rotulo text-taller-acento">{nodoElegido ? NOMBRE_TIPO[nodoElegido.pieza.tipo] : ""}</div>{nodoElegido && nodoElegido.id !== raizSolitario?.id && <p className="mt-1 text-sm font-semibold">{nodoElegido.nombre}</p>}</div>
                    <div className="taller-seccionado flex flex-col">{parametros}</div>
                    <div className="flex-1" />
                    {listaParte}
                  </>
                ) : inspector} />
            </aside>
          )}
        </div>
      </ArrastreDecoracionContexto.Provider>

      <DialogoTaller abierto={dialogo === "lista"} onCerrar={() => setDialogo(null)} titulo={`Lista de compra · ${totalGlobos} globos`} forma="cajon">
        {armadaEscena && dialogo === "lista" && <ListaCompra nombre={nombreEscena} escena={escenaVista} armada={armadaEscena} productosExactos={<ProductosEscena escena={escenaVista} nombre={nombreEscena} />} />}
      </DialogoTaller>
      <DialogoTaller abierto={dialogo === "imagen"} onCerrar={() => setDialogo(null)} titulo="Foto realista">
        <div className="p-4">
          <p className="mb-3 text-sm text-taller-suave">Convierte lo que se ve en el visor en una foto realista con IA (gíralo antes para elegir el ángulo). {solitario.activo ? "Solo la pieza que estás editando." : "La escena entera, como la ves."}</p>
          {listo && <GeneradorIA capturar={async () => { const visor = escenaRef.current; if (!visor) return null; await visor.esperarRotulos(); return visor.capturar(); }} descripcion={descripcionIA} escena={nombreEscena} />}
        </div>
      </DialogoTaller>
      <DialogoTaller abierto={dialogo === "ayuda"} onCerrar={() => setDialogo(null)} titulo="Ayuda y atajos">
        <Ayuda />
      </DialogoTaller>
      <DialogoTaller abierto={ficha !== null} onCerrar={() => setFicha(null)} titulo={ficha?.nombre ?? "Ficha"} forma="grande">
        {ficha && <FichaDialogo key={ficha.id} item={ficha} onAbrirEnEscena={abrirEnEscena} onAnadir={anadirItem} onCerrar={() => setFicha(null)} />}
      </DialogoTaller>
      <DialogoTaller abierto={panelEnDialogo} onCerrar={() => setPanel(null)} titulo={panel === "sala" ? "Sala" : "Plantillas"}>
        {panelEnDialogo && (panel === "sala" ? panelSala : panelPlantillas)}
      </DialogoTaller>
    </div>
  );
}
