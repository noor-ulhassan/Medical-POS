import { KeyRound, Lock, Moon, Sun, Type } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { TEXT_SIZES } from '../lib/prefs.js';
import { Modal, ModalBody } from '../ui/Modal.jsx';

function Choice({ icon: Icon, title, detail, ...props }) {
  return (
    <button type="button" className="flex w-full items-center gap-4 rounded-panel border border-foil px-4 py-3.5 text-left transition-colors hover:border-ink-3 hover:bg-sunken" {...props}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-md font-semibold text-ink">{title}</span>
        {detail && <span className="block text-sm text-ink-2">{detail}</span>}
      </span>
    </button>
  );
}

/** Everything about the person at the till and this screen, for every role. */
export function MeDialog({ open, onClose, theme, onToggleTheme, textSize, onCycleTextSize, onChangePin, onLock }) {
  const { user } = useApp();
  const index = Math.max(
    TEXT_SIZES.findIndex((t) => t.value === textSize),
    0
  );
  const next = TEXT_SIZES[(index + 1) % TEXT_SIZES.length];
  return (
    <Modal open={open} onClose={onClose} title={user ? user.name : ''} description={user ? `${user.role} on this till` : ''} id="modalMe" size="sm">
      <ModalBody className="gap-2.5">
        <Choice icon={KeyRound} title="Change my PIN" onClick={onChangePin} />
        <Choice
          icon={Type}
          title={`Text size: ${TEXT_SIZES[index].label}`}
          detail={`Tap for ${next.label.toLowerCase()} text. Ctrl and + or - also work.`}
          id="textSizeBtn"
          onClick={onCycleTextSize}
        />
        <Choice
          icon={theme === 'dark' ? Sun : Moon}
          title={theme === 'dark' ? 'Dark screen: on' : 'Dark screen: off'}
          detail={theme === 'dark' ? 'Tap for the normal light screen.' : 'Easier on the eyes in a dim shop. Goes back to light at the next start.'}
          id="themeToggleBtn"
          onClick={onToggleTheme}
        />
        <Choice icon={Lock} title="Lock the till" detail="Someone has to enter their PIN to continue. F12 does the same." onClick={onLock} />
      </ModalBody>
    </Modal>
  );
}
