import { Badge } from "@/components/ui/badge";
import type { DbtStatus } from "@/lib/admin";
import { formatAge } from "@/lib/admin-status";

/** scripts/dbt-build.sh records at most this many failed nodes per build. */
export const DBT_FAILED_NODES_CAP = 25;

/** Pass/fail of the most recent dbt build, and what broke if it failed. */
export function DbtBuildStatus({ dbt }: { dbt: DbtStatus }) {
  if (dbt.last_dbt_exit === null) {
    return <p className="text-sm text-muted-foreground">No dbt build recorded yet.</p>;
  }

  const when = [
    dbt.last_dbt_run_id === null ? null : `run #${dbt.last_dbt_run_id}`,
    formatAge(dbt.last_dbt_run_at),
  ]
    .filter(Boolean)
    .join(" · ");

  if (dbt.last_dbt_exit === 0) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <Badge variant="default">Succeeded</Badge>
        <span className="text-muted-foreground">Last build passed · {when}</span>
      </div>
    );
  }

  const nodes = dbt.last_dbt_failed_nodes ?? [];
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <Badge variant="destructive">Failed · exit {dbt.last_dbt_exit}</Badge>
        <span className="text-muted-foreground">{when}</span>
      </div>
      {nodes.length === 0 ? (
        <p className="text-muted-foreground">
          dbt stopped before naming a failing model or test (a parse or connection error). The
          refresh log has the full output.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground">
            {nodes.length >= DBT_FAILED_NODES_CAP
              ? `First ${DBT_FAILED_NODES_CAP} failures; the refresh log has the rest.`
              : `${nodes.length} ${nodes.length === 1 ? "node" : "nodes"} failed.`}{" "}
            Downstream models were skipped.
          </p>
          <ul className="space-y-1 font-mono text-xs break-all">
            {nodes.map((node) => (
              <li key={node}>{node}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
