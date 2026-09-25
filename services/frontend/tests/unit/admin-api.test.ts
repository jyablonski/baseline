import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminApiError,
  JOB_TYPES,
  enqueueAdminJob,
  fetchAdminHealth,
  isJobType,
} from "@/lib/admin";

/** Types mock.calls as a real tuple without declaring unused parameters. */
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200, statusText = "OK") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

describe("isJobType", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts every declared job type and nothing else", () => {
    for (const jobType of JOB_TYPES) {
      expect(isJobType(jobType)).toBe(true);
    }
    expect(isJobType("drop-tables")).toBe(false);
    expect(isJobType("")).toBe(false);
    expect(isJobType(undefined)).toBe(false);
    expect(isJobType(null)).toBe(false);
    // Guards a form value, which arrives as an unknown, so non-strings must not throw.
    expect(isJobType(4)).toBe(false);
    expect(isJobType({ toString: () => "scrape" })).toBe(false);
  });
});

describe("AdminApiError", () => {
  it("carries the upstream status alongside the message", () => {
    const error = new AdminApiError("nope", 409);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AdminApiError");
    expect(error.message).toBe("nope");
    expect(error.status).toBe(409);
  });
});

describe("fetchAdminHealth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fails closed with a 503 when no admin token is configured", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminHealth()).rejects.toMatchObject({ status: 503 });
    // The point of the guard: no unauthenticated request is ever made.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unwraps the data envelope and sends a bearer token without caching", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubEnv("ADMIN_API_URL", "http://api:8000");
    const fetchMock = vi.fn<FetchMock>(async () =>
      jsonResponse({ data: { jobs: [], recent_runs: [] } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAdminHealth()).resolves.toEqual({ jobs: [], recent_runs: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api:8000/api/v1/admin/health");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    // Operational data must never be served from a cache.
    expect(init?.cache).toBe("no-store");
  });

  it("pages recent runs through the query string", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubEnv("ADMIN_API_URL", "http://api:8000");
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdminHealth({ limit: 5, offset: 10 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api:8000/api/v1/admin/health?run_limit=5&run_offset=10"
    );
  });

  it("raises the upstream status when the admin API rejects the call", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubGlobal("fetch", async () => jsonResponse({}, 401, "Unauthorized"));

    await expect(fetchAdminHealth()).rejects.toMatchObject({
      status: 401,
      message: "Admin API returned 401 Unauthorized",
    });
  });

  it("prefers the in-cluster URL over the public one", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubEnv("ADMIN_API_URL", "");
    vi.stubEnv("INTERNAL_API_URL", "http://internal:8000");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://baseline.example.dev");
    const fetchMock = vi.fn<FetchMock>(async () => jsonResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdminHealth();
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://internal:8000/api/v1/admin/health");
  });
});

describe("enqueueAdminJob", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses to queue work when no admin token is configured", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(enqueueAdminJob("scrape", "someone")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the job type and requester, and returns the queued job", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubEnv("ADMIN_API_URL", "http://api:8000");
    const fetchMock = vi.fn<FetchMock>(async () =>
      jsonResponse({ data: { job_id: 7, job_type: "dbt" } }, 202)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(enqueueAdminJob("dbt", "someone")).resolves.toMatchObject({ job_id: 7 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api:8000/api/v1/admin/jobs");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ job_type: "dbt", requested_by: "someone" });
  });

  it("surfaces the API detail on a 409 rather than a generic message", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ detail: "A job is already running." }, 409, "Conflict")
    );

    // 409 means one is already queued; the console shows this instead of retrying.
    await expect(enqueueAdminJob("refresh", "someone")).rejects.toMatchObject({
      status: 409,
      message: "A job is already running.",
    });
  });

  it("falls back to status text when the error body is not JSON", async () => {
    vi.stubEnv("ADMIN_API_TOKEN", "s3cret");
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>502</html>", { status: 502, statusText: "Bad Gateway" })
    );

    await expect(enqueueAdminJob("ml", "someone")).rejects.toMatchObject({
      status: 502,
      message: "Admin API returned 502 Bad Gateway",
    });
  });
});
