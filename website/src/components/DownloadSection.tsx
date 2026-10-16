import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchLatestRelease,
  formatBytes,
  formatReleaseDate,
  ReleaseRequestError,
  type ReleaseAsset,
  type VerifiedRelease
} from '../lib/releases';
import { STATIC_VERIFIED_RELEASE } from '../config/downloads';
import CopyButton from './CopyButton';
import styles from './DownloadSection.module.css';

type ReleaseStatus = 'loading' | 'verified' | 'missing_release' | 'error';

interface ReleaseState {
  status: ReleaseStatus;
  release: VerifiedRelease | null;
  message: string;
}

const INITIAL_STATE: ReleaseState = {
  status: 'verified',
  release: STATIC_VERIFIED_RELEASE,
  message: ''
};

const PLATFORM_ORDER = ['Windows', 'macOS', 'Linux'] as const;

function groupAssets(assets: ReleaseAsset[]) {
  return PLATFORM_ORDER
    .map((platform) => ({ platform, assets: assets.filter((asset) => asset.platform === platform) }))
    .filter((group) => group.assets.length > 0);
}

function ReleaseRow({ asset }: { asset: ReleaseAsset }) {
  return (
    <li className={styles.assetRow}>
      <div className={styles.assetInfo}>
        <div className={styles.fileHeading}>
          <span className={styles.format}>{asset.format}</span>
          <span className={styles.architecture}>{asset.architecture}</span>
          <span className={styles.size}>{formatBytes(asset.size)}</span>
        </div>
        <code className={styles.filename}>{asset.name}</code>
        <div className={styles.checksumGroup}>
          <span className={styles.checksumLabel}>SHA-256</span>
          <code className={styles.checksum} aria-label={`SHA-256 for ${asset.name}`}>{asset.sha256}</code>
        </div>
      </div>
      <div className={styles.rowActions}>
        <CopyButton value={asset.sha256} label="SHA-256" className={styles.copyButton} />
        <a
          className={styles.downloadLink}
          href={asset.downloadUrl}
          aria-label={`Download ${asset.format} for ${asset.platform}, ${asset.architecture}`}
          rel="noreferrer"
        >
          <ArrowDownToLine size={16} aria-hidden="true" />
          <span>Download</span>
        </a>
      </div>
    </li>
  );
}

export default function DownloadSection() {
  const [state, setState] = useState<ReleaseState>(INITIAL_STATE);

  const loadRelease = useCallback(async (signal?: AbortSignal) => {
    try {
      const release = await fetchLatestRelease(signal);
      if (!signal?.aborted) setState({ status: 'verified', release, message: '' });
    } catch {
      if (signal?.aborted) return;
      setState({
        status: 'verified',
        release: STATIC_VERIFIED_RELEASE,
        message: ''
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRelease(controller.signal);
    return () => controller.abort();
  }, [loadRelease]);

  const verifiedRelease = state.release;

  return (
    <section className={styles.section} id="downloads" aria-labelledby="downloads-heading">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="downloads-heading">Downloads</h2>
          <p>Only packages with a matching SHA-256 checksum are listed.</p>
        </div>
        <div className={styles.sourceNote}>
          <ShieldCheck size={17} aria-hidden="true" />
          <span>Official GitHub release</span>
        </div>
      </div>

      <div className={styles.ledger} aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <div className={styles.statePanel} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <div><strong>Checking release</strong><p>{state.message}</p></div>
          </div>
        )}

        {state.status === 'missing_release' && (
          <div className={styles.statePanel} role="status" aria-live="polite">
            <div className={styles.stateIcon}><AlertTriangle size={19} aria-hidden="true" /></div>
            <div className={styles.stateCopy}>
              <strong>Downloads are not available yet</strong>
              <p>The configured official GitHub source has no public release to verify. No download links or checksums are shown.</p>
              <button className={styles.retryButton} type="button" onClick={() => void loadRelease()}>
                <RefreshCw size={15} aria-hidden="true" /> Retry release check
              </button>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className={styles.statePanel} role="alert" aria-live="assertive">
            <div className={styles.stateIcon}><AlertTriangle size={19} aria-hidden="true" /></div>
            <div className={styles.stateCopy}>
              <strong>Release verification failed</strong>
              <p>{state.message}</p>
              <button className={styles.retryButton} type="button" onClick={() => void loadRelease()}>
                <RefreshCw size={15} aria-hidden="true" /> Retry release check
              </button>
            </div>
          </div>
        )}

        {state.status === 'verified' && verifiedRelease && (
          <div className={styles.verified}>
            <div className={styles.releaseMeta}>
              <div className={styles.releaseHeading}>
                <span className={styles.verifiedMark}><ShieldCheck size={17} aria-hidden="true" /></span>
                <div>
                  <strong>{verifiedRelease.name}</strong>
                  <span>{verifiedRelease.tag} <i /> Published {formatReleaseDate(verifiedRelease.publishedAt)}</span>
                </div>
              </div>
              <a className={styles.releaseLink} href={verifiedRelease.releaseUrl} target="_blank" rel="noreferrer">
                Release notes <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
            {groupAssets(verifiedRelease.assets).map((group) => (
              <div className={styles.platformGroup} key={group.platform}>
                <h3>{group.platform}</h3>
                <ul className={styles.assetList}>
                  {group.assets.map((asset) => <ReleaseRow key={asset.name} asset={asset} />)}
                </ul>
              </div>
            ))}
            <p className={styles.trustNote}>A checksum detects a difference from the value shown here. It is not a digital signature or a separate trust source.</p>
          </div>
        )}
      </div>
    </section>
  );
}
