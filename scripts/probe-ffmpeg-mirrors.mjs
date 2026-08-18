#!/usr/bin/env node
/**
 * Diagnostic: find a live source for the withdrawn ffmpeg-kit Android AARs.
 *
 * Meant to be run on a CI runner with unrestricted egress. It lists the
 * `com/arthenica` directory on the public Maven mirrors, enumerates release
 * assets on the forks known to ship binaries, and prints anything that serves
 * an AAR so it can be pinned in ffmpeg-kit.sources.json.
 */

const MAVEN_MIRRORS = [
  'https://repo1.maven.org/maven2',
  'https://maven.aliyun.com/repository/public',
  'https://maven.aliyun.com/repository/central',
  'https://mirrors.cloud.tencent.com/nexus/repository/maven-public',
  'https://repo.huaweicloud.com/repository/maven',
  'https://maven-central.storage-download.googleapis.com/maven2',
  'https://maven-central-asia.storage-download.googleapis.com/maven2',
  'https://repository.mulesoft.org/nexus/content/repositories/public',
  'https://packages.atlassian.com/maven-central',
  'https://plugins.gradle.org/m2',
  'https://jitpack.io',
];

const ARTIFACTS = ['ffmpeg-kit-full-gpl', 'ffmpeg-kit-full', 'ffmpeg-kit-https', 'mobile-ffmpeg-full-gpl'];
const VERSIONS = ['6.0-2', '6.0', '5.1', '4.4'];

const FORKS = [
  'arthenica/ffmpeg-kit',
  '2004durgesh/ffmpeg-kit',
  'Daniel-Griffiths/expo-ffmpeg',
  'wokcito/ffmpeg-kit',
  'tanersener/ffmpeg-kit',
];

const hits = [];

async function head(url) {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-64' } });
    return { status: response.status, length: response.headers.get('content-range') ?? response.headers.get('content-length') };
  } catch (error) {
    return { status: 0, length: String(error.message).slice(0, 60) };
  }
}

async function probeMavenMirrors() {
  for (const base of MAVEN_MIRRORS) {
    console.log(`\n=== ${base}`);
    try {
      const response = await fetch(`${base}/com/arthenica/`, { redirect: 'follow' });
      const body = response.ok ? await response.text() : '';
      const entries = [...body.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => !h.startsWith('.'));
      console.log(`  index ${response.status}: ${entries.slice(0, 15).join(' ') || '(no listing)'}`);
    } catch (error) {
      console.log(`  index failed: ${String(error.message).slice(0, 80)}`);
    }

    for (const artifact of ARTIFACTS) {
      for (const version of VERSIONS) {
        const url = `${base}/com/arthenica/${artifact}/${version}/${artifact}-${version}.aar`;
        const { status, length } = await head(url);
        if (status === 200 || status === 206) {
          console.log(`  HIT ${status} ${length ?? ''} ${url}`);
          hits.push(url);
        }
      }
    }
  }
}

async function probeForks() {
  for (const repo of FORKS) {
    console.log(`\n=== github.com/${repo}`);
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=15`, {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        console.log(`  ${response.status}: ${payload?.message ?? 'no releases'}`);
        continue;
      }
      if (!payload.length) console.log('  (no releases)');
      for (const release of payload) {
        const assets = release.assets ?? [];
        console.log(`  tag ${release.tag_name} — ${assets.length} asset(s)`);
        for (const asset of assets) {
          console.log(`     ${asset.name} ${(asset.size / 1e6).toFixed(1)} MB ${asset.browser_download_url}`);
          if (asset.name.endsWith('.aar')) hits.push(asset.browser_download_url);
        }
      }
    } catch (error) {
      console.log(`  failed: ${String(error.message).slice(0, 80)}`);
    }
  }
}

async function searchGitHub() {
  console.log('\n=== repository search');
  const queries = [
    'ffmpeg-kit+aar+in:name,description,readme',
    'ffmpeg-kit+mirror+in:name,description',
    'ffmpeg+kit+android+aar+release',
  ];
  for (const query of queries) {
    try {
      const response = await fetch(`https://api.github.com/search/repositories?q=${query}&per_page=10`, {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      const payload = await response.json();
      console.log(`  query "${query}" -> ${response.status}`);
      for (const item of payload.items ?? []) {
        console.log(`     ${item.full_name} ★${item.stargazers_count} ${(item.description ?? '').slice(0, 70)}`);
      }
    } catch (error) {
      console.log(`  failed: ${String(error.message).slice(0, 80)}`);
    }
  }
}

await probeMavenMirrors();
await probeForks();
await searchGitHub();

console.log('\n==================== SUMMARY ====================');
if (hits.length) {
  console.log('Working AAR sources:');
  for (const hit of hits) console.log(`  ${hit}`);
} else {
  console.log('No source served an ffmpeg-kit AAR.');
}
