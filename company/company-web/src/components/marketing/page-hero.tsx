export function PageHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-border bg-surface">
      <div className="glow-primary pointer-events-none absolute inset-x-0 top-0 h-64 opacity-70" aria-hidden />
      <div className="container-page relative py-16 text-center sm:py-20">
        {eyebrow ? (
          <p className="mb-3 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {description ? (
          <p className="mx-auto mt-4 max-w-2xl text-base text-pretty text-muted-foreground">{description}</p>
        ) : null}
        {children ? <div className="mt-8 flex flex-wrap justify-center gap-3">{children}</div> : null}
      </div>
    </section>
  );
}
