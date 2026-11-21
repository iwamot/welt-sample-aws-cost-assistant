import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const version = 'v0.10.23';
const filename = 'welt-lambda-python3.14-arm64.zip';
const sha256 = '4779246d9fb46b1c7f7437eb62f20616d148dace0c7b8c7d446ae4408131f752';
const url = `https://github.com/iwamot/welt/releases/download/${version}/${filename}`;

const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) {
  throw new Error(`Downloading Welt ${version} failed with HTTP ${response.status}`);
}

const archive = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(archive).digest('hex') !== sha256) {
  throw new Error(`SHA-256 mismatch for Welt ${version} (${filename})`);
}

await writeFile(join(process.argv[2], filename), archive);
