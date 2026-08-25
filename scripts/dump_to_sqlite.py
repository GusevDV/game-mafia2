#!/usr/bin/env python3
"""Конвертирует MySQL-дамп WordPress в SQLite (только нужные таблицы).

Использование: python3 scripts/dump_to_sqlite.py backup/game-mafia2-16-10-2024.sql scripts/wp.sqlite
"""
import re
import sqlite3
import sys

PREFIX = "wp3xBeSt_"
TABLES = {
    "posts", "postmeta", "terms", "term_taxonomy", "term_relationships",
    "termmeta", "comments", "podsrel", "aioseo_posts", "post_views",
    "options", "users", "ratings",
}

ESCAPES = {
    "0": "\0", "'": "'", '"': '"', "b": "\b", "n": "\n",
    "r": "\r", "t": "\t", "Z": "\x1a", "\\": "\\", "%": "\\%", "_": "\\_",
}


def parse_values(s: str):
    """Разбирает строку `(v1,v2),(v1,v2)...;` из INSERT INTO ... VALUES."""
    rows = []
    row = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "(":
            row = []
            i += 1
            while i < n:
                c = s[i]
                if c in " \t\n,":
                    i += 1
                    continue
                if c == ")":
                    i += 1
                    break
                if c == "'":
                    buf = []
                    i += 1
                    while i < n:
                        c = s[i]
                        if c == "\\":
                            buf.append(ESCAPES.get(s[i + 1], s[i + 1]))
                            i += 2
                        elif c == "'":
                            if i + 1 < n and s[i + 1] == "'":
                                buf.append("'")
                                i += 2
                            else:
                                i += 1
                                break
                        else:
                            buf.append(c)
                            i += 1
                    row.append("".join(buf))
                else:
                    j = i
                    while j < n and s[j] not in ",)":
                        j += 1
                    tok = s[i:j].strip()
                    row.append(None if tok == "NULL" else tok)
                    i = j
            rows.append(row)
        else:
            i += 1
    return rows


def main(dump_path: str, db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    columns: dict[str, list[str]] = {}

    create_re = re.compile(r"^CREATE TABLE `" + PREFIX + r"(\w+)` \($")
    insert_re = re.compile(r"^INSERT INTO `" + PREFIX + r"(\w+)` VALUES (.*);$", re.S)

    with open(dump_path, encoding="utf-8", errors="replace") as f:
        current_create = None
        insert_buf = None
        insert_table = None
        for line in f:
            if insert_buf is not None:
                insert_buf.append(line)
                if line.rstrip().endswith(";"):
                    stmt = "".join(insert_buf)
                    m = insert_re.match(stmt)
                    assert m, stmt[:200]
                    _load_rows(cur, insert_table, m.group(2), columns)
                    insert_buf = None
                continue

            m = create_re.match(line.strip()) if line.startswith("CREATE TABLE") else None
            if m and m.group(1) in TABLES:
                current_create = m.group(1)
                columns[current_create] = []
                continue
            if current_create:
                stripped = line.strip()
                if stripped.startswith("`"):
                    columns[current_create].append(stripped.split("`")[1])
                elif stripped.startswith(")"):
                    cols = ", ".join(f'"{c}"' for c in columns[current_create])
                    cur.execute(f'CREATE TABLE "{current_create}" ({cols})')
                    current_create = None
                continue
            if line.startswith(f"INSERT INTO `{PREFIX}"):
                m = re.match(r"^INSERT INTO `" + PREFIX + r"(\w+)` VALUES ", line)
                if m and m.group(1) in TABLES:
                    if line.rstrip().endswith(";"):
                        _load_rows(cur, m.group(1), line.rstrip()[m.end():-1], columns)
                    else:
                        insert_table = m.group(1)
                        insert_buf = [line]

    conn.commit()
    for t in sorted(columns):
        cnt = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        print(f"{t}: {cnt} rows")
    conn.close()


def _load_rows(cur, table, values_str, columns):
    if values_str.rstrip().endswith(";"):
        values_str = values_str.rstrip()[:-1]
    rows = parse_values(values_str)
    ncols = len(columns[table])
    ph = ", ".join("?" * ncols)
    for r in rows:
        if len(r) != ncols:
            print(f"WARN {table}: row has {len(r)} cols, expected {ncols}", file=sys.stderr)
            continue
        cur.execute(f'INSERT INTO "{table}" VALUES ({ph})', r)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
