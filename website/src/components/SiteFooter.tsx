import { ArrowUpRight } from 'lucide-react';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        <p>Ty-Code <span>·</span> Desktop coding workspace</p>
        <p style={{ fontSize: '0.75rem', opacity: 0.75, marginTop: '0.25rem' }}>
          Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — <a href="https://github.com/Alishahryar1/free-claude-code" target="_blank" rel="noopener noreferrer">https://github.com/Alishahryar1/free-claude-code</a>
        </p>
      </div>
      <a href="#top">Back to top <ArrowUpRight size={14} aria-hidden="true" /></a>
    </footer>
  );
}
