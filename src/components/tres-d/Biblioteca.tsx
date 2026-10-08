"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft, BookmarkPlus, Box, ClipboardCopy, ExternalLink, Eye, Library, Plus, Replace, Search, Trash2 } from "lucide-react";
import {
  BIBLIOTECA_FABRICA, OCASIONES, TIPOS_ITEM, clasePieza, contenidoDeEscena, escenaDeItem, filtrarBiblioteca, huellaItem, indexarEscena, itemDeEscena, itemDeNodo, nombreGenerico,
  productosDe, resumenDe, unirBiblioteca, validarItem, type FiltroBiblioteca, type ItemBiblioteca, type ProductosDeItem, type ResumenItem, type TipoItem,
} from "@/lib/globos3d/biblioteca";
import { armarEscena, type Escena, type EscenaArmada } from "@/lib/globos3d/escena";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { hexDeCodigo, miniaturaDecoracion, type Miniatura } from "@/lib/globos3d/decoraciones-escena";
import { urlTienda } from "@/lib/globos3d/utileria-catalogo";
import { REVISADO_TIENDA } from "@/lib/globos3d/productos-tienda";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { MiniaturaDecoracion } from "./DecoracionesPequenas";
import { ACTIVO, BOTON, INACTIVO } from "./PanelFlor";
import { mostrarArmada } from "./armada-visor";
import type { EscenaGlobos } from "./escena-globos";

/**
 * Pestaña **Biblioteca** de /3d: todo lo reutilizable del taller, cada cosa por separado (escenas, estructuras con sus
 * decoraciones, estructuras, decoraciones y utilería), con filtros y una ficha con la vista 3D, la lista exacta de
 * productos (globos con su producto de la tienda, utilería y, aparte, la escenografía) y de dónde viene. Lo de fábrica
 * sale del código (`biblioteca.ts`); lo que guarda el usuario vive en su navegador (biblioteca propia).
 */

// ----------------------------------------------------------------------------------------------------------
// Biblioteca propia (localStorage)
// ----------------------------------------------------------------------------------------------------------

const CLAVE_PROPIA = "taller3d:biblioteca-propia:v1";
const EVENTO_PROPIA = "taller3d:biblioteca-propia";
const SIN_PROPIOS: readonly ItemBiblioteca[] = [];
let lecturaPropia: { crudo: string | null; items: readonly ItemBiblioteca[] } = { crudo: null, items: SIN_PROPIOS };

function leerCrudo(): string | null {
  try { return window.localStorage.getItem(CLAVE_PROPIA); } catch { return null; }
}

/** Lo guardado, validado (lo que no cuadra se descarta). La misma lista mientras no cambie lo guardado. */
function propiosGuardados(): readonly ItemBiblioteca[] {
  const crudo = leerCrudo();
  if (crudo === lecturaPropia.crudo) return lecturaPropia.items;
  let items: ItemBiblioteca[] = [];
  try {
    const datos: unknown = crudo ? JSON.parse(crudo) : [];
    items = Array.isArray(datos) ? datos.map(validarItem).filter((x): x is ItemBiblioteca => x !== null) : [];
  } catch { items = []; }
  lecturaPropia = { crudo, items };
  return items;
}

function escribirPropios(items: readonly ItemBiblioteca[]): boolean {
  try {
    window.localStorage.setItem(CLAVE_PROPIA, JSON.stringify(items));
    window.dispatchEvent(new Event(EVENTO_PROPIA));
    return true;
  } catch { return false; }
}

/** Guarda un item en la biblioteca propia (si ya hay uno con ese id, lo reemplaza). `false` si el navegador no dejó. */
export function guardarPropio(item: ItemBiblioteca): boolean {
  return escribirPropios([...propiosGuardados().filter((i) => i.id !== item.id), { ...item, propio: true }]);
}

function quitarPropio(id: string): boolean {
  return escribirPropios(propiosGuardados().filter((i) => i.id !== id));
}

function suscribirPropios(aviso: () => void) {
  const alCambiar = (e: Event) => { if (!(e instanceof StorageEvent) || e.key === CLAVE_PROPIA) aviso(); };
  window.addEventListener(EVENTO_PROPIA, alCambiar);
  window.addEventListener("storage", alCambiar);
  return () => { window.removeEventListener(EVENTO_PROPIA, alCambiar); window.removeEventListener("storage", alCambiar); };
}

export function useBibliotecaPropia(): readonly ItemBiblioteca[] {
  return useSyncExternalStore(suscribirPropios, propiosGuardados, () => SIN_PROPIOS);
}

/** Un id nuevo para lo propio: «propio:<base>-<n>» que no choca con lo guardado. */
function idPropio(base: string): string {
  const usados = new Set(propiosGuardados().map((i) => i.id));
  const limpio = base.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
  for (let k = 1; ; k++) if (!usados.has(`propio:${limpio}-${k}`)) return `propio:${limpio}-${k}`;
}

// ----------------------------------------------------------------------------------------------------------
// Índice y resúmenes (se calculan de a poco, sin trabar la página)
// ----------------------------------------------------------------------------------------------------------

/** Lo de fábrica más lo propio, con lo que sale de indexar cada escena (una escena por vuelta). */
function useBiblioteca(propios: readonly ItemBiblioteca[], cache: Map<string, PiezaArmada>) {
  const base = useMemo(() => [...BIBLIOTECA_FABRICA, ...propios], [propios]);
  const escenas = useMemo(() => base.filter((i) => i.contenido.tipo === "escena"), [base]);
  const [indices, setIndices] = useState<ReadonlyMap<string, ItemBiblioteca[]>>(() => new Map());
  const pendiente = escenas.find((e) => !indices.has(e.id));
  useEffect(() => {
    if (!pendiente) return;
    const t = setTimeout(() => {
      let derivados: ItemBiblioteca[] = [];
      try { derivados = indexarEscena(pendiente, undefined, cache); } catch (causa) { console.error("[biblioteca] no se pudo indexar", pendiente.id, causa); }
      setIndices((m) => new Map(m).set(pendiente.id, derivados));
    }, 20);
    return () => clearTimeout(t);
  }, [pendiente, cache]);
  const items = useMemo(() => unirBiblioteca(base, indices), [base, indices]);
  return { items, indexadas: escenas.filter((e) => indices.has(e.id)).length, escenas: escenas.length };
}

/** Globos, colores y productos de cada item (para la tarjeta y los filtros), de a varios por vuelta. */
function useResumenes(items: readonly ItemBiblioteca[], cache: Map<string, PiezaArmada>) {
  const [porHuella, setPorHuella] = useState<ReadonlyMap<string, ResumenItem>>(() => new Map());
  const huellas = useMemo(() => new Map(items.map((i) => [i.id, huellaItem(i)])), [items]);
  const faltan = useMemo(() => items.filter((i) => !porHuella.has(huellas.get(i.id)!)), [items, porHuella, huellas]);
  useEffect(() => {
    if (!faltan.length) return;
    const t = setTimeout(() => {
      const nuevos = new Map<string, ResumenItem>();
      const inicio = performance.now();
      for (const item of faltan) {
        try { nuevos.set(huellas.get(item.id)!, resumenDe(item, armarEscena(escenaDeItem(item), cache))); }
        catch { nuevos.set(huellas.get(item.id)!, { globos: 0, colores: [], productos: [], piezas: 0 }); }
        if (performance.now() - inicio > 40) break;
      }
      setPorHuella((m) => { const salida = new Map(m); for (const [k, v] of nuevos) salida.set(k, v); return salida; });
    }, 15);
    return () => clearTimeout(t);
  }, [faltan, huellas, cache]);
  const porId = useMemo(() => {
    const salida = new Map<string, ResumenItem>();
    for (const i of items) { const r = porHuella.get(huellas.get(i.id)!); if (r) salida.set(i.id, r); }
    return salida;
  }, [items, porHuella, huellas]);
  return { resumenes: porId, listos: porId.size };
}

// ----------------------------------------------------------------------------------------------------------
// Miniaturas 3D (renderizadas una vez en un lienzo oculto y guardadas en la sesión)
// ----------------------------------------------------------------------------------------------------------

const CLAVE_MINI = "taller3d:mini2:";
const ANCHO_MINI = 480, ALTO_MINI = 360;

function miniGuardada(huella: string): string | null {
  try { return window.sessionStorage.getItem(CLAVE_MINI + huella); } catch { return null; }
}

/** Las decoraciones (las de globos) tienen su dibujo SVG; lo demás se renderiza en 3D. */
function miniaturaSvg(item: ItemBiblioteca): Miniatura | null {
  const c = item.contenido;
  if (c.tipo !== "pieza" || c.pieza.tipo !== "decoracion") return null;
  try { return miniaturaDecoracion(c.pieza.decoracion); } catch { return null; }
}

const esperarCuadro = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Renderiza en 3D las miniaturas que faltan, de una en una y en el orden en que se ven, con su propio visor en un lienzo
 * oculto (se cierra al terminar). Cada una se guarda en sessionStorage por la huella de su contenido.
 */
function useMiniaturas3d(orden: readonly ItemBiblioteca[], cache: Map<string, PiezaArmada>) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const visorRef = useRef<EscenaGlobos | null>(null);
  /** Una miniatura a la vez: el visor oculto es uno solo (la siguiente espera a que termine la anterior). */
  const colaRef = useRef<Promise<void>>(Promise.resolve());
  const [minis, setMinis] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [fallidas, setFallidas] = useState<ReadonlySet<string>>(() => new Set());
  const porHuella = useMemo(() => new Map(orden.filter((i) => !miniaturaSvg(i)).map((i) => [huellaItem(i), i])), [orden]);
  const porHuellaRef = useRef(porHuella);
  useEffect(() => { porHuellaRef.current = porHuella; }, [porHuella]);
  // Por la huella (texto), no por el objeto: la lista se rehace al indexar y el item sería otro objeto igual.
  const pendiente = useMemo(() => [...porHuella.keys()].find((h) => !minis.has(h) && !fallidas.has(h)) ?? null, [porHuella, minis, fallidas]);
  useEffect(() => {
    if (!pendiente) {
      // Sin nada que dibujar: el visor oculto se cierra (no gasta la tarjeta gráfica).
      const t = setTimeout(() => { colaRef.current = colaRef.current.then(() => { visorRef.current?.destruir(); visorRef.current = null; }); }, 1500);
      return () => clearTimeout(t);
    }
    const huella = pendiente;
    let vivo = true;
    const dibujar = async () => {
      const item = porHuellaRef.current.get(huella);
      if (!vivo || !item) return;
      const guardada = miniGuardada(huella);
      if (guardada) { setMinis((m) => new Map(m).set(huella, guardada)); return; }
      const lienzo = lienzoRef.current;
      if (!lienzo) return;
      try {
        if (!visorRef.current) {
          const { crearEscena } = await import("./escena-globos");
          visorRef.current = crearEscena(lienzo);
        }
        if (!vivo) return;
        mostrarArmada(visorRef.current, armarEscena(escenaDeItem(item), cache));
        await esperarCuadro();
        await esperarCuadro();
        // Justo después de que el visor dibuja (mismo cuadro): el lienzo todavía tiene la imagen.
        const datos = await new Promise<string>((r) => requestAnimationFrame(() => {
          const salida = document.createElement("canvas");
          salida.width = ANCHO_MINI;
          salida.height = ALTO_MINI;
          const pincel = salida.getContext("2d");
          if (!pincel) { r(""); return; }
          pincel.fillStyle = "#efedf2";
          pincel.fillRect(0, 0, ANCHO_MINI, ALTO_MINI);
          pincel.drawImage(lienzo, 0, 0, ANCHO_MINI, ALTO_MINI);
          r(salida.toDataURL("image/jpeg", 0.72));
        }));
        if (!datos) throw new Error("sin lienzo 2D");
        try { window.sessionStorage.setItem(CLAVE_MINI + huella, datos); } catch { /* sesión llena: queda en memoria */ }
        setMinis((m) => new Map(m).set(huella, datos));
      } catch (causa) {
        console.error("[biblioteca] miniatura", item.id, causa);
        setFallidas((f) => new Set(f).add(huella));
      }
    };
    const t = setTimeout(() => { colaRef.current = colaRef.current.then(dibujar); }, 30);
    return () => { vivo = false; clearTimeout(t); };
  }, [pendiente, cache]);
  useEffect(() => () => { visorRef.current?.destruir(); visorRef.current = null; }, []);
  return { lienzoRef, minis };
}

// ----------------------------------------------------------------------------------------------------------
// Piezas de la interfaz
// ----------------------------------------------------------------------------------------------------------

const NOMBRE_TIPO = new Map(TIPOS_ITEM.map((t) => [t.id, t.nombre]));
const TARJETA = "rounded-2xl bg-superficie ring-1 ring-borde";
const ETIQUETA = "rounded-full bg-superficie-suave px-2 py-0.5 text-[0.7rem] text-texto-suave ring-1 ring-borde";
const SELECT = "min-h-10 min-w-0 rounded-xl bg-superficie px-2 text-sm text-texto ring-1 ring-borde";

const nombreColor = (codigo: string) => `${referenciaPorCodigo(codigo)?.nombreCompleto ?? codigo} ${codigo}`;
const nombreProducto = (clave: string) => { const [f, c] = clave.split("|"); return `${f} ${nombreColor(c ?? "")}`; };

function Chips({ colores, max = 8 }: { colores: readonly string[]; max?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={`Colores: ${colores.map(nombreColor).join(", ")}`}>
      {colores.slice(0, max).map((c) => <span key={c} title={nombreColor(c)} className="size-4 rounded-full ring-1 ring-black/15" style={{ background: hexDeCodigo(c) }} />)}
      {colores.length > max && <span className="text-[0.7rem] text-texto-suave">+{colores.length - max}</span>}
    </span>
  );
}

function Miniatura3d({ item, url, className = "" }: { item: ItemBiblioteca; url: string | undefined; className?: string }) {
  const svg = useMemo(() => miniaturaSvg(item), [item]);
  if (svg) return <div className={`grid place-items-center bg-[#efedf2] p-3 ${className}`}><MiniaturaDecoracion miniatura={svg} nombre={item.nombre} className="h-full max-h-full w-full" /></div>;
  if (url) return <div role="img" aria-label={`Vista 3D de ${item.nombre}`} className={`bg-[#efedf2] bg-cover bg-center ${className}`} style={{ backgroundImage: `url(${url})` }} />;
  return <div className={`grid place-items-center bg-[#efedf2] text-xs text-texto-suave ${className}`}><Box className="size-6 animate-pulse opacity-50" aria-hidden /><span className="sr-only">Dibujando…</span></div>;
}

function Fuente({ item, corta = false }: { item: ItemBiblioteca; corta?: boolean }) {
  const f = item.fuente;
  if (!f) return null;
  const tipo = f.tipo === "idea-sempertex" ? "Idea de sempertex.com" : f.tipo === "celebra" ? "Revista Celebra" : item.id.startsWith("vista:") ? "De tu escena" : item.propio ? "Tu biblioteca" : "Del taller";
  if (corta) return <span className="truncate text-[0.7rem] text-texto-suave" title={f.titulo}>{tipo}{f.tipo !== "propio" ? ` · ${f.titulo}` : ""}</span>;
  return (
    <span className="text-sm text-texto">
      <b className="font-semibold">{tipo}</b> · {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-acento">{f.titulo} <ExternalLink className="inline size-3" aria-hidden /></a> : f.titulo}
      {f.fotoUrl && <> · <a href={f.fotoUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-acento">ver la foto original</a></>}
    </span>
  );
}

function TarjetaItem({ item, resumen, mini, onAbrir }: { item: ItemBiblioteca; resumen: ResumenItem | undefined; mini: string | undefined; onAbrir: () => void }) {
  return (
    <li>
      <button type="button" onClick={onAbrir} className={`${TARJETA} flex h-full w-full flex-col overflow-hidden text-left transition hover:ring-2 hover:ring-acento focus-visible:ring-2 focus-visible:ring-acento`}>
        <Miniatura3d item={item} url={mini} className="aspect-[4/3] w-full" />
        <span className="flex min-w-0 flex-1 flex-col gap-1 p-2">
          <span className="line-clamp-2 text-sm font-semibold text-texto">{item.nombre}</span>
          <span className="flex flex-wrap gap-1">
            <span className={`${ETIQUETA} text-texto`}>{NOMBRE_TIPO.get(item.tipo)}</span>
            {item.ocasiones.filter((o) => o !== "general").slice(0, 2).map((o) => <span key={o} className={ETIQUETA}>{o}</span>)}
            {item.propio && <span className={`${ETIQUETA} text-acento`}>propio</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[0.7rem] text-texto-suave">{resumen ? `${resumen.globos} ${resumen.globos === 1 ? "globo" : "globos"}` : "…"}</span>
            {resumen && <Chips colores={resumen.colores} max={6} />}
          </span>
          <Fuente item={item} corta />
        </span>
      </button>
    </li>
  );
}

/** La lista de compra en texto (para copiarla y pegarla en un pedido). */
function listaEnTexto(item: ItemBiblioteca, p: ProductosDeItem): string {
  const lineas = [`${item.nombre} — productos`, "", "GLOBOS"];
  for (const g of p.globos) lineas.push(`${g.cantidad} × ${g.nombreOficial} — ${g.producto.nombre}${g.producto.estado === "verificado" ? ` — ${g.producto.url}` : " (sin verificar)"}`);
  if (p.utileria.length) { lineas.push("", "UTILERÍA"); for (const u of p.utileria) lineas.push(`${u.cantidad} × ${u.nombre}${u.variante ? ` (${u.variante})` : ""}${u.url ? ` — ${urlTienda(u.url)}` : ""}`); }
  if (p.escenografia.length) { lineas.push("", "ESCENOGRAFÍA (no es producto de la tienda)"); for (const e of p.escenografia) lineas.push(`${e.cantidad} × ${e.nombre}`); }
  return lineas.join("\n");
}

function TablaProductos({ item, productos }: { item: ItemBiblioteca; productos: ProductosDeItem }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(listaEnTexto(item, productos)); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { setCopiado(false); }
  };
  const th = "px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-texto-suave";
  const td = "px-2 py-1.5 align-top";
  return (
    <section className={`${TARJETA} flex flex-col gap-3 p-3`} aria-label="Productos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-texto">Productos</h3>
        <button type="button" onClick={copiar} className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-3 text-xs`}><ClipboardCopy className="size-3.5" aria-hidden />{copiado ? "Lista copiada" : "Copiar la lista"}</button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-texto">Globos <span className="font-normal text-texto-suave">· {productos.totalGlobos} en total</span></h4>
        {productos.globos.length === 0 ? <p className="text-xs text-texto-suave">No lleva globos.</p> : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead><tr className="border-b border-borde"><th className={th}>Cantidad</th><th className={th}>Globo (formato, color, código)</th><th className={th}>Producto en la tienda</th></tr></thead>
              <tbody>
                {productos.globos.map((g) => (
                  <tr key={`${g.formatoId}|${g.codigo}`} className="border-b border-borde/60">
                    <td className={`${td} font-mono font-semibold text-texto`}>{g.cantidad}{g.porLargo ? <span className="block text-[0.65rem] font-normal text-texto-suave">por largo</span> : null}</td>
                    <td className={td}>
                      <span className="flex items-center gap-2 text-texto"><span className="size-4 shrink-0 rounded-full ring-1 ring-black/15" style={{ background: hexDeCodigo(g.codigo) }} aria-hidden /><b className="font-semibold">{g.nombreOficial}</b></span>
                      <span className="block text-[0.7rem] text-texto-suave">{g.formato}</span>
                    </td>
                    <td className={td}>
                      <a href={g.producto.url} target="_blank" rel="noreferrer" className="text-texto underline decoration-dotted underline-offset-2 hover:text-acento">{g.producto.nombre}</a>
                      <span className="block text-[0.7rem] text-texto-suave">
                        {g.producto.estado === "verificado"
                          ? (g.producto.tallaEnTienda ? `Talla ${g.formatoId} en la tienda` : `Sin la talla ${g.formatoId} en la tienda`)
                          : "Sin verificar: no está en el listado de la tienda (enlace a la búsqueda)"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-[0.7rem] text-texto-suave">La tienda vende cada color por paquetes; la talla es una variante del producto. Productos cruzados con la tienda el {REVISADO_TIENDA}. Los tubitos se cuentan por largo (~137 cm útiles cada uno).</p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-texto">Utilería de fiesta</h4>
        {productos.utileria.length === 0 ? <p className="text-xs text-texto-suave">No lleva utilería.</p> : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead><tr className="border-b border-borde"><th className={th}>Cantidad</th><th className={th}>Producto</th><th className={th}>En la escena</th></tr></thead>
              <tbody>
                {productos.utileria.map((u) => (
                  <tr key={`${u.url}|${u.nombre}|${u.variante ?? ""}`} className="border-b border-borde/60">
                    <td className={`${td} font-mono font-semibold text-texto`}>{u.cantidad}</td>
                    <td className={td}>
                      {u.generico ? <span className="text-texto-suave">{u.nombre}</span> : <a href={urlTienda(u.url)} target="_blank" rel="noreferrer" className="text-texto underline decoration-dotted underline-offset-2 hover:text-acento">{u.nombre}</a>}
                      {u.variante && <span className="text-texto-suave"> · {u.variante}</span>}
                    </td>
                    <td className={`${td} text-xs text-texto-suave`}>{u.piezas.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {productos.escenografia.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-texto">Escenografía <span className="font-normal text-texto-suave">· no es producto de la tienda</span></h4>
          <ul className="mt-1 text-sm text-texto">
            {productos.escenografia.map((e) => (
              <li key={`${e.clase}|${e.nombre}`}>{e.cantidad} × {e.nombre} <span className="text-[0.7rem] text-texto-suave">({e.clase === "papel" ? "papel" : e.clase === "follaje" ? "follaje artificial" : "escenografía"})</span></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** El visor 3D de la ficha: su propio lienzo y su propia escena. */
function Vista3d({ armada }: { armada: EscenaArmada }) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const visorRef = useRef<EscenaGlobos | null>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    let vivo = true;
    let observador: ResizeObserver | null = null;
    void import("./escena-globos").then(({ crearEscena }) => {
      if (!vivo || !lienzoRef.current) return;
      const visor = crearEscena(lienzoRef.current);
      visorRef.current = visor;
      observador = new ResizeObserver(() => visor.redimensionar());
      observador.observe(lienzoRef.current);
      setListo(true);
    });
    return () => { vivo = false; observador?.disconnect(); visorRef.current?.destruir(); visorRef.current = null; };
  }, []);
  useEffect(() => { if (listo && visorRef.current) mostrarArmada(visorRef.current, armada); }, [listo, armada]);
  return (
    <div className="relative h-[46vh] min-h-[300px] overflow-hidden rounded-2xl bg-superficie-suave ring-1 ring-borde">
      <canvas ref={lienzoRef} className="block h-full w-full touch-none" aria-label="Vista 3D: arrastra para girar, rueda o pellizca para acercar" />
      {!listo && <p className="absolute inset-0 grid place-items-center text-sm text-texto-suave">Cargando la vista 3D…</p>}
    </div>
  );
}

type Acciones = { onAbrirEnEscena: (item: ItemBiblioteca) => void; onAnadir: (item: ItemBiblioteca) => void };

function Ficha({ item, biblioteca, cache, minis, onVer, onVolver, acciones, puedeVolver }: {
  item: ItemBiblioteca; biblioteca: readonly ItemBiblioteca[]; cache: Map<string, PiezaArmada>; minis: ReadonlyMap<string, string>;
  onVer: (item: ItemBiblioteca) => void; onVolver: () => void; acciones: Acciones; puedeVolver: boolean;
}) {
  const armada = useMemo(() => armarEscena(escenaDeItem(item), cache), [item, cache]);
  const productos = useMemo(() => productosDe(item, armada), [item, armada]);
  const resumen = useMemo(() => resumenDe(item, armada), [item, armada]);
  const contenido = useMemo(() => (item.tipo === "escena" ? contenidoDeEscena(biblioteca, item.id) : []), [item, biblioteca]);
  /** Las decoraciones de un conjunto, juntas por nombre («14 × Ojo con venas»). */
  const armado = useMemo(() => {
    const cuenta = new Map<string, number>();
    if (item.contenido.tipo === "conjunto") for (const h of item.contenido.conjunto.hijos) cuenta.set(nombreGenerico(h.nombre), (cuenta.get(nombreGenerico(h.nombre)) ?? 0) + 1);
    return [...cuenta.entries()];
  }, [item]);
  const escenas = (item.apareceEn ?? []).map((o) => ({ origen: o, escena: biblioteca.find((i) => i.id === o.itemId) })).filter((x) => x.escena);
  const [quitado, setQuitado] = useState(false);
  const grupo = (tipos: TipoItem[]) => contenido.filter((i) => tipos.includes(i.tipo));
  /** Cuántas veces está en esta escena (un conjunto cuenta sus piezas: no se dice). */
  const veces = (i: ItemBiblioteca) => (i.tipo === "conjunto" ? 1 : i.apareceEn?.find((o) => o.itemId === item.id)?.nodoIds.length ?? 0);
  const lista = (titulo: string, items: ItemBiblioteca[], verTexto: string) => items.length === 0 ? null : (
    <div>
      <h4 className="text-sm font-semibold text-texto">{titulo} <span className="font-normal text-texto-suave">· {items.length}</span></h4>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 rounded-xl p-1 ring-1 ring-borde">
            <Miniatura3d item={i} url={minis.get(huellaItem(i))} className="size-12 shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-texto">{i.nombre}{veces(i) > 1 && <span className="text-texto-suave"> · {veces(i)} veces</span>}</span>
              <span className="block truncate text-[0.7rem] text-texto-suave">{NOMBRE_TIPO.get(i.tipo)}{i.derivado ? "" : " · también en la biblioteca"}</span>
            </span>
            <button type="button" onClick={() => onVer(i)} className={`${BOTON} ${INACTIVO} inline-flex shrink-0 items-center gap-1 px-2 text-xs`}><Eye className="size-3.5" aria-hidden />{verTexto}</button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <article className="flex flex-col gap-3" aria-label={`Ficha de ${item.nombre}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onVolver} className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-3`}><ArrowLeft className="size-4" aria-hidden />{puedeVolver ? "Volver" : "Volver a la biblioteca"}</button>
        <span className={`${ETIQUETA} text-texto`}>{NOMBRE_TIPO.get(item.tipo)}</span>
        {item.ocasiones.map((o) => <span key={o} className={ETIQUETA}>{o}</span>)}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Vista3d armada={armada} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => acciones.onAbrirEnEscena(item)} title="Reemplaza la escena de la pestaña Escena (allí Ctrl+Z la recupera)" className={`${BOTON} ${ACTIVO} inline-flex items-center gap-1.5 px-4`}><Replace className="size-4" aria-hidden />Abrir en Escena</button>
            <button type="button" onClick={() => acciones.onAnadir(item)} title="La añade a la escena que tienes, donde estaba en la suya" className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-4`}><Plus className="size-4" aria-hidden />Añadir a mi escena</button>
            {item.propio && (
              <button type="button" onClick={() => { if (quitarPropio(item.id)) { setQuitado(true); onVolver(); } }} disabled={quitado} className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-3`}><Trash2 className="size-4" aria-hidden />Quitar de mi biblioteca</button>
            )}
          </div>
          <p className="text-xs text-texto-suave">«Abrir en Escena» reemplaza la escena actual (en la pestaña Escena, Ctrl+Z la recupera). «Añadir a mi escena» la suma a la que tienes, con su armado: la estructura y sus decoraciones juntas.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <header>
            <h2 className="text-xl font-semibold text-texto">{item.nombre}</h2>
            {item.descripcion && <p className="mt-1 text-sm text-texto-suave">{item.descripcion}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-texto">
              <span className="font-mono">{resumen.globos} globos</span>
              {item.tipo !== "decoracion" && item.tipo !== "utileria" && <span className="font-mono">{resumen.piezas} {resumen.piezas === 1 ? "pieza" : "piezas"}</span>}
              <Chips colores={resumen.colores} max={14} />
            </p>
          </header>
          <section className={`${TARJETA} flex flex-col gap-1 p-3`} aria-label="De dónde viene">
            <h3 className="text-sm font-semibold text-texto">De dónde viene</h3>
            <Fuente item={item} />
            {escenas.length > 0 && (
              <p className="text-sm text-texto">Está en {escenas.map(({ origen, escena }, k) => (
                <span key={origen.itemId}>{k > 0 ? ", " : ""}<button type="button" onClick={() => onVer(escena!)} className="underline decoration-dotted underline-offset-2 hover:text-acento">{origen.nombre}</button>{origen.nodoIds.length > 1 && item.tipo !== "conjunto" ? ` (${origen.nodoIds.length} veces)` : ""}</span>
              ))}.</p>
            )}
          </section>
          {item.tipo === "escena" && (
            <section className={`${TARJETA} flex flex-col gap-3 p-3`} aria-label="Lo que contiene">
              <h3 className="text-sm font-semibold text-texto">Lo que contiene</h3>
              {contenido.length === 0 && <p className="text-xs text-texto-suave">Buscando sus estructuras y decoraciones…</p>}
              {lista("Estructuras", grupo(["conjunto", "estructura"]), "Ver esta estructura sola con sus decoraciones")}
              {lista("Decoraciones", grupo(["decoracion"]), "Ver esta decoración sola")}
              {lista("Utilería", grupo(["utileria"]), "Ver sola")}
            </section>
          )}
          {item.tipo === "conjunto" && item.contenido.tipo === "conjunto" && (
            <section className={`${TARJETA} flex flex-col gap-1 p-3`} aria-label="Armado">
              <h3 className="text-sm font-semibold text-texto">Armado</h3>
              <p className="text-sm text-texto"><b className="font-semibold">{item.contenido.conjunto.raiz.nombre}</b> con:</p>
              <ul className="list-disc pl-5 text-sm text-texto-suave">
                {armado.map(([n, k]) => <li key={n}>{k > 1 ? `${k} × ` : ""}{n}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
      <TablaProductos item={item} productos={productos} />
    </article>
  );
}

// ----------------------------------------------------------------------------------------------------------
// La pestaña
// ----------------------------------------------------------------------------------------------------------

type Props = {
  /** La escena de la pestaña Escena (para decir a qué se añade). */
  escenaActual: Escena;
  /** Reemplaza la escena de la pestaña Escena con la de este item. */
  onAbrirEnEscena: (escena: Escena) => void;
  /** Añade el item a la escena actual, con su armado. */
  onAnadirAEscena: (item: ItemBiblioteca) => void;
  /** Un item para abrir su ficha al entrar (lo que se pidió ver desde la pestaña Escena). */
  abrir?: ItemBiblioteca | null;
};

const FILTRO_VACIO: FiltroBiblioteca = { tipo: null, ocasion: null, color: null, producto: null, texto: "" };

export function Biblioteca({ escenaActual, onAbrirEnEscena, onAnadirAEscena, abrir = null }: Props) {
  const [cache] = useState(() => new Map<string, PiezaArmada>());
  const propios = useBibliotecaPropia();
  const { items, indexadas, escenas } = useBiblioteca(propios, cache);
  const { resumenes, listos } = useResumenes(items, cache);
  const [filtro, setFiltro] = useState<FiltroBiblioteca>(FILTRO_VACIO);
  const [pila, setPila] = useState<ItemBiblioteca[]>(() => (abrir ? [abrir] : []));
  const visibles = useMemo(() => filtrarBiblioteca(items, resumenes, filtro), [items, resumenes, filtro]);
  const { lienzoRef, minis } = useMiniaturas3d(visibles, cache);
  const abierto = pila[pila.length - 1] ?? null;

  const porTipo = useMemo(() => new Map(TIPOS_ITEM.map((t) => [t.id, items.filter((i) => i.tipo === t.id).length])), [items]);
  const ocasiones = useMemo(() => OCASIONES.filter((o) => items.some((i) => i.ocasiones.includes(o))), [items]);
  const { colores, productos } = useMemo(() => {
    const c = new Map<string, number>(), p = new Map<string, number>();
    for (const r of resumenes.values()) { for (const x of r.colores) c.set(x, (c.get(x) ?? 0) + 1); for (const x of r.productos) p.set(x, (p.get(x) ?? 0) + 1); }
    const porNombre = (a: string, b: string) => a.localeCompare(b, "es");
    return {
      colores: [...c.entries()].sort((a, b) => porNombre(nombreColor(a[0]), nombreColor(b[0]))),
      productos: [...p.entries()].sort((a, b) => porNombre(nombreProducto(a[0]), nombreProducto(b[0]))),
    };
  }, [resumenes]);
  const poner = (cambio: Partial<FiltroBiblioteca>) => setFiltro((f) => ({ ...f, ...cambio }));
  const hayFiltro = Boolean(filtro.tipo || filtro.ocasion || filtro.color || filtro.producto || filtro.texto?.trim());
  const acciones: Acciones = {
    onAbrirEnEscena: (item) => onAbrirEnEscena(escenaDeItem(item)),
    onAnadir: (item) => onAnadirAEscena(item),
  };

  const contenido: ReactNode = abierto ? (
    <Ficha key={`${pila.length}:${abierto.id}`} item={abierto} biblioteca={items} cache={cache} minis={minis} acciones={acciones} puedeVolver={pila.length > 1}
      onVer={(i) => setPila((p) => [...p, i])} onVolver={() => setPila((p) => p.slice(0, -1))} />
  ) : (
    <>
      <section className={`${TARJETA} flex flex-col gap-2 p-3`} aria-label="Buscar en la biblioteca">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Tipo">
          <button type="button" onClick={() => poner({ tipo: null })} aria-pressed={!filtro.tipo} className={`${BOTON} ${!filtro.tipo ? ACTIVO : INACTIVO} px-3`}>Todo <span className="font-mono text-xs opacity-75">{items.length}</span></button>
          {TIPOS_ITEM.map((t) => (
            <button key={t.id} type="button" onClick={() => poner({ tipo: filtro.tipo === t.id ? null : t.id })} aria-pressed={filtro.tipo === t.id} className={`${BOTON} ${filtro.tipo === t.id ? ACTIVO : INACTIVO} px-3`}>
              {t.plural} <span className="font-mono text-xs opacity-75">{porTipo.get(t.id) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-4 text-texto-suave" aria-hidden />
            <input type="search" value={filtro.texto ?? ""} onChange={(e) => poner({ texto: e.target.value })} placeholder="Buscar: araña, columna, dorado…" aria-label="Buscar por texto" className={`${SELECT} w-full pl-8`} />
          </label>
          <select value={filtro.ocasion ?? ""} onChange={(e) => poner({ ocasion: e.target.value || null })} aria-label="Ocasión" className={SELECT}>
            <option value="">Cualquier ocasión</option>
            {ocasiones.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={filtro.color ?? ""} onChange={(e) => poner({ color: e.target.value || null })} aria-label="Color" className={SELECT}>
            <option value="">Cualquier color</option>
            {colores.map(([c, n]) => <option key={c} value={c}>{nombreColor(c)} ({n})</option>)}
          </select>
          <select value={filtro.producto ?? ""} onChange={(e) => poner({ producto: e.target.value || null })} aria-label="Producto (globo)" className={SELECT}>
            <option value="">Usa cualquier globo</option>
            {productos.map(([p, n]) => <option key={p} value={p}>Usa {nombreProducto(p)} ({n})</option>)}
          </select>
        </div>
        <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-texto-suave" aria-live="polite">
          <span>
            {visibles.length} de {items.length}
            {indexadas < escenas ? ` · buscando estructuras y decoraciones dentro de las escenas (${indexadas} de ${escenas})…` : ""}
            {listos < items.length ? ` · contando globos (${listos} de ${items.length})…` : ""}
          </span>
          {hayFiltro && <button type="button" onClick={() => setFiltro(FILTRO_VACIO)} className="text-acento underline-offset-2 hover:underline">Quitar filtros</button>}
        </p>
      </section>
      {visibles.length === 0 ? (
        <p className="rounded-2xl bg-superficie-suave p-6 text-center text-sm text-texto-suave ring-1 ring-borde">Nada con esos filtros.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visibles.map((i) => <TarjetaItem key={i.id} item={i} resumen={resumenes.get(i.id)} mini={minis.get(huellaItem(i))} onAbrir={() => setPila([i])} />)}
        </ul>
      )}
    </>
  );

  return (
    <section className="flex flex-col gap-3" aria-label="Biblioteca">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-texto"><Library className="size-5 text-acento" aria-hidden />Biblioteca</h2>
          <p className="text-sm text-texto-suave">Escenas, estructuras con sus decoraciones, estructuras, decoraciones y utilería, cada una con su lista exacta de productos. Tu escena actual tiene {escenaActual.nodos.length} {escenaActual.nodos.length === 1 ? "pieza" : "piezas"}.</p>
        </div>
        {propios.length > 0 && <span className={ETIQUETA}>{propios.length} en tu biblioteca</span>}
      </header>
      {contenido}
      {/* El lienzo oculto donde se dibujan las miniaturas 3D (fuera de la pantalla, con tamaño). */}
      <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 h-[240px] w-[320px]"><canvas ref={lienzoRef} className="block h-full w-full" /></div>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------------
// En la pestaña Escena: con una pieza elegida, verla sola o guardarla
// ----------------------------------------------------------------------------------------------------------

/**
 * Lo de la biblioteca para la pieza elegida de la pestaña Escena: «Ver sola con sus decoraciones» (abre su ficha en la
 * Biblioteca) y «Guardar en la biblioteca» (en la propia, con nombre y ocasión). También guardar la escena entera.
 */
export function AccionesPieza({ escena, armada, nodoId, onVer }: { escena: Escena; armada: EscenaArmada; nodoId: string; onVer: (item: ItemBiblioteca) => void }) {
  const nodo = escena.nodos.find((n) => n.id === nodoId);
  const [abierto, setAbierto] = useState<"pieza" | "escena" | null>(null);
  const [nombre, setNombre] = useState("");
  const [ocasion, setOcasion] = useState("general");
  const [aviso, setAviso] = useState<string | null>(null);
  if (!nodo) return null;
  const clase = clasePieza(nodo.pieza);
  if (clase === "escenografia") return null;
  const temporal = () => itemDeNodo(escena, nodoId, { id: `vista:${nodoId}`, armada });
  const guardar = () => {
    const nombreFinal = nombre.trim() || (abierto === "escena" ? "Mi escena" : nodo.nombre);
    const item = abierto === "escena"
      ? { ...itemDeEscena({ id: idPropio(nombreFinal), nombre: nombreFinal, ocasiones: [ocasion], fuente: { tipo: "propio", titulo: "Guardado desde la pestaña Escena" }, escena }), propio: true }
      : itemDeNodo(escena, nodoId, { id: idPropio(nombreFinal), nombre: nombreFinal, ocasiones: [ocasion], armada });
    if (!item) { setAviso("Esta pieza no se puede guardar sola."); return; }
    setAviso(guardarPropio(item) ? `Guardado en tu biblioteca: «${nombreFinal}» (${NOMBRE_TIPO.get(item.tipo)?.toLowerCase()}).` : "Tu navegador no dejó guardarlo (almacenamiento lleno o bloqueado).");
    setAbierto(null);
  };
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde" aria-label="Biblioteca">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-texto"><Library className="size-4 text-acento" aria-hidden />Biblioteca</h2>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" onClick={() => { const i = temporal(); if (i) onVer({ ...i, propio: false, fuente: { tipo: "propio", titulo: "sin guardar (para guardarla, «Guardar en la biblioteca»)" } }); }} className={`${BOTON} ${INACTIVO} inline-flex items-center justify-center gap-1.5 text-xs`}>
          <Eye className="size-3.5" aria-hidden />{clase === "estructura" ? "Ver sola con sus decoraciones" : "Ver sola"}
        </button>
        <button type="button" onClick={() => { setAbierto(abierto === "pieza" ? null : "pieza"); setNombre(nodo.nombre); setAviso(null); }} aria-expanded={abierto === "pieza"} className={`${BOTON} ${abierto === "pieza" ? ACTIVO : INACTIVO} inline-flex items-center justify-center gap-1.5 text-xs`}>
          <BookmarkPlus className="size-3.5" aria-hidden />Guardar en la biblioteca
        </button>
      </div>
      <button type="button" onClick={() => { setAbierto(abierto === "escena" ? null : "escena"); setNombre(""); setAviso(null); }} aria-expanded={abierto === "escena"} className="self-start text-xs text-acento underline-offset-2 hover:underline">
        Guardar toda la escena en la biblioteca
      </button>
      {abierto && (
        <div className="flex flex-col gap-2 rounded-xl bg-superficie-suave p-2 ring-1 ring-borde">
          <p className="text-[0.7rem] text-texto-suave">{abierto === "escena" ? `La escena entera (${escena.nodos.length} piezas).` : clase === "estructura" ? "La estructura con todo lo que cuelga de ella y lo pegado a sus globos." : "La pieza sola."}</p>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto">Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={abierto === "escena" ? "Mi escena" : nodo.nombre} className="min-h-10 rounded-lg bg-superficie px-2 text-sm font-normal text-texto ring-1 ring-borde" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto">Ocasión
            <select value={ocasion} onChange={(e) => setOcasion(e.target.value)} className={SELECT}>{OCASIONES.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          </label>
          <button type="button" onClick={guardar} className={`${BOTON} ${ACTIVO}`}>Guardar</button>
        </div>
      )}
      {aviso && <p role="status" className="text-xs text-texto">{aviso}</p>}
    </section>
  );
}
