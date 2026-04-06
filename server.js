const express = require("express");
const cors = require("cors");
const twilio = require("twilio");
const { Resend } = require("resend");

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const resend = new Resend(RESEND_API_KEY);
const app = express();
app.use(cors());
app.use(express.json());

app.post("/send-welcome", async (req, res) => {
  const { phone, name, barber, message } = req.body;
  try {
    const digits = phone.replace(/\D/g, "");
    const to = `+1${digits}`;
    const body = message.replace("{name}", name).replace("{barber}", barber);
    await client.messages.create({ body, from: FROM_NUMBER, to });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/send-broadcast", async (req, res) => {
  const { phones, message } = req.body;
  const results = [];
  for (const phone of phones) {
    try {
      const digits = phone.replace(/\D/g, "");
      await client.messages.create({ body: message, from: FROM_NUMBER, to: `+1${digits}` });
      results.push({ phone, success: true });
    } catch (err) {
      results.push({ phone, success: false, error: err.message });
    }
  }
  res.json({ results });
});

app.post("/send-verification", async (req, res) => {
  const { email, name, code } = req.body;
  try {
    await resend.emails.send({
      from: "In LineCut <onboarding@resend.dev>",
      to: email,
      subject: "Your In LineCut Verification Code",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px;">
          <h1 style="font-size: 32px; letter-spacing: 4px; color: #0a0a0a; margin-bottom: 8px;">IN LINECUT</h1>
          <p style="color: #666; margin-bottom: 32px;">Barbershop Check-In</p>
          <h2 style="font-size: 18px; color: #0a0a0a;">Welcome, ${name}!</h2>
          <p style="color: #555; line-height: 1.6;">Your verification code is:</p>
          <div style="background: #0a0a0a; color: #fff; font-size: 36px; font-weight: 800; letter-spacing: 12px; text-align: center; padding: 24px; border-radius: 8px; margin: 24px 0;">${code}</div>
          <p style="color: #999; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 32px 0;" />
          <p style="color: #ccc; font-size: 12px;">— In LineCut Team</p>
        </div>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`In LineCut SMS server running on port ${PORT}`));

app.post("/send-reset", async (req, res) => {
  const { email, code } = req.body;
  try {
    await resend.emails.send({
      from: "In LineCut <onboarding@resend.dev>",
      to: email,
      subject: "Reset Your In LineCut Password",
      html: "<div style='font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 24px'><h1 style='font-size:32px;letter-spacing:4px;color:#0a0a0a'>IN LINECUT</h1><h2>Password Reset Code</h2><p>Your reset code is:</p><div style='background:#0a0a0a;color:#fff;font-size:36px;font-weight:800;letter-spacing:12px;text-align:center;padding:24px;border-radius:8px;margin:24px 0'>" + code + "</div><p style='color:#999;font-size:13px'>Enter this code in the app. Expires in 10 minutes.</p></div>"
    });
    res.json({ success: true });
  } catch(err) { res.status(500).json({ success: false }); }
});
