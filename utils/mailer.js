const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,      // e.g., "smtp.gmail.com", "smtp.office365.com", etc.
  port: parseInt(process.env.EMAIL_PORT) || 587, // 587 for TLS, 465 for SSL
  secure: process.env.EMAIL_SECURE === 'true',  // true for port 465, false for 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

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

module.exports = { sendPasswordResetEmail };
