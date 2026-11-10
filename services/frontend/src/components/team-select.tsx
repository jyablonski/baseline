import { cn } from "@/lib/utils";

/** "All teams" or one abbreviation; highlighted while a team is picked. */
export function TeamSelect({
  team,
  teams,
  setTeam,
}: {
  team: string;
  teams: string[];
  setTeam: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-2">
      Team
      <select
        className={cn("field px-1.5", team && "field-query")}
        value={team}
        onChange={(event) => setTeam(event.target.value)}
      >
        <option value="">All teams</option>
        {teams.map((abbreviation) => (
          <option key={abbreviation} value={abbreviation}>
            {abbreviation}
          </option>
        ))}
      </select>
    </label>
  );
}
