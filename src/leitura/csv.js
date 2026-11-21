// CSV da prova de leitura: uma linha por caixa contada, na ordem da leitura.
// Separador ponto e vírgula e BOM, para abrir direto no Excel em português.
export function gerarCsv(caixas) {
  const linhas = ['ordem;ean;hora;metodo;quadros_lidos'];
  caixas.forEach((c, i) => {
    linhas.push(
      [i + 1, c.ean, new Date(c.contadaEm).toISOString(), c.metodo, c.leituras].join(';'),
    );
  });
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

export function resumoPorEan(caixas) {
  const mapa = new Map();
  for (const c of caixas) mapa.set(c.ean, (mapa.get(c.ean) || 0) + 1);
  return [...mapa.entries()].map(([ean, quantidade]) => ({ ean, quantidade }));
}
