import React from 'react';

export interface ToggleSwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel?: string;
  className?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
  size = 'md',
  ariaLabel,
  className = ''
}) => {
  const sizeStyles = {
    sm: {
      width: '34px',
      height: '18px',
      knob: '14px',
      translate: '16px'
    },
    md: {
      width: '42px',
      height: '22px',
      knob: '18px',
      translate: '20px'
    },
    lg: {
      width: '50px',
      height: '26px',
      knob: '22px',
      translate: '24px'
    }
  }[size];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={handleKeyDown}
      className={`relative inline-flex items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500 ${className}`}
      style={{
        width: sizeStyles.width,
        height: sizeStyles.height,
        backgroundColor: checked
          ? '#8b5cf6'
          : disabled
          ? '#1e2029'
          : '#272a34',
        boxShadow: checked ? '0 0 10px rgba(139, 92, 246, 0.45)' : 'none',
        border: '1px solid',
        borderColor: checked ? '#a78bfa' : '#373a47',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: '1px',
        flexShrink: 0
      }}
    >
      <span
        className="inline-block rounded-full bg-white transition-transform duration-200 shadow-md"
        style={{
          width: sizeStyles.knob,
          height: sizeStyles.knob,
          transform: checked ? `translateX(${sizeStyles.translate})` : 'translateX(2px)',
          backgroundColor: '#ffffff'
        }}
      />
    </button>
  );
};
