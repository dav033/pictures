"use client";

import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { Calculator, ChevronDown, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { SECCIONES_COSTO, type CotizacionProfesionalResultado, type EntradaCotizacionProfesional, type SeccionCosto } from "@/lib/cotizacion/profesional";
import {
  DESCRIPCIONES_SECCION,
  FalloCotizacionProfesional,
  RESPALDO_COTIZACION_PROFESIONAL,
  TITULOS_SECCION,
  borradorVacio,
  filaVacia,
  formatearPesos,
  leerBorrador,
  posicionTrasDigitos,
  materialesDesdeCotizacion,
  pedirCotizacionProfesional,
  type BorradorProfesional,
  type FilaCosto,
} from "@/lib/cotizacion/borrador-profesional";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { productoCliente } from "@/lib/plan/presentacion-cliente";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
/** Espera tras la última tecla antes de pedirle los totales a Python. */
const ESPERA_CALCULO_MS = 400;
const PREFIJO_GUARDADO = "cotizacion-profesional:";

const claseEntrada = "w-full min-w-0 rounded-lg border bg-fondo px-2 py-1.5 text-[13px] text-texto outline-none placeholder:text-texto-suave/70 focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento";
const bordeEntrada = (invalida: boolean) => (invalida ? "border-error" : "border-borde");

type Props = {
  cotizacion: Cotizacion;
  /** Dentro de la tarjeta de la propuesta: sin sombra propia, como un panel destacado. */
  incrustada?: boolean;
  /** Clave del borrador en la sesión del navegador (el `plan_hash` o el id del mensaje). */
  clave: string;
};

type Calculo =
  | { estado: "vacio" }
  | { estado: "calculando"; previo: Resultado | null }
  | { estado: "listo"; resultado: Resultado }
  | { estado: "error"; mensaje: string; previo: Resultado | null };

/** El resultado de Python y las filas que lo produjeron, para poner cada subtotal en su fila. */
type Resultado = { datos: CotizacionProfesionalResultado; enviadas: Record<SeccionCosto, string[]> };

function leerGuardado(clave: string): BorradorProfesional | null {
  try {
    const texto = window.sessionStorage.getItem(PREFIJO_GUARDADO + clave);
    if (!texto) return null;
    const datos = JSON.parse(texto) as Partial<BorradorProfesional>;
    const vacio = borradorVacio();
    const esFila = (fila: unknown): fila is FilaCosto => typeof fila === "object" && fila !== null
      && ["id", "descripcion", "costo", "cantidad"].every((campo) => typeof (fila as Record<string, unknown>)[campo] === "string");
    const costos = Object.fromEntries(SECCIONES_COSTO.map((seccion) => {
      const filas = datos.costos?.[seccion];
      return [seccion, Array.isArray(filas) ? filas.filter(esFila) : []];
    })) as BorradorProfesional["costos"];
    const precios = Object.fromEntries(Object.entries(datos.precios ?? {}).filter(([, valor]) => typeof valor === "string"));
    return { costos, precios, utilidad: typeof datos.utilidad === "string" ? datos.utilidad : vacio.utilidad };
  } catch {
    return null;
  }
}

function guardar(clave: string, borrador: BorradorProfesional): void {
  try {
    window.sessionStorage.setItem(PREFIJO_GUARDADO + clave, JSON.stringify(borrador));
  } catch {
    // Sin almacenamiento (modo privado, cuota): el borrador vive solo mientras la página siga abierta.
  }
}

let contadorFilas = 0;
function idFila(): string {
  contadorFilas += 1;
  return `fila-${Date.now().toString(36)}-${contadorFilas}`;
}

/**
 * Cotización profesional: sobre los materiales de la cotización (productos y
 * bolsas del catálogo), el decorador escribe su precio por bolsa, su mano de
 * obra, equipos y transporte, costos indirectos y % de utilidad, y ve el
 * precio sugerido al cliente. Nada viene precargado salvo el precio de
 * catálogo de cada bolsa. Python calcula cada total
 * (/api/cotizacion-profesional); aquí solo se escribe y se muestra.
 */
/**
 * Entrada de pesos que se ve con los miles separados mientras se escribe:
 * "1000" aparece como "1.000". El punto es SOLO estetico — lo que se guarda es
 * ese mismo texto y `leerPesos` quita los puntos, asi que el valor enviado a
 * Python sigue siendo 1000.
 *
 * Conserva el cursor por numero de digitos escritos antes de el. Sin eso, al
 * reformatear en cada tecla el cursor salta al final y corregir una cifra en
 * medio ("1.0|00" -> borrar) se vuelve imposible.
 */
function EntradaPesos({ valor, onValor, ...resto }: { valor: string; onValor: (texto: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const ref = useRef<HTMLInputElement>(null);
  const cursor = useRef<number | null>(null);
  useEffect(() => {
    const nodo = ref.current;
    if (cursor.current === null || !nodo) return;
    nodo.setSelectionRange(cursor.current, cursor.current);
    cursor.current = null;
  });
  return (
    <input
      {...resto}
      ref={ref}
      inputMode="numeric"
      value={valor}
      onChange={(evento) => {
        const escrito = evento.target.value;
        const hasta = evento.target.selectionStart ?? escrito.length;
        const digitos = escrito.slice(0, hasta).replace(/\D/g, "").length;
        const formateado = formatearPesos(escrito);
        cursor.current = posicionTrasDigitos(formateado, digitos);
        onValor(formateado);
      }}
    />
  );
}


export function CotizacionProfesional({ cotizacion, clave, incrustada = false }: Props) {
  // El borrador guardado de esta cotización: la tarjeta solo existe en el navegador
  // (los mensajes salen de sessionStorage), así que se lee al crear el estado.
  const [guardado] = useState(() => leerGuardado(clave));
  const [abierta, setAbierta] = useState(guardado !== null);
  const [borrador, setBorrador] = useState<BorradorProfesional>(() => guardado ?? borradorVacio());
  const [calculo, setCalculo] = useState<Calculo>({ estado: "vacio" });
  const { materiales, sinPrecio } = useMemo(() => materialesDesdeCotizacion(cotizacion), [cotizacion]);
  const leido = useMemo(() => leerBorrador(borrador, materiales), [borrador, materiales]);
  // Lo que se envía y las filas que lo forman, como texto: solo un cambio ahí vuelve a calcular.
  const envio = leido.entrada ? JSON.stringify({ entrada: leido.entrada, enviadas: leido.enviadas }) : null;
  const ultimoResultado = useRef<Resultado | null>(null);

  useEffect(() => {
    guardar(clave, borrador);
  }, [clave, borrador]);

  useEffect(() => {
    // Siempre calcula, abierta o no: el precio al cliente se ve en la cabecera.
    if (envio === null) return;
    const { entrada, enviadas } = JSON.parse(envio) as { entrada: EntradaCotizacionProfesional; enviadas: Resultado["enviadas"] };
    const control = new AbortController();
    const temporizador = window.setTimeout(() => {
      setCalculo({ estado: "calculando", previo: ultimoResultado.current });
      pedirCotizacionProfesional(entrada, { signal: control.signal })
        .then((datos) => {
          const resultado = { datos, enviadas };
          ultimoResultado.current = resultado;
          setCalculo({ estado: "listo", resultado });
        })
        .catch((error: unknown) => {
          if (esCancelacion(error)) return;
          const mensaje = error instanceof FalloCotizacionProfesional ? error.message : RESPALDO_COTIZACION_PROFESIONAL;
          setCalculo({ estado: "error", mensaje, previo: ultimoResultado.current });
        });
    }, ESPERA_CALCULO_MS);
    return () => {
      window.clearTimeout(temporizador);
      control.abort();
    };
  }, [envio]);

  if (materiales.length === 0) return null;

  const resultado = calculo.estado === "listo" ? calculo.resultado : calculo.estado === "vacio" ? null : calculo.previo;
  const hayErroresEscritos = leido.entrada === null;

  function cambiarFila(seccion: SeccionCosto, id: string, cambios: Partial<FilaCosto>): void {
    setBorrador((previo) => ({
      ...previo,
      costos: { ...previo.costos, [seccion]: previo.costos[seccion].map((fila) => (fila.id === id ? { ...fila, ...cambios } : fila)) },
    }));
  }

  function agregarFila(seccion: SeccionCosto): void {
    setBorrador((previo) => ({ ...previo, costos: { ...previo.costos, [seccion]: [...previo.costos[seccion], filaVacia(idFila())] } }));
  }

  function quitarFila(seccion: SeccionCosto, id: string): void {
    setBorrador((previo) => ({ ...previo, costos: { ...previo.costos, [seccion]: previo.costos[seccion].filter((fila) => fila.id !== id) } }));
  }

  function cambiarPrecio(variantId: string, texto: string | null): void {
    setBorrador((previo) => {
      const precios = { ...previo.precios };
      if (texto === null) delete precios[variantId];
      else precios[variantId] = texto;
      return { ...previo, precios };
    });
  }

  function subtotalFila(seccion: SeccionCosto, id: string): number | null {
    if (!resultado) return null;
    const indice = resultado.enviadas[seccion].indexOf(id);
    return indice < 0 ? null : resultado.datos[seccion].lineas[indice]?.subtotal_cop ?? null;
  }

  const materialPorVariante = new Map(resultado?.datos.materiales.lineas.map((linea) => [linea.variant_id, linea]) ?? []);

  const datos = resultado?.datos ?? null;
  const otrosCostos = datos ? datos.mano_de_obra.total_cop + datos.equipos_transporte.total_cop + datos.indirectos.total_cop : 0;
  const chips: Array<[string, number]> = datos
    ? [["Materiales", datos.materiales.total_cop], ["Tus costos", otrosCostos], ["Utilidad", datos.utilidad_cop]]
    : [];
  const marco = incrustada
    ? "rounded-2xl bg-linear-to-br from-acento-suave/70 via-superficie to-superficie ring-1 ring-acento/20 ring-inset"
    : "mt-3 w-full rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)]";

  return (
    <section aria-label="Precio al cliente" data-testid="cotizacion-profesional" className={`@container overflow-hidden ${marco}`}>
      <div className="grid items-center gap-x-5 gap-y-3 px-4 py-4 @xl:px-5.5 @2xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-acento to-acento-2 text-white shadow-[0_6px_18px_var(--sombra-acento)]">
            <Calculator className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-acento">Precio al cliente</span>
            <span className="block text-sm text-texto-suave">Materiales de esta propuesta + tus costos + tu utilidad.</span>
            {chips.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Desglose del precio">
                {chips.map(([nombre, valor]) => (
              <li key={nombre} className="rounded-full bg-superficie px-2.5 py-1 text-xs text-texto-suave ring-1 ring-borde-suave ring-inset">
                {nombre} <span className="font-semibold tabular-nums text-texto">{pesos.format(valor)}</span>
              </li>
            ))}
          </ul>
        )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 @2xl:justify-end">
          <p className="@2xl:text-right">
            <span className="block text-2xl font-semibold tracking-tight tabular-nums text-texto @xl:text-3xl">
              {datos ? <NumeroAnimado valor={datos.precio_sugerido_cop} formato="pesos" /> : "—"}
            </span>
            <span className="block text-xs text-texto-suave" aria-live="polite">
              {hayErroresEscritos
                ? "Corrige los campos marcados"
                : calculo.estado === "calculando"
                  ? "Calculando…"
                  : calculo.estado === "error"
                    ? <span className="text-error">{calculo.mensaje}</span>
                    : datos && datos.utilidad_cop > 0 && datos.margen_porcentaje !== null
                      ? `Margen real ${numero.format(datos.margen_porcentaje)} % del precio`
                      : "Sin utilidad todavía"}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setAbierta((valor) => !valor)}
            aria-expanded={abierta}
            className="ui-pressable inline-flex h-10 items-center gap-1.5 rounded-xl bg-acento px-3.5 text-[13px] font-semibold text-sobre-acento hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            {abierta ? "Ocultar costos" : "Agregar mis costos"}
            <ChevronDown className={`size-4 transition-transform ${abierta ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {abierta && (
        <div className="grid gap-6 border-t border-borde-suave px-4 pb-5 pt-4 @xl:px-5.5 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <div className="grid gap-x-8">
              {SECCIONES_COSTO.map((seccion) => (
                <SeccionCostos
                  key={seccion}
                  seccion={seccion}
                  clave={clave}
                  filas={borrador.costos[seccion]}
                  invalidas={leido.invalidas}
                  subtotal={(id) => subtotalFila(seccion, id)}
                  total={datos?.[seccion].total_cop ?? null}
                  onCambiar={(id, cambios) => cambiarFila(seccion, id, cambios)}
                  onAgregar={() => agregarFila(seccion)}
                  onQuitar={(id) => quitarFila(seccion, id)}
                />
              ))}
            </div>

            <details className="group mt-6 rounded-xl ring-1 ring-borde-suave ring-inset">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-[13px] font-semibold text-texto focus-visible:outline-2 focus-visible:outline-acento">
                <span>
                  Materiales · {materiales.length} {materiales.length === 1 ? "producto" : "productos"}
                  <span className="block text-xs font-normal text-texto-suave">Precio de catálogo por bolsa; cámbialo si compras a otro precio.</span>
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {datos && pesos.format(datos.materiales.total_cop)}
                  <ChevronDown className="size-4 text-texto-suave transition-transform group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>
              <ul className="grid gap-x-6 border-t border-borde-suave px-3.5" aria-label="Materiales del precio al cliente">
                {materiales.map((material) => {
                  const escrito = borrador.precios[material.variant_id];
                  const editado = escrito !== undefined;
                  const invalido = leido.preciosInvalidos.has(material.variant_id);
                  const calculado = materialPorVariante.get(material.variant_id);
                  const idEntrada = `precio-${clave}-${material.variant_id}`;
                  return (
                    <li key={material.variant_id} className="grid grid-cols-[minmax(0,1fr)_9.5rem_5.5rem] items-center gap-x-2.5 border-b border-borde-suave py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-texto">{productoCliente(material.descripcion)}</span>
                        <span className="block text-xs text-texto-suave">{numero.format(material.paquetes)} {material.paquetes === 1 ? "bolsa" : "bolsas"}{editado ? " · precio tuyo" : ""}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <label htmlFor={idEntrada} className="sr-only">Precio por bolsa de {productoCliente(material.descripcion)}</label>
                        <EntradaPesos
                          id={idEntrada}
                          valor={editado ? escrito : numero.format(material.precio_paquete_catalogo_cop)}
                          onValor={(texto) => cambiarPrecio(material.variant_id, texto)}
                          aria-invalid={invalido}
                          className={`${claseEntrada} ${invalido ? "border-error" : editado ? "border-acento" : "border-borde"} text-right tabular-nums`}
                        />
                        {editado && (
                          <button
                            type="button"
                            onClick={() => cambiarPrecio(material.variant_id, null)}
                            aria-label={`Volver al precio de catálogo de ${productoCliente(material.descripcion)}`}
                            title={`Catálogo: ${pesos.format(material.precio_paquete_catalogo_cop)}`}
                            className="grid size-7 shrink-0 place-items-center rounded-lg text-texto-suave hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento"
                          >
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                      <span className="text-right text-[13px] font-semibold tabular-nums text-texto">{calculado ? pesos.format(calculado.subtotal_cop) : "—"}</span>
                    </li>
                  );
                })}
              </ul>
              {sinPrecio > 0 && (
                <p className="px-3.5 py-2 text-xs text-aviso">
                  {sinPrecio === 1 ? "Una línea de la cotización no tiene" : `${sinPrecio} líneas de la cotización no tienen`} producto o precio en el catálogo y no se incluyen.
                </p>
              )}
            </details>
          </div>

          <aside className="@3xl:sticky @3xl:top-4 @3xl:self-start">
            <div className="rounded-2xl bg-superficie p-4 ring-1 ring-borde-suave ring-inset">
              <label htmlFor={`utilidad-${clave}`} className="block text-[13px] font-semibold text-texto">Tu utilidad</label>
              <span className="mt-1.5 flex items-center gap-2">
                <input
                  id={`utilidad-${clave}`}
                  inputMode="decimal"
                  value={borrador.utilidad}
                  onChange={(evento) => setBorrador((previo) => ({ ...previo, utilidad: evento.target.value }))}
                  aria-invalid={leido.utilidadInvalida}
                  aria-describedby={`utilidad-ayuda-${clave}`}
                  placeholder="0"
                  className={`${claseEntrada} ${bordeEntrada(leido.utilidadInvalida)} w-24 text-right text-base font-semibold tabular-nums`}
                />
                <span className="text-sm text-texto-suave">%</span>
              </span>
              <span id={`utilidad-ayuda-${clave}`} className="mt-1 block text-xs text-texto-suave">Sobre el total de costos.</span>
              <Resumen resultado={datos} calculo={calculo} hayErroresEscritos={hayErroresEscritos} incluyeIva={cotizacion.incluyeIva} />
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function SeccionCostos(props: {
  seccion: SeccionCosto;
  clave: string;
  filas: FilaCosto[];
  invalidas: Set<string>;
  subtotal: (id: string) => number | null;
  total: number | null;
  onCambiar: (id: string, cambios: Partial<FilaCosto>) => void;
  onAgregar: () => void;
  onQuitar: (id: string) => void;
}) {
  const { seccion, clave, filas, invalidas, subtotal, total } = props;
  const titulo = TITULOS_SECCION[seccion];
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-texto">{titulo}</h3>
        {total !== null && filas.length > 0 && <span className="text-[13px] font-semibold tabular-nums text-texto">{pesos.format(total)}</span>}
      </div>
      <p className="mt-0.5 text-xs text-texto-suave">{DESCRIPCIONES_SECCION[seccion]}</p>
      {filas.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label={titulo}>
          {filas.map((fila) => {
            const invalida = invalidas.has(fila.id);
            const base = `${seccion}-${clave}-${fila.id}`;
            const valor = subtotal(fila.id);
            return (
              <li key={fila.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_auto] items-center gap-2 @xl:grid-cols-[minmax(0,1fr)_8rem_5rem_6.5rem_auto]">
                <input
                  aria-label={`Descripción (${titulo})`}
                  id={`${base}-descripcion`}
                  value={fila.descripcion}
                  maxLength={120}
                  onChange={(evento) => props.onCambiar(fila.id, { descripcion: evento.target.value })}
                  placeholder="Descripción"
                  aria-invalid={invalida && !fila.descripcion.trim()}
                  className={`${claseEntrada} ${bordeEntrada(invalida && !fila.descripcion.trim())} col-span-4 @xl:col-span-1`}
                />
                <EntradaPesos
                  aria-label={`Costo unitario (${titulo})`}
                  valor={fila.costo}
                  onValor={(texto) => props.onCambiar(fila.id, { costo: texto })}
                  placeholder="Costo unit."
                  aria-invalid={invalida}
                  className={`${claseEntrada} ${bordeEntrada(invalida)} text-right tabular-nums`}
                />
                <input
                  aria-label={`Cantidad (${titulo})`}
                  inputMode="decimal"
                  value={fila.cantidad}
                  onChange={(evento) => props.onCambiar(fila.id, { cantidad: evento.target.value })}
                  placeholder="Cant."
                  aria-invalid={invalida}
                  className={`${claseEntrada} ${bordeEntrada(invalida)} text-right tabular-nums`}
                />
                <span className="text-right text-[13px] tabular-nums text-texto">{valor === null ? "—" : pesos.format(valor)}</span>
                <button
                  type="button"
                  onClick={() => props.onQuitar(fila.id)}
                  aria-label={`Quitar fila de ${titulo.toLowerCase()}`}
                  className="grid size-7 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={props.onAgregar}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-acento"
      >
        <Plus className="size-3.5" aria-hidden="true" />Agregar {titulo.toLowerCase()}
      </button>
    </div>
  );
}

function Resumen({ resultado, calculo, hayErroresEscritos, incluyeIva }: { resultado: CotizacionProfesionalResultado | null; calculo: Calculo; hayErroresEscritos: boolean; incluyeIva: boolean }) {
  const filas: Array<[string, number]> = resultado
    ? [
      ["Materiales", resultado.materiales.total_cop],
      [TITULOS_SECCION.mano_de_obra, resultado.mano_de_obra.total_cop],
      [TITULOS_SECCION.equipos_transporte, resultado.equipos_transporte.total_cop],
      [TITULOS_SECCION.indirectos, resultado.indirectos.total_cop],
    ]
    : [];
  return (
    <div className="mt-4 border-t border-borde-suave pt-3">
      <p className="text-xs text-texto-suave" aria-live="polite">
        {hayErroresEscritos
          ? "Completa o corrige los campos marcados para ver el precio."
          : calculo.estado === "calculando"
            ? "Calculando…"
            : calculo.estado === "error"
              ? <span className="text-error">{calculo.mensaje}</span>
              : `Materiales a precio ${incluyeIva ? "con IVA" : "sin IVA"} más tus costos.`}
      </p>
      {resultado && (
        <>
          <dl className="mt-2 space-y-1 text-[13px]">
            {filas.map(([nombre, valor]) => (
              <div key={nombre} className="flex justify-between gap-3">
                <dt className="text-texto-suave">{nombre}</dt>
                <dd className="tabular-nums text-texto">{pesos.format(valor)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-borde-suave pt-1 font-medium">
              <dt className="text-texto">Total costos</dt>
              <dd className="tabular-nums text-texto">{pesos.format(resultado.total_costos_cop)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-texto-suave">Utilidad{resultado.utilidad_porcentaje === null ? "" : ` (${numero.format(resultado.utilidad_porcentaje)} %)`}</dt>
              <dd className="tabular-nums text-texto">{pesos.format(resultado.utilidad_cop)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-borde-suave pt-3">
            <span>
              <span className="block text-xs font-medium text-acento">Precio sugerido al cliente</span>
              {resultado.margen_porcentaje !== null && resultado.utilidad_cop > 0 && (
                <span className="block text-xs text-texto-suave">Tu margen real: {numero.format(resultado.margen_porcentaje)} % del precio</span>
              )}
            </span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums text-texto"><NumeroAnimado valor={resultado.precio_sugerido_cop} formato="pesos" /></span>
          </div>
        </>
      )}
    </div>
  );
}
