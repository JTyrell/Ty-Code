import React from 'react';
import { HelpTooltip } from './HelpTooltip';

export interface SettingRowProps {
  id?: string;
  label: string;
  description?: React.ReactNode;
  help?: string;
  badge?: string;
  control: React.ReactNode;
  vertical?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  id,
  label,
  description,
  help,
  badge,
  control,
  vertical = false,
  disabled = false,
  danger = false,
  className = ''
}) => {
  return (
    <div
      id={id}
      className={`group p-3.5 rounded-lg border border-transparent transition-all duration-150 ${
        disabled
          ? 'opacity-60 cursor-not-allowed bg-transparent'
          : 'hover:bg-[#1f2128]/60 hover:border-[#2b2e3b]'
      } ${className}`}
    >
      <div
        className={`flex ${
          vertical ? 'flex-col gap-2.5' : 'flex-row items-center justify-between gap-4'
        }`}
      >
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label
              htmlFor={id}
              className={`text-sm font-medium ${
                danger ? 'text-red-400' : 'text-gray-200'
              } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {label}
            </label>
            {badge && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-800/40 rounded">
                {badge}
              </span>
            )}
            {help && <HelpTooltip content={help} />}
          </div>
          {description && (
            <div className="mt-0.5 text-xs text-gray-400 leading-normal">
              {description}
            </div>
          )}
        </div>

        <div className={`flex items-center ${vertical ? 'w-full pt-1' : 'flex-shrink-0'}`}>
          {control}
        </div>
      </div>
    </div>
  );
};
