# À mão — busca local

Agregador local em uma página: busca no catálogo público do Eporner e em posts do Reddit (OAuth opcional), combina resultados, tenta reproduzir vídeo nativo do Reddit mutado e oferece um campo para entregar um magnet que você já possui ao cliente local que registra esse protocolo.

Não baixa nem guarda mídia. Não salva consulta, favoritos ou histórico; a sessão OAuth existe apenas na memória do processo, com cookie HttpOnly no navegador. Reiniciar o servidor encerra a sessão. O app escuta somente em `127.0.0.1`.

## Executar no Mac

Requer Node.js 20 ou superior. No diretório do projeto:

```sh
npm start
```

Abra `http://127.0.0.1:8765`. As buscas Eporner funcionam sem credenciais Reddit. Se a rede ou a própria fonte bloquear a API, o feed informa falha.

## Reddit: OAuth e disponibilidade de acesso

O conector implementa OAuth 2 authorization code para credenciais da Data API que o Reddit tenha autorizado. Coloque o client ID e secret em `.env` e use o redirect URI exato `http://127.0.0.1:8765/auth/callback`. **Em outubro de 2026, não presuma que novas credenciais clássicas estão disponíveis:** Reddit está restringindo o acesso público legado, direcionando apps novos à Developer Platform e pedindo que apps existentes sejam registrados; o acesso público legado está previsto para terminar em março de 2027. Consulte o [registro de apps](https://developers.reddit.com/app-registration) e as [regras atuais da API](https://redditinc.com/policies/data-api-terms) antes de configurar.

O OAuth usa authorization code, state aleatório, scope `read`, refresh token, cookie HttpOnly/SameSite e não registra termos de busca. O token fica só na memória local enquanto o servidor está rodando; o cookie não permite recuperar sessão depois de reiniciar. As buscas são atribuíveis à sua conta e o Reddit recebe tráfego do seu IP. Reddit limita acesso a conteúdo maduro pela API; portanto, mesmo com OAuth, não há garantia de resultados NSFW e o app não contorna essa restrição. O uso precisa respeitar os termos e limites do Reddit.

## Verificar fontes neste Mac

Para testar conectividade sem usar sua busca privada, rode:

```sh
node check-sources.mjs
```

O script envia apenas a busca neutra `sample` para Eporner e para o endpoint antigo de pesquisa do Pornhub. Ele imprime status HTTP e contagens, nunca títulos nem corpos de resposta. Para RedGIFs, verifica somente se o site responde; não chama endpoints internos. Reddit e Brave só são testados se suas credenciais estiverem configuradas; os valores nunca são exibidos. A checagem do Reddit se completa ao clicar em Conectar Reddit no app.

## Fontes e limites

- **Eporner API**: metadados e embed oficial do catálogo público; o embed é controlado pela fonte e não garante volume mutado.
- **Reddit OAuth**: busca global de posts; vídeos Reddit com URL de playback vão para `<video>` nativo, mutado ao iniciar. Links de terceiros continuam sob controle do respectivo site. Busca de conteúdo 18+ está sujeita à elegibilidade da conta e às restrições do Reddit.
- **RedGIFs**: pode aparecer como link em posts do Reddit; não há integração de busca oficial estável confirmada, então o app não depende de API privada.
- **Pornhub**: não incluído porque não há endpoint público atual confirmado para integração independente.
- **Magnet**: o app só entrega ao cliente registrado no Mac o magnet colado por você. Não pesquisa trackers, indexa torrents nem inicia download por conta própria. Use apenas conteúdo que você tenha direito de acessar/compartilhar; a reprodução depende do cliente instalado e do magnet.

## Privacidade prática

O navegador conversa com o servidor local. O servidor consulta Eporner e Reddit; cada fonte recebe a consulta e pode receber o IP público da conexão. Ao reproduzir embeds externos, o navegador conversa diretamente com o provedor, que pode ver IP e dados normais de rede. Para reduzir rastreamento, use um perfil de navegador separado e reveja as configurações de conteúdo adulto do Reddit. Isto não oferece anonimato de rede.

Não exponha a porta para a rede pública nem faça port forwarding. Este é um protótipo pessoal, sem autenticação de rede, banco de dados, proteção CSRF geral ou hardening para hospedagem multiusuário.
