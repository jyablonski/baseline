import { describe, expect, it } from "vitest";

import type {
  AdminHealth,
  ContainerStats,
  DatabaseDiagnostics,
  DbtStatus,
  HostSnapshot,
  ModelStatus,
  PipelineRun,
  SourceHealth,
} from "@/lib/admin";
import {
  containerLevel,
  databaseLevel,
  dbtLevel,
  formatAge,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  adminTabHref,
  hostChecks,
  isInstantRun,
  latestPredictionAt,
  mlLevel,
  overallLevel,
  parseAdminTab,
  parseRunsPage,
  recoveredSources,
  recoveryNote,
  reviewItems,
  reviewSummary,
  runActionLabel,
  sourceCounts,
  pipelineLevel,
  snapshotLevel,
  sourceLevel,
  vmLevel,
} from "@/lib/admin-status";

const MB = 1024 * 1024;

function source(overrides: Partial<SourceHealth> = {}): SourceHealth {
  return {
    source_name: "standings",
    run_id: 1,
    status: "success",
    expectation: "not_checked",
    rows_written: 30,
    attempt: 1,
    error_type: null,
    error_detail: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    last_success_at: new Date().toISOString(),
    unhealthy_streak: 0,
    run_triggered_by: null,
    ...overrides,
  };
}

function health(overrides: Partial<AdminHealth> = {}): AdminHealth {
  return {
    pipeline: {
      enabled: true,
      season_active: true,
      season_start: null,
      season_end: null,
      scrape_mode: "daily",
      target_season: "2026-27",
      last_success_at: new Date().toISOString(),
      last_scrape_date: null,
      reason: null,
      updated_at: null,
      action_today: "daily",
      reddit_would_run: true,
      hours_since_success: 2,
      is_stale: false,
    },
    sources: [source()],
    freshness: [],
    dbt: {
      last_dbt_exit: 0,
      last_dbt_run_at: null,
      last_dbt_run_id: null,
      last_dbt_failed_nodes: null,
      gold_tables: [],
      gold_table_count: 3,
    },
    ml: [],
    recent_runs: [],
    recent_runs_total: 0,
    jobs: [],
    diagnostics: { snapshot: snapshot(), database: database() },
    ...overrides,
  };
}

function container(overrides: Partial<ContainerStats> = {}): ContainerStats {
  return {
    name: "nba-postgres-1",
    service: "postgres",
    oneoff: false,
    status: "running",
    health: "healthy",
    exit_code: 0,
    oom_killed: false,
    restart_count: 0,
    started_at: new Date().toISOString(),
    mem_used_bytes: 300 * MB,
    mem_limit_bytes: 2048 * MB,
    cpu_percent: 0.5,
    pids: 11,
    ...overrides,
  };
}

function snapshot(overrides: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    captured_at: new Date().toISOString(),
    host: {
      mem_total_bytes: 24_000 * MB,
      mem_available_bytes: 19_000 * MB,
      swap_total_bytes: 0,
      swap_free_bytes: 0,
      load_1m: 0.1,
      load_5m: 0.1,
      load_15m: 0.1,
      cpu_count: 4,
      uptime_seconds: 86_400,
      disk_total_bytes: 100_000 * MB,
      disk_used_bytes: 30_000 * MB,
    },
    containers: [container()],
    connections: [],
    errors: [],
    ...overrides,
  };
}

function database(overrides: Partial<DatabaseDiagnostics> = {}): DatabaseDiagnostics {
  return {
    max_connections: 100,
    total_connections: 5,
    database_size_bytes: 900 * MB,
    connections: [],
    ...overrides,
  };
}

describe("sourceLevel", () => {
  it("treats a single failure as a warning and a streak as bad", () => {
    // One miss is usually "not published yet"; a streak is a parse break.
    expect(sourceLevel(source({ status: "failed", unhealthy_streak: 1 }))).toBe("warn");
    expect(sourceLevel(source({ status: "failed", unhealthy_streak: 2 }))).toBe("bad");
  });

  it("shows skipped as idle, not as a failure", () => {
    expect(sourceLevel(source({ status: "skipped" }))).toBe("idle");
  });

  it("flags a success that missed its expectation", () => {
    expect(
      sourceLevel(source({ status: "success", expectation: "below", unhealthy_streak: 1 }))
    ).toBe("warn");
    expect(sourceLevel(source({ status: "success", expectation: "met" }))).toBe("ok");
  });

  it("escalates repeated empty runs like repeated failures", () => {
    // Zero rows every night is how a parser that stopped matching looks.
    expect(
      sourceLevel(source({ status: "success", expectation: "below", unhealthy_streak: 3 }))
    ).toBe("bad");
  });
});

describe("recoveredSources", () => {
  it("names the sources a catch-up filled, and only the healthy ones", () => {
    const logs = source({
      source_name: "player_game_logs",
      run_id: 74,
      run_triggered_by: "catch-up",
    });
    const pbp = source({ source_name: "play_by_play", run_id: 73, run_triggered_by: "catch-up" });
    const daily = source({ run_triggered_by: "scheduled" });
    const empty = source({ run_triggered_by: "catch-up", expectation: "below", rows_written: 0 });
    expect(recoveredSources([logs, pbp, daily, empty])).toEqual([logs, pbp]);
    expect(recoveryNote([logs])).toBe("recovered by catch-up #74");
    expect(recoveryNote([logs, pbp])).toBe("recovered by catch-up #73 and #74");
    expect(recoveryNote([])).toBeNull();
  });

  it("clears the review list once a catch-up recovers the daily's empty sources", () => {
    const recovered = health({
      sources: [
        source({ source_name: "player_game_logs", run_id: 74, run_triggered_by: "catch-up" }),
        source({ source_name: "play_by_play", run_id: 74, run_triggered_by: "catch-up" }),
      ],
    });
    expect(reviewItems(recovered).filter((item) => item.key.startsWith("source-"))).toEqual([]);
    expect(pipelineLevel(recovered)).toBe("ok");
  });
});

describe("pipelineLevel", () => {
  it("reports a disabled pipeline as idle rather than broken", () => {
    const disabled = health();
    disabled.pipeline.enabled = false;
    expect(pipelineLevel(disabled)).toBe("idle");
  });

  it("reports stale as bad even when every source looks fine", () => {
    const stale = health();
    stale.pipeline.is_stale = true;
    expect(pipelineLevel(stale)).toBe("bad");
  });

  it("takes the worst source level", () => {
    expect(
      pipelineLevel(
        health({ sources: [source(), source({ status: "failed", unhealthy_streak: 3 })] })
      )
    ).toBe("bad");
  });
});

describe("dbtLevel", () => {
  const base: DbtStatus = {
    last_dbt_exit: 0,
    last_dbt_run_at: null,
    last_dbt_run_id: null,
    last_dbt_failed_nodes: null,
    gold_tables: [],
    gold_table_count: 5,
  };

  it("is idle when dbt has never recorded an exit", () => {
    expect(dbtLevel({ ...base, last_dbt_exit: null })).toBe("idle");
  });

  it("is bad on a non-zero exit", () => {
    expect(dbtLevel({ ...base, last_dbt_exit: 1 })).toBe("bad");
  });

  it("warns when dbt succeeded but produced no marts", () => {
    expect(dbtLevel({ ...base, gold_table_count: 0 })).toBe("warn");
    expect(dbtLevel(base)).toBe("ok");
  });
});

describe("mlLevel", () => {
  function model(latest: string | null): ModelStatus {
    return {
      model_name: "elo",
      model_version: "elo-v0",
      prediction_count: 5,
      latest_as_of: latest,
      latest_scraped_at: latest,
      with_market_wp: 0,
    };
  }

  it("is idle with no models or no timestamps", () => {
    expect(mlLevel([])).toBe("idle");
    expect(mlLevel([model(null)])).toBe("idle");
  });

  it("warns once predictions go stale", () => {
    const old = new Date(Date.now() - 60 * 3_600_000).toISOString();
    expect(mlLevel([model(old)])).toBe("warn");
    expect(mlLevel([model(new Date().toISOString())])).toBe("ok");
  });
});

describe("overallLevel", () => {
  it("is driven by the worst subsystem", () => {
    expect(overallLevel(health())).toBe("ok");
    const broken = health();
    broken.dbt = { ...broken.dbt, last_dbt_exit: 2 };
    expect(overallLevel(broken)).toBe("bad");
  });

  it("is idle only when everything is idle", () => {
    const idle = health({
      sources: [],
      ml: [],
      diagnostics: { snapshot: null, database: database() },
    });
    idle.pipeline.enabled = false;
    idle.dbt = {
      last_dbt_exit: null,
      last_dbt_run_at: null,
      last_dbt_run_id: null,
      last_dbt_failed_nodes: null,
      gold_tables: [],
      gold_table_count: 0,
    };
    expect(overallLevel(idle)).toBe("idle");
  });
});

describe("containerLevel", () => {
  it("is ok for a running container with headroom", () => {
    expect(containerLevel(container())).toBe("ok");
  });

  it("warns near the memory limit and is bad at it", () => {
    expect(containerLevel(container({ mem_used_bytes: 1600 * MB }))).toBe("warn");
    expect(containerLevel(container({ mem_used_bytes: 1900 * MB }))).toBe("bad");
  });

  it("is bad for an OOM kill, an unhealthy check, or a stopped service", () => {
    expect(containerLevel(container({ oom_killed: true }))).toBe("bad");
    expect(containerLevel(container({ health: "unhealthy" }))).toBe("bad");
    expect(containerLevel(container({ status: "exited", exit_code: 137 }))).toBe("bad");
  });

  it("does not alarm on a finished one-off job", () => {
    expect(containerLevel(container({ oneoff: true, status: "exited", exit_code: 1 }))).toBe(
      "idle"
    );
  });

  it("warns once a container has restarted", () => {
    expect(containerLevel(container({ restart_count: 2 }))).toBe("warn");
  });
});

describe("snapshotLevel", () => {
  it("is idle before the first snapshot and ok for a healthy one", () => {
    expect(snapshotLevel(null)).toBe("idle");
    expect(snapshotLevel(snapshot())).toBe("ok");
  });

  it("warns when the collector has stopped reporting", () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(snapshotLevel(snapshot({ captured_at: old }))).toBe("warn");
  });

  it("scores available memory, not free memory", () => {
    const host = snapshot().host!;
    expect(snapshotLevel(snapshot({ host: { ...host, mem_available_bytes: 3_000 * MB } }))).toBe(
      "warn"
    );
    expect(snapshotLevel(snapshot({ host: { ...host, mem_available_bytes: 1_000 * MB } }))).toBe(
      "bad"
    );
  });

  it("flags a nearly full disk, heavy swap, and sustained load", () => {
    const host = snapshot().host!;
    expect(snapshotLevel(snapshot({ host: { ...host, disk_used_bytes: 95_000 * MB } }))).toBe(
      "bad"
    );
    expect(
      snapshotLevel(
        snapshot({ host: { ...host, swap_total_bytes: 4_000 * MB, swap_free_bytes: 1_000 * MB } })
      )
    ).toBe("warn");
    expect(snapshotLevel(snapshot({ host: { ...host, load_5m: 6 } }))).toBe("warn");
  });

  it("takes the worst container and warns on collector errors", () => {
    expect(
      snapshotLevel(snapshot({ containers: [container(), container({ oom_killed: true })] }))
    ).toBe("bad");
    expect(snapshotLevel(snapshot({ errors: ["connections: TimeoutExpired"] }))).toBe("warn");
  });
});

describe("databaseLevel", () => {
  it("warns near max_connections and on a long-running query", () => {
    expect(databaseLevel(database())).toBe("ok");
    expect(databaseLevel(database({ total_connections: 85 }))).toBe("warn");
    expect(databaseLevel(database({ total_connections: 99 }))).toBe("bad");
    const stuck = {
      user_name: "postgres",
      application_name: "dbt",
      client_addr: "172.18.0.9",
      is_external: false,
      state: "active",
      connections: 1,
      oldest_connected_at: null,
      longest_active_seconds: 900,
    };
    expect(databaseLevel(database({ connections: [stuck] }))).toBe("warn");
  });

  it("shows an external client without scoring it", () => {
    const dbeaver = {
      user_name: "postgres",
      application_name: "DBeaver",
      client_addr: "203.0.113.9",
      is_external: true,
      state: "idle",
      connections: 2,
      oldest_connected_at: null,
      longest_active_seconds: null,
    };
    expect(databaseLevel(database({ connections: [dbeaver] }))).toBe("ok");
  });
});

describe("vmLevel", () => {
  it("is idle without a snapshot unless the database needs attention", () => {
    expect(vmLevel({ snapshot: null, database: database() })).toBe("idle");
    expect(vmLevel({ snapshot: null, database: database({ total_connections: 99 }) })).toBe("bad");
  });

  it("feeds the overall status", () => {
    const oom = health({
      diagnostics: {
        snapshot: snapshot({ containers: [container({ oom_killed: true })] }),
        database: database(),
      },
    });
    expect(overallLevel(oom)).toBe("bad");
  });
});

describe("parseRunsPage", () => {
  it("accepts positive integers and falls back to page 1 otherwise", () => {
    expect(parseRunsPage("3")).toBe(3);
    expect(parseRunsPage(["2", "9"])).toBe(2);
    for (const junk of [undefined, "", "0", "-1", "1.5", "abc"]) {
      expect(parseRunsPage(junk)).toBe(1);
    }
  });
});

describe("formatters", () => {
  it("formats bytes, percentages, and durations", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(290.8 * MB)).toBe("291 MB");
    expect(formatBytes(2.5 * 1024 * MB)).toBe("2.5 GB");
    expect(formatPercent(1, 4)).toBe("25%");
    expect(formatPercent(1, 0)).toBe("—");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(600)).toBe("10m");
    expect(formatDuration(7200)).toBe("2h");
    expect(formatDuration(5 * 86_400)).toBe("5d");
  });

  it("formats ages and never renders a raw timestamp", () => {
    expect(formatAge(null)).toBe("never");
    expect(formatAge(new Date(Date.now() - 30 * 60_000).toISOString())).toMatch(/m ago$/);
    expect(formatAge(new Date(Date.now() - 5 * 3_600_000).toISOString())).toBe("5h ago");
    expect(formatAge(new Date(Date.now() - 72 * 3_600_000).toISOString())).toBe("3d ago");
  });

  it("formats counts with a placeholder for missing values", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount(1234567)).toBe("1,234,567");
  });
});

function run(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    run_id: 1,
    triggered_by: "scheduled",
    status: "success",
    scrape_action: "daily",
    scrape_exit: 0,
    reddit_ran: true,
    reddit_exit: 0,
    dbt_exit: 0,
    dbt_failed_nodes: null,
    ml_exit: 0,
    detail: null,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_seconds: 280,
    ...overrides,
  };
}

describe("admin tabs", () => {
  it("falls back to the overview for anything it does not know", () => {
    expect(parseAdminTab("pipeline")).toBe("pipeline");
    expect(parseAdminTab(["settings", "pipeline"])).toBe("settings");
    expect(parseAdminTab("nope")).toBe("overview");
    expect(parseAdminTab(undefined)).toBe("overview");
  });

  it("keeps the overview on the bare URL", () => {
    expect(adminTabHref("overview")).toBe("/admin");
    expect(adminTabHref("infrastructure")).toBe("/admin?tab=infrastructure");
  });
});

describe("sourceCounts", () => {
  it("splits the last runs into succeeded, skipped, and the rest", () => {
    expect(
      sourceCounts([
        source(),
        source({ status: "skipped" }),
        source({ status: "failed", unhealthy_streak: 1 }),
        source({ expectation: "below", unhealthy_streak: 3 }),
      ])
    ).toEqual({ total: 4, succeeded: 1, skipped: 1, failed: 2 });
  });
});

describe("hostChecks", () => {
  it("skips a reading the snapshot did not carry", () => {
    const host = { ...snapshot().host!, mem_available_bytes: null, cpu_count: null };
    // No swap configured, so swap has no share to score either.
    expect(hostChecks(host).map((check) => check.resource)).toEqual(["Disk"]);
  });
});

describe("runActionLabel", () => {
  it("names a run by its NBA scrape, not the sources that always ride along", () => {
    expect(runActionLabel("daily+contracts+transactions+reddit")).toBe("Daily");
    expect(runActionLabel("season+reddit")).toBe("Season backfill");
    expect(runActionLabel("contracts+transactions+reddit")).toBe("Off-season");
    expect(runActionLabel("skipped_disabled")).toBe("Disabled");
    expect(runActionLabel("noop")).toBe("Nothing to scrape");
    expect(runActionLabel("dbt")).toBe("dbt only");
    expect(runActionLabel("catch-up")).toBe("Catch-up");
    expect(runActionLabel(null)).toBe("—");
    expect(runActionLabel("something_new")).toBe("something_new");
  });
});

describe("isInstantRun", () => {
  it("is a successful run that took no time, not a failed or unfinished one", () => {
    expect(isInstantRun(run({ duration_seconds: 0 }))).toBe(true);
    expect(isInstantRun(run({ duration_seconds: 0, status: "failed" }))).toBe(false);
    expect(isInstantRun(run({ duration_seconds: null }))).toBe(false);
    expect(isInstantRun(run())).toBe(false);
  });
});

describe("latestPredictionAt", () => {
  it("is null until a model has scored something", () => {
    expect(latestPredictionAt([])).toBeNull();
  });
});

describe("reviewItems", () => {
  const titles = (value: AdminHealth) => reviewItems(value).map((item) => item.title);

  it("has nothing to say about a healthy system", () => {
    expect(reviewItems(health())).toEqual([]);
    expect(reviewSummary([])).toBe("Nothing to review");
  });

  it("raises odd-looking runs without calling the system unhealthy", () => {
    const value = health({
      pipeline: { ...health().pipeline, target_season: null },
      sources: [
        source(),
        // Never attempted until a game goes final: expected before the season.
        source({ source_name: "play_by_play", status: "skipped", last_success_at: null }),
        source({ source_name: "player_game_logs", status: "skipped", last_success_at: null }),
        source({ source_name: "reddit", status: "skipped", last_success_at: null }),
        // Skipped today but scraped before: not worth a line.
        source({ source_name: "odds", status: "skipped" }),
      ],
      recent_runs: [
        run({ run_id: 48, triggered_by: "manual" }),
        run({ run_id: 47, triggered_by: "manual" }),
        run({ run_id: 44, triggered_by: "manual", duration_seconds: 0 }),
      ],
    });
    const items = reviewItems(value);
    // Daily mode never reads target_season, so leaving it empty is fine.
    expect(items.map((item) => [item.level, item.title])).toEqual([
      ["warn", "Every recent run is a manual trigger"],
      ["warn", "Run #44 finished in 0s"],
      ["idle", "reddit never scraped"],
    ]);
    expect(items[0].detail).toContain("Runs #44–48");
    expect(items.every((item) => item.tab === "pipeline")).toBe(true);
    expect(overallLevel(value)).toBe("ok");
    expect(reviewSummary(items)).toBe("3 items to review, none blocking");
  });

  it("does not read one manual run, or a disabled gate, as a problem", () => {
    const value = health({
      pipeline: { ...health().pipeline, enabled: false, is_stale: true, target_season: null },
      recent_runs: [run({ triggered_by: "manual" })],
    });
    expect(reviewItems(value)).toEqual([]);
    expect(
      titles(health({ recent_runs: [run({ triggered_by: "manual" }), run({ run_id: 2 })] }))
    ).toEqual([]);
  });

  it("puts blocking pipeline problems first", () => {
    const stale = new Date(Date.now() - 40 * 3_600_000).toISOString();
    const value = health({
      pipeline: {
        ...health().pipeline,
        is_stale: true,
        target_season: null,
        scrape_mode: "Season",
      },
      sources: [
        source({ source_name: "odds", status: "failed", unhealthy_streak: 1, error_detail: "403" }),
        source({ source_name: "reddit", status: "failed", unhealthy_streak: 3 }),
        source({ source_name: "standings", expectation: "below", unhealthy_streak: 1 }),
        source({ source_name: "a", status: "skipped", last_success_at: null }),
        source({ source_name: "b", status: "skipped", last_success_at: null }),
        source({ source_name: "c", status: "skipped", last_success_at: null }),
      ],
      dbt: { ...health().dbt, last_dbt_exit: 1, last_dbt_failed_nodes: ["model fct_x"] },
      ml: [
        {
          model_name: "elo",
          model_version: "elo-v1",
          prediction_count: 3,
          latest_as_of: null,
          latest_scraped_at: stale,
          with_market_wp: 0,
        },
      ],
    });
    const items = reviewItems(value);
    expect(items.map((item) => [item.level, item.title])).toEqual([
      ["bad", "Ingestion is stale"],
      ["bad", "reddit failed 3 runs in a row"],
      ["bad", "dbt build failed with exit 1"],
      ["warn", "Target season is empty"],
      ["warn", "odds failed"],
      ["warn", "standings returned no rows"],
      ["warn", "ML predictions are stale"],
      ["idle", "a, b and c never scraped"],
    ]);
    const detail = (title: string) => items.find((item) => item.title === title)?.detail;
    expect(detail("odds failed")).toBe("403");
    expect(detail("reddit failed 3 runs in a row")).toMatch(/^Last healthy run /);
    expect(detail("dbt build failed with exit 1")).toMatch(/^1 node failed/);
    expect(detail("Target season is empty")).toMatch(/does nothing/);
    expect(reviewSummary(items)).toBe("8 items to review, 3 blocking");
    expect(reviewSummary(items.slice(0, 1))).toBe("1 item to review, 1 blocking");
  });

  it("words a dbt failure by how much dbt could name", () => {
    const failed = (nodes: string[] | null) =>
      reviewItems(
        health({ dbt: { ...health().dbt, last_dbt_exit: 2, last_dbt_failed_nodes: nodes } })
      )[0].detail;
    expect(failed(null)).toMatch(/stopped before naming/);
    expect(failed(["a", "b"])).toMatch(/^2 nodes failed/);
    expect(titles(health({ dbt: { ...health().dbt, gold_table_count: 0 } }))).toEqual([
      "dbt built no gold tables",
    ]);
  });

  it("sends host, container, and database problems to the infrastructure tab", () => {
    const value = health({
      diagnostics: {
        snapshot: snapshot({
          host: {
            ...snapshot().host!,
            mem_available_bytes: 1_000 * MB,
            disk_used_bytes: 85_000 * MB,
          },
          containers: [
            container(),
            container({ name: "nba-api-1", service: "api", oom_killed: true }),
            container({ name: "nba-cube-1", service: null, status: "exited" }),
            container({ name: "nba-mcp-1", service: "mcp", status: null }),
            container({ name: "nba-caddy-1", service: "caddy", health: "unhealthy" }),
            container({ name: "nba-frontend-1", service: "frontend", restart_count: 2 }),
          ],
          errors: ["connections: timeout", "stats: timeout"],
        }),
        database: database({ total_connections: 85 }),
      },
    });
    const items = reviewItems(value);
    expect(items.every((item) => item.tab === "infrastructure")).toBe(true);
    expect(items.map((item) => [item.level, item.title, item.detail])).toEqual([
      ["bad", "Memory is under pressure", "4% of memory is still available."],
      ["bad", "api needs a look", "The container was OOM killed."],
      ["bad", "nba-cube-1 needs a look", "The container is exited."],
      ["bad", "mcp needs a look", "The container is in an unknown state."],
      ["bad", "caddy needs a look", "Its health check is failing."],
      ["warn", "Disk is under pressure", "85% of the disk is used."],
      ["warn", "frontend needs a look", "15% of its memory limit used, 2 restarts."],
      ["warn", "The host snapshot is incomplete", "connections: timeout; stats: timeout"],
      ["warn", "Postgres is near its connection limit", "85 of 100 connections in use."],
    ]);
  });

  it("reports a stale snapshot instead of scoring its old readings", () => {
    const now = Date.now();
    const old = snapshot({
      captured_at: new Date(now - 30 * 60_000).toISOString(),
      containers: [container({ oom_killed: true })],
    });
    const items = reviewItems(
      health({
        diagnostics: {
          snapshot: old,
          database: database({
            connections: [
              {
                user_name: "postgres",
                application_name: "psql",
                client_addr: null,
                is_external: false,
                state: "active",
                connections: 1,
                oldest_connected_at: null,
                longest_active_seconds: 900,
              },
            ],
          }),
        },
      }),
      now
    );
    expect(items.map((item) => item.title)).toEqual([
      "Host snapshot is stale",
      "A Postgres query has been running a long time",
    ]);
  });

  it("is quiet before the first snapshot and for a snapshot with no host section", () => {
    const base = health().diagnostics;
    expect(reviewItems(health({ diagnostics: { ...base, snapshot: null } }))).toEqual([]);
    expect(
      reviewItems(health({ diagnostics: { ...base, snapshot: snapshot({ host: null }) } }))
    ).toEqual([]);
  });
});
