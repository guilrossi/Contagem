// Validação de EAN-13 pelo dígito verificador. Descarta leituras erradas
// antes que cheguem ao rastreador.
export function eanValido(codigo) {
  if (!/^\d{13}$/.test(codigo)) return false;
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += (codigo.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (soma % 10)) % 10 === codigo.charCodeAt(12) - 48;
}
