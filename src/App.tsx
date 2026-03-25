import { useState, useEffect, useRef, useCallback, Component } from 'react';
import { 
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile
} from 'firebase/auth';
import { auth } from './firebase';
import {
    generateMessageId
} from './utils/crypto';
import {
    createUserProfile,
    getUserProfile,
    updateUserProfile,
    subscribeToMessages,
    saveMessage,
    addReaction,
    uploadAvatar,
    uploadStatus,
    getChatSessionKey,
    setTypingStatus,
    subscribeToTyping,
    getUserChats,
    createChat,
    getOnlineUsers,
    uploadFile,
    getStatuses
} from './utils/firebaseService';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('React Error:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ 
                    padding: 20, 
                    color: 'white', 
                    background: '#0A0B10', 
                    height: '100%',
                    fontFamily: 'sans-serif'
                }}>
                    <h1 style={{color: '#FF5C7A'}}>Something went wrong</h1>
                    <pre style={{background: 'rgba(255,255,255,0.1)', padding: 10, borderRadius: 8}}>
                        {this.state.error?.message || this.state.error?.toString() || 'Unknown error'}
                    </pre>
                </div>
            );
        }
        return this.props.children;
    }
}

import './App.css';

const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😀', '😂', '😍', '🥰', '😎', '🤔', '😅', '😭', '😤', '🥳', '😴', '🤯', '👍', '👎', '👋', '🙏', '💪', '🎉', '🔥', '❤️', '💔', '✨', '🌟', '💯'];

function IconChat({ color = '#fff', size = 22 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M8 18H5L6.2 15.6C5.45 14.69 5 13.53 5 12.25C5 8.8 8.13 6 12 6C15.87 6 19 8.8 19 12.25C19 15.7 15.87 18.5 12 18.5C10.64 18.5 9.38 18.15 8.3 17.55L8 18Z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );
}

function IconCall({ color = '#fff', size = 22 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M6.9 4.5L9.3 4.2C9.72 4.15 10.12 4.39 10.28 4.78L11.38 7.41C11.52 7.75 11.43 8.15 11.15 8.39L9.76 9.58C10.68 11.45 12.2 12.97 14.07 13.89L15.26 12.5C15.5 12.22 15.9 12.13 16.24 12.27L18.87 13.37C19.26 13.53 19.5 13.93 19.45 14.35L19.15 16.75C19.08 17.31 18.61 17.73 18.05 17.73C10.95 17.73 5.92 12.7 5.92 5.6C5.92 5.04 6.34 4.57 6.9 4.5Z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );
}

function IconUser({ color = '#fff', size = 22 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="8" r="3.5" stroke={color} strokeWidth="1.8"/>
            <path d="M5.5 18.5C6.9 15.95 9.16 14.8 12 14.8C14.84 14.8 17.1 15.95 18.5 18.5" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
    );
}

function IconArrow({ color = '#fff', size = 18 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M9 6L15 12L9 18" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );
}

function IconSend({ color = '#fff', size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path d="M21 3L10 14" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 3L14 21L10 14L3 10L21 3Z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    );
}

function App() {
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [currentPartner, setCurrentPartner] = useState(null);
    const [chatId, setChatId] = useState(null);
    const [sessionKey, setSessionKey] = useState(null);

    const [chats, setChats] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [typingUsers, setTypingUsers] = useState([]);

    const [activeTab, setActiveTab] = useState('chats');
    const [showProfile, setShowProfile] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showReactionPicker, setShowReactionPicker] = useState(null);
    const [theme, setTheme] = useState('dark');
    const [selectedFile, setSelectedFile] = useState(null);

    const fileInputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const typingTimeoutRef = useRef(null);

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                let profile = await getUserProfile(firebaseUser.uid);
                
                if (!profile) {
                    const username = sessionStorage.getItem('temp_username') || firebaseUser.email.split('@')[0];
                    profile = await createUserProfile(firebaseUser.uid, username, firebaseUser.email);
                    sessionStorage.removeItem('temp_username');
                }
                
                setUserProfile(profile);
            } else {
                setUser(null);
                setUserProfile(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (user && chatId && sessionKey) {
            const unsubscribe = subscribeToMessages(chatId, sessionKey, setMessages);
            return () => unsubscribe && unsubscribe();
        } else {
            setMessages([]);
        }
    }, [chatId, sessionKey, user]);

    const loadChats = useCallback(async () => {
        if (!user) return;
        const userChats = await getUserChats(user.uid);
        setChats(userChats);
    }, [user]);

    const loadStatuses = useCallback(async () => {
        await getStatuses();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (user) {
            loadChats();
            loadStatuses();
            const interval = setInterval(async () => {
                const users = await getOnlineUsers();
                setOnlineUsers(users.filter(u => u.userId !== user.uid));
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [user, loadChats, loadStatuses]);

    useEffect(() => {
        if (chatId && user) {
            const unsubscribe = subscribeToTyping(chatId, user.uid, (users) => {
                setTypingUsers(users);
            });
            return () => unsubscribe();
        } else {
            setTypingUsers([]);
        }
    }, [chatId, user]);

    const handleAuth = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                sessionStorage.setItem('temp_username', username);
                const result = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(result.user, { displayName: username });
            }
        } catch (err) {
            setError(err.message);
        }
        setLoading(false);
    };

    const _handleLogout = async () => {
        await signOut(auth);
        setCurrentPartner(null);
        setChatId(null);
        setMessages([]);
    };

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    };

    const startChat = async (partnerId, partnerName, partnerAvatar = null) => {
        const newChatId = await createChat(user.uid, partnerId);
        const key = await getChatSessionKey(newChatId, user.uid);
        
        setChatId(newChatId);
        setSessionKey(key);
        setCurrentPartner({ 
            userId: partnerId, 
            username: partnerName,
            avatar: partnerAvatar 
        });
        setActiveTab('chat');
    };

    const sendMessage = async () => {
        if ((!input.trim() && !selectedFile) || !chatId || !sessionKey) return;

        await setTypingStatus(chatId, user.uid, false);

        if (selectedFile) {
            const message = {
                id: generateMessageId(),
                text: `[File] ${selectedFile.name}`,
                senderId: user.uid,
                senderName: userProfile?.username || user.email,
                fileUrl: selectedFile.url,
                fileType: selectedFile.type
            };
            await saveMessage(chatId, message, sessionKey);
            setSelectedFile(null);
        }

        if (input.trim()) {
            const message = {
                id: generateMessageId(),
                text: input,
                senderId: user.uid,
                senderName: userProfile?.username || user.email
            };
            await saveMessage(chatId, message, sessionKey);
        }
        
        setInput('');
    };

    const handleTyping = useCallback(async (text) => {
        setInput(text);
        if (chatId && user) {
            await setTypingStatus(chatId, user.uid, text.length > 0);
            
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
            }
            
            typingTimeoutRef.current = setTimeout(async () => {
                await setTypingStatus(chatId, user.uid, false);
            }, 2000);
        }
    }, [chatId, user]);

    const handleReaction = async (messageId, emoji) => {
        if (chatId) {
            await addReaction(chatId, messageId, user.uid, emoji);
            setShowReactionPicker(null);
        }
    };

    const handleFileSelect = async (e, type) => {
        const file = e.target.files[0];
        if (!file || !user) return;

        if (type === 'avatar') {
            const url = await uploadAvatar(user.uid, file);
            setUserProfile(prev => ({ ...prev, avatar: url }));
        } else if (type === 'status') {
            await uploadStatus(user.uid, file, file.type.startsWith('video') ? 'video' : 'image');
            loadStatuses();
        } else if (type === 'chat') {
            const url = await uploadFile(chatId, file, user.uid);
            setSelectedFile({
                name: file.name,
                url,
                type: file.type
            });
        }
    };

    const _updateBio = async (newBio) => {
        await updateUserProfile(user.uid, { bio: newBio });
        setUserProfile(prev => ({ ...prev, bio: newBio }));
    };

    const addEmoji = (emoji) => {
        setInput(prev => prev + emoji);
        setShowEmojiPicker(false);
    };

    if (loading) {
        return (
            <div className="loading-screen">
                <div className="loader"></div>
                <p>Loading...</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="app">
                <div className="welcome-container">
                    <div className="hero-glow-1"></div>
                    <div className="hero-glow-2"></div>
                    
                    <div className="logo-wrap">
                        <div className="logo-outer">
                            <div className="logo-inner">
                                <span className="logo-mark">L</span>
                            </div>
                        </div>
                    </div>

                    <div className="brand">LAVASYNC</div>
                    <h1 className="hero-title">Private chats.<br/>Fast sync.<br/>Clean energy.</h1>
                    <p className="hero-subtitle">
                        E2E encrypted messenger with premium design: fast chats, calls, statuses, private dialogues.
                    </p>

                    <div className="feature-row">
                        <div className="feature-pill"><span className="feature-pill-text">E2EE Ready UI</span></div>
                        <div className="feature-pill"><span className="feature-pill-text">Live Status</span></div>
                        <div className="feature-pill"><span className="feature-pill-text">Smart Sync</span></div>
                    </div>

                    <div style={{ height: 32 }}></div>

                    <div className="primary-button" onClick={() => setIsLogin(true)}>
                        <span className="primary-button-text">Войти</span>
                    </div>
                    <div style={{ height: 12 }}></div>
                    <div className="primary-button ghost-button" onClick={() => setIsLogin(false)}>
                        <span className="primary-button-text">Создать аккаунт</span>
                    </div>

                    <div className="auth-container">
                        <h2 className="auth-title">LAVASYNC Access</h2>
                        <p className="auth-subtitle">
                            Minimalistic. Premium. No basement vibes.
                        </p>

                        <div className="switcher">
                            <div 
                                className={`switcher-item ${isLogin ? 'active' : ''}`}
                                onClick={() => setIsLogin(true)}
                            >
                                <span className="switcher-text">Вход</span>
                            </div>
                            <div 
                                className={`switcher-item ${!isLogin ? 'active' : ''}`}
                                onClick={() => setIsLogin(false)}
                            >
                                <span className="switcher-text">Регистрация</span>
                            </div>
                        </div>

                        <div className="auth-card">
                            {!isLogin && (
                                <>
                                    <label className="input-label">Имя</label>
                                    <input
                                        type="text"
                                        className="input-field"
                                        placeholder="Введите имя"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                    />
                                </>
                            )}

                            <label className="input-label">Email</label>
                            <input
                                type="email"
                                className="input-field"
                                placeholder="name@lava.sync"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />

                            <label className="input-label">Пароль</label>
                            <input
                                type="password"
                                className="input-field"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />

                            {error && <p style={{ color: '#FF5C7A', marginTop: 8, fontSize: 13 }}>{error}</p>}

                            <div style={{ height: 10 }}></div>

                            <div className="primary-button" onClick={handleAuth}>
                                <span className="primary-button-text">
                                    {isLogin ? 'Войти в LAVASYNC' : 'Создать аккаунт'}
                                </span>
                            </div>

                            <div className="link-btn">
                                <span className="link-text">
                                    {isLogin ? 'Забыли пароль?' : 'Уже есть аккаунт?'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            {activeTab === 'chat' && currentPartner ? (
                <div className="screen">
                    <div className="room-header">
                        <button className="header-back-btn" onClick={() => {
                            setCurrentPartner(null);
                            setChatId(null);
                            setMessages([]);
                        }}>
                            <IconArrow />
                        </button>
                        <div className="room-header-user" onClick={() => setShowProfile(true)}>
                            <div className="room-avatar">
                                <span style={{ 
                                    width: '100%', 
                                    height: '100%', 
                                    borderRadius: '50%', 
                                    background: '#8B5CF6',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontSize: 18,
                                    fontWeight: 800
                                }}>
                                    {currentPartner.username?.[0] || '?'}
                                </span>
                                <div className="room-online"></div>
                            </div>
                            <div>
                                <div className="room-name">{currentPartner.username}</div>
                                <div className="room-status">
                                    {typingUsers.length > 0 ? 'печатает...' : 'online'}
                                </div>
                            </div>
                        </div>
                        <button className="header-circle-btn-small">
                            <IconCall />
                        </button>
                    </div>

                    <div className="messages-list">
                        {messages.map((msg) => (
                            <div 
                                key={msg.id} 
                                className={`message-row ${msg.senderId === user.uid ? 'message-row-me' : 'message-row-them'}`}
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setShowReactionPicker(msg.id);
                                }}
                            >
                                <div className={`message-bubble ${msg.senderId === user.uid ? 'message-bubble-me' : 'message-bubble-them'}`}>
                                    {msg.fileUrl && (
                                        msg.fileType?.startsWith('image/') 
                                            ? <img src={msg.fileUrl} alt="" className="message-image" />
                                            : <div className="message-file">📎 {msg.text}</div>
                                    )}
                                    {msg.text && !msg.fileUrl && (
                                        <span className="message-text">{msg.text}</span>
                                    )}
                                    <span className="message-time">
                                        {msg.timestamp?.toLocaleTimeString?.() || msg.timestamp}
                                    </span>
                                </div>
                                {msg.reactions?.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                        {msg.reactions.map((r, i) => (
                                            <span key={i} style={{ 
                                                fontSize: 14, 
                                                background: '#11131A', 
                                                padding: '2px 6px', 
                                                borderRadius: 8 
                                            }}>{r.emoji}</span>
                                        ))}
                                    </div>
                                )}
                                {showReactionPicker === msg.id && (
                                    <div style={{ 
                                        display: 'flex', 
                                        gap: 4, 
                                        marginTop: 8,
                                        background: '#11131A',
                                        padding: 8,
                                        borderRadius: 20
                                    }}>
                                        {REACTIONS.map((emoji) => (
                                            <button 
                                                key={emoji}
                                                onClick={() => handleReaction(msg.id, emoji)}
                                                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {showEmojiPicker && (
                        <div className="emoji-picker">
                            <div className="emoji-grid">
                                {EMOJIS.map((emoji) => (
                                    <button key={emoji} onClick={() => addEmoji(emoji)}>
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="composer-wrap">
                        <button className="header-circle-btn" onClick={() => fileInputRef.current?.click()}>
                            📎
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*,video/*,.pdf,.doc,.docx"
                            style={{ display: 'none' }}
                            onChange={(e) => handleFileSelect(e, 'chat')}
                        />
                        
                        {selectedFile && (
                            <div className="file-preview">
                                <span>📎 {selectedFile.name}</span>
                                <button className="remove-file" onClick={() => setSelectedFile(null)}>✕</button>
                            </div>
                        )}
                        
                        <button className="header-circle-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                            😊
                        </button>
                        
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => handleTyping(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                            placeholder="Сообщение..."
                            className="composer-input"
                        />
                        <button className="send-btn" onClick={sendMessage}>
                            <IconSend />
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="screen">
                        <div className="screen-header">
                            <div>
                                <div className="screen-eyebrow">LAVASYNC</div>
                                <h1 className="screen-title">
                                    {activeTab === 'chats' ? 'Сообщения' : activeTab === 'calls' ? 'Звонки' : 'Профиль'}
                                </h1>
                            </div>
                            <button className="header-circle-btn" onClick={() => setShowProfile(true)}>
                                <span className="header-circle-btn-text">＋</span>
                            </button>
                        </div>

                        <div className="search-wrap">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Поиск чатов"
                                className="search-input"
                            />
                        </div>

                        {activeTab === 'chats' && (
                            <>
                                <div className="story-row">
                                    {onlineUsers.map((u) => (
                                        <div key={u.userId} className="story-item" onClick={() => startChat(u.userId, u.username)}>
                                            <div className="story-avatar-wrap">
                                                <div className="story-avatar" style={{ 
                                                    background: '#8B5CF6',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: 'white',
                                                    fontSize: 20,
                                                    fontWeight: 800
                                                }}>
                                                    {u.avatar 
                                                        ? <img src={u.avatar} alt="" /> 
                                                        : u.username?.[0] || '?'
                                                    }
                                                </div>
                                                <div className="story-online"></div>
                                            </div>
                                            <span className="story-name">{u.username}</span>
                                        </div>
                                    ))}
                                </div>

                                <div className="chat-list">
                                    {chats.map((chat) => {
                                        const partner = chat.partner;
                                        return (
                                            <div 
                                                key={chat.chatId} 
                                                className="chat-card" 
                                                onClick={() => startChat(chat.partnerId, partner?.username, partner?.avatar)}
                                            >
                                                <div className="avatar">
                                                    <div style={{ 
                                                        width: '100%', 
                                                        height: '100%', 
                                                        borderRadius: '50%', 
                                                        background: '#8B5CF6',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'white',
                                                        fontSize: 20,
                                                        fontWeight: 800
                                                    }}>
                                                        {partner?.avatar 
                                                            ? <img src={partner.avatar} alt="" /> 
                                                            : partner?.username?.[0] || '?'
                                                        }
                                                    </div>
                                                    {partner?.status === 'online' && <div className="online-dot"></div>}
                                                </div>
                                                <div className="chat-mid">
                                                    <div className="chat-top-row">
                                                        <div className="chat-name-row">
                                                            <span className="chat-name">{partner?.username || 'Unknown'}</span>
                                                            {partner?.verified && (
                                                                <div className="verified-badge">
                                                                    <span className="verified-text">✓</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="chat-time">
                                                            {chat.lastMessageTime 
                                                                ? new Date(chat.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                                                : ''
                                                            }
                                                        </span>
                                                    </div>
                                                    <span className="chat-last-message">
                                                        {chat.lastMessage || 'Нет сообщений'}
                                                    </span>
                                                </div>
                                                {chat.unreadCount > 0 && (
                                                    <div className="unread-badge">
                                                        <span className="unread-text">{chat.unreadCount}</span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {chats.length === 0 && onlineUsers.length > 0 && onlineUsers.map((u) => (
                                        <div key={u.userId} className="chat-card" onClick={() => startChat(u.userId, u.username, u.avatar)}>
                                            <div className="avatar">
                                                <div style={{ 
                                                    width: '100%', 
                                                    height: '100%', 
                                                    borderRadius: '50%', 
                                                    background: '#8B5CF6',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: 'white',
                                                    fontSize: 20,
                                                    fontWeight: 800
                                                }}>
                                                    {u.avatar 
                                                        ? <img src={u.avatar} alt="" /> 
                                                        : u.username?.[0] || '?'
                                                    }
                                                </div>
                                                <div className="online-dot"></div>
                                            </div>
                                            <div className="chat-mid">
                                                <div className="chat-top-row">
                                                    <div className="chat-name-row">
                                                        <span className="chat-name">{u.username}</span>
                                                    </div>
                                                </div>
                                                <span className="chat-last-message">Нажмите, чтобы начать чат</span>
                                            </div>
                                        </div>
                                    ))}

                                    {chats.length === 0 && onlineUsers.length === 0 && !searchQuery && (
                                        <div className="no-users">
                                            Нет чатов. Начните общение с пользователями ниже!
                                        </div>
                                    )}

                                    {!searchQuery && onlineUsers.length > 0 && chats.length > 0 && (
                                        <div style={{ padding: '12px', color: '#8C93A8', fontSize: 13 }}>
                                            Новые пользователи
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {activeTab === 'calls' && (
                            <div className="calls-wrap">
                                <div className="chat-card">
                                    <div className="avatar">
                                        <div style={{ 
                                            width: '100%', 
                                            height: '100%', 
                                            borderRadius: '50%', 
                                            background: '#8B5CF6',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: 20,
                                            fontWeight: 800
                                        }}>S</div>
                                    </div>
                                    <div className="chat-mid">
                                        <span className="chat-name">Sofia</span>
                                        <span className="chat-username">Incoming video</span>
                                        <span className="chat-time">Сегодня, 09:12</span>
                                    </div>
                                    <div className="call-icon-wrap">
                                        <IconCall />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'profile' && (
                            <div className="profile-wrap">
                                <div className="profile-hero">
                                    <div className="profile-glow"></div>
                                    <div 
                                        className="profile-avatar"
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        {userProfile?.avatar 
                                            ? <img src={userProfile.avatar} alt="" /> 
                                            : (userProfile?.username?.[0] || user.email[0])
                                        }
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        accept="image/*"
                                        style={{ display: 'none' }}
                                        onChange={(e) => handleFileSelect(e, 'avatar')}
                                    />
                                    <h2 className="profile-name">{userProfile?.username || user.email}</h2>
                                    <span className="profile-username">@{userProfile?.username?.toLowerCase().replace(/\s/g, '') || 'user'}</span>

                                    <div className="stats-row">
                                        <div className="stat-card">
                                            <div className="stat-title">{onlineUsers.length + 5}</div>
                                            <div className="stat-subtitle">Chats</div>
                                        </div>
                                        <div className="stat-card">
                                            <div className="stat-title">3</div>
                                            <div className="stat-subtitle">Calls</div>
                                        </div>
                                        <div className="stat-card">
                                            <div className="stat-title">Pro</div>
                                            <div className="stat-subtitle">Plan</div>
                                        </div>
                                    </div>
                                </div>

                                <div className="settings-card">
                                    {['Аккаунт', 'Приватность', 'Уведомления', 'Оформление', 'Безопасность', 'Поддержка'].map(item => (
                                        <div key={item} className="settings-row">
                                            <span className="settings-text">{item}</span>
                                            <IconArrow color="#8C93A8" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="tab-bar">
                        <div 
                            className={`tab-item ${activeTab === 'chats' ? 'active' : ''}`}
                            onClick={() => setActiveTab('chats')}
                        >
                            <span className="tab-icon">💬</span>
                            <span className="tab-label">Chats</span>
                        </div>
                        <div 
                            className={`tab-item ${activeTab === 'calls' ? 'active' : ''}`}
                            onClick={() => setActiveTab('calls')}
                        >
                            <span className="tab-icon">📞</span>
                            <span className="tab-label">Calls</span>
                        </div>
                        <div 
                            className={`tab-item ${activeTab === 'profile' ? 'active' : ''}`}
                            onClick={() => setActiveTab('profile')}
                        >
                            <span className="tab-icon">👤</span>
                            <span className="tab-label">Profile</span>
                        </div>
                    </div>
                </>
            )}

            {showProfile && (
                <div className="modal-overlay" onClick={() => setShowProfile(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="avatar-large" onClick={() => fileInputRef.current?.click()}>
                            {userProfile?.avatar 
                                ? <img src={userProfile.avatar} alt="" /> 
                                : (userProfile?.username?.[0] || user.email[0])
                            }
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => handleFileSelect(e, 'avatar')}
                        />
                        <h2 className="profile-name">{userProfile?.username || user.email}</h2>
                        <p className="profile-username">{user.email}</p>

                        <div className="theme-toggle">
                            <span className="theme-label">{theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}</span>
                            <div 
                                className={`toggle-switch ${theme === 'light' ? 'active' : ''}`}
                                onClick={toggleTheme}
                            />
                        </div>

                        <div className="security-info">
                            <span>🔐 E2E Encrypted</span>
                            <code>{sessionKey?.substring(0, 16)}...</code>
                        </div>

                        <button className="close-btn" onClick={() => setShowProfile(false)}>
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function AppWrapper() {
    return (
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
}
