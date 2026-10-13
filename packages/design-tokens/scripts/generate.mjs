/* Generate React Native design tokens from the canonical CSS.
 *
 * design-system/tokens/*.css is the single source of truth for the brand — the web
 * mockup, the design system project and the guideline cards all read it. Hand-typing
 * a parallel palette into the mobile app is how the two drift, so this parses the
 * CSS custom properties and emits TypeScript instead.
 *
 * What it emits:
 *   src/generated/colors.ts   light + dark palettes, semantic names, var() resolved
 *   src/generated/layout.ts   spacing, radius, touch, type scale (px numbers)
 *   src/generated/motion.ts   durations (ms numbers) and easing curves
 *
 * What it deliberately does NOT emit: elevation (RN shadows are platform-specific
 * and are decided per component), fonts (the font files ship with the app and are
 * registered by name at startup).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const HERE = path.resolve(import.meta.dirname, '..');
const TOKENS = path.resolve(HERE, '..', '..', 'design-system', 'tokens');
const OUT = path.join(HERE, 'src', 'generated');
mkdirSync(OUT, { recursive: true });

/* ---- parse one CSS file's custom properties into a map ---- */
function parse(file) {
  /* Comments go first. The token files carry prose comments that MENTION other
     tokens ("wider-tracked than --type-overline"), and matching declarations in the
     raw text let one of those swallow the real declaration that followed it. */
  const css = readFileSync(path.join(TOKENS, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map();
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

/* ---- resolve var() references within a map (with a fallback map behind it) ---- */
function resolve(map, fallback = new Map()) {
  const out = new Map();
  const get = (name, depth = 0) => {
    if (depth > 10) throw new Error(`var() loop at --${name}`);
    const raw = map.get(name) ?? fallback.get(name);
    if (raw == null) return null;
    return raw.replace(/var\(--([a-z0-9-]+)\)/gi, (_, ref) => {
      const v = get(ref, depth + 1);
      if (v == null) throw new Error(`--${name} references missing --${ref}`);
      return v;
    });
  };
  for (const name of map.keys()) out.set(name, get(name));
  return out;
}

const kebabToCamel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/* Colours whose value is a colour literal (hex/rgba) after resolution. */
const isColor = (v) => /^(#|rgba?\()/.test(v);

const light = resolve(parse('colors.css'));
const dark = resolve(parse('colors-dark.css'), parse('colors.css'));

/* The dark file only overrides; anything it doesn't define falls through to light.
   Emit complete palettes for both so the app never merges at runtime. */
const darkComplete = new Map(
  [...light.keys()].map((k) => [k, dark.get(k) ?? light.get(k)])
);

function emitPalette(map) {
  const entries = [...map.entries()]
    .filter(([, v]) => isColor(v))
    .map(([k, v]) => `  ${JSON.stringify(kebabToCamel(k))}: ${JSON.stringify(v)},`);
  return entries.join('\n');
}

const colorNames = [...light.entries()].filter(([, v]) => isColor(v)).map(([k]) => kebabToCamel(k));

writeFileSync(path.join(OUT, 'colors.ts'), `/* GENERATED from design-system/tokens/colors*.css — run \`npm run generate\` in
 * packages/design-tokens. Do not hand-edit: edits here silently diverge from the
 * web mockup and the design system. */

export const lightColors = {
${emitPalette(light)}
} as const;

export const darkColors = {
${emitPalette(darkComplete)}
} as const;

export type ColorToken = keyof typeof lightColors;
export type Palette = Record<ColorToken, string>;
`);

/* ---- layout: px custom properties become numbers ---- */
const px = (v) => (/^-?\d+(\.\d+)?px$/.test(v) ? Number(v.replace('px', '')) : null);
const layoutSrc = new Map([...parse('spacing.css'), ...parse('radius.css'), ...parse('typography.css')]);
const layout = resolve(layoutSrc);
const layoutEntries = [...layout.entries()]
  .map(([k, v]) => [kebabToCamel(k), px(v) ?? (/^-?[\d.]+$/.test(v) ? Number(v) : /^(-?[\d.]+)em$/.test(v) ? v : v)])
  .filter(([, v]) => v != null);

writeFileSync(path.join(OUT, 'layout.ts'), `/* GENERATED — see colors.ts header. px values are numbers; em tracking stays a
 * string and is converted per font size at the call site. */

export const layout = {
${layoutEntries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
} as const;
`);

/* ---- motion: ms durations as numbers, easings as cubic-bezier arg arrays ---- */
const motion = resolve(parse('motion.css'));
const motionEntries = [...motion.entries()].map(([k, v]) => {
  if (/^\d+m?s$/.test(v)) return [kebabToCamel(k), v.endsWith('ms') ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000];
  const cb = v.match(/^cubic-bezier\(([^)]+)\)$/);
  if (cb) return [kebabToCamel(k), cb[1].split(',').map(Number)];
  return null;
}).filter(Boolean);

writeFileSync(path.join(OUT, 'motion.ts'), `/* GENERATED — see colors.ts header. Durations are ms numbers; easings are
 * cubic-bezier control points for use with Reanimated's Easing.bezier(...). */

export const motion = {
${motionEntries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
} as const;
`);

console.log(`colors: ${colorNames.length} tokens ×2 themes`);
console.log(`layout: ${layoutEntries.length} tokens`);
console.log(`motion: ${motionEntries.length} tokens`);
console.log(`-> ${path.relative(process.cwd(), OUT)}`);
