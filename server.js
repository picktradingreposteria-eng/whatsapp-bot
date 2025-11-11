import express from "express";
import axios from "axios";
import { google } from "googleapis";
import stringSimilarity from "string-similarity";

const app = express();
app.use(express.json());

// 🧠 Memoria temporal de sugerencias por usuario
const userSuggestions = new Map();

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

      // 🔹 Si el usuario responde con un número (seleccionando una sugerencia)
      if (/^\d+$/.test(text)) {
        const index = parseInt(text, 10) - 1;
        const suggestions = userSuggestions.get(from);
        if (suggestions && suggestions[index]) {
          const reply = `✔️ ${suggestions[index].respuesta}`;
          await sendMessage(from, reply);
          userSuggestions.delete(from); // limpiar después de responder
          return res.sendStatus(200);
        }
      }

      // 🔹 Buscar coincidencia con similitud
      const questions = faqData.map((q) => q.pregunta.toLowerCase());
      const answers = faqData.map((q) => q.respuesta);

      const match = stringSimilarity.findBestMatch(text, questions);
      const best = match.bestMatch;

      let reply;

      if (best.rating > 0.5) {
        const index = match.bestMatchIndex;
        const bestAnswer = answers[index];
        const templates = [
          `ℹ️ ${bestAnswer}`,
          `✔️ ${bestAnswer}`,
          `${bestAnswer}`,
          `✅ ${bestAnswer}`,
        ];
        reply = templates[Math.floor(Math.random() * templates.length)];
      } else {
        // 🔹 Si no hay coincidencia clara, mostrar sugerencias relacionadas
        const sortedMatches = match.ratings
          .sort((a, b) => b.rating - a.rating)
          .slice(0, 5);

        const relatedSuggestions = sortedMatches.map(
          (m) => faqData[questions.indexOf(m.target)]
        );

        userSuggestions.set(from, relatedSuggestions); // guardar para este número

        let suggestionText =
          "No he comprendido completamente su consulta. ¿Podría seleccionar una de las siguientes opciones relacionadas?\n\n";
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
