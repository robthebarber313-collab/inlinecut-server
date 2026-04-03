const express = require("express");
const cors = require("cors");
const twilio = require("twilio");

const ACCOUNT_SID = "AC093cc8343464fd17f9083ccde3ca2590";
const AUTH_TOKEN = "edd4c2b5d3df5f0f0e85a07b8baa7130";
const FROM_NUMBER = "+18777804236";

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const app = express();
app.use(cors());
app.use(express.json());

app.post("/send-welcome", async (req, res) => {
  const { phone, name, barber, message } = req.body;
  try {
    const digits = phone.replace(/\D/g, "");
    const to = `+1${digits}`;
    const body = message
      .replace("{name}", name)
      .replace("{barber}", barber);
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

const PORT = 3001;
app.listen(PORT, () => console.log(`In LineCut SMS server running on port ${PORT}`));
