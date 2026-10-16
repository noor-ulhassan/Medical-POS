import { Modal, ModalBody, ModalFooter } from '../ui/Modal.jsx';
import { Button } from '../ui/Button.jsx';
import { useApp } from '../state/AppState.jsx';

/**
 * Step-by-step answers to the everyday questions at a pharmacy counter,
 * written for someone who is not used to computers. Guides for screens the
 * current user cannot open are hidden.
 */
const GUIDES = [
  {
    title: 'Sell medicine (cash)',
    steps: [
      'Click Sell on the left (or press F1).',
      'Scan the barcode on the box, or type the medicine name and click it.',
      'To sell a whole pack instead of one tablet, click Pack on that line in the sale.',
      'Click the green Charge button (or press F2).',
      'Type the cash the customer gave you. The screen shows the change to give back.',
      'Click Complete sale, then Print receipt.'
    ]
  },
  {
    title: 'Sell on khata (credit)',
    permission: 'customers.view',
    steps: [
      'Add the medicines as for a normal sale.',
      'Under Customer at the top of the sale, choose the customer. (New customer? Add them first in Khata.)',
      'Click Charge, choose Khata, then Complete sale.',
      'If the sale is over their limit, take part of it in cash or raise their limit in Khata.'
    ]
  },
  {
    title: 'A customer pays what they owe',
    permission: 'customers.payment',
    steps: ['Open Khata (credit) on the left.', 'Find the customer and click Receive.', 'Type the amount they paid and click Record payment.']
  },
  {
    title: 'A delivery of medicine arrived',
    permission: 'stock.adjust',
    steps: [
      'Open Medicines & stock on the left and find the medicine.',
      'Click Receive on that line.',
      'Type how many packs arrived. Do not add them up yourself: they are added to what is already there.',
      'If no older packs are left on the shelf, change the expiry date to the one printed on the new packs.',
      'Click Add to stock.'
    ]
  },
  {
    title: 'A new medicine the shop has never sold',
    permission: 'products.manage',
    steps: [
      'Open Medicines & stock and click Add product.',
      'Type the name, scan the barcode (or click Generate), and enter the expiry date from the pack.',
      'Enter how many packs you have, and the prices. Click Add product.'
    ]
  },
  {
    title: 'A customer returns medicine, or a sale was a mistake',
    permission: 'sales.void',
    steps: [
      'Open Past sales and find the sale (search by invoice number or customer).',
      'Click Cancel sale and write why.',
      'The screen tells you how much money to give back. The medicines go back into stock by themselves.'
    ]
  },
  {
    title: 'End of the day: check the cash',
    permission: 'reports.view',
    steps: [
      "Open Today's report.",
      'Look at "Cash that should be in the drawer".',
      'Add the cash you started the day with. Count the drawer: the two should match.'
    ]
  },
  {
    title: 'Record a shop expense (rent, salaries, bills)',
    permission: 'expenses.manage',
    steps: [
      'Open Expenses on the left.',
      'Choose the date and what the money was for, and type the amount.',
      "If you paid it with cash from the shop's drawer, tick the box, so the end-of-day cash count stays right.",
      'Click Save expense. Do not enter payments to suppliers for medicines: their cost is counted automatically when you sell them.'
    ]
  },
  {
    title: 'See how much profit the shop made',
    permission: 'reports.view',
    steps: [
      'Open Profit & loss on the left and choose a period at the top (for example This month).',
      'Net profit is what is left after the cost of the medicines sold, your expenses and expired stock.',
      'Every medicine needs a cost price (Medicines & stock) for its sales to be counted. The screen tells you if any are missing.'
    ]
  },
  {
    title: 'Expired or nearly expired medicine',
    permission: 'products.view',
    steps: [
      'Open Expiring soon. Red means expired or expiring within 30 days.',
      'Expired medicine cannot be sold: the till refuses it.',
      'Take expired packs off the shelf, then click Write off so the stock count is correct.'
    ]
  },
  {
    title: 'Keep your data safe',
    permission: 'backup.manage',
    steps: [
      'The software saves every sale immediately and makes a backup every day by itself.',
      'Once a week: Settings, Backup and restore, Open data folder, and copy the Backups folder to a USB drive.'
    ]
  },
  {
    title: 'Someone forgot their PIN',
    steps: [
      'The owner (Admin) opens Settings, Staff and PINs, and clicks the key next to that person to give a new PIN.',
      'They will choose their own PIN the next time they log in.'
    ]
  }
];

export function HelpDialog({ open, onClose }) {
  const { can } = useApp();
  const guides = GUIDES.filter((g) => !g.permission || can(g.permission));
  return (
    <Modal open={open} onClose={onClose} title="How do I…?" description="Click a question to see the steps." id="modalHelp" size="lg">
      <ModalBody className="gap-2">
        {guides.map((g, i) => (
          <details key={g.title} open={i === 0} className="group rounded-panel border border-foil bg-surface open:border-teal">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-md font-semibold text-ink hover:bg-sunken">
              {g.title}
              <span className="text-ink-3 group-open:rotate-90" aria-hidden="true">
                ›
              </span>
            </summary>
            <ol className="list-decimal space-y-1.5 px-4 pb-4 pl-9 text-base text-ink-2">
              {g.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        ))}
        <p className="mt-2 text-sm text-ink-3">
          Keyboard shortcuts: F1 sell, F2 charge, F3 discount, F4 customer, F12 lock. Esc closes a window.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
