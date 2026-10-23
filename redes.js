'use strict';

// Limites de texto de cada rede e como abrir a publicação.
// intent: link oficial de compartilhamento que já abre o post com o texto preenchido.
// abrir: página aberta quando a rede não tem link com texto (o texto vai para a área de transferência).
const enc = encodeURIComponent;

const REDES = {
  instagram: {
    nome: 'Instagram', cor: '#d62976', limite: 2200, hashtags: 30, precisaMidia: true,
    abrir: 'https://www.instagram.com/',
    dica: 'No celular, “Compartilhar” abre a lista de apps: escolha o Instagram e cole a legenda, que já fica copiada. No computador, a mídia é baixada e o Instagram abre para você criar o post.',
  },
  facebook: {
    nome: 'Facebook', cor: '#1877f2', limite: 63206,
    abrir: 'https://www.facebook.com/',
    dica: 'O texto é copiado e o Facebook abre: clique em “No que você está pensando?” e cole.',
  },
  x: {
    nome: 'X (Twitter)', cor: 'var(--txt)', limite: 280, contaLinks: 23,
    intent: t => 'https://x.com/intent/post?text=' + enc(t),
    dica: 'Abre o X com o texto preenchido. Se o post tiver mídia, anexe a imagem baixada.',
  },
  linkedin: {
    nome: 'LinkedIn', cor: '#0a66c2', limite: 3000,
    intent: t => 'https://www.linkedin.com/feed/?shareActive=true&text=' + enc(t),
    dica: 'Abre o LinkedIn com o texto preenchido. Se o post tiver mídia, anexe a imagem baixada.',
  },
  threads: {
    nome: 'Threads', cor: 'var(--txt)', limite: 500,
    intent: t => 'https://www.threads.net/intent/post?text=' + enc(t),
    dica: 'Abre o Threads com o texto preenchido. Se o post tiver mídia, anexe a imagem baixada.',
  },
  tiktok: {
    nome: 'TikTok', cor: '#00a8a1', limite: 4000, precisaMidia: true,
    abrir: 'https://www.tiktok.com/upload',
    dica: 'No celular, “Compartilhar” envia o vídeo para o TikTok; a legenda já fica copiada. No computador, o vídeo é baixado e a página de upload abre.',
  },
  whatsapp: {
    nome: 'WhatsApp', cor: '#25d366', limite: 65536,
    intent: t => 'https://wa.me/?text=' + enc(t),
    dica: 'Abre o WhatsApp para escolher o contato ou o grupo. Com mídia, no celular use o compartilhamento para enviar a foto junto.',
  },
};
