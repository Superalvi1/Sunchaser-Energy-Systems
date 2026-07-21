import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import DeliveryVerifyPage from './components/DeliveryVerifyPage.tsx';
import './index.css';
import { ToastProvider } from './lib/toast.tsx';
import { inboxQueryClient } from './inbox/queryClient.ts';

const verifyMatch = window.location.pathname.match(/^\/delivery\/verify\/([^/]+)\/?$/);
const verifyToken = verifyMatch?.[1] ? decodeURIComponent(verifyMatch[1]) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={inboxQueryClient}>
      <ToastProvider>
        {verifyToken ? <DeliveryVerifyPage token={verifyToken} /> : <App />}
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && !verifyToken) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        reg.update();
        console.log('Service Worker registered:', reg.scope);
      })
      .catch((err) => console.error('Service Worker registration failed:', err));
  });
}
