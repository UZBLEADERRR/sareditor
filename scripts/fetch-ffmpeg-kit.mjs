#!/usr/bin/env node
/**
 * Downloads the ffmpeg-kit Android AAR into a small local Maven repository at
 * ./vendor/m2, which plugins/withFFmpegKit.js registers with Gradle.
 *
 * Why this exists: Arthenica retired ffmpeg-kit in 2025 and removed the
 * `com.arthenica:ffmpeg-kit-*` artifacts from Maven Central, so there is no
 * longer a repository Gradle can resolve them from. The binaries themselves are
 * still redistributable (LGPL-3.0, or GPL-3.0 for the `-gpl` variants), they
 * just have to be mirrored.
 *
 *   npm run ffmpeg:fetch
 *   FFMPEG_KIT_AAR_URL=https://my-mirror/ffmpeg-kit-full-gpl-6.0-2.aar npm run ffmpeg:fetch
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'ffmpeg-kit.sources.json'), 'utf8'));

const variant = process.env.FFMPEG_KIT_VARIANT || config.variant;
const version = process.env.FFMPEG_KIT_VERSION || config.version;
const artifactId = `ffmpeg-kit-${variant}`;
const fileName = `${artifactId}-${version}.aar`;

const outDir = path.join(root, 'vendor', 'm2', 'com', 'arthenica', artifactId, version);
const aarPath = path.join(outDir, fileName);
const pomPath = path.join(outDir, `${artifactId}-${version}.pom`);

const candidates = [
  process.env.FFMPEG_KIT_AAR_URL,
  ...config.mirrors.map((m) => m.replaceAll('{variant}', variant).replaceAll('{version}', version)),
].filter(Boolean);

/** An AAR is a zip; anything that starts with something else is an error page. */
async function looksLikeAar(file) {
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(2);
    await handle.read(buf, 0, 2, 0);
    const { size } = await handle.stat();
    return buf[0] === 0x50 && buf[1] === 0x4b && size > 1024 * 1024;
  } finally {
    await handle.close();
  }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  if (await fs.stat(aarPath).then(() => true, () => false)) {
    if (await looksLikeAar(aarPath)) {
      const { size } = await fs.stat(aarPath);
      console.log(`✔ ${fileName} already present (${(size / 1e6).toFixed(1)} MB) — nothing to do.`);
      await writePom();
      return;
    }
    await fs.rm(aarPath);
  }

  await fs.mkdir(outDir, { recursive: true });
  const tmp = `${aarPath}.part`;
  const failures = [];

  for (const url of candidates) {
    process.stdout.write(`→ ${url}\n`);
    try {
      await download(url, tmp);
      if (!(await looksLikeAar(tmp))) throw new Error('response was not an AAR archive');
      await fs.rename(tmp, aarPath);
      const { size } = await fs.stat(aarPath);
      console.log(`✔ Saved ${path.relative(root, aarPath)} (${(size / 1e6).toFixed(1)} MB)`);
      await writePom();
      return;
    } catch (err) {
      failures.push(`  ${url}\n    ${err.message}`);
      await fs.rm(tmp, { force: true });
    }
  }

  console.error(
    [
      '',
      `✖ Could not download ${fileName} from any known source.`,
      '',
      ...failures,
      '',
      'Fix it in one of two ways:',
      '',
      `  1. Put the file at ${path.relative(root, aarPath)} yourself, then re-run this script`,
      '     (it will only validate + write the .pom).',
      '',
      '  2. Point the script at a mirror you control:',
      `       FFMPEG_KIT_AAR_URL=https://example.com/${fileName} npm run ffmpeg:fetch`,
      '     In CI, set the FFMPEG_KIT_AAR_URL repository variable or secret.',
      '',
      'Add long-lived mirrors to ffmpeg-kit.sources.json so this stops happening.',
      '',
    ].join('\n')
  );
  process.exit(1);
}

/** Minimal POM so Gradle can resolve the artifact and its one transitive dep. */
async function writePom() {
  const pom = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.arthenica</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>${version}</version>
  <packaging>aar</packaging>
  <dependencies>
    <dependency>
      <groupId>com.arthenica</groupId>
      <artifactId>smart-exception-java</artifactId>
      <version>0.2.1</version>
      <scope>compile</scope>
    </dependency>
  </dependencies>
</project>
`;
  await fs.writeFile(pomPath, pom, 'utf8');
}

await main();
