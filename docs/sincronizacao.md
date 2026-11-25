# Sincronizar notebook e celular

O Meu Financeiro guarda os dados no próprio aparelho. Para manter o notebook e o celular iguais, ele pode
enviar uma cópia **criptografada** para um projeto gratuito do Supabase que é só seu.

## Como funciona (e o que sai do aparelho)

- Os dados são criptografados no aparelho com AES-GCM. A chave nasce da **senha de criptografia** (PBKDF2, 200 mil
  rodadas) e **nunca é enviada**. O servidor guarda só um texto ilegível: não vê valores, descrições nem categorias.
- Cada aparelho baixa, **mescla** (o lançamento mais recente ganha, apagar vale) e envia de volta. Ao ligar o app, ao
  voltar para ele e alguns segundos depois de cada alteração.
- Se a senha for perdida, **não há recuperação**. Faça também o backup em arquivo (Mais → Fazer backup).
- O código de pareamento (endereço, chave pública e identificador) não leva a senha, mas quem tiver o código pode
  apagar ou corromper a cópia do servidor (não consegue ler). Não o deixe em lugar público.
- Quando o app ficar offline, ele funciona normalmente e sincroniza quando a internet voltar.

## Configuração (uma vez, ~10 minutos, no notebook)

O próprio app mostra estes passos em **Mais → Sincronizar entre aparelhos → 1º aparelho (configurar)**, com um botão que copia o SQL.

1. **Conta.** Em <https://supabase.com> clique em **Start your project** e entre com Google ou GitHub.
2. **Projeto.** **New project**, nome `meu-financeiro`, **Database Password → Generate** (guarde; o app não usa), região **South America (São Paulo)**, **Create new project**. Espere 1 a 2 minutos.
3. **SQL.** No menu da esquerda, **SQL Editor → New query**. Cole o conteúdo de [`sincronizacao.sql`](sincronizacao.sql) (no app, o botão **Copiar o SQL**) e clique em **Run**. Deve aparecer *Success. No rows returned*.
4. **Endereço e chave.** Engrenagem **Project Settings → API** (ou **API Keys**): copie o **Project URL** (`https://xxxx.supabase.co`) e a chave **anon** ou **publishable**. **Nunca** copie a `service_role` / `secret`.
5. **No app (1º aparelho).** Cole o Project URL e a chave, invente a **senha de criptografia** (8+ caracteres) e toque em **Ativar sincronização**.
6. **2º aparelho.** No primeiro, abra a mesma tela e toque em **Copiar ou compartilhar o código**; mande o código para você mesmo. No segundo, escolha **2º aparelho (conectar)**, cole o código e digite a **mesma senha**.

## Observações

- No iPhone, o app instalado na Tela de Início e o Safari têm armazenamento separado: configure a sincronização no app
  que você usa de verdade.
- A chave derivada da senha fica guardada no aparelho (como os próprios dados). Em um aparelho perdido, troque a senha:
  desative a sincronização, crie uma nova (novo projeto ou nova configuração) e apague a tabela antiga no Supabase.
- Os dados de exemplo (`?demo`) nunca são sincronizados.
