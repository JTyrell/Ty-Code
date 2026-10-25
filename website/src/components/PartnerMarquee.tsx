import styles from './PartnerMarquee.module.css';

interface EcosystemPartner {
  name: string;
  isFcc?: boolean;
}

const PARTNERS: EcosystemPartner[] = [
  { name: 'Monaco Editor' },
  { name: 'Electron 30' },
  { name: 'TypeScript' },
  { name: 'OpenRouter' },
  { name: 'Ollama' },
  { name: 'Groq' },
  { name: 'Anthropic' },
  { name: 'free-claude-code (FCC)', isFcc: true }
];

export default function PartnerMarquee() {
  return (
    <div className={styles.marqueeContainer}>
      <span className={styles.label}>
        Trusted Open-Source & Model Supply Ecosystem
      </span>
      <div className={styles.pillRow}>
        {PARTNERS.map((partner) => (
          <span
            key={partner.name}
            className={partner.isFcc ? styles.highlightPill : styles.pill}
          >
            <span
              className={partner.isFcc ? styles.highlightDot : styles.pillDot}
              aria-hidden="true"
            />
            {partner.name}
          </span>
        ))}
      </div>
    </div>
  );
}
