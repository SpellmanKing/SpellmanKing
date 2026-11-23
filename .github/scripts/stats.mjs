// Builds dist/stats.svg (activity dashboard) from the GitHub GraphQL API.
// Usage: GITHUB_TOKEN=... node stats.mjs <login> <outFile>
//        node stats.mjs --sample <outFile>   (render with sample data, no network)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const C = {
  bg: '#0A0C14', panel: '#10131F', line: '#1E2335', dim: '#5B6380', text: '#E6E8F2',
  sub: '#9AA3BF', violet: '#8B5CF6', violet2: '#A78BFA', gold: '#F5B942', cyan: '#5EEAD4',
};
const SANS = "'Segoe UI', 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'Cascadia Code', 'SFMono-Regular', Consolas, Menlo, monospace";
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n.toLocaleString('en-US');

const QUERY = `query($login: String!) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
      totalCount
      nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalRepositoriesWithContributedCommits
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

async function fetchData(login, token) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  const j = await r.json();
  if (j.errors || !j.data?.user) throw new Error(JSON.stringify(j.errors || j));
  const u = j.data.user, cc = u.contributionsCollection;
  const days = cc.contributionCalendar.weeks.flatMap(w => w.contributionDays);
  const langs = {};
  for (const repo of u.repositories.nodes)
    for (const e of repo.languages.edges) {
      langs[e.node.name] ??= { size: 0, color: e.node.color || C.dim };
      langs[e.node.name].size += e.size;
    }
  return {
    total: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions, prs: cc.totalPullRequestContributions, issues: cc.totalIssueContributions,
    contributedTo: cc.totalRepositoriesWithContributedCommits,
    repos: u.repositories.totalCount, stars: u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    followers: u.followers.totalCount, days, langs,
  };
}

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let i = days.length - 1, current = 0;
  if (i >= 0 && days[i].contributionCount === 0) i--; // today may not have activity yet
  while (i >= 0 && days[i].contributionCount > 0) { current++; i--; }
  const best = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0] || { contributionCount: 0, date: '' });
  const active = days.filter(d => d.contributionCount > 0).length;
  return { current, longest, best, active };
}

function months(days) {
  const m = new Map();
  for (const d of days) { const k = d.date.slice(0, 7); m.set(k, (m.get(k) || 0) + d.contributionCount); }
  return [...m.entries()].slice(-12);
}

export function render(d) {
  const W = 1190, s = streaks(d.days), mo = months(d.days);
  const tiles = [
    ['CONTRIBUTIONS', fmt(d.total), 'last 12 months', C.violet2],
    ['CURRENT STREAK', `${s.current}d`, `longest: ${s.longest} days`, C.gold],
    ['COMMITS', fmt(d.commits), `in ${d.contributedTo} repositories`, C.cyan],
    ['ACTIVE DAYS', fmt(s.active), `best day: ${s.best.contributionCount}`, '#F472B6'],
    ['PULL REQUESTS', fmt(d.prs), `${fmt(d.issues)} issues opened`, '#60A5FA'],
    ['PUBLIC REPOS', fmt(d.repos), `${fmt(d.stars)} star${d.stars === 1 ? '' : 's'} · ${fmt(d.followers)} follower${d.followers === 1 ? '' : 's'}`, '#34D399'],
  ];
  const TW = (W - 5 * 14) / 3, TH = 118;
  let out = '';
  tiles.forEach(([label, value, note, color], i) => {
    const x = (i % 3) * (TW + 14), y = Math.floor(i / 3) * (TH + 14);
    out += `<g transform="translate(${x} ${y})"><g class="t" style="animation-delay:${i * 0.08}s">
      <rect x="0.5" y="0.5" width="${TW - 1}" height="${TH - 1}" rx="14" fill="${C.bg}" stroke="${C.line}"/>
      <rect x="24" y="0" width="44" height="3" rx="1.5" fill="${color}"/>
      <text x="24" y="36" font-family="${MONO}" font-size="13" letter-spacing="2" fill="${color}">${label}</text>
      <text x="24" y="80" font-family="${SANS}" font-size="40" font-weight="700" fill="${C.text}">${esc(value)}</text>
      <text x="${TW - 24}" y="80" font-family="${SANS}" font-size="16" fill="${C.sub}" text-anchor="end">${esc(note)}</text>
    </g></g>`;
  });
  let y0 = 2 * (TH + 14) + 6;

  // Monthly contributions bar chart
  const CH = 230, max = Math.max(1, ...mo.map(([, v]) => v));
  const PW = 700, plotX = 32, plotW = PW - 64, plotTop = 70, plotH = 110;
  const bw = plotW / mo.length;
  let bars = '';
  mo.forEach(([k, v], i) => {
    const h = Math.max(2, (v / max) * plotH), x = plotX + i * bw + 6, y = plotTop + plotH - h;
    const name = new Date(k + '-01T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 12).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="url(#bar)" class="b" style="animation-delay:${0.3 + i * 0.05}s"/>`;
    if (v > 0) bars += `<text x="${(x + (bw - 12) / 2).toFixed(1)}" y="${(y - 7).toFixed(1)}" font-family="${MONO}" font-size="12" fill="${C.sub}" text-anchor="middle">${v}</text>`;
    bars += `<text x="${(x + (bw - 12) / 2).toFixed(1)}" y="${plotTop + plotH + 24}" font-family="${MONO}" font-size="12" fill="${C.dim}" text-anchor="middle">${name}</text>`;
  });
  out += `<g transform="translate(0 ${y0})">
    <rect x="0.5" y="0.5" width="${PW - 1}" height="${CH - 1}" rx="14" fill="${C.bg}" stroke="${C.line}"/>
    <text x="32" y="38" font-family="${MONO}" font-size="13" letter-spacing="2" fill="${C.violet2}">CONTRIBUTIONS PER MONTH</text>
    <rect x="${plotX}" y="${plotTop + plotH}" width="${plotW}" height="1" fill="${C.line}"/>
    ${bars}
  </g>`;

  // Languages
  const LX = PW + 14, LW = W - LX;
  const all = Object.entries(d.langs).sort((a, b) => b[1].size - a[1].size);
  const sum = all.reduce((a, [, v]) => a + v.size, 0) || 1;
  const top = all.slice(0, 6);
  let lx = 32, seg = '';
  const barW = LW - 64;
  top.forEach(([, v]) => { const w = (v.size / sum) * barW; seg += `<rect x="${lx.toFixed(1)}" y="62" width="${Math.max(0, w - 2).toFixed(1)}" height="12" fill="${v.color}"/>`; lx += w; });
  let legend = '';
  top.forEach(([name, v], i) => {
    const x = 32 + (i % 2) * (barW / 2), y = 112 + Math.floor(i / 2) * 34;
    legend += `<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${v.color}"/><text x="${x + 20}" y="${y}" font-family="${SANS}" font-size="16" fill="${C.text}">${esc(name)}</text><text x="${x + barW / 2 - 16}" y="${y}" font-family="${MONO}" font-size="14" fill="${C.sub}" text-anchor="end">${((v.size / sum) * 100).toFixed(1)}%</text>`;
  });
  out += `<g transform="translate(${LX} ${y0})">
    <rect x="0.5" y="0.5" width="${LW - 1}" height="${CH - 1}" rx="14" fill="${C.bg}" stroke="${C.line}"/>
    <text x="32" y="38" font-family="${MONO}" font-size="13" letter-spacing="2" fill="${C.gold}">TOP LANGUAGES</text>
    <clipPath id="lc"><rect x="32" y="62" width="${barW}" height="12" rx="6"/></clipPath>
    <rect x="32" y="62" width="${barW}" height="12" rx="6" fill="${C.panel}"/>
    <g clip-path="url(#lc)">${seg}</g>
    ${legend}
  </g>`;

  const H = y0 + CH + 30;
  const updated = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub activity: ${d.total} contributions in the last year, ${s.current}-day current streak, ${d.commits} commits, ${d.repos} public repositories">
<defs><linearGradient id="bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.violet2}"/></linearGradient></defs>
<style>
  @keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  @keyframes grow { from { transform: scaleY(0) } to { transform: scaleY(1) } }
  .t { animation: rise .6s ease-out both }
  .b { transform-box: fill-box; transform-origin: bottom; animation: grow .7s ease-out both }
</style>
${out}
<text x="${W - 4}" y="${H - 6}" font-family="${MONO}" font-size="12" fill="#8B93AE" text-anchor="end">updated ${updated} · public activity</text>
</svg>`;
}

function sample() {
  const days = []; const start = new Date(Date.UTC(2025, 10, 23));
  for (let i = 0; i < 366; i++) { const dt = new Date(start.getTime() + i * 864e5); const c = (i * 37) % 11 > 6 ? (i * 13) % 9 : 0; days.push({ date: dt.toISOString().slice(0, 10), contributionCount: c }); }
  for (let i = 360; i < 366; i++) days[i].contributionCount = 3;
  return { total: days.reduce((a, d) => a + d.contributionCount, 0), commits: 412, prs: 18, issues: 6, contributedTo: 14, repos: 15, stars: 1, followers: 8, days,
    langs: { Python: { size: 900000, color: '#3572A5' }, TypeScript: { size: 400000, color: '#3178c6' }, Java: { size: 300000, color: '#b07219' }, HTML: { size: 200000, color: '#e34c26' }, JavaScript: { size: 120000, color: '#f1e05a' }, CSS: { size: 80000, color: '#663399' }, C: { size: 10000, color: '#555555' } } };
}

const [a1, a2] = process.argv.slice(2);
const data = a1 === '--sample' ? sample() : await fetchData(a1, process.env.GITHUB_TOKEN);
mkdirSync(dirname(a2), { recursive: true });
writeFileSync(a2, render(data));
console.log('wrote', a2);
