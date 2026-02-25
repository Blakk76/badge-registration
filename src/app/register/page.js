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

  // list
  const [items, setItems] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  // edit modal (no photo re-upload)
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function loadMyRegistrations(email) {
    setLoadingList(true);

    const { data, error } = await supabase
      .from("registrations")
      .select("id, created_at, full_name, country, photo_path")
      .eq("registered_by_email", email)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      setMsg(error.message);
      setLoadingList(false);
      return;
    }

    // Generate signed URLs for thumbnails (private bucket)
    const withUrls = await Promise.all(
      (data || []).map(async (r) => {
        if (!r.photo_path) return { ...r, photo_url: null };

        const { data: signed, error: signErr } = await supabase.storage
          .from("photos")
          .createSignedUrl(r.photo_path, 60 * 60); // 1 hour

        return { ...r, photo_url: signErr ? null : signed?.signedUrl };
      })
    );

    setItems(withUrls);
    setLoadingList(false);
  }

  // Require auth + whitelist check + AUTO-FILL COUNTRY FROM allowed_users.country
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email?.toLowerCase();
      if (!email) return router.push("/login");

      const { data: allowed, error } = await supabase
        .from("allowed_users")
        .select("email, active, country")
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

      // autofill country once (user can still edit)
      if (allowed?.country && !country.trim()) {
        setCountry(allowed.country);
      }

      loadMyRegistrations(email);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]); // intentionally not depending on `country` to avoid refire

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

    // reset form (keep country as convenience)
    setFullName("");
    setPhotoPreview(null);
    setPhotoBlob(null);

    // refresh list
    await loadMyRegistrations(sessionEmail);

    // success popup
    setSuccessText("Registration saved.");
    setSuccessOpen(true);
    setTimeout(() => setSuccessOpen(false), 2000);
  }

  function openEdit(r) {
    setEditId(r.id);
    setEditName(r.full_name || "");
    setEditCountry(r.country || "");
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId) return;
    setMsg("");
    setEditSaving(true);

    const { error } = await supabase
      .from("registrations")
      .update({
        full_name: editName.trim(),
        country: editCountry.trim(),
      })
      .eq("id", editId);

    setEditSaving(false);

    if (error) return setMsg(error.message);

    setEditOpen(false);
    await loadMyRegistrations(sessionEmail);
  }

  async function deleteEntry(id, photo_path) {
    const ok = window.confirm("Delete this registration?");
    if (!ok) return;

    setMsg("");

    const { error } = await supabase.from("registrations").delete().eq("id", id);
    if (error) return setMsg(error.message);

    // also delete photo file (recommended)
    if (photo_path) {
      await supabase.storage.from("photos").remove([photo_path]);
    }

    await loadMyRegistrations(sessionEmail);
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

    const iconBtn = {
      width: 30,
      height: 30,
      borderRadius: 10,
      border: "1px solid rgba(0,0,0,0.12)",
      background: "white",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 900,
      lineHeight: 1,
    };

    return {
      page: {
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Arial",
        padding: 20,
        gap: 14,
        background: "#b21d3d",
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
        boxShadow: "0 18px 44px rgba(0,0,0,0.28)",
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

      // list: show ~5 rows, scroll if more
      listWrap: {
        width: 800,
      },
      listHeader: {
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 10,
        color: "white",
      },
      listTitle: {
        fontSize: 16,
        fontWeight: 900,
      },
      listCount: {
        fontSize: 13,
        opacity: 0.85,
      },
      listBox: {
        background: "rgba(255,255,255,0.96)",
        borderRadius: 16,
        padding: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        maxHeight: 5 * 60 + 8,
        overflowY: "auto",
      },
      row: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 8px",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        minHeight: 60,
      },
      rowLast: {
        borderBottom: "none",
      },
      thumb: {
        width: 44,
        height: 44,
        borderRadius: "50%",
        objectFit: "cover",
        background: "#eee",
        flex: "0 0 auto",
      },
      rowMain: {
        minWidth: 0,
        flex: 1,
      },
      rowName: {
        fontWeight: 900,
        fontSize: 14,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      rowMeta: {
        fontSize: 12,
        opacity: 0.75,
      },
      rowRight: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginLeft: 8,
        flex: "0 0 auto",
      },
      iconBtn,

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

      // overlay base for popups
      overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 10000,
      },
      modalCard: {
        width: "min(420px, 100%)",
        background: "white",
        borderRadius: 14,
        padding: 18,
        textAlign: "center",
      },
      modalTitle: {
        fontSize: 18,
        fontWeight: 900,
        marginBottom: 8,
      },
      modalBody: {
        fontSize: 14,
        marginBottom: 14,
      },
      okBtn: {
        width: "100%",
        padding: 10,
        borderRadius: 10,
        border: "none",
        cursor: "pointer",
        fontWeight: 900,
        background: "#c2b69b",
        color: "#222",
      },

      // edit inputs
      editInput: {
        width: "100%",
        height: 44,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.15)",
        padding: "0 12px",
        fontSize: 14,
        fontWeight: 600,
        outline: "none",
      },
      editRow: {
        display: "grid",
        gap: 10,
        marginTop: 10,
      },
      editFooter: {
        display: "flex",
        gap: 10,
        marginTop: 14,
      },
      editCancel: {
        width: "100%",
        padding: 10,
        borderRadius: 10,
        cursor: "pointer",
        fontWeight: 900,
        background: "white",
        border: "1px solid rgba(0,0,0,0.15)",
      },
      editSave: {
        width: "100%",
        padding: 10,
        borderRadius: 10,
        border: "none",
        cursor: "pointer",
        fontWeight: 900,
        background: "#c2b69b",
        color: "#222",
        opacity: editSaving ? 0.7 : 1,
      },
    };
  }, [editSaving]);

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

      <div style={styles.listWrap}>
        <div style={styles.listHeader}>
          <div style={styles.listTitle}>Your registrations</div>
          <div style={styles.listCount}>
            {loadingList ? "Loading..." : `${items.length}`}
          </div>
        </div>

        <div style={styles.listBox}>
          {items.length === 0 && !loadingList && (
            <div style={{ padding: 10, opacity: 0.7 }}>No registrations yet.</div>
          )}

          {items.map((r, idx) => (
            <div
              key={r.id}
              style={{
                ...styles.row,
                ...(idx === items.length - 1 ? styles.rowLast : {}),
              }}
            >
              {r.photo_url ? (
                <img src={r.photo_url} alt="" style={styles.thumb} />
              ) : (
                <div style={styles.thumb} />
              )}

              <div style={styles.rowMain}>
                <div style={styles.rowName}>{r.full_name}</div>
                <div style={styles.rowMeta}>{r.country}</div>
              </div>

              <div style={styles.rowRight}>
                <button title="Edit" style={styles.iconBtn} onClick={() => openEdit(r)}>
                  ✎
                </button>
                <button
                  title="Delete"
                  style={styles.iconBtn}
                  onClick={() => deleteEntry(r.id, r.photo_path)}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
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
        <div style={styles.overlay} onClick={() => setSuccessOpen(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Done</div>
            <div style={styles.modalBody}>{successText}</div>
            <button style={styles.okBtn} onClick={() => setSuccessOpen(false)}>
              OK
            </button>
          </div>
        </div>
      )}

      {editOpen && (
        <div style={styles.overlay} onClick={() => setEditOpen(false)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Edit registration</div>

            <div style={styles.editRow}>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="NAME SURNAME"
                style={styles.editInput}
              />
              <input
                value={editCountry}
                onChange={(e) => setEditCountry(e.target.value)}
                placeholder="COUNTRY"
                style={styles.editInput}
              />
            </div>

            <div style={styles.editFooter}>
              <button style={styles.editCancel} onClick={() => setEditOpen(false)}>
                Cancel
              </button>
              <button style={styles.editSave} onClick={saveEdit} disabled={editSaving}>
                {editSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}