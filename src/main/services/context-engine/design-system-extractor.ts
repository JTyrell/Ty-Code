/**
 * Ty-Code Context Engine: Project-Native Design System & UI Stack Extractor
 *
 * Scans the workspace file system for:
 * 1. Tailwind config (tailwind.config.{js,ts,mjs,cjs}):
 *    Extracts custom theme colors, spacing scales, and breakpoints.
 * 2. UI component libraries:
 *    - shadcn/ui: components/ui or src/components/ui
 *    - @mui/material, @chakra-ui/react, antd from package.json
 * 3. CSS variables and theme tokens from globals.css / index.css.
 *
 * Non-blocking, local-only, and cached until next /sync or cache clear.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface DesignComponent {
  name: string;
  importPath: string;
  category?: 'primitive' | 'layout' | 'form' | 'feedback' | 'navigation';
}

export interface DesignProfile {
  colors: Record<string, string>;
  tailwindClasses: string[];
  spacing: Record<string, string>;
  breakpoints: Record<string, string>;
  uiLibrary: string;
  components: DesignComponent[];
  cssFramework: 'Tailwind' | 'Vanilla CSS' | 'CSS Modules' | 'Styled Components' | 'None';
  framework?: string;
  routerType?: string;
  lastScanned: number;
}

const designProfileCache = new Map<string, { profile: DesignProfile; timestamp: number }>();

/**
 * Returns cached DesignProfile if available and less than 5 minutes old.
 */
export function getCachedDesignProfile(rootPath: string): DesignProfile | null {
  const resolved = path.resolve(rootPath);
  const entry = designProfileCache.get(resolved);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
    designProfileCache.delete(resolved);
    return null;
  }
  return entry.profile;
}

/**
 * Clears cached design system profiles (invoked during /sync).
 */
export function clearDesignProfileCache(): void {
  designProfileCache.clear();
}

/**
 * Helper to safely read a file if it exists.
 */
async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Helper to check if a directory exists.
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Capitalizes a kebab-case or camelCase name into PascalCase (e.g. dropdown-menu -> DropdownMenu).
 */
function toPascalCase(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Extracts custom colors, spacing, and breakpoints from Tailwind configuration.
 */
export function parseTailwindConfig(content: string): {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  breakpoints: Record<string, string>;
} {
  const colors: Record<string, string> = {};
  const spacing: Record<string, string> = {};
  const breakpoints: Record<string, string> = {};

  // 1. Nested leaf object groups (e.g., brand: { DEFAULT: '#7c3aed', light: '#a78bfa' }, spacing: { '128': '32rem' })
  const nestedGroupMatches = content.matchAll(/['"]?([a-zA-Z0-9_-]+)['"]?\s*:\s*\{([^{}]+)\}/g);
  for (const group of nestedGroupMatches) {
    const groupName = group[1];
    if (['extend', 'theme', 'colors'].includes(groupName)) continue;
    const inner = group[2];
    const innerMatches = inner.matchAll(/['"]?([a-zA-Z0-9._-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g);
    for (const m of innerMatches) {
      const subKey = m[1];
      const val = m[2].trim();
      if (groupName === 'screens') {
        breakpoints[subKey] = val;
      } else if (groupName === 'spacing') {
        spacing[subKey] = val;
      } else {
        if (subKey.toUpperCase() === 'DEFAULT') {
          colors[groupName] = val;
        } else {
          colors[`${groupName}-${subKey}`] = val;
        }
      }
    }
  }

  // 2. Direct string colors (e.g., primary: '#2563eb', background: 'hsl(var(--background))')
  const colorMatches = content.matchAll(/['"]?([a-zA-Z0-9_-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g);
  for (const match of colorMatches) {
    const key = match[1];
    const val = match[2].trim();
    if (['width', 'height', 'top', 'bottom', 'left', 'right', 'spacing', 'screens', 'content'].includes(key)) continue;
    if (/^#[0-9a-fA-F]{3,8}$/.test(val) || /^(?:rgb|hsl)a?\(.+?\)$/i.test(val)) {
      if (!colors[key]) {
        colors[key] = val;
      }
    }
  }

  // 3. Fallback direct scan for custom screens/breakpoints
  const screenMatches = content.matchAll(/['"]?([a-zA-Z0-9_-]+)['"]?\s*:\s*['"](\d+(?:px|em|rem))['"]/g);
  for (const match of screenMatches) {
    const key = match[1];
    const val = match[2];
    if (!breakpoints[key]) {
      breakpoints[key] = val;
    }
  }

  // 4. Fallback direct scan for custom spacing values
  const spacingMatches = content.matchAll(/['"]?([0-9a-zA-Z._-]+)['"]?\s*:\s*['"](\d+(?:\.\d+)?(?:rem|px|em|%))['"]/g);
  for (const match of spacingMatches) {
    if (!spacing[match[1]]) {
      spacing[match[1]] = match[2];
    }
  }

  return { colors, spacing, breakpoints };
}

/**
 * Parses CSS variables from globals.css / index.css (e.g., shadcn/ui HSL or Hex themes).
 */
export function parseCssVariables(cssContent: string): Record<string, string> {
  const extractedColors: Record<string, string> = {};
  const varMatches = cssContent.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g);

  for (const match of varMatches) {
    const name = match[1].toLowerCase();
    const rawVal = match[2].trim();

    if (rawVal && !extractedColors[name]) {
      extractedColors[name] = rawVal;
    }
  }

  return extractedColors;
}

/**
 * Categorizes a UI component by its name.
 */
function categorizeComponent(name: string): DesignComponent['category'] {
  const lower = name.toLowerCase();
  if (['button', 'input', 'checkbox', 'switch', 'slider', 'textarea', 'select', 'radio'].some((k) => lower.includes(k))) {
    return 'form';
  }
  if (['dialog', 'alert', 'toast', 'popover', 'tooltip', 'modal', 'drawer'].some((k) => lower.includes(k))) {
    return 'feedback';
  }
  if (['card', 'container', 'sheet', 'separator', 'divider', 'collapsible', 'accordion'].some((k) => lower.includes(k))) {
    return 'layout';
  }
  if (['nav', 'navigation', 'tabs', 'breadcrumb', 'pagination', 'menubar'].some((k) => lower.includes(k))) {
    return 'navigation';
  }
  return 'primitive';
}

/**
 * Scans the workspace and extracts the complete DesignProfile.
 */
export async function extractDesignSystem(rootPath: string): Promise<DesignProfile> {
  const resolved = path.resolve(rootPath);
  const cached = getCachedDesignProfile(resolved);
  if (cached) return cached;

  let cssFramework: DesignProfile['cssFramework'] = 'None';
  let uiLibrary = 'Tailwind Base';
  const colors: Record<string, string> = {
    primary: '#a855f7',
    secondary: '#6366f1',
    background: '#0f172a',
    foreground: '#f8fafc',
    accent: '#10b981',
    muted: '#64748b',
    border: '#272a34'
  };
  const spacing: Record<string, string> = {
    '4': '1rem',
    '6': '1.5rem',
    '8': '2rem',
    '12': '3rem',
    '16': '4rem'
  };
  const breakpoints: Record<string, string> = {
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px'
  };
  const components: DesignComponent[] = [];

  // 1. Scan for Tailwind Config
  const tailwindConfigs = [
    path.join(resolved, 'tailwind.config.ts'),
    path.join(resolved, 'tailwind.config.js'),
    path.join(resolved, 'tailwind.config.cjs'),
    path.join(resolved, 'tailwind.config.mjs')
  ];

  for (const configPath of tailwindConfigs) {
    const content = await safeReadFile(configPath);
    if (content) {
      cssFramework = 'Tailwind';
      const parsed = parseTailwindConfig(content);
      Object.assign(colors, parsed.colors);
      Object.assign(spacing, parsed.spacing);
      Object.assign(breakpoints, parsed.breakpoints);
      break;
    }
  }

  // 2. Scan for CSS variables in globals.css / index.css
  const cssPaths = [
    path.join(resolved, 'src/app/globals.css'),
    path.join(resolved, 'app/globals.css'),
    path.join(resolved, 'src/globals.css'),
    path.join(resolved, 'src/index.css'),
    path.join(resolved, 'styles/globals.css'),
    path.join(resolved, 'index.css')
  ];

  for (const cssPath of cssPaths) {
    const cssContent = await safeReadFile(cssPath);
    if (cssContent) {
      if (cssFramework === 'None' && (cssContent.includes('@tailwind') || cssContent.includes('@import "tailwindcss"'))) {
        cssFramework = 'Tailwind';
      }
      const parsedVars = parseCssVariables(cssContent);
      Object.assign(colors, parsedVars);
      break;
    }
  }

  // 3. Scan for UI libraries:
  // 3a. Check for shadcn/ui components in components/ui or src/components/ui
  const shadcnPaths = [
    path.join(resolved, 'components', 'ui'),
    path.join(resolved, 'src', 'components', 'ui')
  ];

  let foundShadcn = false;
  for (const shadcnDir of shadcnPaths) {
    if (await dirExists(shadcnDir)) {
      foundShadcn = true;
      uiLibrary = 'shadcn/ui';
      try {
        const entries = await fs.readdir(shadcnDir, { withFileTypes: true });
        const importPrefix = shadcnDir.includes('src') ? '@/components/ui' : '@/components/ui';
        for (const entry of entries) {
          if (entry.isFile() && /\.(?:tsx|jsx|ts|js)$/i.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            const componentName = toPascalCase(entry.name);
            const baseFileName = entry.name.replace(/\.[^/.]+$/, '');
            components.push({
              name: componentName,
              importPath: `${importPrefix}/${baseFileName}`,
              category: categorizeComponent(componentName)
            });
          }
        }
      } catch {}
      break;
    }
  }

  // 3b. Inspect package.json for frameworks & UI libraries
  let framework = 'React';
  let routerType: 'app-router' | 'pages-router' | 'none' = 'none';

  const pkgRaw = await safeReadFile(path.join(resolved, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (deps['next']) {
        framework = 'Next.js';
        if ((await dirExists(path.join(resolved, 'app'))) || (await dirExists(path.join(resolved, 'src', 'app')))) {
          routerType = 'app-router';
        } else if ((await dirExists(path.join(resolved, 'pages'))) || (await dirExists(path.join(resolved, 'src', 'pages')))) {
          routerType = 'pages-router';
        }
      } else if (deps['react']) {
        framework = 'React';
      }

      if (!foundShadcn) {
        if (deps['@mui/material']) {
          uiLibrary = 'Material UI';
          const muiComponents = ['Button', 'Card', 'TextField', 'Box', 'Typography', 'Dialog', 'AppBar', 'Checkbox', 'Switch'];
          for (const name of muiComponents) {
            components.push({ name, importPath: '@mui/material', category: categorizeComponent(name) });
          }
        } else if (deps['@chakra-ui/react']) {
          uiLibrary = '@chakra-ui';
          const chakraComponents = ['Button', 'Box', 'Input', 'Card', 'Heading', 'Text', 'Modal', 'Checkbox', 'Switch'];
          for (const name of chakraComponents) {
            components.push({ name, importPath: '@chakra-ui/react', category: categorizeComponent(name) });
          }
        } else if (deps['antd']) {
          uiLibrary = 'Ant Design';
          const antdComponents = ['Button', 'Card', 'Input', 'Typography', 'Modal', 'Checkbox', 'Switch'];
          for (const name of antdComponents) {
            components.push({ name, importPath: 'antd', category: categorizeComponent(name) });
          }
        }
      }
    } catch {}
  }

  // Default fallback base components if none were discovered
  if (components.length === 0) {
    components.push(
      { name: 'Button', importPath: '@/components/ui/button', category: 'form' },
      { name: 'Card', importPath: '@/components/ui/card', category: 'layout' },
      { name: 'Input', importPath: '@/components/ui/input', category: 'form' },
      { name: 'Badge', importPath: '@/components/ui/badge', category: 'primitive' },
      { name: 'Dialog', importPath: '@/components/ui/dialog', category: 'feedback' }
    );
  }

  // 4. Build representative list of Tailwind utility classes from extracted design tokens
  const tailwindClasses = [
    ...Object.keys(colors).flatMap((colorKey) => [`bg-${colorKey}`, `text-${colorKey}`, `border-${colorKey}`]),
    'rounded-lg',
    'rounded-xl',
    'rounded-2xl',
    'p-4',
    'p-6',
    'shadow-sm',
    'shadow-md',
    'shadow-lg'
  ];

  const profile: DesignProfile = {
    colors,
    tailwindClasses,
    spacing,
    breakpoints,
    uiLibrary,
    components,
    cssFramework,
    framework,
    routerType,
    lastScanned: Date.now()
  };

  designProfileCache.set(resolved, { profile, timestamp: Date.now() });
  return profile;
}
