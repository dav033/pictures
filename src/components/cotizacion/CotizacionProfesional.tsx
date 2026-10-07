"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator } from "lucide-react";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { SECCIONES_COSTO, type CotizacionProfesionalResultado, type EntradaCotizacionProfesional, type SeccionCosto } from "@/lib/cotizacion/profesional";
import {
  FalloCotizacionProfesional,
  RESPALDO_COTIZACION_PROFESIONAL,
  avisoProductosExcluidos,
  borradorConContenido,
  borradorVacio,
  filaVacia,
  leerBorrador,
  materialesDesdeCotizacion,
  pedirCotizacionProfesional,
  textoSinMateriales,
  type BorradorProfesional,
  type FilaCosto,
} from "@/lib/cotizacion/borrador-profesional";
import { quitarConRastro, reponerFila, type FilaQuitada } from "@/lib/cotizacion/deshacer-fila";
import { leyendaDelPrecio, totalDeLista, vigenciaDe, esNoVigente, type EstadoCalculo } from "@/lib/cotizacion/vigencia";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { CampoGanancia } from "./CampoGanancia";
import { EncabezadoPrecio } from "./EncabezadoPrecio";
import { PreciosMateriales } from "./PreciosMateriales";
import { fichasDeCotizacion } from "@/components/guiado/ficha-globo";
import { ResumenPrecio } from "./ResumenPrecio";
import { SeccionGastos, type FocoFila } from "./SeccionGastos";
import { MaterialesGranel } from "./MaterialesGranel";
import { ModoMateriales } from "./ModoMateriales";
import { useGranel } from "./useGranel";

/** Espera tras la última tecla antes de pedirle los totales a Python. */
const ESPERA_CALCULO_MS = 400;
/** Cuánto tiempo se ofrece devolver un gasto quitado. */
const ESPERA_DESHACER_MS = 10_000;
const PREFIJO_GUARDADO = "cotizacion-profesional:";

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

/** Un borrador vacío no se guarda (y borra el que hubiera): no hay nada que recuperar y no debe abrir el panel al recargar. */
function guardar(clave: string, borrador: BorradorProfesional): void {
  try {
    if (borradorConContenido(borrador)) window.sessionStorage.setItem(PREFIJO_GUARDADO + clave, JSON.stringify(borrador));
    else window.sessionStorage.removeItem(PREFIJO_GUARDADO + clave);
  } catch {
    // Sin almacenamiento (modo privado, cuota): el borrador vive solo mientras la página siga abierta.
  }
}

let contadorFilas = 0;
function idFila(): string {
  contadorFilas += 1;
  return `fila-${Date.now().toString(36)}-${contadorFilas}`;
}

const MARCO_INCRUSTADO = "rounded-2xl bg-linear-to-br from-acento-suave/70 via-superficie to-superficie ring-1 ring-acento/20 ring-inset";
const MARCO_SUELTO = "mt-3 w-full rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)]";

/**
 * Precio al cliente: sobre los materiales de la propuesta (productos del
 * catálogo, con su precio por paquete), quien cotiza suma sus gastos —su
 * trabajo, transporte y equipos, otros— y su ganancia, y ve el precio para el
 * cliente. Nada viene precargado salvo el precio de catálogo de cada paquete.
 * Python calcula cada total (/api/cotizacion-profesional); aquí solo se escribe
 * y se muestra, y cuando lo que se ve ya no corresponde a lo escrito se dice.
 */
export function CotizacionProfesional({ cotizacion, clave, incrustada = false }: Props) {
  // El borrador guardado de esta cotización: la tarjeta solo existe en el navegador
  // (los mensajes salen de sessionStorage), así que se lee al crear el estado.
  const [guardado] = useState(() => leerGuardado(clave));
  // Solo se abre sola si había algo escrito: un borrador vacío no cuenta.
  const [abierta, setAbierta] = useState(guardado !== null && borradorConContenido(guardado));
  const [borrador, setBorrador] = useState<BorradorProfesional>(() => guardado ?? borradorVacio());
  const [calculo, setCalculo] = useState<Calculo>({ estado: "vacio" });
  const [reintento, setReintento] = useState(0);
  const [quitada, setQuitada] = useState<{ seccion: SeccionCosto; fila: FilaQuitada } | null>(null);
  const [foco, setFoco] = useState<FocoFila | null>(null);
  const { materiales, sinPrecio } = useMemo(() => materialesDesdeCotizacion(cotizacion), [cotizacion]);
  // Cómo se ve cada globo (foto, color, tamaño): solo para pintar la lista; no viaja a Python.
  const fichas = useMemo(() => fichasDeCotizacion(cotizacion.lineas), [cotizacion]);
  const leido = useMemo(() => leerBorrador(borrador, materiales), [borrador, materiales]);
  // Globos a granel: solo si el último Python que respondió lo anunció (a uno anterior se le manda lo de siempre).
  const granel = useGranel({
    clave,
    cotizacion,
    materiales,
    borrador,
    leido,
    datos: calculo.estado === "listo" ? calculo.resultado.datos : calculo.estado === "vacio" ? null : calculo.previo?.datos ?? null,
  });
  // Lo que se envía y las filas que lo forman, como texto: solo un cambio ahí vuelve a calcular.
  const envio = granel.envio ? JSON.stringify(granel.envio) : null;
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
  }, [envio, reintento]);

  useEffect(() => {
    if (!quitada) return;
    const temporizador = window.setTimeout(() => setQuitada(null), ESPERA_DESHACER_MS);
    return () => window.clearTimeout(temporizador);
  }, [quitada]);

  const focoListo = useCallback(() => setFoco(null), []);

  if (materiales.length === 0) return <SinMateriales sinPrecio={sinPrecio} incrustada={incrustada} />;

  const resultado = calculo.estado === "listo" ? calculo.resultado : calculo.estado === "vacio" ? null : calculo.previo;
  const datos = resultado?.datos ?? null;
  const estadoCalculo: EstadoCalculo = calculo.estado;
  const vigencia = vigenciaDe({ estado: estadoCalculo, hayResultado: resultado !== null, hayErroresEscritos: granel.envio === null });
  const atenuar = esNoVigente(vigencia);
  const leyenda = leyendaDelPrecio({
    vigencia,
    mensajeError: calculo.estado === "error" ? calculo.mensaje : null,
    ganancia: datos ? { cop: datos.utilidad_cop, margenPorcentaje: datos.margen_porcentaje } : null,
  });
  const reintentar = () => setReintento((valor) => valor + 1);
  const idPanel = `ajustes-${clave}`;

  function cambiarFila(seccion: SeccionCosto, id: string, cambios: Partial<FilaCosto>): void {
    setBorrador((previo) => ({
      ...previo,
      costos: { ...previo.costos, [seccion]: previo.costos[seccion].map((fila) => (fila.id === id ? { ...fila, ...cambios } : fila)) },
    }));
  }

  /** Con `descripcion` (una idea de un toque) la fila llega con qué es y 1 unidad, y el foco va a su valor. */
  function agregarFila(seccion: SeccionCosto, descripcion?: string): void {
    const id = idFila();
    const fila = descripcion ? { ...filaVacia(id), descripcion, cantidad: "1" } : filaVacia(id);
    setBorrador((previo) => ({ ...previo, costos: { ...previo.costos, [seccion]: [...previo.costos[seccion], fila] } }));
    setFoco({ fila: id, campo: descripcion ? "costo" : "descripcion" });
  }

  function quitarFila(seccion: SeccionCosto, id: string): void {
    const { quitada: rastro } = quitarConRastro(borrador.costos[seccion], id);
    setQuitada(rastro ? { seccion, fila: rastro } : null);
    setBorrador((previo) => ({ ...previo, costos: { ...previo.costos, [seccion]: previo.costos[seccion].filter((fila) => fila.id !== id) } }));
  }

  function deshacerQuitar(): void {
    if (!quitada) return;
    const { seccion, fila } = quitada;
    setBorrador((previo) => ({ ...previo, costos: { ...previo.costos, [seccion]: reponerFila(previo.costos[seccion], fila) } }));
    setQuitada(null);
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

  return (
    <section aria-label="Precio al cliente" data-testid="cotizacion-profesional" className={`@container overflow-hidden ${incrustada ? MARCO_INCRUSTADO : MARCO_SUELTO}`}>
      <EncabezadoPrecio
        datos={datos}
        enviadas={resultado?.enviadas ?? null}
        atenuar={atenuar}
        leyenda={leyenda}
        incluyeIva={cotizacion.incluyeIva}
        avisoExcluidos={avisoProductosExcluidos(sinPrecio)}
        abierta={abierta}
        idPanel={idPanel}
        onAlternar={() => setAbierta((valor) => !valor)}
        onReintentar={reintentar}
      />

      {granel.disponible && (
        <ModoMateriales
          clave={clave}
          modo={granel.modo}
          onModo={granel.cambiarModo}
          totalPaquetes={datos?.materiales.total_paquetes_cop ?? null}
          totalGranel={datos?.materiales.granel?.total_cop ?? null}
          globos={datos?.materiales.granel ? { plan: datos.materiales.granel.unidades_plan, extra: datos.materiales.granel.unidades_extra, sobrante: datos.materiales.granel.sobrante_paquetes } : null}
          atenuar={atenuar}
        />
      )}
      {granel.disponible && granel.modo === "granel" && granel.unidades && granel.leido && (
        <MaterialesGranel
          clave={clave}
          materiales={materiales}
          unidades={granel.unidades}
          fichas={fichas}
          borrador={granel.borrador}
          leido={granel.leido}
          lineaDe={(variantId) => materialPorVariante.get(variantId) ?? null}
          resumen={datos?.materiales.granel ?? null}
          totalPaquetes={datos?.materiales.total_paquetes_cop ?? null}
          atenuar={atenuar}
          onPrecio={granel.cambiarPrecio}
          onExtra={granel.cambiarExtra}
        />
      )}

      {abierta && (
        <div id={idPanel} className="grid gap-6 border-t border-borde-suave px-4 pb-5 pt-2 @xl:px-5.5 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <CampoGanancia
              clave={clave}
              valor={borrador.utilidad}
              error={leido.errorUtilidad}
              ganancia={datos && datos.utilidad_porcentaje !== null ? { cop: datos.utilidad_cop, atenuar } : null}
              onValor={(texto) => setBorrador((previo) => ({ ...previo, utilidad: texto }))}
            />

            {SECCIONES_COSTO.map((seccion) => (
              <SeccionGastos
                key={seccion}
                seccion={seccion}
                clave={clave}
                ayudaValor={seccion === SECCIONES_COSTO.find((lista) => borrador.costos[lista].length > 0)}
                filas={borrador.costos[seccion]}
                errores={leido.erroresFila}
                exceso={leido.excesos[seccion]}
                atenuar={atenuar}
                subtotal={(id) => subtotalFila(seccion, id)}
                total={resultado ? totalDeLista(resultado.datos[seccion].total_cop, resultado.enviadas[seccion].length) : null}
                quitada={quitada?.seccion === seccion ? quitada.fila : null}
                foco={foco}
                onFocoListo={focoListo}
                onCambiar={(id, cambios) => cambiarFila(seccion, id, cambios)}
                onAgregar={(descripcion) => agregarFila(seccion, descripcion)}
                onQuitar={(id) => quitarFila(seccion, id)}
                onDeshacer={deshacerQuitar}
              />
            ))}

            {/* A granel, los paquetes no entran al precio: su lista (y su total) se ve solo por paquete. */}
            {granel.modo === "paquete" && <PreciosMateriales
              clave={clave}
              materiales={materiales}
              precios={borrador.precios}
              errores={leido.erroresPrecio}
              atenuar={atenuar}
              subtotalDe={(variantId) => materialPorVariante.get(variantId)?.subtotal_cop ?? null}
              total={datos ? datos.materiales.total_paquetes_cop ?? datos.materiales.total_cop : null}
              onPrecio={cambiarPrecio}
              fichas={fichas}
            />}
            <p className="mt-4 text-xs text-texto-suave">Tus cambios se guardan solos mientras esta pestaña siga abierta.</p>
          </div>

          <aside className="@3xl:sticky @3xl:top-4 @3xl:self-start">
            <ResumenPrecio datos={datos} enviadas={resultado?.enviadas ?? null} atenuar={atenuar} leyenda={leyenda} onReintentar={reintentar} incluyeIva={cotizacion.incluyeIva} />
          </aside>
        </div>
      )}
    </section>
  );
}

/** Sin un solo producto con precio en el catálogo no hay precio que armar: se dice por qué, en vez de desaparecer. */
function SinMateriales({ sinPrecio, incrustada }: { sinPrecio: number; incrustada: boolean }) {
  return (
    <section aria-label="Precio al cliente" data-testid="cotizacion-profesional-sin-materiales" className={`@container overflow-hidden ${incrustada ? MARCO_INCRUSTADO : MARCO_SUELTO}`}>
      <div className="flex items-center gap-3 px-4 py-4 @xl:px-5.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-acento to-acento-2 text-white shadow-[0_6px_18px_var(--sombra-acento)]">
          <Calculator className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-acento">Precio al cliente</span>
          <span className="block text-sm text-texto-suave">{textoSinMateriales(sinPrecio)}</span>
        </span>
      </div>
    </section>
  );
}
