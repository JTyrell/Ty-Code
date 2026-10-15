import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export interface HelpTooltipProps {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  content,
  position = 'top',
  className = ''
}) => {
  const [visible, setVisible] = useState(false);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2'
  }[position];

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <button
        type="button"
        aria-label="More information"
        className="text-gray-400 hover:text-gray-200 transition-colors focus:outline-none focus:text-violet-400 p-0.5 rounded cursor-help"
      >
        <HelpCircle size={14} className="stroke-[2]" />
      </button>

      {visible && (
        <div
          role="tooltip"
          className={`absolute z-50 ${positionClasses} w-60 max-w-xs px-3 py-2 text-xs font-normal text-gray-200 bg-[#1e2029] border border-[#3b3e4f] rounded-lg shadow-xl pointer-events-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-150`}
          style={{
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05)'
          }}
        >
          {content}
          <div
            className={`absolute w-2 h-2 bg-[#1e2029] border-t border-l border-[#3b3e4f] transform rotate-45 ${
              position === 'top'
                ? 'top-full left-1/2 -translate-x-1/2 -mt-1 border-t-0 border-l-0 border-b border-r'
                : position === 'bottom'
                ? 'bottom-full left-1/2 -translate-x-1/2 -mb-1'
                : position === 'left'
                ? 'left-full top-1/2 -translate-y-1/2 -ml-1 border-t-0 border-l-0 border-b border-r'
                : 'right-full top-1/2 -translate-y-1/2 -mr-1'
            }`}
          />
        </div>
      )}
    </div>
  );
};
