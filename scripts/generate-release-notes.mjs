import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));

export function generateReleaseNotes(options = {}) {
  const version = options.version || process.env.TY_CODE_RELEASE_VERSION?.replace(/^v/, '') || packageJson.version;
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
  output += `Welcome to **Ty-Code v${version}**. This release includes the changes listed below and platform packages attached to the release.\n\n`;

  output += `## Highlights\n`;
  output += `- Virtualized file explorer and multi-theme UI.\n`;
  output += `- Myers diff previews with bounded edit-distance work and a large-input guard.\n`;
  output += `- Update checks and user-approved download/install flow, subject to release signing and publishing configuration.\n`;
  output += `- Cross-platform package targets are configured for Windows, macOS, and Linux.\n\n`;

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
  output += `- **Windows**: \`Ty-Code-Setup-${version}.exe\` (NSIS installer) / \`Ty-Code-${version}-portable.exe\`\n`;
  output += `- **macOS**: \`Ty-Code-${version}-mac.dmg\` / \`Ty-Code-${version}-mac.zip\` (Universal targets configured)\n`;
  output += `- **Linux**: \`Ty-Code-${version}-x64.AppImage\` / \`Ty-Code-${version}-x64.deb\` / \`Ty-Code-${version}-x64.rpm\`\n\n`;

  output += `## Checksums & Verification\n`;
  output += `The release workflow generates a SHA256SUMS.txt file for uploaded package assets.\n`;

  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const notes = generateReleaseNotes();
  console.log(notes);
}
