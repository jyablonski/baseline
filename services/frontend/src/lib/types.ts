export type Meta = {
  total: number;
  limit: number;
  offset: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  meta: Meta;
};

export type ApiEnvelope<T> = {
  data: T;
  meta?: Partial<Meta>;
};

export type ApiErrorBody = {
  detail: string;
  status_code: number;
};

export type PlayerSummary = {
  player_id: string;
  full_name: string;
  position: string | null;
  team_abbreviation: string | null;
  is_active: boolean;
  career_games_played?: number;
  career_ppg?: number | null;
  career_rpg?: number | null;
  career_apg?: number | null;
  /** Regular Season MVP ladder for mvp_season (requested season, else the latest scored). */
  mvp_season?: string | null;
  mvp_score?: number | null;
  mvp_rank?: number | null;
};

export type PlayerSort = "mvp" | "name";

export type PlayerDetail = PlayerSummary & {
  first_name: string;
  last_name: string;
  height: string | null;
  weight: number | null;
  birth_date: string | null;
  jersey_number?: string | null;
  team_id?: string | null;
  career_games_played: number;
  seasons_played: number;
  first_season?: string | null;
  last_season?: string | null;
  career_ppg: number | null;
  career_rpg: number | null;
  career_apg: number | null;
  current_season_salary?: number | null;
  current_remaining_guaranteed?: number | null;
  current_contract_season?: string | null;
};

export type GameLogEntry = {
  game_id?: string;
  game_date: string;
  season?: string;
  opponent_abbreviation: string;
  location: string;
  result: string;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;
  plus_minus?: number | null;
  season_type?: string | null;
  mvp_game_score?: number | null;
  is_back_to_back: boolean;
};

export type BackToBackStats = {
  player_id: string;
  player_name: string;
  season: string | null;
  total_back_to_backs: number;
  games_played_in_b2b: number;
  games_sat_in_b2b?: number;
  avg_pts_b2b: number | null;
  avg_pts_non_b2b: number | null;
};

export type PlayerComparison = {
  player_id: string;
  full_name: string;
  team_abbreviation?: string | null;
  position?: string | null;
  career_games_played: number;
  seasons_played?: number;
  first_season?: string | null;
  last_season?: string | null;
  career_ppg: number | null;
  career_rpg: number | null;
  career_apg: number | null;
  career_avg_plus_minus?: number | null;
  mvp_season?: string | null;
  mvp_score?: number | null;
  mvp_rank?: number | null;
  playoff_mvp_score?: number | null;
  playoff_mvp_rank?: number | null;
};

export type PlayerSeasonStats = {
  player_id: string;
  season: string;
  games_played: number;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
};

export type HeadToHeadPlayerAverages = {
  player_id: string;
  full_name: string;
  games: number;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  plus_minus?: number | null;
};

export type HeadToHeadGameLine = {
  player_id: string;
  full_name: string;
  team_abbreviation: string;
  opponent_abbreviation: string;
  location: string;
  result: string;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals?: number | null;
  blocks?: number | null;
  turnovers?: number | null;
  plus_minus?: number | null;
};

export type HeadToHeadGame = {
  game_id: string;
  game_date: string;
  season: string;
  matchup: string;
  lines: HeadToHeadGameLine[];
};

export type HeadToHeadComparison = {
  games_played: number;
  players: HeadToHeadPlayerAverages[];
  games: HeadToHeadGame[];
};

export type TeamSummary = {
  team_id: string;
  abbreviation: string;
  team_name: string;
  conference: string;
  division: string;
  city?: string;
  nickname?: string;
  wins?: number | null;
  losses?: number | null;
  win_pct?: number | null;
  conference_rank?: number | null;
  division_rank?: number | null;
  record_source?: "official" | "games" | null;
  pts_scored_avg?: number | null;
  pts_allowed_avg?: number | null;
};

export type StandingSummary = {
  season: string;
  season_type?: string | null;
  conference: string;
  conference_rank: number | null;
  division?: string | null;
  division_rank?: number | null;
  wins: number | null;
  losses: number | null;
  win_pct?: number | null;
  games_back: number | null;
  streak?: string | null;
  last_10?: string | null;
};

export type StandingRow = StandingSummary & {
  team_id: string;
  abbreviation: string;
  team_name: string;
  season_type: string;
  as_of_date: string | null;
  division: string;
  division_rank: number | null;
  conference_rank: number | null;
  playoff_seed?: number | null;
  win_pct: number | null;
  conf_games_back: number | null;
  streak: string | null;
  last_10: string | null;
  record_source?: "official" | "games" | null;
};

export type TeamDetail = TeamSummary & {
  wins?: number;
  losses?: number;
  win_pct?: number;
  season?: string | null;
  arena_name?: string | null;
  arena_latitude?: number | null;
  arena_longitude?: number | null;
  primary_color?: string | null;
  alternate_color?: string | null;
  current_season_payroll?: number | null;
  current_remaining_guaranteed?: number | null;
  current_contract_season?: string | null;
  salary_cap?: number | null;
  luxury_tax?: number | null;
  first_apron?: number | null;
  second_apron?: number | null;
  over_luxury_tax?: boolean | null;
  over_first_apron?: boolean | null;
  over_second_apron?: boolean | null;
  record_season?: string | null;
  season_record?: TeamRecord | null;
  play_in_record?: TeamRecord | null;
  playoff_record?: TeamRecord | null;
  standing?: StandingSummary | null;
};

export type TeamRecord = {
  team_id: string;
  team_name: string;
  wins: number;
  losses: number;
  win_pct: number;
  games?: number;
  filters_applied?: Record<string, unknown>;
};

export type TeamGame = {
  game_id: string;
  season: string;
  season_type?: string;
  game_date: string;
  opponent_team_id?: string | null;
  opponent_abbreviation?: string | null;
  opponent_name?: string | null;
  location?: string | null;
  result?: string | null;
  team_score?: number | null;
  opponent_score?: number | null;
  home_team_id?: string;
  away_team_id?: string;
  home_team_abbreviation?: string;
  away_team_abbreviation?: string;
  home_team_name?: string;
  away_team_name?: string;
  home_score?: number | null;
  away_score?: number | null;
  arena?: string | null;
  arena_city?: string | null;
  score_margin?: number | null;
  is_win?: boolean | null;
};

export type LeagueGame = {
  game_id: string;
  season: string;
  season_type?: string | null;
  game_date: string;
  home_team_id?: string;
  away_team_id?: string;
  home_team_abbreviation?: string;
  away_team_abbreviation?: string;
  home_team_name?: string;
  away_team_name?: string;
  home_score?: number | null;
  away_score?: number | null;
  arena?: string | null;
  arena_city?: string | null;
  score_margin?: number | null;
  winning_team_id?: string | null;
};

export type SeasonInfo = {
  season: string;
};

export type WarehouseStatus = {
  last_scraped_at: string | null;
  next_scrape_at: string | null;
  player_count: number;
  game_count: number;
  season_count: number;
  first_season: string | null;
  last_season: string | null;
};

export type NlpQueryResponse = {
  answer: string;
  data?: Record<string, unknown>[] | null;
  sql?: string | null;
};

export type SearchPlayersParams = {
  search?: string;
  active?: boolean;
  team_id?: string;
  season?: string;
  sort?: PlayerSort;
  limit?: number;
  offset?: number;
};

export type GameLogParams = {
  season?: string;
  is_back_to_back?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type TeamGamesParams = {
  season?: string;
  opponent_team_id?: string;
  location?: "home" | "away";
  since_season?: string;
  arena_city?: string;
  season_type?: string;
  limit?: number;
  offset?: number;
};

export type TeamRecordParams = {
  opponent_team_id?: string;
  location?: "home" | "away";
  since_season?: string;
  season?: string;
  arena_city?: string;
  season_type?: string;
};

export type ListTeamsParams = {
  season?: string;
};

export type ListStandingsParams = {
  season?: string;
  conference?: string;
};

export type ListGamesParams = {
  season?: string;
  season_type?: string;
  limit?: number;
  offset?: number;
};

export type ScheduledGame = {
  game_id: string;
  season: string;
  season_type?: string | null;
  game_date: string;
  status: string;
  home_team_id: string;
  away_team_id: string;
  home_team_abbreviation?: string | null;
  away_team_abbreviation?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  arena?: string | null;
  arena_city?: string | null;
  arena_state?: string | null;
};

export type ListScheduleParams = {
  season?: string;
  status?: string;
  from_date?: string;
  limit?: number;
  offset?: number;
};

export type PlayByPlayEvent = {
  game_id: string;
  action_number: number;
  period: number | null;
  clock: string | null;
  clock_remaining_seconds?: number | null;
  elapsed_seconds: number;
  score_home: number;
  score_away: number;
  score_differential: number;
  home_points?: number | null;
  away_points?: number | null;
  points_scored?: number | null;
  scoring_side?: string | null;
  team_id?: string | null;
  player_id?: string | null;
  player_name?: string | null;
  action_type?: string | null;
  sub_type?: string | null;
  description?: string | null;
};

export type GameCollapse = {
  game_id: string;
  season?: string | null;
  game_date?: string | null;
  home_team_abbreviation?: string | null;
  home_score?: number | null;
  away_team_abbreviation?: string | null;
  away_score?: number | null;
  largest_lead_blown: number;
  blown_lead_team_abbreviation?: string | null;
  comeback_team_abbreviation?: string | null;
  blown_lead_period?: number | null;
  winner_margin_entering_fourth?: number | null;
  lead_changes?: number | null;
  overtime_periods?: number | null;
};

export type GameFlow = {
  game_id: string;
  season: string;
  game_date: string;
  home_team_id: string;
  home_team_abbreviation?: string | null;
  home_team_name?: string | null;
  home_primary_color?: string | null;
  home_alternate_color?: string | null;
  home_score?: number | null;
  away_team_id: string;
  away_team_abbreviation?: string | null;
  away_team_name?: string | null;
  away_primary_color?: string | null;
  away_alternate_color?: string | null;
  away_score?: number | null;
  winning_team_id?: string | null;
  winning_team_abbreviation?: string | null;
  winner_location?: string | null;
  has_play_by_play: boolean;
  scoring_play_count?: number | null;
  max_home_lead?: number | null;
  max_away_lead?: number | null;
  max_lead?: number | null;
  lead_changes?: number | null;
  ties?: number | null;
  home_lead_seconds?: number | null;
  away_lead_seconds?: number | null;
  tied_seconds?: number | null;
  home_lead_pct?: number | null;
  away_lead_pct?: number | null;
  tied_pct?: number | null;
  game_elapsed_seconds?: number | null;
  biggest_run_team_abbreviation?: string | null;
  biggest_run_winner_points?: number | null;
  biggest_run_opponent_points?: number | null;
  biggest_run_start_seconds?: number | null;
  biggest_run_end_seconds?: number | null;
  biggest_run_label?: string | null;
  final_period?: number | null;
  overtime_periods?: number | null;
  went_to_overtime?: boolean | null;
  largest_lead_blown?: number | null;
  blown_lead_team_abbreviation?: string | null;
  comeback_team_abbreviation?: string | null;
  blown_lead_period?: number | null;
  blown_lead_elapsed_seconds?: number | null;
  is_wire_to_wire?: boolean | null;
  winner_halftime_margin?: number | null;
  winner_margin_entering_fourth?: number | null;
};

export type SocialFlair = {
  author_flair?: string | null;
  flair_scope?: string | null;
  flair_team_abbreviation?: string | null;
  flair_team_name?: string | null;
};

export type SocialPost = SocialFlair & {
  reddit_id: string;
  subreddit: string;
  title: string;
  author: string | null;
  score: number;
  num_comments: number;
  created_utc: string;
  permalink: string;
  url: string | null;
  flair: string | null;
  is_self: boolean;
  scraped_at: string;
  tag: string | null;
  source: string | null;
  content_type: string;
  is_contested: boolean;
  discussion_ratio: number;
  captured_comment_count: number;
  top_comment_score: number | null;
  captured_comment_score: number | null;
  // Null when score is 0: a ratio against a zero score is undefined, not infinite.
  top_comment_leverage: number | null;
  comment_concentration: number | null;
  player_mentions: string[];
  team_mentions: string[];
};

export type SocialPostDetail = SocialPost & { selftext: string | null };

export type SocialComment = SocialFlair & {
  reddit_id: string;
  post_reddit_id: string;
  parent_id: string | null;
  author: string | null;
  body: string | null;
  score: number;
  created_utc: string;
  permalink: string;
  is_top_level: boolean;
  is_removed: boolean;
};

export type SocialSummary = {
  post_count: number;
  author_count: number;
  reported_comment_count: number;
  captured_comment_count: number;
  contested_post_count: number;
  total_score: number;
  top_score: number | null;
  first_post_at: string | null;
  last_post_at: string | null;
  last_scraped_at: string | null;
};

export type SocialLeader = {
  key: string;
  post_count: number;
  self_post_count: number;
  link_post_count: number;
  total_score: number;
  top_score: number;
  avg_score: number;
  median_score: number;
  total_comments: number;
  median_comments: number;
  median_discussion_ratio: number;
};

export type SocialFacet = {
  key: string;
  post_count: number;
  contested_post_count: number;
};

export type SocialEntity = {
  entity_id: string;
  entity_name: string;
  entity_abbreviation: string | null;
  /** Team nickname ("Lakers"); null for players. */
  entity_nickname?: string | null;
  post_count: number;
  comment_count: number;
  total_post_score: number;
  top_post_score: number | null;
  primary_color: string | null;
  alternate_color: string | null;
};

export type SocialFanbase = {
  flair_scope: string;
  flair_team_id: string | null;
  flair_team_abbreviation: string | null;
  flair_team_nickname: string | null;
  label: string;
  document_count: number;
  post_count: number;
  comment_count: number;
  author_count: number;
  primary_color: string | null;
  alternate_color: string | null;
};

export type SocialWindowParams = {
  from_date?: string;
  to_date?: string;
  subreddit?: string;
};

export type ListSocialPostsParams = SocialWindowParams & {
  tag?: string;
  source?: string;
  content_type?: string;
  contested?: boolean;
  search?: string;
  sort?: string;
  limit?: number;
  offset?: number;
};

export type BoxScoreRow = {
  player_id: string;
  player_name: string | null;
  team_id: string;
  team_abbreviation: string | null;
  team_name: string | null;
  location: string | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  field_goals_made: number | null;
  field_goals_attempted: number | null;
  field_goal_pct: number | null;
  three_pointers_made: number | null;
  three_pointers_attempted: number | null;
  three_point_pct: number | null;
  free_throws_made: number | null;
  free_throws_attempted: number | null;
  free_throw_pct: number | null;
  /** Null when the player attempted no shots, rather than a misleading zero. */
  true_shooting_pct: number | null;
  plus_minus: number | null;
  /** Game-level MVP score: box score scaled up in a win, down in a loss. */
  mvp_game_score?: number | null;
};
