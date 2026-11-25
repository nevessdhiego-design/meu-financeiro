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

## Configuração (uma vez, ~10 minutos)

1. Crie uma conta em <https://supabase.com> e um **New project** (região São Paulo, qualquer nome, anote a senha do banco
   no seu gerenciador de senhas; este app não usa essa senha).
2. No projeto, abra **SQL Editor → New query**, cole o conteúdo de [`sincronizacao.sql`](sincronizacao.sql) e clique em **Run**.
3. Em **Project Settings → API** (ou **API Keys**) copie:
   - **Project URL** (`https://xxxx.supabase.co`);
   - a chave **anon** ou **publishable**. **Nunca** use a `service_role` / `secret`: ela não pode ir para o app.
4. No primeiro aparelho: **Mais → Sincronizar entre aparelhos → Primeiro aparelho**. Cole o endereço e a chave, crie a
   senha de criptografia (8+ caracteres) e toque em **Ativar sincronização**.
5. No segundo aparelho: no primeiro, abra a mesma tela e toque em **Copiar ou compartilhar o código**. No segundo, escolha
   **Já tenho um código**, cole o código e digite a **mesma senha**.

## Observações

- No iPhone, o app instalado na Tela de Início e o Safari têm armazenamento separado: configure a sincronização no app
  que você usa de verdade.
- A chave derivada da senha fica guardada no aparelho (como os próprios dados). Em um aparelho perdido, troque a senha:
  desative a sincronização, crie uma nova (novo projeto ou nova configuração) e apague a tabela antiga no Supabase.
- Os dados de exemplo (`?demo`) nunca são sincronizados.
