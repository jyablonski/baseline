import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminTable } from "@/components/admin/admin-table";
import { Section } from "@/components/admin/section";
import { LEVEL_TEXT, Meter, Status, StatusDot } from "@/components/admin/status";
import type {
  ContainerStats,
  DatabaseDiagnostics,
  Diagnostics,
  HostStats,
  ServiceConnections,
} from "@/lib/admin";
import {
  containerLevel,
  databaseLevel,
  formatAge,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  isSnapshotStale,
} from "@/lib/admin-status";
import { cn } from "@/lib/utils";

const SERVICE_LABEL: Record<string, string> = {
  caddy: "Site (Caddy)",
  mcp: "MCP",
};

/** VM, container, and connection health from the host snapshot plus live Postgres. */
export function VmDiagnostics({ diagnostics }: { diagnostics: Diagnostics }) {
  const { snapshot, database } = diagnostics;
  const stale = snapshot !== null && isSnapshotStale(snapshot);

  return (
    <div className="space-y-10">
      {snapshot === null ? (
        <p className="pt-6 text-sm text-muted-foreground">
          No host snapshot yet. The admin-jobs cron records one every minute via{" "}
          <code>scripts/host-snapshot.py</code>.
        </p>
      ) : (
        <>
          <div className="space-y-3 border-b border-rule py-6">
            {snapshot.host ? (
              <HostFields host={snapshot.host} capturedAt={snapshot.captured_at} />
            ) : null}
            {stale ? (
              <p className="text-sm text-warn">
                Host snapshot {formatAge(snapshot.captured_at)} — stale: the admin-jobs cron,
                python3, or Docker on the host has stopped reporting.
              </p>
            ) : null}
            {snapshot.errors.length > 0 ? (
              <ul className="space-y-1 text-xs text-destructive">
                {snapshot.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <Section
            title="Containers"
            noteAlign="inline"
            note={`${snapshot.containers.filter((container) => container.status === "running").length} running · ${snapshot.containers.reduce((sum, container) => sum + container.restart_count, 0)} restarts`}
          >
            <ContainersTable containers={snapshot.containers} />
          </Section>
        </>
      )}

      <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2">
        {snapshot === null ? null : (
          <Section title="Inbound connections">
            <Connections connections={snapshot.connections} />
          </Section>
        )}
        <Section
          title="Postgres"
          noteAlign="inline"
          note={`${database.total_connections} of ${database.max_connections} connections · ${formatBytes(database.database_size_bytes)}`}
        >
          <PostgresConnections database={database} />
        </Section>
      </div>
    </div>
  );
}

function HostFields({ host, capturedAt }: { host: HostStats; capturedAt: string }) {
  const memUsed =
    host.mem_total_bytes !== null && host.mem_available_bytes !== null
      ? host.mem_total_bytes - host.mem_available_bytes
      : null;
  const swapUsed =
    host.swap_total_bytes !== null && host.swap_free_bytes !== null
      ? host.swap_total_bytes - host.swap_free_bytes
      : null;
  const load = (value: number | null) => (value === null ? "—" : value.toFixed(2));

  return (
    <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
      <Stat
        label="Memory"
        value={formatPercent(memUsed, host.mem_total_bytes)}
        share={share(memUsed, host.mem_total_bytes)}
        hint={`${formatBytes(memUsed)} of ${formatBytes(host.mem_total_bytes)} · page cache excluded`}
      />
      <Stat
        label="Disk"
        value={formatPercent(host.disk_used_bytes, host.disk_total_bytes)}
        share={share(host.disk_used_bytes, host.disk_total_bytes)}
        hint={`${formatBytes(host.disk_used_bytes)} of ${formatBytes(host.disk_total_bytes)}`}
      />
      <Stat
        label="Swap"
        value={host.swap_total_bytes ? formatBytes(swapUsed) : "no swap"}
        hint={host.swap_total_bytes ? formatPercent(swapUsed, host.swap_total_bytes) : ""}
      />
      <Stat
        label="Load"
        value={load(host.load_1m)}
        hint={`${load(host.load_5m)} / ${load(host.load_15m)}${
          host.cpu_count ? ` on ${host.cpu_count} CPUs` : ""
        } (1 / 5 / 15m)`}
      />
      <Stat
        label="Uptime"
        value={formatDuration(host.uptime_seconds)}
        hint={`host snapshot ${formatAge(capturedAt)}`}
      />
    </dl>
  );
}

function share(part: number | null, whole: number | null): number | undefined {
  return part === null || whole === null || whole <= 0 ? undefined : part / whole;
}

/** What a container is doing, when that is anything other than plainly running. */
function containerState(container: ContainerStats): string | null {
  if (container.oom_killed) return "OOM killed";
  const parts = [
    container.status === "running" ? null : (container.status ?? "unknown"),
    container.status === "exited" ? `(${container.exit_code})` : null,
    container.health && container.health !== "healthy" ? container.health : null,
  ].filter(Boolean);
  return parts.length === 0 ? null : parts.join(" ");
}

function ContainersTable({ containers }: { containers: ContainerStats[] }) {
  if (containers.length === 0) {
    return <p className="text-sm text-muted-foreground">No containers reported.</p>;
  }
  return (
    <AdminTable>
      <TableHeader>
        <TableRow>
          <TableHead>Container</TableHead>
          <TableHead>Memory of limit</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">PIDs</TableHead>
          <TableHead className="text-right">Restarts</TableHead>
          <TableHead className="text-right">Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {containers.map((container) => {
          const level = containerLevel(container);
          const state = containerState(container);
          const used = share(container.mem_used_bytes, container.mem_limit_bytes);
          return (
            <TableRow key={container.name}>
              <TableCell>
                <span className="inline-flex items-center gap-2.5 font-mono">
                  <StatusDot level={level} />
                  {container.service ?? container.name}
                  {container.oneoff ? <span className="font-sans text-ink-3">(job)</span> : null}
                </span>
                {state ? (
                  <span className={cn("ml-3 text-xs", LEVEL_TEXT[level])}>{state}</span>
                ) : null}
              </TableCell>
              <TableCell className="w-1/2">
                <div className="flex items-center gap-4">
                  {used === undefined ? null : (
                    <Meter
                      value={used}
                      label={`${container.service ?? container.name} memory`}
                      className="w-1/2 max-w-64"
                    />
                  )}
                  <span className="text-ink-2">
                    {formatBytes(container.mem_used_bytes)} /{" "}
                    {formatBytes(container.mem_limit_bytes)} ·{" "}
                    {formatPercent(container.mem_used_bytes, container.mem_limit_bytes)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                {container.cpu_percent === null ? "—" : `${container.cpu_percent.toFixed(1)}%`}
              </TableCell>
              <TableCell className="text-right">{container.pids ?? "—"}</TableCell>
              <TableCell className="text-right">{container.restart_count}</TableCell>
              <TableCell className="text-right text-ink-2">
                {formatAge(container.started_at)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </AdminTable>
  );
}

function Connections({ connections }: { connections: ServiceConnections[] }) {
  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Caddy or MCP container is running on this stack.
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-rule border-b border-rule">
        {connections.map((service) => (
          <li key={service.service} className="space-y-1 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <p>
                {SERVICE_LABEL[service.service] ?? service.service}
                <span className="text-ink-3"> :{service.ports.join(", :")}</span>
              </p>
              <p className="text-ink-2">
                {formatCount(service.established)} open · {formatCount(service.distinct_peers)}{" "}
                clients
              </p>
            </div>
            {service.top_peers.length === 0 ? null : (
              <p className="type-caption">
                {service.top_peers
                  .slice(0, 5)
                  .map((peer) => `${peer.address} ×${peer.connections}`)
                  .join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="type-caption">
        Open TCP connections at snapshot time. MCP only ever sees Caddy, so its count is open MCP
        streams, not distinct users. HTTP/3 (UDP) visitors are not counted.
      </p>
    </>
  );
}

function PostgresConnections({ database }: { database: DatabaseDiagnostics }) {
  const external = database.connections
    .filter((group) => group.is_external)
    .reduce((sum, group) => sum + group.connections, 0);
  const level = databaseLevel(database);

  return (
    <>
      {level === "ok" ? null : <Status level={level} className="text-sm" />}
      <ul className="divide-y divide-rule border-b border-rule">
        {database.connections.length === 0 ? (
          <li className="py-3 text-ink-2">No other connections.</li>
        ) : (
          database.connections.map((group) => (
            <li
              key={`${group.application_name}-${group.user_name}-${group.client_addr}-${group.state}`}
              className="grid grid-cols-[1fr_auto_3rem_5rem] items-baseline gap-4 py-3"
            >
              <p className="min-w-0 truncate">
                {group.application_name || "(unnamed)"}
                <span className="text-ink-3">
                  {" "}
                  {group.user_name ?? "—"} · {group.client_addr ?? "local socket"}
                </span>
                {group.is_external ? <span className="text-warn"> external</span> : null}
              </p>
              <p className="text-ink-2">
                {group.state}
                {group.longest_active_seconds === null
                  ? null
                  : ` · ${formatDuration(group.longest_active_seconds)}`}
              </p>
              <p className="text-right">{group.connections}</p>
              <p className="text-right text-ink-2">{formatAge(group.oldest_connected_at)}</p>
            </li>
          ))
        )}
        <li className="flex items-baseline justify-between gap-4 py-3">
          <p>External connections</p>
          <p className={external === 0 ? "text-primary" : "text-warn"}>
            {external === 0 ? "None" : external}
          </p>
        </li>
      </ul>
      <p className="type-caption">
        External means outside the container network (e.g. DBeaver over the public IP); expected
        only while you are connected.
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  share: used,
}: {
  label: string;
  value: string;
  hint?: string;
  share?: number;
}) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="type-stat mt-1">{value}</dd>
      {used === undefined ? null : <Meter value={used} label={label} className="mt-2" />}
      {hint ? <dd className="mt-2 text-sm text-ink-2">{hint}</dd> : null}
    </div>
  );
}
