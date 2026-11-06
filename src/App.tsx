import React, { useState, useEffect } from 'react';
import { FolderTree, Sun, Moon, FolderOpen, ChevronRight } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { OrganizeView } from './components/OrganizeView';
import { DuplicateHunterView } from './components/DuplicateHunterView';
import { AuditLedgerView } from './components/AuditLedgerView';
import { ProfileTemplatesView } from './components/ProfileTemplatesView';
import { SystemInfo, OrganizeProfile } from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('organize');
  const [selectedDir, setSelectedDir] = useState<string>('');
  const [_systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  
  // Theme state: defaults to false (Light Mode)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('sentinel_theme') === 'dark';
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('sentinel_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('sentinel_theme', 'light');
    }
    if (window.sentinelAPI?.setWindowTheme) {
      window.sentinelAPI.setWindowTheme(isDarkMode).catch(() => {});
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(prev => !prev);
  
  // Profile state
  const [profiles, setProfiles] = useState<OrganizeProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('general');
  
  // Stats state for status bar
  const [stats, setStats] = useState<{ total: number; selected: number; bytes: number }>({
    total: 0,
    selected: 0,
    bytes: 0
  });

  // Load profiles and system info on mount
  useEffect(() => {
    const init = async () => {
      try {
        if (window.sentinelAPI?.getProfiles) {
          const pData = await window.sentinelAPI.getProfiles();
          if (pData?.profiles) {
            setProfiles(pData.profiles);
            setActiveProfileId(pData.activeProfileId || 'general');
          }
        }
        if (window.sentinelAPI?.getSystemInfo) {
          const info = await window.sentinelAPI.getSystemInfo();
          setSystemInfo(info);
        }
      } catch (err) {
        console.warn('Initialization error:', err);
      }
    };
    init();
  }, []);

  const handleUpdateProfiles = async (nextProfiles: OrganizeProfile[], nextActiveId: string) => {
    setProfiles(nextProfiles);
    setActiveProfileId(nextActiveId);
    try {
      if (window.sentinelAPI?.saveProfiles) {
        await window.sentinelAPI.saveProfiles({
          profiles: nextProfiles,
          activeProfileId: nextActiveId
        });
      }
    } catch (err) {
      console.error('Failed to save profiles:', err);
    }
  };

  const handleSelectProfile = (id: string) => {
    setActiveProfileId(id);
    if (window.sentinelAPI?.saveProfiles) {
      window.sentinelAPI.saveProfiles({
        profiles,
        activeProfileId: id
      });
    }
  };

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || {
    id: 'general',
    name: 'General Purpose',
    rules: []
  };

  const pathSegments = selectedDir ? selectedDir.split(/[/\\]/).filter(Boolean) : [];

  return (
    <div className={`h-screen w-screen flex flex-col overflow-hidden font-sans select-none antialiased ${
      isDarkMode ? 'bg-[#111318] text-slate-100' : 'bg-[#f3f4f6] text-slate-800'
    }`}>
      {/* Native Integrated Window Titlebar (36px) */}
      <header className={`h-9 shrink-0 border-b flex items-center justify-between pl-3 pr-[142px] app-drag-region ${
        isDarkMode 
          ? 'bg-[#111318] border-[#242936] text-slate-200' 
          : 'bg-[#f1f5f9] border-slate-300/90 text-slate-800'
      }`}>
        {/* Left: Application Icon & Name */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-5 w-5 rounded-[4px] bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <FolderTree className="h-3 w-3" />
            </div>
            <span className="font-semibold text-[12.5px] tracking-tight">
              SentinelFS
            </span>
          </div>

          <span className={`text-xs ${isDarkMode ? 'text-slate-700' : 'text-slate-300'}`}>|</span>

          {/* Breadcrumb Path Indicator in Titlebar */}
          <div className="flex items-center gap-1 text-[11.5px] text-slate-500 dark:text-slate-400 truncate max-w-[520px]">
            <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0 mr-0.5" />
            {pathSegments.length > 0 ? (
              pathSegments.map((seg, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <ChevronRight className="h-3 w-3 text-slate-400 shrink-0" />}
                  <span className={idx === pathSegments.length - 1 ? 'font-medium text-slate-700 dark:text-slate-200 truncate' : 'truncate'}>
                    {seg}
                  </span>
                </React.Fragment>
              ))
            ) : (
              <span>No directory open</span>
            )}
          </div>
        </div>

        {/* Right (Before Windows Caption Buttons): Theme Switcher */}
        <div className="flex items-center gap-1.5 app-no-drag shrink-0">
          <button
            onClick={toggleTheme}
            className={`h-6 px-2 rounded-[4px] border text-[11px] flex items-center gap-1.5 transition-colors ${
              isDarkMode 
                ? 'bg-[#1b1f2a] hover:bg-[#252b3b] border-[#2e3646] text-slate-300' 
                : 'bg-white hover:bg-slate-100 border-slate-300/90 text-slate-700 shadow-[0_1px_1px_rgba(0,0,0,0.03)]'
            }`}
            title={isDarkMode ? 'Switch to Light Appearance' : 'Switch to Dark Appearance'}
          >
            {isDarkMode ? (
              <>
                <Sun className="h-3 w-3 text-amber-400" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3 w-3 text-slate-600" />
                <span>Dark</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Split-Pane Desktop Workbench (Flush Edge-to-Edge) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSelectProfile={handleSelectProfile}
          selectedDir={selectedDir}
          isDarkMode={isDarkMode}
          onToggleTheme={toggleTheme}
        />

        <main className={`flex-1 min-h-0 flex flex-col overflow-hidden ${
          isDarkMode ? 'bg-[#181b24]' : 'bg-white'
        }`}>
          {activeTab === 'organize' && (
            <OrganizeView
              selectedDir={selectedDir}
              onSelectDir={setSelectedDir}
              activeRules={activeProfile.rules || []}
              activeProfileName={activeProfile.name}
              onSessionComplete={() => {}}
              onUndoClick={() => setActiveTab('ledger')}
              onStatsChange={(total, selected, bytes) => setStats({ total, selected, bytes })}
              isDarkMode={isDarkMode}
            />
          )}
          {activeTab === 'duplicates' && (
            <DuplicateHunterView
              selectedDir={selectedDir}
              onSelectDir={setSelectedDir}
              isDarkMode={isDarkMode}
            />
          )}
          {activeTab === 'ledger' && (
            <AuditLedgerView isDarkMode={isDarkMode} />
          )}
          {activeTab === 'profiles' && (
            <ProfileTemplatesView
              profiles={profiles}
              activeProfileId={activeProfileId}
              onUpdateProfiles={handleUpdateProfiles}
              isDarkMode={isDarkMode}
            />
          )}
        </main>
      </div>

      {/* Native Desktop Status Bar */}
      <StatusBar
        selectedDir={selectedDir}
        activeProfileName={activeProfile.name}
        totalFiles={stats.total}
        selectedFiles={stats.selected}
        totalBytes={stats.bytes}
        isDarkMode={isDarkMode}
      />
    </div>
  );
};

export default App;
