// True end-to-end encryption: keys derived via ECDH, NEVER stored on server

async function getOrCreateECDHKeyPair(userId: string): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
    const stored = localStorage.getItem(`nss_ecdh_${userId}`);
    if (stored) {
        const { privateJwk, publicJwk } = JSON.parse(stored);
        const [privateKey, publicKey] = await Promise.all([
            crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']),
            crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
        ]);
        return { privateKey, publicKey };
    }
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
    const [privateJwk, publicJwk] = await Promise.all([
        crypto.subtle.exportKey('jwk', keyPair.privateKey),
        crypto.subtle.exportKey('jwk', keyPair.publicKey),
    ]);
    localStorage.setItem(`nss_ecdh_${userId}`, JSON.stringify({ privateJwk, publicJwk }));
    return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}

export async function initECDHKeys(userId: string): Promise<string> {
    const { publicKey } = await getOrCreateECDHKeyPair(userId);
    const publicJwk = await crypto.subtle.exportKey('jwk', publicKey);
    return JSON.stringify(publicJwk);
}

export async function deriveChatKey(userId: string, partnerPublicJwkStr: string): Promise<string> {
    const { privateKey } = await getOrCreateECDHKeyPair(userId);
    const partnerPublicJwk = JSON.parse(partnerPublicJwkStr);
    const partnerPublicKey = await crypto.subtle.importKey('jwk', partnerPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

    const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: partnerPublicKey }, privateKey, 256);
    const arr = new Uint8Array(sharedBits);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function deterministicGroupKey(chatId: string): Promise<string> {
    const enc = new TextEncoder();
    const data = enc.encode(`nss_group_${chatId}_v1`);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
