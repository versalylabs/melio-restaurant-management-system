import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';

export interface DockItemData {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: string | number;
}

interface DockProps {
  items: DockItemData[];
  className?: string;
  iconSize?: number;
  magnification?: number;
  distance?: number;
}

export function Dock({
  items,
  className = '',
  iconSize = 44,
  magnification = 68,
  distance = 140,
}: DockProps) {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.nav
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 items-center gap-2.5 rounded-full border border-orange-500/20 bg-zinc-950/80 px-4 py-2.5 shadow-2xl shadow-black/80 backdrop-blur-xl ${className || 'flex'}`}
      aria-label="Floating Quick Navigation"
    >
      {items.map((item, idx) => (
        <DockIcon
          key={idx}
          mouseX={mouseX}
          item={item}
          iconSize={iconSize}
          magnification={magnification}
          distance={distance}
        />
      ))}
    </motion.nav>
  );
}

function DockIcon({
  mouseX,
  item,
  iconSize,
  magnification,
  distance,
}: {
  mouseX: any;
  item: DockItemData;
  iconSize: number;
  magnification: number;
  distance: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

  const dist = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(dist, [-distance, 0, distance], [iconSize, magnification, iconSize]);
  const width = useSpring(widthSync, { mass: 0.1, stiffness: 160, damping: 12 });

  return (
    <div className="relative flex flex-col items-center">
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: -38, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="absolute -top-2 pointer-events-none z-50 whitespace-nowrap rounded-lg border border-orange-500/30 bg-zinc-900/95 px-2.5 py-1 text-[11px] font-semibold text-orange-200 shadow-xl backdrop-blur-md"
          >
            {item.label}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        ref={ref}
        style={{ width, height: width }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={item.onClick}
        whileTap={{ scale: 0.88 }}
        className={`relative flex items-center justify-center rounded-2xl transition-colors duration-200 ${
          item.active
            ? 'bg-gradient-to-tr from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/40 ring-2 ring-orange-400/50'
            : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white border border-white/5'
        }`}
        aria-label={item.label}
      >
        <div className="flex items-center justify-center pointer-events-none scale-100">
          {item.icon}
        </div>

        {item.badge !== undefined && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-extrabold text-white shadow-md">
            {item.badge}
          </span>
        )}

        {item.active && (
          <motion.span
            layoutId="dockActiveDot"
            className="absolute -bottom-1 h-1 w-2 rounded-full bg-orange-400"
          />
        )}
      </motion.button>
    </div>
  );
}

export default Dock;
