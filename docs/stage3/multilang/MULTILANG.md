# Multi-ecosystem build evidence

Run: 2026-11-23T12:35:30.107Z

**9/9 ecosystems built and tested successfully.**

| ecosystem | language | toolchain | build | test | result |
|---|---|---|---|---|---|
| ts-node | TypeScript | tsc + tsx | exit 0 | exit 0 | PASS |
| python | Python | python3 | exit 0 | exit 0 | PASS |
| c | C | gcc | exit 0 | exit 0 | PASS |
| cpp | C++ | g++ | exit 0 | exit 0 | PASS |
| java | Java | javac + java | exit 0 | exit 0 | PASS |
| go | Go | go | exit 0 | exit 0 | PASS |
| rust | Rust | rustc | exit 0 | exit 0 | PASS |
| php | PHP | php | exit 0 | exit 0 | PASS |
| sql-postgres | SQL | psql -> Supabase Postgres | exit 0 | exit 0 | PASS |

## Detail

### ts-node — TypeScript

Build: `npm install @types/node && npx tsc -p tsconfig.json (install exit 0)` → exit 0 (1068 ms)
Test: `npx tsx src/sum.test.ts` → exit 0 (918 ms)
```
ts tests passed
```

### python — Python

Build: `python3 -m py_compile` → exit 0 (26 ms)
Test: `python3 test_sum.py` → exit 0 (36 ms)
```
python tests passed
```

### c — C

Build: `gcc -O2 -o sum sum.c` → exit 0 (36 ms)
Test: `./sum` → exit 0 (2 ms)
```
c tests passed
```

### cpp — C++

Build: `g++ -O2 -std=c++17 -o sum sum.cpp` → exit 0 (294 ms)
Test: `./sum` → exit 0 (3 ms)
```
cpp tests passed
```

### java — Java

Build: `javac Sum.java` → exit 0 (902 ms)
Test: `java Sum` → exit 0 (82 ms)
```
java tests passed
```

### go — Go

Build: `go build -o sum .` → exit 0 (376 ms)
Test: `./sum` → exit 0 (4 ms)
```
go tests passed
```

### rust — Rust

Build: `rustc -O -o sum sum.rs` → exit 0 (295 ms)
Test: `./sum` → exit 0 (3 ms)
```
rust tests passed
```

### php — PHP

Build: `php -l sum.php` → exit 0 (16 ms)
```
No syntax errors detected in sum.php
```
Test: `php sum.php` → exit 0 (15 ms)
```
php tests passed
```

### sql-postgres — SQL

Build: `psql -c "create/insert/select"` → exit 0 (740 ms)
```
CREATE TABLE
INSERT 0 1
 count 
-------
     4
(1 row)
NOTICE:  relation "rare_stage3_probe" already exists, skipping
```
Test: `select count(*)` → exit 0 (740 ms)
```
CREATE TABLE
INSERT 0 1
 count 
-------
     4
(1 row)
NOTICE:  relation "rare_stage3_probe" already exists, skipping
```
