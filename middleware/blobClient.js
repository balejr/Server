// // middleware/blobClient.js
// const { BlobServiceClient } = require('@azure/storage-blob');
// require('dotenv').config();

// const AZURE_CS = process.env.AZURE_STORAGE_CONNECTION_STRING;
// // const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CS);

// const containerName = 'profile-pictures';
// const containerClient = blobServiceClient.getContainerClient(containerName);

// module.exports = { containerClient };

// Local Test
const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

const AZURE_CS = process.env.AZURE_STORAGE_CONNECTION_STRING;

let containerClient = null;

if (!AZURE_CS) {
  console.warn("[Blob Storage] No Azure connection string found. Blob uploads disabled.");
} else {
  const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CS);
  const containerName = 'profile-pictures';
  containerClient = blobServiceClient.getContainerClient(containerName);
}

module.exports = { containerClient };
