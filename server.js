import express from "express";
import axios from "axios";
import { google } from "googleapis";
import stringSimilarity from "string-similarity";

const app = express();
app.use(express.json());

// ---------- LEER GOOGLE SHEETS ----------
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
      range: process.env.SHEET_RANGE, // Ej: "Preguntas_frecuentes!A2:C"
    });

    const rows = response.data.values || [];
    return rows
      .filter((r) => r[0] && r[1] && r[2])
      .map(([tema, pregunta, respuesta]) => ({
        tema,
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

// ---------- MEMORIA DE SESIÓN ----------
const userMemory = new Map();

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
      const questions = faqData.map((f) => f.pregunta.toLowerCase());

      const match = stringSimilarity.findBestMatch(text, questions);
      const best = faqData[match.bestMatchIndex];
      const bestRating = match.bestMatch.rating;

      // Recuperar memoria del usuario
      const memory = userMemory.get(from) || {};

      let reply = "";

      if (bestRating > 0.4) {
        // ✅ Respuesta encontrada
        const formalTemplates = [
          `✅ ${best.respuesta}`,
          `📘 ${best.respuesta}`,
          `ℹ️ ${best.respuesta}`,
          `${best.respuesta}`,
        ];
        reply =
          formalTemplates[Math.floor(Math.random() * formalTemplates.length)];
        memory.suggestions = null;
      } else {
        // ❌ No coincidencia clara → buscar tema predominante
        const temaPalabras = text.split(/\s+/);
        const temasCoincidentes = faqData.filter((f) =>
          temaPalabras.some((p) => f.tema.toLowerCase().includes(p))
        );

        // Si no se detecta tema → mostrar opciones generales
        const temaSeleccionado =
          temasCoincidentes.length > 0
            ? temasCoincidentes[0].tema
            : faqData[0].tema;

        const related = faqData.filter((f) => f.tema === temaSeleccionado);

        let suggestionText = `No he encontrado una respuesta exacta, pero parece estar relacionado con *${temaSeleccionado}*.\nPodría elegir una de estas opciones:\n\n`;
        related.slice(0, 5).forEach((item, i) => {
          suggestionText += `${i + 1}. ${item.pregunta}\n`;
        });

        memory.suggestions = related;
        reply = suggestionText;
      }

      userMemory.set(from, memory);

      // ---------- RESPUESTA A OPCIÓN NUMÉRICA ----------
      if (/^\d+$/.test(text) && memory.suggestions) {
        const index = parseInt(text) - 1;
        const selected = memory.suggestions[index];
        if (selected) {
          reply = selected.respuesta;
          memory.suggestions = null;
          userMemory.set(from, memory);
        } else {
          reply = "Por favor, seleccione un número válido.";
        }
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

