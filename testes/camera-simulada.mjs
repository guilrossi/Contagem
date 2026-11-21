// Teste de ponta a ponta com câmera simulada.
//
// Abre a página no Chromium, troca a câmera por um vídeo sintético de uma
// prateleira (caixas com etiquetas EAN-13 de verdade, várias iguais lado a
// lado) passando devagar na frente da câmera, e confere se o total contado
// bate com o número de caixas.
//
// Uso:  npm run build && npm run preview   (em outro terminal)
//       node testes/camera-simulada.mjs [url] [motor]
// Precisa do Playwright instalado (npm i -D playwright).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = process.argv[2] || 'https://localhost:4173/';
const captura = process.argv[3];

// Roda dentro da página, antes do app.
function instalarCameraSimulada() {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = L.map((p) => [...p].map((b) => (b === '0' ? '1' : '0')).join(''));
  const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  function comDigito(doze) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(doze[i]) * (i % 2 ? 3 : 1);
    return doze + ((10 - (s % 10)) % 10);
  }
  function modulos(ean) {
    const p = PARIDADE[Number(ean[0])];
    let m = '101';
    for (let i = 1; i <= 6; i++) m += (p[i - 1] === 'L' ? L : G)[Number(ean[i])];
    m += '01010';
    for (let i = 7; i <= 12; i++) m += R[Number(ean[i])];
    return m + '101';
  }

  const codigos = ['789100000001', '789100000002', '789100000003', '789100000004', '789100000005'].map(comDigito);
  // 4 linhas x 10 colunas; índices em `codigos`. Muitas caixas iguais vizinhas.
  const grade = [
    [0, 0, 0, 1, 1, 2, 3, 3, 3, 4],
    [0, 0, 1, 1, 2, 2, 3, 4, 4, 4],
    [1, 1, 1, 1, 2, 3, 3, 3, 4, 0],
    [2, 2, 2, 3, 3, 3, 4, 4, 0, 0],
  ];
  const PASSO_X = 460;
  const PASSO_Y = 330;
  const MOD = 2; // pixels por módulo: etiqueta com 190 px de largura
  const mundoL = PASSO_X * grade[0].length + 600;
  const mundoA = PASSO_Y * grade.length + 200;

  const mundo = document.createElement('canvas');
  mundo.width = mundoL;
  mundo.height = mundoA;
  const g = mundo.getContext('2d');
  g.fillStyle = '#5b5148';
  g.fillRect(0, 0, mundoL, mundoA);
  // Textura irregular, como uma prateleira real.
  let semente = 42;
  const rnd = () => ((semente = (semente * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0},0.35)`;
    g.fillRect(rnd() * mundoL, rnd() * mundoA, 10 + rnd() * 60, 6 + rnd() * 30);
  }
  let caixas = 0;
  grade.forEach((linha, l) =>
    linha.forEach((c, col) => {
      const x = 300 + col * PASSO_X;
      const y = 100 + l * PASSO_Y;
      g.fillStyle = ['#d9c7a3', '#c9b48c', '#e2d3b5'][(l + col) % 3];
      g.fillRect(x - 210, y - 150, 420, 300);
      g.strokeStyle = '#3b3128';
      g.lineWidth = 4;
      g.strokeRect(x - 210, y - 150, 420, 300);
      g.fillStyle = '#fff';
      g.fillRect(x - 125, y - 60, 250, 120);
      const m = modulos(codigos[c]);
      g.fillStyle = '#000';
      for (let i = 0; i < m.length; i++) {
        if (m[i] === '1') g.fillRect(x - (95 * MOD) / 2 + i * MOD, y - 45, MOD, 80);
      }
      g.font = '14px monospace';
      g.fillText(codigos[c], x - 55, y + 52);
      caixas++;
    }),
  );
  window.__prateleira = { caixas, codigos: codigos.length };

  // "Câmera": janela de 1080x1920 andando sobre a prateleira, com tremor.
  const cam = document.createElement('canvas');
  cam.width = 1080;
  cam.height = 1920;
  const c = cam.getContext('2d');
  const inicio = performance.now();
  const DURACAO = Number(new URLSearchParams(location.search).get('duracao')) || 30000;
  function quadro() {
    const t = Math.min(1, (performance.now() - inicio) / DURACAO);
    // Ida e volta, para também provar que passar de novo não duplica.
    const f = t < 0.7 ? t / 0.7 : 1 - (t - 0.7) / 0.3;
    const x = f * (mundoL - 1080) + 6 * Math.sin(performance.now() / 130);
    const y = (mundoA - 1920) / 2 + 20 * Math.sin(performance.now() / 700);
    c.fillStyle = '#222';
    c.fillRect(0, 0, 1080, 1920);
    c.drawImage(mundo, -x, -y);
    window.__fimVarredura = t >= 1;
    requestAnimationFrame(quadro);
  }
  quadro();
  navigator.mediaDevices.getUserMedia = async () => cam.captureStream(30);
}

const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const contexto = await navegador.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: captura ? 2 : 1,
  isMobile: true,
  hasTouch: true,
});
const pagina = await contexto.newPage();
pagina.on('pageerror', (e) => console.log('ERRO NA PÁGINA:', e.message));
pagina.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await pagina.addInitScript(instalarCameraSimulada);
await pagina.goto(url);
await pagina.getByRole('button', { name: 'Abrir câmera' }).click();
await pagina.waitForFunction(() => window.__fimVarredura === true, null, { timeout: 120000 });
await pagina.waitForTimeout(1500);

const total = Number(await pagina.getByTestId('total').innerText());
const codigos = Number(await pagina.getByTestId('codigos').innerText());
const tecnico = await pagina.getByTestId('tecnico').innerText();
const esperado = await pagina.evaluate(() => window.__prateleira);
if (captura) await pagina.screenshot({ path: captura });
await navegador.close();

console.log(`contadas ${total} de ${esperado.caixas} caixas; ${codigos} de ${esperado.codigos} códigos; ${tecnico}`);
if (total !== esperado.caixas || codigos !== esperado.codigos) {
  console.log('FALHOU');
  process.exit(1);
}
console.log('OK');
