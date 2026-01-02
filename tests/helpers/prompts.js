/**
 * Interactive Prompts Helper
 *
 * Provides readline-based prompts for entering OTP codes during tests.
 * These prompts pause the test execution until user input is received.
 */

const readline = require("readline");

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bright: "\x1b[1m",
};

/**
 * Create a readline interface
 * @returns {readline.Interface}
 */
const createInterface = () => {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
};

/**
 * Prompt user for input
 *
 * @param {string} question - Question to display
 * @returns {Promise<string>} - User's answer (trimmed)
 */
const prompt = (question) => {
  const rl = createInterface();

  return new Promise((resolve) => {
    rl.question(
      `\n  ${colors.yellow}>> ${question}: ${colors.reset}`,
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
};

/**
 * Prompt for a 6-digit OTP code
 *
 * @param {string} source - Where the code was sent (e.g., "your phone", "your email")
 * @returns {Promise<string|null>} - 6-digit code or null if invalid/skipped
 */
const askForOTP = async (source) => {
  console.log(`\n  ${colors.cyan}📱 Check ${source} for a 6-digit code${colors.reset}`);
  
  const code = await prompt(`Enter the 6-digit code from ${source}`);

  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    console.log(`  ${colors.yellow}⚠️  Invalid code format (expected 6 digits)${colors.reset}`);
    return null;
  }

  return code;
};

/**
 * Prompt for a yes/no confirmation
 *
 * @param {string} question - Question to ask
 * @param {boolean} defaultValue - Default value if user just presses enter
 * @returns {Promise<boolean>}
 */
const askYesNo = async (question, defaultValue = false) => {
  const defaultHint = defaultValue ? "Y/n" : "y/N";
  const answer = await prompt(`${question} (${defaultHint})`);

  if (!answer) {
    return defaultValue;
  }

  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
};

/**
 * Display a section header
 *
 * @param {string} title - Section title
 */
const section = (title) => {
  console.log(`\n${colors.cyan}▶ ${title}${colors.reset}`);
};

/**
 * Display a success message
 *
 * @param {string} message - Success message
 * @param {number} duration - Duration in ms (optional)
 */
const success = (message, duration = null) => {
  const durationStr = duration ? ` ${colors.dim}(${duration}ms)${colors.reset}` : "";
  console.log(`  ${colors.green}✓${colors.reset} ${message}${durationStr}`);
};

/**
 * Display a failure message
 *
 * @param {string} message - Failure message
 * @param {string} reason - Reason for failure (optional)
 */
const failure = (message, reason = null) => {
  console.log(`  ${colors.red}✗${colors.reset} ${message}`);
  if (reason) {
    console.log(`    ${colors.dim}→ ${reason}${colors.reset}`);
  }
};

/**
 * Display an info message
 *
 * @param {string} message - Info message
 */
const info = (message) => {
  console.log(`  ${colors.dim}ℹ ${message}${colors.reset}`);
};

/**
 * Display a warning message
 *
 * @param {string} message - Warning message
 */
const warning = (message) => {
  console.log(`  ${colors.yellow}⚠ ${message}${colors.reset}`);
};

/**
 * Wait for user to press any key
 *
 * @param {string} message - Message to display
 */
const pressAnyKey = async (message = "Press any key to continue...") => {
  return new Promise((resolve) => {
    console.log(`\n  ${colors.dim}${message}${colors.reset}`);
    
    // Set raw mode to capture single keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.once("data", () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve();
    });
  });
};

module.exports = {
  prompt,
  askForOTP,
  askYesNo,
  section,
  success,
  failure,
  info,
  warning,
  pressAnyKey,
  colors,
};

