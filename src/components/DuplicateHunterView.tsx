import React, { useState, useEffect } from 'react';
import { 
  FolderOpen, RefreshCw, ExternalLink, Archive, CheckCircle2, 
  AlertCircle, Copy, FolderPlus, Check, Folder, X
} from 'lucide-react';
import { DuplicateGroup } from '../types';

interface DuplicateHunterViewProps {
  selectedDir: string;
  onSelectDir: (dir: string) => void;
  isDarkMode?: boolean;
}

export const DuplicateHunterView: React.FC<DuplicateHunterViewProps> = ({
  selectedDir,
  onSelectDir,
  isDarkMode = false
}) => {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [quarantineResult, setQuarantineResult] = useState<{ quarantineDir: string; count: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [addressInput, setAddressInput] = useState<string>(selectedDir);

  useEffect(() => {
    setAddressInput(selectedDir);
  }, [selectedDir]);

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
      setStatusMessage({ type: 'error', text: err.message || 'Error selecting folder.' });
    }
  };

  const handleScan = async (dirToScan = selectedDir) => {
    if (!dirToScan) return;
    setIsScanning(true);
    setStatusMessage(null);
    setQuarantineResult(null);
    setSelectedPaths(new Set());

    try {
      const res = await window.sentinelAPI.scanDuplicates(dirToScan);
      setDuplicateGroups(res.duplicates);
      if (res.duplicates.length === 0) {
        setStatusMessage({ type: 'info', text: 'No exact byte-for-byte duplicate files found.' });
      } else {
        const preSelected = new Set<string>();
        for (const group of res.duplicates) {
          const sorted = [...group.files].sort((a, b) => a.mtimeMs - b.mtimeMs);
          for (let i = 1; i < sorted.length; i++) {
            preSelected.add(sorted[i].path);
          }
        }
        setSelectedPaths(preSelected);
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Duplicate scan failed.' });
      setDuplicateGroups([]);
    } finally {
      setIsScanning(false);
    }
  };

  const toggleSelectPath = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectStrategy = (strategy: 'keep-oldest' | 'keep-newest') => {
    const next = new Set<string>();
    for (const group of duplicateGroups) {
      const sorted = [...group.files].sort((a, b) => 
        strategy === 'keep-oldest' ? a.mtimeMs - b.mtimeMs : b.mtimeMs - a.mtimeMs
      );
      for (let i = 1; i < sorted.length; i++) {
        next.add(sorted[i].path);
      }
    }
    setSelectedPaths(next);
  };

  const keepOnlyThis = (group: DuplicateGroup, keepFilePath: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      for (const f of group.files) {
        if (f.path === keepFilePath) {
          next.delete(f.path);
        } else {
          next.add(f.path);
        }
      }
      return next;
    });
  };

  const applyPriorityFolder = (keyword: string) => {
    if (!keyword.trim()) return;
    const lowerKw = keyword.trim().toLowerCase();
    const next = new Set<string>();

    for (const group of duplicateGroups) {
      const preferred = group.files.filter(f => f.path.toLowerCase().includes(lowerKw));
      if (preferred.length > 0) {
        const keeper = preferred[0].path;
        for (const f of group.files) {
          if (f.path !== keeper) next.add(f.path);
        }
      } else {
        const sorted = [...group.files].sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (let i = 1; i < sorted.length; i++) next.add(sorted[i].path);
      }
    }
    setSelectedPaths(next);
    setStatusMessage({
      type: 'info',
      text: `Retained copies matching path "${keyword}".`
    });
  };

  const handleQuarantine = async () => {
    if (selectedPaths.size === 0) {
      setStatusMessage({ type: 'error', text: 'No duplicate copies selected.' });
      return;
    }

    try {
      const res = await window.sentinelAPI.resolveDuplicates({
        filesToQuarantine: Array.from(selectedPaths),
        targetDir: selectedDir
      });

      const quarantinedCount = res.results.filter(r => r.status === 'QUARANTINED').length;
      setQuarantineResult({
        quarantineDir: res.quarantineDir,
        count: quarantinedCount
      });

      setStatusMessage({
        type: 'success',
        text: `Moved ${quarantinedCount} duplicate copies to _Quarantined_Duplicates.`
      });

      handleScan(selectedDir);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Quarantine operation failed.' });
    }
  };

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

  const totalWastedBytes = duplicateGroups.reduce((acc, g) => acc + (g.size * (g.files.length - 1)), 0);

  const toolbarBg = isDarkMode ? 'bg-[#161922] border-[#262b38]' : 'bg-[#f8f9fa] border-slate-300/80';
  const subToolbarBg = isDarkMode ? 'bg-[#12151d] border-[#262b38]' : 'bg-[#f1f3f5] border-slate-300/80';
  const controlBtn = isDarkMode
    ? 'bg-[#1e2330] hover:bg-[#272d3d] text-slate-200 border-[#31384a]'
    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 shadow-[0_1px_1px_rgba(0,0,0,0.04)]';

  return (
    <div 
      className="flex flex-col h-full w-full relative select-none overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className={`absolute inset-2 z-50 border-2 border-dashed rounded-md flex flex-col items-center justify-center p-6 text-center pointer-events-none ${
          isDarkMode ? 'bg-blue-950/90 border-blue-400 text-white' : 'bg-blue-50/95 border-blue-600 text-slate-900'
        }`}>
          <FolderPlus className="h-10 w-10 text-blue-600 mb-2" />
          <h3 className="text-sm font-semibold">Drop Folder to Scan for Duplicates</h3>
          <p className="text-xs text-slate-500 mt-0.5">SHA-256 verification ensures only 100% identical files are matched</p>
        </div>
      )}

      {/* Top Command Bar */}
      <div className={`h-10 px-2.5 border-b flex items-center justify-between gap-2 shrink-0 ${toolbarBg}`}>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <button
            onClick={handleBrowseFolder}
            className={`h-7 px-2.5 rounded-[4px] border text-[12px] font-medium flex items-center gap-1.5 shrink-0 ${controlBtn}`}
          >
            <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
            <span>Browse...</span>
          </button>

          <div className={`flex-1 flex items-center h-7 rounded-[4px] border px-2 gap-1.5 min-w-0 ${
            isDarkMode ? 'bg-[#0e1017] border-[#2d3344]' : 'bg-white border-slate-300 shadow-inner'
          }`}>
            <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <input
              type="text"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && addressInput.trim()) {
                  onSelectDir(addressInput.trim());
                  handleScan(addressInput.trim());
                }
              }}
              placeholder="Select folder to scan for duplicate files..."
              className={`w-full bg-transparent text-[12px] font-mono focus:outline-none truncate ${
                isDarkMode ? 'text-slate-200 placeholder-slate-500' : 'text-slate-800 placeholder-slate-400'
              }`}
            />
          </div>

          <button
            onClick={() => {
              const target = addressInput.trim() || selectedDir;
              if (target) {
                onSelectDir(target);
                handleScan(target);
              }
            }}
            disabled={isScanning || (!addressInput.trim() && !selectedDir)}
            className={`h-7 px-3 rounded-[4px] border text-[12px] font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-40 ${controlBtn}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin text-blue-600' : ''}`} />
            <span>{isScanning ? 'Scanning SHA-256...' : 'Scan Duplicates'}</span>
          </button>
        </div>

        <button
          onClick={handleQuarantine}
          disabled={selectedPaths.size === 0}
          className="h-7 px-3 rounded-[4px] bg-rose-600 hover:bg-rose-700 text-white font-medium text-[12px] border border-rose-700 flex items-center gap-1.5 shadow-2xs transition-colors disabled:opacity-40 tabular-nums shrink-0"
        >
          <Archive className="h-3.5 w-3.5" />
          <span>Quarantine Selected ({selectedPaths.size})</span>
        </button>
      </div>

      {/* Sub-Toolbar: Selection Rules & Stats */}
      <div className={`h-9 px-2.5 border-b flex items-center justify-between gap-3 shrink-0 text-[12px] ${subToolbarBg}`}>
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-medium">Auto-Select:</span>
          <button
            onClick={() => selectStrategy('keep-oldest')}
            disabled={duplicateGroups.length === 0}
            className={`h-6.5 px-2.5 rounded-[4px] border text-[11.5px] disabled:opacity-40 ${controlBtn}`}
          >
            Keep Oldest Copy
          </button>
          <button
            onClick={() => selectStrategy('keep-newest')}
            disabled={duplicateGroups.length === 0}
            className={`h-6.5 px-2.5 rounded-[4px] border text-[11.5px] disabled:opacity-40 ${controlBtn}`}
          >
            Keep Newest Copy
          </button>

          <div className={`h-4 w-[1px] mx-1 ${isDarkMode ? 'bg-[#2a3040]' : 'bg-slate-300'}`} />

          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Keep path matching..."
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyPriorityFolder(priorityFilter)}
              className={`h-6.5 w-44 px-2 rounded-[4px] border text-[11.5px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                isDarkMode ? 'bg-[#0e1017] border-[#2e3546] text-slate-200' : 'bg-white border-slate-300 text-slate-800'
              }`}
            />
            <button
              onClick={() => applyPriorityFolder(priorityFilter)}
              disabled={!priorityFilter.trim() || duplicateGroups.length === 0}
              className={`h-6.5 px-2 rounded-[4px] border text-[11.5px] disabled:opacity-40 ${controlBtn}`}
            >
              Apply
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11.5px] tabular-nums text-slate-600 dark:text-slate-400">
          <span>Groups: <strong>{duplicateGroups.length}</strong></span>
          <span>|</span>
          <span>Reclaimable: <strong className="text-rose-600 dark:text-rose-400">{formatSize(totalWastedBytes)}</strong></span>
        </div>
      </div>

      {/* Status Bar Message */}
      {(statusMessage || quarantineResult) && (
        <div className={`h-7 px-3 border-b flex items-center justify-between text-[11.5px] shrink-0 ${
          statusMessage?.type === 'error'
            ? isDarkMode ? 'bg-rose-950/40 border-rose-800/50 text-rose-200' : 'bg-rose-50 border-rose-200 text-rose-900'
            : isDarkMode ? 'bg-blue-950/30 border-blue-800/40 text-blue-200' : 'bg-blue-50 border-blue-200 text-blue-900'
        }`}>
          <div className="flex items-center gap-1.5 truncate">
            {statusMessage?.type === 'error' ? (
              <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            )}
            <span className="truncate">{statusMessage?.text}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {quarantineResult && window.sentinelAPI?.openPathInExplorer && (
              <button
                onClick={() => window.sentinelAPI.openPathInExplorer(quarantineResult.quarantineDir)}
                className="px-2 py-0.5 rounded-[3px] border border-blue-300 bg-white dark:bg-slate-800 text-[11px] font-medium flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                <span>Open Quarantine Folder</span>
              </button>
            )}
            <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-[#242936]">
        {duplicateGroups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <Copy className="h-8 w-8 text-slate-300 dark:text-slate-700 mb-2 stroke-[1.5]" />
            <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">
              {isScanning ? 'Calculating cryptographic SHA-256 hashes...' : 'No duplicate groups loaded'}
            </p>
            <p className="text-[11.5px] text-slate-400 mt-0.5">
              {selectedDir ? 'Click "Scan Duplicates" to inspect this directory and its subfolders.' : 'Select a folder above to search for identical duplicate files.'}
            </p>
          </div>
        ) : (
          duplicateGroups.map((group, idx) => (
            <div key={group.hash}>
              {/* Group Header */}
              <div className={`h-7.5 px-3 flex items-center justify-between text-[11.5px] ${
                isDarkMode ? 'bg-[#161922] text-slate-300' : 'bg-slate-100 text-slate-700'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Group #{idx + 1}</span>
                  <span className="text-slate-400">•</span>
                  <span className="tabular-nums">{group.files.length} identical copies ({formatSize(group.size)} each)</span>
                </div>
                <span className="font-mono text-[10.5px] text-slate-400">
                  SHA-256: {group.hash.slice(0, 16)}...
                </span>
              </div>

              {/* Group Files */}
              <div className="divide-y divide-slate-100 dark:divide-[#1e222d]">
                {group.files.map(file => {
                  const isSelected = selectedPaths.has(file.path);
                  return (
                    <div
                      key={file.path}
                      onClick={() => toggleSelectPath(file.path)}
                      className={`h-8 px-3 flex items-center justify-between text-[12px] cursor-default transition-colors ${
                        isSelected
                          ? isDarkMode ? 'bg-rose-950/20 hover:bg-rose-950/30' : 'bg-rose-50/40 hover:bg-rose-50/70'
                          : isDarkMode ? 'hover:bg-[#1b1f2a]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-4">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectPath(file.path)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-[3px] border-slate-300 text-rose-600 focus:ring-0 h-3.5 w-3.5"
                        />
                        <span className={`font-medium truncate ${isSelected ? 'line-through text-slate-400 dark:text-slate-500' : ''}`}>
                          {file.name}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 truncate">
                          {file.path}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 text-[11px]" onClick={(e) => e.stopPropagation()}>
                        <span className="text-slate-400 tabular-nums">
                          {new Date(file.mtimeMs).toISOString().slice(0, 10)}
                        </span>
                        <button
                          onClick={() => keepOnlyThis(group, file.path)}
                          className={`px-2 py-0.5 rounded-[3px] border text-[10.5px] flex items-center gap-1 ${controlBtn}`}
                          title="Keep only this copy and mark all other copies in this group for quarantine"
                        >
                          <Check className="h-2.5 w-2.5 text-emerald-600" />
                          <span>Keep Only This</span>
                        </button>
                        {window.sentinelAPI?.openPathInExplorer && (
                          <button
                            onClick={() => window.sentinelAPI.openPathInExplorer(file.path)}
                            className={`p-1 rounded-[3px] border ${controlBtn}`}
                            title="Show in Explorer"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                        <span className={`w-20 text-center py-0.5 rounded-[3px] text-[10.5px] font-medium border ${
                          isSelected
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                        }`}>
                          {isSelected ? 'Quarantine' : 'Retain'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
