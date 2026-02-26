"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendLink() {
    setMsg("");

    if (!email.trim()) {
      setMsg("Enter your IWF mail.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/register`,
      },
    });

    setLoading(false);

    if (error) {
      setMsg(error.message);
    } else {
      setMsg("Login link sent. Check your IWF mail.");
    }
  }

  const styles = {
    page: {
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#b21d3d",
      fontFamily: "Arial",
      padding: 20,
    },

    card: {
      width: 420,
      background: "white",
      borderRadius: 18,
      padding: 28,
      boxShadow: "0 20px 48px rgba(0,0,0,0.25)",
      display: "flex",
      flexDirection: "column",
      gap: 16,
    },

    title: {
      fontSize: 22,
      fontWeight: 900,
      textAlign: "center",
      marginBottom: 6,
    },

    input: {
      height: 48,
      borderRadius: 12,
      border: "1px solid rgba(0,0,0,0.15)",
      padding: "0 14px",
      fontSize: 15,
      outline: "none",
      fontWeight: 600,
    },

    btn: {
      height: 48,
      borderRadius: 12,
      border: "none",
      background: "#c2b69b",
      fontWeight: 900,
      cursor: "pointer",
      letterSpacing: 0.3,
      opacity: loading ? 0.7 : 1,
    },

    msg: {
      fontSize: 14,
      textAlign: "center",
      opacity: 0.8,
      minHeight: 18,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.title}>Login</div>

        <input
          style={styles.input}
          placeholder="IWF mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button style={styles.btn} onClick={sendLink} disabled={loading}>
          {loading ? "Sending..." : "Send login link"}
        </button>

        {msg && <div style={styles.msg}>{msg}</div>}
      </div>
    </div>
  );
}
