# Social

r/nba posts and their top comments, modelled into discourse metrics.

**Current:** ingest, dbt models, Cube, REST, and the `/social` page. **Not built:** any score history.

## Ingest

`services/scraper/src/scrapers/reddit.py` — hot + top of day from r/nba, plus the **top 250 comments per post**. Runs whenever the pipeline is enabled, not behind `season_active`. Upserts on `reddit_id` and overwrites every other column, so **score and `num_comments` are the latest snapshot, not a series** — velocity and "trending" are not derivable. At the old 50-post / 10-comment limits that was roughly 40 new posts and 400 comments a day; at 100 / 250 expect roughly double the posts and up to 25× the comments per post, capped by how many comments a post actually has (estimate, not yet measured).

## Warehouse

| Layer  | Relation                                   | Grain                                                   |
| ------ | ------------------------------------------ | ------------------------------------------------------- |
| gold   | `fct_reddit_posts` / `fct_reddit_comments` | one post / one comment (thin copies)                    |
| silver | `int_reddit_documents`                     | one document: a post's title + selftext, or one comment |
| gold   | `fct_reddit_entity_mentions`               | one entity per document                                 |
| gold   | `fct_reddit_flair`                         | one distinct user-flair string, resolved to a franchise |
| seed   | `nba_team_aliases`                         | one team shorthand (`cavs`, `clips`, `sixers`, …)       |
| seed   | `nba_reddit_flair_codes`                   | one r/nba flair emoji code                              |

`int_reddit_documents` normalizes text with the existing `normalize_player_name` macro and pads it with spaces, so matching is a whole-token substring test. `[removed]` and `[deleted]` bodies are dropped.

### Entity matching precision

**Players match on full name only.** A single-token rule was tested against the live corpus and was roughly half wrong: "Michael Jordan drops 45" matched DeAndre Jordan, "Kobe Bryant" matched Thomas Bryant, "Russell Westbrook" matched D'Angelo Russell. Gating on surname uniqueness does not fix it, because `dim_players` holds only current players — it cannot rule out a collision with someone it does not contain.

The cost is recall: `kawhi` appears in ~31 documents where `Kawhi Leonard` appears in 8. **Surname- and nickname-only references are not counted, and the UI has to say so.** Teams have no such problem and match on full name, nickname, or alias.

This is work that could be improved upon in the future with more sophistication, but for now it prioritizes precision over recall to avoid false positives in player mentions.

### Flair

Two different fields. `flair` is the post's own `link_flair_text` — a content tag, null on ~90% of posts, and useless as a team signal. `author_flair` is the **user's team badge**, present on about half of posts and two thirds of comments, and is what `fct_reddit_flair` resolves.

Four resolution paths: an emoji code with a numeric variant (`:lal-1: Lakers`), an emoji code without one, a bracketed abbreviation (`[SAS] Tim Duncan`), and a plain nickname (`Lakers`). **The numeric variant is what makes a code a team badge** — `:phi:` is Philippines while `:phi-1:`…`:phi-5:` are the 76ers, and that suffix is the only thing separating them. Reddit's code is not always the NBA abbreviation: Milwaukee is `mke`, New Orleans is `nol`, and `tbr` is the 2020-21 Tampa Bay Raptors. Historic labels ride current codes, so `:was-5: Washington Bullets` is a Wizards fan; `sea` (Supersonics) has no current franchise and stays `other`.

`flair_scope` is `team`, `league`, or `other`; `flair_team_id` is set only for `team`. **Not backfillable** — Reddit returns the author's _current_ flair, so rows stored before this shipped stay null unless that post is re-scraped.

## Derived metrics

Defined in `services/api/src/queries/social.py`.

- **`discussion_ratio`** — `num_comments / greatest(score, 1)`. The score floor is deliberate: this is a feed sort option, and nulling it at score 0 would drop exactly the contested posts it exists to surface. It is not the default sort, because Reddit floors downvoted posts at 0 and the floor then puts them all first; the feed opens on Score.
- **`top_comment_leverage`**, **`comment_concentration`** — top / summed captured comment score over post score, using `nullif(score, 0)`. These compare a score to a score, so a zero denominator is meaningless rather than floored, and they come back null.
- **`is_contested`** — `num_comments >= 50 AND num_comments >= score`, and the title does not start with `Game Thread:` (a live game thread is busy and barely upvoted by design, not argued over). The first definition, `score <= 25`, was tuned on the offseason sample, where 23 of 169 posts sat at Reddit's 0 floor; in-season an argued-over post still collects ~100 upvotes, so a fixed score ceiling matched nothing and the Most contested card was always empty. Comparing comments to score scales with traffic and still includes posts at the floor.
- **`content_type`** — `highlight` / `report` / `game_thread` / `discussion` / `link`, from the leading title bracket. `[Highlight]`, `[Lowlight]` and `[All-Access]` (the league's own video account) are highlights; a `[Post Game Thread]` bracket or flair, or a live `GAME THREAD:` title, is a game thread; any other bracket is a report except satire (`SATIRE_TAGS` in `services/api/src/queries/social.py`, e.g. `[The Onion]`), which falls through to `discussion` / `link`. `flair` is null on ~86% of posts; the bracket (`[Highlight]`, `[Charania]`, `[PTFO]`) is the real taxonomy.
- **`source`** — link host, with self-posts collapsed to `self`.

**No Controversy Index.** Score-0 posts tie at any log-scaled maximum and low scores reorder on vote-fuzz noise, so the contested set is ranked by comment count.

## REST

All under `/api/v1/social`, gold-only, no Cube. Every list takes `from_date` / `to_date` (inclusive) and `subreddit`.

| Route                                     | Returns                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /summary`                            | Header counts, including captured vs. reported comment totals                                                                    |
| `GET /posts`                              | Feed. Filters: `tag`, `source`, `content_type`, `contested`, `search`; `sort` in `recent\|score\|comments\|discussion\|leverage` |
| `GET /posts/{reddit_id}`                  | One post plus `selftext`                                                                                                         |
| `GET /posts/{reddit_id}/comments`         | The stored top-10 sample, **never the thread**                                                                                   |
| `GET /entities?entity_type=player\|team`  | Player / team social; teams carry brand hex                                                                                      |
| `GET /fanbases?scope=team\|league\|other` | Which fanbases are talking, from user flair                                                                                      |
| `GET /tags`, `/sources`                   | Rollups with median score, comments, and discussion ratio                                                                        |
| `GET /facets`                             | Content-type counts for filter chips                                                                                             |

`num_comments` is the real Reddit total and `captured_comment_count` is at most 10. **Any UI showing a comment list must label it as a sample.**

## Page

`/social` opens with a strip of four cards: Most discussed team, Most discussed player, Rising, and Most contested. Rising is the player or team whose post count grew most against the window just before, the same length and ending the day before this one starts (`previousWindow`, `risingEntity` in `lib/social.ts`); the page reads that window from `/entities` with `limit=100`, so a name just off its top few still counts what it had. A name missing from it counts from zero, and an empty window before shows no Rising at all, since that is a gap in collection rather than a surge. How much was collected (posts, posters, comments captured against the real total) is in an "About this data" line at the foot of the page, not in the strip.

## Refresh stamp

`source.scrape_pipeline.daily_refresh_utc` (TIME, nullable) is **hand-maintained** — nothing writes it, and editing the host crontab does not update it. `GET /api/v1/status` rolls it forward to the next occurrence as `next_scrape_at`, or returns null when unset. A non-daily schedule would need a cron expression and a parser instead.

```sql
UPDATE source.scrape_pipeline SET daily_refresh_utc = '06:00' WHERE id = 1;
```
