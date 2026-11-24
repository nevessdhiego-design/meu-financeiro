"""Testes da API: usam um SQLite temporário e não tocam em dados reais."""
import importlib

import pytest
from fastapi.testclient import TestClient

TRANSACTION = {
    "descricao": "Mercado",
    "valor": 120.5,
    "tipo": "Saída",
    "categoria": "Alimentação",
    "forma": "Débito",
    "pago": "Sim",
    "data": "2026-11-10",
}

CONFIG = {
    "salario": 3200, "dias": 22, "vr": 28, "vt": 12, "faculdade": 650, "celular": 180,
    "parcelasRestantes": 8, "cartao": 800, "lazer": 400, "investAlvo": 300,
    "metaReserva": 10000, "metaPatrim": 100000, "reservaAtual": 2500, "patrimAtual": 0,
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FINANCEIRO_DB", str(tmp_path / "teste.db"))
    import main
    importlib.reload(main)
    with TestClient(main.app) as test_client:  # dispara o lifespan e cria as tabelas
        yield test_client


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_cria_lista_atualiza_e_exclui_lancamento(client):
    created = client.post("/api/transactions", json=TRANSACTION)
    assert created.status_code == 201
    transaction_id = created.json()["id"]

    assert [t["descricao"] for t in client.get("/api/transactions").json()] == ["Mercado"]

    updated = client.put(f"/api/transactions/{transaction_id}", json={**TRANSACTION, "valor": 99.9})
    assert updated.status_code == 200 and updated.json()["valor"] == 99.9

    assert client.delete(f"/api/transactions/{transaction_id}").status_code == 204
    assert client.get("/api/transactions").json() == []


def test_filtra_por_mes(client):
    client.post("/api/transactions", json=TRANSACTION)
    client.post("/api/transactions", json={**TRANSACTION, "data": "2026-10-03"})
    novembro = client.get("/api/transactions", params={"month": "2026-11"}).json()
    assert len(novembro) == 1 and novembro[0]["data"] == "2026-11-10"


@pytest.mark.parametrize("campo,valor", [
    ("valor", -1),
    ("tipo", "Transferência"),
    ("pago", "Talvez"),
    ("data", "10/11/2026"),
    ("descricao", ""),
])
def test_rejeita_lancamento_invalido(client, campo, valor):
    response = client.post("/api/transactions", json={**TRANSACTION, campo: valor})
    assert response.status_code == 422


def test_mes_invalido_na_listagem(client):
    assert client.get("/api/transactions", params={"month": "novembro"}).status_code == 422


def test_atualizar_ou_excluir_inexistente_retorna_404(client):
    assert client.put("/api/transactions/999", json=TRANSACTION).status_code == 404
    assert client.delete("/api/transactions/999").status_code == 404


def test_config_vazia_salva_e_atualiza(client):
    assert client.get("/api/config").json() == {}
    assert client.put("/api/config", json=CONFIG).status_code == 200
    assert client.get("/api/config").json()["salario"] == 3200
    client.put("/api/config", json={**CONFIG, "salario": 3500})
    assert client.get("/api/config").json()["salario"] == 3500


def test_resumo_do_mes(client):
    client.post("/api/transactions", json={**TRANSACTION, "descricao": "Salário", "valor": 3000, "tipo": "Entrada", "categoria": "Salário"})
    client.post("/api/transactions", json=TRANSACTION)
    client.post("/api/transactions", json={**TRANSACTION, "descricao": "Cinema", "valor": 40, "categoria": "Lazer"})
    resumo = client.get("/api/summary", params={"month": "2026-11"}).json()
    assert resumo["entradas"] == 3000
    assert resumo["saidas"] == 160.5
    assert resumo["saldo"] == 2839.5
    assert list(resumo["saidasPorCategoria"]) == ["Alimentação", "Lazer"]


def test_resumo_exige_mes_valido(client):
    assert client.get("/api/summary").status_code == 422
    assert client.get("/api/summary", params={"month": "nov"}).status_code == 422
