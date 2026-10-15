import React, { useState } from 'react';
import { Zap, CornerDownLeft, Sparkles, Clock, Sliders } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

export const TabCategory: React.FC = () => {
  const [enableTab, setEnableTab] = useState(true);
  const [triggerDelayMs, setTriggerDelayMs] = useState(150);
  const [tabToJump, setTabToJump] = useState(true);
  const [supercomplete, setSupercomplete] = useState(true);
  const [maxLines, setMaxLines] = useState(4);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Tab (Inline Autocomplete)</h2>
        <p className="text-xs text-gray-400 mt-1">
          Configure ghost-text inline code completions, trigger delays, navigation jumps, and multi-line Supercomplete.
        </p>
      </div>

      {/* Core Tab Toggle */}
      <div>
        <SectionHeader
          title="Ghost Text Autocomplete"
          description="Instant code suggestions powered by high-speed local and cloud models."
          badge={enableTab ? 'Active' : 'Disabled'}
        />

        <SettingRow
          label="Enable Tab Autocomplete"
          description="Display gray ghost-text completions inline as you type in the editor."
          help="Press [Tab] to accept completion, [Esc] to dismiss, or [Alt+] to cycle alternatives."
          control={
            <ToggleSwitch
              checked={enableTab}
              onChange={setEnableTab}
              ariaLabel="Toggle tab autocomplete"
            />
          }
        />

        <SettingRow
          label="Trigger Delay (ms)"
          description={`Idle delay before triggering inline completion requests (${triggerDelayMs}ms).`}
          help="A 150ms delay balances responsiveness while preventing unneeded queries during fast typing."
          disabled={!enableTab}
          control={
            <div className="flex items-center gap-3 w-52">
              <input
                type="range"
                min="50"
                max="1000"
                step="25"
                value={triggerDelayMs}
                onChange={(e) => setTriggerDelayMs(parseInt(e.target.value, 10))}
                disabled={!enableTab}
                className="w-full accent-violet-500 cursor-pointer disabled:opacity-50"
              />
              <span className="text-xs font-mono text-violet-300 w-16 text-right">
                {triggerDelayMs}ms
              </span>
            </div>
          }
        />
      </div>

      {/* Navigation & Supercomplete */}
      <div>
        <SectionHeader
          title="Predictive Supercomplete & Navigation"
          description="Multi-line generation and cursor jumping behaviors."
        />

        <SettingRow
          label="Tab-to-Jump Navigation"
          description="Use Tab to jump past closing brackets, quotes, and function argument placeholders."
          help="When the cursor is before a closing delimiter, pressing Tab moves past it without inserting whitespace."
          disabled={!enableTab}
          control={
            <ToggleSwitch
              checked={tabToJump}
              onChange={setTabToJump}
              disabled={!enableTab}
              ariaLabel="Toggle tab-to-jump"
            />
          }
        />

        <SettingRow
          label="Supercomplete (Multi-Line Predictive Completion)"
          description="Generate multi-line implementations and predictive next-action code blocks."
          badge="AI Powered"
          disabled={!enableTab}
          control={
            <ToggleSwitch
              checked={supercomplete}
              onChange={setSupercomplete}
              disabled={!enableTab}
              ariaLabel="Toggle supercomplete"
            />
          }
        />

        <SettingRow
          label="Maximum Supercomplete Lines"
          description={`Upper bound on lines proposed by multi-line autocomplete (${maxLines} lines).`}
          disabled={!enableTab || !supercomplete}
          control={
            <select
              value={maxLines}
              onChange={(e) => setMaxLines(parseInt(e.target.value, 10))}
              disabled={!enableTab || !supercomplete}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer disabled:opacity-50"
            >
              <option value="1">1 Line (Single Line Only)</option>
              <option value="2">2 Lines</option>
              <option value="4">4 Lines (Balanced)</option>
              <option value="8">8 Lines (Extensive)</option>
              <option value="16">16 Lines (Full Blocks)</option>
            </select>
          }
        />
      </div>
    </div>
  );
};
