// Rewrites the README's sponsors section from asciify.org's active-sponsor manifest.
// The manifest is public and written by the upload worker's sponsor sync (Dodo Payments), so this needs no token.
//   node scripts/update-sponsors.mjs            update README.md in place
//   node scripts/update-sponsors.mjs --check    exit 1 if README.md is out of date
import { readFileSync, writeFileSync } from 'node:fs';

const MANIFEST = process.env.SPONSORS_MANIFEST_URL ?? 'https://cdn.asciify.org/sponsors.json';
const README = new URL('../README.md', import.meta.url);
const START = '<!-- sponsors:start -->';
const END = '<!-- sponsors:end -->';
// The picture is drawn live by the upload worker (GET /sponsors.svg), so npm, whose README is frozen at publish, still
// shows current sponsors. The text links below it keep the section accessible and clickable on GitHub.
const PICTURE = '<p align="center"><a href="https://asciify.org/sponsor"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.asciify.org/sponsors-dark.svg"><img src="https://cdn.asciify.org/sponsors.svg" alt="Asciify sponsors" width="720"></picture></a></p>';
const GROUPS = [
  { tier: 'partner', title: 'Partners' },
  { tier: 'backer', title: 'Backers' },
  { tier: 'supporter', title: 'Supporters' },
];

const escape = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function render(manifest) {
  const sponsors = (manifest.sponsors ?? []).filter(sponsor => !sponsor.until || Date.parse(sponsor.until) > Date.now());
  const lines = [START, '', PICTURE, ''];
  const groups = GROUPS.map(group => [group, sponsors.filter(sponsor => sponsor.tier === group.tier)]).filter(([, members]) => members.length);
  if (groups.length) {
    const text = groups.map(([group, members]) => `${group.title}: ${members.map(sponsor => `<a href="${escape(sponsor.url)}">${escape(sponsor.name)}</a>`).join(', ')}`);
    lines.push(`<p align="center"><sub>${text.join('<br>')}</sub></p>`, '');
  }
  lines.push('Asciify is free and open source. [Become a sponsor](https://asciify.org/sponsor).', '', END);
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
