const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const os = require('os');

let mainWindow = null;

function getUserDataPath() {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.sentinel-fs');
  }
}

function getLedgerFile() {
  return path.join(getUserDataPath(), 'audit_ledger.json');
}

function getProfilesFile() {
  return path.join(getUserDataPath(), 'profiles.json');
}

const QUARANTINE_DIR_NAME = '_Quarantined_Duplicates';
const DUPLICATE_SCAN_MAX_DEPTH = 12;
const PARTIAL_HASH_CHUNK = 64 * 1024;
const LEDGER_FLUSH_INTERVAL = 25;

// Writes JSON via temp file + rename so a crash mid-write never corrupts the file.
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// True when `child` is strictly inside `parent` (case-insensitive on Windows).
function isPathInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSamePath(a, b) {
  return path.relative(path.resolve(a), path.resolve(b)) === '';
}

// Returns a path that does not exist yet by appending " (n)" or " (label n)" before the extension.
function getAvailablePath(desiredPath, label = '') {
  if (!fs.existsSync(desiredPath)) return desiredPath;
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const base = path.basename(desiredPath, ext);
  for (let n = 1; n < 10000; n++) {
    const suffix = label ? (n === 1 ? ` (${label})` : ` (${label} ${n})`) : ` (${n})`;
    const candidate = path.join(dir, `${base}${suffix}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`No free filename available for ${path.basename(desiredPath)}`);
}

// fs.rename silently replaces an existing destination on Windows, so always resolve a free name first.
async function moveFileSafely(src, desiredDest, label = '') {
  await fsPromises.mkdir(path.dirname(desiredDest), { recursive: true });
  const dest = getAvailablePath(desiredDest, label);
  await fsPromises.rename(src, dest);
  return dest;
}

function newSessionId() {
  return `sess_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

// Built-in Organization Templates
const BUILTIN_PROFILES = [
  {
    id: 'general',
    name: 'General Purpose',
    description: 'All-around organization for personal files, downloads, and mixed folders',
    isBuiltin: true,
    rules: [
      { id: 'gen-inv', name: 'Invoices & Receipts', type: 'regex', pattern: 'invoice|receipt|bill|statement|tax|payslip', targetFolder: 'Finance', enabled: true },
      { id: 'gen-screen', name: 'Screenshots', type: 'regex', pattern: 'screenshot|screen|scrn|capture|snip', targetFolder: 'Screenshots', enabled: true },
      { id: 'gen-backup', name: 'Backups', type: 'regex', pattern: 'backup|bak|snapshot|archive', targetFolder: 'Backups', enabled: true },
      { id: 'gen-temp', name: 'Temporary Files', type: 'regex', pattern: 'temp|tmp|draft|wip|scratch', targetFolder: 'Temporary', enabled: true },
      { id: 'gen-pdf', name: 'PDF Documents', type: 'extension', pattern: '.pdf', targetFolder: 'Documents/PDF', enabled: true },
      { id: 'gen-word', name: 'Word Documents', type: 'extension', pattern: '.doc,.docx', targetFolder: 'Documents/Word', enabled: true },
      { id: 'gen-excel', name: 'Spreadsheets', type: 'extension', pattern: '.xlsx,.xls,.csv', targetFolder: 'Documents/Spreadsheets', enabled: true },
      { id: 'gen-ppt', name: 'Presentations', type: 'extension', pattern: '.pptx,.ppt,.key', targetFolder: 'Documents/Presentations', enabled: true },
      { id: 'gen-text', name: 'Notes & Text', type: 'extension', pattern: '.txt,.rtf,.md', targetFolder: 'Documents/Notes', enabled: true },
      { id: 'gen-img', name: 'Images & Photos', type: 'extension', pattern: '.jpg,.jpeg,.png,.gif,.webp,.svg', targetFolder: 'Media/Images', enabled: true },
      { id: 'gen-video', name: 'Videos', type: 'extension', pattern: '.mp4,.mkv,.avi,.mov,.webm', targetFolder: 'Media/Videos', enabled: true },
      { id: 'gen-audio', name: 'Audio', type: 'extension', pattern: '.mp3,.wav,.flac,.aac,.m4a', targetFolder: 'Media/Audio', enabled: true },
      { id: 'gen-arch', name: 'Compressed Archives', type: 'extension', pattern: '.zip,.rar,.tar,.gz,.7z', targetFolder: 'Archives', enabled: true },
      { id: 'gen-exe', name: 'Software Installers', type: 'extension', pattern: '.exe,.msi,.bat,.cmd,.ps1', targetFolder: 'Installers', enabled: true },
      { id: 'gen-code', name: 'Code Files', type: 'extension', pattern: '.py,.js,.ts,.html,.css,.json', targetFolder: 'Developer', enabled: true },
    ]
  },
  {
    id: 'developer',
    name: 'Developer Workspace',
    description: 'Separates source code, web components, configuration, dependencies, and logs',
    isBuiltin: true,
    rules: [
      { id: 'dev-src', name: 'Backend Code', type: 'extension', pattern: '.py,.go,.rs,.java,.cpp,.c,.cs,.rb,.php', targetFolder: 'src/backend', enabled: true },
      { id: 'dev-ui', name: 'Frontend & Web', type: 'extension', pattern: '.ts,.tsx,.js,.jsx,.vue,.svelte,.html,.css,.scss', targetFolder: 'src/frontend', enabled: true },
      { id: 'dev-cfg', name: 'Configs & Environment', type: 'extension', pattern: '.json,.yaml,.yml,.toml,.xml,.ini,.conf', targetFolder: 'config', enabled: true },
      { id: 'dev-sql', name: 'Database & SQL Dumps', type: 'extension', pattern: '.sql,.sqlite,.db,.prisma', targetFolder: 'database', enabled: true },
      { id: 'dev-log', name: 'Logs & Traces', type: 'extension', pattern: '.log,.out,.trace', targetFolder: 'logs', enabled: true },
      { id: 'dev-script', name: 'Shell & Automation', type: 'extension', pattern: '.sh,.bash,.zsh,.ps1,.bat,.cmd', targetFolder: 'scripts', enabled: true },
      { id: 'dev-bundle', name: 'Packages & Archives', type: 'extension', pattern: '.zip,.tar.gz,.tgz,.tar', targetFolder: 'packages', enabled: true },
      { id: 'dev-doc', name: 'Documentation', type: 'extension', pattern: '.md,.markdown,.pdf,.txt', targetFolder: 'docs', enabled: true },
    ]
  },
  {
    id: 'media',
    name: 'Media & Creator Studio',
    description: 'High-res photography, raw camera formats, video footage, audio stems, and design assets',
    isBuiltin: true,
    rules: [
      { id: 'med-raw', name: 'RAW Photography', type: 'extension', pattern: '.raw,.cr2,.nef,.arw,.dng,.orf', targetFolder: 'Footage/RAW', enabled: true },
      { id: 'med-video', name: 'Video Footage', type: 'extension', pattern: '.mp4,.mov,.mkv,.avi,.m4v,.prproj,.drp', targetFolder: 'Footage/Video', enabled: true },
      { id: 'med-audio', name: 'Audio Stems & Sound', type: 'extension', pattern: '.wav,.aif,.aiff,.flac,.mp3,.mid', targetFolder: 'Audio/Stems', enabled: true },
      { id: 'med-design', name: 'Vector & Project Design', type: 'extension', pattern: '.psd,.ai,.fig,.svg,.eps,.xd', targetFolder: 'Design/Projects', enabled: true },
      { id: 'med-photo', name: 'Exports & Photos', type: 'extension', pattern: '.jpg,.jpeg,.png,.webp,.tiff', targetFolder: 'Photos/Exports', enabled: true },
      { id: 'med-3d', name: '3D Models & Assets', type: 'extension', pattern: '.blend,.obj,.fbx,.stl,.gltf', targetFolder: '3D/Assets', enabled: true },
    ]
  },
  {
    id: 'office',
    name: 'Office & Finance',
    description: 'Designed for administrative work: receipts, contracts, tax files, and presentations',
    isBuiltin: true,
    rules: [
      { id: 'off-inv', name: 'Invoices & Receipts', type: 'regex', pattern: 'invoice|receipt|bill|statement|tax|payslip', targetFolder: 'Financial/Invoices', enabled: true },
      { id: 'off-legal', name: 'Contracts & Agreements', type: 'regex', pattern: 'contract|agreement|nda|terms|policy', targetFolder: 'Legal/Contracts', enabled: true },
      { id: 'off-sheet', name: 'Spreadsheets', type: 'extension', pattern: '.xlsx,.xls,.csv,.tsv', targetFolder: 'Spreadsheets', enabled: true },
      { id: 'off-pdf', name: 'PDF Reports', type: 'extension', pattern: '.pdf', targetFolder: 'Reports/PDF', enabled: true },
      { id: 'off-word', name: 'Word Documents', type: 'extension', pattern: '.docx,.doc', targetFolder: 'Documents/Word', enabled: true },
      { id: 'off-deck', name: 'Slide Decks', type: 'extension', pattern: '.pptx,.ppt,.key', targetFolder: 'Presentations', enabled: true },
    ]
  },
  {
    id: 'desktop_clean',
    name: 'Desktop & Downloads Cleaner',
    description: 'Rapidly declutters screenshots, downloads, setup installers, and stale drafts',
    isBuiltin: true,
    rules: [
      { id: 'clean-snip', name: 'Screenshots', type: 'regex', pattern: 'screenshot|screen|scrn|capture|snip', targetFolder: 'Screenshots', enabled: true },
      { id: 'clean-inst', name: 'Software Installers', type: 'extension', pattern: '.exe,.msi,.dmg,.pkg,.apk', targetFolder: 'Installers', enabled: true },
      { id: 'clean-zip', name: 'Downloaded Archives', type: 'extension', pattern: '.zip,.rar,.tar,.gz,.7z', targetFolder: 'Archives', enabled: true },
      { id: 'clean-draft', name: 'Drafts & Scratch', type: 'regex', pattern: 'draft|wip|temp|tmp|scratch', targetFolder: 'Drafts', enabled: true },
      { id: 'clean-docs', name: 'Documents', type: 'extension', pattern: '.pdf,.docx,.xlsx,.pptx,.txt', targetFolder: 'Documents', enabled: true },
      { id: 'clean-pics', name: 'Images', type: 'extension', pattern: '.jpg,.jpeg,.png,.gif,.webp', targetFolder: 'Images', enabled: true },
    ]
  }
];

function isProtectedSystemPath(testPath) {
  if (!testPath) return true;
  const normalized = path.resolve(testPath).toLowerCase();
  if (/^[a-z]:\\?$/i.test(normalized)) return true;
  
  const systemPaths = [
    process.env.SystemRoot?.toLowerCase() || 'c:\\windows',
    process.env['ProgramFiles']?.toLowerCase() || 'c:\\program files',
    process.env['ProgramFiles(x86)']?.toLowerCase() || 'c:\\program files (x86)',
    process.env.ProgramData?.toLowerCase() || 'c:\\programdata',
    path.join(os.homedir(), '.ssh').toLowerCase(),
    path.join(os.homedir(), '.gnupg').toLowerCase(),
  ];
  
  for (const sysPath of systemPaths) {
    if (normalized === sysPath || normalized.startsWith(sysPath + path.sep)) {
      return true;
    }
  }
  
  const base = path.basename(normalized);
  const forbiddenFiles = ['.git', '.env', '.ssh', 'ntuser.dat', 'pagefile.sys', 'hiberfil.sys', 'node_modules', QUARANTINE_DIR_NAME.toLowerCase()];
  if (forbiddenFiles.includes(base)) return true;
  
  return false;
}

// Cheap pre-filter: hashes the first and last 64 KB. Only used to narrow candidates,
// never to decide that two files are identical. Returns null if the file can't be read.
async function getPartialFileHash(filePath, size) {
  let handle;
  try {
    handle = await fsPromises.open(filePath, 'r');
    const hash = crypto.createHash('sha256');
    const head = Buffer.alloc(Math.min(PARTIAL_HASH_CHUNK, size));
    const { bytesRead: headRead } = await handle.read(head, 0, head.length, 0);
    hash.update(head.subarray(0, headRead));
    if (size > PARTIAL_HASH_CHUNK) {
      const tailLen = Math.min(PARTIAL_HASH_CHUNK, size - PARTIAL_HASH_CHUNK);
      const tail = Buffer.alloc(tailLen);
      const { bytesRead: tailRead } = await handle.read(tail, 0, tailLen, size - tailLen);
      hash.update(tail.subarray(0, tailRead));
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

// Full-content SHA-256. Returns null if the file can't be read, so unreadable files
// are excluded instead of being given a placeholder hash that could collide.
function getFullFileHash(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

// Groups files by a (possibly async) key function, keeping only groups with 2+ members.
async function regroup(groups, keyFn, onEach) {
  const result = [];
  for (const files of groups) {
    const byKey = new Map();
    for (const file of files) {
      const key = await keyFn(file);
      if (onEach) onEach(file);
      if (key === null) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(file);
    }
    for (const [key, members] of byKey.entries()) {
      if (members.length > 1) result.push({ key, files: members });
    }
  }
  return result;
}

function loadLedger() {
  try {
    const file = getLedgerFile();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading ledger:', err);
  }
  return { sessions: [] };
}

function saveLedger(ledger) {
  try {
    const file = getLedgerFile();
    writeJsonAtomic(file, ledger);
  } catch (err) {
    console.error('Error saving ledger:', err);
  }
}

function loadProfilesData() {
  try {
    const file = getProfilesFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(data.profiles) && data.profiles.length > 0) {
        return data;
      }
    }
  } catch (err) {
    console.error('Error reading profiles:', err);
  }
  const initial = { profiles: BUILTIN_PROFILES, activeProfileId: 'general' };
  saveProfilesData(initial);
  return initial;
}

function saveProfilesData(data) {
  try {
    const file = getProfilesFile();
    writeJsonAtomic(file, data);
    return true;
  } catch (err) {
    console.error('Error saving profiles:', err);
    return false;
  }
}

function tokenizeFilename(nameWithoutExt) {
  const spaced = nameWithoutExt
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2');
  return spaced.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

function matchesRegexOrKeywords(filename, pattern) {
  const parsed = path.parse(filename);
  const baseName = parsed.name;

  // Simple keyword list separated by '|' or ',' without regex meta-syntax
  const isSimpleKeywordList = /^[\w\s\-|,]+$/i.test(pattern);

  if (isSimpleKeywordList) {
    const rawKeywords = pattern.split(/[|,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (rawKeywords.length === 0) return false;

    const tokens = tokenizeFilename(baseName);
    const lowerBase = baseName.toLowerCase();

    for (const kw of rawKeywords) {
      if (tokens.includes(kw)) return true;
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundedRegex = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
      if (boundedRegex.test(lowerBase)) return true;
    }
    return false;
  }

  // Advanced regex supplied by user
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(baseName) || re.test(filename);
  } catch {
    return false;
  }
}

function evaluateFileCategory(filename, rules) {
  const ext = path.extname(filename).toLowerCase();
  
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'regex') continue;
    if (matchesRegexOrKeywords(filename, rule.pattern)) {
      return { targetFolder: rule.targetFolder, ruleName: rule.name, ruleId: rule.id };
    }
  }
  
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'extension') continue;
    const extensions = rule.pattern.toLowerCase().split(',').map(s => s.trim().startsWith('.') ? s.trim() : `.${s.trim()}`);
    if (extensions.includes(ext)) {
      return { targetFolder: rule.targetFolder, ruleName: rule.name, ruleId: rule.id };
    }
  }
  
  const cleanExt = ext ? ext.slice(1).toUpperCase() : 'NO_EXT';
  return { targetFolder: `Unsorted/${cleanExt}`, ruleName: 'Extension Fallback', ruleId: 'fallback' };
}

function createWindow() {
  const isWin = process.platform === 'win32';
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 660,
    frame: true,
    titleBarStyle: isWin ? 'hidden' : 'default',
    ...(isWin ? {
      titleBarOverlay: {
        color: '#f1f5f9',
        symbolColor: '#334155',
        height: 36
      }
    } : {}),
    autoHideMenuBar: true,
    backgroundColor: '#f1f5f9',
    title: 'SentinelFS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  const localHtmlPath = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(localHtmlPath) && process.env.NODE_ENV !== 'development') {
    mainWindow.loadFile(localHtmlPath);
  } else {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      if (fs.existsSync(localHtmlPath)) {
        mainWindow.loadFile(localHtmlPath);
      }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================================
// IPC Handlers
// ============================================================================

ipcMain.handle('dialog:select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'dontAddToRecent'],
    title: 'Select Folder to Organize'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('system:get-info', async () => {
  return {
    osPlatform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    isoTimestamp: new Date().toISOString()
  };
});

ipcMain.handle('profiles:get', async () => loadProfilesData());
ipcMain.handle('profiles:save', async (_event, data) => saveProfilesData(data));

const MONTH_RAW_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function computeTargetFolder({ filename, categoryFolder, modifiedMs, strategy = 'category-only' }) {
  const d = new Date(modifiedMs);
  const year = d.getFullYear();
  const monthNum = String(d.getMonth() + 1).padStart(2, '0');
  const monthRaw = MONTH_RAW_NAMES[d.getMonth()] || `${monthNum}`;
  const dayNum = String(d.getDate()).padStart(2, '0');
  const quarter = `Q${Math.floor(d.getMonth() / 3) + 1}`;
  const ymd = `${year}-${monthNum}-${dayNum}`;
  
  // Year included directly in the month or day folder name (no separate year folder)
  const yearMonthFormatted = `${year}-${monthNum} - ${monthRaw}`; // e.g. "2026-11 - November"
  const monthYearFormatted = `${monthRaw} ${year}`; // e.g. "November 2026"
  const yearQuarterFormatted = `${year}-${quarter}`; // e.g. "2026-Q4"

  switch (strategy) {
    // 📂 Category First (Year included directly in month/day folder name, no separate year folder):
    case 'category-year-month':
      // e.g. Documents / 2026-11 - November
      return path.join(categoryFolder, yearMonthFormatted);
    case 'category-month-year':
      // e.g. Documents / November 2026
      return path.join(categoryFolder, monthYearFormatted);
    case 'category-year-quarter':
      // e.g. Documents / 2026-Q4
      return path.join(categoryFolder, yearQuarterFormatted);
    case 'category-date':
      // e.g. Documents / 2026-11
      return path.join(categoryFolder, `${year}-${monthNum}`);
    case 'category-exact-date':
      // e.g. Documents / 2026-11-06
      return path.join(categoryFolder, ymd);

    // 📅 Date First (Year included directly in month/day folder name, no separate year folder):
    case 'year-month-category':
      // e.g. 2026-11 - November / Documents
      return path.join(yearMonthFormatted, categoryFolder);
    case 'year-quarter-category':
      // e.g. 2026-Q4 / Documents
      return path.join(yearQuarterFormatted, categoryFolder);
    case 'year-month':
      // e.g. 2026-11 - November
      return yearMonthFormatted;
    case 'month-year':
      // e.g. November 2026
      return monthYearFormatted;
    case 'year-quarter':
      // e.g. 2026-Q4
      return yearQuarterFormatted;
    case 'exact-date':
      // e.g. 2026-11-06
      return ymd;

    // 📁 Basic & Flat:
    case 'flatten':
      return '';
    case 'category-only':
    default:
      return categoryFolder;
  }
}

async function collectFilesRecursive(dir, currentDepth = 0, maxDepth = 10) {
  const result = [];
  if (currentDepth > maxDepth) return result;
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (isProtectedSystemPath(full)) continue;
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === QUARANTINE_DIR_NAME.toLowerCase()) continue;
        const sub = await collectFilesRecursive(full, currentDepth + 1, maxDepth);
        result.push(...sub);
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
  } catch {}
  return result;
}

ipcMain.handle('fs:scan-directory', async (_event, dirPath, optionsOrRules, legacyDestinationDir) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    throw new Error('Directory path does not exist');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('This system folder is protected from modification.');
  }

  let rules = null;
  let destinationDir = legacyDestinationDir;
  let includeSubfolders = false;
  let dateStrategy = 'category-only';

  if (Array.isArray(optionsOrRules)) {
    rules = optionsOrRules;
  } else if (optionsOrRules && typeof optionsOrRules === 'object') {
    rules = optionsOrRules.rules;
    destinationDir = optionsOrRules.destinationDir || legacyDestinationDir;
    includeSubfolders = !!optionsOrRules.includeSubfolders;
    dateStrategy = optionsOrRules.dateStrategy || 'category-only';
  }

  if (!Array.isArray(rules) || rules.length === 0) {
    const pData = loadProfilesData();
    const active = pData.profiles.find(p => p.id === pData.activeProfileId) || pData.profiles[0];
    rules = active.rules;
  }

  const baseTarget = (destinationDir && fs.existsSync(destinationDir)) ? destinationDir : dirPath;
  const candidates = [];
  let totalBytes = 0;

  let filePaths = [];
  if (includeSubfolders) {
    filePaths = await collectFilesRecursive(dirPath);
  } else {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dirPath, entry.name);
      if (!isProtectedSystemPath(full)) filePaths.push(full);
    }
  }

  for (const fullPath of filePaths) {
    try {
      const stats = fs.statSync(fullPath);
      totalBytes += stats.size;
      const filename = path.basename(fullPath);
      
      const categoryInfo = evaluateFileCategory(filename, rules);
      const proposedFolder = computeTargetFolder({
        filename,
        categoryFolder: categoryInfo.targetFolder,
        modifiedMs: stats.mtimeMs,
        strategy: dateStrategy
      });

      const proposedPath = proposedFolder ? path.join(baseTarget, proposedFolder, filename) : path.join(baseTarget, filename);
      const ageDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      const currentSubfolder = path.relative(dirPath, path.dirname(fullPath));
      const isNested = currentSubfolder !== '' && currentSubfolder !== '.';
      const normalizedCurrentSubfolder = isNested ? currentSubfolder.replace(/\\/g, '/') : undefined;
      const alreadyOrganized = isSamePath(fullPath, proposedPath);
      
      let status = 'loose';
      if (alreadyOrganized) {
        status = 'organized';
      } else if (isNested) {
        status = 'reorganize';
      }

      const d = new Date(stats.mtimeMs);
      const mNum = String(d.getMonth() + 1).padStart(2, '0');
      const mRaw = MONTH_RAW_NAMES[d.getMonth()] || `${mNum}`;
      const dateGroup = `${d.getFullYear()}-${mNum} - ${mRaw}`;
      
      candidates.push({
        id: crypto.randomUUID(),
        name: filename,
        originalPath: fullPath,
        sizeBytes: stats.size,
        modifiedIso: d.toISOString(),
        createdIso: new Date(stats.birthtimeMs).toISOString(),
        ageDays: Math.round(ageDays * 10) / 10,
        proposedFolder,
        proposedPath,
        ruleName: categoryInfo.ruleName,
        ruleId: categoryInfo.ruleId,
        selected: !alreadyOrganized,
        collision: !alreadyOrganized && fs.existsSync(proposedPath),
        currentSubfolder: normalizedCurrentSubfolder,
        isNested,
        dateGroup,
        alreadyOrganized,
        status
      });
    } catch (err) {
      console.warn(`Error reading ${fullPath}:`, err);
    }
  }

  return {
    dirPath,
    destinationDir: baseTarget !== dirPath ? baseTarget : undefined,
    includeSubfolders,
    dateStrategy,
    totalFiles: candidates.length,
    totalBytes,
    candidates
  };
});

ipcMain.handle('fs:execute-organize', async (_event, payload) => {
  const { dirPath, destinationDir, candidates, organizeByChronology, dateStrategy, profileName } = payload;
  if (!dirPath || !Array.isArray(candidates)) {
    throw new Error('Invalid execute payload');
  }

  const baseTarget = (destinationDir && fs.existsSync(destinationDir)) ? destinationDir : dirPath;
  const sessionId = newSessionId();
  const startTimestamp = new Date().toISOString();
  const ledger = loadLedger();
  
  const records = [];
  let movedCount = 0;
  let errorCount = 0;
  let lastProgressSent = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item.selected) continue;

    await new Promise(r => setImmediate(r));

    const now = Date.now();
    if (mainWindow && (now - lastProgressSent > 60 || i === candidates.length - 1)) {
      lastProgressSent = now;
      mainWindow.webContents.send('organize:progress', {
        current: i + 1,
        total: candidates.length,
        currentFile: item.name,
        percentage: Math.round(((i + 1) / candidates.length) * 100)
      });
    }

    try {
      if (!fs.existsSync(item.originalPath)) continue;

      let targetDir = item.proposedFolder ? path.join(baseTarget, item.proposedFolder) : baseTarget;
      if (organizeByChronology && !dateStrategy?.includes('year')) {
        const d = new Date(item.modifiedIso);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        targetDir = path.join(targetDir, `${year}-${month}`);
      }

      const desiredDest = path.join(targetDir, item.name);
      
      // If file is already at destination, no need to move
      if (isSamePath(item.originalPath, desiredDest)) {
        continue;
      }

      const safeDest = await moveFileSafely(item.originalPath, desiredDest);
      const targetFilename = path.basename(safeDest);

      records.push({
        fileId: item.id,
        originalName: item.name,
        targetName: targetFilename,
        originalPath: item.originalPath,
        finalPath: safeDest,
        sizeBytes: item.sizeBytes,
        category: item.proposedFolder || 'Root',
        movedAtIso: new Date().toISOString(),
        status: 'SUCCESS'
      });
      movedCount++;
    } catch (err) {
      console.error(`Error relocating ${item.name}:`, err);
      errorCount++;
      records.push({
        fileId: item.id,
        originalName: item.name,
        originalPath: item.originalPath,
        status: 'FAILED',
        error: err.message
      });
    }
  }

  const sessionData = {
    sessionId,
    timestampIso: startTimestamp,
    completedAtIso: new Date().toISOString(),
    sourceDirectory: dirPath,
    destinationDirectory: baseTarget !== dirPath ? baseTarget : undefined,
    totalProcessed: candidates.length,
    movedCount,
    errorCount,
    profileName: profileName ? `${profileName} (${dateStrategy || 'Standard'})` : 'Default',
    status: errorCount === 0 ? 'COMPLETED' : 'COMPLETED_WITH_WARNINGS',
    records
  };

  ledger.sessions.unshift(sessionData);
  saveLedger(ledger);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  return sessionData;
});

// Revert entire session
ipcMain.handle('fs:undo-session', async (_event, sessionId) => {
  const ledger = loadLedger();
  const session = ledger.sessions.find(s => s.sessionId === sessionId);
  if (!session) throw new Error('Session not found in history.');
  if (session.status === 'REVERTED') throw new Error('Session already reverted.');

  let restoredCount = 0;
  let failureCount = 0;

  for (const record of session.records.slice().reverse()) {
    if (record.status !== 'SUCCESS' || !record.finalPath) continue;

    try {
      if (fs.existsSync(record.finalPath)) {
        await fsPromises.mkdir(path.dirname(record.originalPath), { recursive: true });
        // Restore safely without overwriting if a file currently exists at originalPath
        const safeDest = getAvailablePath(record.originalPath, 'restored');
        await fsPromises.rename(record.finalPath, safeDest);
        record.status = 'REVERTED';
        record.restoredPath = safeDest;
        restoredCount++;
      } else {
        failureCount++;
        record.error = 'Source file missing at moved destination.';
      }
    } catch (err) {
      console.error(`Error reverting ${record.finalPath}:`, err);
      failureCount++;
      record.error = err.message;
    }
  }

  session.status = 'REVERTED';
  session.revertedAtIso = new Date().toISOString();
  session.restoredFiles = restoredCount;
  saveLedger(ledger);

  return {
    sessionId,
    restoredCount,
    failureCount,
    status: 'REVERTED'
  };
});

// Revert a single file
ipcMain.handle('fs:undo-single-file', async (_event, payload) => {
  const { sessionId, fileId } = payload;
  const ledger = loadLedger();
  const session = ledger.sessions.find(s => s.sessionId === sessionId);
  if (!session) throw new Error('Session not found.');

  const record = session.records.find(r => r.fileId === fileId);
  if (!record) throw new Error('File record not found in session.');
  if (record.status === 'REVERTED') throw new Error('File has already been reverted.');

  if (!fs.existsSync(record.finalPath)) {
    throw new Error('Current file location not found on disk.');
  }

  await fsPromises.mkdir(path.dirname(record.originalPath), { recursive: true });
  // Avoid overwriting if a file exists at originalPath
  const safeDest = getAvailablePath(record.originalPath, 'restored');
  await fsPromises.rename(record.finalPath, safeDest);
  record.status = 'REVERTED';
  record.restoredPath = safeDest;

  // If all records reverted, mark session reverted
  const allReverted = session.records.every(r => r.status === 'REVERTED');
  if (allReverted) {
    session.status = 'REVERTED';
    session.revertedAtIso = new Date().toISOString();
  }

  saveLedger(ledger);
  return { success: true, restoredPath: safeDest };
});

ipcMain.handle('fs:get-audit-ledger', async () => loadLedger());

ipcMain.handle('fs:scan-duplicates', async (_event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    throw new Error('Directory does not exist');
  }

  const sizeMap = new Map();
  let filesScanned = 0;

  async function scanFolderRecursive(currentDir, depth = 0) {
    if (depth > DUPLICATE_SCAN_MAX_DEPTH) return;
    try {
      const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (isProtectedSystemPath(fullPath)) continue;

        if (entry.isDirectory()) {
          if (entry.name.toLowerCase() === QUARANTINE_DIR_NAME.toLowerCase()) continue;
          await scanFolderRecursive(fullPath, depth + 1);
        } else if (entry.isFile()) {
          filesScanned++;
          if (filesScanned % 100 === 0) {
            await new Promise(r => setImmediate(r));
          }
          try {
            const stats = await fsPromises.stat(fullPath);
            if (stats.size > 0) {
              if (!sizeMap.has(stats.size)) {
                sizeMap.set(stats.size, []);
              }
              sizeMap.get(stats.size).push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                modifiedIso: new Date(stats.mtimeMs).toISOString()
              });
            }
          } catch {}
        }
      }
    } catch {}
  }

  await scanFolderRecursive(dirPath);

  // Keep only sizes with 2 or more files
  const candidateSizeGroups = [];
  for (const [size, files] of sizeMap.entries()) {
    if (files.length > 1) {
      candidateSizeGroups.push(files);
    }
  }

  // Phase 1: Fast partial hash (first 64KB + last 64KB) to narrow candidate groups
  let yieldCounter = 0;
  const partialGroups = await regroup(
    candidateSizeGroups,
    async (file) => getPartialFileHash(file.path, file.size),
    () => {
      yieldCounter++;
      if (yieldCounter % 25 === 0) {
        setImmediate(() => {});
      }
    }
  );

  // Phase 2: Full SHA-256 on surviving candidates. Guarantees 100% bit-for-bit exact identity.
  const fullHashGroups = await regroup(
    partialGroups.map(g => g.files),
    async (file) => getFullFileHash(file.path),
    () => {
      yieldCounter++;
      if (yieldCounter % 15 === 0) {
        setImmediate(() => {});
      }
    }
  );

  const duplicates = fullHashGroups.map(g => ({
    hash: g.key,
    size: g.files[0].size,
    files: g.files
  }));

  return {
    scannedRoot: dirPath,
    duplicateGroupsCount: duplicates.length,
    duplicates
  };
});

ipcMain.handle('fs:resolve-duplicates', async (_event, payload) => {
  const { filesToQuarantine, targetDir } = payload;
  if (!targetDir || !Array.isArray(filesToQuarantine) || filesToQuarantine.length === 0) {
    throw new Error('Invalid quarantine request');
  }

  const quarantineDir = path.join(targetDir, QUARANTINE_DIR_NAME);
  await fsPromises.mkdir(quarantineDir, { recursive: true });

  const sessionId = newSessionId();
  const startTimestamp = new Date().toISOString();
  const ledger = loadLedger();
  const records = [];
  const results = [];
  let movedCount = 0;
  let errorCount = 0;

  for (const filePath of filesToQuarantine) {
    try {
      if (!fs.existsSync(filePath)) {
        results.push({ path: filePath, status: 'SKIPPED', error: 'File no longer exists' });
        continue;
      }

      const fileId = crypto.randomUUID();
      const filename = path.basename(filePath);
      const desiredDest = path.join(quarantineDir, filename);

      let stats = null;
      try { stats = await fsPromises.stat(filePath); } catch {}

      // Move safely with auto-disambiguation to never overwrite existing quarantine files
      const safeDest = await moveFileSafely(filePath, desiredDest, 'quarantine');
      const finalName = path.basename(safeDest);

      const record = {
        fileId,
        originalName: filename,
        targetName: finalName,
        originalPath: filePath,
        finalPath: safeDest,
        sizeBytes: stats ? stats.size : 0,
        category: QUARANTINE_DIR_NAME,
        movedAtIso: new Date().toISOString(),
        status: 'SUCCESS'
      };

      records.push(record);
      results.push({ path: filePath, status: 'QUARANTINED', dest: safeDest });
      movedCount++;
    } catch (err) {
      console.error(`Error quarantining ${filePath}:`, err);
      errorCount++;
      records.push({
        fileId: crypto.randomUUID(),
        originalName: path.basename(filePath),
        originalPath: filePath,
        status: 'FAILED',
        error: err.message
      });
      results.push({ path: filePath, status: 'ERROR', error: err.message });
    }
  }

  // Record quarantine session in the audit ledger so it can be viewed and undone
  if (records.length > 0) {
    const sessionData = {
      sessionId,
      timestampIso: startTimestamp,
      completedAtIso: new Date().toISOString(),
      sourceDirectory: targetDir,
      totalProcessed: filesToQuarantine.length,
      movedCount,
      errorCount,
      profileName: 'Duplicate Quarantine',
      status: errorCount === 0 ? 'COMPLETED' : 'COMPLETED_WITH_WARNINGS',
      records
    };
    ledger.sessions.unshift(sessionData);
    saveLedger(ledger);
  }

  return { quarantineDir, results, sessionId };
});

ipcMain.handle('shell:open-path', async (_event, targetPath) => {
  if (fs.existsSync(targetPath)) {
    shell.showItemInFolder(targetPath);
    return true;
  }
  return false;
});

// ============================================================================
// Autonomous Live Sentinel Watcher
// ============================================================================

let sentinelWatcher = null;
const sentinelTimers = new Map();
const sentinelState = {
  isWatching: false,
  watchedDir: null,
  destinationDir: null,
  organizeByChronology: false,
  filesProcessed: 0,
  lastEventTime: null
};

const IGNORED_WATCH_EXTENSIONS = new Set([
  '.tmp', '.crdownload', '.part', '.download', '.swp', '.lock', '.partial', '.aria2'
]);

async function checkFileReady(filePath, maxTries = 4, delayMs = 1000) {
  for (let i = 0; i < maxTries; i++) {
    try {
      if (!fs.existsSync(filePath)) return false;
      const stats = await fsPromises.stat(filePath);
      if (stats.size === 0) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      const handle = await fsPromises.open(filePath, 'r');
      await handle.close();
      return true;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function processIncomingFile(filename) {
  if (!sentinelState.isWatching || !sentinelState.watchedDir) return;
  const watchedDir = sentinelState.watchedDir;
  const fullPath = path.join(watchedDir, filename);

  if (!fs.existsSync(fullPath)) return;
  if (isProtectedSystemPath(fullPath)) return;

  try {
    const stats = await fsPromises.stat(fullPath);
    if (!stats.isFile()) return;

    const ext = path.extname(filename).toLowerCase();
    if (IGNORED_WATCH_EXTENSIONS.has(ext) || filename.startsWith('~$') || filename.startsWith('.')) {
      return;
    }

    const isReady = await checkFileReady(fullPath, 5, 1200);
    if (!isReady || !fs.existsSync(fullPath)) return;

    const pData = loadProfilesData();
    const active = pData.profiles.find(p => p.id === pData.activeProfileId) || pData.profiles[0];
    const categoryInfo = evaluateFileCategory(filename, active.rules);

    const baseTarget = (sentinelState.destinationDir && fs.existsSync(sentinelState.destinationDir)) 
      ? sentinelState.destinationDir 
      : watchedDir;

    const proposedFolder = computeTargetFolder({
      filename,
      categoryFolder: categoryInfo.targetFolder,
      modifiedMs: stats.mtimeMs,
      strategy: sentinelState.dateStrategy || (sentinelState.organizeByChronology ? 'category-date' : 'category-only')
    });

    const targetDir = proposedFolder ? path.join(baseTarget, proposedFolder) : baseTarget;

    const desiredDest = path.join(targetDir, filename);
    const safeDest = await moveFileSafely(fullPath, desiredDest);
    const targetFilename = path.basename(safeDest);

    const ledger = loadLedger();
    const sessionId = newSessionId();
    const record = {
      fileId: crypto.randomUUID(),
      originalName: filename,
      targetName: targetFilename,
      originalPath: fullPath,
      finalPath: safeDest,
      sizeBytes: stats.size,
      category: categoryInfo.targetFolder,
      movedAtIso: new Date().toISOString(),
      status: 'SUCCESS'
    };

    const sessionData = {
      sessionId,
      timestampIso: new Date().toISOString(),
      completedAtIso: new Date().toISOString(),
      sourceDirectory: watchedDir,
      destinationDirectory: baseTarget !== watchedDir ? baseTarget : undefined,
      totalProcessed: 1,
      movedCount: 1,
      errorCount: 0,
      profileName: `Sentinel Live Watch (${active.name})`,
      status: 'COMPLETED',
      records: [record]
    };

    ledger.sessions.unshift(sessionData);
    saveLedger(ledger);

    sentinelState.filesProcessed++;
    sentinelState.lastEventTime = new Date().toISOString();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sentinel:event', {
        type: 'ORGANIZED',
        file: filename,
        sourcePath: fullPath,
        targetPath: safeDest,
        category: categoryInfo.targetFolder,
        timestamp: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error('Sentinel auto-move error for', filename, err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sentinel:event', {
        type: 'ERROR',
        file: filename,
        message: err.message,
        timestamp: new Date().toISOString()
      });
    }
  }
}

ipcMain.handle('sentinel:start-watch', async (_event, dirPath, options = {}) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    throw new Error('Directory to watch does not exist');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('Protected system folders cannot be monitored.');
  }

  if (sentinelWatcher) {
    try { sentinelWatcher.close(); } catch {}
    sentinelWatcher = null;
  }
  for (const timer of sentinelTimers.values()) {
    clearTimeout(timer);
  }
  sentinelTimers.clear();

  sentinelState.isWatching = true;
  sentinelState.watchedDir = dirPath;
  sentinelState.destinationDir = options.destinationDir || null;
  sentinelState.dateStrategy = options.dateStrategy || null;
  sentinelState.organizeByChronology = !!options.organizeByChronology;
  sentinelState.filesProcessed = 0;
  sentinelState.lastEventTime = new Date().toISOString();

  sentinelWatcher = fs.watch(dirPath, { recursive: false }, (_eventType, filename) => {
    if (!filename) return;

    if (sentinelTimers.has(filename)) {
      clearTimeout(sentinelTimers.get(filename));
    }

    const timer = setTimeout(() => {
      sentinelTimers.delete(filename);
      processIncomingFile(filename);
    }, 1500);

    sentinelTimers.set(filename, timer);
  });

  sentinelWatcher.on('error', (err) => {
    console.error('Sentinel watcher error:', err);
    sentinelState.isWatching = false;
  });

  return { success: true, watchedDir: dirPath };
});

ipcMain.handle('sentinel:stop-watch', async () => {
  if (sentinelWatcher) {
    try { sentinelWatcher.close(); } catch {}
    sentinelWatcher = null;
  }
  for (const timer of sentinelTimers.values()) {
    clearTimeout(timer);
  }
  sentinelTimers.clear();

  sentinelState.isWatching = false;
  sentinelState.watchedDir = null;
  sentinelState.destinationDir = null;
  return { success: true };
});

ipcMain.handle('sentinel:get-status', async () => {
  return { ...sentinelState };
});

// ============================================================================
// Empty Folder Janitor
// ============================================================================

ipcMain.handle('fs:scan-empty-folders', async (_event, dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) {
    throw new Error('Directory does not exist');
  }

  const emptyFolders = [];

  async function checkEmptyDir(curr) {
    try {
      const entries = await fsPromises.readdir(curr, { withFileTypes: true });
      let hasFiles = false;
      let hasValidSubdirs = false;

      for (const entry of entries) {
        const full = path.join(curr, entry.name);
        if (isProtectedSystemPath(full)) continue;

        if (entry.isFile()) {
          hasFiles = true;
        } else if (entry.isDirectory()) {
          const subEmpty = await checkEmptyDir(full);
          if (!subEmpty) {
            hasValidSubdirs = true;
          }
        }
      }

      if (!hasFiles && !hasValidSubdirs && curr !== dirPath) {
        emptyFolders.push({
          path: curr,
          relativePath: path.relative(dirPath, curr),
          name: path.basename(curr)
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  await checkEmptyDir(dirPath);
  return emptyFolders;
});

ipcMain.handle('fs:delete-empty-folders', async (_event, folderPaths) => {
  if (!Array.isArray(folderPaths)) return { deletedCount: 0 };
  let deletedCount = 0;

  const sorted = [...folderPaths].sort((a, b) => b.length - a.length);

  for (const fPath of sorted) {
    if (isProtectedSystemPath(fPath)) continue;
    try {
      if (fs.existsSync(fPath)) {
        await fsPromises.rmdir(fPath);
        deletedCount++;
      }
    } catch (err) {
      console.warn(`Could not delete folder ${fPath}:`, err);
    }
  }

  return { deletedCount };
});

ipcMain.handle('window:set-theme', (_event, isDark) => {
  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay({
        color: isDark ? '#111318' : '#f1f5f9',
        symbolColor: isDark ? '#e2e8f0' : '#334155',
        height: 36
      });
    } catch {}
  }
  return true;
});
