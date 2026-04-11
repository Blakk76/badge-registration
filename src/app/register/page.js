"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Cropper from "react-easy-crop";
import { supabase } from "@/lib/supabaseClient";

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

const STATUS_OPTIONS = [
  "TEAM",
  "CONGRESS ONLY",
  "CONGRESS PARTICIPANT",
  "EWF EB MEMBER",
  "MEDIA",
  "LOC",
  "VIP",
  "VVIP",
  "DCO",
  "TV",
];

export default function RegisterPage() {
  const router = useRouter();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [sessionEmail, setSessionEmail] = useState("");
  const [userCountry, setUserCountry] = useState("");
  const [userRole, setUserRole] = useState("user");
  const [msg, setMsg] = useState("");

  const [successOpen, setSuccessOpen] = useState(false);
  const [successText, setSuccessText] = useState("");

  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("TEAM");

  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBlob, setPhotoBlob] = useState(null);

  const [cropOpen, setCropOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const [items, setItems] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const [countryFilter, setCountryFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [allCountries, setAllCountries] = useState([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("TEAM");
  const [editCountry, setEditCountry] = useState("");
  const [editPhotoPath, setEditPhotoPath] = useState(null);
  const [editPhotoUrl, setEditPhotoUrl] = useState(null);
  const [editPhotoBlob, setEditPhotoBlob] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  const [editCropOpen, setEditCropOpen] = useState(false);
  const [editRawImageSrc, setEditRawImageSrc] = useState(null);
  const [editCrop, setEditCrop] = useState({ x: 0, y: 0 });
  const [editZoom, setEditZoom] = useState(1);
  const [editCroppedAreaPixels, setEditCroppedAreaPixels] = useState(null);

  const isSuperuser = userRole === "superuser";

  function openSinglePdf(id) {
    window.open(`/api/badge/${id}`, "_blank");
  }

  function exportCountryPdf() {
    if (!countryFilter || countryFilter === "ALL") return;
    window.open(
      `/api/export-country?country=${encodeURIComponent(countryFilter)}`,
      "_blank"
    );
  }

  async function loadCountries() {
    const { data, error } = await supabase
      .from("registrations")
      .select("country")
      .order("country", { ascending: true });

    if (error) return;

    const unique = [...new Set((data || []).map((x) => x.country).filter(Boolean))];
    setAllCountries(unique);
  }

  async function loadRegistrations(email, role, selectedCountry = "ALL") {
    setLoadingList(true);

    let query = supabase
      .from("registrations")
      .select("id, created_at, full_name, country, status, photo_path, registered_by_email")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (role !== "superuser") {
      query = query.eq("registered_by_email", email);
    } else if (selectedCountry !== "ALL") {
      query = query.eq("country", selectedCountry);
    }

    const { data, error } = await query;

    if (error) {
      setMsg(error.message);
      setLoadingList(false);
      return;
    }

    const withUrls = await Promise.all(
      (data || []).map(async (r) => {
        if (!r.photo_path) return { ...r, photo_url: null };

        const { data: signed, error: signErr } = await supabase.storage
          .from("photos")
          .createSignedUrl(r.photo_path, 60 * 60);

        return { ...r, photo_url: signErr ? null : signed?.signedUrl };
      })
    );

    setItems(withUrls);
    setLoadingList(false);
  }

  useEffect(() => {
    let cancelled = false;

    const checkAuth = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        console.log("REGISTER PAGE SESSION:", data?.session);

        const email = data?.session?.user?.email?.toLowerCase();
        console.log("REGISTER PAGE EMAIL:", email);

        if (!email) {
          if (!cancelled) {
            setCheckingAuth(false);
            router.push("/login");
          }
          return;
        }

        const { data: allowed, error } = await supabase
          .from("allowed_users")
          .select("email, active, country, role")
          .eq("email", email)
          .eq("active", true)
          .maybeSingle();

        console.log("REGISTER PAGE ALLOWED USER:", allowed);
        console.log("REGISTER PAGE ALLOWED ERROR:", error);

        if (error) {
          if (!cancelled) {
            setMsg(error.message);
            setCheckingAuth(false);
          }
          return;
        }

        if (!allowed) {
          await supabase.auth.signOut();
          if (!cancelled) {
            setCheckingAuth(false);
            router.push("/login");
          }
          return;
        }

        if (!cancelled) {
          const role = allowed.role || "user";
          setSessionEmail(email);
          setUserRole(role);
          setUserCountry(allowed.country || "");
          setCountry(allowed.country || "");
          await loadRegistrations(email, role, "ALL");
          if (role === "superuser") {
            await loadCountries();
          }
          setCheckingAuth(false);
        }
      } catch (e) {
        console.error("REGISTER PAGE EXCEPTION:", e);
        if (!cancelled) {
          setMsg(String(e));
          setCheckingAuth(false);
        }
      }
    };

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!checkingAuth && isSuperuser) {
      loadRegistrations(sessionEmail, userRole, countryFilter);
    }
  }, [countryFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function onSelectEditFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setEditRawImageSrc(reader.result);
      setEditZoom(1);
      setEditCrop({ x: 0, y: 0 });
      setEditCropOpen(true);
    };
    reader.readAsDataURL(file);
  }

  async function applyEditCrop() {
    setMsg("");
    if (!editRawImageSrc || !editCroppedAreaPixels) return;

    const { blob, preview } = await getCroppedBlob(editRawImageSrc, editCroppedAreaPixels);
    if (!blob) return setMsg("Could not crop image.");

    setEditPhotoBlob(blob);
    setEditPhotoUrl(preview);
    setEditCropOpen(false);
  }

  async function submit() {
    setMsg("");

    if (!sessionEmail) return setMsg("Not logged in.");
    if (!fullName.trim()) return setMsg("Enter NAME SURNAME.");
    if (!country.trim()) return setMsg("Country is missing.");
    if (!status.trim()) return setMsg("Select STATUS.");
    if (!photoBlob) return setMsg("Upload and crop a photo.");

    const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
    const filePath = `${sessionEmail}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from("photos")
      .upload(filePath, photoBlob, {
        contentType: "image/jpeg",
        upsert: false,
      });

    if (uploadErr) return setMsg(uploadErr.message);

    const { error: insertErr } = await supabase.from("registrations").insert({
      registered_by_email: sessionEmail,
      full_name: fullName.trim(),
      country: country.trim(),
      status: status.trim(),
      photo_path: filePath,
    });

    if (insertErr) return setMsg(insertErr.message);

    setFullName("");
    setStatus("TEAM");
    setPhotoPreview(null);
    setPhotoBlob(null);

    if (!isSuperuser) {
      setCountry(userCountry || "");
    } else {
      setCountry("");
    }

    await loadRegistrations(sessionEmail, userRole, countryFilter);
    if (isSuperuser) {
      await loadCountries();
    }

    setSuccessText("Registration saved.");
    setSuccessOpen(true);
    setTimeout(() => setSuccessOpen(false), 2000);
  }

  function openEdit(r) {
    setEditId(r.id);
    setEditName(r.full_name || "");
    setEditStatus(r.status || "TEAM");
    setEditCountry(r.country || "");
    setEditPhotoPath(r.photo_path || null);
    setEditPhotoUrl(r.photo_url || null);
    setEditPhotoBlob(null);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editId) return;
    setMsg("");
    setEditSaving(true);

    let newPhotoPath = editPhotoPath;

    if (editPhotoBlob) {
      const newFileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
      newPhotoPath = `${sessionEmail}/${newFileName}`;

      const { error: uploadErr } = await supabase.storage
        .from("photos")
        .upload(newPhotoPath, editPhotoBlob, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (uploadErr) {
        setEditSaving(false);
        return setMsg(uploadErr.message);
      }
    }

    const { error } = await supabase
      .from("registrations")
      .update({
        full_name: editName.trim(),
        status: editStatus.trim(),
        country: editCountry.trim(),
        photo_path: newPhotoPath,
      })
      .eq("id", editId);

    if (error) {
      setEditSaving(false);
      return setMsg(error.message);
    }

    if (editPhotoBlob && editPhotoPath && editPhotoPath !== newPhotoPath) {
      await supabase.storage.from("photos").remove([editPhotoPath]);
    }

    setEditSaving(false);
    setEditOpen(false);
    await loadRegistrations(sessionEmail, userRole, countryFilter);
    if (isSuperuser) {
      await loadCountries();
    }
  }

  async function deleteEntry(id, photo_path) {
    const ok = window.confirm("Delete this registration?");
    if (!ok) return;

    setMsg("");

    const { error } = await supabase.from("registrations").delete().eq("id", id);
    if (error) return setMsg(error.message);

    if (photo_path) {
      await supabase.storage.from("photos").remove([photo_path]);
    }

    await loadRegistrations(sessionEmail, userRole, countryFilter);
    if (isSuperuser) {
      await loadCountries();
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return items;

    return items.filter((r) => {
      const haystack = [
        r.full_name,
        r.country,
        r.status,
        r.registered_by_email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [items, searchTerm]);

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
      appearance: "none",
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
      loadingPage: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#b21d3d",
        color: "white",
        fontFamily: "Arial",
        fontSize: 18,
        fontWeight: 700,
      },

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

      secondField: {
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

      infoText: {
        position: "absolute",
        left: 390,
        top: 530,
        width: 360,
        color: "white",
        fontSize: 13,
        lineHeight: 1.4,
        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
      },

      superuserText: {
        position: "absolute",
        left: 390,
        top: 555,
        width: 360,
        color: "#f4e9d1",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.3,
        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
      },

      msg: {
        position: "absolute",
        left: 390,
        top: 585,
        width: 380,
        color: "white",
        fontSize: 14,
        textShadow: "0 1px 2px rgba(0,0,0,0.45)",
      },

      listWrap: {
        width: 800,
      },
      listHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
        color: "white",
        gap: 10,
      },
      listTitle: {
        fontSize: 16,
        fontWeight: 900,
      },
      listCount: {
        fontSize: 13,
        opacity: 0.85,
        whiteSpace: "nowrap",
      },
      filterWrap: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        justifyContent: "flex-end",
      },
      filterSelect: {
        height: 40,
        borderRadius: 12,
        border: "none",
        padding: "0 12px",
        fontSize: 14,
        fontWeight: 600,
        background: "rgba(255,255,255,0.95)",
      },
      searchInput: {
        height: 40,
        borderRadius: 12,
        border: "none",
        padding: "0 12px",
        fontSize: 14,
        fontWeight: 600,
        background: "rgba(255,255,255,0.95)",
        minWidth: 220,
        outline: "none",
      },
      exportBtn: {
        height: 40,
        borderRadius: 12,
        border: "none",
        padding: "0 14px",
        fontSize: 14,
        fontWeight: 800,
        background: "#c2b69b",
        color: "#222",
        cursor: "pointer",
        opacity: countryFilter === "ALL" ? 0.5 : 1,
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
      pdfBtn: {
        height: 30,
        borderRadius: 10,
        border: "1px solid rgba(0,0,0,0.12)",
        padding: "0 10px",
        background: "#c2b69b",
        color: "#222",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
        lineHeight: 1,
      },

      // MAIN MODALS
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
        width: "min(460px, 100%)",
        background: "white",
        borderRadius: 14,
        padding: 18,
        textAlign: "center",
        position: "relative",
        zIndex: 10001,
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

      // CROP MODALS - HIGHER Z-INDEX
      cropOverlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 20000,
      },
      cropModal: {
        width: "min(560px, 100%)",
        background: "white",
        borderRadius: 12,
        overflow: "hidden",
        position: "relative",
        zIndex: 20001,
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
      editSelect: {
        width: "100%",
        height: 44,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.15)",
        padding: "0 12px",
        fontSize: 14,
        fontWeight: 600,
        outline: "none",
        background: "white",
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
      editPhotoPreviewWrap: {
        display: "flex",
        justifyContent: "center",
        marginTop: 6,
      },
      editPhotoPreview: {
        width: 90,
        height: 90,
        borderRadius: "50%",
        objectFit: "cover",
        background: "#eee",
      },
      editPhotoBtn: {
        width: "100%",
        padding: 10,
        borderRadius: 10,
        cursor: "pointer",
        fontWeight: 800,
        background: "#f3f3f3",
        border: "1px solid rgba(0,0,0,0.15)",
      },
    };
  }, [editSaving, countryFilter]);

  if (checkingAuth) {
    return <div style={styles.loadingPage}>Loading...</div>;
  }

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

        {isSuperuser ? (
          <input
            style={styles.secondField}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="COUNTRY"
          />
        ) : (
          <select
            style={styles.secondField}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}

        {isSuperuser && (
          <select
            style={{
              ...styles.secondField,
              top: 444,
              width: 250,
            }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}

        <button
          style={{
            ...styles.submitBtn,
            top: isSuperuser ? 510 : 460,
          }}
          onClick={submit}
        >
          SUBMIT
        </button>

        <button
          style={{
            ...styles.logoutBtn,
            top: isSuperuser ? 510 : 460,
          }}
          onClick={logout}
        >
          LOG OUT
        </button>

        <div
          style={{
            ...styles.infoText,
            top: isSuperuser ? 580 : 530,
          }}
        >
          Country: <strong>{country || "Not set"}</strong>
        </div>

        {isSuperuser && (
          <div
            style={{
              ...styles.superuserText,
              top: isSuperuser ? 605 : 555,
            }}
          >
            SUPERUSER MODE
          </div>
        )}

        {msg && (
          <div
            style={{
              ...styles.msg,
              top: isSuperuser ? 635 : 585,
            }}
          >
            {msg}
          </div>
        )}
      </div>

      <div style={styles.listWrap}>
        <div style={styles.listHeader}>
          <div style={styles.listTitle}>
            {isSuperuser ? "All registrations" : "Your registrations"}
          </div>

          <div style={styles.filterWrap}>
            {isSuperuser && (
              <>
                <select
                  style={styles.filterSelect}
                  value={countryFilter}
                  onChange={(e) => setCountryFilter(e.target.value)}
                >
                  <option value="ALL">All countries</option>
                  {allCountries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <input
                  style={styles.searchInput}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search person, country, status..."
                />

                <button
                  style={styles.exportBtn}
                  onClick={exportCountryPdf}
                  disabled={countryFilter === "ALL"}
                >
                  Export 3×3 PDF
                </button>
              </>
            )}

            <div style={styles.listCount}>
              {loadingList ? "Loading..." : `${filteredItems.length}`}
            </div>
          </div>
        </div>

        <div style={styles.listBox}>
          {filteredItems.length === 0 && !loadingList && (
            <div style={{ padding: 10, opacity: 0.7 }}>No registrations yet.</div>
          )}

          {filteredItems.map((r, idx) => (
            <div
              key={r.id}
              style={{
                ...styles.row,
                ...(idx === filteredItems.length - 1 ? styles.rowLast : {}),
              }}
            >
              {r.photo_url ? (
                <img src={r.photo_url} alt="" style={styles.thumb} />
              ) : (
                <div style={styles.thumb} />
              )}

              <div style={styles.rowMain}>
                <div style={styles.rowName}>{r.full_name}</div>
                <div style={styles.rowMeta}>
                  {r.country} · {r.status || "TEAM"}
                  {isSuperuser ? ` · entered by ${r.registered_by_email}` : ""}
                </div>
              </div>

              <div style={styles.rowRight}>
                {isSuperuser && (
                  <button
                    title="PDF"
                    style={styles.pdfBtn}
                    onClick={() => openSinglePdf(r.id)}
                  >
                    PDF
                  </button>
                )}

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
        <div style={styles.cropOverlay}>
          <div style={styles.cropModal}>
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

      {editCropOpen && (
        <div style={styles.cropOverlay}>
          <div style={styles.cropModal}>
            <div style={styles.cropArea}>
              <Cropper
                image={editRawImageSrc}
                crop={editCrop}
                zoom={editZoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setEditCrop}
                onZoomChange={setEditZoom}
                onCropComplete={(a, pixels) => setEditCroppedAreaPixels(pixels)}
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
                value={editZoom}
                onChange={(e) => setEditZoom(Number(e.target.value))}
              />
            </div>

            <div style={styles.modalFooter}>
              <button style={styles.modalBtn} onClick={() => setEditCropOpen(false)}>
                Cancel
              </button>
              <button style={styles.modalBtn} onClick={applyEditCrop}>
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

              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                style={styles.editSelect}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>

              <div style={styles.editPhotoPreviewWrap}>
                {editPhotoUrl ? (
                  <img src={editPhotoUrl} alt="Preview" style={styles.editPhotoPreview} />
                ) : (
                  <div style={styles.editPhotoPreview} />
                )}
              </div>

              <input
                id="edit-file"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={onSelectEditFile}
              />

              <button
                type="button"
                style={styles.editPhotoBtn}
                onClick={() => document.getElementById("edit-file")?.click()}
              >
                Replace photo
              </button>
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