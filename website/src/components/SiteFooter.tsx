import { ArrowUpRight, ExternalLink } from 'lucide-react';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footerWrap}>
      <div className={styles.columns}>
        <div>
          <h4 className={styles.colTitle}>Product</h4>
          <ul className={styles.linkList}>
            <li><a href="#downloads">Download Binaries (v1.0.0)</a></li>
            <li><a href="/campaign/ENTERPRISE-WHITEPAPER.pdf" target="_blank" rel="noopener noreferrer">Enterprise Whitepaper (PDF)</a></li>
            <li><a href="https://github.com/JTyrell/Ty-Code/releases" target="_blank" rel="noopener noreferrer">Release Notes & Roadmap <ExternalLink size={11} aria-hidden="true" /></a></li>
            <li><a href="https://github.com/JTyrell/Ty-Code#readme" target="_blank" rel="noopener noreferrer">Documentation & Quickstart <ExternalLink size={11} aria-hidden="true" /></a></li>
          </ul>
        </div>

        <div>
          <h4 className={styles.colTitle}>Security & Architecture</h4>
          <ul className={styles.linkList}>
            <li><a href="#compliance">Zero-Telemetry Model</a></li>
            <li><a href="/campaign/ENTERPRISE-WHITEPAPER.pdf" target="_blank" rel="noopener noreferrer">Terminal Sandbox Policy</a></li>
            <li><a href="/traces/fcc-coverage.json" target="_blank" rel="noopener noreferrer">Verified Audit Traces (JSON)</a></li>
            <li><a href="https://github.com/JTyrell/Ty-Code/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer">Security Policy & Disclosure <ExternalLink size={11} aria-hidden="true" /></a></li>
          </ul>
        </div>

        <div>
          <h4 className={styles.colTitle}>Campaign & Briefings</h4>
          <ul className={styles.linkList}>
            <li><a href="/campaign/ENTERPRISE-WHITEPAPER.pdf" target="_blank" rel="noopener noreferrer">Whitepaper (PDF, 250 KB)</a></li>
            <li><a href="/campaign/INVESTOR-PITCH-DECK.pptx" target="_blank" rel="noopener noreferrer">Pitch Deck (PowerPoint, 3.3 MB)</a></li>
            <li><a href="/campaign/INVESTOR-PITCH-DECK.pdf" target="_blank" rel="noopener noreferrer">Pitch Deck Slides (PDF)</a></li>
            <li><a href="/campaign/manifest.json" target="_blank" rel="noopener noreferrer">SHA-256 Checksum Manifest</a></li>
          </ul>
        </div>

        <div>
          <h4 className={styles.colTitle}>Open Source & Community</h4>
          <ul className={styles.linkList}>
            <li><a href="https://github.com/JTyrell/Ty-Code" target="_blank" rel="noopener noreferrer">GitHub Repository <ExternalLink size={11} aria-hidden="true" /></a></li>
            <li><a href="https://discord.gg/tycode" target="_blank" rel="noopener noreferrer">Discord Developer Community <ExternalLink size={11} aria-hidden="true" /></a></li>
            <li><a href="https://github.com/JTyrell/Ty-Code/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contributing Guidelines <ExternalLink size={11} aria-hidden="true" /></a></li>
            <li><a href="https://github.com/JTyrell/Ty-Code/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License <ExternalLink size={11} aria-hidden="true" /></a></li>
          </ul>
        </div>
      </div>

      <div className={styles.bottomBar}>
        <div className={styles.attributionText}>
          <p className={styles.tagline}><strong>Ty-Code</strong> — Built on the shoulders of giants. Local-first sovereign AI development.</p>
          <p className={styles.fccLine}>
            Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — <a href="https://github.com/Alishahryar1/free-claude-code" target="_blank" rel="noopener noreferrer">https://github.com/Alishahryar1/free-claude-code</a>
          </p>
          <p className={styles.copyright}>© 2026 Ty-Code Project. Distributed under the MIT License. Data sovereignty guaranteed.</p>
        </div>
        <a href="#top" className={styles.backToTop}>
          Back to top <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}
