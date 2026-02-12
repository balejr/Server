// middleware/blobClient.js
const {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
} = require("@azure/storage-blob");
require("dotenv").config();

const AZURE_CS = process.env.AZURE_STORAGE_CONNECTION_STRING;

let containerClient = null; // profile-pictures (existing)
let inquiryContainerClient = null;
let sharedKeyCredential = null;
let accountName = null;

if (AZURE_CS) {
  try {
    // Parse account name and key from connection string for SAS generation
    const csMap = {};
    for (const part of AZURE_CS.split(";")) {
      const idx = part.indexOf("=");
      if (idx > -1) {
        csMap[part.substring(0, idx)] = part.substring(idx + 1);
      }
    }
    accountName = csMap.AccountName;
    const accountKey = csMap.AccountKey;

    if (accountName && accountKey) {
      sharedKeyCredential = new StorageSharedKeyCredential(
        accountName,
        accountKey
      );
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CS);

    // Existing profile-pictures container
    containerClient = blobServiceClient.getContainerClient("profile-pictures");

    // New inquiry-attachments container
    inquiryContainerClient = blobServiceClient.getContainerClient(
      "inquiry-attachments"
    );
    inquiryContainerClient
      .createIfNotExists()
      .then(() =>
        console.log("inquiry-attachments container ready")
      )
      .catch((err) =>
        console.warn("inquiry-attachments createIfNotExists failed:", err.message)
      );

    console.log("Azure Blob Storage initialized successfully");
  } catch (error) {
    console.warn("Azure Blob Storage initialization failed:", error.message);
  }
} else {
  console.warn(
    "AZURE_STORAGE_CONNECTION_STRING not set - blob storage disabled"
  );
}

/**
 * Generate a write-only SAS URL for uploading to inquiry-attachments.
 * @param {string} blobName - Full blob path (e.g. inquiries/{userId}/{ts}-{uuid}-{file})
 * @param {string} contentType - MIME type for the Content-Type header
 * @returns {string} Full SAS URL for upload (PUT)
 */
function generateUploadSas(blobName, contentType) {
  if (!sharedKeyCredential || !inquiryContainerClient) {
    throw new Error("Azure Blob Storage is not configured");
  }

  const startsOn = new Date();
  startsOn.setMinutes(startsOn.getMinutes() - 2); // clock skew buffer
  const expiresOn = new Date();
  expiresOn.setMinutes(expiresOn.getMinutes() + 15);

  const sasParams = generateBlobSASQueryParameters(
    {
      containerName: "inquiry-attachments",
      blobName,
      permissions: BlobSASPermissions.parse("cw"), // create + write
      startsOn,
      expiresOn,
      contentType,
    },
    sharedKeyCredential
  );

  const blobClient = inquiryContainerClient.getBlobClient(blobName);
  return `${blobClient.url}?${sasParams.toString()}`;
}

/**
 * Generate a read-only SAS URL for downloading from inquiry-attachments.
 * @param {string} blobUrl - Full blob URL (without SAS)
 * @param {number} [expiryDays=30] - Number of days the read link is valid
 * @returns {string} Full SAS URL for read (GET)
 */
function generateReadSas(blobUrl, expiryDays = 30) {
  if (!sharedKeyCredential) {
    throw new Error("Azure Blob Storage is not configured");
  }

  // Extract blob name from the URL
  const prefix = `https://${accountName}.blob.core.windows.net/inquiry-attachments/`;
  if (!blobUrl.startsWith(prefix)) {
    throw new Error("Invalid blob URL for inquiry-attachments");
  }
  const blobName = decodeURIComponent(
    blobUrl.substring(prefix.length).split("?")[0]
  );

  const startsOn = new Date();
  startsOn.setMinutes(startsOn.getMinutes() - 2);
  const expiresOn = new Date();
  expiresOn.setDate(expiresOn.getDate() + expiryDays);

  const sasParams = generateBlobSASQueryParameters(
    {
      containerName: "inquiry-attachments",
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    sharedKeyCredential
  );

  // Return the clean blob URL (without any existing query params) + new SAS
  const cleanUrl = blobUrl.split("?")[0];
  return `${cleanUrl}?${sasParams.toString()}`;
}

module.exports = {
  containerClient,
  inquiryContainerClient,
  generateUploadSas,
  generateReadSas,
};
