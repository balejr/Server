const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendPasswordResetEmail(email, code) {
  const mailOptions = {
    from: '"ApogeeFit Support" <support@hpapogee.com>',
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

