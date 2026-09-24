from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.getenv("FINANCEIRO_DB", BASE_DIR / "financeiro.db"))

app = FastAPI(title="Meu Financeiro API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


class Transaction(BaseModel):
    descricao: str = Field(min_length=1, max_length=160)
    valor: float = Field(ge=0)
    tipo: Literal["Entrada", "Saída"]
    categoria: str = Field(min_length=1, max_length=80)
    forma: str = Field(min_length=1, max_length=40)
    pago: Literal["Sim", "Não"]
    data: date


class Config(BaseModel):
    salario: float = Field(ge=0)
    dias: float = Field(ge=0)
    vr: float = Field(ge=0)
    vt: float = Field(ge=0)
    faculdade: float = Field(ge=0)
    celular: float = Field(ge=0)
    parcelasRestantes: float = Field(ge=0)
    cartao: float = Field(ge=0)
    lazer: float = Field(ge=0)
    investAlvo: float = Field(ge=0)
    metaReserva: float = Field(ge=0)
    metaPatrim: float = Field(ge=0)
    reservaAtual: float = Field(ge=0)
    patrimAtual: float = Field(ge=0)


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_database() -> None:
    with closing(connect()) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                descricao TEXT NOT NULL,
                valor REAL NOT NULL CHECK(valor >= 0),
                tipo TEXT NOT NULL CHECK(tipo IN ('Entrada', 'Saída')),
                categoria TEXT NOT NULL,
                forma TEXT NOT NULL,
                pago TEXT NOT NULL CHECK(pago IN ('Sim', 'Não')),
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS config (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(data);
            CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(categoria);
            """
        )
        connection.commit()


@app.on_event("startup")
def startup() -> None:
    init_database()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "meu-financeiro-api"}


@app.get("/api/transactions")
def list_transactions(month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$")) -> list[dict]:
    query = "SELECT id, descricao, valor, tipo, categoria, forma, pago, data FROM transactions"
    params: tuple[str, ...] = ()
    if month:
        query += " WHERE data LIKE ?"
        params = (f"{month}%",)
    query += " ORDER BY data DESC, id DESC"
    with closing(connect()) as connection:
        return [dict(row) for row in connection.execute(query, params).fetchall()]


@app.post("/api/transactions", status_code=201)
def create_transaction(transaction: Transaction) -> dict:
    with closing(connect()) as connection:
        cursor = connection.execute(
            "INSERT INTO transactions (descricao, valor, tipo, categoria, forma, pago, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (transaction.descricao, transaction.valor, transaction.tipo, transaction.categoria, transaction.forma, transaction.pago, transaction.data.isoformat()),
        )
        connection.commit()
        return {"id": cursor.lastrowid, **transaction.model_dump(mode="json")}


@app.put("/api/transactions/{transaction_id}")
def update_transaction(transaction_id: int, transaction: Transaction) -> dict:
    with closing(connect()) as connection:
        cursor = connection.execute(
            "UPDATE transactions SET descricao=?, valor=?, tipo=?, categoria=?, forma=?, pago=?, data=? WHERE id=?",
            (transaction.descricao, transaction.valor, transaction.tipo, transaction.categoria, transaction.forma, transaction.pago, transaction.data.isoformat(), transaction_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lançamento não encontrado")
        connection.commit()
        return {"id": transaction_id, **transaction.model_dump(mode="json")}


@app.delete("/api/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int) -> None:
    with closing(connect()) as connection:
        cursor = connection.execute("DELETE FROM transactions WHERE id=?", (transaction_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lançamento não encontrado")
        connection.commit()
