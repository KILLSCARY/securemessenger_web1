import { 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    onSnapshot,
    doc,
    updateDoc,
    serverTimestamp,
    getDocs,
    getDoc,
    limit,
    setDoc
} from 'firebase/firestore';
import { 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from 'firebase/storage';
import { db, storage } from '../firebase';
import CryptoJS from 'crypto-js';

// Synchronous AES-256-CBC helpers — no async/Web Crypto dependency
const encryptText = (text: string, keyHex: string) => {
    const key = CryptoJS.enc.Hex.parse(keyHex);
    const iv  = CryptoJS.lib.WordArray.random(16);
    const enc = CryptoJS.AES.encrypt(text, key, {
        iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7
    });
    return {
        ciphertext: enc.ciphertext.toString(CryptoJS.enc.Base64),
        iv: iv.toString(CryptoJS.enc.Hex),
    };
};

const decryptText = (ciphertext: string, ivHex: string, keyHex: string): string => {
    try {
        const key = CryptoJS.enc.Hex.parse(keyHex);
        const iv  = CryptoJS.enc.Hex.parse(ivHex);
        const ct  = CryptoJS.enc.Base64.parse(ciphertext);
        const dec = CryptoJS.AES.decrypt(
            CryptoJS.lib.CipherParams.create({ ciphertext: ct }),
            key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        return dec.toString(CryptoJS.enc.Utf8) || '';
    } catch { return ''; }
};


export const createUserProfile = async (userId, username, email) => {
    try {
        const userDoc = {
            userId,
            username,
            email,
            avatar: null,
            status: 'online',
            lastSeen: serverTimestamp(),
            bio: '',
            createdAt: serverTimestamp(),
            publicKey: null
        };
        // Use userId as document ID to prevent duplicate documents
        await setDoc(doc(db, 'users', userId), userDoc, { merge: true });
        return userDoc;
    } catch (error) {
        console.error('Error creating profile:', error);
        return null;
    }
};

export const getUserProfile = async (userId) => {
    try {
        // Direct lookup by document ID (fast, no duplicates)
        const snap = await getDoc(doc(db, 'users', userId));
        if (snap.exists()) return { id: snap.id, ...snap.data() };
        // Fallback: query for old-style documents with auto-generated IDs
        const q = query(collection(db, 'users'), where('userId', '==', userId), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        const profileData = snapshot.docs[0].data();
        // Silently migrate to canonical path so future lookups are fast
        setDoc(doc(db, 'users', userId), profileData, { merge: true }).catch(() => {});
        return { id: snapshot.docs[0].id, ...profileData };
    } catch (error) {
        console.error('Error getting profile:', error);
        return null;
    }
};

export const updateUserProfile = async (userId, updates) => {
    try {
        // Always include userId so the online-users deduplication keeps this entry
        await setDoc(doc(db, 'users', userId), { userId, ...updates }, { merge: true });
    } catch (error) {
        console.error('Error updating profile:', error);
    }
};

export const getOnlineUsers = async () => {
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('status', '==', 'online'));
        const snapshot = await getDocs(q);
        const users = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        // Deduplicate by userId (old addDoc approach could create multiple docs per user)
        const seen = new Set<string>();
        return users.filter(u => {
            if (!u.userId || seen.has(u.userId)) return false;
            seen.add(u.userId);
            return true;
        });
    } catch (error) {
        console.error('Error getting online users:', error);
        return [];
    }
};


export const saveMessage = async (chatId, message, sessionKey) => {
    const encrypted = encryptText(message.text || '', sessionKey);

    const messageDoc: any = {
        senderId: message.senderId,
        senderName: message.senderName,
        encryptedText: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp: serverTimestamp(),
        reactions: [],
        readBy: [message.senderId]
    };
    if (message.fileUrl) messageDoc.fileUrl = message.fileUrl;
    if (message.fileType) messageDoc.fileType = message.fileType;

    await addDoc(collection(db, 'chats', chatId, 'messages'), messageDoc);

    await setDoc(doc(db, 'chats', chatId), {
        lastMessage: (message.fileUrl ? '[Файл]' : (message.text || '')).substring(0, 50),
        lastMessageTime: serverTimestamp()
    }, { merge: true });
};

export const subscribeToMessages = (chatId: string, sessionKey: string, callback: (msgs: any[]) => void) => {
    if (!chatId || !sessionKey) { callback([]); return () => {}; }

    const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
        const msgs: any[] = [];
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const text = decryptText(data.encryptedText || '', data.iv || '', sessionKey);
            msgs.push({
                id: docSnap.id,
                senderId: data.senderId,
                senderName: data.senderName,
                text,
                fileUrl: data.fileUrl ?? null,
                fileType: data.fileType ?? null,
                timestamp: data.timestamp?.toDate(),
                reactions: data.reactions ?? [],
                readBy: data.readBy ?? [],
            });
        }
        callback(msgs);
    }, (err) => {
        console.error('Messages subscription error:', err);
        callback([]);
    });
};

export const addReaction = async (chatId, messageId, userId, emoji) => {
    try {
        const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
        const messageSnap = await getDoc(messageRef);

        if (messageSnap.exists()) {
            const reactions = messageSnap.data().reactions || [];
            const existingIndex = reactions.findIndex(r => r.userId === userId && r.emoji === emoji);

            if (existingIndex >= 0) {
                reactions.splice(existingIndex, 1);
            } else {
                reactions.push({ userId, emoji, timestamp: Date.now() });
            }

            await updateDoc(messageRef, { reactions });
        }
    } catch (error) {
        console.error('Error adding reaction:', error);
    }
};

export const createChat = async (user1Id, user2Id) => {
    try {
        const chatsRef = collection(db, 'chats');
        const chatId = [user1Id, user2Id].sort().join('_');
        
        const q = query(chatsRef, where('chatId', '==', chatId), limit(1));
        const existing = await getDocs(q);
        
        if (existing.empty) {
            await addDoc(chatsRef, {
                chatId,
                participants: [user1Id, user2Id],
                lastMessage: null,
                lastMessageTime: serverTimestamp(),
                createdAt: serverTimestamp()
            });
            
            await setDoc(doc(db, 'chatKeys', chatId), {
                chatId,
                participants: {},
                createdAt: serverTimestamp()
            });
        }
        
        return chatId;
    } catch (error) {
        console.error('Error creating chat:', error);
        return `${user1Id}_${user2Id}`.split('_').sort().join('_');
    }
};

export const getUserChats = async (userId) => {
    try {
        const chatsRef = collection(db, 'chats');
        const q = query(
            chatsRef, 
            where('participants', 'array-contains', userId),
            orderBy('lastMessageTime', 'desc')
        );
        const snapshot = await getDocs(q);
        
        const chats = [];
        for (const docSnap of snapshot.docs) {
            const chatData = docSnap.data();
            const partnerId = chatData.participants.find(p => p !== userId);
            
            let partnerProfile = null;
            if (partnerId) {
                partnerProfile = await getUserProfile(partnerId);
            }
            
            chats.push({
                id: docSnap.id,
                chatId: chatData.chatId,
                partnerId,
                partner: partnerProfile,
                lastMessage: chatData.lastMessage,
                lastMessageTime: chatData.lastMessageTime?.toDate(),
                unreadCount: 0
            });
        }
        
        return chats;
    } catch (error) {
        console.error('Error getting chats:', error);
        return [];
    }
};

export const getChatSessionKey = async (chatId: string, userId: string): Promise<string> => {
    const keyName = `chat_key_${chatId}`;

    // 1. Check session storage first (fastest path, survives tab switches)
    const cached = sessionStorage.getItem(keyName);
    if (cached) {
        return JSON.parse(cached).key;
    }

    // 2. Retrieve shared key from Firestore so both participants use the SAME key
    try {
        const chatKeyRef = doc(db, 'chatKeys', chatId);
        const snapshot = await getDoc(chatKeyRef);
        if (snapshot.exists() && snapshot.data()?.sharedKey) {
            const sharedKey = snapshot.data().sharedKey as string;
            sessionStorage.setItem(keyName, JSON.stringify({ key: sharedKey, createdAt: Date.now() }));
            return sharedKey;
        }
    } catch (e) {
        console.error('Error loading chat key from Firestore:', e);
    }

    // 3. First user to open this chat: generate key and persist it
    const newKey = generateRandomKey();
    sessionStorage.setItem(keyName, JSON.stringify({ key: newKey, createdAt: Date.now() }));

    try {
        const chatKeyRef = doc(db, 'chatKeys', chatId);
        await setDoc(chatKeyRef, { sharedKey: newKey }, { merge: true });
    } catch (e) {
        console.error('Error saving chat key to Firestore:', e);
    }

    return newKey;
};

function generateRandomKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes.buffer;
}

export const uploadAvatar = async (userId, file) => {
    try {
        const avatarRef = ref(storage, `avatars/${userId}`);
        await uploadBytes(avatarRef, file);
        const url = await getDownloadURL(avatarRef);
        await updateUserProfile(userId, { avatar: url });
        return url;
    } catch (error) {
        console.error('Error uploading avatar:', error);
        return null;
    }
};

export const uploadFile = async (chatId, file, senderId) => {
    try {
        const timestamp = Date.now();
        const extension = file.name.split('.').pop();
        const fileName = `${chatId}_${timestamp}.${extension}`;
        const fileRef = ref(storage, `files/${fileName}`);
        
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        
        return url;
    } catch (error) {
        console.error('Error uploading file:', error);
        return null;
    }
};

export const uploadStatus = async (userId, file, type = 'image') => {
    try {
        const statusRef = ref(storage, `statuses/${userId}_${Date.now()}`);
        await uploadBytes(statusRef, file);
        const url = await getDownloadURL(statusRef);
        
        const statusesRef = collection(db, 'statuses');
        await addDoc(statusesRef, {
            userId,
            type,
            url,
            createdAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
        
        return url;
    } catch (error) {
        console.error('Error uploading status:', error);
        return null;
    }
};

export const getStatuses = async () => {
    try {
        const statusesRef = collection(db, 'statuses');
        const now = new Date();
        const q = query(
            statusesRef,
            orderBy('createdAt', 'desc'),
            limit(20)
        );
        const snapshot = await getDocs(q);
        
        const statuses = [];
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            if (data.expiresAt && data.expiresAt.toDate && data.expiresAt.toDate() > now) {
                const userProfile = await getUserProfile(data.userId);
                statuses.push({
                    id: docSnap.id,
                    ...data,
                    user: userProfile
                });
            }
        }
        return statuses;
    } catch (error) {
        console.error('Error getting statuses:', error);
        return [];
    }
};

export const setTypingStatus = async (chatId, userId, isTyping) => {
    try {
        const typingRef = doc(db, 'typing', chatId, 'status', userId);
        await setDoc(typingRef, {
            userId,
            isTyping,
            timestamp: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error('Error setting typing status:', error);
    }
};

export const subscribeToTyping = (chatId, userId, callback) => {
    try {
        const typingRef = collection(db, 'typing', chatId, 'status');
        const q = query(typingRef, where('isTyping', '==', true));
        
        return onSnapshot(q, (snapshot) => {
            const typingUsers = snapshot.docs
                .filter(d => d.id !== userId)
                .map(d => d.id);
            callback(typingUsers);
        });
    } catch (error) {
        console.error('Error subscribing to typing:', error);
        callback([]);
        return () => {};
    }
};

export const searchMessages = async (chatId, searchTerm) => {
    try {
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const snapshot = await getDocs(messagesRef);
        
        return snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(m => m.senderName.toLowerCase().includes(searchTerm.toLowerCase()));
    } catch (error) {
        console.error('Error searching messages:', error);
        return [];
    }
};
