# Cube

Cube is the semantic layer over `gold`. It serves governed measures and dimensions to Ask and MCP. The browser never calls it.

The data path is scraper → `source` → dbt → `silver`/`gold` → Cube → Ask and MCP. Cube reads gold; it never scrapes or builds anything.

## How it works

The model lives in [`services/cube`](../services/cube/): YAML cubes in `model/cubes/`, views in `model/views/`, connection in `cube.js`.

Two endpoints matter:

- `/cubejs-api/v1/meta` — the queryable members
- `/cubejs-api/v1/load` — accepts Cube query JSON and generates warehouse SQL internally

Clients send query JSON, never SQL. They validate member names against meta first, so `Unknown Cube member(s)` means the member is missing from the **running instance's model** — the Postgres column may well exist.

`game_odds` holds both the upcoming slate and the last pregame line of every played game, so filter `commence_time` when you want only upcoming games. `game_upsets` sits on `gold.fct_game_upsets` and stays empty until Final games with captured lines exist (see [data.md](data.md#upsets)).

Cube is not a second warehouse. Results reflect the current gold tables _and_ the model baked into the running image. Refreshing data does not update the model.

## Local vs production

|                   | Local (`make up`)                 | Production                       |
| ----------------- | --------------------------------- | -------------------------------- |
| Port 4000         | published                         | **not** published, internal only |
| Model             | Tilt syncs `cube.js` and `model/` | baked into the image             |
| `CUBEJS_DEV_MODE` | `true`                            | `false`                          |
| Memory            | unbounded                         | 1 GB limit                       |

A YAML change reaches production only through a new Cube image. Pull it with `make prod-release`.

**Only Tilt syncs the model.** A plain `docker compose up -d cube` — no Tilt — serves the model baked into the last-built image, so a new cube YAML is silently absent from `/meta` and every query against it fails as an unknown member. Run `docker compose build cube` first. `services/migrate` behaves the same way with Alembic revisions: `make db-migrate` against a stale image reports success and applies nothing.

**Dev mode hides model problems.** It relaxes auth and member-access checks, so a member can work locally and be absent from production meta. Never enable it on the public host.

To inspect production meta, ask from the API container — it shares Cube's network and secret:

```bash
docker compose exec -T api python -c '
import os
from cube.client import CubeClient
meta = CubeClient(os.environ["CUBE_API_URL"], os.environ["CUBEJS_API_SECRET"]).meta()
print([c["name"] for c in meta["cubes"]])
'
```

## Environment

| Variable            | Purpose                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `CUBE_API_URL`      | `http://cube:4000` in Compose, `http://localhost:4000` from the host |
| `CUBEJS_API_SECRET` | shared secret for Cube, API, and MCP                                 |
| `CUBEJS_DEV_MODE`   | `true` locally, `false` in production                                |
| `CUBEJS_DB_*`       | Cube's Postgres connection                                           |

## Primary keys need `public: true`

This is the most common way to break Ask or MCP with a valid-looking model.

Cube primary keys are **private by default**. `primary_key: true` still supports joins, but Cube omits the member from `/meta` — and since API and MCP validate against meta, the query fails before `/load` ever runs.

```yaml
- name: player_id
  sql: player_id
  type: string
  primary_key: true
  public: true
```

Cube tests enforce this on every primary key. `public: true` controls semantic visibility only — it does not publish port 4000 or bypass authentication.

## Adding a member

1. Add the dimension or measure to the right cube YAML over a gold relation.
2. Set `public: true` if it is a primary key used by API, MCP, or Ask.
3. Update the named operation and its tests if you add a wrapper.
4. Check `/meta` and run the Cube tests before publishing the image.

Fix the model or the requested member list. Never add a gold-SQL fallback.

## Related

[ask.md](ask.md) · [mcp-and-ai.md](mcp-and-ai.md) · [data.md](data.md) · [operations.md](operations.md)
