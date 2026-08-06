export interface HoverImageCandidate {
  currentSrc: string;
  src: string;
  srcset: string;
  pictureSources?: string[];
  lazySrcsets?: string[];
  lazySources: string[];
  backgroundImage: string;
}

export interface HoverEligibility {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  role: string;
  className: string;
  insideVideo: boolean;
  insideLink: boolean;
  siteAdapter?: HoverSiteAdapter;
  matchesSiteSelector?: boolean;
}

export type HoverCandidateDiscovery = "persistent" | "direct";

export interface HoverRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type HoverSiteAdapter =
  "pinterest" | "behance" | "dribbble" | "unsplash" | "pexels" | "pixabay" | "xiaohongshu" | "generic";

export interface HoverSiteAdapterRules {
  id: HoverSiteAdapter;
  imageSelectors: string[];
  excludeSelectors: string[];
}

export const hoverBlockerSelector =
  "button, a, input, [role='button'], [role='searchbox'], [role='combobox']";

export async function runWithoutCaptureOverlay<T>(
  setHidden: (hidden: boolean) => void,
  waitForPaint: () => Promise<void>,
  capture: () => Promise<T>
): Promise<T> {
  setHidden(true);
  try {
    await waitForPaint();
    return await capture();
  } finally {
    setHidden(false);
  }
}

const sharedExclusions = [
  "[class*='avatar' i]",
  "[class*='icon' i]",
  "[class*='emoji' i]",
  "video",
  "[class*='video-control' i]",
  "[class*='player-control' i]"
];

const siteRules: Record<HoverSiteAdapter, HoverSiteAdapterRules> = {
  pinterest: {
    id: "pinterest",
    imageSelectors: ["[data-test-id*='pin' i] img", "[class*='Pin' i] img"],
    excludeSelectors: [...sharedExclusions, "[data-test-id*='avatar' i]"]
  },
  behance: {
    id: "behance",
    imageSelectors: ["[class*='Project' i] img", "[class*='Image' i] img"],
    excludeSelectors: [...sharedExclusions, "[class*='Project-owner' i]"]
  },
  dribbble: {
    id: "dribbble",
    imageSelectors: ["[class*='shot' i] img", "figure img"],
    excludeSelectors: [...sharedExclusions, "[class*='shot-user' i]"]
  },
  unsplash: {
    id: "unsplash",
    imageSelectors: ["[data-test*='photo' i] img", "figure img"],
    excludeSelectors: [...sharedExclusions, "[data-test*='avatar' i]"]
  },
  pexels: {
    id: "pexels",
    imageSelectors: ["article img", "[class*='photo' i] img", "main img[src*='images.pexels.com']", "main img[src]"],
    excludeSelectors: [...sharedExclusions, "[class*='avatar' i]"]
  },
  pixabay: {
    id: "pixabay",
    imageSelectors: ["article img", "[class*='gallery' i] img"],
    excludeSelectors: [...sharedExclusions, "[class*='avatar' i]"]
  },
  xiaohongshu: {
    id: "xiaohongshu",
    imageSelectors: ["[class*='note' i] img", "[class*='swiper' i] img"],
    excludeSelectors: [...sharedExclusions, "[class*='author' i] [class*='avatar' i]"]
  },
  generic: {
    id: "generic",
    imageSelectors: ["img", "[style*='background-image' i]"],
    excludeSelectors: sharedExclusions
  }
};

export function candidateKey(
  sourceUrl: string,
  rect: { x: number; y: number; width: number; height: number }
): string {
  return `${sourceUrl}\n${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`;
}

export function isHoverOverlayEvent(path: readonly EventTarget[], host: EventTarget): boolean {
  return path.includes(host);
}

export function canBindNestedImageFromTarget(target: HoverRect, image: HoverRect): boolean {
  return overlaps(target, image);
}

function largestSrcset(srcset: string): string {
  return srcset.split(",").map((entry) => {
    const [url, size = "0w"] = entry.trim().split(/\s+/);
    return { url, score: Number.parseFloat(size) || 0 };
  }).filter((entry) => entry.url).sort((a, b) => b.score - a.score)[0]?.url ?? "";
}

function largestFromSrcsets(srcsets: string[]): string {
  return largestSrcset(srcsets.filter(Boolean).join(", "));
}

function largestCssImage(backgroundImage: string): string {
  const densityImages = Array.from(backgroundImage.matchAll(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)\s*(\d+(?:\.\d+)?)x/gi
  )).map((match) => ({
    url: (match[1] ?? match[2] ?? match[3] ?? "").trim(),
    density: Number.parseFloat(match[4] ?? "0")
  })).filter((entry) => entry.url);
  if (densityImages.length) {
    return densityImages.sort((left, right) => right.density - left.density)[0]?.url ?? "";
  }
  const first = backgroundImage.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/i);
  return (first?.[1] ?? first?.[2] ?? first?.[3] ?? "").trim();
}

export function resolveHoverImage(candidate: HoverImageCandidate): string {
  if (candidate.currentSrc) return candidate.currentSrc;
  const srcset = largestSrcset(candidate.srcset);
  if (srcset) return srcset;
  const picture = largestFromSrcsets(candidate.pictureSources ?? []);
  if (picture) return picture;
  const lazySrcset = largestFromSrcsets(candidate.lazySrcsets ?? []);
  if (lazySrcset) return lazySrcset;
  const lazy = candidate.lazySources.find(Boolean);
  if (lazy) return lazy;
  if (candidate.src) return candidate.src;
  return largestCssImage(candidate.backgroundImage);
}

export function isEligibleHoverCandidate(
  candidate: HoverEligibility,
  discovery: HoverCandidateDiscovery = "direct"
): boolean {
  if (candidate.insideVideo) return false;
  const semanticText = `${candidate.role} ${candidate.className}`.toLowerCase();
  if (/(avatar|user-photo|emoji|(^|[-_\s])ad([-_\s]|$)|advertisement|sponsored|promoted|推广|赞助|广告|badge|icon)/.test(semanticText)) return false;
  const renderedSizeEligible = candidate.width >= 180 && candidate.height >= 120 &&
    candidate.width * candidate.height >= 40_000;
  if (!renderedSizeEligible) return false;
  const hasNaturalSize = candidate.naturalWidth > 0 || candidate.naturalHeight > 0;
  const naturalSizeEligible = candidate.naturalWidth >= 180 && candidate.naturalHeight >= 120 &&
    candidate.naturalWidth * candidate.naturalHeight >= 40_000;
  if (hasNaturalSize && !naturalSizeEligible) return false;
  if (!hasNaturalSize && discovery === "persistent") return false;
  if (discovery === "direct") return true;
  return candidate.siteAdapter === undefined || candidate.siteAdapter === "generic" ||
    candidate.matchesSiteSelector === true;
}

export function choosePersistentCaptureCandidateIndex(
  candidates: HoverRect[],
  viewport: { width: number; height: number }
): number {
  let bestIndex = -1;
  let bestScore = -1;
  candidates.forEach((candidate, index) => {
    const visibleWidth = Math.max(0, Math.min(candidate.right, viewport.width) - Math.max(candidate.left, 0));
    const visibleHeight = Math.max(0, Math.min(candidate.bottom, viewport.height) - Math.max(candidate.top, 0));
    const visibleArea = visibleWidth * visibleHeight;
    if (visibleArea <= 0) return;
    const centerX = (candidate.left + candidate.right) / 2;
    const centerY = (candidate.top + candidate.bottom) / 2;
    const distance = Math.hypot(centerX - viewport.width / 2, centerY - viewport.height / 2);
    const score = visibleArea - distance * 8;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function overlaps(a: HoverRect, b: HoverRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function isBlockingHoverControl(image: HoverRect, candidate: HoverRect): boolean {
  if (!overlaps(image, candidate)) return true;
  const overlapWidth = Math.max(0, Math.min(image.right, candidate.right) - Math.max(image.left, candidate.left));
  const overlapHeight = Math.max(0, Math.min(image.bottom, candidate.bottom) - Math.max(image.top, candidate.top));
  const imageArea = image.width * image.height;
  const overlapRatio = imageArea > 0 ? overlapWidth * overlapHeight / imageArea : 0;
  return overlapRatio < 0.5;
}

export function chooseHoverToolbarPosition(
  image: HoverRect,
  toolbar: Pick<HoverRect, "width" | "height">,
  viewport: { width: number; height: number },
  blockers: HoverRect[],
  preferInside = false
): { left: number; top: number } | null {
  const gap = 6;
  const centeredLeft = image.left + (image.width - toolbar.width) / 2;
  const centeredTop = image.top + (image.height - toolbar.height) / 2;
  const topInsideCandidates = [
    { left: image.right - toolbar.width - 12, top: image.top + 12, inside: true },
    { left: image.left + 12, top: image.top + 12, inside: true }
  ];
  const insideCandidates = [
    { left: centeredLeft, top: image.bottom - toolbar.height - 12, inside: true },
    { left: image.left + 12, top: image.bottom - toolbar.height - 12, inside: true },
    { left: image.right - toolbar.width - 12, top: image.bottom - toolbar.height - 12, inside: true },
    { left: centeredLeft, top: centeredTop, inside: true }
  ];
  const outsideCandidates = [
    { left: image.right - toolbar.width, top: image.top - toolbar.height - gap, inside: false },
    { left: centeredLeft, top: image.top - toolbar.height - gap, inside: false },
    { left: image.left, top: image.top - toolbar.height - gap, inside: false },
    { left: image.right + 8, top: image.top, inside: false },
    { left: image.right + 8, top: centeredTop, inside: false },
    { left: image.left - toolbar.width - 8, top: image.top, inside: false },
    { left: image.left - toolbar.width - 8, top: centeredTop, inside: false },
    { left: image.right - toolbar.width, top: image.bottom + gap, inside: false },
    { left: centeredLeft, top: image.bottom + gap, inside: false },
    { left: image.left, top: image.bottom + gap, inside: false }
  ];
  const candidates = preferInside
    ? [...topInsideCandidates, ...insideCandidates, ...outsideCandidates]
    : [...outsideCandidates, ...insideCandidates];
  for (const candidate of candidates) {
    const rect: HoverRect = {
      ...candidate,
      right: candidate.left + toolbar.width,
      bottom: candidate.top + toolbar.height,
      width: toolbar.width,
      height: toolbar.height
    };
    const insideViewport = rect.left >= gap && rect.top >= gap &&
      rect.right <= viewport.width - gap && rect.bottom <= viewport.height - gap;
    if (!insideViewport || (!candidate.inside && overlaps(rect, image)) ||
      blockers.some((blocker) => overlaps(rect, blocker))) continue;
    return { left: candidate.left, top: candidate.top };
  }
  return null;
}

export function siteAdapterForHost(host: string): HoverSiteAdapter {
  const normalized = host.toLowerCase();
  const domains = {
    pinterest: "pinterest.com",
    behance: "behance.net",
    dribbble: "dribbble.com",
    unsplash: "unsplash.com",
    pexels: "pexels.com",
    pixabay: "pixabay.com",
    xiaohongshu: "xiaohongshu.com"
  } as const;
  for (const [adapter, domain] of Object.entries(domains)) {
    if (normalized === domain || normalized.endsWith(`.${domain}`)) {
      return adapter as keyof typeof domains;
    }
  }
  return "generic";
}

export function siteAdapterRulesForHost(host: string): HoverSiteAdapterRules {
  return siteRules[siteAdapterForHost(host)];
}

export function permissionOriginForUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}
