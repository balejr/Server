const nodemailer = require('nodemailer');

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

async function sendInquiryEmail({ userEmail, message }) {
  const safeEmail = String(userEmail || "").trim();
  const safeMessage = String(message || "").trim();

  const mailOptions = {
    from: `"FitNxt Support" <${process.env.EMAIL_USER}>`,
    to: "fitness@hpapogee.com",
    replyTo: safeEmail,
    subject: "FitNxt Customer Inquiry",
    text: `From: ${safeEmail}\n\n${safeMessage}`,
    html: `
      <h2>FitNxt Customer Inquiry</h2>
      <p><strong>From:</strong> ${escapeHtml(safeEmail)}</p>
      <p>${escapeHtml(safeMessage).replace(/\n/g, "<br />")}</p>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Inquiry email sent:", info.response);
    return { success: true };
  } catch (error) {
    console.error("❌ Error sending inquiry email:", error);
    return { success: false, error: error.message };
  }
}

module.exports = { sendPasswordResetEmail, sendInquiryEmail, isEmailConfigured };
