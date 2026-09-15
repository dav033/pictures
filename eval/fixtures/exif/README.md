# Fixtures EXIF

Shared by Plan A §A0.2 (reference analysis transport) and Plan C C0.6. Synthetic images only; no photos.

| File | Stored pixels | EXIF orientation | Displayed | Marker |
|---|---|---|---|---|
| `orientacion-6.jpg` | 240×160 | 6 (rotate 90° clockwise) | 160×240 | Red band: left third when stored, top third when displayed |

Generated once with sharp 0.35 (the committed bytes are the fixture; regeneration need not be byte-identical):

```js
const red = await sharp({ create: { width: 80, height: 160, channels: 3, background: "#ff0000" } }).png().toBuffer();
await sharp({ create: { width: 240, height: 160, channels: 3, background: "#808080" } })
  .composite([{ input: red, left: 0, top: 0 }])
  .jpeg({ quality: 90 })
  .withMetadata({ orientation: 6 })
  .toFile("eval/fixtures/exif/orientacion-6.jpg");
```
