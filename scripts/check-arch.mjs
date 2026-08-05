#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');

const FRAMEWORK_PACKAGES = [
  '@nestjs/',
  'typeorm',
  'ioredis',
  'redis',
  'express',
  'class-validator',
  'class-transformer',
  'rxjs',
];

const IMPORT_RE = /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

const violations = [];

function report(file, message) {
  violations.push(`${relative(ROOT, file)}: ${message}`);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      check(full);
    }
  }
}

function importsOf(file, source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    specifiers.push({
      specifier,
      resolved: specifier.startsWith('.')
        ? relative(ROOT, resolve(dirname(file), specifier)).replaceAll('\\', '/')
        : null,
    });
  }
  return specifiers;
}

/** `src/modules/identity/domain/user.entity.ts` -> `identity`, else null */
function contextOf(path) {
  return /^src\/modules\/([^/]+)\//.exec(path)?.[1] ?? null;
}

/** `src/modules/identity/application/x.ts` -> `application`, else null */
function layerOf(path) {
  return /^src\/modules\/[^/]+\/([^/]+)/.exec(path)?.[1] ?? null;
}

function check(file) {
  const source = readFileSync(file, 'utf8');
  const path = relative(ROOT, file).replaceAll('\\', '/');
  const context = contextOf(path);
  const layer = layerOf(path);
  const isShared = path.startsWith('src/shared/');
  const isSpec = path.endsWith('.spec.ts');

  // R7 — environment access is confined to the config adapter.
  if (!path.startsWith('src/platform/config/') && /\bprocess\.env\b/.test(source)) {
    report(file, 'reads process.env directly — inject AppConfig instead (AGENTS.md §9)');
  }

  for (const { specifier, resolved } of importsOf(file, source)) {
    const framework = FRAMEWORK_PACKAGES.find((p) => specifier === p || specifier.startsWith(p));

    // R1/R2 — the pure core stays pure.
    if (framework && (isShared || layer === 'domain')) {
      report(file, `imports framework package '${specifier}' (AGENTS.md §2)`);
    }

    if (!resolved) continue;

    // R6 — only the outer layers may touch platform wiring.
    if (resolved.startsWith('src/platform/') && (isShared || layer === 'domain' || layer === 'application')) {
      report(file, `imports platform code '${specifier}' (AGENTS.md §2)`);
    }

    const targetContext = contextOf(resolved);
    const targetLayer = layerOf(resolved);

    if (!targetContext) continue;

    if (targetContext === context) {
      // R3/R4 — the dependency rule, within a context.
      if (layer === 'domain' && targetLayer !== 'domain') {
        report(file, `domain imports ${targetLayer}/ (AGENTS.md §2)`);
      }
      if (layer === 'application' && (targetLayer === 'infrastructure' || targetLayer === 'presentation')) {
        report(file, `application imports ${targetLayer}/ (AGENTS.md §2)`);
      }
      continue;
    }

    // R5 — cross-context reach-in. Only the module's public index is allowed.
    if (!isSpec && resolved !== `src/modules/${targetContext}/index`) {
      report(
        file,
        `reaches into context '${targetContext}' at '${specifier}' — ` +
          `import 'src/modules/${targetContext}' or react to its events (AGENTS.md §13)`,
      );
    }
  }
}

walk(SRC);

if (violations.length > 0) {
  console.error(`✗ architecture check failed (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('');
  process.exit(1);
}

console.log('✓ architecture check passed');
