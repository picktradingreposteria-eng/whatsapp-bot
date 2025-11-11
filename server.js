import express from "express";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(express.json());

// ---------- FUNCIÓN PARA LEER GOOGLE SHEETS ----------
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
    return rows.map(([pregunta, respuesta]) => ({
      pregunta,
      respuesta,
    }));
  } catch (error) {
    console.error("❌ Error al leer Google Sheets:", error);
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
    console.log("✅ Webhook verificado correctamente");
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

      // ---------- APRENDIZAJE AUTOMÁTICO ----------
      const dictionary = {};
      for (const { pregunta, respuesta } of faqData) {
        const words = pregunta
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") // elimina acentos
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .map((w) => (w.endsWith("s") ? w.slice(0, -1) : w)) // quita plurales simples
          .filter((w) => w.length > 3);

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
        .split(/\s+/)
        .map((w) => (w.endsWith("s") ? w.slice(0, -1) : w));

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

      // ---------- SELECCIÓN DE RESPUESTA ----------
      let bestResponse = null;
      let bestScore = 0;
      for (const [resp, score] of Object.entries(scoreMap)) {
        if (score > bestScore) {
          bestScore = score;
          bestResponse = resp;
        }
      }

      // ---------- RESPUESTA NATURAL ----------
      let reply;
      if (bestScore > 0) {
        const humanTemplates = [
          `Claro 😊 ${bestResponse}`,
          `Por supuesto 👍 ${bestResponse}`,
          `Sin problema 😄 ${bestResponse}`,
          `${bestResponse} 😉`,
        ];
        reply =
          humanTemplates[Math.floor(Math.random() * humanTemplates.length)];
      } else {
        reply =
          "Perdona 😅, no estoy seguro de haber entendido. ¿Podrías decirlo de otra forma?";
      }

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
  console.log(`🚀 Servidor activo en el puerto ${PORT}`);
});
