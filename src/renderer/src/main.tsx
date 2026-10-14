import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import { App } from './App';
import './index.css';

async function bootstrap(): Promise<void> {
  await import('./services/monaco-workers');
  const monaco = await import('monaco-editor');
  loader.config({ monaco });

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
