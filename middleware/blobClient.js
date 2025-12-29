// middleware/blobClient.js
const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

const AZURE_CS = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!AZURE_CS) {
  console.warn('⚠️ AZURE_STORAGE_CONNECTION_STRING not set - blob storage disabled');
  module.exports = { containerClient: null };
} else {
  const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CS);
  const containerName = 'profile-pictures';
  const containerClient = blobServiceClient.getContainerClient(containerName);
  module.exports = { containerClient };
}