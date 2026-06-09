import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";

import useAuth from "../hooks/useAuth";

const RegisterPage = () => {
  const navigate = useNavigate();
  const { register: registerUser, isAuthenticated } = useAuth();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      full_name: "",
      email: "",
      password: "",
      confirm_password: "",
    },
  });

  const passwordValue = watch("password");

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (values) => {
    setServerError("");

    try {
      await registerUser(values.full_name, values.email, values.password);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setServerError(
        error.response?.data?.message || "Unable to create your account"
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
          <h1>Register</h1>
        </div>

        <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
          <label className="field">
            <span>Full name</span>
            <input
              type="text"
              placeholder="Jane Doe"
              {...register("full_name", {
                required: "Full name is required",
              })}
            />
            {errors.full_name && (
              <small className="error">{errors.full_name.message}</small>
            )}
          </label>

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
              placeholder="Minimum 8 characters"
              {...register("password", {
                required: "Password is required",
                minLength: {
                  value: 8,
                  message: "Password must be at least 8 characters",
                },
              })}
            />
            {errors.password && (
              <small className="error">{errors.password.message}</small>
            )}
          </label>

          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              placeholder="Re-enter your password"
              {...register("confirm_password", {
                required: "Please confirm your password",
                validate: (value) =>
                  value === passwordValue || "Passwords do not match",
              })}
            />
            {errors.confirm_password && (
              <small className="error">{errors.confirm_password.message}</small>
            )}
          </label>

          {serverError && <div className="server-error">{serverError}</div>}

          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? "Creating account..." : "Register"}
          </button>

          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
