/**
 * A stand-in for the FastAPI service, for the signed-in e2e specs.
 *
 * Those flows run through server actions, which call the API from the Next.js
 * server: the window.fetch mock the other specs use cannot reach them. This
 * keeps the same contract in memory (bearer tokens, the X-Baseline-User
 * header, quota, feature flags) so the browser, the session, the
 * server actions and the HTTP client are all exercised for real. The API's own
 * behaviour is covered against Postgres in services/api/tests.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.STUB_API_PORT ?? 8100);
const ACCOUNTS_TOKEN = process.env.ACCOUNTS_API_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;
const DAILY_LIMIT = 3;
const MAX_TURNS = 3;

const TEAMS = {
  GSW: "7bf8726a-a852-452d-b81f-14839127c5fb",
  LAL: "8cbd46d2-8092-4b1e-8b24-f31c7692cadd",
  MIA: "3cd9c269-597b-4eab-acb3-2d434f8b1280",
  MIL: "3cbdd44d-e2b2-458a-81cd-b3008d5ebb5b",
};

const GAMES = [
  {
    game_id: "00000000-0000-4000-8000-000000000401",
    season: "2025-26",
    game_date: "2099-10-22",
    start_time_et: "19:30:00",
    status: "Scheduled",
    home_team_id: TEAMS.GSW,
    away_team_id: TEAMS.LAL,
    home_team_abbreviation: "GSW",
    away_team_abbreviation: "LAL",
    home_team_name: "Golden State Warriors",
    away_team_name: "Los Angeles Lakers",
    arena: "Chase Center",
    home_moneyline: -150,
    away_moneyline: 130,
  },
  {
    // No odds posted: a pick is allowed, a stake is not.
    game_id: "00000000-0000-4000-8000-000000000402",
    season: "2025-26",
    game_date: "2099-10-22",
    start_time_et: "20:00:00",
    status: "Scheduled",
    home_team_id: TEAMS.MIA,
    away_team_id: TEAMS.MIL,
    home_team_abbreviation: "MIA",
    away_team_abbreviation: "MIL",
    home_team_name: "Miami Heat",
    away_team_name: "Milwaukee Bucks",
    arena: "Kaseya Center",
    home_moneyline: null,
    away_moneyline: null,
  },
];

const flags = new Map([
  ["chatbot", { enabled: true, description: "Signed-in chat at /chat.", updated_by: null }],
  ["picks", { enabled: true, description: "Signed-in game picks.", updated_by: null }],
]);
/** user id -> { provider, subject, name, picks: Map<gameId, pick>, asked, blocked } */
const users = new Map();
const subjects = new Map();
/** Every /account request, so a spec can assert on what the server sent. */
const requests = [];

function userFor(id) {
  if (!users.has(id)) {
    users.set(id, { name: null, picks: new Map(), asked: 0, blocked: false });
  }
  return users.get(id);
}

function sheet(user) {
  const picks = [...user.picks.values()];
  return {
    data: {
      summary: {
        wins: 0,
        losses: 0,
        pending: picks.length,
        net: 0,
        staked_open: picks.reduce((sum, pick) => sum + (pick.stake ?? 0), 0),
        vs_model: 0,
        model_games: 0,
      },
      picks,
    },
  };
}

function quota(user) {
  return {
    daily_limit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - user.asked),
    resets_at: "2099-10-23T04:00:00Z",
    max_turns: MAX_TURNS,
  };
}

function flagRows() {
  return [...flags.entries()].map(([flag_key, flag]) => ({
    flag_key,
    enabled: flag.enabled,
    description: flag.description,
    updated_at: "2099-10-22T12:00:00Z",
    updated_by: flag.updated_by,
  }));
}

const HEALTH = {
  pipeline: {
    enabled: true,
    season_active: true,
    season_start: null,
    season_end: null,
    scrape_mode: "daily",
    target_season: null,
    last_success_at: new Date().toISOString(),
    last_scrape_date: null,
    reason: null,
    updated_at: null,
    action_today: "daily",
    reddit_would_run: true,
    hours_since_success: 1,
    is_stale: false,
  },
  sources: [],
  freshness: [],
  dbt: {
    last_dbt_exit: 0,
    last_dbt_failed_nodes: null,
    last_dbt_run_at: new Date().toISOString(),
    last_dbt_run_id: 1,
    gold_tables: [],
    gold_table_count: 0,
  },
  ml: [],
  recent_runs: [],
  recent_runs_total: 0,
  jobs: [],
  diagnostics: {
    snapshot: null,
    database: {
      max_connections: 100,
      total_connections: 1,
      database_size_bytes: 1000,
      connections: [],
    },
  },
};

function bearer(request) {
  const header = request.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

function account(request, path, body) {
  if (bearer(request) !== ACCOUNTS_TOKEN) return [401, { detail: "Invalid credentials." }];
  requests.push({
    method: request.method,
    path,
    user: request.headers["x-baseline-user"] ?? null,
    body,
  });

  if (path === "/users" && request.method === "POST") {
    const key = `${body.provider}:${body.provider_subject}`;
    if (!subjects.has(key)) subjects.set(key, randomUUID());
    const userId = subjects.get(key);
    userFor(userId).name = body.display_name;
    return [200, { data: { user_id: userId, status: "active" } }];
  }

  const userId = request.headers["x-baseline-user"];
  if (!userId) return [400, { detail: "Missing or malformed user id." }];
  // Like the API: an id with no row behind it is not quietly created.
  if (!users.has(userId)) return [404, { detail: "Account not found." }];
  const user = userFor(userId);
  if (user.blocked) return [403, { detail: "This account has been blocked." }];

  if (path === "/me" && request.method === "GET") {
    return [200, { data: { user: { user_id: userId }, chat: quota(user) } }];
  }
  if (path === "/me" && request.method === "DELETE") {
    users.delete(userId);
    return [204, null];
  }

  if (path === "/chat" && request.method === "POST") {
    if (!flags.get("chatbot").enabled) return [503, { detail: "Chat is turned off right now." }];
    if (user.asked >= DAILY_LIMIT) {
      return [429, { detail: "You have used all of today's questions." }];
    }
    user.asked += 1;
    const question = body.messages.at(-1).content;
    const turns = body.messages.filter((message) => message.role === "user").length;
    return [
      200,
      {
        answer: `Answer ${turns}: ${question}`,
        data: [{ team_abbreviation: "OKC", wins: 60 }],
        source: "cube tool get_standings",
        backend: "rules",
        quota: quota(user),
      },
    ];
  }

  if (path.startsWith("/picks")) {
    if (!flags.get("picks").enabled) return [503, { detail: "Picks is turned off right now." }];
    if (path === "/picks" && request.method === "GET") return [200, sheet(user)];

    const gameId = decodeURIComponent(path.slice("/picks/".length));
    const game = GAMES.find((item) => item.game_id === gameId);
    if (!game) return [409, { detail: "That game is not on the schedule." }];
    if (request.method === "DELETE") {
      user.picks.delete(gameId);
      return [200, sheet(user)];
    }
    if (request.method === "PUT") {
      const home = body.picked_team_id === game.home_team_id;
      if (!home && body.picked_team_id !== game.away_team_id) {
        return [409, { detail: "That team is not playing in this game." }];
      }
      const moneyline = home ? game.home_moneyline : game.away_moneyline;
      const stake = body.stake ?? null;
      if (stake !== null && moneyline === null) {
        return [409, { detail: "No moneyline is posted for this game yet, so it takes no stake." }];
      }
      user.picks.set(gameId, {
        game_id: gameId,
        picked_team_id: body.picked_team_id,
        stake,
        moneyline,
        result: "pending",
        profit: null,
        model_correct: null,
        game_date: game.game_date,
        start_time_et: game.start_time_et,
        game_status: game.status,
        home_team_id: game.home_team_id,
        home_team_abbreviation: game.home_team_abbreviation,
        home_score: null,
        away_team_id: game.away_team_id,
        away_team_abbreviation: game.away_team_abbreviation,
        away_score: null,
        created_at: "2099-10-22T12:00:00Z",
        updated_at: "2099-10-22T12:00:00Z",
      });
      return [200, sheet(user)];
    }
  }
  return [404, { detail: "Not found." }];
}

function admin(request, path, body) {
  if (bearer(request) !== ADMIN_TOKEN) return [401, { detail: "Invalid credentials." }];
  if (path === "/health") return [200, { data: HEALTH }];
  if (path === "/flags" && request.method === "GET") return [200, flagRows()];
  if (path.startsWith("/flags/") && request.method === "PUT") {
    const flag = flags.get(decodeURIComponent(path.slice("/flags/".length)));
    if (!flag) return [404, { detail: "Unknown feature flag." }];
    flag.enabled = Boolean(body.enabled);
    flag.updated_by = body.updated_by;
    return [200, { data: flagRows().find((row) => flags.get(row.flag_key) === flag) }];
  }
  return [404, { detail: "Not found." }];
}

/** Test-only controls. The real API has nothing like them. */
function control(path, body) {
  if (path === "/reset") {
    for (const flag of flags.values()) Object.assign(flag, { enabled: true, updated_by: null });
    users.clear();
    subjects.clear();
    requests.length = 0;
    return [200, { ok: true }];
  }
  if (path === "/requests") return [200, requests];
  if (path === "/seed") {
    userFor(body.user_id);
    return [200, { ok: true }];
  }
  if (path === "/block") {
    userFor(body.user_id).blocked = true;
    return [200, { ok: true }];
  }
  return [404, {}];
}

function publicApi(path) {
  if (path === "/features") {
    return [
      200,
      { data: Object.fromEntries([...flags].map(([key, flag]) => [key, flag.enabled])) },
    ];
  }
  if (path === "/status") {
    return [200, { data: { last_scraped_at: "2099-10-22T08:00:00Z", next_scrape_at: null } }];
  }
  if (path === "/seasons") {
    return [200, { data: [{ season: "2025-26" }], meta: { total: 1, limit: 1, offset: 0 } }];
  }
  if (path === "/schedule") {
    return [200, { data: GAMES, meta: { total: GAMES.length, limit: 50, offset: 0 } }];
  }
  if (path === "/query") {
    return [200, { answer: "Rules answer.", data: [], sql: null }];
  }
  return [200, { data: [], meta: { total: 0, limit: 0, offset: 0 } }];
}

const server = createServer(async (request, response) => {
  // The browser reads the public endpoints from another origin (the Next dev
  // server), as it does from the Tilt stack.
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  response.setHeader("Access-Control-Allow-Methods", "*");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const { pathname } = new URL(request.url, "http://stub");
  const body = await readJson(request);
  let result;
  if (pathname.startsWith("/__stub")) {
    result = control(pathname.slice("/__stub".length), body);
  } else if (pathname.startsWith("/api/v1/account")) {
    result = account(request, pathname.slice("/api/v1/account".length), body);
  } else if (pathname.startsWith("/api/v1/admin")) {
    result = admin(request, pathname.slice("/api/v1/admin".length), body);
  } else if (pathname.startsWith("/api/v1")) {
    result = publicApi(pathname.slice("/api/v1".length));
  } else {
    result = [200, { status: "ok" }];
  }

  const [status, payload] = result;
  if (payload === null) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub api listening on ${PORT}`);
});
