import React from 'react';
import { motion } from 'framer-motion';

export interface GlassIconItem {
  icon: React.ReactNode;
  label?: string;
  sublabel?: string;
  color?: 'amber' | 'orange' | 'emerald' | 'ruby' | 'gold' | 'sapphire' | 'violet';
  customGradient?: string;
  onClick?: () => void;
}

interface GlassIconProps {
  icon: React.ReactNode;
  label?: string;
  sublabel?: string;
  color?: 'amber' | 'orange' | 'emerald' | 'ruby' | 'gold' | 'sapphire' | 'violet';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

const colorVariants = {
  amber: {
    glow: 'from-orange-500/50 via-amber-500/25 to-transparent',
    border: 'border-orange-500/40 group-hover:border-orange-400/80',
    iconColor: 'text-orange-400 group-hover:text-orange-300',
    bg: 'from-orange-500/20 via-amber-500/10 to-zinc-900/60',
    flare: 'bg-orange-400/25',
  },
  orange: {
    glow: 'from-orange-500/50 via-amber-500/25 to-transparent',
    border: 'border-orange-500/40 group-hover:border-orange-400/80',
    iconColor: 'text-orange-400 group-hover:text-orange-300',
    bg: 'from-orange-500/20 via-amber-500/10 to-zinc-900/60',
    flare: 'bg-orange-400/25',
  },
  gold: {
    glow: 'from-amber-400/40 via-yellow-500/20 to-transparent',
    border: 'border-amber-400/30 group-hover:border-amber-300/60',
    iconColor: 'text-amber-300 group-hover:text-amber-200',
    bg: 'from-amber-400/15 via-yellow-500/5 to-zinc-900/40',
    flare: 'bg-amber-300/20',
  },
  emerald: {
    glow: 'from-emerald-500/40 via-teal-500/20 to-transparent',
    border: 'border-emerald-500/30 group-hover:border-emerald-400/60',
    iconColor: 'text-emerald-400 group-hover:text-emerald-300',
    bg: 'from-emerald-500/15 via-teal-500/5 to-zinc-900/40',
    flare: 'bg-emerald-400/20',
  },
  ruby: {
    glow: 'from-rose-500/40 via-red-500/20 to-transparent',
    border: 'border-rose-500/30 group-hover:border-rose-400/60',
    iconColor: 'text-rose-400 group-hover:text-rose-300',
    bg: 'from-rose-500/15 via-red-500/5 to-zinc-900/40',
    flare: 'bg-rose-400/20',
  },
  sapphire: {
    glow: 'from-orange-500/40 via-cyan-500/20 to-transparent',
    border: 'border-orange-500/30 group-hover:border-orange-400/60',
    iconColor: 'text-orange-400 group-hover:text-orange-300',
    bg: 'from-orange-500/15 via-cyan-500/5 to-zinc-900/40',
    flare: 'bg-orange-400/20',
  },
  violet: {
    glow: 'from-purple-500/40 via-indigo-500/20 to-transparent',
    border: 'border-purple-500/30 group-hover:border-purple-400/60',
    iconColor: 'text-purple-400 group-hover:text-purple-300',
    bg: 'from-purple-500/15 via-indigo-500/5 to-zinc-900/40',
    flare: 'bg-purple-400/20',
  },
};

const sizeClasses = {
  sm: 'h-10 w-10 p-2 text-sm rounded-xl',
  md: 'h-14 w-14 p-3 text-lg rounded-2xl',
  lg: 'h-18 w-18 p-4 text-2xl rounded-3xl',
  xl: 'h-24 w-24 p-5 text-3xl rounded-3xl',
};

export function GlassIcon({
  icon,
  label,
  sublabel,
  color = 'amber',
  size = 'md',
  className = '',
  onClick,
}: GlassIconProps) {
  const scheme = colorVariants[color] || colorVariants.amber;

  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.03 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      onClick={onClick}
      className={`group relative flex flex-col items-center ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* Dynamic Ambient Back-Glow */}
      <div
        className={`absolute -inset-1.5 rounded-3xl bg-gradient-to-br ${scheme.glow} opacity-60 blur-lg transition duration-500 group-hover:opacity-100 group-hover:blur-xl`}
      />

      {/* Glass Prism Body */}
      <div
        className={`relative flex items-center justify-center border bg-gradient-to-b ${scheme.bg} ${scheme.border} ${sizeClasses[size]} shadow-xl backdrop-blur-xl transition-all duration-300`}
        style={{
          boxShadow: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.2), 0 8px 32px 0 rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Top Glare Highlight Reflection */}
        <div className="absolute inset-x-0 top-0 h-[40%] rounded-t-2xl bg-gradient-to-b from-white/25 to-transparent pointer-events-none" />

        {/* Icon with Subtle Inner Glow */}
        <div className={`relative z-10 transition duration-300 ${scheme.iconColor}`}>
          {icon}
        </div>

        {/* Diagonal Light Streak */}
        <div className="absolute -inset-full top-0 block transform -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />
      </div>

      {/* Label and Sublabel (if provided) */}
      {label && (
        <span className="mt-2.5 text-center font-serif text-sm font-semibold text-white tracking-wide group-hover:text-orange-200 transition">
          {label}
        </span>
      )}
      {sublabel && (
        <span className="text-[11px] text-gray-400 font-sans tracking-normal">
          {sublabel}
        </span>
      )}
    </motion.div>
  );
}

export function GlassIconGrid({
  items,
  className = '',
}: {
  items: GlassIconItem[];
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 ${className}`}>
      {items.map((item, idx) => (
        <GlassIcon
          key={idx}
          icon={item.icon}
          label={item.label}
          sublabel={item.sublabel}
          color={item.color}
          onClick={item.onClick}
        />
      ))}
    </div>
  );
}

export default GlassIcon;
