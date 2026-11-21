import { describe, it, expect } from 'vitest';
import { Rastreador } from '../src/leitura/rastreador.js';
import { prateleira, varrer, trecho, contarPorEan, aleatorio } from './simulador.js';

const A = '7909276583022';
const B = '7891234567895';
const C = '7890000000017';
const D = '7890000000024';
const E = '7890000000031';

function rodar(rastreador, caixas, caminho, opcoes, lidas) {
  let ultimo = 0;
  for (const q of varrer(caixas, caminho, opcoes)) {
    rastreador.atualizar(q.deteccoes, q.movimento, q.agora);
    if (lidas) for (const d of q.deteccoes) lidas.set(d.caixa, (lidas.get(d.caixa) || 0) + 1);
    ultimo = q.agora;
  }
  return ultimo;
}

// Prateleira com 12 colunas e 5 linhas; várias caixas iguais vizinhas.
const linhas = [
  [A, A, A, B, B, C, D, D, D, D, E, A],
  [A, A, B, B, C, C, D, E, E, E, E, A],
  [B, B, B, B, C, D, D, D, E, A, A, A],
  [C, C, C, D, D, D, E, E, E, E, B, B],
  [A, B, C, D, E, A, B, C, D, E, A, B],
];
const caixas = prateleira(linhas);
const esperado = contarPorEan(caixas);
const larguraTotal = 11 * 400;

// Varredura em ziguezague cobrindo a prateleira toda.
function ziguezague(quadrosPorPassada = 60) {
  return [
    ...trecho({ cx: 0, cy: 300 }, { cx: 0, cy: 300 }, 8),
    ...trecho({ cx: 0, cy: 300 }, { cx: larguraTotal, cy: 300 }, quadrosPorPassada),
    ...trecho({ cx: larguraTotal, cy: 300 }, { cx: larguraTotal, cy: 1200 }, 12),
    ...trecho({ cx: larguraTotal, cy: 1200 }, { cx: 0, cy: 1200 }, quadrosPorPassada),
    ...trecho({ cx: 0, cy: 1200 }, { cx: 0, cy: 1200 }, 8),
  ];
}

describe('rastreador de caixas', () => {
  it('conta caixas iguais lado a lado uma a uma', () => {
    const r = new Rastreador();
    const duas = prateleira([[A, A]]);
    rodar(r, duas, trecho({ cx: 200, cy: 0 }, { cx: 200, cy: 0 }, 10), { taxaLeitura: 1 });
    expect(r.caixas().length).toBe(2);
  });

  it('não conta a mesma caixa de novo com a câmera parada', () => {
    const r = new Rastreador();
    const uma = prateleira([[A]]);
    rodar(r, uma, trecho({ cx: 0, cy: 0 }, { cx: 0, cy: 0 }, 200), { taxaLeitura: 0.8 });
    expect(r.caixas().length).toBe(1);
  });

  it('uma leitura isolada não conta (precisa repetir)', () => {
    const r = new Rastreador();
    r.atualizar([{ ean: A, x: 500, y: 500, w: 150 }], null, 0);
    r.atualizar([], null, 100);
    expect(r.caixas().length).toBe(0);
  });

  it('varredura completa em ziguezague bate com a prateleira', () => {
    for (let semente = 1; semente <= 20; semente++) {
      const r = new Rastreador();
      rodar(r, caixas, ziguezague(), { rnd: aleatorio(semente) });
      expect(contarPorEan(r.caixas()), `semente ${semente}`).toEqual(esperado);
    }
  });

  it('aguenta leitura fraca, tremor e aproximação da câmera', () => {
    // Com 45% de leitura por quadro, uma ou outra caixa pode nunca ser lida
    // duas vezes; essas não são erro do rastreador e ficam fora da conta.
    for (let semente = 1; semente <= 60; semente++) {
      const r = new Rastreador();
      const caminho = ziguezague(90).map((p, i) => ({
        ...p,
        zoom: 1 + 0.15 * Math.sin(i / 9),
        cy: p.cy + 30 * Math.sin(i / 3),
      }));
      const lidas = new Map();
      rodar(
        r,
        caixas,
        caminho,
        { rnd: aleatorio(100 + semente), taxaLeitura: 0.45, ruido: 8, movimentoDisponivel: 0.7 },
        lidas,
      );
      const legiveis = caixas.filter((c) => (lidas.get(c) || 0) >= 2);
      expect(legiveis.length).toBeGreaterThanOrEqual(58);
      expect(contarPorEan(r.caixas()), `semente ${semente}`).toEqual(contarPorEan(legiveis));
    }
  });

  it('passar de novo pelas mesmas caixas não duplica', () => {
    const r = new Rastreador();
    const ida = trecho({ cx: 0, cy: 300 }, { cx: larguraTotal, cy: 300 }, 60);
    rodar(r, caixas, [...ida, ...[...ida].reverse(), ...ida], { rnd: aleatorio(7) });
    const vistas = caixas.filter((c) => c.y <= 300 + 960 - 75);
    expect(contarPorEan(r.caixas())).toEqual(contarPorEan(vistas));
  });

  it('reencontra a posição depois de um tempo sem ler nada', () => {
    const r = new Rastreador();
    const ida = trecho({ cx: 0, cy: 300 }, { cx: 1600, cy: 300 }, 30);
    const fim = rodar(r, caixas, ida, { rnd: aleatorio(3) });
    const antes = r.caixas().length;
    // Câmera abaixada por 5 segundos, volta apontando para outro ponto já
    // contado, sem informação de movimento.
    const volta = trecho({ cx: 600, cy: 350 }, { cx: 600, cy: 350 }, 20);
    volta[0].salto = true;
    rodar(r, caixas, volta, { rnd: aleatorio(4), inicioMs: fim + 5000 });
    expect(r.caixas().length).toBe(antes);
  });

  it('outra prateleira com os mesmos códigos conta como caixas novas', () => {
    const r = new Rastreador();
    const p1 = prateleira([[A, B], [C, D]]);
    const fim = rodar(r, p1, trecho({ cx: 200, cy: 190 }, { cx: 200, cy: 190 }, 10), { taxaLeitura: 1 });
    expect(r.caixas().length).toBe(4);
    // Arranjo diferente dos mesmos códigos: não é a mesma prateleira.
    const p2 = prateleira([[D, A], [B, C]]);
    const caminho = trecho({ cx: 200, cy: 190 }, { cx: 200, cy: 190 }, 30);
    caminho[0].salto = true;
    rodar(r, p2, caminho, { taxaLeitura: 1, inicioMs: fim + 4000 });
    expect(r.caixas().length).toBe(8);
  });

  it('desfazer tira a última caixa e não a reconta em seguida', () => {
    const r = new Rastreador();
    const duas = prateleira([[A, B]]);
    const parado = trecho({ cx: 200, cy: 0 }, { cx: 200, cy: 0 }, 10);
    const fim = rodar(r, duas, parado, { taxaLeitura: 1 });
    expect(r.caixas().length).toBe(2);
    const desfeita = r.desfazerUltima();
    expect(desfeita).not.toBeNull();
    rodar(r, duas, parado, { taxaLeitura: 1, inicioMs: fim + 100 });
    expect(r.caixas().length).toBe(1);
  });

  it('ignora leitura de outro código em cima de caixa já contada', () => {
    const r = new Rastreador();
    const parado = { dx: 0, dy: 0 };
    for (let i = 0; i < 5; i++) r.atualizar([{ ean: A, x: 500, y: 500, w: 150 }], parado, i * 100);
    for (let i = 5; i < 10; i++) r.atualizar([{ ean: B, x: 505, y: 500, w: 150 }], parado, i * 100);
    expect(r.caixas().map((c) => c.ean)).toEqual([A]);
  });
});
