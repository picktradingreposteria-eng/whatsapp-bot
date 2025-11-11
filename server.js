// ---------- IMPORTACIONES ----------
import express from "express";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(express.json());

// ---------- CONFIGURACIÓN GOOGLE SHEETS ----------
async function getSheetData() {
  try {
    const credentials = JSON.parse(
      Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, "base64").toString("utf8")
    );

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: process.env.SHEET_RANGE,
    });

    const rows = response.data.values || [];
    const faqData = rows.map(([pregunta, respuesta]) => ({
      pregunta,
      respuesta,
    }));

    return faqData;
  } catch (error) {
    console.error("❌ Error al obtener datos de Google Sheets:", error);
    return [];
  }
}

// ---------- WEBHOOK DE VERIFICACIÓN ----------
app.get("/webhook", (req, res) => {
  const verifyToken = process.env.VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === verifyToken) {
    console.log("✅ Webhook verificado correctamente.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ---------- WEBHOOK DE MENSAJES ----------
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (messages && messages.length > 0) {
      const message = messages[0];
      const from = message.from;
      const text = (message.text?.body || "").toLowerCase().trim();

      console.log("📩 Mensaje recibido:", text);

      const faqData = await getSheetData();

      // ---------- FUNCIÓN DE SIMILITUD ----------
      function similarity(a, b) {
        const wordsA = a.split(/\s+/);
        const wordsB = b.split(/\s+/);
        const matches = wordsA.filter((w) => wordsB.includes(w));
        return matches.length / Math.max(wordsA.length, wordsB.length);
      }

      let bestMatch = null;
      let bestScore = 0;

      for (const row of faqData) {
        const question = (row.pregunta || "").toLowerCase().trim();
        const score = similarity(text, question);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = row;
        }
      }

      let reply;
      if (bestScore > 0.2) {
        reply = bestMatch.respuesta;
      } else {
        reply =
          "Perdona, no te he entendido muy bien. ¿Podrías repetirlo o ser un poco más específico?";
      }

      // ---------- RESPUESTA A WHATSAPP ----------
      await axios.post(
        `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: reply },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          },
        }
      );

      console.log("✅ Respuesta enviada:", reply);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en webhook:", error.response?.data || error);
    res.sendStatus(500);
  }
});

// ---------- INICIO DEL SERVIDOR ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en marcha en el puerto ${PORT}`);
});
