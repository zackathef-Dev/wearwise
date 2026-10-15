import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTokens } from './theme/tokens';
import { applyThemePreference } from './theme/theme-preference';
import { App } from './App';
import './styles/fonts.css';
import './styles/global.css';

installTokens();
applyThemePreference();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
