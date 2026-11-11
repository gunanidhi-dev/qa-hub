// UI scoping only: static hosting cannot keep the underlying JSON private.
export const isAdmin = (store) => store.actor()?.active !== false && store.actor()?.role === 'Admin';

export function assignedStore(store) {
  const visible = (c) => !!store.actor() && store.actor().active !== false && (isAdmin(store) || c?.assignedTo === store.actor().id);
  return new Proxy(store, {
    get(target, key) {
      if (key === 'data') {
        if (isAdmin(store)) return target.data;
        const testCases = target.data.testCases.filter(visible);
        const ids = new Set(testCases.map((c) => c.id));
        const modules = new Set(testCases.map((c) => c.moduleId));
        return { ...target.data, testCases,
          modules: target.data.modules.filter((m) => modules.has(m.id)),
          features: target.data.features.filter((f) => modules.has(f.moduleId)),
          activity: target.data.activity.filter((e) => ids.has(e.entityId)),
          deletedItems: [], testRuns: [] };
      }
      if (key === 'get') return (collection, id) => {
        const record = target.get(collection, id);
        return collection === 'testCases' && !visible(record) ? null : record;
      };
      if (key === 'activeCases') return () => target.activeCases().filter(visible);
      if (key === 'can') return (permission) => {
        if (permission === 'case.create') return isAdmin(store) && target.can('case.edit');
        if (!isAdmin(store) && !['case.edit', 'case.bulk'].includes(permission)) return false;
        return target.can(permission);
      };
      if (['updateCase', 'softDeleteCases', 'bulkUpdateCases', 'reviewCase', 'restoreCase', 'purgeCase'].includes(key)) {
        return async (idOrIds, ...args) => {
          const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
          if (!ids.every((id) => visible(target.get('testCases', id)))) throw new Error('You can only change cases assigned to you.');
          return target[key](idOrIds, ...args);
        };
      }
      return target[key];
    },
  });
}

export function developerProgress(store) {
  const cases = store.activeCases();
  const rows = store.data.members.filter((m) => m.active !== false || cases.some((c) => c.assignedTo === m.id))
    .map((m) => ({ id: m.id, name: m.displayName, active: m.active !== false }));
  rows.push({ id: '', name: 'Unassigned', active: true });
  return rows.map((row) => {
    const assigned = cases.filter((c) => (c.assignedTo || '') === row.id);
    const completed = assigned.filter((c) => c.completionStatus === 'Completed').length;
    return { ...row, total: assigned.length, completed, pending: assigned.length - completed,
      percent: assigned.length ? Math.round(completed / assigned.length * 100) : 0 };
  });
}
