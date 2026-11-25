import React, { useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface LiquidGlassProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'orange' | 'amber' | 'emerald' | 'sapphire' | 'violet' | 'neutral';
  blur?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  intensity?: 'subtle' | 'medium' | 'strong';
  interactive?: boolean;
}

const glowVariants = {
  orange: 'from-orange-500/20 via-amber-500/10 to-transparent hover:border-orange-500/40',
  amber: 'from-amber-500/20 via-yellow-500/10 to-transparent hover:border-amber-400/40',
  emerald: 'from-emerald-500/20 via-teal-500/10 to-transparent hover:border-emerald-400/40',
  sapphire: 'from-blue-500/20 via-cyan-500/10 to-transparent hover:border-cyan-400/40',
  violet: 'from-purple-500/20 via-indigo-500/10 to-transparent hover:border-purple-400/40',
  neutral: 'from-white/10 via-white/5 to-transparent hover:border-white/30',
};


export default function LiquidGlass({
  children,
  className,
  glowColor = 'orange',
  blur: _blur, // kept for callers; the blur now comes from the shared glass recipe
  intensity = 'medium',
  interactive = true,
  ...props
}: LiquidGlassProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        // Shared liquid-glass recipe (index.css): frosted tint, light-catching rim, sheen, shadow.
        'glass-panel group relative overflow-hidden rounded-2xl sm:rounded-3xl transition-all duration-300 text-gray-900 dark:text-gray-100',
        glowVariants[glowColor],
        className
      )}
      {...props}
    >
      {/* Interactive Mouse Spotlight Sheen */}
      {interactive && isHovered && (
        <div
          className="pointer-events-none absolute -inset-px opacity-100 transition-opacity duration-300"
          style={{
            background: `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, rgba(249, 115, 22, 0.12), transparent 80%)`,
          }}
        />
      )}

      {/* Prismatic Corner Flare */}
      <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br from-orange-500/10 via-amber-400/5 to-transparent blur-2xl pointer-events-none" />

      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
