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

const blurClasses = {
  sm: 'backdrop-blur-sm',
  md: 'backdrop-blur-md',
  lg: 'backdrop-blur-lg',
  xl: 'backdrop-blur-xl',
  '2xl': 'backdrop-blur-2xl',
};

export default function LiquidGlass({
  children,
  className,
  glowColor = 'orange',
  blur = 'xl',
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
        'group relative overflow-hidden rounded-2xl sm:rounded-3xl border transition-all duration-300',
        // Glass Background & Blur
        blurClasses[blur],
        'bg-white/70 dark:bg-[#121218]/80 text-gray-900 dark:text-gray-100',
        'border-orange-500/15 dark:border-white/10',
        'shadow-[0_8px_32px_0_rgba(0,0,0,0.08)] dark:shadow-[0_8px_32px_0_rgba(0,0,0,0.35)]',
        // Hover State
        glowVariants[glowColor],
        className
      )}
      style={{
        boxShadow:
          'inset 0 1px 1px 0 rgba(255, 255, 255, 0.35), 0 8px 32px 0 rgba(0, 0, 0, 0.15)',
      }}
      {...props}
    >
      {/* Top Specular Glare Reflection Bar */}
      <div className="absolute inset-x-0 top-0 h-[35%] bg-gradient-to-b from-white/30 dark:from-white/10 to-transparent pointer-events-none rounded-t-2xl sm:rounded-t-3xl" />

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
