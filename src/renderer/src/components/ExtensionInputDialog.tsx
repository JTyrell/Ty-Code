import React, { useEffect, useRef } from 'react';
import { useExtensionPromptStore } from '../state/extension-prompt-store';

export const ExtensionInputDialog: React.FC = () => {
  const { inputPrompt, updateInput, resolveInput } = useExtensionPromptStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!inputPrompt) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); resolveInput(undefined); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inputPrompt?.id, resolveInput]);

  if (!inputPrompt) return null;
  return (
    <div className="extension-input-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) resolveInput(undefined); }}>
      <form
        className="extension-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-input-title"
        onSubmit={(event) => { event.preventDefault(); resolveInput(inputPrompt.value); }}
      >
        <h2 id="extension-input-title">Extension input</h2>
        <label htmlFor="extension-input-value">{inputPrompt.prompt}</label>
        <input
          ref={inputRef}
          id="extension-input-value"
          value={inputPrompt.value}
          maxLength={2_000}
          onChange={(event) => updateInput(event.target.value)}
          autoComplete="off"
        />
        <div className="extension-input-actions">
          <button type="button" onClick={() => resolveInput(undefined)}>Cancel</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </div>
  );
};
