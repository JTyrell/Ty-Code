import React, { useState } from 'react';
import { Cpu, Brain, KeyRound, Sparkles, ExternalLink, Zap } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';

export interface ModelsCategoryProps {
  onOpenByokWizard?: () => void;
}

export const ModelsCategory: React.FC<ModelsCategoryProps> = ({ onOpenByokWizard }) => {
  const [defaultModel, setDefaultModel] = useState('deepseek/deepseek-r1:free');
  const [thinkingBudget, setThinkingBudget] = useState(4096);
  const [temperature, setTemperature] = useState(0.2);

  const modelOptions = [
    { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free - Tier S Reasoning)', provider: 'OpenRouter' },
    { id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen 2.5 Coder 32B (Free - Tier A Coding)', provider: 'OpenRouter' },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile (Free)', provider: 'Groq' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Ultra-Fast)', provider: 'Groq' },
    { id: 'flash-2.0-exp:free', name: 'Ultra-Fast Flash 2.0 (Free)', provider: 'AI Cloud' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (Free via FCC Proxy)', provider: 'Anthropic Proxy' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Models & Inference</h2>
        <p className="text-xs text-gray-400 mt-1">
          Configure default AI models, extended thinking budgets, temperature parameters, and BYOK credentials.
        </p>
      </div>

      {/* Model Selection */}
      <div>
        <SectionHeader
          title="Default Model Selection"
          description="The active model used for code generation and agent workflows."
          badge="Router Active"
        />

        <SettingRow
          label="Default LLM Model"
          description="Primary model loaded for new conversations and background tasks."
          help="When Intelligent Router is enabled (Ctrl+M), Ty-Code will automatically select the best model per prompt."
          control={
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="bg-[#1f2128] border border-[#3b3e4f] text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-violet-500 cursor-pointer max-w-xs truncate"
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          }
        />
      </div>

      {/* Reasoning & Parameters */}
      <div>
        <SectionHeader
          title="Inference Parameters & Reasoning"
          description="Tune model creativity and extended reasoning depth."
        />

        <SettingRow
          label="Thinking Budget (Reasoning Tokens)"
          description={`Maximum token allocation for internal chain-of-thought (${thinkingBudget === 0 ? 'Disabled' : `${thinkingBudget} tokens`}).`}
          help="Allocates reasoning scratchpad tokens for deep thinking models like DeepSeek R1 and Claude 3.7."
          badge={thinkingBudget > 0 ? 'Extended Thinking' : undefined}
          control={
            <div className="flex items-center gap-3 w-52">
              <input
                type="range"
                min="0"
                max="16384"
                step="1024"
                value={thinkingBudget}
                onChange={(e) => setThinkingBudget(parseInt(e.target.value, 10))}
                className="w-full accent-violet-500 cursor-pointer"
              />
              <span className="text-xs font-mono text-violet-300 w-16 text-right">
                {thinkingBudget === 0 ? '0' : `${Math.round(thinkingBudget / 1024)}K`}
              </span>
            </div>
          }
        />

        <SettingRow
          label="Sampling Temperature"
          description={`Balance between deterministic precision and exploratory variance (${temperature.toFixed(2)}).`}
          help="Lower values (0.0 - 0.3) are best for code generation and refactoring. Higher values produce more diverse explanations."
          control={
            <div className="flex items-center gap-3 w-52">
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-violet-500 cursor-pointer"
              />
              <span className="text-xs font-mono text-violet-300 w-12 text-right">
                {temperature.toFixed(2)}
              </span>
            </div>
          }
        />
      </div>

      {/* API Keys & BYOK Section */}
      <div>
        <SectionHeader
          title="API Keys & Provider Configuration"
          description="Connect your own keys or manage zero-config free providers."
        />

        <div className="p-4 rounded-xl bg-[#181a22] border border-[#262833] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-700/50 flex items-center justify-center text-emerald-300">
              <KeyRound size={20} />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-100">BYOK & Free Provider Keys</div>
              <p className="text-xs text-gray-400 mt-0.5">
                8+ Free providers connected with zero configuration. Add custom keys for elevated quotas.
              </p>
            </div>
          </div>

          {onOpenByokWizard && (
            <button
              type="button"
              onClick={onOpenByokWizard}
              className="px-3.5 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Zap size={13} />
              Open BYOK Wizard
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
