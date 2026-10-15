import { ChevronDown, ShieldCheck } from 'lucide-react';
import CopyButton from './CopyButton';
import styles from './HowToVerify.module.css';

const unixCommand = 'shasum -a 256 "/path/to/downloaded-file"';
const windowsCommand = '(Get-FileHash ".\\path\\to\\downloaded-file" -Algorithm SHA256).Hash.ToLower()';

export default function HowToVerify() {
  return (
    <section className={styles.section} id="verify" aria-labelledby="verify-heading">
      <div className={styles.heading}>
        <ShieldCheck size={19} aria-hidden="true" />
        <div>
          <h2 id="verify-heading">Check the file before you install</h2>
          <p>Calculate SHA-256 for the file you downloaded and compare all 64 characters with the value shown above.</p>
        </div>
      </div>
      <details className={styles.details}>
        <summary>
          Show verification commands <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.commandBlock}>
          <div className={styles.commandRow}>
            <div><span>macOS and Linux</span><code>{unixCommand}</code></div>
            <CopyButton value={unixCommand} label="command" />
          </div>
          <div className={styles.commandRow}>
            <div><span>Windows PowerShell</span><code>{windowsCommand}</code></div>
            <CopyButton value={windowsCommand} label="command" />
          </div>
          <p>Replace the path with the installer’s actual location. The command prints a hash; compare it to the matching package above.</p>
        </div>
      </details>
      <p className={styles.caveat}>A checksum confirms that two files have the same bytes. It does not prove who built the file, and the published checksum should not be treated as a digital signature.</p>
    </section>
  );
}
