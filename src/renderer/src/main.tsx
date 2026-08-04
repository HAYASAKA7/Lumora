import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { WindowRoot } from './WindowRoot';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Renderer root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <WindowRoot />
  </StrictMode>
);
