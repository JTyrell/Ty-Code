import React, { useState } from 'react';
import { Sparkles, FileText, Server, Plus, Check, Save } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

export const CustomizationsCategory: React.FC = () => {
  const [agentsRules, setAgentsRules] = useState(
`# AGENTS.md - Workspace Agent Guidelines
You are Ty-Code, an agentic pair-programming assistant.
- Maintain documentation integrity.
- Never write destructive rm -rf commands without asking.
- Write clean, modular TypeScript with strict type definitions.
- Always run tests to verify implementation before concluding.`
  );
  const [isSaved, setIsSaved] = useState(false);

  const [skills, setSkills] = useState([
    { id: 'git-workflow', name: 'Git & Branch Automation', enabled: true, desc: 'Enables branch creation, staging, and structured commit generation' },
    { id: 'ui-sketcher', name: 'M3E Canvas Visual Sketcher', enabled: true, desc: 'Generates interactive prototype sketches and exports code prompts' },
    { id: 'bento-slides', name: 'Bento Presentation Generator', enabled: true, desc: 'Builds self-contained standalone HTML presentation decks' },
    { id: 'open-seo-mcp', name: 'Open SEO & Analytics MCP', enabled: false, desc: 'Audits core web vitals and keyword rankings' }
  ]);

  const [mcpServers, setMcpServers] = useState([
    { name: 'open-seo', status: 'Connected', transport: 'stdio', tools: 4 },
    { name: 'filesystem-workspace', status: 'Active', transport: 'in-process', tools: 12 },
    { name: 'developer-knowledge', status: 'Ready', transport: 'http-sse', tools: 3 }
  ]);

  const handleSaveRules = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const toggleSkill = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Customizations & Rules</h2>
        <p className="text-xs text-gray-400 mt-1">
          Configure agent workflow skills, workspace rules (AGENTS.md), and Model Context Protocol (MCP) servers.
        </p>
      </div>

      {/* Rules Editor */}
      <div>
        <SectionHeader
          title="Agent Rules (AGENTS.md)"
          description="Guidelines and behavioral constraints injected into every agent prompt for this workspace."
          badge="Workspace Level"
        />

        <div className="rounded-xl border border-[#262833] bg-[#181a22] overflow-hidden">
          <div className="p-3 bg-[#1e2029] border-b border-[#262833] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-violet-400" />
              <span className="text-xs font-mono font-medium text-gray-300">./AGENTS.md</span>
            </div>
            <button
              type="button"
              onClick={handleSaveRules}
              className="px-3 py-1 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {isSaved ? <Check size={13} className="text-emerald-300" /> : <Save size={13} />}
              {isSaved ? 'Saved!' : 'Save Rules'}
            </button>
          </div>
          <textarea
            value={agentsRules}
            onChange={(e) => setAgentsRules(e.target.value)}
            rows={7}
            className="w-full bg-[#14151b] text-gray-200 text-xs font-mono p-3 focus:outline-none resize-none leading-relaxed"
            placeholder="Define custom rules and instructions..."
          />
        </div>
      </div>

      {/* Skills Manager */}
      <div>
        <SectionHeader
          title="Skills Manager"
          description="Modular capabilities and workflow instructions available to the AI agent."
        />

        <div className="space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="p-3 rounded-lg bg-[#181a22] border border-[#262833] flex items-center justify-between"
            >
              <div className="pr-4">
                <div className="text-xs font-medium text-gray-200 flex items-center gap-2">
                  {skill.name}
                  {skill.enabled && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  )}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">{skill.desc}</div>
              </div>
              <ToggleSwitch
                checked={skill.enabled}
                onChange={() => toggleSkill(skill.id)}
                size="sm"
                ariaLabel={`Toggle ${skill.name}`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* MCP Servers */}
      <div>
        <SectionHeader
          title="Model Context Protocol (MCP) Servers"
          description="External tools, datasets, and context sources connected via MCP standard."
        />

        <div className="space-y-2">
          {mcpServers.map((srv) => (
            <div
              key={srv.name}
              className="p-3 rounded-lg bg-[#181a22] border border-[#262833] flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#1f222d] border border-[#2f3242] flex items-center justify-center text-violet-300">
                  <Server size={16} />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-200 font-mono">{srv.name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Transport: {srv.transport} · {srv.tools} active tools
                  </div>
                </div>
              </div>

              <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 rounded-full">
                {srv.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
