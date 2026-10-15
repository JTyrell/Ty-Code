/**
 * Ty-Code Desktop IDE - LogoWithFallback Component
 * Renders extension logos with skeleton shimmer, lazy loading, no-referrer privacy,
 * and deterministic initials avatar fallback on missing/failed icons.
 */

import React, { useState, useMemo } from 'react';

export interface LogoWithFallbackProps {
  id: string;
  displayName: string;
  iconUrl?: string;
  size?: number;
  className?: string;
}

// Curated harmonious Obsidian Cyber palette for deterministic fallback avatars
const AVATAR_PALETTE = [
  '#7c3aed', // Purple
  '#0891b2', // Cyan
  '#059669', // Emerald
  '#d97706', // Amber
  '#e11d48', // Rose
  '#2563eb', // Blue
  '#9333ea', // Violet
  '#0d9488', // Teal
  '#4f46e5'  // Indigo
];

/**
 * Deterministically generates a consistent background color from an extension ID.
 */
export function getDeterministicColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

/**
 * Extracts 1-2 letter initials from a display name or ID.
 */
export function getInitials(displayName: string): string {
  if (!displayName || typeof displayName !== 'string') return 'EX';
  const clean = displayName.replace(/[^a-zA-Z0-9\s_-]/g, '').trim();
  if (!clean) return 'EX';

  const parts = clean.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export const LogoWithFallback: React.FC<LogoWithFallbackProps> = ({
  id,
  displayName,
  iconUrl,
  size = 40,
  className = ''
}) => {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const initials = useMemo(() => getInitials(displayName || id), [displayName, id]);
  const avatarBg = useMemo(() => getDeterministicColor(id), [id]);

  const hasValidIcon = Boolean(iconUrl && !imgError);

  return (
    <div
      className={`extension-logo-container ${className}`}
      data-testid="extension-logo-box"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        maxWidth: `${size}px`,
        maxHeight: `${size}px`,
        borderRadius: '6px',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hasValidIcon ? 'var(--bg-primary)' : avatarBg,
        border: '1px solid var(--border-subtle)',
        flexShrink: 0,
        userSelect: 'none'
      }}
      title={displayName}
    >
      {hasValidIcon ? (
        <>
          {/* Skeleton shimmer placeholder while image loads */}
          {!imgLoaded && (
            <div
              className="logo-shimmer"
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'var(--bg-hover)',
                animation: 'skeleton-shimmer 1.5s infinite linear'
              }}
            />
          )}

          <img
            src={iconUrl}
            alt={`${displayName} icon`}
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              setImgError(true);
              setImgLoaded(true);
            }}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              opacity: imgLoaded ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out'
            }}
          />
        </>
      ) : (
        /* Initials avatar fallback with deterministic color */
        <span
          data-testid="extension-logo-fallback"
          style={{
            color: '#ffffff',
            fontSize: `${Math.round(size * 0.36)}px`,
            fontWeight: 700,
            letterSpacing: '0.5px',
            lineHeight: 1,
            textShadow: '0 1px 2px rgba(0,0,0,0.4)',
            pointerEvents: 'none'
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
};
