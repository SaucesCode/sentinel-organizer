import React, { useState, useEffect, useMemo } from 'react';
import { 
  FolderOpen, Play, Search, AlertCircle, ArrowRight, 
  Undo2, ExternalLink, RefreshCw, CheckCircle2, 
  FileText, FileSpreadsheet, FileImage, FileVideo, FileAudio, FileArchive, FileCode, File,
  Radio, FolderTree, List, Trash2, ChevronRight, ChevronDown, 
  FolderPlus, CheckCheck, Folder, X
} from 'lucide-react';
import { 
  FileCandidate, ScanResult, ProgressData, OrganizeSession, 
  OrganizeRule, SentinelWatchStatus, SentinelWatchEvent, EmptyFolderItem,
  DateStrategy
} from '../types';

interface OrganizeViewProps {
  selectedDir: string;
  onSelectDir: (dir: string) => void;
  activeRules: OrganizeRule[];
  activeProfileName: string;
  onSessionComplete: (session: OrganizeSession) => void;
  onUndoClick: (sessionId: string) => void;
  onStatsChange: (total: number, selected: number, bytes: number) => void;
  isDarkMode?: boolean;
}

const getFileIcon = (filename: string) => {
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'pdf') return <FileText className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />;
  if (['doc', 'docx', 'rtf', 'txt', 'md'].includes(ext)) return <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return <FileImage className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 shrink-0" />;
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return <FileVideo className="h-3.5 w-3.5 text-pink-600 dark:text-pink-400 shrink-0" />;
  if (['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'].includes(ext)) return <FileAudio className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />;
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <FileArchive className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400 shrink-0" />;
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'sql', 'yaml', 'yml', 'xml', 'sh', 'ps1'].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />;
  }
  return <File className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
};

export const OrganizeView: React.FC<OrganizeViewProps> = ({
  selectedDir,
  onSelectDir,
  activeRules,
  activeProfileName,
  onSessionComplete,
  onUndoClick,
  onStatsChange,
  isDarkMode = false
}) => {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [_scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [candidates, setCandidates] = useState<FileCandidate[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  // Reorganize by Category & Date Strategy (Default: Category First, Year in Month folder)
  const [dateStrategy, setDateStrategy] = useState<DateStrategy>('category-year-month');
  // Include already organized nested subfolders
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(true);
  // Grouping in the grouped view
  const [groupBy, setGroupBy] = useState<'folder' | 'category' | 'date'>('folder');
  
  // Organization tracking & status filtering
  const [statusFilter, setStatusFilter] = useState<'all' | 'needs-action' | 'organized'>('all');

  // Custom destination library folder
  const [destinationDir, setDestinationDir] = useState<string>('');
  
  // View mode: 'table' (Details) or 'tree' (Grouped)
  const [viewMode, setViewMode] = useState<'table' | 'tree'>('table');
  const [expandedTreeFolders, setExpandedTreeFolders] = useState<Set<string>>(new Set());

  // Autonomous Live Sentinel Watcher state
  const [sentinelStatus, setSentinelStatus] = useState<SentinelWatchStatus>({
    isWatching: false,
    watchedDir: null,
    destinationDir: null,
    filesProcessed: 0
  });

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Empty Folder Janitor state
  const [showJanitorModal, setShowJanitorModal] = useState<boolean>(false);
  const [emptyFolders, setEmptyFolders] = useState<EmptyFolderItem[]>([]);
  const [isScanningEmpty, setIsScanningEmpty] = useState<boolean>(false);
  const [isPurgingEmpty, setIsPurgingEmpty] = useState<boolean>(false);

  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [lastSession, setLastSession] = useState<OrganizeSession | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Initialize progress and sentinel listeners
  useEffect(() => {
    let unProg: (() => void) | undefined;
    let unSent: (() => void) | undefined;

    if (window.sentinelAPI?.onProgress) {
      unProg = window.sentinelAPI.onProgress((data) => {
        setProgress(data);
      });
    }

    if (window.sentinelAPI?.onSentinelEvent) {
      unSent = window.sentinelAPI.onSentinelEvent((evt) => {
        if (evt.type === 'ORGANIZED') {
          setStatusMessage({
            type: 'success',
            text: `Auto-Watch relocated "${evt.file}" to ${evt.category}`
          });
          if (selectedDir) {
            handleScan(selectedDir);
          }
        }
      });
    }

    if (window.sentinelAPI?.getSentinelStatus) {
      window.sentinelAPI.getSentinelStatus().then(status => {
        if (status) setSentinelStatus(status);
      }).catch(() => {});
    }

    return () => {
      if (unProg) unProg();
      if (unSent) unSent();
    };
  }, [selectedDir]);

  // Update parent status bar
  useEffect(() => {
    const selected = candidates.filter(c => c.selected);
    const bytes = selected.reduce((acc, c) => acc + c.sizeBytes, 0);
    onStatsChange(candidates.length, selected.length, bytes);
  }, [candidates, onStatsChange]);

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleBrowseFolder = async () => {
    try {
      if (!window.sentinelAPI?.selectDirectory) return;
      const dir = await window.sentinelAPI.selectDirectory();
      if (dir) {
        onSelectDir(dir);
        handleScan(dir);
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to select directory.' });
    }
  };

  const handleBrowseDestination = async () => {
    try {
      if (!window.sentinelAPI?.selectDirectory) return;
      const dir = await window.sentinelAPI.selectDirectory();
      if (dir) {
        setDestinationDir(dir);
        if (selectedDir) {
          handleScan(selectedDir, dir);
        }
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to select target folder.' });
    }
  };

  const handleScan = async (
    dirToScan = selectedDir, 
    targetLibrary = destinationDir, 
    recursive = includeSubfolders, 
    strat = dateStrategy
  ) => {
    if (!dirToScan) return;
    setIsScanning(true);
    setStatusMessage(null);
    try {
      const result = await window.sentinelAPI.scanDirectory(dirToScan, {
        rules: activeRules,
        destinationDir: targetLibrary || undefined,
        includeSubfolders: recursive,
        dateStrategy: strat
      });
      setScanResult(result);
      setCandidates(result.candidates);
      
      const allGroups = new Set(result.candidates.map(c => c.proposedFolder || 'Root Folder'));
      setExpandedTreeFolders(allGroups);

      if (result.candidates.length === 0) {
        setStatusMessage({ type: 'info', text: 'Folder is empty.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error scanning directory.' });
      setScanResult(null);
      setCandidates([]);
    } finally {
      setIsScanning(false);
    }
  };

  // Re-scan automatically when active rules, recursive mode or date strategy change
  useEffect(() => {
    if (selectedDir) {
      handleScan(selectedDir, destinationDir, includeSubfolders, dateStrategy);
    }
  }, [activeRules, includeSubfolders, dateStrategy]);

  const toggleSentinelWatch = async () => {
    if (!selectedDir) {
      setStatusMessage({ type: 'error', text: 'Select a folder before starting Auto-Watch.' });
      return;
    }

    try {
      if (sentinelStatus.isWatching) {
        await window.sentinelAPI.stopSentinelWatch();
        setSentinelStatus({
          isWatching: false,
          watchedDir: null,
          destinationDir: null,
          filesProcessed: sentinelStatus.filesProcessed
        });
        setStatusMessage({ type: 'info', text: 'Background Auto-Watch stopped.' });
      } else {
        await window.sentinelAPI.startSentinelWatch(selectedDir, {
          destinationDir: destinationDir || undefined,
          dateStrategy
        });
        setSentinelStatus({
          isWatching: true,
          watchedDir: selectedDir,
          destinationDir: destinationDir || null,
          filesProcessed: 0,
          lastEventTime: new Date().toISOString()
        });
        setStatusMessage({ 
          type: 'success', 
          text: `Auto-Watch active on ${selectedDir}` 
        });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Auto-Watch toggle failed.' });
    }
  };

  const handleExecute = async () => {
    const selectedFiles = candidates.filter(c => c.selected);
    if (!selectedFiles.length) {
      setStatusMessage({ type: 'error', text: 'Select at least one file to organize.' });
      return;
    }

    setIsExecuting(true);
    setProgress({ current: 0, total: selectedFiles.length, currentFile: 'Moving files...', percentage: 0 });

    try {
      const session = await window.sentinelAPI.executeOrganize({
        dirPath: selectedDir,
        destinationDir: destinationDir || undefined,
        candidates: selectedFiles,
        organizeByChronology: false,
        dateStrategy,
        profileName: activeProfileName
      });

      setIsExecuting(false);
      setProgress(null);
      setLastSession(session);
      onSessionComplete(session);
      setStatusMessage({
        type: 'success',
        text: `Moved ${session.movedCount} files into organized folders.`
      });

      setTimeout(() => {
        handleScan(selectedDir, destinationDir, includeSubfolders, dateStrategy);
      }, 100);
    } catch (err: any) {
      setIsExecuting(false);
      setProgress(null);
      setStatusMessage({ type: 'error', text: err.message || 'Execution error.' });
    }
  };

  const handleSelectNeedsAction = () => {
    setCandidates(prev => prev.map(c => ({
      ...c,
      selected: c.status !== 'organized' && !c.alreadyOrganized
    })));
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedPath = (e.dataTransfer.files[0] as any).path;
      if (droppedPath) {
        onSelectDir(droppedPath);
        handleScan(droppedPath);
      }
    }
  };

  // Empty Folder Janitor handlers
  const handleOpenJanitor = async () => {
    if (!selectedDir) {
      setStatusMessage({ type: 'error', text: 'Select a directory first.' });
      return;
    }
    setShowJanitorModal(true);
    setIsScanningEmpty(true);
    try {
      const empty = await window.sentinelAPI.scanEmptyFolders(selectedDir);
      setEmptyFolders(empty);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to scan empty folders.' });
    } finally {
      setIsScanningEmpty(false);
    }
  };

  const handlePurgeEmptyFolders = async () => {
    if (!emptyFolders.length) return;
    setIsPurgingEmpty(true);
    try {
      const paths = emptyFolders.map(f => f.path);
      const res = await window.sentinelAPI.deleteEmptyFolders(paths);
      setShowJanitorModal(false);
      setEmptyFolders([]);
      setStatusMessage({
        type: 'success',
        text: `Removed ${res.deletedCount} empty folders.`
      });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to delete empty folders.' });
    } finally {
      setIsPurgingEmpty(false);
    }
  };

  const toggleSelectAll = (select: boolean) => {
    const visibleIds = new Set(filteredCandidates.map(c => c.id));
    setCandidates(prev => prev.map(c => visibleIds.has(c.id) ? { ...c, selected: select } : c));
  };

  const toggleCandidate = (id: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, selected: !c.selected } : c));
  };

  const toggleFolderSelection = (groupKey: string, selectAll: boolean) => {
    setCandidates(prev => prev.map(c => {
      const key = groupBy === 'date'
        ? (c.dateGroup || 'Unspecified')
        : groupBy === 'category'
        ? (c.ruleName || c.proposedFolder.split('/')[0]?.split('\\')[0] || 'Unfiled')
        : (c.proposedFolder || 'Root Folder');
      return key === groupKey ? { ...c, selected: selectAll } : c;
    }));
  };

  const toggleTreeFolderExpand = (folder: string) => {
    setExpandedTreeFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const organizedCandidates = candidates.filter(c => c.status === 'organized' || c.alreadyOrganized);
  const needsActionCandidates = candidates.filter(c => c.status !== 'organized' && !c.alreadyOrganized);
  const looseCandidates = candidates.filter(c => c.status === 'loose');
  const reorganizeCandidates = candidates.filter(c => c.status === 'reorganize' || (c.isNested && !c.alreadyOrganized));
  
  const organizationScore = candidates.length > 0 
    ? Math.round((organizedCandidates.length / candidates.length) * 100) 
    : 100;

  // Build hierarchical folder tree for the Left Explorer Pane
  const folderTree = useMemo(() => {
    const map = new Map<string, { folder: string; count: number; inPlaceCount: number; moveCount: number }>();
    candidates.forEach(c => {
      const f = (c.proposedFolder || 'Root Folder').replace(/\//g, '\\');
      const existing = map.get(f) || { folder: f, count: 0, inPlaceCount: 0, moveCount: 0 };
      existing.count++;
      if (c.status === 'organized' || c.alreadyOrganized) {
        existing.inPlaceCount++;
      } else {
        existing.moveCount++;
      }
      map.set(f, existing);
    });
    return Array.from(map.values()).sort((a, b) => a.folder.localeCompare(b.folder));
  }, [candidates]);

  const filteredCandidates = candidates.filter(c => {
    // 1. Status Filter
    if (statusFilter === 'needs-action' && (c.status === 'organized' || c.alreadyOrganized)) return false;
    if (statusFilter === 'organized' && c.status !== 'organized' && !c.alreadyOrganized) return false;

    // 2. Search Query
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matches = c.name.toLowerCase().includes(q) ||
        c.proposedFolder.toLowerCase().includes(q) ||
        (c.dateGroup && c.dateGroup.toLowerCase().includes(q)) ||
        (c.currentSubfolder && c.currentSubfolder.toLowerCase().includes(q));
      if (!matches) return false;
    }

    // 3. Folder Tree Filter
    if (categoryFilter !== 'all') {
      const normProposed = (c.proposedFolder || 'Root Folder').replace(/\//g, '\\');
      if (normProposed !== categoryFilter && !normProposed.startsWith(categoryFilter + '\\')) {
        return false;
      }
    }

    return true;
  });

  const selectedCount = candidates.filter(c => c.selected).length;

  // Group candidates for Grouped View
  const groupKeys = Array.from(new Set(filteredCandidates.map(c => {
    if (groupBy === 'date') {
      return c.dateGroup || 'Unspecified Timeline';
    } else if (groupBy === 'category') {
      return c.ruleName || c.proposedFolder.split('/')[0]?.split('\\')[0] || 'Unfiled';
    } else {
      return (c.proposedFolder || 'Root Folder').replace(/\//g, '\\');
    }
  })));

  const groupedCandidates = groupKeys.map(key => {
    const items = filteredCandidates.filter(c => {
      if (groupBy === 'date') {
        return (c.dateGroup || 'Unspecified Timeline') === key;
      } else if (groupBy === 'category') {
        const topCat = c.ruleName || c.proposedFolder.split('/')[0]?.split('\\')[0] || 'Unfiled';
        return topCat === key;
      } else {
        return (c.proposedFolder || 'Root Folder').replace(/\//g, '\\') === key;
      }
    });
    const size = items.reduce((acc, item) => acc + item.sizeBytes, 0);
    const allSelected = items.length > 0 && items.every(i => i.selected);
    return {
      folder: key,
      items,
      size,
      allSelected
    };
  });

  const toolbarBg = isDarkMode ? 'bg-[#161922] border-[#262b38]' : 'bg-[#f8f9fa] border-slate-300/80';
  const subToolbarBg = isDarkMode ? 'bg-[#12151d] border-[#262b38]' : 'bg-[#f1f3f5] border-slate-300/80';
  const controlBtn = isDarkMode
    ? 'bg-[#1e2330] hover:bg-[#272d3d] active:bg-[#191d28] text-slate-200 border-[#31384a]'
    : 'bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border-slate-300 shadow-[0_1px_1px_rgba(0,0,0,0.04)]';

  return (
    <div 
      className="flex flex-col h-full w-full relative select-none overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Overlay */}
      {isDragOver && (
        <div className={`absolute inset-2 z-50 border-2 border-dashed rounded-md flex flex-col items-center justify-center p-6 text-center pointer-events-none ${
          isDarkMode 
            ? 'bg-blue-950/90 border-blue-400 text-white' 
            : 'bg-blue-50/95 border-blue-600 text-slate-900'
        }`}>
          <FolderPlus className="h-10 w-10 text-blue-600 dark:text-blue-400 mb-2" />
          <h3 className="text-sm font-semibold">Drop Folder to Open in SentinelFS</h3>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
            Files will be scanned and previewed before any changes are made
          </p>
        </div>
      )}

      {/* Top Native Command Bar (Row 1: Address Bar & Primary Actions) */}
      <div className={`h-10 px-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${toolbarBg}`}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <button
            onClick={handleBrowseFolder}
            className={`h-7 px-2.5 rounded-[4px] border text-[12px] font-medium flex items-center gap-1.5 shrink-0 transition-colors ${controlBtn}`}
          >
            <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
            <span>Browse...</span>
          </button>

          {/* Native Desktop Address Bar */}
          <div className={`flex-1 flex items-center h-7 rounded-[4px] border px-2 gap-1.5 min-w-0 ${
            isDarkMode ? 'bg-[#0e1017] border-[#2d3344]' : 'bg-white border-slate-300 shadow-inner'
          }`}>
            <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <input
              type="text"
              value={selectedDir}
              onChange={(e) => onSelectDir(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan(selectedDir)}
              placeholder="Select or type a directory path (e.g. C:\Users\Downloads)..."
              className={`w-full bg-transparent text-[12px] font-mono focus:outline-none truncate ${
                isDarkMode ? 'text-slate-200 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'
              }`}
            />
            {selectedDir && (
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => handleScan(selectedDir, destinationDir, includeSubfolders, dateStrategy)}
                  disabled={isScanning}
                  className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  title="Refresh Scan"
                >
                  <RefreshCw className={`h-3 w-3 ${isScanning ? 'animate-spin text-blue-600' : ''}`} />
                </button>
                {window.sentinelAPI?.openPathInExplorer && (
                  <button
                    onClick={() => window.sentinelAPI.openPathInExplorer(selectedDir)}
                    className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    title="Open in Windows File Explorer"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleOpenJanitor}
            disabled={!selectedDir}
            className={`h-7 px-2.5 rounded-[4px] border text-[12px] flex items-center gap-1.5 transition-colors disabled:opacity-40 ${controlBtn}`}
            title="Find and remove empty subfolders"
          >
            <Trash2 className="h-3.5 w-3.5 text-slate-500" />
            <span>Clean Empty</span>
          </button>

          <button
            onClick={toggleSentinelWatch}
            disabled={!selectedDir}
            className={`h-7 px-2.5 rounded-[4px] border text-[12px] flex items-center gap-1.5 transition-colors disabled:opacity-40 ${
              sentinelStatus.isWatching
                ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700 font-medium'
                : controlBtn
            }`}
            title={sentinelStatus.isWatching ? 'Stop background folder watch' : 'Automatically organize new files dropped in this folder'}
          >
            <Radio className={`h-3.5 w-3.5 ${sentinelStatus.isWatching ? 'animate-pulse text-white' : 'text-slate-500'}`} />
            <span>{sentinelStatus.isWatching ? 'Watching' : 'Auto-Watch'}</span>
          </button>

          <button
            onClick={handleExecute}
            disabled={isExecuting || selectedCount === 0}
            className="h-7 px-3 rounded-[4px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium text-[12px] border border-blue-700 flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-40 disabled:pointer-events-none tabular-nums"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Organize ({selectedCount})</span>
          </button>
        </div>
      </div>

      {/* Row 2: Organization Strategy & Options Strip */}
      <div className={`h-9 px-2.5 border-b flex items-center justify-between gap-3 shrink-0 text-[12px] ${subToolbarBg}`}>
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
          {/* Folder Structure Strategy */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Folder Structure:</span>
            <select
              value={dateStrategy}
              onChange={(e) => setDateStrategy(e.target.value as DateStrategy)}
              className={`h-6.5 rounded-[4px] px-2 text-[12px] border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                isDarkMode 
                  ? 'bg-[#181c26] border-[#2e3546] text-slate-200' 
                  : 'bg-white border-slate-300 text-slate-800'
              }`}
            >
              <optgroup label="Category First (Year in Month/Day folder name)">
                <option value="category-year-month">Category \ YYYY-MM - Month (e.g. Documents\2026-11 - November)</option>
                <option value="category-month-year">Category \ Month YYYY (e.g. Documents\November 2026)</option>
                <option value="category-date">Category \ YYYY-MM (e.g. Documents\2026-11)</option>
                <option value="category-exact-date">Category \ YYYY-MM-DD (e.g. Documents\2026-11-06)</option>
                <option value="category-year-quarter">Category \ YYYY-Quarter (e.g. Documents\2026-Q4)</option>
              </optgroup>
              <optgroup label="Date First (Year in Month/Day folder name)">
                <option value="year-month-category">YYYY-MM - Month \ Category (e.g. 2026-11 - November\Documents)</option>
                <option value="year-month">YYYY-MM - Month (e.g. 2026-11 - November)</option>
                <option value="month-year">Month YYYY (e.g. November 2026)</option>
                <option value="exact-date">Exact Date YYYY-MM-DD (e.g. 2026-11-06)</option>
                <option value="year-quarter">YYYY-Quarter (e.g. 2026-Q4)</option>
              </optgroup>
              <optgroup label="Standard">
                <option value="category-only">Category Only (e.g. Documents)</option>
                <option value="flatten">Flatten All Subfolders to Root</option>
              </optgroup>
            </select>
          </div>

          <div className={`h-4 w-[1px] shrink-0 ${isDarkMode ? 'bg-[#2a3040]' : 'bg-slate-300'}`} />

          {/* Recursive Subfolder Toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer shrink-0 text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeSubfolders}
              onChange={(e) => setIncludeSubfolders(e.target.checked)}
              className="rounded-[3px] border-slate-300 text-blue-600 focus:ring-0 h-3.5 w-3.5"
            />
            <span>Include subfolders (reorganize existing folders)</span>
          </label>

          <div className={`h-4 w-[1px] shrink-0 ${isDarkMode ? 'bg-[#2a3040]' : 'bg-slate-300'}`} />

          {/* Destination Picker */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleBrowseDestination}
              className={`h-6.5 px-2 rounded-[4px] border text-[11.5px] flex items-center gap-1 transition-colors ${
                destinationDir
                  ? 'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-300'
                  : controlBtn
              }`}
            >
              <FolderPlus className="h-3 w-3 text-slate-500" />
              <span>{destinationDir ? `Move to: ${destinationDir.split('\\').pop()}` : 'Location: In-Place'}</span>
            </button>
            {destinationDir && (
              <button
                onClick={() => {
                  setDestinationDir('');
                  handleScan(selectedDir, '');
                }}
                className="p-1 text-slate-400 hover:text-rose-600"
                title="Reset to In-Place"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Search & View Mode Switcher */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-48">
            <Search className="h-3 w-3 text-slate-400 absolute left-2 top-1.5" />
            <input
              type="text"
              placeholder="Filter files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full h-6.5 pl-6 pr-5 rounded-[4px] border text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                isDarkMode 
                  ? 'bg-[#0e1017] border-[#2e3546] text-slate-200 placeholder-slate-500' 
                  : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Native Segmented View Switcher */}
          <div className={`flex items-center rounded-[4px] border p-0.5 ${
            isDarkMode ? 'bg-[#0e1017] border-[#2e3546]' : 'bg-slate-200/70 border-slate-300'
          }`}>
            <button
              onClick={() => setViewMode('table')}
              className={`h-5.5 px-2 rounded-[3px] text-[11px] flex items-center gap-1 transition-colors ${
                viewMode === 'table'
                  ? isDarkMode ? 'bg-[#252b3b] text-white font-medium' : 'bg-white text-slate-900 font-medium shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="Details Table View"
            >
              <List className="h-3 w-3" />
              <span>Details</span>
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`h-5.5 px-2 rounded-[3px] text-[11px] flex items-center gap-1 transition-colors ${
                viewMode === 'tree'
                  ? isDarkMode ? 'bg-[#252b3b] text-white font-medium' : 'bg-white text-slate-900 font-medium shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
              title="Grouped Folders View"
            >
              <FolderTree className="h-3 w-3" />
              <span>Grouped</span>
            </button>
          </div>
        </div>
      </div>

      {/* Inline Notification Bar / Progress Strip */}
      {(statusMessage || (isExecuting && progress)) && (
        <div className={`h-7 px-3 border-b flex items-center justify-between text-[11.5px] shrink-0 ${
          isExecuting
            ? isDarkMode ? 'bg-blue-950/40 border-blue-800/50 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-900'
            : statusMessage?.type === 'error'
            ? isDarkMode ? 'bg-rose-950/40 border-rose-800/50 text-rose-200' : 'bg-rose-50 border-rose-200 text-rose-900'
            : isDarkMode ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200' : 'bg-emerald-50 border-emerald-200 text-emerald-900'
        }`}>
          {isExecuting && progress ? (
            <div className="flex items-center gap-3 w-full">
              <RefreshCw className="h-3 w-3 animate-spin text-blue-600 shrink-0" />
              <span className="truncate">{progress.currentFile}</span>
              <div className="w-40 h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full overflow-hidden shrink-0 ml-auto">
                <div className="bg-blue-600 h-full transition-all" style={{ width: `${progress.percentage}%` }} />
              </div>
              <span className="tabular-nums font-mono text-[11px]">{progress.percentage}%</span>
            </div>
          ) : statusMessage ? (
            <>
              <div className="flex items-center gap-1.5 truncate">
                {statusMessage.type === 'error' ? (
                  <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                )}
                <span className="truncate">{statusMessage.text}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lastSession && statusMessage.type === 'success' && (
                  <button
                    onClick={() => onUndoClick(lastSession.sessionId)}
                    className="px-2 py-0.5 rounded-[3px] border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-[11px] font-medium flex items-center gap-1 hover:bg-slate-50"
                  >
                    <Undo2 className="h-3 w-3" />
                    <span>Undo Move</span>
                  </button>
                )}
                <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Main Master-Detail Split-Pane Explorer */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Sub-Pane: Organization Tracker & Target Folder Tree */}
        <div className={`w-60 shrink-0 border-r flex flex-col select-none ${
          isDarkMode ? 'bg-[#141720] border-[#262b38]' : 'bg-[#f8f9fa] border-slate-300/80'
        }`}>
          {/* Section 1: Organization Status Filter */}
          <div className={`p-2.5 border-b ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-tight">
                Organization Status
              </span>
              {candidates.length > 0 && (
                <span className="text-[11px] font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                  {organizationScore}% Organized
                </span>
              )}
            </div>

            {/* Segmented Health Bar */}
            <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden flex mb-2.5">
              <div 
                className="bg-emerald-500 h-full transition-all" 
                style={{ width: `${candidates.length ? (organizedCandidates.length / candidates.length) * 100 : 0}%` }} 
              />
              <div 
                className="bg-amber-500 h-full transition-all" 
                style={{ width: `${candidates.length ? (reorganizeCandidates.length / candidates.length) * 100 : 0}%` }} 
              />
              <div 
                className="bg-blue-500 h-full transition-all" 
                style={{ width: `${candidates.length ? (looseCandidates.length / candidates.length) * 100 : 0}%` }} 
              />
            </div>

            <div className="space-y-0.5 text-[12px]">
              <button
                onClick={() => setStatusFilter('all')}
                className={`w-full flex items-center justify-between px-2 h-6.5 rounded-[4px] transition-colors ${
                  statusFilter === 'all'
                    ? isDarkMode ? 'bg-[#232938] text-white font-medium' : 'bg-blue-50/90 text-blue-900 font-medium border border-blue-200/70'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#1c202c]'
                }`}
              >
                <span>All Files</span>
                <span className="tabular-nums text-[11px] text-slate-500">{candidates.length}</span>
              </button>

              <button
                onClick={() => setStatusFilter('needs-action')}
                className={`w-full flex items-center justify-between px-2 h-6.5 rounded-[4px] transition-colors ${
                  statusFilter === 'needs-action'
                    ? isDarkMode ? 'bg-[#232938] text-white font-medium' : 'bg-blue-50/90 text-blue-900 font-medium border border-blue-200/70'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#1c202c]'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>Needs Organizing</span>
                </span>
                <span className="tabular-nums text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  {needsActionCandidates.length}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('organized')}
                className={`w-full flex items-center justify-between px-2 h-6.5 rounded-[4px] transition-colors ${
                  statusFilter === 'organized'
                    ? isDarkMode ? 'bg-[#232938] text-white font-medium' : 'bg-blue-50/90 text-blue-900 font-medium border border-blue-200/70'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#1c202c]'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span>Already in Place</span>
                </span>
                <span className="tabular-nums text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  {organizedCandidates.length}
                </span>
              </button>
            </div>
          </div>

          {/* Section 2: Target Folder Tree Explorer */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="px-2.5 py-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-tight">
                Target Folders ({folderTree.length})
              </span>
              {categoryFilter !== 'all' && (
                <button
                  onClick={() => setCategoryFilter('all')}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-0.5">
              {folderTree.length === 0 ? (
                <div className="px-2 py-6 text-center text-[11.5px] text-slate-400">
                  {selectedDir ? 'No target folders' : 'Open a folder to view target structure'}
                </div>
              ) : (
                folderTree.map(item => {
                  const isSelected = categoryFilter === item.folder;
                  const parts = item.folder.split('\\');
                  const topCat = parts[0];
                  const subDate = parts.slice(1).join('\\');

                  return (
                    <button
                      key={item.folder}
                      onClick={() => setCategoryFilter(isSelected ? 'all' : item.folder)}
                      className={`w-full text-left px-2 py-1.5 rounded-[4px] transition-colors flex flex-col gap-0.5 ${
                        isSelected
                          ? isDarkMode ? 'bg-[#232938] text-white' : 'bg-blue-50/90 text-blue-950 border border-blue-200/70'
                          : 'hover:bg-slate-200/60 dark:hover:bg-[#1c202c] text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 w-full">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Folder className={`h-3.5 w-3.5 shrink-0 ${
                            item.moveCount > 0 ? 'text-amber-500' : 'text-emerald-500'
                          }`} />
                          <span className="text-[12px] font-medium truncate">{topCat}</span>
                        </div>
                        <span className="text-[11px] tabular-nums text-slate-400 shrink-0">{item.count}</span>
                      </div>
                      {subDate && (
                        <div className="pl-5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="truncate">└ {subDate}</span>
                          {item.inPlaceCount > 0 && item.moveCount === 0 && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">In place</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Main Pane: File Details ListView / Grouped View */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Sub-Header Selection Bar */}
          <div className={`h-7 px-3 border-b flex items-center justify-between text-[11.5px] shrink-0 ${
            isDarkMode ? 'bg-[#141720] border-[#262b38] text-slate-400' : 'bg-[#f8f9fa] border-slate-200 text-slate-600'
          }`}>
            <div className="flex items-center gap-1.5 truncate">
              <span>Showing:</span>
              <strong className="font-medium text-slate-800 dark:text-slate-200">
                {statusFilter === 'all' ? 'All Files' : statusFilter === 'needs-action' ? 'Needs Organizing' : 'Already in Place'}
              </strong>
              {categoryFilter !== 'all' && (
                <>
                  <ChevronRight className="h-3 w-3 text-slate-400" />
                  <span className="font-mono text-[11px] text-blue-700 dark:text-blue-400">{categoryFilter}</span>
                  <button
                    onClick={() => setCategoryFilter('all')}
                    className="ml-1 text-slate-400 hover:text-slate-700"
                    title="Clear folder filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
              <span className="text-slate-400 tabular-nums">({filteredCandidates.length} items)</span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {needsActionCandidates.length > 0 && (
                <button
                  onClick={handleSelectNeedsAction}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium flex items-center gap-1"
                >
                  <CheckCheck className="h-3 w-3" />
                  <span>Select Unorganized ({needsActionCandidates.length})</span>
                </button>
              )}
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <button onClick={() => toggleSelectAll(true)} className="hover:text-slate-900 dark:hover:text-white">
                Select All
              </button>
              <button onClick={() => toggleSelectAll(false)} className="hover:text-slate-900 dark:hover:text-white">
                Select None
              </button>
            </div>
          </div>

          {/* Main File List Body */}
          {viewMode === 'table' ? (
            <div className="flex-1 overflow-auto">
              {filteredCandidates.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
                  <FolderOpen className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
                  <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">
                    {selectedDir ? 'No files match the current filter' : 'No folder opened'}
                  </p>
                  <p className="text-[11.5px] text-slate-400 mt-0.5">
                    {selectedDir ? 'Try switching the status filter on the left or clearing the search box.' : 'Click "Browse..." or drag and drop a folder into the window to start.'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse select-none">
                  <thead className={`sticky top-0 z-10 h-7 border-b text-[11px] font-semibold ${
                    isDarkMode ? 'bg-[#181b24] border-[#262b38] text-slate-400' : 'bg-[#f1f3f5] border-slate-300/90 text-slate-600'
                  }`}>
                    <tr>
                      <th className={`w-8 text-center border-r ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>
                        <input
                          type="checkbox"
                          checked={filteredCandidates.length > 0 && filteredCandidates.every(c => c.selected)}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="rounded-[3px] border-slate-300 text-blue-600 focus:ring-0 h-3.5 w-3.5"
                        />
                      </th>
                      <th className={`px-2.5 border-r ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>Name</th>
                      <th className={`px-2.5 w-28 border-r ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>Status</th>
                      <th className={`px-2.5 w-44 border-r ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>Current Folder</th>
                      <th className={`px-2.5 border-r ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>Target Folder (Category \ Date)</th>
                      <th className={`px-2.5 w-28 text-right border-r ${isDarkMode ? 'border-[#262b38]' : 'border-slate-200'}`}>Date Modified</th>
                      <th className="px-2.5 w-24 text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y text-[12px] ${
                    isDarkMode ? 'divide-[#202430] text-slate-200' : 'divide-slate-100 text-slate-800'
                  }`}>
                    {filteredCandidates.map(c => {
                      const isInPlace = c.status === 'organized' || c.alreadyOrganized;
                      const isReorganize = c.status === 'reorganize' || (c.isNested && !isInPlace);
                      const targetDisplay = (c.proposedFolder || 'Root').replace(/\//g, '\\');

                      return (
                        <tr
                          key={c.id}
                          onClick={() => toggleCandidate(c.id)}
                          className={`h-7.5 cursor-default transition-colors ${
                            c.selected
                              ? isDarkMode ? 'bg-blue-950/25 hover:bg-blue-950/40' : 'bg-blue-50/50 hover:bg-blue-50/90'
                              : isDarkMode ? 'hover:bg-[#1e222d] opacity-65' : 'hover:bg-slate-50 opacity-65'
                          }`}
                        >
                          <td className="text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={c.selected}
                              onChange={() => toggleCandidate(c.id)}
                              className="rounded-[3px] border-slate-300 text-blue-600 focus:ring-0 h-3.5 w-3.5"
                            />
                          </td>
                          <td className="px-2.5 max-w-[260px]">
                            <div className="flex items-center gap-2 truncate">
                              {getFileIcon(c.name)}
                              <span className="truncate font-medium">{c.name}</span>
                              {c.collision && (
                                <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-800 border border-amber-300 shrink-0">
                                  Auto-Rename
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2.5">
                            {isInPlace ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                In Place
                              </span>
                            ) : isReorganize ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Reorganize
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 dark:text-blue-400 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                Unfiled
                              </span>
                            )}
                          </td>
                          <td className="px-2.5 max-w-[180px] truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {c.isNested ? c.currentSubfolder?.replace(/\//g, '\\') : '(Root)'}
                          </td>
                          <td className="px-2.5 max-w-[280px] truncate font-mono text-[11px]">
                            <div className="flex items-center gap-1 truncate text-slate-700 dark:text-slate-300">
                              <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="truncate">{targetDisplay}</span>
                            </div>
                          </td>
                          <td className="px-2.5 text-right tabular-nums text-[11.5px] text-slate-500 dark:text-slate-400">
                            {c.modifiedIso.slice(0, 10)}
                          </td>
                          <td className="px-2.5 text-right tabular-nums text-[11.5px] text-slate-500 dark:text-slate-400">
                            {formatSize(c.sizeBytes)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            /* Grouped View (Windows Explorer Group-By Style) */
            <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-[#242936]">
              <div className={`px-3 py-1.5 flex items-center gap-2 text-[11px] border-b ${
                isDarkMode ? 'bg-[#181b24] border-[#262b38]' : 'bg-slate-100 border-slate-200'
              }`}>
                <span className="text-slate-500">Group headers by:</span>
                {(['folder', 'category', 'date'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setGroupBy(mode)}
                    className={`px-2 py-0.5 rounded-[3px] capitalize ${
                      groupBy === mode
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    {mode === 'folder' ? 'Full Target Path' : mode}
                  </button>
                ))}
              </div>

              {groupedCandidates.map(grp => {
                const isExpanded = expandedTreeFolders.has(grp.folder);
                return (
                  <div key={grp.folder}>
                    {/* Native Group Divider Row */}
                    <div className={`h-8 px-3 flex items-center justify-between select-none ${
                      isDarkMode ? 'bg-[#161922] hover:bg-[#1c202b]' : 'bg-slate-50 hover:bg-slate-100/80'
                    }`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          onClick={() => toggleTreeFolderExpand(grp.folder)}
                          className="text-slate-500 hover:text-slate-800 dark:hover:text-white"
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <input
                          type="checkbox"
                          checked={grp.allSelected}
                          onChange={(e) => toggleFolderSelection(grp.folder, e.target.checked)}
                          className="rounded-[3px] border-slate-300 text-blue-600 focus:ring-0 h-3.5 w-3.5"
                        />
                        <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 truncate font-mono">
                          {grp.folder}
                        </span>
                        <span className="text-[11px] text-slate-400 tabular-nums">
                          ({grp.items.length} items)
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {formatSize(grp.size)}
                      </span>
                    </div>

                    {/* Group Rows */}
                    {isExpanded && (
                      <div className="divide-y divide-slate-100 dark:divide-[#1f2430]">
                        {grp.items.map(file => (
                          <div
                            key={file.id}
                            onClick={() => toggleCandidate(file.id)}
                            className={`h-7.5 pl-9 pr-3 flex items-center justify-between text-[12px] cursor-default ${
                              file.selected
                                ? isDarkMode ? 'bg-blue-950/20 hover:bg-blue-950/35' : 'bg-white hover:bg-blue-50/50'
                                : 'opacity-60 hover:bg-slate-50 dark:hover:bg-[#1a1e29]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-4">
                              <input
                                type="checkbox"
                                checked={file.selected}
                                onChange={() => toggleCandidate(file.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded-[3px] border-slate-300 text-blue-600 focus:ring-0 h-3.5 w-3.5"
                              />
                              {getFileIcon(file.name)}
                              <span className="truncate font-medium">{file.name}</span>
                              {file.isNested && (
                                <span className="text-[10.5px] font-mono text-slate-400 truncate">
                                  (from {file.currentSubfolder?.replace(/\//g, '\\')})
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 shrink-0 text-[11px] text-slate-500 tabular-nums">
                              <span>{file.modifiedIso.slice(0, 10)}</span>
                              <span className="w-16 text-right">{formatSize(file.sizeBytes)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Empty Folder Janitor Dialog */}
      {showJanitorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`border rounded-[6px] w-full max-w-md shadow-xl overflow-hidden ${
            isDarkMode ? 'bg-[#181b24] border-[#2d3446] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
          }`}>
            <div className={`px-4 py-2.5 border-b flex items-center justify-between ${
              isDarkMode ? 'bg-[#141720] border-[#262b38]' : 'bg-[#f3f4f6] border-slate-200'
            }`}>
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                <h3 className="text-[12.5px] font-semibold">Clean Empty Subfolders</h3>
              </div>
              <button onClick={() => setShowJanitorModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {isScanningEmpty ? (
                <div className="py-6 text-center text-[12px] text-slate-500">
                  Scanning for empty directories...
                </div>
              ) : emptyFolders.length === 0 ? (
                <div className="py-6 text-center text-[12px] text-emerald-600 dark:text-emerald-400 font-medium">
                  No empty subfolders found in this directory.
                </div>
              ) : (
                <>
                  <p className="text-[12px] text-slate-600 dark:text-slate-400 mb-2">
                    Found <strong>{emptyFolders.length}</strong> empty subfolders that can be safely removed:
                  </p>
                  <div className={`max-h-48 overflow-y-auto border rounded-[4px] p-2 space-y-1 font-mono text-[11px] ${
                    isDarkMode ? 'bg-[#111318] border-[#262b38]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    {emptyFolders.map(f => (
                      <div key={f.path} className="truncate text-slate-600 dark:text-slate-300">
                        \{f.relativePath}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-200 dark:border-[#262b38]">
                <button
                  onClick={() => setShowJanitorModal(false)}
                  className={`h-7 px-3 rounded-[4px] border text-[12px] ${controlBtn}`}
                >
                  Cancel
                </button>
                {emptyFolders.length > 0 && (
                  <button
                    onClick={handlePurgeEmptyFolders}
                    disabled={isPurgingEmpty}
                    className="h-7 px-3 rounded-[4px] bg-rose-600 hover:bg-rose-700 text-white text-[12px] font-medium"
                  >
                    {isPurgingEmpty ? 'Removing...' : `Remove All (${emptyFolders.length})`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
