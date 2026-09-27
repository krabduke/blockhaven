import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/pixelify-sans/700.css';
import './ui/style.css';
import { Game } from './game';
import { buildAtlas } from './textures';
import { initIcons } from './ui/icons';

const atlas = buildAtlas();
initIcons(atlas);
new Game(document.getElementById('app')!, atlas);
