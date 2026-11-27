import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// renovate: datasource=github-releases depName=iwamot/welt
const version = 'v0.10.29';

// Downloads the Welt Lambda ZIP of the version above into the directory given as the
// first argument, and prints the release's welt-lambda.json, which names the ZIP and
// the runtime, architecture, and handler to run it under. The stack reads them from
// there, so a Welt release that moves to another Python needs no change here.

// Welt's releases are immutable, so the SHA-256 digest that GitHub records for each
// asset can't change after the release. Checking each download against it catches a
// corrupted or replaced file without pinning hashes here next to the version.
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

async function download(filename, timeout) {
  const asset = release.assets.find((a) => a.name === filename);
  if (!asset) {
    throw new Error(`Welt ${version} has no asset named ${filename}`);
  }
  if (!asset.digest?.startsWith('sha256:')) {
    throw new Error(`Welt ${version} has no SHA-256 digest for ${filename}`);
  }
  const response = await fetch(asset.browser_download_url, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    throw new Error(
      `Downloading ${filename} of Welt ${version} failed with HTTP ${response.status}`,
    );
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (`sha256:${createHash('sha256').update(content).digest('hex')}` !== asset.digest) {
    throw new Error(`SHA-256 mismatch for ${filename} of Welt ${version}`);
  }
  return content;
}

const manifest = JSON.parse(await download('welt-lambda.json', 30_000));
await writeFile(join(process.argv[2], manifest.zip), await download(manifest.zip, 120_000));
process.stdout.write(JSON.stringify(manifest));
