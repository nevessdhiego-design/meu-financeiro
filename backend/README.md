# API Python do Meu Financeiro

Backend **opcional** em FastAPI e SQLite, para desenvolvimento local. O app do GitHub Pages continua usando `localStorage` até existir autenticação e hospedagem para esta API.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | verificação de saúde |
| GET | `/api/transactions?month=AAAA-MM` | lista lançamentos (filtro de mês opcional) |
| POST | `/api/transactions` | cria lançamento |
| PUT | `/api/transactions/{id}` | atualiza lançamento |
| DELETE | `/api/transactions/{id}` | exclui lançamento |
| GET / PUT | `/api/config` | lê e grava as configurações (salário, metas etc.) |
| GET | `/api/summary?month=AAAA-MM` | entradas, saídas, saldo e saídas por categoria |

Os dados são validados com Pydantic (valor não negativo, tipo `Entrada`/`Saída`, data ISO etc.) e respondem `422` quando inválidos.

## Executar localmente

No PowerShell, dentro de `backend`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 8000
```

Verificação:

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/docs
```

Os dados locais ficam em `backend/financeiro.db` e não devem ser enviados ao GitHub (o `.gitignore` já ignora `*.db`). Para usar outro arquivo, defina `FINANCEIRO_DB`; para liberar outras origens no CORS, defina `CORS_ORIGINS` (lista separada por vírgulas).

## Testes

```powershell
pytest
```

Os testes usam um SQLite temporário e cobrem CRUD, filtro por mês, validação, `404`, configurações e resumo mensal.

## Próxima etapa antes de produção

A API ainda não tem autenticação. Antes de conectá-la ao frontend ou publicá-la, adicione autenticação por usuário, autorização por registro, HTTPS, variáveis de ambiente, backups e limites de requisição. Para sincronização pessoal, Supabase com Auth e RLS continua sendo uma alternativa mais simples que hospedar esta API.
