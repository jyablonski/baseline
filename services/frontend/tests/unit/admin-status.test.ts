import { describe, expect, it } from "vitest";

import type { AdminHealth, DbtStatus, ModelStatus, SourceHealth } from "@/lib/admin";
import {
  dbtLevel,
  formatAge,
  formatCount,
  mlLevel,
  overallLevel,
  pipelineLevel,
  sourceLevel,
} from "@/lib/admin-status";

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
      gold_tables: [],
      gold_table_count: 3,
    },
    ml: [],
    recent_runs: [],
    jobs: [],
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
    const idle = health({ sources: [], ml: [] });
    idle.pipeline.enabled = false;
    idle.dbt = {
      last_dbt_exit: null,
      last_dbt_run_at: null,
      last_dbt_run_id: null,
      gold_tables: [],
      gold_table_count: 0,
    };
    expect(overallLevel(idle)).toBe("idle");
  });
});

describe("formatters", () => {
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
