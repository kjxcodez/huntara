import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/main/workers/worker-host.ts')
        }
      }
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@huntara/schema',
          '@huntara/sdk',
          '@huntara/core',
          '@huntara/ai',
          '@huntara/agent-core',
          '@huntara/agent-runtime',
          '@huntara/workflow-engine',
          'p-limit'
        ]
      })
    ]
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@huntara/schema',
          '@huntara/sdk',
          '@huntara/core',
          '@huntara/ai',
          '@huntara/agent-core',
          '@huntara/agent-runtime',
          '@huntara/workflow-engine'
        ]
      })
    ]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})