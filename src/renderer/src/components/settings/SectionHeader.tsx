import React from 'react';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  badge?: string;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  badge,
  className = ''
}) => {
  return (
    <div className={`pt-4 pb-2 border-b border-[#262833] mb-4 ${className}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-gray-200">
          {title}
        </h3>
        {badge && (
          <span className="px-2 py-0.5 text-[10px] font-medium tracking-wider text-violet-300 bg-violet-950/60 border border-violet-800/50 rounded-full">
            {badge}
          </span>
        )}
      </div>
      {description && (
        <p className="mt-1 text-xs text-gray-400 leading-relaxed">
          {description}
        </p>
      )}
    </div>
  );
};
