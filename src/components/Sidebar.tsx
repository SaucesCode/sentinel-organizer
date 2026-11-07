import React from 'react';
import { 
  FolderSync, Copy, History, SlidersHorizontal, 
  HardDrive, ShieldCheck, Download, Monitor, FileText, Image, Clock, Folder
} from 'lucide-react';
import { OrganizeProfile, QuickFolderItem } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  profiles: OrganizeProfile[];
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
  selectedDir: string;
  quickFolders?: QuickFolderItem[];
  recentFolders?: string[];
  onSelectQuickDir?: (dir: string) => void;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
}

const getQuickIcon = (id: string) => {
  switch (id) {
    case 'downloads':
      return Download;
    case 'desktop':
      return Monitor;
    case 'documents':
      return FileText;
    case 'pictures':
      return Image;
    default:
      return Folder;
  }
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  profiles,
  activeProfileId,
  onSelectProfile,
  selectedDir,
  quickFolders = [],
  recentFolders = [],
  onSelectQuickDir,
  isDarkMode = false,
}) => {
  const mainNav = [
    { id: 'organize', label: 'File Organizer', icon: FolderSync },
    { id: 'duplicates', label: 'Duplicate Finder', icon: Copy },
    { id: 'ledger', label: 'History & Undo', icon: History },
    { id: 'profiles', label: 'Rule Profiles', icon: SlidersHorizontal },
  ];

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];
  const normSelected = selectedDir.toLowerCase();
  const quickLowerSet = new Set(quickFolders.map(q => q.path.toLowerCase()));
  const customRecents = recentFolders.filter(p => !quickLowerSet.has(p.toLowerCase())).slice(0, 3);

  return (
    <aside className={`w-52 shrink-0 flex flex-col justify-between select-none border-r ${
      isDarkMode 
        ? 'bg-[#14171f] border-[#242936] text-slate-300' 
        : 'bg-[#f3f4f6] border-slate-300/80 text-slate-700'
    }`}>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col py-2">
        {/* Primary Navigation */}
        <div className="px-2 space-y-0.5">
          <div className="px-2.5 py-1 text-[11px] font-semibold tracking-tight text-slate-500">
            Workspace
          </div>
          {mainNav.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative w-full flex items-center gap-2.5 px-2.5 h-7 rounded-[4px] text-[12.5px] transition-colors ${
                  isActive
                    ? isDarkMode
                      ? 'bg-[#222735] text-white font-medium'
                      : 'bg-white text-slate-900 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] border border-slate-200/80'
                    : isDarkMode
                      ? 'text-slate-400 hover:text-slate-200 hover:bg-[#1b1f2a]'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-blue-600 dark:bg-blue-500" />
                )}
                <Icon className={`h-3.5 w-3.5 shrink-0 ${
                  isActive 
                    ? 'text-blue-600 dark:text-blue-400' 
                    : isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Quick Access Pinned Folders */}
        {quickFolders.length > 0 && onSelectQuickDir && (
          <>
            <div className={`my-2 mx-3 border-t ${isDarkMode ? 'border-[#242936]' : 'border-slate-300/70'}`} />
            <div className="px-2 space-y-0.5">
              <div className="px-2.5 py-1 text-[11px] font-semibold tracking-tight text-slate-500">
                Quick Access
              </div>
              {quickFolders.map(qf => {
                const QIcon = getQuickIcon(qf.id);
                const isCurr = normSelected === qf.path.toLowerCase();
                return (
                  <button
                    key={qf.id}
                    onClick={() => onSelectQuickDir(qf.path)}
                    title={qf.path}
                    className={`w-full flex items-center gap-2 px-2.5 h-6.5 rounded-[4px] text-[12px] transition-colors ${
                      isCurr
                        ? isDarkMode
                          ? 'bg-blue-950/40 text-blue-300 font-medium'
                          : 'bg-blue-50 text-blue-800 font-medium border border-blue-200/80'
                        : isDarkMode
                          ? 'text-slate-400 hover:text-slate-200 hover:bg-[#1b1f2a]'
                          : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <QIcon className={`h-3.5 w-3.5 shrink-0 ${
                      isCurr ? 'text-blue-600 dark:text-blue-400' : 'text-amber-500'
                    }`} />
                    <span className="truncate">{qf.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Recent Custom Folders */}
        {customRecents.length > 0 && onSelectQuickDir && (
          <div className="px-2 mt-2 space-y-0.5">
            <div className="px-2.5 py-1 text-[11px] font-semibold tracking-tight text-slate-500 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Recent Folders</span>
            </div>
            {customRecents.map(dir => {
              const name = dir.split(/[/\\]/).filter(Boolean).pop() || dir;
              const isCurr = normSelected === dir.toLowerCase();
              return (
                <button
                  key={dir}
                  onClick={() => onSelectQuickDir(dir)}
                  title={dir}
                  className={`w-full flex items-center gap-2 px-2.5 h-6.5 rounded-[4px] text-[11.5px] transition-colors ${
                    isCurr
                      ? isDarkMode
                        ? 'bg-blue-950/40 text-blue-300 font-medium'
                        : 'bg-blue-50 text-blue-800 font-medium border border-blue-200/80'
                      : isDarkMode
                        ? 'text-slate-400 hover:text-slate-200 hover:bg-[#1b1f2a]'
                        : 'text-slate-700 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <Folder className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className={`my-2.5 mx-3 border-t ${isDarkMode ? 'border-[#242936]' : 'border-slate-300/70'}`} />

        {/* Active Rule Profile Box */}
        <div className="px-2.5">
          <div className={`p-2 rounded-[5px] border ${
            isDarkMode ? 'bg-[#191d28] border-[#262c3a]' : 'bg-slate-200/50 border-slate-300/80'
          }`}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className={`font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                Active Profile
              </span>
              <span className="text-[10px] tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
                {activeProfile?.rules?.filter(r => r.enabled).length || 0} rules
              </span>
            </div>
            <select
              value={activeProfileId}
              onChange={(e) => onSelectProfile(e.target.value)}
              className={`w-full text-[12px] rounded-[4px] px-2 h-6.5 focus:outline-none focus:ring-1 focus:ring-blue-500 border ${
                isDarkMode 
                  ? 'bg-[#111318] border-[#2d3446] text-slate-200' 
                  : 'bg-white border-slate-300 text-slate-800 shadow-[0_1px_1px_rgba(0,0,0,0.03)]'
              }`}
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-[10.5px] mt-1 leading-snug line-clamp-2 text-slate-500">
              {activeProfile?.description}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Directory & Protection Readout */}
      <div className={`px-3 py-2 border-t text-[11px] space-y-1 shrink-0 ${
        isDarkMode ? 'border-[#242936] bg-[#11131a]' : 'border-slate-300/80 bg-[#ebedf0]'
      }`}>
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <HardDrive className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="truncate font-medium" title={selectedDir || 'No active directory'}>
            {selectedDir ? (selectedDir.split(/[/\\]/).filter(Boolean).pop() || selectedDir) : 'No folder loaded'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500 shrink-0" />
          <span className="truncate">Collision & App Guard Active</span>
        </div>
      </div>
    </aside>
  );
};
