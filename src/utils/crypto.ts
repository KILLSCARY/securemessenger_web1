import CryptoJS from 'crypto-js';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

let cryptoKeys = new Map();

const useWebCrypto = typeof crypto !== 'undefined' && crypto.subtle ? true : false;

export const generateAESKey = async () => {
    if (useWebCrypto) {
        const key = await crypto.subtle.generateKey(
            { name: ALGORITHM, length: KEY_LENGTH },
            true,
            ['encrypt', 'decrypt']
        );
        return key;
    }
    return CryptoJS.lib.WordArray.random(KEY_LENGTH / 8).toString(CryptoJS.enc.Hex);
};

export const exportKey = async (key) => {
    if (!useWebCrypto || key instanceof CryptoJS.lib.WordArray) {
        return key.toString ? key.toString(CryptoJS.enc.Hex) : key;
    }
    const exported = await crypto.subtle.exportKey('raw', key);
    return arrayBufferToHex(exported);
};

export const importKey = async (hexKey) => {
    if (!useWebCrypto) {
        return CryptoJS.enc.Hex.parse(hexKey);
    }
    const keyData = hexToArrayBuffer(hexKey);
    return await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
};

export const encryptMessage = async (message, key) => {
    if (!useWebCrypto || key instanceof CryptoJS.lib.WordArray) {
        const keyWordArray = key instanceof CryptoJS.lib.WordArray ? key : CryptoJS.enc.Hex.parse(key);
        const iv = CryptoJS.lib.WordArray.random(16);
        const encrypted = CryptoJS.AES.encrypt(message, keyWordArray, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        return {
            ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
            iv: iv.toString(CryptoJS.enc.Hex)
        };
    }
    
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    const encrypted = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv, tagLength: 128 },
        key,
        data
    );

    return {
        ciphertext: arrayBufferToBase64(encrypted),
        iv: arrayBufferToHex(iv)
    };
};

export const decryptMessage = async (encryptedData, key) => {
    if (!useWebCrypto || key instanceof CryptoJS.lib.WordArray) {
        try {
            const keyWordArray = key instanceof CryptoJS.lib.WordArray ? key : CryptoJS.enc.Hex.parse(key);
            const iv = CryptoJS.enc.Hex.parse(encryptedData.iv);
            const ciphertext = CryptoJS.enc.Base64.parse(encryptedData.ciphertext);
            
            const decrypted = CryptoJS.AES.decrypt(
                ciphertext,
                keyWordArray,
                {
                    iv: iv,
                    mode: CryptoJS.mode.CBC,
                    padding: CryptoJS.pad.Pkcs7
                }
            );
            return decrypted.toString(CryptoJS.enc.Utf8);
        } catch (e) {
            console.error('CryptoJS decrypt error:', e);
            return null;
        }
    }
    
    try {
        const iv = hexToArrayBuffer(encryptedData.iv);
        const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);

        const decrypted = await crypto.subtle.decrypt(
            { name: ALGORITHM, iv: new Uint8Array(iv), tagLength: 128 },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
};

export const generateECDHKeyPair = async () => {
    if (!useWebCrypto) {
        return null;
    }
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey']
    );
    return keyPair;
};

export const exportECPublicKey = async (publicKey) => {
    if (!useWebCrypto) {
        return '';
    }
    const exported = await crypto.subtle.exportKey('spki', publicKey);
    return arrayBufferToBase64(exported);
};

export const importECPublicKey = async (base64Key) => {
    if (!useWebCrypto) {
        return null;
    }
    const keyData = base64ToArrayBuffer(base64Key);
    return await crypto.subtle.importKey(
        'spki',
        keyData,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
};

export const deriveSharedSecret = async (privateKey, publicKey) => {
    if (!useWebCrypto) {
        return null;
    }
    const sharedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: publicKey },
        privateKey,
        { name: ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
    return sharedKey;
};

export const generateKeyPair = async () => {
    if (useWebCrypto) {
        const ecdh = await generateECDHKeyPair();
        const aes = await generateAESKey();
        const publicKeyBase64 = await exportECPublicKey(ecdh.publicKey);
        const aesKeyHex = await exportKey(aes);
        return { publicKey: publicKeyBase64, privateKey: aesKeyHex, keyId: generateKeyId() };
    }
    const aesKey = await generateAESKey();
    return { publicKey: '', privateKey: aesKey, keyId: generateKeyId() };
};

export const encryptForRecipient = async (message, recipientPublicKey, senderPrivateKey) => {
    if (!useWebCrypto) {
        return encryptMessage(message, senderPrivateKey);
    }
    const senderAES = await importKey(senderPrivateKey);
    const recipientEC = await importECPublicKey(recipientPublicKey);
    const sharedKey = await deriveSharedSecret(senderAES, recipientEC);
    return encryptMessage(message, sharedKey);
};

export const decryptFromSender = async (encryptedData, senderPublicKey, recipientPrivateKey) => {
    if (!useWebCrypto) {
        return decryptMessage(encryptedData, recipientPrivateKey);
    }
    const recipientAES = await importKey(recipientPrivateKey);
    const senderEC = await importECPublicKey(senderPublicKey);
    const sharedKey = await deriveSharedSecret(recipientAES, senderEC);
    return decryptMessage(encryptedData, sharedKey);
};

export const storeKey = (keyId, key) => {
    cryptoKeys.set(keyId, key);
};

export const getKey = (keyId) => {
    return cryptoKeys.get(keyId);
};

export const clearKeys = () => {
    cryptoKeys.clear();
};

export const hashKey = (key) => {
    return key?.substring ? key.substring(0, 8) : '';
};

export const generateMessageId = () => {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const generateKeyId = () => {
    if (useWebCrypto) {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return arrayBufferToHex(array.buffer);
    }
    return Math.random().toString(36).substring(2, 18);
};

function arrayBufferToHex(buffer) {
    const array = new Uint8Array(buffer);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToArrayBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
    const array = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < array.byteLength; i++) {
        binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export const generateSessionKey = () => {
    if (useWebCrypto) {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return arrayBufferToHex(array.buffer);
    }
    return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
};

export const encryptWithPassword = async (message, password) => {
    if (!useWebCrypto) {
        const key = CryptoJS.PBKDF2(password, CryptoJS.lib.WordArray.random(16), { keySize: 256/32 });
        const iv = CryptoJS.lib.WordArray.random(16);
        const encrypted = CryptoJS.AES.encrypt(message, key, { iv, padding: CryptoJS.pad.Pkcs7 });
        return {
            ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
            iv: iv.toString(CryptoJS.enc.Hex),
            salt: ''
        };
    }
    
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordData,
        'PBKDF2',
        false,
        ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const data = encoder.encode(message);
    const encrypted = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv, tagLength: 128 },
        key,
        data
    );
    return {
        ciphertext: arrayBufferToBase64(encrypted),
        iv: arrayBufferToHex(iv),
        salt: arrayBufferToHex(salt)
    };
};

export const decryptWithPassword = async (encryptedData, password, saltHex) => {
    if (!useWebCrypto) {
        const key = CryptoJS.PBKDF2(password, CryptoJS.lib.WordArray.random(16), { keySize: 256/32 });
        const iv = CryptoJS.enc.Hex.parse(encryptedData.iv);
        const ciphertext = CryptoJS.enc.Base64.parse(encryptedData.ciphertext);
        const decrypted = CryptoJS.AES.decrypt(ciphertext, key, { iv, padding: CryptoJS.pad.Pkcs7 });
        return decrypted.toString(CryptoJS.enc.Utf8);
    }
    
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    const salt = hexToArrayBuffer(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordData,
        'PBKDF2',
        false,
        ['deriveKey']
    );
    const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: ALGORITHM, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt']
    );
    const iv = hexToArrayBuffer(encryptedData.iv);
    const ciphertext = base64ToArrayBuffer(encryptedData.ciphertext);
    const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv: new Uint8Array(iv), tagLength: 128 },
        key,
        ciphertext
    );
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
};
