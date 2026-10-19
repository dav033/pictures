"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

export function ImageInput({
  label,
  helper,
  initialUrl,
  onFile,
}: {
  label: string;
  helper?: string;
  initialUrl?: string | null;
  onFile: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(initialUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function alSeleccionar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    onFile(file);

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    if (file) {
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setPreview(url);
    } else {
      objectUrlRef.current = null;
      setPreview(initialUrl ?? null);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-texto-suave">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={alSeleccionar}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-borde bg-superficie transition hover:border-acento/50"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-32 w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 py-8 text-texto-suave">
            <Camera className="size-6" aria-hidden />
            <span className="text-sm">Subir imagen</span>
          </span>
        )}
      </button>
      {helper && <p className="mt-1 text-xs text-texto-suave">{helper}</p>}
    </div>
  );
}
