import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS com certificado autoassinado: o navegador do celular só libera a
// câmera em página segura. base './' permite hospedar o build em qualquer pasta.
export default defineConfig({
  base: './',
  plugins: [react(), basicSsl()],
  worker: { format: 'es' },
  test: { include: ['testes/**/*.test.js'] },
});
