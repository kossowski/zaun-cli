export interface HasDeps {
  id: string;
  deps?: string[];
}

export interface Plan<M extends HasDeps> {
  /** Modules to run, dependencies first. */
  ordered: M[];
  /** Ids that were not selected but are needed by something that was. */
  added: string[];
}

export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyError';
  }
}

/**
 * Depth-first topological sort. Ties keep the order of `all` (the registry),
 * so the plan reads the same way as the menu.
 */
export function resolvePlan<M extends HasDeps>(selected: string[], all: M[]): Plan<M> {
  const byId = new Map(all.map((m) => [m.id, m]));
  for (const id of selected) {
    if (!byId.has(id)) throw new DependencyError(`Unknown module "${id}".`);
  }

  // 1. Collect the closure of the selection (selected + transitive deps).
  const wanted = new Set<string>();
  const collect = (id: string, from: string | null) => {
    const mod = byId.get(id);
    if (!mod) throw new DependencyError(`Module "${from}" depends on unknown module "${id}".`);
    if (wanted.has(id)) return;
    wanted.add(id);
    for (const dep of mod.deps ?? []) collect(dep, id);
  };
  for (const id of selected) collect(id, null);

  // 2. Visit in registry order; emit a module after all of its deps.
  const ordered: M[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.includes(id)) {
      const cycle = [...visiting.slice(visiting.indexOf(id)), id].join(' → ');
      throw new DependencyError(`Dependency cycle: ${cycle}`);
    }
    visiting.push(id);
    const mod = byId.get(id)!;
    for (const dep of mod.deps ?? []) visit(dep);
    visiting.pop();
    done.add(id);
    ordered.push(mod);
  };
  for (const mod of all) if (wanted.has(mod.id)) visit(mod.id);

  const chosen = new Set(selected);
  return { ordered, added: ordered.map((m) => m.id).filter((id) => !chosen.has(id)) };
}
