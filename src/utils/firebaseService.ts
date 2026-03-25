import { 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    onSnapshot,
    doc,
    updateDoc,
    deleteDoc,
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

const chatKeys = new Map();

const getOrCreateChatKey = async (chatId, userId) => {
    const keyName = `chat_key_${chatId}_${userId}`;
    
    let keyData = sessionStorage.getItem(keyName);
    if (keyData) {
        return JSON.parse(keyData);
    }
    
    const { encryptMessage, decryptMessage, generateSessionKey, importKey, exportKey } = await import('./crypto');
    
    const newKey = generateSessionKey();
    const exported = newKey;
    
    keyData = { key: exported, createdAt: Date.now() };
    sessionStorage.setItem(keyName, JSON.stringify(keyData));
    
    const chatKeyRef = doc(db, 'chatKeys', chatId);
    const existing = await getDoc(chatKeyRef);
    
    if (!existing.exists()) {
        await setDoc(chatKeyRef, {
            chatId,
            participants: {}
        });
    }
    
    return keyData;
};

const getChatKey = async (chatId, userId) => {
    const keyName = `chat_key_${chatId}_${userId}`;
    const keyData = sessionStorage.getItem(keyName);
    if (keyData) {
        return JSON.parse(keyData).key;
    }
    return null;
};

const saveChatKeyToFirestore = async (chatId, userId, publicKey) => {
    const chatKeyRef = doc(db, 'chatKeys', chatId);
    await setDoc(chatKeyRef, {
        participants: {
            [userId]: {
                publicKey,
                joinedAt: Date.now()
            }
        }
    }, { merge: true });
};

export const getParticipantPublicKeys = async (chatId) => {
    try {
        const chatKeyRef = doc(db, 'chatKeys', chatId);
        const snapshot = await getDoc(chatKeyRef);
        if (snapshot.exists()) {
            return snapshot.data().participants || {};
        }
        return {};
    } catch (error) {
        console.error('Error getting participant keys:', error);
        return {};
    }
};

export const createUserProfile = async (userId, username, email) => {
    try {
        const usersRef = collection(db, 'users');
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
        await addDoc(usersRef, userDoc);
        return userDoc;
    } catch (error) {
        console.error('Error creating profile:', error);
        return null;
    }
};

export const getUserProfile = async (userId) => {
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('userId', '==', userId), limit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    } catch (error) {
        console.error('Error getting profile:', error);
        return null;
    }
};

export const updateUserProfile = async (userId, updates) => {
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('userId', '==', userId), limit(1));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            await updateDoc(doc(db, 'users', snapshot.docs[0].id), updates);
        }
    } catch (error) {
        console.error('Error updating profile:', error);
    }
};

export const getOnlineUsers = async () => {
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('status', '==', 'online'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error getting online users:', error);
        return [];
    }
};

let cryptoModule: any = null;

const loadCrypto = async () => {
    if (!cryptoModule) {
        cryptoModule = await import('./crypto');
    }
    return cryptoModule;
};

export const saveMessage = async (chatId, message, sessionKey) => {
    try {
        const crypto = await loadCrypto();
        const key = await crypto.importKey(sessionKey);
        
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const encrypted = await crypto.encryptMessage(message.text, key);
        
        const messageDoc = {
            senderId: message.senderId,
            senderName: message.senderName,
            encryptedText: encrypted.ciphertext,
            iv: encrypted.iv,
            timestamp: serverTimestamp(),
            reactions: [],
            readBy: [message.senderId]
        };
        
        await addDoc(messagesRef, messageDoc);
        
        const chatRef = doc(db, 'chats', chatId);
        await updateDoc(chatRef, {
            lastMessage: message.text.substring(0, 50),
            lastMessageTime: serverTimestamp()
        });
    } catch (error) {
        console.error('Error saving message:', error);
    }
};

export const subscribeToMessages = (chatId, sessionKey, callback) => {
    if (!chatId) {
        callback([]);
        return () => {};
    }
    
    let key = null;
    let decrypt: any = null;
    
    (async () => {
        try {
            const crypto = await loadCrypto();
            key = await crypto.importKey(sessionKey);
            decrypt = crypto.decryptMessage;
        } catch (e) {
            console.error('Key import error:', e);
        }
    })();
    
    try {
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));
        
        return onSnapshot(q, async (snapshot) => {
            if (!key || !decrypt) {
                try {
                    const crypto = await loadCrypto();
                    key = await crypto.importKey(sessionKey);
                    decrypt = crypto.decryptMessage;
                } catch (e) {
                    console.error('Key import error:', e);
                    callback([]);
                    return;
                }
            }
            
            const messages = [];
            for (const docSnap of snapshot.docs) {
                const data = docSnap.data();
                let text = '[Encrypted]';
                try {
                    text = await decrypt({ ciphertext: data.encryptedText, iv: data.iv }, key);
                } catch (e) {
                    console.error('Decrypt error:', e);
                }
                
                messages.push({
                    id: docSnap.id,
                    senderId: data.senderId,
                    senderName: data.senderName,
                    text,
                    timestamp: data.timestamp?.toDate(),
                    reactions: data.reactions || [],
                    readBy: data.readBy || []
                });
            }
            callback(messages);
        }, (error) => {
            console.error('Subscribe error:', error);
            callback([]);
        });
    } catch (error) {
        console.error('Firebase error:', error);
        callback([]);
        return () => {};
    }
};

export const addReaction = async (chatId, messageId, userId, emoji) => {
    try {
        const messagesRef = collection(db, 'chats', chatId, 'messages');
        const q = query(messagesRef);
        const snapshot = await getDocs(q);
        const messageDoc = snapshot.docs.find(d => d.id === messageId);
        
        if (messageDoc) {
            const reactions = messageDoc.data().reactions || [];
            const existingIndex = reactions.findIndex(r => r.userId === userId && r.emoji === emoji);
            
            if (existingIndex >= 0) {
                reactions.splice(existingIndex, 1);
            } else {
                reactions.push({ userId, emoji, timestamp: Date.now() });
            }
            
            await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), { reactions });
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
        
        const userProfile = await getUserProfile(userId);
        const usersRef = collection(db, 'users');
        
        const chats = [];
        for (const docSnap of snapshot.docs) {
            const chatData = docSnap.data();
            const partnerId = chatData.participants.find(p => p !== userId);
            
            let partnerProfile = null;
            if (partnerId) {
                const partnerQ = query(usersRef, where('userId', '==', partnerId), limit(1));
                const partnerSnap = await getDocs(partnerQ);
                if (!partnerSnap.empty) {
                    partnerProfile = { id: partnerSnap.docs[0].id, ...partnerSnap.docs[0].data() };
                }
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
    const keyData = sessionStorage.getItem(`chat_key_${chatId}`);
    if (keyData) {
        const parsed = JSON.parse(keyData);
        return parsed.key;
    }
    
    const newKey = generateRandomKey();
    const storedData = { key: newKey, createdAt: Date.now() };
    sessionStorage.setItem(`chat_key_${chatId}`, JSON.stringify(storedData));
    
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
