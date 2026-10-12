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
