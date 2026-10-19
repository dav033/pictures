"use client";

/* Catalog images come from runtime URLs (Shopify CDN) and are not routed through next/image. */
/* eslint-disable @next/next/no-img-element */

import { memo, useId, useMemo, useState, type RefObject } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { muestraColor } from "@/lib/plan/presentacion-cliente";
import { TAMANOS_PULGADAS, agruparPorFamilia, agruparPorTamano, miniaturaDeCatalogo, type TarjetaGlobo, type OpcionElegible } from "./ajuste-propuesta";
import { nombreDeFamilia, representanteDeFamilia, type FamiliaDelCatalogo, type FamiliaId } from "./familias-color";
import type { AjustePropuesta, ElegidoAjuste, SeccionResultados, VistaResultados } from "./usarAjustePropuesta";

const CHIP = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento sm:min-h-8";
const CHIP_ACTIVO = "bg-acento-suave font-semibold text-acento ring-acento";
const CHIP_INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";

/** Cuántas tarjetas piden su foto con prioridad (las de la primera fila visible); el resto la pide al acercarse. */
const FOTOS_PRIORITARIAS = 5;
const VARIANTES_A_LA_VISTA = 3;
const REJILLA = "grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

function Muestra({ color, tamano = "size-4" }: { color: string; tamano?: string }) {
  const muestra = muestraColor(color, null);
  return <span aria-hidden="true" className={`${tamano} shrink-0 rounded-full ${muestra.conBorde ? "ring-1 ring-borde" : "ring-1 ring-black/10"}`} style={{ background: muestra.fondo }} />;
}

function nombreColor(color: string): string {
  return muestraColor(color, null).etiqueta;
}

function Familias({ ajuste }: { ajuste: AjustePropuesta }) {
  const vista = ajuste.vistaColores;
  const elegidas: FamiliaDelCatalogo[] = vista.tipo === "listo" ? vista.familias.filter((familia) => ajuste.familias.includes(familia.id)) : [];
  return (
    <section data-testid="ajuste-colores" aria-labelledby="ajuste-colores-titulo" className="space-y-1.5">
      <h3 id="ajuste-colores-titulo" className="text-xs font-semibold text-texto">Color</h3>
      {vista.tipo === "cargando" && (
        <div role="status" aria-label="Cargando los colores del catálogo" className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, indice) => <span key={indice} aria-hidden="true" className="brillo-carga h-8 w-24 rounded-full" />)}
        </div>
      )}
      {vista.tipo === "error" && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-error-suave px-3 py-2 text-xs font-medium text-error">
          {vista.mensaje}
          <button type="button" onClick={ajuste.reintentarColores} className="font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento">Reintentar</button>
        </p>
      )}
      {vista.tipo === "listo" && (
        vista.familias.length === 0 ? (
          <p className="text-xs text-texto-suave">El catálogo no tiene colores para mostrar.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {vista.familias.map((familia) => {
                const activa = ajuste.familias.includes(familia.id);
                return (
                  <button key={familia.id} type="button" aria-pressed={activa} onClick={() => ajuste.alternarFamilia(familia.id)} className={`${CHIP} ${activa ? CHIP_ACTIVO : CHIP_INACTIVO}`}>
                    <Muestra color={familia.representante} />
                    {familia.nombre}
                  </button>
                );
              })}
            </div>
            {elegidas.filter((familia) => familia.colores.length > 1).map((familia) => (
              <div key={familia.id} role="group" aria-label={`Colores de ${familia.nombre}`} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-texto-suave">{familia.nombre}:</span>
                {familia.colores.map(({ valor, total }) => {
                  const activo = ajuste.exactos.includes(valor);
                  return (
                    <button key={valor} type="button" aria-pressed={activo} onClick={() => ajuste.alternarColorExacto(valor)} className={`${CHIP} ${activo ? CHIP_ACTIVO : CHIP_INACTIVO}`}>
                      <Muestra color={valor} tamano="size-3.5" />
                      {nombreColor(valor)}
                      <span className="tabular-nums text-texto-suave">{total}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </>
        )
      )}
    </section>
  );
}

function Tamanos({ ajuste }: { ajuste: AjustePropuesta }) {
  return (
    <section aria-labelledby="ajuste-tamanos-titulo" className="space-y-1.5">
      <h3 id="ajuste-tamanos-titulo" className="text-xs font-semibold text-texto">Tamaño</h3>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={ajuste.tamanos.length === 0} onClick={ajuste.limpiarTamanos} className={`${CHIP} ${ajuste.tamanos.length === 0 ? CHIP_ACTIVO : CHIP_INACTIVO}`}>Todos los tamaños</button>
        {TAMANOS_PULGADAS.map((tamano) => {
          const activo = ajuste.tamanos.includes(tamano);
          return (
            <button key={tamano} type="button" aria-pressed={activo} aria-label={`${tamano} pulgadas`} onClick={() => ajuste.alternarTamano(tamano)} className={`${CHIP} ${activo ? CHIP_ACTIVO : CHIP_INACTIVO}`}>{tamano}″</button>
          );
        })}
      </div>
    </section>
  );
}

function descripcionVariante(nombre: string, variante: OpcionElegible): string {
  return [nombre, variante.tamano ?? "tamaño no especificado", variante.colores.length ? variante.colores.join(", ") : null].filter(Boolean).join(", ");
}

type PropsTarjeta = {
  tarjeta: TarjetaGlobo;
  /** La variante elegida si es de esta tarjeta; null si no, para que elegir otra no repinte toda la grilla. */
  elegidoId: string | null;
  prioritaria: boolean;
  onElegir: (producto: ElegidoAjuste["producto"], variante: OpcionElegible) => void;
};

const TarjetaGloboCatalogo = memo(function TarjetaGloboCatalogo({ tarjeta, elegidoId, prioritaria, onElegir }: PropsTarjeta) {
  const [imagenFallida, setImagenFallida] = useState(false);
  const [verTodas, setVerTodas] = useState(false);
  // La elegida siempre se ve, aunque quede más allá de las primeras.
  const visibles = verTodas ? tarjeta.opciones : tarjeta.opciones.filter((variante, indice) => indice < VARIANTES_A_LA_VISTA || variante.variantId === elegidoId);
  const ocultas = tarjeta.opciones.length - visibles.length;
  return (
    <li className={`flex min-w-0 flex-col overflow-hidden rounded-xl bg-superficie ring-1 ${elegidoId ? "ring-2 ring-acento" : "ring-borde"}`}>
      <div className="relative aspect-[5/4] w-full bg-superficie-2">
        {tarjeta.imagen && !imagenFallida ? (
          <img
            src={miniaturaDeCatalogo(tarjeta.imagen, 360)}
            srcSet={`${miniaturaDeCatalogo(tarjeta.imagen, 240)} 240w, ${miniaturaDeCatalogo(tarjeta.imagen, 480)} 480w`}
            sizes="(min-width: 1280px) 180px, (min-width: 1024px) 22vw, (min-width: 768px) 30vw, 45vw"
            alt={tarjeta.nombre}
            width={240}
            height={192}
            loading={prioritaria ? "eager" : "lazy"}
            fetchPriority={prioritaria ? "high" : "auto"}
            decoding="async"
            onError={() => setImagenFallida(true)}
            className="size-full object-contain"
          />
        ) : (
          <span className="grid size-full place-items-center px-3 text-center text-[11px] text-texto-suave">Sin foto en el catálogo</span>
        )}
        {elegidoId && <span aria-hidden="true" className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-acento text-sobre-acento"><Check className="size-3" /></span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <p className="line-clamp-2 text-xs font-semibold leading-snug text-texto">{tarjeta.nombre}</p>
        <ul className="mt-auto flex flex-col gap-1" aria-label={`Opciones de ${tarjeta.nombre}`}>
          {visibles.map((variante) => {
            const activo = variante.variantId === elegidoId;
            return (
              <li key={variante.variantId}>
                <button
                  type="button"
                  aria-pressed={activo}
                  aria-label={descripcionVariante(tarjeta.nombre, variante)}
                  onClick={() => onElegir({ productId: tarjeta.productId, nombre: tarjeta.nombre, imagen: tarjeta.imagen }, variante)}
                  className={`flex min-h-11 w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] leading-tight ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento sm:min-h-8 ${activo ? CHIP_ACTIVO : "text-texto ring-borde hover:bg-superficie-suave"}`}
                >
                  <span className="flex shrink-0 items-center -space-x-1" aria-hidden="true">{variante.colores.slice(0, 3).map((color) => <Muestra key={color} color={color} tamano="size-3" />)}</span>
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-semibold">{variante.tamanoCorto ?? "Tamaño no especificado"}</span>
                    <span className="text-texto-suave"> · {variante.colores.length > 0 ? variante.colores.map(nombreColor).join(", ") : "color del catálogo"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {(ocultas > 0 || verTodas) && tarjeta.opciones.length > VARIANTES_A_LA_VISTA && (
          <button type="button" aria-expanded={verTodas} onClick={() => setVerTodas((valor) => !valor)} className="min-h-8 self-start text-[11px] font-semibold text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento">
            {verTodas ? "Ver menos" : `Ver ${ocultas} más`}
          </button>
        )}
      </div>
    </li>
  );
});

function Esqueleto({ cantidad = 5 }: { cantidad?: number }) {
  return (
    <ul role="status" aria-label="Buscando globos en el catálogo" className={REJILLA}>
      {Array.from({ length: cantidad }, (_, indice) => (
        <li key={indice} aria-hidden="true" className="overflow-hidden rounded-xl bg-superficie ring-1 ring-borde">
          <div className="brillo-carga aspect-[5/4] w-full" />
          <div className="space-y-1.5 p-2"><div className="brillo-carga h-3 w-4/5 rounded" /><div className="brillo-carga h-8 w-full rounded-lg" /></div>
        </li>
      ))}
    </ul>
  );
}

type GrupoVista = { familia: FamiliaId; vista: VistaResultados };

/** Una familia: su encabezado y, dentro, sus globos subdivididos por tamaño de menor a mayor. */
function GrupoDeFamilia({ grupo, ajuste, primeraFoto }: { grupo: GrupoVista; ajuste: AjustePropuesta; primeraFoto: number }) {
  const idTitulo = useId();
  const { vista } = grupo;
  const tarjetas = vista.tipo === "listo" ? vista.tarjetas : null;
  const porTamano = useMemo(() => (tarjetas ? agruparPorTamano(tarjetas) : []), [tarjetas]);
  const elegidoId = ajuste.elegido?.variante.variantId ?? null;
  // Las primeras tarjetas de la pantalla (contando las de las familias de arriba) piden su foto con prioridad.
  const prioritarias = useMemo(
    () => new Set(porTamano.flatMap((tamano) => tamano.tarjetas.map((tarjeta) => `${tamano.diamPulg}|${tarjeta.productId}`)).slice(0, Math.max(0, FOTOS_PRIORITARIAS - primeraFoto))),
    [porTamano, primeraFoto],
  );
  return (
    <section aria-labelledby={idTitulo} className="space-y-2">
      <h3 id={idTitulo} className="flex items-center gap-2 text-sm font-semibold text-texto">
        <Muestra color={representanteDeFamilia(grupo.familia)} tamano="size-4" />
        {nombreDeFamilia(grupo.familia)}
        {tarjetas && <span className="text-xs font-normal text-texto-suave">{tarjetas.length} {tarjetas.length === 1 ? "globo" : "globos"}</span>}
      </h3>
      {vista.tipo === "cargando" && <Esqueleto />}
      {vista.tipo === "error" && <p className="text-xs text-texto-suave">No se pudieron cargar los globos de esta familia.</p>}
      {tarjetas && tarjetas.length === 0 && <p className="text-xs text-texto-suave">No hay globos de este color con esos filtros.</p>}
      {porTamano.map((tamano) => (
        <div key={tamano.diamPulg ?? "sin-tamano"} className="space-y-1.5">
          <h4 className="text-xs font-semibold text-texto-suave">{tamano.etiqueta} <span className="font-normal">· {tamano.tarjetas.length}</span></h4>
          <ul className={REJILLA} aria-label={`${nombreDeFamilia(grupo.familia)}, ${tamano.etiqueta}`}>
            {tamano.tarjetas.map((tarjeta) => (
              <TarjetaGloboCatalogo
                key={tarjeta.productId}
                tarjeta={tarjeta}
                elegidoId={tarjeta.opciones.some((opcion) => opcion.variantId === elegidoId) ? elegidoId : null}
                prioritaria={prioritarias.has(`${tamano.diamPulg}|${tarjeta.productId}`)}
                onElegir={ajuste.elegirVariante}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function gruposDe(secciones: readonly SeccionResultados[]): GrupoVista[] {
  const [primera] = secciones;
  if (!primera) return [];
  // Sin familia elegida hay una sola búsqueda sobre todo el catálogo: se reparte por la familia de cada globo.
  if (primera.familia === null) {
    if (primera.vista.tipo !== "listo") return [{ familia: "otros", vista: primera.vista }];
    const { cargandoMas, hayMas } = primera.vista;
    return agruparPorFamilia(primera.vista.tarjetas).map((grupo) => ({ familia: grupo.familia, vista: { tipo: "listo", tarjetas: grupo.tarjetas, cargandoMas, hayMas } }));
  }
  return secciones.flatMap((seccion) => (seccion.familia === null ? [] : [{ familia: seccion.familia, vista: seccion.vista }]));
}

function Resultados({ ajuste }: { ajuste: AjustePropuesta }) {
  const { secciones } = ajuste;
  const grupos = gruposDe(secciones);
  const sinFamilia = secciones[0]?.familia === null;
  const vistas = secciones.map((seccion) => seccion.vista);
  const cargando = vistas.some((vista) => vista.tipo === "cargando");
  const fallo = vistas.find((vista) => vista.tipo === "error");
  const total = vistas.reduce((suma, vista) => suma + (vista.tipo === "listo" ? vista.tarjetas.length : 0), 0);
  const hayMas = vistas.some((vista) => vista.tipo === "listo" && vista.hayMas);
  const cargandoMas = vistas.some((vista) => vista.tipo === "listo" && vista.cargandoMas);
  const tarjetasDe = (grupo: GrupoVista) => (grupo.vista.tipo === "listo" ? grupo.vista.tarjetas.length : 0);
  return (
    <div data-testid="ajuste-resultados" className="space-y-4">
      {fallo?.tipo === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-error-suave px-3 py-2 text-sm font-medium text-error">
          <p>{fallo.mensaje}</p>
          <button type="button" onClick={ajuste.reintentarBusqueda} className="ui-pressable min-h-11 rounded-lg bg-superficie px-3 py-1.5 text-xs font-semibold text-error ring-1 ring-error/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento sm:min-h-8">Reintentar</button>
        </div>
      )}
      {sinFamilia && cargando && <Esqueleto cantidad={10} />}
      {!cargando && !fallo && total === 0 && (
        <div className="space-y-2 rounded-xl bg-superficie px-4 py-8 text-center ring-1 ring-borde">
          <p className="text-sm font-medium text-texto">No encontré globos con esos filtros: quita algún color o tamaño.</p>
          {ajuste.hayFiltros && <button type="button" onClick={ajuste.limpiarFiltros} className="min-h-11 text-xs font-semibold text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento sm:min-h-8">Quitar todos los filtros</button>}
        </div>
      )}
      {!(sinFamilia && cargando) && grupos.map((grupo, indice) => (
        <GrupoDeFamilia key={grupo.familia} grupo={grupo} ajuste={ajuste} primeraFoto={grupos.slice(0, indice).reduce((suma, anterior) => suma + tarjetasDe(anterior), 0)} />
      ))}
      {total > 0 && <p className="sr-only" role="status">{total} globos encontrados</p>}
      {(hayMas || cargandoMas) && (
        <div className="flex justify-center">
          <button type="button" disabled={cargandoMas} onClick={ajuste.cargarMas} className="ui-pressable min-h-11 rounded-lg border border-borde bg-superficie px-4 py-2 text-sm font-medium text-acento hover:bg-acento-suave disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento sm:min-h-9">
            {cargandoMas ? "Cargando más…" : "Cargar más"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Buscador, filtros (familias de color con sus colores exactos, y tamaño) y los globos agrupados por familia y,
 * dentro de cada una, por tamaño. En pantallas chicas los filtros se pliegan detrás de un resumen.
 */
export function ExploradorCatalogo({ ajuste, campoBusqueda }: { ajuste: AjustePropuesta; campoBusqueda: RefObject<HTMLInputElement | null> }) {
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const idFiltros = useId();
  return (
    <div className="space-y-3">
      <form role="search" onSubmit={(evento) => { evento.preventDefault(); ajuste.buscarYa(); }} className="relative">
        <label htmlFor="ajuste-buscar" className="sr-only">Buscar un globo en el catálogo</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-texto-suave" />
        <input
          ref={campoBusqueda}
          id="ajuste-buscar"
          name="busqueda-catalogo"
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          value={ajuste.texto}
          onChange={(evento) => ajuste.setTexto(evento.target.value)}
          placeholder="Busca un globo por nombre"
          className="h-11 w-full rounded-xl border border-borde bg-superficie pl-9 pr-11 text-sm text-texto outline-none placeholder:text-texto-tenue focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento"
        />
        {ajuste.texto && (
          <button type="button" aria-label="Borrar la búsqueda" onClick={() => { ajuste.setTexto(""); campoBusqueda.current?.focus(); }} className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-texto-suave hover:bg-superficie-suave hover:text-texto focus-visible:outline-2 focus-visible:outline-acento"><X className="size-4" aria-hidden="true" /></button>
        )}
      </form>

      <div className="flex items-center gap-2 sm:hidden">
        <button type="button" aria-expanded={filtrosAbiertos} aria-controls={idFiltros} onClick={() => setFiltrosAbiertos((valor) => !valor)} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-acento ring-1 ring-inset ring-borde hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento">
          Filtros
          <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${filtrosAbiertos ? "rotate-180" : ""}`} />
        </button>
        <p className="min-w-0 flex-1 truncate text-xs text-texto-suave">{ajuste.resumen.length > 0 ? ajuste.resumen.join(" · ") : "Todos los globos"}</p>
        {ajuste.hayFiltros && <button type="button" onClick={ajuste.limpiarFiltros} className="min-h-11 shrink-0 px-1 text-xs font-semibold text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento">Quitar filtros</button>}
      </div>

      <div id={idFiltros} className={`${filtrosAbiertos ? "block" : "hidden"} space-y-3 sm:block`}>
        <Familias ajuste={ajuste} />
        <Tamanos ajuste={ajuste} />
        {ajuste.hayFiltros && (
          <button type="button" onClick={ajuste.limpiarFiltros} className="hidden min-h-8 text-xs font-semibold text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento sm:inline-block">Quitar filtros</button>
        )}
      </div>

      <Resultados ajuste={ajuste} />
    </div>
  );
}
