"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, BookmarkPlus, Box, ClipboardCopy, ExternalLink, Eye, Plus, Replace, Trash2 } from "lucide-react";
import {
  BIBLIOTECA_FABRICA, OCASIONES, TIPOS_ITEM, clasePieza, contenidoDeEscena, copiarItem, escenaDeItem, filtrarBiblioteca, huellaConId, itemDeEscena, itemDeNodo, nombreGenerico,
  unirBiblioteca, validarItem, type ItemBiblioteca, type ProductosDeItem, type ResumenItem, type TipoItem,
} from "@/lib/globos3d/biblioteca";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import { hexDeCodigo, miniaturaDecoracion, type Miniatura } from "@/lib/globos3d/decoraciones-escena";
import { urlTienda } from "@/lib/globos3d/utileria-catalogo";
import { REVISADO_TIENDA } from "@/lib/globos3d/productos-tienda";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { MiniaturaDecoracion } from "./DecoracionesPequenas";
import { ACTIVO, BOTON, INACTIVO } from "./PanelFlor";
import { mostrarArmada } from "./armada-visor";
import type { EscenaGlobos } from "./escena-globos";
import { armarEnMotor, useMotorBiblioteca, type Armado } from "./biblioteca-cliente";

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

/**
 * Lo de fábrica más lo propio, con lo que sale de indexar cada escena, sus resúmenes (globos, colores, productos) y
 * sus huellas (para las miniaturas). Todo lo que arma lo hace el motor fuera de la página (`biblioteca-cliente.ts`):
 * aquí no se toca el contenido de nada. La grilla sale enseguida con lo fijo (nombre, tipo, ocasiones, foto) y se
 * completa (sin repetidos, con lo de cada escena) a medida que el motor avanza.
 */
export function useBiblioteca(propios: readonly ItemBiblioteca[]) {
  const motor = useMotorBiblioteca(propios);
  const base = useMemo(() => [...BIBLIOTECA_FABRICA, ...propios], [propios]);
  // Mientras el motor no ha firmado un item, su firma es única (no se junta con nada todavía).
  const items = useMemo(() => unirBiblioteca(base, motor.indices, (i) => motor.hechos.get(i.id)?.firma ?? `pendiente:${i.id}`), [base, motor.indices, motor.hechos]);
  const { resumenes, huellas } = useMemo(() => {
    const r = new Map<string, ResumenItem>(), h = new Map<string, string>();
    for (const i of items) {
      const hecho = motor.hechos.get(i.id);
      if (hecho) { r.set(i.id, hecho.resumen); h.set(i.id, huellaConId(i.id, hecho.huella)); }
    }
    return { resumenes: r, huellas: h };
  }, [items, motor.hechos]);
  return { items, resumenes, huellas, listos: resumenes.size, indexadas: motor.escenasHechas, escenas: motor.escenas };
}

// ----------------------------------------------------------------------------------------------------------
// Miniaturas 3D (renderizadas una vez en un lienzo oculto y guardadas en la sesión)
// ----------------------------------------------------------------------------------------------------------

const CLAVE_MINI = "taller3d:mini2:";
const ANCHO_MINI = 480, ALTO_MINI = 360;

function miniGuardada(huella: string): string | null {
  try { return window.sessionStorage.getItem(CLAVE_MINI + huella); } catch { return null; }
}

/**
 * Las decoraciones (las de globos) tienen su dibujo SVG; lo demás se renderiza en 3D. Solo se mira el contenido de las
 * decoraciones (piezas chicas): el de una escena de fábrica es perezoso y armarlo aquí trabaría la página.
 */
function miniaturaSvg(item: ItemBiblioteca): Miniatura | null {
  if (item.tipo !== "decoracion") return null;
  const c = item.contenido;
  if (c.tipo !== "pieza" || c.pieza.tipo !== "decoracion") return null;
  try { return miniaturaDecoracion(c.pieza.decoracion); } catch { return null; }
}

const esperarCuadro = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Renderiza en 3D las miniaturas que faltan, de una en una y en el orden en que se ven, con su propio visor en un lienzo
 * oculto (se cierra al terminar). Cada una se guarda en sessionStorage por la huella de su contenido. Lo arma el motor
 * (fuera de la página); aquí solo se dibuja. Sin huella todavía (el motor no llegó a ese item), espera.
 */
export function useMiniaturas3d(orden: readonly ItemBiblioteca[], huellas: ReadonlyMap<string, string>) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const visorRef = useRef<EscenaGlobos | null>(null);
  /** Una miniatura a la vez: el visor oculto es uno solo (la siguiente espera a que termine la anterior). */
  const colaRef = useRef<Promise<void>>(Promise.resolve());
  const [minis, setMinis] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [fallidas, setFallidas] = useState<ReadonlySet<string>>(() => new Set());
  const porHuella = useMemo(() => new Map(orden.flatMap((i) => {
    const huella = huellas.get(i.id);
    return huella && !miniaturaSvg(i) ? [[huella, i] as const] : [];
  })), [orden, huellas]);
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
        const hecho = await armarEnMotor(item, false);
        if ("error" in hecho) throw new Error(hecho.error);
        if (!vivo || !visorRef.current) return;
        mostrarArmada(visorRef.current, hecho.armada);
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
          // El visor dibuja solo cuando algo cambia: se dibuja aquí mismo para que el lienzo tenga la imagen.
          visorRef.current?.dibujar();
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
  }, [pendiente]);
  useEffect(() => () => { visorRef.current?.destruir(); visorRef.current = null; }, []);
  return { lienzoRef, minis };
}

// ----------------------------------------------------------------------------------------------------------
// Piezas de la interfaz
// ----------------------------------------------------------------------------------------------------------

export const NOMBRE_TIPO_ITEM = new Map(TIPOS_ITEM.map((t) => [t.id, t.nombre]));
const TARJETA = "rounded-2xl bg-superficie ring-1 ring-borde";
const ETIQUETA = "rounded-full bg-superficie-suave px-2 py-0.5 text-[0.7rem] text-texto-suave ring-1 ring-borde";
/** 44 px de alto y, en el teléfono, letra de 16 px (si no, iOS acerca la página al tocar el campo). */
const SELECT = "min-h-11 min-w-0 rounded-xl bg-superficie px-2 text-base text-texto ring-1 ring-borde sm:text-sm";

const nombreColor = (codigo: string) => `${referenciaPorCodigo(codigo)?.nombreCompleto ?? codigo} ${codigo}`;
const nombreProducto = (clave: string) => { const [f, c] = clave.split("|"); return `${f} ${nombreColor(c ?? "")}`; };

export function Chips({ colores, max = 8 }: { colores: readonly string[]; max?: number }) {
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={`Colores: ${colores.map(nombreColor).join(", ")}`}>
      {colores.slice(0, max).map((c) => <span key={c} title={nombreColor(c)} className="size-4 rounded-full ring-1 ring-black/15" style={{ background: hexDeCodigo(c) }} />)}
      {colores.length > max && <span className="text-[0.7rem] text-texto-suave">+{colores.length - max}</span>}
    </span>
  );
}

export function Miniatura3d({ item, url, className = "" }: { item: ItemBiblioteca; url: string | undefined; className?: string }) {
  const svg = useMemo(() => miniaturaSvg(item), [item]);
  if (svg) return <div className={`grid place-items-center bg-[#efedf2] p-3 ${className}`}><MiniaturaDecoracion miniatura={svg} nombre={item.nombre} className="h-full max-h-full w-full" /></div>;
  if (url) return <div role="img" aria-label={`Vista 3D de ${item.nombre}`} className={`bg-[#efedf2] bg-cover bg-center ${className}`} style={{ backgroundImage: `url(${url})` }} />;
  // Mientras se dibuja la vista 3D, la foto de la idea (url pública de su fuente), si la tiene.
  // eslint-disable-next-line @next/next/no-img-element -- foto externa del CDN de Sempertex, a tamaño de tarjeta
  if (item.fuente?.fotoUrl) return <img src={item.fuente.fotoUrl} alt={`Foto de ${item.nombre}`} loading="lazy" decoding="async" className={`bg-[#efedf2] object-cover ${className}`} />;
  return <div className={`grid place-items-center bg-[#efedf2] text-xs text-texto-suave ${className}`}><Box className="size-6 animate-pulse opacity-50" aria-hidden /><span className="sr-only">Dibujando…</span></div>;
}

export function Fuente({ item, corta = false }: { item: ItemBiblioteca; corta?: boolean }) {
  const f = item.fuente;
  if (!f) return null;
  const tipo = f.tipo === "idea-sempertex" ? "Idea de sempertex.com" : f.tipo === "celebra" ? "Revista Celebra" : f.tipo === "referencia-web" ? "Referencia web" : item.id.startsWith("vista:") ? "De tu escena" : item.propio ? "Tu biblioteca" : "Del taller";
  if (corta) return <span className="truncate text-[0.7rem] text-texto-suave" title={f.titulo}>{tipo}{f.tipo !== "propio" ? ` · ${f.titulo}` : ""}</span>;
  return (
    <span className="text-sm text-texto">
      <b className="font-semibold">{tipo}</b> · {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-acento">{f.titulo} <ExternalLink className="inline size-3" aria-hidden /></a> : f.titulo}
      {f.fotoUrl && <> · <a href={f.fotoUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-acento">ver la foto original</a></>}
    </span>
  );
}

/** La lista de compra en texto (para copiarla y pegarla en un pedido). */
function listaEnTexto(item: ItemBiblioteca, p: ProductosDeItem): string {
  const lineas = [`${item.nombre} — productos`, "", "GLOBOS"];
  for (const g of p.globos) lineas.push(`${g.cantidad} × ${g.nombreOficial} — ${g.producto.nombre}${g.producto.estado === "verificado" ? ` — ${g.producto.url}` : " (sin verificar)"}${g.impresos ? ` (${g.impresos} de ellos impresos: ver abajo)` : ""}`);
  for (const [seccion, titulo] of [["impresos", "GLOBOS IMPRESOS"], ["metalizados", "METALIZADOS"]] as const) {
    const de = p.tienda.filter((t) => t.seccion === seccion);
    if (de.length) { lineas.push("", titulo); for (const t of de) lineas.push(`${t.cantidad} × ${t.nombre} (${t.detalle}) — ${t.url}`); }
  }
  if (p.utileria.length) { lineas.push("", "UTILERÍA"); for (const u of p.utileria) lineas.push(`${u.cantidad} × ${u.nombre}${u.variante ? ` (${u.variante})` : ""}${u.url ? ` — ${urlTienda(u.url)}` : ""}`); }
  if (p.escenografia.length) { lineas.push("", "ESCENOGRAFÍA (no es producto de la tienda)"); for (const e of p.escenografia) lineas.push(`${e.cantidad} × ${e.nombre}`); }
  return lineas.join("\n");
}

export function TablaProductos({ item, productos }: { item: ItemBiblioteca; productos: ProductosDeItem }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(listaEnTexto(item, productos)); setCopiado(true); setTimeout(() => setCopiado(false), 2500); } catch { setCopiado(false); }
  };
  const th = "px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-texto-suave";
  const td = "px-2 py-1.5 align-top";
  // En el teléfono cada fila es una ficha: la cantidad a la izquierda y lo demás apilado (sin scroll de lado).
  // Desde 640 px, la tabla de siempre con su propio scroll horizontal si no cabe.
  const tabla = "w-full border-collapse text-sm max-sm:block sm:min-w-[520px]";
  const cabeza = "max-sm:hidden";
  const cuerpo = "max-sm:block";
  const fila = "border-b border-borde/60 max-sm:grid max-sm:grid-cols-[3rem_minmax(0,1fr)] max-sm:py-1";
  const celdaCantidad = `${td} font-mono font-semibold text-texto max-sm:row-span-4`;
  const celda = `${td} min-w-0 break-words max-sm:col-start-2 max-sm:py-0.5`;
  const rotulo = "text-texto-suave sm:hidden";
  return (
    <section className={`${TARJETA} flex flex-col gap-3 p-3`} aria-label="Productos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-texto">Productos</h3>
        <button type="button" onClick={copiar} className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-3 text-xs`}><ClipboardCopy className="size-3.5" aria-hidden />{copiado ? "Lista copiada" : "Copiar la lista"}</button>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-texto">Globos <span className="font-normal text-texto-suave">· {productos.totalGlobos} en total</span></h4>
        {productos.globos.length === 0 ? <p className="text-xs text-texto-suave">No lleva globos.</p> : (
          <div className="mt-1 overflow-x-auto overscroll-x-contain">
            <table className={tabla}>
              <thead className={cabeza}><tr className="border-b border-borde"><th className={th}>Cantidad</th><th className={th}>Globo (formato, color, código)</th><th className={th}>Producto en la tienda</th></tr></thead>
              <tbody className={cuerpo}>
                {productos.globos.map((g) => (
                  <tr key={`${g.formatoId}|${g.codigo}`} className={fila}>
                    <td className={celdaCantidad}>{g.cantidad}{g.porLargo ? <span className="block text-[0.65rem] font-normal text-texto-suave">por largo</span> : null}</td>
                    <td className={celda}>
                      <span className="flex items-center gap-2 text-texto"><span className="size-4 shrink-0 rounded-full ring-1 ring-black/15" style={{ background: hexDeCodigo(g.codigo) }} aria-hidden /><b className="font-semibold">{g.nombreOficial}</b></span>
                      <span className="block text-[0.7rem] text-texto-suave">{g.formato}{g.impresos ? ` · ${g.impresos} ${g.impresos === 1 ? "va impreso" : "van impresos"}: se compran como el impreso de abajo` : ""}</span>
                    </td>
                    <td className={celda}>
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

      {productos.tienda.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-texto">Globos impresos y metalizados <span className="font-normal text-texto-suave">· producto exacto de la tienda</span></h4>
          <div className="mt-1 overflow-x-auto overscroll-x-contain">
            <table className={tabla}>
              <thead className={cabeza}><tr className="border-b border-borde"><th className={th}>Cantidad</th><th className={th}>Producto en la tienda</th><th className={th}>Sección</th><th className={th}>En la escena</th></tr></thead>
              <tbody className={cuerpo}>
                {productos.tienda.map((t) => (
                  <tr key={t.url} className={fila}>
                    <td className={celdaCantidad}>{t.cantidad}</td>
                    <td className={celda}>
                      <a href={t.url} target="_blank" rel="noreferrer" className="text-texto underline decoration-dotted underline-offset-2 hover:text-acento">{t.nombre}</a>
                      <span className="block text-[0.7rem] text-texto-suave">{t.detalle}</span>
                    </td>
                    <td className={`${celda} text-xs text-texto`}>{t.seccion === "impresos" ? "Globos impresos" : "Metalizados"}</td>
                    <td className={`${celda} text-xs text-texto-suave`}><span className={rotulo}>En la escena: </span>{t.piezas.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-texto">Utilería de fiesta</h4>
        {productos.utileria.length === 0 ? <p className="text-xs text-texto-suave">No lleva utilería.</p> : (
          <div className="mt-1 overflow-x-auto overscroll-x-contain">
            <table className={tabla}>
              <thead className={cabeza}><tr className="border-b border-borde"><th className={th}>Cantidad</th><th className={th}>Producto</th><th className={th}>En la escena</th></tr></thead>
              <tbody className={cuerpo}>
                {productos.utileria.map((u) => (
                  <tr key={`${u.url}|${u.nombre}|${u.variante ?? ""}`} className={fila}>
                    <td className={celdaCantidad}>{u.cantidad}</td>
                    <td className={celda}>
                      {u.generico ? <span className="text-texto-suave">{u.nombre}</span> : <a href={urlTienda(u.url)} target="_blank" rel="noreferrer" className="text-texto underline decoration-dotted underline-offset-2 hover:text-acento">{u.nombre}</a>}
                      {u.variante && <span className="text-texto-suave"> · {u.variante}</span>}
                    </td>
                    <td className={`${celda} text-xs text-texto-suave`}><span className={rotulo}>En la escena: </span>{u.piezas.join(", ")}</td>
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

/** Lo que el motor armó para la ficha (o por qué no pudo). */
function useArmadoFicha(item: ItemBiblioteca): Armado | null {
  const [hecho, setHecho] = useState<{ item: ItemBiblioteca; armado: Armado } | null>(null);
  useEffect(() => {
    let vivo = true;
    void armarEnMotor(item, true).then((armado) => { if (vivo) setHecho({ item, armado }); });
    return () => { vivo = false; };
  }, [item]);
  return hecho?.item === item ? hecho.armado : null;
}

export function Ficha({ item, biblioteca, huellas, minis, onVer, onVolver, acciones, puedeVolver }: {
  item: ItemBiblioteca; biblioteca: readonly ItemBiblioteca[]; huellas: ReadonlyMap<string, string>; minis: ReadonlyMap<string, string>;
  onVer: (item: ItemBiblioteca) => void; onVolver: () => void; acciones: Acciones; puedeVolver: boolean;
}) {
  // La vista, los productos y el resumen los arma el motor (fuera de la página): una idea grande tarda segundos.
  const hecho = useArmadoFicha(item);
  const listo = hecho && !("error" in hecho) ? hecho : null;
  const armada = listo?.armada ?? null;
  const productos = listo?.productos ?? null;
  const resumen = listo?.resumen ?? null;
  /** El item con su contenido ya armado (para «Abrir en Escena» y «Añadir» sin armarlo en la página). */
  const completo = useMemo(() => (listo?.contenido ? copiarItem(item, { contenido: listo.contenido }) : hecho ? item : null), [item, listo, hecho]);
  const contenido = useMemo(() => (item.tipo === "escena" ? contenidoDeEscena(biblioteca, item.id) : []), [item, biblioteca]);
  /** Las decoraciones de un conjunto, juntas por nombre («14 × Ojo con venas»). Un conjunto siempre es dato plano. */
  const armado = useMemo(() => {
    const cuenta = new Map<string, number>();
    if (item.tipo === "conjunto" && item.contenido.tipo === "conjunto") for (const h of item.contenido.conjunto.hijos) cuenta.set(nombreGenerico(h.nombre), (cuenta.get(nombreGenerico(h.nombre)) ?? 0) + 1);
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
            <Miniatura3d item={i} url={minis.get(huellas.get(i.id) ?? "")} className="size-12 shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-texto">{i.nombre}{veces(i) > 1 && <span className="text-texto-suave"> · {veces(i)} veces</span>}</span>
              <span className="block truncate text-[0.7rem] text-texto-suave">{NOMBRE_TIPO_ITEM.get(i.tipo)}{i.derivado ? "" : " · también en la biblioteca"}</span>
            </span>
            <button type="button" onClick={() => onVer(i)} className={`${BOTON} ${INACTIVO} inline-flex max-w-[45%] shrink-0 items-center gap-1 px-2 text-left text-xs sm:max-w-none`}><Eye className="size-3.5 shrink-0" aria-hidden />{verTexto}</button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <article className="flex flex-col gap-3" aria-label={`Ficha de ${item.nombre}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onVolver} className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-3`}><ArrowLeft className="size-4" aria-hidden />{puedeVolver ? "Volver" : "Volver a la biblioteca"}</button>
        <span className={`${ETIQUETA} text-texto`}>{NOMBRE_TIPO_ITEM.get(item.tipo)}</span>
        {item.ocasiones.map((o) => <span key={o} className={ETIQUETA}>{o}</span>)}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {armada ? <Vista3d armada={armada} /> : (
            <div className="grid h-[46vh] min-h-[300px] place-items-center rounded-2xl bg-superficie-suave text-sm text-texto-suave ring-1 ring-borde" role="status">
              {hecho && "error" in hecho ? `No se pudo armar: ${hecho.error}` : "Armando la vista 3D…"}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!completo} onClick={() => { if (completo) acciones.onAbrirEnEscena(completo); }} title="Reemplaza la escena que tienes (Ctrl+Z la recupera)" className={`${BOTON} ${ACTIVO} inline-flex items-center gap-1.5 px-4 disabled:opacity-60`}><Replace className="size-4" aria-hidden />Abrir en Escena</button>
            <button type="button" disabled={!completo} onClick={() => { if (completo) acciones.onAnadir(completo); }} title="La añade a la escena que tienes, donde estaba en la suya" className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-4 disabled:opacity-60`}><Plus className="size-4" aria-hidden />Añadir a mi escena</button>
            {item.propio && (
              <button type="button" onClick={() => { if (quitarPropio(item.id)) { setQuitado(true); onVolver(); } }} disabled={quitado} className={`${BOTON} ${INACTIVO} inline-flex items-center gap-1.5 px-3`}><Trash2 className="size-4" aria-hidden />Quitar de mi biblioteca</button>
            )}
          </div>
          <p className="text-xs text-texto-suave">«Abrir en Escena» reemplaza la escena que tienes (Ctrl+Z la recupera). «Añadir a mi escena» la suma a la que tienes, con su armado: la estructura y sus decoraciones juntas.</p>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <header>
            <h2 className="text-xl font-semibold text-texto">{item.nombre}</h2>
            {item.descripcion && <p className="mt-1 text-sm text-texto-suave">{item.descripcion}</p>}
            {resumen ? (
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-texto">
                <span className="font-mono">{resumen.globos} globos</span>
                {item.tipo !== "decoracion" && item.tipo !== "utileria" && <span className="font-mono">{resumen.piezas} {resumen.piezas === 1 ? "pieza" : "piezas"}</span>}
                <Chips colores={resumen.colores} max={14} />
              </p>
            ) : <p className="mt-2 text-sm text-texto-suave">Contando globos…</p>}
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
      {productos ? <TablaProductos item={item} productos={productos} /> : (
        <section className={`${TARJETA} p-3 text-sm text-texto-suave`} aria-label="Productos" role="status">{hecho && "error" in hecho ? "Sin lista de productos: no se pudo armar." : "Calculando la lista de productos…"}</section>
      )}
    </article>
  );
}

// ----------------------------------------------------------------------------------------------------------
// En el panel «Añadir»: filtros, tarjetas compactas y la ficha en un diálogo
// ----------------------------------------------------------------------------------------------------------

/** Ocasión, color y globo elegidos en los filtros de «Añadir» (el texto viene del buscador del panel). */
export type FiltroCompacto = { ocasion: string | null; color: string | null; producto: string | null };
export const FILTRO_COMPACTO_VACIO: FiltroCompacto = { ocasion: null, color: null, producto: null };

/**
 * La biblioteca de los tipos de una pestaña de «Añadir» (Estructuras: estructuras y conjuntos; Decoraciones; Utilería;
 * Ideas: escenas), con el texto del buscador y los filtros; y las opciones de los filtros (ocasiones, colores y globos
 * que hay en esos tipos). El motor (Web Worker) cuenta y arma fuera de la página.
 */
export function useBibliotecaFiltrada(tipos: readonly TipoItem[], texto: string, filtro: FiltroCompacto) {
  const propios = useBibliotecaPropia();
  const { items, resumenes, huellas, listos, indexadas, escenas } = useBiblioteca(propios);
  const clave = tipos.join("|");
  const deTipo = useMemo(() => { const t = new Set(clave.split("|")); return items.filter((i) => t.has(i.tipo)); }, [items, clave]);
  const visibles = useMemo(() => filtrarBiblioteca(deTipo, resumenes, { tipo: null, ...filtro, texto }), [deTipo, resumenes, filtro, texto]);
  const ocasiones = useMemo(() => OCASIONES.filter((o) => deTipo.some((i) => i.ocasiones.includes(o))), [deTipo]);
  const { colores, productos } = useMemo(() => {
    const c = new Map<string, number>(), p = new Map<string, number>();
    for (const i of deTipo) {
      const r = resumenes.get(i.id);
      if (!r) continue;
      for (const x of r.colores) c.set(x, (c.get(x) ?? 0) + 1);
      for (const x of r.productos) p.set(x, (p.get(x) ?? 0) + 1);
    }
    const porNombre = (a: string, b: string) => a.localeCompare(b, "es");
    return {
      colores: [...c.entries()].sort((a, b) => porNombre(nombreColor(a[0]), nombreColor(b[0]))),
      productos: [...p.entries()].sort((a, b) => porNombre(nombreProducto(a[0]), nombreProducto(b[0]))),
    };
  }, [deTipo, resumenes]);
  return { items, deTipo, visibles, resumenes, huellas, ocasiones, colores, productos, contando: listos < items.length || indexadas < escenas, propios };
}

const FILTRO_CHIP = "h-[30px] min-w-0 flex-1 truncate rounded-lg border border-taller-borde bg-taller-panel px-2 text-xs font-medium text-taller-medio hover:text-taller-texto";

/** Los filtros de la biblioteca como chips (selectores nativos: accesibles y cómodos con el dedo). */
export const FiltrosCompactos = memo(function FiltrosCompactos({ filtro, onFiltro, ocasiones, colores, productos }: {
  filtro: FiltroCompacto; onFiltro: (f: FiltroCompacto) => void; ocasiones: readonly string[];
  colores: ReadonlyArray<readonly [string, number]>; productos: ReadonlyArray<readonly [string, number]>;
}) {
  const hay = Boolean(filtro.ocasion || filtro.color || filtro.producto);
  return (
    <div className="flex gap-1.5" role="group" aria-label="Filtros de la biblioteca">
      <select value={filtro.ocasion ?? ""} onChange={(e) => onFiltro({ ...filtro, ocasion: e.target.value || null })} aria-label="Ocasión" className={`${FILTRO_CHIP} ${filtro.ocasion ? "border-taller-resalte text-taller-texto" : ""}`}>
        <option value="">Ocasión: todas</option>
        {ocasiones.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <select value={filtro.color ?? ""} onChange={(e) => onFiltro({ ...filtro, color: e.target.value || null })} aria-label="Color" className={`${FILTRO_CHIP} ${filtro.color ? "border-taller-resalte text-taller-texto" : ""}`}>
        <option value="">Color: todos</option>
        {colores.map(([c, n]) => <option key={c} value={c}>{nombreColor(c)} ({n})</option>)}
      </select>
      <select value={filtro.producto ?? ""} onChange={(e) => onFiltro({ ...filtro, producto: e.target.value || null })} aria-label="Globo que usa" className={`${FILTRO_CHIP} ${filtro.producto ? "border-taller-resalte text-taller-texto" : ""}`}>
        <option value="">Globo: todos</option>
        {productos.map(([x, n]) => <option key={x} value={x}>{x.split("|")[0]} · {nombreColor(x.split("|")[1] ?? "")} ({n})</option>)}
      </select>
      {hay && <button type="button" onClick={() => onFiltro(FILTRO_COMPACTO_VACIO)} aria-label="Quitar filtros" title="Quitar filtros" className="h-[30px] shrink-0 px-1.5 text-xs text-taller-acento hover:underline">Quitar</button>}
    </div>
  );
});

/** De dónde viene, en corto, para la tarjeta compacta («Idea Sempertex #384», «Celebra», «Referencia web»). */
function fuenteCorta(item: ItemBiblioteca): string {
  const f = item.fuente;
  if (!f) return item.propio ? "Tu biblioteca" : "Del taller";
  if (f.tipo === "idea-sempertex") { const n = /#\s?(\d+)/.exec(f.titulo)?.[1]; return n ? `Idea Sempertex #${n}` : "Idea Sempertex"; }
  if (f.tipo === "celebra") return "Celebra";
  if (f.tipo === "referencia-web") return "Referencia web";
  return item.id.startsWith("vista:") ? "De tu escena" : item.propio ? "Tu biblioteca" : "Del taller";
}

const TarjetaCompacta = memo(function TarjetaCompacta({ item, resumen, mini, onAbrir }: { item: ItemBiblioteca; resumen: ResumenItem | undefined; mini: string | undefined; onAbrir: (item: ItemBiblioteca) => void }) {
  const sub = `${fuenteCorta(item)}${resumen ? ` · ${resumen.globos} globos` : ""}`;
  return (
    <li>
      <button type="button" onClick={() => onAbrir(item)} title={`${item.nombre}${item.descripcion ? ` — ${item.descripcion}` : ""}. Toca para ver su ficha y añadirla.`}
        className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-taller-borde bg-taller-tarjeta p-2 text-left text-xs font-medium leading-snug text-taller-texto hover:border-taller-resalte">
        <Miniatura3d item={item} url={mini} className="h-[72px] w-full rounded-lg" />
        <span className="line-clamp-2">{item.nombre}</span>
        <span className="truncate text-[11px] font-normal text-taller-suave">{sub}</span>
      </button>
    </li>
  );
}, (a, b) => a.resumen === b.resumen && a.mini === b.mini && a.onAbrir === b.onAbrir && a.item.id === b.item.id && a.item.nombre === b.item.nombre);

/** Tarjetas por página en el panel (24: abrir el panel no debe pintar cientos de tarjetas). */
const POR_PAGINA_PANEL = 24;

/** La grilla de la biblioteca en el panel «Añadir» (3 columnas, miniaturas 3D del motor, de a 24). */
export function GrillaCompacta({ visibles, resumenes, huellas, onAbrir, vacio }: {
  visibles: readonly ItemBiblioteca[]; resumenes: ReadonlyMap<string, ResumenItem>; huellas: ReadonlyMap<string, string>;
  onAbrir: (item: ItemBiblioteca) => void; vacio: string;
}) {
  const [pagina, setPagina] = useState<{ de: readonly ItemBiblioteca[]; cuantos: number }>({ de: visibles, cuantos: POR_PAGINA_PANEL });
  // Otra búsqueda u otro filtro (otra lista que no empieza igual): vuelve a la primera página.
  const cuantos = pagina.de === visibles || (pagina.de.length <= visibles.length && pagina.de[0]?.id === visibles[0]?.id) ? pagina.cuantos : POR_PAGINA_PANEL;
  const mas = () => setPagina({ de: visibles, cuantos: cuantos + POR_PAGINA_PANEL });
  const mostrados = useMemo(() => visibles.slice(0, cuantos), [visibles, cuantos]);
  const { lienzoRef, minis } = useMiniaturas3d(mostrados, huellas);
  const hayMas = mostrados.length < visibles.length;
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
  return (
    <>
      {visibles.length === 0 ? <p className="px-1 text-xs text-taller-suave">{vacio}</p> : (
        <ul className="grid grid-cols-3 gap-2">
          {mostrados.map((i) => <TarjetaCompacta key={i.id} item={i} resumen={resumenes.get(i.id)} mini={minis.get(huellas.get(i.id) ?? "")} onAbrir={onAbrir} />)}
          {hayMas && (
            <li ref={finRef} className="col-span-full flex justify-center">
              <button type="button" onClick={mas} className="min-h-9 rounded-lg px-3 text-xs text-taller-acento hover:bg-taller-encima">Mostrar más ({visibles.length - mostrados.length})</button>
            </li>
          )}
        </ul>
      )}
      <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 h-[240px] w-[320px]"><canvas ref={lienzoRef} className="block h-full w-full" /></div>
    </>
  );
}

/**
 * La ficha de un item en un diálogo: vista 3D, productos exactos de la tienda (copiar la lista), de dónde viene (enlace
 * y foto de la idea), lo que contiene (y verlo por separado), «Abrir en Escena», «Añadir a mi escena» y quitar lo propio.
 */
export function FichaDialogo({ item, onAbrirEnEscena, onAnadir, onCerrar }: {
  item: ItemBiblioteca; onAbrirEnEscena: (escena: Escena, item: ItemBiblioteca) => void; onAnadir: (item: ItemBiblioteca) => void; onCerrar: () => void;
}) {
  const propios = useBibliotecaPropia();
  const { items, huellas } = useBiblioteca(propios);
  const [pila, setPila] = useState<ItemBiblioteca[]>(() => [item]);
  const abierto = pila[pila.length - 1] ?? item;
  const contenido = useMemo(() => (abierto.tipo === "escena" ? contenidoDeEscena(items, abierto.id) : []), [abierto, items]);
  const { lienzoRef, minis } = useMiniaturas3d(contenido, huellas);
  const acciones: Acciones = { onAbrirEnEscena: (i) => onAbrirEnEscena(escenaDeItem(i), i), onAnadir };
  return (
    <div className="p-3 sm:p-4">
      <Ficha key={`${pila.length}:${abierto.id}`} item={abierto} biblioteca={items} huellas={huellas} minis={minis} acciones={acciones} puedeVolver={pila.length > 1}
        onVer={(i) => setPila((p) => [...p, i])} onVolver={() => { if (pila.length > 1) setPila((p) => p.slice(0, -1)); else onCerrar(); }} />
      <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 h-[240px] w-[320px]"><canvas ref={lienzoRef} className="block h-full w-full" /></div>
    </div>
  );
}

/** Las escenas predefinidas (Plantillas) como tarjetas compactas con su miniatura 3D. */
export function TarjetasPlantillas({ plantillas, onElegir, onVacia }: {
  plantillas: ReadonlyArray<{ id: string; nombre: string; descripcion: string }>; onElegir: (id: string) => void; onVacia: () => void;
}) {
  const propios = useBibliotecaPropia();
  const { items, resumenes, huellas } = useBiblioteca(propios);
  const deItems = useMemo(() => plantillas.flatMap((p) => { const i = items.find((x) => x.id === `escena:${p.id}`); return i ? [i] : []; }), [plantillas, items]);
  const { lienzoRef, minis } = useMiniaturas3d(deItems, huellas);
  return (
    <>
      <ul className="grid grid-cols-2 gap-2">
        {plantillas.map((p) => {
          const item = deItems.find((i) => i.id === `escena:${p.id}`);
          const r = item ? resumenes.get(item.id) : undefined;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onElegir(p.id)} title={p.descripcion}
                className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-taller-borde bg-taller-tarjeta p-2 text-left text-xs font-medium leading-snug text-taller-texto hover:border-taller-resalte">
                {item ? <Miniatura3d item={item} url={minis.get(huellas.get(item.id) ?? "")} className="aspect-[4/3] w-full rounded-lg" /> : <span className="aspect-[4/3] w-full rounded-lg bg-taller-encima" aria-hidden />}
                <span className="line-clamp-2">{p.nombre}</span>
                <span className="text-[11px] font-normal text-taller-suave">{r ? `${r.globos} globos · ${r.piezas} piezas` : "…"}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onVacia} className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-taller-borde p-2 text-center text-xs font-medium text-taller-texto-2 hover:border-taller-resalte">
            <Plus className="size-5 text-taller-medio" aria-hidden />Empezar con la sala vacía
          </button>
        </li>
      </ul>
      <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0 h-[240px] w-[320px]"><canvas ref={lienzoRef} className="block h-full w-full" /></div>
    </>
  );
}

/** Los productos exactos de la tienda para la escena que se tiene (los arma el motor, fuera de la página). */
export function ProductosEscena({ escena, nombre }: { escena: Escena; nombre: string }) {
  const item = useMemo(() => itemDeEscena({ id: "vista:escena-actual", nombre, ocasiones: ["general"], escena }), [escena, nombre]);
  const hecho = useArmadoFicha(item);
  const productos = hecho && !("error" in hecho) ? hecho.productos ?? null : null;
  if (!productos) return <p className="text-sm text-taller-suave" role="status">{hecho && "error" in hecho ? `No se pudo armar la lista de productos: ${hecho.error}` : "Calculando los productos exactos de la tienda…"}</p>;
  return <TablaProductos item={item} productos={productos} />;
}

// ----------------------------------------------------------------------------------------------------------
// Inspector: con una pieza elegida, verla sola o guardarla (o, sin pieza, guardar la escena)
// ----------------------------------------------------------------------------------------------------------

/**
 * Lo de la biblioteca para la pieza elegida: «Ver sola con sus decoraciones» (abre su ficha) y «Guardar en mi
 * biblioteca» (en la propia, con nombre y ocasión). También guardar la escena entera. `pedirGuardar` (un contador que
 * sube) abre el formulario de guardar la pieza desde fuera (el menú contextual).
 */
export function AccionesPieza({ escena, armada, nodoId, onVer, pedirGuardar = 0 }: { escena: Escena; armada: EscenaArmada; nodoId: string | null; onVer: (item: ItemBiblioteca) => void; pedirGuardar?: number }) {
  const nodo = nodoId ? escena.nodos.find((n) => n.id === nodoId) ?? null : null;
  const [abierto, setAbierto] = useState<"pieza" | "escena" | null>(null);
  const [nombre, setNombre] = useState("");
  const [ocasion, setOcasion] = useState("general");
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedido, setPedido] = useState(pedirGuardar);
  if (pedirGuardar !== pedido) { setPedido(pedirGuardar); if (nodo) { setAbierto("pieza"); setNombre(nodo.nombre); setAviso(null); } }
  const clase = nodo ? clasePieza(nodo.pieza) : null;
  const temporal = () => (nodoId ? itemDeNodo(escena, nodoId, { id: `vista:${nodoId}`, armada }) : null);
  const guardar = () => {
    const nombreFinal = nombre.trim() || (abierto === "escena" || !nodo ? "Mi escena" : nodo.nombre);
    const item = abierto === "escena" || !nodoId
      ? { ...itemDeEscena({ id: idPropio(nombreFinal), nombre: nombreFinal, ocasiones: [ocasion], fuente: { tipo: "propio", titulo: "Guardado desde el Taller 3D" }, escena }), propio: true }
      : itemDeNodo(escena, nodoId, { id: idPropio(nombreFinal), nombre: nombreFinal, ocasiones: [ocasion], armada });
    if (!item) { setAviso("Esta pieza no se puede guardar sola."); return; }
    setAviso(guardarPropio(item) ? `Guardado en tu biblioteca: «${nombreFinal}» (${NOMBRE_TIPO_ITEM.get(item.tipo)?.toLowerCase()}).` : "Tu navegador no dejó guardarlo (almacenamiento lleno o bloqueado).");
    setAbierto(null);
  };
  const conPieza = nodo !== null && clase !== "escenografia";
  return (
    <section className="flex flex-col gap-2" aria-label="Biblioteca">
      {conPieza && (
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => { const i = temporal(); if (i) onVer({ ...i, propio: false, fuente: { tipo: "propio", titulo: "sin guardar (para guardarla, «Guardar en mi biblioteca»)" } }); }} className={`${BOTON} ${INACTIVO} inline-flex items-center justify-center gap-1.5 text-xs`}>
            <Eye className="size-3.5" aria-hidden />{clase === "estructura" ? "Ver con sus decoraciones" : "Ver sola"}
          </button>
          <button type="button" onClick={() => { setAbierto(abierto === "pieza" ? null : "pieza"); setNombre(nodo.nombre); setAviso(null); }} aria-expanded={abierto === "pieza"} className={`${BOTON} ${abierto === "pieza" ? ACTIVO : INACTIVO} inline-flex items-center justify-center gap-1.5 text-xs`}>
            <BookmarkPlus className="size-3.5" aria-hidden />Guardar en mi biblioteca
          </button>
        </div>
      )}
      <button type="button" onClick={() => { setAbierto(abierto === "escena" ? null : "escena"); setNombre(""); setAviso(null); }} aria-expanded={abierto === "escena"} className="min-h-9 self-start text-xs text-taller-acento underline-offset-2 hover:underline">
        Guardar toda la escena en mi biblioteca
      </button>
      {abierto && (
        <div className="flex flex-col gap-2 rounded-xl bg-superficie-suave p-2 ring-1 ring-borde">
          <p className="text-[0.7rem] text-texto-suave">{abierto === "escena" || !nodo ? `La escena entera (${escena.nodos.length} piezas).` : clase === "estructura" ? "La estructura con todo lo que cuelga de ella y lo pegado a sus globos." : "La pieza sola."}</p>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto">Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={abierto === "escena" || !nodo ? "Mi escena" : nodo.nombre} className="min-h-11 rounded-lg bg-superficie px-2 text-base font-normal text-texto ring-1 ring-borde sm:text-sm lg:min-h-9" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-texto">Ocasión
            <select value={ocasion} onChange={(e) => setOcasion(e.target.value)} className={SELECT}>{OCASIONES.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          </label>
          <button type="button" onClick={guardar} className="min-h-11 rounded-[10px] bg-taller-primario px-3 text-sm font-medium text-taller-sobre-primario hover:bg-taller-primario-hover lg:min-h-9">Guardar</button>
        </div>
      )}
      {aviso && <p role="status" className="text-xs text-texto">{aviso}</p>}
    </section>
  );
}
