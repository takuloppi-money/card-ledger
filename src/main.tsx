import '@fontsource/archivo/latin-700.css';
import '@fontsource/archivo/latin-900.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 他のサイトに iframe で埋め込まれた場合は表示しない（クリックジャッキング対策。
// GitHub Pages では frame-ancestors ヘッダーを付けられないため）
if (window.top !== window.self) {
  document.body.textContent = 'このアプリは埋め込み表示できません';
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
