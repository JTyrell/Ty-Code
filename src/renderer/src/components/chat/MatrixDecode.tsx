/**
 * MatrixDecode (Prompt 1 / Prompt 3 Compatibility Layer)
 *
 * Re-exports and wraps ScrambleText for Matrix decode glyph scramble animations.
 *
 * Brand: Ty-Code
 */

import React from 'react';
import { ScrambleText } from './ScrambleText';

export type MatrixDecodeMode = 'tail' | 'sweep' | 'off';

export interface MatrixDecodeProps {
  text: string;
  mode?: MatrixDecodeMode;
  onSweepEnd?: () => void;
  tailLength?: number;
  enabled?: boolean;
  streaming?: boolean;
}

export const MatrixDecode: React.FC<MatrixDecodeProps> = ({
  text,
  mode = 'tail',
  onSweepEnd,
  enabled,
  streaming
}) => {
  const isEnabled = enabled ?? (mode !== 'off');
  const isStreaming = streaming ?? (mode === 'tail');

  React.useEffect(() => {
    if (mode === 'sweep' && onSweepEnd) {
      const timer = window.setTimeout(onSweepEnd, 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [mode, onSweepEnd]);

  return (
    <ScrambleText
      text={text}
      enabled={isEnabled}
      streaming={isStreaming}
      onSettled={onSweepEnd}
    />
  );
};

export default MatrixDecode;
