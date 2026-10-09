"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { claveRender } from "@/lib/modulos-estudio/clave-render";
import { FORMATOS_ESTUDIO, TIPOS_ESTUDIO, nombreColor, resolverConfig, type ConfigModulo } from "@/lib/modulos-estudio/configuracion";
import type { TipoModulo } from "@/lib/globos3d/modulos";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { PanelRender } from "./PanelRender";
import { PedidoEnTexto, type PedidoResuelto } from "./PedidoEnTexto";
import { SelectorColorModulo } from "./SelectorColorModulo";
import { VisorModulo, type VisorModuloHandle } from "./VisorModulo";
import { useRenderModulo } from "./useRenderModulo";

/**
 * El estudio de módulos (REQ-011): solo dúo, trío, cuarteto, quinteto y sexteto, con el color y el acabado de cada globo,
 * sobre un fondo continuo y sin nada alrededor, y el render con IA que se guarda para no pagarlo dos veces.
 */
const INICIAL: ConfigModulo = { tipo: "pareja", formatoId: "R-12", colores: ["915", "040"] };

/** Texto negro o blanco según el fondo, para el número que va dentro de cada globo. */
function textoSobre(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 150 ? "#1c1425" : "#ffffff";
}

/** Cuánto se queda marcado en 3D el globo que se acaba de elegir: lo justo para ver cuál es, sin ensuciar la imagen. */
const MARCA_MS = 1600;

const rotulo = "text-xs font-semibold uppercase tracking-wider text-texto-suave";
const chip = (activo: boolean) => `min-h-10 rounded-full px-4 text-sm font-medium ring-1 transition-colors ${activo ? "bg-acento text-sobre-acento ring-acento" : "bg-superficie text-texto ring-borde hover:bg-superficie-suave"}`;

export function EstudioModulos() {
  const [config, setConfig] = useState<ConfigModulo>(INICIAL);
  const [elegido, setElegido] = useState(0);
  const [vistaElegida, setVistaElegida] = useState<"3d" | "render" | null>(null);
  const [marcado, setMarcado] = useState<number | null>(null);
  const visorRef = useRef<VisorModuloHandle>(null);

  useEffect(() => {
    if (marcado === null) return;
    const reloj = setTimeout(() => setMarcado(null), MARCA_MS);
    return () => clearTimeout(reloj);
  }, [marcado]);

  const clave = useMemo(() => claveRender(config), [config]);
  const avisos = useMemo(() => {
    const r = resolverConfig(config);
    return r.ok ? r.avisos : [];
  }, [config]);
  const capturar = useCallback(() => visorRef.current?.capturar() ?? null, []);
  const { estado, generar, base } = useRenderModulo(config, clave, capturar);

  const urlRender = estado.fase === "guardado" || estado.fase === "lista" ? estado.url : null;
  const vista = urlRender ? vistaElegida ?? "render" : "3d";

  const cambiar = (siguiente: ConfigModulo, globo = elegido) => {
    setConfig(siguiente);
    setElegido(Math.min(globo, siguiente.colores.length - 1));
    setVistaElegida(null);
  };
  const cambiarTipo = (tipo: TipoModulo) => {
    const globos = TIPOS_ESTUDIO.find((t) => t.id === tipo)?.globos ?? config.colores.length;
    cambiar({ ...config, tipo, colores: Array.from({ length: globos }, (_, i) => config.colores[i % config.colores.length]!) });
  };
  const elegirColor = (codigo: string) => cambiar({ ...config, colores: config.colores.map((c, i) => (i === elegido ? codigo : c)) });
  const aplicarPedido = (p: PedidoResuelto) => cambiar({ tipo: p.tipo, formatoId: p.formatoId, colores: p.colores }, 0);
  const aplicarATodos = () => cambiar({ ...config, colores: config.colores.map(() => config.colores[elegido]!) });

  const codigoElegido = config.colores[elegido] ?? config.colores[0]!;
  const resumen = [...new Set(config.colores)].map(nombreColor).join(" + ");
  const nombreTipo = TIPOS_ESTUDIO.find((t) => t.id === config.tipo)?.nombre ?? config.tipo;

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-6xl content-start gap-5 px-4 py-4 sm:py-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8 lg:py-10">
      <header className="flex flex-col gap-1 lg:col-span-2">
        <Link href="/3d" className="inline-flex min-h-8 items-center gap-1.5 self-start text-xs font-medium text-texto-suave hover:text-texto">
          <ArrowLeft className="size-3.5" aria-hidden /> Taller 3D
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-texto">Estudio de módulos</h1>
        <p className="text-sm text-texto-suave">Elige el módulo, el color y el acabado de cada globo, y genera una foto realista.</p>
      </header>

      <section aria-label="Vista del módulo" className="flex flex-col gap-3 lg:row-span-2 lg:sticky lg:top-6">
        <div
          className="relative aspect-square w-full overflow-hidden rounded-3xl shadow-[0_24px_60px_-34px_rgba(40,30,70,0.45)] ring-1 ring-black/5"
          style={{ background: "radial-gradient(120% 95% at 50% 38%, #fcfcfd 0%, #efeff2 52%, #dfdfe5 100%)" }}
        >
          <VisorModulo ref={visorRef} config={config} globoElegido={vista === "3d" ? marcado : null} />
          {vista === "render" && urlRender && (
            // eslint-disable-next-line @next/next/no-img-element -- imagen del caché (blob o data URL): next/image no aplica
            <img src={urlRender} alt={`Render con IA: ${nombreTipo} ${resumen}`} className="absolute inset-0 size-full object-cover" />
          )}
          {urlRender && (
            <div role="group" aria-label="Qué ver" className="absolute inset-x-0 bottom-3 flex justify-center">
              <div className="flex rounded-full bg-white/85 p-1 text-xs font-medium shadow-sm ring-1 ring-black/10 backdrop-blur">
                {([["3d", "Vista 3D"], ["render", "Render IA"]] as const).map(([id, texto]) => (
                  <button key={id} type="button" aria-pressed={vista === id} onClick={() => setVistaElegida(id)}
                    className={`min-h-9 rounded-full px-4 ${vista === id ? "bg-[#1c1425] text-white" : "text-[#1c1425]"}`}>{texto}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="px-1 text-center text-sm text-texto-suave"><span className="font-medium text-texto">{nombreTipo}</span> · {config.formatoId} · {resumen}</p>
      </section>

      <div className="lg:col-start-2 lg:row-start-3">
        <PanelRender estado={estado} base={base} viendoRender={vista === "render"} onGenerar={generar} onVerRender={() => setVistaElegida("render")} />
      </div>

      <section aria-label="Configuración" className="flex flex-col gap-5 rounded-2xl bg-superficie p-4 ring-1 ring-borde lg:col-start-2 lg:row-start-2">
        <PedidoEnTexto onResuelto={aplicarPedido} />

        <div className="flex flex-col gap-2">
          <h2 className={rotulo}>Módulo</h2>
          <div role="radiogroup" aria-label="Tipo de módulo" className="flex flex-wrap gap-2">
            {TIPOS_ESTUDIO.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={t.id === config.tipo} onClick={() => cambiarTipo(t.id)} className={chip(t.id === config.tipo)}>
                {t.nombre} <span className="opacity-70">· {t.globos}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className={rotulo}>Tamaño del globo</h2>
          <div role="radiogroup" aria-label="Tamaño del globo" className="flex flex-wrap gap-2">
            {FORMATOS_ESTUDIO.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={f === config.formatoId} onClick={() => cambiar({ ...config, formatoId: f })} className={chip(f === config.formatoId)}>{f}</button>
            ))}
          </div>
          {avisos.map((a) => <p key={a} className="text-xs text-aviso">{a}</p>)}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className={rotulo}>Globos</h2>
          <div role="radiogroup" aria-label="Globo a pintar" className="flex flex-wrap gap-2.5">
            {config.colores.map((codigo, i) => {
              const hex = referenciaPorCodigo(codigo)?.hexGlobo ?? "#cccccc";
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={i === elegido}
                  aria-label={`Globo ${i + 1}: ${nombreColor(codigo)}`}
                  onClick={() => { setElegido(i); setMarcado(i); }}
                  className={`grid size-12 place-items-center rounded-full text-sm font-semibold ring-2 ring-offset-2 ring-offset-superficie transition-shadow ${i === elegido ? "ring-acento" : "ring-transparent hover:ring-borde"}`}
                  style={{ background: hex, color: textoSobre(hex), boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14)" }}
                >{i + 1}</button>
              );
            })}
          </div>
          <SelectorColorModulo formatoId={config.formatoId} codigo={codigoElegido} etiqueta={`globo ${elegido + 1}`} onElegir={elegirColor} />
          {config.colores.length > 1 && (
            <button type="button" onClick={aplicarATodos} className="min-h-10 self-start rounded-full px-3 text-xs font-medium text-acento ring-1 ring-borde hover:bg-superficie-suave">Usar este color en todos los globos</button>
          )}
        </div>
      </section>
    </main>
  );
}
