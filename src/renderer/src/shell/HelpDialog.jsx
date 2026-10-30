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
      'To change how many, click the number on that line and type it (for example 30), then press Enter.',
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
      'At the top of the sale, click Walk-in customer and choose the customer. (New customer? Add them first in Khata.)',
      'Click Charge, choose Khata, then Complete sale.',
      'If the sale is over their limit, take part of it in cash or raise their limit in Khata.'
    ]
  },
  {
    title: 'A customer pays what they owe',
    permission: 'customers.payment',
    steps: [
      'Open Khata on the left.',
      'Find the customer and click Take payment.',
      'Type the amount they paid, choose how they paid (cash, card, mobile wallet or bank transfer), and click Record payment.'
    ]
  },
  {
    title: 'Medicine that needs a prescription (Rx)',
    steps: [
      'These medicines show an Rx mark.',
      'Click Prescription under the sale and choose the photo of the prescription.',
      'No photo? The till asks you to confirm before it completes the sale. You can add the photo later: open Sales, click the sale, then Add prescription photo.'
    ]
  },
  {
    title: 'Keep a sale for later (customer will come back)',
    steps: [
      'Click Hold under the sale. The till is empty for the next customer.',
      'To bring it back, click Held at the top of the sale, then Resume next to it.'
    ]
  },
  {
    title: 'Give a discount',
    steps: [
      'Click Discount under the sale (or press F3) and type the discount. Choose Rs or %.',
      'A cashier can give up to the limit set by the owner (10% unless changed). For more, press F12 and let a manager log in: the sale stays in the cart.',
      "Every discount, and who gave it, is shown in the activity log and on Today's report."
    ]
  },
  {
    title: 'A delivery of medicine arrived',
    permission: 'stock.adjust',
    steps: [
      'Open Stock on the left. Medicines opens first: find the medicine.',
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
      'Open Stock and click Add medicine.',
      'Type the name, scan the barcode (or click Generate), and enter the expiry date from the pack.',
      'Enter how many packs you have, and the prices. Click Add medicine.',
      'To change it later, click the medicine in the list and then Change details, stock or prices.'
    ]
  },
  {
    title: 'A customer brings back some of what they bought',
    permission: 'sales.void',
    steps: [
      'Open Sales on the left and find the sale (search by invoice number or customer).',
      'Click the sale, then Customer returns items. Type how many of each item came back (or click All), and write why.',
      'If the medicine cannot be sold again (opened, damaged, not kept cold), untick "Put the medicine back on the shelf".',
      'The screen tells you how much money to give back (or how much comes off their khata). Click Save the return, then print the receipt for the customer.'
    ]
  },
  {
    title: 'A whole sale was a mistake',
    permission: 'sales.void',
    steps: [
      'Open Sales and click the sale.',
      'Click Cancel the whole sale and write why. (Once something was returned from a sale, use Customer returns items for the rest instead.)',
      'The screen tells you how much money to give back. The medicines go back into stock by themselves.'
    ]
  },
  {
    title: 'A customer already owed money in the old khata book',
    permission: 'customers.manage',
    steps: [
      'Open Khata and click Add customer. (For a customer who has no entries yet, click them, then Change details or limit.)',
      'Type what they owe from the old book under "Already owes" and save.',
      'It is added to their khata as the opening balance. Payments they make later are taken off it as usual.'
    ]
  },
  {
    title: 'End of the day: check the cash',
    permission: 'reports.view',
    steps: [
      'Open Reports on the left. Today opens first.',
      'Look at "Cash that should be in the drawer".',
      'Add the cash you started the day with. Count the drawer: the two should match.'
    ]
  },
  {
    title: 'Record a shop expense (rent, salaries, bills)',
    permission: 'expenses.manage',
    steps: [
      'Open Reports on the left, then Expenses at the top.',
      'Choose the date and what the money was for, and type the amount.',
      "If you paid it with cash from the shop's drawer, tick the box, so the end-of-day cash count stays right.",
      'Click Save expense. Do not enter payments to suppliers for medicines: their cost is counted automatically when you sell them.'
    ]
  },
  {
    title: 'See how much profit the shop made',
    permission: 'reports.view',
    steps: [
      'Open Reports on the left, then Profit & loss at the top, and choose a period (for example This month).',
      'Net profit is what is left after the cost of the medicines sold, your expenses and stock that expired, broke or went missing.',
      'Every medicine needs a cost price (Stock, Medicines) for its sales to be counted. The screen tells you if any are missing.',
      'Click Show more for expenses by type, the best medicines and the numbers day by day.'
    ]
  },
  {
    title: 'Expired or nearly expired medicine',
    permission: 'products.view',
    steps: [
      'Open Stock on the left, then Expiring at the top. Red means expired or expiring within 30 days.',
      'Expired medicine cannot be sold: the till refuses it.',
      'Take expired packs off the shelf, then click Throw away so the stock count is correct.'
    ]
  },
  {
    title: 'Keep your data safe',
    permission: 'backup.manage',
    steps: [
      'The software saves every sale immediately and makes a backup every day by itself.',
      'Plug in a USB drive that can stay in the computer (or use a OneDrive or Google Drive folder).',
      'Settings, Backup and restore, Choose a USB drive or cloud folder. From then on every backup and prescription photo is also copied there.',
      "If the copy stops working (for example the drive was taken out), Today's report says so."
    ]
  },
  {
    title: 'Make the writing bigger',
    steps: [
      'Click your name at the bottom of the menu, then Text size. Each click makes the text bigger, then back to normal.',
      'Or hold Ctrl and press + (bigger) or − (smaller). Ctrl and 0 goes back to normal.'
    ]
  },
  {
    title: 'Print receipts automatically',
    permission: 'settings.manage',
    steps: [
      'Open Settings, then This computer.',
      'Tick "Print the receipt automatically after every sale".',
      'To skip the print window too, make the receipt printer the default printer in Windows, then tick "Print without showing the print window".'
    ]
  },
  {
    title: 'Someone forgot their PIN',
    steps: [
      'The owner (Admin) opens Settings, Staff and PINs, and clicks New PIN next to that person.',
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
