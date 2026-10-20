const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = process.env.EDITOR_IMAGE_MODULES
  ? createRequire(path.join(process.env.EDITOR_IMAGE_MODULES, 'package.json'))('sharp')
  : require('sharp');

(async () => {
  const source = path.join(__dirname, 'app-icon-retro-source.png');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) images.push(await sharp(source).resize(size, size, { kernel: 'nearest' }).png().toBuffer());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  await fs.writeFile(path.join(__dirname, 'app-icon.ico'), Buffer.concat([header, ...images]));
  await fs.writeFile(path.join(__dirname, '../launcher/app-icon.png'), images.at(-1));
  await fs.writeFile(path.join(__dirname, 'app-icon-32.png'), images[2]);
  console.log('Generated app-icon.ico, app-icon-32.png and launcher/app-icon.png');
})().catch((error) => { console.error(error); process.exitCode = 1; });
