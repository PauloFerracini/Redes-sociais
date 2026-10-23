# Postador

App web para **criar, agendar e publicar posts nas suas redes sociais**: Instagram, Facebook, X, LinkedIn, Threads, TikTok e WhatsApp. É gratuito, funciona sem cadastro e sem servidor, e os dados ficam salvos no seu navegador.

## Como usar

Abra o `index.html` no navegador, ou sirva a pasta:

```bash
python3 -m http.server 8000   # e acesse http://localhost:8000
```

Para usar no celular, publique a pasta de graça no **GitHub Pages** (Settings → Pages → branch e pasta raiz) e abra o link no navegador do celular. Lá, “Adicionar à tela inicial” deixa o app com cara de aplicativo.

## Funcionalidades

- **Criar**: escreva uma vez e escolha as redes. O contador mostra os caracteres de cada rede (no X, cada link conta 23) e o total de hashtags do Instagram (máximo de 30). O app também avisa quando a rede exige foto ou vídeo.
- **Prévia**: mostra como o post fica em cada rede e destaca o texto que passa do limite.
- **Mídia**: fotos são reduzidas automaticamente para 1440 px. Vídeos são aceitos como estão.
- **Agenda**: posts agrupados por dia, com rascunhos, posts atrasados em destaque e opções de editar, duplicar e excluir.
- **Publicar**: abre cada rede com o texto pronto (X, LinkedIn, Threads e WhatsApp já vêm preenchidos) e copia a legenda. No celular, “Compartilhar” envia a foto ou o vídeo direto para o app da rede. Depois, você marca cada rede como publicada.
- **Lembretes**: com o app aberto, aparece um aviso e uma notificação na hora do post. Para ser lembrado com o app fechado, baixe o arquivo `.ics` e adicione à agenda do celular.
- **Grupos de hashtags**: salve conjuntos de hashtags e insira com um toque.
- **Backup**: exporte e importe tudo, inclusive as mídias, em um arquivo `.json`.

## Por que ele não publica sozinho?

A publicação automática exige um servidor e um app aprovado em cada rede (por exemplo, a Instagram Graph API da Meta, que só funciona com conta Business/Creator e passa por revisão). Este app usa os links oficiais de compartilhamento, que não precisam de nada disso. Você confirma o envio em um toque.

## Estrutura

- `index.html`: a interface
- `styles.css`: os estilos (inclui o modo escuro)
- `redes.js`: os limites e os links de publicação de cada rede
- `app.js`: o editor, a agenda, os lembretes e o backup
