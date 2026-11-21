// Laço de varredura: câmera -> leitor -> rastreador -> eventos para a tela.
// Não depende do React, para a tela da Fase 1 reaproveitar.
import { criarLeitor } from './leitor.js';
import { Rastreador } from './rastreador.js';
import { estimarMovimento, paraCinza } from './movimento.js';

const RESOLUCOES = {
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

const MINIATURA = 64; // largura da miniatura usada para medir o movimento
const ALCANCE = 16; // deslocamento máximo medido, em pixels da miniatura (25%)

export class Varredura {
  // aoAtualizar(estado) é chamado a cada quadro processado.
  // aoContar(caixa) é chamado a cada caixa nova.
  constructor({ video, aoAtualizar, aoContar }) {
    this.video = video;
    this.aoAtualizar = aoAtualizar;
    this.aoContar = aoContar;
    this.rastreador = new Rastreador();
    this.leitor = null;
    this.stream = null;
    this.ativo = false;
    this.pausado = false;
    this.geracao = 0;
    this.mini = document.createElement('canvas');
    this.miniCtx = this.mini.getContext('2d', { willReadFrequently: true });
    this.cinzaAnterior = null;
    this.tempos = [];
  }

  async iniciar({ motor = 'auto', resolucao = '1080p' } = {}) {
    await this.parar();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Câmera indisponível. Abra a página por HTTPS.');
    }
    const geracao = ++this.geracao;
    const r = RESOLUCOES[resolucao] || RESOLUCOES['1080p'];
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: r.width },
        height: { ideal: r.height },
      },
    });
    const leitor = await criarLeitor(motor).catch((erro) => {
      stream.getTracks().forEach((t) => t.stop());
      throw erro;
    });
    if (geracao !== this.geracao) {
      stream.getTracks().forEach((t) => t.stop());
      leitor.encerrar();
      return;
    }
    this.stream = stream;
    this.leitor = leitor;
    const faixa = stream.getVideoTracks()[0];
    // Foco contínuo, quando o aparelho permite escolher.
    try {
      const cap = faixa.getCapabilities?.() || {};
      if (cap.focusMode?.includes('continuous')) {
        await faixa.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
      this.temLanterna = Boolean(cap.torch);
    } catch {
      this.temLanterna = false;
    }
    this.video.srcObject = stream;
    await this.video.play();
    this.ativo = true;
    this.pausado = false;
    this.cinzaAnterior = null;
    this.#ciclo(geracao);
  }

  async parar() {
    this.geracao++;
    this.ativo = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.leitor?.encerrar();
    this.leitor = null;
    if (this.video) this.video.srcObject = null;
  }

  pausar(valor) {
    this.pausado = valor;
    if (valor) this.cinzaAnterior = null;
  }

  async lanterna(ligada) {
    const faixa = this.stream?.getVideoTracks()[0];
    if (!faixa) return false;
    try {
      await faixa.applyConstraints({ advanced: [{ torch: ligada }] });
      return true;
    } catch {
      return false;
    }
  }

  zerar() {
    this.rastreador.reiniciar();
    this.cinzaAnterior = null;
  }

  desfazerUltima() {
    return this.rastreador.desfazerUltima();
  }

  caixas() {
    return this.rastreador.caixas();
  }

  #medirMovimento(largura, altura) {
    const mw = MINIATURA;
    const mh = Math.max(8, Math.round((MINIATURA * altura) / largura));
    if (this.mini.width !== mw || this.mini.height !== mh) {
      this.mini.width = mw;
      this.mini.height = mh;
      this.cinzaAnterior = null;
    }
    this.miniCtx.drawImage(this.video, 0, 0, mw, mh);
    const cinza = paraCinza(this.miniCtx.getImageData(0, 0, mw, mh).data, new Uint8Array(mw * mh));
    let movimento = null;
    if (this.cinzaAnterior) {
      const m = estimarMovimento(this.cinzaAnterior, cinza, mw, mh, ALCANCE);
      if (m) movimento = { dx: (m.dx * largura) / mw, dy: (m.dy * altura) / mh };
    }
    this.cinzaAnterior = cinza;
    return movimento;
  }

  async #ciclo(geracao) {
    const quadro = () => new Promise((ok) => requestAnimationFrame(ok));
    while (this.ativo && geracao === this.geracao) {
      const video = this.video;
      if (this.pausado || video.readyState < 2 || !video.videoWidth) {
        await quadro();
        continue;
      }
      const largura = video.videoWidth;
      const altura = video.videoHeight;
      const inicio = performance.now();
      let deteccoes = [];
      let erro = null;
      const movimento = this.#medirMovimento(largura, altura);
      try {
        deteccoes = await this.leitor.ler(video);
      } catch (e) {
        erro = String(e?.message || e);
      }
      if (geracao !== this.geracao) return;
      const resultado = this.rastreador.atualizar(deteccoes, movimento, Date.now());
      for (const caixa of resultado.novas) this.aoContar?.(caixa);

      this.tempos.push(performance.now() - inicio);
      if (this.tempos.length > 20) this.tempos.shift();
      const msPorQuadro = this.tempos.reduce((a, b) => a + b, 0) / this.tempos.length;

      this.aoAtualizar?.({
        largura,
        altura,
        motor: this.leitor.nome,
        lidasNoQuadro: deteccoes.length,
        msPorQuadro,
        perdido: resultado.perdido,
        marcas: this.rastreador.visiveis(largura, altura),
        erro,
      });
      await quadro();
    }
  }
}
