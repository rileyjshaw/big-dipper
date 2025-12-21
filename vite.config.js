import { defineConfig } from 'vite';
import favicons from '@peterek/vite-plugin-favicons';

const config = {
	path: '/big-dipper/',
	appName: 'Big Dipper',
	appShortName: 'Big Dipper',
	appDescription: 'A rhythm machine made with DIP switches.',
};

export default defineConfig({
	base: config.path,
	build: {
		outDir: 'dist',
	},
	plugins: [favicons('src/assets/icon.png', config)],
});
