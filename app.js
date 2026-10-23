'use strict';

// ---------- Armazenamento ----------
const store = {
  get(chave, padrao) {
    try {
      const v = localStorage.getItem('postador.' + chave);
      return v ? JSON.parse(v) : padrao;
    } catch { return padrao; }
  },
  set(chave, valor) {
    try { localStorage.setItem('postador.' + chave, JSON.stringify(valor)); } catch { toast('Não foi possível salvar neste navegador.'); }
  },
};

// Fotos e vídeos ficam no IndexedDB, que aguenta arquivos grandes. Sem ele, ficam só na memória.
const midias = (() => {
  const memoria = new Map();
  let conexao = null;
  function abrir() {
    if (!conexao) {
      conexao = new Promise((ok, falha) => {
        const req = indexedDB.open('postador', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('midias');
        req.onsuccess = () => ok(req.result);
        req.onerror = () => falha(req.error);
      }).catch(() => null);
    }
    return conexao;
  }
  async function op(modo, fn) {
    const db = await abrir();
    if (!db) return undefined;
    return new Promise((ok, falha) => {
      const tx = db.transaction('midias', modo);
      const req = fn(tx.objectStore('midias'));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = () => falha(tx.error);
    });
  }
  return {
    async get(id) {
      if (memoria.has(id)) return memoria.get(id);
      try { return (await op('readonly', s => s.get(id))) || null; } catch { return null; }
    },
    async set(id, blob) {
      memoria.set(id, blob);
      try { await op('readwrite', s => s.put(blob, id)); } catch { /* fica só na memória */ }
    },
    async del(id) {
      memoria.delete(id);
      try { await op('readwrite', s => s.delete(id)); } catch { /* nada a apagar */ }
    },
  };
})();

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const tamanho = s => [...s].length;
const hojeIso = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local
// Aberto dentro de outra página (como o link do Claude): downloads, notificações e o
// compartilhamento nativo ficam bloqueados, então o app usa alternativas.
const emFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

// ---------- Estado ----------
let posts = store.get('posts', []);
let ajustes = Object.assign({ nome: 'Seu nome', usuario: 'seuusuario', grupos: [] }, store.get('ajustes', {}));
let editandoId = null;
let midiaAtual = null;              // { blob, url } da mídia no editor
let redesEscolhidas = store.get('ultimasRedes', ['instagram', 'facebook']);
const urlsMiniatura = new Map();    // id do post -> { url, blob } da miniatura

const salvarPosts = () => { store.set('posts', posts); renderListas(); };
const salvarAjustes = () => store.set('ajustes', ajustes);

const publicadoEm = (p, r) => p.publicado && p.publicado[r];
const completo = p => p.redes.length > 0 && p.redes.every(r => publicadoEm(p, r));
const atrasado = p => p.quando && !completo(p) && new Date(p.quando).getTime() <= Date.now();

// ---------- Utilidades ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function copiar(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(texto).then(() => true, () => copiarAntigo(texto));
  }
  return Promise.resolve(copiarAntigo(texto));
}
function copiarAntigo(texto) {
  const ta = document.createElement('textarea');
  ta.value = texto;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* sem cópia */ }
  ta.remove();
  return ok;
}

function baixar(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const extensao = blob => (blob.type.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('quicktime', 'mov').split(';')[0];

function formatarQuando(iso) {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatarTexto(texto) {
  return esc(texto)
    .replace(/(^|[\s(])([#@][\p{L}\p{N}_.]+)/gu, '$1<span class="hl">$2</span>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<span class="hl">$1</span>');
}

// Reduz fotos grandes para 1440 px em JPEG: fica leve e com boa qualidade em todas as redes.
async function comprimir(arquivo) {
  if (!arquivo.type.startsWith('image/') || arquivo.type === 'image/gif') return arquivo;
  let bmp;
  try { bmp = await createImageBitmap(arquivo); } catch { return arquivo; }
  const k = Math.min(1, 1440 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.88));
  return blob && blob.size < arquivo.size ? blob : arquivo;
}

function tagMidia(blob, url, extra = '') {
  return blob.type.startsWith('video/')
    ? `<video src="${url}" muted playsinline preload="metadata" ${extra}></video>`
    : `<img src="${url}" alt="" ${extra}>`;
}

// Conta como a rede conta: no X, todo link vale 23 caracteres.
function contar(texto, rede) {
  const R = REDES[rede];
  if (R.contaLinks) texto = texto.replace(/https?:\/\/\S+/g, 'x'.repeat(R.contaLinks));
  return tamanho(texto);
}
const contarHashtags = texto => (texto.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;

// ---------- Abas ----------
document.querySelectorAll('.aba').forEach(btn => {
  btn.addEventListener('click', () => abrirAba(btn.dataset.aba));
});
function abrirAba(id) {
  document.querySelectorAll('.aba').forEach(b => b.classList.toggle('ativa', b.dataset.aba === id));
  document.querySelectorAll('.painel').forEach(p => p.classList.toggle('ativo', p.id === id));
  store.set('aba', id);
  window.scrollTo({ top: 0 });
}

// ---------- Editor ----------
const form = $('#form-post');

function renderEscolhaRedes() {
  $('#escolha-redes').innerHTML = Object.entries(REDES).map(([id, R]) =>
    `<button type="button" class="chip ${redesEscolhidas.includes(id) ? 'ativo' : ''}" data-rede="${id}" aria-pressed="${redesEscolhidas.includes(id)}">
       <span class="ponto" style="background:${R.cor}"></span>${esc(R.nome)}
     </button>`).join('');
  $('#escolha-redes').querySelectorAll('[data-rede]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.rede;
    redesEscolhidas = redesEscolhidas.includes(id) ? redesEscolhidas.filter(r => r !== id) : [...redesEscolhidas, id];
    store.set('ultimasRedes', redesEscolhidas);
    renderEscolhaRedes();
    atualizarEditor();
  }));
}

function renderAtalhoHashtags() {
  $('#atalho-hashtags').innerHTML = ajustes.grupos.map((g, i) =>
    `<button type="button" class="chip" data-grupo="${i}">+ ${esc(g.nome)}</button>`).join('');
  $('#atalho-hashtags').querySelectorAll('[data-grupo]').forEach(b => b.addEventListener('click', () => {
    const g = ajustes.grupos[b.dataset.grupo];
    const ta = form.texto;
    const atual = ta.value.replace(/\s+$/, '');
    ta.value = atual + (atual ? '\n\n' : '') + g.tags;
    ta.focus();
    atualizarEditor();
  }));
}

function atualizarEditor() {
  const texto = form.texto.value;
  const temData = !!form.data.value;
  $('#btn-salvar').textContent = editandoId ? 'Salvar alterações' : temData ? 'Agendar' : 'Salvar rascunho';

  $('#contadores').innerHTML = redesEscolhidas.map(r => {
    const R = REDES[r];
    const n = contar(texto, r);
    const partes = [`<span class="${n > R.limite ? 'estouro' : ''}">${esc(R.nome)} ${n.toLocaleString('pt-BR')}/${R.limite.toLocaleString('pt-BR')}</span>`];
    if (R.hashtags) {
      const h = contarHashtags(texto);
      if (h) partes.push(`<span class="${h > R.hashtags ? 'estouro' : ''}">${h}/${R.hashtags} hashtags</span>`);
    }
    return partes.join('');
  }).join('');

  renderPrevias();
}

function renderPrevias() {
  const texto = form.texto.value;
  if (!redesEscolhidas.length) {
    $('#previas').innerHTML = '<p class="muted">Escolha ao menos uma rede para ver a prévia.</p>';
    return;
  }
  const inicial = (ajustes.nome || '?').trim().charAt(0).toUpperCase() || '?';
  $('#previas').innerHTML = redesEscolhidas.map(r => {
    const R = REDES[r];
    const letras = [...texto];
    const dentro = letras.length > R.limite ? letras.slice(0, R.limite).join('') : texto;
    const sobra = letras.length > R.limite ? letras.slice(R.limite).join('') : '';
    const midiaHtml = midiaAtual ? `<div class="previa-midia">${tagMidia(midiaAtual.blob, midiaAtual.url, 'controls')}</div>` : '';
    const alertas = [];
    if (R.precisaMidia && !midiaAtual) alertas.push(`O ${R.nome} precisa de uma foto ou vídeo.`);
    if (r === 'tiktok' && midiaAtual && !midiaAtual.blob.type.startsWith('video/')) alertas.push('No TikTok, prefira vídeo.');
    const excesso = contar(texto, r) - R.limite;
    if (excesso > 0) alertas.push(`Passou ${excesso.toLocaleString('pt-BR')} caracteres do limite.`);
    return `<article class="previa ${R.precisaMidia ? 'midia-primeiro' : ''}">
      <div class="previa-rede"><span class="ponto" style="background:${R.cor}"></span>${esc(R.nome)}</div>
      <div class="previa-topo"><span class="avatar">${esc(inicial)}</span>
        <div><b>${esc(ajustes.nome)}</b><span>@${esc(ajustes.usuario)} · agora</span></div></div>
      <div class="previa-texto">${texto ? formatarTexto(dentro) : '<span class="muted">Seu texto aparece aqui.</span>'}${sobra ? `<mark class="sobra">${esc(sobra)}</mark>` : ''}</div>
      ${midiaHtml}
      ${alertas.map(a => `<p class="previa-alerta">${esc(a)}</p>`).join('')}
    </article>`;
  }).join('');
}

function definirMidia(blob) {
  if (midiaAtual) URL.revokeObjectURL(midiaAtual.url);
  midiaAtual = blob ? { blob, url: URL.createObjectURL(blob) } : null;
  $('#midia-conteudo').innerHTML = midiaAtual ? tagMidia(blob, midiaAtual.url) : '📷 Adicionar foto ou vídeo';
  $('#midia-remover').hidden = !midiaAtual;
  renderPrevias();
}

form.midia.addEventListener('change', async () => {
  const arquivo = form.midia.files[0];
  form.midia.value = '';
  if (!arquivo) return;
  if (!/^(image|video)\//.test(arquivo.type)) { toast('Escolha uma foto ou um vídeo.'); return; }
  definirMidia(await comprimir(arquivo));
});
$('#midia-remover').addEventListener('click', () => definirMidia(null));
form.texto.addEventListener('input', atualizarEditor);
form.data.addEventListener('input', atualizarEditor);

function erroForm(msg) {
  const e = $('#form-erro');
  e.textContent = msg || '';
  e.hidden = !msg;
}

function limparEditor() {
  editandoId = null;
  form.reset();
  definirMidia(null);
  erroForm('');
  $('#titulo-editor').textContent = 'Novo post';
  $('#btn-cancelar').hidden = true;
  atualizarEditor();
}

async function salvarDoEditor({ agora = false } = {}) {
  const texto = form.texto.value.trim();
  if (!redesEscolhidas.length) return erroForm('Escolha onde publicar.');
  if (!texto && !midiaAtual) return erroForm('Escreva um texto ou adicione uma mídia.');
  let quando = '';
  if (form.data.value) quando = `${form.data.value}T${form.hora.value || '09:00'}`;
  if (agora) quando = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  erroForm('');

  let p = editandoId && posts.find(x => x.id === editandoId);
  if (!p) {
    p = { id: novoId(), criado: new Date().toISOString(), publicado: {} };
    posts.push(p);
  }
  if (p.quando !== quando) p.avisado = agora; // quem publica agora não precisa de lembrete
  Object.assign(p, { texto, redes: [...redesEscolhidas], quando, temMidia: !!midiaAtual });
  for (const r of Object.keys(p.publicado)) if (!p.redes.includes(r)) delete p.publicado[r];

  if (midiaAtual) await midias.set(p.id, midiaAtual.blob);
  else await midias.del(p.id);
  limparMiniatura(p.id);

  salvarPosts();
  limparEditor();
  return p;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const p = await salvarDoEditor();
  if (p) {
    toast(p.quando ? 'Post agendado.' : 'Rascunho salvo.');
    abrirAba('agenda');
  }
});
$('#btn-agora').addEventListener('click', async () => {
  const p = await salvarDoEditor({ agora: true });
  if (p) abrirPublicar(p.id);
});
$('#btn-cancelar').addEventListener('click', limparEditor);

async function editar(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  limparEditor();
  editandoId = id;
  form.texto.value = p.texto;
  [form.data.value, form.hora.value] = p.quando ? p.quando.split('T') : ['', ''];
  redesEscolhidas = [...p.redes];
  renderEscolhaRedes();
  definirMidia(p.temMidia ? await midias.get(id) : null);
  $('#titulo-editor').textContent = 'Editar post';
  $('#btn-cancelar').hidden = false;
  atualizarEditor();
  abrirAba('criar');
}

async function duplicar(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  const copia = { ...p, id: novoId(), criado: new Date().toISOString(), publicado: {}, quando: '', avisado: false };
  if (p.temMidia) {
    const blob = await midias.get(id);
    if (blob) await midias.set(copia.id, blob);
    else copia.temMidia = false;
  }
  posts.push(copia);
  salvarPosts();
  editar(copia.id);
  toast('Cópia criada como rascunho.');
}

async function excluir(id) {
  posts = posts.filter(x => x.id !== id);
  await midias.del(id);
  limparMiniatura(id);
  if (editandoId === id) limparEditor();
  salvarPosts();
}

// ---------- Agenda e publicados ----------
function limparMiniatura(id) {
  if (urlsMiniatura.has(id)) URL.revokeObjectURL(urlsMiniatura.get(id).url);
  urlsMiniatura.delete(id);
}

function cartaoPost(p) {
  const pubs = p.redes.filter(r => publicadoEm(p, r)).length;
  let status;
  if (completo(p)) status = '<span class="status publicado">Publicado</span>';
  else if (atrasado(p)) status = '<span class="status atrasado">Hora de publicar</span>';
  else if (p.quando) status = '<span class="status">Agendado</span>';
  else status = '<span class="status">Rascunho</span>';
  const parcial = pubs && !completo(p) ? ` · ${pubs}/${p.redes.length} redes` : '';
  const texto = tamanho(p.texto) > 180 ? [...p.texto].slice(0, 180).join('') + '…' : p.texto;
  return `<article class="post ${atrasado(p) ? 'atrasado' : ''}">
    <div class="thumb" data-thumb="${p.id}">${p.temMidia ? '' : '✎'}</div>
    <div class="post-corpo">
      <div class="post-meta">${status}${p.quando ? ' · ' + esc(formatarQuando(p.quando)) : ''}${parcial}</div>
      <p class="post-texto">${p.texto ? formatarTexto(texto) : '<span class="muted">(sem texto)</span>'}</p>
      <div class="post-redes">${p.redes.map(r => `<span class="${publicadoEm(p, r) ? 'feito' : ''}"><span class="ponto" style="background:${REDES[r].cor}"></span>${esc(REDES[r].nome)}${publicadoEm(p, r) ? ' ✓' : ''}</span>`).join('')}</div>
      <div class="botoes">
        ${completo(p) ? '' : `<button class="btn peq" data-acao="publicar" data-id="${p.id}">Publicar</button>`}
        <button class="btn sec peq" data-acao="editar" data-id="${p.id}">Editar</button>
        <button class="btn sec peq" data-acao="duplicar" data-id="${p.id}">Duplicar</button>
        ${p.quando && !completo(p) && !emFrame ? `<button class="btn sec peq" data-acao="ics" data-id="${p.id}">Lembrete</button>` : ''}
        <button class="btn sec peq perigo" data-acao="excluir" data-id="${p.id}">Excluir</button>
      </div>
    </div>
  </article>`;
}

function rotuloDia(dia) {
  const amanha = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE');
  if (dia === hojeIso()) return 'Hoje';
  if (dia === amanha) return 'Amanhã';
  return new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function renderListas() {
  const pendentes = posts.filter(p => !completo(p));
  const rascunhos = pendentes.filter(p => !p.quando).sort((a, b) => b.criado.localeCompare(a.criado));
  const agendados = pendentes.filter(p => p.quando).sort((a, b) => a.quando.localeCompare(b.quando));
  const feitos = posts.filter(completo).sort((a, b) => ultimaPublicacao(b).localeCompare(ultimaPublicacao(a)));

  let html = '';
  if (!pendentes.length) html = '<div class="card vazio">Nenhum post na agenda. Crie um na aba <b>Criar</b>.</div>';
  let diaAtual = '';
  for (const p of agendados) {
    const dia = p.quando.slice(0, 10);
    if (dia !== diaAtual) { html += `<h3 class="dia-titulo">${esc(rotuloDia(dia))}</h3>`; diaAtual = dia; }
    html += cartaoPost(p);
  }
  if (rascunhos.length) html += '<h3 class="dia-titulo">Rascunhos</h3>' + rascunhos.map(cartaoPost).join('');
  $('#lista-agenda').innerHTML = html;

  $('#lista-publicados').innerHTML = feitos.length
    ? feitos.map(cartaoPost).join('')
    : '<div class="card vazio">Os posts que você publicar em todas as redes escolhidas aparecem aqui.</div>';

  const n = pendentes.filter(p => p.quando).length;
  $('#n-agenda').textContent = n;
  $('#n-agenda').hidden = !n;

  document.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', () => {
    const { acao, id } = b.dataset;
    if (acao === 'publicar') abrirPublicar(id);
    else if (acao === 'editar') editar(id);
    else if (acao === 'duplicar') duplicar(id);
    else if (acao === 'excluir') {
      // Pede um segundo toque para confirmar, sem caixa de diálogo do navegador.
      if (b.dataset.confirmar) return excluir(id);
      b.dataset.confirmar = '1';
      b.textContent = 'Toque de novo para excluir';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.confirmar; b.textContent = 'Excluir'; } }, 4000);
    }
    else if (acao === 'ics') baixarIcs(posts.filter(x => x.id === id));
  }));
  carregarMiniaturas();
  verificarLembretes();
}

const ultimaPublicacao = p => Object.values(p.publicado).sort().pop() || '';

async function carregarMiniaturas() {
  for (const el of document.querySelectorAll('[data-thumb]')) {
    const id = el.dataset.thumb;
    const p = posts.find(x => x.id === id);
    if (!p || !p.temMidia) continue;
    if (!urlsMiniatura.has(id)) {
      const blob = await midias.get(id);
      if (!blob) continue;
      urlsMiniatura.set(id, { url: URL.createObjectURL(blob), blob });
    }
    const m = urlsMiniatura.get(id);
    el.innerHTML = tagMidia(m.blob, m.url);
  }
}

// ---------- Publicar ----------
// Sem servidor, o app não publica sozinho: ele abre cada rede com o texto pronto,
// copia a legenda e entrega a mídia, e você confirma o envio lá.
const dlg = $('#dlg-publicar');
$('.fechar', dlg).addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => renderListas());

async function abrirPublicar(id) {
  const p = posts.find(x => x.id === id);
  if (!p) return;
  const blob = p.temMidia ? await midias.get(id) : null;
  const arquivo = blob ? new File([blob], `post-${p.id}.${extensao(blob)}`, { type: blob.type }) : null;
  const podeCompartilhar = !emFrame && !!(arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] }));
  const urlMidia = blob && emFrame ? URL.createObjectURL(blob) : null;
  dlg.addEventListener('close', () => urlMidia && URL.revokeObjectURL(urlMidia), { once: true });

  function render() {
    $('#publicar-corpo').innerHTML = `
      <h2>Publicar</h2>
      <p class="muted">Toque na rede para abrir a publicação. Depois de enviar, marque como publicado.</p>
      <div class="botoes" style="margin-bottom:14px">
        <button class="btn sec peq" data-pub="copiar">Copiar texto</button>
        ${blob && !emFrame ? '<button class="btn sec peq" data-pub="baixar">Baixar mídia</button>' : ''}
        ${podeCompartilhar ? '<button class="btn sec peq" data-pub="compartilhar">Compartilhar mídia e texto</button>' : ''}
      </div>
      ${urlMidia ? `<div class="pub-midia">${tagMidia(blob, urlMidia, 'controls')}<p class="muted">Para salvar a mídia no aparelho, toque e segure (ou clique com o botão direito) e escolha salvar.</p></div>` : ''}
      ${p.redes.map(r => {
        const R = REDES[r];
        const feito = publicadoEm(p, r);
        return `<div class="pub-rede ${feito ? 'feito' : ''}">
          <h3><span class="ponto" style="background:${R.cor}"></span>${esc(R.nome)}</h3>
          <p>${esc(R.dica)}</p>
          ${contar(p.texto, r) > R.limite ? `<p class="erro">O texto passa do limite de ${R.limite} caracteres desta rede.</p>` : ''}
          <div class="botoes">
            <a class="btn peq" href="${esc(R.intent ? R.intent(p.texto) : R.abrir)}" target="_blank" rel="noopener" data-abrir="${r}">Abrir ${esc(R.nome)}</a>
            <label class="check"><input type="checkbox" data-feito="${r}" ${feito ? 'checked' : ''}> Publicado</label>
          </div>
        </div>`;
      }).join('')}`;

    const corpo = $('#publicar-corpo');
    corpo.querySelector('[data-pub="copiar"]').addEventListener('click', () => copiar(p.texto).then(ok => toast(ok ? 'Texto copiado.' : 'Não foi possível copiar.')));
    corpo.querySelector('[data-pub="baixar"]')?.addEventListener('click', () => baixar(blob, arquivo.name));
    corpo.querySelector('[data-pub="compartilhar"]')?.addEventListener('click', () => compartilhar());
    corpo.querySelectorAll('[data-abrir]').forEach(a => a.addEventListener('click', e => abrirRede(a.dataset.abrir, e)));
    corpo.querySelectorAll('[data-feito]').forEach(c => c.addEventListener('change', () => {
      if (c.checked) p.publicado[c.dataset.feito] = new Date().toISOString();
      else delete p.publicado[c.dataset.feito];
      store.set('posts', posts);
      if (completo(p)) toast('Tudo publicado! 🎉');
      render();
    }));
  }

  function compartilhar() {
    copiar(p.texto);
    navigator.share({ files: [arquivo], text: p.texto }).catch(() => { /* cancelado */ });
  }

  // O link abre a rede em outra aba; o clique também copia a legenda e entrega a mídia.
  function abrirRede(r, evento) {
    const R = REDES[r];
    copiar(p.texto);
    if (blob && podeCompartilhar && !R.intent) {
      evento.preventDefault();
      compartilhar();
      toast('Legenda copiada. Escolha o app e cole o texto.');
    } else if (R.intent) {
      if (blob) toast(emFrame ? 'Texto preenchido. Salve a mídia acima para anexar.' : 'Texto preenchido. Use “Baixar mídia” para anexar a foto.');
    } else {
      if (blob && !emFrame) baixar(blob, arquivo.name);
      toast(blob ? (emFrame ? 'Legenda copiada. Salve a mídia acima e crie o post.' : 'Legenda copiada e mídia baixada. Crie o post e cole o texto.') : 'Texto copiado. Cole na publicação.');
    }
  }

  render();
  if (!dlg.open) dlg.showModal();
}

// ---------- Lembretes ----------
function verificarLembretes() {
  const devidos = posts.filter(atrasado);
  const banner = $('#banner');
  if (devidos.length) {
    banner.innerHTML = `<span>⏰ ${devidos.length === 1 ? '1 post está' : devidos.length + ' posts estão'} na hora de publicar.</span><button class="btn peq" type="button">Ver</button>`;
    banner.querySelector('button').addEventListener('click', () => devidos.length === 1 ? abrirPublicar(devidos[0].id) : abrirAba('agenda'));
  }
  banner.hidden = !devidos.length;

  const novos = devidos.filter(p => !p.avisado);
  if (!novos.length) return;
  novos.forEach(p => { p.avisado = true; });
  store.set('posts', posts);
  if ('Notification' in window && Notification.permission === 'granted') {
    for (const p of novos) {
      try {
        const n = new Notification('Hora de publicar', { body: (p.texto || 'Post com mídia').slice(0, 120), tag: p.id });
        n.onclick = () => { window.focus(); abrirPublicar(p.id); };
      } catch { /* notificação indisponível */ }
    }
  }
}
setInterval(verificarLembretes, 30000);

$('#btn-notificacoes').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Este navegador não tem notificações.');
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Notificações ativadas.' : 'As notificações foram bloqueadas no navegador.');
});

// Arquivo de calendário: abre na agenda do celular/computador e avisa na hora, mesmo com o app fechado.
function baixarIcs(lista) {
  lista = lista.filter(p => p.quando && !completo(p));
  if (!lista.length) return toast('Nenhum post agendado pendente.');
  const escIcs = s => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const dobrar = linha => {
    const ch = [...linha];
    const partes = [];
    for (let i = 0; i < ch.length; i += 70) partes.push(ch.slice(i, i + 70).join(''));
    return partes.join('\r\n ');
  };
  const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Postador//PT-BR', 'CALSCALE:GREGORIAN'];
  for (const p of lista) {
    const inicio = p.quando.replace(/[-:]/g, '') + '00';
    const redes = p.redes.map(r => REDES[r].nome).join(', ');
    linhas.push('BEGIN:VEVENT', `UID:${p.id}@postador`, `DTSTAMP:${carimbo}`, `DTSTART:${inicio}`, 'DURATION:PT15M',
      dobrar(`SUMMARY:${escIcs('Publicar post: ' + redes)}`),
      dobrar(`DESCRIPTION:${escIcs(p.texto)}`),
      'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Hora de publicar', 'END:VALARM', 'END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  baixar(new Blob([linhas.join('\r\n')], { type: 'text/calendar' }), lista.length === 1 ? 'lembrete-post.ics' : 'agenda-posts.ics');
}
$('#btn-ics-todos').addEventListener('click', () => baixarIcs(posts));

// ---------- Ajustes ----------
const formPerfil = $('#form-perfil');
formPerfil.nome.value = ajustes.nome;
formPerfil.usuario.value = ajustes.usuario;
formPerfil.addEventListener('submit', e => {
  e.preventDefault();
  ajustes.nome = formPerfil.nome.value.trim() || 'Seu nome';
  ajustes.usuario = formPerfil.usuario.value.trim().replace(/^@/, '') || 'seuusuario';
  salvarAjustes();
  renderPrevias();
  toast('Perfil salvo.');
});

function renderGrupos() {
  $('#lista-hashtags').innerHTML = ajustes.grupos.length
    ? ajustes.grupos.map((g, i) => `<li><span><b>${esc(g.nome)}</b> <span class="muted">${esc(g.tags)}</span></span><button class="x" data-rm-grupo="${i}" aria-label="Remover">×</button></li>`).join('')
    : '<li class="muted">Nenhum grupo salvo.</li>';
  $('#lista-hashtags').querySelectorAll('[data-rm-grupo]').forEach(b => b.addEventListener('click', () => {
    ajustes.grupos.splice(+b.dataset.rmGrupo, 1);
    salvarAjustes();
    renderGrupos();
  }));
  renderAtalhoHashtags();
}
$('#form-hashtags').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const tags = f.tags.value.split(/[\s,]+/).filter(Boolean).map(t => '#' + t.replace(/^#+/, '')).join(' ');
  ajustes.grupos.push({ nome: f.nome.value.trim(), tags });
  salvarAjustes();
  f.reset();
  renderGrupos();
});

// ---------- Backup ----------
const paraDataUrl = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });

$('#btn-exportar').addEventListener('click', async () => {
  const arquivos = {};
  for (const p of posts) {
    if (!p.temMidia) continue;
    const blob = await midias.get(p.id);
    if (blob) arquivos[p.id] = await paraDataUrl(blob);
  }
  const dados = { app: 'postador', versao: 1, exportado: new Date().toISOString(), posts, ajustes, midias: arquivos };
  if (emFrame) {
    const ok = await copiar(JSON.stringify(dados));
    return toast(ok ? 'Backup copiado. Cole num arquivo de texto e salve como .json.' : 'Não foi possível copiar o backup.');
  }
  baixar(new Blob([JSON.stringify(dados)], { type: 'application/json' }), `postador-backup-${hojeIso()}.json`);
});

$('#btn-importar input').addEventListener('change', async e => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  let dados;
  try { dados = JSON.parse(await arquivo.text()); } catch { return toast('Arquivo de backup inválido.'); }
  if (!dados || dados.app !== 'postador' || !Array.isArray(dados.posts)) return toast('Este arquivo não é um backup do Postador.');
  const existentes = new Set(posts.map(p => p.id));
  const novos = dados.posts
    .filter(p => p && p.id && Array.isArray(p.redes) && !existentes.has(p.id))
    .map(p => ({ ...p, publicado: p.publicado || {}, redes: p.redes.filter(r => REDES[r]) }));
  for (const p of novos) {
    const url = (dados.midias || {})[p.id];
    if (!url) continue;
    try { await midias.set(p.id, await (await fetch(url)).blob()); } catch { p.temMidia = false; }
  }
  posts.push(...novos);
  ajustes = Object.assign({ nome: 'Seu nome', usuario: 'seuusuario', grupos: [] }, dados.ajustes || {});
  salvarAjustes();
  formPerfil.nome.value = ajustes.nome;
  formPerfil.usuario.value = ajustes.usuario;
  limparEditor();
  renderGrupos();
  salvarPosts();
  toast(novos.length ? `${novos.length} posts importados.` : 'Esses posts já estavam no app.');
});

// ---------- Início ----------
if (emFrame) {
  ['#btn-notificacoes', '#btn-ics-todos'].forEach(s => { $(s).hidden = true; });
  $('#txt-lembretes').textContent = 'Enquanto o app estiver aberto, um aviso aparece no topo quando chegar a hora de cada post.';
  $('#btn-exportar').textContent = 'Copiar backup';
}
redesEscolhidas = redesEscolhidas.filter(r => REDES[r]);
renderEscolhaRedes();
renderGrupos();
atualizarEditor();
renderListas();
abrirAba(document.getElementById(store.get('aba', 'criar')) ? store.get('aba', 'criar') : 'criar');
