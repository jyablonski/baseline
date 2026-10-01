with scoring as (
    select * from {{ ref('int_play_by_play_scoring') }}
),

games as (
    select * from {{ ref('fct_team_game_results') }}
),

game_bounds as (
    select
        scoring.game_id,
        max(scoring.period) as max_period,
        max(scoring.elapsed_seconds) as max_elapsed,
        count(*) as scoring_play_count,
        max(scoring.score_differential) as max_home_lead,
        max(-scoring.score_differential) as max_away_lead
    from scoring
    group by scoring.game_id
),

game_end as (
    select
        game_bounds.game_id,
        game_bounds.scoring_play_count,
        game_bounds.max_home_lead,
        game_bounds.max_away_lead,
        greatest(game_bounds.max_home_lead, game_bounds.max_away_lead) as max_lead,
        -- Run the clock to the final buzzer, not the last basket: time after the
        -- last score still counts toward whoever was leading.
        greatest(
            game_bounds.max_elapsed,
            case
                when coalesce(game_bounds.max_period, 4) <= 4 then 4 * 720
                else 4 * 720 + (game_bounds.max_period - 4) * 300
            end
        ) as game_end_seconds
    from game_bounds
),

last_scores as (
    select
        scoring.game_id,
        scoring.score_differential,
        row_number() over (
            partition by scoring.game_id
            order by scoring.action_number desc
        ) as reverse_order
    from scoring
),

final_differential as (
    select
        last_scores.game_id,
        last_scores.score_differential
    from last_scores
    where last_scores.reverse_order = 1
),

-- Scoring plays bracketed by a 0-0 row at tip-off and a closing row at the
-- buzzer. action_number 0 and int max force those to sort first and last when
-- a scoring play shares their elapsed second.
timeline as (
    select
        game_end.game_id,
        0::numeric as elapsed_seconds,
        0 as action_number,
        0 as score_differential
    from game_end

    union all

    select
        scoring.game_id,
        scoring.elapsed_seconds,
        scoring.action_number,
        scoring.score_differential
    from scoring

    union all

    select
        game_end.game_id,
        game_end.game_end_seconds,
        2147483647 as action_number,
        final_differential.score_differential
    from game_end
    inner join final_differential
        on game_end.game_id = final_differential.game_id
),

marked_intervals as (
    select
        timeline.game_id,
        timeline.elapsed_seconds,
        timeline.score_differential,
        lead(timeline.elapsed_seconds) over (
            partition by timeline.game_id
            order by timeline.elapsed_seconds, timeline.action_number
        ) as next_elapsed
    from timeline
),

intervals as (
    select
        marked_intervals.game_id,
        greatest(
            coalesce(marked_intervals.next_elapsed, marked_intervals.elapsed_seconds)
            - marked_intervals.elapsed_seconds,
            0
        ) as duration_seconds,
        marked_intervals.score_differential
    from marked_intervals
    where marked_intervals.next_elapsed is not null
),

lead_time as (
    select
        intervals.game_id,
        sum(intervals.duration_seconds) as game_elapsed_seconds,
        sum(
            case
                when intervals.score_differential > 0 then intervals.duration_seconds
                else 0
            end
        ) as home_lead_seconds,
        sum(
            case
                when intervals.score_differential < 0 then intervals.duration_seconds
                else 0
            end
        ) as away_lead_seconds,
        sum(
            case
                when intervals.score_differential = 0 then intervals.duration_seconds
                else 0
            end
        ) as tied_seconds
    from intervals
    group by intervals.game_id
),

with_prev_diff as (
    select
        scoring.game_id,
        scoring.score_differential,
        lag(scoring.score_differential) over (
            partition by scoring.game_id
            order by scoring.action_number
        ) as prev_differential
    from scoring
),

-- Lead changes are direct sign flips only. Passing through a tie (home +1,
-- tied, away +2) counts as a tie, not a lead change.
lead_events as (
    select
        with_prev_diff.game_id,
        count(*) filter (
            where
                with_prev_diff.prev_differential > 0
                and with_prev_diff.score_differential < 0
        ) + count(*) filter (
            where
                with_prev_diff.prev_differential < 0
                and with_prev_diff.score_differential > 0
        ) as lead_changes,
        count(*) filter (
            where
                with_prev_diff.score_differential = 0
                and with_prev_diff.prev_differential is not null
                and with_prev_diff.prev_differential <> 0
        ) as ties
    from with_prev_diff
    group by with_prev_diff.game_id
),

run_starts as (
    select * from scoring
),

run_ends as (
    select * from scoring
),

-- Every start/end pair of scoring plays in a game (O(n^2) per game). Measuring
-- from the start row's prev_score includes the starting play's own points.
run_windows as (
    select
        run_starts.game_id,
        run_starts.elapsed_seconds as run_start_seconds,
        run_ends.elapsed_seconds as run_end_seconds,
        run_starts.action_number as start_action_number,
        run_ends.action_number as end_action_number,
        run_ends.score_home - coalesce(run_starts.prev_score_home, 0) as window_home_points,
        run_ends.score_away - coalesce(run_starts.prev_score_away, 0) as window_away_points
    from run_starts
    inner join run_ends
        on run_starts.game_id = run_ends.game_id
        and run_ends.action_number >= run_starts.action_number
),

run_candidates as (
    select
        run_windows.game_id,
        run_windows.run_start_seconds,
        run_windows.run_end_seconds,
        run_windows.window_home_points + run_windows.window_away_points as scored_total,
        case
            when run_windows.window_home_points > run_windows.window_away_points
                then run_windows.window_home_points
            else run_windows.window_away_points
        end as winner_points,
        case
            when run_windows.window_home_points > run_windows.window_away_points
                then run_windows.window_away_points
            else run_windows.window_home_points
        end as opponent_points,
        case
            when run_windows.window_home_points > run_windows.window_away_points
                then games.home_team_abbreviation
            else games.away_team_abbreviation
        end as winner_abbreviation
    from run_windows
    inner join games
        on run_windows.game_id = games.game_id
    where
        run_windows.window_home_points <> run_windows.window_away_points
        and run_windows.window_home_points + run_windows.window_away_points > 0
        and run_windows.window_home_points + run_windows.window_away_points < 25
),

ranked_runs as (
    select
        run_candidates.*,
        -- Biggest net margin wins; ties go to the more one-sided run, then
        -- the shorter one, then the earlier one.
        row_number() over (
            partition by run_candidates.game_id
            order by
                (run_candidates.winner_points - run_candidates.opponent_points) desc,
                (
                    (run_candidates.winner_points - run_candidates.opponent_points)::numeric
                    / nullif(run_candidates.scored_total, 0)
                ) desc,
                (run_candidates.run_end_seconds - run_candidates.run_start_seconds) asc,
                run_candidates.run_start_seconds asc
        ) as run_rank
    from run_candidates
),

-- Margin from the eventual loser's side: positive means the loser was ahead.
-- The peak of this is the largest lead blown.
loser_margins as (
    select
        scoring.game_id,
        scoring.period,
        scoring.action_number,
        scoring.elapsed_seconds,
        case
            when games.winning_team_id = games.home_team_id then -scoring.score_differential
            when games.winning_team_id = games.away_team_id then scoring.score_differential
        end as loser_margin
    from scoring
    inner join games
        on scoring.game_id = games.game_id
),

ranked_loser_margins as (
    select
        loser_margins.game_id,
        loser_margins.period,
        loser_margins.elapsed_seconds,
        loser_margins.loser_margin,
        row_number() over (
            partition by loser_margins.game_id
            order by loser_margins.loser_margin desc, loser_margins.action_number asc
        ) as margin_rank
    from loser_margins
    where loser_margins.loser_margin is not null
),

blown_lead as (
    select
        ranked_loser_margins.game_id,
        greatest(ranked_loser_margins.loser_margin, 0) as largest_lead_blown,
        case
            when ranked_loser_margins.loser_margin > 0 then ranked_loser_margins.period
        end as blown_lead_period,
        case
            when ranked_loser_margins.loser_margin > 0 then ranked_loser_margins.elapsed_seconds
        end as blown_lead_elapsed_seconds
    from ranked_loser_margins
    where ranked_loser_margins.margin_rank = 1
),

period_end_ranks as (
    select
        scoring.game_id,
        scoring.period,
        scoring.score_differential,
        row_number() over (
            partition by scoring.game_id, scoring.period
            order by scoring.action_number desc
        ) as reverse_period_order
    from scoring
    where scoring.period between 1 and 4
),

period_end_margins as (
    select
        period_end_ranks.game_id,
        period_end_ranks.period,
        period_end_ranks.score_differential
    from period_end_ranks
    where period_end_ranks.reverse_period_order = 1
),

winner_period_margins as (
    select
        games.game_id,
        max(
            case
                when period_end_margins.period = 2 then
                    case
                        when games.winning_team_id = games.home_team_id
                            then period_end_margins.score_differential
                        when games.winning_team_id = games.away_team_id
                            then -period_end_margins.score_differential
                    end
            end
        ) as winner_halftime_margin,
        max(
            case
                when period_end_margins.period = 3 then
                    case
                        when games.winning_team_id = games.home_team_id
                            then period_end_margins.score_differential
                        when games.winning_team_id = games.away_team_id
                            then -period_end_margins.score_differential
                    end
            end
        ) as winner_margin_entering_fourth
    from games
    inner join period_end_margins
        on games.game_id = period_end_margins.game_id
    group by games.game_id
),

game_periods as (
    select
        scoring.game_id,
        max(scoring.period) as final_period
    from scoring
    group by scoring.game_id
),

biggest_run as (
    select
        ranked_runs.game_id,
        ranked_runs.winner_abbreviation as biggest_run_team_abbreviation,
        ranked_runs.winner_points as biggest_run_winner_points,
        ranked_runs.opponent_points as biggest_run_opponent_points,
        ranked_runs.run_start_seconds as biggest_run_start_seconds,
        ranked_runs.run_end_seconds as biggest_run_end_seconds,
        ranked_runs.winner_abbreviation
        || ' '
        || ranked_runs.winner_points::int
        || '-'
        || ranked_runs.opponent_points::int as biggest_run_label
    from ranked_runs
    where ranked_runs.run_rank = 1
)

select
    games.game_id,
    games.season,
    games.game_date,
    games.home_team_id,
    games.home_team_abbreviation,
    games.home_team_name,
    games.home_score,
    games.away_team_id,
    games.away_team_abbreviation,
    games.away_team_name,
    games.away_score,
    games.winning_team_id,
    case
        when games.winning_team_id = games.home_team_id then games.home_team_abbreviation
        when games.winning_team_id = games.away_team_id then games.away_team_abbreviation
    end as winning_team_abbreviation,
    games.winner_location,
    game_end.scoring_play_count,
    greatest(game_end.max_home_lead, 0) as max_home_lead,
    greatest(game_end.max_away_lead, 0) as max_away_lead,
    greatest(game_end.max_lead, 0) as max_lead,
    coalesce(lead_events.lead_changes, 0) as lead_changes,
    coalesce(lead_events.ties, 0) as ties,
    lead_time.home_lead_seconds,
    lead_time.away_lead_seconds,
    lead_time.tied_seconds,
    case
        when lead_time.game_elapsed_seconds > 0
            then lead_time.home_lead_seconds / lead_time.game_elapsed_seconds
    end as home_lead_pct,
    case
        when lead_time.game_elapsed_seconds > 0
            then lead_time.away_lead_seconds / lead_time.game_elapsed_seconds
    end as away_lead_pct,
    case
        when lead_time.game_elapsed_seconds > 0
            then lead_time.tied_seconds / lead_time.game_elapsed_seconds
    end as tied_pct,
    lead_time.game_elapsed_seconds,
    biggest_run.biggest_run_team_abbreviation,
    biggest_run.biggest_run_winner_points,
    biggest_run.biggest_run_opponent_points,
    biggest_run.biggest_run_start_seconds,
    biggest_run.biggest_run_end_seconds,
    biggest_run.biggest_run_label,
    coalesce(game_periods.final_period, 4) as final_period,
    greatest(coalesce(game_periods.final_period, 4) - 4, 0) as overtime_periods,
    coalesce(game_periods.final_period, 4) > 4 as went_to_overtime,
    coalesce(blown_lead.largest_lead_blown, 0) as largest_lead_blown,
    case
        when coalesce(blown_lead.largest_lead_blown, 0) > 0
            then case
                when games.winning_team_id = games.home_team_id then games.away_team_abbreviation
                when games.winning_team_id = games.away_team_id then games.home_team_abbreviation
            end
    end as blown_lead_team_abbreviation,
    case
        when coalesce(blown_lead.largest_lead_blown, 0) > 0
            then case
                when games.winning_team_id = games.home_team_id then games.home_team_abbreviation
                when games.winning_team_id = games.away_team_id then games.away_team_abbreviation
            end
    end as comeback_team_abbreviation,
    blown_lead.blown_lead_period,
    blown_lead.blown_lead_elapsed_seconds,
    coalesce(blown_lead.largest_lead_blown, 0) = 0 as is_wire_to_wire,
    winner_period_margins.winner_halftime_margin,
    winner_period_margins.winner_margin_entering_fourth
from games
inner join game_end
    on games.game_id = game_end.game_id
left join lead_time
    on games.game_id = lead_time.game_id
left join lead_events
    on games.game_id = lead_events.game_id
left join biggest_run
    on games.game_id = biggest_run.game_id
left join blown_lead
    on games.game_id = blown_lead.game_id
left join winner_period_margins
    on games.game_id = winner_period_margins.game_id
left join game_periods
    on games.game_id = game_periods.game_id
