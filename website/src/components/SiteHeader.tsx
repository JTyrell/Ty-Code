import { ArrowDown, ShieldCheck } from 'lucide-react';
import styles from './SiteHeader.module.css';

export default function SiteHeader() {
  return (
    <header className={styles.header}>
      <a className={styles.brand} href="#top" aria-label="Ty-Code home">
        <img src="/icon.svg" width="34" height="34" alt="" />
        <span>Ty-Code</span>
      </a>
      <nav className={styles.nav} aria-label="Main navigation">
        <a href="#downloads"><ArrowDown aria-hidden="true" size={15} /> Downloads</a>
        <a href="#verify"><ShieldCheck aria-hidden="true" size={15} /> Verify</a>
        <a href="#privacy">Privacy</a>
      </nav>
    </header>
  );
}
