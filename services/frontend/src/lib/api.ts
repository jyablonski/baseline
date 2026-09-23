import type {
  BackToBackStats,
  BoxScoreRow,
  SocialComment,
  SocialEntity,
  SocialFacet,
  SocialFanbase,
  SocialLeader,
  SocialPost,
  SocialPostDetail,
  SocialSummary,
  SocialWindowParams,
  ListSocialPostsParams,
  GameLogEntry,
  GameLogParams,
  GameCollapse,
  GameFlow,
  HeadToHeadComparison,
  LeagueGame,
  ListGamesParams,
  ListScheduleParams,
  PlayByPlayEvent,
  ScheduledGame,
  ListStandingsParams,
  ListTeamsParams,
  NlpQueryResponse,
  PaginatedResponse,
  PlayerComparison,
  PlayerDetail,
  PlayerSeasonStats,
  PlayerSummary,
  PredictionScorecard,
  SearchPlayersParams,
  SeasonInfo,
  StandingRow,
  TeamDetail,
  TeamGame,
  TeamGamesParams,
  TeamRecord,
  TeamRecordParams,
  TeamSummary,
  WarehouseStatus,
} from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

function buildQuery(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: options?.signal ?? AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiClientError("The request timed out. Try again in a moment.", 0);
    }
    throw new ApiClientError("Unable to load data. Try again in a moment.", 0);
  }

  if (!res.ok) {
    let detail = `API error: ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (body.detail != null) {
        detail = JSON.stringify(body.detail);
      }
    } catch {
      /* ignore parse errors */
    }
    throw new ApiClientError(detail, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

function emptyMeta(length = 0) {
  return { total: length, limit: length, offset: 0 };
}

function asPaginated<T>(json: unknown): PaginatedResponse<T> {
  if (Array.isArray(json)) {
    return { data: json as T[], meta: emptyMeta(json.length) };
  }

  if (json && typeof json === "object" && "data" in json) {
    const payload = json as { data: unknown; meta?: Partial<PaginatedResponse<T>["meta"]> };
    const rows = Array.isArray(payload.data)
      ? (payload.data as T[])
      : payload.data == null
        ? []
        : [payload.data as T];
    return {
      data: rows,
      meta: {
        total: payload.meta?.total ?? rows.length,
        limit: payload.meta?.limit ?? rows.length,
        offset: payload.meta?.offset ?? 0,
      },
    };
  }

  return { data: [], meta: emptyMeta() };
}

function asData<T>(json: unknown): T {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}

function asSeasons(json: unknown): PaginatedResponse<SeasonInfo> {
  const page = asPaginated<string | SeasonInfo>(json);
  const data = page.data.map((item) => (typeof item === "string" ? { season: item } : item));
  return { data, meta: page.meta };
}

function asNlpResponse(json: unknown): NlpQueryResponse {
  if (!json || typeof json !== "object") {
    return { answer: "No answer returned." };
  }

  const obj = json as Record<string, unknown>;
  if (typeof obj.answer === "string") {
    return {
      answer: obj.answer,
      data: Array.isArray(obj.data) ? (obj.data as Record<string, unknown>[]) : null,
      sql: typeof obj.sql === "string" ? obj.sql : null,
    };
  }

  if (obj.data && typeof obj.data === "object" && "answer" in obj.data) {
    return asNlpResponse(obj.data);
  }

  return { answer: "No answer returned.", data: null, sql: null };
}

export function queryErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Try again in a moment.";
}

export const api = {
  getGameBoxScore: async (gameId: string) =>
    asPaginated<BoxScoreRow>(await fetchApi(`/api/v1/games/${gameId}/box-score`)),

  getSocialSummary: async (params: SocialWindowParams = {}) =>
    asData<SocialSummary>(await fetchApi(`/api/v1/social/summary${buildQuery({ ...params })}`)),

  listSocialPosts: async (params: ListSocialPostsParams = {}) =>
    asPaginated<SocialPost>(await fetchApi(`/api/v1/social/posts${buildQuery({ ...params })}`)),

  getSocialPost: async (id: string) =>
    asData<SocialPostDetail>(await fetchApi(`/api/v1/social/posts/${id}`)),

  listSocialPostComments: async (id: string) =>
    asPaginated<SocialComment>(await fetchApi(`/api/v1/social/posts/${id}/comments`)),

  listSocialEntities: async (entityType: "player" | "team", params: SocialWindowParams = {}) =>
    asPaginated<SocialEntity>(
      await fetchApi(`/api/v1/social/entities${buildQuery({ entity_type: entityType, ...params })}`)
    ),

  listSocialFanbases: async (
    params: SocialWindowParams & { scope?: string; limit?: number } = {}
  ) =>
    asPaginated<SocialFanbase>(
      await fetchApi(`/api/v1/social/fanbases${buildQuery({ ...params })}`)
    ),

  listSocialFacets: async (params: SocialWindowParams = {}) =>
    asPaginated<SocialFacet>(await fetchApi(`/api/v1/social/facets${buildQuery({ ...params })}`)),

  listSocialBoard: async (
    board: "tags" | "sources" | "authors" | "composition",
    params: SocialWindowParams & { limit?: number } = {}
  ) =>
    asPaginated<SocialLeader>(
      await fetchApi(`/api/v1/social/${board}${buildQuery({ ...params })}`)
    ),

  searchPlayers: async (search = "", params: Omit<SearchPlayersParams, "search"> = {}) =>
    asPaginated<PlayerSummary>(
      await fetchApi(
        `/api/v1/players${buildQuery({
          search,
          active: params.active,
          team_id: params.team_id,
          season: params.season,
          sort: params.sort,
          limit: params.limit,
          offset: params.offset,
        })}`
      )
    ),

  getPlayer: async (id: string) => asData<PlayerDetail>(await fetchApi(`/api/v1/players/${id}`)),

  getPlayerGameLog: async (id: string, params: GameLogParams = {}) =>
    asPaginated<GameLogEntry>(
      await fetchApi(
        `/api/v1/players/${id}/game-log${buildQuery({
          season: params.season,
          is_back_to_back: params.is_back_to_back,
          sort: params.sort,
          order: params.order,
          limit: params.limit,
          offset: params.offset,
        })}`
      )
    ),

  getPlayerBackToBacks: async (id: string, season?: string) =>
    asData<BackToBackStats>(
      await fetchApi(`/api/v1/players/${id}/back-to-backs${buildQuery({ season })}`)
    ),

  comparePlayers: async (ids: string[], stat?: string, season?: string) =>
    asPaginated<PlayerComparison>(
      await fetchApi(
        `/api/v1/players/compare${buildQuery({
          ids: ids.join(","),
          stat,
          season,
        })}`
      )
    ),

  comparePlayersHeadToHead: async (ids: string[]) =>
    asData<HeadToHeadComparison>(
      await fetchApi(
        `/api/v1/players/compare/head-to-head${buildQuery({
          ids: ids.join(","),
        })}`
      )
    ),

  listTeams: async (params: ListTeamsParams = {}) =>
    asPaginated<TeamSummary>(
      await fetchApi(`/api/v1/teams${buildQuery({ season: params.season })}`)
    ),

  getTeam: async (id: string) => asData<TeamDetail>(await fetchApi(`/api/v1/teams/${id}`)),

  getTeamGames: async (id: string, params: TeamGamesParams = {}) =>
    asPaginated<TeamGame>(
      await fetchApi(
        `/api/v1/teams/${id}/games${buildQuery({
          season: params.season,
          opponent_team_id: params.opponent_team_id,
          location: params.location,
          since_season: params.since_season,
          arena_city: params.arena_city,
          season_type: params.season_type,
          limit: params.limit,
          offset: params.offset,
        })}`
      )
    ),

  getTeamRecord: async (id: string, params: TeamRecordParams = {}) =>
    asData<TeamRecord>(
      await fetchApi(
        `/api/v1/teams/${id}/record${buildQuery({
          opponent_team_id: params.opponent_team_id,
          location: params.location,
          since_season: params.since_season,
          season: params.season,
          arena_city: params.arena_city,
          season_type: params.season_type,
        })}`
      )
    ),

  listStandings: async (params: ListStandingsParams = {}) =>
    asPaginated<StandingRow>(
      await fetchApi(
        `/api/v1/standings${buildQuery({
          season: params.season,
          conference: params.conference,
        })}`
      )
    ),

  listSeasons: async () => asSeasons(await fetchApi("/api/v1/seasons")),

  getPlayerSeasonStats: async (id: string) =>
    asPaginated<PlayerSeasonStats>(await fetchApi(`/api/v1/players/${id}/season-stats`)),

  getStatus: async () => asData<WarehouseStatus>(await fetchApi("/api/v1/status")),

  listGames: async (params: ListGamesParams = {}) =>
    asPaginated<LeagueGame>(
      await fetchApi(
        `/api/v1/games${buildQuery({
          season: params.season,
          season_type: params.season_type,
          limit: params.limit ?? 10,
          offset: params.offset,
        })}`
      )
    ),

  listSchedule: async (params: ListScheduleParams = {}) =>
    asPaginated<ScheduledGame>(
      await fetchApi(
        `/api/v1/schedule${buildQuery({
          season: params.season,
          status: params.status,
          from_date: params.from_date,
          limit: params.limit ?? 50,
          offset: params.offset,
        })}`
      )
    ),

  getPredictionScorecard: async (params: { season?: string } = {}) =>
    asData<PredictionScorecard>(
      await fetchApi(`/api/v1/predictions/scorecard${buildQuery({ season: params.season })}`)
    ),

  listBiggestCollapses: async (
    params: { season?: string; blown_lead_team?: string; limit?: number } = {}
  ) =>
    asPaginated<GameCollapse>(
      await fetchApi(
        `/api/v1/games/collapses${buildQuery({
          season: params.season,
          blown_lead_team: params.blown_lead_team,
          limit: params.limit ?? 10,
        })}`
      )
    ),

  getGamePlayByPlay: async (gameId: string) =>
    asPaginated<PlayByPlayEvent>(await fetchApi(`/api/v1/games/${gameId}/play-by-play`)),

  getGameFlow: async (gameId: string) =>
    asData<GameFlow>(await fetchApi(`/api/v1/games/${gameId}/flow`)),

  queryNlp: async (question: string, season?: string) => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/v1/query`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          ...(season ? { season } : {}),
        }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ApiClientError("The request timed out. Try again in a moment.", 0);
      }
      throw new ApiClientError("Unable to load data. Try again in a moment.", 0);
    }

    if (!res.ok) {
      let detail = `API error: ${res.status}`;
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body.detail === "string") {
          detail = body.detail;
        }
      } catch {
        /* ignore */
      }
      throw new ApiClientError(detail, res.status);
    }

    return asNlpResponse(await res.json());
  },
};
