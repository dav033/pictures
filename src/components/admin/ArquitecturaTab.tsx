"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CategoriaArquitectura,
  ElementoArquitectura,
  NivelElemento,
  NivelPresupuesto,
  ProductoShopifyArquitectura,
  TipoArquitectura,
} from "@/lib/arquitectura";

type Arquitectura = {
  categorias: CategoriaArquitectura[];
  tipos: TipoArquitectura[];
  elementos: ElementoArquitectura[];
};

type Seccion = "elementos" | "categorias" | "tipos";

const NIVEL_NOMBRE: Record<NivelElemento, string> = {
  component: "Componente",
  module: "Módulo",
  composition: "Composición",
};

const PRESUPUESTO_NOMBRE: Record<NivelPresupuesto, string> = {
  low: "Low",
  mid: "Mid",
  high: "High",
};

const EMPTY: Arquitectura = { categorias: [], tipos: [], elementos: [] };

function dinero(value: number | null): string {
  if (value === null) return "Sin precio";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

async function leerJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la operación.");
  return data;
}

export function ArquitecturaTab() {
  const [seccion, setSeccion] = useState<Seccion>("elementos");
  const [data, setData] = useState<Arquitectura>(EMPTY);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consulta, setConsulta] = useState("");
  const [shopify, setShopify] = useState<ProductoShopifyArquitectura[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [productoActivo, setProductoActivo] = useState<ProductoShopifyArquitectura | null>(null);
  const [elementoActivo, setElementoActivo] = useState<ElementoArquitectura | null>(null);
  const [categoriaActiva, setCategoriaActiva] = useState<CategoriaArquitectura | "new" | null>(null);
  const [tipoActivo, setTipoActivo] = useState<TipoArquitectura | "new" | null>(null);

  useEffect(() => {
    let vigente = true;
    fetch("/api/admin/arquitectura")
      .then(leerJson)
      .then((next) => { if (vigente) setData(next); })
      .catch((cause) => { if (vigente) setError(cause instanceof Error ? cause.message : "No se pudo cargar la biblioteca."); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    let vigente = true;
    const timeout = window.setTimeout(async () => {
      setBuscando(true);
      try {
        const result = await leerJson(await fetch(`/api/admin/arquitectura?view=shopify&q=${encodeURIComponent(consulta)}`));
        if (vigente) setShopify(result.productos ?? []);
      } catch (cause) {
        if (vigente) setError(cause instanceof Error ? cause.message : "No se pudo consultar Shopify.");
      } finally {
        if (vigente) setBuscando(false);
      }
    }, 250);
    return () => { vigente = false; window.clearTimeout(timeout); };
  }, [consulta, data.elementos.length]);

  async function ejecutar(payload: object) {
    setGuardando(true);
    setError(null);
    try {
      const next = await leerJson(await fetch("/api/admin/arquitectura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setData({ categorias: next.categorias, tipos: next.tipos, elementos: next.elementos });
      setProductoActivo(null);
      setElementoActivo(null);
      setCategoriaActiva(null);
      setTipoActivo(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el cambio.");
      return false;
    } finally {
      setGuardando(false);
    }
  }

  const conteos = useMemo(() => ({
    componentes: data.elementos.filter((element) => element.nivel === "component").length,
    modulos: data.elementos.filter((element) => element.nivel === "module").length,
    composiciones: data.elementos.filter((element) => element.nivel === "composition").length,
  }), [data.elementos]);

  if (cargando) return <p className="py-16 text-center text-sm text-texto-suave">Preparando biblioteca visual…</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-borde pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-texto">Arquitectura de decoraciones</h2>
          <p className="mt-1 text-sm leading-6 text-texto-suave">
            Clasifica productos del CDN de Shopify como componentes, módulos o composiciones. Un mismo elemento puede participar en varias ocasiones.
          </p>
        </div>
        <div className="flex gap-4 text-right tabular-nums">
          <Metric value={conteos.componentes} label="componentes" />
          <Metric value={conteos.modulos} label="módulos" />
          <Metric value={conteos.composiciones} label="composiciones" />
        </div>
      </header>

      {error && (
        <div className="flex items-start justify-between gap-4 rounded-xl bg-error-suave px-4 py-3 text-sm text-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold underline underline-offset-4">Cerrar</button>
        </div>
      )}

      <nav className="flex gap-5 overflow-x-auto border-b border-borde" aria-label="Secciones de arquitectura">
        {([
          ["elementos", "Biblioteca"],
          ["categorias", `Categorías · ${data.categorias.length}`],
          ["tipos", `Tipos · ${data.tipos.length}`],
        ] as Array<[Seccion, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSeccion(id)}
            className={`shrink-0 border-b-2 px-1 pb-3 text-sm font-medium transition ${seccion === id ? "border-acento text-texto" : "border-transparent text-texto-suave hover:text-texto"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {seccion === "elementos" && (
        <ElementosView
          data={data}
          shopify={shopify}
          consulta={consulta}
          setConsulta={setConsulta}
          buscando={buscando}
          productoActivo={productoActivo}
          elementoActivo={elementoActivo}
          onProducto={setProductoActivo}
          onElemento={(element) => {
            setElementoActivo(element);
            setProductoActivo(null);
          }}
          onCancelar={() => { setProductoActivo(null); setElementoActivo(null); }}
          onGuardar={ejecutar}
          guardando={guardando}
        />
      )}

      {seccion === "categorias" && (
        <TaxonomyView
          mode="category"
          items={data.categorias}
          active={categoriaActiva}
          onActive={setCategoriaActiva}
          onExecute={ejecutar}
          saving={guardando}
        />
      )}

      {seccion === "tipos" && (
        <TaxonomyView
          mode="type"
          items={data.tipos}
          active={tipoActivo}
          onActive={setTipoActivo}
          onExecute={ejecutar}
          saving={guardando}
        />
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div><p className="text-lg font-semibold text-texto">{value}</p><p className="text-[11px] text-texto-suave">{label}</p></div>;
}

function ElementosView(props: {
  data: Arquitectura;
  shopify: ProductoShopifyArquitectura[];
  consulta: string;
  setConsulta: (value: string) => void;
  buscando: boolean;
  productoActivo: ProductoShopifyArquitectura | null;
  elementoActivo: ElementoArquitectura | null;
  onProducto: (product: ProductoShopifyArquitectura | null) => void;
  onElemento: (element: ElementoArquitectura) => void;
  onCancelar: () => void;
  onGuardar: (payload: object) => Promise<boolean>;
  guardando: boolean;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-texto">Elementos clasificados</h3>
            <p className="mt-1 text-xs text-texto-suave">Fuente única para recuperación, recetas y próximo dataset.</p>
          </div>
          <span className="text-xs tabular-nums text-texto-suave">{props.data.elementos.length} total</span>
        </div>
        {props.data.elementos.length === 0 ? (
          <div className="rounded-xl bg-superficie-2 px-6 py-12 text-center">
            <p className="text-sm font-medium text-texto">Biblioteca vacía</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-texto-suave">Busca un producto de Shopify y define cómo participa en las decoraciones.</p>
          </div>
        ) : (
          <div className="divide-y divide-borde">
            {props.data.elementos.map((element) => (
              <article key={element.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-4 py-4">
                <ProductImage src={element.imagenUrl} alt="" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-semibold text-texto">{element.nombre}</h4>
                    {!element.disponible && <span className="rounded-full bg-aviso-suave px-2 py-0.5 text-[10px] font-semibold text-aviso">Sin inventario</span>}
                  </div>
                  <p className="mt-1 text-xs text-texto-suave">{NIVEL_NOMBRE[element.nivel]} · {element.tipoNombre}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {element.categorias.map((category) => (
                      <span key={category.id} className="rounded-full px-2 py-1 text-[10px] font-medium text-texto" style={{ backgroundColor: `${category.color}28` }}>{category.nombre}</span>
                    ))}
                    {element.categorias.length === 0 && <span className="text-[11px] text-aviso">Sin categoría</span>}
                  </div>
                </div>
                <button type="button" onClick={() => props.onElemento(element)} className="self-start text-xs font-semibold text-acento underline underline-offset-4">Editar</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="lg:sticky lg:top-5 lg:self-start">
        {props.productoActivo || props.elementoActivo ? (
          <ElementoEditor
            product={props.productoActivo}
            element={props.elementoActivo}
            categories={props.data.categorias}
            types={props.data.tipos}
            saving={props.guardando}
            onCancel={props.onCancelar}
            onSave={props.onGuardar}
          />
        ) : (
          <div className="rounded-2xl bg-superficie-2 p-4">
            <h3 className="text-sm font-semibold text-texto">Agregar desde Shopify</h3>
            <p className="mt-1 text-xs leading-5 text-texto-suave">La imagen permanece en CDN; SQLite guarda clasificación y relaciones.</p>
            <label className="mt-4 block text-xs font-medium text-texto" htmlFor="shopify-search">Buscar producto</label>
            <input
              id="shopify-search"
              value={props.consulta}
              onChange={(event) => props.setConsulta(event.target.value)}
              placeholder="Feliz cumpleaños, globo R-12…"
              className="mt-2 w-full rounded-xl border border-borde bg-superficie px-3 py-2.5 text-sm text-texto outline-none placeholder:text-texto-suave focus:border-acento"
            />
            <div className="mt-3 max-h-[32rem] divide-y divide-borde overflow-y-auto pr-1">
              {props.buscando ? <p className="py-8 text-center text-xs text-texto-suave">Buscando…</p> : props.shopify.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  disabled={product.agregado}
                  onClick={() => props.onProducto(product)}
                  className="grid w-full grid-cols-[3rem_minmax(0,1fr)] gap-3 py-3 text-left disabled:opacity-45"
                >
                  <ProductImage src={product.imagenUrl} alt="" compact />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-texto">{product.nombre}</span>
                    <span className="mt-1 block text-[11px] text-texto-suave">{product.agregado ? "Ya agregado" : `${dinero(product.precioMin)} · ${product.disponible ? "Disponible" : "Sin inventario"}`}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function ProductImage({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) {
  const size = compact ? "h-12 w-12" : "h-[4.5rem] w-[4.5rem]";
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- URLs remotas variables provenientes de Shopify.
    <img src={src} alt={alt} className={`${size} rounded-xl bg-white object-contain p-1`} />
  ) : <div className={`${size} grid place-items-center rounded-xl bg-superficie text-[10px] text-texto-suave`}>Sin foto</div>;
}

function ElementoEditor(props: {
  product: ProductoShopifyArquitectura | null;
  element: ElementoArquitectura | null;
  categories: CategoriaArquitectura[];
  types: TipoArquitectura[];
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: object) => Promise<boolean>;
}) {
  const source = props.product;
  const element = props.element;
  const shopifyProductId = source?.id ?? element?.shopifyProductoId ?? "";
  const [name, setName] = useState(source?.nombre ?? element?.nombre ?? "");
  const [typeId, setTypeId] = useState(element?.tipoId ?? props.types.find((type) => type.nivel === "component")?.id ?? "");
  const [categoryIds, setCategoryIds] = useState<string[]>(element?.categoriaIds ?? []);
  const [budgets, setBudgets] = useState<NivelPresupuesto[]>(element?.presupuestos ?? ["low", "mid", "high"]);
  const [notes, setNotes] = useState(element?.notas ?? "");

  function toggle<T extends string>(list: T[], value: T, setter: (next: T[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await props.onSave({
      action: "save_element",
      id: element?.id,
      shopifyProductoId: shopifyProductId,
      tipoId: typeId,
      nombre: name,
      categoriaIds: categoryIds,
      presupuestos: budgets,
      notas: notes,
      activo: true,
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl bg-superficie-2 p-4">
      <div className="flex items-start gap-3">
        <ProductImage src={source?.imagenUrl ?? element?.imagenUrl ?? null} alt="" compact />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-texto">{element ? "Editar elemento" : "Clasificar producto"}</h3>
          <p className="mt-1 truncate text-xs text-texto-suave">{source?.nombre ?? element?.nombre}</p>
        </div>
      </div>

      <label className="mt-5 block text-xs font-medium text-texto">Nombre en biblioteca</label>
      <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-2 w-full rounded-xl border border-borde bg-superficie px-3 py-2.5 text-sm text-texto outline-none focus:border-acento" />

      <label className="mt-4 block text-xs font-medium text-texto">Tipo y nivel</label>
      <Select value={typeId} onValueChange={setTypeId} required>
        <SelectTrigger className="mt-2 w-full max-w-none border border-borde bg-superficie text-sm font-normal text-texto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["component", "module", "composition"] as NivelElemento[]).map((level) => {
            const opciones = props.types.filter((type) => type.nivel === level && type.activo);
            if (opciones.length === 0) return null;
            return (
              <SelectGroup key={level}>
                <SelectLabel>{NIVEL_NOMBRE[level]}</SelectLabel>
                {opciones.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.nombre}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-texto">Categorías</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {props.categories.filter((category) => category.activa).map((category) => {
            const checked = categoryIds.includes(category.id);
            return (
              <label key={category.id} className={`cursor-pointer rounded-full px-2.5 py-1.5 text-[11px] font-medium transition ${checked ? "text-texto" : "bg-superficie text-texto-suave"}`} style={checked ? { backgroundColor: `${category.color}35` } : undefined}>
                <input type="checkbox" checked={checked} onChange={() => toggle(categoryIds, category.id, setCategoryIds)} className="sr-only" />
                {category.nombre}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-texto">Presupuesto compatible</legend>
        <div className="mt-2 flex gap-2">
          {(["low", "mid", "high"] as NivelPresupuesto[]).map((budget) => (
            <label key={budget} className={`cursor-pointer rounded-full px-3 py-1.5 text-[11px] font-semibold ${budgets.includes(budget) ? "bg-acento-suave text-acento" : "bg-superficie text-texto-suave"}`}>
              <input type="checkbox" checked={budgets.includes(budget)} onChange={() => toggle(budgets, budget, setBudgets)} className="sr-only" />
              {PRESUPUESTO_NOMBRE[budget]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block text-xs font-medium text-texto">Notas para IA</label>
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Uso visual, restricciones o composición…" className="mt-2 w-full resize-none rounded-xl border border-borde bg-superficie px-3 py-2.5 text-sm text-texto outline-none placeholder:text-texto-suave focus:border-acento" />

      <div className="mt-5 flex gap-2">
        <button type="submit" disabled={props.saving || !typeId} className="ui-button-primary flex-1">{props.saving ? "Guardando…" : "Guardar"}</button>
        <button type="button" onClick={props.onCancel} className="rounded-xl px-3 py-2 text-xs font-semibold text-texto-suave hover:text-texto">Cancelar</button>
      </div>
      {element && (
        <button type="button" disabled={props.saving} onClick={() => props.onSave({ action: "delete_element", id: element.id })} className="mt-3 w-full text-center text-xs font-semibold text-error underline underline-offset-4">Quitar de biblioteca</button>
      )}
    </form>
  );
}

function TaxonomyView(props: {
  mode: "category" | "type";
  items: CategoriaArquitectura[] | TipoArquitectura[];
  active: CategoriaArquitectura | TipoArquitectura | "new" | null;
  onActive: (item: never) => void;
  onExecute: (payload: object) => Promise<boolean>;
  saving: boolean;
}) {
  const isCategory = props.mode === "category";
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem]">
      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-texto">{isCategory ? "Ocasiones disponibles" : "Tipos visuales"}</h3>
            <p className="mt-1 text-xs text-texto-suave">{isCategory ? "Un elemento puede pertenecer a varias categorías." : "Cada tipo define nivel y función dentro de una decoración."}</p>
          </div>
          <button type="button" onClick={() => props.onActive("new" as never)} className="ui-button-primary">Agregar</button>
        </div>
        <div className="divide-y divide-borde">
          {props.items.map((item) => (
            <button key={item.id} type="button" onClick={() => props.onActive(item as never)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 py-4 text-left">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  {isCategory && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: (item as CategoriaArquitectura).color }} />}
                  <span className="text-sm font-semibold text-texto">{item.nombre}</span>
                </span>
                <span className="mt-1 block text-xs text-texto-suave">{isCategory ? (item as CategoriaArquitectura).descripcion : `${NIVEL_NOMBRE[(item as TipoArquitectura).nivel]} · ${(item as TipoArquitectura).descripcion ?? "Sin descripción"}`}</span>
              </span>
              <span className="text-xs tabular-nums text-texto-suave">{item.elementos} elementos</span>
            </button>
          ))}
        </div>
      </section>
      <aside className="lg:sticky lg:top-5 lg:self-start">
        {props.active ? (
          <TaxonomyEditor mode={props.mode} item={props.active} onExecute={props.onExecute} onCancel={() => props.onActive(null as never)} saving={props.saving} />
        ) : (
          <div className="rounded-2xl bg-superficie-2 p-5">
            <p className="text-sm font-semibold text-texto">Selecciona un registro</p>
            <p className="mt-2 text-xs leading-5 text-texto-suave">Edita nombre y descripción, o agrega uno nuevo sin tocar código.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function TaxonomyEditor(props: {
  mode: "category" | "type";
  item: CategoriaArquitectura | TipoArquitectura | "new";
  onExecute: (payload: object) => Promise<boolean>;
  onCancel: () => void;
  saving: boolean;
}) {
  const current = props.item === "new" ? null : props.item;
  const [name, setName] = useState(current?.nombre ?? "");
  const [description, setDescription] = useState(current?.descripcion ?? "");
  const [color, setColor] = useState(props.mode === "category" && current ? (current as CategoriaArquitectura).color : "#63d8c5");
  const [level, setLevel] = useState<NivelElemento>(props.mode === "type" && current ? (current as TipoArquitectura).nivel : "component");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const creating = props.item === "new";
    await props.onExecute(props.mode === "category"
      ? { action: creating ? "create_category" : "update_category", id: current?.id, nombre: name, descripcion: description, color }
      : { action: creating ? "create_type" : "update_type", id: current?.id, nombre: name, descripcion: description, nivel: level });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl bg-superficie-2 p-4">
      <h3 className="text-sm font-semibold text-texto">{props.item === "new" ? "Nuevo registro" : "Editar registro"}</h3>
      <label className="mt-4 block text-xs font-medium text-texto">Nombre</label>
      <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-2 w-full rounded-xl border border-borde bg-superficie px-3 py-2.5 text-sm text-texto outline-none focus:border-acento" />
      <label className="mt-4 block text-xs font-medium text-texto">Descripción</label>
      <textarea value={description ?? ""} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-borde bg-superficie px-3 py-2.5 text-sm text-texto outline-none focus:border-acento" />
      {props.mode === "category" ? (
        <><label className="mt-4 block text-xs font-medium text-texto">Color identificador</label><input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="mt-2 h-10 w-full cursor-pointer rounded-xl border border-borde bg-superficie p-1" /></>
      ) : (
        <>
          <label className="mt-4 block text-xs font-medium text-texto">Nivel</label>
          <Select value={level} onValueChange={(v) => setLevel(v as NivelElemento)}>
            <SelectTrigger className="mt-2 w-full max-w-none border border-borde bg-superficie text-sm font-normal text-texto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="component">Componente</SelectItem>
              <SelectItem value="module">Módulo</SelectItem>
              <SelectItem value="composition">Composición</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
      <div className="mt-5 flex gap-2">
        <button type="submit" disabled={props.saving} className="ui-button-primary flex-1">{props.saving ? "Guardando…" : "Guardar"}</button>
        <button type="button" onClick={props.onCancel} className="rounded-xl px-3 py-2 text-xs font-semibold text-texto-suave hover:text-texto">Cancelar</button>
      </div>
      {current && (
        <button type="button" disabled={props.saving || current.elementos > 0} title={current.elementos > 0 ? "Reasigna sus elementos antes de eliminar." : undefined} onClick={() => props.onExecute({ action: props.mode === "category" ? "delete_category" : "delete_type", id: current.id })} className="mt-3 w-full text-center text-xs font-semibold text-error underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-35">Eliminar</button>
      )}
    </form>
  );
}
