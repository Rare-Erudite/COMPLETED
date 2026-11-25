/**
 * Stage 3 — multi-ecosystem build evidence (PDF Test B).
 *
 * Creates a real, minimal project in each ecosystem, builds it with that
 * ecosystem's own toolchain, runs its test, and records the actual command,
 * exit code and output. Nothing is mocked: if a toolchain is absent the result
 * says so instead of pretending the build passed.
 *
 * Run: npx tsx scripts/stage3_multilang.ts
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'docs', 'stage3', 'multilang');
const WORK = path.resolve(process.cwd(), 'projects', 'multilang');

interface CaseResult {
  id: string;
  language: string;
  toolchain: string;
  available: boolean;
  build: { command: string; exitCode: number | null; output: string; durationMs: number } | null;
  test: { command: string; exitCode: number | null; output: string; durationMs: number } | null;
  passed: boolean;
  note: string;
}

function run(bin: string, args: string[], cwd: string, timeout = 120_000) {
  const started = Date.now();
  return new Promise<{ code: number | null; output: string; durationMs: number }>((resolve) => {
    execFile(bin, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof (error as any).code === 'number' ? (error as any).code : null) : 0,
        output: `${stdout || ''}\n${stderr || ''}`.trim(),
        durationMs: Date.now() - started,
      });
    });
  });
}

async function has(bin: string): Promise<boolean> {
  const result = await run('which', [bin], process.cwd(), 5000);
  return result.code === 0;
}

function write(relative: string, content: string) {
  const full = path.join(WORK, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function tail(text: string, lines = 12) {
  return text.split('\n').filter(Boolean).slice(-lines).join('\n');
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  const results: CaseResult[] = [];

  // ---- TypeScript / Node --------------------------------------------------
  {
    const dir = path.join(WORK, 'ts-node');
    write('ts-node/package.json', JSON.stringify({ name: 'ts-demo', version: '1.0.0', type: 'module' }, null, 2));
    // A project-local tsconfig keeps the demo independent of the host repo's
    // compiler settings — which is exactly what an isolated workspace means.
    write(
      'ts-node/tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            types: ['node'],
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );
    write('ts-node/src/sum.ts', 'export function sum(a: number, b: number): number { return a + b; }\n');
    write(
      'ts-node/src/sum.test.ts',
      "import { sum } from './sum.js';\nimport assert from 'node:assert';\nassert.strictEqual(sum(2, 3), 5);\nassert.strictEqual(sum(-1, 1), 0);\nconsole.log('ts tests passed');\n",
    );
    const available = await has('npx');
    // A real dependency install, in the project's own directory. This is the
    // "install and configure dependencies" step of the Project Builder, and it
    // is what makes the type-check pass rather than being skipped.
    const install = available ? await run('npm', ['install', '--no-audit', '--no-fund', '--save-dev', '@types/node'], dir, 180_000) : null;
    const build = available ? await run('npx', ['tsc', '-p', 'tsconfig.json'], dir) : null;
    const test = available ? await run('npx', ['tsx', 'src/sum.test.ts'], dir) : null;
    results.push({
      id: 'ts-node',
      language: 'TypeScript',
      toolchain: 'tsc + tsx',
      available,
      build: build ? { command: `npm install @types/node && npx tsc -p tsconfig.json (install exit ${install?.code})`, exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: 'npx tsx src/sum.test.ts', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'npx not available',
    });
  }

  // ---- Python -------------------------------------------------------------
  {
    const dir = path.join(WORK, 'python');
    write('python/sum.py', 'def add(a, b):\n    return a + b\n');
    write(
      'python/test_sum.py',
      'from sum import add\nassert add(2, 3) == 5\nassert add(-1, 1) == 0\nprint("python tests passed")\n',
    );
    const available = await has('python3');
    const build = available ? await run('python3', ['-m', 'py_compile', 'sum.py', 'test_sum.py'], dir) : null;
    const test = available ? await run('python3', ['test_sum.py'], dir) : null;
    results.push({
      id: 'python',
      language: 'Python',
      toolchain: 'python3',
      available,
      build: build ? { command: 'python3 -m py_compile', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: 'python3 test_sum.py', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'python3 not available',
    });
  }

  // ---- C ------------------------------------------------------------------
  {
    const dir = path.join(WORK, 'c');
    write('c/sum.c', '#include <stdio.h>\nint add(int a,int b){return a+b;}\nint main(void){if(add(2,3)!=5)return 1;printf("c tests passed\\n");return 0;}\n');
    const available = await has('gcc');
    const build = available ? await run('gcc', ['-O2', '-o', 'sum', 'sum.c'], dir) : null;
    const test = available && build?.code === 0 ? await run('./sum', [], dir) : null;
    results.push({
      id: 'c',
      language: 'C',
      toolchain: 'gcc',
      available,
      build: build ? { command: 'gcc -O2 -o sum sum.c', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: './sum', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'gcc not available',
    });
  }

  // ---- C++ ----------------------------------------------------------------
  {
    const dir = path.join(WORK, 'cpp');
    write('cpp/sum.cpp', '#include <iostream>\nint add(int a,int b){return a+b;}\nint main(){if(add(2,3)!=5)return 1;std::cout<<"cpp tests passed\\n";return 0;}\n');
    const available = await has('g++');
    const build = available ? await run('g++', ['-O2', '-std=c++17', '-o', 'sum', 'sum.cpp'], dir) : null;
    const test = available && build?.code === 0 ? await run('./sum', [], dir) : null;
    results.push({
      id: 'cpp',
      language: 'C++',
      toolchain: 'g++',
      available,
      build: build ? { command: 'g++ -O2 -std=c++17 -o sum sum.cpp', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: './sum', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'g++ not available',
    });
  }

  // ---- Java ---------------------------------------------------------------
  {
    const dir = path.join(WORK, 'java');
    write('java/Sum.java', 'public class Sum {\n  static int add(int a,int b){return a+b;}\n  public static void main(String[] a){\n    if(add(2,3)!=5) System.exit(1);\n    System.out.println("java tests passed");\n  }\n}\n');
    const available = await has('javac');
    const build = available ? await run('javac', ['Sum.java'], dir) : null;
    const test = available && build?.code === 0 ? await run('java', ['Sum'], dir) : null;
    results.push({
      id: 'java',
      language: 'Java',
      toolchain: 'javac + java',
      available,
      build: build ? { command: 'javac Sum.java', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: 'java Sum', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'javac not available',
    });
  }

  // ---- Go -----------------------------------------------------------------
  {
    const dir = path.join(WORK, 'go');
    write('go/go.mod', 'module demo\n\ngo 1.21\n');
    write('go/sum.go', 'package main\n\nimport "fmt"\n\nfunc add(a, b int) int { return a + b }\n\nfunc main() {\n\tif add(2, 3) != 5 {\n\t\tpanic("fail")\n\t}\n\tfmt.Println("go tests passed")\n}\n');
    const available = await has('go');
    const build = available ? await run('go', ['build', '-o', 'sum', '.'], dir) : null;
    const test = available && build?.code === 0 ? await run('./sum', [], dir) : null;
    results.push({
      id: 'go',
      language: 'Go',
      toolchain: 'go',
      available,
      build: build ? { command: 'go build -o sum .', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: './sum', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'go not available',
    });
  }

  // ---- Rust ---------------------------------------------------------------
  {
    const dir = path.join(WORK, 'rust');
    write('rust/sum.rs', 'fn add(a: i32, b: i32) -> i32 { a + b }\nfn main() {\n    if add(2, 3) != 5 { std::process::exit(1); }\n    println!("rust tests passed");\n}\n');
    const available = await has('rustc');
    const build = available ? await run('rustc', ['-O', '-o', 'sum', 'sum.rs'], dir) : null;
    const test = available && build?.code === 0 ? await run('./sum', [], dir) : null;
    results.push({
      id: 'rust',
      language: 'Rust',
      toolchain: 'rustc',
      available,
      build: build ? { command: 'rustc -O -o sum sum.rs', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: './sum', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'rustc not available',
    });
  }

  // ---- PHP ----------------------------------------------------------------
  {
    const dir = path.join(WORK, 'php');
    write('php/sum.php', '<?php\nfunction add($a,$b){return $a+$b;}\nif(add(2,3)!==5){exit(1);}\necho "php tests passed\\n";\n');
    const available = await has('php');
    const build = available ? await run('php', ['-l', 'sum.php'], dir) : null;
    const test = available ? await run('php', ['sum.php'], dir) : null;
    results.push({
      id: 'php',
      language: 'PHP',
      toolchain: 'php',
      available,
      build: build ? { command: 'php -l sum.php', exitCode: build.code, output: tail(build.output), durationMs: build.durationMs } : null,
      test: test ? { command: 'php sum.php', exitCode: test.code, output: tail(test.output), durationMs: test.durationMs } : null,
      passed: Boolean(build?.code === 0 && test?.code === 0),
      note: available ? '' : 'php not available',
    });
  }

  // ---- SQL / PostgreSQL (real connection to Supabase) --------------------
  {
    const available = await has('psql');
    const dsn = process.env.SUPABASE_DB_URL || '';
    let build: CaseResult['build'] = null;
    let test: CaseResult['test'] = null;
    let note = '';
    if (!available) {
      note = 'psql client not available';
    } else if (!dsn) {
      note = 'SUPABASE_DB_URL not set, so no live database test was attempted';
    } else {
      const started = Date.now();
      const result = await run(
        'psql',
        [dsn, '-v', 'ON_ERROR_STOP=1', '-c', 'create table if not exists rare_stage3_probe(id serial primary key, note text); insert into rare_stage3_probe(note) values (\'stage3\'); select count(*) from rare_stage3_probe;'],
        process.cwd(),
        60_000,
      );
      build = { command: 'psql -c "create/insert/select"', exitCode: result.code, output: tail(result.output), durationMs: result.durationMs };
      test = { command: 'select count(*)', exitCode: result.code, output: tail(result.output), durationMs: Date.now() - started };
    }
    results.push({
      id: 'sql-postgres',
      language: 'SQL',
      toolchain: 'psql -> Supabase Postgres',
      available: available && Boolean(dsn),
      build,
      test,
      passed: Boolean(build?.exitCode === 0),
      note,
    });
  }

  const summary = {
    runAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    results,
  };
  fs.writeFileSync(path.join(ROOT, 'multilang.json'), JSON.stringify(summary, null, 2), 'utf-8');

  const lines = [
    '# Multi-ecosystem build evidence',
    '',
    `Run: ${summary.runAt}`,
    '',
    `**${summary.passed}/${summary.total} ecosystems built and tested successfully.**`,
    '',
    '| ecosystem | language | toolchain | build | test | result |',
    '|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.language} | ${r.toolchain} | ${r.build ? `exit ${r.build.exitCode}` : 'not run'} | ${r.test ? `exit ${r.test.exitCode}` : 'not run'} | ${r.passed ? 'PASS' : 'FAIL'} |`,
    ),
    '',
    '## Detail',
    '',
  ];
  for (const r of results) {
    lines.push(`### ${r.id} — ${r.language}`, '');
    if (r.note) lines.push(`Note: ${r.note}`, '');
    if (r.build) {
      lines.push(`Build: \`${r.build.command}\` → exit ${r.build.exitCode} (${r.build.durationMs} ms)`);
      if (r.build.output) lines.push('```', r.build.output, '```');
    }
    if (r.test) {
      lines.push(`Test: \`${r.test.command}\` → exit ${r.test.exitCode} (${r.test.durationMs} ms)`);
      if (r.test.output) lines.push('```', r.test.output, '```');
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'MULTILANG.md'), lines.join('\n'), 'utf-8');

  console.log(`[multilang] ${summary.passed}/${summary.total} passed`);
  for (const r of results) {
    console.log(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.id.padEnd(14)} ${r.note}`);
  }
}

main().catch((error) => {
  console.error('[multilang] FAILED:', error);
  process.exit(1);
});
