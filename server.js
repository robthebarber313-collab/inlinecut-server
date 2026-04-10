const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

// ── Database setup ──
const db = new Database(path.join(__dirname, "users.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT,
    joinDate TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    verifyCode TEXT,
    resetCode TEXT,
    resetExpiry INTEGER
  )
`);
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const cors = require("cors");
const twilio = require("twilio");

const ACCOUNT_SID = "AC093cc8343464fd17f9083ccde3ca2590";
const AUTH_TOKEN = "edd4c2b5d3df5f0f0e85a07b8baa7130";
const FROM_NUMBER = "+18777804236";

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

let checkinLog = [];
const app = express();
app.use(cors());
app.use(express.json());

app.post("/send-welcome", async (req, res) => {
  try {
    const { phone, name, barber, message } = req.body;
    console.log("Received:", { phone, name, barber, message });
    
    if (!phone) return res.status(400).json({ success: false, error: "Phone is required" });
    
    const digits = phone.replace(/\D/g, "");
    const to = `+1${digits}`;
    
    const welcomeMsg = message || "Welcome to the barbershop!";
    const body = welcomeMsg
      .replace("{name}", name || "")
      .replace("{barber}", barber || "");
    
    console.log("Sending to:", to, "Message:", body);
    
    const result = await client.messages.create({ body, from: FROM_NUMBER, to });
    console.log("Sent! SID:", result.sid);
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/send-broadcast", async (req, res) => {
  try {
    const { phones, message } = req.body;
    console.log("Broadcast to", phones.length, "clients");
    const results = [];
    for (const phone of phones) {
      try {
        const digits = phone.replace(/\D/g, "");
        const result = await client.messages.create({ 
          body: message, from: FROM_NUMBER, to: `+1${digits}` 
        });
        results.push({ phone, success: true, sid: result.sid });
      } catch (err) {
        results.push({ phone, success: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/log-checkin", (req, res) => {
  try { const { name, barber, phone, checkedInAt } = req.body; checkinLog.push({ name, barber, phone, checkedInAt: checkedInAt || new Date().toISOString() }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get("/daily-summary", (req, res) => {
  try {
    const today = new Date();
    const todayLog = checkinLog.filter(c => { const d = new Date(c.checkedInAt); return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate(); });
    const hourMap = {}; todayLog.forEach(c => { const h = new Date(c.checkedInAt).getHours(); hourMap[h]=(hourMap[h]||0)+1; });
    const busyEntry = Object.entries(hourMap).sort((a,b)=>b[1]-a[1])[0];
    const barberMap = {}; todayLog.forEach(c => { barberMap[c.barber]=(barberMap[c.barber]||0)+1; });
    res.json({ date: today.toDateString(), totalServed: todayLog.length, busyHour: busyEntry ? busyEntry[0]+":00" : null, barberBreakdown: barberMap });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post("/send-verification", async (req, res) => {
  try {
    const { name, email, code } = req.body;
    if (!email || !code) return res.status(400).json({ success: false, error: "Missing fields" });
    await resend.emails.send({
      from: "In LineCut <noreply@mail.inlinecut.com>",
      to: email,
      subject: "Your In LineCut Verification Code",
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;"><h1 style="font-size:32px;letter-spacing:4px;color:#0a0a0a;">IN LINECUT</h1><p style="color:#888;font-size:14px;margin-bottom:32px;">Barbershop Check-In</p><p style="font-size:16px;color:#0a0a0a;">Hey ${name},</p><p style="font-size:14px;color:#555;">Your verification code is:</p><div style="background:#0a0a0a;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;padding:20px;border-radius:8px;text-align:center;margin:24px 0;">${code}</div><p style="font-size:13px;color:#aaa;">This code expires in 10 minutes.</p></div>`
    });
    res.json({ success: true });
  } catch(err) {
    console.error("Verification error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Signup ──
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, error: "Missing fields" });
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
    if (existing) return res.status(409).json({ success: false, error: "Email already registered" });
    const hashed = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const joinDate = new Date().toLocaleDateString();
    db.prepare("INSERT INTO users (name, email, password, phone, joinDate, verified, verifyCode) VALUES (?, ?, ?, ?, ?, 0, ?)").run(name, email.toLowerCase(), hashed, phone || "", joinDate, code);
    // Send verification email
    try {
      await resend.emails.send({
        from: "In LineCut <noreply@mail.inlinecut.com>",
        to: email,
        subject: "Your In LineCut Verification Code",
        html: \`<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;"><h1 style="font-size:32px;letter-spacing:4px;color:#0a0a0a;">IN LINECUT</h1><p style="color:#888;font-size:14px;margin-bottom:32px;">Barbershop Check-In</p><p style="font-size:16px;color:#0a0a0a;">Hey \${name},</p><p style="font-size:14px;color:#555;">Your verification code is:</p><div style="background:#0a0a0a;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;padding:20px;border-radius:8px;text-align:center;margin:24px 0;">\${code}</div><p style="font-size:13px;color:#aaa;">This code expires in 10 minutes.</p></div>\`
      });
    } catch(e) { console.error("Email error:", e.message); }
    res.json({ success: true, message: "Verification email sent" });
  } catch(err) {
    console.error("Signup error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Verify email ──
app.post("/verify-account", (req, res) => {
  try {
    const { email, code } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if (user.verifyCode !== code) return res.status(400).json({ success: false, error: "Incorrect code" });
    db.prepare("UPDATE users SET verified = 1, verifyCode = NULL WHERE email = ?").run(email.toLowerCase());
    res.json({ success: true, user: { name: user.name, email: user.email, phone: user.phone, joinDate: user.joinDate } });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Login ──
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
    if (!user) return res.status(404).json({ success: false, error: "No account found with this email" });
    if (!user.verified) return res.status(403).json({ success: false, error: "Please verify your email first" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, error: "Incorrect password" });
    res.json({ success: true, user: { name: user.name, email: user.email, phone: user.phone, joinDate: user.joinDate } });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Resend verification ──
app.post("/resend-code", async (req, res) => {
  try {
    const { email } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    db.prepare("UPDATE users SET verifyCode = ? WHERE email = ?").run(code, email.toLowerCase());
    await resend.emails.send({
      from: "In LineCut <noreply@mail.inlinecut.com>",
      to: email,
      subject: "Your In LineCut Verification Code",
      html: \`<div style="font-family:sans-serif;padding:40px 24px;"><h1>IN LINECUT</h1><p>Your new verification code:</p><div style="background:#0a0a0a;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;padding:20px;border-radius:8px;text-align:center;margin:24px 0;">\${code}</div></div>\`
    });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "running" }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`In LineCut SMS server running on port ${PORT}`));
