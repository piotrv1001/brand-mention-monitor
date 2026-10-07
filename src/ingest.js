// Search every keyword on Threads, Reddit and Google News and store new mentions.
import { readFile } from 'node:fs/promises';
import { ApifyClient } from 'apify-client';
import { db } from './db.js';

const { LOOKBACK_DAYS = '7', MAX_PER_SOURCE = '30', NEWS_COUNTRY = 'US', NEWS_LANGUAGE = 'en' } = process.env;
const since = new Date(Date.now() - Number(LOOKBACK_DAYS) * 86_400_000);
const postedAfter = since.toISOString().slice(0, 10);
const max = Number(MAX_PER_SOURCE);

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const stripHtml = (s) => s?.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Each source: the Actor, its input for one keyword, and how one of its items maps onto a mention.
const SOURCES = {
    threads: {
        actor: 'piotrv1001/threads-posts-scraper',
        input: (keyword) => ({ searchQueries: [keyword], maxPosts: max, postedAfter }),
        map: (p) => ({
            externalId: p.id, url: p.url, text: p.text, author: p.author?.username,
            publishedAt: p.createdAt, engagement: (p.likes ?? 0) + (p.replies ?? 0) + (p.reposts ?? 0),
        }),
    },
    reddit: {
        actor: 'piotrv1001/reddit-posts-scraper',
        input: (keyword) => ({ searchQueries: [keyword], sort: 'new', maxPosts: max, postedAfter }),
        map: (p) => ({
            externalId: p.id, url: p.url, title: p.title, text: p.text, author: p.author, community: p.subreddit,
            publishedAt: p.createdAt, engagement: (p.score ?? 0) + (p.numComments ?? 0),
        }),
    },
    news: {
        actor: 'piotrv1001/google-news-scraper',
        input: (keyword) => ({ query: keyword, maxItems: max, country: NEWS_COUNTRY, language: NEWS_LANGUAGE }),
        map: (a) => ({
            externalId: a.guid, url: a.link, title: a.title, text: stripHtml(a.description), author: a.source,
            publishedAt: a.publishedAt && new Date(a.publishedAt).toISOString(),
        }),
    },
};

async function collect(source, keyword) {
    const { actor, input, map } = SOURCES[source];
    const run = await client.actor(actor).call(input(keyword), { log: null });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    let added = 0;
    for (const m of items.filter((i) => i.type !== 'comment').map(map)) {
        // Google News has no date filter; keep its older articles out of the period too.
        if (!m.externalId || (m.publishedAt && new Date(m.publishedAt) < since)) continue;
        const { rowCount } = await db.query(
            `INSERT INTO mentions (source, external_id, keyword, url, title, text, author, community, published_at, engagement)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
            [source, m.externalId, keyword, m.url, m.title, m.text, m.author, m.community, m.publishedAt, m.engagement],
        );
        added += rowCount;
    }
    console.log(`  ${source.padEnd(7)} "${keyword}": ${items.length} results, ${added} new (run ${run.id})`);
}

const keywords = (await readFile('keywords.txt', 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

console.log(`Searching ${keywords.length} keyword(s) on ${Object.keys(SOURCES).join(', ')} since ${postedAfter}...`);
for (const keyword of keywords) {
    // The three sources run in parallel; one failing source doesn't lose the others.
    const results = await Promise.allSettled(Object.keys(SOURCES).map((source) => collect(source, keyword)));
    for (const r of results) if (r.status === 'rejected') console.error(`  failed: ${r.reason.message}`);
}

await db.end();
