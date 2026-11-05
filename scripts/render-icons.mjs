// Renders branding/icon.svg into the PNG sizes the manifest declares.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const svg = await readFile(new URL('../branding/icon.svg', import.meta.url), 'utf8');
const outDir = new URL('../public/icon/', import.meta.url);
await mkdir(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(new URL(`${size}.png`, outDir), png);
  console.log(`public/icon/${size}.png (${png.length} bytes)`);
}
