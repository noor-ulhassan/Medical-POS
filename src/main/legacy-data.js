'use strict';

const fs = require('fs');
const path = require('path');

/*
 * Earlier releases kept their data in the Documents folder (first under a
 * different app name, then as NoorPharmacyPOS). Documents is often synced by
 * OneDrive and protected by Windows "Controlled folder access", which blocks
 * apps from saving there, so data now lives in %LOCALAPPDATA%.
 *
 * On the first start of this version the newest previous folder is moved,
 * or copied when Windows does not allow the move, into the current location,
 * so no sales, stock or customer history is lost. These names are never shown.
 */
const PREVIOUS_FOLDERS = ['NoorPharmacyPOS', 'MediDeskPOS'];
const PREVIOUS_DB_FILES = ['medidesk_pos.db'];

/**
 * @returns {{ action: 'moved'|'copied', from: string } | null} what was done, or null when there was nothing to adopt
 */
function adoptPreviousInstall({ documentsDir, dataDir, dbFileName }) {
  let result = null;

  if (!fs.existsSync(dataDir)) {
    const source = PREVIOUS_FOLDERS.map((name) => path.join(documentsDir, name)).find(
      (dir) => path.resolve(dir) !== path.resolve(dataDir) && fs.existsSync(dir)
    );
    if (source) {
      fs.mkdirSync(path.dirname(dataDir), { recursive: true });
      try {
        fs.renameSync(source, dataDir);
        result = { action: 'moved', from: source };
      } catch (_) {
        // Protected folder, another drive, or the old app still open:
        // copying leaves the original untouched.
        fs.cpSync(source, dataDir, { recursive: true });
        result = { action: 'copied', from: source };
      }
    }
  }

  const currentDb = path.join(dataDir, dbFileName);
  for (const name of PREVIOUS_DB_FILES) {
    const previousDb = path.join(dataDir, name);
    if (fs.existsSync(previousDb) && !fs.existsSync(currentDb)) {
      fs.renameSync(previousDb, currentDb);
      result = result || { action: 'moved', from: previousDb };
    }
  }
  return result;
}

module.exports = { adoptPreviousInstall };
