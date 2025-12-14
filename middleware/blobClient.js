// middleware/blobClient.js
const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

const AZURE_CS = process.env.AZURE_STORAGE_CONNECTION_STRING;

let containerClient = null;

if (AZURE_CS) {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CS);
    const containerName = 'profile-pictures';
    containerClient = blobServiceClient.getContainerClient(containerName);
    console.log('Azure Blob Storage initialized');
  } catch (error) {
    console.warn('Azure Blob Storage connection failed:', error.message);
    console.warn('Profile picture uploads will be disabled');
  }
} else {
  console.warn('AZURE_STORAGE_CONNECTION_STRING not set - profile picture uploads disabled');
}

module.exports = { containerClient };
