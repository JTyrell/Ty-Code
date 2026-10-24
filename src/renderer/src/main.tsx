import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';
import 'katex/dist/katex.min.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Ty-Code Workbench Crash Detected">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

