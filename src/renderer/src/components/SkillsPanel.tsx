import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Zap,
  BookOpen,
  Play,
  RefreshCw,
  Sliders,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import type { SkillDefinition } from '../../../preload/types';

export const SkillsPanel: React.FC = () => {
  const { workspacePath } = useWorkspaceStore();
  const { sendMessage } = useChatStore();

  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadSkills = async () => {
    setIsLoading(true);
    try {
      const res = await window.electronAPI.getAvailableSkills(workspacePath);
      if (res.success && res.data) {
        setSkills(res.data);
      }
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, [workspacePath]);

  const slashCommands = [
    { command: '/plan', label: 'Plan Workflow', desc: 'Create a phased architectural plan before execution' },
    { command: '/goal', label: 'Long-running Goal', desc: 'Run persistent autonomous agent loop until goal achieved' },
    { command: '/schedule', label: 'Schedule Timer', desc: 'Set recurring cron or background reminder' },
    { command: '/learn', label: 'Save Learnings', desc: 'Distill interaction and persist to project memory' }
  ];

  const handleRunSlashCommand = (cmd: string) => {
    const prompt = `${cmd} for current task in workspace`;
    sendMessage(prompt, workspacePath);
  };

  const handleRunSkill = (skill: SkillDefinition) => {
    const prompt = `Activate skill "${skill.name}":\n${skill.description}\n\nInspect current workspace context and execute.`;
    sendMessage(prompt, workspacePath);
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          height: '35px',
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={14} color="var(--accent-primary)" />
          <span>Antigravity Capabilities</span>
        </div>
        <button onClick={loadSkills} title="Refresh Skills">
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* Antigravity Slash Commands */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
            AGENTIC SLASH COMMANDS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {slashCommands.map((sc) => (
              <div
                key={sc.command}
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Zap size={12} color="var(--accent-primary)" />
                    <span style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text-primary)' }}>
                      {sc.command}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({sc.label})</span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {sc.desc}
                  </div>
                </div>

                <button
                  onClick={() => handleRunSlashCommand(sc.command)}
                  style={{
                    backgroundColor: 'var(--bg-hover)',
                    color: 'var(--accent-primary)',
                    padding: '3px 6px',
                    fontSize: '10px',
                    borderRadius: '4px'
                  }}
                  title="Run command"
                >
                  <Play size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Custom Agent Skills */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)' }}>
              LOADED SKILLS ({skills.length})
            </span>
          </div>

          {skills.length === 0 ? (
            <div
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px dashed var(--border-subtle)',
                borderRadius: '6px',
                padding: '16px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '11px',
                lineHeight: 1.5
              }}
            >
              No custom skills found in <code>.agents/skills/</code> or <code>context/skills/</code>.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {skills.map((skill) => {
                const isExpanded = expandedId === skill.id;
                return (
                  <div
                    key={skill.id}
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : skill.id)}
                      style={{
                        padding: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <BookOpen size={12} color="var(--accent-cyan)" />
                        <span style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text-primary)' }}>
                          {skill.name}
                        </span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRunSkill(skill);
                        }}
                        style={{
                          backgroundColor: 'var(--accent-primary)',
                          color: '#fff',
                          padding: '2px 6px',
                          fontSize: '10px',
                          borderRadius: '3px'
                        }}
                      >
                        Invoke
                      </button>
                    </div>

                    {isExpanded && (
                      <div
                        style={{
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-secondary)',
                          borderTop: '1px solid var(--border-subtle)',
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          lineHeight: 1.4
                        }}
                      >
                        <div>{skill.description}</div>
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Path: {skill.path}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
