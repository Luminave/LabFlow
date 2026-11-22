import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        // 刻意不在这里 startup()：开发模式下 Electron 由 `npm run electron:dev` 里的
        // `electron .` 拉起。插件再拉一次就是两个实例，单实例锁会把后一个踢掉，
        // concurrently 随即把 vite 收走 —— 窗口白屏 / 整个应用消失（2026-11-22 踩过）
        onstart() {},

        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'sql.js']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        // 同理不写 onstart：插件的 reload() 在「插件自己没 startup 过」时**会退化成 startup()**，
        // 那样又会多开一个 Electron（单实例锁踢掉它，日志里就冒出假的“第二实例”）。
        // preload 改动不算频繁，改了重启一次 dev 即可。
        onstart() {},
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@renderer': path.resolve(__dirname, './src/renderer')
    }
  },
  build: {
    outDir: 'dist'
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
