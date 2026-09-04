"use client";

import { useEffect, useState } from "react";
import type { Alerta, ConteoEtiqueta, ConteoImagen, EstadisticasOrdenes as Estadisticas, ReferenciaProducto } from "@/app/api/admin/ordenes/estadisticas/route";

export const ETIQUETAS_CATEGORIA: Record<string, string> = {
  no_asignada: "No asignada",
  general: "General",
  amor_y_amistad: "Amor y amistad",
  halloween: "Halloween",
  navidad: "Navidad",
  xv_anos: "XV años",
  fiesta_infantil: "Fiesta infantil",
  fiesta_generica: "Fiesta genérica",
};

function StatTile({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-borde bg-superficie p-4 shadow-[0_8px_24px_color-mix(in_srgb,var(--texto)_5%,transparent)] sm:p-5 ${className}`}>
      <p className="text-xs text-texto-suave">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-texto">{value}</p>
    </div>
  );
}

/** Barra de dos segmentos con leyenda para desgloses binarios. */
function BarraDosSegmentos({
  titulo,
  a,
  b,
}: {
  titulo: string;
  a: { etiqueta: string; cantidad: number; colorClase: string };
  b: { etiqueta: string; cantidad: number; colorClase: string };
}) {
  const total = a.cantidad + b.cantidad;
  const pctA = total > 0 ? (a.cantidad / total) * 100 : 0;
  const pctB = 100 - pctA;

  return (
    <div className="rounded-xl border border-borde bg-superficie p-4">
      <p className="mb-2 text-xs text-texto-suave">{titulo}</p>
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-superficie-2">
        {pctA > 0 && <div className={`h-full rounded-l-full ${a.colorClase}`} style={{ width: `${pctA}%` }} />}
        {pctB > 0 && <div className={`h-full rounded-r-full ${b.colorClase}`} style={{ width: `${pctB}%` }} />}
      </div>
      <div className="mt-2 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-texto-suave">
          <span className={`size-2 rounded-full ${a.colorClase}`} /> {a.etiqueta} ({a.cantidad})
        </span>
        <span className="flex items-center gap-1.5 text-texto-suave">
          <span className={`size-2 rounded-full ${b.colorClase}`} /> {b.etiqueta} ({b.cantidad})
        </span>
      </div>
    </div>
  );
}

function FilaRanking({ item, maximo, posicion }: { item: ReferenciaProducto; maximo: number; posicion: number }) {
  const pct = maximo > 0 ? (item.vecesReferenciado / maximo) * 100 : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-texto-suave">{posicion}</span>
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-superficie-2">
        {item.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen viene del CDN de Shopify
          <img src={item.imagen} alt={item.titulo} className="size-full object-cover" />
        ) : null}
      </div>
      <span className="w-40 shrink-0 truncate text-xs text-texto" title={item.titulo}>
        {item.titulo}
      </span>
      <div className="relative h-4 flex-1 rounded-full bg-superficie-2">
        <div className="h-full rounded-r-full bg-acento" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-texto">
        {item.vecesReferenciado}
      </span>
    </div>
  );
}

/** Fila de ranking simple (sin imagen) para categorías textuales -- tipo de estructura,
 * elementos no comprados. Mismo spec de barra que FilaRanking. */
function FilaBarraSimple({ item, maximo }: { item: ConteoEtiqueta; maximo: number }) {
  const pct = maximo > 0 ? (item.cantidad / maximo) * 100 : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-44 shrink-0 truncate text-xs capitalize text-texto" title={item.etiqueta}>
        {item.etiqueta}
      </span>
      <div className="relative h-4 flex-1 rounded-full bg-superficie-2">
        <div className="h-full rounded-r-full bg-acento-2" style={{ width: `${Math.max(pct, 3)}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-texto">{item.cantidad}</span>
    </div>
  );
}

/** Item chico con miniatura + título, sin barra -- para listas donde el conteo es siempre 0
 * (productos del catálogo que nunca aparecieron en el dataset) y una barra no aporta nada. */
function ItemCatalogo({ item }: { item: ConteoImagen }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-borde bg-fondo p-2">
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-superficie-2">
        {item.imagen ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen viene del CDN de Shopify
          <img src={item.imagen} alt={item.titulo} className="size-full object-cover" />
        ) : null}
      </div>
      <span className="truncate text-xs text-texto" title={item.titulo}>
        {item.titulo}
      </span>
    </div>
  );
}

const ESTILO_NIVEL: Record<Alerta["nivel"], { badge: string; borde: string; etiqueta: string }> = {
  alta: { badge: "bg-error-suave text-error", borde: "border-error/40", etiqueta: "Alta" },
  media: { badge: "bg-amber-500/10 text-amber-600", borde: "border-amber-500/30", etiqueta: "Media" },
  baja: { badge: "bg-superficie-2 text-texto-suave", borde: "border-borde", etiqueta: "Informativa" },
};

function FilaAlerta({ alerta }: { alerta: Alerta }) {
  const estilo = ESTILO_NIVEL[alerta.nivel];
  return (
    <div className={`rounded-lg border p-3 ${estilo.borde}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${estilo.badge}`}>
          {estilo.etiqueta}
        </span>
        <p className="text-xs font-semibold text-texto">{alerta.titulo}</p>
      </div>
      <p className="text-xs leading-relaxed text-texto-suave">{alerta.detalle}</p>
    </div>
  );
}

/** Salud general: no es un score numérico (daría falsa precisión) -- es un resumen de cuántas
 * alertas hay por nivel, más un veredicto corto derivado de si hay alguna alerta "alta". */
function PanelSalud({ alertas }: { alertas: Alerta[] }) {
  const altas = alertas.filter((a) => a.nivel === "alta").length;
  const medias = alertas.filter((a) => a.nivel === "media").length;
  const bajas = alertas.filter((a) => a.nivel === "baja").length;

  const veredicto =
    altas > 0
      ? "Hay problemas que conviene resolver antes de enviar el dataset a entrenar."
      : medias > 0
        ? "El dataset está usable, pero hay desbalances que vale la pena revisar."
        : "Sin problemas detectados en los chequeos automáticos.";

  return (
    <div className="rounded-xl border border-borde bg-superficie p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">Salud general del dataset</p>
      <p className="mb-3 text-sm text-texto">{veredicto}</p>
      <div className="flex gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-texto-suave">
          <span className="size-2 rounded-full bg-error" /> {altas} alta{altas === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5 text-texto-suave">
          <span className="size-2 rounded-full bg-amber-500" /> {medias} media{medias === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1.5 text-texto-suave">
          <span className="size-2 rounded-full bg-texto-suave" /> {bajas} informativa{bajas === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function Panel({ titulo, children, accion }: { titulo: string; children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borde bg-superficie p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">{titulo}</h3>
        {accion}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function EstadisticasOrdenes() {
  const [datos, setDatos] = useState<Estadisticas | null>(null);
  const [imagenesUltimoEntrenamiento, setImagenesUltimoEntrenamiento] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verTodo, setVerTodo] = useState(false);
  const [verTodoCatalogo, setVerTodoCatalogo] = useState(false);
  const [verTodoSinRepresentacion, setVerTodoSinRepresentacion] = useState(false);

  useEffect(() => {
    let vigente = true;
    Promise.all([
      fetch("/api/admin/ordenes/estadisticas").then((r) => r.json()),
      fetch("/api/lora/overview", { cache: "no-store", headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([data, lora]) => {
        if (!vigente) return;
        if (data.error) setError(data.error);
        else {
          setDatos(data);
          setImagenesUltimoEntrenamiento(lora?.recentRuns?.[0]?.image_count ?? null);
        }
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (error) return <p className="text-xs text-error">{error}</p>;
  if (!datos) return <p className="text-sm text-texto-suave">Cargando…</p>;

  // Fallbacks defensivos: durante un hot-reload en desarrollo la pestaña puede tener por un
  // instante el componente nuevo con datos de una respuesta anterior a que estos campos
  // existieran -- no debe tirar la vista entera por eso.
  const ranking = datos.ranking ?? [];
  const tiposEstructura = datos.tiposEstructura ?? [];
  const elementosNoComprados = datos.elementosNoComprados ?? [];
  const fotos = datos.fotos ?? { totalFotos: 0, ordenesConUnaFoto: 0, ordenesConVariasFotos: 0 };
  const captions = datos.captions ?? { totalCaptions: 0, editadosAMano: 0, generadosPorIa: 0, conProporcionRelativa: 0 };

  // El servidor no tiene la carpeta de órdenes: allí estos números vienen del
  // snapshot publicado, y hay que decirlo para que nadie los lea como frescos.
  const avisoSnapshot = datos.origen === "snapshot"
    ? `Datos del snapshot publicado${datos.generadoEn ? ` el ${new Date(datos.generadoEn).toLocaleString("es-CO")}` : ""}. Esta máquina no tiene la carpeta de órdenes, así que no son datos en vivo.`
    : null;

  const maximoRanking = ranking[0]?.vecesReferenciado ?? 0;
  const LIMITE = 15;
  const visibles = verTodo ? ranking : ranking.slice(0, LIMITE);
  const masMenosReferenciados = [...ranking].slice(-5).reverse();

  // `ranking` ya trae `mapeado` calculado por SKU contra el catálogo local -- separar los que
  // no matchearon da la lista de productos comprados que el catálogo no reconoce (ranking ya
  // viene ordenado por vecesReferenciado, el filtro preserva ese orden).
  const sinReferencia = ranking.filter((item) => !item.mapeado);
  const maximoSinReferencia = sinReferencia[0]?.vecesReferenciado ?? 0;

  const catalogoSinReferencia = datos.catalogoSinReferencia ?? [];
  const LIMITE_CATALOGO = 24;
  const catalogoVisible = verTodoCatalogo ? catalogoSinReferencia : catalogoSinReferencia.slice(0, LIMITE_CATALOGO);

  const maximoEstructura = tiposEstructura[0]?.cantidad ?? 0;
  const maximoElementos = elementosNoComprados[0]?.cantidad ?? 0;

  const acabados = datos.acabados ?? [];
  const maximoAcabado = acabados[0]?.cantidad ?? 0;
  const alertas = datos.alertas ?? [];

  const categorias = datos.categorias ?? [];
  const maximoCategoria = categorias[0]?.cantidad ?? 0;

  const sinRepresentacionVisual = datos.sinRepresentacionVisual ?? [];
  const LIMITE_SIN_REPRESENTACION = 15;
  const sinRepresentacionVisible = verTodoSinRepresentacion
    ? sinRepresentacionVisual
    : sinRepresentacionVisual.slice(0, LIMITE_SIN_REPRESENTACION);
  const maximoSinRepresentacion = sinRepresentacionVisual[0]?.vecesReferenciado ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1 border-b border-borde/70 pb-4">
        <h2 className="text-xl font-semibold tracking-tight text-texto">Resumen del dataset</h2>
        <p className="text-sm text-texto-suave">Cobertura, volumen y consistencia de las referencias analizadas.</p>
      </div>

      {avisoSnapshot && (
        <p className="rounded-xl border border-borde bg-superficie px-4 py-3 text-xs text-texto-suave">{avisoSnapshot}</p>
      )}

      <PanelSalud alertas={alertas} />

      {alertas.length > 0 && (
        <Panel titulo={`Alertas (${alertas.length})`}>
          {alertas.map((a, i) => (
            <FilaAlerta key={i} alerta={a} />
          ))}
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
        <StatTile className="sm:col-span-3" label="Órdenes analizadas" value={String(datos.ordenesAnalizadas)} />
        <StatTile className="sm:col-span-3" label="Referencias totales" value={String(datos.totalReferencias)} />
        <StatTile className="sm:col-span-3" label="Productos distintos" value={String(datos.productosDistintos)} />
        <StatTile
          className="sm:col-span-3"
          label="% mapeadas al catálogo"
          value={datos.totalReferencias > 0 ? `${Math.round((datos.referenciasMapeadas / datos.totalReferencias) * 100)}%` : "—"}
        />
        <StatTile className="sm:col-span-3" label="Fotos totales" value={String(fotos.totalFotos)} />
        <StatTile className="sm:col-span-3" label="Captions generados" value={String(captions.totalCaptions)} />
        <StatTile
          className="sm:col-span-3"
          label="% con proporción relativa"
          value={captions.totalCaptions > 0 ? `${Math.round((captions.conProporcionRelativa / captions.totalCaptions) * 100)}%` : "—"}
        />
        <StatTile
          className="sm:col-span-3"
          label="Imágenes entrenadas"
          value={imagenesUltimoEntrenamiento == null ? "—" : String(imagenesUltimoEntrenamiento)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <BarraDosSegmentos
          titulo="Referencias con match en el catálogo"
          a={{ etiqueta: "Mapeadas", cantidad: datos.referenciasMapeadas, colorClase: "bg-exito" }}
          b={{ etiqueta: "Sin match", cantidad: datos.referenciasSinMapear, colorClase: "bg-texto-suave/40" }}
        />
        <BarraDosSegmentos
          titulo="Fotos por orden"
          a={{ etiqueta: "1 foto", cantidad: fotos.ordenesConUnaFoto, colorClase: "bg-acento" }}
          b={{ etiqueta: "2 o más fotos", cantidad: fotos.ordenesConVariasFotos, colorClase: "bg-acento-2" }}
        />
        <BarraDosSegmentos
          titulo="Proporción relativa de tamaños"
          a={{ etiqueta: "Presente en la foto", cantidad: captions.conProporcionRelativa, colorClase: "bg-acento" }}
          b={{
            etiqueta: "No aplica",
            cantidad: captions.totalCaptions - captions.conProporcionRelativa,
            colorClase: "bg-texto-suave/40",
          }}
        />
      </div>

      <Panel
        titulo="Productos más referenciados"
        accion={
          ranking.length > LIMITE && (
            <button type="button" onClick={() => setVerTodo((v) => !v)} className="text-xs text-acento hover:underline">
              {verTodo ? "Ver menos" : `Ver los ${ranking.length}`}
            </button>
          )
        }
      >
        {visibles.map((item, i) => (
          <FilaRanking key={item.clave} item={item} maximo={maximoRanking} posicion={i + 1} />
        ))}
      </Panel>

      {masMenosReferenciados.length > 0 && (
        <Panel titulo="Menos referenciados">
          {masMenosReferenciados.map((item, i) => (
            <FilaRanking
              key={item.clave}
              item={item}
              maximo={maximoRanking}
              posicion={ranking.length - masMenosReferenciados.length + i + 1}
            />
          ))}
        </Panel>
      )}

      {sinReferencia.length > 0 && (
        <Panel titulo="Elementos sin referencia en el catálogo">
          {sinReferencia.slice(0, LIMITE).map((item, i) => (
            <FilaRanking key={item.clave} item={item} maximo={maximoSinReferencia} posicion={i + 1} />
          ))}
        </Panel>
      )}

      {sinRepresentacionVisual.length > 0 && (
        <Panel
          titulo={`Comprados pero sin confirmar visibles en ninguna foto (${sinRepresentacionVisual.length})`}
          accion={
            sinRepresentacionVisual.length > LIMITE_SIN_REPRESENTACION && (
              <button
                type="button"
                onClick={() => setVerTodoSinRepresentacion((v) => !v)}
                className="text-xs text-acento hover:underline"
              >
                {verTodoSinRepresentacion ? "Ver menos" : `Ver los ${sinRepresentacionVisual.length}`}
              </button>
            )
          }
        >
          {sinRepresentacionVisible.map((item, i) => (
            <FilaRanking key={item.clave} item={item} maximo={maximoSinRepresentacion} posicion={i + 1} />
          ))}
        </Panel>
      )}

      {catalogoSinReferencia.length > 0 && (
        <Panel
          titulo={`Productos del catálogo sin ninguna referencia en el dataset (${catalogoSinReferencia.length})`}
          accion={
            catalogoSinReferencia.length > LIMITE_CATALOGO && (
              <button type="button" onClick={() => setVerTodoCatalogo((v) => !v)} className="text-xs text-acento hover:underline">
                {verTodoCatalogo ? "Ver menos" : `Ver los ${catalogoSinReferencia.length}`}
              </button>
            )
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {catalogoVisible.map((item) => (
              <ItemCatalogo key={item.titulo} item={item} />
            ))}
          </div>
        </Panel>
      )}

      {categorias.length > 0 && (
        <Panel titulo="Categorías de entrenamiento">
          {categorias.map((item) => (
            <FilaBarraSimple
              key={item.etiqueta}
              item={{ etiqueta: ETIQUETAS_CATEGORIA[item.etiqueta] ?? item.etiqueta, cantidad: item.cantidad }}
              maximo={maximoCategoria}
            />
          ))}
        </Panel>
      )}

      {acabados.length > 0 && (
        <Panel titulo={`Acabados Sempertex representados en las fotos (${acabados.length})`}>
          {acabados.map((item) => (
            <FilaBarraSimple key={item.etiqueta} item={item} maximo={maximoAcabado} />
          ))}
        </Panel>
      )}

      {datos.tiposEstructura.length > 0 && (
        <Panel titulo="Tipos de estructura en las fotos">
          {datos.tiposEstructura.map((item) => (
            <FilaBarraSimple key={item.etiqueta} item={item} maximo={maximoEstructura} />
          ))}
        </Panel>
      )}

      {datos.elementosNoComprados.length > 0 && (
        <Panel titulo="Elementos más comunes visibles pero no comprados">
          {datos.elementosNoComprados.map((item) => (
            <FilaBarraSimple key={item.etiqueta} item={item} maximo={maximoElementos} />
          ))}
        </Panel>
      )}
    </div>
  );
}
