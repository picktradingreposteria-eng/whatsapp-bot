import express from "express";
import axios from "axios";
import { google } from "googleapis";
import stringSimilarity from "string-similarity";

const app = express();
app.use(express.json());

// 🧠 Memoria temporal por usuario
const userMemory = new Map(); // Guarda el contexto del usuario (último tema y sugerencias)

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

    return rows
      .filter((row) => row[0] && row[1])
      .map(([pregunta, respuesta]) => ({
        pregunta: pregunta.trim(),
        respuesta: respuesta.trim(),
      }));
  } catch (error) {
    console.error("❌ Error al leer Google Sheets:", error);
    return [];
  }
}

// ---------- FUNCIÓN DE ENVÍO A WHATSAPP ----------
async function sendMessage(to, body) {
  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body },
      },
      {
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      }
    );
    console.log("✅ Respuesta enviada:", body);
  } catch (error) {
    console.error("❌ Error al enviar mensaje:", error.response?.data || error);
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
      if (faqData.length === 0) {
        await sendMessage(from, "⚠️ No se han encontrado datos en la hoja de Google Sheets.");
        return res.sendStatus(200);
      }

      const questions = faqData.map((q) => q.pregunta.toLowerCase());
      const answers = faqData.map((q) => q.respuesta);

      // Recuperar memoria del usuario
      let memory = userMemory.get(from) || { lastTopic: null, suggestions: [] };

      // Si responde con un número (opción de sugerencias)
      if (/^\d+$/.test(text)) {
        const index = parseInt(text, 10) - 1;
        const suggestions = memory.suggestions;
        if (suggestions && suggestions[index]) {
          const reply = `✅ ${suggestions[index].respuesta}`;
          await sendMessage(from, reply);

          // Actualizar memoria con el nuevo tema
          memory.lastTopic = suggestions[index].pregunta.toLowerCase();
          memory.suggestions = [];
          userMemory.set(from, memory);
          return res.sendStatus(200);
        }
      }

      // Buscar coincidencia flexible
      const allTexts = questions.map((q) =>
        memory.lastTopic ? `${memory.lastTopic} ${q}` : q
      );

      const match = stringSimilarity.findBestMatch(text, allTexts);
      const best = match.bestMatch;

      let reply;

      if (best.rating > 0.5) {
        const index = match.bestMatchIndex;
        const bestAnswer = answers[index];
        const templates = [
          `📍 ${bestAnswer}`,
          `ℹ️ ${bestAnswer}`,
          `✅ ${bestAnswer}`,
          `🚐 ${bestAnswer}`,
        ];
        reply = templates[Math.floor(Math.random() * templates.length)];

        // Guardar nuevo tema en memoria
        memory.lastTopic = questions[index];
        memory.suggestions = [];
        userMemory.set(from, memory);
      } else {
        // Si no encuentra coincidencia clara → sugerencias relacionadas
        const sortedMatches = match.ratings
          .sort((a, b) => b.rating - a.rating)
          .slice(0, 5);

        const relatedSuggestions = sortedMatches.map(
          (m) => faqData[questions.indexOf(m.target)]
        );

        memory.suggestions = relatedSuggestions;
        userMemory.set(from, memory);

        let suggestionText =
          "🔎 No he comprendido completamente su consulta. ¿Podría elegir una de las siguientes opciones relacionadas?\n\n";
        relatedSuggestions.forEach((item, i) => {
          suggestionText += `${i + 1}. ${item.pregunta}\n`;
        });

        reply = suggestionText;
      }

      await sendMessage(from, reply);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en webhook:", error.response?.data || error);
    res.sendStatus(500);
  }
});

// ---------- INICIO DEL SERVIDOR ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en el puerto ${PORT}`));
