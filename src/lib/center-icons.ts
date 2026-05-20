import anchorSvg from '../assets/center-icons/anchor.svg?raw';
import catFaceSvg from '../assets/center-icons/cat-face.svg?raw';
import crownSvg from '../assets/center-icons/crown.svg?raw';
import dinosaurSvg from '../assets/center-icons/dinosaur.svg?raw';
import flameSvg from '../assets/center-icons/flame.svg?raw';
import ghostSvg from '../assets/center-icons/ghost.svg?raw';
import heartSvg from '../assets/center-icons/heart.svg?raw';
import leafSvg from '../assets/center-icons/leaf.svg?raw';
import lightningBoltSvg from '../assets/center-icons/lightning-bolt.svg?raw';
import moonSvg from '../assets/center-icons/moon.svg?raw';
import mushroomSvg from '../assets/center-icons/mushroom.svg?raw';
import musicNoteSvg from '../assets/center-icons/music-note.svg?raw';
import fishSvg from '../assets/center-icons/fish.svg?raw';
import pawPrintSvg from '../assets/center-icons/paw-print.svg?raw';
import rocketSvg from '../assets/center-icons/rocket.svg?raw';
import skullSvg from '../assets/center-icons/skull.svg?raw';
import smileyFaceSvg from '../assets/center-icons/smiley-face.svg?raw';
import snowflakeSvg from '../assets/center-icons/snowflake.svg?raw';
import starSvg from '../assets/center-icons/star.svg?raw';
import sunSvg from '../assets/center-icons/sun.svg?raw';

/**
 * Catalog of optional decorative icons that can be embedded in the
 * center of a QR code. Each icon's SVG file uses `fill="currentColor"`
 * so a single source paints in whatever foreground color the user picks
 * at render time. The 'none' entry is the no-op selection.
 *
 * Icon files use `viewBox="0 0 24 24"`. We strip the outer `<svg>` wrapper
 * and store only the inner contents so the overlay renderer can transform
 * them into the QR's coordinate system via a `<g transform>` without
 * having to embed a foreign `<svg>` (which complicates exports).
 */
export type CenterIconId =
  | 'none'
  | 'anchor'
  | 'cat-face'
  | 'crown'
  | 'dinosaur'
  | 'fish'
  | 'flame'
  | 'ghost'
  | 'heart'
  | 'leaf'
  | 'lightning-bolt'
  | 'moon'
  | 'mushroom'
  | 'music-note'
  | 'paw-print'
  | 'rocket'
  | 'skull'
  | 'smiley-face'
  | 'snowflake'
  | 'star'
  | 'sun';

export type CenterIconDef = {
  id: CenterIconId;
  label: string;
  /** Inner SVG markup between the outer `<svg>` tags. Empty for 'none'. */
  innerSvg: string;
};

/**
 * Strip the outer `<svg ...>...</svg>` wrapper, leaving only the drawable
 * contents. Throws on malformed input so a missing icon file fails the
 * build/test rather than silently rendering blank.
 */
function extractInner(svg: string): string {
  const match = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg);
  if (!match || match[1] === undefined) {
    throw new Error('center icon SVG missing outer <svg> wrapper');
  }
  return match[1].trim();
}

export const CENTER_ICONS: readonly CenterIconDef[] = [
  { id: 'none', label: 'None', innerSvg: '' },
  { id: 'heart', label: 'Heart', innerSvg: extractInner(heartSvg) },
  { id: 'star', label: 'Star', innerSvg: extractInner(starSvg) },
  { id: 'smiley-face', label: 'Smiley', innerSvg: extractInner(smileyFaceSvg) },
  { id: 'lightning-bolt', label: 'Bolt', innerSvg: extractInner(lightningBoltSvg) },
  { id: 'flame', label: 'Flame', innerSvg: extractInner(flameSvg) },
  { id: 'sun', label: 'Sun', innerSvg: extractInner(sunSvg) },
  { id: 'moon', label: 'Moon', innerSvg: extractInner(moonSvg) },
  { id: 'snowflake', label: 'Snowflake', innerSvg: extractInner(snowflakeSvg) },
  { id: 'leaf', label: 'Leaf', innerSvg: extractInner(leafSvg) },
  { id: 'mushroom', label: 'Mushroom', innerSvg: extractInner(mushroomSvg) },
  { id: 'cat-face', label: 'Cat', innerSvg: extractInner(catFaceSvg) },
  { id: 'paw-print', label: 'Paw', innerSvg: extractInner(pawPrintSvg) },
  { id: 'dinosaur', label: 'Dinosaur', innerSvg: extractInner(dinosaurSvg) },
  { id: 'fish', label: 'Fish', innerSvg: extractInner(fishSvg) },
  { id: 'ghost', label: 'Ghost', innerSvg: extractInner(ghostSvg) },
  { id: 'skull', label: 'Skull', innerSvg: extractInner(skullSvg) },
  { id: 'crown', label: 'Crown', innerSvg: extractInner(crownSvg) },
  { id: 'rocket', label: 'Rocket', innerSvg: extractInner(rocketSvg) },
  { id: 'anchor', label: 'Anchor', innerSvg: extractInner(anchorSvg) },
  { id: 'music-note', label: 'Music', innerSvg: extractInner(musicNoteSvg) },
];

const BY_ID = new Map<CenterIconId, CenterIconDef>(CENTER_ICONS.map((i) => [i.id, i]));

export function findCenterIcon(id: CenterIconId): CenterIconDef {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown center icon id: ${String(id)}`);
  return found;
}

export const NONE_ICON: CenterIconDef = findCenterIcon('none');
