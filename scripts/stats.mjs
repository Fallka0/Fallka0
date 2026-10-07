// Builds the "by the numbers" card for the profile README.
// Runs in GitHub Actions (see .github/workflows/profile-assets.yml) and writes
// stats.svg and stats-dark.svg into the output directory given as argv[2].
//
// Local preview without network: node scripts/stats.mjs out --mock

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "dist";
const MOCK = process.argv.includes("--mock");
const USER = process.env.USERNAME ?? "Fallka0";
const TOKEN = process.env.GITHUB_TOKEN;

// Markup and config languages say little about what someone builds.
const IGNORED = new Set(["HTML", "CSS", "SCSS", "Dockerfile", "Makefile", "Batchfile", "Inno Setup", "Procfile"]);

// Colours from GitHub's linguist, so the card matches the repo pages.
const LANG_COLORS = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Go: "#00ADD8", Swift: "#F05138",
  Python: "#3572A5", "C#": "#178600", PHP: "#4F5D95", "C++": "#f34b7d", C: "#555555",
  Java: "#b07219", Kotlin: "#A97BFF", Shell: "#89e051", PLpgSQL: "#336790", Rust: "#dea584",
};

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile-card`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loadData() {
  if (MOCK) {
    const days = [];
    const start = Date.UTC(2025, 9, 7);
    for (let i = 0; i < 366; i++) {
      const n = (i * 7919) % 11;
      days.push({ date: new Date(start + i * 864e5).toISOString().slice(0, 10), count: i > 355 ? 3 : n > 6 ? n - 6 : 0 });
    }
    return {
      repos: 24, stars: 6, total: 806, days,
      languages: { TypeScript: 52e5, Go: 9e5, Swift: 8e5, "C#": 6e5, Python: 3e5, PHP: 2e5, HTML: 9e6 },
    };
  }

  const repos = (await gh(`/users/${USER}/repos?per_page=100&type=owner`)).filter((r) => !r.fork);
  const languages = {};
  for (const r of repos) {
    const langs = await gh(`/repos/${USER}/${r.name}/languages`);
    for (const [lang, bytes] of Object.entries(langs)) languages[lang] = (languages[lang] ?? 0) + bytes;
  }

  let total = null;
  let days = [];
  try {
    const q = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}`;
    const res = await gh("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, variables: { login: USER } }),
    });
    const cal = res.data.user.contributionsCollection.contributionCalendar;
    total = cal.totalContributions;
    days = cal.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount }));
  } catch (err) {
    console.warn("Contribution calendar unavailable, card shows repos and stars instead:", err.message);
  }

  return {
    repos: repos.length,
    stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
    total, days, languages,
  };
}

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today often has no commits yet; that should not break a running streak.
  let current = 0;
  const list = [...days];
  if (list.length && list.at(-1).count === 0) list.pop();
  for (let i = list.length - 1; i >= 0 && list[i].count > 0; i--) current++;
  return { current, longest };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("de-CH");

function card(data, theme) {
  const t = theme === "dark"
    ? { bg: "#0d1117", border: "#30363d", text: "#e6edf3", muted: "#8b949e", accent: "#58a6ff", track: "#21262d" }
    : { bg: "#ffffff", border: "#d0d7de", text: "#1f2328", muted: "#59636e", accent: "#0969da", track: "#eaeef2" };

  const langs = Object.entries(data.languages)
    .filter(([l]) => !IGNORED.has(l))
    .sort((a, b) => b[1] - a[1]);
  const sum = langs.reduce((s, [, b]) => s + b, 0) || 1;
  const top = langs.slice(0, 6).map(([l, b]) => ({ l, p: (b / sum) * 100 }));
  const rest = 100 - top.reduce((s, x) => s + x.p, 0);
  if (rest >= 0.5) top.push({ l: "Other", p: rest });

  const { current, longest } = streaks(data.days);
  const stats = data.total != null
    ? [[fmt(data.total), "contributions, last 12 months"], [`${current} days`, "current streak"], [`${longest} days`, "longest streak"]]
    : [[fmt(data.repos), "public repos"], [fmt(data.stars), "stars"]];

  const W = 860, H = 200;
  const statW = 400;

  // Left: the numbers.
  const statSvg = stats.map(([v, label], i) => {
    const y = 74 + i * 44;
    return `<g class="fade" style="animation-delay:${0.1 + i * 0.12}s">
      <text x="32" y="${y}" class="num">${esc(v)}</text>
      <text x="${32 + 150}" y="${y - 2}" class="lbl">${esc(label)}</text>
    </g>`;
  }).join("");

  // Right: one stacked bar plus a legend.
  const barX = statW + 40, barW = W - barX - 32, barY = 62;
  let x = barX;
  const segs = top.map((s, i) => {
    const w = (s.p / 100) * barW;
    const seg = `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(w - 2, 1).toFixed(1)}" height="12" rx="2"
      fill="${LANG_COLORS[s.l] ?? t.muted}" class="grow" style="animation-delay:${0.3 + i * 0.08}s"/>`;
    x += w;
    return seg;
  }).join("");

  const legend = top.map((s, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = barX + col * (barW / 2), ly = barY + 44 + row * 26;
    return `<g class="fade" style="animation-delay:${0.5 + i * 0.06}s">
      <circle cx="${lx + 5}" cy="${ly - 4}" r="5" fill="${LANG_COLORS[s.l] ?? t.muted}"/>
      <text x="${lx + 18}" y="${ly}" class="leg">${esc(s.l)}</text>
      <text x="${lx + barW / 2 - 24}" y="${ly}" class="pct" text-anchor="end">${s.p.toFixed(1)}%</text>
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats for ${esc(USER)}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .title { font-size: 13px; font-weight: 600; fill: ${t.muted}; letter-spacing: .08em; }
    .num { font-size: 28px; font-weight: 700; fill: ${t.text}; }
    .lbl { font-size: 14px; fill: ${t.muted}; }
    .leg { font-size: 13px; fill: ${t.text}; }
    .pct { font-size: 13px; fill: ${t.muted}; font-variant-numeric: tabular-nums; }
    .fade { opacity: 0; animation: fade .6s ease forwards; }
    .grow { transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: grow .7s cubic-bezier(.2,.8,.2,1) forwards; }
    @keyframes fade { to { opacity: 1; } }
    @keyframes grow { to { transform: scaleX(1); } }
    @media (prefers-reduced-motion: reduce) { .fade, .grow { animation: none; opacity: 1; transform: none; } }
  </style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
  <text x="32" y="34" class="title">BY THE NUMBERS</text>
  <text x="${barX}" y="34" class="title">WHAT I WRITE</text>
  <line x1="${statW}" y1="28" x2="${statW}" y2="${H - 28}" stroke="${t.border}"/>
  ${statSvg}
  <rect x="${barX}" y="${barY}" width="${barW}" height="12" rx="3" fill="${t.track}"/>
  ${segs}
  ${legend}
</svg>
`;
}

const data = await loadData();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "stats.svg"), card(data, "light"));
writeFileSync(join(OUT, "stats-dark.svg"), card(data, "dark"));
console.log(`Wrote stats.svg and stats-dark.svg to ${OUT}`);
