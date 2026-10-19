"use client";

import { useEffect, useRef, useState } from "react";

/** Cuánto se espera sin teclear para aplicar lo escrito (ms). */
const ESPERA_MS = 300;

/**
 * El campo de un texto que el visor dibuja con letras de verdad (un rótulo, un neón): lo que se escribe se ve de inmediato en el
 * campo, pero se aplica a la pieza al dejar de teclear o al salir del campo. Cada cambio rearma las letras en el visor (se dibuja el
 * texto y se saca su contorno), y no hace falta rehacerlas con cada letra ni guardar cada intermedio. Con una sola línea es un campo
 * de texto; con más, un área de `lineas` renglones.
 */
export function CampoTexto({ etiqueta, valor, lineas = 1, maxLength, onTexto, aviso }: { etiqueta: string; valor: string; lineas?: number; maxLength: number; onTexto: (texto: string) => void; /** Qué decir de lo escrito si no se dibuja tal cual (se quita o se cambia algo); null si va bien. */ aviso?: (texto: string) => string | null }) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aplicar = useRef(onTexto);
  useEffect(() => { aplicar.current = onTexto; });
  useEffect(() => () => { if (espera.current) clearTimeout(espera.current); }, []);
  const parar = () => { if (espera.current) { clearTimeout(espera.current); espera.current = null; return true; } return false; };
  const escribir = (texto: string) => {
    setBorrador(texto);
    parar();
    espera.current = setTimeout(() => { espera.current = null; aplicar.current(texto); }, ESPERA_MS);
  };
  const soltar = () => {
    if (parar() && borrador !== null) aplicar.current(borrador);
    setBorrador(null);
  };
  const clases = "rounded-md bg-superficie-suave px-2 py-1.5 text-sm";
  const nota = borrador !== null && aviso ? aviso(borrador) : null;
  return (
    <label className="flex flex-col gap-1 text-xs text-texto">{etiqueta}
      {lineas > 1
        ? <textarea value={borrador ?? valor} rows={lineas} maxLength={maxLength} onChange={(e) => escribir(e.target.value)} onBlur={soltar} className={`${clases} resize-none`} />
        : <input type="text" value={borrador ?? valor} maxLength={maxLength} onChange={(e) => escribir(e.target.value)} onBlur={soltar} className={clases} />}
      {nota && <span role="status" className="text-[0.7rem] text-texto-suave">{nota}</span>}
    </label>
  );
}
