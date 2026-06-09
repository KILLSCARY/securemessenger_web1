import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = 3001;
const server = createServer();
const wss = new WebSocketServer({ server });

const clients = new Map();
let pendingConnections = [];

wss.on('connection', (ws) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    clients.set(clientId, { 
        ws, 
        publicKey: null,
        username: null,
        connectedTo: null
    });
    
    console.log(`[+] New client connected: ${clientId}`);
    broadcastOnlineUsers();

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(clientId, message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        const client = clients.get(clientId);
        if (client?.connectedTo) {
            const partner = clients.get(client.connectedTo);
            if (partner) {
                partner.connectedTo = null;
                partner.ws.send(JSON.stringify({ 
                    type: 'partner_disconnected' 
                }));
            }
        }
        clients.delete(clientId);
        console.log(`[-] Client disconnected: ${clientId}`);
        broadcastOnlineUsers();
    });

    ws.on('error', (error) => {
        console.error(`Error for ${clientId}:`, error);
    });
});

function handleMessage(senderId, message) {
    const sender = clients.get(senderId);
    if (!sender) return;

    switch (message.type) {
        case 'register':
            sender.username = message.username;
            sender.publicKey = message.publicKey;
            console.log(`[*] User registered: ${sender.username} (${senderId})`);
            broadcastOnlineUsers();
            break;

        case 'request_connection':
            const target = Array.from(clients.entries()).find(
                ([id, c]) => c.username === message.targetUsername && id !== senderId
            );
            
            if (target) {
                const [targetId, targetClient] = target;
                targetClient.ws.send(JSON.stringify({
                    type: 'connection_request',
                    from: sender.username,
                    fromId: senderId,
                    publicKey: sender.publicKey
                }));
                console.log(`[*] Connection request from ${sender.username} to ${targetClient.username}`);
            } else {
                sender.ws.send(JSON.stringify({
                    type: 'error',
                    message: 'User not found'
                }));
            }
            break;

        case 'accept_connection':
            const requester = clients.get(message.fromId);
            if (requester) {
                sender.connectedTo = message.fromId;
                requester.connectedTo = senderId;
                
                sender.ws.send(JSON.stringify({
                    type: 'connection_accepted',
                    partner: requester.username,
                    partnerId: requester.publicKey,
                    sessionKey: message.sessionKey
                }));
                
                requester.ws.send(JSON.stringify({
                    type: 'connection_accepted',
                    partner: sender.username,
                    partnerId: sender.publicKey,
                    sessionKey: message.sessionKey
                }));
                
                console.log(`[*] Users connected: ${sender.username} <-> ${requester.username}`);
            }
            break;

        case 'reject_connection':
            const rejecter = clients.get(message.toId);
            if (rejecter) {
                rejecter.ws.send(JSON.stringify({
                    type: 'connection_rejected',
                    from: sender.username
                }));
            }
            break;

        case 'encrypted_message':
            if (sender.connectedTo) {
                const partner = clients.get(sender.connectedTo);
                if (partner) {
                    partner.ws.send(JSON.stringify({
                        type: 'encrypted_message',
                        from: sender.username,
                        encrypted: message.encrypted,
                        iv: message.iv,
                        timestamp: Date.now()
                    }));
                }
            }
            break;

        case 'typing':
            if (sender.connectedTo) {
                const partner = clients.get(sender.connectedTo);
                if (partner) {
                    partner.ws.send(JSON.stringify({
                        type: 'typing',
                        from: sender.username
                    }));
                }
            }
            break;

        case 'end_connection':
            if (sender.connectedTo) {
                const partner = clients.get(sender.connectedTo);
                if (partner) {
                    partner.connectedTo = null;
                    partner.ws.send(JSON.stringify({
                        type: 'connection_ended',
                        by: sender.username
                    }));
                }
                sender.connectedTo = null;
            }
            broadcastOnlineUsers();
            break;

        case 'disconnect':
            sender.ws.close();
            break;
    }
}

function broadcastOnlineUsers() {
    const users = Array.from(clients.entries())
        .filter(([id, client]) => client.connectedTo === null)
        .map(([id, client]) => ({
            id,
            username: client.username,
            publicKey: client.publicKey
        }));

    clients.forEach((client) => {
        if (client.ws.readyState === 1) {
            client.ws.send(JSON.stringify({
                type: 'online_users',
                users
            }));
        }
    });
}

function broadcastMessage(message) {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify(message));
        }
    });
}

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║     Secure Messenger Server v1.0          ║
║     WebSocket Port: ${PORT}                       ║
║     Status: RUNNING                        ║
╚═══════════════════════════════════════════╝
    `);
});
