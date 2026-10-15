import React, { useState } from 'react';
import { Palette, Layout, Type, Sliders } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';

export const AppearanceCategory: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light' | 'cyber'>('dark');
  const [chatWidth, setChatWidth] = useState<'narrow' | 'default' | 'wide' | 'split'>('default');
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [fontFamily, setFontFamily] = useState('JetBrains Mono');
  const [fontSize, setFontSize] = useState(13);

  const themeOptions = [
    { id: 'dark', name: 'Dark Slate', desc: 'Curated deep slate with violet highlights (#121316)', bg: '#121316', border: '#262833' },
    { id: 'cyber', name: 'Cyber Void', desc: 'High-contrast obsidian with neon cyan/magenta', bg: '#0b0c10', border: '#1f2833' },
    { id: 'light', name: 'Light Clean', desc: 'Soft parchment daylight theme for high ambient light', bg: '#f8fafc', border: '#cbd5e1' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Appearance & Layout</h2>
        <p className="text-xs text-gray-400 mt-1">
          Customize themes, chat sidecar widths, font typographies, and display densities.
        </p>
      </div>

      {/* Theme Selection */}
      <div>
        <SectionHeader
          title="Color Theme"
          description="Select the interface color scheme."
        />

        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id as 'dark' | 'light' | 'cyber')}
              className={`p-3.5 rounded-xl text-left border transition-all duration-200 relative ${
                theme === t.id
                  ? 'border-violet-500 bg-violet-950/20 ring-1 ring-violet-500/50 shadow-lg'
                  : 'border-[#262833] bg-[#181a22] hover:border-[#3b3e4f] hover:bg-[#1f2128]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-100">{t.name}</span>
                <span
                  className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0"
                  style={{ backgroundColor: t.bg }}
                />
              </div>
              <p className="text-[11px] text-gray-400 leading-tight">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Layout & Sidecar */}
      <div>
        <SectionHeader
          title="Chat Sidecar & Layout"
          description="Configure sidecar panel proportions and layout constraints."
        />

        <SettingRow
          label="Chat Sidecar Width"
          description="Default width allocated to the agent sidecar conversation panel."
          control={
            <select
              value={chatWidth}
              onChange={(e) => setChatWidth(e.target.value as any)}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer"
            >
              <option value="narrow">Narrow (380px)</option>
              <option value="default">Comfortable (440px)</option>
              <option value="wide">Wide (560px)</option>
              <option value="split">50 / 50 Half Split</option>
            </select>
          }
        />

        <SettingRow
          label="Interface Density"
          description="Control padding and spacing between tree view items, tabs, and list rows."
          control={
            <div className="flex items-center gap-1 bg-[#1f2128] p-1 rounded-lg border border-[#3b3e4f]">
              <button
                type="button"
                onClick={() => setDensity('compact')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  density === 'compact'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Compact
              </button>
              <button
                type="button"
                onClick={() => setDensity('comfortable')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  density === 'comfortable'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Comfortable
              </button>
            </div>
          }
        />
      </div>

      {/* Typography */}
      <div>
        <SectionHeader
          title="Typography & Code Fonts"
          description="Editor and code block monospaced font preferences."
        />

        <SettingRow
          label="Font Family"
          description="Preferred monospaced font family rendered in Monaco editor and code diffs."
          control={
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer font-mono"
            >
              <option value="JetBrains Mono">JetBrains Mono</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Cascadia Code">Cascadia Code</option>
              <option value="Source Code Pro">Source Code Pro</option>
              <option value="Menlo, Monaco, monospace">System Monospace</option>
            </select>
          }
        />

        <SettingRow
          label="Font Size (px)"
          description={`Base text size in editor views (${fontSize}px).`}
          control={
            <div className="flex items-center gap-3 w-44">
              <input
                type="range"
                min="10"
                max="20"
                step="1"
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                className="w-full accent-violet-500 cursor-pointer"
              />
              <span className="text-xs font-mono text-violet-300 w-8 text-right">{fontSize}px</span>
            </div>
          }
        />
      </div>
    </div>
  );
};
