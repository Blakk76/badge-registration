"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Signing you in...");

  useEffect(() => {
    let mounted = true;

    const finishLogin = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error("exchangeCodeForSession error:", error);
            if (mounted) {
              setMessage("Login failed. Redirecting to login...");
              setTimeout(() => router.replace("/login"), 1500);
            }
            return;
          }
        }

        const { data, error } = await supabase.auth.getSession();

        console.log("callback session:", data?.session, error);

        if (data?.session) {
          router.replace("/register");
        } else {
          if (mounted) {
            setMessage("No session found. Redirecting to login...");
            setTimeout(() => router.replace("/login"), 1500);
          }
        }
      } catch (e) {
        console.error("callback exception:", e);
        if (mounted) {
          setMessage("Something went wrong. Redirecting to login...");
          setTimeout(() => router.replace("/login"), 1500);
        }
      }
    };

    finishLogin();

    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#b21d3d",
        color: "white",
        fontFamily: "Arial, sans-serif",
        fontSize: 18,
        fontWeight: 700,
      }}
    >
      {message}
    </div>
  );
}