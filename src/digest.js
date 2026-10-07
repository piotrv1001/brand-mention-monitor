// Summarize the relevant mentions published since the last digest: themes, mood and what to answer.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from './db.js';

if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, skipping the digest.');
    process.exit(0);
}

const Digest = z.object({
    summary: z.string().describe('Three or four sentences: what people said and how the mood changed'),
    themes: z.array(z.object({
        theme: z.string(),
        mentions: z.number().int(),
        sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
    })).describe('Up to 5 themes, largest first'),
    replyTo: z.array(z.object({
        id: z.string(),
        why: z.string().describe('One sentence on what to answer'),
    })).describe('Up to 5 mentions most worth a reply, most urgent first'),
});

const { rows: [last] } = await db.query('SELECT max(created_at) AS at FROM digests');
const periodStart = last.at ?? new Date(0);
const { rows } = await db.query(
    `SELECT m.source, m.external_id, m.community, m.title, m.published_at, m.engagement,
            c.sentiment, c.topic, c.summary, c.needs_reply
     FROM mentions m JOIN classifications c USING (source, external_id)
     WHERE c.relevant AND m.first_seen > $1
     ORDER BY m.published_at DESC`,
    [periodStart],
);
if (!rows.length) {
    console.log('No new relevant mentions since the last digest.');
    await db.end();
    process.exit(0);
}

const client = new Anthropic();
const response = await client.messages.parse({
    model: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Digest) },
    system: 'You write a short brand-monitoring digest for a marketing and developer-relations team.',
    messages: [{
        role: 'user',
        content: JSON.stringify(rows.map((r) => ({ id: `${r.source}:${r.external_id}`, ...r }))),
    }],
});
if (!response.parsed_output) {
    console.error(`No digest: Claude stopped with "${response.stop_reason}".`);
    process.exit(1);
}

const { summary, themes, replyTo } = response.parsed_output;
const known = new Set(rows.map((r) => `${r.source}:${r.external_id}`));
const replies = replyTo.filter((r) => known.has(r.id)).map((r) => {
    const [source, ...rest] = r.id.split(':');
    return { source, externalId: rest.join(':'), why: r.why };
});
await db.query(
    'INSERT INTO digests (period_start, summary, themes, reply_to) VALUES ($1, $2, $3, $4)',
    [periodStart, summary, JSON.stringify(themes), JSON.stringify(replies)],
);
console.log(`${summary}\n`);
for (const t of themes) console.log(`  ${t.theme}: ${t.mentions} (${t.sentiment})`);

await db.end();
