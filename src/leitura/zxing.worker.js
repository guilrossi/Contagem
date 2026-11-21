// Leitura de códigos de barras com zxing-cpp compilado para WebAssembly,
// rodando fora da thread da tela para a imagem da câmera não travar.
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// O .wasm é servido junto com o app (nada de CDN): precisa funcionar sem
// internet no estoque.
const pronto = prepareZXingModule({
  overrides: {
    locateFile: (caminho, prefixo) => (caminho.endsWith('.wasm') ? wasmUrl : prefixo + caminho),
  },
  fireImmediately: true,
});

const OPCOES = {
  formats: ['EAN13'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 255,
};

self.onmessage = async (e) => {
  const { id, tipo } = e.data;
  try {
    await pronto;
    if (tipo === 'preparar') {
      self.postMessage({ id, ok: true });
      return;
    }
    const { buffer, largura, altura } = e.data;
    const imagem = new ImageData(new Uint8ClampedArray(buffer), largura, altura);
    const lidos = await readBarcodes(imagem, OPCOES);
    const resultados = lidos
      .filter((r) => r.isValid)
      .map((r) => ({
        texto: r.text,
        cantos: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft],
      }));
    self.postMessage({ id, ok: true, resultados });
  } catch (erro) {
    self.postMessage({ id, ok: false, erro: String(erro?.message || erro) });
  }
};
