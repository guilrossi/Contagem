import { describe, it, expect } from 'vitest';
import { eanValido } from '../src/leitura/ean.js';
import { gerarCsv, resumoPorEan } from '../src/leitura/csv.js';
import { estimarMovimento } from '../src/leitura/movimento.js';
import { aleatorio } from './simulador.js';

describe('EAN-13', () => {
  it('aceita código com dígito verificador certo', () => {
    expect(eanValido('7909276583022')).toBe(true);
    expect(eanValido('7891234567895')).toBe(true);
  });
  it('recusa dígito errado, tamanho errado e letras', () => {
    expect(eanValido('7909276583023')).toBe(false);
    expect(eanValido('20010146')).toBe(false);
    expect(eanValido('79092765830AB')).toBe(false);
  });
});

describe('CSV', () => {
  it('gera uma linha por caixa, na ordem', () => {
    const caixas = [
      { ean: '7909276583022', contadaEm: 0, metodo: 'camera', leituras: 5 },
      { ean: '7909276583022', contadaEm: 1000, metodo: 'camera', leituras: 3 },
    ];
    const linhas = gerarCsv(caixas).replace('﻿', '').trim().split('\r\n');
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toBe('1;7909276583022;1970-01-01T00:00:00.000Z;camera;5');
    expect(resumoPorEan(caixas)).toEqual([{ ean: '7909276583022', quantidade: 2 }]);
  });
});

describe('movimento da imagem', () => {
  const L = 64;
  const H = 96;
  function cena(rnd) {
    // Textura suave e não repetitiva, maior que o quadro.
    const W = 160;
    const base = new Float32Array(W * W);
    for (let i = 0; i < base.length; i++) base[i] = rnd() * 255;
    const suave = new Float32Array(W * W);
    for (let y = 2; y < W - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        let s = 0;
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) s += base[(y + j) * W + x + i];
        suave[y * W + x] = s / 25;
      }
    const min = Math.min(...suave.slice(W * 2 + 2, W * 3));
    return (ox, oy) => {
      const q = new Uint8Array(L * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < L; x++) q[y * L + x] = Math.max(0, Math.min(255, (suave[(y + oy) * W + x + ox] - min + 60) * 1.2));
      return q;
    };
  }

  it('mede o deslocamento entre dois quadros', () => {
    const recorte = cena(aleatorio(9));
    const a = recorte(30, 30);
    // Câmera andou 7 para a direita e 3 para baixo: conteúdo anda ao contrário.
    const b = recorte(37, 33);
    expect(estimarMovimento(a, b, L, H, 16)).toEqual({ dx: -7, dy: -3 });
  });

  it('câmera parada dá zero', () => {
    const recorte = cena(aleatorio(10));
    const a = recorte(30, 30);
    expect(estimarMovimento(a, a, L, H, 16)).toEqual({ dx: 0, dy: 0 });
  });

  it('imagem lisa não dá resposta', () => {
    const a = new Uint8Array(L * H).fill(120);
    expect(estimarMovimento(a, a, L, H, 16)).toBeNull();
  });
});
