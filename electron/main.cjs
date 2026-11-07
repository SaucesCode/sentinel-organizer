const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const os = require('os');

let mainWindow = null;

// Enforce single-instance lock to prevent concurrent ledger/file race conditions
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

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

function getExcludedFoldersFile() {
  return path.join(getUserDataPath(), 'excluded_folders.json');
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

// Rejects UNC network shares (\\server\share) and malformed strings to prevent NTLM hash leaks or path abuse
function isUncOrInvalidPath(testPath) {
  if (!testPath || typeof testPath !== 'string') return true;
  if (testPath.includes('\0')) return true;
  const trimmed = testPath.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) return true;
  return false;
}

// Protects Sentinel's own executable, portable .exe wrapper, ASAR bundle, and userData directory from self-modification
function isAppSelfPath(testPath) {
  if (!testPath || typeof testPath !== 'string') return true;
  const normalized = path.resolve(testPath).toLowerCase();

  // Exact file checks (e.g. portable .exe sitting inside Downloads)
  const selfFiles = [
    process.execPath,
    process.env.PORTABLE_EXECUTABLE_FILE
  ].filter(Boolean).map(p => path.resolve(p).toLowerCase());

  if (selfFiles.includes(normalized)) return true;

  // Protected internal application directories
  const selfDirs = [
    getUserDataPath(),
    process.resourcesPath,
    (() => { try { return app.getAppPath(); } catch { return null; } })()
  ].filter(Boolean).map(p => path.resolve(p).toLowerCase());

  for (const dir of selfDirs) {
    if (normalized === dir || normalized.startsWith(dir + path.sep)) {
      return true;
    }
  }
  return false;
}

function isProtectedSystemPath(testPath) {
  if (isUncOrInvalidPath(testPath)) return true;
  if (isAppSelfPath(testPath)) return true;

  const normalized = path.resolve(testPath).toLowerCase();
  if (/^[a-z]:\\?$/i.test(normalized)) return true;
  
  const home = os.homedir();
  const appDataRoaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const appDataLocal = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  const systemPaths = [
    process.env.SystemRoot?.toLowerCase() || 'c:\\windows',
    process.env['ProgramFiles']?.toLowerCase() || 'c:\\program files',
    process.env['ProgramFiles(x86)']?.toLowerCase() || 'c:\\program files (x86)',
    process.env.ProgramData?.toLowerCase() || 'c:\\programdata',
    'c:\\recovery',
    appDataRoaming.toLowerCase(),
    appDataLocal.toLowerCase(),
    path.join(appDataRoaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup').toLowerCase(),
    path.join(home, '.ssh').toLowerCase(),
    path.join(home, '.gnupg').toLowerCase(),
    path.join(home, '.aws').toLowerCase(),
    path.join(home, '.kube').toLowerCase(),
    path.join(home, '.azure').toLowerCase(),
  ];
  
  for (const sysPath of systemPaths) {
    if (normalized === sysPath || normalized.startsWith(sysPath + path.sep)) {
      return true;
    }
  }
  
  const base = path.basename(normalized);
  const forbiddenNames = [
    '.git', '.svn', '.hg', '.env', '.ssh',
    '$recycle.bin', 'system volume information',
    'ntuser.dat', 'pagefile.sys', 'hiberfil.sys', 'swapfile.sys',
    'desktop.ini', 'thumbs.db',
    'node_modules',
    QUARANTINE_DIR_NAME.toLowerCase()
  ];
  if (forbiddenNames.includes(base)) return true;
  
  return false;
}

const WIN_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Strictly sanitizes any relative target folder path to prevent directory traversal ("..") or illegal Windows path segments
function sanitizeRelativeSubfolder(subfolder) {
  if (!subfolder || typeof subfolder !== 'string') return '';
  const cleaned = subfolder
    .replace(/\0/g, '')
    .replace(/^[a-zA-Z]:/, '') // strip drive letters
    .replace(/\\/g, '/');

  const safeSegments = [];
  for (const rawSeg of cleaned.split('/')) {
    const seg = rawSeg.trim().replace(/[<>:"|?*]/g, '_').replace(/\.+$/, '');
    if (!seg || seg === '.' || seg === '..') continue;
    if (WIN_RESERVED_NAMES.test(seg)) continue;
    safeSegments.push(seg);
  }
  return safeSegments.length > 0 ? path.join(...safeSegments) : '';
}

function assertTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || !event || event.sender !== mainWindow.webContents) {
    throw new Error('Unauthorized IPC sender blocked.');
  }
}

function loadExcludedFolders() {
  try {
    const file = getExcludedFoldersFile();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(parsed)) {
        return parsed.filter(p => typeof p === 'string' && !isUncOrInvalidPath(p)).map(p => path.resolve(p));
      }
    }
  } catch (err) {
    console.error('Error loading excluded folders:', err);
  }
  return [];
}

function saveExcludedFolders(folderList) {
  try {
    const unique = Array.from(
      new Map(
        folderList
          .filter(p => typeof p === 'string' && !isUncOrInvalidPath(p))
          .map(p => {
            const resolved = path.resolve(p);
            return [resolved.toLowerCase(), resolved];
          })
      ).values()
    );
    writeJsonAtomic(getExcludedFoldersFile(), unique);
    return unique;
  } catch (err) {
    console.error('Error saving excluded folders:', err);
    return [];
  }
}

// Smart Project & Application Folder Detector:
// Prevents Sentinel from reaching inside intact coding projects, version-controlled repos,
// game engine workspaces, or unpacked/portable applications (.exe + runtime companions).
const PROJECT_MANIFEST_MARKERS = new Map([
  ['package.json', 'Node.js / Web Project'],
  ['pnpm-lock.yaml', 'Node.js / Web Project'],
  ['yarn.lock', 'Node.js / Web Project'],
  ['bun.lockb', 'Bun / Web Project'],
  ['deno.json', 'Deno Project'],
  ['cargo.toml', 'Rust Project'],
  ['go.mod', 'Go Project'],
  ['pyproject.toml', 'Python Project'],
  ['pipfile', 'Python Project'],
  ['pyvenv.cfg', 'Python Virtual Environment'],
  ['manage.py', 'Django Project'],
  ['pom.xml', 'Java Maven Project'],
  ['build.gradle', 'Gradle / Android Project'],
  ['build.gradle.kts', 'Gradle / Kotlin Project'],
  ['composer.json', 'PHP Composer Project'],
  ['cmakelists.txt', 'C/C++ CMake Project'],
  ['makefile', 'Build Project'],
  ['gemfile', 'Ruby Project'],
  ['project.godot', 'Godot Engine Project'],
]);

const VCS_AND_IDE_DIRS = new Map([
  ['.git', 'Git Repository'],
  ['.svn', 'Subversion Repository'],
  ['.hg', 'Mercurial Repository'],
  ['.idea', 'JetBrains IDE Project'],
  ['.vs', 'Visual Studio Project'],
  ['node_modules', 'Node.js Dependencies'],
  ['venv', 'Python Virtual Environment'],
  ['.venv', 'Python Virtual Environment'],
]);

async function detectProtectedSubfolder(subDirPath, excludedLowerSet) {
  const resolved = path.resolve(subDirPath);
  const lowerResolved = resolved.toLowerCase();

  if (excludedLowerSet && excludedLowerSet.has(lowerResolved)) {
    return { protected: true, reason: 'Excluded by User', autoDetected: false };
  }

  // Also check if subDirPath is inside any user-excluded parent folder
  if (excludedLowerSet) {
    for (const ex of excludedLowerSet) {
      if (lowerResolved === ex || lowerResolved.startsWith(ex + path.sep)) {
        return { protected: true, reason: 'Excluded by User', autoDetected: false };
      }
    }
  }

  try {
    const entries = await fsPromises.readdir(resolved, { withFileTypes: true });
    let hasExe = false;
    let hasAppRuntimeCompanion = false;
    let hasResourcesDir = false;
    let hasLocalesDir = false;
    let hasUnityAssets = false;
    let hasUnitySettings = false;

    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (VCS_AND_IDE_DIRS.has(lowerName)) {
          return { protected: true, reason: VCS_AND_IDE_DIRS.get(lowerName), autoDetected: true };
        }
        if (lowerName === 'resources') hasResourcesDir = true;
        if (lowerName === 'locales') hasLocalesDir = true;
        if (lowerName === '_internal' || lowerName === 'monobleedingedge' || lowerName.endsWith('_data')) {
          hasAppRuntimeCompanion = true;
        }
        if (lowerName === 'assets') hasUnityAssets = true;
        if (lowerName === 'projectsettings') hasUnitySettings = true;
        if (lowerName.endsWith('.xcodeproj') || lowerName.endsWith('.xcworkspace')) {
          return { protected: true, reason: 'Xcode Project', autoDetected: true };
        }
      } else if (entry.isFile()) {
        if (lowerName === '.git') {
          return { protected: true, reason: 'Git Worktree / Submodule', autoDetected: true };
        }
        if (PROJECT_MANIFEST_MARKERS.has(lowerName)) {
          return { protected: true, reason: PROJECT_MANIFEST_MARKERS.get(lowerName), autoDetected: true };
        }
        if (
          lowerName.endsWith('.sln') ||
          lowerName.endsWith('.csproj') ||
          lowerName.endsWith('.vcxproj') ||
          lowerName.endsWith('.fsproj') ||
          lowerName.endsWith('.uproject')
        ) {
          return { protected: true, reason: 'IDE / Engine Project', autoDetected: true };
        }

        const ext = path.extname(lowerName);
        if (ext === '.exe') hasExe = true;
        if (
          ext === '.dll' ||
          ext === '.pak' ||
          ext === '.asar' ||
          ext === '.pyd' ||
          ext === '.winmd' ||
          lowerName === 'unins000.dat'
        ) {
          hasAppRuntimeCompanion = true;
        }
      }
    }

    if (hasUnityAssets && hasUnitySettings) {
      return { protected: true, reason: 'Unity Game Project', autoDetected: true };
    }
    if (hasExe && (hasAppRuntimeCompanion || (hasResourcesDir && hasLocalesDir))) {
      return { protected: true, reason: 'Portable / Unpacked Application', autoDetected: true };
    }
  } catch {
    // Unreadable folders are treated as protected so Sentinel never modifies them
    return { protected: true, reason: 'Restricted Access Folder', autoDetected: true };
  }

  return { protected: false };
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
    if (!data || !Array.isArray(data.profiles)) return false;
    // Sanitize all custom rule target folders before persisting
    const sanitizedProfiles = data.profiles.map(profile => ({
      ...profile,
      name: String(profile.name || 'Profile').slice(0, 80),
      description: String(profile.description || '').slice(0, 240),
      rules: Array.isArray(profile.rules)
        ? profile.rules.map(rule => ({
            ...rule,
            name: String(rule.name || 'Rule').slice(0, 80),
            pattern: String(rule.pattern || '').slice(0, 250),
            targetFolder: sanitizeRelativeSubfolder(rule.targetFolder) || 'Unsorted'
          }))
        : []
    }));
    const file = getProfilesFile();
    writeJsonAtomic(file, {
      profiles: sanitizedProfiles,
      activeProfileId: String(data.activeProfileId || 'general')
    });
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

// Rejects overly long or nested-quantifier patterns that could cause catastrophic backtracking (ReDoS)
function isSafeRegexPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 250) return false;
  if (/\([^)]*[+*][^)]*\)[+*?]/.test(pattern)) return false;
  return true;
}

function matchesRegexOrKeywords(filename, pattern) {
  if (!pattern || typeof pattern !== 'string' || pattern.length > 250) return false;
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

  // Advanced regex supplied by user (guarded against ReDoS)
  if (!isSafeRegexPattern(pattern)) return false;
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
      const safeTarget = sanitizeRelativeSubfolder(rule.targetFolder) || 'Unsorted';
      return { targetFolder: safeTarget, ruleName: rule.name, ruleId: rule.id };
    }
  }
  
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== 'extension') continue;
    const extensions = String(rule.pattern || '').toLowerCase().split(',').map(s => s.trim().startsWith('.') ? s.trim() : `.${s.trim()}`);
    if (extensions.includes(ext)) {
      const safeTarget = sanitizeRelativeSubfolder(rule.targetFolder) || 'Unsorted';
      return { targetFolder: safeTarget, ruleName: rule.name, ruleId: rule.id };
    }
  }
  
  const cleanExt = (ext ? ext.slice(1).replace(/[^a-z0-9]/gi, '').toUpperCase() : '') || 'NO_EXT';
  return { targetFolder: path.join('Unsorted', cleanExt), ruleName: 'Extension Fallback', ruleId: 'fallback' };
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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false
    }
  });

  // Block external popups, navigations, and webviews
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (app.isPackaged || !targetUrl.startsWith('http://localhost:5173')) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  const localHtmlPath = path.join(__dirname, '../dist/index.html');
  if (app.isPackaged) {
    // Strictly load bundled read-only ASAR UI in production; never connect to localhost
    mainWindow.loadFile(localHtmlPath);
  } else if (fs.existsSync(localHtmlPath) && process.env.NODE_ENV === 'production') {
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
  // Deny all browser hardware/media/notification permission prompts
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  // Enforce strict offline air-gap in packaged builds: block all outbound network requests
  if (app.isPackaged) {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url || '';
      if (/^(https?|wss?|ftp):/i.test(url)) {
        return callback({ cancel: true });
      }
      callback({ cancel: false });
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';"
          ]
        }
      });
    });
  }

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

ipcMain.handle('dialog:select-directory', async (event) => {
  assertTrustedSender(event);
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'dontAddToRecent'],
    title: 'Select Folder to Organize'
  });
  if (result.canceled || !result.filePaths.length) return null;
  const picked = result.filePaths[0];
  if (isProtectedSystemPath(picked)) {
    throw new Error('This system or application folder is protected and cannot be modified.');
  }
  return picked;
});

ipcMain.handle('system:get-info', async (event) => {
  assertTrustedSender(event);
  return {
    osPlatform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    isoTimestamp: new Date().toISOString()
  };
});

ipcMain.handle('profiles:get', async (event) => {
  assertTrustedSender(event);
  return loadProfilesData();
});

ipcMain.handle('profiles:save', async (event, data) => {
  assertTrustedSender(event);
  return saveProfilesData(data);
});

ipcMain.handle('fs:get-excluded-folders', async (event) => {
  assertTrustedSender(event);
  return loadExcludedFolders();
});

ipcMain.handle('fs:add-excluded-folder', async (event, payload = {}) => {
  assertTrustedSender(event);
  let chosenPath = typeof payload === 'string' ? payload : payload?.folderPath;

  if (!chosenPath) {
    if (!mainWindow) return { added: null, excludedFolders: loadExcludedFolders() };
    const defaultPath = payload?.browseFromDir && !isUncOrInvalidPath(payload.browseFromDir) && fs.existsSync(payload.browseFromDir)
      ? payload.browseFromDir
      : undefined;
    const res = await dialog.showOpenDialog(mainWindow, {
      defaultPath,
      properties: ['openDirectory', 'dontAddToRecent'],
      title: 'Select Subfolder to Protect / Exclude from Sentinel'
    });
    if (res.canceled || !res.filePaths.length) {
      return { added: null, excludedFolders: loadExcludedFolders() };
    }
    chosenPath = res.filePaths[0];
  }

  if (isUncOrInvalidPath(chosenPath) || !fs.existsSync(chosenPath)) {
    throw new Error('Selected folder path is invalid or does not exist.');
  }
  const st = await fsPromises.lstat(chosenPath);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error('Only standard local directories can be added.');
  }

  const resolved = path.resolve(chosenPath);
  const existing = loadExcludedFolders();
  const updated = saveExcludedFolders([...existing, resolved]);
  return { added: resolved, excludedFolders: updated };
});

ipcMain.handle('fs:remove-excluded-folder', async (event, folderPath) => {
  assertTrustedSender(event);
  if (!folderPath || typeof folderPath !== 'string') return loadExcludedFolders();
  const existing = loadExcludedFolders();
  const filtered = existing.filter(p => !isSamePath(p, folderPath));
  return saveExcludedFolders(filtered);
});

const MONTH_RAW_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Parses embedded calendar dates from filenames like "Screenshot 2026-11-06.png" or "IMG_20261106_1420.jpg"
function extractDateFromFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.parse(filename).name;

  // 1. Separated YYYY-MM-DD / YYYY_MM_DD / YYYY.MM.DD
  const sepMatch = base.match(/(?:^|[^0-9])((?:199\d|20\d{2}))[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])(?:$|[^0-9])/);
  if (sepMatch) {
    const y = Number(sepMatch[1]);
    const m = Number(sepMatch[2]);
    const day = Number(sepMatch[3]);
    const dt = new Date(y, m - 1, day, 12, 0, 0);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day) {
      return dt.getTime();
    }
  }

  // 2. Compact YYYYMMDD (e.g. IMG_20261106_093000, VID-20261106-WA0001)
  const compactMatch = base.match(/(?:^|[^0-9])((?:199\d|20\d{2}))(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:$|[^0-9])/);
  if (compactMatch) {
    const y = Number(compactMatch[1]);
    const m = Number(compactMatch[2]);
    const day = Number(compactMatch[3]);
    const dt = new Date(y, m - 1, day, 12, 0, 0);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day) {
      return dt.getTime();
    }
  }

  return null;
}

function resolveEffectiveTimestamp(filename, stats, dateSource = 'created') {
  const birthValid = (stats.birthtimeMs && stats.birthtimeMs > 0) ? stats.birthtimeMs : stats.mtimeMs;
  if (dateSource === 'modified') {
    return stats.mtimeMs;
  }
  if (dateSource === 'smart') {
    const parsed = extractDateFromFilename(filename);
    return parsed !== null ? parsed : birthValid;
  }
  // 'created' -> Date Downloaded / Created on this PC
  return birthValid;
}

function computeTargetFolder({ filename, categoryFolder, modifiedMs, strategy = 'category-only' }) {
  const safeCat = sanitizeRelativeSubfolder(categoryFolder) || 'Unsorted';
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
    case 'category-year-month':
      return path.join(safeCat, yearMonthFormatted);
    case 'category-month-year':
      return path.join(safeCat, monthYearFormatted);
    case 'category-year-quarter':
      return path.join(safeCat, yearQuarterFormatted);
    case 'category-date':
      return path.join(safeCat, `${year}-${monthNum}`);
    case 'category-exact-date':
      return path.join(safeCat, ymd);

    case 'year-month-category':
      return path.join(yearMonthFormatted, safeCat);
    case 'year-quarter-category':
      return path.join(yearQuarterFormatted, safeCat);
    case 'year-month':
      return yearMonthFormatted;
    case 'month-year':
      return monthYearFormatted;
    case 'year-quarter':
      return yearQuarterFormatted;
    case 'exact-date':
      return ymd;

    case 'flatten':
      return '';
    case 'category-only':
    default:
      return safeCat;
  }
}

async function collectFilesRecursive(rootDir, dir, excludedLowerSet, protectedOut, currentDepth = 0, maxDepth = 10) {
  const result = [];
  if (currentDepth > maxDepth) return result;
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // Never follow symlinks or NTFS junctions
      const full = path.join(dir, entry.name);
      if (isProtectedSystemPath(full)) continue;

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === QUARANTINE_DIR_NAME.toLowerCase()) continue;

        const check = await detectProtectedSubfolder(full, excludedLowerSet);
        if (check.protected) {
          protectedOut.push({
            path: full,
            relativePath: path.relative(rootDir, full),
            name: entry.name,
            reason: check.reason || 'Protected Folder',
            autoDetected: !!check.autoDetected
          });
          continue;
        }

        const sub = await collectFilesRecursive(rootDir, full, excludedLowerSet, protectedOut, currentDepth + 1, maxDepth);
        result.push(...sub);
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
  } catch {}
  return result;
}

ipcMain.handle('fs:scan-directory', async (event, dirPath, optionsOrRules, legacyDestinationDir) => {
  assertTrustedSender(event);
  if (isUncOrInvalidPath(dirPath) || !fs.existsSync(dirPath)) {
    throw new Error('Directory path does not exist or is invalid.');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('This system or application folder is protected from modification.');
  }

  const rootStat = await fsPromises.lstat(dirPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Symbolic links and non-directory paths cannot be scanned.');
  }

  const excludedList = loadExcludedFolders();
  const excludedLowerSet = new Set(excludedList.map(p => p.toLowerCase()));

  // Also prevent scanning if the user explicitly excluded the selected root folder itself
  if (excludedLowerSet.has(path.resolve(dirPath).toLowerCase())) {
    throw new Error('This folder is currently in your Excluded / Protected Folders list.');
  }

  let rules = null;
  let destinationDir = legacyDestinationDir;
  let includeSubfolders = false;
  let dateStrategy = 'category-only';
  let dateSource = 'created';

  if (Array.isArray(optionsOrRules)) {
    rules = optionsOrRules;
  } else if (optionsOrRules && typeof optionsOrRules === 'object') {
    rules = optionsOrRules.rules;
    destinationDir = optionsOrRules.destinationDir || legacyDestinationDir;
    includeSubfolders = !!optionsOrRules.includeSubfolders;
    dateStrategy = optionsOrRules.dateStrategy || 'category-only';
    dateSource = optionsOrRules.dateSource || 'created';
  }

  if (destinationDir && (isUncOrInvalidPath(destinationDir) || isProtectedSystemPath(destinationDir))) {
    throw new Error('Destination folder is protected or invalid.');
  }

  if (!Array.isArray(rules) || rules.length === 0) {
    const pData = loadProfilesData();
    const active = pData.profiles.find(p => p.id === pData.activeProfileId) || pData.profiles[0];
    rules = active.rules;
  }

  const baseTarget = (destinationDir && fs.existsSync(destinationDir)) ? path.resolve(destinationDir) : path.resolve(dirPath);
  const candidates = [];
  const protectedFolders = [];
  let totalBytes = 0;

  let filePaths = [];
  if (includeSubfolders) {
    filePaths = await collectFilesRecursive(dirPath, dirPath, excludedLowerSet, protectedFolders);
  } else {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dirPath, entry.name);
      if (isProtectedSystemPath(full)) continue;
      if (entry.isFile()) {
        filePaths.push(full);
      } else if (entry.isDirectory() && entry.name.toLowerCase() !== QUARANTINE_DIR_NAME.toLowerCase()) {
        // Still inspect top-level subfolders so the UI shows protected project/app folders accurately
        const check = await detectProtectedSubfolder(full, excludedLowerSet);
        if (check.protected) {
          protectedFolders.push({
            path: full,
            relativePath: path.relative(dirPath, full),
            name: entry.name,
            reason: check.reason || 'Protected Folder',
            autoDetected: !!check.autoDetected
          });
        }
      }
    }
  }

  for (const fullPath of filePaths) {
    try {
      const stats = await fsPromises.lstat(fullPath);
      if (stats.isSymbolicLink() || !stats.isFile()) continue;

      totalBytes += stats.size;
      const filename = path.basename(fullPath);
      
      const categoryInfo = evaluateFileCategory(filename, rules);
      const effectiveMs = resolveEffectiveTimestamp(filename, stats, dateSource);
      const rawProposedFolder = computeTargetFolder({
        filename,
        categoryFolder: categoryInfo.targetFolder,
        modifiedMs: effectiveMs,
        strategy: dateStrategy
      });
      const proposedFolder = sanitizeRelativeSubfolder(rawProposedFolder);

      const proposedPath = proposedFolder ? path.join(baseTarget, proposedFolder, filename) : path.join(baseTarget, filename);
      const ageDays = (Date.now() - effectiveMs) / (1000 * 60 * 60 * 24);
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

      const d = new Date(effectiveMs);
      const mNum = String(d.getMonth() + 1).padStart(2, '0');
      const mRaw = MONTH_RAW_NAMES[d.getMonth()] || `${mNum}`;
      const dateGroup = `${d.getFullYear()}-${mNum} - ${mRaw}`;
      const birthValid = (stats.birthtimeMs && stats.birthtimeMs > 0) ? stats.birthtimeMs : stats.mtimeMs;
      
      candidates.push({
        id: crypto.randomUUID(),
        name: filename,
        originalPath: fullPath,
        sizeBytes: stats.size,
        modifiedIso: new Date(stats.mtimeMs).toISOString(),
        createdIso: new Date(birthValid).toISOString(),
        effectiveDateIso: d.toISOString(),
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
    destinationDir: !isSamePath(baseTarget, dirPath) ? baseTarget : undefined,
    includeSubfolders,
    dateStrategy,
    totalFiles: candidates.length,
    totalBytes,
    candidates,
    protectedFolders
  };
});

ipcMain.handle('fs:execute-organize', async (event, payload) => {
  assertTrustedSender(event);
  const { dirPath, destinationDir, candidates, organizeByChronology, dateStrategy, profileName } = payload || {};
  if (!dirPath || isUncOrInvalidPath(dirPath) || !Array.isArray(candidates)) {
    throw new Error('Invalid execute payload');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('Source directory is protected and cannot be modified.');
  }
  if (destinationDir && (isUncOrInvalidPath(destinationDir) || isProtectedSystemPath(destinationDir))) {
    throw new Error('Destination directory is protected and cannot be modified.');
  }

  const resolvedSource = path.resolve(dirPath);
  const baseTarget = (destinationDir && fs.existsSync(destinationDir)) ? path.resolve(destinationDir) : resolvedSource;
  const excludedLowerSet = new Set(loadExcludedFolders().map(p => p.toLowerCase()));

  const sessionId = newSessionId();
  const startTimestamp = new Date().toISOString();
  const ledger = loadLedger();
  
  const records = [];
  let movedCount = 0;
  let errorCount = 0;
  let lastProgressSent = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item || !item.selected) continue;

    await new Promise(r => setImmediate(r));

    const now = Date.now();
    if (mainWindow && (now - lastProgressSent > 60 || i === candidates.length - 1)) {
      lastProgressSent = now;
      mainWindow.webContents.send('organize:progress', {
        current: i + 1,
        total: candidates.length,
        currentFile: String(item.name || ''),
        percentage: Math.round(((i + 1) / candidates.length) * 100)
      });
    }

    try {
      if (!item.originalPath || isUncOrInvalidPath(item.originalPath)) continue;
      const resolvedSrcFile = path.resolve(item.originalPath);

      // Security check 1: File must strictly reside inside the scanned source directory
      if (!isPathInside(resolvedSource, resolvedSrcFile)) {
        throw new Error('Blocked attempt to move a file outside the selected folder.');
      }
      // Security check 2: Never touch protected system/app files or user-excluded folders
      if (isProtectedSystemPath(resolvedSrcFile)) {
        throw new Error('Protected file skipped.');
      }
      for (const ex of excludedLowerSet) {
        if (resolvedSrcFile.toLowerCase().startsWith(ex + path.sep)) {
          throw new Error('File is inside an excluded protected folder.');
        }
      }
      if (!fs.existsSync(resolvedSrcFile)) continue;

      // Security check 3: Refuse symbolic links / reparse points
      const srcStat = await fsPromises.lstat(resolvedSrcFile);
      if (srcStat.isSymbolicLink() || !srcStat.isFile()) continue;

      const safeFilename = path.basename(resolvedSrcFile);
      const safeSubfolder = sanitizeRelativeSubfolder(item.proposedFolder);

      let targetDir = safeSubfolder ? path.join(baseTarget, safeSubfolder) : baseTarget;
      if (organizeByChronology && !dateStrategy?.includes('year')) {
        const d = new Date(item.modifiedIso);
        const year = d.getUTCFullYear();
        const month = String(d.getUTCMonth() + 1).padStart(2, '0');
        targetDir = path.join(targetDir, `${year}-${month}`);
      }

      const desiredDest = path.join(targetDir, safeFilename);

      // Security check 4: Strictly enforce destination containment within baseTarget
      if (!isPathInside(baseTarget, desiredDest)) {
        throw new Error('Blocked destination path outside target folder.');
      }
      
      // If file is already at destination, no need to move
      if (isSamePath(resolvedSrcFile, desiredDest)) {
        continue;
      }

      const safeDest = await moveFileSafely(resolvedSrcFile, desiredDest);
      const targetFilename = path.basename(safeDest);

      records.push({
        fileId: item.id || crypto.randomUUID(),
        originalName: safeFilename,
        targetName: targetFilename,
        originalPath: resolvedSrcFile,
        finalPath: safeDest,
        sizeBytes: srcStat.size,
        category: safeSubfolder || 'Root',
        movedAtIso: new Date().toISOString(),
        status: 'SUCCESS'
      });
      movedCount++;
    } catch (err) {
      console.error(`Error relocating ${item?.name}:`, err);
      errorCount++;
      records.push({
        fileId: item?.id || crypto.randomUUID(),
        originalName: path.basename(String(item?.originalPath || item?.name || 'unknown')),
        originalPath: String(item?.originalPath || ''),
        status: 'FAILED',
        error: err.message
      });
    }
  }

  const sessionData = {
    sessionId,
    timestampIso: startTimestamp,
    completedAtIso: new Date().toISOString(),
    sourceDirectory: resolvedSource,
    destinationDirectory: !isSamePath(baseTarget, resolvedSource) ? baseTarget : undefined,
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
ipcMain.handle('fs:undo-session', async (event, sessionId) => {
  assertTrustedSender(event);
  const ledger = loadLedger();
  const session = ledger.sessions.find(s => s.sessionId === sessionId);
  if (!session) throw new Error('Session not found in history.');
  if (session.status === 'REVERTED') throw new Error('Session already reverted.');

  let restoredCount = 0;
  let failureCount = 0;

  for (const record of session.records.slice().reverse()) {
    if (record.status !== 'SUCCESS' || !record.finalPath) continue;

    try {
      if (isProtectedSystemPath(record.finalPath) || isProtectedSystemPath(record.originalPath)) {
        failureCount++;
        record.error = 'Blocked restore involving protected path.';
        continue;
      }

      if (fs.existsSync(record.finalPath)) {
        const st = await fsPromises.lstat(record.finalPath);
        if (st.isSymbolicLink() || !st.isFile()) {
          failureCount++;
          record.error = 'Blocked restore of symbolic link.';
          continue;
        }
        await fsPromises.mkdir(path.dirname(record.originalPath), { recursive: true });
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
ipcMain.handle('fs:undo-single-file', async (event, payload) => {
  assertTrustedSender(event);
  const { sessionId, fileId } = payload || {};
  const ledger = loadLedger();
  const session = ledger.sessions.find(s => s.sessionId === sessionId);
  if (!session) throw new Error('Session not found.');

  const record = session.records.find(r => r.fileId === fileId);
  if (!record) throw new Error('File record not found in session.');
  if (record.status === 'REVERTED') throw new Error('File has already been reverted.');

  if (isProtectedSystemPath(record.finalPath) || isProtectedSystemPath(record.originalPath)) {
    throw new Error('Blocked restore involving protected path.');
  }

  if (!fs.existsSync(record.finalPath)) {
    throw new Error('Current file location not found on disk.');
  }

  const st = await fsPromises.lstat(record.finalPath);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw new Error('Symbolic links cannot be restored.');
  }

  await fsPromises.mkdir(path.dirname(record.originalPath), { recursive: true });
  const safeDest = getAvailablePath(record.originalPath, 'restored');
  await fsPromises.rename(record.finalPath, safeDest);
  record.status = 'REVERTED';
  record.restoredPath = safeDest;

  const allReverted = session.records.every(r => r.status === 'REVERTED');
  if (allReverted) {
    session.status = 'REVERTED';
    session.revertedAtIso = new Date().toISOString();
  }

  saveLedger(ledger);
  return { success: true, restoredPath: safeDest };
});

ipcMain.handle('fs:get-audit-ledger', async (event) => {
  assertTrustedSender(event);
  return loadLedger();
});

ipcMain.handle('fs:scan-duplicates', async (event, dirPath) => {
  assertTrustedSender(event);
  if (isUncOrInvalidPath(dirPath) || !fs.existsSync(dirPath)) {
    throw new Error('Directory does not exist or is invalid.');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('Protected system or application folders cannot be scanned.');
  }

  const excludedLowerSet = new Set(loadExcludedFolders().map(p => p.toLowerCase()));
  const sizeMap = new Map();
  let filesScanned = 0;

  async function scanFolderRecursive(currentDir, depth = 0) {
    if (depth > DUPLICATE_SCAN_MAX_DEPTH) return;
    try {
      const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (isProtectedSystemPath(fullPath)) continue;

        if (entry.isDirectory()) {
          if (entry.name.toLowerCase() === QUARANTINE_DIR_NAME.toLowerCase()) continue;
          // Protect intact apps, games, coding repos, and user-excluded folders from duplicate quarantining
          const check = await detectProtectedSubfolder(fullPath, excludedLowerSet);
          if (check.protected) continue;

          await scanFolderRecursive(fullPath, depth + 1);
        } else if (entry.isFile()) {
          filesScanned++;
          if (filesScanned % 100 === 0) {
            await new Promise(r => setImmediate(r));
          }
          try {
            const stats = await fsPromises.lstat(fullPath);
            if (!stats.isSymbolicLink() && stats.isFile() && stats.size > 0) {
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

  const candidateSizeGroups = [];
  for (const [, files] of sizeMap.entries()) {
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

ipcMain.handle('fs:resolve-duplicates', async (event, payload) => {
  assertTrustedSender(event);
  const { filesToQuarantine, targetDir } = payload || {};
  if (!targetDir || isUncOrInvalidPath(targetDir) || isProtectedSystemPath(targetDir) || !Array.isArray(filesToQuarantine) || filesToQuarantine.length === 0) {
    throw new Error('Invalid quarantine request');
  }

  const resolvedTargetDir = path.resolve(targetDir);
  const quarantineDir = path.join(resolvedTargetDir, QUARANTINE_DIR_NAME);
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
      if (!filePath || isUncOrInvalidPath(filePath)) continue;
      const resolvedFile = path.resolve(filePath);

      if (!isPathInside(resolvedTargetDir, resolvedFile) || isProtectedSystemPath(resolvedFile)) {
        results.push({ path: filePath, status: 'SKIPPED', error: 'Protected or out-of-scope file skipped' });
        continue;
      }

      if (!fs.existsSync(resolvedFile)) {
        results.push({ path: filePath, status: 'SKIPPED', error: 'File no longer exists' });
        continue;
      }

      const stats = await fsPromises.lstat(resolvedFile);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        results.push({ path: filePath, status: 'SKIPPED', error: 'Symbolic links skipped' });
        continue;
      }

      const fileId = crypto.randomUUID();
      const filename = path.basename(resolvedFile);
      const desiredDest = path.join(quarantineDir, filename);

      const safeDest = await moveFileSafely(resolvedFile, desiredDest, 'quarantine');
      const finalName = path.basename(safeDest);

      const record = {
        fileId,
        originalName: filename,
        targetName: finalName,
        originalPath: resolvedFile,
        finalPath: safeDest,
        sizeBytes: stats.size,
        category: QUARANTINE_DIR_NAME,
        movedAtIso: new Date().toISOString(),
        status: 'SUCCESS'
      };

      records.push(record);
      results.push({ path: resolvedFile, status: 'QUARANTINED', dest: safeDest });
      movedCount++;
    } catch (err) {
      console.error(`Error quarantining ${filePath}:`, err);
      errorCount++;
      records.push({
        fileId: crypto.randomUUID(),
        originalName: path.basename(String(filePath || 'unknown')),
        originalPath: String(filePath || ''),
        status: 'FAILED',
        error: err.message
      });
      results.push({ path: filePath, status: 'ERROR', error: err.message });
    }
  }

  if (records.length > 0) {
    const sessionData = {
      sessionId,
      timestampIso: startTimestamp,
      completedAtIso: new Date().toISOString(),
      sourceDirectory: resolvedTargetDir,
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

ipcMain.handle('shell:open-path', async (event, targetPath) => {
  assertTrustedSender(event);
  if (isUncOrInvalidPath(targetPath)) return false;
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    // Only reveals item in Windows File Explorer; never executes binaries or scripts
    shell.showItemInFolder(resolved);
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
      const stats = await fsPromises.lstat(filePath);
      if (stats.isSymbolicLink() || !stats.isFile()) return false;
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

async function processIncomingFile(rawFilename) {
  if (!sentinelState.isWatching || !sentinelState.watchedDir) return;
  const filename = path.basename(String(rawFilename || ''));
  if (!filename) return;

  const watchedDir = path.resolve(sentinelState.watchedDir);
  const fullPath = path.join(watchedDir, filename);

  if (!fs.existsSync(fullPath)) return;
  if (isProtectedSystemPath(fullPath)) return;

  try {
    const stats = await fsPromises.lstat(fullPath);
    if (stats.isSymbolicLink() || !stats.isFile()) return;

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
      ? path.resolve(sentinelState.destinationDir) 
      : watchedDir;

    const effectiveMs = resolveEffectiveTimestamp(filename, stats, sentinelState.dateSource || 'created');
    const rawProposed = computeTargetFolder({
      filename,
      categoryFolder: categoryInfo.targetFolder,
      modifiedMs: effectiveMs,
      strategy: sentinelState.dateStrategy || (sentinelState.organizeByChronology ? 'category-date' : 'category-only')
    });
    const proposedFolder = sanitizeRelativeSubfolder(rawProposed);

    const targetDir = proposedFolder ? path.join(baseTarget, proposedFolder) : baseTarget;
    const desiredDest = path.join(targetDir, filename);

    if (!isPathInside(baseTarget, desiredDest)) return;
    if (isSamePath(fullPath, desiredDest)) return;

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
      category: proposedFolder || categoryInfo.targetFolder,
      movedAtIso: new Date().toISOString(),
      status: 'SUCCESS'
    };

    const sessionData = {
      sessionId,
      timestampIso: new Date().toISOString(),
      completedAtIso: new Date().toISOString(),
      sourceDirectory: watchedDir,
      destinationDirectory: !isSamePath(baseTarget, watchedDir) ? baseTarget : undefined,
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
        category: proposedFolder || categoryInfo.targetFolder,
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

ipcMain.handle('sentinel:start-watch', async (event, dirPath, options = {}) => {
  assertTrustedSender(event);
  if (isUncOrInvalidPath(dirPath) || !fs.existsSync(dirPath)) {
    throw new Error('Directory to watch does not exist');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('Protected system folders cannot be monitored.');
  }
  if (options?.destinationDir && (isUncOrInvalidPath(options.destinationDir) || isProtectedSystemPath(options.destinationDir))) {
    throw new Error('Protected destination folder cannot be used.');
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
  sentinelState.watchedDir = path.resolve(dirPath);
  sentinelState.destinationDir = options.destinationDir ? path.resolve(options.destinationDir) : null;
  sentinelState.dateStrategy = options.dateStrategy || null;
  sentinelState.dateSource = options.dateSource || 'created';
  sentinelState.organizeByChronology = !!options.organizeByChronology;
  sentinelState.filesProcessed = 0;
  sentinelState.lastEventTime = new Date().toISOString();

  sentinelWatcher = fs.watch(sentinelState.watchedDir, { recursive: false }, (_eventType, filename) => {
    if (!filename) return;
    // Ignore subdirectory events so only top-level incoming files are auto-routed
    if (filename.includes(path.sep) || filename.includes('/')) return;

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

  return { success: true, watchedDir: sentinelState.watchedDir };
});

ipcMain.handle('sentinel:stop-watch', async (event) => {
  assertTrustedSender(event);
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

ipcMain.handle('sentinel:get-status', async (event) => {
  assertTrustedSender(event);
  return { ...sentinelState };
});

// ============================================================================
// Empty Folder Janitor
// ============================================================================

ipcMain.handle('fs:scan-empty-folders', async (event, dirPath) => {
  assertTrustedSender(event);
  if (isUncOrInvalidPath(dirPath) || !fs.existsSync(dirPath)) {
    throw new Error('Directory does not exist');
  }
  if (isProtectedSystemPath(dirPath)) {
    throw new Error('Protected system folders cannot be modified.');
  }

  const excludedLowerSet = new Set(loadExcludedFolders().map(p => p.toLowerCase()));
  const emptyFolders = [];

  async function checkEmptyDir(curr) {
    try {
      const entries = await fsPromises.readdir(curr, { withFileTypes: true });
      let hasFiles = false;
      let hasValidSubdirs = false;

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          hasFiles = true; // Never delete directories containing symlinks
          continue;
        }
        const full = path.join(curr, entry.name);
        if (isProtectedSystemPath(full)) {
          hasValidSubdirs = true;
          continue;
        }

        if (entry.isFile()) {
          hasFiles = true;
        } else if (entry.isDirectory()) {
          const check = await detectProtectedSubfolder(full, excludedLowerSet);
          if (check.protected) {
            // Never step into or delete folders inside intact projects/apps or excluded dirs
            hasValidSubdirs = true;
            continue;
          }
          const subEmpty = await checkEmptyDir(full);
          if (!subEmpty) {
            hasValidSubdirs = true;
          }
        }
      }

      if (!hasFiles && !hasValidSubdirs && !isSamePath(curr, dirPath)) {
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

ipcMain.handle('fs:delete-empty-folders', async (event, folderPaths) => {
  assertTrustedSender(event);
  if (!Array.isArray(folderPaths)) return { deletedCount: 0 };
  let deletedCount = 0;

  const excludedLowerSet = new Set(loadExcludedFolders().map(p => p.toLowerCase()));
  const sorted = [...folderPaths].filter(p => typeof p === 'string').sort((a, b) => b.length - a.length);

  for (const fPath of sorted) {
    if (isProtectedSystemPath(fPath)) continue;
    try {
      if (fs.existsSync(fPath)) {
        const st = await fsPromises.lstat(fPath);
        if (st.isSymbolicLink() || !st.isDirectory()) continue;
        const check = await detectProtectedSubfolder(fPath, excludedLowerSet);
        if (check.protected) continue;

        await fsPromises.rmdir(fPath);
        deletedCount++;
      }
    } catch (err) {
      console.warn(`Could not delete folder ${fPath}:`, err);
    }
  }

  return { deletedCount };
});

ipcMain.handle('window:set-theme', (event, isDark) => {
  assertTrustedSender(event);
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
