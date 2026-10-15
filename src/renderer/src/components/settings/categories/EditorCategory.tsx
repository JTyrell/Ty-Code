import React, { useState } from 'react';
import { FileCode, Eye, CheckSquare, Sparkles, BookOpen, Layers } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

export const EditorCategory: React.FC = () => {
  const [ligatures, setLigatures] = useState(true);
  const [minimap, setMinimap] = useState(true);
  const [formatOnSave, setFormatOnSave] = useState(true);
  const [codeLenses, setCodeLenses] = useState(true);
  const [bracketPairs, setBracketPairs] = useState(true);
  const [wordWrap, setWordWrap] = useState<'on' | 'off' | 'wordWrapColumn'>('on');
  const [tabSize, setTabSize] = useState(2);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Editor Configuration</h2>
        <p className="text-xs text-gray-400 mt-1">
          Customize Monaco code editor capabilities, ligatures, formatting triggers, and visual lenses.
        </p>
      </div>

      {/* Visual Features */}
      <div>
        <SectionHeader
          title="Display & Typography Features"
          description="Visual enhancements for code rendering and syntax navigation."
        />

        <SettingRow
          label="Font Ligatures"
          description="Render typographical ligatures for composite operators like =>, !==, ===, <=, and >=."
          help="Requires a ligature-compatible font like JetBrains Mono, Fira Code, or Cascadia Code."
          badge="Aesthetic"
          control={
            <ToggleSwitch
              checked={ligatures}
              onChange={setLigatures}
              ariaLabel="Toggle font ligatures"
            />
          }
        />

        <SettingRow
          label="Editor Minimap"
          description="Display an outline code overview minimap on the right gutter of the editor."
          control={
            <ToggleSwitch
              checked={minimap}
              onChange={setMinimap}
              ariaLabel="Toggle editor minimap"
            />
          }
        />

        <SettingRow
          label="Bracket Pair Colorization"
          description="Colorize matching opening and closing brackets with harmonious rainbow hues."
          control={
            <ToggleSwitch
              checked={bracketPairs}
              onChange={setBracketPairs}
              ariaLabel="Toggle bracket pair colorization"
            />
          }
        />
      </div>

      {/* Code Formatting & Automation */}
      <div>
        <SectionHeader
          title="Formatting & Code Lenses"
          description="Automated linting, formatting, and contextual reference metadata."
        />

        <SettingRow
          label="Format on Save"
          description="Automatically format documents using Prettier or language server on file save (Ctrl+S)."
          badge="Productivity"
          control={
            <ToggleSwitch
              checked={formatOnSave}
              onChange={setFormatOnSave}
              ariaLabel="Toggle format on save"
            />
          }
        />

        <SettingRow
          label="Inline Code Lenses"
          description="Display inline actionable metadata (references count, test runners, git author)."
          help="Renders clickable annotations directly above function and class signatures."
          control={
            <ToggleSwitch
              checked={codeLenses}
              onChange={setCodeLenses}
              ariaLabel="Toggle inline code lenses"
            />
          }
        />

        <SettingRow
          label="Word Wrap"
          description="Control whether long lines soft-wrap at the editor viewport edge."
          control={
            <select
              value={wordWrap}
              onChange={(e) => setWordWrap(e.target.value as any)}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer"
            >
              <option value="on">On (Wrap at viewport edge)</option>
              <option value="off">Off (Horizontal scrollbar)</option>
              <option value="wordWrapColumn">Wrap at 80/120 Characters</option>
            </select>
          }
        />

        <SettingRow
          label="Tab Size (Spaces)"
          description="Number of spaces equivalent to one indentation level."
          control={
            <select
              value={tabSize}
              onChange={(e) => setTabSize(parseInt(e.target.value, 10))}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer"
            >
              <option value="2">2 Spaces (Standard JS/TS/HTML)</option>
              <option value="4">4 Spaces (Python/Rust/Java/C++)</option>
              <option value="8">8 Spaces</option>
            </select>
          }
        />
      </div>
    </div>
  );
};
