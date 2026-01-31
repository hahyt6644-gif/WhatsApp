const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We handle this manually below
        logger: pino({ level: 'silent' }),
        browser: ["Render Bot", "Chrome", "120.0"], // Updated browser signature
        
        // STABILITY SETTINGS (Prevents "Connection Closed" loop)
        connectTimeoutMs: 60000, // Wait 60s for connection
        defaultQueryTimeoutMs: 0, // No timeout for queries
        keepAliveIntervalMs: 10000, // Ping server every 10s
        retryRequestDelayMs: 5000, // Wait 5s before retrying
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- NEW QR GENERATED ---');
            
            // 1. Show in Terminal (Backup)
            qrcodeTerminal.generate(qr, { small: true });

            // 2. Send to Website (Primary Way)
            // We use a small delay to ensure the frontend is ready
            const qrImage = await QRCode.toDataURL(qr);
            io.emit('qr', qrImage);
            io.emit('status', 'Scan QR Code now!');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                // Wait 2 seconds before retrying to stop the "Instant Loop"
                await delay(2000);
                connectToWhatsApp();
            } else {
                console.log('Logged out. Delete "auth_info_baileys" to reset.');
                io.emit('status', 'Logged Out.');
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');
            io.emit('qr', null); // Hide QR on website
            io.emit('status', 'Connected & Online');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Message Listener
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && messages[0].message) {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "Media";
            console.log(`New Message: ${text}`);
            io.emit('new_message', {
                pushName: msg.pushName,
                text: text
            });
        }
    });
}

// Socket Handling
io.on('connection', (socket) => {
    socket.emit('status', 'Waiting for QR...');
    if (sock?.user) {
        socket.emit('status', 'Connected');
    }
});

// Start
connectToWhatsApp();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
