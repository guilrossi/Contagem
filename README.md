# Contagem de estoque por câmera

Piloto do Grupo Rossi: a equipe da loja conta o estoque pelo celular, seção por
seção, lendo as etiquetas EAN-13 das caixas com a câmera.

**Estado atual: Fase 0, prova da leitura.** Só existe a página de teste da
câmera. Login, seções, painel, divergências e exportação para o ERP vêm nas
fases seguintes, depois que a leitura for validada com caixas reais.

## O que a página faz

- Abre a câmera traseira em Full HD (ou 4K, nos ajustes).
- Lê vários códigos EAN-13 por quadro, sem parar.
- Conta **caixas**, não códigos: duas caixas iguais lado a lado contam como duas,
  e a mesma caixa vista várias vezes conta como uma.
- Mostra uma marca verde sobre cada etiqueta já contada (amarela enquanto a
  leitura ainda não foi confirmada).
- Botões: desfazer última, pausar, zerar, lanterna (quando o aparelho tem) e
  exportar CSV (uma linha por caixa: ordem, EAN, hora, método, quadros lidos).

## Como subir em HTTPS na rede da loja

O navegador do celular só libera a câmera em página HTTPS. O servidor já sobe
com um certificado autoassinado.

1. Em um computador ligado ao mesmo Wi-Fi dos celulares, com Node.js 20 ou
   mais novo:

   ```
   npm install
   npm run build
   npm run preview
   ```

2. O terminal mostra um endereço `Network`, por exemplo
   `https://192.168.0.25:4173/`. Abra esse endereço no celular.
3. O navegador avisa que a conexão não é particular (o certificado é
   autoassinado). Toque em **Avançado** e depois em **Ir para o site**
   (Chrome), ou **Mostrar detalhes** e **Visitar este site** (Safari).
4. Toque em **Abrir câmera** e permita o uso da câmera.

Se o celular não abrir a página, o firewall do computador pode estar
bloqueando a porta 4173.

## Como testar com caixas reais

1. Escolha uma prateleira e conte as caixas à mão antes (por exemplo, 50
   caixas, incluindo algumas iguais lado a lado).
2. Segure o celular a um ou dois palmos das etiquetas e passe devagar, linha
   por linha. Confira se toda etiqueta ficou verde antes de seguir.
3. Compare o total da tela com a contagem manual e exporte o CSV.
4. Repita no Android e no iPhone, e com a prateleira mal iluminada.
5. Nos ajustes (engrenagem) dá para trocar o leitor e a resolução. A linha
   pequena no topo mostra o leitor em uso, a resolução real da câmera, o tempo
   por quadro e quantas etiquetas foram lidas no quadro.

Anote: caixas que não leram, caixas contadas em dobro, caixas iguais contadas
como uma só, e o tempo por prateleira.

## Leitor escolhido

| Opção | Vários códigos por quadro | Android (Chrome) | iPhone (Safari) |
| --- | --- | --- | --- |
| API nativa `BarcodeDetector` | Sim | Sim, usa o leitor do aparelho | Não disponível |
| zxing-cpp em WebAssembly (`zxing-wasm`) | Sim | Sim | Sim |
| QuaggaJS, html5-qrcode | Um por vez, na prática | Sim | Sim |

A página usa a **API nativa quando o navegador tem** (Android) e o **zxing em
WebAssembly no resto** (iPhone). O nativo é o mais rápido e roda fora do
JavaScript; o zxing é o único com leitura de vários códigos por quadro que
funciona nos dois sistemas, e vai junto com o app, sem depender de internet.
As bibliotecas que leem um código por vez ficaram de fora porque o objetivo é
varrer a prateleira sem parar em cada caixa.

Essa escolha foi feita por compatibilidade e por teste em computador. **A taxa
de leitura em aparelho real ainda não foi medida**: é o que o teste acima
responde, e os ajustes permitem comparar os dois leitores no mesmo celular.

## Como a contagem de caixas funciona

O app monta um mapa da prateleira enquanto a câmera anda. Cada caixa contada
ganha uma posição fixa nesse mapa. A cada quadro, as etiquetas já conhecidas
servem de âncora para saber onde a câmera está; quando nenhuma é lida, o
movimento da própria imagem cobre o intervalo. Leitura em cima de uma caixa já
mapeada com o mesmo código é a mesma caixa; leitura em lugar vazio é caixa
nova. Uma etiqueta precisa ser lida em dois quadros para contar, e o dígito
verificador do EAN é conferido.

Limites conhecidos:

- Etiquetas iguais precisam estar a mais de uma largura de etiqueta uma da
  outra (caixas empilhadas normalmente ficam a duas ou três).
- Se a câmera ficar muito tempo sem ler nada e depois voltar a uma área já
  contada vendo uma etiqueta só, o app não tem como saber que é a mesma caixa
  e pode contar de novo. Com duas ou mais etiquetas à vista ele se reencontra.

Se o teste com caixas reais mostrar contagem em dobro ou caixas engolidas, a
alternativa é a varredura guiada: o contador fotografa a prateleira parte por
parte, com a câmera parada, e o app conta as etiquetas de cada foto.

## Testes

```
npm test              # rastreador, movimento, EAN e CSV, com prateleira simulada
npm run test:camera   # página inteira com câmera simulada (precisa do Playwright
                      # e de "npm run preview" rodando em outro terminal)
```

## Estrutura

```
src/leitura/leitor.js        leitores de código atrás de uma interface comum
src/leitura/zxing.worker.js  zxing em WebAssembly, fora da thread da tela
src/leitura/rastreador.js    transforma leituras em caixas
src/leitura/movimento.js     movimento da imagem entre quadros
src/leitura/varredura.js     laço câmera -> leitor -> rastreador
src/telas/ProvaLeitura.jsx   tela da Fase 0
testes/                      testes e simulador de prateleira
```
