import axios from "axios";

const TOKEN_KEY = "ai-app-auth-token";

const documentsApi = axios.create({
  baseURL: "/api",
});

const getAuthHeaders = () => {
  const token = localStorage.getItem(TOKEN_KEY);

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
};

export const uploadFile = async (file, onProgress) => {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await documentsApi.post("/upload", formData, {
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: (event) => {
      if (!event.total) {
        return;
      }

      const percentage = Math.round((event.loaded * 100) / event.total);
      onProgress?.(percentage);
    },
  });

  return data;
};

export const uploadAudio = async (file, onProgress) => {
  const formData = new FormData();
  formData.append("audio", file); // note the backend expects field name 'audio'

  const { data } = await documentsApi.post("/upload/audio", formData, {
    headers: {
      ...getAuthHeaders(),
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: (event) => {
      if (!event.total) {
        return;
      }

      const percentage = Math.round((event.loaded * 100) / event.total);
      onProgress?.(percentage, event.loaded, event.total);
    },
  });

  return data;
};

export const getAudioLimits = async () => {
  const { data } = await documentsApi.get("/upload/audio/limits", {
    headers: getAuthHeaders(),
  });
  return data;
};


export const getDocuments = async () => {
  const { data } = await documentsApi.get("/documents", {
    headers: getAuthHeaders(),
  });
  return data;
};

export const deleteDocument = async (id) => {
  await documentsApi.delete(`/documents/${id}`, {
    headers: getAuthHeaders(),
  });
};

export const getDocumentStatus = async (id) => {
  const { data } = await documentsApi.get(`/documents/${id}/status`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export const previewUrl = async (url) => {
  const { data } = await documentsApi.post(
    "/scrape/preview",
    { url },
    {
      headers: getAuthHeaders(),
    }
  );
  return data;
};

export const ingestUrl = async (url, title) => {
  const { data } = await documentsApi.post(
    "/scrape/ingest",
    { url, title },
    {
      headers: getAuthHeaders(),
    }
  );
  return data;
};

export const getIngestStatus = async (docId) => {
  const { data } = await documentsApi.get(`/scrape/status/${docId}`, {
    headers: getAuthHeaders(),
  });
  return data;
};

export default documentsApi;
