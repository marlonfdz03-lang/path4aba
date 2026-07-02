/**
 * Path4ABA Form Engine — Angular Material DOM helpers (MAIN world)
 *
 * Provides window.setMatInput and window.selectMatOption for the Executor. These are ported
 * from abamatrix-autofill.js, which declares them as LOCAL functions (not on window) and runs
 * in the ISOLATED world — so the MAIN-world Executor cannot reach them there. This module
 * exposes them on the MAIN-world window. In the MAIN world the Angular expando __ngContext__
 * is also visible, so setMatInput can drive the control's onChange accessor directly.
 *
 * Exposes: window.setMatInput(el, value), window.selectMatOption(selectEl, value)
 */
(function () {
  'use strict';
  // Always overwrite on (re)injection — no idempotency guard (matches the engine modules).
  window.__FormEngine_v = (window.__FormEngine_v || 0) + 1;

  function waitMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function setMatInput(el, value) {
    if (!el) return;
    // Try Angular's onChange accessor first (visible in the MAIN world).
    const ctx = el.__ngContext__;
    if (ctx && Array.isArray(ctx)) {
      for (let i = 0; i < ctx.length; i++) {
        const item = ctx[i];
        if (item && typeof item === 'object' && typeof item.onChange === 'function' && item._elementRef) {
          el.value = value;
          item.onChange(value);
          if (typeof item.onTouched === 'function') item.onTouched();
          return;
        }
      }
    }
    // Fallback: native setter + events.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) { nativeSetter.call(el, value); } else { el.value = value; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function selectMatOption(selectEl, value) {
    if (!selectEl || !value) return;
    selectEl.click();
    await waitMs(500);
    const options = document.querySelectorAll('mat-option');
    if (!options.length) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitMs(200);
      return;
    }

    const valueLower = String(value).toLowerCase().trim();

    let match = Array.from(options).find(function (opt) {
      return opt.innerText && opt.innerText.trim().toLowerCase() === valueLower;
    });
    if (!match) {
      match = Array.from(options).find(function (opt) {
        const o = opt.innerText ? opt.innerText.trim().toLowerCase() : '';
        return o.includes(valueLower) || valueLower.includes(o);
      });
    }
    if (!match) {
      const words = valueLower.split(' ').filter(function (w) { return w.length > 3; });
      match = Array.from(options).find(function (opt) {
        const o = opt.innerText ? opt.innerText.trim().toLowerCase() : '';
        return words.length > 0 && words.every(function (w) { return o.includes(w); });
      });
    }

    if (match) {
      match.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    await waitMs(400);

    // Close the dropdown — focus select, send Escape, click the CDK backdrop.
    selectEl.focus();
    selectEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await waitMs(150);
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) {
      backdrop.click();
    } else {
      document.documentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await waitMs(200);
  }

  window.setMatInput = setMatInput;
  window.selectMatOption = selectMatOption;
})();
