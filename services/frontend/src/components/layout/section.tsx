export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="type-module border-b border-rule pb-1">{title}</h2>
      <div className="type-prose mt-3">{children}</div>
    </section>
  );
}
