import React, { useState } from 'react';
import { UserCheck, Cloud, RefreshCw, Key, Shield, ArrowUpRight } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

export const AccountCategory: React.FC = () => {
  const [cloudSync, setCloudSync] = useState(true);
  const [syncHistory, setSyncHistory] = useState(false);
  const [autoBackup, setAutoBackup] = useState(true);

  // Mock quota data representing current state (1.35B monthly allocation)
  const tokensUsed = 42_500_000;
  const tokensTotal = 1_350_000_000;
  const percentage = Math.min(100, Math.round((tokensUsed / tokensTotal) * 100));

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Account & Profile</h2>
        <p className="text-xs text-gray-400 mt-1">
          Manage your authentication status, free tier quotas, and synchronization preferences.
        </p>
      </div>

      {/* Auth Status Card */}
      <div className="p-4 rounded-xl bg-[#181a22] border border-[#262833] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-950/80 border border-violet-700/50 flex items-center justify-center text-violet-300">
            <UserCheck size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-100">Active Developer Session</span>
              <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 rounded-full">
                Connected
              </span>
            </div>
            <p className="text-xs text-gray-400">Authenticated via Local Keychain & Zero-Config Free Tiers</p>
          </div>
        </div>
        <button
          type="button"
          className="px-3 py-1.5 text-xs font-medium bg-[#222530] hover:bg-[#2b2e3d] text-gray-200 border border-[#3b3e4f] rounded-lg transition-colors flex items-center gap-1.5"
          onClick={() => {}}
        >
          <RefreshCw size={13} />
          Refresh Token
        </button>
      </div>

      {/* Section 1: Usage Quota Meter */}
      <div>
        <SectionHeader
          title="Usage Quota Meter"
          description="Free model token consumption across OpenRouter, Groq, OpenKilo, AI Studio, and Together AI."
          badge="1.35B Tokens / Mo"
        />

        <div className="p-4 rounded-lg bg-[#181a22] border border-[#262833] space-y-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-gray-300">Monthly Free Allocation</span>
            <span className="text-gray-400">
              <span className="text-violet-300 font-semibold">{(tokensUsed / 1_000_000).toFixed(1)}M</span> / {(tokensTotal / 1_000_000_000).toFixed(2)}B tokens ({percentage}%)
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2.5 rounded-full bg-[#272a34] overflow-hidden p-0.5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-600 via-indigo-500 to-cyan-400 transition-all duration-500 shadow-sm"
              style={{ width: `${Math.max(3, percentage)}%` }}
            />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 text-center text-[11px]">
            <div className="p-2 rounded bg-[#1e212b] border border-[#2a2d3a]">
              <div className="text-gray-400">Groq Fast Tier</div>
              <div className="font-semibold text-gray-200 mt-0.5">Unlimited TPM</div>
            </div>
            <div className="p-2 rounded bg-[#1e212b] border border-[#2a2d3a]">
              <div className="text-gray-400">AI Studio Free</div>
              <div className="font-semibold text-gray-200 mt-0.5">300M / mo</div>
            </div>
            <div className="p-2 rounded bg-[#1e212b] border border-[#2a2d3a]">
              <div className="text-gray-400">OpenRouter Free</div>
              <div className="font-semibold text-gray-200 mt-0.5">200M / mo</div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Sync Preferences */}
      <div>
        <SectionHeader
          title="Sync & Backup Preferences"
          description="Maintain consistent configurations and customized rules across machines."
        />

        <SettingRow
          label="Cloud Settings Synchronization"
          description="Sync editor settings, custom keybindings, and appearance themes."
          help="Synchronizes non-sensitive settings JSON. API keys and passwords are NEVER synced to cloud storage."
          control={
            <ToggleSwitch
              checked={cloudSync}
              onChange={setCloudSync}
              ariaLabel="Toggle cloud sync"
            />
          }
        />

        <SettingRow
          label="Sync Conversation History"
          description="Allow chat conversations to sync across your authenticated desktop devices."
          control={
            <ToggleSwitch
              checked={syncHistory}
              onChange={setSyncHistory}
              ariaLabel="Toggle conversation history sync"
            />
          }
        />

        <SettingRow
          label="Automatic Local Configuration Backups"
          description="Create local snapshot backups before applying schema upgrades or extension modifications."
          control={
            <ToggleSwitch
              checked={autoBackup}
              onChange={setAutoBackup}
              ariaLabel="Toggle auto backup"
            />
          }
        />
      </div>
    </div>
  );
};
