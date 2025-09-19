const querystring = require("querystring");

// helper: read raw body (works for HTML forms)
function readRaw(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  // parse HTML form body
  const raw = await readRaw(req);
  const form = querystring.parse(raw);

  const name = (form.name || "").trim();
  const email = (form.email || "").trim();
  const mobile = (form.mobile || "").trim();
  const amount = String(form.amount || "").trim(); // in sen (e.g., 10000)

  if (!name || (!email && !mobile) || !amount) {
    res.statusCode = 400;
    return res.end("Missing fields");
  }

  const API_BASE =
    process.env.BILLPLZ_SANDBOX === "true"
      ? "https://www.billplz-sandbox.com/api"
      : "https://www.billplz.com/api";

  const payload = {
    collection_id: process.env.BILLPLZ_COLLECTION_ID,
    name,
    email,
    mobile,
    amount, // sen
    description: "Training Registration Fee",
    callback_url: `${process.env.PUBLIC_API_BASE}/api/billplz-webhook`,
    redirect_url: `${process.env.APP_BASE_URL}/payment-status`
  };

  const auth =
    "Basic " + Buffer.from(process.env.BILLPLZ_API_KEY + ":").toString("base64");

  const resp = await fetch(`${API_BASE}/v3/bills`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    res.statusCode = 500;
    return res.end(`Billplz error: ${text}`);
  }

  const bill = await resp.json(); // expects { url, id, ... }
  res.statusCode = 302;
  res.setHeader("Location", bill.url);
  return res.end();
};
