import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const projectRoot = resolve(import.meta.dir, '..');
const builtinDir = resolve(projectRoot, 'apps/electron/resources/skills/builtin');
const manifestPath = resolve(projectRoot, 'apps/electron/resources/skills/manifest.json');

const skills: Record<string, { version: string; runtime: string; category: string }> = {};

for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const name = entry.name;
  const skillMd = resolve(builtinDir, name, 'SKILL.md');
  let category = 'general';
  try {
    const content = readFileSync(skillMd, 'utf8');
    const match = content.match(/^category:\s*(.+)$/m);
    if (match) category = match[1].trim();
  } catch {
    // no SKILL.md — use default category
  }
  skills[name] = { version: '1.0.0', runtime: 'python', category };
  console.log(`✓ Registered skill: ${name} (${category})`);
}

const manifest = { version: '1.0.0', skills };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ Wrote manifest with ${Object.keys(skills).length} skills`);
