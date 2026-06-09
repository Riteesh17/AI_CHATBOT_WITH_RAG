import axios from "axios";

const authApi = axios.create({
  baseURL: "/api/auth",
});

export const setAuthToken = (token) => {
  if (token) {
    authApi.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete authApi.defaults.headers.common.Authorization;
  }
};

export const registerUser = async (payload) => {
  const { data } = await authApi.post("/register", payload);
  return data;
};

export const loginUser = async (payload) => {
  const { data } = await authApi.post("/login", payload);
  return data;
};

export const fetchCurrentUser = async () => {
  const { data } = await authApi.get("/me");
  return data;
};

export default authApi;
