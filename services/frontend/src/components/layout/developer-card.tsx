/** The developer's avatar, name and profile links, shared by /about and /data. */
export function DeveloperCard() {
  return (
    <div className="flex items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo/profile.png"
        alt="Jacob Yablonski"
        width={72}
        height={72}
        className="h-18 w-18 rounded-full border border-rule object-cover"
      />
      <div>
        <p className="font-medium text-foreground">Jacob Yablonski</p>
        <p className="mt-1 flex gap-3">
          <a
            className="underline underline-offset-2"
            href="https://github.com/jyablonski"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a
            className="underline underline-offset-2"
            href="https://www.linkedin.com/in/jacobyablonski/"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
        </p>
      </div>
    </div>
  );
}
