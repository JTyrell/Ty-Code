import { LockKeyhole, Radio } from 'lucide-react';
import styles from './PrivacySummary.module.css';

export default function PrivacySummary() {
  return (
    <section className={styles.section} id="privacy" aria-labelledby="privacy-heading">
      <div className={styles.heading}>
        <LockKeyhole size={19} aria-hidden="true" />
        <h2 id="privacy-heading">Your work stays on your device</h2>
      </div>
      <div className={styles.copy}>
        <p>
          Ty-Code stores workspace files, chat history, and project indexes locally. If you choose a hosted model,
          the prompt and context needed for that request go to the provider you selected.
        </p>
        <p>
          Optional desktop diagnostics are off by default and are not transmitted by the current app build. This
          website uses a small first-party page-view counter only when your browser does not send Do Not Track or
          Global Privacy Control. It uses no cookies, account IDs, or advertising trackers.
        </p>
      </div>
      <div className={styles.note}>
        <Radio size={16} aria-hidden="true" />
        <span>Website measurement and desktop-app telemetry are separate systems.</span>
      </div>
    </section>
  );
}
