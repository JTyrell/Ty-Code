import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import styles from './CopyButton.module.css';

interface CopyButtonProps {
  value: string;
  label: string;
  className?: string;
}

export default function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  async function copyValue() {
    setCopied(false);
    setError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError(true);
    }
  }

  const buttonLabel = copied ? `${label} copied` : error ? `Could not copy ${label}` : label;
  return (
    <button
      className={[styles.button, className].filter(Boolean).join(' ')}
      type="button"
      onClick={() => void copyValue()}
      aria-label={buttonLabel}
      title={buttonLabel}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span>{copied ? 'Copied' : error ? 'Copy failed' : 'Copy'}</span>
      <span className={styles.srOnly} role="status" aria-live="polite">{buttonLabel}</span>
    </button>
  );
}
