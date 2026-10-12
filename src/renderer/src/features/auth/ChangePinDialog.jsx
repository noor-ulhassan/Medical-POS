import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useToast } from '../../ui/Toast.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button } from '../../ui/Button.jsx';
import { Field, Input } from '../../ui/Field.jsx';

/** Voluntary or forced PIN change. A forced change cannot be dismissed; "Lock instead" logs out. */
export function ChangePinDialog({ open, forced, onClose, onChanged, onLock }) {
  const { toast, guard } = useToast();
  const [values, setValues] = useState({ currentPin: '', newPin: '', confirmPin: '' });
  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));

  const submit = guard(async (e) => {
    e.preventDefault();
    if (values.newPin !== values.confirmPin) {
      toast('The two new PINs do not match', 'error');
      return;
    }
    const user = await call('auth.changeOwnPin', { currentPin: values.currentPin, newPin: values.newPin });
    setValues({ currentPin: '', newPin: '', confirmPin: '' });
    toast('PIN changed');
    onChanged(user, forced);
  });

  const pinProps = { type: 'password', inputMode: 'numeric', autoComplete: 'off', maxLength: 6, required: true };

  return (
    <Modal open={open} onClose={onClose} locked={forced} title="Change your PIN" id="modalChangePin" size="sm">
      <form id="changePinForm" onSubmit={submit} className="contents">
        <ModalBody>
          {forced && (
            <div className="flex gap-3 rounded-control bg-amber-soft px-3.5 py-3 text-sm text-amber-ink">
              <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
              <span>Choose a new PIN that only you know before you continue.</span>
            </div>
          )}
          <Field label="Current PIN">
            <Input name="currentPin" value={values.currentPin} onChange={set('currentPin')} {...pinProps} />
          </Field>
          <Field label="New PIN" help="4 to 6 digits. Avoid 1234, 0000 and repeated digits.">
            <Input name="newPin" pattern="\d{4,6}" value={values.newPin} onChange={set('newPin')} {...pinProps} />
          </Field>
          <Field label="New PIN again">
            <Input name="confirmPin" pattern="\d{4,6}" value={values.confirmPin} onChange={set('confirmPin')} {...pinProps} />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onLock}>Lock instead</Button>
          <Button type="submit" variant="primary">
            Save new PIN
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
