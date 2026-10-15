import React, { useState } from 'react';
import { Globe, Video, ShieldAlert, Monitor, Terminal } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

export const BrowserCategory: React.FC = () => {
  const [headless, setHeadless] = useState(true);
  const [domainAllowlist, setDomainAllowlist] = useState('localhost:*\n127.0.0.1:*\n*.github.com\n*.npmjs.com\n*.stackoverflow.com');
  const [sessionRecording, setSessionRecording] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [viewportHeight, setViewportHeight] = useState(800);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Browser Automation & Subagent</h2>
        <p className="text-xs text-gray-400 mt-1">
          Configure browser subagent behavior, headless rendering, domain access controls, and session recordings.
        </p>
      </div>

      {/* Execution Mode */}
      <div>
        <SectionHeader
          title="Browser Execution Mode"
          description="Control whether browser tasks run silently in the background or display a live window."
        />

        <SettingRow
          label="Headless Browser Mode"
          description={
            headless
              ? 'Headless (Silent background execution without visible browser window)'
              : 'Headed (Live interactive browser window rendered on screen)'
          }
          help="Headed mode is recommended when debugging web application flows or OAuth logins."
          badge={headless ? 'Fast & Silent' : 'Visual Window'}
          control={
            <ToggleSwitch
              checked={headless}
              onChange={setHeadless}
              ariaLabel="Toggle headless mode"
            />
          }
        />

        <SettingRow
          label="Record Browser Sessions (WebP Video)"
          description="Automatically record animated video clips of browser interactions into artifact storage."
          help="Recordings are compressed to WebP and saved in local workspace artifacts for playback."
          control={
            <ToggleSwitch
              checked={sessionRecording}
              onChange={setSessionRecording}
              ariaLabel="Toggle session recording"
            />
          }
        />
      </div>

      {/* Domain Allowlist */}
      <div>
        <SectionHeader
          title="Security: Domain Allowlist"
          description="Restrict browser navigation to authorized development servers and approved domains."
          badge="Sandbox Policy"
        />

        <div className="rounded-xl border border-[#262833] bg-[#181a22] p-3 space-y-2">
          <label htmlFor="domain-allowlist-textarea" className="text-xs font-medium text-gray-300">
            Allowed Domains and Hostnames (One per line, wildcards supported)
          </label>
          <textarea
            id="domain-allowlist-textarea"
            value={domainAllowlist}
            onChange={(e) => setDomainAllowlist(e.target.value)}
            rows={5}
            className="w-full bg-[#14151b] border border-[#262833] text-gray-200 text-xs font-mono p-2.5 rounded-lg focus:outline-none focus:border-violet-500 resize-none leading-relaxed"
            placeholder="e.g. localhost:*, *.mycompany.com"
          />
          <p className="text-[11px] text-gray-400">
            Navigation attempts to domains not listed above will be rejected by the Browser Subagent.
          </p>
        </div>
      </div>

      {/* Viewport Settings */}
      <div>
        <SectionHeader
          title="Default Viewport Dimensions"
          description="Simulated browser resolution for web scraping and screenshot verification."
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-[#181a22] border border-[#262833]">
            <label className="text-xs text-gray-400 block mb-1">Width (px)</label>
            <input
              type="number"
              value={viewportWidth}
              onChange={(e) => setViewportWidth(parseInt(e.target.value, 10))}
              className="w-full bg-[#14151b] border border-[#3b3e4f] text-gray-200 text-xs px-2.5 py-1.5 rounded-md focus:outline-none focus:border-violet-500 font-mono"
            />
          </div>
          <div className="p-3 rounded-lg bg-[#181a22] border border-[#262833]">
            <label className="text-xs text-gray-400 block mb-1">Height (px)</label>
            <input
              type="number"
              value={viewportHeight}
              onChange={(e) => setViewportHeight(parseInt(e.target.value, 10))}
              className="w-full bg-[#14151b] border border-[#3b3e4f] text-gray-200 text-xs px-2.5 py-1.5 rounded-md focus:outline-none focus:border-violet-500 font-mono"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
