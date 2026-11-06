import React, { useState } from 'react';
import { 
  SlidersHorizontal, Plus, Trash2, CheckCircle2, Folder, Check
} from 'lucide-react';
import { OrganizeProfile, OrganizeRule } from '../types';

interface ProfileTemplatesViewProps {
  profiles: OrganizeProfile[];
  activeProfileId: string;
  onUpdateProfiles: (profiles: OrganizeProfile[], activeId: string) => void;
  isDarkMode?: boolean;
}

export const ProfileTemplatesView: React.FC<ProfileTemplatesViewProps> = ({
  profiles,
  activeProfileId,
  onUpdateProfiles,
  isDarkMode = false
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(activeProfileId);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');
  const [newTemplateDesc, setNewTemplateDesc] = useState<string>('');
  
  const [showAddRule, setShowAddRule] = useState<boolean>(false);
  const [ruleName, setRuleName] = useState<string>('');
  const [ruleType, setRuleType] = useState<'extension' | 'regex'>('extension');
  const [rulePattern, setRulePattern] = useState<string>('');
  const [ruleTarget, setRuleTarget] = useState<string>('');

  const currentProfile = profiles.find(p => p.id === selectedTemplateId) || profiles[0];

  const handleSetActive = (id: string) => {
    onUpdateProfiles(profiles, id);
    setStatusMessage({ type: 'success', text: `Active organization profile set to "${profiles.find(p => p.id === id)?.name}".` });
  };

  const handleCreateTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;

    const newProfile: OrganizeProfile = {
      id: `custom_${Date.now()}`,
      name: newTemplateName.trim(),
      description: newTemplateDesc.trim() || 'Custom user organization profile',
      isBuiltin: false,
      rules: [...(currentProfile?.rules || [])]
    };

    const next = [...profiles, newProfile];
    onUpdateProfiles(next, newProfile.id);
    setSelectedTemplateId(newProfile.id);
    setNewTemplateName('');
    setNewTemplateDesc('');
    setShowNewTemplateModal(false);
    setStatusMessage({ type: 'success', text: `Created new profile "${newProfile.name}".` });
  };

  const handleDeleteTemplate = (id: string) => {
    const toDelete = profiles.find(p => p.id === id);
    if (toDelete?.isBuiltin) {
      alert('Built-in system profiles cannot be deleted.');
      return;
    }
    const confirmDelete = window.confirm(`Delete profile "${toDelete?.name}"?`);
    if (!confirmDelete) return;

    const next = profiles.filter(p => p.id !== id);
    const nextActive = activeProfileId === id ? next[0].id : activeProfileId;
    onUpdateProfiles(next, nextActive);
    setSelectedTemplateId(next[0].id);
    setStatusMessage({ type: 'success', text: `Deleted profile "${toDelete?.name}".` });
  };

  const handleToggleRule = (ruleId: string) => {
    const nextRules = currentProfile.rules.map(r => r.id === ruleId ? { ...r, enabled: !r.enabled } : r);
    const nextProfiles = profiles.map(p => p.id === currentProfile.id ? { ...p, rules: nextRules } : p);
    onUpdateProfiles(nextProfiles, activeProfileId);
  };

  const handleDeleteRule = (ruleId: string) => {
    const nextRules = currentProfile.rules.filter(r => r.id !== ruleId);
    const nextProfiles = profiles.map(p => p.id === currentProfile.id ? { ...p, rules: nextRules } : p);
    onUpdateProfiles(nextProfiles, activeProfileId);
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName || !rulePattern || !ruleTarget) {
      setStatusMessage({ type: 'error', text: 'Please fill out all rule fields.' });
      return;
    }

    const newRule: OrganizeRule = {
      id: `rule_${Date.now()}`,
      name: ruleName.trim(),
      type: ruleType,
      pattern: rulePattern.trim(),
      targetFolder: ruleTarget.trim(),
      enabled: true
    };

    const nextRules = [newRule, ...currentProfile.rules];
    const nextProfiles = profiles.map(p => p.id === currentProfile.id ? { ...p, rules: nextRules } : p);
    onUpdateProfiles(nextProfiles, activeProfileId);

    setRuleName('');
    setRulePattern('');
    setRuleTarget('');
    setShowAddRule(false);
    setStatusMessage({ type: 'success', text: `Added rule to "${currentProfile.name}".` });
  };

  const toolbarBg = isDarkMode ? 'bg-[#1e1e1e] border-[#2d2d2d]' : 'bg-[#f8fafc] border-slate-300';
  const paneBg = isDarkMode ? 'bg-[#141414]' : 'bg-white';
  const sidePaneBg = isDarkMode ? 'bg-[#1a1a1a] border-[#2d2d2d]' : 'bg-[#f8fafc] border-slate-300';
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
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span className={`text-xs font-semibold ${textHead}`}>
            Routing Rules & Profiles
          </span>
          <span className={`text-xs ${textMuted}`}>
            — Configure file extensions and filename patterns for automatic folder classification
          </span>
        </div>

        <button
          onClick={() => setShowNewTemplateModal(true)}
          className="h-7 px-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-[4px] text-xs transition-colors flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          New Profile
        </button>
      </div>

      {/* Inline Status Notification Strip */}
      {statusMessage && (
        <div className={`h-7 px-3 border-b flex items-center justify-between text-xs shrink-0 ${
          statusMessage.type === 'success'
            ? isDarkMode ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : isDarkMode ? 'bg-rose-950/40 border-rose-800/50 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <div className="flex items-center gap-2 truncate">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
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

      {/* Split Master-Detail Workspace */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Pane: Profiles List */}
        <div className={`w-64 border-r flex flex-col shrink-0 overflow-hidden ${sidePaneBg}`}>
          <div className={`px-3 py-2 border-b text-[11px] font-semibold uppercase tracking-wider ${borderCol} ${textMuted}`}>
            Profiles ({profiles.length})
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-200/70 dark:divide-[#262626]">
            {profiles.map(p => {
              const isSelected = p.id === currentProfile.id;
              const isActive = p.id === activeProfileId;

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedTemplateId(p.id)}
                  className={`p-2.5 cursor-pointer transition-colors relative ${
                    isSelected
                      ? isDarkMode
                        ? 'bg-[#252526] text-white'
                        : 'bg-white text-slate-900'
                      : isDarkMode
                        ? 'hover:bg-[#202020] text-zinc-300'
                        : 'hover:bg-slate-200/50 text-slate-700'
                  }`}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-xs truncate">{p.name}</span>
                    {isActive ? (
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[3px] font-medium border shrink-0 ${
                        isDarkMode
                          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        <Check className="h-2.5 w-2.5" />
                        Active
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetActive(p.id);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded-[3px] border shrink-0 transition-colors ${
                          isDarkMode
                            ? 'bg-[#1e1e1e] hover:bg-[#2d2d2d] text-zinc-300 border-[#383838]'
                            : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        Activate
                      </button>
                    )}
                  </div>
                  <p className={`text-[11px] mt-1 line-clamp-1 ${textMuted}`}>
                    {p.description}
                  </p>
                  <div className={`mt-1.5 flex items-center justify-between text-[11px] tabular-nums ${textMuted}`}>
                    <span>{p.rules.length} rules</span>
                    {!p.isBuiltin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTemplate(p.id);
                        }}
                        className="text-slate-400 hover:text-rose-500"
                        title="Delete custom profile"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Pane: Rules Table for Selected Profile */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Selected Profile Subheader */}
          <div className={`h-9 px-3 border-b flex items-center justify-between shrink-0 ${
            isDarkMode ? 'bg-[#181818] border-[#2d2d2d]' : 'bg-[#f1f5f9] border-slate-300'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`font-semibold text-xs ${textHead}`}>{currentProfile.name}</span>
              <span className={`text-xs truncate ${textMuted}`}>— {currentProfile.description}</span>
            </div>

            <button
              onClick={() => setShowAddRule(!showAddRule)}
              className={`h-6 px-2.5 border rounded-[3px] text-[11px] font-medium transition-colors flex items-center gap-1 shrink-0 ${
                isDarkMode 
                  ? 'bg-[#252526] hover:bg-[#2d2d2d] text-zinc-200 border-[#383838]' 
                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
              }`}
            >
              <Plus className="h-3 w-3" />
              Add Rule
            </button>
          </div>

          {/* Add Rule Inline Bar */}
          {showAddRule && (
            <form onSubmit={handleAddRule} className={`p-2.5 border-b text-xs space-y-2 shrink-0 ${
              isDarkMode ? 'bg-[#1e1e1e] border-[#2d2d2d]' : 'bg-slate-100 border-slate-300'
            }`}>
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  placeholder="Rule Name (e.g. Raw Photos)"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className={`h-7 border rounded-[4px] px-2 text-xs focus:outline-none ${inputBg}`}
                />
                <select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as 'extension' | 'regex')}
                  className={`h-7 border rounded-[4px] px-2 text-xs focus:outline-none ${inputBg}`}
                >
                  <option value="extension">File Extensions (.ext)</option>
                  <option value="regex">Filename Regex</option>
                </select>
                <input
                  type="text"
                  placeholder="Pattern (.cr2, .nef or invoice|receipt)"
                  value={rulePattern}
                  onChange={(e) => setRulePattern(e.target.value)}
                  className={`h-7 border rounded-[4px] px-2 text-xs font-mono focus:outline-none ${inputBg}`}
                />
                <input
                  type="text"
                  placeholder="Destination Folder (e.g. Photos\RAW)"
                  value={ruleTarget}
                  onChange={(e) => setRuleTarget(e.target.value)}
                  className={`h-7 border rounded-[4px] px-2 text-xs focus:outline-none ${inputBg}`}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddRule(false)}
                  className={`h-6 px-2.5 text-xs ${textMuted} hover:underline`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-6 px-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-[3px] text-xs"
                >
                  Save Rule
                </button>
              </div>
            </form>
          )}

          {/* High-Density Rules Table */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className={`sticky top-0 z-10 border-b select-none ${
                isDarkMode ? 'bg-[#1e1e1e] border-[#2d2d2d] text-zinc-400' : 'bg-[#f8fafc] border-slate-300 text-slate-600'
              }`}>
                <tr>
                  <th className={`py-1.5 px-2.5 w-10 text-center font-medium border-r ${borderCol}`}>On</th>
                  <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol} w-44`}>Rule Name</th>
                  <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol} w-24`}>Match Type</th>
                  <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol}`}>Match Pattern</th>
                  <th className={`py-1.5 px-2.5 font-medium border-r ${borderCol} w-48`}>Target Folder</th>
                  <th className="py-1.5 px-2.5 w-10 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className={`divide-y ${
                isDarkMode ? 'divide-[#222222] text-zinc-300' : 'divide-slate-200/70 text-slate-800'
              }`}>
                {currentProfile.rules.map(rule => (
                  <tr key={rule.id} className={`transition-colors ${
                    isDarkMode ? 'hover:bg-[#252526]' : 'hover:bg-blue-50/50'
                  } ${!rule.enabled ? 'opacity-45' : ''}`}>
                    <td className="py-1 px-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule.id)}
                        className="h-3.5 w-3.5 rounded-[3px] border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                    </td>
                    <td className={`py-1 px-2.5 font-medium ${textHead}`}>{rule.name}</td>
                    <td className="py-1 px-2.5">
                      <span className={`px-1.5 py-0.5 rounded-[3px] text-[10px] font-medium border ${
                        isDarkMode ? 'bg-[#252526] text-zinc-400 border-[#383838]' : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        {rule.type}
                      </span>
                    </td>
                    <td className="py-1 px-2.5">
                      <code className={`font-mono text-[11px] break-all ${
                        isDarkMode ? 'text-zinc-300' : 'text-slate-700'
                      }`}>
                        {rule.pattern}
                      </code>
                    </td>
                    <td className="py-1 px-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        <Folder className="h-3 w-3 text-amber-500 shrink-0" />
                        {rule.targetFolder}
                      </span>
                    </td>
                    <td className="py-1 px-2.5 text-center">
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-slate-400 hover:text-rose-500"
                        title="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Native-Style Modal for New Profile */}
      {showNewTemplateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateTemplate} className={`border rounded-[6px] p-4 max-w-sm w-full text-xs space-y-3 shadow-xl ${
            isDarkMode ? 'bg-[#1e1e1e] border-[#383838]' : 'bg-white border-slate-300'
          }`}>
            <h3 className={`text-sm font-semibold ${textHead}`}>New Organization Profile</h3>
            <div>
              <label className={`block mb-1 text-[11px] font-medium ${textMuted}`}>Profile Name</label>
              <input
                type="text"
                placeholder="e.g. Photography Studio"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className={`w-full h-7 border rounded-[4px] px-2.5 text-xs focus:outline-none ${inputBg}`}
              />
            </div>
            <div>
              <label className={`block mb-1 text-[11px] font-medium ${textMuted}`}>Description</label>
              <input
                type="text"
                placeholder="Brief summary of this profile..."
                value={newTemplateDesc}
                onChange={(e) => setNewTemplateDesc(e.target.value)}
                className={`w-full h-7 border rounded-[4px] px-2.5 text-xs focus:outline-none ${inputBg}`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewTemplateModal(false)}
                className={`h-7 px-3 rounded-[4px] border text-xs ${
                  isDarkMode ? 'border-[#383838] text-zinc-300 hover:bg-[#2d2d2d]' : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-7 px-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-[4px] text-xs"
              >
                Create Profile
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
