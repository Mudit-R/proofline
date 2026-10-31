import { defineConfig } from 'vite';
export default defineConfig({server:{port:15191,proxy:{'/api':'http://127.0.0.1:15190'}}});
