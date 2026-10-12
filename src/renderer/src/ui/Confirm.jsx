import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, ModalBody, ModalFooter } from './Modal.jsx';
import { Button } from './Button.jsx';

const ConfirmContext = createContext(null);

/** Promise-based confirmation dialog: `if (await confirm({...})) ...` */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const yesRef = useRef(null);

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

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={Boolean(request)} onClose={() => finish(false)} title={request?.title} id="modalConfirm" size="sm" role="alertdialog" initialFocus={yesRef}>
        <ModalBody>
          <p className="whitespace-pre-line text-base leading-relaxed text-ink-2">{request?.message}</p>
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => finish(false)}>Cancel</Button>
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
