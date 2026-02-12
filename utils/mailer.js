const nodemailer = require('nodemailer');
const path = require("path");

const transporter = nodemailer.createTransport({
  // host: process.env.EMAIL_HOST,      // e.g., "smtp.gmail.com", "smtp.office365.com", etc.
  // port: parseInt(process.env.EMAIL_PORT) || 587, // 587 for TLS, 465 for SSL
  // secure: process.env.EMAIL_SECURE === 'true',  // true for port 465, false for 587
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const isEmailConfigured = () =>
  Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

async function sendPasswordResetEmail(email, code) {
  const mailOptions = {
    from: `"ApogeeFit Support" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your ApogeeFit Reset Code',
    html: `
      <h2>Password Reset Request</h2>
      <p>Use the following 6-digit code to reset your password:</p>
      <h1 style="font-size: 36px; letter-spacing: 4px; color: #4CAF50;">${code}</h1>
      <p>This code will expire in 10 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent:', info.response);
  } catch (error) {
    console.error('❌ Error sending email:', error);
  }
}

async function sendInquiryEmail({
  userEmail,
  message,
  subject,
  topic,
  attachments = [],
  blobAttachments = [],
}) {
  const safeEmail = String(userEmail || "").trim();
  const safeMessage = String(message || "").trim();
  const safeTopic = topic ? escapeHtml(topic) : null;

  // Process legacy inline attachments (base64 / multer buffers)
  const safeAttachments = (attachments || [])
    .map((attachment, index) => {
      const content = attachment?.content || attachment?.buffer;
      if (!content) {
        return null;
      }

      const filename = path.basename(
        String(
          attachment?.filename ||
            attachment?.originalname ||
            `attachment_${index + 1}`
        )
      );

      return {
        filename,
        content,
        contentType: attachment?.contentType || attachment?.mimetype,
      };
    })
    .filter(Boolean);

  // Generate download links for blob-based attachments
  let blobLinksHtml = "";
  if (blobAttachments.length > 0) {
    const { generateReadSas } = require("../middleware/blobClient");

    const linkItems = blobAttachments
      .map((a) => {
        try {
          const downloadUrl = generateReadSas(a.blobUrl, 30);
          const safeName = escapeHtml(a.filename || "attachment");
          const safeType = escapeHtml(a.contentType || "file");
          const sizeLabel = a.size
            ? ` (${formatFileSize(a.size)})`
            : "";
          return `<li><a href="${downloadUrl}">${safeName}</a> &mdash; ${safeType}${sizeLabel}</li>`;
        } catch (err) {
          console.error("Failed to generate read SAS for blob:", err.message);
          return null;
        }
      })
      .filter(Boolean);

    if (linkItems.length > 0) {
      blobLinksHtml = `
        <h3>Attachments</h3>
        <ul>${linkItems.join("")}</ul>
        <p style="color:#888;font-size:12px;">Links expire in 30 days.</p>
      `;
    }
  }

  const topicLine = safeTopic
    ? `<p><strong>Topic:</strong> ${safeTopic}</p>`
    : "";

  const mailOptions = {
    from: `"FitNxt Support" <${process.env.EMAIL_USER}>`,
    to: "fitness@hpapogee.com",
    replyTo: safeEmail,
    subject: subject || "FitNxt Customer Inquiry",
    text: `From: ${safeEmail}\n\n${safeMessage}`,
    html: `
      <h2>FitNxt Customer Inquiry</h2>
      ${topicLine}
      <p><strong>From:</strong> ${escapeHtml(safeEmail)}</p>
      <p>${escapeHtml(safeMessage).replace(/\n/g, "<br />")}</p>
      ${blobLinksHtml}
    `,
    attachments: safeAttachments.length > 0 ? safeAttachments : undefined,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Inquiry email sent:", info.response);
    return { success: true };
  } catch (error) {
    console.error("Error sending inquiry email:", error);
    return { success: false, error: error.message };
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

module.exports = { sendPasswordResetEmail, sendInquiryEmail, isEmailConfigured };
