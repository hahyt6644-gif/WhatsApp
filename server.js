const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal'); // New import

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
        // printQRInTerminal: true,  <-- REMOVED THIS LINE (It was causing the warning)
        logger: pino({ level: 'silent' }),
        browser: ["My Bot", "Chrome", "1.0"],
        connectTimeoutMs: 60000,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Scan this QR Code to login:');
            // 1. Print to Terminal (Manual fix for the warning)
            qrcodeTerminal.generate(qr, { small: true });
            
            // 2. Send to Website (Frontend)
            const qrImage = await QRCode.toDataURL(qr);
            io.emit('qr', qrImage);
            io.emit('status', 'Scan the QR Code');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out completely. Delete "auth_info_baileys" folder and restart.');
            }
        } else if (connection === 'open') {
            console.log('✅ Connected to WhatsApp!');
            io.emit('qr', null);
            io.emit('status', 'Connected & Online');
        }
    });

    sock.ev.on('creds.update', saveCreds);

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

io.on('connection', (socket) => {
    socket.emit('status', 'Initializing...');
    if (sock?.user) {
        socket.emit('status', 'Connected');
    }
});

connectToWhatsApp();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
