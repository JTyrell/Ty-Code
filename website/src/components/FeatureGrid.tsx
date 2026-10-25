import { Bug, Cpu, Layers, Palette } from 'lucide-react';
import styles from './FeatureGrid.module.css';

interface FeatureItem {
  id: string;
  badge: string;
  name: string;
  headline: string;
  description: string;
  icon: typeof Cpu;
}

const FEATURES: FeatureItem[] = [
  {
    id: 'omni-orchestrator',
    badge: 'RESILIENT ROUTING',
    name: 'Omni-Orchestrator',
    headline: 'Intelligent Failover That Never Drops Context',
    description:
      'Tired of hit-the-wall HTTP 429 rate limits and random upstream provider outages mid-refactor? Our Omni-Orchestrator dynamically monitors model health, token quotas, and latency across OpenRouter, Groq, Anthropic, and local Ollama. If a provider hiccups, Ty-Code seamlessly resumes your turn on an alternate model with zero context loss.',
    icon: Cpu
  },
  {
    id: 'context-engine',
    badge: 'COMPOUNDING MEMORY',
    name: 'Ty-Code Context Engine',
    headline: 'The AI That Learns Your Stack and Remembers Your Rules',
    description:
      "Generic AI assistants forget your architectural preferences the moment you clear your chat history. Ty-Code's Universal Correction Memory codifies every developer correction into a local Write-Ahead-Logged SQLite database. Rules taught in the Chat Sidecar are instantly enforced by the architectural debugger and visual canvas in real time.",
    icon: Layers
  },
  {
    id: 'omni-debugger',
    badge: 'DRIFT PREVENTION',
    name: 'Omni-Debugger',
    headline: 'Stack-Aware Architectural Drift Detection',
    description:
      'Catch hidden bugs, schema mismatches, and compliance violations before your code ever hits pull request review. The Omni-Debugger runs multi-threaded static workers to inspect file mutations against your workspace actual architecture. It identifies drift, isolates failing unit tests, and proposes atomic unified diffs you can verify with a single keystroke.',
    icon: Bug
  },
  {
    id: 'm3e-canvas',
    badge: 'DESIGN TO CODE',
    name: 'M3E Canvas',
    headline: 'Project-Native Visual UI Generation',
    description:
      'Bridge the gap between frontend design and production code without leaving your IDE. The M3E Canvas extracts your project active design system tokens, Tailwind palettes, and CSS variables directly from source. Design components visually on an interactive canvas and watch bidirectional code synchronize instantly with Monaco.',
    icon: Palette
  }
];

export default function FeatureGrid() {
  return (
    <section className={styles.section} id="features" aria-labelledby="features-heading">
      <div className={styles.header}>
        <span className={styles.eyebrow}>THE "WHY TY-CODE" ADVANTAGE</span>
        <h2 id="features-heading">Engineered for Sovereign Developer Velocity</h2>
        <p className={styles.subhead}>
          Autonomous agentic capabilities built directly on top of native OS security primitives and local hardware.
        </p>
      </div>

      <div className={styles.grid}>
        {FEATURES.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.iconWrap}>
                  <Icon size={20} aria-hidden="true" />
                </div>
                <span className={styles.cardBadge}>{item.badge}</span>
              </div>
              <h3 className={styles.cardName}>{item.name}</h3>
              <h4 className={styles.cardHeadline}>{item.headline}</h4>
              <p className={styles.cardDesc}>{item.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
