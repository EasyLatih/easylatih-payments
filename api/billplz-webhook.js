const crypto = require("crypto");
const querystring = require("querystring");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

// read raw x-www-form-urlencoded body
function readRaw(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

// verify Billplz X-Signature
function verifyXSignature(obj) {
  const keys = Object.keys(obj).filter((k) => k !== "x_signature");
  keys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const source = keys.map((k) => `${k}${obj[k]}`).join("|");
  const h = crypto
    .createHmac("sha256", process.env.BILLPLZ_X_SIGNATURE)
    .update(source, "utf8")
    .digest("hex");
  return h === obj.x_signature;
}

// simple invoice number
function nextInvoiceNo() {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const rnd = Math.floor(Math.random() * 9000) + 1000;
  return `EL-${ym}-${rnd}`;
}

// make a one-page PDF invoice, return Buffer
function buildInvoicePdf({ invoiceNo, name, email, amountSen, billId, paidAt }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text("Easy Latih Consultancy", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(12).text("www.easylatih.my");
    doc.moveDown();

    doc.fontSize(20).text("TAX INVOICE / RECEIPT", { align: "right" });
    doc.moveDown();

    const rm = (Number(amountSen || 0) / 100).toFixed(2);
    doc.fontSize(11)
      .text(`Invoice No: ${invoiceNo}`)
      .text(`Billplz Bill ID: ${billId}`)
      .text(`Date Paid: ${paidAt || "-"}`)
      .moveDown()
      .text(`Billed To: ${name}${email ? " <" + email + ">" : ""}`)
      .moveDown()
      .text(`Description: Training Registration Fee`)
      .text(`Amount (RM): ${rm}`)
      .moveDown(2)
      .fontSize(9)
      .text("Thank you for your payment.", { align: "left" });

    doc.end();
  });
}

async function emailInvoice({ to, pdfBuffer, invoiceNo }) {
  if (!process.env.SMTP_HOST) {
    console.log("No SMTP set. Skipping email.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: `"Easy Latih" <${process.env.ADMIN_EMAIL}>`,
    to,
    bcc: process.env.ADMIN_EMAIL,
    subject: `Invoice ${invoiceNo} – Easy Latih`,
    text: `Attached is your invoice ${invoiceNo}. Thank you.`,
    attachments: [{ filename: `${invoiceNo}.pdf`, content: pdfBuffer }]
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  const raw = await readRaw(req);
  const obj = querystring.parse(raw); // form-encoded to object

  // verify signature
  if (!obj.x_signature || !verifyXSignature(obj)) {
    res.statusCode = 400;
    return res.end("Invalid signature");
  }

  // Only if paid
  if (String(obj.paid) !== "true" || obj.state !== "paid") {
    res.statusCode = 200;
    return res.end(); // acknowledge quietly
  }

  try {
    const invoiceNo = nextInvoiceNo();
    const pdf = await buildInvoicePdf({
      invoiceNo,
      name: obj.name || "",
      email: obj.email || "",
      amountSen: obj.amount || 0,
      billId: obj.id || "",
      paidAt: obj.paid_at || ""
    });

    if (obj.email) {
      await emailInvoice({ to: obj.email, pdfBuffer: pdf, invoiceNo });
    }
  } catch (e) {
    console.error("Webhook error:", e);
    // still reply 200 so Billplz doesn't downgrade the webhook
  }

  res.statusCode = 200;
  return res.end();
};
