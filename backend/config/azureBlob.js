const { BlobServiceClient } = require("@azure/storage-blob");

const getAzureConfig = () => {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER;

  if (!connectionString || !containerName) {
    throw new Error(
      "Azure Blob Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER in backend/.env."
    );
  }

  return {
    connectionString,
    containerName,
  };
};

const getContainerClient = async () => {
  const { connectionString, containerName } = getAzureConfig();
  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  await containerClient.createIfNotExists();
  return containerClient;
};

const uploadFileToBlob = async (localFilePath, blobName, mimeType) => {
  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadFile(localFilePath, {
    blobHTTPHeaders: {
      blobContentType: mimeType,
    },
  });

  return {
    blobName,
    blobUrl: blockBlobClient.url,
  };
};

const deleteBlob = async (blobName) => {
  if (!blobName) {
    return;
  }

  const containerClient = await getContainerClient();
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
};

module.exports = {
  getContainerClient,
  uploadFileToBlob,
  deleteBlob,
};
