import { useCallback, useEffect, useState } from 'react';
import { Plus, Download, Upload, Folder, RefreshCw, TriangleAlert } from 'lucide-react';
import { call } from '../../lib/api.js';
import { useApp } from '../../state/AppState.jsx';
import { useToast } from '../../ui/Toast.jsx';
import { useConfirm } from '../../ui/Confirm.jsx';
import { Modal, ModalBody, ModalFooter } from '../../ui/Modal.jsx';
import { Button } from '../../ui/Button.jsx';
import { Field, Input, Select, Textarea, Checkbox, Fieldset } from '../../ui/Field.jsx';
import { Page, PageHeader, Panel, Tabs, Pill } from '../../ui/display.jsx';
import { Table, Th, Td, Tr, RowActions, EmptyRow } from '../../ui/Table.jsx';
import { toCents, centsToInput, dateTime, fileSize } from '../../lib/format.js';
import { readPrefs, writePrefs, AUTO_LOCK_CHOICES } from '../../lib/prefs.js';

const ROLE_HELP = {
  Cashier: 'Sells, holds sales, reprints receipts and attaches prescriptions.',
  Manager: 'Everything a cashier does, plus any discount, products, khata, returns, voids, write-offs, restock and the dashboard.',
  Admin: 'Everything, plus store settings, staff, backups and factory reset.'
};

// ------------------------------------------------------------------ store

function StoreTab() {
  const { settings, loadSettings } = useApp();
  const { toast, guard } = useToast();
  const [v, setV] = useState(null);

  useEffect(() => {
    if (!settings.store_name && settings.store_name !== '') return;
    setV({
      storeName: settings.store_name,
      storePhone: settings.store_phone,
      storeAddress: settings.store_address,
      ntnFbrId: settings.ntn_fbr_id,
      taxRatePercent: String(settings.tax_rate_percent),
      posFee: centsToInput(settings.pos_fee_cents),
      invoicePrefix: settings.invoice_prefix,
      receiptDisclaimer: settings.receipt_disclaimer,
      cashierMaxDiscountPercent: String(settings.cashier_max_discount_percent ?? 10)
    });
  }, [settings]);

  if (!v) return null;
  const set = (name) => (e) => setV((cur) => ({ ...cur, [name]: e.target.value }));
  const nextInvoice = `${v.invoicePrefix}${String(settings.next_invoice_no || 1).padStart(6, '0')}`;

  const submit = guard(async (e) => {
    e.preventDefault();
    const fee = toCents(v.posFee);
    if (Number.isNaN(fee) || fee < 0) throw new Error('Fee per receipt is not a valid amount');
    await call('settings.update', {
      ...v,
      taxRatePercent: Number(v.taxRatePercent),
      cashierMaxDiscountPercent: Number(v.cashierMaxDiscountPercent),
      posFeeCents: fee,
      posFee: undefined
    });
    await loadSettings();
    toast('Settings saved');
  });

  return (
    <form id="settingsForm" onSubmit={submit} className="max-w-[880px] rounded-panel border border-foil bg-surface">
      <div className="flex flex-col gap-6 p-6">
        <Fieldset legend="Shown on receipts">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Store name">
              <Input name="storeName" value={v.storeName} onChange={set('storeName')} required maxLength={120} />
            </Field>
            <Field label="Phone">
              <Input name="storePhone" value={v.storePhone} onChange={set('storePhone')} maxLength={60} />
            </Field>
            <Field label="Address" className="col-span-2">
              <Input name="storeAddress" value={v.storeAddress} onChange={set('storeAddress')} maxLength={250} />
            </Field>
            <Field label="NTN / FBR registration">
              <Input name="ntnFbrId" value={v.ntnFbrId} onChange={set('ntnFbrId')} maxLength={120} />
            </Field>
            <div />
            <Field label="Receipt footer" help="A return policy or thank-you note, printed at the bottom of every receipt." className="col-span-2">
              <Textarea name="receiptDisclaimer" rows={2} value={v.receiptDisclaimer} onChange={set('receiptDisclaimer')} maxLength={500} />
            </Field>
          </div>
        </Fieldset>
        <Fieldset legend="Tax and invoices">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Sales tax (%)">
              <Input numeric type="number" name="taxRatePercent" min={0} max={100} step="0.01" required value={v.taxRatePercent} onChange={set('taxRatePercent')} />
            </Field>
            <Field label="Fee per receipt (Rs)" help="For example the FBR POS fee.">
              <Input numeric type="number" name="posFee" min={0} step="0.01" required value={v.posFee} onChange={set('posFee')} />
            </Field>
            <Field label="Invoice prefix" help={`Next invoice: ${nextInvoice}`}>
              <Input name="invoicePrefix" value={v.invoicePrefix} onChange={set('invoicePrefix')} maxLength={12} />
            </Field>
          </div>
        </Fieldset>
        <Fieldset legend="Discounts">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Most discount a cashier can give (%)" help="Of the bill. A manager or admin can give more. Every discount is in the activity log." className="col-span-2">
              <Input
                numeric
                type="number"
                name="cashierMaxDiscountPercent"
                min={0}
                max={100}
                step="0.5"
                required
                value={v.cashierMaxDiscountPercent}
                onChange={set('cashierMaxDiscountPercent')}
                className="!w-[140px]"
              />
            </Field>
          </div>
        </Fieldset>
      </div>
      <div className="flex justify-end border-t border-foil bg-sunken/60 px-6 py-3.5">
        <Button type="submit" variant="primary">
          Save changes
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ staff

function UserDialog({ state, onClose, onSaved }) {
  const { toast, guard } = useToast();
  const [v, setV] = useState({ name: '', role: 'Cashier', isActive: true, pin: '' });
  const mode = state?.mode;
  const user = state?.user;

  useEffect(() => {
    if (!state) return;
    setV(user ? { name: user.name, role: user.role, isActive: user.isActive, pin: '' } : { name: '', role: 'Cashier', isActive: true, pin: '' });
  }, [state, user]);

  // A PIN is needed when creating or resetting, and when reactivating someone.
  const needsPin = mode !== 'edit' || (user && !user.isActive && v.isActive);
  const set = (name) => (e) => setV((cur) => ({ ...cur, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = guard(async (e) => {
    e.preventDefault();
    if (mode === 'create') {
      await call('users.create', { name: v.name, role: v.role, pin: v.pin });
      toast(`${v.name} added. They'll choose their own PIN when they first log in.`);
    } else if (mode === 'pin') {
      await call('users.resetPin', { id: user.id, pin: v.pin });
      toast(`PIN reset. ${user.name} must change it at their next login.`);
    } else {
      await call('users.update', { id: user.id, name: v.name, role: v.role, isActive: v.isActive, pin: v.pin || undefined });
      toast(`${v.name} updated`);
    }
    onClose();
    await onSaved();
  });

  const title = mode === 'create' ? 'Add staff member' : mode === 'pin' ? `Reset PIN for ${user?.name}` : `Edit ${user?.name || ''}`;
  return (
    <Modal open={Boolean(state)} onClose={onClose} title={title} id="modalUser" size="sm">
      <form id="userForm" onSubmit={submit} className="contents">
        <ModalBody>
          {mode !== 'pin' && (
            <>
              <Field label="Name">
                <Input name="name" value={v.name} onChange={set('name')} required maxLength={80} />
              </Field>
              <Field label="Role" help={ROLE_HELP[v.role]}>
                <Select name="role" value={v.role} onChange={set('role')}>
                  <option value="Cashier">Cashier</option>
                  <option value="Manager">Manager</option>
                  <option value="Admin">Admin</option>
                </Select>
              </Field>
            </>
          )}
          {mode === 'edit' && <Checkbox name="isActive" checked={v.isActive} onChange={set('isActive')} label="Can log in" />}
          {needsPin && (
            <Field label={mode === 'pin' ? 'New PIN' : 'Starting PIN'} help="4 to 6 digits. They'll be asked to choose their own PIN when they log in.">
              <Input name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,6}" maxLength={6} required value={v.pin} onChange={set('pin')} />
            </Field>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            {mode === 'create' ? 'Add staff member' : mode === 'pin' ? 'Reset PIN' : 'Save changes'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function StaffTab() {
  const { user: me } = useApp();
  const { guard } = useToast();
  const [users, setUsers] = useState([]);
  const [dialog, setDialog] = useState(null);
  const load = useCallback(() => guard(async () => setUsers(await call('users.list')))(), [guard]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Panel
      title="Staff"
      flush
      className="max-w-[880px]"
      actions={
        <Button size="sm" variant="primary" icon={Plus} id="btnAddUser" onClick={() => setDialog({ mode: 'create' })}>
          Add staff member
        </Button>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>PIN</Th>
            <Th />
          </tr>
        </thead>
        <tbody id="usersTableBody">
          {users.map((u) => (
            <Tr key={u.id} tone={u.isActive ? undefined : 'muted'}>
              <Td className="font-semibold text-ink">
                {u.name} {me && u.id === me.id && <span className="ml-1 text-sm font-normal text-ink-3">(you)</span>}
              </Td>
              <Td>{u.role}</Td>
              <Td>{u.isActive ? <Pill tone="teal">Active</Pill> : <Pill>Can't log in</Pill>}</Td>
              <Td>{u.mustChangePin ? <Pill tone="amber">Must change</Pill> : <span className="text-ink-2">Set</span>}</Td>
              <Td className="w-[1%]">
                <RowActions>
                  <Button size="sm" variant="ghost" aria-label={`Edit ${u.name}`} onClick={() => setDialog({ mode: 'edit', user: u })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Reset PIN for ${u.name}`} onClick={() => setDialog({ mode: 'pin', user: u })}>
                    New PIN
                  </Button>
                </RowActions>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <UserDialog state={dialog} onClose={() => setDialog(null)} onSaved={load} />
    </Panel>
  );
}

// ------------------------------------------------------------------ backups

/** Toast for the outcome of copying backups to the USB drive / cloud folder (null when none is set). */
function copyOutcomeToast(toast, copy) {
  if (!copy) return;
  if (copy.ok) toast(`Backups copied to ${copy.target}`);
  else toast(copy.error, 'error', { sticky: true });
}

/** Where the second copy of the backups goes: a USB drive or a cloud folder, so a dead or stolen PC loses nothing. */
function BackupCopyPanel() {
  const { settings, loadSettings } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const dir = settings.backup_copy_dir;

  const choose = guard(async () => {
    const res = await call('system.chooseBackupCopyFolder');
    if (res.cancelled) return;
    await loadSettings();
    copyOutcomeToast(toast, res.copy);
  });

  const stop = guard(async () => {
    const ok = await confirm({
      title: 'Stop copying backups?',
      message: 'Backups will then only be on this computer. If its disk fails or it is stolen, the shop data is lost.',
      confirmText: 'Stop copying',
      danger: true
    });
    if (!ok) return;
    await call('system.stopBackupCopies');
    await loadSettings();
    toast('Backups are no longer copied');
  });

  return (
    <Panel title="Copy to a USB drive or cloud folder">
      {dir ? (
        <div id="backupCopyStatus" className="flex flex-col gap-3">
          <p className="text-base text-ink-2">
            Every backup and every prescription photo is also copied to <strong className="num break-all text-ink">{dir}</strong> (in a folder named
            Noor Pharmacy POS backups). Each day's backup is copied as soon as the drive can be reached.
          </p>
          {settings.backup_copy_last_error ? (
            <div className="flex gap-3 rounded-panel bg-red-soft px-4 py-3 text-sm font-semibold text-red-ink">
              <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
              <span>{settings.backup_copy_last_error}</span>
            </div>
          ) : (
            <p className="text-sm text-ink-3">Last copied: {settings.backup_copy_last_at ? dateTime(settings.backup_copy_last_at) : 'not yet'}.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={Folder} id="btnChooseBackupCopyFolder" onClick={choose}>
              Change folder…
            </Button>
            <Button variant="danger-ghost" id="btnStopBackupCopies" onClick={stop}>
              Stop copying
            </Button>
          </div>
        </div>
      ) : (
        <div id="backupCopyStatus" className="flex flex-col gap-3">
          <div className="flex gap-3 rounded-panel bg-amber-soft px-4 py-3 text-sm text-amber-ink">
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
            <span>
              Backups are only on this computer. If its disk fails or it is stolen, all sales, stock and khata records are lost. Choose a USB drive that stays
              plugged in, or a OneDrive or Google Drive folder.
            </span>
          </div>
          <div>
            <Button variant="primary" icon={Folder} id="btnChooseBackupCopyFolder" onClick={choose}>
              Choose a USB drive or cloud folder…
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function BackupTab() {
  const { appInfo, can, loadSettings } = useApp();
  const { toast, guard } = useToast();
  const confirm = useConfirm();
  const [backups, setBackups] = useState([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const load = useCallback(() => guard(async () => setBackups(await call('system.listBackups')))(), [guard]);
  useEffect(() => {
    load();
  }, [load]);

  // The main process ended the session; reload into a clean lock screen.
  const reloadSoon = () => setTimeout(() => window.location.reload(), 1200);

  const backupNow = guard(async () => {
    const { filePath, copy } = await call('system.backup');
    toast(`Backup saved to ${filePath}`);
    copyOutcomeToast(toast, copy);
    await Promise.all([load(), loadSettings()]);
  });

  const restore = guard(async () => {
    const ok = await confirm({
      title: 'Restore a backup?',
      message: 'Everything on this computer will be replaced by the backup you choose. The current data is backed up first.',
      confirmText: 'Choose backup…',
      danger: true
    });
    if (!ok) return;
    const res = await call('system.restore');
    if (res.cancelled) return;
    toast('Backup restored. Log in again to continue.');
    reloadSoon();
  });

  const reset = guard(async () => {
    const value = resetText.trim().toUpperCase();
    if (value !== 'RESET') {
      toast('Type RESET to confirm', 'error');
      return;
    }
    const { safetyBackup } = await call('system.factoryReset', { confirm: value });
    setResetOpen(false);
    toast(`Reset complete. Your previous data was saved to ${safetyBackup}`);
    reloadSoon();
  });

  return (
    <div className="flex max-w-[880px] flex-col gap-5">
      <Panel title="Backups">
        <p className="max-w-[70ch] text-base text-ink-2">
          A backup is made automatically once a day (the last 14 are kept) and before every restore, reset or upgrade.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={Download} id="btnBackupDb" onClick={backupNow}>
            Back up now
          </Button>
          <Button icon={Upload} id="btnRestoreDb" onClick={restore}>
            Restore a backup…
          </Button>
          <Button icon={Folder} id="btnOpenDataFolder" onClick={guard(() => call('system.openDataFolder'))}>
            Open data folder
          </Button>
        </div>
        <div className="mt-5 overflow-hidden rounded-panel border border-foil">
          <Table maxHeight={260}>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Created</Th>
                <Th num>Size</Th>
              </tr>
            </thead>
            <tbody id="backupsTableBody">
              {backups.length === 0 && <EmptyRow colSpan={3}>No backups yet.</EmptyRow>}
              {backups.map((b) => (
                <Tr key={b.fileName}>
                  <Td className="num text-sm">{b.fileName}</Td>
                  <Td muted className="num">{dateTime(b.modifiedAt)}</Td>
                  <Td num muted>{fileSize(b.size)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Data folder: <span id="dataFolderPath" className="num">{appInfo.dataDir}</span>. Version <span id="appVersion">{appInfo.version}</span>.
        </p>
      </Panel>

      <BackupCopyPanel />

      {can('system.reset') && (
        <Panel title="Factory reset" tone="danger">
          <p className="max-w-[70ch] text-base text-ink-2">Removes all products, sales, customers, staff and settings from this computer. A backup is saved first so it can be restored.</p>
          <Button variant="danger" className="mt-4" id="btnOpenFactoryResetModal" onClick={() => { setResetText(''); setResetOpen(true); }}>
            Reset this computer…
          </Button>
        </Panel>
      )}

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset this computer?" id="modalFactoryResetConfirm" size="sm" role="alertdialog">
        <ModalBody>
          <div className="flex gap-3 rounded-panel bg-red-soft px-4 py-3 text-sm text-red-ink">
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
            <span>All products, sales, customers, staff and settings will be removed. A backup is saved to the Backups folder first.</span>
          </div>
          <Field label="Type RESET to confirm">
            <Input id="resetConfirmInput" value={resetText} onChange={(e) => setResetText(e.target.value)} autoComplete="off" spellCheck="false" />
          </Field>
        </ModalBody>
        <ModalFooter>
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="danger" id="btnExecuteFactoryReset" onClick={reset} disabled={resetText.trim().toUpperCase() !== 'RESET'}>
            Reset
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ this computer

/** Printer behaviour belongs to the computer at the counter, so it is saved here, not in the shop data. */
function ComputerTab() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState(readPrefs);
  const set = (name) => (e) => {
    setPrefs(writePrefs({ [name]: e.target.checked }));
    toast('Saved for this computer');
  };
  return (
    <div className="flex max-w-[880px] flex-col gap-5">
      <Panel title="Receipts">
        <div className="flex flex-col gap-4">
          <div>
            <Checkbox name="autoPrintReceipt" checked={prefs.autoPrintReceipt} onChange={set('autoPrintReceipt')} label="Print the receipt automatically after every sale" />
            <p className="ml-7 mt-1 text-sm text-ink-3">Saves pressing Print for each customer.</p>
          </div>
          <div>
            <Checkbox name="silentPrint" checked={prefs.silentPrint} onChange={set('silentPrint')} label="Print without showing the print window" />
            <p className="ml-7 mt-1 text-sm text-ink-3">
              Prints straight to this computer's default printer. Make your receipt printer the default printer in Windows (Settings, Printers) first.
            </p>
          </div>
        </div>
      </Panel>
      <Panel title="Lock when not in use">
        <div className="flex flex-col gap-2">
          <Field label="Lock this till by itself" help="Someone has to enter their PIN again. A sale that is being rung up is kept.">
            <Select
              name="autoLockMinutes"
              value={String(prefs.autoLockMinutes)}
              onChange={(e) => {
                setPrefs(writePrefs({ autoLockMinutes: Number(e.target.value) }));
                toast('Saved for this computer');
              }}
              className="!w-[240px]"
            >
              {AUTO_LOCK_CHOICES.map((c) => (
                <option key={c.value} value={String(c.value)}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Panel>
      <Panel title="Text size">
        <p className="text-base text-ink-2">
          Use the <strong>Aa</strong> button at the bottom of the menu to make all text larger or smaller, or press Ctrl and + / Ctrl and −. It is remembered on this
          computer.
        </p>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ activity

const ACTION_LABELS = {
  'auth.login': 'Logged in',
  'auth.login_failed': 'Wrong PIN entered',
  'auth.pin_changed': 'Changed own PIN',
  'auth.pin_change_failed': 'Wrong current PIN when changing PIN',
  'auth.pin_taken': 'Tried a PIN that someone else uses',
  'users.create': 'Added staff member',
  'users.update': 'Edited staff member',
  'users.reset_pin': 'Reset a PIN',
  'settings.update': 'Changed store settings',
  'products.create': 'Added product',
  'products.price_change': 'Changed a price',
  'products.receive_stock': 'Received stock',
  'products.stock_correction': 'Corrected stock',
  'products.stock_loss': 'Recorded damaged or lost stock',
  'products.write_off': 'Wrote off stock',
  'sales.discount': 'Gave a discount',
  'sales.return': 'Took back returned items',
  'customers.opening_balance': 'Entered an opening khata balance',
  'system.backup_copy_folder': 'Chose the backup copy folder',
  'system.backup_copy_stopped': 'Stopped copying backups',
  'expenses.create': 'Recorded an expense',
  'expenses.delete': 'Deleted an expense',
  'products.archive': 'Archived product',
  'products.delete': 'Removed product',
  'categories.create': 'Added category',
  'categories.update': 'Edited category',
  'suppliers.create': 'Added supplier',
  'suppliers.update': 'Edited supplier',
  'customers.create': 'Added customer',
  'customers.update': 'Edited customer',
  'sales.void': 'Cancelled a sale',
  'sales.attach_prescription': 'Attached a prescription',
  'system.restore': 'Restored a backup',
  'system.factory_reset': 'Factory reset'
};

function describe(entry) {
  try {
    return Object.entries(JSON.parse(entry.details || '{}'))
      .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
      .join(', ');
  } catch (_) {
    return entry.details;
  }
}

function ActivityTab() {
  const { guard } = useToast();
  const [entries, setEntries] = useState([]);
  const load = useCallback(() => guard(async () => setEntries(await call('audit.list', { limit: 200 })))(), [guard]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <Panel
      title="Recent activity"
      flush
      actions={
        <Button size="sm" icon={RefreshCw} id="btnRefreshAudit" onClick={load}>
          Refresh
        </Button>
      }
    >
      <Table maxHeight={560}>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>What</Th>
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody id="auditTableBody">
          {entries.length === 0 && <EmptyRow colSpan={4}>Nothing recorded yet.</EmptyRow>}
          {entries.map((a) => (
            <Tr key={a.id}>
              <Td muted className="num whitespace-nowrap">{dateTime(a.created_at)}</Td>
              <Td>{a.user_name || '—'}</Td>
              <Td className="whitespace-nowrap font-semibold" title={a.action}>
                {ACTION_LABELS[a.action] || a.action}
                <span className="sr-only"> ({a.action})</span>
              </Td>
              <Td muted className="max-w-[460px] break-words text-sm">
                {describe(a)}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}

export function SettingsView() {
  const { can, loadSettings } = useApp();
  const { guard } = useToast();
  const [tab, setTab] = useState('store');

  // The invoice counter changes with every sale, so reload on entry.
  useEffect(() => {
    guard(loadSettings)();
  }, [guard, loadSettings]);

  const tabs = [
    { value: 'store', label: 'Store details' },
    can('users.manage') && { value: 'staff', label: 'Staff and PINs' },
    can('backup.manage') && { value: 'backup', label: 'Backup and restore' },
    can('users.manage') && { value: 'activity', label: 'Activity log' },
    { value: 'computer', label: 'This computer' }
  ].filter(Boolean);

  return (
    <Page id="settingsView">
      <PageHeader title="Settings" description="Store details, staff, backups and the activity log." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'store' && <StoreTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'computer' && <ComputerTab />}
    </Page>
  );
}
