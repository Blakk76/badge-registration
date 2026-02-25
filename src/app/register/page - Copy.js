// src/app/register/page.js
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper from "react-easy-crop";
import { supabase } from "@/lib/supabaseClient";

// Create cropped image (square)
async function getCroppedBlob(imageSrc, cropPixels) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = imageSrc;

  await new Promise((res, rej) => {
    image.onload = res;
    image.onerror = rej;
  });

  const canvas = document.createElement("canvas");
  canvas.width = cropPixels.width;
  canvas.height = cropPixels.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    cropPixels.width,
    cropPixels.height
  );

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9)
  );

  return { blob, preview: canvas.toDataURL("image/jpeg", 0.9) };
}

export default function RegisterPage() {
  const router = useRouter();

  const [sessionEmail, setSessionEmail] = useState("");
  const [msg, setMsg] = useState("");

  // Success popup
  const [successOpen, setSuccessOpen] = useState(false);
  const [successText, setSuccessText] = useState("");

  // form
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");

  // photo
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBlob, setPhotoBlob] = useState(null);

  // crop modal
  const [cropOpen, setCropOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  // Require auth + whitelist check
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email?.toLowerCase();
      if (!email) return router.push("/login");

      const { data: allowed, error } = await supabase
        .from("allowed_users")
        .select("email, active")
        .eq("email", email)
        .eq("active", true)
        .maybeSingle();

      if (error) {
        setMsg(error.message);
        return;
      }

      if (!allowed) {
        await supabase.auth.signOut();
        return router.push("/login");
      }

      setSessionEmail(email);
    })();
  }, [router]);

  function onSelectFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setRawImageSrc(reader.result);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
  }

  async function applyCrop() {
    setMsg("");
    if (!rawImageSrc || !croppedAreaPixels) return;

    const { blob, preview } = await getCroppedBlob(rawImageSrc, croppedAreaPixels);
    if (!blob) return setMsg("Could not crop image.");

    setPhotoBlob(blob);
    setPhotoPreview(preview);
    setCropOpen(false);
  }

  async function submit() {
    setMsg("");

    if (!sessionEmail) return setMsg("Not logged in.");
    if (!fullName.trim()) return setMsg("Enter NAME SURNAME.");
    if (!country.trim()) return setMsg("Enter COUNTRY.");
    if (!photoBlob) return setMsg("Upload and crop a photo.");

    // upload photo
    const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
    const filePath = `${sessionEmail}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("photos")
      .upload(filePath, photoBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadErr) return setMsg(uploadErr.message);

    // save registration
    const { error: insertErr } = await supabase.from("registrations").insert({
      registered_by_email: sessionEmail,
      full_name: fullName.trim(),
      country: country.trim(),
      photo_path: filePath,
    });

    if (insertErr) return setMsg(insertErr.message);

    // reset form
    setFullName("");
    setCountry("");
    setPhotoPreview(null);
    setPhotoBlob(null);

    // success popup
    setSuccessText("Registration saved.");
    setSuccessOpen(true);

    // optional: auto-close after 2 seconds
    setTimeout(() => setSuccessOpen(false), 2000);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const styles = useMemo(() => {
    const controlBase = {
      position: "absolute",
      boxSizing: "border-box",
      border: "none",
      outline: "none",
      padding: "0 16px",
      height: 48,
      borderRadius: 14,
      fontSize: 16,
      fontWeight: 600,
    };

    const primaryBtn = {
      ...controlBase,
      background: "#c2b69b",
      color: "#222",
      cursor: "pointer",
      fontWeight: 800,
      letterSpacing: 0.2,
    };

    return {
      page: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial",
        padding: 20,
      },

      badge: {
        width: 800,
        height: 800,
        position: "relative",
        backgroundImage: "url(/badge-bg.jpg)",
        backgroundSize: "100% 100%",
        backgroundPosition: "top left",
        backgroundRepeat: "no-repeat",
        borderRadius: 24,
        overflow: "hidden",
      },

      hiddenFile: { display: "none" },

      photoCircle: {
        position: "absolute",
        left: 72,
        top: 255,
        width: 285,
        height: 285,
        borderRadius: "50%",
        cursor: "pointer",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.08)",
      },
      photoImg: {
        width: "100%",
        height: "100%",
        objectFit: "cover",
      },
      photoLabelWrap: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        transform: "translateY(6px)",
      },
      photoLabel: {
        color: "rgba(255,255,255,0.85)",
        fontWeight: 900,
        letterSpacing: 0.6,
        fontSize: 18,
      },
      photoIcon: {
        fontSize: 40,
        lineHeight: 1,
        opacity: 0.9,
      },

      // Inputs (aligned + normalized)
      nameInput: {
        ...controlBase,
        left: 390,
        top: 320,
        width: 365,
        background: "rgba(255,255,255,0.92)",
      },
      countryInput: {
        ...controlBase,
        left: 390,
        top: 388,
        width: 250,
        background: "rgba(255,255,255,0.92)",
      },

      // Buttons aligned to inputs
      submitBtn: {
        ...primaryBtn,
        left: 390,
        top: 460,
        width: 170,
      },
      logoutBtn: {
        ...primaryBtn,
        left: 585,
        top: 460,
        width: 170,
        opacity: 0.9,
      },

      msg: {
        position: "absolute",
        left: 390,
        top: 520,
        width: 380,
        color: "white",
        fontSize: 14,
        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
      },

      // crop modal
      modalOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 9999,
      },
      modal: {
        width: "min(560px, 100%)",
        background: "white",
        borderRadius: 12,
        overflow: "hidden",
      },
      cropArea: {
        position: "relative",
        width: "100%",
        height: 420,
        background: "#111",
      },
      zoomRow: {
        padding: "0 12px 12px 12px",
        display: "flex",
        gap: 10,
        alignItems: "center",
      },
      zoomInput: { width: "100%" },
      modalFooter: {
        display: "flex",
        gap: 10,
        padding: 12,
      },
      modalBtn: {
        flex: 1,
        padding: 10,
        borderRadius: 10,
        border: "1px solid #ddd",
        cursor: "pointer",
        fontWeight: 800,
      },

      // success popup
      successOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 10000,
      },
      successModal: {
        width: "min(420px, 100%)",
        background: "white",
        borderRadius: 14,
        padding: 18,
        textAlign: "center",
      },
      successTitle: {
        fontSize: 18,
        fontWeight: 900,
        marginBottom: 8,
      },
      successBody: {
        fontSize: 14,
        marginBottom: 14,
      },
      successOk: {
        width: "100%",
        padding: 10,
        borderRadius: 10,
        border: "none",
        cursor: "pointer",
        fontWeight: 900,
        background: "#c2b69b",
        color: "#222",
      },
    };
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.badge}>
        <input
          id="file"
          type="file"
          accept="image/*"
          style={styles.hiddenFile}
          onChange={onSelectFile}
        />

        <div
          style={styles.photoCircle}
          onClick={() => document.getElementById("file")?.click()}
          title="Upload photo"
        >
          {photoPreview ? (
            <img src={photoPreview} alt="Cropped" style={styles.photoImg} />
          ) : (
            <div style={styles.photoLabelWrap}>
              <div style={styles.photoLabel}>LOAD PHOTO</div>
              <div style={styles.photoIcon}>📷</div>
            </div>
          )}
        </div>

        <input
          style={styles.nameInput}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="NAME SURNAME"
        />

        <input
          style={styles.countryInput}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder="COUNTRY"
        />

        <button style={styles.submitBtn} onClick={submit}>
          SUBMIT
        </button>

        <button style={styles.logoutBtn} onClick={logout}>
          LOG OUT
        </button>

        {msg && <div style={styles.msg}>{msg}</div>}
      </div>

      {cropOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.cropArea}>
              <Cropper
                image={rawImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(a, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>

            <div style={styles.zoomRow}>
              <div style={{ width: 60, fontWeight: 900 }}>Zoom</div>
              <input
                style={styles.zoomInput}
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.modalBtn} onClick={() => setCropOpen(false)}>
                Cancel
              </button>
              <button style={styles.modalBtn} onClick={applyCrop}>
                Use photo
              </button>
            </div>
          </div>
        </div>
      )}

      {successOpen && (
        <div style={styles.successOverlay} onClick={() => setSuccessOpen(false)}>
          <div style={styles.successModal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.successTitle}>Done</div>
            <div style={styles.successBody}>{successText}</div>
            <button style={styles.successOk} onClick={() => setSuccessOpen(false)}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}