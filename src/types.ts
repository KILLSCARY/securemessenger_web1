export interface User {
    id?: string;
    userId: string;
    username: string;
    email: string;
    avatar: string | null;
    status: string;
    lastSeen?: Date;
    bio?: string;
    publicKey?: string | null;
    createdAt?: Date;
}

export interface Message {
    id: string;
    senderId: string;
    senderName: string;
    text: string;
    timestamp?: Date;
    reactions: Reaction[];
    readBy: string[];
    fileUrl?: string;
    fileType?: string;
}

export interface Reaction {
    userId: string;
    emoji: string;
    timestamp: number;
}

export interface Chat {
    id?: string;
    chatId: string;
    participants: string[];
    partnerId?: string;
    partner?: User;
    lastMessage: string | null;
    lastMessageTime?: Date;
    unreadCount: number;
    createdAt?: Date;
}

export interface ChatKey {
    key: string;
    createdAt: number;
}

export interface TypingStatus {
    userId: string;
    isTyping: boolean;
    timestamp: Date;
}

export interface Status {
    id: string;
    userId: string;
    type: 'image' | 'video';
    url: string;
    createdAt: Date;
    expiresAt: Date;
    user?: User;
}

export interface EncryptedData {
    ciphertext: string;
    iv: string;
    salt?: string;
}
