// Leitores de código de barras atrás de uma interface comum:
//   ler(video) -> [{ ean, x, y, w, cantos }]  (pixels do quadro da câmera)
//
// Dois motores:
// - 'nativo': API BarcodeDetector do navegador. No Android (Chrome) usa o
//   leitor do próprio aparelho (ML Kit): rápido e lê vários códigos por quadro.
// - 'zxing': zxing-cpp em WebAssembly. Funciona em qualquer navegador,
//   inclusive no iPhone, onde a API nativa não está disponível.
// 'auto' escolhe o nativo quando existe e lê EAN-13, senão o zxing.
import { eanValido } from './ean.js';

function medir(cantos) {
  const [a, b, c, d] = cantos;
  const x = (a.x + b.x + c.x + d.x) / 4;
  const y = (a.y + b.y + c.y + d.y) / 4;
  const w = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
  return { x, y, w };
}

function normalizar(lista) {
  const saida = [];
  for (const { texto, cantos } of lista) {
    if (!eanValido(texto) || cantos.length !== 4) continue;
    const m = medir(cantos);
    if (m.w < 8) continue;
    saida.push({ ean: texto, ...m, cantos });
  }
  return saida;
}

export async function nativoDisponivel() {
  if (!('BarcodeDetector' in globalThis)) return false;
  try {
    const formatos = await globalThis.BarcodeDetector.getSupportedFormats();
    return formatos.includes('ean_13');
  } catch {
    return false;
  }
}

function criarNativo() {
  const detector = new globalThis.BarcodeDetector({ formats: ['ean_13'] });
  return {
    nome: 'nativo',
    async ler(video) {
      const lidos = await detector.detect(video);
      return normalizar(lidos.map((r) => ({ texto: r.rawValue, cantos: r.cornerPoints || [] })));
    },
    encerrar() {},
  };
}

async function criarZxing() {
  const worker = new Worker(new URL('./zxing.worker.js', import.meta.url), { type: 'module' });
  let proximo = 1;
  const pendentes = new Map();
  worker.onmessage = (e) => {
    const p = pendentes.get(e.data.id);
    if (!p) return;
    pendentes.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.resultados);
    else p.reject(new Error(e.data.erro));
  };
  worker.onerror = (e) => {
    for (const p of pendentes.values()) p.reject(new Error(e.message || 'Falha no leitor'));
    pendentes.clear();
  };
  const pedir = (mensagem, transferir = []) =>
    new Promise((resolve, reject) => {
      const id = proximo++;
      pendentes.set(id, { resolve, reject });
      worker.postMessage({ id, ...mensagem }, transferir);
    });
  await pedir({ tipo: 'preparar' });

  const tela = document.createElement('canvas');
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  return {
    nome: 'zxing',
    async ler(video) {
      const largura = video.videoWidth;
      const altura = video.videoHeight;
      if (tela.width !== largura || tela.height !== altura) {
        tela.width = largura;
        tela.height = altura;
      }
      ctx.drawImage(video, 0, 0, largura, altura);
      const { data } = ctx.getImageData(0, 0, largura, altura);
      const lidos = await pedir({ tipo: 'ler', buffer: data.buffer, largura, altura }, [data.buffer]);
      return normalizar(lidos);
    },
    encerrar() {
      worker.terminate();
    },
  };
}

export async function criarLeitor(motor = 'auto') {
  if (motor === 'nativo' || (motor === 'auto' && (await nativoDisponivel()))) {
    if (!(await nativoDisponivel())) throw new Error('Este navegador não tem leitor nativo de EAN-13.');
    return criarNativo();
  }
  return criarZxing();
}
