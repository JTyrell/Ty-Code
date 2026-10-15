import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, ShieldCheck, Power } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

export const GeneralCategory: React.FC = () => {
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'insiders'>('stable');
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [runInBackground, setRunInBackground] = useState(false);
  const [keepAwake, setKeepAwake] = useState(true);
  const [startupBehavior, setStartupBehavior] = useState<'restore' | 'empty' | 'prompt'>('restore');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  const handleCheckUpdate = () => {
    setIsCheckingUpdate(true);
    setUpdateStatus(null);
    setTimeout(() => {
      setIsCheckingUpdate(false);
      setUpdateStatus('You are running the latest version of Ty-Code (v0.1.0).');
    }, 1200);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">General Settings</h2>
        <p className="text-xs text-gray-400 mt-1">
          Configure application update channels, system tray lifecycle, and workspace startup behaviors.
        </p>
      </div>

      {/* Auto-Updates Section */}
      <div>
        <SectionHeader
          title="Application Updates"
          description="Manage automatic release checks and update channels."
        />

        <SettingRow
          label="Update Channel"
          description="Choose between validated stable builds or rapid insider releases with preview features."
          help="Stable updates release on a monthly cadence. Insiders receives daily builds."
          control={
            <select
              value={updateChannel}
              onChange={(e) => setUpdateChannel(e.target.value as 'stable' | 'insiders')}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer"
            >
              <option value="stable">Stable (Recommended)</option>
              <option value="insiders">Insiders (Nightly & Previews)</option>
            </select>
          }
        />

        <SettingRow
          label="Automatic Update Checks"
          description="Periodically verify signature hashes for new releases on launch."
          control={
            <ToggleSwitch
              checked={autoCheckUpdates}
              onChange={setAutoCheckUpdates}
              ariaLabel="Toggle automatic update checks"
            />
          }
        />

        <div className="p-3.5 rounded-lg bg-[#181a22] border border-[#262833] flex items-center justify-between mt-2">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={16} className="text-emerald-400" />
            <div className="text-xs">
              <span className="text-gray-200 font-medium">Ty-Code Desktop v0.1.0</span>
              <p className="text-gray-400 text-[11px]">Channel: {updateChannel === 'stable' ? 'Stable Release' : 'Insiders Fast'}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={isCheckingUpdate}
            onClick={handleCheckUpdate}
            className="px-3 py-1.5 text-xs font-medium bg-[#222530] hover:bg-[#2b2e3d] text-gray-200 border border-[#3b3e4f] rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw size={12} className={isCheckingUpdate ? 'animate-spin' : ''} />
            {isCheckingUpdate ? 'Checking...' : 'Check Now'}
          </button>
        </div>

        {updateStatus && (
          <p className="text-xs text-emerald-400 px-2 mt-1.5 flex items-center gap-1">
            <CheckCircle2 size={12} /> {updateStatus}
          </p>
        )}
      </div>

      {/* System & Power Section */}
      <div>
        <SectionHeader
          title="System Lifecycle & Background Execution"
          description="Control how Ty-Code interacts with system sleep states and background tasks."
        />

        <SettingRow
          label="Run in Background"
          description="Minimize to system notification tray when window is closed, maintaining active agent loops."
          help="When enabled, closing the main window keeps background tasks, model indexing, and terminal tasks active."
          control={
            <ToggleSwitch
              checked={runInBackground}
              onChange={setRunInBackground}
              ariaLabel="Toggle run in background"
            />
          }
        />

        <SettingRow
          label="Keep Awake (Prevent Sleep)"
          description="Prevent OS sleep and display standby while the AI agent is actively executing multi-step workflows."
          help="Acquires a power save blocker lock while commands or inference streams are active."
          badge="Energy Guard"
          control={
            <ToggleSwitch
              checked={keepAwake}
              onChange={setKeepAwake}
              ariaLabel="Toggle keep awake"
            />
          }
        />
      </div>

      {/* Startup Behavior Section */}
      <div>
        <SectionHeader
          title="Startup Behavior"
          description="Define default workspace state upon launching the application."
        />

        <SettingRow
          label="Launch Workspace Restoration"
          description="Determine how files and active tabs are initialized on cold start."
          control={
            <select
              value={startupBehavior}
              onChange={(e) => setStartupBehavior(e.target.value as 'restore' | 'empty' | 'prompt')}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer"
            >
              <option value="restore">Reopen Previous Workspace & Tabs</option>
              <option value="empty">Open Clean Workspace</option>
              <option value="prompt">Show Welcome & Recent Projects Dialog</option>
            </select>
          }
        />
      </div>
    </div>
  );
};
