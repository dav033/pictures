"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Rows3, Circle, Anchor, Undo2, Redo2 } from "lucide-react";
import { FORMATOS_GLOBO, NOMBRE_FAMILIA, coloresDelFormato, formatoPorId, infladoValido, type FormatoGlobo } from "@/lib/globos3d/formatos";
import { MODULOS, armarModulo, materialesModulo, moduloPorId, type TipoModulo } from "@/lib/globos3d/modulos";
import { PATRONES_COLUMNA, armarColumna, type PatronColumna } from "@/lib/globos3d/columnas";
import { FORMAS_ARCO, armarArco, type FormaArco } from "@/lib/globos3d/arcos";
import { colocarEn, colocarTubosEn, elegirAnclas, materialesPorFormato, type GloboDecoracion, type ReglaDecoracion, type TuboDecoracion } from "@/lib/globos3d/decoraciones";
import { armarDecoracion, decoracionPredefinida, type Decoracion, type MaterialDecoracion } from "@/lib/globos3d/figuras";
import { CELEBRA_27, decorarPared, sumarMateriales, type MezclaDecoraciones } from "@/lib/globos3d/mezcla";
import { PARED_TRENZAS_INICIAL, armarParedTrenzas, superficieFrontal, type OpcionesParedTrenzas } from "@/lib/globos3d/pared-trenzas";
import type { DondeDecoracion } from "./PanelFlor";
import { PanelDecoracion, nombreDecoracion } from "./PanelDecoracion";
import { PanelPared, PARED_INICIAL, type OpcionesPared, type TipoPared } from "./PanelPared";
import { armarPared } from "@/lib/globos3d/paredes";
import { armarOrganico } from "@/lib/globos3d/organico";
import { repartirFlores } from "@/lib/globos3d/flores-artificiales";
import { COLUMNA_QUINCE_AZUL } from "@/lib/globos3d/organico-presets";
import { AJUSTES_QUINCE_AZUL, PanelOrganico, opcionesDeAjustes, type AjustesOrganico } from "./PanelOrganico";
import { referenciaPorCodigo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import type { EscenaGlobos, GloboColocadoEnEscena, GloboEnEscena, TuboEnEscena } from "./escena-globos";
import { descripcionRender3d, formatoEnIngles } from "@/lib/globos3d/render-ia";
import { GeneradorIA } from "./GeneradorIA";
import { PaletaEscena, type GrupoColor } from "./PaletaEscena";
import { reemplazarColor } from "@/lib/globos3d/recolorear";
import { armarEscena, escenaEnIngles, type Escena } from "@/lib/globos3d/escena";
import { escenaPredefinida } from "@/lib/globos3d/escenas-presets";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { PanelEscena } from "./PanelEscena";
import { useEdicionEscena, useHistorialEscena, type PiezaEnVivo } from "./useEdicionEscena";
import { useLienzoDecoraciones, type CopiaElegida } from "./useLienzoDecoraciones";
import { ArrastreDecoracionContexto } from "./arrastre-decoracion";

const formatoCm = (valor: number) => `${valor.toLocaleString("es-CO", { maximumFractionDigits: 1 })} cm`;
const metros = (cm: number) => (cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** Un globo de decoración (o de pared) tal como lo dibuja el visor: formato, color oficial y orientación. */
function globoAEscena(g: GloboDecoracion, porDefecto: FormatoGlobo): GloboColocadoEnEscena {
  const ref = referenciaPorCodigo(g.codigo);
  return {
    formato: formatoPorId(g.formatoId) ?? porDefecto, infladoCm: g.infladoCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion",
    nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm, ...(g.frente ? { frente: g.frente } : {}), ...(g.estampado ? { estampado: g.estampado } : {}),
  };
}

function tuboAEscena(t: TuboDecoracion): TuboEnEscena {
  const ref = referenciaPorCodigo(t.codigo);
  // Papel (fantasma, telaraña, cintas): no es globo, va en su color y mate.
  if (t.papel) return { puntos: t.puntos, grosorCm: t.grosorCm, hex: t.papel.hex, familia: "papel", cerrado: t.cerrado, ...(t.papel.relleno ? { relleno: true } : {}) };
  return { puntos: t.puntos, grosorCm: t.grosorCm, hex: ref?.hexGlobo ?? "#ffffff", familia: ref?.familia ?? "fashion", cerrado: t.cerrado };
}

/** La lista de materiales de la tarjeta del visor: cantidad × formato, nombre del color y código. */
function ListaMateriales({ materiales }: { materiales: ReadonlyArray<MaterialDecoracion> }) {
  return (
    <ul className={`mt-1 text-xs text-texto ${materiales.length > 6 ? "gap-x-4 sm:columns-2" : ""}`}>
      {materiales.map((m) => {
        const ref = referenciaPorCodigo(m.codigo);
        return <li key={`${m.formatoId}|${m.codigo}`} className="break-inside-avoid">{m.cantidad} × {m.formatoId} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
      })}
    </ul>
  );
}

/** Materiales con el nombre del color en inglés, para la descripción que acompaña la captura a FLUX. */
function materialesEnIngles(materiales: ReadonlyArray<{ formatoId: string; codigo: string; cantidad: number }>) {
  return materiales.map((m) => ({ cantidad: m.cantidad, formatoId: m.formatoId, colorEn: referenciaPorCodigo(m.codigo)?.nombreEn ?? m.codigo }));
}

const PATRON_EN: Record<PatronColumna, string> = { un_color: "single-color", dos_colores: "two-color", espiral: "spiral", salvavidas: "life-ring", zigzag: "zig-zag" };
const FORMA_EN: Record<FormaArco, string> = { redondo: "round", parabolico: "parabolic", rectangular: "rectangular" };
const MODULO_EN: Record<TipoModulo, string> = { pareja: "duplet", trio: "triplet", cuarteto: "quartet", quinteto: "quintet", sexteto: "sextet" };

/** Lo que se guarda antes de cambiar un color con la paleta, para «Deshacer». */
type FotoColores = {
  pared: OpcionesPared; paredTrenzas: OpcionesParedTrenzas; mezcla: MezclaDecoraciones; decoracion: Decoracion;
  coloresColumna: string[]; coloresModulo: string[]; ajustesOrganico: AjustesOrganico; codigo: string; escena: Escena;
};

/** Formatos de la columna de cuartetos: redondos de 5" a 18". */
const FORMATOS_COLUMNA = ["R-5", "R-9", "R-12", "R-18"] as const;

/** Formatos con los que se arman módulos: redondos de 5" a 24" y Link-O-Loon 6 y 12. */
const FORMATOS_MODULO = ["R-5", "R-9", "R-12", "R-18", "R-24", "LOL-6", "LOL-12"] as const;

type Modo = "globo" | "modulo" | "columna" | "arco" | "pared" | "decoracion" | "organico" | "escena";

const BOTON = "min-h-11 rounded-xl px-2 text-sm ring-1 transition-colors";
const ACTIVO = "bg-acento text-sobre-acento ring-acento";
const INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";

/**
 * Página /3d. Dos pestañas:
 * - Globo: cada globo Sempertex a su tamaño real (formato, color oficial, inflado), o todos los redondos lado a lado.
 * - Módulos: pareja, trío, cuarteto, quinteto y sexteto armados como enseña Sempertex, con color por globo,
 *   sus anclas (donde se cuelgan las decoraciones) y su lista de materiales.
 */
export function Taller3D() {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const escenaRef = useRef<EscenaGlobos | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("globo");
  const [formatoId, setFormatoId] = useState("R-12");
  const formato = formatoPorId(formatoId) ?? FORMATOS_GLOBO[2]!;
  const colores = useMemo(() => coloresDelFormato(formato.id), [formato.id]);
  const [codigo, setCodigo] = useState("009");
  const color = colores.find((c) => c.codigo === codigo) ?? colores[0];
  const [infladoCm, setInfladoCm] = useState(formato.infladoDecoracionCm);
  const [vista, setVista] = useState<"uno" | "todos">("uno");
  // Módulos
  const [moduloId, setModuloId] = useState<TipoModulo>("cuarteto");
  const modulo = moduloPorId(moduloId) ?? MODULOS[2]!;
  const [coloresModulo, setColoresModulo] = useState<string[]>(["009", "009", "009", "009", "009", "009"]);
  const [ranura, setRanura] = useState<number | null>(null);
  const [verAnclas, setVerAnclas] = useState(true);
  // Columna (los colores de la espiralada de Sempertex: Amarillo y Fucsia opuestos, Azul Caribe y Verde Lima opuestos)
  const [patron, setPatron] = useState<PatronColumna>("espiral");
  const [alturaCm, setAlturaCm] = useState(180);
  const [coloresColumna, setColoresColumna] = useState<string[]>(["020", "038", "012", "031"]);
  // Arco (comparte patrón y colores con la columna: es la misma trenza sobre una curva)
  const [forma, setForma] = useState<FormaArco>("redondo");
  const [anchoArcoCm, setAnchoArcoCm] = useState(300);
  const [altoArcoCm, setAltoArcoCm] = useState(240);
  // Decoración: una decoración por propiedades (flor, flor de tubito, moño, estrella, flor de corazones), sola o
  // colgada de las anclas de la columna, del arco o de la pared; en la pared, también una mezcla de varias.
  const [decoracion, setDecoracion] = useState<Decoracion>(() => decoracionPredefinida("flor5"));
  const [donde, setDonde] = useState<DondeDecoracion>("columna");
  const [regla, setRegla] = useState<ReglaDecoracion>({ cadaNiveles: 2, caras: 2 });
  const [mezcla, setMezcla] = useState<MezclaDecoraciones>(CELEBRA_27.mezcla);
  const [usarMezcla, setUsarMezcla] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  // Pared: malla Link-O-Loon tipo flor o trenzas alternando tamaños.
  const [pared, setPared] = useState<OpcionesPared>(PARED_INICIAL);
  const [tipoPared, setTipoPared] = useState<TipoPared>("malla");
  const [paredTrenzas, setParedTrenzas] = useState<OpcionesParedTrenzas>(PARED_TRENZAS_INICIAL);
  const [verAnclasPared, setVerAnclasPared] = useState(false);
  // Escena: varias piezas (arco orgánico, columnas, guirnalda, pared…) colocadas en una sala.
  // Con deshacer y rehacer (Ctrl+Z / Ctrl+Y): cada cambio de la escena guarda un paso.
  const historialEscena = useHistorialEscena(() => escenaPredefinida("arco_organico_columnas_guirnalda"));
  const escenaEdit = historialEscena.escena;
  const setEscenaEdit = historialEscena.cambiar;
  const [seleccionElegida, setSeleccion] = useState<string | null>(null);
  // Si la pieza elegida ya no está (se quitó o se deshizo su llegada), no hay elegida.
  const seleccion = seleccionElegida && escenaEdit.nodos.some((n) => n.id === seleccionElegida) ? seleccionElegida : null;
  /** La pieza que se está arrastrando y dónde va (sus coordenadas en vivo en el panel). */
  const [enVivo, setEnVivo] = useState<PiezaEnVivo | null>(null);
  /** La copia de un reparto en anclas que se tocó en el visor (las flechas, Q/E y Supr van solo a esa). */
  const [copiaTocada, setCopiaTocada] = useState<CopiaElegida | null>(null);
  const copiaElegida = copiaTocada && copiaTocada.id === seleccion ? copiaTocada : null;
  /** Lo que pasó al soltar una decoración en el visor (o por qué no se puso). */
  const [avisoLienzo, setAvisoLienzo] = useState<string | null>(null);
  /** Sube al cargar una escena predefinida: el visor reencuadra; al mover una pieza, la cámara se queda quieta. */
  const [vueltaEncuadre, setVueltaEncuadre] = useState(0);
  const encuadradoRef = useRef<number | null>(null);
  // Piezas ya armadas por su JSON: mover una pieza no rehace el arco orgánico (medio segundo).
  const [cacheEscena] = useState(() => new Map<string, PiezaArmada>());

  // La escena se crea una vez (three.js se carga solo en el navegador).
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
        setListo(true);
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

  const inflado = infladoValido(formato, infladoCm);
  const armado = useMemo(() => armarModulo(modulo, formato, inflado), [modulo, formato, inflado]);
  const datosPatron = PATRONES_COLUMNA.find((p) => p.id === patron) ?? PATRONES_COLUMNA[1]!;
  const arco = useMemo(() => armarArco({ formato, infladoCm: inflado, forma, anchoCm: anchoArcoCm, altoCm: altoArcoCm, patron, colores: coloresColumna.slice(0, datosPatron.colores) }), [formato, inflado, forma, anchoArcoCm, altoArcoCm, patron, coloresColumna, datosPatron.colores]);
  const elementoEditado = editando !== null ? mezcla.elementos[editando] : undefined;
  const decoracionEnEditor = elementoEditado?.decoracion ?? decoracion;
  const decoracionArmada = useMemo(() => armarDecoracion(decoracionEnEditor), [decoracionEnEditor]);
  const cambiarDecoracion = (nueva: Decoracion) => {
    if (editando === null || !elementoEditado) { setDecoracion(nueva); return; }
    const nombre = nombreDecoracion(nueva);
    setMezcla({ ...mezcla, elementos: mezcla.elementos.map((e, i) => (i === editando ? { ...e, decoracion: nueva, nombre } : e)) });
  };
  const paredTrenzasArmada = useMemo(() => armarParedTrenzas(paredTrenzas), [paredTrenzas]);
  const paredArmada = useMemo(() => armarPared({
    formato: formatoPorId(pared.formatoId)!, infladoCm: pared.infladoCm, anchoCm: pared.anchoCm, altoCm: pared.altoCm, patron: pared.patron, colores: pared.colores,
    union: { formato: formatoPorId("R-5")!, infladoCm: pared.union.infladoCm, codigo: pared.union.codigo },
  }), [pared]);
  const columna = useMemo(() => armarColumna({ formato, infladoCm: inflado, alturaCm, patron, colores: coloresColumna.slice(0, datosPatron.colores) }), [formato, inflado, alturaCm, patron, coloresColumna, datosPatron.colores]);
  const refModulo = (i: number): ReferenciaSempertex | undefined => {
    const c = coloresModulo[i] ?? codigo;
    return colores.find((x) => x.codigo === c) ?? color;
  };

  // Decoración: la estructura elegida (o nada) y la decoración en cada ancla que cumple la regla; en la pared,
  // apoyada sobre la superficie y, si se pide, una mezcla de varias repartida en las anclas.
  const paredActual = tipoPared === "trenzas" ? paredTrenzasArmada : paredArmada;
  const superficie = useMemo(() => superficieFrontal(paredActual.globos), [paredActual]);
  const escenaDecoracion = useMemo((): { globos: GloboDecoracion[]; tubos: TuboDecoracion[]; materiales: MaterialDecoracion[]; soloDecoraciones: MaterialDecoracion[]; puestas: number; porElemento: number[] } => {
    const armada = decoracionArmada;
    if (donde === "sola") return { globos: armada.globos, tubos: armada.tubos, materiales: armada.materiales, soloDecoraciones: armada.materiales, puestas: 1, porElemento: [] };
    if (donde === "pared") {
      const base: GloboDecoracion[] = paredActual.globos.map((g) => ({ formatoId: g.formatoId, infladoCm: g.infladoCm, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
      const cada = Math.max(1, regla.cadaNiveles);
      // Una sola decoración: en la malla, 1 de cada N centros de flor; en las trenzas, 1 de cada N cuartetos sobre
      // el eje de cada trenza, corriendo media vuelta en las trenzas impares para que queden en tresbolillo.
      const decorada = usarMezcla
        ? decorarPared({ anclas: paredActual.anclas, mezcla, superficie, limites: { minX: 0, maxX: paredActual.anchoCm, minY: 0, maxY: paredActual.altoCm } })
        : decorarPared({
          anclas: tipoPared === "malla"
            ? paredArmada.anclas.filter((a) => a.fila % cada === 0 && a.columna % cada === 0)
            : paredTrenzasArmada.anclas.filter((a) => a.tipo === "trenza" && (a.nivel + (a.columna % 2) * Math.ceil(cada / 2)) % cada === 0),
          mezcla: { elementos: [{ nombre: nombreDecoracion(decoracionEnEditor), decoracion: decoracionEnEditor, peso: 1 }], modo: "ciclico", semilla: 0, total: 10000, separacionCm: -1e6, giroAleatorio: false },
          superficie,
        });
      return { globos: [...base, ...decorada.globos], tubos: decorada.tubos, materiales: sumarMateriales(paredActual.materiales, decorada.materiales), soloDecoraciones: decorada.materiales, puestas: decorada.colocaciones.length, porElemento: decorada.porElemento };
    }
    const estructura = donde === "arco" ? arco : columna;
    const base: GloboDecoracion[] = estructura.globos.map((g) => ({ formatoId: formato.id, infladoCm: inflado, codigo: g.codigo, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm }));
    const anclas = elegirAnclas(estructura.anclas, regla);
    return {
      globos: [...base, ...anclas.flatMap((ancla) => colocarEn(armada.globos, ancla))],
      tubos: anclas.flatMap((ancla) => colocarTubosEn(armada.tubos, ancla)),
      materiales: sumarMateriales(materialesPorFormato(base), ...anclas.map(() => armada.materiales)),
      soloDecoraciones: sumarMateriales(...anclas.map(() => armada.materiales)),
      puestas: anclas.length, porElemento: [],
    };
  }, [donde, arco, columna, paredActual, paredArmada, paredTrenzasArmada, tipoPared, superficie, regla, usarMezcla, mezcla, decoracionArmada, decoracionEnEditor, formato.id, inflado]);

  /** «Pared de Celebra ed. 27»: la malla de trenzas, la mezcla de la foto y la vista de decoración en la pared. */
  function aplicarCelebra() {
    setTipoPared("trenzas");
    setParedTrenzas(CELEBRA_27.pared);
    setMezcla(CELEBRA_27.mezcla);
    setUsarMezcla(true);
    setEditando(null);
    setDonde("pared");
    cambiarModo("decoracion");
  }

  // Orgánico: la columna azul de XV (motor orgánico + flores artificiales en los huecos + pedestal).
  const [ajustesOrganico, setAjustesOrganico] = useState<AjustesOrganico>(AJUSTES_QUINCE_AZUL);
  const organico = useMemo(() => {
    const resultado = armarOrganico(opcionesDeAjustes(ajustesOrganico));
    const flores = ajustesOrganico.conFlores ? repartirFlores(resultado.anclas, COLUMNA_QUINCE_AZUL.flores) : { racimos: [], materiales: [], avisos: [] };
    return { resultado, flores };
  }, [ajustesOrganico]);

  const armadaEscena = useMemo(() => (modo === "escena" ? armarEscena(escenaEdit, cacheEscena) : null), [modo, escenaEdit, cacheEscena]);

  // Lo que se ve.
  useEffect(() => {
    const escena = escenaRef.current;
    if (!listo || !escena || !color) return;
    if (modo === "escena" && armadaEscena) {
      // Ya viene en coordenadas del mundo, con su sala. Si la pieza elegida cuelga de otra, se ven las anclas de esa otra.
      const elegido = escenaEdit.nodos.find((n) => n.id === seleccion);
      const padreId = elegido?.colocacion.en === "ancla" || elegido?.colocacion.en === "sobre" ? elegido.colocacion.padreId : null;
      const anclas = padreId ? armadaEscena.porNodo.find((n) => n.id === padreId)?.anclas.map((a) => a.posicion) ?? [] : [];
      const encuadrar = encuadradoRef.current !== vueltaEncuadre;
      encuadradoRef.current = vueltaEncuadre;
      // Cada cosa lleva el id de su pieza: un clic la elige y al arrastrarla se mueve todo lo suyo junto.
      escena.mostrarModulo(
        armadaEscena.porNodo.flatMap((n) => n.globos.map((g) => ({ ...globoAEscena(g, formato), ...(g.confeti ? { confeti: true } : {}), nodo: n.id }))),
        anclas,
        armadaEscena.porNodo.flatMap((n) => n.tubos.map((t) => ({ ...tuboAEscena(t), nodo: n.id }))),
        {
          flores: armadaEscena.porNodo.flatMap((n) => n.flores.map((f) => ({ ...f, nodo: n.id }))), cilindros: armadaEscena.cilindros, sala: armadaEscena.sala,
          solidos: armadaEscena.porNodo.flatMap((n) => n.solidos.map((x) => ({ ...x, nodo: n.id }))),
          // La copia tocada de un reparto se resalta sola; si no, la pieza entera.
          resaltado: (() => {
            const hecho = armadaEscena.porNodo.find((n) => n.id === seleccion);
            return (copiaElegida ? hecho?.puestas[copiaElegida.copia]?.caja : undefined) ?? hecho?.caja ?? null;
          })(), encuadrar,
        },
      );
      return;
    }
    encuadradoRef.current = null;
    if (modo === "organico") {
      const { resultado, flores } = organico;
      const pedestal = COLUMNA_QUINCE_AZUL.escena.pedestal;
      escena.mostrarModulo(
        resultado.globos.map((g) => ({ ...globoAEscena(g, formato), confeti: g.confeti })),
        [],
        [],
        {
          flores: flores.racimos.flatMap((r) => r.flores.map((f) => ({ tipo: f.tipo, hex: f.hex, diametroCm: f.diametroCm, posicion: f.posicion, normal: f.normal }))),
          cilindros: ajustesOrganico.conPedestal ? [{ base: pedestal.base, radioCm: pedestal.radioCm, altoCm: pedestal.altoCm, hex: "#f4f2ee" }] : [],
        },
      );
    } else if (modo === "pared") {
      escena.mostrarModulo(paredActual.globos.map((g) => globoAEscena(g, formato)), verAnclasPared ? paredActual.anclas.map((a) => a.posicion) : []);
    } else if (modo === "decoracion") {
      escena.mostrarModulo(escenaDecoracion.globos.map((g) => globoAEscena(g, formato)), [], escenaDecoracion.tubos.map(tuboAEscena));
    } else if (modo === "columna" || modo === "arco") {
      const globos: GloboColocadoEnEscena[] = (modo === "arco" ? arco.globos : columna.globos).map((g) => {
        const ref = colores.find((x) => x.codigo === g.codigo) ?? color;
        return { formato, infladoCm: inflado, hex: ref.hexGlobo, familia: ref.familia, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      });
      escena.mostrarModulo(globos, []);
    } else if (modo === "modulo") {
      const globos: GloboColocadoEnEscena[] = armado.globos.map((g) => {
        const ref = colores.find((x) => x.codigo === coloresModulo[g.indice]) ?? color;
        return { formato, infladoCm: inflado, hex: ref.hexGlobo, familia: ref.familia, nudo: g.nudo, direccion: g.direccion, cuelloExtraCm: g.cuelloExtraCm };
      });
      escena.mostrarModulo(globos, verAnclas ? armado.anclas.map((a) => a.posicion) : []);
    } else if (vista === "todos") {
      const fila: GloboEnEscena[] = FORMATOS_GLOBO.filter((f) => f.tipo === "redondo" && color.formatos.includes(f.id))
        .map((f) => ({ formato: f, infladoCm: f.infladoDecoracionCm, hex: color.hexGlobo, familia: color.familia }));
      escena.mostrar(fila);
    } else {
      escena.mostrar([{ formato, infladoCm: inflado, hex: color.hexGlobo, familia: color.familia }]);
    }
  }, [listo, modo, vista, formato, inflado, color, colores, coloresModulo, armado, verAnclas, columna, arco, escenaDecoracion, paredActual, verAnclasPared, organico, ajustesOrganico.conPedestal, armadaEscena, escenaEdit, seleccion, vueltaEncuadre, copiaElegida]);

  // Escena a mano en el visor: clic elige, arrastrar mueve, teclado (flechas, Q/E, RePág/AvPág, Supr, Ctrl+D/Z/Y, Esc).
  useEdicionEscena({
    lienzoRef, visorRef: escenaRef, activo: listo && modo === "escena", escena: escenaEdit, armada: armadaEscena, seleccion,
    onSeleccion: setSeleccion, onCambio: setEscenaEdit, onEnVivo: setEnVivo, onDeshacer: historialEscena.deshacer, onRehacer: historialEscena.rehacer,
  });

  // La estructura como lienzo: arrastrar decoraciones del panel al visor, coger una copia colgada y moverla.
  const lienzoDecoraciones = useLienzoDecoraciones({
    lienzoRef, visorRef: escenaRef, activo: listo && modo === "escena", escena: escenaEdit, armada: armadaEscena, seleccion, copia: copiaElegida,
    onCopia: setCopiaTocada, onSeleccion: setSeleccion, onCambio: setEscenaEdit, onAviso: setAvisoLienzo, cache: cacheEscena,
    aEscena: (n) => ({ globos: n.globos.map((g) => ({ ...globoAEscena(g, formato), ...(g.confeti ? { confeti: true } : {}) })), tubos: n.tubos.map(tuboAEscena) }),
  });
  // El aviso del visor se va solo.
  useEffect(() => {
    if (!avisoLienzo) return;
    const t = setTimeout(() => setAvisoLienzo(null), 7000);
    return () => clearTimeout(t);
  }, [avisoLienzo]);

  function elegirFormato(f: FormatoGlobo) {
    setFormatoId(f.id);
    setInfladoCm(f.infladoDecoracionCm);
    const disponibles = coloresDelFormato(f.id);
    if (!disponibles.some((c) => c.codigo === codigo)) setCodigo(disponibles[0]?.codigo ?? codigo);
    setColoresModulo((actual) => actual.map((c) => (disponibles.some((d) => d.codigo === c) ? c : disponibles[0]?.codigo ?? c)));
    setColoresColumna((actual) => actual.map((c) => (disponibles.some((d) => d.codigo === c) ? c : disponibles[0]?.codigo ?? c)));
    setVista("uno");
  }

  function cambiarModo(nuevo: Modo) {
    setModo(nuevo);
    setAvisoColor(null);
    if (nuevo === "modulo" && !FORMATOS_MODULO.includes(formato.id as (typeof FORMATOS_MODULO)[number])) elegirFormato(formatoPorId("R-12")!);
    if ((nuevo === "columna" || nuevo === "arco" || nuevo === "decoracion") && !FORMATOS_COLUMNA.includes(formato.id as (typeof FORMATOS_COLUMNA)[number])) elegirFormato(formatoPorId("R-12")!);
    setRanura(null);
  }

  function elegirColor(nuevo: string) {
    setCodigo(nuevo);
    if (modo === "columna" || modo === "arco") {
      setColoresColumna((actual) => (ranura === null ? actual.map(() => nuevo) : actual.map((c, i) => (i === ranura ? nuevo : c))));
      return;
    }
    if (modo !== "modulo") return;
    // Con una ranura elegida cambia solo ese globo; sin ranura, todo el módulo queda de ese color.
    setColoresModulo((actual) => (ranura === null ? actual.map(() => nuevo) : actual.map((c, i) => (i === ranura ? nuevo : c))));
  }

  const porFamilia = useMemo(() => {
    const grupos = new Map<string, typeof colores>();
    for (const c of colores) grupos.set(c.familia, [...(grupos.get(c.familia) ?? []), c]);
    return [...grupos.entries()];
  }, [colores]);

  const materiales = materialesModulo(coloresModulo.slice(0, modulo.globos));
  const formatosVisibles = modo === "modulo"
    ? FORMATOS_GLOBO.filter((f) => FORMATOS_MODULO.includes(f.id as (typeof FORMATOS_MODULO)[number]))
    : modo === "columna" || modo === "arco" ? FORMATOS_GLOBO.filter((f) => FORMATOS_COLUMNA.includes(f.id as (typeof FORMATOS_COLUMNA)[number])) : FORMATOS_GLOBO;
  const seleccionado = (i: number) => (modo === "modulo" ? coloresModulo[i] : codigo);

  // Colores de la escena: los que usa lo que se ve, y cambiar uno en todo el montaje de una vez.
  const [avisoColor, setAvisoColor] = useState<string | null>(null);
  const [historialColor, setHistorialColor] = useState<FotoColores[]>([]);
  // En Decoración, la base (pared, columna o arco) y las decoraciones se cambian por separado.
  const gruposColor = useMemo((): GrupoColor[] => {
    if (modo !== "decoracion" || donde === "sola") return [];
    const deBase = donde === "pared" ? paredActual.materiales : (donde === "arco" ? arco : columna).materiales.map((m) => ({ formatoId: formato.id, codigo: m.codigo, cantidad: m.cantidad }));
    return [
      { id: "base", nombre: donde === "pared" ? "Pared" : donde === "arco" ? "Arco" : "Columna", materiales: deBase },
      { id: "decoraciones", nombre: "Decoraciones", materiales: escenaDecoracion.soloDecoraciones },
    ];
  }, [modo, donde, paredActual, escenaDecoracion, arco, columna, formato.id]);
  const materialesEscena = useMemo(() => {
    const conFormato = (lista: ReadonlyArray<{ codigo: string; cantidad: number }>) => lista.map((m) => ({ formatoId: formato.id, codigo: m.codigo, cantidad: m.cantidad }));
    if (modo === "escena") return armadaEscena?.materiales ?? [];
    if (modo === "organico") return organico.resultado.materiales;
    if (modo === "pared") return paredActual.materiales;
    if (modo === "decoracion") return escenaDecoracion.materiales;
    if (modo === "columna") return conFormato(columna.materiales);
    if (modo === "arco") return conFormato(arco.materiales);
    if (modo === "modulo") return conFormato(materiales);
    return [];
  }, [modo, organico, paredActual, escenaDecoracion, columna, arco, materiales, formato.id, armadaEscena]);

  function reemplazarEnEscena(de: string, a: string, grupo: GrupoColor["id"] | "todo" = "todo") {
    setHistorialColor((h) => [...h.slice(-19), { pared, paredTrenzas, mezcla, decoracion, coloresColumna, coloresModulo, ajustesOrganico, codigo, escena: escenaEdit }]);
    const enBase = grupo !== "decoraciones";
    const enDecoraciones = grupo !== "base";
    const omitidos = new Set<string>();
    let cambios = 0;
    const cambiar = <T,>(valor: T): T => {
      const r = reemplazarColor(valor, de, a);
      r.omitidos.forEach((f) => omitidos.add(f));
      cambios += r.cambios;
      return r.valor;
    };
    const enLista = (lista: string[]) => {
      if (!lista.includes(de)) return lista;
      if (!colores.some((c) => c.codigo === a)) { omitidos.add(formato.id); return lista; }
      cambios += 1;
      return lista.map((c) => (c === de ? a : c));
    };
    if (modo === "organico") setAjustesOrganico(cambiar(ajustesOrganico));
    // En la escena, el color cambia en todas sus piezas a la vez (la sala no: sus tonos no son globos).
    if (modo === "escena") setEscenaEdit(cambiar(escenaEdit));
    if (modo === "pared" || (modo === "decoracion" && donde === "pared" && enBase)) {
      // Solo la pared que se ve (malla o trenzas): la otra no está en la escena.
      if (tipoPared === "malla") setPared(cambiar(pared)); else setParedTrenzas(cambiar(paredTrenzas));
    }
    if (modo === "decoracion" && enDecoraciones) {
      // Con el color cambia también el nombre («Moño fucsia» ya no es fucsia).
      const nueva = cambiar(mezcla);
      setMezcla({ ...nueva, elementos: nueva.elementos.map((e, i) => (JSON.stringify(e.decoracion) === JSON.stringify(mezcla.elementos[i]?.decoracion) ? e : { ...e, nombre: nombreDecoracion(e.decoracion) })) });
      setDecoracion(cambiar(decoracion));
    }
    if (modo === "columna" || modo === "arco" || (modo === "decoracion" && (donde === "columna" || donde === "arco") && enBase)) setColoresColumna(enLista(coloresColumna));
    if (modo === "modulo") setColoresModulo(enLista(coloresModulo));
    if (codigo === de && colores.some((c) => c.codigo === a)) setCodigo(a);
    const nombre = referenciaPorCodigo(a)?.nombreCompleto ?? a;
    setAvisoColor(omitidos.size
      ? `${nombre} no se fabrica en ${[...omitidos].join(", ")}: esas piezas quedan como estaban.`
      : cambios ? null : "No había nada de ese color para cambiar.");
  }

  function deshacerColor() {
    const ultima = historialColor[historialColor.length - 1];
    if (!ultima) return;
    setPared(ultima.pared); setParedTrenzas(ultima.paredTrenzas); setMezcla(ultima.mezcla); setDecoracion(ultima.decoracion);
    setColoresColumna(ultima.coloresColumna); setColoresModulo(ultima.coloresModulo); setAjustesOrganico(ultima.ajustesOrganico); setCodigo(ultima.codigo); setEscenaEdit(ultima.escena);
    setHistorialColor(historialColor.slice(0, -1));
    setAvisoColor(null);
  }

  // Lo que se le cuenta a FLUX junto con la captura: la estructura y sus globos (en inglés, sin marcas).
  const descripcionIA = useMemo(() => {
    const m = (cm: number) => `${(cm / 100).toFixed(2).replace(/\.?0+$/, "")} m`;
    if (modo === "escena" && armadaEscena) {
      return descripcionRender3d(escenaEnIngles(escenaEdit, armadaEscena), materialesEnIngles(armadaEscena.materiales), armadaEscena.flores.length ? "Artificial hydrangeas and roses tucked between the balloons" : "");
    }
    if (modo === "organico") {
      const r = organico.resultado;
      return descripcionRender3d(
        `An organic balloon column ${m(r.medidas.altoCm)} tall made of mixed-size balloons, with a balloon garland wrapping around ${ajustesOrganico.conPedestal ? "a white round pedestal" : "its base"}`,
        materialesEnIngles(r.materiales),
        organico.flores.racimos.length ? `${organico.flores.racimos.length} clusters of artificial hydrangea and rose flowers tucked between the balloons; clear balloons have silver confetti inside` : "",
      );
    }
    if (modo === "pared") return descripcionRender3d(`A flat balloon wall ${m(paredActual.anchoCm)} wide and ${m(paredActual.altoCm)} tall, ${tipoPared === "malla" ? "a Link-O-Loon flower mesh" : "vertical braids of quartets alternating balloon sizes"}`, materialesEnIngles(paredActual.materiales));
    if (modo === "decoracion") {
      const base = donde === "sola" ? "A small balloon decoration piece" : donde === "pared" ? `A balloon wall ${m(paredActual.anchoCm)} wide and ${m(paredActual.altoCm)} tall` : donde === "arco" ? `A ${FORMA_EN[forma]} balloon arch ${m(anchoArcoCm)} wide` : `A balloon column ${m(columna.alturaCm)} tall`;
      return descripcionRender3d(`${base}${donde === "sola" ? "" : ` decorated with ${escenaDecoracion.puestas} small balloon flowers and bows attached on its surface`}`, materialesEnIngles(escenaDecoracion.materiales));
    }
    if (modo === "columna") return descripcionRender3d(`A ${PATRON_EN[patron]} balloon column ${m(columna.alturaCm)} tall made of ${columna.niveles} stacked quartets`, materialesEnIngles(columna.materiales.map((x) => ({ ...x, formatoId: formato.id }))));
    if (modo === "arco") return descripcionRender3d(`A ${FORMA_EN[forma]} ${PATRON_EN[patron]} balloon arch ${m(anchoArcoCm)} wide and ${m(altoArcoCm)} tall made of ${arco.niveles} quartets`, materialesEnIngles(arco.materiales.map((x) => ({ ...x, formatoId: formato.id }))));
    if (modo === "modulo") return descripcionRender3d(`A single ${MODULO_EN[moduloId]} balloon cluster (${modulo.globos} balloons tied together at the center)`, materialesEnIngles(materiales.map((x) => ({ ...x, formatoId: formato.id }))));
    if (vista === "todos") return descripcionRender3d(`A row of round latex balloons of every size side by side, all ${color?.nombreEn ?? ""}`, []);
    return descripcionRender3d(`A single ${formatoEnIngles(formato.id)} latex balloon, ${color?.nombreEn ?? ""}`, []);
  }, [modo, organico, ajustesOrganico.conPedestal, paredActual, tipoPared, donde, forma, anchoArcoCm, altoArcoCm, columna, escenaDecoracion, patron, arco, formato.id, moduloId, modulo.globos, materiales, vista, color, armadaEscena, escenaEdit]);

  // Ficha del visor: compacta encima del lienzo (sin listas) y completa debajo (con materiales y notas).
  const elegidaEscena = armadaEscena?.porNodo.find((n) => n.id === seleccion);
  const fichaVisor = color ? (
    <>
                {modo === "escena" && armadaEscena ? (
                  <>
                    <p className="font-semibold text-texto">Escena · {escenaEdit.nodos.length} {escenaEdit.nodos.length === 1 ? "pieza" : "piezas"} · {armadaEscena.globos.length} globos{armadaEscena.flores.length ? ` · ${armadaEscena.flores.length} flores` : ""}</p>
                    <p className="font-mono text-xs text-texto-suave">Sala {metros(escenaEdit.sala.anchoCm)} × {metros(escenaEdit.sala.fondoCm)} × {metros(escenaEdit.sala.altoCm)} m{elegidaEscena ? ` · elegida: ${elegidaEscena.nombre} (${elegidaEscena.globos.length} globos)` : ""}</p>
                    <ul className="mt-1 text-xs text-texto-suave">
                      {armadaEscena.porNodo.map((n) => <li key={n.id}>{n.nombre}: {n.globos.length} globos{n.copias > 1 ? ` en ${n.copias} copias` : ""}</li>)}
                    </ul>
                    <ListaMateriales materiales={armadaEscena.materiales} />
                    {armadaEscena.avisos.length > 0 && <p className="mt-1 text-[0.7rem] text-texto">{armadaEscena.avisos.join(" ")}</p>}
                  </>
                ) : modo === "organico" ? (
                  <>
                    <p className="font-semibold text-texto">Columna orgánica · {metros(organico.resultado.medidas.altoCm)} m · {organico.resultado.conteo.total} globos{organico.flores.racimos.length ? ` · ${organico.flores.racimos.length} racimos de flores` : ""}</p>
                    <p className="font-mono text-xs text-texto-suave">{organico.resultado.conteo.porTamano.grande} grandes · {organico.resultado.conteo.porTamano.mediano} medianos · {organico.resultado.conteo.porTamano.relleno} de relleno · {organico.resultado.medidas.tramos.map((t) => `${t.nombre ?? t.id}`).join(" + ")}</p>
                    <ListaMateriales materiales={organico.resultado.materiales.map((m) => ({ formatoId: m.formatoId, codigo: m.codigo, cantidad: m.cantidad }))} />
                    {organico.resultado.materiales.some((m) => m.confeti) && <p className="detalle-ficha mt-1 text-[0.7rem] text-texto-suave">Los cristales llevan confeti plateado por dentro.</p>}
                    {organico.flores.materiales.length > 0 && (
                      <ul className="mt-2 text-xs text-texto-suave">
                        {organico.flores.materiales.map((m) => <li key={`${m.tipo}|${m.colorId}`}>{m.cantidad} × {m.nombre} <span className="font-mono">(follaje, no cotiza como globo)</span></li>)}
                      </ul>
                    )}
                    {organico.resultado.avisos.length > 0 && <p className="detalle-ficha mt-1 text-[0.7rem] text-texto-suave">{organico.resultado.avisos.join(" ")}</p>}
                  </>
                ) : modo === "pared" ? (
                  tipoPared === "trenzas" ? (
                    <>
                      <p className="font-semibold text-texto">Trenzas alternando {paredTrenzas.grande.formatoId} a {formatoCm(paredTrenzas.grande.infladoCm)} y {paredTrenzas.chico.formatoId} a {formatoCm(paredTrenzas.chico.infladoCm)} · {metros(paredTrenzasArmada.anchoCm)} × {metros(paredTrenzasArmada.altoCm)} m</p>
                      <p className="font-mono text-xs text-texto-suave">{paredTrenzasArmada.columnas} trenzas × {paredTrenzasArmada.niveles} cuartetos ({paredTrenzasArmada.cuartetos.grande} grandes + {paredTrenzasArmada.cuartetos.chico} chicos) · {(100 / paredTrenzasArmada.pasoCm).toLocaleString("es-CO", { maximumFractionDigits: 1 })} por metro · {formatoCm(paredTrenzasArmada.anchoTrenzaCm)} por trenza</p>
                      <ListaMateriales materiales={paredTrenzasArmada.materiales} />
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-texto">Malla {pared.formatoId} tipo flor · {metros(paredArmada.anchoCm)} × {metros(paredArmada.altoCm)} m</p>
                      <p className="font-mono text-xs text-texto-suave">{paredArmada.eslabones} eslabones · {paredArmada.uniones} parejas de unión ({paredArmada.uniones * 2} R-5)</p>
                      <ListaMateriales materiales={paredArmada.materiales} />
                    </>
                  )
                ) : modo === "decoracion" ? (
                  <>
                    <p className="font-semibold text-texto">
                      {donde === "sola" ? `${nombreDecoracion(decoracionEnEditor)} · ${formatoCm(decoracionArmada.diametroCm)} de ancho`
                        : donde === "pared" ? `${tipoPared === "trenzas" ? "Pared de trenzas" : `Malla ${pared.formatoId}`} ${metros(paredActual.anchoCm)} × ${metros(paredActual.altoCm)} m · ${escenaDecoracion.puestas} ${usarMezcla ? "decoraciones" : `× ${nombreDecoracion(decoracionEnEditor)}`}`
                          : `${escenaDecoracion.puestas} × ${nombreDecoracion(decoracionEnEditor)} en ${donde === "arco" ? "el arco" : "la columna"}`}
                    </p>
                    {donde === "pared" && usarMezcla && (
                      <p className="detalle-ficha text-xs text-texto-suave">{mezcla.elementos.map((e, i) => `${escenaDecoracion.porElemento[i] ?? 0} ${e.nombre}`).join(" · ")}</p>
                    )}
                    <p className="font-mono text-xs text-texto-suave">{escenaDecoracion.globos.length} globos{escenaDecoracion.tubos.length ? ` · ${escenaDecoracion.tubos.length} tramos de tubito` : ""}</p>
                    <ListaMateriales materiales={escenaDecoracion.materiales} />
                    {escenaDecoracion.materiales.some((m) => m.formatoId.startsWith("T-")) && <p className="detalle-ficha mt-1 text-[0.7rem] text-texto-suave">Tubitos contados por largo (~137 cm útiles cada uno).</p>}
                    {escenaDecoracion.materiales.some((m) => m.formatoId === "C-6") && <p className="detalle-ficha text-[0.7rem] text-texto-suave">Corazón 6: color de Celebra ed. 27 (no está en la tabla oficial).</p>}
                  </>
                ) : modo === "arco" ? (
                  <>
                    <p className="font-semibold text-texto">Arco {FORMAS_ARCO.find((f) => f.id === forma)?.nombre.toLowerCase()} {datosPatron.nombre.toLowerCase()} de {formato.id} a {formatoCm(inflado)}</p>
                    <p className="font-mono text-xs text-texto-suave">{(anchoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} × {(altoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {(arco.longitudCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} m de recorrido · {arco.niveles} cuartetos · {arco.globos.length} globos</p>
                    <ul className="mt-1 text-xs text-texto">
                      {arco.materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={m.codigo}>{m.cantidad} × {formato.id} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : modo === "columna" ? (
                  <>
                    <p className="font-semibold text-texto">Columna {datosPatron.nombre.toLowerCase()} de {formato.id} a {formatoCm(inflado)}</p>
                    <p className="font-mono text-xs text-texto-suave">{(columna.alturaCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {columna.niveles} cuartetos · {columna.globos.length} globos</p>
                    <ul className="mt-1 text-xs text-texto">
                      {columna.materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={m.codigo}>{m.cantidad} × {formato.id} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : modo === "modulo" ? (
                  <>
                    <p className="font-semibold text-texto">{modulo.nombre} de {formato.id} a {formatoCm(inflado)}</p>
                    <p className="font-mono text-xs text-texto-suave">{modulo.globos} globos · {formatoCm(armado.anchoCm)} de ancho</p>
                    <ul className="mt-1 text-xs text-texto">
                      {materiales.map((m) => {
                        const ref = referenciaPorCodigo(m.codigo);
                        return <li key={m.codigo}>{m.cantidad} × {formato.id} {ref?.nombreCompleto ?? m.codigo} <span className="font-mono text-texto-suave">{m.codigo}</span></li>;
                      })}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-texto">{vista === "todos" ? "Redondos de 5\" a 36\"" : formato.nombre} · {color.nombreCompleto} <span className="font-mono text-xs text-texto-suave">{color.codigo}</span></p>
                    <p className="font-mono text-xs text-texto-suave">
                      {vista === "todos"
                        ? "Inflado de decoración de cada tamaño"
                        : formato.largoCm
                          ? `${formatoCm(inflado)} de grosor × ${formatoCm(formato.largoCm)} de largo`
                          : `${formatoCm(inflado)} de diámetro`}
                      {" · "}{color.acabado}
                    </p>
                  </>
                )}
    </>
  ) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wider text-acento">Taller 3D</p>
          <h1 className="text-2xl font-semibold text-texto">Globos Sempertex en 3D</h1>
          <p className="text-sm text-texto-suave">Cada formato a su tamaño real. La cuadrícula del piso es de 10 cm.</p>
        </div>
        <Link href="/asistente" className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm text-texto ring-1 ring-borde hover:bg-superficie-suave">
          <ArrowLeft className="size-4" aria-hidden /> Volver al asistente
        </Link>
      </header>

      <div role="tablist" aria-label="Qué modelar" className="inline-flex w-fit gap-1 rounded-full bg-superficie p-1 ring-1 ring-borde">
        {([["globo", "Globos"], ["modulo", "Módulos"], ["columna", "Columna"], ["arco", "Arco"], ["pared", "Pared"], ["decoracion", "Decoración"], ["organico", "Orgánico"], ["escena", "Escena"]] as const).map(([valor, etiqueta]) => (
          <button key={valor} type="button" role="tab" aria-selected={modo === valor} onClick={() => cambiarModo(valor)}
            className={`min-h-10 rounded-full px-5 text-sm font-medium ${modo === valor ? "bg-acento text-sobre-acento" : "text-texto hover:bg-superficie-suave"}`}>
            {etiqueta}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <ArrastreDecoracionContexto.Provider value={modo === "escena" && listo ? lienzoDecoraciones.empezarArrastre : null}>
        <aside className="order-2 flex min-w-0 flex-col gap-4 lg:order-1" aria-label="Elegir el globo">
          {modo !== "globo" && (
            <PaletaEscena grupos={gruposColor.length ? gruposColor : [{ id: "todo", nombre: "", materiales: materialesEscena }]} onReemplazar={reemplazarEnEscena}
              aviso={avisoColor} puedeDeshacer={historialColor.length > 0} onDeshacer={deshacerColor} />
          )}
          {modo === "escena" && armadaEscena ? (
            <PanelEscena escena={escenaEdit} onEscena={(e) => setEscenaEdit(e, { agrupar: "panel" })} armada={armadaEscena} seleccion={seleccion} onSeleccion={(id) => { setSeleccion(id); setCopiaTocada(null); }} enVivo={enVivo}
              onPreset={(id) => { setEscenaEdit(escenaPredefinida(id)); setSeleccion(null); setVueltaEncuadre((v) => v + 1); setAvisoColor(null); }} />
          ) : modo === "organico" ? (
            <PanelOrganico valor={ajustesOrganico} onCambio={setAjustesOrganico} />
          ) : modo === "pared" ? (
            <PanelPared tipo={tipoPared} onTipo={setTipoPared} valor={pared} onCambio={setPared} trenzas={paredTrenzas} onTrenzas={setParedTrenzas}
              verAnclas={verAnclasPared} onVerAnclas={setVerAnclasPared} anclas={paredActual.anclas.length} onCelebra={aplicarCelebra} />
          ) : modo === "decoracion" ? (
            <PanelDecoracion decoracion={decoracionEnEditor} onDecoracion={cambiarDecoracion} editando={elementoEditado ? editando : null} onEditando={setEditando}
              donde={donde} onDonde={setDonde} regla={regla} onRegla={setRegla} usarMezcla={usarMezcla} onUsarMezcla={setUsarMezcla}
              mezcla={mezcla} onMezcla={setMezcla} tipoPared={tipoPared} puestas={escenaDecoracion.porElemento} onCelebra={aplicarCelebra} />
          ) : (<>
          {modo === "modulo" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="mb-2 text-sm font-semibold text-texto">Módulo</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {MODULOS.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setModuloId(m.id); setRanura(null); }} aria-pressed={m.id === modulo.id}
                    className={`${BOTON} ${m.id === modulo.id ? ACTIVO : INACTIVO}`}>
                    {m.nombre} <span className="font-mono text-xs opacity-75">×{m.globos}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-suave">{modulo.armado}</p>
            </section>
          )}

          {modo === "arco" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="mb-2 text-sm font-semibold text-texto">Forma del arco</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {FORMAS_ARCO.map((f) => (
                  <button key={f.id} type="button" onClick={() => setForma(f.id)} aria-pressed={f.id === forma}
                    className={`${BOTON} ${f.id === forma ? ACTIVO : INACTIVO}`}>{f.nombre}</button>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-suave">{FORMAS_ARCO.find((f) => f.id === forma)?.descripcion}</p>
            </section>
          )}

          {(modo === "columna" || modo === "arco") && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="mb-2 text-sm font-semibold text-texto">Trenza de cuartetos</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {PATRONES_COLUMNA.map((p) => (
                  <button key={p.id} type="button" onClick={() => { setPatron(p.id); setRanura(null); }} aria-pressed={p.id === patron}
                    className={`${BOTON} ${p.id === patron ? ACTIVO : INACTIVO}`}>{p.nombre}</button>
                ))}
              </div>
              <p className="mt-2 text-xs text-texto-suave">{datosPatron.descripcion}</p>
              {modo === "columna" ? (
                <>
                  <label htmlFor="altura" className="mt-3 flex items-baseline justify-between text-sm font-semibold text-texto">
                    Altura <span className="font-mono text-xs font-normal text-texto-suave">{(alturaCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {columna.niveles} cuartetos</span>
                  </label>
                  <input id="altura" type="range" min={40} max={260} step={5} value={alturaCm} onChange={(e) => setAlturaCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
                </>
              ) : (
                <>
                  <label htmlFor="ancho-arco" className="mt-3 flex items-baseline justify-between text-sm font-semibold text-texto">
                    Ancho <span className="font-mono text-xs font-normal text-texto-suave">{(anchoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m</span>
                  </label>
                  <input id="ancho-arco" type="range" min={100} max={500} step={10} value={anchoArcoCm} onChange={(e) => setAnchoArcoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
                  <label htmlFor="alto-arco" className="mt-3 flex items-baseline justify-between text-sm font-semibold text-texto">
                    Alto <span className="font-mono text-xs font-normal text-texto-suave">{(altoArcoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m · {arco.niveles} cuartetos</span>
                  </label>
                  <input id="alto-arco" type="range" min={100} max={350} step={10} value={altoArcoCm} onChange={(e) => setAltoArcoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
                </>
              )}
              {datosPatron.colores > 1 && (
                <>
                  <p className="mb-2 mt-3 text-xs text-texto-suave">{ranura === null ? "Toca un color de abajo para toda la columna, o elige un puesto para cambiar solo ese." : `Elige el color ${ranura + 1}.`}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {Array.from({ length: datosPatron.colores }, (_, i) => {
                      const ref = colores.find((x) => x.codigo === coloresColumna[i]);
                      return (
                        <button key={i} type="button" onClick={() => setRanura(ranura === i ? null : i)} aria-pressed={ranura === i}
                          aria-label={`Color ${i + 1}: ${ref?.nombreCompleto ?? ""}`} title={`Color ${i + 1}: ${ref?.nombreCompleto ?? ""}`}
                          className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${ranura === i ? "ring-acento" : "ring-borde"}`}
                          style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
                      );
                    })}
                    {ranura !== null && <button type="button" onClick={() => setRanura(null)} className={`${BOTON} ${INACTIVO}`}>Toda la {modo === "arco" ? "estructura" : "columna"}</button>}
                  </div>
                </>
              )}
            </section>
          )}

          <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
            <h2 className="mb-2 text-sm font-semibold text-texto">{modo === "modulo" ? "Globo del módulo" : modo === "columna" || modo === "arco" ? "Globo de los cuartetos" : "Formato"}</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {formatosVisibles.map((f) => (
                <button key={f.id} type="button" onClick={() => elegirFormato(f)} aria-pressed={(modo !== "globo" || vista === "uno") && f.id === formato.id}
                  className={`${BOTON} ${(modo !== "globo" || vista === "uno") && f.id === formato.id ? ACTIVO : INACTIVO}`}>
                  {f.id}
                </button>
              ))}
            </div>
            {modo === "globo" && (
              <button type="button" onClick={() => setVista(vista === "todos" ? "uno" : "todos")} aria-pressed={vista === "todos"}
                className={`mt-2 inline-flex w-full items-center justify-center gap-2 ${BOTON} ${vista === "todos" ? ACTIVO : INACTIVO}`}>
                {vista === "todos" ? <Circle className="size-4" aria-hidden /> : <Rows3 className="size-4" aria-hidden />}
                {vista === "todos" ? "Ver un solo globo" : "Todos los tamaños lado a lado"}
              </button>
            )}
          </section>

          {(modo !== "globo" || vista === "uno") && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <label htmlFor="inflado" className="flex items-baseline justify-between text-sm font-semibold text-texto">
                Inflado <span className="font-mono text-xs font-normal text-texto-suave">{formatoCm(inflado)} de {formatoCm(formato.diametroMaxCm)} máx.</span>
              </label>
              <input id="inflado" type="range" min={Math.round(formato.diametroMaxCm * 0.4 * 10) / 10} max={formato.diametroMaxCm} step={0.5}
                value={inflado} onChange={(e) => setInfladoCm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-acento,#7c3aed)]" />
              <button type="button" onClick={() => setInfladoCm(formato.infladoDecoracionCm)} className="mt-1 text-xs text-acento underline-offset-2 hover:underline">
                Inflado de decoración ({formatoCm(formato.infladoDecoracionCm)})
              </button>
              {modo === "globo" && <p className="mt-2 text-xs text-texto-suave">{formato.descripcion}</p>}
            </section>
          )}

          {modo === "modulo" && (
            <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
              <h2 className="text-sm font-semibold text-texto">Color de cada globo</h2>
              <p className="mb-2 text-xs text-texto-suave">{ranura === null ? "Elige un color para todo el módulo, o toca un globo para cambiar solo ese." : `Elige el color del globo ${ranura + 1}.`}</p>
              <div className="flex flex-wrap items-center gap-2">
                {Array.from({ length: modulo.globos }, (_, i) => {
                  const ref = refModulo(i);
                  return (
                    <button key={i} type="button" onClick={() => setRanura(ranura === i ? null : i)} aria-pressed={ranura === i}
                      aria-label={`Globo ${i + 1}: ${ref?.nombreCompleto ?? ""}`} title={`Globo ${i + 1}: ${ref?.nombreCompleto ?? ""}`}
                      className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${ranura === i ? "ring-acento" : "ring-borde"}`}
                      style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
                  );
                })}
                {ranura !== null && <button type="button" onClick={() => setRanura(null)} className="text-xs text-acento underline-offset-2 hover:underline">Todo el módulo</button>}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-texto" htmlFor="ver-anclas">
                <input id="ver-anclas" type="checkbox" checked={verAnclas} onChange={(e) => setVerAnclas(e.target.checked)} />
                <Anchor className="size-4 text-acento" aria-hidden /> Ver anclas ({armado.anclas.length})
              </label>
              <p className="mt-1 text-xs text-texto-suave">Las anclas son los puntos donde se cuelga una decoración: el centro y los huecos entre globos.</p>
            </section>
          )}

          <section className="min-h-0 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
            <h2 className="mb-1 text-sm font-semibold text-texto">Color <span className="font-normal text-texto-suave">· {colores.length} en {formato.id}</span></h2>
            <div className="flex max-h-[42vh] flex-col gap-3 overflow-y-auto pr-1">
              {porFamilia.map(([familia, lista]) => (
                <div key={familia}>
                  <p className="mb-1 font-mono text-[0.7rem] uppercase tracking-wider text-texto-suave">{NOMBRE_FAMILIA[familia] ?? familia}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lista.map((c) => {
                      const marcado = modo === "columna" || modo === "arco"
                        ? (ranura === null ? coloresColumna.slice(0, datosPatron.colores).every((x) => x === c.codigo) : coloresColumna[ranura] === c.codigo)
                        : modo === "modulo" ? (ranura === null ? coloresModulo.slice(0, modulo.globos).every((x) => x === c.codigo) : seleccionado(ranura) === c.codigo) : c.codigo === color?.codigo;
                      return (
                        <button key={c.codigo} type="button" onClick={() => elegirColor(c.codigo)} aria-pressed={marcado}
                          title={`${c.nombreCompleto} ${c.codigo}`} aria-label={`${c.nombreCompleto} ${c.codigo}`}
                          className={`size-9 rounded-full ring-2 ring-offset-2 ring-offset-superficie ${marcado ? "ring-acento" : "ring-transparent hover:ring-borde"}`}
                          style={{ background: c.hexGlobo, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          </>)}
        </aside>
        </ArrastreDecoracionContexto.Provider>

        <section className="order-1 flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:order-2 lg:self-start" aria-label="Visor 3D">
          <div className="relative h-[58vh] min-h-[320px] overflow-hidden rounded-2xl bg-superficie-suave ring-1 ring-borde lg:h-[calc(100dvh-220px)]">
            <canvas ref={lienzoRef} className="block h-full w-full touch-none" aria-label="Modelo en 3D: arrastra para girar, rueda o pellizca para acercar" />
            {!listo && !error && <p className="absolute inset-0 grid place-items-center text-sm text-texto-suave">Cargando el visor 3D…</p>}
            {modo === "escena" && avisoLienzo && (
              <p role="status" className="pointer-events-none absolute bottom-3 left-3 right-3 mx-auto max-w-xl rounded-xl bg-superficie/95 px-3 py-2 text-center text-sm text-texto shadow-sm ring-1 ring-borde">{avisoLienzo}</p>
            )}
            {error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-texto">{error}</p>}
            {color && (
              <div className="pointer-events-none absolute left-3 top-3 max-w-[min(80%,34rem)] rounded-xl bg-superficie/90 px-3 py-2 text-sm shadow-sm ring-1 ring-borde backdrop-blur [&_.detalle-ficha]:hidden [&_ul]:hidden">
                {fichaVisor}
              </div>
            )}
          </div>
          {color && (
            <details className="rounded-2xl bg-superficie p-3 text-sm ring-1 ring-borde" open>
              <summary className="cursor-pointer font-semibold text-texto">Materiales y detalle</summary>
              <div className="mt-2">{fichaVisor}</div>
            </details>
          )}
          {listo && <GeneradorIA capturar={() => escenaRef.current?.capturar() ?? null} descripcion={descripcionIA} />}
          {modo === "escena" ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto-suave">
              <p className="min-w-0 flex-1">
                <b className="font-semibold text-texto">Clic en una pieza para elegirla</b> · arrástrala para moverla (imán 5 cm; Alt lo quita) · flechas 5 cm (Shift 25) · Q/E girar · RePág/AvPág altura · Supr quitar · Ctrl+D duplicar · Ctrl+Z deshacer · Esc soltar.
                Lo colgado de otra pieza no se arrastra: las flechas lo pasan de ancla. Arrastra el vacío para girar la cámara.
              </p>
              <div className="flex gap-1">
                <button type="button" onClick={historialEscena.deshacer} disabled={!historialEscena.puedeDeshacer} title="Deshacer (Ctrl+Z)" aria-label="Deshacer" className="grid size-9 place-items-center rounded-lg text-texto ring-1 ring-borde hover:bg-superficie-suave disabled:opacity-40"><Undo2 className="size-4" aria-hidden /></button>
                <button type="button" onClick={historialEscena.rehacer} disabled={!historialEscena.puedeRehacer} title="Rehacer (Ctrl+Y)" aria-label="Rehacer" className="grid size-9 place-items-center rounded-lg text-texto ring-1 ring-borde hover:bg-superficie-suave disabled:opacity-40"><Redo2 className="size-4" aria-hidden /></button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-texto-suave">Arrastra para girar · rueda o pellizca para acercar · medidas nominales del catálogo Sempertex; el color es el del globo inflado.</p>
          )}
        </section>
      </div>
    </main>
  );
}
