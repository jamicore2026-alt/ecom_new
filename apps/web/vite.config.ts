import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5478,
		strictPort: true,
		proxy: {
			'/api': {
				target: 'http://localhost:3005',
				changeOrigin: true
			},
			'/uploads': {
				target: 'http://localhost:3005',
				changeOrigin: true
			}
		}
	}
})
