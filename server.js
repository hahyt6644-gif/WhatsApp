const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Serve frontend
app.use(express.static('public'));

// --- CONFIGURATION ---
const usePairingCode = true; // <--- WE ENABLED THIS
const myPhoneNumber = "919876543210"; // <--- REPLACE WITH YOUR PHONE NUMBER (Country Code + Number, no + sign)

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: !usePairingCode, // Do not print QR if using pairing code
        logger: pino({ level: 'silent' }),
        browser: ["RenderBot", "Chrome", "20.0"], // Linux browser signature for stability
        connectTimeoutMs: 60000,
        syncFullHistory: false, 
    });

    // --- PAIRING CODE LOGIC ---
    if (usePairingCode && !sock.authState.creds.registered) {
        // Wait a moment for connection
        setTimeout(async () => {
            try {
                // Request code
                const code = await sock.requestPairingCode(myPhoneNumber);
                console.log("\n========================================");
                console.log("   YOUR PAIRING CODE IS:  " + code);
                console.log("========================================\n");
                
                // Send to Frontend as well
                io.emit('status', `Pairing Code: ${code}`);
            } catch (err) {
                console.log("Error requesting pairing code:", err);
            }
        }, 6000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out. Please redeploy to reset.');
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

// Socket IO
io.on('connection', (socket) => {
    socket.emit('status', 'Initializing...');
});

// Start
connectToWhatsApp();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
