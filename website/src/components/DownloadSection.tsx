import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Apple,
  ArrowDownToLine,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Terminal
} from 'lucide-react';
import {
  fetchLatestRelease,
  formatBytes,
  formatReleaseDate,
  type ReleaseAsset,
  type VerifiedRelease
} from '../lib/releases';
import { STATIC_VERIFIED_RELEASE } from '../config/downloads';
import CopyButton from './CopyButton';
import styles from './DownloadSection.module.css';

type ReleaseStatus = 'loading' | 'verified' | 'missing_release' | 'error';
type PlatformFilter = 'All' | 'Windows' | 'macOS' | 'Linux';

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

const PAGE_SIZE = 4;

interface OsDocumentation {
  title: string;
  requirements: string;
  installGuide: string;
  verifySnippet: string;
  notes?: string;
}

const OS_DOCS: Record<'Windows' | 'macOS' | 'Linux', OsDocumentation> = {
  Windows: {
    title: 'Windows Installation & Verification',
    requirements: 'Windows 10/11 64-bit (x64)',
    installGuide: 'Run Ty-Code-Setup-1.0.0.exe for automatic desktop and PATH integration, or extract the portable ZIP.',
    verifySnippet: '(Get-FileHash ".\\Ty-Code-Setup-1.0.0.exe" -Algorithm SHA256).Hash.ToLower()',
    notes: 'If Windows SmartScreen appears on first run, click "More info" and select "Run anyway".'
  },
  macOS: {
    title: 'macOS Installation & Verification',
    requirements: 'macOS 12.0 Monterey or later (Universal / Apple Silicon & Intel)',
    installGuide: 'Open Ty-Code-1.0.0.dmg and drag Ty-Code into your Applications folder.',
    verifySnippet: 'shasum -a 256 Ty-Code-1.0.0.dmg',
    notes: 'For Gatekeeper warning, right-click and choose "Open", or run: xattr -cr /Applications/Ty-Code.app'
  },
  Linux: {
    title: 'Linux Installation & Verification',
    requirements: 'glibc 2.28+ (Ubuntu 20.04+, Debian 11+, Fedora 34+, Arch)',
    installGuide: 'AppImage: chmod +x Ty-Code-1.0.0.AppImage && ./Ty-Code-1.0.0.AppImage | Debian: sudo dpkg -i ty-code_1.0.0_amd64.deb | RPM: sudo rpm -i ty-code-1.0.0.x86_64.rpm',
    verifySnippet: 'sha256sum Ty-Code-1.0.0.AppImage',
    notes: 'For sandboxed containers or older distros, ensure libfuse2 / fuse3 is installed for AppImage execution.'
  }
};

function ReleaseRow({ asset }: { asset: ReleaseAsset }) {
  return (
    <li className={styles.assetRow}>
      <div className={styles.assetInfo}>
        <div className={styles.fileHeading}>
          <span className={styles.format}>{asset.format}</span>
          <span className={styles.platformBadge}>{asset.platform}</span>
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
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformFilter>('All');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showDocs, setShowDocs] = useState<boolean>(false);

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
  const allAssets = useMemo(() => verifiedRelease?.assets || [], [verifiedRelease]);

  const platformCounts = useMemo(() => {
    return {
      All: allAssets.length,
      Windows: allAssets.filter((a) => a.platform === 'Windows').length,
      macOS: allAssets.filter((a) => a.platform === 'macOS').length,
      Linux: allAssets.filter((a) => a.platform === 'Linux').length
    };
  }, [allAssets]);

  const filteredAssets = useMemo(() => {
    if (selectedPlatform === 'All') return allAssets;
    return allAssets.filter((asset) => asset.platform === selectedPlatform);
  }, [allAssets, selectedPlatform]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / PAGE_SIZE));
  const activePage = Math.min(currentPage, totalPages);

  const paginatedAssets = useMemo(() => {
    const startIndex = (activePage - 1) * PAGE_SIZE;
    return filteredAssets.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredAssets, activePage]);

  const handleTabChange = (platform: PlatformFilter) => {
    setSelectedPlatform(platform);
    setCurrentPage(1);
  };

  const activeDoc = selectedPlatform !== 'All' ? OS_DOCS[selectedPlatform] : null;

  return (
    <section className={styles.section} id="downloads" aria-labelledby="downloads-heading">
      <div className={styles.sectionHead}>
        <div>
          <h2 id="downloads-heading">Downloads & Checksums</h2>
          <p>Verified standalone packages for Windows, macOS, and Linux with cryptographic SHA-256 hashes.</p>
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
              <div className={styles.metaActions}>
                <button
                  type="button"
                  className={styles.docsToggleBtn}
                  onClick={() => setShowDocs((prev) => !prev)}
                  aria-expanded={showDocs}
                >
                  <BookOpen size={14} aria-hidden="true" />
                  <span>{showDocs ? 'Hide Documentation' : 'OS Documentation'}</span>
                  <ChevronDown size={14} className={showDocs ? styles.chevronRotated : ''} aria-hidden="true" />
                </button>
                <a className={styles.releaseLink} href={verifiedRelease.releaseUrl} target="_blank" rel="noreferrer">
                  Release notes <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
            </div>

            {/* Platform Navigation Tabs */}
            <div className={styles.tabBar} role="tablist" aria-label="Operating system download filter">
              {(['All', 'Windows', 'macOS', 'Linux'] as PlatformFilter[]).map((platform) => {
                const isActive = selectedPlatform === platform;
                return (
                  <button
                    key={platform}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ''}`}
                    onClick={() => handleTabChange(platform)}
                  >
                    {platform === 'Windows' && <Monitor size={15} aria-hidden="true" />}
                    {platform === 'macOS' && <Apple size={15} aria-hidden="true" />}
                    {platform === 'Linux' && <Terminal size={15} aria-hidden="true" />}
                    <span>{platform}</span>
                    <span className={styles.tabBadge}>{platformCounts[platform]}</span>
                  </button>
                );
              })}
            </div>

            {/* Quick OS Documentation Card */}
            {(showDocs || selectedPlatform !== 'All') && (
              <div className={styles.docsCard} role="region" aria-label="Installation documentation">
                <div className={styles.docsHead}>
                  <BookOpen size={16} aria-hidden="true" />
                  <strong>
                    {activeDoc ? activeDoc.title : 'Cross-Platform Installation & Verification Notes'}
                  </strong>
                </div>
                {activeDoc ? (
                  <div className={styles.docsBody}>
                    <p className={styles.docReq}><strong>Requirements:</strong> {activeDoc.requirements}</p>
                    <p className={styles.docGuide}><strong>Setup:</strong> {activeDoc.installGuide}</p>
                    {activeDoc.notes && <p className={styles.docNotes}><strong>Note:</strong> {activeDoc.notes}</p>}
                    <div className={styles.docVerifyBlock}>
                      <span className={styles.verifyLabel}>SHA-256 Check Command:</span>
                      <div className={styles.verifyRow}>
                        <code>{activeDoc.verifySnippet}</code>
                        <CopyButton value={activeDoc.verifySnippet} label="Command" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={styles.docsBody}>
                    <p className={styles.docGuide}>
                      Select any OS tab above (Windows, macOS, or Linux) to view targeted setup commands, requirement notes, and SHA-256 verification instructions.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Asset List & Pagination Controls */}
            <div className={styles.assetListWrapper}>
              <div className={styles.listHeaderRow}>
                <span className={styles.listCount}>
                  Showing {Math.min((activePage - 1) * PAGE_SIZE + 1, filteredAssets.length)}–
                  {Math.min(activePage * PAGE_SIZE, filteredAssets.length)} of {filteredAssets.length} packages
                  {selectedPlatform !== 'All' ? ` for ${selectedPlatform}` : ''}
                </span>
                {totalPages > 1 && (
                  <div className={styles.paginationControls}>
                    <button
                      type="button"
                      disabled={activePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={styles.pageBtn}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <span className={styles.pageIndicator}>
                      Page {activePage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={activePage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={styles.pageBtn}
                      aria-label="Next page"
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>

              <ul className={styles.assetList}>
                {paginatedAssets.map((asset) => (
                  <ReleaseRow key={asset.name} asset={asset} />
                ))}
              </ul>

              {/* Bottom Pagination for convenience */}
              {totalPages > 1 && (
                <div className={styles.paginationBottom}>
                  <div className={styles.paginationControls}>
                    <button
                      type="button"
                      disabled={activePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={styles.pageBtn}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={16} aria-hidden="true" />
                      <span>Prev</span>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((num) => (
                      <button
                        key={num}
                        type="button"
                        aria-current={num === activePage ? 'page' : undefined}
                        className={`${styles.pageNumberBtn} ${num === activePage ? styles.pageNumberActive : ''}`}
                        onClick={() => setCurrentPage(num)}
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={activePage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={styles.pageBtn}
                      aria-label="Next page"
                    >
                      <span>Next</span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className={styles.trustNote}>
              A checksum confirms the file was downloaded intact without transmission error or tampering. It is matched against the authoritative SHA256SUMS.txt manifest published with each official GitHub release.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
