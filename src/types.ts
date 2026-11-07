export type DateStrategy = 
  | 'category-only' 
  | 'category-year-month'
  | 'category-month-year'
  | 'category-year-quarter'
  | 'category-date'
  | 'category-exact-date'
  | 'year-month-category'
  | 'year-quarter-category'
  | 'year-month' 
  | 'month-year'
  | 'year-quarter' 
  | 'exact-date' 
  | 'flatten';

export type DateSource = 'created' | 'modified' | 'smart';

export type FileCandidateStatus = 'organized' | 'reorganize' | 'loose';

export interface FileCandidate {
  id: string;
  name: string;
  originalPath: string;
  sizeBytes: number;
  modifiedIso: string;
  createdIso: string;
  effectiveDateIso?: string;
  ageDays: number;
  proposedFolder: string;
  proposedPath: string;
  ruleName: string;
  ruleId: string;
  selected: boolean;
  collision: boolean;
  currentSubfolder?: string;
  isNested?: boolean;
  dateGroup?: string;
  alreadyOrganized?: boolean;
  status?: FileCandidateStatus;
}

export interface ScanOptions {
  rules?: OrganizeRule[];
  destinationDir?: string;
  includeSubfolders?: boolean;
  dateStrategy?: DateStrategy;
  dateSource?: DateSource;
}

export interface ProtectedFolderItem {
  path: string;
  relativePath: string;
  name: string;
  reason: string;
  autoDetected: boolean;
}

export interface ScanResult {
  dirPath: string;
  destinationDir?: string;
  includeSubfolders?: boolean;
  dateStrategy?: DateStrategy;
  totalFiles: number;
  totalBytes: number;
  candidates: FileCandidate[];
  protectedFolders?: ProtectedFolderItem[];
}

export interface OrganizeRule {
  id: string;
  name: string;
  type: 'regex' | 'extension';
  pattern: string;
  targetFolder: string;
  enabled: boolean;
}

export interface OrganizeProfile {
  id: string;
  name: string;
  description: string;
  rules: OrganizeRule[];
  isBuiltin?: boolean;
}

export interface LedgerRecord {
  fileId: string;
  originalName: string;
  targetName?: string;
  originalPath: string;
  finalPath?: string;
  sha256?: string;
  sizeBytes?: number;
  category?: string;
  movedAtIso?: string;
  status: 'SUCCESS' | 'FAILED' | 'REVERTED';
  error?: string;
}

export interface OrganizeSession {
  sessionId: string;
  timestampIso: string;
  completedAtIso: string;
  sourceDirectory: string;
  totalProcessed: number;
  movedCount: number;
  errorCount: number;
  cleanedEmptyCount?: number;
  profileName?: string;
  status: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'REVERTED';
  revertedAtIso?: string;
  restoredFiles?: number;
  records: LedgerRecord[];
}

export interface AuditLedger {
  sessions: OrganizeSession[];
}

export interface DuplicateFile {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
  modifiedIso: string;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: DuplicateFile[];
}

export interface ProgressData {
  current: number;
  total: number;
  currentFile: string;
  percentage: number;
}

export interface SentinelWatchStatus {
  isWatching: boolean;
  watchedDir: string | null;
  destinationDir: string | null;
  filesProcessed: number;
  lastEventTime?: string;
}

export interface SentinelWatchEvent {
  type: 'ORGANIZED' | 'ERROR' | 'STARTED' | 'STOPPED';
  file?: string;
  sourcePath?: string;
  targetPath?: string;
  category?: string;
  message?: string;
  timestamp: string;
}

export interface EmptyFolderItem {
  path: string;
  relativePath: string;
  name: string;
}

export interface QuickFolderItem {
  id: string;
  label: string;
  path: string;
}

export interface SystemInfo {
  osPlatform: string;
  osRelease: string;
  arch: string;
  nodeVersion: string;
  isoTimestamp: string;
}

declare global {
  interface Window {
    sentinelAPI: {
      selectDirectory: () => Promise<string | null>;
      getSystemInfo: () => Promise<SystemInfo>;
      getQuickFolders: () => Promise<QuickFolderItem[]>;
      scanDirectory: (dirPath: string, optionsOrRules?: ScanOptions | OrganizeRule[], legacyDestinationDir?: string) => Promise<ScanResult>;
      executeOrganize: (payload: { dirPath: string; destinationDir?: string; candidates: FileCandidate[]; organizeByChronology?: boolean; dateStrategy?: DateStrategy; profileName?: string }) => Promise<OrganizeSession>;
      getAuditLedger: () => Promise<AuditLedger>;
      undoSession: (sessionId: string) => Promise<{ sessionId: string; restoredCount: number; failureCount: number; cleanedEmptyCount?: number; status: string }>;
      undoSingleFile: (payload: { sessionId: string; fileId: string }) => Promise<{ success: boolean; restoredPath: string; cleanedEmptyCount?: number }>;
      scanDuplicates: (dirPath: string) => Promise<{ scannedRoot: string; duplicateGroupsCount: number; duplicates: DuplicateGroup[] }>;
      resolveDuplicates: (payload: { filesToQuarantine: string[]; targetDir: string }) => Promise<{ quarantineDir: string; results: any[]; sessionId?: string }>;
      getProfiles: () => Promise<{ profiles: OrganizeProfile[]; activeProfileId: string }>;
      saveProfiles: (payload: { profiles: OrganizeProfile[]; activeProfileId: string }) => Promise<boolean>;
      onProgress: (callback: (data: ProgressData) => void) => () => void;
      openPathInExplorer: (targetPath: string) => Promise<boolean>;
      setWindowTheme?: (isDark: boolean) => Promise<boolean>;
      // Live Sentinel Watcher
      startSentinelWatch: (dirPath: string, options?: { destinationDir?: string; organizeByChronology?: boolean; dateStrategy?: DateStrategy; dateSource?: DateSource }) => Promise<{ success: boolean; watchedDir: string }>;
      stopSentinelWatch: () => Promise<{ success: boolean }>;
      getSentinelStatus: () => Promise<SentinelWatchStatus>;
      onSentinelEvent: (callback: (event: SentinelWatchEvent) => void) => () => void;
      // Empty Folder Janitor
      scanEmptyFolders: (dirPath: string) => Promise<EmptyFolderItem[]>;
      deleteEmptyFolders: (folderPaths: string[]) => Promise<{ deletedCount: number }>;
      // Protected & Excluded Subfolders
      getExcludedFolders: () => Promise<string[]>;
      addExcludedFolder: (payload?: string | { folderPath?: string; browseFromDir?: string }) => Promise<{ added: string | null; excludedFolders: string[] }>;
      removeExcludedFolder: (folderPath: string) => Promise<string[]>;
    };
  }
}
