// Movimento global da imagem entre dois quadros, por comparação de miniaturas
// em tons de cinza. Serve para o rastreador saber para onde a câmera foi nos
// quadros em que nenhuma etiqueta conhecida foi lida (borrão, espaço vazio).
//
// Sem dependência do navegador: recebe as miniaturas já como vetores de brilho.

// anterior, atual: Uint8Array de largura*altura. Devolve { dx, dy } em pixels
// da miniatura (o conteúdo que estava em (x, y) está agora em (x+dx, y+dy)),
// ou null quando a imagem não tem textura suficiente para decidir.
export function estimarMovimento(anterior, atual, largura, altura, alcance) {
  const maxX = Math.min(alcance, (largura >> 1) - 2);
  const maxY = Math.min(alcance, (altura >> 1) - 2);
  let melhor = Infinity;
  let melhorDx = 0;
  let melhorDy = 0;
  let soma = 0;
  let n = 0;
  let noZero = Infinity;

  for (let dy = -maxY; dy <= maxY; dy++) {
    const y0 = Math.max(0, -dy);
    const y1 = Math.min(altura, altura - dy);
    for (let dx = -maxX; dx <= maxX; dx++) {
      const x0 = Math.max(0, -dx);
      const x1 = Math.min(largura, largura - dx);
      let erro = 0;
      let pontos = 0;
      for (let y = y0; y < y1; y += 2) {
        const la = y * largura;
        const lb = (y + dy) * largura + dx;
        for (let x = x0; x < x1; x += 2) {
          const d = anterior[la + x] - atual[lb + x];
          erro += d < 0 ? -d : d;
          pontos++;
        }
      }
      const medio = erro / pontos;
      soma += medio;
      n++;
      if (dx === 0 && dy === 0) noZero = medio;
      if (medio < melhor) {
        melhor = medio;
        melhorDx = dx;
        melhorDy = dy;
      }
    }
  }

  // Imagem lisa ou repetitiva demais: o melhor encaixe não se destaca.
  const media = soma / n;
  if (media < 2 || melhor > 0.6 * media) return null;
  // Na dúvida entre parado e um deslocamento quase igual, fica parado.
  if (noZero <= melhor * 1.05) return { dx: 0, dy: 0 };
  return { dx: melhorDx, dy: melhorDy };
}

// Converte RGBA (ImageData.data) em brilho.
export function paraCinza(rgba, destino) {
  for (let i = 0, j = 0; j < destino.length; i += 4, j++) {
    destino[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return destino;
}
