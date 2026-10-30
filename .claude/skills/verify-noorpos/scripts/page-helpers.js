/*
 * Loaded before every `drive.mjs eval` in the app window, as window.$v.
 * They act like a user (clicks, typing, keys) through the same DOM the
 * smoke test uses, never through internal state.
 */
window.$v =
  window.$v ||
  (() => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const exists = (id) => Boolean(document.getElementById(id));
    const text = (sel) => ($(sel) ? $(sel).textContent.replace(/\s+/g, ' ').trim() : '');

    async function waitFor(label, predicate, timeout = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (predicate()) return true;
        await sleep(50);
      }
      throw new Error(`Timed out waiting for: ${label}`);
    }

    /** Set a React-controlled field the way typing does. */
    function type(el, value) {
      if (typeof el === 'string') el = $(el);
      if (!el) throw new Error('field not found');
      const proto =
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    }

    const key = (target, k, extra = {}) =>
      (typeof target === 'string' ? $(target) : target).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

    function click(target) {
      const el = typeof target === 'string' ? $(target) : target;
      if (!el) throw new Error(`nothing to click: ${target}`);
      el.click();
    }

    /** A button (or link) whose visible text starts with `label`, inside `scope`. */
    function button(label, scope = document) {
      const root = typeof scope === 'string' ? $(scope) : scope;
      return $$('button, a, [role="button"]', root).find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith(label)) || null;
    }

    async function typePin(pin) {
      await waitFor('lock screen', () => exists('modalPinAuth'));
      for (const digit of pin) click(`.pin-key[data-key="${digit}"]`);
      await sleep(30);
      click('#btnPinSubmit');
    }

    /** Unlock; on a fresh install 1234 forces a change to `newPin`. */
    async function login(pin = '1234', newPin = '7391') {
      await typePin(pin);
      await waitFor('unlocked or PIN change', () => exists('modalChangePin') || !exists('modalPinAuth'));
      if (exists('modalChangePin')) {
        type('#changePinForm [name="currentPin"]', pin);
        type('#changePinForm [name="newPin"]', newPin);
        type('#changePinForm [name="confirmPin"]', newPin);
        $('#changePinForm').requestSubmit();
        await waitFor('PIN changed', () => !exists('modalChangePin'));
      }
      await waitFor('main screen', () => exists('posView'));
      await sleep(800); // unlocking finishes loading, then returns to Sell
      return true;
    }

    /** Open a screen: its section in the side bar, then its tab when the section has several screens. */
    async function nav(view) {
      const item = $$('.nav-item[data-views]').find((el) => el.dataset.views.split(' ').includes(view));
      if (!item) throw new Error(`no menu section opens ${view} (role without access?)`);
      item.click();
      if (item.dataset.target !== view) {
        await waitFor(`${view} tab`, () => $(`[data-tab="${view}"]`));
        click(`[data-tab="${view}"]`);
      }
      await waitFor(view, () => exists(view));
      await sleep(200);
    }

    function closeDialogs() {
      for (const close of $$('[data-modal-overlay] button[aria-label="Close"]')) close.click();
    }

    /** Elements wider than the window (a layout bug at this size). */
    function overflowing() {
      const w = document.documentElement.clientWidth;
      return $$('body *')
        .filter((el) => el.getBoundingClientRect().right > w + 1 && el.offsetParent !== null)
        .slice(0, 10)
        .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
    }

    return { sleep, $, $$, exists, text, waitFor, type, key, click, button, typePin, login, nav, closeDialogs, overflowing };
  })();
