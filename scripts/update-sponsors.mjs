// Rewrites the README's sponsors section from asciify.org's active-sponsor manifest.
// The manifest is public and written by the upload worker's GitHub Sponsors sync, so this needs no token.
//   node scripts/update-sponsors.mjs            update README.md in place
//   node scripts/update-sponsors.mjs --check    exit 1 if README.md is out of date
import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = process.env.SPONSORS_MANIFEST_URL ?? 'https://cdn.asciify.org/sponsors.json';
const README = new URL('../README.md', import.meta.url);
const START = '<!-- sponsors:start -->';
const END = '<!-- sponsors:end -->';
// Sizes; keep in step with README_SIZE in the site's SponsorPreview.tsx. Partners and Backers show their wordmark at
// this height (or their square mark a little larger); Supporters show their GitHub avatar.
const GROUPS = [
  { tier: 'partner', title: 'Partners', size: 56 },
  { tier: 'backer', title: 'Backed by', size: 32 },
  { tier: 'supporter', title: 'Supporters', size: 36 },
];

const escape = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const avatar = (url, size) => `${url}${url.includes('?') ? '&' : '?'}s=${size * 2}`;

function entry(sponsor, size, logos) {
  const href = escape(sponsor.url);
  const name = escape(sponsor.name);
  if (logos && sponsor.logo) {
    const dark = sponsor.logoDark ? `<source media="(prefers-color-scheme: dark)" srcset="${escape(sponsor.logoDark)}">` : '';
    return `<a href="${href}" title="${name}"><picture>${dark}<img src="${escape(sponsor.logo)}" height="${size}" alt="${name}"></picture></a>`;
  }
  if (logos) {
    const mark = sponsor.mark ?? avatar(sponsor.avatar, size + 8);
    return `<a href="${href}" title="${name}"><img src="${escape(mark)}" width="${size + 8}" height="${size + 8}" alt="${name}"></a>`;
  }
  return `<a href="${href}" title="${name}"><img src="${escape(avatar(sponsor.avatar, size))}" width="${size}" height="${size}" alt="${name}"></a>`;
}

export function render(manifest) {
  const sponsors = (manifest.sponsors ?? []).filter(sponsor => !sponsor.until || Date.parse(sponsor.until) > Date.now());
  const lines = [START, '', 'Asciify is free and open source. [Sponsor its development](https://asciify.org/sponsor) on GitHub Sponsors.', ''];
  for (const group of GROUPS) {
    const members = sponsors.filter(sponsor => sponsor.tier === group.tier);
    if (!members.length) continue;
    const logos = group.tier !== 'supporter';
    lines.push(`<h3 align="center">${group.title}</h3>`, '', `<p align="center">${members.map(sponsor => entry(sponsor, group.size, logos)).join('&nbsp;&nbsp;')}</p>`, '');
  }
  if (!sponsors.length) lines.push('<p align="center"><a href="https://asciify.org/sponsor">Your logo here</a></p>', '');
  lines.push(END);
  return lines.join('\n');
}

const response = await fetch(MANIFEST);
if (!response.ok) throw new Error(`Manifest: ${response.status}`);
const manifest = await response.json();
const readme = readFileSync(README, 'utf8');
const start = readme.indexOf(START), end = readme.indexOf(END);
if (start < 0 || end < start) throw new Error(`README.md needs ${START} and ${END}`);
const next = readme.slice(0, start) + render(manifest) + readme.slice(end + END.length);
if (process.argv.includes('--check')) {
  if (next !== readme) { console.error('README sponsors section is out of date.'); process.exit(1); }
} else if (next !== readme) {
  writeFileSync(README, next);
  console.log(`README sponsors updated (${manifest.sponsors?.length ?? 0} sponsors).`);
} else console.log('README sponsors already current.');
