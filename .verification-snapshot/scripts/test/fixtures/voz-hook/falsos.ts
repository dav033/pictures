/**
 * Micrófono, grabadora, Web Audio y red falsos para probar `useDictado` en un navegador de verdad (sin permisos ni dispositivos).
 * Todo lo que el hook hace queda anotado en `window.__voz` para que la prueba lo mire.
 */

export type LlamadaFalsa = {
  url: string;
  tipo: string | null;
  bytes: number;
  abortada: boolean;
  responder: (status: number, cuerpo: unknown) => void;
};

export type EstadoFalso = {
  /** Orden en que ocurrió lo importante: «contexto» (Web Audio) antes de «microfono» (getUserMedia). */
  orden: string[];
  pistasAbiertas: number;
  contextosCerrados: number;
  grabadorasDetenidas: number;
  llamadas: LlamadaFalsa[];
  /** La próxima llamada a `getUserMedia` falla con este error (`name`). */
  fallaMicrofono: string | null;
};

declare global {
  interface Window {
    __voz: EstadoFalso;
  }
}

export function instalarFalsos(): EstadoFalso {
  const estado: EstadoFalso = { orden: [], pistasAbiertas: 0, contextosCerrados: 0, grabadorasDetenidas: 0, llamadas: [], fallaMicrofono: null };
  window.__voz = estado;

  const flujoFalso = (): MediaStream => {
    estado.pistasAbiertas += 1;
    let abierta = true;
    const pista = { stop: () => { if (abierta) { abierta = false; estado.pistasAbiertas -= 1; } } };
    return { getTracks: () => [pista] } as unknown as MediaStream;
  };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        estado.orden.push("microfono");
        await new Promise((r) => setTimeout(r, 20));
        if (estado.fallaMicrofono) { const nombre = estado.fallaMicrofono; estado.fallaMicrofono = null; throw new DOMException("sin permiso", nombre); }
        return flujoFalso();
      },
    },
  });

  class GrabadoraFalsa {
    static isTypeSupported(mime: string): boolean { return mime === "audio/webm;codecs=opus"; }
    state: "inactive" | "recording" = "inactive";
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_flujo: MediaStream, opciones?: { mimeType?: string }) { this.mimeType = opciones?.mimeType ?? "audio/webm"; }
    start(): void { this.state = "recording"; }
    stop(): void {
      this.state = "inactive";
      estado.grabadorasDetenidas += 1;
      this.ondataavailable?.({ data: new Blob(["audio-falso"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  Object.defineProperty(window, "MediaRecorder", { configurable: true, value: GrabadoraFalsa });

  class ContextoFalso {
    constructor() { estado.orden.push("contexto"); }
    resume(): Promise<void> { return Promise.resolve(); }
    close(): Promise<void> { estado.contextosCerrados += 1; return Promise.resolve(); }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData: (d: Uint8Array) => d.fill(160) }; }
    createMediaStreamSource() { return { connect: () => undefined }; }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: ContextoFalso });

  window.fetch = ((url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolver, rechazar) => {
    const llamada: LlamadaFalsa = {
      url: String(url),
      tipo: new Headers(init?.headers).get("content-type"),
      bytes: init?.body instanceof Blob ? init.body.size : 0,
      abortada: false,
      responder: (status, cuerpo) => resolver(new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } })),
    };
    init?.signal?.addEventListener("abort", () => { llamada.abortada = true; rechazar(new DOMException("abortada", "AbortError")); });
    estado.llamadas.push(llamada);
  })) as typeof fetch;
  return estado;
}
