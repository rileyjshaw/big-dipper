import { defineConfig } from 'vite';
import favicons from '@peterek/vite-plugin-favicons';

export default defineConfig({
	base: '/big-dipper/',
	build: {
		outDir: 'dist',
	},
	plugins: [favicons('src/assets/icon.png')],
});
