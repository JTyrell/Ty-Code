import { Check, FileText, KeyRound, Lock, ShieldCheck, Terminal } from 'lucide-react';
import styles from './EnterpriseCompliance.module.css';

interface PillarItem {
  id: string;
  icon: typeof ShieldCheck;
  title: string;
  badge: string;
  description: string;
}

const PILLARS: PillarItem[] = [
  {
    id: 'zero-telemetry',
    icon: Lock,
    title: 'Zero-Telemetry Guarantee',
    badge: '100% LOCAL',
    description:
      'Because Ty-Code never routes repository files, ASTs, or chat history to external indexing servers, your compliance perimeter remains strictly confined to your managed hardware.'
  },
  {
    id: 'pty-sandbox',
    icon: Terminal,
    title: 'Three-Tier Terminal Sandbox',
    badge: 'ISOLATED PTY',
    description:
      'Automated agent commands run under strict allowlist policies with aggressive PTY environment scrubbing that strips API keys and secrets before execution.'
  },
  {
    id: 'hardware-vault',
    icon: KeyRound,
    title: 'Hardware Credential Sealing',
    badge: 'SAFESTORAGE',
    description:
      'All credentials remain locked in operating-system secure storage (safeStorage via DPAPI, Keychain, and Secret Service), preventing token theft from compromised local dependencies.'
  },
  {
    id: 'compliance-mdm',
    icon: ShieldCheck,
    title: 'HIPAA, SOC2 & MDM Governance',
    badge: 'REGULATED WORKSPACES',
    description:
      'Designed for regulated environments in healthcare, defense, and fintech. IT teams can deploy global policies via Intune, Jamf, or GPO to enforce private VPC endpoints across 1,000+ engineers.'
  }
];

export default function EnterpriseCompliance() {
  return (
    <section className={styles.section} id="compliance" aria-labelledby="compliance-heading">
      <div className={styles.header}>
        <span className={styles.eyebrow}>ENTERPRISE GRADE DATA SOVEREIGNTY</span>
        <h2 id="compliance-heading">Engineered for Healthcare, Defense, and Regulated Engineering</h2>
        <p className={styles.subhead}>
          Architecturally incapable of source code exfiltration. Proven under rigorous compliance standards.
        </p>
      </div>

      <div className={styles.grid}>
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <div key={pillar.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.iconWrap}>
                  <Icon size={18} aria-hidden="true" />
                </div>
                <span className={styles.badge}>{pillar.badge}</span>
              </div>
              <h3 className={styles.title}>{pillar.title}</h3>
              <p className={styles.desc}>{pillar.description}</p>
            </div>
          );
        })}
      </div>

      <div className={styles.whitepaperCallout}>
        <div className={styles.calloutContent}>
          <FileText size={22} className={styles.docIcon} aria-hidden="true" />
          <div>
            <h4>Read the Complete 10-Page Enterprise Architecture Whitepaper</h4>
            <p>Comprehensive threat modeling, IPC Zod schemas, sandbox specs, and machine-verified audit traces.</p>
          </div>
        </div>
        <a
          href="https://github.com/JTyrell/Ty-Code/blob/main/docs/ENTERPRISE-WHITEPAPER.md"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.whitepaperBtn}
        >
          View Enterprise Architecture →
        </a>
      </div>
    </section>
  );
}
