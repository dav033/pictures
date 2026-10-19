"use client";

import { memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as EventoPuntero, type RefObject } from "react";
import type { ItemBiblioteca, ResumenItem } from "@/lib/globos3d/biblioteca";
import { AnimatedList } from "@/components/ui/reactbits/AnimatedList";
import SpotlightCard from "@/components/ui/reactbits/SpotlightCard";
import { descripcionParaCliente } from "@/lib/globos3d/descripcion-ficha";
import { ArrastreDecoracionContexto, arrastreDeItem } from "./arrastre-decoracion";
import { Miniatura3d } from "./Biblioteca";

/**
 * La grilla compacta de la biblioteca en el panel «Añadir» (3 columnas, de a 24). La página de cada lista y el visor que dibuja las
 * miniaturas 3D (`useMiniaturas3d`) son de quien la usa: con varias grillas en el panel (las ideas del asistente y las demás) el
 * visor es UNO, con una sola cola y un solo contexto WebGL, sobre lo que muestran todas.
 */

/** De dónde viene, en corto, para la tarjeta compacta («Idea Sempertex #384», «Celebra», «Referencia web»). */
function fuenteCorta(item: ItemBiblioteca): string {
  const f = item.fuente;
  if (!f) return item.propio ? "Tu biblioteca" : "Del taller";
  if (f.tipo === "idea-sempertex") { const n = /#\s?(\d+)/.exec(f.titulo)?.[1]; return n ? `Idea Sempertex #${n}` : "Idea Sempertex"; }
  if (f.tipo === "celebra") return "Celebra";
  if (f.tipo === "referencia-web") return "Referencia web";
  if (f.tipo === "referencia-dueno") return "Referencia del dueño";
  return item.id.startsWith("vista:") ? "De tu escena" : item.propio ? "Tu biblioteca" : "Del taller";
}

const TarjetaCompacta = memo(function TarjetaCompacta({ item, resumen, mini, etiqueta, onAbrir }: { item: ItemBiblioteca; resumen: ResumenItem | undefined; mini: string | undefined; etiqueta: string | null; onAbrir: (item: ItemBiblioteca) => void }) {
  const sub = `${fuenteCorta(item)}${resumen ? ` · ${resumen.globos} globos` : ""}`;
  const descripcion = useMemo(() => (item.descripcion ? descripcionParaCliente(item.descripcion).replace(/\n/g, " ") : ""), [item.descripcion]);
  const arrastrar = useContext(ArrastreDecoracionContexto);
  const apretada = useRef<{ x: number; y: number } | null>(null);
  const arrastrable = Boolean(arrastrar) && item.tipo !== "escena";
  // Con ratón o lápiz se arrastra al visor (como las tarjetas de «Nuevas»); con el dedo se toca y se abre la ficha.
  const alApretar = (e: EventoPuntero<HTMLButtonElement>) => {
    apretada.current = { x: e.clientX, y: e.clientY };
    if (!arrastrar || !arrastrable || e.button !== 0 || e.pointerType === "touch") return;
    const arrastre = arrastreDeItem(item);
    if (!arrastre) return;
    e.preventDefault();
    arrastrar(arrastre, { x: e.clientX, y: e.clientY });
  };
  return (
    <button type="button" onPointerDown={alApretar}
        onClick={(e) => {
          const desde = apretada.current;
          apretada.current = null;
          // Lejos de donde se apretó: fue un arrastre al visor (ya la puso), no abre la ficha.
          if (desde && e.detail > 0 && Math.hypot(e.clientX - desde.x, e.clientY - desde.y) > 6) return;
          onAbrir(item);
        }}
        title={`${item.nombre}${descripcion ? ` — ${descripcion}` : ""}. ${arrastrable ? "Arrástrala al visor, o tócala para ver su ficha." : "Toca para ver su ficha y añadirla."}`}
        className={`flex h-full w-full select-none flex-col rounded-xl border border-taller-borde bg-taller-tarjeta text-left text-xs font-medium leading-snug text-taller-texto hover:border-taller-resalte ${arrastrable ? "cursor-grab active:cursor-grabbing" : ""}`}>
      <SpotlightCard theme="light" spotlightColor="#cba6f7" intensity={0.12} spotlightSize={180} borderGlow={0.25} proximity={70} flare={false} className="h-full w-full rounded-xl p-2 shadow-none"
        style={{ "--spotlight-card-surface": "var(--taller-tarjeta)", padding: "0.5rem", boxShadow: "none", borderRadius: "0.75rem" } as CSSProperties}>
        <div className="relative z-10 flex h-full w-full flex-col gap-1.5">
          <Miniatura3d item={item} url={mini} className="h-[72px] w-full rounded-lg" />
          <span className="line-clamp-2">{item.nombre}</span>
          <span className="truncate text-[11px] font-normal text-taller-suave">{sub}</span>
          {etiqueta && <span className="truncate text-[11px] font-normal text-taller-acento" title={`Celebración y temática: ${etiqueta}`}>{etiqueta}</span>}
        </div>
      </SpotlightCard>
    </button>
  );
}, (a, b) => a.resumen === b.resumen && a.mini === b.mini && a.etiqueta === b.etiqueta && a.onAbrir === b.onAbrir && a.item.id === b.item.id && a.item.nombre === b.item.nombre);

/** Tarjetas por página en el panel (24: abrir el panel no debe pintar cientos de tarjetas). */
const POR_PAGINA_PANEL = 24;

/** Lo que una grilla muestra ahora (`mostrados`), cuántas faltan y cómo traer otra página. */
export type PaginaCompacta = { mostrados: readonly ItemBiblioteca[]; restantes: number; mas: () => void };

/** La página de una lista de a 24. Otra búsqueda u otro filtro (otra lista que no empieza igual) vuelve a la primera. */
export function usePaginaCompacta(visibles: readonly ItemBiblioteca[]): PaginaCompacta {
  const [pagina, setPagina] = useState<{ de: readonly ItemBiblioteca[]; cuantos: number }>({ de: visibles, cuantos: POR_PAGINA_PANEL });
  const cuantos = pagina.de === visibles || (pagina.de.length <= visibles.length && pagina.de[0]?.id === visibles[0]?.id) ? pagina.cuantos : POR_PAGINA_PANEL;
  const mas = () => setPagina({ de: visibles, cuantos: cuantos + POR_PAGINA_PANEL });
  const mostrados = useMemo(() => visibles.slice(0, cuantos), [visibles, cuantos]);
  return { mostrados, restantes: visibles.length - mostrados.length, mas };
}

type PropiedadesDeLaGrilla = {
  pagina: PaginaCompacta; resumenes: ReadonlyMap<string, ResumenItem>; huellas: ReadonlyMap<string, string>;
  /** Las miniaturas ya dibujadas por huella (`useMiniaturas3d`, una sola vez para todas las grillas del panel). */
  minis: ReadonlyMap<string, string>;
  onAbrir: (item: ItemBiblioteca) => void; vacio: string;
  /** La celebración y temática principales de un item para su tarjeta (`null` si no tiene o aún no carga). */
  etiquetaDe?: (id: string) => string | null;
};

/** Una lista de la biblioteca en el panel «Añadir»: 3 columnas, la página que le toca y «Mostrar más» (que también se activa al llegar a la vista). */
export function GrillaCompacta({ pagina, resumenes, huellas, minis, onAbrir, vacio, etiquetaDe }: PropiedadesDeLaGrilla) {
  const { mostrados, restantes, mas } = pagina;
  const hayMas = restantes > 0;
  const finRef = useRef<HTMLLIElement>(null);
  const masRef = useRef(mas);
  useEffect(() => { masRef.current = mas; });
  useEffect(() => {
    const fin = finRef.current;
    if (!fin || !hayMas) return;
    const observador = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) masRef.current(); }, { rootMargin: "300px" });
    observador.observe(fin);
    return () => observador.disconnect();
  }, [hayMas, mostrados.length]);
  if (mostrados.length === 0) return <p className="px-1 text-xs text-taller-suave">{vacio}</p>;
  return (
    <AnimatedList items={mostrados} getKey={(i) => i.id} getItemAttributes={(i) => ({ "data-item-id": i.id })} className="grid grid-cols-3 gap-2"
      renderItem={(i) => <TarjetaCompacta item={i} resumen={resumenes.get(i.id)} mini={minis.get(huellas.get(i.id) ?? "")} etiqueta={etiquetaDe?.(i.id) ?? null} onAbrir={onAbrir} />}
      footer={hayMas ? (
        <li ref={finRef} className="col-span-full flex justify-center">
          <button type="button" onClick={mas} className="min-h-9 rounded-lg px-3 text-xs text-taller-acento hover:bg-taller-encima">Mostrar más ({restantes})</button>
        </li>
      ) : null} />
  );
}

/** El lienzo oculto en que `useMiniaturas3d` dibuja las miniaturas: uno solo por panel. */
export function LienzoDeMiniaturas({ lienzoRef }: { lienzoRef: RefObject<HTMLCanvasElement | null> }) {
  return <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 h-[240px] w-[320px]"><canvas ref={lienzoRef} className="block h-full w-full" /></div>;
}
