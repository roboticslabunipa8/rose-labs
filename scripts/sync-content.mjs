import { promises as fs } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outputDir = path.join(rootDir, "data");
const outputFile = path.join(outputDir, "site-content.json");
const outputScriptFile = path.join(outputDir, "site-content.js");

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];
const HEIC_EXTENSIONS = [".heic", ".heif"];
const VIDEO_EXTENSIONS = [".mov", ".mp4", ".webm", ".m4v"];
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS);
const HEIC_EXTENSION_SET = new Set(HEIC_EXTENSIONS);
const VIDEO_EXTENSION_SET = new Set(VIDEO_EXTENSIONS);
const DERIVED_DIR_NAME = "_derived";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function prettifySlug(slug) {
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function resolveLocalized(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => resolveLocalized(item, "")).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.it != null && value.it !== "") return String(value.it);
    if (value.en != null && value.en !== "") return String(value.en);
    const first = Object.values(value).find((entry) => entry != null && entry !== "");
    return first != null ? String(first) : fallback;
  }
  return fallback;
}

function normalizeMetadataIndex(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return new Map();
  }

  const entries = raw.items && Array.isArray(raw.items) ? raw.items : Object.entries(raw);
  const index = new Map();

  for (const entry of entries) {
    if (Array.isArray(entry)) {
      const [key, value] = entry;
      if (!key || !value || typeof value !== "object") continue;
      index.set(key, value);
      continue;
    }

    if (!entry || typeof entry !== "object") continue;
    const key = entry.slug || entry.stem || entry.file || entry.name;
    if (!key) continue;
    index.set(key, entry);
  }

  return index;
}

async function ensureJpegDerivative(sourcePath, targetPath) {
  const sourceStat = await safeStat(sourcePath);
  const targetStat = await safeStat(targetPath);
  if (sourceStat && targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs) {
    return targetPath;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  execFileSync("sips", ["-s", "format", "jpeg", sourcePath, "--out", targetPath], {
    stdio: "pipe"
  });
  return targetPath;
}

async function ensureVideoPoster(sourcePath, targetPath) {
  const sourceStat = await safeStat(sourcePath);
  const targetStat = await safeStat(targetPath);
  if (sourceStat && targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs) {
    return targetPath;
  }

  const targetDir = path.dirname(targetPath);
  await fs.mkdir(targetDir, { recursive: true });

  execFileSync("qlmanage", ["-t", "-s", "1400", "-o", targetDir, sourcePath], {
    stdio: "pipe"
  });

  const generatedPath = path.join(targetDir, `${path.basename(sourcePath)}.png`);
  if (generatedPath !== targetPath) {
    try {
      await fs.rm(targetPath, { force: true });
      await fs.rename(generatedPath, targetPath);
    } catch {
      if (await safeStat(generatedPath)) {
        return generatedPath;
      }
    }
  }

  return targetPath;
}

async function findMatchingFile(dirPath, stem, extensions) {
  const entries = await safeReadDir(dirPath);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const currentStem = path.parse(entry.name).name;
    const ext = path.parse(entry.name).ext.toLowerCase();
    if (currentStem === stem && extensions.includes(ext)) {
      return path.join(dirPath, entry.name);
    }
  }
  return null;
}

async function collectPublications() {
  const dirPath = path.join(rootDir, "publications");
  const entries = await safeReadDir(dirPath);
  const publications = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json" || entry.name === "index.json") {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const data = await readJson(filePath);
    const stem = path.basename(entry.name, ".json");
    const pdfPath = data.pdf
      ? path.join(dirPath, data.pdf)
      : await findMatchingFile(dirPath, stem, [".pdf"]);

    publications.push({
      slug: data.slug || stem,
      year: Number(data.year) || "",
      topic: Array.isArray(data.topic) ? data.topic : [],
      title: data.title || prettifySlug(stem),
      authors: data.authors || "",
      description: data.description || "",
      venue: data.venue || "",
      type: data.type || "",
      pdf: pdfPath ? toPosix(path.relative(rootDir, pdfPath)) : "",
      doi: data.doi || "",
      order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0
    });
  }

  const pdfEntries = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".pdf");
  for (const entry of pdfEntries) {
    const stem = path.basename(entry.name, ".pdf");
    const alreadyPresent = publications.some((publication) => publication.pdf.endsWith(`${stem}.pdf`) || publication.slug === stem);
    if (alreadyPresent) continue;
    publications.push({
      slug: stem,
      year: "",
      topic: [],
      title: { it: prettifySlug(stem), en: prettifySlug(stem) },
      authors: "",
      description: { it: "", en: "" },
      venue: { it: "", en: "" },
      type: { it: "Publication", en: "Publication" },
      pdf: toPosix(path.relative(rootDir, path.join(dirPath, entry.name))),
      doi: "",
      order: 0
    });
  }

  return publications.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return String(b.year).localeCompare(String(a.year));
  });
}

async function collectFolderItems(folderName, defaults = {}) {
  const dirPath = path.join(rootDir, folderName);
  const entries = await safeReadDir(dirPath);
  const items = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json" || entry.name === "index.json") {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const data = await readJson(filePath);
    const stem = path.basename(entry.name, ".json");
    const imagePath = data.image
      ? path.join(dirPath, data.image)
      : await findMatchingFile(dirPath, stem, IMAGE_EXTENSIONS);

    items.push({
      slug: data.slug || stem,
      name: data.name || prettifySlug(stem),
      role: data.role || "",
      bio: data.bio || data.description || "",
      description: data.description || data.bio || "",
      kind: data.kind || defaults.kind || "",
      quantity: Number(data.quantity) || defaults.quantity || 1,
      initials: data.initials || "",
      image: imagePath ? toPosix(path.relative(rootDir, imagePath)) : "",
      imageAlt: data.imageAlt || "",
      order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0
    });
  }

  return items.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return String(a.name).localeCompare(String(b.name));
  });
}

async function collectMedia() {
  const dirPath = path.join(rootDir, "media");
  const entries = await safeReadDir(dirPath);
  const media = [];
  const sidecars = new Map();
  const metadataIndex = normalizeMetadataIndex(await readOptionalJson(path.join(dirPath, "index.json")));
  const derivedDir = path.join(dirPath, DERIVED_DIR_NAME);

  await fs.mkdir(derivedDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const originalExt = path.extname(entry.name);
    const ext = originalExt.toLowerCase();
    if (ext === ".json" && entry.name !== "index.json") {
      const stem = path.basename(entry.name, ".json");
      sidecars.set(stem, await readJson(path.join(dirPath, entry.name)));
    }
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const originalExt = path.extname(entry.name);
    const ext = originalExt.toLowerCase();

    const stem = path.basename(entry.name, originalExt);
    const imagePath = path.join(dirPath, entry.name);
    const meta = {
      ...(metadataIndex.get(stem) || {}),
      ...(sidecars.get(stem) || {})
    };

    if (meta.exclude || meta.hidden) {
      continue;
    }

    const captionValue = meta.caption ?? meta.title ?? prettifySlug(stem);
    const altValue = meta.alt ?? meta.title ?? prettifySlug(stem);
    const orderValue = Number.isFinite(Number(meta.order)) ? Number(meta.order) : null;

    let src = "";
    let poster = "";
    let kind = meta.kind || "image";

    if (HEIC_EXTENSION_SET.has(ext)) {
      kind = "image";
      const derivedPath = path.join(derivedDir, `${stem}.jpg`);
      src = toPosix(path.relative(rootDir, await ensureJpegDerivative(imagePath, derivedPath)));
    } else if (VIDEO_EXTENSION_SET.has(ext)) {
      kind = "video";
      src = toPosix(path.relative(rootDir, imagePath));
      poster = toPosix(path.relative(rootDir, await ensureVideoPoster(imagePath, path.join(derivedDir, `${stem}.png`))));
    } else if (IMAGE_EXTENSION_SET.has(ext)) {
      src = toPosix(path.relative(rootDir, imagePath));
    } else {
      continue;
    }

    media.push({
      slug: meta.slug || stem,
      src,
      alt: altValue,
      caption: captionValue,
      kind,
      poster,
      order: orderValue
    });
  }

  return media.sort((a, b) => {
    const aOrder = a.order;
    const bOrder = b.order;
    if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
    if (aOrder != null && bOrder == null) return -1;
    if (aOrder == null && bOrder != null) return 1;
    return String(a.slug).localeCompare(String(b.slug));
  });
}

async function countProjectCards() {
  try {
    const html = await fs.readFile(path.join(rootDir, "projects.html"), "utf8");
    const matches = html.match(/<article\b[^>]*class="[^"]*\bproject\b[^"]*"/gi);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

async function main() {
  const [publications, people, equipment, media, projectsCount] = await Promise.all([
    collectPublications(),
    collectFolderItems("people"),
    collectFolderItems("equipment"),
    collectMedia(),
    countProjectCards()
  ]);

  const robotsCount = equipment
    .filter((item) => item.kind !== "xr")
    .reduce((count, item) => count + (Number(item.quantity) || 1), 0);
  const headsetsCount = equipment
    .filter((item) => item.kind === "xr")
    .reduce((count, item) => count + (Number(item.quantity) || 1), 0);

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      publications: publications.length,
      people: people.length,
      robots: robotsCount,
      headsets: headsetsCount,
      projects: projectsCount
    },
    publications,
    people,
    equipment,
    media
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await fs.writeFile(outputScriptFile, `window.__ROSE_SITE_CONTENT__ = ${JSON.stringify(output, null, 2)};\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
