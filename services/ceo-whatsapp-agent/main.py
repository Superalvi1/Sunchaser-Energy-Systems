import os
import sys
import traceback
from datetime import datetime, timezone

import psycopg
from psycopg import sql
from whagent import Agent

AGENT_TOKEN = os.environ.get("WHATSAPP_AGENT_TOKEN", "").strip()
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
AGENT_NAME = os.environ.get("CEO_AGENT_NAME", "Superalvi1").strip() or "Superalvi1"

if not AGENT_TOKEN:
    raise RuntimeError("WHATSAPP_AGENT_TOKEN is required")

agent = Agent(AGENT_TOKEN)


def _db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured")
    return psycopg.connect(
        DATABASE_URL,
        connect_timeout=6,
        autocommit=True,
        options="-c default_transaction_read_only=on",
    )


def _columns(cur, table):
    cur.execute(
        """
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = %s
        order by ordinal_position
        """,
        (table,),
    )
    return [r[0] for r in cur.fetchall()]


def _count(cur, table, where_sql=None):
    q = sql.SQL("select count(*) from {}").format(sql.Identifier(table))
    if where_sql:
        q += sql.SQL(" where ") + sql.SQL(where_sql)
    cur.execute(q)
    return int(cur.fetchone()[0])


def _table_exists(cur, table):
    cur.execute(
        """
        select exists(
          select 1 from information_schema.tables
          where table_schema='public' and table_name=%s
        )
        """,
        (table,),
    )
    return bool(cur.fetchone()[0])


def dashboard_summary():
    if not DATABASE_URL:
        return "CRM database is not connected to this agent yet."

    lines = ["*Sunchaser CEO Snapshot*"]
    with _db() as conn, conn.cursor() as cur:
        if _table_exists(cur, "leads"):
            cols = set(_columns(cur, "leads"))
            total = _count(cur, "leads")
            active = total
            if "deleted_at" in cols:
                active = _count(cur, "leads", "deleted_at is null")
            elif "is_deleted" in cols:
                active = _count(cur, "leads", "coalesce(is_deleted,false)=false")
            lines.append(f"• Leads: {total} total / {active} active")

        if _table_exists(cur, "customers"):
            lines.append(f"• Customers: {_count(cur, 'customers')}")

        if _table_exists(cur, "invoices"):
            lines.append(f"• Invoices: {_count(cur, 'invoices')}")

        if len(lines) == 1:
            lines.append("• CRM tables were not found in the connected database.")

    lines.append(f"• Agent: {AGENT_NAME} online")
    return "\n".join(lines)


def latest_leads(limit=5):
    if not DATABASE_URL:
        return "CRM database is not connected to this agent yet."

    with _db() as conn, conn.cursor() as cur:
        if not _table_exists(cur, "leads"):
            return "The leads table was not found."

        cols = _columns(cur, "leads")
        preferred = [
            "name", "full_name", "customer_name",
            "phone", "phone_number", "mobile",
            "city", "source", "status", "created_at",
        ]
        selected = [c for c in preferred if c in cols]

        if not selected:
            selected = cols[:6]

        query = sql.SQL("select {} from {}").format(
            sql.SQL(", ").join(map(sql.Identifier, selected)),
            sql.Identifier("leads"),
        )
        if "deleted_at" in cols:
            query += sql.SQL(" where deleted_at is null")
        elif "is_deleted" in cols:
            query += sql.SQL(" where coalesce(is_deleted,false)=false")
        if "created_at" in cols:
            query += sql.SQL(" order by created_at desc nulls last")
        query += sql.SQL(" limit %s")

        cur.execute(query, (limit,))
        rows = cur.fetchall()

    if not rows:
        return "No active leads found."

    out = ["*Latest CRM Leads*"]
    for idx, row in enumerate(rows, 1):
        data = {selected[i]: row[i] for i in range(len(selected))}
        name = data.get("name") or data.get("full_name") or data.get("customer_name") or "Unnamed lead"
        phone = data.get("phone") or data.get("phone_number") or data.get("mobile")
        city = data.get("city")
        source = data.get("source")
        status = data.get("status")
        bits = [str(name)]
        if phone:
            bits.append(str(phone))
        if city:
            bits.append(str(city))
        if source:
            bits.append(f"source: {source}")
        if status:
            bits.append(f"status: {status}")
        out.append(f"{idx}. " + " | ".join(bits))
    return "\n".join(out)


def crm_health():
    try:
        with _db() as conn, conn.cursor() as cur:
            cur.execute("select now()")
            db_now = cur.fetchone()[0]
        return f"CRM database connection: OK ✅\nDatabase time: {db_now}"
    except Exception:
        return "CRM database connection: FAILED ❌\nI could not reach the connected CRM database."


def help_text():
    return (
        f"*{AGENT_NAME} — CEO Assistant*\n"
        "Test commands:\n"
        "• *ping* — verify WhatsApp Agent connection\n"
        "• *status* — CRM counts + agent status\n"
        "• *leads* — latest active CRM leads\n"
        "• *crm* — database health check\n"
        "• *who are you* — agent identity\n"
        "• *help* — show this menu\n\n"
        "This first build is intentionally read-only. It cannot edit CRM records, send customer messages, or make payments."
    )


def handle_text(text):
    q = (text or "").strip()
    lower = q.lower()

    if not q:
        return "Send *help* to see the test commands."
    if lower in {"ping", "test", "hello", "hi", "hey"}:
        return f"{AGENT_NAME} is online ✅\nWhatsApp Agent API connection is working."
    if lower in {"help", "menu", "commands"}:
        return help_text()
    if lower in {"status", "dashboard", "snapshot", "ceo status", "today"}:
        return dashboard_summary()
    if "lead" in lower:
        return latest_leads()
    if lower in {"crm", "crm status", "database", "db", "health"}:
        return crm_health()
    if lower in {"who are you", "who r u", "about"}:
        return (
            f"I am *{AGENT_NAME}*, your private WhatsApp CEO assistant for Sunchaser. "
            "Right now I am in read-only test mode and can inspect selected CRM data. "
            "AI reasoning and write actions will be enabled only after the connection test is stable."
        )

    return (
        "I received your message successfully. ✅\n"
        "This is the transport-test build, so free-form AI is not enabled yet. "
        "Send *help* for available CEO commands."
    )


@agent.on_text
def on_text(ctx):
    try:
        reply = handle_text(ctx.text)
        ctx.reply(reply)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        ctx.reply(
            "I received the message, but the requested CEO tool failed. "
            "Try *ping* or *help*. The error has been logged on the server."
        )


if __name__ == "__main__":
    print(
        f"[{datetime.now(timezone.utc).isoformat()}] Starting {AGENT_NAME} WhatsApp CEO agent",
        flush=True,
    )
    agent.run()
