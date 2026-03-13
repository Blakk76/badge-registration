"use client";
import { useEffect, useState } from "react";

export default function Home() {
  const [timeLeft, setTimeLeft] = useState("00d 00h 00m 00s");

  useEffect(() => {
    const targetDate = new Date("April 19, 2026 00:00:00").getTime();

    const updateTimer = setInterval(() => {
      const now = new Date().getTime();
      const difference = targetDate - now;

      if (difference < 0) {
        clearInterval(updateTimer);
        setTimeLeft("EVENT LIVE");
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    }, 1000);

    return () => clearInterval(updateTimer);
  }, []);

  return (
    <main>
      <style jsx global>{`
        body, html {
          margin: 0; padding: 0; height: 100%; overflow: hidden;
          background-color: #000;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .fixed-bg {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background-image: url('/br.jpg');
          background-size: cover; background-position: center; z-index: 1;
        }
        .fixed-logo {
          position: fixed; top: 40%; left: 50%; transform: translate(-50%, -50%);
          z-index: 10; width: 200px;
        }
        .fixed-registration {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          z-index: 10; padding: 14px 24px; border-radius: 14px;
          background: #c2b69b; color: #222; font-weight: 800;
          text-decoration: none; letter-spacing: 0.3px; font-size: 14px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.25); transition: 0.2s ease;
        }
        .fixed-registration:hover {
          transform: translate(-50%, -50%) scale(1.05);
        }
        .fixed-countdown {
          position: fixed; top: 60%; left: 50%; transform: translate(-50%, -50%);
          z-index: 10; background: rgba(0, 0, 0, 0.6); color: white;
          padding: 15px 25px; border-radius: 10px; text-align: center;
          backdrop-filter: blur(8px); border: 1px solid rgba(255, 255, 255, 0.1);
          min-width: 150px;
        }
        #timer { font-size: 1.5rem; font-weight: bold; margin-top: 5px; }
        h2 { margin: 0; font-size: 0.5rem; letter-spacing: 2px; color: #ff4d4d; text-transform: uppercase; }
      `}</style>

      <div className="fixed-bg"></div>

      {/* Make sure logo.png is in your /public folder! */}
      <img src="/logo.png" alt="Logo" className="fixed-logo" />

      <a href="https://registration.geowf.ge" className="fixed-registration">
        Registration
      </a>

      <div className="fixed-countdown">
        <h2>Batumi 2026 Begins In</h2>
        <div id="timer">{timeLeft}</div>
      </div>
    </main>
  );
}
