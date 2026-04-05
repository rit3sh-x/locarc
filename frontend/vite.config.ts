import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { varlockVitePlugin } from '@varlock/vite-integration'
import path from 'node:path'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendRoot = path.resolve(__dirname, '../backend/convex')

const config = defineConfig({
    plugins: [
        devtools(),
        tsconfigPaths({ projects: ['./tsconfig.json'] }),
        tailwindcss(),
        varlockVitePlugin(),
        tanstackRouter({ target: 'react', autoCodeSplitting: true }),
        viteReact(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@backend/api': path.resolve(backendRoot, '_generated/api'),
            '@backend/dataModel': path.resolve(backendRoot, '_generated/dataModel'),
            '@backend/authDataModel': path.resolve(backendRoot, 'betterAuth/_generated/dataModel'),
            '@backend/types': path.resolve(backendRoot, 'types'),
        },
    },
    server: {
        port: 3000,
        strictPort: true,
    },
})

export default config
