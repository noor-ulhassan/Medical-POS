import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TriangleAlert, CircleHelp } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from './Modal.jsx';
import { cx } from './cx.js';
import { Button } from './Button.jsx';
import { useApp } from '../state/AppState.jsx';

const ConfirmContext = createContext(null);

/** Promise-based confirmation dialog: `if (await confirm({...})) ...` */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const yesRef = useRef(null);
  const cancelRef = useRef(null);

  const confirm = useCallback((options) => {
    if (resolver.current) resolver.current(false);
    return new Promise((resolve) => {
      resolver.current = resolve;
      setRequest({ title: 'Are you sure?', confirmText: 'Confirm', danger: false, ...options });
    });
  }, []);

  const finish = (answer) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    if (resolve) resolve(answer);
  };

  // Locking the till answers "no" to an open question.
  const { user } = useApp();
  useEffect(() => {
    if (user || !resolver.current) return;
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve(false);
  }, [user]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {/* For destructive questions the safe answer has focus, so a stray Enter (or a barcode scanner's Enter) cannot clear or delete anything. */}
      <Modal open={Boolean(request)} onClose={() => finish(false)} title={request?.title} id="modalConfirm" size="sm" role="alertdialog" initialFocus={request?.danger ? cancelRef : yesRef}>
        <ModalBody>
          <div className="flex items-start gap-4">
            <span
              className={cx('flex size-11 shrink-0 items-center justify-center rounded-full', request?.danger ? 'bg-red-soft text-red-ink' : 'bg-accent-soft text-accent-ink')}
              aria-hidden="true"
            >
              {request?.danger ? <TriangleAlert className="size-5" /> : <CircleHelp className="size-5" />}
            </span>
            <p className="whitespace-pre-line pt-2 text-base leading-relaxed text-ink-2">{request?.message}</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button ref={cancelRef} onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button ref={yesRef} id="confirmYes" variant={request?.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>
            {request?.confirmText}
          </Button>
        </ModalFooter>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
