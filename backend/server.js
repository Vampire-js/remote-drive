const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;
const STORAGE_ROOT = path.join(__dirname, 'storage');

if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}

app.use(cors());
app.use(express.json());

/**
 * Resolves a user supplied relative path to an absolute path inside
 * STORAGE_ROOT. Any ".." segments are stripped out entirely so it is
 * impossible to escape the storage directory (path traversal protection).
 */
function resolveSafePath(relPath) {
  const cleaned = String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  const resolved = path.join(STORAGE_ROOT, cleaned);
  const rootWithSep = STORAGE_ROOT + path.sep;
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('Invalid path');
  }
  return resolved;
}

function sanitizeName(name) {
  return path.basename(String(name || '')).replace(/[/\\]/g, '_');
}

// List folders/files inside a directory
app.get('/api/items', async (req, res) => {
  try {
    const relPath = req.query.path || '';
    const dirPath = resolveSafePath(relPath);
    const stat = await fsp.stat(dirPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const entryStat = await fsp.stat(path.join(dirPath, entry.name));
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          size: entryStat.size,
          modified: entryStat.mtime,
        };
      })
    );

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: relPath, items });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create a new folder
app.post('/api/folders', async (req, res) => {
  try {
    const { path: relPath = '', name } = req.body || {};
    if (!name || /[/\\]/.test(name)) {
      return res.status(400).json({ error: 'Invalid folder name' });
    }
    const parent = resolveSafePath(relPath);
    const target = path.join(parent, sanitizeName(name));
    if (fs.existsSync(target)) {
      return res.status(409).json({ error: 'A file or folder with that name already exists' });
    }
    await fsp.mkdir(target);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload one or more files into a folder (target folder via ?path=).
// The client encodes each file's relative path (for folder uploads) in the
// FormData filename, e.g. "photos/vacation/img.jpg". We split that into a
// destination subdirectory (created on the fly) and the final leaf filename.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const relPath = req.query.path || '';
        const baseDir = resolveSafePath(relPath);

        // Browsers often mis-encode non-ASCII names as latin1 in multipart.
        const fixedName = Buffer.from(file.originalname, 'latin1').toString('utf8');

        // Split into safe segments, dropping any traversal attempts.
        const segments = fixedName
          .replace(/\\/g, '/')
          .split('/')
          .filter((s) => s && s !== '.' && s !== '..')
          .map(sanitizeName);

        const dirSegments = segments.slice(0, -1);
        const targetDir = path.join(baseDir, ...dirSegments);

        // Re-validate the resolved path stays inside STORAGE_ROOT.
        const rootWithSep = STORAGE_ROOT + path.sep;
        if (targetDir !== STORAGE_ROOT && !targetDir.startsWith(rootWithSep) && !targetDir.startsWith(baseDir)) {
          return cb(new Error('Invalid path'));
        }

        fs.mkdirSync(targetDir, { recursive: true });

        // Stash the leaf filename for the filename() callback below.
        file._finalName = segments[segments.length - 1] || sanitizeName(fixedName);
        cb(null, targetDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, file._finalName || sanitizeName(file.originalname));
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB per file
});

app.post('/api/upload', upload.array('files'), (req, res) => {
  const uploaded = (req.files || []).map((file) => file.filename);
  res.status(201).json({ ok: true, uploaded });
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ error: err.message || 'Upload failed' });
});

// Download a file
app.get('/api/download', async (req, res) => {
  try {
    const relPath = req.query.path || '';
    const filePath = resolveSafePath(relPath);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Rename a file or folder
app.patch('/api/items', async (req, res) => {
  try {
    const { path: relPath, newName } = req.body || {};
    if (!relPath) {
      return res.status(400).json({ error: 'Missing path' });
    }
    if (!newName || /[/\\]/.test(newName)) {
      return res.status(400).json({ error: 'Invalid name' });
    }
    const oldPath = resolveSafePath(relPath);
    const parentRel = relPath.split('/').slice(0, -1).join('/');
    const parent = resolveSafePath(parentRel);
    const newPath = path.join(parent, sanitizeName(newName));
    if (fs.existsSync(newPath)) {
      return res.status(409).json({ error: 'A file or folder with that name already exists' });
    }
    await fsp.rename(oldPath, newPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Storage usage stats (used by the app + underlying disk, when available)
async function getDirSize(dirPath) {
  let total = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirSize(fullPath);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}

app.get('/api/stats', async (_req, res) => {
  try {
    const used = await getDirSize(STORAGE_ROOT);
    let total = null;
    let free = null;
    try {
      const statfs = await fsp.statfs(STORAGE_ROOT);
      total = statfs.bsize * statfs.blocks;
      free = statfs.bsize * statfs.bfree;
    } catch {
      // fs.statfs isn't available on this platform/Node version; skip disk totals
    }
    res.json({ used, total, free });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a file or folder
app.delete('/api/items', async (req, res) => {
  try {
    const relPath = req.query.path || '';
    if (!relPath) {
      return res.status(400).json({ error: 'Cannot delete the root folder' });
    }
    const target = resolveSafePath(relPath);
    await fsp.rm(target, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Serve the built frontend (run `npm run build` in the project root first)
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`My Drive server running at http://0.0.0.0:${PORT}`);
});

