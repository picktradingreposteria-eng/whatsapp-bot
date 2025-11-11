import express from "express";
import axios from "axios";
import { google } from "googleapis";
import stringSimilarity from "string-similarity"; // coincidencia flexible

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
      const questions = faqData.map((q) => q.pregunta.toLowerCase());
      const answers = faqData.map((q) => q.respuesta);

      // ---------- NUEVA LÓGICA DE COINCIDENCIA ----------
      const match = stringSimilarity.findBestMatch(text, questions);
      const best = match.bestMatch;

      let reply;

      if (best.rating > 0.4) {
        const index = match.bestMatchIndex;
        const bestAnswer = answers[index];

        // 👇 Plantillas más formales y neutrales
        const templates = [
          `✔️ ${bestAnswer}`,
          `✅ ${bestAnswer}`,
          `${bestAnswer}`,
          `ℹ️ ${bestAnswer}`,
          `De acuerdo. ${bestAnswer}`,
        ];

        reply = templates[Math.floor(Math.random() * templates.length)];
      } else {
        reply =
          "Disculpe, no he logrado comprender su consulta. ¿Podría reformularla, por favor?";
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
