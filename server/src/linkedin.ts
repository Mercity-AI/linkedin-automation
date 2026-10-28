/**
 * Accepts anything that looks like a LinkedIn profile link and returns its slug:
 *   https://uk.linkedin.com/in/Jane-Doe-123/recent-activity/all/?trk=x  ->  jane-doe-123
 *   linkedin.com/in/jane-doe-123                                        ->  jane-doe-123
 */
export function profileSlug(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return match[1].toLowerCase();
  }
}

const PROFILE_IN_TEXT = /linkedin\.com\/in\/([A-Za-z0-9\-_%.\u00C0-\uFFFF]+?)(?=https?:|[\s/?#,:;'"<>)]|$)/gi;

/** Pull every profile slug out of free text (one per line, comma separated, or glued together). */
export function extractProfileSlugs(text: string): { slugs: string[]; invalid: string[] } {
  const slugs = new Set<string>();
  const invalid: string[] = [];
  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const found = [...line.matchAll(PROFILE_IN_TEXT)].map((m) => profileSlug(`https://www.linkedin.com/in/${m[1]}`)).filter(Boolean);
    if (found.length) found.forEach((s) => slugs.add(s!));
    else invalid.push(line.slice(0, 120));
  }
  return { slugs: [...slugs], invalid };
}

export const profileUrl = (slug: string) => `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;

/** Strip LinkedIn tracking params from links we display. */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const u = new URL(value);
    u.searchParams.delete('trk');
    return u.toString();
  } catch {
    return value;
  }
}
