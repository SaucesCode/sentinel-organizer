import React, { useState, useEffect, useMemo } from 'react';
import { 
  History, Undo2, CheckCircle2, AlertTriangle, 
  ChevronDown, ChevronRight, Download, Search, FileText, 
  RotateCcw, Folder
} from 'lucide-react';
import { AuditLedger, OrganizeSession, LedgerRecord } from '../types';

interface AuditLedgerViewProps {
  onSessionReverted?: (sessionId: string) => void;
  isDarkMode?: boolean;
}

export const AuditLedgerView: React.FC<AuditLedgerViewProps> = ({ 
  onSessionReverted,
  isDarkMode = false
}) => {
  const [ledger, setLedger] = useState<AuditLedger | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertingFileId, setRevertingFileId] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'files' | 'sessions'>('files');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchLedger = async () => {
    try {
      if (window.sentinelAPI?.getAuditLedger) {
        const data = await window.sentinelAPI.getAuditLedger();
        setLedger(data);
      }
    } catch (err: any) {
      console.error('Failed to load history:', err);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, []);

  const handleUndoSession = async (session: OrganizeSession) => {
    if (session.status === 'REVERTED') return;
    const confirmRevert = window.confirm(
      `Restore all ${session.movedCount} files from session ${session.sessionId} back to original locations?`
    );
    if (!confirmRevert) return;

    setRevertingId(session.sessionId);
    setStatusMessage(null);
    try {
      const res = await window.sentinelAPI.undoSession(session.sessionId);
      const emptyNote = res.cleanedEmptyCount ? ` (cleaned ${res.cleanedEmptyCount} empty subfolder${res.cleanedEmptyCount > 1 ? 's' : ''})` : '';
      setStatusMessage({
        type: 'success',
        text: `Restored ${res.restoredCount} files back to original directories${emptyNote}.`
      });
      if (onSessionReverted) onSessionReverted(session.sessionId);
      await fetchLedger();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Restore failed.' });
    } finally {
      setRevertingId(null);
    }
  };

  const handleUndoSingleFile = async (sessionId: string, record: LedgerRecord) => {
    if (record.status === 'REVERTED') return;
    setRevertingFileId(record.fileId);
    setStatusMessage(null);
    try {
      const res = await window.sentinelAPI.undoSingleFile({ sessionId, fileId: record.fileId });
      const emptyNote = res.cleanedEmptyCount ? ` (cleaned ${res.cleanedEmptyCount} empty subfolder${res.cleanedEmptyCount > 1 ? 's' : ''})` : '';
      setStatusMessage({
        type: 'success',
        text: `Restored "${record.originalName}" back to original directory${emptyNote}.`
      });
      await fetchLedger();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'File restore failed.' });
    } finally {
      setRevertingFileId(null);
    }
  };

  const exportAuditLogJson = () => {
    if (!ledger) return;
    const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinel_history_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sessions = ledger?.sessions || [];

  const allHistoricalFiles = useMemo(() => {
    const list: Array<{ record: LedgerRecord; session: OrganizeSession }> = [];
    for (const session of sessions) {
      for (const record of session.records) {
        list.push({ record, session });
      }
    }
    return list;
  }, [sessions]);

  const filteredFiles = useMemo(() => {
    if (!fileSearchQuery.trim()) return allHistoricalFiles;
    const q = fileSearchQuery.toLowerCase();
    return allHistoricalFiles.filter(({ record, session }) => {
      const matchName = record.originalName.toLowerCase().includes(q) ||
                        (record.targetName && record.targetName.toLowerCase().includes(q));
      const matchPath = record.originalPath.toLowerCase().includes(q) ||
                        (record.finalPath && record.finalPath.toLowerCase().includes(q));
      const matchCat = record.category && record.category.toLowerCase().includes(q);
      const matchSession = session.sessionId.toLowerCase().includes(q);
      return matchName || matchPath || matchCat || matchSession;
    });
  }, [allHistoricalFiles, fileSearchQuery]);

  const toolbarBg = isDarkMode ? 'bg-[#1e1e1e] border-[#2d2d2d]' : 'bg-[#f8fafc] border-slate-300';
  const paneBg = isDarkMode ? 'bg-[#141414]' : 'bg-white';
  const borderCol = isDarkMode ? 'border-[#2d2d2d]' : 'border-slate-300';
  const textHead = isDarkMode ? 'text-zinc-100' : 'text-slate-900';
  const textMuted = isDarkMode ? 'text-zinc-400' : 'text-slate-500';
  const inputBg = isDarkMode
    ? 'bg-[#141414] border-[#383838] text-zinc-200 focus:border-blue-500'
    : 'bg-white border-slate-300 text-slate-800 focus:border-blue-600';

  return (
    <div className={`flex flex-col h-full select-none overflow-hidden ${paneBg}`}>
      {/* Top Native Command Toolbar */}
      <div className={`h-10 border-b px-3 flex items-center justify-between gap-2 shrink-0 ${toolbarBg}`}>
        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1.5" />
            <input
              type="text"
              placeholder="Find moved file by name, destination folder, or session ID..."
              value={fileSearchQuery}
              onChange={(e) => setFileSearchQuery(e.target.value)}
              className={`w-full h-7 border rounded-[4px] pl-8 pr-12 text-xs focus:outline-none ${inputBg}`}
            />
            {fileSearchQuery && (
              <button
                onClick={() => setFileSearchQuery('')}
                className="absolute right-2 top-1.5 text-[11px] text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className={`flex items-center rounded-[4px] border p-0.5 ${
            isDarkMode ? 'bg-[#141414] border-[#383838]' : 'bg-slate-200/70 border-slate-300'
          }`}>
            <button
              onClick={() => setViewMode('files')}
              className={`px-2.5 h-6 rounded-[3px] text-[11px] font-medium transition-colors tabular-nums ${
                viewMode === 'files'
                  ? isDarkMode ? 'bg-[#2d2d2d] text-white' : 'bg-white text-slate-900 shadow-2xs'
                  : textMuted
              }`}
            >
              Moved Files ({filteredFiles.length})
            </button>
            <button
              onClick={() => setViewMode('sessions')}
              className={`px-2.5 h-6 rounded-[3px] text-[11px] font-medium transition-colors tabular-nums ${
                viewMode === 'sessions'
                  ? isDarkMode ? 'bg-[#2d2d2d] text-white' : 'bg-white text-slate-900 shadow-2xs'
                  : textMuted
              }`}
            >
              Batch Sessions ({sessions.length})
            </button>
          </div>

          <button
            onClick={exportAuditLogJson}
            disabled={sessions.length === 0}
            className={`h-7 px-2.5 rounded-[4px] text-xs font-medium transition-colors flex items-center gap-1.5 border disabled:opacity-40 ${
              isDarkMode
                ? 'bg-[#252526] hover:bg-[#2d2d2d] text-zinc-200 border-[#383838]'
                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            Export Log
          </button>
        </div>
      </div>

      {/* Inline Status Notification Strip */}
      {statusMessage && (
        <div className={`h-7 px-3 border-b flex items-center justify-between text-xs shrink-0 ${
          statusMessage.type === 'success'
            ? isDarkMode ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : isDarkMode ? 'bg-rose-950/40 border-rose-800/50 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <div className="flex items-center gap-2 truncate">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
            )}
            <span className="truncate">{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-[11px] opacity-70 hover:opacity-100 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {viewMode === 'files' ? (
          <div className="flex-1 overflow-y-auto">
            {filteredFiles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <History className={`h-8 w-8 mb-2 ${isDarkMode ? 'text-zinc-700' : 'text-slate-300'}`} />
                <p className={`text-xs font-medium ${textHead}`}>
                  {fileSearchQuery ? `No files matching "${fileSearchQuery}"` : 'No file organization history yet'}
                </p>
                <p className={`text-[11px] mt-0.5 ${textMuted}`}>
                  Every file moved by Sentinel is recorded here for instant single-file or batch undo.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className={`sticky top-0 z-10 border-b select-none ${
                  isDarkMode ? 'bg-[#1e1e1e] border-[#2d2d2d] text-zinc-400' : 'bg-[#f1f5f9] border-slate-300 text-slate-600'
                }`}>
                  <tr>
                    <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol}`}>File Name</th>
                    <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol}`}>Original Location</th>
                    <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol}`}>Organized Location</th>
                    <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol} w-36`}>Timestamp</th>
                    <th className="py-1.5 px-2.5 font-medium text-right w-28">Action</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${
                  isDarkMode ? 'divide-[#222222] text-zinc-300' : 'divide-slate-200/70 text-slate-800'
                }`}>
                  {filteredFiles.map(({ record, session }) => {
                    const isReverted = record.status === 'REVERTED' || session.status === 'REVERTED';
                    const isReverting = revertingFileId === record.fileId;

                    return (
                      <tr key={record.fileId} className={`transition-colors ${
                        isDarkMode ? 'hover:bg-[#252526]' : 'hover:bg-blue-50/50'
                      }`}>
                        <td className={`py-1 px-2.5 font-medium ${textHead}`}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            <span className="truncate max-w-[200px]" title={record.originalName}>
                              {record.originalName}
                            </span>
                          </div>
                        </td>
                        <td className={`py-1 px-2.5 font-mono text-[11px] ${textMuted}`}>
                          <span className="truncate max-w-[240px] block" title={record.originalPath}>
                            {record.originalPath}
                          </span>
                        </td>
                        <td className="py-1 px-2.5">
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 truncate max-w-[240px]" title={record.finalPath}>
                            <Folder className="h-3 w-3 text-amber-500 shrink-0" />
                            {record.category}\{record.targetName || record.originalName}
                          </span>
                        </td>
                        <td className={`py-1 px-2.5 text-[11px] tabular-nums ${textMuted}`}>
                          {session.timestampIso.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="py-1 px-2.5 text-right">
                          {!isReverted ? (
                            <button
                              onClick={() => handleUndoSingleFile(session.sessionId, record)}
                              disabled={isReverting}
                              className={`h-6 px-2 rounded-[3px] text-[11px] font-medium transition-colors inline-flex items-center gap-1 border disabled:opacity-40 ${
                                isDarkMode 
                                  ? 'bg-[#252526] hover:bg-[#2d2d2d] text-zinc-200 border-[#383838]' 
                                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                              }`}
                              title="Restore this single file back to its original path"
                            >
                              <RotateCcw className={`h-3 w-3 ${isReverting ? 'animate-spin' : ''}`} />
                              Restore
                            </button>
                          ) : (
                            <span className={`text-[11px] ${textMuted}`}>
                              Restored
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-slate-200 dark:divide-[#262626]">
            {sessions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <History className={`h-8 w-8 mb-2 ${isDarkMode ? 'text-zinc-700' : 'text-slate-300'}`} />
                <p className={`text-xs font-medium ${textHead}`}>No batch sessions recorded yet</p>
              </div>
            ) : (
              sessions.map(session => {
                const isExpanded = expandedSessionId === session.sessionId;
                const isReverted = session.status === 'REVERTED';
                const isReverting = revertingId === session.sessionId;

                return (
                  <div key={session.sessionId} className="flex flex-col">
                    <div className={`px-3 py-2 flex items-center justify-between gap-3 ${
                      isDarkMode ? 'bg-[#1a1a1a] hover:bg-[#202020]' : 'bg-white hover:bg-slate-50'
                    }`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          onClick={() => setExpandedSessionId(isExpanded ? null : session.sessionId)}
                          className={`p-0.5 rounded-[3px] ${isDarkMode ? 'text-zinc-400 hover:bg-[#2d2d2d]' : 'text-slate-500 hover:bg-slate-200'}`}
                        >
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-xs font-semibold ${textHead}`}>{session.sessionId}</span>
                            <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium border ${
                              isReverted
                                ? isDarkMode ? 'bg-zinc-800 text-zinc-400 border-zinc-700' : 'bg-slate-100 text-slate-500 border-slate-200'
                                : isDarkMode ? 'bg-blue-950/40 text-blue-300 border-blue-800/50' : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                              {session.status}
                            </span>
                            {session.profileName && (
                              <span className={`text-[11px] ${textMuted}`}>
                                • {session.profileName}
                              </span>
                            )}
                            <span className={`text-[11px] tabular-nums ${textMuted}`}>
                              • {session.timestampIso.slice(0, 16).replace('T', ' ')}
                            </span>
                          </div>
                          <div className={`text-[11px] font-mono truncate mt-0.5 ${textMuted}`}>
                            {session.sourceDirectory} ({session.movedCount} files moved)
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!isReverted ? (
                          <button
                            onClick={() => handleUndoSession(session)}
                            disabled={isReverting}
                            className="h-7 px-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-[4px] text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <Undo2 className={`h-3.5 w-3.5 ${isReverting ? 'animate-spin' : ''}`} />
                            {isReverting ? 'Restoring...' : 'Undo Entire Batch'}
                          </button>
                        ) : (
                          <span className={`text-xs ${textMuted}`}>Batch Restored</span>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className={`px-8 py-2 border-t max-h-56 overflow-y-auto divide-y ${
                        isDarkMode ? 'border-[#262626] bg-[#141414] divide-[#222222]' : 'border-slate-200 bg-slate-50/70 divide-slate-200/60'
                      }`}>
                        {session.records.map((r, i) => (
                          <div key={i} className="py-1 flex items-center justify-between text-xs gap-4">
                            <div className="truncate flex-1 flex items-center gap-2">
                              <FileText className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className={`font-medium ${textHead}`}>{r.originalName}</span>
                              <span className={textMuted}>→</span>
                              <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400">{r.category}\{r.targetName || r.originalName}</span>
                            </div>
                            <span className={`text-[11px] shrink-0 ${r.status === 'REVERTED' ? textMuted : 'text-emerald-600 dark:text-emerald-400 font-medium'}`}>
                              {r.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
