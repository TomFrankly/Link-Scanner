// Browser entry point: loads the global styles and mounts the app into index.html's #app.
// Everything else starts in App.svelte, which calls boot() from store.svelte.ts.
import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });
