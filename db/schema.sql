-- Every post or article that matched a keyword, from any source.
CREATE TABLE mentions (
    source        text NOT NULL CHECK (source IN ('threads', 'reddit', 'news')),
    external_id   text NOT NULL,
    keyword       text NOT NULL,
    url           text NOT NULL,
    title         text,                 -- Reddit post title or news headline
    text          text,
    author        text,                 -- username, or the publication for news
    community     text,                 -- subreddit
    published_at  timestamptz,
    engagement    int,                  -- likes + replies + reposts, or score + comments
    first_seen    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id)
);

-- Claude's reading of each mention against brand.md.
CREATE TABLE classifications (
    source         text NOT NULL,
    external_id    text NOT NULL,
    relevant       boolean NOT NULL,     -- about this brand, not a namesake or a passing word
    sentiment      text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
    topic          text,
    summary        text,
    needs_reply    boolean NOT NULL DEFAULT false,
    classified_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id),
    FOREIGN KEY (source, external_id) REFERENCES mentions
);

-- One digest per run, over the relevant mentions published since the previous one.
CREATE TABLE digests (
    created_at    timestamptz PRIMARY KEY DEFAULT now(),
    period_start  timestamptz NOT NULL,
    summary       text NOT NULL,
    themes        jsonb NOT NULL,       -- [{ theme, mentions, sentiment }]
    reply_to      jsonb NOT NULL        -- [{ source, externalId, why }]
);
