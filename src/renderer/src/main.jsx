import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.jsx';
import { AppStateProvider } from './state/AppState.jsx';
import { CartProvider } from './state/Cart.jsx';
import { ToastProvider } from './ui/Toast.jsx';
import { ConfirmProvider } from './ui/Confirm.jsx';
import { DocumentsProvider } from './print/Documents.jsx';

window.addEventListener('error', (e) => console.error('Unhandled error:', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));

// Scrolling the mouse wheel over a focused number box changes its value in
// Chromium, so an amount (cash received, a price) could change without anyone
// noticing. Leaving the box first lets the wheel scroll the page instead.
document.addEventListener(
  'wheel',
  (e) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === e.target) el.blur();
  },
  { passive: true }
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <AppStateProvider>
        <ConfirmProvider>
          <DocumentsProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </DocumentsProvider>
        </ConfirmProvider>
      </AppStateProvider>
    </ToastProvider>
  </StrictMode>
);
