import { useEffect } from 'react';
import DownloadSection from './components/DownloadSection';
import EnterpriseCompliance from './components/EnterpriseCompliance';
import FccFreeTierSection from './components/FccFreeTierSection';
import FeatureGrid from './components/FeatureGrid';
import HowToVerify from './components/HowToVerify';
import PrivacySummary from './components/PrivacySummary';
import ProblemSolution from './components/ProblemSolution';
import SiteFooter from './components/SiteFooter';
import SiteHeader from './components/SiteHeader';
import { recordWebsitePageView } from './lib/privacy';
import styles from './App.module.css';

export default function App() {
  useEffect(() => {
    recordWebsitePageView();
  }, []);

  return (
    <div className={styles.site} id="top">
      <SiteHeader />
      <main className={styles.main}>
        <div className={styles.topGrid}>
          <section className={styles.intro} aria-labelledby="intro-heading">
            <div className={styles.badgePill}>
              ⚡ v1.0.0 Stable Release • Zero-Telemetry Certified • 100% Local-First
            </div>
            <div className={styles.introCopy}>
              <h1 id="intro-heading">Local-First AI Coding. Zero Cloud Exfiltration.</h1>
              <p>
                Build at terminal velocity with an autonomous AI IDE that never phones home with your proprietary source code. Powered by our intelligent <strong>Omni-Orchestrator</strong> and a unified <strong>ProviderGateway</strong> unlocking <strong>1.3B+ free tokens</strong> across 11 multi-harness runtimes.
              </p>
            </div>
            <div className={styles.ctaRow}>
              <a href="#downloads" className={styles.primaryCta}>
                Download for Free (v1.0.0)
              </a>
              <a
                href="https://github.com/JTyrell/Ty-Code/blob/main/docs/ENTERPRISE-WHITEPAPER.md"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.secondaryCta}
              >
                View Enterprise Architecture →
              </a>
            </div>
            <div className={styles.localNote}>
              <span className={styles.localMark} aria-hidden="true" />
              <span>Hardware safeStorage <i /> Air-gapped BYOK <i /> Windows • macOS • Linux</span>
            </div>
          </section>
          <DownloadSection />
        </div>

        <ProblemSolution />
        <FeatureGrid />
        <FccFreeTierSection />
        <EnterpriseCompliance />
        <HowToVerify />
        <PrivacySummary />
      </main>
      <div className={styles.footerWrap}><SiteFooter /></div>
    </div>
  );
}
