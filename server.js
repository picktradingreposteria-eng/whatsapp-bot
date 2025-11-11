import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// ✅ Verificación del webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 📩 Recepción de mensajes
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const text = message?.text?.body?.toLowerCase();

    if (text) {
      let reply = "👋 Hola, soy tu asistente virtual. ¿En qué puedo ayudarte?";
      if (text.includes("hola")) reply = "¡Hola! 😊 ¿Cómo estás?";
      if (text.includes("gracias")) reply = "¡De nada! 💬";
      if (text.includes("ayuda")) reply = "Puedo informarte sobre horarios, precios y más.";

      await axios.post(
        `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply },
        },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
    }
  } catch (err) {
    console.error("Error:", err.message);
  }

  res.sendStatus(200);
});

app.listen(10000, () => console.log("✅ Bot corriendo en puerto 10000"));
