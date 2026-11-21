// Prateleira simulada para testar o rastreador sem câmera.
// Unidades em "pixels de mapa": etiqueta com 150 de largura, caixas a cada
// 400 na horizontal e 380 na vertical (cerca de 2,5 larguras de etiqueta).

export function aleatorio(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd) {
  return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

// eans: matriz [linha][coluna] de códigos. Códigos repetidos lado a lado são
// caixas diferentes.
export function prateleira(eans, { passoX = 400, passoY = 380, w = 150, origemX = 0 } = {}) {
  const caixas = [];
  eans.forEach((linha, l) =>
    linha.forEach((ean, c) => {
      if (ean) caixas.push({ ean, x: origemX + c * passoX, y: l * passoY, w });
    }),
  );
  return caixas;
}

// Gera os quadros de uma varredura. caminho: [{ cx, cy, zoom }] por quadro.
export function* varrer(caixas, caminho, opcoes = {}) {
  const {
    largura = 1080,
    altura = 1920,
    taxaLeitura = 0.7,
    ruido = 4,
    ruidoMovimento = 6,
    movimentoDisponivel = 0.9,
    intervaloMs = 100,
    inicioMs = 0,
    rnd = aleatorio(1),
  } = opcoes;
  let anterior = null;
  let agora = inicioMs;
  for (const pose of caminho) {
    const zoom = pose.zoom ?? 1;
    const ox = largura / 2 - zoom * pose.cx;
    const oy = altura / 2 - zoom * pose.cy;
    const deteccoes = [];
    for (const c of caixas) {
      const x = zoom * c.x + ox;
      const y = zoom * c.y + oy;
      const w = zoom * c.w;
      if (x < w / 2 || y < w / 2 || x > largura - w / 2 || y > altura - w / 2) continue;
      if (rnd() > taxaLeitura) continue;
      deteccoes.push({
        caixa: c,
        ean: c.ean,
        x: x + ruido * gauss(rnd),
        y: y + ruido * gauss(rnd),
        w: w * (1 + 0.03 * gauss(rnd)),
      });
    }
    let movimento = null;
    if (anterior && !pose.salto && rnd() < movimentoDisponivel) {
      movimento = {
        dx: ox - anterior.ox + ruidoMovimento * gauss(rnd),
        dy: oy - anterior.oy + ruidoMovimento * gauss(rnd),
      };
    }
    anterior = { ox, oy };
    yield { deteccoes, movimento, agora };
    agora += pose.pausaMs ?? intervaloMs;
  }
}

// Caminho em linha reta entre dois pontos, em n quadros.
export function trecho(de, ate, n) {
  const pontos = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1);
    pontos.push({
      cx: de.cx + f * (ate.cx - de.cx),
      cy: de.cy + f * (ate.cy - de.cy),
      zoom: (de.zoom ?? 1) + f * ((ate.zoom ?? 1) - (de.zoom ?? 1)),
    });
  }
  return pontos;
}

export function contarPorEan(caixas) {
  const m = {};
  for (const c of caixas) m[c.ean] = (m[c.ean] || 0) + 1;
  return m;
}
