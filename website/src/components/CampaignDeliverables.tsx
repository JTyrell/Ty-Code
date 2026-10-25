import { CheckCircle2, Download, ExternalLink, FileCode, FileText, Presentation } from 'lucide-react';
import styles from './CampaignDeliverables.module.css';

interface DeliverableItem {
  id: string;
  icon: typeof FileText;
  badge: string;
  title: string;
  description: string;
  links: {
    label: string;
    href: string;
    primary?: boolean;
    isDownload?: boolean;
  }[];
}

const CAMPAIGN_ITEMS: DeliverableItem[] = [
  {
    id: 'whitepaper',
    icon: FileText,
    badge: '10 PAGES • ARCHITECTURE',
    title: 'Enterprise Architecture Whitepaper (WP-ENT-2026-V1)',
    description:
      'Rigorous technical briefing for CTOs, CISOs, and enterprise architects. Proves threat containment across Electron process boundaries, OS safeStorage hardware sealing, PTY terminal sandbox allowlists, and compliance under SOC2 Type II and HIPAA.',
    links: [
      { label: 'Download PDF (250 KB)', href: '/campaign/ENTERPRISE-WHITEPAPER.pdf', primary: true, isDownload: true },
      { label: 'Web Reader', href: '/campaign/ENTERPRISE-WHITEPAPER.html' },
      { label: 'Word (.docx)', href: '/campaign/ENTERPRISE-WHITEPAPER.docx', isDownload: true }
    ]
  },
  {
    id: 'pitch-deck',
    icon: Presentation,
    badge: '12 SLIDES • MARP COMPATIBLE',
    title: 'Investor & Stakeholder Pitch Deck',
    description:
      'High-impact presentation deck covering the $32B generative developer tooling TAM, the architectural moat, the Omni-Orchestrator failover chain, and the 11-harness FCC reverse-proxy supply routing map with full speaker notes.',
    links: [
      { label: 'Download PPTX (3.3 MB)', href: '/campaign/INVESTOR-PITCH-DECK.pptx', primary: true, isDownload: true },
      { label: 'Slides PDF', href: '/campaign/INVESTOR-PITCH-DECK.pdf', isDownload: true },
      { label: 'Interactive HTML', href: '/campaign/INVESTOR-PITCH-DECK.html' }
    ]
  },
  {
    id: 'qa-trace',
    icon: CheckCircle2,
    badge: '100% PASS • MACHINE AUDIT',
    title: 'Pre-Publish QA Audit & Coverage Trace',
    description:
      'Machine-readable JSON evidence trace auditing all 12 provider capabilities, ToS compliance, persistent safeStorage protection, and full FCC attribution across 30 verification checks with SHA-256 artifact manifests.',
    links: [
      { label: 'Coverage Trace JSON', href: '/traces/fcc-coverage.json', primary: true },
      { label: 'SHA-256 Manifest', href: '/campaign/manifest.json' }
    ]
  },
  {
    id: 'landing-guide',
    icon: FileCode,
    badge: 'MKT-LANDING-2026-V1',
    title: 'Marketing Landing Page Copy & Wireframe Guide',
    description:
      'Complete developer SaaS conversion blueprint detailing hero positioning, comparison matrices, 2x2 Bento grids, free-tier reverse proxy architecture, and compliance trust signals.',
    links: [
      { label: 'Download PDF', href: '/campaign/MARKETING-LANDING-PAGE-COPY.pdf', primary: true, isDownload: true },
      { label: 'Web Guide', href: '/campaign/MARKETING-LANDING-PAGE-COPY.html' },
      { label: 'Word (.docx)', href: '/campaign/MARKETING-LANDING-PAGE-COPY.docx', isDownload: true }
    ]
  }
];

export default function CampaignDeliverables() {
  return (
    <section className={styles.section} id="briefings" aria-labelledby="campaign-heading">
      <div className={styles.header}>
        <span className={styles.eyebrow}>EXECUTIVE & TECHNICAL BRIEFINGS</span>
        <h2 id="campaign-heading">Campaign Deliverables & Architectural Specs</h2>
        <p className={styles.subhead}>
          Download fully compiled, production-ready whitepapers, presentation decks, and machine-verified audit traces generated locally by our pipeline.
        </p>
      </div>

      <div className={styles.grid}>
        {CAMPAIGN_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.iconWrap}>
                  <Icon size={20} aria-hidden="true" />
                </div>
                <span className={styles.badge}>{item.badge}</span>
              </div>
              <h3 className={styles.title}>{item.title}</h3>
              <p className={styles.desc}>{item.description}</p>
              <div className={styles.actions}>
                {item.links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={link.primary ? styles.btnPrimary : styles.btnSecondary}
                    {...(link.isDownload ? { download: '' } : {})}
                  >
                    {link.isDownload ? <Download size={13} aria-hidden="true" /> : <ExternalLink size={13} aria-hidden="true" />}
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
