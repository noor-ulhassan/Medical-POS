'use strict';

const path = require('path');
const { protocol } = require('electron');
const { isInside } = require('./lib/fsutil');

const SCHEME = 'app';
const HOST = 'noorpos';
const APP_ORIGIN = `${SCHEME}://${HOST}`;
/** The built React UI (`npm run build:ui`, see vite.config.mjs). */
const UI_DIR = path.join(__dirname, '..', '..', 'build', 'renderer');

/**
 * The UI is served from app://noorpos/ instead of file:// so it has a real
 * origin (CSP 'self', ES modules and localStorage all behave normally) and
 * can only ever load files from the built UI folder.
 */
function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

function registerAppProtocol() {
  protocol.registerFileProtocol(SCHEME, (request, respond) => {
    try {
      const url = new URL(request.url);
      const filePath = path.normalize(path.join(UI_DIR, decodeURIComponent(url.pathname)));
      if (url.host !== HOST || !isInside(UI_DIR, filePath)) {
        respond({ error: -6 }); // net::ERR_FILE_NOT_FOUND
        return;
      }
      respond({ path: filePath });
    } catch (_) {
      respond({ error: -2 }); // net::ERR_FAILED
    }
  });
}

/**
 * True for pages served by registerAppProtocol. (URL#origin is "null" for
 * custom schemes, so protocol and host are compared instead.)
 */
function isAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === `${SCHEME}:` && url.host === HOST;
  } catch (_) {
    return false;
  }
}

module.exports = { registerSchemePrivileges, registerAppProtocol, isAppUrl, ENTRY_URL: `${APP_ORIGIN}/index.html`, UI_DIR };
