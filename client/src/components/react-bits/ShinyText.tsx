interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
}

export function ShinyText({
  text,
  disabled = false,
  speed = 4,
  className = '',
}: ShinyTextProps) {
  const animationDuration = `${speed}s`;

  return (
    <span
      className={`inline-block bg-clip-text text-transparent ${
        disabled
          ? 'text-white'
          : 'bg-gradient-to-r from-orange-200 via-amber-400 to-orange-200 bg-[length:200%_auto] animate-shiny-text'
      } ${className}`}
      style={{
        animationDuration,
        backgroundImage: disabled
          ? undefined
          : 'linear-gradient(120deg, rgba(255, 255, 255, 0.4) 0%, rgba(251, 146, 60, 1) 40%, rgba(255, 255, 255, 0.9) 50%, rgba(251, 146, 60, 1) 60%, rgba(255, 255, 255, 0.4) 100%)',
        backgroundSize: '200% auto',
      }}
    >
      {text}
    </span>
  );
}

export default ShinyText;
