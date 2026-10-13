import React from 'react';
import { Image, PixelRatio } from 'react-native';
import { ImageFormat, Skia } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { ICON_SVG, type IconName } from './icon-data';

/* The same Lucide set the web mockup ships (rounded, 2px stroke), from vendored SVG
 * strings drawn with Skia — no react-native-svg native module.
 *
 * Each icon is drawn ONCE, on a CPU surface, into a PNG that a plain <Image> shows,
 * cached per (name, colour, pixel size). An earlier version gave every icon its own
 * Skia <Canvas>, which on Android is a GPU-backed TextureView: a busy session (many
 * screens, the ECG chart, the fall alarm) ran out of surfaces, logged thousands of
 * "EGLConsumer is not attached to an OpenGL ES context" and icons went blank app-wide.
 *
 * Getting the glyph centred and uncropped at any size:
 *  1. The vendored SVGs carry an intrinsic width="24" height="24"; Skia would draw at
 *     that size, so the root's width/height are stripped and only the 0 0 24 24
 *     viewBox remains.
 *  2. The viewBox is then scaled into the icon box, with a hair of inset so round caps
 *     at the very edge are never clipped.
 * Lucide strokes are currentColor; Skia can't resolve that, so the colour is
 * substituted in.
 */
const VIEWBOX = 24; // Lucide's coordinate space
const svgCache = new Map<string, ReturnType<typeof Skia.SVG.MakeFromString>>();
const pngCache = new Map<string, string | null>();

function svgFor(name: string, color: string) {
  const key = `${name}|${color}`;
  const hit = svgCache.get(key);
  if (hit !== undefined) return hit;
  const raw = ICON_SVG[name as IconName];
  const cleaned = raw
    ? raw
        // drop the ROOT's intrinsic size → scale by viewBox. Only the <svg> tag: a
        // <rect> without width/height has no area, which erased lock, cpu, battery…
        .replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, ''))
        .replace(/currentColor/g, color)
    : null;
  const svg = cleaned ? Skia.SVG.MakeFromString(cleaned) : null;
  svgCache.set(key, svg);
  return svg;
}

/** A PNG data URI of the icon at `px` × `px` device pixels, or null if it can't be drawn. */
function iconUri(name: string, color: string, px: number): string | null {
  const key = `${name}|${color}|${px}`;
  const hit = pngCache.get(key);
  if (hit !== undefined) return hit;
  let uri: string | null = null;
  const svg = svgFor(name, color);
  const surface = svg ? Skia.Surface.Make(px, px) : null;
  if (svg && surface) {
    const canvas = surface.getCanvas();
    const pad = Math.max(0.5, px * 0.04);
    canvas.translate(pad, pad);
    canvas.scale((px - pad * 2) / VIEWBOX, (px - pad * 2) / VIEWBOX);
    canvas.drawSvg(svg, VIEWBOX, VIEWBOX);
    surface.flush();
    uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100)}`;
  }
  pngCache.set(key, uri);
  return uri;
}

export function Icon({ name, size = 20, color }: { name: IconName | string; size?: number; color?: string }) {
  const { colors } = useTheme();
  const tint = color ?? colors.textSecondary;
  const px = Math.max(1, Math.round(size * PixelRatio.get()));
  const uri = React.useMemo(() => iconUri(name, tint, px), [name, tint, px]);
  if (!uri) return null;
  return <Image source={{ uri }} style={{ width: size, height: size }} fadeDuration={0} accessibilityIgnoresInvertColors />;
}

export type { IconName };
