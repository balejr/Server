require('dotenv').config();
const { sendPasswordResetEmail } = require('./utils/mailer');
const { generateResetToken } = require('./utils/token'); // make sure you have this

(async () => {
  try {
    const testEmail = 'simranshukla@gmail.com'; // put your test email here

    // Normally the token would include the user's ID
    const resetToken = generateResetToken({ userId: 123 }); // just testing with dummy ID

    await sendPasswordResetEmail(testEmail, resetToken);

    console.log('✅ Test email with reset link sent!');
  } catch (error) {
    console.error('❌ Error sending test reset email:', error);
  }
})();
