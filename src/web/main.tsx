import { render } from 'preact';
import { App } from './app';
import { WordSheet } from './word-sheet';
import { reloadWhenUpdated } from './fresh';
import './styles.css';

render(
  <>
    <App />
    <WordSheet />
  </>,
  document.getElementById('app')!,
);

reloadWhenUpdated();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}
