import { useCallback, useEffect, useRef, useState } from 'react';
import { Varredura } from '../leitura/varredura.js';
import { gerarCsv } from '../leitura/csv.js';

const VERDE = '#22c55e';
const AMARELO = '#facc15';
const CINZA = '#9ca3af';

// Desenha as marcas sobre o vídeo. O vídeo é exibido inteiro (contain), então
// tudo que a câmera lê está visível na tela.
function desenhar(canvas, estado) {
  const dpr = window.devicePixelRatio || 1;
  const lw = canvas.clientWidth;
  const lh = canvas.clientHeight;
  if (canvas.width !== Math.round(lw * dpr) || canvas.height !== Math.round(lh * dpr)) {
    canvas.width = Math.round(lw * dpr);
    canvas.height = Math.round(lh * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, lw, lh);
  if (!estado) return;
  const escala = Math.min(lw / estado.largura, lh / estado.altura);
  const ox = (lw - estado.largura * escala) / 2;
  const oy = (lh - estado.altura * escala) / 2;
  // Nada é desenhado fora da área do vídeo.
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, estado.largura * escala, estado.altura * escala);
  ctx.clip();
  for (const m of estado.marcas) {
    const x = ox + m.x * escala;
    const y = oy + m.y * escala;
    const w = Math.max(m.w * escala, 18);
    const h = w * 0.55;
    const cor = m.ignorada ? CINZA : m.confirmada ? VERDE : AMARELO;
    ctx.lineWidth = 3;
    ctx.strokeStyle = cor;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 6);
    if (m.confirmada && !m.ignorada) {
      ctx.fillStyle = 'rgba(34, 197, 94, 0.45)';
      ctx.fill();
    }
    ctx.stroke();
    if (m.confirmada && !m.ignorada) {
      // Sinal de "contada".
      const r = Math.min(h * 0.32, 14);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(3, r * 0.35);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x - r * 0.25, y + r * 0.7);
      ctx.lineTo(x + r, y - r * 0.7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function usarBipe() {
  const ref = useRef(null);
  return useCallback((preparar) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!ref.current && Ctx) ref.current = new Ctx();
      const ac = ref.current;
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      if (preparar) return;
      const osc = ac.createOscillator();
      const ganho = ac.createGain();
      osc.frequency.value = 1200;
      ganho.gain.setValueAtTime(0.25, ac.currentTime);
      ganho.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
      osc.connect(ganho).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.09);
    } catch {
      // Sem som, a contagem segue normalmente.
    }
  }, []);
}

export default function ProvaLeitura() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const varreduraRef = useRef(null);
  const travaTelaRef = useRef(null);

  const [fase, setFase] = useState('inicio'); // inicio | abrindo | lendo | erro
  const [erro, setErro] = useState('');
  const [pausado, setPausado] = useState(false);
  const [total, setTotal] = useState(0);
  const [codigos, setCodigos] = useState(0);
  const [ultima, setUltima] = useState(null);
  const [info, setInfo] = useState(null);
  const [lanterna, setLanterna] = useState(false);
  const [temLanterna, setTemLanterna] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [motor, setMotor] = useState('auto');
  const [resolucao, setResolucao] = useState('1080p');
  const bipe = usarBipe();

  const atualizarTotais = useCallback(() => {
    const caixas = varreduraRef.current?.caixas() || [];
    setTotal(caixas.length);
    setCodigos(new Set(caixas.map((c) => c.ean)).size);
    const u = caixas[caixas.length - 1];
    setUltima(u ? { ean: u.ean, repeticao: caixas.filter((c) => c.ean === u.ean).length } : null);
  }, []);

  useEffect(() => {
    let ultimoInfo = 0;
    const v = new Varredura({
      video: videoRef.current,
      aoContar: () => {
        bipe();
        navigator.vibrate?.(30);
        atualizarTotais();
      },
      aoAtualizar: (estado) => {
        desenhar(canvasRef.current, estado);
        const agora = performance.now();
        if (agora - ultimoInfo > 400) {
          ultimoInfo = agora;
          setInfo({
            motor: estado.motor,
            largura: estado.largura,
            altura: estado.altura,
            ms: Math.round(estado.msPorQuadro),
            lidas: estado.lidasNoQuadro,
            perdido: estado.perdido,
            erro: estado.erro,
          });
        }
      },
    });
    varreduraRef.current = v;
    return () => {
      v.parar();
      travaTelaRef.current?.release?.();
    };
  }, [bipe, atualizarTotais]);

  const abrir = useCallback(
    async (opcoes) => {
      setFase('abrindo');
      setErro('');
      bipe(true);
      try {
        const v = varreduraRef.current;
        await v.iniciar(opcoes);
        setTemLanterna(Boolean(v.temLanterna));
        setLanterna(false);
        setPausado(false);
        setFase('lendo');
        try {
          travaTelaRef.current = await navigator.wakeLock?.request('screen');
        } catch {
          // Sem trava de tela: o aparelho pode apagar a tela sozinho.
        }
      } catch (e) {
        const nome = e?.name || '';
        setErro(
          nome === 'NotAllowedError'
            ? 'A câmera foi bloqueada. Libere a câmera para este site nas configurações do navegador e tente de novo.'
            : nome === 'NotFoundError'
              ? 'Nenhuma câmera encontrada neste aparelho.'
              : String(e?.message || e),
        );
        setFase('erro');
      }
    },
    [bipe],
  );

  const alternarPausa = () => {
    const novo = !pausado;
    varreduraRef.current.pausar(novo);
    setPausado(novo);
  };

  const desfazer = () => {
    if (varreduraRef.current.desfazerUltima()) atualizarTotais();
  };

  const zerar = () => {
    if (total > 0 && !window.confirm(`Apagar as ${total} caixas contadas e começar de novo?`)) return;
    varreduraRef.current.zerar();
    desenhar(canvasRef.current, null);
    atualizarTotais();
  };

  const exportar = () => {
    const caixas = varreduraRef.current.caixas();
    const blob = new Blob([gerarCsv(caixas)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `leitura-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const alternarLanterna = async () => {
    const novo = !lanterna;
    if (await varreduraRef.current.lanterna(novo)) setLanterna(novo);
  };

  const aplicarAjustes = (novoMotor, novaResolucao) => {
    setMotor(novoMotor);
    setResolucao(novaResolucao);
    if (fase === 'lendo') abrir({ motor: novoMotor, resolucao: novaResolucao });
  };

  const lendo = fase === 'lendo';

  return (
    <div className="tela">
      <header className="topo">
        <div className="contador" aria-live="polite">
          <span className="numero" data-testid="total">{total}</span>
          <span className="rotulo">{total === 1 ? 'caixa' : 'caixas'}</span>
        </div>
        <div className="resumo">
          <div>
            <strong data-testid="codigos">{codigos}</strong> {codigos === 1 ? 'código' : 'códigos'}
          </div>
          {info && lendo && (
            <div className="tecnico" data-testid="tecnico">
              {info.motor} · {info.largura}×{info.altura} · {info.ms} ms · {info.lidas} lidas
            </div>
          )}
        </div>
        <button className="icone" onClick={() => setAjustes((a) => !a)} aria-label="Ajustes">
          ⚙
        </button>
      </header>

      {ajustes && (
        <section className="ajustes">
          <label>
            Leitor
            <select value={motor} onChange={(e) => aplicarAjustes(e.target.value, resolucao)}>
              <option value="auto">Automático</option>
              <option value="nativo">Nativo do navegador</option>
              <option value="zxing">ZXing (WebAssembly)</option>
            </select>
          </label>
          <label>
            Resolução
            <select value={resolucao} onChange={(e) => aplicarAjustes(motor, e.target.value)}>
              <option value="1080p">Full HD (1080p)</option>
              <option value="4k">4K</option>
            </select>
          </label>
        </section>
      )}

      <main className="visor">
        <video ref={videoRef} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
        {fase !== 'lendo' && (
          <div className="capa">
            {fase === 'erro' && <p className="erro">{erro}</p>}
            {fase === 'abrindo' ? (
              <p>Abrindo a câmera…</p>
            ) : (
              <>
                {fase === 'inicio' && (
                  <p>
                    Aponte para as etiquetas e passe o celular devagar pelas caixas. Cada caixa
                    contada ganha uma marca verde.
                  </p>
                )}
                <button className="botao principal" onClick={() => abrir({ motor, resolucao })}>
                  {fase === 'erro' ? 'Tentar de novo' : 'Abrir câmera'}
                </button>
              </>
            )}
          </div>
        )}
        {lendo && pausado && <div className="faixa">Pausado</div>}
        {lendo && !pausado && info?.perdido && (
          <div className="faixa aviso">Procurando a posição. Segure o celular parado sobre as etiquetas.</div>
        )}
        {lendo && info?.erro && <div className="faixa aviso">{info.erro}</div>}
      </main>

      <footer className="base">
        <div className="ultima" data-testid="ultima">
          {ultima ? (
            <>
              Última: <strong>{ultima.ean}</strong>
              {ultima.repeticao > 1 && <> · {ultima.repeticao}ª caixa deste código</>}
            </>
          ) : (
            'Nenhuma caixa contada'
          )}
        </div>
        <div className="botoes">
          <button className="botao" onClick={desfazer} disabled={total === 0}>
            Desfazer última
          </button>
          <button className="botao" onClick={alternarPausa} disabled={!lendo}>
            {pausado ? 'Continuar' : 'Pausar'}
          </button>
        </div>
        <div className="botoes">
          <button className="botao discreto" onClick={zerar}>
            Zerar
          </button>
          {temLanterna && (
            <button className="botao discreto" onClick={alternarLanterna} disabled={!lendo}>
              {lanterna ? 'Apagar lanterna' : 'Lanterna'}
            </button>
          )}
          <button className="botao principal" onClick={exportar} disabled={total === 0}>
            Exportar CSV
          </button>
        </div>
      </footer>
    </div>
  );
}
