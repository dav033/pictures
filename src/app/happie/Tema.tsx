import { derivarTemaId, type TemaId } from "@sempertex/happie-package-ia";

const FONDOS: Record<TemaId, string> = {
  tropical: "linear-gradient(155deg, #0f766e 0%, #14b8a6 46%, #fb7185 100%)",
  neon: "#0d0b14",
  corazones: "linear-gradient(150deg, #9f1239 0%, #e11d48 48%, #fda4af 100%)",
  huellitas: "linear-gradient(150deg, #78350f 0%, #b45309 50%, #fcd34d 100%)",
  destellos: "linear-gradient(155deg, #451a03 0%, #b45309 42%, #fbbf24 100%)",
  puntos: "linear-gradient(150deg, #4c1d95 0%, #7c3aed 52%, #c084fc 100%)",
  verde: "linear-gradient(150deg, #14532d 0%, #16a34a 55%, #86efac 100%)",
  azul: "linear-gradient(155deg, #1e3a8a 0%, #3b82f6 50%, #bfdbfe 100%)",
  rosa: "linear-gradient(150deg, #831843 0%, #ec4899 50%, #fbcfe8 100%)",
  luxury: "linear-gradient(150deg, #18181b 0%, #292524 58%, #57534e 100%)",
  futbol: "linear-gradient(150deg, #14532d 0%, #15803d 52%, #4ade80 100%)",
  marca: "linear-gradient(150deg, #2e1065 0%, #6d3fe0 52%, #d6216f 100%)",
};

function MotivoTropical() {
  return (
    <>
      <circle cx="214" cy="30" r="26" fill="#fde68a" opacity="0.88" />
      <g fill="#065f46" opacity="0.48">
        <path d="M-6 118 C 26 76, 44 62, 38 26 C 62 68, 50 92, 30 118 Z" />
        <path d="M262 118 C 240 80, 254 56, 274 38 C 268 74, 280 96, 284 118 Z" />
      </g>
      <path d="M14 118 C 38 78, 28 50, 6 28 C 54 44, 66 88, 56 118 Z" fill="#a3e635" opacity="0.52" />
      <g fill="#ffffff">
        <circle className="happie-flota" cx="120" cy="36" r="3" opacity="0.7" />
        <circle className="happie-flota" cx="164" cy="72" r="2.4" opacity="0.55" style={{ animationDelay: "1.3s" }} />
      </g>
    </>
  );
}

function MotivoNeon() {
  return (
    <>
      <defs>
        <radialGradient id="neon-c" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neon-m" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f0abfc" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#f0abfc" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g stroke="#2dd4bf" strokeWidth="0.5" opacity="0.2">
        <path d="M0 40h268M0 80h268M60 0v118M130 0v118M200 0v118" />
      </g>
      <circle className="happie-brilla" cx="66" cy="46" r="58" fill="url(#neon-c)" />
      <circle className="happie-brilla" cx="206" cy="76" r="62" fill="url(#neon-m)" style={{ animationDelay: "1.4s" }} />
      <path d="M24 86 C 68 34, 110 102, 152 50 C 188 12, 226 74, 252 40" fill="none" stroke="#22d3ee" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 86 C 68 34, 110 102, 152 50 C 188 12, 226 74, 252 40" fill="none" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
    </>
  );
}

function MotivoCorazones() {
  return (
    <>
      <g fill="#ffffff" opacity="0.3">
        <path d="M40 30c0-7 10-10 14-3 4-7 14-4 14 3 0 9-14 17-14 17S40 39 40 30z" />
        <path d="M188 76c0-6 8-8 11-2.4 3-5.6 11-3.6 11 2.4 0 7.2-11 13.6-11 13.6S188 83.2 188 76z" />
      </g>
      <g fill="#fff1f2" opacity="0.85">
        <path className="happie-flota" d="M120 40c0-9 13-13 18-4 5-9 18-5 18 4 0 11.6-18 22-18 22S120 51.6 120 40z" />
      </g>
      <g fill="#ffffff" opacity="0.55">
        <path className="happie-flota" d="M70 84c0-5 7-7 9.6-2 2.4-5 9.6-3 9.6 2 0 6.4-9.6 12-9.6 12S70 90.4 70 84z" style={{ animationDelay: "1.6s" }} />
        <path d="M230 26c0-4.4 6-6 8.4-1.6 2-4.4 8.4-2.8 8.4 1.6 0 5.6-8.4 10.4-8.4 10.4S230 31.6 230 26z" />
      </g>
    </>
  );
}

function MotivoHuellitas() {
  return (
    <>
      <g fill="#ffffff" opacity="0.55">
        <g transform="translate(44 34) rotate(-14)">
          <ellipse cx="0" cy="8" rx="9" ry="7.5" />
          <circle cx="-8" cy="-4" r="3.2" />
          <circle cx="-2.6" cy="-8" r="3.2" />
          <circle cx="3.4" cy="-8" r="3.2" />
          <circle cx="8.6" cy="-3.4" r="3.2" />
        </g>
        <g transform="translate(150 74) rotate(12)">
          <ellipse cx="0" cy="8" rx="10.5" ry="8.6" />
          <circle cx="-9" cy="-4.6" r="3.7" />
          <circle cx="-3" cy="-9.2" r="3.7" />
          <circle cx="4" cy="-9.2" r="3.7" />
          <circle cx="10" cy="-4" r="3.7" />
        </g>
      </g>
      <g fill="#fffbeb" opacity="0.85">
        <g className="happie-flota" transform="translate(214 32) rotate(-8)">
          <ellipse cx="0" cy="9" rx="11.5" ry="9.4" />
          <circle cx="-10" cy="-5" r="4" />
          <circle cx="-3.4" cy="-10" r="4" />
          <circle cx="4.4" cy="-10" r="4" />
          <circle cx="11" cy="-4.4" r="4" />
        </g>
      </g>
    </>
  );
}

function MotivoDestellos() {
  return (
    <>
      <g fill="#fffbeb">
        <path className="happie-brilla" d="M74 22 L79 39 L96 44 L79 49 L74 66 L69 49 L52 44 L69 39 Z" />
        <path className="happie-brilla" d="M188 56 L192 69 L205 73 L192 77 L188 90 L184 77 L171 73 L184 69 Z" style={{ animationDelay: "1.1s" }} />
        <path className="happie-brilla" d="M136 18 L139 27 L148 30 L139 33 L136 42 L133 33 L124 30 L133 27 Z" style={{ animationDelay: "2.1s" }} opacity="0.85" />
      </g>
      <g fill="#fde68a" opacity="0.7">
        <circle className="happie-flota" cx="34" cy="78" r="3" />
        <circle className="happie-flota" cx="232" cy="26" r="2.4" style={{ animationDelay: "1.5s" }} />
        <circle cx="110" cy="92" r="2" />
        <circle cx="246" cy="94" r="2.6" />
      </g>
    </>
  );
}

function MotivoPuntos() {
  return (
    <g>
      <circle className="happie-flota" cx="46" cy="32" r="11" fill="#fbbf24" />
      <circle className="happie-flota" cx="106" cy="66" r="9" fill="#f472b6" style={{ animationDelay: ".8s" }} />
      <circle className="happie-flota" cx="168" cy="28" r="12" fill="#22d3ee" style={{ animationDelay: "1.6s" }} />
      <circle className="happie-flota" cx="222" cy="70" r="10" fill="#a3e635" style={{ animationDelay: "2.3s" }} />
      <circle cx="76" cy="94" r="6" fill="#ffffff" opacity="0.75" />
      <circle cx="140" cy="98" r="5" fill="#fbbf24" opacity="0.7" />
      <circle cx="200" cy="102" r="6.5" fill="#f472b6" opacity="0.65" />
      <circle cx="252" cy="34" r="5" fill="#ffffff" opacity="0.6" />
      <circle cx="16" cy="76" r="6" fill="#22d3ee" opacity="0.6" />
    </g>
  );
}

function MotivoVerde() {
  return (
    <>
      <g fill="#052e16" opacity="0.34">
        <path d="M0 118 C 28 82, 24 50, 4 22 C 52 42, 62 90, 50 118 Z" />
        <path d="M268 118 C 246 86, 256 52, 278 28 C 268 74, 280 94, 284 118 Z" />
      </g>
      <g fill="#bbf7d0" opacity="0.5">
        <path d="M82 118 C 100 90, 96 62, 80 42 C 116 58, 122 94, 112 118 Z" />
        <path className="happie-flota" d="M180 118 C 164 92, 170 66, 188 48 C 184 86, 198 100, 202 118 Z" />
      </g>
      <g fill="#ffffff">
        <circle className="happie-flota" cx="140" cy="34" r="3" opacity="0.6" />
        <circle cx="228" cy="58" r="2.2" opacity="0.5" />
      </g>
    </>
  );
}

function MotivoAzul() {
  return (
    <>
      <g fill="#ffffff">
        <path className="happie-brilla" d="M62 26 L66 38 L78 42 L66 46 L62 58 L58 46 L46 42 L58 38 Z" opacity="0.9" />
        <path className="happie-brilla" d="M196 62 L199 71 L208 74 L199 77 L196 86 L193 77 L184 74 L193 71 Z" opacity="0.8" style={{ animationDelay: "1.3s" }} />
      </g>
      <path d="M0 96 C 46 74, 82 108, 134 88 C 186 68, 224 100, 268 82" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.4" />
      <path d="M0 108 C 52 90, 88 118, 140 100 C 192 82, 228 110, 268 96" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.28" />
      <g fill="#dbeafe">
        <circle className="happie-flota" cx="120" cy="34" r="3.4" opacity="0.8" />
        <circle className="happie-flota" cx="238" cy="30" r="2.6" opacity="0.7" style={{ animationDelay: "1.8s" }} />
        <circle cx="30" cy="66" r="2.2" opacity="0.6" />
      </g>
    </>
  );
}

function MotivoRosa() {
  return (
    <>
      <g fill="#ffffff">
        <path className="happie-brilla" d="M78 24 L83 40 L99 45 L83 50 L78 66 L73 50 L57 45 L73 40 Z" />
        <path className="happie-brilla" d="M184 58 L188 70 L200 74 L188 78 L184 90 L180 78 L168 74 L180 70 Z" opacity="0.85" style={{ animationDelay: "1.2s" }} />
      </g>
      <g fill="#fce7f3" opacity="0.75">
        <circle className="happie-flota" cx="138" cy="30" r="4" />
        <circle className="happie-flota" cx="238" cy="40" r="3" style={{ animationDelay: "1.7s" }} />
        <circle cx="36" cy="80" r="3.4" />
        <circle cx="118" cy="96" r="2.6" />
        <circle cx="216" cy="98" r="3" />
      </g>
    </>
  );
}

function MotivoLuxury() {
  return (
    <>
      <g fill="none" stroke="#d4af37" strokeWidth="1.5" opacity="0.85">
        <path d="M134 14 A 46 46 0 0 1 134 106 A 46 46 0 0 1 134 14 Z" />
        <path d="M134 26 A 34 34 0 0 1 134 94 A 34 34 0 0 1 134 26 Z" opacity="0.6" />
      </g>
      <g stroke="#d4af37" strokeWidth="1.2" opacity="0.55">
        <path d="M0 59h72M196 59h72" />
        <path d="M42 40l14 19-14 19M226 40l-14 19 14 19" fill="none" />
      </g>
      <g fill="#d4af37">
        <path className="happie-brilla" d="M134 44 L137.5 55.5 L149 59 L137.5 62.5 L134 74 L130.5 62.5 L119 59 L130.5 55.5 Z" />
      </g>
      <g fill="#fde68a" opacity="0.5">
        <circle cx="76" cy="26" r="2" />
        <circle cx="196" cy="94" r="2" />
      </g>
    </>
  );
}

function MotivoFutbol() {
  return (
    <>
      <g stroke="#ffffff" strokeWidth="1.4" fill="none" opacity="0.32">
        <path d="M0 59h268" />
        <circle cx="134" cy="59" r="26" />
        <path d="M0 24h34v70H0M268 24h-34v70h34" />
      </g>
      <g className="happie-flota">
        <circle cx="134" cy="59" r="21" fill="#ffffff" />
        <g fill="#14532d">
          <path d="M134 45 l8 5.6 -3 9.4 h-10 l-3 -9.4 Z" />
          <path d="M134 38 l-9.4 4 1.4 5 8-5.6 8 5.6 1.4-5 Z" opacity="0.85" />
          <path d="M117 65 l3.4 9.6 4.6-1.4 -2.4-8.6 Z" opacity="0.85" />
          <path d="M151 65 l-3.4 9.6 -4.6-1.4 2.4-8.6 Z" opacity="0.85" />
        </g>
      </g>
      <g fill="#ffffff" opacity="0.45">
        <circle cx="42" cy="30" r="2.6" />
        <circle cx="226" cy="88" r="2.6" />
      </g>
    </>
  );
}

function MotivoMarca() {
  return (
    <>
      <g>
        <ellipse className="happie-flota" cx="74" cy="46" rx="17" ry="21" fill="#fde68a" opacity="0.9" />
        <path d="M74 67 l-3 11 h6 z" fill="#fde68a" opacity="0.75" />
        <ellipse className="happie-flota" cx="134" cy="34" rx="15" ry="19" fill="#ffffff" opacity="0.92" style={{ animationDelay: ".9s" }} />
        <path d="M134 53 l-2.6 10 h5.2 z" fill="#ffffff" opacity="0.7" />
        <ellipse className="happie-flota" cx="192" cy="50" rx="16" ry="20" fill="#f9a8d4" opacity="0.9" style={{ animationDelay: "1.8s" }} />
        <path d="M192 70 l-2.8 10 h5.6 z" fill="#f9a8d4" opacity="0.75" />
      </g>
      <g fill="#ffffff" opacity="0.6">
        <rect x="34" y="86" width="5" height="5" rx="1" transform="rotate(28 36 88)" />
        <rect x="232" y="80" width="5" height="5" rx="1" transform="rotate(-20 234 82)" />
        <rect x="106" y="96" width="4" height="4" rx="1" transform="rotate(42 108 98)" />
      </g>
    </>
  );
}

const MOTIVOS: Record<TemaId, () => React.JSX.Element> = {
  tropical: MotivoTropical,
  neon: MotivoNeon,
  corazones: MotivoCorazones,
  huellitas: MotivoHuellitas,
  destellos: MotivoDestellos,
  puntos: MotivoPuntos,
  verde: MotivoVerde,
  azul: MotivoAzul,
  rosa: MotivoRosa,
  luxury: MotivoLuxury,
  futbol: MotivoFutbol,
  marca: MotivoMarca,
};

/** Arte generativo del paquete: el tema sale del nombre (ver `derivarTemaId`
 * en @sempertex/happie-package-ia), sin imágenes que mantener. */
export function ArtePaquete({
  nombre,
  className,
  children,
}: {
  nombre: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const tema = derivarTemaId(nombre);
  const Motivo = MOTIVOS[tema];
  return (
    <div className={className} style={{ position: "relative", overflow: "hidden", background: FONDOS[tema] }}>
      <svg viewBox="0 0 268 118" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <Motivo />
      </svg>
      {children}
    </div>
  );
}

export function colorMiniatura(nombre: string): string {
  return FONDOS[derivarTemaId(nombre)];
}

/** Un tipo de evento (ej. "Boda", "XV años") no es el nombre de un paquete
 * puntual, así que no tiene palabra clave de estilo que derivar — cada tipo
 * curado (ver `tiposEventoCurados` en @sempertex/happie-package-ia) tiene su
 * propia foto generada por IA, mapeada por `clave`. */
const IMAGENES_TIPO: Record<string, string> = {
  cumpleanos: "/happie/tipo-cumpleanos.jpg",
  "fiesta-infantil": "/happie/tipo-fiesta-infantil.jpg",
  boda: "/happie/tipo-boda.jpg",
  "xv-anos": "/happie/tipo-xv-anos.jpg",
  "san-valentin": "/happie/tipo-san-valentin.jpg",
  aniversario: "/happie/tipo-aniversario.jpg",
};

export function ArteTipoEvento({ clave, className }: { clave: string; className?: string }) {
  const src = IMAGENES_TIPO[clave] ?? IMAGENES_TIPO.cumpleanos;
  return (
    <div className={className} style={{ position: "relative", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ya vienen comprimidas por el pipeline de generación */}
      <img src={src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
}
