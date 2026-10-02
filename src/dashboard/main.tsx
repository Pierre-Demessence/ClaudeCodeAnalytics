import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/dashboard/App';
import '@/dashboard/styles.css';

const root = document.querySelector<HTMLDivElement>('#app');

if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
