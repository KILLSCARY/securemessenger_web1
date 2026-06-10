import { useState, useEffect, useRef, useCallback, Component } from 'react';
import {
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    signOut, onAuthStateChanged, updateProfile,
    sendPasswordResetEmail, sendEmailVerification,
} from 'firebase/auth';
import { auth } from './firebase';
import { generateMessageId } from './utils/crypto';
import {
    createUserProfile, getUserProfile, updateUserProfile,
    subscribeToMessages, loadMoreMessages, saveMessage, addReaction,
    uploadAvatar, getChatSessionKey, setTypingStatus,
    subscribeToTyping, subscribeToChats, ensureChatExists,
    subscribeToOnlineUsers, uploadFile, updateCourseProgress,
    markChatAsRead,
} from './utils/firebaseService';
import { initECDHKeys } from './utils/e2e';
import './App.css';

// ── Error Boundary ────────────────────────────────────────────────
class ErrorBoundary extends Component<any, any> {
    state = { hasError: false, error: null };
    static getDerivedStateFromError(e: any) { return { hasError: true, error: e }; }
    render() {
        if (this.state.hasError) return (
            <div style={{ padding: 24, color: '#fff', background: '#0A0B10', height: '100dvh' }}>
                <h2 style={{ color: '#FF5C7A', marginBottom: 12 }}>Ошибка приложения</h2>
                <pre style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'pre-wrap' }}>
                    {(this.state.error as any)?.message || String(this.state.error)}
                </pre>
            </div>
        );
        return this.props.children;
    }
}

// ── Constants ─────────────────────────────────────────────────────
const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😀','😂','😍','🥰','😎','🤔','😅','😭','😤','🥳','😴','🤯','👍','👎','👋','🙏','💪','🎉','🔥','❤️','💔','✨','🌟','💯'];
const CITY_CHATS = [
    { id: 'city_moscow', name: 'Москва', short: 'МСК', color: '#8B5CF6' },
    { id: 'city_spb', name: 'Санкт-Петербург', short: 'СПБ', color: '#3B82F6' },
    { id: 'city_novosibirsk', name: 'Новосибирск', short: 'НСБ', color: '#10B981' },
    { id: 'city_yekaterinburg', name: 'Екатеринбург', short: 'ЕКБ', color: '#F59E0B' },
    { id: 'city_kazan', name: 'Казань', short: 'КЗН', color: '#EF4444' },
    { id: 'city_krasnodar', name: 'Краснодар', short: 'КРД', color: '#EC4899' },
];
const COURSES = [
    {
        id: 'sales', title: 'Продажи с нуля', icon: '🎯', color: '#8B5CF6',
        desc: 'Скрипты, возражения, закрытие сделок',
        lessons: [
            'Что такое продажи и почему все продают',
            'Психология покупателя: страхи и желания',
            'Первый контакт: как начать разговор',
            'Выявление потребностей: вопросы SPIN',
            'Презентация ценности, а не продукта',
            'Работа с возражениями: 5 техник',
            'Закрытие сделки: когда и как просить',
            'Работа с отказами: как не сгореть',
        ],
    },
    {
        id: 'team', title: 'Построение команды', icon: '👥', color: '#3B82F6',
        desc: 'Найм, адаптация, управление отделом',
        lessons: [
            'Когда нужна команда и с чего начать',
            'Профиль должности и поиск людей',
            'Собеседование: что спрашивать',
            'Онбординг: первые 30 дней сотрудника',
            'Делегирование без потери качества',
            'Мотивация: деньги и не только',
            'Обратная связь: похвала и критика',
            'Как и когда расставаться с людьми',
        ],
    },
    {
        id: 'brand', title: 'Личный бренд', icon: '⭐', color: '#F59E0B',
        desc: 'Стать экспертом в своей нише',
        lessons: [
            'Что такое личный бренд и зачем он',
            'Найти свою нишу и аудиторию',
            'Упаковка: фото, биография, ценности',
            'Контент-план: о чём говорить',
            'Сторителлинг: как рассказывать истории',
            'Нетворкинг: знакомства и связи',
        ],
    },
    {
        id: 'finance', title: 'Финансы бизнеса', icon: '💰', color: '#10B981',
        desc: 'Планирование и масштабирование',
        lessons: [
            'Считаем деньги: P&L и баланс',
            'Юнит-экономика: один клиент',
            'Бюджетирование и план-факт',
            'Инвестиции: когда и во что',
            'Налоги для предпринимателя',
            'Масштабирование без потери прибыли',
        ],
    },
    {
        id: 'nego', title: 'Переговоры', icon: '🤝', color: '#EF4444',
        desc: 'Психология и техники влияния',
        lessons: [
            'Принципы win-win переговоров',
            'Подготовка: интересы и BATNA',
            'Активное слушание и эмпатия',
            'Техники убеждения и влияния',
            'Сложные переговоры: давление',
            'Итог и фиксация договорённостей',
        ],
    },
];
const NOTIFS = [
    { id: '1', ico: '💬', title: 'Новое сообщение', body: 'Александр: Привет, как дела?', time: '2 мин', unread: true },
    { id: '2', ico: '📚', title: 'Новый урок', body: 'Продажи с нуля: Урок 4 доступен', time: '1 ч', unread: true },
    { id: '3', ico: '🏆', title: 'Клуб NSS', body: 'Встреча в Москве — 15 июня', time: '3 ч', unread: false },
    { id: '4', ico: '🔥', title: 'Новый курс', body: 'Построение команды — старт открыт', time: 'вчера', unread: false },
    { id: '5', ico: '💰', title: 'Тариф', body: 'Ваша подписка NSS Pro активна', time: '2 дня', unread: false },
];

// ── AudioPlayer ───────────────────────────────────────────────────
function AudioPlayer({ url, label, isMe }: { url: string; label?: string; isMe: boolean }) {
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const audioRef = useRef<HTMLAudioElement>(null);

    const toggle = () => {
        const a = audioRef.current;
        if (!a) return;
        if (playing) { a.pause(); } else { a.play(); }
        setPlaying(!playing);
    };

    return (
        <div className={`voice-msg ${isMe ? 'voice-me' : 'voice-them'}`}>
            <audio ref={audioRef}
                src={url}
                onEnded={() => { setPlaying(false); setProgress(0); }}
                onTimeUpdate={e => {
                    const a = e.currentTarget;
                    if (a.duration) setProgress(a.currentTime / a.duration);
                }}
            />
            <button className="voice-play" onClick={toggle}>{playing ? '⏸' : '▶'}</button>
            <div className="voice-body">
                <div className="voice-wave">
                    {Array.from({length: 20}, (_, i) => (
                        <div key={i} className="voice-bar" style={{
                            height: `${20 + Math.sin(i * 0.8) * 10 + Math.cos(i * 1.3) * 8}px`,
                            opacity: i / 20 <= progress ? 1 : 0.3
                        }} />
                    ))}
                </div>
                <span className="voice-label">{label || 'Голосовое'}</span>
            </div>
        </div>
    );
}

// ── Avatar ────────────────────────────────────────────────────────
function Ava({ src = '', name = '?', size = 48, online = false, color = '#EAB308' }: {
    src?: string | null; name?: string; size?: number; online?: boolean; color?: string;
}) {
    const letter = (name || '?')[0]?.toUpperCase() || '?';
    return (
        <div className="ava-wrap" style={{ width: size, height: size }}>
            <div className="ava" style={{ width: size, height: size, background: color }}>
                {src ? <img src={src} alt={name} /> : <span style={{ fontSize: size * 0.37 }}>{letter}</span>}
            </div>
            {online && <div className="ava-online" />}
        </div>
    );
}

// ── Icons ─────────────────────────────────────────────────────────
function IcoBack() {
    return <svg width={20} height={20} viewBox="0 0 24 24" fill="none"><path d="M15 6L9 12L15 18" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IcoSend() {
    return <svg width={20} height={20} viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="#000" strokeWidth="2" strokeLinecap="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function IcoArrow() {
    return <svg width={16} height={16} viewBox="0 0 24 24" fill="none"><path d="M9 6L15 12L9 18" stroke="#7A7A62" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

// ── App ───────────────────────────────────────────────────────────
function App() {
    const [user, setUser] = useState<any>(null);
    const [profile, setProfile] = useState<any>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [uname, setUname] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(true);
    const [authErr, setAuthErr] = useState('');

    const [messages, setMessages] = useState<any[]>([]);
    const [input, setInput] = useState('');
    const [partner, setPartner] = useState<any>(null);
    const [chatId, setChatId] = useState<string | null>(null);
    const [sessionKey, setSessionKey] = useState<string | null>(null);
    const [selFile, setSelFile] = useState<any>(null);

    const [chats, setChats] = useState<any[]>([]);
    const [online, setOnline] = useState<any[]>([]);
    const [typing, setTyping] = useState<any[]>([]);

    const [tab, setTab] = useState('chats');
    const [searchQuery, setSearchQuery] = useState('');
    const [settingsToast, setSettingsToast] = useState('');
    const [showEmoji, setShowEmoji] = useState(false);
    const [reactionFor, setReactionFor] = useState<string | null>(null);
    const [cityOpen, setCityOpen] = useState(true);
    const [viewPartner, setViewPartner] = useState(false);
    const [sendErr, setSendErr] = useState('');
    const [editProfile, setEditProfile] = useState(false);
    const [editUsername, setEditUsername] = useState('');
    const [editBio, setEditBio] = useState('');

    // Auth / reset
    const [resetMode, setResetMode] = useState(false);
    const [resetEmail, setResetEmail] = useState('');
    const [resetSent, setResetSent] = useState(false);

    // Courses
    const [courseProgress, setCourseProgress] = useState<Record<string, number[]>>({});
    const [selectedCourse, setSelectedCourse] = useState<string | null>(null);

    // Email verification
    const [emailVerifSent, setEmailVerifSent] = useState(false);

    // Message pagination
    const [olderMessages, setOlderMessages] = useState<any[]>([]);
    const [hasMoreMessages, setHasMoreMessages] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const msgCursorRef = useRef<any>(null);

    // Voice recording state
    const [isRecording, setIsRecording] = useState(false);
    const [recordDuration, setRecordDuration] = useState(0);

    const fileRef = useRef<any>(null);
    const avaRef = useRef<any>(null);
    const endRef = useRef<any>(null);
    const typingTimer = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordTimerRef = useRef<any>(null);

    // Auth
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (fu) => {
            if (fu) {
                setUser(fu);
                let p = await getUserProfile(fu.uid);
                if (!p) {
                    const n = sessionStorage.getItem('temp_username') || fu.email!.split('@')[0];
                    p = await createUserProfile(fu.uid, n, fu.email!);
                    sessionStorage.removeItem('temp_username');
                }
                // Init ECDH keys and store public key in profile
                try {
                    const publicKeyJwk = await initECDHKeys(fu.uid);
                    await updateUserProfile(fu.uid, { status: 'online', ecdhPublicKey: publicKeyJwk });
                } catch (e) {
                    console.warn('ECDH init failed:', e);
                    await updateUserProfile(fu.uid, { status: 'online' });
                }
                setProfile(p);
                setCourseProgress(p?.courseProgress || {});
            } else {
                setUser(null); setProfile(null);
            }
            setLoading(false);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        const off = () => user && updateUserProfile(user.uid, { status: 'offline' });
        window.addEventListener('beforeunload', off);
        return () => window.removeEventListener('beforeunload', off);
    }, [user]);

    // Messages with pagination
    useEffect(() => {
        msgCursorRef.current = null;
        setOlderMessages([]);
        setHasMoreMessages(false);
        if (user && chatId && sessionKey) {
            const unsub = subscribeToMessages(chatId, sessionKey, setMessages, (hasMore, cursor) => {
                if (!msgCursorRef.current) {
                    msgCursorRef.current = cursor;
                    setHasMoreMessages(hasMore);
                }
            });
            return () => unsub?.();
        }
        setMessages([]);
    }, [chatId, sessionKey, user]);

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    // Real-time chats & online users — no polling
    useEffect(() => {
        if (!user) return;
        const unsubChats = subscribeToChats(user.uid, setChats);
        const unsubOnline = subscribeToOnlineUsers(user.uid, setOnline);
        // Heartbeat: keep lastSeen fresh so we stay visible as online
        const heartbeat = setInterval(() => {
            updateUserProfile(user.uid, { status: 'online' });
        }, 90_000);
        return () => { unsubChats(); unsubOnline(); clearInterval(heartbeat); };
    }, [user]);

    // Auto-clear send error
    useEffect(() => {
        if (!sendErr) return;
        const t = setTimeout(() => setSendErr(''), 3000);
        return () => clearTimeout(t);
    }, [sendErr]);

    // Auto-clear settings toast
    useEffect(() => {
        if (!settingsToast) return;
        const t = setTimeout(() => setSettingsToast(''), 2500);
        return () => clearTimeout(t);
    }, [settingsToast]);

    // Typing
    useEffect(() => {
        if (!chatId || !user) { setTyping([]); return; }
        const unsub = subscribeToTyping(chatId, user.uid, setTyping);
        return () => unsub();
    }, [chatId, user]);

    // Actions
    const handleAuth = async () => {
        setAuthErr('');
        setLoading(true);
        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                sessionStorage.setItem('temp_username', uname);
                const r = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(r.user, { displayName: uname });
            }
        } catch (e: any) {
            const errMap: Record<string, string> = {
                'auth/user-not-found':     'Пользователь не найден',
                'auth/wrong-password':     'Неверный пароль',
                'auth/invalid-email':      'Неверный формат email',
                'auth/email-already-in-use': 'Этот email уже используется',
                'auth/weak-password':      'Пароль слишком слабый (минимум 6 символов)',
                'auth/too-many-requests':  'Слишком много попыток. Попробуйте позже',
                'auth/network-request-failed': 'Ошибка сети',
                'auth/invalid-credential': 'Неверный email или пароль',
            };
            setAuthErr(errMap[e?.code] || 'Ошибка авторизации');
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await updateUserProfile(user.uid, { status: 'offline' });
        await signOut(auth);
        setPartner(null); setChatId(null); setMessages([]); setTab('chats');
    };

    const startChat = async (pid: string, pname: string, pava: any = null) => {
        const isGroup = pid.startsWith('__group_');
        const cid = isGroup ? pid.replace('__group_', '') : [user.uid, pid].sort().join('_');
        const key = await getChatSessionKey(cid, user.uid, isGroup ? undefined : pid);
        setChatId(cid);
        setSessionKey(key);
        setPartner({ userId: pid, username: pname, avatar: pava });
        setSearchQuery('');
        setTab('chat');
        markChatAsRead(cid, user.uid);
    };

    const goBack = () => {
        setPartner(null); setChatId(null); setMessages([]);
        setOlderMessages([]); setHasMoreMessages(false);
        setTab('chats');
    };

    const send = async () => {
        if ((!input.trim() && !selFile) || !chatId || !sessionKey) return;
        setSendErr('');
        try {
            await setTypingStatus(chatId, user.uid, false);
            // Ensure chat doc exists before first message (non-group chats)
            if (partner && !chatId.startsWith('city_')) {
                await ensureChatExists(chatId, user.uid, partner.userId);
            }
            if (selFile) {
                await saveMessage(chatId, {
                    id: generateMessageId(), text: `[File] ${selFile.name}`,
                    senderId: user.uid, senderName: profile?.username || user.email,
                    fileUrl: selFile.url, fileType: selFile.type, fileName: selFile.name,
                }, sessionKey);
                setSelFile(null);
            }
            if (input.trim()) {
                await saveMessage(chatId, {
                    id: generateMessageId(), text: input,
                    senderId: user.uid, senderName: profile?.username || user.email,
                }, sessionKey);
            }
            setInput('');
            markChatAsRead(chatId, user.uid);
        } catch (e: any) {
            setSendErr('Ошибка отправки');
            console.error('Send error:', e);
        }
    };

    const handleTyping = useCallback(async (v: string) => {
        setInput(v);
        if (!chatId || !user) return;
        await setTypingStatus(chatId, user.uid, v.length > 0);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTypingStatus(chatId!, user.uid, false), 2000);
    }, [chatId, user]);

    const handleLoadMore = async () => {
        if (!chatId || !sessionKey || !msgCursorRef.current || loadingMore) return;
        setLoadingMore(true);
        try {
            const { msgs, hasMore, cursor } = await loadMoreMessages(chatId, sessionKey, msgCursorRef.current);
            msgCursorRef.current = cursor;
            setOlderMessages(prev => [...msgs, ...prev]);
            setHasMoreMessages(hasMore);
        } catch (e) { console.error('Load more error:', e); }
        finally { setLoadingMore(false); }
    };

    const handleReset = async () => {
        setAuthErr('');
        try {
            await sendPasswordResetEmail(auth, resetEmail);
            setResetSent(true);
        } catch (e: any) {
            const errMap: Record<string, string> = {
                'auth/user-not-found': 'Пользователь с таким email не найден',
                'auth/invalid-email':  'Неверный формат email',
            };
            setAuthErr(errMap[e?.code] || 'Ошибка. Проверьте email.');
        }
    };

    const handleCompleteLesson = async (courseId: string, idx: number) => {
        const current = courseProgress[courseId] || [];
        const updated = current.includes(idx) ? current.filter(i => i !== idx) : [...current, idx];
        setCourseProgress(prev => ({ ...prev, [courseId]: updated }));
        await updateCourseProgress(user.uid, courseId, updated);
    };

    const handleFile = async (e: any, type: string) => {
        const f = e.target.files?.[0];
        if (!f || !user) return;
        if (type === 'avatar') {
            const url = await uploadAvatar(user.uid, f);
            if (url) {
                setProfile((p: any) => ({ ...p, avatar: url }));
                await updateUserProfile(user.uid, { avatar: url });
            }
        } else {
            try {
                const result = await uploadFile(chatId!, f, user.uid);
                setSelFile({ name: result.name, url: result.url, type: result.type });
            } catch (e: any) {
                setSendErr('Ошибка загрузки файла');
                console.error('File upload error:', e);
            }
        }
    };

    // Voice recording
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
            const mr = new MediaRecorder(stream, { mimeType });
            audioChunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            mr.start(100);
            mediaRecorderRef.current = mr;
            setIsRecording(true);
            setRecordDuration(0);
            recordTimerRef.current = setInterval(() => setRecordDuration(d => d + 1), 1000);
        } catch (e) {
            setSendErr('Нет доступа к микрофону');
        }
    };

    const stopRecording = async (doSend: boolean) => {
        if (!mediaRecorderRef.current) return;
        clearInterval(recordTimerRef.current);
        setIsRecording(false);

        if (!doSend) {
            mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
            mediaRecorderRef.current = null;
            setRecordDuration(0);
            return;
        }

        const currentDuration = recordDuration;
        await new Promise<void>(resolve => {
            mediaRecorderRef.current!.onstop = () => resolve();
            mediaRecorderRef.current!.stop();
            mediaRecorderRef.current!.stream?.getTracks().forEach(t => t.stop());
        });

        const mimeType = audioChunksRef.current[0]?.type || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });

        try {
            if (partner && !chatId!.startsWith('city_')) {
                await ensureChatExists(chatId!, user.uid, partner.userId);
            }
            const result = await uploadFile(chatId!, file, user.uid);
            await saveMessage(chatId!, {
                id: generateMessageId(),
                text: '',
                senderId: user.uid,
                senderName: profile?.username || user.email,
                fileUrl: result.url,
                fileType: 'audio/voice',
                fileName: `Голосовое • ${currentDuration}с`,
            }, sessionKey!);
        } catch (e) {
            setSendErr('Ошибка отправки голосового');
        }
        setRecordDuration(0);
        mediaRecorderRef.current = null;
    };

    // ── Loading ───────────────────────────────────────────────────
    if (loading) return (
        <div className="app">
            <div className="loading-screen">
                <div className="logo-circle"><img src="/nss-icon.png" alt="NSS" /></div>
                <div className="spinner" />
            </div>
        </div>
    );

    // ── Auth ──────────────────────────────────────────────────────
    if (!user) return (
        <div className="app">
            <div className="auth-wrap">
                <div className="auth-glow1" /><div className="auth-glow2" />

                <div className="auth-hero">
                    <div className="auth-nss-title">
                        <span>НЕ</span>
                        <span>СУЩИЙ</span>
                        <span>СВЕТ</span>
                    </div>
                </div>

                <div className="auth-box">
                    {resetMode ? (
                        <>
                            <div className="auth-reset-title">Сброс пароля</div>
                            {resetSent ? (
                                <p className="auth-reset-ok">Письмо отправлено на {resetEmail}. Проверьте почту.</p>
                            ) : (
                                <>
                                    <input className="nss-input" type="email" placeholder="Ваш Email"
                                        value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleReset()} />
                                    {authErr && <p className="auth-err">{authErr}</p>}
                                    <button className="btn-primary" onClick={handleReset}>Отправить ссылку</button>
                                </>
                            )}
                            <button className="auth-back-link" onClick={() => { setResetMode(false); setResetSent(false); setAuthErr(''); }}>← Назад</button>
                        </>
                    ) : (
                        <>
                            <div className="auth-tabs">
                                <button className={`auth-tab${isLogin ? ' active' : ''}`} onClick={() => setIsLogin(true)}>Вход</button>
                                <button className={`auth-tab${!isLogin ? ' active' : ''}`} onClick={() => setIsLogin(false)}>Регистрация</button>
                            </div>
                            {!isLogin && (
                                <input className="nss-input" type="text" placeholder="Имя" value={uname} onChange={e => setUname(e.target.value)} />
                            )}
                            <input className="nss-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                            <input className="nss-input" type="password" placeholder="Пароль" value={password}
                                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAuth()} />
                            {authErr && <p className="auth-err">{authErr}</p>}
                            <button className="btn-primary" onClick={handleAuth}>{isLogin ? 'Войти в NSS' : 'Создать аккаунт'}</button>
                            {isLogin && (
                                <button className="auth-forgot" onClick={() => { setResetMode(true); setResetEmail(email); setAuthErr(''); }}>
                                    Забыли пароль?
                                </button>
                            )}
                        </>
                    )}
                </div>

                <div className="auth-features">
                    <div className="auth-feat">
                        <span className="auth-feat-ico">👥</span>
                        <span className="auth-feat-title">Сообщество</span>
                        <span className="auth-feat-desc">Единомышленники рядом</span>
                    </div>
                    <div className="auth-feat">
                        <span className="auth-feat-ico">📚</span>
                        <span className="auth-feat-title">Знания</span>
                        <span className="auth-feat-desc">Курсы и материалы для роста</span>
                    </div>
                    <div className="auth-feat">
                        <span className="auth-feat-ico">💬</span>
                        <span className="auth-feat-title">Общение</span>
                        <span className="auth-feat-desc">Диалоги без поверхностности</span>
                    </div>
                </div>
            </div>
        </div>
    );

    // ── Chat Screen ───────────────────────────────────────────────
    if (tab === 'chat' && partner) return (
        <div className="app">
            <div className="chat-screen">
                <div className="chat-header">
                    <button className="icon-btn" onClick={goBack}><IcoBack /></button>
                    <div className="chat-header-ava-btn" onClick={() => setViewPartner(true)}>
                        <Ava src={partner.avatar} name={partner.username} size={40} />
                    </div>
                    <div className="chat-header-info" onClick={() => setViewPartner(true)} style={{ cursor: 'pointer' }}>
                        <div className="chat-header-name">{partner.username}</div>
                        <div className="chat-header-status">
                            {typing.length > 0 ? 'печатает...' : online.some((u: any) => u.userId === partner.userId) ? 'онлайн' : 'не в сети'}
                        </div>
                    </div>
                </div>

                {viewPartner && (
                    <div className="profile-overlay" onClick={() => setViewPartner(false)}>
                        <div className="profile-sheet" onClick={e => e.stopPropagation()}>
                            <div className="profile-sheet-ava">
                                <Ava src={partner.avatar} name={partner.username} size={88} />
                            </div>
                            <div className="profile-sheet-name">{partner.username}</div>
                            <div className="profile-sheet-sub">@{(partner.username || 'user').toLowerCase().replace(/\s/g, '')}</div>
                            <div className="profile-sheet-status">
                                {online.some((u: any) => u.userId === partner.userId) ? '● онлайн' : 'последний раз в сети...'}
                            </div>
                            <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => setViewPartner(false)}>
                                Написать
                            </button>
                        </div>
                    </div>
                )}

                <div className="msgs-area">
                    {hasMoreMessages && (
                        <div className="load-more-wrap">
                            <button className="load-more-btn" onClick={handleLoadMore} disabled={loadingMore}>
                                {loadingMore ? 'Загрузка...' : '⬆ Загрузить историю'}
                            </button>
                        </div>
                    )}
                    {[...olderMessages, ...messages].map(msg => (
                        <div key={msg.id} className={`msg-row ${msg.senderId === user.uid ? 'msg-me' : 'msg-them'}`}
                            onContextMenu={e => { e.preventDefault(); setReactionFor(msg.id); }}>
                            <div className={`bubble ${msg.senderId === user.uid ? 'bubble-me' : 'bubble-them'}`}>
                                {msg.fileUrl && msg.fileType === 'audio/voice'
                                    ? <AudioPlayer url={msg.fileUrl} label={msg.fileName} isMe={msg.senderId === user.uid} />
                                    : msg.fileUrl && msg.fileType?.startsWith('image/')
                                        ? <img src={msg.fileUrl} alt="" className="msg-img" />
                                        : msg.fileUrl
                                            ? <div className="msg-file-chip">📎 {msg.fileName || msg.text?.replace('[File] ', '') || 'Файл'}</div>
                                            : null
                                }
                                {!msg.fileUrl && <p className="bubble-text">{msg.text}</p>}
                                <span className="bubble-time">
                                    {msg.timestamp?.toLocaleTimeString?.([], { hour: '2-digit', minute: '2-digit' }) || ''}
                                </span>
                            </div>
                            {msg.reactions?.length > 0 && (
                                <div className="reactions-row">
                                    {msg.reactions.map((r: any, i: number) => (
                                        <span key={i} className="reaction">{r.emoji}</span>
                                    ))}
                                </div>
                            )}
                            {reactionFor === msg.id && (
                                <div className="reaction-picker">
                                    {REACTIONS.map(em => (
                                        <button key={em} onClick={() => { addReaction(chatId!, msg.id, user.uid, em); setReactionFor(null); }}>{em}</button>
                                    ))}
                                    <button onClick={() => setReactionFor(null)} style={{ opacity: 0.5 }}>✕</button>
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={endRef} />
                </div>

                {showEmoji && (
                    <div className="emoji-panel">
                        {EMOJIS.map(em => <button key={em} onClick={() => { setInput(p => p + em); setShowEmoji(false); }}>{em}</button>)}
                    </div>
                )}

                {sendErr && <div className="send-err">{sendErr}</div>}

                <div className="composer">
                    <button className="composer-btn" onClick={() => fileRef.current?.click()}>📎</button>
                    <input type="file" ref={fileRef} accept="image/*,video/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={e => handleFile(e, 'chat')} />

                    {isRecording ? (
                        <div className="recording-indicator">
                            <div className="rec-dot" />
                            <span className="rec-time">{Math.floor(recordDuration/60).toString().padStart(2,'0')}:{(recordDuration%60).toString().padStart(2,'0')}</span>
                            <button className="composer-btn rec-cancel" onClick={() => stopRecording(false)}>✕</button>
                        </div>
                    ) : (
                        <>
                            <button className="composer-btn" onClick={() => setShowEmoji(v => !v)}>😊</button>
                            <button
                                className="composer-btn"
                                onMouseDown={startRecording}
                                onTouchStart={e => { e.preventDefault(); startRecording(); }}
                                onMouseUp={() => stopRecording(true)}
                                onTouchEnd={e => { e.preventDefault(); stopRecording(true); }}
                            >🎤</button>
                        </>
                    )}

                    {selFile && (
                        <div className="file-chip">
                            <span>{selFile.name}</span>
                            <button onClick={() => setSelFile(null)}>✕</button>
                        </div>
                    )}
                    <input type="text" className="composer-input" value={input} placeholder="Сообщение..."
                        onChange={e => handleTyping(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
                    <button className="send-btn" onClick={send}><IcoSend /></button>
                </div>
            </div>
        </div>
    );

    // ── Main ──────────────────────────────────────────────────────
    return (
        <div className="app">
            <div className="main-wrap">

                {/* CHATS */}
                {tab === 'chats' && (
                    <div className="page">
                        <div className="page-hdr">
                            <div>
                                <div className="eyebrow">NSS</div>
                                <h1 className="page-title">Сообщения</h1>
                            </div>
                        </div>

                        <div className="search-row">
                            <input className="search-input" type="text" placeholder="🔍  Поиск чатов"
                                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                        </div>

                        {(() => {
                            const q = searchQuery.trim().toLowerCase();
                            const filteredOnline = q ? online.filter((u: any) => u.username?.toLowerCase().includes(q)) : online;
                            return filteredOnline.length > 0 && (
                            <div className="stories">
                                {filteredOnline.map((u: any) => (
                                    <div key={u.userId} className="story" onClick={() => startChat(u.userId, u.username, u.avatar)}>
                                        <div className="story-ava">
                                            <Ava src={u.avatar} name={u.username} size={56} />
                                            <div className="story-dot" />
                                        </div>
                                        <span className="story-name">{(u.username || '').split(' ')[0]}</span>
                                    </div>
                                ))}
                            </div>
                        );
                        })()}

                        {!searchQuery && (
                            <>
                                <div className="list-section" onClick={() => setCityOpen(v => !v)}>
                                    <span>🏙 Города</span>
                                    <span>{cityOpen ? '▲' : '▼'}</span>
                                </div>
                                {cityOpen && CITY_CHATS.map(c => (
                                    <div key={c.id} className="chat-row" onClick={() => startChat(`__group_${c.id}`, c.name)}>
                                        <div className="ava city-ava" style={{ width: 52, height: 52, minWidth: 52, background: c.color }}>
                                            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{c.short}</span>
                                        </div>
                                        <div className="chat-info">
                                            <div className="chat-row-top">
                                                <span className="chat-name">{c.name}</span>
                                            </div>
                                            <span className="chat-preview">Городской чат клуба</span>
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}

                        {(() => {
                            const q = searchQuery.trim().toLowerCase();
                            const filtered = q ? chats.filter((ch: any) => ch.partner?.username?.toLowerCase().includes(q)) : chats;
                            return (
                                <>
                                    {filtered.length > 0 && <div className="list-section-plain">Личные чаты</div>}
                                    {filtered.map((ch: any) => {
                                        const p = ch.partner;
                                        return (
                                            <div key={ch.chatId} className="chat-row" onClick={() => startChat(ch.partnerId, p?.username, p?.avatar)}>
                                                <Ava src={p?.avatar} name={p?.username || '?'} size={52} online={online.some((u: any) => u.userId === ch.partnerId)} />
                                                <div className="chat-info">
                                                    <div className="chat-row-top">
                                                        <span className="chat-name">{p?.username || 'Пользователь'}</span>
                                                        <span className="chat-time">
                                                            {ch.lastMessageTime ? new Date(ch.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                                        </span>
                                                    </div>
                                                    <div className="chat-row-bot">
                                                        <span className="chat-preview">{ch.lastMessage || 'Нет сообщений'}</span>
                                                        {ch.isUnread && <span className="unread-badge" />}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {q && filtered.length === 0 && (
                                        <div className="empty-state"><p>Ничего не найдено</p></div>
                                    )}
                                </>
                            );
                        })()}

                        {chats.length === 0 && online.length === 0 && !searchQuery && (
                            <div className="empty-state">
                                <p style={{ fontSize: 40 }}>💬</p>
                                <p>Нет чатов</p>
                            </div>
                        )}
                    </div>
                )}

                {/* COURSES */}
                {tab === 'courses' && !selectedCourse && (
                    <div className="page">
                        <div className="page-hdr">
                            <div>
                                <div className="eyebrow">NSS</div>
                                <h1 className="page-title">Курсы</h1>
                            </div>
                        </div>
                        {COURSES.map((c) => {
                            const done = (courseProgress[c.id] || []).length;
                            const total = c.lessons.length;
                            const pct = total > 0 ? Math.round(done / total * 100) : 0;
                            return (
                                <div key={c.id} className="course-card" onClick={() => setSelectedCourse(c.id)}>
                                    <div className="course-ico" style={{ background: c.color }}>{c.icon}</div>
                                    <div className="course-body">
                                        <div className="course-title">{c.title}</div>
                                        <div className="course-desc">{c.desc}</div>
                                        <div className="course-footer">
                                            <span className="course-lessons">{total} уроков · {pct}%</span>
                                            <div className="progress-bar">
                                                <div className="progress-fill" style={{ background: c.color, width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* COURSE DETAIL */}
                {tab === 'courses' && selectedCourse && (() => {
                    const c = COURSES.find(x => x.id === selectedCourse)!;
                    const done = courseProgress[c.id] || [];
                    const pct = Math.round(done.length / c.lessons.length * 100);
                    return (
                        <div className="page">
                            <div className="course-detail-header">
                                <button className="icon-btn" onClick={() => setSelectedCourse(null)}><IcoBack /></button>
                                <div className="course-detail-ico" style={{ background: c.color }}>{c.icon}</div>
                                <div className="course-detail-info">
                                    <div className="course-title">{c.title}</div>
                                    <div className="course-desc">{c.desc}</div>
                                </div>
                            </div>
                            <div className="course-detail-progress">
                                <div className="course-detail-pct">{pct}% завершено · {done.length} из {c.lessons.length}</div>
                                <div className="progress-bar" style={{ height: 6 }}>
                                    <div className="progress-fill" style={{ background: c.color, width: `${pct}%` }} />
                                </div>
                            </div>
                            <div className="lesson-list">
                                {c.lessons.map((lesson, idx) => {
                                    const completed = done.includes(idx);
                                    return (
                                        <div key={idx} className={`lesson-row${completed ? ' lesson-done' : ''}`}
                                            onClick={() => handleCompleteLesson(c.id, idx)}>
                                            <div className="lesson-num" style={{ background: completed ? c.color : 'var(--card2)', color: completed ? '#000' : 'var(--sub)' }}>
                                                {completed ? '✓' : idx + 1}
                                            </div>
                                            <span className="lesson-title">{lesson}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {/* PROFILE */}
                {tab === 'profile' && (
                    <div className="page">
                        {!user.emailVerified && (
                            <div className="verif-banner">
                                <span>📧 Email не подтверждён</span>
                                <button onClick={async () => {
                                    await sendEmailVerification(user);
                                    setEmailVerifSent(true);
                                }}>
                                    {emailVerifSent ? '✓ Отправлено' : 'Подтвердить'}
                                </button>
                            </div>
                        )}
                        <div className="profile-hero">
                            <div className="profile-glow" />
                            <div className="profile-ava-btn" onClick={() => avaRef.current?.click()}>
                                <Ava src={profile?.avatar} name={profile?.username || user.email} size={90} />
                                <div className="ava-edit-badge">✏️</div>
                            </div>
                            <input type="file" ref={avaRef} accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e, 'avatar')} />
                            <h2 className="profile-name">{profile?.username || user.email}</h2>
                            <p className="profile-handle">@{(profile?.username || 'user').toLowerCase().replace(/\s/g, '')}</p>
                            {profile?.bio && <p className="profile-bio">{profile.bio}</p>}
                            {profile?.createdAt && (
                                <p className="profile-registered">
                                    Зарегистрирован: {new Date(profile.createdAt?.toDate?.() || profile.createdAt).toLocaleDateString('ru-RU')}
                                </p>
                            )}
                            <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => {
                                setEditUsername(profile?.username || '');
                                setEditBio(profile?.bio || '');
                                setEditProfile(true);
                            }}>Редактировать профиль</button>
                            <div className="profile-stats">
                                <div className="stat"><div className="stat-val">{chats.length}</div><div className="stat-lbl">Чаты</div></div>
                                <div className="stat"><div className="stat-val">5</div><div className="stat-lbl">Курсы</div></div>
                                <div className="stat"><div className="stat-val">Pro</div><div className="stat-lbl">Тариф</div></div>
                            </div>
                        </div>

                        {settingsToast && <div className="settings-toast">{settingsToast}</div>}

                        <div className="settings-list">
                            {[
                                { ico: '👤', lbl: 'Аккаунт', action: () => { setEditUsername(profile?.username || ''); setEditBio(profile?.bio || ''); setEditProfile(true); } },
                                { ico: '🔔', lbl: 'Уведомления', action: () => setSettingsToast('Скоро доступно') },
                                { ico: '🔒', lbl: 'Приватность', action: () => setSettingsToast('Скоро доступно') },
                                { ico: '🎨', lbl: 'Оформление', action: () => setSettingsToast('Скоро доступно') },
                                { ico: '🛡', lbl: 'Безопасность', action: () => setSettingsToast(`Ваш ID: ${user.uid.slice(0, 8)}…`) },
                                { ico: '💬', lbl: 'Поддержка', action: () => setSettingsToast('support@nss.club') },
                            ].map(({ ico, lbl, action }) => (
                                <div key={lbl} className="settings-row" onClick={action}>
                                    <span className="settings-ico">{ico}</span>
                                    <span className="settings-lbl">{lbl}</span>
                                    <IcoArrow />
                                </div>
                            ))}
                            <div className="settings-row settings-danger" onClick={handleLogout}>
                                <span className="settings-ico">🚪</span>
                                <span className="settings-lbl" style={{ color: '#FF5C7A' }}>Выйти</span>
                                <IcoArrow />
                            </div>
                        </div>

                    </div>
                )}
            </div>

            {/* NOTIFICATIONS TAB */}
            {tab === 'notifs' && (
                <div className="page" style={{position:'absolute',inset:0,top:'env(safe-area-inset-top,0px)',overflowY:'auto',background:'var(--bg)',zIndex:1}}>
                    <div className="page-hdr">
                        <div>
                            <div className="eyebrow">NSS</div>
                            <h1 className="page-title">Уведомления</h1>
                        </div>
                    </div>
                    {NOTIFS.map(n => (
                        <div key={n.id} className={`notif-row${n.unread ? ' notif-unread' : ''}`}>
                            <div className="notif-ico-wrap">
                                <span className="notif-ico">{n.ico}</span>
                            </div>
                            <div className="notif-body">
                                <div className="notif-title">{n.title}</div>
                                <div className="notif-text">{n.body}</div>
                            </div>
                            <div className="notif-meta">
                                <span className="notif-time">{n.time}</span>
                                {n.unread && <div className="notif-dot" />}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* EDIT PROFILE OVERLAY — outside main-wrap so fixed positioning covers the bottom nav */}
            {editProfile && (
                <div className="profile-overlay" onClick={() => setEditProfile(false)}>
                    <div className="profile-sheet edit-profile-sheet" onClick={e => e.stopPropagation()}>
                        <div className="profile-sheet-name" style={{ marginBottom: 16 }}>Редактировать профиль</div>
                        <input className="nss-input" placeholder="Имя" value={editUsername}
                            onChange={e => setEditUsername(e.target.value)} />
                        <input className="nss-input" placeholder="О себе" value={editBio}
                            onChange={e => setEditBio(e.target.value)} style={{ marginTop: 10 }} />
                        <button className="btn-primary" style={{ marginTop: 16 }} onClick={async () => {
                            if (!editUsername.trim()) return;
                            await updateUserProfile(user.uid, { username: editUsername.trim(), bio: editBio.trim() });
                            setProfile((p: any) => ({ ...p, username: editUsername.trim(), bio: editBio.trim() }));
                            setEditProfile(false);
                        }}>Сохранить</button>
                    </div>
                </div>
            )}

            {/* BOTTOM NAV */}
            <div className="bottom-nav">
                <button className={`nav-btn${tab === 'chats' ? ' nav-active' : ''}`} onClick={() => setTab('chats')}>
                    <span className="nav-ico">💬</span>
                    <span className="nav-lbl">Чаты</span>
                </button>
                <button className={`nav-btn${tab === 'courses' ? ' nav-active' : ''}`} onClick={() => setTab('courses')}>
                    <span className="nav-ico">📚</span>
                    <span className="nav-lbl">Курсы</span>
                </button>
                <button className={`nav-btn${tab === 'notifs' ? ' nav-active' : ''}`} onClick={() => setTab('notifs')}>
                    <span className="nav-ico">🔔</span>
                    <span className="nav-lbl">Лента</span>
                </button>
                <button className={`nav-btn${tab === 'profile' ? ' nav-active' : ''}`} onClick={() => setTab('profile')}>
                    <span className="nav-ico">👤</span>
                    <span className="nav-lbl">Профиль</span>
                </button>
            </div>
        </div>
    );
}

export default function AppWrapper() {
    return <ErrorBoundary><App /></ErrorBoundary>;
}
