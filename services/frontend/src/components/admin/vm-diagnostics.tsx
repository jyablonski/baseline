import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AdminTable } from "@/components/admin/admin-table";
import type { ContainerStats, Diagnostics, HostStats, ServiceConnections } from "@/lib/admin";
import {
  LEVEL_BADGE,
  LEVEL_LABEL,
  containerLevel,
  databaseLevel,
  formatAge,
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  isSnapshotStale,
  vmLevel,
} from "@/lib/admin-status";

const SERVICE_LABEL: Record<string, string> = {
  caddy: "Site (Caddy)",
  mcp: "MCP",
};

/** VM, container, and connection health from the host snapshot plus live Postgres. */
export function VmDiagnostics({ diagnostics }: { diagnostics: Diagnostics }) {
  const { snapshot, database } = diagnostics;
  const level = vmLevel(diagnostics);
  const stale = snapshot !== null && isSnapshotStale(snapshot);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>VM health</CardTitle>
        <Badge variant={LEVEL_BADGE[level]}>{LEVEL_LABEL[level]}</Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        {snapshot === null ? (
          <p className="text-sm text-muted-foreground">
            No host snapshot yet. The admin-jobs cron records one every minute via{" "}
            <code>scripts/host-snapshot.py</code>.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Host snapshot {formatAge(snapshot.captured_at)}
              {stale
                ? " — stale: the admin-jobs cron, python3, or Docker on the host has stopped reporting."
                : "."}
            </p>
            {snapshot.host ? <HostFields host={snapshot.host} /> : null}
            {snapshot.errors.length > 0 ? (
              <ul className="space-y-1 text-xs text-destructive">
                {snapshot.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            <Section title="Containers">
              <ContainersTable containers={snapshot.containers} />
            </Section>
            <Section title="Inbound connections">
              <ConnectionsTable connections={snapshot.connections} />
            </Section>
          </>
        )}

        <Section title="Postgres connections" level={databaseLevel(database)}>
          <p className="text-xs text-muted-foreground">
            {database.total_connections} of {database.max_connections} connections · database{" "}
            {formatBytes(database.database_size_bytes)}. External means outside the container
            network (e.g. DBeaver over the public IP); expected only while you are connected.
          </p>
          {database.connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other connections.</p>
          ) : (
            <AdminTable>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Connected</TableHead>
                  <TableHead className="text-right">Longest active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {database.connections.map((group) => (
                  <TableRow
                    key={`${group.application_name}-${group.user_name}-${group.client_addr}-${group.state}`}
                  >
                    <TableCell className="font-medium">{group.application_name}</TableCell>
                    <TableCell>{group.user_name ?? "—"}</TableCell>
                    <TableCell className="space-x-2">
                      <span className="tabular-nums">{group.client_addr ?? "local socket"}</span>
                      {group.is_external ? <Badge variant="secondary">external</Badge> : null}
                    </TableCell>
                    <TableCell>{group.state}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.connections}</TableCell>
                    <TableCell>{formatAge(group.oldest_connected_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(group.longest_active_seconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </AdminTable>
          )}
        </Section>
      </CardContent>
    </Card>
  );
}

function HostFields({ host }: { host: HostStats }) {
  const memUsed =
    host.mem_total_bytes !== null && host.mem_available_bytes !== null
      ? host.mem_total_bytes - host.mem_available_bytes
      : null;
  const swapUsed =
    host.swap_total_bytes !== null && host.swap_free_bytes !== null
      ? host.swap_total_bytes - host.swap_free_bytes
      : null;
  const load =
    host.load_1m === null
      ? "—"
      : `${[host.load_1m, host.load_5m, host.load_15m]
          .map((value) => (value === null ? "—" : value.toFixed(2)))
          .join(" / ")}${host.cpu_count ? ` on ${host.cpu_count} CPUs` : ""}`;

  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
      <Stat
        label="Memory used"
        value={`${formatBytes(memUsed)} of ${formatBytes(host.mem_total_bytes)}`}
        hint={`${formatPercent(memUsed, host.mem_total_bytes)} · page cache excluded`}
      />
      <Stat
        label="Swap used"
        value={host.swap_total_bytes ? formatBytes(swapUsed) : "no swap"}
        hint={host.swap_total_bytes ? formatPercent(swapUsed, host.swap_total_bytes) : ""}
      />
      <Stat
        label="Disk used"
        value={`${formatBytes(host.disk_used_bytes)} of ${formatBytes(host.disk_total_bytes)}`}
        hint={formatPercent(host.disk_used_bytes, host.disk_total_bytes)}
      />
      <Stat label="Load (1 / 5 / 15m)" value={load} />
      <Stat label="Uptime" value={formatDuration(host.uptime_seconds)} />
    </dl>
  );
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
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Memory</TableHead>
          <TableHead className="text-right">of limit</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">PIDs</TableHead>
          <TableHead className="text-right">Restarts</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {containers.map((container) => (
          <TableRow key={container.name}>
            <TableCell className="font-medium">
              {container.service ?? container.name}
              {container.oneoff ? <span className="text-muted-foreground"> (job)</span> : null}
            </TableCell>
            <TableCell>
              <Badge variant={LEVEL_BADGE[containerLevel(container)]}>
                {container.oom_killed
                  ? "OOM killed"
                  : [
                      container.status ?? "unknown",
                      container.status === "exited" ? `(${container.exit_code})` : null,
                      container.health && container.health !== "healthy" ? container.health : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatBytes(container.mem_used_bytes)} / {formatBytes(container.mem_limit_bytes)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPercent(container.mem_used_bytes, container.mem_limit_bytes)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {container.cpu_percent === null ? "—" : `${container.cpu_percent.toFixed(1)}%`}
            </TableCell>
            <TableCell className="text-right tabular-nums">{container.pids ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{container.restart_count}</TableCell>
            <TableCell>{formatAge(container.started_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </AdminTable>
  );
}

function ConnectionsTable({ connections }: { connections: ServiceConnections[] }) {
  if (connections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Caddy or MCP container is running on this stack.
      </p>
    );
  }
  return (
    <>
      <AdminTable>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead className="text-right">Open</TableHead>
            <TableHead className="text-right">Clients</TableHead>
            <TableHead>Busiest clients</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.map((service) => (
            <TableRow key={service.service}>
              <TableCell className="font-medium">
                {SERVICE_LABEL[service.service] ?? service.service}
                <span className="text-muted-foreground"> :{service.ports.join(", :")}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(service.established)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(service.distinct_peers)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {service.top_peers.length === 0
                  ? "—"
                  : service.top_peers
                      .slice(0, 5)
                      .map((peer) => `${peer.address} ×${peer.connections}`)
                      .join(", ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </AdminTable>
      <p className="text-xs text-muted-foreground">
        Open TCP connections at snapshot time. MCP only ever sees Caddy, so its count is open MCP
        streams, not distinct users. HTTP/3 (UDP) visitors are not counted.
      </p>
    </>
  );
}

function Section({
  title,
  level,
  children,
}: {
  title: string;
  level?: keyof typeof LEVEL_BADGE;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {level && level !== "ok" && level !== "idle" ? (
          <Badge variant={LEVEL_BADGE[level]}>{LEVEL_LABEL[level]}</Badge>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
