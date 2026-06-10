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
    setDoc,
    startAfter,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import CryptoJS from 'crypto-js';

// ── Encryption ────────────────────────────────────────────────────
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

// ── Profile cache (avoids repeated Firestore reads for the same user) ──
const profileCache = new Map<string, any>();

// ── Users ─────────────────────────────────────────────────────────
export const createUserProfile = async (userId: string, username: string, email: string) => {
    try {
        const userDoc = {
            userId, username, email,
            avatar: null,
            status: 'online',
            lastSeen: serverTimestamp(),
            bio: '',
            createdAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'users', userId), userDoc, { merge: true });
        const result = { id: userId, ...userDoc };
        profileCache.set(userId, result);
        return result;
    } catch (error) {
        console.error('Error creating profile:', error);
        return null;
    }
};

export const getUserProfile = async (userId: string) => {
    if (profileCache.has(userId)) return profileCache.get(userId);
    try {
        const snap = await getDoc(doc(db, 'users', userId));
        if (snap.exists()) {
            const profile = { id: snap.id, ...snap.data() };
            profileCache.set(userId, profile);
            return profile;
        }
        // Fallback for old-style auto-ID docs
        const q = query(collection(db, 'users'), where('userId', '==', userId), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        const profileData = snapshot.docs[0].data();
        setDoc(doc(db, 'users', userId), profileData, { merge: true }).catch(() => {});
        const profile = { id: snapshot.docs[0].id, ...profileData };
        profileCache.set(userId, profile);
        return profile;
    } catch (error) {
        console.error('Error getting profile:', error);
        return null;
    }
};

export const updateUserProfile = async (userId: string, updates: any) => {
    try {
        await setDoc(doc(db, 'users', userId), { userId, lastSeen: serverTimestamp(), ...updates }, { merge: true });
        // Invalidate cache so next read gets fresh data
        profileCache.delete(userId);
    } catch (error) {
        console.error('Error updating profile:', error);
    }
};

// Real-time online users with 5-minute staleness check
export const subscribeToOnlineUsers = (currentUserId: string, callback: (users: any[]) => void) => {
    const q = query(collection(db, 'users'), where('status', '==', 'online'));
    return onSnapshot(q, (snapshot) => {
        const cutoff = Date.now() - 5 * 60 * 1000;
        const seen = new Set<string>();
        const users = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter((u: any) => {
                if (!u.userId || u.userId === currentUserId || seen.has(u.userId)) return false;
                const ls = u.lastSeen?.toDate?.()?.getTime?.() ?? 0;
                if (ls < cutoff) return false; // stale
                seen.add(u.userId);
                return true;
            });
        callback(users);
    }, (err) => {
        console.error('Online users subscription error:', err);
        callback([]);
    });
};

// ── Messages ─────────────────────────────────────────────────────
export const saveMessage = async (chatId: string, message: any, sessionKey: string) => {
    const encrypted = encryptText(message.text || '', sessionKey);
    const messageDoc: any = {
        senderId: message.senderId,
        senderName: message.senderName,
        encryptedText: encrypted.ciphertext,
        iv: encrypted.iv,
        timestamp: serverTimestamp(),
        reactions: [],
        readBy: [message.senderId],
    };
    if (message.fileUrl)  messageDoc.fileUrl  = message.fileUrl;
    if (message.fileType) messageDoc.fileType = message.fileType;
    if (message.fileName) messageDoc.fileName = message.fileName;

    await addDoc(collection(db, 'chats', chatId, 'messages'), messageDoc);

    await setDoc(doc(db, 'chats', chatId), {
        chatId,
        lastMessage: message.fileUrl ? `📎 ${message.fileName || 'Файл'}` : (message.text || '').substring(0, 60),
        lastMessageTime: serverTimestamp(),
    }, { merge: true });
};

const decodeDoc = (docSnap: any, sessionKey: string) => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        senderId:   data.senderId,
        senderName: data.senderName,
        text:       decryptText(data.encryptedText || '', data.iv || '', sessionKey),
        fileUrl:    data.fileUrl  ?? null,
        fileType:   data.fileType ?? null,
        fileName:   data.fileName ?? null,
        timestamp:  data.timestamp?.toDate() ?? null,
        reactions:  data.reactions ?? [],
        readBy:     data.readBy ?? [],
    };
};

export const subscribeToMessages = (
    chatId: string,
    sessionKey: string,
    callback: (msgs: any[]) => void,
    onMeta?: (hasMore: boolean, oldestDoc: any) => void
) => {
    if (!chatId || !sessionKey) { callback([]); return () => {}; }

    const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('timestamp', 'desc'),
        limit(50)
    );

    return onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(d => decodeDoc(d, sessionKey)).reverse();
        if (onMeta) {
            const oldest = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            onMeta(snapshot.docs.length >= 50, oldest);
        }
        callback(msgs);
    }, (err) => {
        console.error('Messages subscription error:', err);
        callback([]);
    });
};

export const loadMoreMessages = async (chatId: string, sessionKey: string, oldestDoc: any) => {
    const q = query(
        collection(db, 'chats', chatId, 'messages'),
        orderBy('timestamp', 'desc'),
        startAfter(oldestDoc),
        limit(50)
    );
    const snapshot = await getDocs(q);
    const msgs = snapshot.docs.map(d => decodeDoc(d, sessionKey)).reverse();
    const cursor = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
    return { msgs, hasMore: snapshot.docs.length >= 50, cursor };
};

export const addReaction = async (chatId: string, messageId: string, userId: string, emoji: string) => {
    try {
        const messageRef = doc(db, 'chats', chatId, 'messages', messageId);
        const messageSnap = await getDoc(messageRef);
        if (messageSnap.exists()) {
            const reactions = messageSnap.data().reactions || [];
            const existing = reactions.findIndex((r: any) => r.userId === userId && r.emoji === emoji);
            if (existing >= 0) reactions.splice(existing, 1);
            else reactions.push({ userId, emoji, timestamp: Date.now() });
            await updateDoc(messageRef, { reactions });
        }
    } catch (error) {
        console.error('Error adding reaction:', error);
    }
};

export const updateCourseProgress = async (userId: string, courseId: string, completedLessons: number[]) => {
    try {
        await updateDoc(doc(db, 'users', userId), {
            [`courseProgress.${courseId}`]: completedLessons,
            lastSeen: serverTimestamp(),
        });
        profileCache.delete(userId);
    } catch (e) {
        console.error('Error updating course progress:', e);
    }
};

// ── Chats ─────────────────────────────────────────────────────────

// ensureChatExists: creates the chat doc with participants ONLY if it doesn't exist
export const ensureChatExists = async (chatId: string, user1Id: string, user2Id: string): Promise<void> => {
    try {
        const chatRef = doc(db, 'chats', chatId);
        const existing = await getDoc(chatRef);
        if (!existing.exists()) {
            await setDoc(chatRef, {
                chatId,
                participants: [user1Id, user2Id],
                lastMessage: null,
                lastMessageTime: serverTimestamp(),
                createdAt: serverTimestamp(),
            });
        }
    } catch (error) {
        console.error('Error ensuring chat exists:', error);
    }
};

export const createChat = async (user1Id: string, user2Id: string) => {
    const chatId = [user1Id, user2Id].sort().join('_');
    await ensureChatExists(chatId, user1Id, user2Id);
    return chatId;
};

// Real-time chat list — no orderBy so no composite index required; sorted in JS
// Only shows chats that have at least one message (filters empty chats)
export const subscribeToChats = (userId: string, callback: (chats: any[]) => void) => {
    const q = query(collection(db, 'chats'), where('participants', 'array-contains', userId));
    return onSnapshot(q, async (snapshot) => {
        const chats: any[] = [];
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            // Skip chats with no messages sent yet (lastMessageTime is set on creation, so check lastMessage)
            if (!data.lastMessage) continue;
            const chatId = data.chatId || docSnap.id;
            const partnerId = data.participants?.find((p: string) => p !== userId) ?? null;
            const partner = partnerId ? await getUserProfile(partnerId) : null;
            chats.push({
                id: docSnap.id,
                chatId,
                partnerId,
                partner,
                lastMessage: data.lastMessage ?? null,
                lastMessageTime: data.lastMessageTime?.toDate() ?? null,
                unreadCount: 0,
            });
        }
        // Deduplicate by partnerId: old auto-ID docs and new canonical sorted-ID docs can coexist
        const seen = new Map<string, any>();
        for (const chat of chats) {
            if (!chat.partnerId) continue;
            const existing = seen.get(chat.partnerId);
            if (!existing || (chat.lastMessageTime?.getTime() ?? 0) > (existing.lastMessageTime?.getTime() ?? 0)) {
                seen.set(chat.partnerId, chat);
            }
        }
        const result = Array.from(seen.values());
        result.sort((a, b) => (b.lastMessageTime?.getTime() ?? 0) - (a.lastMessageTime?.getTime() ?? 0));
        callback(result);
    }, (err) => {
        console.error('Chats subscription error:', err);
        callback([]);
    });
};

// ── Session Key (ECDH-based) ──────────────────────────────────────
export const getChatSessionKey = async (chatId: string, userId: string, partnerId?: string): Promise<string> => {
    const keyName = `nss_chatkey_${chatId}`;
    // Use localStorage (not sessionStorage) so key persists across sessions
    const cached = localStorage.getItem(keyName);
    if (cached) return cached;

    let key: string;

    if (partnerId && !chatId.startsWith('city_')) {
        // Private chat: try ECDH derivation
        try {
            const snap = await getDoc(doc(db, 'users', partnerId));
            if (snap.exists() && snap.data()?.ecdhPublicKey) {
                const { deriveChatKey } = await import('./e2e');
                key = await deriveChatKey(userId, snap.data().ecdhPublicKey);
                localStorage.setItem(keyName, key);
                return key;
            }
        } catch (e) {
            console.warn('ECDH derivation failed, using legacy key:', e);
        }
    }

    if (chatId.startsWith('city_')) {
        // Group chat: deterministic key from chatId
        const { deterministicGroupKey } = await import('./e2e');
        key = await deterministicGroupKey(chatId);
        localStorage.setItem(keyName, key);
        return key;
    }

    // Legacy fallback: check Firestore for old key
    try {
        const snapshot = await getDoc(doc(db, 'chatKeys', chatId));
        if (snapshot.exists() && snapshot.data()?.sharedKey) {
            key = snapshot.data().sharedKey as string;
            localStorage.setItem(keyName, key);
            return key;
        }
    } catch (e) { /* ignore */ }

    // Generate new random key for this chat
    key = generateRandomKey();
    localStorage.setItem(keyName, key);
    try {
        await setDoc(doc(db, 'chatKeys', chatId), { sharedKey: key }, { merge: true });
    } catch (e) { /* ignore */ }
    return key;
};

function generateRandomKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Storage ───────────────────────────────────────────────────────
export const uploadAvatar = async (userId: string, file: File) => {
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

export const uploadFile = async (chatId: string, file: File, senderId: string) => {
    const ext  = file.name.split('.').pop() || 'bin';
    const path = `files/${chatId}/${senderId}_${Date.now()}.${ext}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    return { url, name: file.name, type: file.type };
};

// ── Typing ────────────────────────────────────────────────────────
export const setTypingStatus = async (chatId: string, userId: string, isTyping: boolean) => {
    try {
        await setDoc(doc(db, 'typing', chatId, 'status', userId), {
            userId, isTyping, timestamp: serverTimestamp(),
        }, { merge: true });
    } catch (error) { console.error('Error setting typing status:', error); }
};

export const subscribeToTyping = (chatId: string, userId: string, callback: (users: string[]) => void) => {
    try {
        return onSnapshot(
            query(collection(db, 'typing', chatId, 'status'), where('isTyping', '==', true)),
            (snapshot) => callback(snapshot.docs.filter(d => d.id !== userId).map(d => d.id)),
        );
    } catch { callback([]); return () => {}; }
};
