import './index.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installGlobalErrorLogging, logError, logInfo } from './lib/logger';

installGlobalErrorLogging();

const container = document.getElementById('root');
if (!container) {
  logError('bootstrap', 'Root element #root not found');
  throw new Error('Root element #root not found');
}
logInfo('bootstrap', 'Renderer starting', { userAgent: navigator.userAgent });
createRoot(container).render(<App />);
