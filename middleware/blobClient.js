// middleware/blobClient.js
const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

const AZURE_CS = process.env.AZURE_STORAGE_CONNECTION_STRING;

let containerClient = null;

// 只有在有 Azure 连接字符串时才初始化 Blob 客户端
if (AZURE_CS) {
  try {
    const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CS);
    const containerName = 'profile-pictures';
    containerClient = blobServiceClient.getContainerClient(containerName);
    console.log('Azure Blob Storage 客户端已初始化');
  } catch (error) {
    console.warn('Azure Blob Storage 初始化失败:', error.message);
  }
} else {
  console.warn('AZURE_STORAGE_CONNECTION_STRING 未设置，文件上传功能将不可用');
}

module.exports = { containerClient };