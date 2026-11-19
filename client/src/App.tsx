import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff, X } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { AdminView } from './components/AdminView';
import { AuthScreen } from './components/AuthScreen';
import { CallOverlay } from './components/CallOverlay';
import { ChatView } from './components/ChatView';
import { FilesView } from './components/FilesView';
import { GalleryView } from './components/GalleryView';
import { MediaLightbox } from './components/MediaLightbox';
import { ForwardModal, GroupSettingsModal, NewDmModal, NewGroupModal, SearchModal } from './components/Modals';
import { RightSidebar } from './components/RightSidebar';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TasksView } from './components/TasksView';
import { WorkspaceView } from './components/WorkspaceView';

export default function App() {
  const {
    booting,
    me,
    isAdmin,
    connection,
    activeView,
    toasts,
    boot,
    dismissToast,
    setSearchModalOpen,
  } = useAppStore();

  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);

  useEffect(() => {
    boot();
  }, []);

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPwaPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Global keyboard shortcut: Ctrl+K / Cmd+K for quick search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (useAppStore.getState().me) setSearchModalOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleInstallPwa() {
    if (!pwaPrompt) return;
    pwaPrompt.prompt();
    await pwaPrompt.userChoice.catch(() => {});
    setPwaPrompt(null);
  }

  if (booting) {
    return (
      <div className="h-screen w-screen bg-[#101114] flex flex-col items-center justify-center gap-3 text-[#9296A3]">
        <img src="/icon.svg" alt="LOCAL HUB" className="w-12 h-12 animate-pulse" />
        <div className="text-xs tracking-wide">Connecting to LOCAL HUB...</div>
      </div>
    );
  }

  if (!me) {
    return (
      <>
        <AuthScreen />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#101114] text-[#F5F5F7] overflow-hidden">
      {/* Reconnection banner */}
      {connection === 'reconnecting' && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-xs px-4 py-1.5 flex items-center justify-center gap-2 shrink-0">
          <WifiOff className="w-3.5 h-3.5 animate-pulse" />
          Connection to host lost — automatically reconnecting to LAN server...
        </div>
      )}

      {/* Main 3-column desktop workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar onNewDm={() => setNewDmOpen(true)} onNewGroup={() => setNewGroupOpen(true)} />

        <main className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
          {activeView === 'chat' && <ChatView onOpenGroupSettings={() => setGroupSettingsOpen(true)} />}
          {activeView === 'workspace' && <WorkspaceView />}
          {activeView === 'files' && <FilesView />}
          {activeView === 'gallery' && <GalleryView />}
          {activeView === 'tasks' && <TasksView />}
          {activeView === 'admin' && isAdmin && <AdminView />}
          {activeView === 'settings' && (
            <SettingsView pwaPrompt={pwaPrompt} onInstallPwa={handleInstallPwa} />
          )}
        </main>

        <RightSidebar />
      </div>

      {/* Overlays & Modals */}
      <MediaLightbox />
      <CallOverlay />
      <ForwardModal />
      <SearchModal />
      {newDmOpen && <NewDmModal onClose={() => setNewDmOpen(false)} />}
      {newGroupOpen && <NewGroupModal onClose={() => setNewGroupOpen(false)} />}
      {groupSettingsOpen && <GroupSettingsModal onClose={() => setGroupSettingsOpen(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Array<{ id: string; message: string; tone: 'info' | 'success' | 'error' }>;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-medium shadow-2xl border backdrop-blur ${
              t.tone === 'error'
                ? 'bg-rose-950/90 border-rose-500/40 text-rose-100'
                : t.tone === 'success'
                  ? 'bg-[#122622]/95 border-[#21C7A8]/40 text-[#D4FFF5]'
                  : 'bg-[#20232B]/95 border-white/15 text-[#F5F5F7]'
            }`}
          >
            <span>{t.message}</span>
            <button onClick={() => onDismiss(t.id)} className="opacity-70 hover:opacity-100 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

