import { render } from 'preact';
import { App } from './app';
import { WordSheet } from './word-sheet';
import './styles.css';

render(
  <>
    <App />
    <WordSheet />
  </>,
  document.getElementById('app')!,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}
