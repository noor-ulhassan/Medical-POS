'use strict';

const v = require('../lib/validate');
const { recordAudit } = require('./audit');

function createSettingsService(db) {
  function get() {
    return db.get('SELECT * FROM settings WHERE id = 1;');
  }

  return {
    get,

    update(actor, input) {
      const data = v.object(input);
      const values = {
        storeName: v.string(data.storeName, 'Store name', { required: true, max: 120 }),
        storeAddress: v.string(data.storeAddress, 'Store address', { max: 250 }),
        storePhone: v.string(data.storePhone, 'Phone', { max: 60 }),
        ntnFbrId: v.string(data.ntnFbrId, 'NTN / FBR ID', { max: 120 }),
        taxRatePercent: v.number(data.taxRatePercent, 'Tax rate', { min: 0, max: 100 }),
        posFeeCents: v.cents(data.posFeeCents, 'POS fee', { max: 100000 }),
        invoicePrefix: v.string(data.invoicePrefix, 'Invoice prefix', { max: 12 }),
        receiptDisclaimer: v.string(data.receiptDisclaimer, 'Receipt footer', { max: 500 })
      };
      db.transaction(() => {
        db.run(
          `UPDATE settings SET store_name = ?, store_address = ?, store_phone = ?, ntn_fbr_id = ?,
             tax_rate_percent = ?, pos_fee_cents = ?, invoice_prefix = ?, receipt_disclaimer = ? WHERE id = 1;`,
          [
            values.storeName,
            values.storeAddress,
            values.storePhone,
            values.ntnFbrId,
            values.taxRatePercent,
            values.posFeeCents,
            values.invoicePrefix,
            values.receiptDisclaimer
          ]
        );
        recordAudit(db, actor, 'settings.update', values);
      });
      return get();
    }
  };
}

module.exports = { createSettingsService };
