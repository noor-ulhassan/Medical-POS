import { useCallback, useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { Button } from '../../ui/Button.jsx';
import { cx } from '../../ui/cx.js';

const MAX_PIN = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'BACK'];

/** Full-screen PIN entry. Nothing from the store is visible while locked. */
export function LockScreen({ onSession }) {
  const { settings, appInfo } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const busy = useRef(false);

  const press = useCallback((key) => {
    setError('');
    setPin((p) => {
      if (key === 'CLEAR') return '';
      if (key === 'BACK') return p.slice(0, -1);
      return /^\d$/.test(key) && p.length < MAX_PIN ? p + key : p;
    });
  }, []);

  const submit = useCallback(async () => {
    if (busy.current || pin.length < 4) return;
    busy.current = true;
    try {
      const user = await call('auth.login', { pin });
      setPin('');
      await onSession(user);
    } catch (err) {
      setPin('');
      setError(err.message);
      setShakeKey((k) => k + 1);
    } finally {
      busy.current = false;
    }
  }, [pin, onSession]);

  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('[data-modal-overlay]')) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('BACK');
      else if (e.key === 'Delete' || e.key === 'Escape') press('CLEAR');
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [press, submit]);

  return (
    <div id="modalPinAuth" className="flex h-full items-center justify-center bg-paper p-6" role="dialog" aria-modal="true" aria-labelledby="pinStoreName">
      <div className="w-full max-w-[360px] rounded-dialog border border-foil bg-surface px-8 pb-7 pt-8 shadow-dialog">
        <div className="flex flex-col items-center text-center">
          <img src="./icon.png" alt="" className="size-14 rounded-xl" />
          <h1 id="pinStoreName" className="mt-4 text-xl font-bold text-ink">
            {settings.store_name || 'MediDesk POS'}
          </h1>
          <p className="mt-1 text-base text-ink-2">Enter your PIN to start</p>
        </div>

        <div key={shakeKey} className={cx('mt-6 flex h-4 justify-center gap-3', shakeKey > 0 && 'animate-shake')} id="pinDots" aria-live="polite" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span
              key={i}
              className={cx('size-3.5 rounded-full border-2 transition-colors', i < pin.length ? 'border-teal bg-teal' : 'border-foil-strong')}
            />
          ))}
        </div>
        <p id="pinError" role="alert" className="mt-3 min-h-[20px] text-center text-sm font-semibold text-red-ink">
          {error}
        </p>

        <div className="mt-2 grid grid-cols-3 gap-2.5">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              data-key={key}
              onClick={() => press(key)}
              aria-label={key === 'BACK' ? 'Delete last digit' : key === 'CLEAR' ? 'Clear' : key}
              className={cx(
                'pin-key num flex h-14 items-center justify-center rounded-panel border border-foil font-semibold transition-colors active:bg-teal-soft',
                key.length === 1 ? 'bg-surface text-xl text-ink hover:bg-sunken' : 'bg-sunken text-sm text-ink-2 hover:text-ink'
              )}
            >
              {key === 'BACK' ? <Delete className="size-5" aria-hidden="true" /> : key === 'CLEAR' ? 'Clear' : key}
            </button>
          ))}
        </div>

        <Button variant="primary" size="lg" block className="mt-4" id="btnPinSubmit" onClick={submit} disabled={pin.length < 4}>
          Unlock
        </Button>

        {appInfo.firstRun && (
          <p id="pinFirstRunHint" className="mt-4 rounded-control bg-teal-soft px-3 py-2.5 text-center text-sm text-teal-ink">
            First start: the administrator PIN is <strong>1234</strong>. You'll choose your own PIN next.
          </p>
        )}
      </div>
    </div>
  );
}
