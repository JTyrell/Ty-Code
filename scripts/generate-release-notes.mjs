import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

export function generateReleaseNotes(options = {}) {
  const version = options.version || packageJson.version;
  const date = options.date || new Date().toISOString().split('T')[0];

  let rawLog = '';
  try {
    rawLog = execSync('git log -n 40 --pretty=format:"%h%x09%s%x09%an"', { cwd: rootDir, encoding: 'utf-8' });
  } catch {
    rawLog = '';
  }

  const categories = {
    features: [],
    fixes: [],
    performance: [],
    polish: [],
    tooling: [],
    other: []
  };

  const lines = rawLog.split('\n').filter(Boolean);
  for (const line of lines) {
    const [hash, message, author] = line.split('\t');
    if (!message) continue;

    const entry = { hash, message, author };
    const lower = message.toLowerCase();

    if (lower.startsWith('feat:') || lower.startsWith('feat(')) {
      categories.features.push(entry);
    } else if (lower.startsWith('fix:') || lower.startsWith('fix(')) {
      categories.fixes.push(entry);
    } else if (lower.startsWith('perf:') || lower.startsWith('perf(')) {
      categories.performance.push(entry);
    } else if (lower.startsWith('style:') || lower.startsWith('refactor:')) {
      categories.polish.push(entry);
    } else if (lower.startsWith('chore:') || lower.startsWith('build:') || lower.startsWith('ci:')) {
      categories.tooling.push(entry);
    } else {
      categories.other.push(entry);
    }
  }

  let output = `# Ty-Code v${version} (${date})\n\n`;
  output += `Welcome to **Ty-Code v${version}**! This release brings major polish, 60fps performance optimizations, virtual scrolling, auto-updates, and multi-platform distribution packages for Windows, macOS, and Linux.\n\n`;

  output += `## 🌟 Highlights\n`;
  output += `- **Virtual File Tree**: Smooth 60fps scrolling and instant navigation across 10,000+ files.\n`;
  output += `- **Auto-Update Engine**: Background download, update channels (Stable/Beta/Nightly), and single-click update.\n`;
  output += `- **Performance**: Sub-2s startup time, Myers diff algorithm for fast hunks, and lazy editor disposal.\n`;
  output += `- **UI/UX Polish**: Multi-theme system (Dark, Light, High-Contrast), toast notifications, welcome guide, and i18n support.\n`;
  output += `- **Cross-Platform Installers**: Windows (NSIS & Portable), macOS (Universal DMG & ZIP), Linux (AppImage, DEB, RPM).\n\n`;

  const renderSection = (title, items) => {
    if (items.length === 0) return '';
    let section = `### ${title}\n`;
    for (const item of items) {
      section += `- ${item.message} (\`${item.hash}\`)\n`;
    }
    return section + '\n';
  };

  output += renderSection('🚀 Features', categories.features);
  output += renderSection('⚡ Performance & Optimization', categories.performance);
  output += renderSection('🐛 Bug Fixes', categories.fixes);
  output += renderSection('🎨 UI/UX Polish', categories.polish);
  output += renderSection('🔧 Build & System', categories.tooling);

  output += `## 📦 Download Packages\n`;
  output += `- **Windows**: \`Ty-Code-Setup-${version}.exe\` (NSIS Installer) / \`Ty-Code-${version}-portable.exe\`\n`;
  output += `- **macOS**: \`Ty-Code-${version}-universal.dmg\` (Apple Silicon & Intel) / \`Ty-Code-${version}-mac.zip\`\n`;
  output += `- **Linux**: \`Ty-Code-${version}.AppImage\` / \`ty-code_${version}_amd64.deb\` / \`ty-code-${version}.x86_64.rpm\`\n\n`;

  output += `## 🔐 Checksums & Verification\n`;
  output += `Every release artifact is accompanied by a SHA256 checksum file in the release assets.\n`;

  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notes = generateReleaseNotes();
  console.log(notes);
}
