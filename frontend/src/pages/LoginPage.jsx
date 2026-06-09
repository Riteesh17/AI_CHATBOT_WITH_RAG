import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";

import useAuth from "../hooks/useAuth";

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (values) => {
    setServerError("");

    try {
      await login(values.email, values.password);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setServerError(
        error.response?.data?.message || "Unable to sign in right now"
      );
    }
  };

  return (
    <div className="page-shell auth-page">
      <div className="auth-card-centered">
        <div className="auth-header-centered">
          <div className="auth-logo-icon">
            <span>💬</span>
            <span className="logo-spark">✨</span>
          </div>
          <span className="eyebrow">AI Chatbot</span>
          <h1>Sign In</h1>
        </div>

        <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              placeholder="you@example.com"
              {...register("email", {
                required: "Email is required",
                pattern: {
                  value: /^\S+@\S+\.\S+$/,
                  message: "Enter a valid email address",
                },
              })}
            />
            {errors.email && <small className="error">{errors.email.message}</small>}
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              placeholder="Enter your password"
              {...register("password", {
                required: "Password is required",
              })}
            />
            {errors.password && (
              <small className="error">{errors.password.message}</small>
            )}
          </label>

          {serverError && <div className="server-error">{serverError}</div>}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Login"}
          </button>

          <p className="auth-switch">
            Need an account? <Link to="/register">Create one</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
