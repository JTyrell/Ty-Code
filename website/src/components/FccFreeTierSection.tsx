import { ArrowUpRight, Flame, GitFork, Sparkles, Terminal } from 'lucide-react';
import styles from './FccFreeTierSection.module.css';

export default function FccFreeTierSection() {
  return (
    <section className={styles.section} id="fcc-free-tier" aria-labelledby="fcc-heading">
      <div className={styles.container}>
        <div className={styles.badgeRow}>
          <span className={styles.eyebrow}>
            <Flame size={13} aria-hidden="true" /> COMMUNITY POWERED • ZERO COST
          </span>
          <span className={styles.tokenPill}>
            <Sparkles size={13} aria-hidden="true" /> 1.3B+ Monthly Free Tokens
          </span>
        </div>

        <h2 id="fcc-heading" className={styles.title}>
          Powered by Open Source: The 1.3B+ Token Free Tier
        </h2>

        <p className={styles.introCopy}>
          Great software should be accessible to every engineer on earth, not hidden behind an upfront paywall. Ty-Code integrates multi-harness routing across 11 distinct development runtimes—including <strong>Claude Code</strong>, <strong>Codex</strong>, <strong>VS Code Extension APIs</strong>, <strong>Pi</strong>, <strong>OpenCode</strong>, <strong>Cline</strong>, and <strong>Aider</strong>. This unlocks direct, zero-friction access to over 1.3 billion combined monthly tokens across high-throughput open-weights supply pools.
        </p>

        <div className={styles.diagramBox}>
          <div className={styles.diagramHeader}>
            <Terminal size={14} aria-hidden="true" />
            <span>Ty-Code Local Loopback Multi-Harness Pipeline (Port 8765)</span>
          </div>
          <pre className={styles.diagramPre}>
{`+-----------------------------------------------------------------------------------------+
|                                TY-CODE MULTI-HARNESS ROUTER                             |
|  [Claude Code] [OpenCode] [Codex] [Pi] [VS Code] [Cline] [Aider] [Hermes] [DeepSeek]... |
+-----------------------------------------------------------------------------------------+
                                             |
                         Local Loopback Supply Adapter (Port 8765)
                                             v
+-----------------------------------------------------------------------------------------+
|                     FREE-CLAUDE-CODE (FCC) REVERSE PROXY SUPPLY LAYER                   |
|  • Zero Canned Mock Replies           • Strict ToS-Safe Filter (Risky Web Stubs Blocked)|
|  • High-Throughput Free Token Pool    • Automated Model Rotation & Failover             |
+-----------------------------------------------------------------------------------------+`}
          </pre>
        </div>

        <div className={styles.creditCard}>
          <div className={styles.creditHeader}>
            <GitFork size={18} className={styles.forkIcon} aria-hidden="true" />
            <h3>🌟 Open-Source Credit & Acknowledgement: free-claude-code (FCC)</h3>
          </div>
          <p className={styles.creditBody}>
            Ty-Code's multi-harness routing capability was deeply inspired by and architected upon the pioneering methodologies established by the <strong>free-claude-code (FCC)</strong> project created by Ali Shahryar.
          </p>
          <div className={styles.repoLinkRow}>
            <a
              href="https://github.com/Alishahryar1/free-claude-code.git"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.repoLink}
            >
              https://github.com/Alishahryar1/free-claude-code.git
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
          <blockquote className={styles.attributionQuote}>
            Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT —{' '}
            <a href="https://github.com/Alishahryar1/free-claude-code" target="_blank" rel="noopener noreferrer">
              https://github.com/Alishahryar1/free-claude-code
            </a>
          </blockquote>
          <p className={styles.creditSummary}>
            By adapting FCC's mock-free binary loopback architecture into Ty-Code's hardened enterprise sandbox, we engineered a 100% Terms-of-Service-compliant, voice-supported, and session-aware supply layer. This allows developers to build, test, and iterate without spending a single dollar on initial token budgets.
          </p>
        </div>
      </div>
    </section>
  );
}
