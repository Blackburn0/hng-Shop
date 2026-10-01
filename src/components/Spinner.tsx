// Rebuilt from Design/loader.svg: a thick ring with a white-to-transparent
// conic gradient, spinning. Decorative — pair it with visible status text.
export function Spinner({ size = 300, className = "" }: { size?: number; className?: string }) {
  const thickness = Math.round(size * 0.1);
  return (
    <div
      aria-hidden="true"
      className={`animate-spin rounded-full [animation-duration:1.4s] motion-reduce:animate-none ${className}`}
      style={{
        width: size,
        height: size,
        background: "conic-gradient(from 90deg, rgba(255,255,255,1), rgba(196,196,196,0))",
        mask: `radial-gradient(farthest-side, transparent calc(100% - ${thickness}px), #000 calc(100% - ${thickness - 1}px))`,
      }}
    />
  );
}
