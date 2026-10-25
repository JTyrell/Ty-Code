import { ArrowDown, FileText } from 'lucide-react';
import CopyButton from './CopyButton';
import styles from './FinalCta.module.css';

const QUICKSTART_COMMAND = 'git clone https://github.com/JTyrell/Ty-Code.git && cd Ty-Code && npm ci && npm run dev';

export default function FinalCta() {
  return (
    <section className={styles.section} id="get-started" aria-labelledby="cta-heading">
      <div className={styles.box}>
        <span className={styles.eyebrow}>READY TO TAKE BACK CONTROL?</span>
        <h2 id="cta-heading" className={styles.title}>
          Code at Full Speed. Keep Your Intellectual Property Yours.
        </h2>
        <p className={styles.desc}>
          Join thousands of senior architects, startup builders, and open-source developers who have switched to local-first AI engineering. Install in seconds. No credit card required.
        </p>

        <div className={styles.actions}>
          <a href="#downloads" className={styles.primaryBtn}>
            <ArrowDown size={16} aria-hidden="true" />
            Get Ty-Code v1.0.0 Now
          </a>
          <a href="/campaign/ENTERPRISE-WHITEPAPER.pdf" target="_blank" rel="noopener noreferrer" className={styles.secondaryBtn}>
            <FileText size={16} aria-hidden="true" />
            Read Enterprise Whitepaper (PDF)
          </a>
        </div>

        <div className={styles.terminalSnippet}>
          <span className={styles.terminalLabel}>Quickstart:</span>
          <code className={styles.code}>{QUICKSTART_COMMAND}</code>
          <CopyButton value={QUICKSTART_COMMAND} label="Quickstart command" />
        </div>
      </div>
    </section>
  );
}
