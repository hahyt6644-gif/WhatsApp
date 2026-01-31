const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// Serve the Frontend files
app.use(express.static('public'));

// Variables to hold the socket connection
let sock;

// --- WHATSAPP CONNECTION LOGIC ---
async function connectToWhatsApp() {
    // 1. Use Local "Database" (Folder) for Auth
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Print QR to terminal as backup
        logger: pino({ level: 'silent' }), // Hide messy logs
        browser: ["My Local Bot", "Chrome", "1.0"], // How you appear in Linked Devices
        connectTimeoutMs: 60000,
        syncFullHistory: false, // Set to true if you want old chats (uses more RAM)
    });

    // 2. Handle Connection Events
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('QR Code received, sending to frontend...');
            // Convert QR string to Image Data URL for the frontend
            const qrImage = await QRCode.toDataURL(qr);
            io.emit('qr', qrImage);
            io.emit('status', 'Scan the QR Code');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            io.emit('status', 'Connection Lost. Reconnecting...');
            
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                io.emit('status', 'Logged out. Delete "auth_info_baileys" folder to re-scan.');
            }
        } else if (connection === 'open') {
            console.log('Connected to WhatsApp!');
            io.emit('qr', null); // Tell frontend to hide QR
            io.emit('status', 'Connected & Online');
            
            // Send a test message to log (optional)
            // loadChats(); 
        }
    });

    // 3. Save Credentials to Local File automatically
    sock.ev.on('creds.update', saveCreds);

    // 4. Handle New Messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        
        if (!msg.key.fromMe && messages[0].message) {
            // Log to console
            const sender = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "Media/Unknown";
            const pushName = msg.pushName || "Unknown User";

            console.log(`New Message from ${pushName}: ${text}`);

            // Send to Frontend UI
            io.emit('new_message', {
                remoteJid: sender,
                pushName: pushName,
                text: text
            });

            // --- AUTO REPLY EXAMPLE ---
            // if (text.toLowerCase() === 'ping') {
            //    await sock.sendMessage(sender, { text: 'Pong!' });
            // }
        }
    });
}

// --- SOCKET.IO HANDLING ---
io.on('connection', (socket) => {
    console.log('Frontend Client Connected');
    socket.emit('status', 'Initializing...');
    
    // Check if already connected, give status
    if (sock?.user) {
        socket.emit('status', 'Connected');
        socket.emit('qr', null);
    }
});

// Start the bot
connectToWhatsApp();

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
