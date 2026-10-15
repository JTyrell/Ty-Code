import { useEffect } from 'react';
import DownloadSection from './components/DownloadSection';
import HowToVerify from './components/HowToVerify';
import PrivacySummary from './components/PrivacySummary';
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
            <div className={styles.introCopy}>
              <h1 id="intro-heading">A desktop workspace for coding with AI.</h1>
              <p>
                Edit with Monaco, work in an integrated terminal, and choose the model providers that fit your workflow.
                Your project files and local indexes stay on your device.
              </p>
            </div>
            <div className={styles.localNote}>
              <span className={styles.localMark} aria-hidden="true" />
              <span>Windows <i /> macOS <i /> Linux</span>
            </div>
          </section>
          <DownloadSection />
        </div>
        <HowToVerify />
        <PrivacySummary />
      </main>
      <div className={styles.footerWrap}><SiteFooter /></div>
    </div>
  );
}
