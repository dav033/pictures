'use client';

const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/** 3x3 lattice of dots that pulse in a diagonal wave; static under reduced motion. */
export function LatticeLoader({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" data-testid="lattice-loader" className={`inline-grid grid-cols-3 gap-[3px] ${className}`}>
      {CELLS.map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-acento animate-pulse motion-reduce:animate-none motion-reduce:opacity-60"
          style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 120}ms` }}
        />
      ))}
    </span>
  );
}
