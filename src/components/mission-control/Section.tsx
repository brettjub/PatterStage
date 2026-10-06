// ═══════════════════════════════════════════════════════════════
// Section — labelled, focusable landmark for jump-link targets
// ═══════════════════════════════════════════════════════════════

interface SectionProps {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  children: React.ReactNode;
}

export default function Section({ id, title, icon: Icon, description, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      tabIndex={-1}
      className="scroll-mt-4 rounded-xl border border-white/10 bg-dark-900/50 p-4 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/60"
    >
      <h2
        id={`${id}-heading`}
        className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white"
      >
        <Icon className="w-4 h-4 text-neon-cyan shrink-0" aria-hidden="true" />
        {title}
      </h2>
      {description && <p className="mt-1 text-xs text-white/60">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
