import { ArrowUpRight } from 'lucide-react';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <p>Ty-Code <span>·</span> Desktop coding workspace</p>
      <a href="#top">Back to top <ArrowUpRight size={14} aria-hidden="true" /></a>
    </footer>
  );
}
