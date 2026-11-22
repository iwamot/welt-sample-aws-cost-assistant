import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// renovate: datasource=github-releases depName=iwamot/welt
const version = 'v0.10.23';
const filename = 'welt-lambda-python3.14-arm64.zip';

// Welt's releases are immutable, so the SHA-256 digest that GitHub records for the
// asset can't change after the release. Checking the download against it catches a
// corrupted or replaced file without pinning the hash here next to the version.
const headers = { Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}
const releaseResponse = await fetch(
  `https://api.github.com/repos/iwamot/welt/releases/tags/${version}`,
  { headers, signal: AbortSignal.timeout(30_000) },
);
if (!releaseResponse.ok) {
  throw new Error(`Reading Welt ${version} failed with HTTP ${releaseResponse.status}`);
}
const release = await releaseResponse.json();
if (release.immutable !== true) {
  throw new Error(`Welt ${version} is not an immutable release`);
}
const asset = release.assets.find((a) => a.name === filename);
if (!asset) {
  throw new Error(`Welt ${version} has no asset named ${filename}`);
}
if (!asset.digest?.startsWith('sha256:')) {
  throw new Error(`Welt ${version} has no SHA-256 digest for ${filename}`);
}

const response = await fetch(asset.browser_download_url, {
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok) {
  throw new Error(`Downloading Welt ${version} failed with HTTP ${response.status}`);
}

const archive = Buffer.from(await response.arrayBuffer());
if (`sha256:${createHash('sha256').update(archive).digest('hex')}` !== asset.digest) {
  throw new Error(`SHA-256 mismatch for Welt ${version} (${filename})`);
}

await writeFile(join(process.argv[2], filename), archive);
