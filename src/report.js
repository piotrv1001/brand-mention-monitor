// Write reports/index.html: the latest digest, the mentions worth a reply and every relevant mention.
import { mkdir, writeFile } from 'node:fs/promises';
import { db } from './db.js';

const { rows: [digest] } = await db.query('SELECT * FROM digests ORDER BY created_at DESC LIMIT 1');
const { rows: mentions } = await db.query(
    `SELECT m.*, c.relevant, c.sentiment, c.topic, c.summary, c.needs_reply
     FROM mentions m JOIN classifications c USING (source, external_id)
     ORDER BY m.published_at DESC NULLS LAST`,
);
await db.end();

const relevant = mentions.filter((m) => m.relevant);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const date = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const SOURCES = { threads: 'Threads', reddit: 'Reddit', news: 'News' };
const count = (list, key, value) => list.filter((m) => m[key] === value).length;

const byId = new Map(mentions.map((m) => [`${m.source}:${m.external_id}`, m]));
const replies = (digest?.reply_to ?? []).map((r) => ({ ...r, m: byId.get(`${r.source}:${r.externalId}`) })).filter((r) => r.m);

function card(m) {
    const where = m.source === 'reddit' ? `r/${m.community}` : m.author;
    return `<article>
        <div class="meta"><span class="src ${m.source}">${SOURCES[m.source]}</span> ${esc(where)} · ${date(m.published_at)}${m.engagement ? ` · ${m.engagement} interactions` : ''}
            <span class="pill ${m.sentiment}">${m.sentiment}</span>${m.topic ? ` <span class="topic">${esc(m.topic)}</span>` : ''}</div>
        <a href="${esc(m.url)}">${esc(m.summary)}</a>
    </article>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brand mentions</title>
<style>
    body { font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 32px; }
    main { max-width: 900px; margin: auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 28px 0 10px; }
    .muted, .meta { color: #6b7280; font-size: 12px; }
    .box { background: #fff; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px #0000001a; }
    .digest { background: #eef2ff; border: 1px solid #c7d2fe; box-shadow: none; margin-top: 18px; }
    .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .stat { background: #fff; border-radius: 10px; padding: 8px 14px; box-shadow: 0 1px 2px #0000000f; font-size: 13px; }
    .stat b { font-size: 18px; display: block; }
    ul.themes { margin: 10px 0 0; padding-left: 18px; }
    article { background: #fff; border-radius: 10px; padding: 12px 16px; margin-top: 8px; box-shadow: 0 1px 2px #0000000f; }
    article a { color: inherit; text-decoration: none; display: block; margin-top: 4px; }
    .why { margin-top: 6px; font-size: 13px; color: #3730a3; border-left: 3px solid #c7d2fe; padding-left: 8px; }
    .src { font-weight: 600; color: #111827; }
    .src.reddit { color: #c2410c; } .src.threads { color: #111827; } .src.news { color: #1d4ed8; }
    .pill { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; margin-left: 6px; }
    .positive { background: #dcfce7; color: #15803d; } .negative { background: #fee2e2; color: #b91c1c; }
    .neutral { background: #f1f5f9; color: #475569; } .mixed { background: #fef3c7; color: #92400e; }
    .topic { font-size: 11px; color: #6b7280; border: 1px solid #e5e7eb; border-radius: 999px; padding: 0 8px; }
</style></head>
<body><main>
    <h1>Brand mentions</h1>
    <div class="muted">${mentions.length} mentions collected · ${relevant.length} relevant · ${mentions.length - relevant.length} filtered out by Claude (namesakes, skill lists, unrelated posts)</div>
    <div class="stats">
        ${Object.keys(SOURCES).map((s) => `<div class="stat"><b>${count(relevant, 'source', s)}</b>${SOURCES[s]}</div>`).join('')}
        ${['positive', 'neutral', 'mixed', 'negative'].map((s) => `<div class="stat"><b>${count(relevant, 'sentiment', s)}</b>${s}</div>`).join('')}
    </div>
    ${digest ? `<div class="box digest"><b>AI digest</b> · ${esc(digest.summary)}
        <ul class="themes">${digest.themes.map((t) => `<li>${esc(t.theme)} <span class="pill ${t.sentiment}">${t.sentiment}</span> <span class="muted">about ${t.mentions} mentions</span></li>`).join('')}</ul></div>` : ''}
    ${replies.length ? `<h2>Worth a reply</h2>${replies.map((r) => card(r.m).replace('</article>', `<div class="why">${esc(r.why)}</div></article>`)).join('')}` : ''}
    <h2>All relevant mentions</h2>
    ${relevant.map(card).join('\n')}
</main></body></html>`;

await mkdir('reports', { recursive: true });
await writeFile('reports/index.html', html);
console.log(`Wrote reports/index.html (${relevant.length} relevant of ${mentions.length} mentions)`);
