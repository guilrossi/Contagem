// Rastreador de etiquetas: transforma as detecções de cada quadro em CAIXAS.
//
// O problema: duas caixas iguais lado a lado têm o mesmo EAN e precisam contar
// como duas; a mesma caixa vista em vários quadros precisa contar como uma.
//
// A solução: manter um "mapa" da prateleira. Cada caixa contada guarda uma
// posição fixa nesse mapa. A cada quadro estimamos onde a câmera está sobre o
// mapa (deslocamento + zoom), usando como âncoras as etiquetas que já
// conhecemos e, quando não há âncora, o movimento da imagem. Uma leitura que
// cai em cima de uma caixa já mapeada com o mesmo EAN é a mesma caixa; uma que
// cai em um lugar vazio é uma caixa nova.
//
// Todas as distâncias são medidas em "larguras de etiqueta", para não depender
// da resolução nem da distância da câmera.
//
// Este módulo não usa nada do navegador, para poder ser testado no Node.

const PADRAO = {
  // Distância máxima (em larguras de etiqueta) para considerar que uma leitura
  // é a mesma caixa já mapeada.
  raio: 0.8,
  // Raio maior, usado só para achar âncoras antes de corrigir a posição.
  raioBusca: 1.2,
  // Quadros em que a etiqueta precisa ser lida para a caixa contar.
  minLeituras: 2,
  // Tentativa não confirmada some depois deste tempo.
  validadeTentativaMs: 1500,
  // Sem âncora, a incerteza da posição cresce a cada quadro: pouco quando o
  // movimento da imagem foi medido (proporcional ao quanto a câmera andou),
  // muito quando não foi. Passando do limite, a câmera se perdeu.
  incertezaPorQuadro: 0.01,
  incertezaPorLargura: 0.1,
  incertezaQuadroCego: 0.35,
  limiteIncerteza: 1,
  // Intervalo entre quadros acima do qual a posição anterior é descartada.
  intervaloMaximoMs: 1000,
  // Depois de se perder, tempo tentando se reencontrar no mapa antes de
  // assumir que é uma área nova.
  esperaReencontroMs: 700,
};

function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export class Rastreador {
  constructor(opcoes = {}) {
    this.op = { ...PADRAO, ...opcoes };
    this.reiniciar();
  }

  reiniciar() {
    this.trilhas = [];
    this.T = { s: 1, tx: 0, ty: 0 }; // quadro = s * mapa + t
    this.regiao = 1;
    this.proxId = 1;
    this.ordem = 0;
    this.incerteza = 0;
    this.perdidoDesde = null;
    this.ultimoQuadro = null;
  }

  paraQuadro(x, y) {
    return { x: this.T.s * x + this.T.tx, y: this.T.s * y + this.T.ty };
  }

  paraMapa(x, y) {
    return { x: (x - this.T.tx) / this.T.s, y: (y - this.T.ty) / this.T.s };
  }

  // deteccoes: [{ ean, x, y, w }] em pixels do quadro (centro e largura).
  // movimento: { dx, dy } deslocamento da imagem desde o quadro anterior, ou
  //            null quando não foi possível medir.
  // Devolve { novas: caixas confirmadas neste quadro, ancoras, perdido }.
  atualizar(deteccoes, movimento, agora) {
    const op = this.op;
    // Intervalo longo entre quadros (pausa, app em segundo plano): o que foi
    // medido antes não vale mais.
    if (this.ultimoQuadro !== null && agora - this.ultimoQuadro > op.intervaloMaximoMs) {
      movimento = null;
      this.incerteza = op.limiteIncerteza;
    }
    this.ultimoQuadro = agora;
    if (movimento) {
      this.T.tx += movimento.dx;
      this.T.ty += movimento.dy;
    }

    const daRegiao = this.trilhas.filter((t) => t.regiao === this.regiao);

    // 1. Âncoras: leituras que batem com caixas já mapeadas.
    let pares = this.#associar(deteccoes, daRegiao, op.raioBusca);
    if (pares.length) {
      this.#corrigirPosicao(pares);
      pares = this.#associar(deteccoes, daRegiao, op.raio);
    }

    // 2. Controle de "perdido": sem âncora por muito tempo, a posição
    // estimada deixa de ser confiável.
    if (pares.length || !daRegiao.length) {
      this.incerteza = 0;
      this.perdidoDesde = null;
    } else {
      if (movimento) {
        const w = mediana(daRegiao.map((t) => t.w)) * this.T.s;
        this.incerteza +=
          op.incertezaPorQuadro +
          (op.incertezaPorLargura * Math.hypot(movimento.dx, movimento.dy)) / w;
      } else {
        this.incerteza += op.incertezaQuadroCego;
      }
      if (this.incerteza >= op.limiteIncerteza && deteccoes.length) {
        const r = this.#tentarReencontro(deteccoes, agora);
        if (r === 'esperar') {
          this.#limparTentativas(agora);
          return { novas: [], ancoras: 0, perdido: true };
        }
        // Reencontrou (ou abriu região nova): refaz a associação.
        const atuais = this.trilhas.filter((t) => t.regiao === this.regiao);
        pares = this.#associar(deteccoes, atuais, op.raio);
        this.incerteza = 0;
        this.perdidoDesde = null;
      }
    }

    // 3. Atualiza as caixas reencontradas.
    const novas = [];
    const usadas = new Set();
    for (const { d, t } of pares) {
      usadas.add(d);
      const p = this.paraMapa(d.x, d.y);
      t.x += 0.2 * (p.x - t.x);
      t.y += 0.2 * (p.y - t.y);
      t.w += 0.2 * (d.w / this.T.s - t.w);
      t.leituras++;
      t.vistaEm = agora;
      if (!t.confirmada && t.leituras >= op.minLeituras) this.#confirmar(t, agora, novas);
    }

    // 4. Leituras sem par viram caixas novas (ainda não confirmadas).
    const atuais = this.trilhas.filter((t) => t.regiao === this.regiao);
    for (const d of deteccoes) {
      if (usadas.has(d)) continue;
      const p = this.paraMapa(d.x, d.y);
      const w = d.w / this.T.s;
      // Duas etiquetas não ocupam o mesmo lugar: leitura de outro código em
      // cima de uma caixa já contada é erro de leitura.
      const emCima = atuais.some(
        (t) => t.confirmada && t.ean !== d.ean && Math.hypot(t.x - p.x, t.y - p.y) < 0.3 * t.w,
      );
      if (emCima) continue;
      const t = {
        id: this.proxId++,
        regiao: this.regiao,
        ean: d.ean,
        x: p.x,
        y: p.y,
        w,
        leituras: 1,
        vistaEm: agora,
        confirmada: false,
        ignorada: false,
        metodo: 'camera',
      };
      this.trilhas.push(t);
      atuais.push(t);
      if (op.minLeituras <= 1) this.#confirmar(t, agora, novas);
    }

    this.#limparTentativas(agora);
    return { novas, ancoras: pares.length, perdido: false };
  }

  #confirmar(t, agora, novas) {
    t.confirmada = true;
    t.contadaEm = agora;
    t.ordem = ++this.ordem;
    novas.push(t);
  }

  #limparTentativas(agora) {
    const validade = this.op.validadeTentativaMs;
    this.trilhas = this.trilhas.filter((t) => t.confirmada || agora - t.vistaEm <= validade);
  }

  // Casa leituras com caixas do mesmo EAN, da mais próxima para a mais
  // distante, uma para uma.
  #associar(deteccoes, trilhas, raio) {
    const candidatos = [];
    for (const d of deteccoes) {
      const p = this.paraMapa(d.x, d.y);
      for (const t of trilhas) {
        if (t.ean !== d.ean) continue;
        const dist = Math.hypot(t.x - p.x, t.y - p.y) / t.w;
        if (dist < raio) candidatos.push({ d, t, dist });
      }
    }
    candidatos.sort((a, b) => a.dist - b.dist);
    const ds = new Set();
    const ts = new Set();
    const pares = [];
    for (const c of candidatos) {
      if (ds.has(c.d) || ts.has(c.t)) continue;
      ds.add(c.d);
      ts.add(c.t);
      pares.push(c);
    }
    return pares;
  }

  // Ajusta zoom e deslocamento da câmera sobre o mapa a partir das âncoras.
  // Mediana, para uma âncora errada não puxar o resultado.
  #corrigirPosicao(pares) {
    let s = this.T.s;
    const razoes = [];
    for (let i = 0; i < pares.length; i++) {
      for (let j = i + 1; j < pares.length; j++) {
        const a = pares[i];
        const b = pares[j];
        const noMapa = Math.hypot(a.t.x - b.t.x, a.t.y - b.t.y);
        if (noMapa < 1.5 * a.t.w) continue;
        razoes.push(Math.hypot(a.d.x - b.d.x, a.d.y - b.d.y) / noMapa);
      }
    }
    // O zoom muda devagar, então a medida de cada quadro entra amortecida:
    // mais peso quando vem da distância entre duas etiquetas, menos quando
    // vem só da largura de uma (que oscila mais).
    if (razoes.length) {
      s += 0.6 * (mediana(razoes) - s);
    } else {
      s += 0.3 * (s * mediana(pares.map((p) => p.d.w / (s * p.t.w))) - s);
    }
    s = Math.min(Math.max(s, this.T.s * 0.8), this.T.s * 1.25);
    this.T.s = s;
    this.T.tx = mediana(pares.map((p) => p.d.x - s * p.t.x));
    this.T.ty = mediana(pares.map((p) => p.d.y - s * p.t.y));
  }

  // A câmera se perdeu. Procura no mapa um conjunto de caixas conhecidas que
  // explique as leituras atuais: duas ou mais leituras apontando para a mesma
  // posição da câmera, sem empate, e cobrindo mais da metade das leituras de
  // códigos conhecidos (senão é só coincidência de códigos em outra área). Se nenhuma leitura é de código conhecido,
  // ou se o tempo de espera acaba, abre uma região nova do mapa.
  #tentarReencontro(deteccoes, agora) {
    const confirmadas = this.trilhas.filter((t) => t.confirmada);
    const candidatos = [];
    for (const d of deteccoes) {
      for (const t of confirmadas) {
        if (t.ean !== d.ean) continue;
        const s = d.w / t.w;
        candidatos.push({ d, t, s, tx: d.x - s * t.x, ty: d.y - s * t.y });
      }
    }
    if (!candidatos.length) {
      this.#novaRegiao();
      return 'nova';
    }

    let melhor = null;
    const grupos = candidatos.map((c) => {
      const ds = new Set();
      const ts = new Set();
      const membros = [];
      for (const o of candidatos) {
        if (o.t.regiao !== c.t.regiao || ds.has(o.d) || ts.has(o.t)) continue;
        const tol = 0.5 * o.d.w;
        if (Math.abs(o.tx - c.tx) < tol && Math.abs(o.ty - c.ty) < tol) {
          ds.add(o.d);
          ts.add(o.t);
          membros.push(o);
        }
      }
      return membros;
    });
    for (const g of grupos) if (!melhor || g.length > melhor.length) melhor = g;
    const doMelhor = new Set(melhor);
    let segundo = 0;
    candidatos.forEach((c, i) => {
      if (!doMelhor.has(c)) segundo = Math.max(segundo, grupos[i].length);
    });

    const conhecidas = new Set(candidatos.map((c) => c.d)).size;
    if (melhor.length >= 2 && melhor.length > segundo && melhor.length * 2 > conhecidas) {
      this.regiao = melhor[0].t.regiao;
      this.T.s = mediana(melhor.map((c) => c.s));
      this.T.tx = mediana(melhor.map((c) => c.d.x - this.T.s * c.t.x));
      this.T.ty = mediana(melhor.map((c) => c.d.y - this.T.s * c.t.y));
      return 'reencontrou';
    }

    if (this.perdidoDesde === null) this.perdidoDesde = agora;
    if (agora - this.perdidoDesde < this.op.esperaReencontroMs) return 'esperar';
    this.#novaRegiao();
    return 'nova';
  }

  #novaRegiao() {
    this.regiao++;
    this.T.tx = 0;
    this.T.ty = 0;
  }

  // Caixas contadas, na ordem em que foram contadas.
  caixas() {
    return this.trilhas
      .filter((t) => t.confirmada && !t.ignorada)
      .sort((a, b) => a.ordem - b.ordem);
  }

  // Marca a última caixa contada como ignorada. Ela continua no mapa para
  // não ser contada de novo enquanto a câmera ainda está sobre ela.
  desfazerUltima() {
    const lista = this.caixas();
    const ultima = lista[lista.length - 1];
    if (ultima) ultima.ignorada = true;
    return ultima || null;
  }

  // Caixas da região atual que caem dentro do quadro, em pixels do quadro.
  // Usado para desenhar as marcas na tela.
  visiveis(largura, altura) {
    const saida = [];
    for (const t of this.trilhas) {
      if (t.regiao !== this.regiao) continue;
      const p = this.paraQuadro(t.x, t.y);
      const w = t.w * this.T.s;
      if (p.x < -w || p.y < -w || p.x > largura + w || p.y > altura + w) continue;
      saida.push({ id: t.id, ean: t.ean, x: p.x, y: p.y, w, confirmada: t.confirmada, ignorada: t.ignorada });
    }
    return saida;
  }
}
