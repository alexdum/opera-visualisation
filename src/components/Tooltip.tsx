import React, { ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delayMs?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ 
  content, 
  children, 
  position = 'top', 
  className = '',
  delayMs = 0
}) => {
  return (
    <div className={`group relative inline-flex items-center justify-center ${className}`}>
      {children}
      <div 
        className={`absolute z-[100] invisible opacity-0 [@media(hover:hover)]:group-hover:visible [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 transition-all duration-200 pointer-events-none whitespace-nowrap
          bg-white/70 backdrop-blur-md border border-white/60 shadow-lg text-slate-800 text-xs py-1.5 px-3 rounded-lg font-medium
          ${position === 'top' ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' : ''}
          ${position === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-2' : ''}
          ${position === 'left' ? 'right-full top-1/2 -translate-y-1/2 mr-2' : ''}
          ${position === 'right' ? 'left-full top-1/2 -translate-y-1/2 ml-2' : ''}
        `}
        style={{ transitionDelay: `${delayMs}ms` }}
      >
        {content}
      </div>
    </div>
  );
};
