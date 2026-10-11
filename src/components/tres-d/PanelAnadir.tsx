"use client";

import { memo, useCallback, useContext, useMemo, useRef, useState, type PointerEvent as EventoPuntero, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { conteosPorRepositorio, eleccionVigente, itemsDelRepositorio, nombresDeRepositorios, opcionesDelSelector, procedenciasDeRepositorios, vistaDeAnadir, visiblesParaAnadir, type EleccionAnadir, type VistaAnadir } from "@/lib/catalogo/anadir-repositorios";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import { TIPOS_ITEM, type ItemBiblioteca, type TipoItem } from "@/lib/globos3d/biblioteca";
import { miniaturaDecoracion } from "@/lib/globos3d/decoraciones-escena";
import { DecoracionesPequenas, MiniaturaDecoracion, contarDecoraciones } from "./DecoracionesPequenas";
import { UtileriaFiesta, contarUtileria } from "./UtileriaFiesta";
import { FondosYMuebles, contarFondosYMuebles } from "./FondosYMuebles";
import { MuralesTechoArboles } from "./MuralesTechoArboles";
import { FormasYLetras } from "./FormasYLetras";
import { FILTRO_COMPACTO_VACIO, FiltrosCompactos, GrillaCompacta, useBibliotecaFiltrada, type FiltroCompacto } from "./Biblioteca";
import { FiltrosTaxonomia } from "./FiltrosTaxonomia";
import { BuscarPorFoto, useSoltarFoto } from "./BuscarPorFoto";
import { useRefinarBiblioteca } from "./useRefinarBiblioteca";
import { useRepositoriosCatalogo } from "./useRepositoriosCatalogo";
import { SelectorRepositorio } from "./SelectorRepositorio";
import { BotonVoz } from "../voz/BotonVoz";
import { ArrastreDecoracionContexto } from "./arrastre-decoracion";
import { DibujoGlobo, FORMATOS_SUELTOS, NUEVAS_DECORACIONES, NUEVAS_ESTRUCTURAS, globoSuelto, type PiezaParaAnadir } from "./nuevas-taller";
import { MINI, SEG, SEG_ON, TARJETA, coincide } from "./ui-taller";

export type PestanaAnadir = "estructuras" | "decoraciones" | "utileria" | "ideas";

const PESTANAS: ReadonlyArray<{ id: PestanaAnadir; nombre: string; tipos: readonly TipoItem[]; vacio: string }> = [
  { id: "estructuras", nombre: "Estructuras", tipos: ["conjunto", "estructura"], vacio: "Ninguna estructura de la biblioteca coincide." },
  { id: "decoraciones", nombre: "Decoraciones", tipos: ["decoracion"], vacio: "Ninguna decoración de la biblioteca coincide." },
  { id: "utileria", nombre: "Utilería", tipos: ["utileria"], vacio: "Ninguna utilería de la biblioteca coincide." },
  { id: "ideas", nombre: "Ideas", tipos: ["escena"], vacio: "Ninguna idea coincide." },
];

/** Sin pestañas (Mobiliario y Escenografía), lo guardado por el usuario se busca en todos los tipos. */
const TODOS_LOS_TIPOS: readonly TipoItem[] = TIPOS_ITEM.map((t) => t.id);
/** Lo de siempre: la interfaz por repositorio apagada (la marcha atrás) o sin leer todavía. */
const VISTA_DE_SIEMPRE: VistaAnadir = { sempertex: true, fondos: ["mobiliario", "escenografia"], fondosEnUtileria: true };

type Props = {
  escena: Escena;
  armada: EscenaArmada;
  onEscena: (e: Escena) => void;
  seleccion: string | null;
  onSeleccion: (id: string | null) => void;
  pestana: PestanaAnadir;
  onPestana: (p: PestanaAnadir) => void;
  /** Tocar una tarjeta de «Nuevas» (o un globo suelto): entra a la escena y se abre su editor solitario. */
  onNueva: (p: PiezaParaAnadir) => void;
  /** Tocar una tarjeta de la biblioteca: su ficha (vista 3D, productos, añadir). */
  onFicha: (item: ItemBiblioteca) => void;
  /** El repositorio elegido (REQ-013, `useEstadoAnadir`): solo cuenta con la interfaz por repositorio encendida. */
  eleccion: EleccionAnadir;
  onEleccion: (e: EleccionAnadir) => void;
  /** En la hoja del teléfono (sin el título del panel). */
  enHoja?: boolean;
};

/** Una tarjeta de «Nuevas»: con el ratón se arrastra al visor (lugares en verde); al tocarla, se abre su editor. */
const TarjetaNueva = memo(function TarjetaNueva({ nombre, sub, descripcion, dibujo, crear, onNueva }: {
  nombre: string; sub: string; descripcion: string; dibujo: ReactNode; crear: () => PiezaParaAnadir; onNueva: (p: PiezaParaAnadir) => void;
}) {
  const arrastrar = useContext(ArrastreDecoracionContexto);
  const apretada = useRef<{ x: number; y: number; tactil: boolean } | null>(null);
  const alApretar = (e: EventoPuntero<HTMLButtonElement>) => {
    apretada.current = { x: e.clientX, y: e.clientY, tactil: e.pointerType === "touch" };
    // Con el dedo se toca (arrastrar movería la lista); con ratón o lápiz, se arrastra al visor.
    if (!arrastrar || e.button !== 0 || e.pointerType === "touch") return;
    e.preventDefault();
    const p = crear();
    arrastrar(p.pieza.tipo === "decoracion" ? { decoracion: p.pieza.decoracion, nombre: p.nombre, idBase: p.idBase } : { pieza: p.pieza, nombre: p.nombre, idBase: p.idBase }, { x: e.clientX, y: e.clientY });
  };
  return (
    <button type="button" onPointerDown={alApretar} title={`${descripcion} Tócala para ajustarla sola, o arrástrala al visor.`}
      onClick={(e) => {
        const desde = apretada.current;
        apretada.current = null;
        // Un clic lejos de donde se apretó fue un arrastre al visor (ya la puso): no abre el editor. Con el dedo no hay arrastre (se toca), y el
        // navegador mueve el clic de un toque unos píxeles (ajuste táctil): esa distancia no cuenta.
        if (desde && !desde.tactil && e.detail > 0 && Math.hypot(e.clientX - desde.x, e.clientY - desde.y) > 6) return;
        onNueva(crear());
      }}
      className={`${TARJETA} cursor-grab select-none active:cursor-grabbing`}>
      <span className={MINI} aria-hidden>{dibujo}</span>
      <span>{nombre}<span className="block text-[11px] font-normal text-taller-suave">{sub}</span></span>
    </button>
  );
});

/** Las decoraciones ajustables (una por tipo), con su dibujo (se arma una vez). */
const DECORACIONES_NUEVAS = () => NUEVAS_DECORACIONES.map((d) => {
  const p = d.crear();
  return { ...d, miniatura: p.pieza.tipo === "decoracion" ? miniaturaDecoracion(p.pieza.decoracion) : null };
});

/**
 * Panel «Añadir a la escena»: un buscador para todo y cuatro pestañas (Estructuras, Decoraciones, Utilería, Ideas).
 * Arriba «Nuevas · ajustables» (cada una abre su editor solitario: el generador de su tipo); luego lo armado (decoraciones
 * pequeñas, murales, formas y letras, utilería, globos sueltos) y la biblioteca con sus filtros y su ficha.
 */
export const PanelAnadir = memo(function PanelAnadir({ escena, armada, onEscena, seleccion, onSeleccion, pestana, onPestana, eleccion: eleccionPedida, onEleccion, onNueva, onFicha, enHoja = false }: Props) {
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<FiltroCompacto>(FILTRO_COMPACTO_VACIO);
  const repositorios = useRepositoriosCatalogo();
  const visibles = useMemo(() => visiblesParaAnadir(repositorios), [repositorios]);
  const eleccion = visibles ? eleccionVigente(eleccionPedida, visibles) : "todos";
  const vista = visibles ? vistaDeAnadir(eleccion, visibles) : VISTA_DE_SIEMPRE;
  const nombres = useMemo(() => nombresDeRepositorios(repositorios), [repositorios]);
  const procedencias = useMemo(() => (visibles ? procedenciasDeRepositorios(repositorios) : undefined), [visibles, repositorios]);
  const datos = PESTANAS.find((p) => p.id === pestana) ?? PESTANAS[0]!;
  const tipos = vista.sempertex ? datos.tipos : TODOS_LOS_TIPOS;
  const biblio = useBibliotecaFiltrada(tipos, texto, vista.sempertex ? filtro : FILTRO_COMPACTO_VACIO);
  const refinada = useRefinarBiblioteca(biblio.deTipo, biblio.visibles, datos.tipos);
  const soltar = useSoltarFoto(refinada.foto.buscar, vista.sempertex);
  const delRepositorio = useMemo(() => itemsDelRepositorio(vista.sempertex ? refinada.refinados : biblio.visibles, eleccion, visibles ?? undefined), [vista.sempertex, refinada.refinados, biblio.visibles, eleccion, visibles]);
  const conteos = useMemo(() => (visibles ? conteosPorRepositorio(biblio.items) : null), [visibles, biblio.items]);
  const [cuentaMurales, setCuentaMurales] = useState(0);
  const [cuentaFormas, setCuentaFormas] = useState(0);
  const decoracionesNuevas = useMemo(() => (pestana === "decoraciones" ? DECORACIONES_NUEVAS() : []), [pestana]);
  const nuevas = NUEVAS_ESTRUCTURAS.filter((n) => coincide(texto, n.nombre, n.sub, n.descripcion));
  const decosNuevas = decoracionesNuevas.filter((d) => coincide(texto, d.nombre, d.descripcion));
  const globos = FORMATOS_SUELTOS.filter((f) => coincide(texto, f.id, f.nombre, "globo suelto"));
  const cuentaDeLaPestana = pestana === "estructuras" ? nuevas.length + cuentaMurales + cuentaFormas
    : pestana === "decoraciones" ? decosNuevas.length + globos.length + contarDecoraciones(texto)
      : pestana === "utileria" ? contarUtileria(texto) : 0;
  const cuenta = delRepositorio.length + (vista.sempertex ? cuentaDeLaPestana : vista.fondos.reduce((n, repositorio) => n + contarFondosYMuebles(texto, repositorio), 0));
  const nombreDeLaVista = eleccion === "todos" ? vista.fondos.map((r) => nombres[r]).join(" y ") : nombres[eleccion];
  const alCuentaMurales = useCallback((n: number) => setCuentaMurales(n), []);
  const alCuentaFormas = useCallback((n: number) => setCuentaFormas(n), []);

  return (
    <div {...soltar.propiedades} className={`flex min-h-0 flex-1 flex-col ${soltar.arrastrando ? "outline outline-2 -outline-offset-2 outline-dashed outline-taller-resalte" : ""}`}>
      <div className="flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-4 [&>*]:shrink-0">
        {!enHoja && <h2 className="text-[15px] font-semibold">Añadir a la escena</h2>}
        <div className="flex h-[38px] items-center gap-2 rounded-[10px] border border-taller-solitario-borde bg-taller-tarjeta px-3 focus-within:border-taller-resalte">
          <Search className="size-[18px] shrink-0 text-taller-suave" aria-hidden />
          <label htmlFor="anadir-buscar" className="sr-only">Buscar en todo</label>
          <input id="anadir-buscar" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar: columna, flor, dorado…" autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-taller-texto outline-none placeholder:text-taller-suave [&::-webkit-search-cancel-button]:hidden" />
          <BotonVoz campoId="anadir-buscar" alTexto={setTexto} variante="taller" ventana="abajo" clase="grid size-6 place-items-center rounded text-taller-suave hover:text-taller-texto disabled:opacity-45" />
          {texto && <button type="button" onClick={() => setTexto("")} aria-label="Borrar la búsqueda" className="grid size-6 place-items-center rounded text-taller-suave hover:text-taller-texto"><X className="size-3.5" aria-hidden /></button>}
          <span className="font-mono text-[11px] text-taller-suave" aria-live="polite" aria-label={`${cuenta} resultados`}>{cuenta}</span>
        </div>
        {visibles && conteos && visibles.length > 1 && <SelectorRepositorio opciones={opcionesDelSelector(visibles)} eleccion={eleccion} onElegir={onEleccion} nombres={nombres} conteos={conteos} />}
        {vista.sempertex && (
          <>
            <div role="tablist" aria-label="Qué añadir" className="flex gap-1 rounded-[10px] bg-taller-barra p-[3px]">
              {PESTANAS.map((p) => (
                <button key={p.id} type="button" role="tab" id={`anadir-tab-${p.id}`} aria-selected={pestana === p.id} aria-controls="anadir-contenido" onClick={() => onPestana(p.id)}
                  className={`${SEG} flex-1 ${pestana === p.id ? SEG_ON : ""}`}>{p.nombre}</button>
              ))}
            </div>
            <FiltrosCompactos filtro={filtro} onFiltro={setFiltro} ocasiones={biblio.ocasiones} colores={biblio.colores} productos={biblio.productos} />
            <FiltrosTaxonomia filtro={refinada.taxonomia} onFiltro={refinada.onTaxonomia} conteos={refinada.conteos} cargando={refinada.cargandoClasificacion} />
            <BuscarPorFoto estado={refinada.foto.estado} cuantos={refinada.refinados.length} onFoto={refinada.foto.buscar} onQuitar={refinada.foto.limpiar} />
          </>
        )}
      </div>

      <div id="anadir-contenido" role={vista.sempertex ? "tabpanel" : "region"} aria-labelledby={vista.sempertex ? `anadir-tab-${pestana}` : undefined} aria-label={vista.sempertex ? undefined : "Añadir por repositorio"}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
        {vista.sempertex && eleccion === "sempertex" && procedencias?.sempertex && <p className="text-xs leading-snug text-taller-suave" data-testid="procedencia-repositorio">{procedencias.sempertex}</p>}
        {vista.sempertex && pestana === "estructuras" && (
          <>
            {nuevas.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Nuevas y ajustables">
                <h3 className="taller-rotulo">Nuevas · ajustables</h3>
                <div className="grid grid-cols-3 gap-2">
                  {nuevas.map((n) => <TarjetaNueva key={n.id} nombre={n.nombre} sub={n.sub} descripcion={n.descripcion} dibujo={n.dibujo()} crear={n.crear} onNueva={onNueva} />)}
                </div>
              </section>
            )}
            <MuralesTechoArboles escena={escena} onEscena={onEscena} onSeleccion={onSeleccion} filtro={texto} onCuenta={alCuentaMurales} />
            <FormasYLetras escena={escena} onEscena={onEscena} onSeleccion={onSeleccion} filtro={texto} onCuenta={alCuentaFormas} />
          </>
        )}
        {vista.sempertex && pestana === "decoraciones" && (
          <>
            {decosNuevas.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Decoraciones nuevas y ajustables">
                <h3 className="taller-rotulo">Nuevas · ajustables</h3>
                <div className="grid grid-cols-3 gap-2">
                  {decosNuevas.map((d) => (
                    <TarjetaNueva key={d.tipo} nombre={d.nombre} sub="ajustable" descripcion={d.descripcion} crear={d.crear} onNueva={onNueva}
                      dibujo={d.miniatura ? <MiniaturaDecoracion miniatura={d.miniatura} nombre={d.nombre} className="size-14" /> : null} />
                  ))}
                </div>
              </section>
            )}
            <DecoracionesPequenas escena={escena} onEscena={onEscena} armada={armada} seleccion={seleccion} onSeleccion={onSeleccion} filtro={texto} />
            {globos.length > 0 && (
              <section className="flex flex-col gap-2" aria-label="Globos sueltos">
                <h3 className="taller-rotulo">Globos sueltos <span className="font-normal normal-case tracking-normal">· cada globo a su tamaño real</span></h3>
                <div className="grid grid-cols-3 gap-2">
                  {globos.map((f) => {
                    const p = globoSuelto(f);
                    return <TarjetaNueva key={f.id} nombre={f.id} sub={f.nombre} descripcion={f.descripcion} crear={() => globoSuelto(f)} onNueva={onNueva}
                      dibujo={<DibujoGlobo formato={f} codigo={p.pieza.tipo === "globo" ? p.pieza.codigo : "009"} />} />;
                  })}
                </div>
              </section>
            )}
          </>
        )}
        {vista.sempertex && pestana === "utileria" && (
          <>
            {vista.fondosEnUtileria && vista.fondos.length > 0 && (
              <FondosYMuebles escena={escena} onEscena={onEscena} onSeleccion={onSeleccion} filtro={texto} repositorio={vista.fondos.length === 1 ? vista.fondos[0] : undefined} procedencias={procedencias} />
            )}
            <UtileriaFiesta escena={escena} onEscena={onEscena} armada={armada} seleccion={seleccion} onSeleccion={onSeleccion} filtro={texto} />
          </>
        )}

        {!vista.sempertex && vista.fondos.map((repositorio) => (
          <FondosYMuebles key={repositorio} escena={escena} onEscena={onEscena} onSeleccion={onSeleccion} filtro={texto} repositorio={repositorio} procedencias={procedencias} />
        ))}

        <section className="flex flex-col gap-2" aria-label="De la biblioteca">
          <h3 className="taller-rotulo flex items-baseline justify-between gap-2">
            <span>{!vista.sempertex ? "De tu biblioteca" : pestana === "ideas" ? "Ideas y escenas" : "De la biblioteca"}</span>
            <span className="font-normal normal-case tracking-normal">{biblio.contando ? "contando…" : !vista.sempertex ? `${delRepositorio.length}` : pestana === "estructuras" ? "con sus decoraciones" : pestana === "ideas" ? "con su enlace y foto" : `${delRepositorio.length}`}</span>
          </h3>
          <GrillaCompacta visibles={delRepositorio} resumenes={biblio.resumenes} huellas={biblio.huellas} onAbrir={onFicha} etiquetaDe={refinada.etiquetaDe}
            vacio={!vista.sempertex ? (texto ? `Nada de ${nombreDeLaVista} en tu biblioteca coincide con la búsqueda.` : `Todavía no guardas nada de ${nombreDeLaVista} en tu biblioteca.`)
              : refinada.conFoto ? "Ningún parecido a tu foto en esta pestaña." : datos.vacio} />
        </section>
        <p className="text-xs leading-snug text-taller-suave">Arrastra una tarjeta al visor: se marca en verde dónde puede ir. O tócala y elige dónde.</p>
      </div>
    </div>
  );
});
