const express = require("express");
const bodyParser = require("body-parser");
const { bitrixRequest } = require("./bitrixAuth");

const app = express();
app.use(bodyParser.json());

let requestQueue = [];
let isProcessing = false;

app.get("/", (req, res) => {
  res.send("✅ App is running!");
});

app.post("/bx24-event-handler", async (req, res) => {
  console.log("📥 Incoming request:", req.body); // Log toàn bộ request để debug

  const callData = req.body.data;
  
  if (!callData || !callData.CALL_ID) {
    console.error("❌ Error: CALL_ID is missing or request body is invalid.", req.body);
    return res.status(400).json({ error: "Invalid request: Missing CALL_ID." });
  }

  const callId = callData.CALL_ID;
  console.log(`📞 Received call event for CALL_ID: ${callId}`);
  requestQueue.push({ callId, res });

  if (!isProcessing) {
    processNextRequest();
  }
});

async function processNextRequest() {
  if (requestQueue.length === 0) {
    console.log("✅ All requests processed.");
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const { callId, res } = requestQueue.shift();

  try {
    // Lấy thông tin cuộc gọi
    const callStats = await bitrixRequest(`/voximplant.statistic.get/?FILTER[CALL_ID]=${callId}`);
    if (!callStats?.result?.length) {
      throw new Error("No call data found.");
    }

    const callInfo = callStats.result[0];
    const { CRM_ENTITY_ID, CRM_ENTITY_TYPE, CALL_FAILED_REASON, CALL_DURATION, CALL_START_DATE } = callInfo;

    if (!CRM_ENTITY_ID) {
      throw new Error("Missing CRM_ENTITY_ID.");
    }

    // Cập nhật vào Deal
    if (CRM_ENTITY_TYPE === "DEAL") {
      await updateDeal(CRM_ENTITY_ID, CALL_FAILED_REASON, CALL_DURATION, CALL_START_DATE);
    } 
    // Nếu là Contact, tìm Deal liên quan
    else if (CRM_ENTITY_TYPE === "CONTACT") {
      const dealData = await bitrixRequest(`/crm.deal.list/?FILTER[CONTACT_ID]=${CRM_ENTITY_ID}`);
      if (dealData?.result?.length) {
        await updateDeal(dealData.result[0].ID, CALL_FAILED_REASON, CALL_DURATION, CALL_START_DATE);
      }
      // Cập nhật vào Contact nếu không có Deal
      await updateContact(CRM_ENTITY_ID, CALL_DURATION, CALL_FAILED_REASON, CALL_START_DATE);
    }

    res.send("✅ Call data processed successfully.");
  } catch (error) {
    console.error("❌ Error processing request:", error.message);
    res.status(500).send(error.message);
  }

  processNextRequest();
}

// Cập nhật Deal
async function updateDeal(dealId, callFailedCode, callDuration, callStartDate) {
  const fieldsToUpdate = {
    "UF_CRM_668BB634B111F": callFailedCode,  // Trạng thái cuộc gọi
    "UF_CRM_66C2B64134A71": callDuration,   // Thời gian gọi
    "UF_CRM_1733474117": callStartDate,     // Ngày gọi
  };

  console.log(`📌 Updating Deal ID: ${dealId}`);
  await bitrixRequest(`/crm.deal.update.json/?ID=${dealId}`, "POST", { fields: fieldsToUpdate });
}

// Cập nhật Contact
async function updateContact(contactId, callDuration, callStatus, lastCallDate) {
  const fieldsToUpdate = {
    "UF_CRM_66CBE81B02C06": callDuration,      // Thời gian gọi
    "UF_CRM_668F763F5D533": callStatus,        // Trạng thái cuộc gọi
    "UF_CRM_1733471904291": lastCallDate,      // Ngày cuối gọi
  };

  console.log(`📌 Updating Contact ID: ${contactId}`);
  await bitrixRequest(`/crm.contact.update.json/?ID=${contactId}`, "POST", { fields: fieldsToUpdate });
}

// Lắng nghe trên cổng Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}/`);
});
