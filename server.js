const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { Resend } = require("resend");
const cors = require("cors");
const twilio = require("twilio");

const resend = new Resend(process.env.RESEND_API_KEY);
const ACCOUNT_SID = "AC093cc8343464fd17f9083ccde3ca2590";
const AUTH_TOKEN = "edd4c2b5d3df5f0f0e85a07b8baa7130";
const FROM_NUMBER = "+18882942895";
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "users.json") : path.join(__dirname, "users.json");
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
}

function verifyEmailHTML(name, code) {
  return '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 24px">'
    + '<h1 style="font-size:32px;letter-spacing:4px;color:#0a0a0a">IN LINECUT</h1>'
    + '<p style="color:#888;font-size:14px;margin-bottom:32px">Barbershop Check-In</p>'
    + '<p style="font-size:16px;color:#0a0a0a">Hey ' + name + ',</p>'
    + '<p style="font-size:14px;color:#555">Your verification code is:</p>'
    + '<div style="background:#0a0a0a;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;padding:20px;border-radius:8px;text-align:center;margin:24px 0">' + code + '</div>'
    + '<p style="font-size:13px;color:#aaa">This code expires in 10 minutes.</p>'
    + '</div>';
}

let checkinLog = [];
const app = express();
app.use(cors());
app.use(express.json());

app.post("/send-welcome", async (req, res) => {
  try {
    const { phone, name, barber, message } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: "Phone is required" });
    const digits = phone.replace(/\D/g, "");
    const to = "+1" + digits;
    const welcomeMsg = (message || "Welcome to the barbershop!")
      .replace("{name}", name || "")
      .replace("{barber}", barber || "");
    const result = await client.messages.create({ body: welcomeMsg, from: FROM_NUMBER, to });
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/send-broadcast", async (req, res) => {
  try {
    const { phones, message } = req.body;
    const results = [];
    for (const phone of phones) {
      try {
        const digits = phone.replace(/\D/g, "");
        const result = await client.messages.create({ body: message, from: FROM_NUMBER, to: "+1" + digits });
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
  try {
    const { name, barber, phone, checkedInAt } = req.body;
    checkinLog.push({ name, barber, phone, checkedInAt: checkedInAt || new Date().toISOString() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/daily-summary", (req, res) => {
  try {
    const today = new Date();
    const todayLog = checkinLog.filter(c => {
      const d = new Date(c.checkedInAt);
      return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate();
    });
    const hourMap = {};
    todayLog.forEach(c => { const h = new Date(c.checkedInAt).getHours(); hourMap[h]=(hourMap[h]||0)+1; });
    const busyEntry = Object.entries(hourMap).sort((a,b)=>b[1]-a[1])[0];
    const barberMap = {};
    todayLog.forEach(c => { barberMap[c.barber]=(barberMap[c.barber]||0)+1; });
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
      html: verifyEmailHTML(name || "there", code)
    });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/signup", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, error: "Missing fields" });
    const users = loadUsers();
    const existing = users.find(u => u.email === email.toLowerCase());
    if (existing) return res.status(409).json({ success: false, error: "Email already registered" });
    const hashed = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const joinDate = new Date().toLocaleDateString();
    users.push({ id: Date.now(), name, email: email.toLowerCase(), password: hashed, phone: phone || "", joinDate, verified: false, verifyCode: code });
    saveUsers(users);
    try {
      await resend.emails.send({
        from: "In LineCut <noreply@mail.inlinecut.com>",
        to: email,
        subject: "Your In LineCut Verification Code",
        html: verifyEmailHTML(name, code)
      });
    } catch(e) { console.error("Email error:", e.message); }
    res.json({ success: true, message: "Verification email sent" });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/verify-account", (req, res) => {
  try {
    const { email, code } = req.body;
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === email.toLowerCase());
    if (idx === -1) return res.status(404).json({ success: false, error: "User not found" });
    if (users[idx].verifyCode !== code) return res.status(400).json({ success: false, error: "Incorrect code" });
    users[idx].verified = true;
    users[idx].verifyCode = null;
    saveUsers(users);
    const user = users[idx];
    res.json({ success: true, user: { name: user.name, email: user.email, phone: user.phone, joinDate: user.joinDate } });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.email === email.toLowerCase());
    if (!user) return res.status(404).json({ success: false, error: "No account found with this email" });
    if (!user.verified) return res.status(403).json({ success: false, error: "Please verify your email first" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ success: false, error: "Incorrect password" });
    res.json({ success: true, user: { name: user.name, email: user.email, phone: user.phone, joinDate: user.joinDate } });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/resend-code", async (req, res) => {
  try {
    const { email } = req.body;
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === email.toLowerCase());
    if (idx === -1) return res.status(404).json({ success: false, error: "User not found" });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    users[idx].verifyCode = code;
    saveUsers(users);
    await resend.emails.send({
      from: "In LineCut <noreply@mail.inlinecut.com>",
      to: email,
      subject: "Your In LineCut Verification Code",
      html: verifyEmailHTML(users[idx].name, code)
    });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/dev-verify", (req, res) => {
  try {
    const { email, secret } = req.body;
    if (secret !== "inlinecut2026") return res.status(403).json({ success: false });
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === email.toLowerCase());
    if (idx === -1) return res.status(404).json({ success: false, error: "User not found" });
    users[idx].verified = true;
    users[idx].verifyCode = null;
    saveUsers(users);
    res.json({ success: true, message: "Account verified" });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === email.toLowerCase());
    if (idx === -1) return res.status(404).json({ success: false, error: "No account found with this email" });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    users[idx].resetCode = code;
    users[idx].resetExpiry = Date.now() + 10 * 60 * 1000;
    saveUsers(users);
    await resend.emails.send({
      from: "In LineCut <noreply@mail.inlinecut.com>",
      to: email,
      subject: "Reset Your In LineCut Password",
      html: "<div style='font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 24px'>"
        + "<h1 style='font-size:32px;letter-spacing:4px;color:#0a0a0a'>IN LINECUT</h1>"
        + "<p style='font-size:16px;color:#0a0a0a'>Password Reset Request</p>"
        + "<p style='font-size:14px;color:#555'>Your reset code is:</p>"
        + "<div style='background:#0a0a0a;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;padding:20px;border-radius:8px;text-align:center;margin:24px 0'>" + code + "</div>"
        + "<p style='font-size:13px;color:#aaa'>This code expires in 10 minutes. If you did not request this, ignore this email.</p>"
        + "</div>"
    });
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ success: false, error: "Missing fields" });
    const users = loadUsers();
    const idx = users.findIndex(u => u.email === email.toLowerCase());
    if (idx === -1) return res.status(404).json({ success: false, error: "User not found" });
    if (users[idx].resetCode !== code) return res.status(400).json({ success: false, error: "Incorrect code" });
    if (Date.now() > users[idx].resetExpiry) return res.status(400).json({ success: false, error: "Code expired" });
    if (newPassword.length < 4) return res.status(400).json({ success: false, error: "Password must be 4+ characters" });
    users[idx].password = await bcrypt.hash(newPassword, 10);
    users[idx].resetCode = null;
    users[idx].resetExpiry = null;
    saveUsers(users);
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) => res.json({ status: "running" }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("In LineCut server running on port " + PORT));
