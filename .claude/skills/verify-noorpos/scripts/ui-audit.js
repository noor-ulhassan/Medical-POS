// Per-screen simplicity numbers for the current UI, run through `drive.mjs eval`.
// Logs in on a fresh instance if needed, visits every screen the admin can open,
// and measures what a person faces there. Returns { screens: [...] }.
//
//   node .claude/skills/verify-noorpos/scripts/drive.mjs eval .claude/skills/verify-noorpos/scripts/ui-audit.js
//
// controls: visible buttons, links, fields and menu items (main area and menu counted apart)
// actions:  their visible labels (or aria-label), to check nothing is lost in a redesign
// words:    visible words, a rough measure of how much there is to read
// smallText: share of visible text under 14px; minFont: smallest visible font size
// hints:    visible keyboard chips (<kbd>); wide: elements spilling past the window
if (document.getElementById('modalPinAuth')) await $v.login();
$v.closeDialogs();

const visible = (el) => {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};
const label = (el) =>
  (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.tagName)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);

function measure(root) {
  const controls = [...root.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="option"]')].filter(visible);
  const textNodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.trim() && node.parentElement && visible(node.parentElement)) textNodes.push(node);
  }
  const sizes = textNodes.map((n) => parseFloat(getComputedStyle(n.parentElement).fontSize));
  const words = textNodes.reduce((sum, n) => sum + n.textContent.trim().split(/\s+/).length, 0);
  return {
    controls: controls.length,
    actions: [...new Set(controls.map(label))],
    words,
    minFont: sizes.length ? Math.min(...sizes) : null,
    smallText: sizes.length ? Math.round((sizes.filter((s) => s < 14).length / sizes.length) * 100) : 0,
    hints: [...root.querySelectorAll('kbd')].filter(visible).length
  };
}

// Every screen: from the side bar's sections (data-views), or one menu item per screen in older builds.
const items = [...document.querySelectorAll('.nav-item[data-target]')];
const views = [...new Set(items.flatMap((el) => (el.dataset.views ? el.dataset.views.split(' ') : [el.dataset.target])))];
const menu = document.querySelector('nav') || document.querySelector('aside');
const screens = [];
for (const view of views) {
  await $v.nav(view);
  await $v.sleep(400);
  const main = document.getElementById(view);
  screens.push({ view, ...measure(main), wide: $v.overflowing() });
}
await $v.nav(views[0]);
return { menuItems: items.length, menu: menu ? measure(menu) : null, screens };
