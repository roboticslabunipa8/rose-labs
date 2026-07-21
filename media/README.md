# Media gallery source

Drop lab photos and videos here, then rerun `node scripts/sync-content.mjs`.

Supported image files:
- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.gif`
- `.svg`
- `.heic`
- `.heif`

Supported video files:
- `.mov`
- `.mp4`
- `.webm`
- `.m4v`

Optional metadata:
- `same-name.json`
- `index.json`
- Example fields: `caption`, `alt`, `order`, `slug`, `kind`, `exclude`

Notes:
- HEIC and HEIF images are converted to web-friendly JPEG derivatives automatically.
- Video files get an automatic poster thumbnail in the `_derived/` folder.
- Set `exclude: true` to keep legacy files in the folder without showing them in the site.
