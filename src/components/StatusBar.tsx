import React, { useState, useEffect } from 'react';
import { HardDrive, Layers, Radio, CheckCircle2, ShieldCheck } from 'lucide-react';
import { SentinelWatchStatus } from '../types';

interface StatusBarProps {
  selectedDir: string;
  activeProfileName: string;
  totalFiles: number;
  selectedFiles: number;
  totalBytes: number;
  isDarkMode?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  selectedDir,
  activeProfileName,
  totalFiles,
  selectedFiles,
  totalBytes,
  isDarkMode = false
}) => {
  const [watchStatus, setWatchStatus] = useState<SentinelWatchStatus | null>(null);

  useEffect(() => {
    let unEvent: (() => void) | undefined;
    const fetchStatus = async () => {
      try {
        if (window.sentinelAPI?.getSentinelStatus) {
          const s = await window.sentinelAPI.getSentinelStatus();
          setWatchStatus(s);
        }
      } catch {}
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);

    if (window.sentinelAPI?.onSentinelEvent) {
      unEvent = window.sentinelAPI.onSentinelEvent(() => {
        fetchStatus();
      });
    }

    return () => {
      clearInterval(interval);
      if (unEvent) unEvent();
    };
  }, []);

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <footer className={`h-6 shrink-0 border-t px-2.5 flex items-center justify-between text-[11px] select-none z-30 ${
      isDarkMode 
        ? 'bg-[#111318] border-[#242936] text-slate-400' 
        : 'bg-[#f3f4f6] border-slate-300 text-slate-600'
    }`}>
      <div className="flex items-center h-full">
        <div className={`flex items-center gap-1.5 pr-3 h-full border-r ${
          isDarkMode ? 'border-[#242936]' : 'border-slate-300/80'
        }`}>
          <HardDrive className="h-3 w-3 text-slate-500 shrink-0" />
          <span className="truncate max-w-[320px] font-mono text-[10.5px]">
            {selectedDir || 'Ready'}
          </span>
        </div>

        <div className={`flex items-center gap-1.5 px-3 h-full border-r ${
          isDarkMode ? 'border-[#242936]' : 'border-slate-300/80'
        }`}>
          <Layers className="h-3 w-3 text-slate-500 shrink-0" />
          <span>Profile: <strong className="font-medium text-slate-700 dark:text-slate-200">{activeProfileName}</strong></span>
        </div>

        {totalFiles > 0 && (
          <div className="flex items-center gap-2 px-3 h-full tabular-nums">
            <span>{totalFiles} items</span>
            <span className="text-slate-400">|</span>
            <span className="font-medium text-blue-700 dark:text-blue-400">
              {selectedFiles} selected ({formatSize(totalBytes)})
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center h-full">
        <div
          className={`flex items-center gap-1.5 px-3 h-full border-r ${
            isDarkMode ? 'border-[#242936] text-slate-400' : 'border-slate-300/80 text-slate-600'
          }`}
          title="100% Offline Air-Gapped Mode • Chromium OS Sandbox • Symlink & App-Tamper Protection Active"
        >
          <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-500 shrink-0" />
          <span>Offline & Sandboxed</span>
        </div>

        {watchStatus?.isWatching ? (
          <div className="flex items-center gap-1.5 pl-3 text-rose-600 dark:text-rose-400 font-medium tabular-nums">
            <Radio className="h-3 w-3 animate-pulse" />
            <span>Auto-Watch Active ({watchStatus.filesProcessed} moved)</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 pl-3 text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-500" />
            <span>Ready</span>
          </div>
        )}
      </div>
    </footer>
  );
};
