export function hasPrivacySignal(): boolean {
  const navigatorWithPrivacySignals = navigator as Navigator & {
    globalPrivacyControl?: boolean | string;
  };
  return navigator.doNotTrack === '1'
    || navigatorWithPrivacySignals.globalPrivacyControl === true
    || navigatorWithPrivacySignals.globalPrivacyControl === '1';
}

export function recordWebsitePageView(): void {
  if (typeof navigator === 'undefined' || hasPrivacySignal()) return;

  void fetch('/api/pageview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body: JSON.stringify({ event: 'page_view' })
  }).catch(() => {
    // The public site remains usable if the optional analytics binding is absent.
  });
}
