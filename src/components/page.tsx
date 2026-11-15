import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">{title}</h1>
      {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-6 py-16 text-center">
      <div className="mb-4 grid size-10 place-items-center rounded-lg bg-zinc-900 text-zinc-400">
        <Icon className="size-5" />
      </div>
      <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>
    </div>
  );
}
