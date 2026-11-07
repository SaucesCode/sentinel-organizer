# Sentinel Organizer (`sentinel-fs`)

A native desktop file organizer and SHA-256 duplicate finder built with **Electron**, **React**, **TypeScript**, and **Tailwind CSS**. Sentinel helps you organize cluttered folders (like `Downloads`, `Desktop`, or project directories) into clean, predictable folder structures with full undo capability.

---

## Key Features

- **Flexible Folder Structure Strategies**
  - **Category Only:** `Documents/`, `Images/`, `Archives/`, etc.
  - **Category + Month (`YYYY-MM - Month`):** `Documents/2026-11 - November/`
  - **Category + Month (`Month YYYY`):** `Documents/November 2026/`
  - **Category + Date (`YYYY-MM-DD`):** `Documents/2026-11-06/`
  - **Date Only (`YYYY-MM - Month`, `Month YYYY`, `YYYY-MM`, `YYYY-MM-DD`, or `YYYY-QN`):** Group strictly by when files were created or modified so you can find files by memory of when you downloaded or worked on them.
- **Smart Project & Application Folder Protection**
  - Automatically detects and shields intact coding projects (`package.json`, `.git`, `pyproject.toml`, `.sln`, `Cargo.toml`, virtualenvs, `node_modules`, etc.), games, and unpacked portable apps (`.exe` + runtime files) so Sentinel never rips internal project files apart—plus support for pinning custom excluded folders.
- **Accurate Date Source Modes**
  - Choose between **Downloaded / Created** (Windows `birthtime`, default so older files downloaded today go into *this* month's folder), **Smart (Filename → Created)** (parses `YYYY-MM-DD` / `YYYYMMDD` dates from screenshots, invoices, and camera filenames), or **Date Modified**.
- **1-Click Quick Access & Explorer Workflow**
  - Jump straight to `Downloads`, `Desktop`, `Documents`, `Pictures`, or **Recent Folders** from the sidebar, sort preview columns (`Name`, `Status`, `Current Folder`, `Target Folder`, `Date`, `Size`), and right-click or click any row to reveal it in Windows File Explorer.
- **Re-Organize Subfolders & Auto-Clean Empty Folders**
  - Toggle **Re-organize Subfolders** to switch between Category-based and Date-based folder layouts at any time; leftover empty folders are automatically pruned after organizing or undoing.
- **2-Phase SHA-256 Duplicate Finder**
  - **Phase 1:** Rapidly groups files by exact byte size, eliminating 99% of non-duplicates without disk-heavy hashing.
  - **Phase 2:** Computes cryptographic `SHA-256` hashes only for size-matched candidates, allowing safe quarantine of redundant copies with 1-click restoration.
- **Complete Audit History & Instant Undo**
  - Every file move is logged in a local transaction ledger. Restore a **single file** via universal search or revert an **entire batch session** back to its original paths.
- **Customizable Routing Profiles & Background Auto-Watch**
  - Switch between built-in profiles (*General Purpose*, *Software Developer*, *Media & Creative Studio*, *Business & Finance*, *Desktop Declutter*), create custom rules, or watch a folder in real time.
- **100% Offline & Hardened Safety Guarantees**
  - Runs 100% offline in packaged builds (`asar: true`, Electron `sandbox: true`, strict CSP, zero outbound network connections).
  - Blocks symlinks/NTFS junctions, UNC network paths, path traversal, and OS/application directories, and never overwrites or executes user files.

---

## Tech Stack

- **Desktop Runtime:** Electron 33 (Main + Preload IPC bridge with `contextIsolation`)
- **Frontend:** React 18, TypeScript, Tailwind CSS, Lucide Icons
- **Build Tooling:** Vite 5, `electron-builder`

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and **npm**

### Installation

```bash
git clone https://github.com/SaucesCode/sentinel-organizer.git
cd sentinel-organizer
npm install
```

### Run in Development Mode

Starts the Vite dev server and launches the native Electron desktop window:

```bash
npm start
```

### Build for Production

Compile TypeScript, bundle the frontend with Vite, and package the Windows desktop executable:

```bash
npm run build
npm run dist
```

---

## Project Structure

```text
sentinel-organizer/
├── electron/
│   ├── main.cjs          # Electron main process, filesystem engine, SHA-256 scanner & undo ledger
│   └── preload.cjs       # Context-isolated IPC bridge (window.sentinelAPI)
├── scripts/
│   └── start-app.mjs     # Dev runner orchestrating Vite + Electron
├── src/
│   ├── components/
│   │   ├── OrganizeView.tsx         # File Explorer workspace & live preview table
│   │   ├── DuplicateHunterView.tsx  # 2-phase SHA-256 duplicate scanner & quarantine manager
│   │   ├── AuditLedgerView.tsx      # Universal file search, history log & single/batch undo
│   │   ├── ProfileTemplatesView.tsx # Custom & preset routing profiles and rules
│   │   ├── Sidebar.tsx              # Native navigation rail & profile switcher
│   │   └── StatusBar.tsx            # Bottom desktop status bar
│   ├── App.tsx           # Native window titlebar, breadcrumbs & split-pane shell
│   ├── types.ts          # TypeScript interfaces for IPC & state
│   └── index.css         # System typography, scrollbars & drag-region styles
└── package.json
```

---

## License

MIT
