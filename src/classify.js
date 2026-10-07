// Let Claude read every new mention against brand.md: is it about us, how does it feel, does it need a reply?
import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from './db.js';

const BATCH = 20;

if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set, skipping classification.');
    process.exit(0);
}

const Result = z.object({
    mentions: z.array(z.object({
        id: z.string(),
        relevant: z.boolean(),
        sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
        topic: z.string().describe('2-4 words, e.g. "auth migration" or "pricing"'),
        summary: z.string().describe('One sentence on what the mention says about the brand'),
        needsReply: z.boolean(),
    })),
});

const brand = await readFile('brand.md', 'utf8');
const client = new Anthropic();
const system = [{
    type: 'text',
    // The brand profile is the same in every request, so it is cached after the first one.
    cache_control: { type: 'ephemeral' },
    text: `You triage social media posts and news articles for one brand. For each mention decide whether it is
relevant to the brand as defined below, its sentiment towards the brand, a short topic, a one-sentence summary, and
whether the brand should reply. Return one entry per mention, with its id unchanged.

<brand>
${brand}
</brand>`,
}];

const { rows } = await db.query(
    `SELECT m.* FROM mentions m
     WHERE NOT EXISTS (SELECT 1 FROM classifications c WHERE c.source = m.source AND c.external_id = m.external_id)
     ORDER BY m.published_at DESC NULLS LAST`,
);
console.log(`Classifying ${rows.length} new mentions...`);

for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const byId = new Map(batch.map((m) => [`${m.source}:${m.external_id}`, m]));
    const response = await client.messages.parse({
        model: process.env.CLAUDE_MODEL ?? 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low', format: zodOutputFormat(Result) },
        system,
        messages: [{
            role: 'user',
            content: JSON.stringify(batch.map((m) => ({
                id: `${m.source}:${m.external_id}`,
                source: m.source,
                community: m.community,
                title: m.title,
                text: m.text?.slice(0, 2000), // long posts: the opening says enough to triage
            }))),
        }],
    });
    if (!response.parsed_output) {
        console.error(`Batch ${i / BATCH + 1}: no result (stop reason "${response.stop_reason}")`);
        continue;
    }
    for (const c of response.parsed_output.mentions) {
        const m = byId.get(c.id);
        if (!m) continue;
        await db.query(
            `INSERT INTO classifications (source, external_id, relevant, sentiment, topic, summary, needs_reply)
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
            [m.source, m.external_id, c.relevant, c.sentiment, c.topic, c.summary, c.needsReply],
        );
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
}

await db.end();
