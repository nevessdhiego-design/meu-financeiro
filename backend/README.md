# API Python do Meu Financeiro

Backend opcional em FastAPI para desenvolvimento local. O site do GitHub Pages continua usando `localStorage` até existir autenticação e hospedagem para esta API.

## Executar localmente

No PowerShell, dentro de `backend`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Verificação:

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/docs
```

Os dados locais ficam em `backend/financeiro.db` e não devem ser enviados ao GitHub.

## Próxima etapa antes de produção

A API ainda não tem autenticação. Antes de conectá-la ao frontend ou publicá-la, adicione autenticação por usuário, autorização por registro, HTTPS, variáveis de ambiente, backups e limites de requisição. Para sincronização pessoal, Supabase com Auth e RLS continua sendo uma alternativa mais simples que hospedar esta API.
