const COLLAPSE_STORAGE_KEY = 'disc-array-tool-collapsed';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (raw) return new Set<string>(JSON.parse(raw));
  } catch { /* ignore corrupt data */ }
  return new Set();
}

function saveCollapsed(set: Set<string>) {
  localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...set]));
}

/**
 * Header markup shared by every collapsible panel. `title` is the panel name;
 * `enableCheckbox` is optional inner HTML (e.g. an enable checkbox) rendered
 * beside the title. The checkbox is intentionally separate from the collapse
 * affordance so toggling "enabled" never collapses the panel and vice-versa.
 */
export function collapsibleHeader(title: string, enableCheckbox = ''): string {
  return `
    <h3 class="panel-header" data-collapse-toggle>
      <span class="collapse-chevron" aria-hidden="true">▸</span>
      ${enableCheckbox}
      <span class="panel-title">${title}</span>
    </h3>
  `;
}

/**
 * Wire a panel's header to collapse/expand its body, persisting the state per
 * `key`. The root must contain a `[data-collapse-toggle]` header and a
 * `[data-collapse-body]` body. Clicks on inputs/labels inside the header (the
 * enable checkbox) are ignored, keeping collapse independent of enabled state.
 */
export function makeCollapsible(root: HTMLElement, key: string) {
  const header = root.querySelector<HTMLElement>('[data-collapse-toggle]');
  const body = root.querySelector<HTMLElement>('[data-collapse-body]');
  if (!header || !body) return;

  const apply = (collapsed: boolean) => {
    root.classList.toggle('collapsed', collapsed);
    body.style.display = collapsed ? 'none' : '';
  };
  apply(loadCollapsed().has(key));

  header.addEventListener('click', (e) => {
    // Let the enable checkbox (and its label) toggle without collapsing.
    if ((e.target as HTMLElement).closest('input, label')) return;
    const set = loadCollapsed();
    const collapsed = !set.has(key);
    if (collapsed) set.add(key); else set.delete(key);
    saveCollapsed(set);
    apply(collapsed);
  });
}
