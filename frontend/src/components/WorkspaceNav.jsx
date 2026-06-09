import { NavLink } from "react-router-dom";

import useAuth from "../hooks/useAuth";

const WorkspaceNav = ({ title, description, actions, mobileMenuAction }) => {
  const { logout, user } = useAuth();

  return (
    <header className="workspace-header">
      <div className="workspace-header-left">
        {mobileMenuAction ? (
          <button
            type="button"
            className="menu-button"
            onClick={mobileMenuAction}
            aria-label="Toggle conversations"
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}
      </div>

      <div className="workspace-title-row">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>

        <nav className="workspace-tabs" aria-label="Workspace navigation">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `workspace-tab ${isActive ? "workspace-tab-active" : ""}`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              `workspace-tab ${isActive ? "workspace-tab-active" : ""}`
            }
          >
            Chat
          </NavLink>
        </nav>
      </div>

      <div className="workspace-actions" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {actions}
        {user && (
          <div className="workspace-user-profile" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span 
              className="workspace-user-avatar" 
              style={{ 
                display: "grid", 
                placeItems: "center", 
                width: "36px", 
                height: "36px", 
                borderRadius: "50%", 
                background: "linear-gradient(135deg, var(--blue-primary), var(--blue-secondary))", 
                color: "#ffffff", 
                fontWeight: "700",
                fontSize: "0.95rem",
                boxShadow: "0 2px 8px rgba(37, 99, 235, 0.15)"
              }}
            >
              {user.full_name ? user.full_name.charAt(0).toUpperCase() : "U"}
            </span>
            <span 
              className="workspace-user-name" 
              style={{ 
                fontWeight: "600", 
                color: "var(--text-secondary)",
                fontSize: "0.95rem" 
              }}
            >
              {user.full_name || user.email}
            </span>
          </div>
        )}
        <button
          type="button"
          className="secondary-button workspace-logout-button"
          onClick={logout}
        >
          Logout
        </button>
      </div>
    </header>
  );
};

export default WorkspaceNav;
