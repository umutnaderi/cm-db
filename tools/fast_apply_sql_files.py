import sqlite3
import sys
import time


def run(db_path, files):
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=OFF")
    for path in files:
        t0 = time.time()
        with open(path, "r", encoding="utf-8") as f:
            sql = f.read()
        con.execute("BEGIN")
        con.executescript(sql)
        con.commit()
        print(f"  {path}  ({time.time()-t0:.1f}s)")
    con.close()


if __name__ == "__main__":
    db_path = sys.argv[1]
    files = sys.argv[2:]
    run(db_path, files)
