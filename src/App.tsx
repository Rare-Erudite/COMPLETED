import React, { useState, useEffect, useRef } from 'react';
import {
  Activity,
  Terminal,
  Hammer,
  FileText,
  Compass,
  Mic,
  MicOff,
  Sliders,
  Settings as SettingsIcon,
  ShieldCheck,
  RotateCcw,
  Plus,
  Send,
  Volume2,
  VolumeX,
  Search,
  CheckCircle2,
  Sparkles,
  Laptop,
  Trash2,
  Save,
  Copy,
  Share2,
  BrainCircuit,
  Lock,
  Unlock,
  Download,
  Package,
  Wrench,
  Check,
  FileAudio,
  Users,
  MessageSquare,
  ArrowRight,
  Eye,
  Play,
  FileCode,
  Shield,
  Layers,
  KeyRound,
  LogOut,
  ChevronRight,
  Info,
  Menu,
  X,
  SquarePen,
  Paperclip,
  PhoneCall,
  PhoneOff,
  Monitor,
  Smartphone,
  Globe,
  MoreVertical,
  Image as ImageIcon,
  Clock,
  Puzzle,
  SlidersHorizontal,
  Edit2,
  Cpu,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  AlertTriangle,
  Camera
} from 'lucide-react';
import { themes, ThemeKey, ThemeConfig } from './theme';

import {
  safeFetch,
  safePost,
  isStandaloneMobileApp,
  getStoredSessionToken,
  storeUserSessionToken,
  clearUserSession,
  validateCurrentUserSession,
  subscribeConnectionState,
  getBackendUrl,
  getDefaultBackendUrl,
  normalizeBackendUrl,
  setBackendUrl,
  testBackendConnection,
  BackendConnectionState
} from './api';

import { ImageStudioWorkspaceView } from './ImageStudioWorkspaceView';
import { DownloadAppModal } from './DownloadAppModal';
import { UpdateModal, AppUpdate } from './UpdateModal';
import { DeveloperAuthModal } from './DeveloperAuthModal';
import { AuthModal, UserAccount, getUserInitials } from './AuthModal';
import { ShareChatModal } from './ShareChatModal';
import {
  HUMAN_VOICE_PERSONAS,
  VoicePersona,
  speakWithHumanVoice,
  stopHumanVoice,
  generateNaturalCallGreeting,
  generateDynamicBrainReply,
} from './engine/standalone-brain';

// Types
export type AgentRole =
  | 'coordinator'
  | 'architect'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'test'
  | 'security'
  | 'repair'
  | 'release';

export type AgentStatus =
  | 'initializing'
  | 'ready'
  | 'working'
  | 'waiting'
  | 'communicating'
  | 'reviewing'
  | 'repairing'
  | 'validating'
  | 'completed'
  | 'failed';

export interface AgentMember {
  id: string;
  name: string;
  role: AgentRole;
  title: string;
  avatarColor: string;
  status: AgentStatus;
  currentTask: string;
  completedTasks: string[];
  lastAction: string;
  progressPercent: number;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  fromRole: AgentRole;
  fromName: string;
  toAgentId?: string;
  toRole?: AgentRole;
  toName?: string;
  type: string;
  subject: string;
  content: string;
  artifactRef?: string;
  timestamp: string;
}

export interface MultiAgentTeamRun {
  id: string;
  title: string;
  targetDomain: string;
  objective: string;
  status: 'planning' | 'coordinating' | 'executing' | 'validating' | 'completed' | 'failed';
  currentStage: string;
  userProgressMessage: string;
  coordinator: AgentMember;
  agents: AgentMember[];
  messages: AgentMessage[];
  events: Array<{
    id: string;
    time: string;
    agentId: string;
    agentName: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
    toolCalled?: string;
    fileAffected?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  checkpointId?: string;
  artifacts: Array<{ name: string; type: string; size: string; path: string }>;
  metrics: {
    durationSeconds: number;
    tasksTotal: number;
    tasksCompleted: number;
    handoffsCount: number;
    repairsCount: number;
  };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  thought?: string;
  actionDetected?: {
    type: 'project_build' | 'document_work' | 'schedule_create' | 'image_create' | 'memory_stored';
    data?: any;
    summary?: string;
  };
}

export interface ScheduledTask {
  id: string;
  title: string;
  time: string;
  type: 'alarm' | 'recurring' | 'reminder' | 'automation';
  action: string;
  enabled: boolean;
  repeat: string;
  created_at: string;
}

export interface PluginDef {
  id: string;
  name: string;
  category: 'build' | 'dev' | 'tools' | 'media' | 'data' | 'system';
  description: string;
  version: string;
  author: string;
  installed: boolean;
  icon: string;
  capabilities: string[];
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  userId?: string;
  messageCount?: number;
  messages?: ChatMessage[];
  customTitle?: boolean;
  matchedSnippet?: string;
}

interface ResearchItem {
  id: string;
  query: string;
  subquestions: string[];
  findings: string;
  sources: Array<{ name: string; url: string; credibility: number; date: string; quote: string }>;
  synthesis: string;
  confidence: number;
  timestamp: string;
}

const LOCAL_CONVS_KEY = 'rare_standalone_conversations_v1';
const LOCAL_MEMORIES_KEY = 'rare_standalone_memories_v1';

function loadLocalConversationsStore(): Record<string, Conversation> {
  try {
    const raw = localStorage.getItem(LOCAL_CONVS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

function saveLocalConversationsStore(store: Record<string, Conversation>) {
  try {
    localStorage.setItem(LOCAL_CONVS_KEY, JSON.stringify(store));
  } catch {}
}

function loadLocalMemories(): Array<{ topic: string; content: string; timestamp: string }> {
  try {
    const raw = localStorage.getItem(LOCAL_MEMORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [
    {
      topic: 'Custom Footwear Design',
      content: 'Discussed custom shoes: Matte obsidian black sneakers with electric cobalt blue accents, breathable mesh upper, and carbon-fiber cushioned sole.',
      timestamp: new Date().toISOString(),
    },
  ];
}

function saveLocalMemory(topic: string, content: string) {
  try {
    const list = loadLocalMemories();
    list.unshift({ topic, content, timestamp: new Date().toISOString() });
    localStorage.setItem(LOCAL_MEMORIES_KEY, JSON.stringify(list.slice(0, 60)));
  } catch {}
}

async function generateStandaloneCognitiveReply(
  userQuery: string,
  assistantName: string,
  personaMode: string,
  thinkHarder: boolean,
  recentMessages: ChatMessage[] = []
): Promise<{ content: string; thought?: string }> {
  return generateDynamicBrainReply({
    prompt: userQuery,
    assistantName,
    personaMode,
    thinkHarder,
    recentMessages: recentMessages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('chat');
  const [health, setHealth] = useState<any>(null);
  const [assistantName, setAssistantName] = useState('RARE');
  const [autonomyLevel, setAutonomyLevel] = useState(2);
  const [thinkHarder, setThinkHarder] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  // Conversations, search, and session state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [liveVoiceModalOpen, setLiveVoiceModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Theme selection with local persistence (Default is 'blue')
  const [currentThemeKey, setCurrentThemeKey] = useState<ThemeKey>(() => {
    const saved = localStorage.getItem('rare_theme_key');
    if (saved && ['blue', 'white', 'dark', 'red', 'green', 'yellow'].includes(saved)) {
      return saved as ThemeKey;
    }
    return 'blue';
  });

  const t: ThemeConfig = themes[currentThemeKey] || themes.blue;

  // Developer passkey gate state
  const [isDeveloperAuthed, setIsDeveloperAuthed] = useState(false);
  const [showDevModal, setShowDevModal] = useState(false);
  const [openDevSpaceDirectly, setOpenDevSpaceDirectly] = useState(false);

  // User Account & Authentication Modal state (Sign In / Sign Up)
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'default' | 'google' | 'outlook' | 'switch'>('default');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
    const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = localStorage.getItem('rare_user_account');

      if (!saved || !getStoredSessionToken()) {
        localStorage.removeItem('rare_user_account');
        return null;
      }

      return JSON.parse(saved);
    } catch {
      return null;
    }
  });
  const [sessionGeneration, setSessionGeneration] = useState(0);

  // Full Conversation Share Modal state
  const [shareModalData, setShareModalData] = useState<{ id: string; title: string; messages?: ChatMessage[] } | null>(null);

  // Download & Dual-Channel OTA Update state
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null);
  const [clientVersion, setClientVersion] = useState<string>(() => {
    return localStorage.getItem('rare_client_version') || '1.0.0';
  });

  const [connectionStatus, setConnectionStatus] = useState<BackendConnectionState>({
    reachable: false,
    lastChecked: 0,
    configuredUrl: '',
  });

  useEffect(() => {
    return subscribeConnectionState((state) => {
      setConnectionStatus(state);
    });
  }, []);

useEffect(() => {
  let cancelled = false;

  const validateSavedSession = async () => {
    if (!getStoredSessionToken()) {
      return;
    }

    const result = await validateCurrentUserSession();

    // A network/server failure is not proof that the session is invalid.
    if (cancelled || !result) {
      return;
    }

    if (!result.authenticated) {
      await clearUserSession();

      if (cancelled) {
        return;
      }

      setCurrentUser(null);
      setIsDeveloperAuthed(false);
      localStorage.removeItem('rare_user_account');
      return;
    }

    if (result.user) {
      const user = result.user as UserAccount;

      setCurrentUser(user);
      localStorage.setItem('rare_user_account', JSON.stringify(user));

      if (user.role === 'developer') {
        setIsDeveloperAuthed(true);
      } else {
        setIsDeveloperAuthed(false);
      }
    } else {
      // A valid guest session is not a signed-in account.
      setCurrentUser(null);
      setIsDeveloperAuthed(false);
      localStorage.removeItem('rare_user_account');
    }
  };

  void validateSavedSession();

  return () => {
    cancelled = true;
  };
}, []);

useEffect(() => {
  const callback = async () => {
    const callbackUrl = new URL(window.location.href);
    const code = callbackUrl.searchParams.get('code');
    const state = callbackUrl.searchParams.get('state');
    const providerError = callbackUrl.searchParams.get('error');
    if (!code && !providerError) return;

    let transaction: { verifier?: string; nonce?: string; state?: string; redirectUri?: string } | null = null;
    try {
      transaction = JSON.parse(sessionStorage.getItem('rare_microsoft_oauth_transaction') || 'null');
    } catch { /* Invalid local OAuth transaction is rejected below. */ }
    sessionStorage.removeItem('rare_microsoft_oauth_transaction');
    window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.hash}`);

    if (providerError || !code || !transaction?.verifier || !transaction.nonce || !transaction.state || !transaction.redirectUri || state !== transaction.state) {
      sessionStorage.setItem('rare_oauth_error', providerError ? 'Microsoft sign-in was cancelled or rejected.' : 'Microsoft sign-in could not be verified. Start the sign-in again.');
      setAuthModalMode('outlook');
      setAuthModalOpen(true);
      return;
    }

    try {
      const response = await safePost<{ success: boolean; user?: UserAccount; error?: string }>('/api/user/oauth', {
        provider: 'outlook',
        code,
        codeVerifier: transaction.verifier,
        nonce: transaction.nonce,
        redirectUri: transaction.redirectUri,
      });
      if (!response?.success || !response.user) throw new Error('Microsoft could not verify the sign-in. Check the OAuth application configuration and try again.');
      setCurrentUser(response.user);
      localStorage.setItem('rare_user_account', JSON.stringify(response.user));
      setIsDeveloperAuthed(response.user.role === 'developer');
      setAuthModalOpen(false);
    } catch {
      sessionStorage.setItem('rare_oauth_error', 'Microsoft sign-in could not be completed. Check the OAuth application and redirect URI configuration.');
      setAuthModalMode('outlook');
      setAuthModalOpen(true);
    }
  };
  void callback();
}, []);

  const checkForUpdates = async (forceOpenModal = false) => {
    const channel = isDeveloperAuthed ? 'developer' : 'public';
    const data = await safeFetch<any>(`/api/updates/check?clientVersion=${clientVersion}&channel=${channel}`);
    if (data && data.hasUpdate && data.update) {
      setAvailableUpdate(data.update);
      const dismissed = sessionStorage.getItem('rare_dismissed_update');
      if (forceOpenModal || dismissed !== data.update.id) {
        setUpdateModalOpen(true);
      }
    } else {
      setAvailableUpdate(null);
    }
    return data;
  };

  const handleApplyUpdate = (newVersion: string) => {
    setClientVersion(newVersion);
    localStorage.setItem('rare_client_version', newVersion);
    setAvailableUpdate(null);
  };

  const fetchHealthAndSettings = async () => {
    const [hData, sData] = await Promise.all([
      safeFetch<any>('/api/health'),
      safeFetch<any>('/api/settings'),
    ]);
    if (hData) {
      setHealth(hData);
      if (hData.assistant_name) setAssistantName(hData.assistant_name);
      if (hData.autonomy) setAutonomyLevel(hData.autonomy);
    }
    if (sData && sData.developer_authenticated !== undefined) {
      setIsDeveloperAuthed(sData.developer_authenticated);
    }
  };

  const loadConversations = async (search?: string, userToQuery = currentUser) => {
    const q = search !== undefined ? search : chatSearchQuery;
    const userKey = userToQuery?.email || userToQuery?.phone || 'guest';
    const params = new URLSearchParams();
    if (q && q.trim()) params.set('search', q.trim());
    params.set('userId', userKey);

    const url = `/api/conversations?${params.toString()}`;
    const data = await safeFetch<Conversation[]>(url);
    const localStore = loadLocalConversationsStore();

    if (data && data.length > 0) {
      // Sync server conversations into local store
      data.forEach((c) => {
        localStore[c.id] = { ...(localStore[c.id] || {}), ...c };
      });
      saveLocalConversationsStore(localStore);
      setConversations(data);
      if (!activeConvId || !data.some((c) => c.id === activeConvId)) {
        setActiveConvId(data[0].id);
      }
      return data;
    }

    // Browser accounts must not fall back to a shared device cache when an
    // online request is unavailable or returns an empty private collection.
    if (!isStandaloneMobileApp()) {
      setConversations([]);
      return [];
    }
    // Standalone mode intentionally keeps conversations on the device.
    let localList = Object.values(localStore).filter(
      (c) => c.userId === userKey || (!c.userId && userKey === 'guest')
    );
    if (q && q.trim()) {
      const lq = q.trim().toLowerCase();
      localList = localList.filter(
        (c) =>
          c.title.toLowerCase().includes(lq) ||
          (c.messages && c.messages.some((m) => m.content.toLowerCase().includes(lq)))
      );
    }
    localList.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (localList.length > 0) {
      setConversations(localList);
      if (!activeConvId || !localList.some((c) => c.id === activeConvId)) {
        setActiveConvId(localList[0].id);
      }
      return localList;
    }
    return [];
  };

  // Clear in-memory chat state before loading another account's private chats.
  useEffect(() => {
    setConversations([]);
    setActiveConvId('');
    loadConversations('', currentUser);
  }, [currentUser?.id]);

  // Fresh initial startup
  useEffect(() => {
    const init = async () => {
      fetchHealthAndSettings();
      checkForUpdates(false);
      const existing = await loadConversations('', currentUser);
      if (!existing || existing.length === 0) {
        const userKey = currentUser?.email || currentUser?.phone || 'guest';
        const fallbackId = `conv_${Date.now()}`;
        const fallbackChat: Conversation = {
          id: fallbackId,
          title: 'New Chat',
          userId: userKey,
          created_at: new Date().toISOString(),
          messages: [
            {
              id: `msg_${Date.now()}`,
              role: 'assistant',
              content: `Hello! I am ${assistantName} — your personal AI companion and software builder.\n\nWhat would you like to explore today?\n• Chat casually about any topic — my permanent memory retains everything we discuss\n• Type to build a project (APK, EXE, or Web bundle)\n• Schedule an alarm, reminder, or recurring automation\n• Generate or edit high-fidelity images`,
              timestamp: new Date().toISOString(),
            },
          ],
        };
        const newChat = (await safePost<Conversation>('/api/conversations', {
          id: fallbackId,
          title: 'New Chat',
          userId: userKey,
        })) || fallbackChat;

        const store = loadLocalConversationsStore();
        store[newChat.id] = newChat;
        saveLocalConversationsStore(store);

        setConversations([newChat]);
        setActiveConvId(newChat.id);
      } else {
        setActiveConvId(existing[0].id);
      }
    };
    init();

    const interval = setInterval(fetchHealthAndSettings, 10000);
    return () => clearInterval(interval);
  }, []);

  // Live search debounced query
  useEffect(() => {
    const timer = setTimeout(() => {
      loadConversations(chatSearchQuery);
    }, 180);
    return () => clearTimeout(timer);
  }, [chatSearchQuery]);

  const changeTheme = async (newKey: ThemeKey) => {
    setCurrentThemeKey(newKey);
    localStorage.setItem('rare_theme_key', newKey);
    await safePost('/api/settings', { theme: newKey });
  };

  const handleNewChat = async () => {
    const userKey = currentUser?.email || currentUser?.phone || 'guest';
    const clientConvId = `conv_${Date.now()}`;
    const initialConv: Conversation = {
      id: clientConvId,
      title: 'New Chat',
      userId: userKey,
      created_at: new Date().toISOString(),
      messages: [
        {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: `Hello! I am ${assistantName} — your personal AI companion and software builder.\n\nWhat would you like to explore today?\n• Chat casually about any topic — my permanent memory retains everything we discuss\n• Type to build a project (APK, EXE, or Web bundle)\n• Schedule an alarm, reminder, or recurring automation\n• Generate or edit high-fidelity images`,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const store = loadLocalConversationsStore();
    store[clientConvId] = initialConv;
    saveLocalConversationsStore(store);

    // Immediate optimistic state update — makes the New Chat button 100% responsive and instantaneous
    setConversations((prev) => [initialConv, ...prev.filter((c) => c.id !== clientConvId)]);
    setActiveConvId(clientConvId);
    setActiveTab('chat');
    setChatSearchQuery('');
    setSidebarOpen(false);

    try {
      const newChat = await safePost<Conversation>('/api/conversations', {
        id: clientConvId,
        title: 'New Chat',
        userId: userKey,
      });
      if (newChat && newChat.id !== clientConvId) {
        setConversations((prev) => [newChat, ...prev.filter((c) => c.id !== clientConvId && c.id !== newChat.id)]);
        setActiveConvId(newChat.id);
      }
    } catch (e) {
      console.warn('Backend new chat synchronization:', e);
    }
  };

  const handleStartRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingConvId(conv.id);
    setEditingTitleText(conv.title);
  };

  const handleSaveRename = async (id: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editingTitleText.trim();
    if (!trimmed) {
      setEditingConvId(null);
      return;
    }
    const store = loadLocalConversationsStore();
    if (store[id]) {
      store[id] = { ...store[id], title: trimmed, customTitle: true };
      saveLocalConversationsStore(store);
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed, customTitle: true } : c))
    );
    setEditingConvId(null);
    await safePost<any>(`/api/conversations/${id}/rename`, { title: trimmed });
  };

  const handleDeleteChat = async (id: string, e?: React.SyntheticEvent) => {
    if (e) {
      e.stopPropagation();
      if ('preventDefault' in e) e.preventDefault();
    }
    const store = loadLocalConversationsStore();
    delete store[id];
    saveLocalConversationsStore(store);

    try {
      await safeFetch(`/api/conversations/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('Failed to delete chat:', err);
    }
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (activeConvId === id) {
      if (remaining.length > 0) {
        setActiveConvId(remaining[0].id);
      } else {
        handleNewChat();
      }
    }
  };

  // Mobile swipe gestures for opening/closing sidebar
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const endY = e.changedTouches[0]?.clientY ?? touchStartYRef.current;
    const diffX = endX - touchStartXRef.current;
    const diffY = endY - touchStartYRef.current;

    // Detect horizontal swipe
    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      if (diffX > 0 && touchStartXRef.current < 90) {
        // Swiped right from left margin: open sidebar
        setSidebarOpen(true);
      } else if (diffX < -30 && sidebarOpen) {
        // Swiped left while sidebar is open: close sidebar
        setSidebarOpen(false);
      }
    }
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  const workspaceNavItems = [
    { id: 'projects', label: 'Projects', icon: Package, badge: 'APK • EXE • Web' },
    { id: 'scheduled', label: 'Scheduled', icon: Clock, badge: 'Alarms' },
    { id: 'plugins', label: 'Plugins', icon: Puzzle, badge: '8 Installed' },
    { id: 'images', label: 'VisionCraft Studio', icon: ImageIcon, badge: '4K AI' },
  ];

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`flex h-screen w-screen overflow-hidden ${t.bg} ${t.textPrimary} font-sans transition-colors duration-200 relative`}
    >
      {/* Mobile Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden"
        />
      )}

      {/* Responsive Sidebar Navigation Drawer */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 ${t.sidebar} ${t.cardBorder} border-r flex flex-col justify-between select-none shrink-0 transition-transform duration-300 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex-1 flex flex-col min-h-0">
          {/* Logo / Branding Header */}
          <div className={`p-4 border-b ${t.cardBorder} flex items-center justify-between`}>
            <div className="flex items-center space-x-3 cursor-pointer" onClick={() => { setActiveTab('chat'); setSidebarOpen(false); }}>
              <div className={`w-9 h-9 rounded-xl ${t.accentBg} flex items-center justify-center shadow-lg ${t.glow}`}>
                <BrainCircuit className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="font-bold text-base tracking-wider">{assistantName}</span>
                  <span className={`text-[10px] ${t.badgeBg} ${t.badgeText} px-1.5 py-0.5 rounded font-mono font-semibold`}>
                    045
                  </span>
                </div>
                <div className={`text-[11px] ${t.textDim}`}>AI Companion & Builder</div>
              </div>
            </div>

            {/* Mobile Close Button */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white md:hidden"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* New Chat & Search Header */}
          <div className="p-3 space-y-2 border-b border-white/5">
            {/* Prominent New Chat Button */}
            <button
              onClick={handleNewChat}
              className={`w-full py-2.5 px-3 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center justify-center space-x-2 shadow-md transition transform hover:scale-[1.01] active:scale-[0.99]`}
            >
              <SquarePen className="w-4 h-4" />
              <span>New Chat</span>
            </button>

            {/* Search History Input */}
            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-3 top-2.5 ${t.textDim}`} />
              <input
                type="text"
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                placeholder="Search chats & message text..."
                className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl pl-8 pr-7 py-1.5 text-xs placeholder:text-slate-500 focus:outline-none`}
              />
              {chatSearchQuery && (
                <button
                  onClick={() => setChatSearchQuery('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Scrollable Navigation & Chat History List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-4">
            {/* Workspace Features Navigation */}
            <div>
              <div className="px-2 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                Workspace
              </div>
              <div className="space-y-1">
                {workspaceNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setSidebarOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                        isActive
                          ? `${t.accentBg} text-white shadow-sm font-semibold`
                          : `${t.textMuted} hover:${t.textPrimary} hover:${t.cardSub}`
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </div>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                        isActive ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-400'
                      }`}>
                        {item.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Chat History Section */}
            <div>
              <div className="px-2 mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                <span>{chatSearchQuery ? 'Search Results' : 'Chats'}</span>
                <span className="text-[9px]">{conversations.length}</span>
              </div>

              {conversations.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-500">
                  {chatSearchQuery ? `No chats match "${chatSearchQuery}"` : 'No chats yet'}
                </div>
              ) : (
                <div className="space-y-1">
                  {conversations.map((c) => {
                    const isSelected = activeTab === 'chat' && activeConvId === c.id;
                    const isRenaming = editingConvId === c.id;

                    return (
                      <div
                        key={c.id}
                        onClick={() => {
                          setActiveConvId(c.id);
                          setActiveTab('chat');
                          setSidebarOpen(false);
                        }}
                        className={`group relative flex flex-col p-2 rounded-xl text-xs cursor-pointer transition ${
                          isSelected
                            ? `${t.cardSub} ${t.textPrimary} border ${t.cardBorder} shadow-sm font-semibold`
                            : `${t.textMuted} hover:${t.textPrimary} hover:bg-white/5`
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          {isRenaming ? (
                            <form
                              onSubmit={(e) => handleSaveRename(c.id, e)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center space-x-1 w-full"
                            >
                              <input
                                type="text"
                                value={editingTitleText}
                                onChange={(e) => setEditingTitleText(e.target.value)}
                                autoFocus
                                className="w-full bg-slate-900 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                              />
                              <button
                                type="submit"
                                className="p-1 rounded text-emerald-400 hover:text-emerald-300"
                                title="Save"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setEditingConvId(null); }}
                                className="p-1 rounded text-slate-400 hover:text-white"
                                title="Cancel"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </form>
                          ) : (
                            <>
                              <div className="flex items-center space-x-2 truncate pr-2 flex-1">
                                <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isSelected ? t.accentText : 'text-slate-500'}`} />
                                <span className="truncate">{c.title}</span>
                              </div>

                              <div className="flex items-center space-x-1 shrink-0">
                                {c.messageCount !== undefined && (
                                  <span className="text-[10px] text-slate-500 font-mono group-hover:hidden hidden sm:inline">
                                    {c.messageCount}
                                  </span>
                                )}

                                {/* Action Buttons: Always accessible on mobile touch, visible on hover or when selected on desktop */}
                                <div className={`flex items-center space-x-1 ${isSelected ? 'opacity-100' : 'opacity-90 sm:opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShareModalData({ id: c.id, title: c.title, messages: c.messages });
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    className="p-1.5 sm:p-1 rounded text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/15 active:text-indigo-300 active:scale-95 transition"
                                    title="Share Full Chat Sheet"
                                  >
                                    <Share2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartRename(c, e);
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    className="p-1.5 sm:p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition"
                                    title="Rename Chat"
                                  >
                                    <Edit2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteChat(c.id, e);
                                    }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    onTouchEnd={(e) => {
                                      e.stopPropagation();
                                      handleDeleteChat(c.id, e);
                                    }}
                                    className="p-1.5 sm:p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 active:text-rose-300 active:scale-95 transition"
                                    title="Delete Chat"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                  </button>
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Matched snippet text when searching */}
                        {chatSearchQuery && c.matchedSnippet && (
                          <div className="mt-1 text-[10px] text-amber-300/80 bg-amber-500/10 px-2 py-1 rounded line-clamp-2 font-mono">
                            "{c.matchedSnippet}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Lower Part of Sidebar: Account Profile + Settings pushed down */}
        <div className={`p-3 border-t ${t.cardBorder} ${t.cardSub} space-y-2 relative`}>
          {/* User Account Initials Badge & Profile Row near Settings */}
          {currentUser ? (
            <div className="relative">
              <button
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                className={`w-full flex items-center justify-between p-2 rounded-xl transition border text-left group ${
                  accountMenuOpen
                    ? 'bg-indigo-500/20 border-indigo-500/50 shadow-sm'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
                title="Account options: Switch account, sign out, manage profile"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-sm relative"
                    style={{
                      backgroundColor:
                        currentUser.provider === 'google'
                          ? '#4285F4'
                          : currentUser.provider === 'outlook'
                          ? '#0078D4'
                          : '#6366F1',
                    }}
                  >
                    <span>{getUserInitials(currentUser)}</span>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#03040A]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition truncate">
                      {currentUser.name}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      {currentUser.email || currentUser.phone}
                    </div>
                  </div>
                </div>
                <MoreVertical className="w-3.5 h-3.5 text-slate-400 group-hover:text-white shrink-0 ml-1" />
              </button>

              {/* Account Options Popover */}
              {accountMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAccountMenuOpen(false)}
                  />
                  <div
                    className={`absolute bottom-full left-0 right-0 mb-2 z-50 ${t.card} border ${t.cardBorder} rounded-xl p-3 shadow-2xl space-y-2 animate-in fade-in zoom-in-95 duration-150`}
                  >
                    {/* Header in Popover */}
                    <div className="flex items-center space-x-2.5 pb-2 border-b border-white/5">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white shrink-0 shadow-sm"
                        style={{
                          backgroundColor:
                            currentUser.provider === 'google'
                              ? '#4285F4'
                              : currentUser.provider === 'outlook'
                              ? '#0078D4'
                              : '#6366F1',
                        }}
                      >
                        {getUserInitials(currentUser)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white truncate">{currentUser.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {currentUser.email || currentUser.phone}
                        </div>
                      </div>
                    </div>

                    {/* Popover Actions */}
                    <div className="space-y-1">
                      {/* Switch Google Account */}
                      <button
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setAuthModalMode('google');
                          setAuthModalOpen(true);
                        }}
                        className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
                          <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z" />
                          <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 12s.7 2.3 1.9 4.7l3.7-1.9z" />
                          <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z" />
                        </svg>
                        <span>Switch Google Account</span>
                      </button>

                      {/* Switch Outlook Account */}
                      <button
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setAuthModalMode('outlook');
                          setAuthModalOpen(true);
                        }}
                        className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                          <path fill="#F25022" d="M1 1h10v10H1z" />
                          <path fill="#7FBA00" d="M13 1h10v10H13z" />
                          <path fill="#00A4EF" d="M1 13h10v10H1z" />
                          <path fill="#FFB900" d="M13 13h10v10H1z" />
                        </svg>
                        <span>Switch Outlook Account</span>
                      </button>

                      {/* Other Sign-In / Account options */}
                      <button
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setAuthModalMode('default');
                          setAuthModalOpen(true);
                        }}
                        className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition"
                      >
                        <Users className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span>All Sign-In Options...</span>
                      </button>

                      <div className="h-px bg-white/5 my-1" />

                      {/* Sign Out */}
                      <button
                                                onClick={() => {
                          setAccountMenuOpen(false);
                          void clearUserSession();
                          setCurrentUser(null);
                          setConversations([]);
                          setActiveConvId('');
                          setSessionGeneration((value) => value + 1);
                          localStorage.removeItem('rare_user_account');
                        }}
                        className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                      >
                        <LogOut className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => {
                setAuthModalMode('default');
                setAuthModalOpen(true);
              }}
              className="w-full flex items-center justify-between p-2 rounded-xl transition border bg-white/5 border-white/10 hover:bg-white/10 text-left group"
              title="Click to sign in with Google, Outlook, Email, or Phone"
            >
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-slate-700/60 flex items-center justify-center font-bold text-xs text-slate-300 shrink-0">
                  RA
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white group-hover:text-indigo-300 transition">
                    Guest Account
                  </div>
                  <div className="text-[10px] text-slate-400">Click to Sign In</div>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white shrink-0" />
            </button>
          )}

          {/* Settings Button */}
          <button
            onClick={() => {
              setActiveTab('settings');
              setSidebarOpen(false);
              setOpenDevSpaceDirectly(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === 'settings'
                ? `${t.accentBg} text-white shadow-sm`
                : `${t.textMuted} hover:${t.textPrimary} hover:bg-white/5`
            }`}
          >
            <div className="flex items-center space-x-2.5">
              <SettingsIcon className="w-4 h-4 shrink-0" />
              <span>Settings</span>
            </div>
            <span className={`text-[10px] font-mono ${t.textDim}`}>Config</span>
          </button>

          {/* 6 Theme Selector Dots */}
          <div className="flex items-center justify-between pt-1">
            <span className={`text-[10px] ${t.textDim}`}>Theme:</span>
            <div className="flex items-center space-x-1.5">
              {(['blue', 'white', 'dark', 'red', 'green', 'yellow'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => changeTheme(key)}
                  className={`w-3.5 h-3.5 rounded-full border transition transform hover:scale-125 ${
                    currentThemeKey === key ? 'ring-2 ring-indigo-400 scale-110' : 'opacity-70'
                  }`}
                  style={{
                    backgroundColor:
                      key === 'blue'
                        ? '#5C7CFF'
                        : key === 'white'
                        ? '#F1F5F9'
                        : key === 'dark'
                        ? '#161822'
                        : key === 'red'
                        ? '#E11D48'
                        : key === 'green'
                        ? '#10B981'
                        : '#F59E0B',
                    borderColor: currentThemeKey === key ? '#ffffff' : 'rgba(255,255,255,0.2)',
                  }}
                  title={`${key.toUpperCase()} Theme`}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
            <button
              onClick={() => checkForUpdates(true)}
              className="flex items-center space-x-2 text-left hover:opacity-90 transition cursor-pointer"
              title="Click to check for system updates"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-medium text-[11px]">System Ready</span>
            </button>
            <button
              onClick={() => setDownloadModalOpen(true)}
              className={`text-[10px] font-mono ${t.textDim} hover:text-white transition hover:underline cursor-pointer`}
              title="Click to download APK, Windows EXE, or PWA"
            >
              v{clientVersion}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* Top Header Bar */}
        <header className={`h-14 border-b ${t.cardBorder} ${t.header} backdrop-blur px-4 sm:px-6 flex items-center justify-between shrink-0`}>
          <div className="flex items-center space-x-3">
            {/* Hamburger Menu Toggle Button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition"
              title="Toggle Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <h1 className="text-sm font-semibold tracking-wide capitalize">
              {activeTab === 'chat' ? 'Chat' : activeTab}
            </h1>
            <span className={`${t.textDim} hidden sm:inline`}>/</span>
            <span className={`text-xs ${t.textMuted} hidden sm:inline`}>{assistantName} Intelligence Core</span>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-2.5">
            {/* Login / Sign Up Account Header Button — ONLY shown when user is NOT signed in */}
            {!currentUser && (
              <button
                onClick={() => {
                  setAuthModalMode('default');
                  setAuthModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-full text-xs flex items-center space-x-1.5 transition border bg-indigo-500/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25 font-semibold"
                title="Login / Sign Up (Google, Outlook, Email, Phone)"
              >
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Login / Sign Up</span>
              </button>
            )}

            {/* Phone Icon: Download Android APK & Install to Phone */}
            <button
              onClick={() => setDownloadModalOpen(true)}
              className="px-2.5 sm:px-3 py-1 rounded-full text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 active:scale-95 flex items-center space-x-1.5 transition shadow-xs cursor-pointer"
              title="Download Real Android APK, install to phone, or share via Xender"
              aria-label="Download Android APK and install to phone"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-semibold text-emerald-300">Get APK / Phone App</span>
            </button>

            {/* Dynamic Update Notification Pill */}
            {availableUpdate && (
              <button
                onClick={() => setUpdateModalOpen(true)}
                className={`px-2.5 py-1 rounded-full text-xs flex items-center space-x-1.5 transition animate-pulse font-semibold shadow-xs ${
                  availableUpdate.channel === 'developer'
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
                    : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30'
                }`}
                title={`New update v${availableUpdate.version} (${availableUpdate.channel}) is available! Click to view & apply.`}
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>v{availableUpdate.version} Update</span>
              </button>
            )}

            {/* Think Harder Toggle */}
            <button
              onClick={() => setThinkHarder(!thinkHarder)}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs transition-all border ${
                thinkHarder
                  ? `${t.accentBg} text-white shadow-sm font-semibold`
                  : `${t.cardSub} ${t.textMuted} ${t.cardBorder} hover:${t.textPrimary}`
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Deep Reasoning</span>
            </button>
          </div>
        </header>

        {/* View Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'chat' && (
            <CleanChatWorkspaceView
              t={t}
              assistantName={assistantName}
              thinkHarder={thinkHarder}
              voiceEnabled={voiceEnabled}
              activeConvId={activeConvId}
              sessionKey={`${currentUser?.id || 'guest'}:${sessionGeneration}`}
              onSelectConv={setActiveConvId}
              onRefreshConversations={() => loadConversations()}
              onNewChat={handleNewChat}
              onOpenLiveVoice={() => setLiveVoiceModalOpen(true)}
              onDeleteChat={handleDeleteChat}
              onNavigate={setActiveTab}
            />
          )}
          {activeTab === 'projects' && <CollaborativeBuildWorkspaceView t={t} />}
          {activeTab === 'scheduled' && <ScheduledWorkspaceView t={t} onNavigate={setActiveTab} />}
          {activeTab === 'plugins' && <PluginsDirectoryView t={t} onNavigate={setActiveTab} />}
          {activeTab === 'images' && (
            <ImageStudioWorkspaceView
              t={t}
              assistantName={assistantName}
            />
          )}
          {activeTab === 'live' && (
            <LiveVoiceView
              t={t}
              assistantName={assistantName}
              voiceEnabled={voiceEnabled}
            />
          )}
          {activeTab === 'settings' && (
            <CleanSettingsWorkspaceView
              t={t}
              assistantName={assistantName}
              setAssistantName={setAssistantName}
              currentThemeKey={currentThemeKey}
              changeTheme={changeTheme}
              isDeveloperAuthed={isDeveloperAuthed}
              onOpenDevModal={() => setShowDevModal(true)}
              openDevSpaceDirectly={openDevSpaceDirectly}
              setOpenDevSpaceDirectly={setOpenDevSpaceDirectly}
              onDeveloperLogout={() => setIsDeveloperAuthed(false)}
              clientVersion={clientVersion}
              onCheckForUpdates={() => checkForUpdates(true)}
              onOpenDownloadModal={() => setDownloadModalOpen(true)}
            />
          )}
        </div>
      </main>

      {/* Download & Offline Install / Xender Share Modal */}
      <DownloadAppModal
        t={t}
        isOpen={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
        assistantName={assistantName}
      />

      {/* Over-The-Air System Update Modal */}
      <UpdateModal
        t={t}
        isOpen={updateModalOpen}
        onClose={() => {
          if (availableUpdate) {
            sessionStorage.setItem('rare_dismissed_update', availableUpdate.id);
          }
          setUpdateModalOpen(false);
        }}
        update={availableUpdate}
        onApplyUpdate={handleApplyUpdate}
        isDeveloper={isDeveloperAuthed}
      />

      {/* Live Voice Dialog Modal Overlay */}
      {liveVoiceModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="relative w-full max-w-4xl h-[90vh] bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col">
            <button
              onClick={() => setLiveVoiceModalOpen(false)}
              className="absolute top-4 right-4 z-50 p-2 rounded-full bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800 transition"
              title="Close Live Voice"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex-1 overflow-y-auto p-4 sm:p-8">
              <LiveVoiceView
                t={t}
                assistantName={assistantName}
                voiceEnabled={voiceEnabled}
                onClose={() => setLiveVoiceModalOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* User Login / Sign Up Modal */}
      <AuthModal
        t={t}
        isOpen={authModalOpen}
        currentUser={currentUser}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
                onLoginSuccess={(user) => {
          storeUserSessionToken();
          setCurrentUser(user);
          localStorage.setItem('rare_user_account', JSON.stringify(user));
          if (user.role === 'developer') {
            setIsDeveloperAuthed(true);
          }
        }}
        onLogout={() => {
          void clearUserSession();
          setCurrentUser(null);
          localStorage.removeItem('rare_user_account');
        }}
      />

      {/* Developer Passkey Security & Access Modal */}
      <DeveloperAuthModal
        t={t}
        isOpen={showDevModal}
        onSuccess={() => {
          setIsDeveloperAuthed(true);
          setShowDevModal(false);
          setActiveTab('settings');
          setOpenDevSpaceDirectly(true);
        }}
        onClose={() => setShowDevModal(false)}
      />

      {/* Share Chat Sheet Modal */}
      {shareModalData && (
        <ShareChatModal
          t={t}
          isOpen={!!shareModalData}
          onClose={() => setShareModalData(null)}
          conversationId={shareModalData.id}
          conversationTitle={shareModalData.title}
          assistantName={assistantName}
          preloadedMessages={shareModalData.messages}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 1. Clean User-Focused Command Center
// -----------------------------------------------------------------------------
function CleanCommandCenterView({
  t,
  onNavigate,
  assistantName,
}: {
  t: ThemeConfig;
  onNavigate: (tab: string) => void;
  assistantName: string;
}) {
  const [runs, setRuns] = useState<MultiAgentTeamRun[]>([]);

  useEffect(() => {
    safeFetch<MultiAgentTeamRun[]>('/api/agents/runs').then((data) => {
      if (data) setRuns(data);
    });
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Welcome Banner */}
      <div className={`rounded-2xl ${t.card} border ${t.cardBorder} p-6 shadow-xl space-y-3`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className={`inline-flex items-center space-x-1.5 ${t.accentText} text-xs font-semibold uppercase tracking-wider`}>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Personal Intelligence Core</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className={`text-xs ${t.textMuted} max-w-lg`}>
              {assistantName} is ready to help you build applications across platforms, organize documents, transcribe audio, and conduct research.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => onNavigate('build')}
              className={`px-4 py-2.5 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center space-x-2 shadow-md transition`}
            >
              <Hammer className="w-4 h-4" />
              <span>Start New Project</span>
            </button>
            <button
              onClick={() => onNavigate('chat')}
              className={`px-4 py-2.5 rounded-xl ${t.cardSub} border ${t.cardBorder} text-xs font-semibold flex items-center space-x-2 transition`}
            >
              <Terminal className="w-4 h-4" />
              <span>Open Chat</span>
            </button>
            <button
              onClick={() => onNavigate('images')}
              className={`px-4 py-2.5 rounded-xl ${t.cardSub} border ${t.cardBorder} text-xs font-semibold flex items-center space-x-2 transition`}
            >
              <ImageIcon className="w-4 h-4" />
              <span>Image Studio</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick Launch Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigate('images')}
          className={`${t.card} border ${t.cardBorder} hover:${t.accentBorder} p-4 rounded-xl cursor-pointer transition space-y-2 group`}
        >
          <div className="flex items-center justify-between">
            <div className={`p-2 rounded-lg bg-indigo-500/10 text-indigo-400`}>
              <ImageIcon className="w-4 h-4" />
            </div>
            <ArrowRight className={`w-4 h-4 ${t.textDim} group-hover:${t.accentText} transition`} />
          </div>
          <h3 className="text-sm font-bold">VisionCraft Image Studio</h3>
          <p className={`text-xs ${t.textMuted}`}>
            Gemini 3 Pro (1K/2K/4K) synthesis and Nano Banana 2.1 text-prompt creation & editing.
          </p>
        </div>

        <div
          onClick={() => onNavigate('build')}
          className={`${t.card} border ${t.cardBorder} hover:${t.accentBorder} p-4 rounded-xl cursor-pointer transition space-y-2 group`}
        >
          <div className="flex items-center justify-between">
            <div className={`p-2 rounded-lg ${t.badgeBg} ${t.badgeText}`}>
              <Users className="w-4 h-4" />
            </div>
            <ArrowRight className={`w-4 h-4 ${t.textDim} group-hover:${t.accentText} transition`} />
          </div>
          <h3 className="text-sm font-bold">Collaborative Software Builder</h3>
          <p className={`text-xs ${t.textMuted}`}>
            Describe your idea and watch specialized AI agents coordinate to build and test your project.
          </p>
        </div>

        <div
          onClick={() => onNavigate('docs')}
          className={`${t.card} border ${t.cardBorder} hover:${t.accentBorder} p-4 rounded-xl cursor-pointer transition space-y-2 group`}
        >
          <div className="flex items-center justify-between">
            <div className={`p-2 rounded-lg ${t.badgeBg} ${t.badgeText}`}>
              <FileText className="w-4 h-4" />
            </div>
            <ArrowRight className={`w-4 h-4 ${t.textDim} group-hover:${t.accentText} transition`} />
          </div>
          <h3 className="text-sm font-bold">Document & Audio Center</h3>
          <p className={`text-xs ${t.textMuted}`}>
            Read, write, edit files, and transcribe recordings with intelligent quotation verification.
          </p>
        </div>

        <div
          onClick={() => onNavigate('research')}
          className={`${t.card} border ${t.cardBorder} hover:${t.accentBorder} p-4 rounded-xl cursor-pointer transition space-y-2 group`}
        >
          <div className="flex items-center justify-between">
            <div className={`p-2 rounded-lg ${t.badgeBg} ${t.badgeText}`}>
              <Compass className="w-4 h-4" />
            </div>
            <ArrowRight className={`w-4 h-4 ${t.textDim} group-hover:${t.accentText} transition`} />
          </div>
          <h3 className="text-sm font-bold">Multi-Source Research</h3>
          <p className={`text-xs ${t.textMuted}`}>
            Investigate topics across verified sources and generate clear synthesis reports.
          </p>
        </div>
      </div>

      {/* Recent Projects & Deliverables */}
      <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center space-x-2">
            <Package className="w-4 h-4 text-indigo-400" />
            <span>Active & Recent Projects</span>
          </h3>
          <button
            onClick={() => onNavigate('build')}
            className={`text-xs ${t.accentText} hover:underline font-medium`}
          >
            View Universal Builder →
          </button>
        </div>

        <div className="divide-y divide-white/5">
          {runs.map((run) => (
            <div key={run.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold">{run.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold uppercase ${
                    run.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : `${t.badgeBg} ${t.badgeText}`
                  }`}>
                    {run.status}
                  </span>
                  <span className={`text-[11px] ${t.textDim} capitalize`}>• {run.targetDomain}</span>
                </div>
                <p className={`text-xs ${t.textMuted}`}>{run.userProgressMessage || run.objective}</p>
              </div>

              {run.artifacts && run.artifacts.length > 0 && (
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-xs font-mono text-emerald-400 flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{run.artifacts[0].name}</span>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2. Collaborative Multi-Agent Software Builder Workspace
// -----------------------------------------------------------------------------
function CollaborativeBuildWorkspaceView({ t }: { t: ThemeConfig }) {
  const [runs, setRuns] = useState<MultiAgentTeamRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<MultiAgentTeamRun | null>(null);

  // New Project Form
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState<'web' | 'android' | 'windows' | 'backend' | 'cli'>('web');
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['windows', 'android']);
  const [selectedStacks, setSelectedStacks] = useState<string[]>(['TypeScript / React Vite', 'Node.js Express']);

  const loadRuns = async () => {
    const data = await safeFetch<MultiAgentTeamRun[]>('/api/agents/runs');
    if (data && data.length > 0) {
      setRuns(data);
      if (!selectedRun) setSelectedRun(data[0]);
      else {
        const updated = data.find((r) => r.id === selectedRun.id);
        if (updated) setSelectedRun(updated);
      }
    }
  };

  useEffect(() => {
    loadRuns();
    const timer = setInterval(loadRuns, 2500);
    return () => clearInterval(timer);
  }, [selectedRun?.id]);

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((item) => item !== p) : prev) : [...prev, p]
    );
  };

  const toggleStack = (s: string) => {
    setSelectedStacks((prev) =>
      prev.includes(s) ? (prev.length > 1 ? prev.filter((item) => item !== s) : prev) : [...prev, s]
    );
  };

  const handleStartProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !objective.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await safePost<MultiAgentTeamRun>('/api/agents/runs', {
        title,
        targetDomain: selectedPlatforms.join(' + '),
        objective: `${objective} (Target Platforms: ${selectedPlatforms.join(', ')} | Tech Stacks: ${selectedStacks.join(', ')})`,
      });
      if (res) {
        setTitle('');
        setObjective('');
        setSelectedRun(res);
        loadRuns();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRepair = async (runId: string) => {
    await safePost(`/api/agents/runs/${runId}/repair`);
    loadRuns();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Project Creator */}
      <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
        <div className="flex items-center space-x-2">
          <Hammer className={`w-4 h-4 ${t.accentText}`} />
          <h3 className="text-sm font-bold">Universal Software Builder (Multi-Device)</h3>
        </div>

        <form onSubmit={handleStartProject} className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">Project Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. OrbitTrack Cross-Platform Command Center..."
              className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
            />
          </div>

          {/* Multi-Device / Multi-Platform Selection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
              <span>Target Platforms (Select Any Combination)</span>
              <span className="text-[10px] text-indigo-400 font-mono">
                {selectedPlatforms.length} {selectedPlatforms.length === 1 ? 'platform' : 'platforms'} selected
              </span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { id: 'windows', label: 'Windows (EXE)', icon: Monitor, tag: 'x64 Native' },
                { id: 'android', label: 'Android (APK)', icon: Smartphone, tag: 'Mobile' },
                { id: 'web', label: 'Web (PWA)', icon: Globe, tag: 'Browser' },
                { id: 'macos', label: 'macOS (DMG)', icon: Laptop, tag: 'Universal' },
                { id: 'linux', label: 'Linux (Binary)', icon: Terminal, tag: 'AppImage' },
              ].map((p) => {
                const Icon = p.icon;
                const isSelected = selectedPlatforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlatform(p.id)}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500 text-white'
                        : `${t.cardSub} ${t.cardBorder} hover:border-slate-600 text-slate-400`
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                      <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${isSelected ? 'bg-indigo-500/30 text-indigo-200' : 'bg-white/5'}`}>
                        {p.tag}
                      </span>
                    </div>
                    <span className="text-xs font-semibold">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tech Stack Multi-Select */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 block">
              Languages & Tech Stack (Flexible Combinations)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {[
                'TypeScript / React Vite',
                'Node.js Express API',
                'Kotlin / Android Compose',
                'Python 3.13 / FastAPI',
                'Rust / Cargo',
                'C++ / MSVC Native',
              ].map((st) => {
                const isSelected = selectedStacks.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => toggleStack(st)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                      isSelected
                        ? `${t.accentBg} text-white border-transparent shadow-xs`
                        : `${t.cardSub} ${t.cardBorder} text-slate-400 hover:text-slate-200`
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">What should RARE build for you?</label>
            <input
              type="text"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Describe the application features, data needs, and desired outcome..."
              className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={submitting || !title.trim() || !objective.trim()}
              className={`px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold disabled:opacity-40 transition shadow-md`}
            >
              {submitting ? 'Assembling Team...' : 'Commission Multi-Platform Project'}
            </button>
          </div>
        </form>
      </div>

      {/* Selected Project Realtime Collaborative Team View */}
      {selectedRun && (
        <div className="space-y-5">
          {/* Progress Header */}
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-base font-bold">{selectedRun.title}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-mono font-bold ${
                    selectedRun.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : `${t.badgeBg} ${t.badgeText}`
                  }`}>
                    {selectedRun.status}
                  </span>
                </div>
                <p className={`text-xs ${t.textMuted} mt-0.5`}>{selectedRun.objective}</p>
              </div>

              {selectedRun.status !== 'completed' && (
                <button
                  onClick={() => handleRepair(selectedRun.id)}
                  className={`px-3 py-1.5 rounded-lg border ${t.cardBorder} ${t.cardSub} text-xs font-medium text-amber-400 flex items-center space-x-1.5`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Verify & Repair</span>
                </button>
              )}
            </div>

            {/* Clean Progress Stage Bar */}
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-indigo-400">{selectedRun.currentStage}</span>
                <span className={`text-[11px] ${t.textDim}`}>{selectedRun.userProgressMessage}</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full ${t.accentBg} transition-all duration-500`}
                  style={{
                    width: `${
                      selectedRun.status === 'completed'
                        ? 100
                        : selectedRun.currentStage.includes('Packaging')
                        ? 80
                        : selectedRun.currentStage.includes('Verification')
                        ? 60
                        : selectedRun.currentStage.includes('Implementing')
                        ? 40
                        : 20
                    }%`,
                  }}
                />
              </div>
            </div>

            {/* Deliverable Downloads */}
            {selectedRun.artifacts && selectedRun.artifacts.length > 0 && (
              <div className={`p-3 rounded-lg ${t.cardSub} border ${t.cardBorder} flex flex-wrap items-center justify-between gap-2 pt-2`}>
                <div className="flex items-center space-x-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="font-semibold">Deliverable Verified:</span>
                  <span className="font-mono text-emerald-300">{selectedRun.artifacts[0].name} ({selectedRun.artifacts[0].size})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/api/download/source"
                    download="rare_app_win64.exe"
                    className={`px-3 py-1.5 rounded-lg ${t.accentBg} text-white text-xs font-medium flex items-center space-x-1.5 shadow-sm hover:opacity-90`}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Windows EXE</span>
                  </a>
                  <a
                    href="/api/download/source"
                    download="rare_app_mobile.apk"
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center space-x-1.5 shadow-sm transition"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Download Android APK</span>
                  </a>
                  <a
                    href="/api/download/source"
                    download="rare_project_bundle.zip"
                    className={`px-3 py-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} text-xs font-medium flex items-center space-x-1.5 transition`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Full Source ZIP</span>
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* VISIBLE ACTIVE AGENT TEAM */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Active Specialist AI Team</span>
              </h4>
              <span className={`text-[11px] ${t.textDim}`}>Real-time Multi-Agent Delegation</span>
            </div>

            {/* Agents Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Coordinator */}
              <div className={`${t.card} border ${t.cardBorder} rounded-xl p-3.5 space-y-2 relative overflow-hidden`}>
                <div className="flex items-center space-x-2.5">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-md`}>
                    00
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">Project Coordinator</div>
                    <div className={`text-[10px] ${t.textDim} truncate`}>Lead Orchestrator</div>
                  </div>
                </div>
                <p className={`text-[11px] ${t.textMuted} leading-snug line-clamp-2`}>
                  {selectedRun.coordinator.currentTask}
                </p>
                <div className="flex items-center justify-between text-[10px] font-mono pt-1">
                  <span className="text-emerald-400 uppercase font-semibold">{selectedRun.coordinator.status}</span>
                  <span className={t.textDim}>{selectedRun.coordinator.progressPercent}%</span>
                </div>
              </div>

              {/* Specialists */}
              {selectedRun.agents.map((ag, i) => (
                <div key={ag.id} className={`${t.card} border ${t.cardBorder} rounded-xl p-3.5 space-y-2 relative overflow-hidden`}>
                  <div className="flex items-center space-x-2.5">
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-tr ${ag.avatarColor} flex items-center justify-center text-white text-xs font-bold shadow-md`}>
                      0{i + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">{ag.name.replace(/Agent \d+ — /, '')}</div>
                      <div className={`text-[10px] ${t.textDim} truncate`}>{ag.title}</div>
                    </div>
                  </div>
                  <p className={`text-[11px] ${t.textMuted} leading-snug line-clamp-2`}>
                    {ag.currentTask}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-mono pt-1">
                    <span className={`uppercase font-semibold ${
                      ag.status === 'completed'
                        ? 'text-emerald-400'
                        : ag.status === 'working'
                        ? 'text-indigo-400'
                        : 'text-amber-400'
                    }`}>
                      {ag.status}
                    </span>
                    <span className={t.textDim}>{ag.progressPercent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Inter-Agent Communication & Progress Stream */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Team Messages */}
            <div className={`${t.card} border ${t.cardBorder} rounded-xl p-4 space-y-3`}>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                <span>Live Collaboration Log</span>
              </h4>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {selectedRun.messages.map((m) => (
                  <div key={m.id} className={`p-2.5 rounded-lg ${t.cardSub} border ${t.cardBorder} space-y-1 text-xs`}>
                    <div className="flex items-center justify-between font-semibold">
                      <span className="text-indigo-300">{m.fromName} → {m.toName}</span>
                      <span className={`text-[10px] font-mono ${t.textDim}`}>{m.timestamp}</span>
                    </div>
                    <div className="text-[11px] font-medium text-slate-300">{m.subject}</div>
                    <p className={`text-[11px] ${t.textMuted}`}>{m.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Task Operations Stream */}
            <div className={`${t.card} border ${t.cardBorder} rounded-xl p-4 space-y-3`}>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Quality & Verification Checks</span>
              </h4>
              <div className="space-y-1.5 font-mono text-[11px] max-h-56 overflow-y-auto pr-1">
                {selectedRun.events.map((ev) => (
                  <div key={ev.id} className="flex items-start space-x-2">
                    <span className={`${t.textDim} shrink-0`}>[{ev.time}]</span>
                    <span className="text-indigo-400 shrink-0 font-semibold">{ev.agentName}:</span>
                    <span className={ev.level === 'success' ? 'text-emerald-400' : ev.level === 'warn' ? 'text-amber-400' : t.textMuted}>
                      {ev.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3. Clean Documents & Audio Workspace
// -----------------------------------------------------------------------------
function CleanDocumentsWorkspaceView({ t }: { t: ThemeConfig }) {
  const [docList, setDocList] = useState<Array<{ path: string; size: number; format: string }>>([]);
  const [activePath, setActivePath] = useState<string>('project_plan_overview.md');
  const [content, setContent] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const loadDocList = async () => {
    const data = await safeFetch<any[]>('/api/documents');
    if (data) setDocList(data);
  };

  const loadDocContent = async (path: string) => {
    const data = await safeFetch<any>(`/api/documents/${path}`);
    if (data) {
      setContent(data.content);
      setActivePath(path);
    }
  };

  useEffect(() => {
    loadDocList();
    loadDocContent('project_plan_overview.md');
  }, []);

  const handleSave = async () => {
    const res = await safePost('/api/documents', { path: activePath, text: content });
    if (res) {
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
      loadDocList();
    }
  };

  // Context-Aware Universal Audio Transcription
  const handleTranscribeAudio = async (topic: string = 'executive_strategy') => {
    setTranscribing(true);
    try {
      const data = await safePost<any>('/api/documents/transcribe', {
        audioName: `${topic}_recording.mp3`,
        sampleTopic: topic,
      });
      if (data) {
        await loadDocList();
        loadDocContent(data.path);
      }
    } finally {
      setTranscribing(false);
    }
  };

  const filteredDocs = docList.filter((d) =>
    d.path.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={`h-[calc(100vh-8rem)] flex rounded-xl border ${t.cardBorder} overflow-hidden ${t.card}`}>
      {/* File Sidebar */}
      <div className={`w-64 border-r ${t.cardBorder} ${t.cardSub} flex flex-col p-3 shrink-0 space-y-3`}>
        <div className="relative">
          <Search className={`w-3.5 h-3.5 absolute left-2.5 top-2.5 ${t.textDim}`} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search documents..."
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none`}
          />
        </div>

        {/* Audio Transcription Tool Box */}
        <div className="space-y-1.5 p-2.5 rounded-xl border border-white/5 bg-black/20">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
            <span className="flex items-center space-x-1.5">
              <FileAudio className="w-3.5 h-3.5 text-indigo-400" />
              <span>Audio Transcription</span>
            </span>
            <span className="text-[9px] font-mono text-emerald-400 uppercase">Context-Aware</span>
          </div>
          <p className={`text-[10px] ${t.textMuted} leading-tight`}>
            Transcribes meetings, lectures, and interviews with proper punctuation and contextual clarification.
          </p>

          <div className="grid grid-cols-2 gap-1 pt-1">
            <button
              onClick={() => handleTranscribeAudio('executive_strategy')}
              disabled={transcribing}
              className={`p-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} hover:${t.accentBorder} text-[10px] font-medium text-left truncate transition`}
              title="Transcribe Board / Executive Meeting"
            >
              💼 Strategy Meeting
            </button>
            <button
              onClick={() => handleTranscribeAudio('technical_architecture')}
              disabled={transcribing}
              className={`p-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} hover:${t.accentBorder} text-[10px] font-medium text-left truncate transition`}
              title="Transcribe Technical Engineering Standup"
            >
              ⚙️ Tech Standup
            </button>
            <button
              onClick={() => handleTranscribeAudio('academic_lecture')}
              disabled={transcribing}
              className={`p-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} hover:${t.accentBorder} text-[10px] font-medium text-left truncate transition`}
              title="Transcribe University Lecture"
            >
              🎓 Lecture Q&A
            </button>
            <button
              onClick={() => handleTranscribeAudio('interview')}
              disabled={transcribing}
              className={`p-1.5 rounded-lg ${t.cardSub} border ${t.cardBorder} hover:${t.accentBorder} text-[10px] font-medium text-left truncate transition`}
              title="Transcribe Podcast / Interview"
            >
              🎙️ Interview / Voice
            </button>
          </div>

          {transcribing && (
            <div className="text-[10px] text-indigo-400 font-mono flex items-center space-x-1.5 pt-1 animate-pulse">
              <BrainCircuit className="w-3 h-3 animate-spin" />
              <span>Transcribing & verifying context...</span>
            </div>
          )}
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto space-y-1">
          <div className="text-[10px] font-semibold text-slate-400 px-1 uppercase tracking-wider">
            Documents ({filteredDocs.length})
          </div>
          {filteredDocs.map((doc) => (
            <button
              key={doc.path}
              onClick={() => loadDocContent(doc.path)}
              className={`w-full text-left p-2 rounded-lg text-xs truncate flex items-center space-x-2 transition ${
                activePath === doc.path
                  ? `${t.card} font-bold border ${t.cardBorder}`
                  : `${t.textMuted} hover:${t.textPrimary}`
              }`}
            >
              <FileText className={`w-3.5 h-3.5 ${t.accentText} shrink-0`} />
              <span className="truncate">{doc.path}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Document Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className={`h-12 border-b ${t.cardBorder} px-4 flex items-center justify-between ${t.cardSub}`}>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-mono font-bold">{activePath}</span>
            {savedSuccess && (
              <span className="text-xs text-emerald-400 flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved</span>
              </span>
            )}
          </div>

          <button
            onClick={handleSave}
            className={`px-3 py-1.5 rounded-lg ${t.accentBg} ${t.accentBgHover} text-white text-xs font-medium flex items-center space-x-1.5 transition`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Document</span>
          </button>
        </div>

        {content.includes('Context-Verified') && (
          <div className="p-3 bg-indigo-950/20 border-b border-indigo-500/20 text-xs text-indigo-300 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>
                <strong>Context Verification Active:</strong> Soft questions, indistinct acoustic segments, and domain terms reconciled from contextual dialog flow.
              </span>
            </div>
            <span className="text-[10px] bg-indigo-500/20 px-2 py-0.5 rounded text-indigo-300 font-mono">
              Confidence: 98.6%
            </span>
          </div>
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={`flex-1 bg-transparent p-6 font-mono text-xs leading-relaxed focus:outline-none resize-none ${t.textPrimary}`}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 4. Clean Research Workspace
// -----------------------------------------------------------------------------
function CleanResearchWorkspaceView({ t, onNavigate }: { t: ThemeConfig; onNavigate: (tab: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    safeFetch<ResearchItem[]>('/api/research/items').then((d) => {
      if (d) setResults(d);
    });
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const data = await safePost<any>('/api/research/search', { query });
      if (data?.results) setResults(data.results);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center space-y-1.5 py-2">
        <h2 className="text-xl font-bold">Research & Fact Synthesis</h2>
        <p className={`text-xs ${t.textMuted} max-w-md mx-auto`}>
          Investigate questions across reliable sources with citation traceability.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className={`w-4 h-4 absolute left-3.5 top-3 ${t.textDim}`} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter research topic or question..."
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none`}
          />
        </div>
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className={`px-5 py-2.5 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold disabled:opacity-40 transition shadow-md`}
        >
          {searching ? 'Investigating...' : 'Research'}
        </button>
      </form>

      <div className="space-y-4">
        {results.map((r) => (
          <div key={r.id} className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">{r.query}</h3>
              <span className={`text-[10px] font-mono ${t.badgeBg} ${t.badgeText} px-2 py-0.5 rounded font-bold`}>
                {(r.confidence * 100).toFixed(0)}% Confidence
              </span>
            </div>

            <p className={`text-xs leading-relaxed ${t.textPrimary}`}>{r.findings}</p>

            <div className="space-y-1.5 pt-1">
              <div className={`text-[10px] uppercase font-semibold text-slate-400`}>Verified Sources:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {r.sources.map((s, idx) => (
                  <div key={idx} className={`p-2.5 rounded-lg border ${t.cardBorder} ${t.cardSub} space-y-1`}>
                    <div className="text-xs font-semibold">{s.name}</div>
                    <p className={`text-[11px] ${t.textMuted} italic`}>"{s.quote}"</p>
                    <div className={`text-[9px] ${t.textDim} font-mono truncate`}>{s.url}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`pt-2 border-t ${t.cardBorder} flex items-center justify-between`}>
              <span className={`text-[11px] ${t.textDim} italic`}>Synthesis: {r.synthesis}</span>
              <button
                onClick={() => onNavigate('build')}
                className={`px-3 py-1 rounded text-xs ${t.accentBg} text-white font-medium`}
              >
                Send to Builder
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3. Chronos Scheduler & Alarms Workspace View
// -----------------------------------------------------------------------------
function ScheduledWorkspaceView({
  t,
  onNavigate,
}: {
  t: ThemeConfig;
  onNavigate?: (tab: string) => void;
}) {
  const [schedules, setSchedules] = useState<ScheduledTask[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [type, setType] = useState<'alarm' | 'recurring' | 'reminder' | 'automation'>('alarm');
  const [repeat, setRepeat] = useState('Once');
  const [action, setAction] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const loadSchedules = async () => {
    const data = await safeFetch<ScheduledTask[]>('/api/schedules');
    if (data) setSchedules(data);
  };

  useEffect(() => {
    loadSchedules();
  }, []);

  const handleToggle = async (id: string) => {
    const res = await safePost<any>(`/api/schedules/${id}/toggle`);
    if (res?.task) {
      setSchedules((prev) => prev.map((s) => (s.id === id ? res.task : s)));
    }
  };

  const handleDelete = async (id: string) => {
    await safeFetch(`/api/schedules/${id}`, { method: 'DELETE' });
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const newTask = await safePost<ScheduledTask>('/api/schedules', {
      title: title.trim(),
      time,
      type,
      repeat,
      action: action || `Execute ${title}`,
    });
    if (newTask) {
      setSchedules((prev) => [newTask, ...prev]);
      setTitle('');
      setAction('');
      setShowAddModal(false);
    }
  };

  const filtered = filterType === 'all' ? schedules : schedules.filter((s) => s.type === filterType);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className={`p-5 rounded-2xl ${t.card} border ${t.cardBorder} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-md`}>
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">Chronos Scheduler & Alarms</h2>
            <p className={`text-xs ${t.textMuted}`}>Automated alarms, recurring tasks, and reminders for your apps and day.</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className={`px-4 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center space-x-2 shadow-sm transition`}
        >
          <Plus className="w-4 h-4" />
          <span>New Schedule / Alarm</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
        {['all', 'alarm', 'recurring', 'reminder', 'automation'].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterType(cat)}
            className={`px-3 py-1.5 rounded-lg capitalize font-medium transition ${
              filterType === cat ? `${t.accentBg} text-white` : `${t.cardSub} ${t.textMuted} hover:${t.textPrimary}`
            }`}
          >
            {cat} {cat === 'all' && `(${schedules.length})`}
          </button>
        ))}
      </div>

      {/* Tasks List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`p-4 rounded-xl border ${t.cardBorder} ${t.card} flex flex-col justify-between space-y-3 transition`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className={`text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded ${
                    item.type === 'alarm'
                      ? 'bg-amber-500/10 text-amber-400'
                      : item.type === 'recurring'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    {item.type}
                  </span>
                  <span className="text-xs font-bold text-slate-300">{item.time}</span>
                </div>
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className={`text-xs ${t.textMuted}`}>{item.action}</p>
                <div className={`text-[11px] ${t.textDim}`}>Repeat: {item.repeat}</div>
              </div>

              {/* Toggle switch */}
              <button
                onClick={() => handleToggle(item.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  item.enabled ? 'bg-indigo-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    item.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className={`pt-2 border-t border-white/5 flex items-center justify-between text-xs`}>
              <span className={`text-[10px] ${item.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {item.enabled ? '● Active' : '○ Paused'}
              </span>
              <button
                onClick={() => handleDelete(item.id)}
                className="text-slate-500 hover:text-red-400 p-1 transition"
                title="Delete Schedule"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-md ${t.card} border ${t.cardBorder} rounded-2xl p-5 space-y-4 shadow-2xl`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">Create Schedule or Alarm</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddSchedule} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Code Review Alarm, Daily Standup"
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Time</label>
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="e.g. 10:00, Tomorrow at 1:00 PM"
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 block mb-1">Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
                  >
                    <option value="alarm">Alarm</option>
                    <option value="recurring">Recurring</option>
                    <option value="reminder">Reminder</option>
                    <option value="automation">Automation</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Repeat Frequency</label>
                <select
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
                >
                  <option value="Once">Once</option>
                  <option value="Every day">Every day</option>
                  <option value="Weekdays">Weekdays (Mon-Fri)</option>
                  <option value="Every night">Every night</option>
                  <option value="Tomorrow at 1:00 PM">Tomorrow at 1:00 PM</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Action / Notification</label>
                <input
                  type="text"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder="e.g. Chime alarm and compile build summary"
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={`px-4 py-2 rounded-lg ${t.cardSub} text-xs font-medium text-slate-400 hover:text-white`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded-lg ${t.accentBg} text-xs font-semibold text-white shadow-sm`}
                >
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 4. World-Class Plugin Ecosystem Directory
// -----------------------------------------------------------------------------
function PluginsDirectoryView({
  t,
  onNavigate,
}: {
  t: ThemeConfig;
  onNavigate?: (tab: string) => void;
}) {
  const [plugins, setPlugins] = useState<PluginDef[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  const loadPlugins = async () => {
    const data = await safeFetch<PluginDef[]>('/api/plugins');
    if (data) setPlugins(data);
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const handleToggle = async (id: string) => {
    const res = await safePost<any>(`/api/plugins/${id}/toggle`);
    if (res?.plugin) {
      setPlugins((prev) => prev.map((p) => (p.id === id ? res.plugin : p)));
    }
  };

  const filtered = plugins.filter((p) => {
    const matchCat = category === 'all' || p.category === category;
    const matchQuery =
      !search.trim() ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.capabilities.some((c) => c.toLowerCase().includes(search.toLowerCase()));
    return matchCat && matchQuery;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className={`p-5 rounded-2xl ${t.card} border ${t.cardBorder} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-md`}>
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">World-Class Plugin Directory</h2>
            <p className={`text-xs ${t.textMuted}`}>Extended intelligence capabilities, compilers, acoustics, and sandbox security modules.</p>
          </div>
        </div>
        <div className="text-xs font-mono px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center space-x-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{plugins.filter((p) => p.installed).length}/{plugins.length} Plugins Active</span>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
          {['all', 'build', 'media', 'tools', 'data', 'dev', 'system'].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg capitalize font-medium transition ${
                category === cat ? `${t.accentBg} text-white` : `${t.cardSub} ${t.textMuted} hover:${t.textPrimary}`
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className={`w-3.5 h-3.5 absolute left-3 top-2.5 ${t.textDim}`} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plugins & skills..."
            className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none`}
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((item) => (
          <div
            key={item.id}
            className={`p-4 rounded-xl border ${t.cardBorder} ${t.card} flex flex-col justify-between space-y-3 transition`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold">{item.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase ${t.badgeBg} ${t.badgeText}`}>
                      {item.category}
                    </span>
                  </div>
                  <div className={`text-[11px] ${t.textDim}`}>by {item.author} • v{item.version}</div>
                </div>

                <button
                  onClick={() => handleToggle(item.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                    item.installed
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                      : 'bg-slate-800 text-slate-400 hover:text-white border border-white/10'
                  }`}
                >
                  {item.installed ? 'Installed' : 'Enable'}
                </button>
              </div>

              <p className={`text-xs ${t.textMuted}`}>{item.description}</p>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-white/5">
              <span className={`text-[10px] ${t.textDim} font-semibold uppercase tracking-wider`}>Capabilities</span>
              <div className="flex flex-wrap gap-1.5">
                {item.capabilities.map((cap, idx) => (
                  <span
                    key={idx}
                    className={`text-[10px] px-2 py-0.5 rounded-md ${t.cardSub} ${t.textPrimary} border ${t.cardBorder}`}
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 5. Clean Unified Chat Workspace (Full-Width Streamlined Experience)
// -----------------------------------------------------------------------------
function CleanChatWorkspaceView({
  t,
  assistantName,
  thinkHarder,
  voiceEnabled,
  activeConvId,
  sessionKey,
  onSelectConv,
  onRefreshConversations,
  onNewChat,
  onOpenLiveVoice,
  onDeleteChat,
  onNavigate,
}: {
  t: ThemeConfig;
  assistantName: string;
  thinkHarder: boolean;
  voiceEnabled: boolean;
  activeConvId: string;
  sessionKey: string;
  onSelectConv?: (id: string) => void;
  onRefreshConversations?: () => void;
  onNewChat?: () => void;
  onOpenLiveVoice?: () => void;
  onDeleteChat?: (id: string, e?: React.SyntheticEvent) => void;
  onNavigate?: (tab: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convTitle, setConvTitle] = useState('New Chat');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [personaMode, setPersonaMode] = useState<'casual' | 'professional' | 'creative' | 'concise'>('casual');
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);

  // High-accuracy Voice Recording & Real-time Live Transcription States
  const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false);
  const [liveInterimTranscript, setLiveInterimTranscript] = useState('');
  const [micAudioLevel, setMicAudioLevel] = useState(0);
  const [voiceNoteError, setVoiceNoteError] = useState<string | null>(null);

  // Attachment Sheet & Device Permission States
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [micPermissionModalOpen, setMicPermissionModalOpen] = useState(false);

  // In-App Camera Viewfinder States
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recognitionVoiceNoteRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const baseInputRef = useRef('');
  const finalAccumulatedRef = useRef('');
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = async (convId: string) => {
    if (!convId) return;
    const data = await safeFetch<any>(`/api/conversations/${convId}`);
    const localStore = loadLocalConversationsStore();
    if (data && Array.isArray(data.messages) && data.messages.length > 0) {
      setMessages(data.messages);
      if (data.title) {
        setConvTitle(data.title);
        setTitleInput(data.title);
      }
      localStore[convId] = {
        ...(localStore[convId] || { id: convId, title: data.title || 'Chat', created_at: new Date().toISOString() }),
        title: data.title || localStore[convId]?.title || 'Chat',
        messages: data.messages,
        messageCount: data.messages.length,
      };
      saveLocalConversationsStore(localStore);
    } else if (isStandaloneMobileApp() && localStore[convId] && Array.isArray(localStore[convId].messages) && localStore[convId].messages!.length > 0) {
      setMessages(localStore[convId].messages!);
      setConvTitle(localStore[convId].title || 'New Chat');
      setTitleInput(localStore[convId].title || 'New Chat');
    } else {
      // Clean initial welcome for new conversation
      const initialMsgs: ChatMessage[] = [
        {
          id: `msg_init_${Date.now()}`,
          role: 'assistant',
          content: `Hello! I am ${assistantName} — your personal AI companion and software builder.\n\nWhat would you like to explore today?\n• Chat casually about any topic — my permanent memory retains everything we discuss\n• Type to build a project (APK, EXE, or Web bundle)\n• Schedule an alarm, reminder, or recurring automation\n• Generate or edit high-fidelity images`,
          timestamp: new Date().toISOString(),
        },
      ];
      setMessages(initialMsgs);
      setConvTitle('New Chat');
      setTitleInput('New Chat');
      localStore[convId] = {
        id: convId,
        title: localStore[convId]?.title || 'New Chat',
        created_at: localStore[convId]?.created_at || new Date().toISOString(),
        messages: initialMsgs,
        messageCount: initialMsgs.length,
      };
      saveLocalConversationsStore(localStore);
    }
  };

  useEffect(() => {
    setMessages([{
      id: `msg_session_${Date.now()}`,
      role: 'assistant',
      content: 'Hello! Messages in your account are private. Online AI responses require an available provider.',
      timestamp: new Date().toISOString(),
    }]);
    setConvTitle('New Chat');
    setTitleInput('New Chat');
    setInput('');
  }, [sessionKey]);

  useEffect(() => {
    stopHumanVoice();
    setSpeakingMsgId(null);
    if (activeConvId) {
      loadMessages(activeConvId);
    }
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Clean up any ongoing recording or speech when component unmounts
  useEffect(() => {
    return () => {
      stopHumanVoice();
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        if (recognitionVoiceNoteRef.current) {
          try {
            recognitionVoiceNoteRef.current.stop();
          } catch {}
        }
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        }
      }
    };
  }, []);

  // Message interaction states: copy, speak, edit, delete, context menu, and whole chat share
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [contextMenuMsg, setContextMenuMsg] = useState<ChatMessage | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const longPressTimerRef = useRef<any>(null);

  const showToast = (txt: string) => {
    setToastMessage(txt);
    setTimeout(() => setToastMessage(null), 2400);
  };

  const handleCopyText = async (text: string, msgId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(msgId);
      showToast('Copied to clipboard!');
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedMsgId(msgId);
      showToast('Copied to clipboard!');
      setTimeout(() => setCopiedMsgId(null), 2000);
    }
  };

  const handleShareMessage = async (msg: ChatMessage) => {
    const title = msg.role === 'user' ? 'My Message' : `${assistantName} Response`;
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: msg.content,
        });
        showToast('Shared!');
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    // Fallback: Copy to clipboard
    handleCopyText(msg.content, msg.id);
    showToast('Copied message text to clipboard for sharing!');
  };

  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleToggleSpeak = async (msgId: string, text: string) => {
    if (speakingMsgId === msgId) {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
      stopHumanVoice();
      setSpeakingMsgId(null);
      return;
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    stopHumanVoice();
    setSpeakingMsgId(msgId);

    const personaId = localStorage.getItem('rare_voice_persona') || 'aria_warm';
    try {
      await speakWithHumanVoice(text, personaId, {
        onEnd: () => setSpeakingMsgId(null),
      });
      return;
    } catch (err) {
      console.warn('speakWithHumanVoice error, checking neural fallback:', err);
    }

    // 2. High-fidelity Neural Audio TTS fallback for Android WebView & unsupported devices
    try {
      showToast('Generating high-quality speech...');
      const res = await safePost<any>('/api/voice/tts', { text });
      if (res?.audioBase64) {
        const audio = new Audio(`data:${res.mimeType || 'audio/wav'};base64,${res.audioBase64}`);
        activeAudioRef.current = audio;
        audio.onended = () => {
          setSpeakingMsgId(null);
          activeAudioRef.current = null;
        };
        audio.onerror = () => {
          setSpeakingMsgId(null);
          activeAudioRef.current = null;
          showToast('Could not play audio. Please check device volume.');
        };
        await audio.play();
        return;
      }
    } catch (err) {
      console.warn('Neural TTS playback error:', err);
    }

    setSpeakingMsgId(null);
    showToast('Speech synthesis unavailable. Please check sound settings.');
  };

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMsgId(msg.id);
    setEditContent(msg.content);
    setContextMenuMsg(null);
  };

  const handleCancelEdit = () => {
    setEditingMsgId(null);
    setEditContent('');
  };

  const handleSaveEdit = async (msgId: string, resend: boolean = false) => {
    const trimmed = editContent.trim();
    if (!trimmed || !activeConvId) {
      setEditingMsgId(null);
      return;
    }

    setMessages((prev) => {
      const updated = prev.map((m) => (m.id === msgId ? { ...m, content: trimmed } : m));
      const store = loadLocalConversationsStore();
      if (store[activeConvId]) {
        store[activeConvId].messages = updated;
        saveLocalConversationsStore(store);
      }
      return updated;
    });
    showToast('Message updated successfully');
    setEditingMsgId(null);

    try {
      await safeFetch<any>(`/api/conversations/${activeConvId}/messages/${msgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });
    } catch (e) {
      console.warn('Failed to update message:', e);
    }

    if (resend) {
      handleSend(trimmed);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!activeConvId) return;
    setMessages((prev) => {
      const updated = prev.filter((m) => m.id !== msgId);
      const store = loadLocalConversationsStore();
      if (store[activeConvId]) {
        store[activeConvId].messages = updated;
        store[activeConvId].messageCount = updated.length;
        saveLocalConversationsStore(store);
      }
      return updated;
    });
    showToast('Message deleted');
    setContextMenuMsg(null);
    try {
      await safeFetch(`/api/conversations/${activeConvId}/messages/${msgId}`, {
        method: 'DELETE',
      });
    } catch (e) {
      console.warn('Failed to delete message:', e);
    }
  };

  const handleTouchStartMsg = (msg: ChatMessage) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setContextMenuMsg(msg);
    }, 450);
  };

  const handleTouchEndMsg = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleSaveTitle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!titleInput.trim() || !activeConvId) {
      setEditingTitle(false);
      return;
    }
    const res = await safePost<any>(`/api/conversations/${activeConvId}/rename`, { title: titleInput.trim() });
    if (res?.conversation) {
      setConvTitle(res.conversation.title);
      if (onRefreshConversations) onRefreshConversations();
    }
    setEditingTitle(false);
  };

  // High-accuracy Voice Note Recording & Real-time Live Transcription Engine
  const startVoiceNote = async () => {
    setVoiceNoteError(null);
    setLiveInterimTranscript('');
    finalAccumulatedRef.current = '';
    baseInputRef.current = input;
    isRecordingRef.current = true;
    setIsRecordingVoiceNote(true);

    let streamObtained = false;
    // 1. Audio Meter & MediaRecorder initialization
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        streamObtained = true;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioLevel = () => {
            if (!analyserRef.current || !isRecordingRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            setMicAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
            animFrameRef.current = requestAnimationFrame(updateAudioLevel);
          };
          updateAudioLevel();
        }

        try {
          audioChunksRef.current = [];
          const recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          mediaRecorderRef.current = recorder;
          recorder.start(250);
        } catch {}
      }
    } catch (err: any) {
      console.warn('Microphone stream error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setMicPermissionModalOpen(true);
        setVoiceNoteError(null);
      } else {
        setVoiceNoteError('Microphone could not be accessed. Please check your device audio input.');
      }
    }

    // 2. Web Speech Recognition
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = navigator.language || 'en-US';
        rec.maxAlternatives = 1;

        rec.onstart = () => {
          setIsRecordingVoiceNote(true);
        };

        rec.onresult = (event: any) => {
          let currentInterim = '';
          let currentFinal = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              currentFinal += transcript;
            } else {
              currentInterim += transcript;
            }
          }

          if (currentFinal.trim()) {
            const phrase = currentFinal.trim();
            const formatted = phrase.charAt(0).toUpperCase() + phrase.slice(1);
            if (finalAccumulatedRef.current) {
              finalAccumulatedRef.current += ' ' + formatted;
            } else {
              finalAccumulatedRef.current = formatted;
            }
          }

          setLiveInterimTranscript(currentInterim.trim());

          const base = baseInputRef.current.trim();
          const committed = finalAccumulatedRef.current.trim();
          const interim = currentInterim.trim();

          let full = base;
          if (committed) full = full ? `${full} ${committed}` : committed;
          if (interim) full = full ? `${full} ${interim}` : interim;

          setInput(full);
        };

        rec.onerror = (event: any) => {
          if (event.error === 'no-speech') {
            return;
          }
          if (event.error === 'not-allowed') {
            setMicPermissionModalOpen(true);
            setVoiceNoteError(null);
            setIsRecordingVoiceNote(false);
            isRecordingRef.current = false;
            return;
          }
          if (event.error === 'aborted') {
            return;
          }
          console.warn('Speech recognition warning:', event.error);
        };

        rec.onend = () => {
          if (isRecordingRef.current) {
            try {
              rec.start();
            } catch {}
          } else {
            setIsRecordingVoiceNote(false);
          }
        };

        recognitionVoiceNoteRef.current = rec;
        rec.start();
      } catch (e) {
        console.warn('SpeechRecognition start error:', e);
      }
    }
  };

  const stopVoiceNote = async () => {
    isRecordingRef.current = false;
    setIsRecordingVoiceNote(false);

    if (recognitionVoiceNoteRef.current) {
      try {
        recognitionVoiceNoteRef.current.stop();
      } catch {}
      recognitionVoiceNoteRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setMicAudioLevel(0);

    const hasWebSpeechResult = Boolean(finalAccumulatedRef.current.trim() || liveInterimTranscript.trim());

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Seamless Acoustic Speech Transcription fallback (e.g. for Android WebView / APK where Web Speech is absent)
    if (!hasWebSpeechResult && audioChunksRef.current.length > 0) {
      try {
        showToast('Transcribing your speech...');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          const res = await safePost<any>('/api/voice/transcribe', {
            audioData: base64data,
            mimeType: 'audio/webm',
          });
          if (res?.transcript && res.transcript.trim()) {
            const tr = res.transcript.trim();
            setInput((prev) => {
              const base = prev.trim();
              return base ? `${base} ${tr}` : tr;
            });
            showToast('Voice transcribed successfully!');
          }
        };
        reader.readAsDataURL(audioBlob);
      } catch (err) {
        console.warn('Acoustic transcription error:', err);
      }
    }

    // Polish final punctuation & capitalisation in input field
    setInput((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return '';
      let formatted = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      if (!/[.?!]$/.test(formatted) && formatted.split(' ').length > 2) {
        formatted += '.';
      }
      return formatted;
    });

    setLiveInterimTranscript('');
  };

  const toggleVoiceNote = () => {
    if (isRecordingVoiceNote) {
      stopVoiceNote();
    } else {
      startVoiceNote();
    }
  };

  // Live Camera Viewfinder & In-App Photo Capture
  const startCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    setCameraError(null);
    setCameraLoading(true);
    setCameraModalOpen(true);
    setAttachMenuOpen(false);

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera device access is not supported.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraFacing(facing);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (err: any) {
      console.warn('Camera stream error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera access in device settings.');
      } else {
        setCameraError('Could not start live camera preview. You can also pick from system files.');
      }
    } finally {
      setCameraLoading(false);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraModalOpen(false);
    setCameraError(null);
  };

  const switchCameraFacing = () => {
    const nextFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(nextFacing);
    startCamera(nextFacing);
  };

  const snapPhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setAttachedFile({
        name: `photo_${Date.now()}.jpg`,
        content: dataUrl,
      });
      showToast('Photo captured and attached to chat!');
      stopCamera();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachMenuOpen(false);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = (event.target?.result as string) || '';
        setAttachedFile({
          name: file.name,
          content: `[Image Attached: ${file.name} (${Math.round(file.size / 1024)} KB)]`,
        });
        showToast(`Image loaded: ${file.name}`);
      };
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      setAttachedFile({ name: file.name, content });
      showToast(`Attached: ${file.name}`);
    };
    reader.readAsText(file);
  };

  const handleSend = async (customText?: string) => {
    let textToSend = customText || input;
    if ((!textToSend.trim() && !attachedFile) || loading) return;

    const targetConvId = activeConvId || `conv_${Date.now()}`;
    if (!activeConvId && onSelectConv) {
      onSelectConv(targetConvId);
    }

    if (attachedFile) {
      textToSend = `[Attached Document: ${attachedFile.name}]\n${attachedFile.content.slice(0, 1500)}\n\n${textToSend}`;
    }

    setInput('');
    setAttachedFile(null);
    setLoading(true);

    const tempUserMsg: ChatMessage = {
      id: `tmp_${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const data = await safePost<any>(`/api/conversations/${targetConvId}`, {
        message: textToSend,
        think_harder: thinkHarder,
        persona: personaMode,
      }, undefined, 55000);

      if (data) {
        const botMsg: ChatMessage = {
          ...data.assistant_message,
          ...(data.mode === 'offline_local' ? { content: `Offline local mode: ${data.assistant_message.content}` } : {}),
          actionDetected: data.actionDetected,
        };

        setMessages((prev) => {
          const updated = [
            ...prev.filter((m) => m.id !== tempUserMsg.id),
            data.user_message,
            botMsg,
          ];
          const store = loadLocalConversationsStore();
          const currentConv: Conversation = store[targetConvId] || {
            id: targetConvId,
            title: data.conversationTitle || convTitle || 'New Chat',
            created_at: new Date().toISOString(),
          };
          if (data.conversationTitle) {
            currentConv.title = data.conversationTitle;
          }
          currentConv.messages = updated;
          currentConv.messageCount = updated.length;
          store[targetConvId] = currentConv;
          saveLocalConversationsStore(store);
          return updated;
        });

        if (data.conversationTitle) {
          setConvTitle(data.conversationTitle);
          setTitleInput(data.conversationTitle);
          if (onRefreshConversations) onRefreshConversations();
        }
      } else {
        setMessages((prev) => prev.filter((message) => message.id !== tempUserMsg.id));
        showToast('Online AI could not respond. Your message was not processed. Check the backend and provider connection, then retry.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`h-[calc(100vh-8.5rem)] flex flex-col rounded-2xl border ${t.cardBorder} overflow-hidden ${t.card} shadow-xl`}>
      {/* Top Header of Chat: Only Mode of Discussion, Share Button, and New Chat Button */}
      <div className={`h-12 border-b ${t.cardBorder} px-4 sm:px-6 flex items-center justify-between ${t.cardSub} shrink-0`}>
        {/* Mode of Discussion Picker */}
        <div className="flex items-center space-x-2">
          <select
            value={personaMode}
            onChange={(e) => setPersonaMode(e.target.value as any)}
            className="text-xs bg-slate-900/60 text-slate-200 font-medium border border-white/10 rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer"
            title="Mode of Discussion"
            aria-label="Mode of Discussion"
          >
            <option value="casual" className="bg-slate-900 text-white">Casual & Friendly</option>
            <option value="professional" className="bg-slate-900 text-white">Professional & Technical</option>
            <option value="creative" className="bg-slate-900 text-white">Creative & Ideation</option>
            <option value="concise" className="bg-slate-900 text-white">Concise & Direct</option>
          </select>
        </div>

        {/* Right Controls: Share Button and New Chat Button Only */}
        <div className="flex items-center space-x-2">
          {/* Share Entire Chat Button */}
          <button
            type="button"
            onClick={() => setShareModalOpen(true)}
            className={`px-3 py-1.5 rounded-xl ${t.cardSub} border ${t.cardBorder} text-slate-300 hover:text-indigo-300 hover:border-indigo-500/40 active:scale-95 transition flex items-center space-x-1.5 cursor-pointer`}
            title="Share Entire Chat"
          >
            <Share2 className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold">Share</span>
          </button>

          {/* New Chat Button */}
          {onNewChat && (
            <button
              type="button"
              onClick={onNewChat}
              className={`px-3 py-1.5 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white active:scale-95 transition flex items-center space-x-1.5 shadow-sm cursor-pointer`}
              title="Start a New Chat"
            >
              <SquarePen className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">New Chat</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Message Stream */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {/* Welcome Hero when chat is fresh */}
        {messages.length <= 1 && (
          <div className="max-w-3xl mx-auto my-4 p-5 rounded-2xl bg-gradient-to-br from-indigo-950/20 via-transparent to-purple-950/20 border border-white/10 space-y-4">
            <div className="flex items-center space-x-3">
              <div className={`w-9 h-9 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-lg`}>
                <BrainCircuit className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold">{assistantName} — Standalone Personal AI & Builder</h3>
                <p className={`text-xs ${t.textMuted}`}>
                  Adaptive reasoning, software development, multi-source research, and permanent cross-session memory.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-400">Quick Prompt Inspirations:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[
                  { text: '💬 How far! What is on your mind today?', desc: 'Casual friendly chat with full memory recall' },
                  { text: '👟 What were the custom shoes we discussed before?', desc: 'Instant recall of prior topics and preferences' },
                  { text: '🔨 Build an Android APK & Web telemetry dashboard', desc: 'Universal software builder with specialist agents' },
                  { text: '⏰ Set an alarm for 1:00 PM tomorrow', desc: 'Intelligent Chronos scheduler and reminders' },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(item.text)}
                    className={`p-2.5 rounded-xl text-left border ${t.cardBorder} ${t.cardSub} hover:${t.accentBorder} transition group space-y-1`}
                  >
                    <div className="font-semibold text-slate-200 group-hover:text-white">{item.text}</div>
                    <div className={`text-[10px] ${t.textDim}`}>{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Message Items */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const act = msg.actionDetected;

          return (
            <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-4xl mx-auto w-full group/msg`}>
              <div className={`flex items-center space-x-2 mb-1 text-[11px] ${t.textDim}`}>
                <span className="font-semibold">{isUser ? 'You' : assistantName}</span>
                <span>•</span>
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* Thought Drawer */}
              {msg.thought && (
                <div className={`max-w-2xl mb-2 p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} text-xs font-mono space-y-1`}>
                  <div className={`flex items-center space-x-1.5 font-bold uppercase text-[10px] ${t.accentText}`}>
                    <Sparkles className="w-3 h-3" />
                    <span>Reasoning Summary</span>
                  </div>
                  <pre className="whitespace-pre-wrap text-[11px] leading-relaxed opacity-90">{msg.thought}</pre>
                </div>
              )}

              {/* Message Content Bubble / Inline Edit Form */}
              {isUser && editingMsgId === msg.id ? (
                <div className="w-full max-w-2xl bg-slate-900 border border-indigo-500/60 rounded-2xl p-3.5 space-y-3 shadow-xl">
                  <div className="flex items-center justify-between text-xs text-indigo-300 font-semibold">
                    <span className="flex items-center space-x-1.5">
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Editing Your Message</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="text-slate-400 hover:text-white p-1"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-slate-950 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-indigo-500 min-h-[90px] resize-y"
                    autoFocus
                    rows={3}
                  />
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(msg.id, false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition flex items-center space-x-1"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Save</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveEdit(msg.id, true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${t.accentBg} ${t.accentBgHover} text-white shadow-sm transition flex items-center space-x-1`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Save & Resend</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onTouchStart={() => isUser ? handleTouchStartMsg(msg) : undefined}
                  onTouchEnd={handleTouchEndMsg}
                  onTouchMove={handleTouchEndMsg}
                  onContextMenu={(e) => {
                    if (isUser) {
                      e.preventDefault();
                      setContextMenuMsg(msg);
                    }
                  }}
                  className={`max-w-2xl px-4 py-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words select-text relative transition shadow-md ${
                    isUser
                      ? `${t.accentBg} text-white rounded-br-none`
                      : `${t.cardSub} ${t.textPrimary} border ${t.cardBorder} rounded-bl-none`
                  }`}
                  title={isUser ? 'Long press or right click for message options' : undefined}
                >
                  {msg.content}
                </div>
              )}

              {/* Action Toolbar Underneath Each Message: Copy, Share, Read Aloud, Edit, Delete */}
              {editingMsgId !== msg.id && (
                <div
                  className={`mt-1.5 flex items-center space-x-1 text-[11px] ${
                    isUser ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {isUser ? (
                    /* User Input Actions: Edit, Copy, Share, Delete */
                    <>
                      <button
                        type="button"
                        onClick={() => handleStartEdit(msg)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 active:scale-95 transition"
                        title="Edit what you sent"
                      >
                        <Edit2 className="w-3 h-3 text-slate-400" />
                        <span className="text-[10px]">Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyText(msg.content, msg.id)}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg active:scale-95 transition ${
                          copiedMsgId === msg.id
                            ? 'text-emerald-300 bg-emerald-500/15'
                            : 'text-slate-400 hover:text-white hover:bg-white/10'
                        }`}
                        title="Copy text"
                      >
                        {copiedMsgId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400" />
                        )}
                        <span className="text-[10px]">{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShareMessage(msg)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition"
                        title="Share this text"
                      >
                        <Share2 className="w-3 h-3 text-slate-400" />
                        <span className="text-[10px]">Share</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 active:scale-95 transition"
                        title="Delete what you sent"
                      >
                        <Trash2 className="w-3 h-3 text-slate-400" />
                        <span className="text-[10px]">Delete</span>
                      </button>
                    </>
                  ) : (
                    /* AI Output Actions: Read Aloud (volume icon), Copy, Share */
                    <>
                      <button
                        type="button"
                        onClick={() => handleToggleSpeak(msg.id, msg.content)}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg active:scale-95 transition ${
                          speakingMsgId === msg.id
                            ? 'text-purple-300 bg-purple-500/20 font-semibold border border-purple-500/30'
                            : 'text-slate-400 hover:text-purple-300 hover:bg-purple-500/10'
                        }`}
                        title={speakingMsgId === msg.id ? 'Stop audio' : 'Read aloud with volume'}
                      >
                        {speakingMsgId === msg.id ? (
                          <VolumeX className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-slate-400 hover:text-purple-400" />
                        )}
                        <span className="text-[10px]">
                          {speakingMsgId === msg.id ? 'Stop Audio' : 'Read Aloud'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyText(msg.content, msg.id)}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg active:scale-95 transition ${
                          copiedMsgId === msg.id
                            ? 'text-emerald-300 bg-emerald-500/15'
                            : 'text-slate-400 hover:text-white hover:bg-white/10'
                        }`}
                        title="Copy response"
                      >
                        {copiedMsgId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400" />
                        )}
                        <span className="text-[10px]">{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleShareMessage(msg)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 active:scale-95 transition"
                        title="Share response"
                      >
                        <Share2 className="w-3 h-3 text-slate-400" />
                        <span className="text-[10px]">Share</span>
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Embedded Project Build Action Card */}
              {act?.type === 'project_build' && act.data && (
                <div className={`mt-2.5 max-w-2xl w-full p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/20 space-y-3 shadow-lg`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                        <Hammer className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{act.data.title}</div>
                        <div className="text-[10px] text-indigo-300 font-mono">
                          Target: {act.data.targetDomain?.toUpperCase()} • {act.data.currentStage}
                        </div>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono px-2 py-0.5 rounded uppercase font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {act.data.status}
                    </span>
                  </div>

                  {/* Specialist Agent Team Status */}
                  {act.data.agents && (
                    <div className="space-y-1 pt-1">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Coordinated Specialist Agents</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
                        {act.data.agents.slice(0, 4).map((ag: any) => (
                          <div key={ag.id} className="p-1.5 rounded-lg bg-black/40 border border-white/5 space-y-1">
                            <div className="font-bold truncate text-slate-200">{ag.name.split('—')[1] || ag.name}</div>
                            <div className="text-[9px] text-emerald-400">{ag.progressPercent}% active</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Generated Deliverables Artifacts */}
                  {act.data.artifacts && act.data.artifacts.length > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
                      <div className="flex items-center space-x-1.5 text-emerald-400 font-mono text-[11px]">
                        <Package className="w-3.5 h-3.5" />
                        <span>{act.data.artifacts[0].name} ({act.data.artifacts[0].size})</span>
                      </div>
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate('projects')}
                          className={`text-xs ${t.accentText} hover:underline font-semibold flex items-center space-x-1`}
                        >
                          <span>View in Projects</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Embedded Schedule / Alarm Action Card */}
              {act?.type === 'schedule_create' && act.data && (
                <div className={`mt-2.5 max-w-2xl w-full p-4 rounded-xl border border-amber-500/30 bg-amber-950/20 space-y-2 shadow-lg`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <div>
                        <div className="text-xs font-bold text-white">{act.data.title}</div>
                        <div className="text-[10px] text-amber-300 font-mono">
                          Time: {act.data.time} • Repeat: {act.data.repeat}
                        </div>
                      </div>
                    </div>
                    {onNavigate && (
                      <button
                        onClick={() => onNavigate('scheduled')}
                        className={`text-xs text-amber-300 hover:underline font-semibold flex items-center space-x-1`}
                      >
                        <span>View in Scheduled</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className="flex items-center space-x-2 text-xs py-2 max-w-4xl mx-auto w-full px-2">
            <div className="flex items-center space-x-1">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
            </div>
            <span className="text-slate-400 text-xs font-medium ml-1.5">
              {thinkHarder ? `${assistantName} is analyzing...` : `${assistantName} is thinking...`}
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Controls */}
      <div className={`p-3.5 border-t ${t.cardBorder} ${t.cardSub} space-y-2 shrink-0`}>
        {/* Attached Document Pill */}
        {attachedFile && (
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 text-xs w-fit">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-medium truncate max-w-xs">{attachedFile.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Voice Note Error Banner */}
        {voiceNoteError && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs shadow-md animate-in fade-in">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{voiceNoteError}</span>
            </div>
            <button
              type="button"
              onClick={() => setVoiceNoteError(null)}
              className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Voice Note Recording Live Pulse & Streaming Transcript Bar */}
        {isRecordingVoiceNote && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-950/70 via-slate-900 to-indigo-950/50 border border-emerald-500/40 text-emerald-300 text-xs shadow-lg animate-in fade-in duration-150">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                <span className="absolute w-5 h-5 rounded-full bg-emerald-500/30 animate-ping" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </div>

              {/* Audio Wave Meter */}
              <div className="flex items-center space-x-0.5 h-3.5 shrink-0">
                {[20, 55, 85, 45, 75, 30].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                    style={{
                      height: `${Math.max(4, Math.round((h * (micAudioLevel > 0 ? micAudioLevel : 35)) / 100))}px`,
                    }}
                  />
                ))}
              </div>

              <div className="truncate">
                <span className="font-semibold text-white">Listening: </span>
                <span className="text-emerald-200 font-medium">
                  {liveInterimTranscript || input || 'Speak naturally into your microphone...'}
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setInput(baseInputRef.current);
                  stopVoiceNote();
                }}
                className="px-2 py-1 rounded-md text-[11px] bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={stopVoiceNote}
                className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition shadow"
              >
                Done Speaking
              </button>
            </div>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isRecordingVoiceNote) {
              stopVoiceNote();
            }
            handleSend();
          }}
          className={`flex items-center space-x-2 ${t.card} border ${t.inputBorder} rounded-xl px-3 py-1.5 shadow-inner`}
        >
          {/* Hidden File Input for Documents */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.json,.ts,.js,.py,.pdf,.csv,.doc,.docx"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Hidden File Input for Gallery / Media */}
          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Hidden File Input for Native Camera Capture */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Paperclip / Attachment Button with Native Device Sheet Trigger */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAttachMenuOpen((prev) => !prev)}
              className={`p-1.5 rounded-lg transition ${
                attachMenuOpen
                  ? 'text-indigo-300 bg-indigo-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title="Attach Document, Photo, Camera or Media"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Native Mobile Attachment Options Sheet */}
            {attachMenuOpen && (
              <div
                className="absolute bottom-10 left-0 z-50 w-52 rounded-2xl bg-slate-900 border border-slate-750 shadow-2xl p-2 space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Attach to Chat
                </div>

                {/* 1. Camera Option */}
                <button
                  type="button"
                  onClick={() => {
                    startCamera();
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition"
                >
                  <Camera className="w-4 h-4 text-emerald-400" />
                  <span>Take Photo (Camera)</span>
                </button>

                {/* 2. Media & Photos Option */}
                <button
                  type="button"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    mediaInputRef.current?.click();
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition"
                >
                  <ImageIcon className="w-4 h-4 text-sky-400" />
                  <span>Media & Gallery</span>
                </button>

                {/* 3. Document / Code Option */}
                <button
                  type="button"
                  onClick={() => {
                    setAttachMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition"
                >
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>Document or File</span>
                </button>
              </div>
            )}
          </div>

          {/* Main Chat Input Field */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask ${assistantName} anything, discuss shoes, build apps, or schedule tasks...`}
            className="flex-1 bg-transparent text-xs placeholder-slate-500 focus:outline-none py-1.5"
          />

          {/* Voice Note Microphone Button */}
          <button
            type="button"
            onClick={toggleVoiceNote}
            className={`p-1.5 sm:p-2 rounded-xl transition flex items-center justify-center relative ${
              isRecordingVoiceNote
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30 scale-105'
                : 'text-slate-400 hover:text-white hover:bg-white/5 active:scale-95'
            }`}
            title={isRecordingVoiceNote ? 'Stop Recording Voice Note (Done)' : 'Click to Speak (Voice-to-Text)'}
          >
            {isRecordingVoiceNote ? (
              <>
                <Mic className="w-4 h-4 animate-pulse text-slate-950" />
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping" />
              </>
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>

          {/* Quick Live Voice Launch Button */}
          {onOpenLiveVoice && (
            <button
              type="button"
              onClick={onOpenLiveVoice}
              className="p-1.5 rounded-lg text-slate-400 hover:text-purple-400 transition"
              title="Launch Live Voice Dialogue"
            >
              <PhoneCall className="w-4 h-4" />
            </button>
          )}

          {/* Send Button */}
          <button
            type="submit"
            disabled={(!input.trim() && !attachedFile) || loading}
            className={`p-2 rounded-lg ${t.accentBg} text-white transition disabled:opacity-40 shadow-sm`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Mobile Long-Press / Options Modal */}
      {contextMenuMsg && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-3 sm:p-4"
          onClick={() => setContextMenuMsg(null)}
        >
          <div
            className={`w-full max-w-sm ${t.card} border ${t.cardBorder} rounded-2xl p-4 space-y-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="text-xs font-bold text-slate-300">Message Options</div>
              <button
                type="button"
                onClick={() => setContextMenuMsg(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {contextMenuMsg.role === 'user' && (
                <button
                  type="button"
                  onClick={() => handleStartEdit(contextMenuMsg)}
                  className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 transition"
                >
                  <Edit2 className="w-4 h-4 text-indigo-400" />
                  <span>Edit Message</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  handleCopyText(contextMenuMsg.content, contextMenuMsg.id);
                  setContextMenuMsg(null);
                }}
                className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 transition"
              >
                <Copy className="w-4 h-4 text-emerald-400" />
                <span>Copy Text</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  handleShareMessage(contextMenuMsg);
                  setContextMenuMsg(null);
                }}
                className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 transition"
              >
                <Share2 className="w-4 h-4 text-blue-400" />
                <span>Share Message</span>
              </button>

              {contextMenuMsg.role === 'assistant' && (
                <button
                  type="button"
                  onClick={() => {
                    handleToggleSpeak(contextMenuMsg.id, contextMenuMsg.content);
                    setContextMenuMsg(null);
                  }}
                  className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:bg-white/10 transition"
                >
                  {speakingMsgId === contextMenuMsg.id ? (
                    <VolumeX className="w-4 h-4 text-purple-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-purple-400" />
                  )}
                  <span>{speakingMsgId === contextMenuMsg.id ? 'Stop Audio' : 'Read Aloud'}</span>
                </button>
              )}

              {contextMenuMsg.role === 'user' && (
                <button
                  type="button"
                  onClick={() => handleDeleteMessage(contextMenuMsg.id)}
                  className="w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-rose-300 hover:bg-rose-500/15 transition"
                >
                  <Trash2 className="w-4 h-4 text-rose-400" />
                  <span>Delete Message</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live In-App Camera Viewfinder Modal */}
      {cameraModalOpen && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
          onClick={stopCamera}
        >
          <div
            className="relative w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col items-center animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Bar */}
            <div className="w-full px-4 py-3 bg-slate-900/90 border-b border-white/10 flex items-center justify-between z-10">
              <div className="flex items-center space-x-2">
                <Camera className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white tracking-wide">Live Camera Viewfinder</span>
              </div>
              <button
                type="button"
                onClick={stopCamera}
                className="p-1.5 rounded-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition"
                title="Close Camera"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Viewfinder Video */}
            <div className="relative w-full aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
              {cameraLoading && (
                <div className="flex flex-col items-center space-y-2 text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                  <span className="text-xs">Starting camera...</span>
                </div>
              )}
              {cameraError && (
                <div className="p-4 text-center space-y-3">
                  <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
                  <p className="text-xs text-rose-200">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      stopCamera();
                      cameraInputRef.current?.click();
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition"
                  >
                    Open System Camera App
                  </button>
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraError ? 'hidden' : ''}`}
              />
            </div>

            {/* Bottom Controls */}
            <div className="w-full p-4 bg-slate-900/95 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={switchCameraFacing}
                className="p-3 rounded-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 transition"
                title="Flip Camera (Front / Rear)"
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              {/* Shutter Button */}
              <button
                type="button"
                onClick={snapPhoto}
                disabled={cameraLoading || Boolean(cameraError)}
                className="w-16 h-16 rounded-full border-4 border-white bg-emerald-500 hover:bg-emerald-400 active:scale-90 transition flex items-center justify-center shadow-lg shadow-emerald-500/30 disabled:opacity-50"
                title="Snap Photo"
              >
                <div className="w-12 h-12 rounded-full border-2 border-slate-950 bg-white" />
              </button>

              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  cameraInputRef.current?.click();
                }}
                className="p-3 rounded-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 active:scale-95 transition"
                title="Open Phone Camera / Gallery Picker"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Native Mobile Permission Dialog (Mic / Audio Access) */}
      {micPermissionModalOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setMicPermissionModalOpen(false)}
        >
          <div
            className={`w-full max-w-sm ${t.card} border ${t.cardBorder} rounded-2xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Microphone Permission</h3>
                <p className="text-[11px] text-slate-400">Allow {assistantName} to record voice notes & transcribe speech</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              To record voice notes, transcribe speech, and converse naturally, this app requests microphone permission on your device.
            </p>

            <div className="flex items-center space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setMicPermissionModalOpen(false)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 transition"
              >
                Don't Allow
              </button>
              <button
                type="button"
                onClick={async () => {
                  setMicPermissionModalOpen(false);
                  try {
                    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                      stream.getTracks().forEach((track) => track.stop());
                      showToast('Microphone permission granted!');
                      startVoiceNote();
                    }
                  } catch (e) {
                    showToast('Please enable microphone in your device settings.');
                  }
                }}
                className={`flex-1 py-2 rounded-xl text-xs font-bold text-white ${t.accentBg} hover:brightness-110 transition shadow`}
              >
                Allow Permission
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Toast */}
      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-slate-900 border border-white/20 text-white text-xs px-3.5 py-2 rounded-xl shadow-2xl flex items-center space-x-2 z-50 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Share Chat Sheet Modal for current active conversation */}
      <ShareChatModal
        t={t}
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        conversationId={activeConvId}
        conversationTitle={convTitle}
        assistantName={assistantName}
        preloadedMessages={messages}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// 6. Live Voice View (Human Voice Personas, 2.5s Pause Detection & Full-Duplex Barge-In)
// -----------------------------------------------------------------------------
function LiveVoiceView({
  t,
  assistantName,
  voiceEnabled,
  onClose,
}: {
  t: ThemeConfig;
  assistantName: string;
  voiceEnabled: boolean;
  onClose?: () => void;
}) {
  const [active, setActive] = useState(true);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [pendingUserSpeech, setPendingUserSpeech] = useState('');
  const [audioLevel, setAudioLevel] = useState(0); // 0 to 100 volume meter
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ sender: 'user' | 'assistant'; text: string; time: string }>>([]);
  const [quickPrompt, setQuickPrompt] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState<'all' | 'female' | 'male'>('all');

  const [voiceSpeed, setVoiceSpeed] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('rare_voice_speed') || '0.96');
      return isNaN(v) ? 0.96 : v;
    } catch {
      return 0.96;
    }
  });

  const [voicePitch, setVoicePitch] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('rare_voice_pitch') || '1.0');
      return isNaN(v) ? 1.0 : v;
    } catch {
      return 1.0;
    }
  });

  const [autoConnect, setAutoConnect] = useState<boolean>(() => {
    try {
      return localStorage.getItem('rare_voice_auto_connect') !== 'false';
    } catch {
      return true;
    }
  });

  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(() => {
    try {
      return localStorage.getItem('rare_voice_persona') || 'aria_warm';
    } catch {
      return 'aria_warm';
    }
  });

  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const activeRef = useRef(true);
  const isMutedRef = useRef(false);
  const selectedPersonaRef = useRef(selectedPersonaId);
  const accumulatedSpeechRef = useRef('');
  const latestInterimRef = useRef('');
  const silenceTimerRef = useRef<any>(null);
  const callTimerRef = useRef<any>(null);

  isSpeakingRef.current = isSpeaking;
  isProcessingRef.current = isProcessing;
  activeRef.current = active;
  isMutedRef.current = isMuted;
  selectedPersonaRef.current = selectedPersonaId;

  const selectedPersona: VoicePersona =
    HUMAN_VOICE_PERSONAS.find((p) => p.id === selectedPersonaId) || HUMAN_VOICE_PERSONAS[0];

  const handleSelectPersona = (id: string, preview = false) => {
    setSelectedPersonaId(id);
    selectedPersonaRef.current = id;
    try {
      localStorage.setItem('rare_voice_persona', id);
    } catch {}
    if (preview) {
      const p = HUMAN_VOICE_PERSONAS.find((item) => item.id === id) || HUMAN_VOICE_PERSONAS[0];
      setIsSpeaking(true);
      speakWithHumanVoice(p.sampleLine, id, {
        pitch: voicePitch,
        rate: voiceSpeed,
        onEnd: () => setIsSpeaking(false),
      });
    }
  };

  const handleSpeedChange = (val: number) => {
    setVoiceSpeed(val);
    try {
      localStorage.setItem('rare_voice_speed', String(val));
    } catch {}
  };

  const handlePitchChange = (val: number) => {
    setVoicePitch(val);
    try {
      localStorage.setItem('rare_voice_pitch', String(val));
    } catch {}
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;
    if (nextMuted) {
      clearSilenceTimer();
      setInterimText('');
      setPendingUserSpeech('');
      setAudioLevel(0);
    }
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  // Speak aloud using the selected natural Human Voice Persona
  const speakAloud = (text: string, onDone?: () => void) => {
    setIsSpeaking(true);
    isSpeakingRef.current = true;

    speakWithHumanVoice(text, selectedPersonaRef.current, {
      pitch: voicePitch,
      rate: voiceSpeed,
      onStart: () => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
      },
      onEnd: () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (onDone) onDone();
        // Ensure recognition is actively listening for the user's next turn unless muted
        if (activeRef.current && !isMutedRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {}
        }
      },
    });
  };

  // Interrupt AI speech immediately (Barge-In) and listen to user
  const handleInterruptAssistant = () => {
    stopHumanVoice();
    setIsSpeaking(false);
    isSpeakingRef.current = false;
    if (activeRef.current && !isMutedRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {}
    }
  };

  // Process user speech after pause (or immediate send) and query assistant
  const handleUserSpokenInput = async (spokenText: string) => {
    const cleaned = spokenText.trim();
    if (!cleaned || isProcessingRef.current) return;

    clearSilenceTimer();
    accumulatedSpeechRef.current = '';
    latestInterimRef.current = '';
    setInterimText('');
    setPendingUserSpeech('');

    // If assistant was speaking, interrupt immediately
    if (isSpeakingRef.current) {
      stopHumanVoice();
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    }

    setIsProcessing(true);
    isProcessingRef.current = true;

    const userEntry = {
      sender: 'user' as const,
      text: cleaned,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setTranscript((prev) => [...prev, userEntry]);

    try {
      
      const data = await safePost<any>('/api/voice/chat', {
        speech: cleaned,
        recentMessages: transcript.slice(-10).map((message) => ({
          role: message.sender === 'assistant' ? 'assistant' : 'user',
          content: message.text.slice(0, 800),
        })),
      });

      let replyText = data?.mode === 'offline_local'
        ? `Offline local mode: ${data.reply || ''}`
        : data?.reply;

      if (!replyText) {
        throw new Error('Online voice response is unavailable.');
      }


      const botEntry = {
        sender: 'assistant' as const,
        text: replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
      setTranscript((prev) => [...prev, botEntry]);

      // Speak back the response in the selected human voice
      speakAloud(replyText);
    } catch {
      setTranscript((prev) => [
        ...prev,
        { sender: 'assistant', text: 'Online voice response is unavailable. No AI reply was generated; please retry when the provider connection is restored.', time: new Date().toLocaleTimeString() },
      ]);
    } finally {
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  };

  const flushAccumulatedSpeech = () => {
    const combined = `${accumulatedSpeechRef.current} ${latestInterimRef.current}`.replace(/\s+/g, ' ').trim();
    if (combined) {
      handleUserSpokenInput(combined);
    }
  };

  // Schedule 2.5-second natural pause detection before sending user's turn
  const scheduleTurnAfterSilence = () => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      flushAccumulatedSpeech();
    }, 2500);
  };

  // Start real microphone audio visualizer
  const startAudioMeter = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        if (isMutedRef.current) {
          setAudioLevel(0);
        } else {
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        }
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch {
      // AudioContext or mic access blocked; fallback gracefully
    }
  };

  const stopAudioMeter = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  // Initialize and start Full-Duplex Speech Recognition with 2.5s Pause Detection & Barge-In
  const startListening = () => {
    setPermissionError(null);
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      setPermissionError('Speech Recognition is not natively supported by this browser. You can use the Voice Input box below.');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        if (isMutedRef.current) return;

        let interim = '';
        let finalPhrase = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const trans = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalPhrase += trans + ' ';
          } else {
            interim += trans;
          }
        }

        const newlyHeard = `${finalPhrase} ${interim}`.trim();

        // Full-Duplex Barge-In: If RARE is speaking and the user speaks to interrupt
        if (isSpeakingRef.current && newlyHeard) {
          const isExplicitInterrupt = /\b(stop|wait|hold on|keep quiet|be quiet|no|actually|listen|pause|sorry)\b/i.test(newlyHeard);
          const wordCount = newlyHeard.split(/\s+/).length;
          if (isExplicitInterrupt || wordCount >= 2) {
            stopHumanVoice();
            setIsSpeaking(false);
            isSpeakingRef.current = false;
          } else {
            return;
          }
        }

        if (finalPhrase.trim()) {
          accumulatedSpeechRef.current = `${accumulatedSpeechRef.current} ${finalPhrase.trim()}`.trim();
        }
        latestInterimRef.current = interim.trim();

        const fullLive = `${accumulatedSpeechRef.current} ${latestInterimRef.current}`.trim();
        setInterimText(fullLive);
        setPendingUserSpeech(fullLive);

        if (fullLive) {
          scheduleTurnAfterSilence();
        }
      };

      rec.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          setPermissionError('Microphone access was denied. Please allow microphone permissions in your browser or device settings.');
          setIsListening(false);
        }
      };

      rec.onend = () => {
        setIsListening(false);
        if (activeRef.current && !isMutedRef.current) {
          try {
            rec.start();
          } catch {}
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      setPermissionError('Could not initialize microphone. Please check browser permissions.');
    }
  };

  const stopListening = () => {
    clearSilenceTimer();
    accumulatedSpeechRef.current = '';
    latestInterimRef.current = '';
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterimText('');
    setPendingUserSpeech('');
  };

  // Start Call Session immediately upon opening (just like picking up a call)
  const startCallSession = async () => {
    setActive(true);
    activeRef.current = true;
    setIsMuted(false);
    isMutedRef.current = false;
    setCallDuration(0);

    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    startAudioMeter();
    startListening();

    // Natural greeting spoken immediately
    const greetingResult = await safePost<any>('/api/voice/chat', {
  speech: 'Hello',
  isGreeting: true,
  recentMessages: transcript.slice(-10).map((message) => ({
    role: message.sender === 'assistant' ? 'assistant' : 'user',
    content: message.text.slice(0, 800),
  })),
});

const naturalGreeting =
  typeof greetingResult?.reply === 'string' &&
  greetingResult.reply.trim()
    ? greetingResult.reply.trim()
    : await generateNaturalCallGreeting();
    if (!activeRef.current) return;

    setTranscript([
      {
        sender: 'assistant',
        text: naturalGreeting,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      },
    ]);

    speakAloud(naturalGreeting);
  };

  // End Call Session
  const endCallSession = () => {
    setActive(false);
    activeRef.current = false;
    setIsMuted(false);
    isMutedRef.current = false;
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    stopListening();
    stopAudioMeter();
    stopHumanVoice();
    setIsSpeaking(false);
    setIsProcessing(false);
  };

  // Connect on mount ONLY if autoConnect is enabled. If manual mode (autoConnect is false), require explicit user tap to start.
  useEffect(() => {
    let isMounted = true;
    if (autoConnect) {
      const connectImmediate = async () => {
        setIsConnecting(true);
        await startCallSession();
        if (isMounted) setIsConnecting(false);
      };
      connectImmediate();
    } else {
      setActive(false);
      activeRef.current = false;
      setIsConnecting(false);
    }

    return () => {
      isMounted = false;
      activeRef.current = false;
      if (callTimerRef.current) clearInterval(callTimerRef.current);
      stopListening();
      stopAudioMeter();
      stopHumanVoice();
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const rawVoiceState: 'idle' | 'listening' | 'processing' | 'speaking' = !active
    ? 'idle'
    : isProcessing
    ? 'processing'
    : isSpeaking
    ? 'speaking'
    : 'listening';

  const filteredPersonas = HUMAN_VOICE_PERSONAS.filter((p) => {
    if (voiceFilter === 'all') return true;
    return p.gender === voiceFilter;
  });

  return (
    <div className="relative w-full h-full flex flex-col justify-between max-w-3xl mx-auto py-2 px-1 sm:px-4">
      {/* 1. Phone Call Header with Status, Timer, Voice Badge & Settings Gear */}
      <div className="w-full flex items-center justify-between border-b border-white/10 pb-3">
        {/* Left: Call State & Duration */}
        <div className="flex items-center space-x-2.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-white tracking-wide">
                {isConnecting ? 'Connecting...' : 'Active Call'}
              </span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                {formatDuration(callDuration)}
              </span>
            </div>
            <span className={`text-[10px] ${t.textDim}`}>
              Full-Duplex Natural Voice • {assistantName}
            </span>
          </div>
        </div>

        {/* Center: Selected Voice Pill (Click to open settings) */}
        <button
          type="button"
          onClick={() => setVoiceSettingsOpen(true)}
          className="hidden sm:flex items-center space-x-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25 transition cursor-pointer text-xs"
          title="Click to change natural voice persona and speech settings"
        >
          <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold">{selectedPersona.name}</span>
          <span className="text-[10px] opacity-75">
            ({selectedPersona.gender === 'female' ? 'Female' : 'Male'} • {selectedPersona.style})
          </span>
        </button>

        {/* Right: Settings Gear & End Call Button */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setVoiceSettingsOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700/80 text-slate-200 hover:text-white hover:border-indigo-400 hover:bg-slate-800 transition cursor-pointer text-xs font-semibold shadow-sm"
            title="Voice Persona & Audio Settings"
          >
            <SettingsIcon className="w-4 h-4 text-indigo-400" />
            <span className="hidden xs:inline">Voice Settings</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={() => {
                endCallSession();
                onClose();
              }}
              className="p-1.5 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 transition cursor-pointer"
              title="Hang up and close"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Permission / Status Banner */}
      {permissionError && (
        <div className="w-full mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center space-x-2">
          <Info className="w-4 h-4 shrink-0 text-amber-400" />
          <span>{permissionError}</span>
        </div>
      )}

      {/* 2. Main Acoustic Call Visualizer Stage */}
      <div className="relative flex flex-col items-center justify-center py-6 sm:py-10 min-h-[260px] my-auto">
        {/* Dynamic Halos */}
        {rawVoiceState === 'listening' && (
          <>
            <div
              className="absolute rounded-full bg-emerald-500/25 blur-3xl transition-all duration-300 pointer-events-none"
              style={{
                width: `${190 + audioLevel * 1.8}px`,
                height: `${190 + audioLevel * 1.8}px`,
              }}
            />
            <div
              className="absolute rounded-full border border-emerald-400/40 animate-ping duration-1500 pointer-events-none"
              style={{
                width: `${160 + (audioLevel > 10 ? audioLevel * 1.2 : 20)}px`,
                height: `${160 + (audioLevel > 10 ? audioLevel * 1.2 : 20)}px`,
              }}
            />
            <div
              className="absolute rounded-full border-2 border-emerald-400/20 pointer-events-none animate-pulse"
              style={{
                width: `${220 + audioLevel}px`,
                height: `${220 + audioLevel}px`,
              }}
            />
          </>
        )}

        {rawVoiceState === 'processing' && (
          <>
            <div className="absolute w-64 h-64 rounded-full bg-amber-500/30 blur-3xl animate-pulse pointer-events-none duration-1000" />
            <div className="absolute w-52 h-52 rounded-full border-2 border-dashed border-amber-400/70 animate-spin pointer-events-none duration-3000" />
            <div className="absolute w-44 h-44 rounded-full border-2 border-dotted border-orange-400/60 animate-spin pointer-events-none duration-5000 [animation-direction:reverse]" />
          </>
        )}

        {rawVoiceState === 'speaking' && (
          <>
            <div className="absolute w-64 h-64 rounded-full bg-purple-500/35 blur-3xl animate-pulse pointer-events-none duration-700" />
            <div className="absolute w-52 h-52 rounded-full border-2 border-purple-400/70 animate-ping pointer-events-none duration-1000" />
            <div className="absolute w-56 h-56 rounded-full border border-pink-400/50 animate-pulse pointer-events-none" />
          </>
        )}

        {rawVoiceState === 'idle' && (
          <div className="absolute w-36 h-36 rounded-full bg-slate-500/10 blur-xl pointer-events-none" />
        )}

        {/* Central Audio Orb Button */}
        <button
          onClick={() => {
            if (active && isSpeaking) {
              handleInterruptAssistant();
            } else if (active && pendingUserSpeech) {
              flushAccumulatedSpeech();
            } else if (!active) {
              startCallSession();
            }
          }}
          className={`w-36 h-36 sm:w-44 sm:h-44 rounded-full border-2 flex flex-col items-center justify-center transition-all duration-500 shadow-2xl relative z-10 cursor-pointer ${
            rawVoiceState === 'listening'
              ? audioLevel > 15
                ? 'bg-gradient-to-tr from-emerald-600 via-teal-600 to-emerald-500 border-emerald-300 text-white shadow-emerald-500/60 scale-105'
                : 'bg-gradient-to-tr from-emerald-700 via-teal-700 to-emerald-600 border-emerald-400 text-white shadow-emerald-500/40'
              : rawVoiceState === 'processing'
              ? 'bg-gradient-to-tr from-amber-600 via-orange-600 to-amber-500 border-amber-300 text-white shadow-amber-500/60 animate-pulse'
              : rawVoiceState === 'speaking'
              ? 'bg-gradient-to-tr from-purple-600 via-violet-600 to-fuchsia-600 border-purple-300 text-white shadow-purple-500/70 scale-105'
              : `${t.cardBorder} ${t.card} text-slate-400 hover:text-slate-200`
          }`}
          title={
            active && isSpeaking
              ? 'Tap to interrupt speech'
              : active && pendingUserSpeech
              ? 'Tap to send speech immediately'
              : 'Microphone active'
          }
        >
          {rawVoiceState === 'listening' && (
            <div className="relative">
              <Mic className={`w-12 h-12 sm:w-14 sm:h-14 text-white transition-transform ${audioLevel > 15 ? 'scale-115' : 'scale-100'}`} />
              {audioLevel > 15 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"></span>
                </span>
              )}
            </div>
          )}

          {rawVoiceState === 'processing' && (
            <div className="relative flex items-center justify-center">
              <BrainCircuit className="w-12 h-12 sm:w-14 sm:h-14 text-white animate-spin duration-3000" />
              <Sparkles className="w-5 h-5 text-amber-200 absolute -top-1 -right-1 animate-ping" />
            </div>
          )}

          {rawVoiceState === 'speaking' && (
            <div className="relative flex items-center justify-center">
              <Volume2 className="w-12 h-12 sm:w-14 sm:h-14 text-white animate-bounce" />
              <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-300 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-fuchsia-400"></span>
              </span>
            </div>
          )}

          {rawVoiceState === 'idle' && (
            <Mic className="w-12 h-12 sm:w-14 sm:h-14 text-slate-400" />
          )}

          {/* Subtitle Badge */}
          <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider mt-2 px-2.5 py-0.5 rounded-full bg-black/35 backdrop-blur-xs">
            {rawVoiceState === 'listening'
              ? pendingUserSpeech
                ? 'Tap to Send'
                : audioLevel > 15
                ? 'Hearing Voice'
                : 'Listening...'
              : rawVoiceState === 'processing'
              ? 'Thinking...'
              : rawVoiceState === 'speaking'
              ? 'Tap to Interrupt'
              : 'Call Ended'}
          </span>
        </button>

        {/* Live Audio Equalizer Bars */}
        {active && (
          <div className="flex items-center space-x-1.5 mt-5 h-7">
            {[0.4, 0.7, 1.1, 0.8, 1.3, 0.6, 1.0, 1.2, 0.5, 0.9, 1.1, 0.7, 1.0, 0.5].map((mult, idx) => {
              let barHeight = 4;
              let barColor = 'bg-slate-700';

              if (rawVoiceState === 'listening') {
                barHeight = Math.max(4, Math.min(28, Math.round((audioLevel * mult * 0.4) + 5)));
                barColor = 'bg-gradient-to-t from-emerald-500 to-teal-300';
              } else if (rawVoiceState === 'processing') {
                const phase = (Date.now() / 200 + idx * 0.5) % Math.PI;
                barHeight = Math.max(6, Math.round(12 + Math.sin(phase) * 8 * mult));
                barColor = 'bg-gradient-to-t from-amber-500 to-orange-300 animate-pulse';
              } else if (rawVoiceState === 'speaking') {
                barHeight = Math.max(8, Math.round(16 * mult + ((idx % 3) * 3)));
                barColor = 'bg-gradient-to-t from-purple-500 to-fuchsia-300';
              }

              return (
                <div
                  key={idx}
                  className={`w-1 rounded-full transition-all duration-100 ${barColor}`}
                  style={{ height: `${barHeight}px` }}
                />
              );
            })}
          </div>
        )}

        {/* Dynamic Status Pill */}
        <div className="mt-4 flex items-center space-x-2 px-3.5 py-1.5 rounded-full border text-xs bg-slate-900/60 border-slate-800 text-slate-300">
          <span
            className={`w-2 h-2 rounded-full ${
              rawVoiceState === 'listening'
                ? 'bg-emerald-400 animate-pulse'
                : rawVoiceState === 'processing'
                ? 'bg-amber-400 animate-ping'
                : rawVoiceState === 'speaking'
                ? 'bg-purple-400 animate-bounce'
                : 'bg-slate-500'
            }`}
          />
          <span className="font-semibold">
            {rawVoiceState === 'listening'
              ? isMuted
                ? 'Microphone Muted'
                : 'Microphone Active — Listening for your voice'
              : rawVoiceState === 'processing'
              ? `${assistantName} is formulating natural response...`
              : rawVoiceState === 'speaking'
              ? `${assistantName} is speaking (${selectedPersona.name})`
              : 'Voice Session Finished'}
          </span>
        </div>
      </div>

      {/* 3. Interim User Speech Subtitle Banner (Waiting 2.5s pause or instant tap) */}
      {active && interimText && (
        <div className="w-full mb-3 p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/50 text-xs text-emerald-200 flex items-center justify-between gap-3 shadow-lg shadow-emerald-950/30 animate-in fade-in">
          <div className="flex items-center space-x-2.5 min-w-0">
            <Mic className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
            <div className="truncate">
              <span className="font-bold text-emerald-300 mr-1.5">Hearing:</span>
              <span className="italic">"{interimText}"</span>
            </div>
          </div>
          <button
            type="button"
            onClick={flushAccumulatedSpeech}
            className="px-3 py-1 rounded-lg bg-emerald-400 text-slate-950 font-bold text-[11px] shrink-0 hover:bg-emerald-300 transition cursor-pointer"
          >
            Reply Now
          </button>
        </div>
      )}

      {/* 4. Phone Call Action Bar (Mute, Voice Settings, Transcript & Big Red End Call Button) */}
      <div className="w-full border-t border-white/10 pt-3 flex flex-wrap items-center justify-center gap-2.5 sm:gap-4">
        {/* Mute Toggle */}
        <button
          type="button"
          onClick={toggleMute}
          className={`px-3.5 py-2.5 rounded-2xl border flex items-center space-x-2 text-xs font-semibold transition cursor-pointer ${
            isMuted
              ? 'bg-rose-500/25 border-rose-500/60 text-rose-300 ring-1 ring-rose-500/40'
              : `${t.card} ${t.cardBorder} text-slate-300 hover:text-white hover:border-white/20`
          }`}
          title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-emerald-400" />}
          <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
        </button>

        {/* Voice Persona Settings Trigger */}
        <button
          type="button"
          onClick={() => setVoiceSettingsOpen(true)}
          className={`px-3.5 py-2.5 rounded-2xl border ${t.card} ${t.cardBorder} text-slate-300 hover:text-white hover:border-indigo-400 transition cursor-pointer flex items-center space-x-2 text-xs font-semibold`}
          title="Choose Voice Persona & Tone"
        >
          <Sliders className="w-4 h-4 text-indigo-400" />
          <span>Voice: {selectedPersona.name}</span>
        </button>

        {/* Transcript Drawer Toggle */}
        <button
          type="button"
          onClick={() => setTranscriptOpen(!transcriptOpen)}
          className={`px-3.5 py-2.5 rounded-2xl border flex items-center space-x-2 text-xs font-semibold transition cursor-pointer ${
            transcriptOpen
              ? 'bg-indigo-600/30 border-indigo-400 text-indigo-200 shadow-sm ring-1 ring-indigo-400/40'
              : `${t.card} ${t.cardBorder} text-slate-300 hover:text-white`
          }`}
          title="Toggle Spoken Transcript"
        >
          <MessageSquare className="w-4 h-4 text-indigo-300" />
          <span>Transcript ({transcript.length})</span>
        </button>

        {/* End Call Button */}
        <button
          type="button"
          onClick={() => {
            endCallSession();
            onClose?.();
          }}
          className="px-6 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wider uppercase transition shadow-lg shadow-rose-950/60 flex items-center space-x-2 cursor-pointer"
          title="Hang up and terminate call session"
        >
          <PhoneOff className="w-4 h-4" />
          <span>End Call</span>
        </button>
      </div>

      {/* 5. Collapsible Transcript History Stream */}
      {transcriptOpen && (
        <div className={`w-full mt-3 ${t.card} border ${t.cardBorder} rounded-2xl p-4 font-mono text-xs space-y-2 max-h-48 overflow-y-auto animate-in fade-in`}>
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5 font-sans">
            <span className="text-[11px] font-bold text-white flex items-center space-x-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Call Dialogue Transcript</span>
            </span>
            <span className="text-[10px] text-slate-400">{transcript.length} turns recorded</span>
          </div>

          {transcript.length === 0 && (
            <div className={`text-xs ${t.textDim} py-3 text-center italic font-sans`}>
              No turns yet. Speak into your microphone to begin dialogue.
            </div>
          )}

          {transcript.map((item, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center space-x-2 text-[10px]">
                <span className={`font-bold ${item.sender === 'user' ? 'text-indigo-400' : 'text-emerald-400'}`}>
                  {item.sender === 'user' ? 'You' : `${assistantName} (${selectedPersona.name})`}:
                </span>
                <span className={t.textDim}>{item.time}</span>
              </div>
              <div className={`text-xs pl-2 font-sans leading-relaxed ${item.sender === 'user' ? t.textPrimary : 'text-slate-200'}`}>
                {item.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 6. Quick Push-to-Talk Fallback */}
      <div className="w-full mt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (quickPrompt.trim()) {
              handleUserSpokenInput(quickPrompt);
              setQuickPrompt('');
            }
          }}
          className={`flex items-center space-x-2 ${t.card} border ${t.inputBorder} rounded-xl px-3 py-1.5`}
        >
          <input
            type="text"
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            placeholder="Type a spoken turn if mic is unavailable..."
            className="flex-1 bg-transparent text-xs placeholder-slate-500 focus:outline-none py-1"
          />
          <button
            type="submit"
            disabled={!quickPrompt.trim() || isProcessing}
            className={`px-3 py-1 rounded-lg ${t.accentBg} text-white text-xs font-semibold disabled:opacity-40 transition cursor-pointer`}
          >
            Send Spoken Turn
          </button>
        </form>
      </div>

      {/* 7. Dedicated Voice Settings Modal (Anti-Robotic Engine, 12 Human Personas, Speed & Tone Controls) */}
      {voiceSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
          <div className="relative w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Voice & Audio Settings</h3>
                  <p className={`text-xs ${t.textDim}`}>
                    Natural human conversational engine • Robotic synthesizers filtered out
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVoiceSettingsOpen(false)}
                className="p-2 rounded-full bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close Voice Settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Voice Category Filter Tabs */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">
                  Select Natural Voice ({HUMAN_VOICE_PERSONAS.length} Total Variations)
                </span>
                <div className="flex items-center space-x-1 p-1 rounded-xl bg-black/50 border border-white/10 text-xs">
                  <button
                    type="button"
                    onClick={() => setVoiceFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                      voiceFilter === 'all'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All ({HUMAN_VOICE_PERSONAS.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceFilter('female')}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                      voiceFilter === 'female'
                        ? 'bg-pink-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Female ({HUMAN_VOICE_PERSONAS.filter((p) => p.gender === 'female').length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setVoiceFilter('male')}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                      voiceFilter === 'male'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Male ({HUMAN_VOICE_PERSONAS.filter((p) => p.gender === 'male').length})
                  </button>
                </div>
              </div>

              {/* Personas Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredPersonas.map((vp) => {
                  const isSel = vp.id === selectedPersonaId;
                  return (
                    <div
                      key={vp.id}
                      onClick={() => handleSelectPersona(vp.id, false)}
                      className={`p-3 rounded-2xl border transition cursor-pointer flex flex-col justify-between ${
                        isSel
                          ? 'bg-indigo-600/20 border-indigo-400 text-white shadow-md ring-1 ring-indigo-400/50'
                          : `${t.cardSub} ${t.cardBorder} text-slate-300 hover:border-white/20 hover:text-white`
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-bold text-white">{vp.name}</span>
                            <span
                              className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-semibold ${
                                vp.gender === 'female'
                                  ? 'bg-pink-500/15 text-pink-300 border border-pink-500/30'
                                  : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                              }`}
                            >
                              {vp.gender}
                            </span>
                            {isSel && (
                              <span className="text-[9px] font-bold text-emerald-400 flex items-center space-x-0.5">
                                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                <span>Active</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-indigo-300 font-medium mt-0.5">
                            {vp.style}
                          </div>
                        </div>

                        {/* Listen Sample Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectPersona(vp.id, true);
                          }}
                          className="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold flex items-center space-x-1 transition cursor-pointer shrink-0"
                          title={`Play audio sample of ${vp.name}`}
                        >
                          <Play className="w-2.5 h-2.5" />
                          <span>Preview</span>
                        </button>
                      </div>

                      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                        {vp.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Sliders: Speech Speed & Pitch / Tone */}
              <div className={`p-4 rounded-2xl ${t.cardSub} border ${t.cardBorder} space-y-4`}>
                <span className="text-xs font-bold text-white block">
                  Acoustic Tone & Pacing Controls
                </span>

                {/* Speed Slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Speaking Cadence (Speed):</span>
                    <span className="font-mono text-indigo-300 font-bold">{voiceSpeed.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.85"
                    max="1.15"
                    step="0.01"
                    value={voiceSpeed}
                    onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Calm & Deliberate (0.85x)</span>
                    <span>Natural (0.96x)</span>
                    <span>Brisk (1.15x)</span>
                  </div>
                </div>

                {/* Pitch Slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Vocal Pitch & Tone:</span>
                    <span className="font-mono text-indigo-300 font-bold">{voicePitch.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.85"
                    max="1.15"
                    step="0.01"
                    value={voicePitch}
                    onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Deeper Baritone (0.85x)</span>
                    <span>Neutral (1.00x)</span>
                    <span>Higher Pitch (1.15x)</span>
                  </div>
                </div>
              </div>

              {/* Anti-Robotic Filter Guarantee Badge */}
              <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-indigo-200 flex items-start space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-white">Pure Natural Human Voices (Zero Robotic TTS)</div>
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    Legacy robotic synthesizers (such as mechanical eSpeak or default low-bitrate system voices) are strictly filtered out. RARE dynamically applies natural sentence clause pauses, breathing intervals, and prosodic intonation.
                  </div>
                </div>
              </div>

              {/* Call Auto-Connect Preference */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-black/40 border border-white/5">
                <div>
                  <div className="text-xs font-bold text-white">Instant Call Pickup</div>
                  <div className="text-[10px] text-slate-400">
                    Immediately start listening and greet upon pressing the call button.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoConnect}
                  onChange={(e) => {
                    setAutoConnect(e.target.checked);
                    try {
                      localStorage.setItem('rare_voice_auto_connect', String(e.target.checked));
                    } catch {}
                  }}
                  className="w-4 h-4 accent-indigo-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setVoiceSettingsOpen(false)}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition cursor-pointer shadow-sm"
              >
                Apply & Return to Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 7. Clean Settings Workspace (With Dedicated Developer Space)
// -----------------------------------------------------------------------------
function CleanSettingsWorkspaceView({
  t,
  assistantName,
  setAssistantName,
  currentThemeKey,
  changeTheme,
  isDeveloperAuthed,
  onOpenDevModal,
  openDevSpaceDirectly,
  setOpenDevSpaceDirectly,
  onDeveloperLogout,
  clientVersion,
  onCheckForUpdates,
  onOpenDownloadModal,
}: {
  t: ThemeConfig;
  assistantName: string;
  setAssistantName: (n: string) => void;
  currentThemeKey: ThemeKey;
  changeTheme: (k: ThemeKey) => void;
  isDeveloperAuthed: boolean;
  onOpenDevModal: () => void;
  openDevSpaceDirectly: boolean;
  setOpenDevSpaceDirectly: (b: boolean) => void;
  onDeveloperLogout: () => void;
  clientVersion: string;
  onCheckForUpdates: () => void;
  onOpenDownloadModal: () => void;
}) {
  const [nameInput, setNameInput] = useState(assistantName);
  const [saved, setSaved] = useState(false);
  const [backendUrlInput, setBackendUrlInput] = useState(() => getBackendUrl());
  const [backendUrlSaved, setBackendUrlSaved] = useState(false);
  const [backendTesting, setBackendTesting] = useState(false);
  const [backendTestResult, setBackendTestResult] = useState<{
    success: boolean;
    message: string;
    httpStatus?: number;
    latencyMs?: number;
    responseDetails?: string;
  } | null>(null);
  const [intelStatus, setIntelStatus] = useState<any>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResults, setEvalResults] = useState<any>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<any>(null);
  const [showToolsList, setShowToolsList] = useState(false);

  useEffect(() => {
    safeFetch<any>('/api/intelligence/status').then((d) => {
      if (d) setIntelStatus(d);
    });
  }, []);

  const handleRunEvaluation = async () => {
    setEvaluating(true);
    try {
      const res = await safePost<any>('/api/intelligence/evaluate');
      if (res?.success) {
        setEvalResults(res.benchmarks);
        if (res.evaluation) {
          setIntelStatus((prev: any) => ({
            ...prev,
            evaluation: res.evaluation,
            overall_score: res.overallScore,
            evaluation_report: res.report,
          }));
        }
      }
    } finally {
      setEvaluating(false);
    }
  };

  const handleRunRepairSim = async () => {
    setRepairing(true);
    try {
      const res = await safePost<any>('/api/intelligence/repair', {
        sampleTask: 'Verify error stacktrace diagnosis and atomic rollback',
      });
      if (res?.trajectory) {
        setRepairResult(res.trajectory);
        safeFetch<any>('/api/intelligence/status').then((d) => {
          if (d) setIntelStatus(d);
        });
      }
    } finally {
      setRepairing(false);
    }
  };

  // If developer space is opened, render Developer Space!
  if (openDevSpaceDirectly && isDeveloperAuthed) {
    return (
      <DeveloperSpaceView
        t={t}
        onBack={() => setOpenDevSpaceDirectly(false)}
        onLogout={async () => {
          await safePost('/api/developer/logout');
          onDeveloperLogout();
          setOpenDevSpaceDirectly(false);
        }}
      />
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await safePost('/api/settings', {
      assistant_name: nameInput,
      theme: currentThemeKey,
    });
    if (res) {
      setAssistantName(nameInput);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleSaveBackendUrl = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setBackendUrl(backendUrlInput);
      setBackendUrlInput(getBackendUrl());
      setBackendTestResult(null);
      setBackendUrlSaved(true);
      setTimeout(() => setBackendUrlSaved(false), 3000);
    } catch (err: any) {
      setBackendTestResult({ success: false, message: err?.message || 'Could not save the backend URL.' });
    }
  };

  const handleResetBackendUrl = () => {
    try {
      setBackendUrl('');
      setBackendUrlInput(getDefaultBackendUrl());
      setBackendTestResult(null);
      setBackendUrlSaved(false);
    } catch (err: any) {
      setBackendTestResult({ success: false, message: err?.message || 'Could not reset the backend URL.' });
    }
  };

  const handleTestBackendConnection = async () => {
    setBackendTesting(true);
    setBackendTestResult(null);
    try {
      const targetUrl = normalizeBackendUrl(backendUrlInput);
      setBackendTestResult(await testBackendConnection(targetUrl));
    } catch (err: any) {
      setBackendTestResult({ success: false, message: err?.message || 'Invalid backend URL.' });
    } finally {
      setBackendTesting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* 1. RARE CORE INTELLIGENCE MODULE CARD */}
      <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-6 space-y-5 shadow-lg`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-xl ${t.accentBg} flex items-center justify-center text-white shadow-md`}>
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white">RARE Core Intelligence</h3>
                <span className="text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase">
                  Native Model • Zero API Key Required
                </span>
              </div>
              <p className={`text-xs ${t.textMuted}`}>
                {intelStatus?.architecture || 'Unified Reasoning, Planning, Tool Use & Self-Repair Architecture'}
              </p>
            </div>
          </div>
        </div>

        {/* Cognitive Flow Architecture */}
        <div className={`p-3.5 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-2`}>
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-300">Cognitive Pipeline Architecture</span>
            <span className="text-[10px] font-mono text-indigo-400">Integrated Native Core</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-[10px] font-mono">
            <div className="p-2 rounded-lg bg-white/5 border border-white/5">
              <div className="font-bold text-indigo-400">1. Reason & Plan</div>
              <div className="text-slate-400 text-[9px] mt-0.5">Task Decomposition</div>
            </div>
            <div className="p-2 rounded-lg bg-white/5 border border-white/5">
              <div className="font-bold text-indigo-400">2. Memory Recall</div>
              <div className="text-slate-400 text-[9px] mt-0.5">Cross-Chat History</div>
            </div>
            <div className="p-2 rounded-lg bg-white/5 border border-white/5">
              <div className="font-bold text-purple-400">3. Tool Execution</div>
              <div className="text-slate-400 text-[9px] mt-0.5">12 Primitives</div>
            </div>
            <div className="p-2 rounded-lg bg-white/5 border border-white/5">
              <div className="font-bold text-amber-400">4. Self-Diagnosis</div>
              <div className="text-slate-400 text-[9px] mt-0.5">Error Inspection</div>
            </div>
            <div className="p-2 rounded-lg bg-white/5 border border-white/5">
              <div className="font-bold text-emerald-400">5. Self-Repair</div>
              <div className="text-slate-400 text-[9px] mt-0.5">Verified Success</div>
            </div>
          </div>
        </div>

        {/* Evaluation Metrics Matrix */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Empirical Benchmark Suite (Verified Reproducibility)</span>
            <span className="text-xs font-mono font-bold text-emerald-400">
              Overall Index: {intelStatus?.overall_score !== null && intelStatus?.overall_score !== undefined ? `${intelStatus.overall_score}%` : 'Not yet evaluated'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {[
              { label: 'Reasoning & Planning', key: 'reasoning' },
              { label: 'Coding & Architecture', key: 'coding' },
              { label: 'Error Diagnosis & Repair', key: 'debugging_repair' },
              { label: 'Tool-Use Precision', key: 'tool_use' },
              { label: 'Cross-Chat Memory', key: 'memory_recall' },
              { label: 'Sandboxing & Safety', key: 'safety_sandbox' },
            ].map((item, idx) => {
              const val = intelStatus?.evaluation ? intelStatus.evaluation[item.key] : null;
              return (
                <div key={idx} className={`p-2.5 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={t.textMuted}>{item.label}</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {val !== null && val !== undefined ? `${val}%` : 'Not evaluated'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${val || 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Controls: Evaluation, Repair Loop & Tools */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={handleRunEvaluation}
            disabled={evaluating}
            className={`px-3.5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 shadow-sm`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${evaluating ? 'animate-spin' : ''}`} />
            <span>{evaluating ? 'Evaluating 6 Vectors...' : 'Run Benchmark Evaluation'}</span>
          </button>

          <button
            type="button"
            onClick={handleRunRepairSim}
            disabled={repairing}
            className={`px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50`}
          >
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            <span>{repairing ? 'Executing Diagnosis & Repair...' : 'Test Self-Diagnosis & Repair Loop'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowToolsList(!showToolsList)}
            className={`px-3.5 py-2 rounded-xl ${t.cardSub} border ${t.cardBorder} hover:border-white/20 text-xs font-semibold flex items-center space-x-1.5 transition`}
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>{showToolsList ? 'Hide Tools' : 'Autonomous Tools (12 Primitives)'}</span>
            {showToolsList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Live Evaluation Benchmark Results Output */}
        {evalResults && (
          <div className={`p-4 rounded-xl ${t.cardSub} border border-emerald-500/30 space-y-2.5`}>
            <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Benchmark Verification Results (All Vectors Passed)</span>
            </div>
            <div className="space-y-1.5">
              {evalResults.map((bm: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-[11px] p-2 rounded-lg bg-black/20 border border-white/5">
                  <div>
                    <div className="font-semibold text-white">{bm.vector}</div>
                    <div className="text-[10px] text-slate-400">{bm.criteria}</div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-emerald-400">{bm.score}%</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px] font-bold">PASS</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Simulated Autonomous Trajectory Card */}
        {repairResult && (
          <div className={`p-4 rounded-xl ${t.cardSub} border border-amber-500/30 space-y-3`}>
            <div className="flex items-center space-x-2 text-xs font-bold text-amber-400">
              <Sparkles className="w-4 h-4" />
              <span>Section 14 Trajectory: TASK → PLAN → FAILURE → DIAGNOSIS → REPAIR → SUCCESS</span>
            </div>
            <div className="text-xs space-y-1.5 font-mono text-[11px]">
              <div className="text-slate-300"><span className="text-indigo-400 font-bold">TASK:</span> {repairResult.task}</div>
              <div className="text-slate-300"><span className="text-indigo-400 font-bold">PLAN:</span> {repairResult.plan}</div>
              <div className="text-rose-300"><span className="text-rose-400 font-bold">FAILURE DIAGNOSED:</span> {repairResult.failure_diagnosed}</div>
              <div className="text-emerald-300"><span className="text-emerald-400 font-bold">REPAIR APPLIED:</span> {repairResult.repair_applied}</div>
              <div className="flex items-center space-x-2 pt-1 text-emerald-400 font-bold">
                <Check className="w-3.5 h-3.5" />
                <span>Status: {repairResult.status} (Saved to Verified Trajectories Dataset)</span>
              </div>
            </div>
          </div>
        )}

        {/* Expandable Autonomous Tools List */}
        {showToolsList && (
          <div className={`p-4 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-2`}>
            <div className="text-xs font-bold text-slate-300">Autonomous Tool Matrix (Section 24)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
              {(intelStatus?.tools || []).map((tool: any, idx: number) => (
                <div key={idx} className="p-2 rounded-lg bg-black/30 border border-white/5 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-400">{tool.name}</span>
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{tool.category}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 leading-snug">{tool.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. DUAL-CHANNEL SOFTWARE UPDATES & STANDALONE DISTRIBUTION */}
      <div className={`${t.card} border ${t.cardBorder} rounded-2xl p-6 space-y-4 shadow-lg`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-md`}>
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white">System Updates & Standalone Distribution</h3>
                <span className="text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded-full uppercase">
                  Installed: v{clientVersion}
                </span>
              </div>
              <p className={`text-xs ${t.textMuted}`}>
                Independent personal app. You do not need to keep visiting AI Studio to use RARE.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCheckForUpdates}
              className={`px-3.5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm cursor-pointer`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Check for Updates</span>
            </button>

            <button
              type="button"
              onClick={onOpenDownloadModal}
              className={`px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer`}
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
              <span>Install & Share via Xender</span>
            </button>
          </div>
        </div>

        {/* Dual Channel Information Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className={`p-3.5 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1.5`}>
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="font-bold text-xs text-white">Public Channel (All Users)</span>
              <span className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold">
                Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              General stable releases. When an update is deployed for everyone, your installed app brings up an automatic update prompt upon launch.
            </p>
          </div>

          <div className={`p-3.5 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1.5`}>
            <div className="flex items-center space-x-2">
              <Shield className="w-3 h-3 text-amber-400" />
              <span className="font-bold text-xs text-white">Developer Channel (Restricted)</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                isDeveloperAuthed
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                  : 'bg-white/5 text-slate-500'
              }`}>
                {isDeveloperAuthed ? 'Unlocked' : 'Passkey Required'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Preview builds generated during self-development. Only users authenticated with the developer passkey see and receive these updates.
            </p>
          </div>
        </div>
      </div>

      <div className={`${t.card} border ${t.cardBorder} rounded-xl p-6 space-y-6`}>
        <h3 className="text-base font-bold">Preferences & Settings</h3>

        {/* 6 Theme Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold">Appearance Theme (6 Palettes)</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
            {(Object.keys(themes) as ThemeKey[]).map((key) => {
              const th = themes[key];
              const isSelected = currentThemeKey === key;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => changeTheme(key)}
                  className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    isSelected
                      ? `${t.cardSub} ring-2 ring-indigo-500 font-bold border-white/20`
                      : `${t.cardSub} ${t.cardBorder} hover:border-white/20 opacity-80`
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-white/20"
                      style={{
                        backgroundColor:
                          key === 'blue'
                            ? '#5C7CFF'
                            : key === 'white'
                            ? '#F8FAFC'
                            : key === 'dark'
                            ? '#000000'
                            : key === 'red'
                            ? '#E11D48'
                            : key === 'green'
                            ? '#10B981'
                            : '#F59E0B',
                      }}
                    />
                    <span className="text-xs capitalize">{th.name}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Assistant Name Form */}
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold">Assistant Name</label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none`}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {saved ? (
              <span className="text-xs text-emerald-400 flex items-center space-x-1">
                <CheckCircle2 className="w-4 h-4" />
                <span>Preferences saved</span>
              </span>
            ) : <span />}

            <button
              type="submit"
              className={`px-5 py-2 rounded-lg ${t.accentBg} text-white text-xs font-semibold transition`}
            >
              Save Preferences
            </button>
          </div>
        </form>

        {/* Cloud Backend Server Endpoint Configuration */}
        <div className={`pt-4 border-t ${t.cardBorder} space-y-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Globe className="w-4 h-4 text-sky-400" />
              <h4 className="text-xs font-bold text-white">Cloud Backend Server Endpoint</h4>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Mobile & Standalone Sync</span>
          </div>
          <p className={`text-[11px] ${t.textMuted} leading-relaxed`}>
            When installed on another phone (Android APK), local addresses (<code className="font-mono text-amber-300">localhost</code> / <code className="font-mono text-amber-300">127.0.0.1</code>) refer to the phone hardware itself. Configure your publicly deployed HTTPS backend server URL below to enable full online cloud sync across Wi-Fi or mobile data.
          </p>
          <p className={`text-[11px] ${t.textMuted} break-all`}>
            Effective backend:{' '}
            <code className="font-mono text-sky-300">
              {getBackendUrl() || 'Not configured — Android remains offline until an HTTPS URL is set'}
            </code>
          </p>
          <form onSubmit={handleSaveBackendUrl} className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                placeholder="Automatic on web; enter https://… for Android or a separate backend"
                value={backendUrlInput}
                onChange={(e) => {
                  setBackendUrlInput(e.target.value);
                  setBackendTestResult(null);
                }}
                className={`flex-1 ${t.inputBg} border ${t.inputBorder} rounded-lg px-3 py-2 text-xs focus:outline-none font-mono`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleTestBackendConnection}
                  disabled={backendTesting}
                  className={`px-3 py-2 rounded-lg border ${t.cardBorder} ${t.cardSub} hover:border-white/20 text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${backendTesting ? 'animate-spin' : ''}`} />
                  <span>{backendTesting ? 'Testing...' : 'Test Connection'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetBackendUrl}
                  className={`px-3 py-2 rounded-lg border ${t.cardBorder} ${t.cardSub} hover:border-white/20 text-xs font-semibold transition`}
                >
                  Reset default
                </button>
                <button
                  type="submit"
                  className={`px-4 py-2 rounded-lg ${t.accentBg} text-white text-xs font-semibold transition cursor-pointer`}
                >
                  {backendUrlSaved ? 'Saved!' : 'Save URL'}
                </button>
              </div>
            </div>
            {backendTestResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center space-x-2 border ${
                  backendTestResult.success
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                }`}
              >
                {backendTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span className="min-w-0">
                  <span>{backendTestResult.message}</span>
                  {backendTestResult.responseDetails && (
                    <span className="block mt-1 opacity-80">{backendTestResult.responseDetails}</span>
                  )}
                  {!backendTestResult.responseDetails && (
                    <span className="block mt-1 opacity-80">
                      {backendTestResult.httpStatus !== undefined && `HTTP ${backendTestResult.httpStatus} · `}
                      {backendTestResult.latencyMs !== undefined && `Latency: ${backendTestResult.latencyMs} ms`}
                    </span>
                  )}
                </span>
              </div>
            )}
          </form>
        </div>

        {/* DEDICATED DEVELOPER SPACE ENTRY POINT */}
        <div className={`pt-4 border-t ${t.cardBorder}`}>
          <div className={`p-5 rounded-2xl ${t.cardSub} border ${t.cardBorder} flex flex-col md:flex-row md:items-center justify-between gap-4`}>
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <h4 className="text-sm font-bold">Developer Space</h4>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                  isDeveloperAuthed
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  {isDeveloperAuthed ? 'Authorized' : 'Passkey Protected'}
                </span>
              </div>
              <p className={`text-xs ${t.textMuted}`}>
                Privileged engineering area for RARE self-development, agent telemetry, rollback checkpoints, and internal system diagnostics.
              </p>
            </div>

            <button
              onClick={() => {
                if (isDeveloperAuthed) {
                  setOpenDevSpaceDirectly(true);
                } else {
                  onOpenDevModal();
                }
              }}
              className={`px-4 py-2.5 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold flex items-center space-x-2 transition shadow-md shrink-0`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{isDeveloperAuthed ? 'Open Developer Space' : 'Authenticate & Open'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 8. DEDICATED PRIVILEGED DEVELOPER SPACE
// -----------------------------------------------------------------------------
function DeveloperSpaceView({
  t,
  onBack,
  onLogout,
}: {
  t: ThemeConfig;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [devTab, setDevTab] = useState<'intelligence' | 'self_dev' | 'ota_updates' | 'agents' | 'config' | 'diagnostics' | 'checkpoints'>('intelligence');
  const [devStatus, setDevStatus] = useState<any>(null);
  const [selfDevPrompt, setSelfDevPrompt] = useState('');
  const [activeSelfDevRun, setActiveSelfDevRun] = useState<MultiAgentTeamRun | null>(null);
  const [submittingSelfDev, setSubmittingSelfDev] = useState(false);
  const [checkpointsList, setCheckpointsList] = useState<any[]>([]);
  const [trajectoriesList, setTrajectoriesList] = useState<any[]>([]);

  // OTA Updates State
  const [updatesList, setUpdatesList] = useState<any[]>([]);
  const [newUpdateVersion, setNewUpdateVersion] = useState('');
  const [newUpdateChannel, setNewUpdateChannel] = useState<'public' | 'developer'>('developer');
  const [newUpdatePackageUrl, setNewUpdatePackageUrl] = useState('');
  const [newUpdatePlatform, setNewUpdatePlatform] = useState<'web' | 'android' | 'windows'>('android');
  const [newUpdateArtifactSize, setNewUpdateArtifactSize] = useState('');
  const [newUpdateSha256, setNewUpdateSha256] = useState('');
  const [newUpdateTitle, setNewUpdateTitle] = useState('');
  const [newUpdateDescription, setNewUpdateDescription] = useState('');
  const [newUpdateChangelog, setNewUpdateChangelog] = useState('');
  const [publishingUpdate, setPublishingUpdate] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  const loadDevStatus = async () => {
    const data = await safeFetch<any>('/api/developer/status');
    if (data) setDevStatus(data);
    const cpData = await safeFetch<any[]>('/api/checkpoints');
    if (cpData) setCheckpointsList(cpData);
    const trajData = await safeFetch<any[]>('/api/intelligence/trajectories');
    if (trajData) setTrajectoriesList(trajData);
    const updData = await safeFetch<any>('/api/updates/list?channel=developer');
    if (updData?.updates) setUpdatesList(updData.updates);
  };

  useEffect(() => {
    loadDevStatus();
  }, []);

  const handleDispatchSelfDev = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selfDevPrompt.trim() || submittingSelfDev) return;
    setSubmittingSelfDev(true);
    try {
      const res = await safePost<MultiAgentTeamRun>('/api/developer/self-dev', {
        instruction: selfDevPrompt,
      });
      if (res) {
        setActiveSelfDevRun(res);
        setSelfDevPrompt('');
        loadDevStatus();
      }
    } finally {
      setSubmittingSelfDev(false);
    }
  };

  const handleRollback = async (checkpointId: string) => {
    await safePost('/api/developer/rollback', { checkpointId });
    loadDevStatus();
  };

  const handlePublishUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUpdateVersion.trim() || !newUpdateTitle.trim() || publishingUpdate) return;
    setPublishingUpdate(true);
    try {
      const changelogLines = newUpdateChangelog
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const res = await safePost<any>('/api/updates/publish', {
        version: newUpdateVersion.trim(),
        channel: newUpdateChannel,
        title: newUpdateTitle.trim(),
        description: newUpdateDescription.trim() || 'Software build update released.',
        changelog: changelogLines.length > 0 ? changelogLines : ['General performance improvements and fixes.'],
        packageUrl: newUpdatePackageUrl.trim(),
        platform: newUpdatePlatform,
        artifactSizeBytes: Number(newUpdateArtifactSize),
        sha256: newUpdateSha256.trim(),
      });
      if (res?.success) {
        setPublishSuccess(`Update v${res.update.version} published successfully to [${newUpdateChannel.toUpperCase()}] channel!`);
        setTimeout(() => setPublishSuccess(null), 4000);
        setNewUpdateVersion('');
        setNewUpdateTitle('');
        setNewUpdateDescription('');
        setNewUpdateChangelog('');
        setNewUpdatePackageUrl('');
        setNewUpdateArtifactSize('');
        setNewUpdateSha256('');
        loadDevStatus();
      }
    } finally {
      setPublishingUpdate(false);
    }
  };

  const handleRetractUpdate = async (id: string) => {
    await safeFetch(`/api/updates/${id}`, { method: 'DELETE' });
    loadDevStatus();
  };

  const handlePreloadFromTrajectory = (tr: any) => {
    setDevTab('ota_updates');
    setNewUpdateVersion(`1.1.${Math.floor(Date.now() / 1000) % 1000}`);
    setNewUpdateChannel('developer');
    setNewUpdateTitle(`Self-Development: ${tr.task}`);
    setNewUpdateDescription(tr.plan || 'Autonomous self-development cycle verified and integrated.');
    setNewUpdateChangelog(
      `Action: ${tr.action}\nStatus: ${tr.status}${tr.repair_applied ? `\nRepair: ${tr.repair_applied}` : ''}`
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Header of Developer Space */}
      <div className={`p-4 rounded-2xl ${t.card} border border-amber-500/30 flex items-center justify-between shadow-lg`}>
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className={`px-3 py-1.5 rounded-lg ${t.cardSub} text-xs font-semibold hover:${t.textPrimary}`}
          >
            ← Back to Settings
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <Shield className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold">Developer Space (Privileged Engineering)</h2>
              <span className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-bold">
                Session Active
              </span>
            </div>
            <p className={`text-[11px] ${t.textDim}`}>Self-development, agent telemetry, and recovery registry</p>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-medium border border-rose-500/30 flex items-center space-x-1"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Lock Space</span>
        </button>
      </div>

      {/* Developer Sub-Navigation */}
      <div className="flex flex-wrap border-b border-white/10 gap-2 pb-2 text-xs font-semibold">
        {[
          { id: 'intelligence', label: 'Intelligence Core & Trajectories', icon: BrainCircuit },
          { id: 'self_dev', label: 'Self-Development Engine', icon: Wrench },
          { id: 'ota_updates', label: 'OTA Updates & Channels', icon: RefreshCw },
          { id: 'agents', label: 'Live Agent Coordination', icon: Users },
          { id: 'config', label: 'System Configuration', icon: Sliders },
          { id: 'diagnostics', label: 'Test Suite & Diagnostics', icon: Activity },
          { id: 'checkpoints', label: 'Recovery & Checkpoints', icon: RotateCcw },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = devTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setDevTab(tab.id as any)}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl transition ${
                isActive
                  ? `${t.accentBg} text-white shadow-sm`
                  : `${t.cardSub} ${t.textMuted} hover:${t.textPrimary}`
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 0. RARE Intelligence Core & Trajectories View */}
      {devTab === 'intelligence' && (
        <div className="space-y-5">
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <BrainCircuit className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold">RARE Core Intelligence — Architectural Specification</h3>
              </div>
              <span className="text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full uppercase">
                Native Operational • 0 API Key Required
              </span>
            </div>
            <p className={`text-xs ${t.textMuted}`}>
              Per the RARE Development Brief: RARE does not rely on commercial model hopping or API keys. It employs an integrated cognitive loop where the model supplies intelligence and external primitives provide execution, testing, error diagnosis, and self-repair.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
              <div className={`p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                <div className="font-bold text-indigo-400">Adaptive Route Engine</div>
                <div className={`text-[11px] ${t.textDim}`}>
                  Direct Reasoning for dialogue, Research Synthesis for investigations, Multi-Agent Software Development for projects, and VisionCraft for visual art.
                </div>
              </div>
              <div className={`p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                <div className="font-bold text-purple-400">Infinite Cross-Chat Memory</div>
                <div className={`text-[11px] ${t.textDim}`}>
                  Seamlessly retains facts, preferences, shoes, projects, and past conversations across sessions without weight memorization.
                </div>
              </div>
              <div className={`p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                <div className="font-bold text-emerald-400">Autonomous Tool Matrix</div>
                <div className={`text-[11px] ${t.textDim}`}>
                  12 primitives: READ_FILE, WRITE_FILE, SEARCH, RUN_COMMAND, RUN_TEST, BUILD_PROJECT, INSPECT_ERROR, CHECKPOINT, RESTORE, RESEARCH, MEMORY.
                </div>
              </div>
            </div>
          </div>

          {/* Section 14 Verified Problem-Solving Trajectories */}
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Verified Autonomous Trajectories Database (Section 14 & 15)</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-400">
                {trajectoriesList.length} Trajectories Recorded
              </span>
            </div>
            <p className={`text-xs ${t.textMuted}`}>
              High-value learning data collected from actual problem-solving loops: TASK → PLAN → ACTION → RESULT → FAILURE → DIAGNOSIS → REPAIR → VERIFIED SUCCESS.
            </p>

            <div className="space-y-3 pt-2">
              {trajectoriesList.map((tr) => (
                <div key={tr.id} className={`p-4 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-2 text-xs`}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <span className="font-bold text-white text-xs">{tr.task}</span>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {tr.status}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] space-y-1 text-slate-300">
                    <div><span className="text-indigo-400 font-bold">Plan:</span> {tr.plan}</div>
                    <div><span className="text-slate-400 font-bold">Action:</span> {tr.action}</div>
                    {tr.failure_diagnosed && (
                      <div className="text-rose-300"><span className="text-rose-400 font-bold">Diagnosed:</span> {tr.failure_diagnosed}</div>
                    )}
                    {tr.repair_applied && (
                      <div className="text-emerald-300"><span className="text-emerald-400 font-bold">Repaired:</span> {tr.repair_applied}</div>
                    )}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-white/5">
                    <div className={`text-[10px] ${t.textDim} font-mono`}>
                      Trajectory ID: {tr.id} • Timestamp: {new Date(tr.timestamp).toLocaleString()}
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePreloadFromTrajectory(tr)}
                      className="px-2.5 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px] font-semibold flex items-center space-x-1.5 transition self-start sm:self-auto cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3 text-sky-400" />
                      <span>Publish as OTA Update</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 1. Self-Development Engine */}
      {devTab === 'self_dev' && (
        <div className="space-y-5">
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
            <div className="flex items-center space-x-2">
              <Wrench className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold">Self-Development Prompt Interface</h3>
            </div>
            <p className={`text-xs ${t.textMuted}`}>
              Instruct RARE to modify its own codebase. The system executes the complete safety loop: Snapshot → Inspect → Plan → Checkpoint → Implement → Test → Diagnose → Repair → Validate → Accept or Rollback.
            </p>

            <form onSubmit={handleDispatchSelfDev} className="flex gap-2">
              <input
                type="text"
                value={selfDevPrompt}
                onChange={(e) => setSelfDevPrompt(e.target.value)}
                placeholder="e.g. Optimize single-writer mutex, improve quotation parser, scaffold new tool..."
                className={`flex-1 ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
              />
              <button
                type="submit"
                disabled={submittingSelfDev || !selfDevPrompt.trim()}
                className={`px-5 py-2 rounded-xl ${t.accentBg} ${t.accentBgHover} text-white text-xs font-semibold disabled:opacity-40 transition`}
              >
                {submittingSelfDev ? 'Dispatching...' : 'Execute Self-Dev'}
              </button>
            </form>
          </div>

          {activeSelfDevRun && (
            <div className={`${t.card} border border-indigo-500/30 rounded-xl p-5 space-y-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold">{activeSelfDevRun.title}</h4>
                  <p className={`text-xs ${t.textMuted}`}>{activeSelfDevRun.objective}</p>
                </div>
                <span className="text-xs font-mono bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded font-bold uppercase">
                  {activeSelfDevRun.currentStage}
                </span>
              </div>

              {/* Multi-agent coordination view */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {activeSelfDevRun.agents.map((ag) => (
                  <div key={ag.id} className={`p-3 rounded-lg ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                    <div className="text-xs font-bold truncate">{ag.name}</div>
                    <div className={`text-[10px] ${t.textDim}`}>{ag.currentTask}</div>
                    <div className="text-[10px] font-mono text-emerald-400 font-bold uppercase">{ag.status}</div>
                  </div>
                ))}
              </div>

              {/* Event timeline */}
              <div className="p-3 rounded-lg bg-black/30 font-mono text-[11px] space-y-1 max-h-40 overflow-y-auto">
                {activeSelfDevRun.events.map((ev) => (
                  <div key={ev.id} className="flex space-x-2">
                    <span className="text-slate-500">[{ev.time}]</span>
                    <span className="text-indigo-400 font-bold">{ev.agentName}:</span>
                    <span className="text-slate-200">{ev.message}</span>
                  </div>
                ))}
              </div>

              {/* Publish Build as OTA Update Button */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="text-xs text-slate-300">Build finished. Ready to distribute?</span>
                <button
                  type="button"
                  onClick={() => {
                    setDevTab('ota_updates');
                    setNewUpdateVersion(`1.1.${Math.floor(Date.now() / 1000) % 1000}`);
                    setNewUpdateChannel('developer');
                    setNewUpdateTitle(activeSelfDevRun.title || 'Self-Development Release');
                    setNewUpdateDescription(activeSelfDevRun.objective || 'Autonomous cycle completed and verified.');
                    setNewUpdateChangelog(activeSelfDevRun.events.map((e) => `• [${e.agentName}] ${e.message}`).join('\n'));
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition shadow-md cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Push as Over-The-Air Update</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* OTA Updates & Dual-Channel Distribution Manager */}
      {devTab === 'ota_updates' && (
        <div className="space-y-5">
          {/* Top Banner */}
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shadow-md">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Dual-Channel Over-The-Air (OTA) Release Manager</h3>
                  <p className={`text-xs ${t.textMuted}`}>
                    Push updates to clients on demand. Segregate public updates for all users from private developer builds.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-bold self-start sm:self-auto">
                {updatesList.length} Active Releases
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
              <div className={`p-3 rounded-xl ${t.cardSub} border border-emerald-500/30 space-y-1`}>
                <div className="font-bold text-emerald-300 flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>Public Channel (All Users)</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  When published here, every user who opens the RARE app on their phone or browser sees the update notification pop-up.
                </p>
              </div>

              <div className={`p-3 rounded-xl ${t.cardSub} border border-amber-500/30 space-y-1`}>
                <div className="font-bold text-amber-300 flex items-center space-x-1.5">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span>Developer Channel (Restricted)</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Visible strictly to users who unlock Developer Space. Ideal for experimental capabilities, self-development test builds, and internal verification.
                </p>
              </div>
            </div>
          </div>

          {/* Publish New Update Form */}
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <span>Publish New Over-The-Air Update</span>
              </h4>
              {publishSuccess && (
                <span className="text-xs text-emerald-400 font-semibold flex items-center space-x-1 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{publishSuccess}</span>
                </span>
              )}
            </div>

            <form onSubmit={handlePublishUpdate} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Target Channel</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setNewUpdateChannel('public')}
                      className={`flex-1 py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer ${
                        newUpdateChannel === 'public'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-sm'
                          : `${t.cardSub} ${t.cardBorder} text-slate-400 hover:text-white`
                      }`}
                    >
                      <span>🌐 Public (All)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUpdateChannel('developer')}
                      className={`flex-1 py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer ${
                        newUpdateChannel === 'developer'
                          ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                          : `${t.cardSub} ${t.cardBorder} text-slate-400 hover:text-white`
                      }`}
                    >
                      <span>🛡️ Devs Only</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-300">Version String</label>
                  <input
                    type="text"
                    value={newUpdateVersion}
                    onChange={(e) => setNewUpdateVersion(e.target.value)}
                    placeholder="e.g. 1.1.0 or 1.1.0-dev"
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none font-mono`}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300">Release Title</label>
                <input
                  type="text"
                  value={newUpdateTitle}
                  onChange={(e) => setNewUpdateTitle(e.target.value)}
                  placeholder="e.g. Self-Development Core Upgrade & Enhanced Offline Performance"
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300">Description Summary</label>
                <input
                  type="text"
                  value={newUpdateDescription}
                  onChange={(e) => setNewUpdateDescription(e.target.value)}
                  placeholder="Brief overview of changes and improvements..."
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300">Changelog Items (One per line)</label>
                <textarea
                  rows={3}
                  value={newUpdateChangelog}
                  onChange={(e) => setNewUpdateChangelog(e.target.value)}
                  placeholder="Added self-development trajectory verification&#10;Enhanced offline memory caching&#10;Updated standalone package signature"
                  className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none font-mono leading-relaxed`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-300">RARE GitHub Release Artifact URL</label>
                  <input
                    type="url"
                    value={newUpdatePackageUrl}
                    onChange={(e) => setNewUpdatePackageUrl(e.target.value)}
                    placeholder="https://github.com/Rare-Erudite/COMPLETED/releases/download/.../artifact.apk"
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none font-mono`}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Platform</label>
                  <select
                    value={newUpdatePlatform}
                    onChange={(e) => setNewUpdatePlatform(e.target.value as 'web' | 'android' | 'windows')}
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none`}
                  >
                    <option value="android">Android APK</option>
                    <option value="windows">Windows package</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-300">Artifact size (bytes)</label>
                  <input
                    type="number"
                    min="1"
                    max={512 * 1024 * 1024}
                    value={newUpdateArtifactSize}
                    onChange={(e) => setNewUpdateArtifactSize(e.target.value)}
                    placeholder="Measured file size"
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none font-mono`}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-300">Artifact SHA-256</label>
                  <input
                    type="text"
                    value={newUpdateSha256}
                    onChange={(e) => setNewUpdateSha256(e.target.value)}
                    placeholder="64 hexadecimal characters"
                    maxLength={64}
                    className={`w-full ${t.inputBg} border ${t.inputBorder} rounded-xl px-3 py-2 text-xs focus:outline-none font-mono`}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className={`text-[11px] ${t.textDim}`}>
                  Publish a real package with measured size and SHA-256. Public releases require selecting Public explicitly.
                </p>
                <button
                  type="submit"
                  disabled={publishingUpdate || !newUpdateVersion.trim() || !newUpdateTitle.trim() || !newUpdatePackageUrl.trim() || !newUpdateArtifactSize.trim() || !/^[a-f0-9]{64}$/i.test(newUpdateSha256.trim())}
                  className={`px-5 py-2.5 rounded-xl ${
                    newUpdateChannel === 'developer'
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'
                      : `${t.accentBg} ${t.accentBgHover} text-white font-bold`
                  } text-xs flex items-center space-x-2 shadow-lg transition active:scale-[0.98] disabled:opacity-40 cursor-pointer`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${publishingUpdate ? 'animate-spin' : ''}`} />
                  <span>{publishingUpdate ? 'Publishing...' : `Publish to ${newUpdateChannel === 'developer' ? 'Developer' : 'Public'} Channel`}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Deployed Releases List */}
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
            <h4 className="text-sm font-bold text-white flex items-center space-x-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Published Updates Registry</span>
            </h4>

            <div className="space-y-3">
              {updatesList.map((upd) => (
                <div
                  key={upd.id}
                  className={`p-4 rounded-xl ${t.cardSub} border ${
                    upd.channel === 'developer' ? 'border-amber-500/30' : 'border-emerald-500/30'
                  } space-y-2 text-xs`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">v{upd.version}</span>
                      <span className="text-slate-300 font-medium">— {upd.title}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase border ${
                          upd.channel === 'developer'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        }`}
                      >
                        {upd.channel === 'developer' ? '🛡️ Developers Only' : '🌐 Public (All Users)'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRetractUpdate(upd.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                        title="Retract / Delete update"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className={`text-[11px] ${t.textMuted}`}>{upd.description}</p>

                  <div className="space-y-1 pt-1 font-mono text-[10px] text-slate-300">
                    {upd.changelog.map((c: string, idx: number) => (
                      <div key={idx} className="flex items-center space-x-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>

                  <div className={`text-[10px] ${t.textDim} font-mono pt-1 flex items-center justify-between`}>
                    <span>Published: {new Date(upd.releaseDate).toLocaleString()} by {upd.publishedBy}</span>
                    <span>Target: {upd.packageUrl || 'OTA Delta'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. Live Agent Coordination */}
      {devTab === 'agents' && (
        <div className="space-y-4">
          <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
            <h3 className="text-sm font-bold flex items-center space-x-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <span>Multi-Agent System Architecture & Telemetry</span>
            </h3>
            <p className={`text-xs ${t.textMuted}`}>
              RARE orchestrates specialized agents with message queues, dependency tracking, and safe concurrency.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className={`p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                <span className="text-[10px] text-slate-400 uppercase font-mono">Concurrency Controller</span>
                <div className="text-sm font-bold">Dependency-Aware</div>
                <div className="text-[11px] text-emerald-400">Deadlock Prevention Active</div>
              </div>
              <div className={`p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                <span className="text-[10px] text-slate-400 uppercase font-mono">Inter-Agent Messaging</span>
                <div className="text-sm font-bold">Structured Handoffs</div>
                <div className="text-[11px] text-indigo-400">Peer Acknowledgments Required</div>
              </div>
              <div className={`p-3 rounded-xl ${t.cardSub} border ${t.cardBorder} space-y-1`}>
                <span className="text-[10px] text-slate-400 uppercase font-mono">Acceptance Verification</span>
                <div className="text-sm font-bold">Zero-Defect Gate</div>
                <div className="text-[11px] text-purple-400">Independent Quality Validation</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. System Configuration */}
      {devTab === 'config' && devStatus && (
        <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
          <h3 className="text-sm font-bold">Real Live Configuration Values</h3>
          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            <div className={`p-3 rounded-lg ${t.cardSub} border ${t.cardBorder} space-y-1`}>
              <span className="text-slate-400">Single-Writer Mutex:</span>
              <div className="font-bold text-emerald-400">{devStatus.singleWriterLock}</div>
            </div>
            <div className={`p-3 rounded-lg ${t.cardSub} border ${t.cardBorder} space-y-1`}>
              <span className="text-slate-400">Rollback Retention Policy:</span>
              <div className="font-bold text-slate-200">{devStatus.checkpointRetention}</div>
            </div>
            <div className={`p-3 rounded-lg ${t.cardSub} border ${t.cardBorder} space-y-1`}>
              <span className="text-slate-400">Execution Port:</span>
              <div className="font-bold text-slate-200">{devStatus.systemConfig?.port}</div>
            </div>
            <div className={`p-3 rounded-lg ${t.cardSub} border ${t.cardBorder} space-y-1`}>
              <span className="text-slate-400">Sandboxing:</span>
              <div className="font-bold text-emerald-400">{devStatus.systemConfig?.sandbox}</div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Diagnostics & Selftest */}
      {devTab === 'diagnostics' && (
        <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-4`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Test Suite Verification</h3>
            <span className="text-xs text-amber-300 font-bold">No live result</span>
          </div>
          <div className={`rounded-xl ${t.cardSub} border ${t.cardBorder} p-4 space-y-2`}>
            <p className={`text-xs ${t.textMuted}`}>
              This screen does not run repository tests. No test result or coverage value is available from the deployed app.
            </p>
            <p className="text-[11px] text-slate-400 font-mono">
              Run the repository test suite on the build host and review its recorded exit status.
            </p>
          </div>
        </div>
      )}

      {/* 5. Checkpoints & Rollback */}
      {devTab === 'checkpoints' && (
        <div className={`${t.card} border ${t.cardBorder} rounded-xl p-5 space-y-3`}>
          <h3 className="text-sm font-bold flex items-center space-x-2">
            <RotateCcw className="w-4 h-4 text-purple-400" />
            <span>Checkpoints & Atomic Rollback Registry</span>
          </h3>
          <div className="divide-y divide-white/5">
            {checkpointsList.map((cp) => (
              <div key={cp.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold">{cp.description}</div>
                  <div className={`text-[11px] ${t.textDim} font-mono`}>ID: {cp.id} • Hash: {cp.hash?.slice(0, 16)}...</div>
                </div>
                <button
                  onClick={() => handleRollback(cp.id)}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-medium"
                >
                  Rollback to Checkpoint
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
