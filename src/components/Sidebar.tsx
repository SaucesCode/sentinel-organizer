import React from 'react';
import { 
  FolderSync, Copy, History, SlidersHorizontal, 
  HardDrive, ShieldCheck
} from 'lucide-react';
import { OrganizeProfile } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  profiles: OrganizeProfile[];
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
  selectedDir: string;
  isDarkMode?: boolean;
  onToggleTheme?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  profiles,
  activeProfileId,
  onSelectProfile,
  selectedDir,
  isDarkMode = false,
}) => {
  const mainNav = [
    { id: 'organize', label: 'File Organizer', icon: FolderSync },
    { id: 'duplicates', label: 'Duplicate Finder', icon: Copy },
    { id: 'ledger', label: 'History & Undo', icon: History },
  ];

  const configNav = [
    { id: 'profiles', label: 'Rule Profiles', icon: SlidersHorizontal },
  ];

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

  return (
    <aside className={`w-48 shrink-0 flex flex-col justify-between select-none border-r ${
      isDarkMode 
        ? 'bg-[#14171f] border-[#242936] text-slate-300' 
        : 'bg-[#f3f4f6] border-slate-300/80 text-slate-700'
    }`}>
      <div className="flex flex-col py-2">
        {/* Primary Navigation */}
        <div className="px-2 space-y-0.5">
          <div className={`px-2.5 py-1 text-[11px] font-semibold tracking-tight ${
            isDarkMode ? 'text-slate-500' : 'text-slate-500'
          }`}>
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

        {/* Separator */}
        <div className={`my-2.5 mx-3 border-t ${isDarkMode ? 'border-[#242936]' : 'border-slate-300/70'}`} />

        {/* Configuration Navigation */}
        <div className="px-2 space-y-0.5">
          <div className={`px-2.5 py-1 text-[11px] font-semibold tracking-tight ${
            isDarkMode ? 'text-slate-500' : 'text-slate-500'
          }`}>
            Configuration
          </div>
          {configNav.map(item => {
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

        {/* Active Rule Profile Box */}
        <div className="px-3 mt-4">
          <div className={`p-2.5 rounded-[5px] border ${
            isDarkMode ? 'bg-[#191d28] border-[#262c3a]' : 'bg-slate-200/50 border-slate-300/80'
          }`}>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
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
            <p className={`text-[11px] mt-1.5 leading-snug line-clamp-2 ${
              isDarkMode ? 'text-slate-500' : 'text-slate-500'
            }`}>
              {activeProfile?.description}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Directory & Protection Readout */}
      <div className={`px-3 py-2.5 border-t text-[11px] space-y-1 ${
        isDarkMode ? 'border-[#242936] bg-[#11131a]' : 'border-slate-300/80 bg-[#ebedf0]'
      }`}>
        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
          <HardDrive className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="truncate font-medium" title={selectedDir || 'No active directory'}>
            {selectedDir ? (selectedDir.split('\\').pop() || selectedDir) : 'No folder loaded'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500 shrink-0" />
          <span className="truncate">Collision Guard Enabled</span>
        </div>
      </div>
    </aside>
  );
};
