# Brand Mention Monitor — Threads, Reddit and Google News with Claude

![Brand mention monitor](docs/banner.png)

Track what people say about your brand on **Threads, Reddit and Google News**, let Claude throw out the noise and
classify the rest, and get a digest of the main themes plus the posts worth answering. Everything is stored in
Postgres, so you can query weeks of mentions later.

Scraping runs on Apify with three Actors: the
[Threads Posts Scraper](https://apify.com/piotrv1001/threads-posts-scraper),
[Reddit Posts Scraper](https://apify.com/piotrv1001/reddit-posts-scraper) and
[Google News Scraper](https://apify.com/piotrv1001/google-news-scraper). No social media accounts, API keys or
browsers are needed on your side.

![Mention report with an AI digest, themes, the mentions worth a reply and the relevant feed](docs/report.png)

## Why the AI step matters

Keyword searches are noisy. In our example run for "Supabase" over 30 days, 74 posts and articles matched, and Claude
marked 23 of them as not really about Supabase: about two thirds only listed it in a tech stack, a job ad or a
freelancer profile, and the rest never mentioned it at all, having matched on other words. The other 51 got a sentiment, a topic and a one-line summary, in
English, Ukrainian, Italian or Korean alike.

The digest then picked up the two stories of the month, a security study about exposed databases and a funding
round, and listed five posts worth answering, including a support complaint and a pre-launch security question.

## How it works

```mermaid
flowchart LR
    K[keywords.txt] --> I
    B[brand.md] --> C
    subgraph pipeline [npm start]
        I[ingest<br/>3 Apify Actors] --> DB[(Postgres<br/>mentions)]
        DB --> C[classify<br/>Claude]
        C --> DB
        DB --> D[digest<br/>Claude]
        D --> DB
        DB --> R[report]
    end
    R --> H[reports/index.html]
```

| Step | Command | What it does |
| --- | --- | --- |
| Ingest | `npm run ingest` | Searches every keyword on Threads, Reddit and Google News in parallel and stores new mentions from the last `LOOKBACK_DAYS`: text, author or subreddit, date and engagement. |
| Classify | `npm run classify` | Sends mentions it hasn't seen to Claude, 20 per request, with `brand.md` as context: relevant or not, sentiment, topic, a one-line summary and whether to reply. |
| Digest | `npm run digest` | One Claude request over the relevant mentions since the last digest: a short summary, up to five themes and up to five mentions worth a reply, with what to answer. |
| Report | `npm run report` | Writes `reports/index.html`: counts by source and sentiment, the digest, the reply list and every relevant mention. |

## Quick start

You need [Node.js](https://nodejs.org/) 22 or newer, [Docker](https://docs.docker.com/get-docker/), an
[Apify account](https://console.apify.com/sign-up) and an [Anthropic API key](https://console.anthropic.com/).

```bash
git clone https://github.com/piotrv1001/brand-mention-monitor.git
cd brand-mention-monitor
docker compose up -d          # Postgres 17, schema created on first start
npm install
cp .env.example .env          # add APIFY_TOKEN and ANTHROPIC_API_KEY
```

Then make it yours:

1. List your brand names, product names and common misspellings in `keywords.txt`.
2. Describe the brand in `brand.md`: what it is, what counts as a relevant mention, what doesn't (namesakes, job ads),
   and what deserves a reply. The example describes Supabase.
3. Run `npm start` and open `reports/index.html`. For the first run, `LOOKBACK_DAYS=30 npm start` fills a month of
   history.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APIFY_TOKEN` | – | [Apify API token](https://console.apify.com/settings/integrations) |
| `DATABASE_URL` | `postgres://mentions:mentions@localhost:5432/mentions` | Any Postgres 13+ works |
| `LOOKBACK_DAYS` | `7` | Only mentions published in this window are kept |
| `MAX_PER_SOURCE` | `30` | Results per keyword and source |
| `NEWS_COUNTRY` / `NEWS_LANGUAGE` | `US` / `en` | Google News edition |
| `ANTHROPIC_API_KEY` | – | Required for classification and the digest |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Any Claude model, e.g. `claude-haiku-4-5` for a cheaper run |

Threads search returns the top posts for a keyword rather than the latest ones, so a daily run mostly adds Reddit
posts and news; Threads catches the posts that got traction.

## Run it every morning

```cron
0 8 * * * cd /path/to/brand-mention-monitor && npm start >> monitor.log 2>&1
```

Mentions already stored are never classified or paid for twice, and each digest covers only what arrived since the
previous one.

## Query the mentions

```sql
-- Negative mentions this week, most engaged first
SELECT m.source, m.published_at::date, m.engagement, c.summary, m.url
FROM mentions m JOIN classifications c USING (source, external_id)
WHERE c.relevant AND c.sentiment = 'negative' AND m.published_at > now() - interval '7 days'
ORDER BY m.engagement DESC NULLS LAST;

-- Sentiment per week
SELECT date_trunc('week', m.published_at)::date AS week, c.sentiment, count(*)
FROM mentions m JOIN classifications c USING (source, external_id)
WHERE c.relevant GROUP BY 1, 2 ORDER BY 1, 2;

-- Most discussed topics
SELECT c.topic, count(*) FROM classifications c WHERE c.relevant GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

Connect with `docker compose exec db psql -U mentions`.

## Cost

Pricing as of October 7, 2026:

- **Apify:** $0.0035 per Threads post, $0.002 per Reddit post and $0.0025 per news article. One keyword at 30 results
  per source costs at most about $0.24 per run; a daily run usually returns far fewer new posts than the maximum.
  The Apify free plan includes $5 of monthly usage.
- **Claude:** classifying the 74 mentions of our example run cost $0.35 with the default model, about half a cent per
  mention; the digest is one more request per run.

## Project structure

```
db/schema.sql      tables: mentions, classifications, digests
src/ingest.js      runs the three Actors per keyword and saves mentions
src/classify.js    Claude relevance, sentiment, topic, summary and reply flag
src/digest.js      Claude summary, themes and reply list
src/report.js      HTML report
keywords.txt       what to search for
brand.md           who you are, for Claude (an example is included)
```

## Related

- [Threads Posts Scraper](https://apify.com/piotrv1001/threads-posts-scraper),
  [Reddit Posts Scraper](https://apify.com/piotrv1001/reddit-posts-scraper) and
  [Google News Scraper](https://apify.com/piotrv1001/google-news-scraper) — the Actors this pipeline runs
- [AliExpress price tracker](https://github.com/piotrv1001/aliexpress-price-tracker),
  [Mercado Libre price tracker](https://github.com/piotrv1001/mercado-libre-price-tracker),
  [LinkedIn jobs AI matcher](https://github.com/piotrv1001/linkedin-jobs-ai-matcher) and
  [Clutch lead generation pipeline](https://github.com/piotrv1001/clutch-lead-generation-pipeline) — the same
  pipeline pattern for other jobs
