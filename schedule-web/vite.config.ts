import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // データベースのテストは1件ごとに PGlite を作り直すので時間がかかる
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 30000 },
});
