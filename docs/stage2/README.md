# RARE Stage 2 — build/test evidence

Multi-language build + test verification executed in the RARE sandbox on 2026-11-23.

| language | build command | exit | output |
|---|---|---|---|
| C | gcc -O2 -o app main.c | 0 | C_OK 5 |
| C++ | g++ -O2 -std=c++17 | 0 | CPP_OK 10 |
| PHP | php -l / php index.php | 0 | PHP_OK hello-rare-world |
| Python | py_compile / python3 | 0 | PY_OK 55 |
| TypeScript | tsc (after repair) | 0 | TS_OK 10 |
| Java | javac / java | 0 | JAVA_OK 120 |
| Go | go build | 0 | GO_OK ERAR |
| Rust | cargo build --release | 0 | RUST_OK 10 |

Model evaluation: SmolLM2-135M-Instruct scored 3/8 (38%) on RARE-relevant capability tests.
See smollm2-135m-results.json for every prompt, output and verdict.
