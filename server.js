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

      // ---------- ENTRENAMIENTO AUTOMÁTICO ----------
      // Genera un "diccionario" de palabras clave a respuestas
      const dictionary = {};
      for (const { pregunta, respuesta } of faqData) {
        const words = pregunta
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 3); // quita palabras como "de", "la", etc.

        words.forEach((w) => {
          if (!dictionary[w]) dictionary[w] = [];
          if (!dictionary[w].includes(respuesta)) dictionary[w].push(respuesta);
        });
      }

      // ---------- ANÁLISIS DEL MENSAJE ----------
      const inputWords = text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, "")
        .split(/\s+/);

      // Cuenta coincidencias entre las palabras del mensaje y las del diccionario
      const scoreMap = {};
      inputWords.forEach((word) => {
        for (const key in dictionary) {
          if (key.includes(word) || word.includes(key)) {
            dictionary[key].forEach((resp) => {
              scoreMap[resp] = (scoreMap[resp] || 0) + 1;
            });
          }
        }
      });

      // ---------- ELEGIR MEJOR RESPUESTA ----------
      let bestResponse = null;
      let bestScore = 0;
      for (const [resp, score] of Object.entries(scoreMap)) {
        if (score > bestScore) {
          bestScore = score;
          bestResponse = resp;
        }
      }

      // ---------- RESPUESTA FINAL ----------
      const reply =
        bestScore > 0
          ? bestResponse
          : "Perdona, no te he entendido muy bien. ¿Podrías repetirlo o ser un poco más específico?";

      // ---------- ENVÍO A WHATSAPP ----------
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

