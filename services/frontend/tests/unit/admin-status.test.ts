import { describe, expect, it } from "vitest";

import type {
  AdminHealth,
  ContainerStats,
  DatabaseDiagnostics,
  DbtStatus,
  HostSnapshot,
  ModelStatus,
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
  mlLevel,
  overallLevel,
  parseRunsPage,
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
      target_season: null,
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
