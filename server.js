import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// --- CONFIGURACIÓN GOOGLE SHEETS ---
const SHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_RANGE = process.env.SHEET_RANGE || "Preguntas!A2:B";

async function getSheetData() {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, "base64").toString("utf8")
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });

  const rows = res.data.values || [];
  const data = rows.map(([pregunta, respuesta]) => ({
    pregunta: pregunta.toLowerCase(),
    respuesta,
  }));
  return data;
}

// --- WEBHOOK DE VERIFICACIÓN ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado correctamente.");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// --- MANEJO DE MENSAJES ---
app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object) {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message && message.text) {
      const from = message.from;
      const text = message.text.body.toLowerCase().trim();

      console.log("📩 Mensaje recibido:", text);

      let reply = "Disculpa, no te entendí muy bien. ¿Podrías repetirlo? 😊";

      try {
        const faqData = await getSheetData();
        // Función para medir similitud entre textos (simple pero eficaz)
function similarity(a, b) {
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);
  const matches = wordsA.filter((w) => wordsB.includes(w));
  return matches.length / Math.max(wordsA.length, wordsB.length);
}

let bestMatch = null;
let bestScore = 0;

for (const row of faqData) {
  const score = similarity(text, row.pregunta);
  if (score > bestScore) {
    bestScore = score;
    bestMatch = row;
  }
}

// Si la similitud supera cierto umbral, se considera válida
if (bestScore > 0.3) {
  reply = bestMatch.respuesta;
}


        if (match) {
          reply = match.respuesta;
        }

        await axios.post(
          `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: reply },
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            },
          }
        );

        console.log("✅ Respuesta enviada:", reply);
      } catch (error) {
        console.error("❌ Error:", error.response?.data || error.message);
      }
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Bot de Horizon CHM conectado y listo en el puerto", PORT));

