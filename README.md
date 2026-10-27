# À mão — configuração do Reddit

Notas para configurar a conexão local com a API do Reddit.

## Requisitos

- Node.js 20 ou superior
- Credenciais OAuth válidas para o fluxo usado neste projeto

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha `REDDIT_CLIENT_ID` e `REDDIT_CLIENT_SECRET` com credenciais autorizadas para uso com a API do Reddit.
3. Cadastre exatamente este redirect URI na configuração OAuth:

   `http://127.0.0.1:8765/auth/callback`

O registro no Reddit Developer Platform não preenche essas variáveis automaticamente. Mantenha-as vazias até ter credenciais válidas para este fluxo. Nunca publique o arquivo `.env`.

## Executar

No diretório do projeto:

```sh
npm start
```

O servidor local usa `127.0.0.1:8765`. A autorização solicita somente o escopo `read`. Os tokens ficam na memória do processo; reiniciar o servidor encerra a sessão local. As consultas não são gravadas em arquivo.
