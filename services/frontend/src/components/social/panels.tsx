"use client";

import { formatCount } from "@/lib/social";
import type { SocialEntity, SocialFanbase, SocialLeader } from "@/lib/types";

export function Panel({
  title,
  meta,
  note,
  children,
}: {
  title: string;
  meta?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-rule bg-raised">
      <div className="flex items-baseline justify-between gap-2 border-b border-rule-strong px-[var(--ct-space-3)] py-[var(--ct-space-2)]">
        <h2 className="type-module">{title}</h2>
        {meta ? <span className="type-eyebrow">{meta}</span> : null}
      </div>
      <div className="px-[var(--ct-space-3)] py-[var(--ct-space-3)]">{children}</div>
      {note ? (
        <p className="type-caption border-t border-rule-soft px-[var(--ct-space-3)] py-2">{note}</p>
      ) : null}
    </section>
  );
}

export function EntityBoard({
  rows,
  unit,
  emptyMessage,
}: {
  rows: SocialEntity[];
  unit: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) return <Empty message={emptyMessage} />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{unit}</th>
          <th className="text-right">Posts</th>
          <th className="text-right">Cmts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.entity_id}>
            <td>
              <span className="inline-flex items-center gap-2">
                {row.primary_color ? (
                  <span
                    aria-hidden
                    className="inline-block h-[13px] w-[3px] shrink-0"
                    style={{ backgroundColor: row.primary_color }}
                  />
                ) : null}
                {/* Teams show the nickname, like the fanbase board; players have none. */}
                <span title={row.entity_name}>{row.entity_nickname ?? row.entity_name}</span>
              </span>
            </td>
            <td className="tabular text-right">{row.post_count}</td>
            <td className="tabular text-right">{row.comment_count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FanbaseBoard({ rows }: { rows: SocialFanbase[] }) {
  if (rows.length === 0) {
    return <Empty message="No user flair collected in this range yet." />;
  }
  const max = Math.max(...rows.map((row) => row.document_count), 1);
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={`${row.flair_scope}-${row.label}`} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[var(--ct-fs-cell)]" title={row.label}>
            {row.flair_team_nickname ?? row.label}
          </span>
          <span className="tabular w-9 text-right text-[var(--ct-fs-num)]">
            {row.document_count}
          </span>
          <span aria-hidden className="h-[11px] w-[64px] shrink-0 bg-tint">
            <span
              className="block h-full"
              style={{
                width: `${Math.max((row.document_count / max) * 100, 4)}%`,
                backgroundColor: row.primary_color ?? "var(--ct-ink-3)",
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LeaderBoard({
  rows,
  unit,
  emptyMessage,
}: {
  rows: SocialLeader[];
  unit: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) return <Empty message={emptyMessage} />;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{unit}</th>
          <th className="text-right">Posts</th>
          <th className="text-right">Total score</th>
          <th className="text-right">Median</th>
          <th className="text-right">Median cmts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>{row.key}</td>
            <td className="tabular text-right">{row.post_count}</td>
            <td className="tabular text-right">{formatCount(row.total_score)}</td>
            <td className="tabular text-right">{formatCount(row.median_score)}</td>
            <td className="tabular text-right">{formatCount(row.median_comments)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="type-caption py-2">{message}</p>;
}
