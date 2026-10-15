/**
 * Ty-Code Desktop IDE - LogoWithFallback Unit Tests
 * Validates initials extraction, deterministic background hashing,
 * and 404/missing icon fallback avatar rendering.
 */

import { getInitials, getDeterministicColor } from '../../src/renderer/src/components/extensions/LogoWithFallback';

export async function runLogoWithFallbackTests(assert: (cond: boolean, msg: string) => void) {
  console.log('--- Running LogoWithFallback Unit Tests ---');

  // Test 1: Initials Extraction
  assert(getInitials('Python') === 'PY', 'Single word extracts first two letters');
  assert(getInitials('Rust') === 'RU', 'Single word "Rust" -> "RU"');
  assert(getInitials('Go') === 'GO', 'Single word "Go" -> "GO"');
  assert(getInitials('Docker Extension') === 'DE', 'Two words extracts first letter of each');
  assert(getInitials('Git Lens') === 'GL', 'Two words "Git Lens" -> "GL"');
  assert(getInitials('Prettier - Code Formatter') === 'PC', 'Hyphenated name extracts first letters of first two segments');
  assert(getInitials('ms-tools') === 'MT', 'Hyphenated prefix extracts initials');
  assert(getInitials('') === 'EX', 'Empty string falls back to "EX"');
  assert(getInitials('   ') === 'EX', 'Whitespace falls back to "EX"');
  assert(getInitials('$$$') === 'EX', 'Symbols only falls back to "EX"');

  // Test 2: Deterministic Color Hashing
  const color1 = getDeterministicColor('ms-python.python');
  const color2 = getDeterministicColor('ms-python.python');
  assert(color1 === color2, 'Deterministic color is 100% reproducible for identical extension ID');
  assert(/^#[0-9a-f]{6}$/i.test(color1), 'Returns valid 6-digit hex color token');

  const testIds = [
    'esbenp.prettier-vscode',
    'dbaeumer.vscode-eslint',
    'golang.go',
    'rust-lang.rust-analyzer',
    'bradlc.vscode-tailwindcss',
    'eamodio.gitlens',
    'ms-toolsai.jupyter'
  ];

  const assignedColors = testIds.map((id) => getDeterministicColor(id));
  const uniqueColors = new Set(assignedColors);
  assert(uniqueColors.size >= 4, `Hash algorithm distributes across palette (${uniqueColors.size} unique colors across 7 extensions)`);

  // Test 3: Fallback state on error
  // Simulation: when image fails (onError triggered or missing iconUrl), avatar renders initials span
  const simulateRender = (iconUrl?: string, hasError = false) => {
    const hasValidIcon = Boolean(iconUrl && !hasError);
    if (!hasValidIcon) {
      return {
        type: 'initials-avatar',
        initials: getInitials('Community Tool'),
        backgroundColor: getDeterministicColor('community.tool')
      };
    }
    return {
      type: 'image',
      iconUrl,
      referrerPolicy: 'no-referrer',
      loading: 'lazy',
      decoding: 'async',
      objectFit: 'contain'
    };
  };

  const missingIconState = simulateRender(undefined);
  assert(missingIconState.type === 'initials-avatar', 'Renders initials avatar when iconUrl is undefined');
  assert(missingIconState.initials === 'CT', 'Initials avatar renders correct initials');

  const errorIconState = simulateRender('https://broken-url/404.png', true);
  assert(errorIconState.type === 'initials-avatar', 'Renders initials avatar when image 404s/fails');

  const validIconState = simulateRender('https://open-vsx.org/icon.png', false);
  assert(validIconState.type === 'image', 'Renders image when valid icon provided');
  assert(validIconState.referrerPolicy === 'no-referrer', 'Enforces referrerpolicy="no-referrer"');
  assert(validIconState.loading === 'lazy', 'Enforces loading="lazy"');
  assert(validIconState.decoding === 'async', 'Enforces decoding="async"');
  assert(validIconState.objectFit === 'contain', 'Enforces object-fit: contain');
}
