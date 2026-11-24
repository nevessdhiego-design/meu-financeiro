# Meu Financeiro

Aplicativo web de **controle financeiro pessoal**: visão geral do mês, lançamentos de entradas e saídas, metas (reserva e patrimônio), planejamento por categoria e evolução dos últimos 6 meses. Funciona direto no navegador, sem conta e sem servidor: os dados ficam só no seu aparelho.

**Experimente:** <https://nevessdhiego-design.github.io/meu-financeiro/?demo> (o `?demo` carrega dados de exemplo, todos fictícios).

<p align="center">
  <img src="docs/telas/visao-geral.png" alt="Visão geral: saldo planejado, metas, cartão e evolução dos últimos 6 meses" width="24%">
  <img src="docs/telas/lancamentos.png" alt="Lançamentos: saldo do mês, busca, filtros e lista" width="24%">
  <img src="docs/telas/planejamento.png" alt="Planejamento: orçamento restante por categoria" width="24%">
  <img src="docs/telas/privacidade.png" alt="Modo privacidade: valores borrados na tela" width="24%">
</p>

## O que ele faz

- **Visão geral:** recursos e despesas fixas do mês, saldo planejado, progresso da reserva e da meta de patrimônio, uso do teto do cartão, parcelas restantes e gráfico de entradas x saídas dos últimos 6 meses.
- **Lançamentos:** cadastro, edição e exclusão; **busca por texto** (sem diferenciar acento ou maiúsculas); filtros por mês, categoria e tipo; indicação de lançamentos não pagos; gráfico de saldo e gastos por categoria.
- **Planejamento:** orçamento restante por categoria e configuração de salário, benefícios, metas e dias úteis.
- **Modo privacidade:** um toque borra todos os valores na tela (útil em lugares públicos); a escolha fica salva.
- **Backup:** exporta um JSON pela **folha de compartilhar** do celular (Arquivos, iCloud Drive etc.) ou por download no computador, avisa quando o último backup está velho e restaura com prévia antes de gravar.
- **Planilhas:** importação e exportação de `.xlsx`.
- **PWA:** `manifest` e *service worker* para instalar na tela inicial e abrir sem internet.

## Instalar no iPhone

1. Abra <https://nevessdhiego-design.github.io/meu-financeiro/> no **Safari** (precisa ser o Safari).
2. Toque em **Compartilhar** (o quadrado com a seta para cima) e em **Adicionar à Tela de Início**.
3. Abra pelo novo ícone: o app roda em tela cheia e guarda os dados no próprio aparelho.

Os dados do app instalado ficam separados dos do Safari, então **faça o backup antes de instalar** se você já usava o site no navegador e restaure depois pelo menu ☰. No Android, use o Chrome (menu ⋮, **Instalar app**).

## Como foi feito

| Parte | Tecnologia |
|---|---|
| Interface | HTML, CSS e JavaScript puros (sem framework e sem *build*): `index.html`, `css/styles.css`, `js/app.js` |
| Lógica pura | `js/lib.js` (formatação, importação, totais por mês, busca, status do backup), sem DOM e testável no Node |
| Armazenamento | `localStorage` do navegador |
| Planilhas | [SheetJS](https://sheetjs.com/) por CDN, com verificação de integridade (SRI) |
| API opcional | Python, FastAPI e SQLite, em `backend/` (veja o [README do backend](backend/README.md)) |
| Testes | `node --test` na lógica (12 testes) e `pytest` na API (13 testes), ambos na CI do GitHub |

Decisões que valem destacar:

- **Privacidade por padrão:** nada sai do navegador. O repositório não contém dados reais; os valores iniciais e o conteúdo de `?demo` são fictícios.
- **Sem dependência de servidor:** a API existe para a próxima etapa (sincronização entre aparelhos), mas o app não precisa dela.
- **Segurança na interface:** tudo o que vem de planilha ou de backup é escapado antes de ir para o HTML.
- **Fuso horário correto:** datas e meses usam o horário local, não UTC.
- **Pensado para o celular:** campos de 16 px (o Safari não dá zoom ao digitar), teclado decimal no valor e pedido de armazenamento persistente.

## Como rodar

O app é estático. Na pasta do projeto:

```powershell
python -m http.server 8000
```

Abra `http://localhost:8000/?demo` no navegador. Atalhos úteis na URL: `?demo` (dados de exemplo), `&tab=lanc` ou `&tab=plan` (abre a aba) e `&privacidade` (valores ocultos).

Testes da lógica (precisa do Node 20 ou superior):

```powershell
node --test tests/lib.test.js
```

API e testes da API:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pytest
uvicorn main:app --reload --port 8000
```

A documentação interativa da API fica em `http://127.0.0.1:8000/docs`.

## Limitações conhecidas

- Os dados ficam só no navegador: trocar de aparelho, limpar os dados do site ou desinstalar o app apaga tudo. Use o **Backup** com regularidade.
- A API ainda **não tem autenticação**; por isso não está conectada ao app nem publicada (detalhes no README do backend).
- A importação de planilha espera colunas de data, descrição, valor, tipo, categoria e forma de pagamento; o app mostra uma prévia e só grava depois de você confirmar.
- Não há testes automatizados da interface (só da lógica em `js/lib.js` e da API); a conferência da tela é manual.

## Próximos passos

- Autenticação e sincronização (por exemplo, Supabase com Auth e RLS, ou a API própria com login).
- Orçamento por categoria editável e lançamentos recorrentes.
- Testes automatizados da interface.

## Licença

[MIT](LICENSE).
