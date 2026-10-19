/**
 * Image → CSS palette conversion (M3E Canvas)
 *
 * Extracts a color palette from a user-picked image with node-vibrant in the
 * renderer and produces ready-to-paste CSS: a gradient, CSS custom properties
 * and a suggested text color with strong contrast against the dominant swatch.
 */

export interface ImageCssResult {
  palette: string[];
  gradient: string;
  textColor: string;
  cssSource: string;
  sourceName: string;
}

interface VibrantSwatch {
  hex: string;
  population: number;
}

const isHexColor = (value: string): boolean =>
  /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());

const relativeLuminance = (hex: string): number => {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return 0.5;
  const int = parseInt(m[1], 16);
  const channel = (shift: number): number => {
    const c = ((int >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
};

const pickBestTextFor = (backgroundHex: string): '#f8fafc' | '#1c1917' =>
  relativeLuminance(backgroundHex) > 0.45 ? '#1c1917' : '#f8fafc';

export async function extractImageCss(file: File): Promise<ImageCssResult> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const mod = (await import('node-vibrant/browser')) as { Vibrant: { from: (src: string) => { getPalette: () => Promise<Record<string, VibrantSwatch | null>> } } };
    const swatchMap = await mod.Vibrant.from(objectUrl).getPalette();

    const preferredOrder: Array<keyof typeof swatchMap> = [
      'Vibrant',
      'DarkVibrant',
      'LightVibrant',
      'Muted',
      'DarkMuted',
      'LightMuted'
    ];
    const picked: VibrantSwatch[] = [];
    for (const key of preferredOrder) {
      const swatch = swatchMap[key];
      if (swatch && isHexColor(swatch.hex) && !picked.some((candidate) => candidate.hex === swatch.hex)) {
        picked.push(swatch);
      }
    }
    const others = Object.values(swatchMap)
      .filter((swatch): swatch is VibrantSwatch => Boolean(swatch) && isHexColor(String(swatch?.hex)))
      .sort((a, b) => b.population - a.population);
    for (const swatch of others) {
      if (picked.length >= 5) break;
      if (!picked.some((candidate) => candidate.hex === swatch.hex)) picked.push(swatch);
    }
    if (picked.length === 0) {
      picked.push({ hex: '#8b5cf6', population: 1 });
    }

    const palette = picked.map((swatch) => swatch.hex);
    const dominant = picked.reduce((best, candidate) =>
      candidate.population > best.population ? candidate : best, picked[0]);
    const gradientStops = palette.slice(0, 3);
    const stopCount = gradientStops.length;
    const finalGradient = `linear-gradient(135deg, ${
      gradientStops
        .map((hex, index) =>
          stopCount === 1 ? `${hex} 100%` : `${hex} ${Math.round((index / (stopCount - 1)) * 100)}%`
        )
        .join(', ')
    })`;
    const textColor = pickBestTextFor(dominant.hex);

    const variables = palette
      .map((hex, index) => {
        const names = ['primary', 'secondary', 'accent', 'surface', 'highlight'];
        return `  --src-${names[index] ?? `tone-${index + 1}`}: ${hex};`;
      })
      .join('\n');

    const cssSource = [
      `/* Palette extracted from ${file.name || 'picked image'} */`,
      `.src-canvas {`,
      `  background: ${finalGradient};`,
      `  color: ${textColor};`,
      `}`,
      `:root {`,
      variables,
      `}`
    ].join('\n');

    return {
      palette,
      gradient: finalGradient,
      textColor,
      cssSource,
      sourceName: file.name || 'picked image'
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
